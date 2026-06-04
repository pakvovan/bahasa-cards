/* Слой данных + аутентификация на Supabase.
   Две базы:
     • Личная (таблица words) — слова пользователя.
     • Готовая (общий словарь window.DICTIONARY + прогресс в dict_progress).
   Интервальное повторение: у слова есть due (когда повторить) и streak.

   ОФЛАЙН: слова и прогресс кешируются в localStorage (читаются без сети).
   Изменения, сделанные офлайн, складываются в очередь и синхронизируются,
   когда сеть возвращается (Store.syncNow / событие online).
*/
const Store = (() => {
  const STATUS = {
    learning: { id: "learning", label: "Учу",        color: "#e8590c" },
    known:    { id: "known",    label: "Знаю",       color: "#2f9e44" },
    review:   { id: "review",   label: "Повторение", color: "#1971c2" },
  };

  let sb = null;
  let user = null;
  let words = [];
  let dictProgress = null; // {dict_id: {status,streak,due,indo,rus}}
  const wordListeners = new Set();
  const authListeners = new Set();

  const DAY = 86400000;

  function nextSchedule(status, prevStreak) {
    let streak = prevStreak || 0;
    let ms;
    if (status === "learning") {
      streak = 0;
      ms = 0;
    } else if (status === "review") {
      streak = 0;
      ms = DAY;
    } else {
      streak = streak + 1;
      ms = Math.min(60, Math.pow(2, streak - 1)) * DAY;
    }
    return { streak, due: new Date(Date.now() + ms).toISOString() };
  }
  function isDue(due) {
    return !!due && new Date(due).getTime() <= Date.now();
  }

  // ---- локальный кеш (для офлайна), ключи привязаны к пользователю ----
  function ck(k) {
    return "bahasa_cache_" + (user ? user.id : "anon") + "_" + k;
  }
  function readCache(k) {
    try {
      return JSON.parse(localStorage.getItem(ck(k)));
    } catch (e) {
      return null;
    }
  }
  function writeCache(k, v) {
    try {
      localStorage.setItem(ck(k), JSON.stringify(v));
    } catch (e) {}
  }
  const persistWords = () => writeCache("words", words);
  const persistDict = () => writeCache("dictprog", dictProgress || {});

  // ---- очередь офлайн-изменений ----
  function enqueue(op) {
    const q = readCache("pending") || [];
    q.push(op);
    writeCache("pending", q.slice(-1000));
  }
  // выполнить запись на сервер; при ошибке (офлайн) — положить в очередь
  function serverWrite(builder, op) {
    try {
      builder
        .then(({ error }) => {
          if (error) enqueue(op);
        })
        .catch(() => enqueue(op));
    } catch (e) {
      enqueue(op);
    }
  }
  async function flushPending() {
    if (!user) return;
    const q = readCache("pending");
    if (!Array.isArray(q) || !q.length) return;
    const remain = [];
    for (const op of q) {
      try {
        let r;
        if (op.t === "wU") r = await sb.from("words").update(op.patch).eq("id", op.id);
        else if (op.t === "wD") r = await sb.from("words").delete().eq("id", op.id);
        else if (op.t === "dU")
          r = await sb
            .from("dict_progress")
            .upsert(op.row, { onConflict: "user_id,dict_id" });
        if (r && r.error) remain.push(op);
      } catch (e) {
        remain.push(op);
      }
    }
    writeCache("pending", remain);
  }

  function configured() {
    const c = window.SUPABASE_CONFIG;
    return !!(
      c &&
      c.url &&
      c.anonKey &&
      !/ВСТАВ|PASTE|XXXX/i.test(c.url) &&
      !/ВСТАВ|PASTE|XXXX/i.test(c.anonKey)
    );
  }

  function notifyWords() {
    wordListeners.forEach((fn) => fn(words));
  }
  function notifyAuth() {
    authListeners.forEach((fn) => fn(user));
  }

  function rowToWord(r) {
    return {
      id: r.id,
      indo: r.indo,
      rus: r.rus,
      cat: r.cat,
      status: r.status,
      added: r.added,
      due: r.due || null,
      streak: r.streak || 0,
    };
  }

  function translateAuthError(err) {
    const m = (err && err.message) || "Ошибка";
    if (/invalid login credentials/i.test(m)) return "Неверный email или пароль";
    if (/already registered|already exists/i.test(m))
      return "Этот email уже зарегистрирован — войди";
    if (/password should be at least/i.test(m))
      return "Пароль слишком короткий (минимум 6 символов)";
    if (/unable to validate email|invalid email/i.test(m))
      return "Похоже, email введён неверно";
    if (/rate limit|too many/i.test(m)) return "Слишком много попыток, подожди немного";
    if (/failed to fetch|networkerror|load failed/i.test(m))
      return "Нет связи с сервером — проверь интернет";
    return m;
  }

  // мгновенно показать слова из кеша (для офлайна — без ожидания сети)
  function applyCachedWords() {
    const cached = readCache("words");
    words = Array.isArray(cached) ? cached : [];
    notifyWords();
  }
  // обновить слова с сервера; офлайн/ошибка — молча оставить кеш
  async function refreshWords() {
    try {
      const { data, error } = await sb
        .from("words")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) return;
      words = (data || []).map(rowToWord);
      persistWords();
      notifyWords();
    } catch (e) {}
  }

  function upsertDict(id, p) {
    const row = {
      user_id: user.id,
      dict_id: id,
      status: p.status || "learning",
      streak: p.streak || 0,
      due: p.due || null,
      indo: p.indo || null,
      rus: p.rus || null,
    };
    serverWrite(
      sb.from("dict_progress").upsert(row, { onConflict: "user_id,dict_id" }),
      { t: "dU", id, row }
    );
  }

  return {
    STATUS,
    isDue,
    configured,

    async init() {
      if (!configured()) return { configured: false };
      // fetch с таймаутом — чтобы офлайн-запросы не «висели» по 10+ секунд
      const tfetch = (input, opts) => {
        const ctrl = new AbortController();
        const id = setTimeout(() => ctrl.abort(), 6000);
        return fetch(input, Object.assign({}, opts, { signal: ctrl.signal }))
          .finally(() => clearTimeout(id));
      };
      sb = window.supabase.createClient(
        window.SUPABASE_CONFIG.url,
        window.SUPABASE_CONFIG.anonKey,
        { global: { fetch: tfetch } }
      );
      const {
        data: { session },
      } = await sb.auth.getSession();
      user = session ? session.user : null;
      sb.auth.onAuthStateChange((event, sess) => {
        const newUser = sess ? sess.user : null;
        const changed = (newUser && newUser.id) !== (user && user.id);
        user = newUser;
        if (event === "SIGNED_OUT" || (changed && !newUser)) {
          words = [];
          dictProgress = null;
          notifyAuth();
        }
      });
      if (user) {
        applyCachedWords(); // мгновенно из кеша
        // сеть — в фоне, не блокируем открытие
        flushPending().then(refreshWords).catch(() => {});
      }
      return { configured: true, user };
    },

    currentUser() {
      return user;
    },
    onAuth(fn) {
      authListeners.add(fn);
      return () => authListeners.delete(fn);
    },

    // синхронизация при возврате сети
    async syncNow() {
      if (!user) return;
      await flushPending();
      await refreshWords();
      if (dictProgress !== null) await this.dictRefresh();
    },

    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) return { ok: false, error: translateAuthError(error) };
      if (data.session) {
        user = data.user;
        applyCachedWords();
        await flushPending();
        await refreshWords();
        return { ok: true };
      }
      return { ok: true, needConfirm: true };
    },

    async signIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({
        email,
        password,
      });
      if (error) return { ok: false, error: translateAuthError(error) };
      user = data.user;
      applyCachedWords();
      await flushPending();
      await refreshWords();
      return { ok: true };
    },

    async signOut() {
      if (sb) await sb.auth.signOut();
      user = null;
      words = [];
      dictProgress = null;
    },

    // ====== ЛИЧНАЯ БАЗА ======
    subscribe(fn) {
      wordListeners.add(fn);
      return () => wordListeners.delete(fn);
    },
    all() {
      return words.slice();
    },
    byStatus(status) {
      return words.filter((w) => w.status === status);
    },
    due() {
      return words.filter((w) => isDue(w.due));
    },
    counts() {
      const c = { learning: 0, known: 0, review: 0, due: 0, total: words.length };
      words.forEach((w) => {
        c[w.status] = (c[w.status] || 0) + 1;
        if (isDue(w.due)) c.due++;
      });
      return c;
    },
    categories() {
      return [...new Set(words.map((w) => w.cat))].sort((a, b) =>
        a.localeCompare(b, "ru")
      );
    },

    async add({ indo, rus, cat }) {
      indo = (indo || "").trim();
      rus = (rus || "").trim();
      if (!indo || !rus) return { ok: false, error: "Заполни слово и перевод" };
      if (words.find((w) => w.indo.toLowerCase() === indo.toLowerCase()))
        return { ok: false, error: "Такое слово уже есть" };
      const row = {
        user_id: user.id,
        indo,
        rus,
        cat: (cat || "").trim() || "Мои слова",
        status: "learning",
        added: true,
      };
      const { data, error } = await sb
        .from("words")
        .insert(row)
        .select()
        .single();
      if (error)
        return {
          ok: false,
          error: /fetch|network/i.test(error.message || "")
            ? "Добавление новых слов недоступно офлайн"
            : "Ошибка сохранения: " + error.message,
        };
      const w = rowToWord(data);
      words.unshift(w);
      persistWords();
      notifyWords();
      return { ok: true, word: w };
    },

    setStatus(id, status) {
      const w = words.find((x) => x.id === id);
      if (!w) return;
      const s = nextSchedule(status, w.streak);
      w.status = status;
      w.streak = s.streak;
      w.due = s.due;
      notifyWords();
      persistWords();
      const patch = { status, streak: s.streak, due: s.due };
      serverWrite(sb.from("words").update(patch).eq("id", id), {
        t: "wU",
        id,
        patch,
      });
    },

    update(id, fields) {
      const w = words.find((x) => x.id === id);
      if (!w) return { ok: false };
      const indo = fields.indo !== undefined ? fields.indo.trim() : w.indo;
      const rus = fields.rus !== undefined ? fields.rus.trim() : w.rus;
      if (!indo || !rus) return { ok: false, error: "Пусто" };
      w.indo = indo;
      w.rus = rus;
      notifyWords();
      persistWords();
      const patch = { indo, rus };
      serverWrite(sb.from("words").update(patch).eq("id", id), {
        t: "wU",
        id,
        patch,
      });
      return { ok: true };
    },

    remove(id) {
      words = words.filter((w) => w.id !== id);
      notifyWords();
      persistWords();
      serverWrite(sb.from("words").delete().eq("id", id), { t: "wD", id });
    },

    async clearAll() {
      words = [];
      persistWords();
      notifyWords();
      const { error } = await sb.from("words").delete().eq("user_id", user.id);
      if (error) console.error("clearAll:", error);
    },

    exportJSON() {
      return JSON.stringify(words, null, 2);
    },

    // Обратная связь
    async sendFeedback(message) {
      message = (message || "").trim();
      if (!message) return { ok: false, error: "Напиши сообщение" };
      if (message.length > 4000)
        return { ok: false, error: "Слишком длинно (макс. 4000 символов)" };
      const row = {
        user_id: user ? user.id : null,
        email: user ? user.email : null,
        message,
      };
      const { error } = await sb.from("feedback").insert(row);
      if (error)
        return {
          ok: false,
          error: /fetch|network/i.test(error.message || "")
            ? "Нет интернета — попробуй позже"
            : error.message,
        };
      return { ok: true };
    },

    // ====== ГОТОВАЯ БАЗА ======
    dictLoaded() {
      return dictProgress !== null;
    },
    async dictLoad() {
      // мгновенно из кеша, сеть — в фоне (офлайн не ждёт таймаута)
      const cached = readCache("dictprog");
      dictProgress = cached && typeof cached === "object" ? cached : {};
      notifyWords();
      this.dictRefresh();
    },
    dictRefresh() {
      return sb
        .from("dict_progress")
        .select("*")
        .then(({ data, error }) => {
          if (error) return;
          dictProgress = {};
          (data || []).forEach((r) => {
            dictProgress[r.dict_id] = {
              status: r.status || "learning",
              streak: r.streak || 0,
              due: r.due || null,
              indo: r.indo || null,
              rus: r.rus || null,
            };
          });
          persistDict();
          notifyWords();
        })
        .catch(() => {});
    },
    dictAll() {
      const dict = window.DICTIONARY || [];
      return dict.map((w) => {
        const p = dictProgress && dictProgress[w.id];
        return {
          id: w.id,
          indo: (p && p.indo) || w.indo,
          rus: (p && p.rus) || w.rus,
          cat: w.cat,
          status: (p && p.status) || "learning",
          due: (p && p.due) || null,
          streak: (p && p.streak) || 0,
          added: false,
          edited: !!(p && (p.indo || p.rus)),
        };
      });
    },
    dictByStatus(status) {
      return this.dictAll().filter((w) => w.status === status);
    },
    dictDue() {
      return this.dictAll().filter((w) => isDue(w.due));
    },
    dictCounts() {
      const dict = window.DICTIONARY || [];
      const c = { learning: 0, known: 0, review: 0, due: 0, total: dict.length };
      dict.forEach((w) => {
        const p = dictProgress && dictProgress[w.id];
        const st = (p && p.status) || "learning";
        c[st] = (c[st] || 0) + 1;
        if (p && isDue(p.due)) c.due++;
      });
      return c;
    },
    dictCategories() {
      return [...new Set((window.DICTIONARY || []).map((w) => w.cat))].sort(
        (a, b) => a.localeCompare(b, "ru")
      );
    },
    dictSetStatus(id, status) {
      if (!dictProgress) dictProgress = {};
      const p = dictProgress[id] || {};
      const s = nextSchedule(status, p.streak);
      const np = { ...p, status, streak: s.streak, due: s.due };
      dictProgress[id] = np;
      notifyWords();
      persistDict();
      upsertDict(id, np);
    },
    dictEdit(id, { indo, rus }) {
      if (!dictProgress) dictProgress = {};
      const p = dictProgress[id] || { status: "learning", streak: 0, due: null };
      if (indo !== undefined) p.indo = indo.trim() || null;
      if (rus !== undefined) p.rus = rus.trim() || null;
      dictProgress[id] = p;
      notifyWords();
      persistDict();
      upsertDict(id, p);
    },
  };
})();
