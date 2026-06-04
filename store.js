/* Слой данных + аутентификация на Supabase.
   Две базы:
     • Личная (таблица words) — слова пользователя.
     • Готовая (общий словарь window.DICTIONARY + прогресс в dict_progress).
   Плюс интервальное повторение: у слова есть due (когда повторить) и streak.

   Статусы (корзины): "learning" | "known" | "review".
*/
const Store = (() => {
  const STATUS = {
    learning: { id: "learning", label: "Учу",        color: "#e8590c" },
    known:    { id: "known",    label: "Знаю",       color: "#2f9e44" },
    review:   { id: "review",   label: "Повторение", color: "#1971c2" },
  };

  let sb = null;      // клиент Supabase
  let user = null;    // текущий пользователь
  let words = [];     // кеш ЛИЧНЫХ слов пользователя
  let dictProgress = null; // прогресс готовой базы: {dict_id: {status,streak,due,indo,rus}}
  const wordListeners = new Set();
  const authListeners = new Set();

  const DAY = 86400000;

  // --- интервальное повторение: считаем следующую дату по ответу ---
  function nextSchedule(status, prevStreak) {
    let streak = prevStreak || 0;
    let ms;
    if (status === "learning") {        // «Не знаю» → ещё сегодня
      streak = 0;
      ms = 0;
    } else if (status === "review") {   // «Повторить» → завтра
      streak = 0;
      ms = DAY;
    } else {                            // «Знаю» → растущий интервал 1,2,4,8…60 дней
      streak = streak + 1;
      ms = Math.min(60, Math.pow(2, streak - 1)) * DAY;
    }
    return { streak, due: new Date(Date.now() + ms).toISOString() };
  }
  function isDue(due) {
    return !!due && new Date(due).getTime() <= Date.now();
  }

  // --- конфигурация ---
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
    return m;
  }

  async function loadWords() {
    const { data, error } = await sb
      .from("words")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Ошибка загрузки слов:", error);
      words = [];
      notifyWords();
      return;
    }
    words = (data || []).map(rowToWord);
    if (words.length === 0) {
      await seedForUser();
    }
    notifyWords();
  }

  async function seedForUser() {
    const seed = (window.SEED_WORDS || []).map((w) => ({
      user_id: user.id,
      indo: w.indo,
      rus: w.rus,
      cat: w.cat || "Без категории",
      status: "learning",
      added: false,
    }));
    if (!seed.length) return;
    const { data, error } = await sb.from("words").insert(seed).select();
    if (error) {
      console.error("Ошибка наполнения стартовым набором:", error);
      return;
    }
    words = (data || []).map(rowToWord);
    notifyWords();
  }

  // upsert строки прогресса готовой базы целиком (чтобы не затирать переопределения)
  function upsertDict(id, p) {
    sb.from("dict_progress")
      .upsert(
        {
          user_id: user.id,
          dict_id: id,
          status: p.status || "learning",
          streak: p.streak || 0,
          due: p.due || null,
          indo: p.indo || null,
          rus: p.rus || null,
        },
        { onConflict: "user_id,dict_id" }
      )
      .then(({ error }) => {
        if (error) {
          // возможно, ещё нет колонок streak/due/indo/rus — сохраним хотя бы статус
          sb.from("dict_progress")
            .upsert(
              { user_id: user.id, dict_id: id, status: p.status || "learning" },
              { onConflict: "user_id,dict_id" }
            )
            .then(({ error: e2 }) => e2 && console.error("dict upsert:", e2));
        }
      });
  }

  return {
    STATUS,
    isDue,
    configured,

    // ---- инициализация ----
    async init() {
      if (!configured()) return { configured: false };
      sb = window.supabase.createClient(
        window.SUPABASE_CONFIG.url,
        window.SUPABASE_CONFIG.anonKey
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
      if (user) await loadWords();
      return { configured: true, user };
    },

    // ---- аутентификация ----
    currentUser() {
      return user;
    },
    onAuth(fn) {
      authListeners.add(fn);
      return () => authListeners.delete(fn);
    },

    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) return { ok: false, error: translateAuthError(error) };
      if (data.session) {
        user = data.user;
        await loadWords();
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
      await loadWords();
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
      if (error) return { ok: false, error: "Ошибка сохранения: " + error.message };
      const w = rowToWord(data);
      words.unshift(w);
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
      sb.from("words")
        .update({ status, streak: s.streak, due: s.due })
        .eq("id", id)
        .then(({ error }) => {
          if (error) {
            // возможно, ещё нет колонок due/streak — сохраним хотя бы статус
            sb.from("words")
              .update({ status })
              .eq("id", id)
              .then(({ error: e2 }) => e2 && console.error("setStatus:", e2));
          }
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
      sb.from("words")
        .update({ indo, rus })
        .eq("id", id)
        .then(({ error }) => error && console.error("update:", error));
      return { ok: true };
    },

    remove(id) {
      words = words.filter((w) => w.id !== id);
      notifyWords();
      sb.from("words")
        .delete()
        .eq("id", id)
        .then(({ error }) => error && console.error("remove:", error));
    },

    async resetAll() {
      const { error } = await sb.from("words").delete().eq("user_id", user.id);
      if (error) {
        console.error("resetAll:", error);
        return;
      }
      words = [];
      await seedForUser();
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
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    },

    // Импорт слов из уроков в личную базу (без дублей по indo)
    async importLessons() {
      const lessons = window.LESSON_WORDS || [];
      if (!lessons.length) return { added: 0, skipped: 0 };
      const have = new Set(words.map((w) => w.indo.toLowerCase()));
      const seen = new Set();
      const fresh = [];
      lessons.forEach((w) => {
        const k = w.indo.toLowerCase();
        if (have.has(k) || seen.has(k)) return;
        seen.add(k);
        fresh.push({
          user_id: user.id,
          indo: w.indo,
          rus: w.rus,
          cat: w.cat,
          status: "learning",
          added: true,
        });
      });
      if (!fresh.length) return { added: 0, skipped: lessons.length };
      const { data, error } = await sb.from("words").insert(fresh).select();
      if (error) return { added: 0, error: error.message };
      const added = (data || []).map(rowToWord);
      words = added.concat(words);
      notifyWords();
      return { added: added.length, skipped: lessons.length - added.length };
    },

    // ====== ГОТОВАЯ БАЗА ======
    dictLoaded() {
      return dictProgress !== null;
    },
    async dictLoad() {
      const { data, error } = await sb.from("dict_progress").select("*");
      dictProgress = {};
      if (error) {
        console.error("Ошибка загрузки прогресса готовой базы:", error);
      } else {
        (data || []).forEach((r) => {
          dictProgress[r.dict_id] = {
            status: r.status || "learning",
            streak: r.streak || 0,
            due: r.due || null,
            indo: r.indo || null,
            rus: r.rus || null,
          };
        });
      }
      notifyWords();
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
      upsertDict(id, np);
    },
    dictEdit(id, { indo, rus }) {
      if (!dictProgress) dictProgress = {};
      const p = dictProgress[id] || { status: "learning", streak: 0, due: null };
      if (indo !== undefined) p.indo = indo.trim() || null;
      if (rus !== undefined) p.rus = rus.trim() || null;
      dictProgress[id] = p;
      notifyWords();
      upsertDict(id, p);
    },
  };
})();
