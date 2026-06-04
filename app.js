/* UI приложения карточек. Чистый JS, без сборки. */
(() => {
  const S = Store.STATUS;
  const root = document.getElementById("view");
  const tabsEl = document.getElementById("tabs");
  const statsEl = document.getElementById("stats");

  // Состояние UI (не сохраняется, кроме активной вкладки)
  const ui = {
    tab: "study",        // study | list | add
    authMode: "login",   // login | register
    base: "mine",        // mine (моя база) | ready (готовая база)
    deck: "learning",    // какую корзину учим
    studyCat: "all",     // фильтр темы в режиме учёбы
    reverse: localStorage.getItem("bahasa_reverse") === "1", // показывать русский первым
    flipped: false,
    queue: [],           // очередь id для изучения
    qIndex: 0,
    search: "",
    filterStatus: "all",
    listCat: "all",      // фильтр темы в списке
  };

  // --- активная база: маршрутизируем чтение/запись ---
  const isReady = () => ui.base === "ready";
  const curAll = () => (isReady() ? Store.dictAll() : Store.all());
  const curByStatus = (s) => (isReady() ? Store.dictByStatus(s) : Store.byStatus(s));
  const curCounts = () => (isReady() ? Store.dictCounts() : Store.counts());
  const curCategories = () =>
    isReady() ? Store.dictCategories() : Store.categories();
  const curSetStatus = (id, s) =>
    isReady() ? Store.dictSetStatus(id, s) : Store.setStatus(id, s);
  const curDue = () => (isReady() ? Store.dictDue() : Store.due());
  const curEdit = (id, fields) =>
    isReady() ? Store.dictEdit(id, fields) : Store.update(id, fields);

  // Озвучка слова на бахаса через браузерный синтез речи
  let _voices = [];
  function loadVoices() {
    if (window.speechSynthesis) _voices = speechSynthesis.getVoices() || [];
  }
  if (window.speechSynthesis) {
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }
  function speak(text) {
    if (!window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "id-ID";
    const v = _voices.find((x) => /^id\b|id-|indones/i.test(x.lang + x.name));
    if (v) u.voice = v;
    u.rate = 0.92;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  // Копировать слово из готовой базы в свою
  async function copyToMine(indo, rus, cat) {
    const res = await Store.add({ indo, rus, cat });
    return res;
  }

  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );

  // ---------- Переключатель базы ----------
  function renderBaseSwitch() {
    const el = document.getElementById("baseswitch");
    if (!Store.currentUser()) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = `
      <div class="base-switch">
        <button data-base="mine" class="${ui.base === "mine" ? "active" : ""}">📔 Моя база</button>
        <button data-base="ready" class="${ui.base === "ready" ? "active" : ""}">📚 Готовая база</button>
      </div>`;
    el.querySelectorAll("[data-base]").forEach((b) =>
      b.addEventListener("click", async () => {
        const next = b.dataset.base;
        if (next === ui.base) return;
        if (next === "ready" && !Store.dictLoaded()) {
          b.textContent = "Загрузка…";
          await Store.dictLoad();
        }
        ui.base = next;
        ui.deck = "learning";
        ui.studyCat = "all";
        ui.listCat = "all";
        ui.filterStatus = "all";
        ui.search = "";
        if (ui.tab === "add" && isReady()) ui.tab = "study";
        if (ui.tab === "study") startDeck();
        renderShell();
      })
    );
  }

  // ---------- Stats / Tabs ----------
  function renderStats() {
    const c = curCounts();
    statsEl.innerHTML = `
      <div class="stat" data-deck="learning">
        <div class="num">${c.learning}</div><div class="lbl">Учу</div>
      </div>
      <div class="stat" data-deck="review">
        <div class="num">${c.review}</div><div class="lbl">Повторение</div>
      </div>
      <div class="stat" data-deck="known">
        <div class="num">${c.known}</div><div class="lbl">Знаю</div>
      </div>`;
    statsEl.querySelectorAll(".stat").forEach((el) =>
      el.addEventListener("click", () => {
        ui.tab = "study";
        ui.deck = el.dataset.deck;
        startDeck();
        render();
      })
    );
  }

  function renderTabs() {
    const tabs = [
      ["study", "Учить"],
      ["list", "Все слова"],
    ];
    if (!isReady()) tabs.push(["add", "Добавить"]); // в готовую базу не добавляют
    tabsEl.innerHTML = tabs
      .map(
        ([id, lbl]) =>
          `<button data-tab="${id}" class="${ui.tab === id ? "active" : ""}">${lbl}</button>`
      )
      .join("");
    tabsEl.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        ui.tab = b.dataset.tab;
        if (ui.tab === "study") startDeck();
        render();
      })
    );
  }

  // ---------- Study ----------
  function startDeck() {
    let pool = ui.deck === "due" ? curDue() : curByStatus(ui.deck);
    if (ui.studyCat !== "all") pool = pool.filter((w) => w.cat === ui.studyCat);
    ui.queue = pool.map((w) => w.id);
    // выбрана конкретная тема — идём ПО ПОРЯДКУ; «Все темы» — перемешиваем
    if (ui.studyCat === "all") {
      for (let i = ui.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ui.queue[i], ui.queue[j]] = [ui.queue[j], ui.queue[i]];
      }
    }
    ui.qIndex = 0;
    ui.flipped = false;
  }

  function currentWord() {
    const id = ui.queue[ui.qIndex];
    return curAll().find((w) => w.id === id);
  }

  function renderStudy() {
    const deckLabels = {
      due: "🔔 Сегодня",
      learning: "Учу",
      review: "Повторение",
      known: "Знаю",
    };
    const dc = curCounts();
    const deckPick = `
      <div class="deck-pick">
        ${["due", "learning", "review", "known"]
          .map(
            (d) =>
              `<button data-deck="${d}" class="${ui.deck === d ? "active" : ""}">${deckLabels[d]} <span class="cnt">${dc[d] || 0}</span></button>`
          )
          .join("")}
      </div>`;

    const cats = curCategories();
    const catFilter =
      cats.length > 1
        ? `<select class="cat-filter" id="studyCat">
             <option value="all">📂 Все темы</option>
             ${cats
               .map(
                 (c) =>
                   `<option value="${esc(c)}" ${
                     ui.studyCat === c ? "selected" : ""
                   }>${esc(c)}</option>`
               )
               .join("")}
           </select>`
        : "";

    const word = currentWord();

    if (!word) {
      root.innerHTML =
        deckPick +
        catFilter +
        `<div class="study-empty">
           <div class="big">🎉</div>
           <div>В корзине «${deckLabels[ui.deck]}»${
             ui.studyCat !== "all" ? " по теме «" + esc(ui.studyCat) + "»" : ""
           } сейчас нет карточек${
          ui.deck === "learning" && ui.studyCat === "all"
            ? " — всё разобрано!"
            : "."
        }</div>
         </div>`;
      bindDeckPick();
      return;
    }

    // Направление: какая сторона показывается первой
    const prompt = ui.reverse ? word.rus : word.indo;
    const answer = ui.reverse ? word.indo : word.rus;
    const dirLabel = ui.reverse ? "🇷🇺 → 🇮🇩" : "🇮🇩 → 🇷🇺";

    root.innerHTML =
      deckPick +
      catFilter +
      `<div class="study-bar">
         <span class="progress-line">${ui.qIndex + 1} / ${ui.queue.length} · ← → или свайп</span>
         <button class="dir-toggle" id="dirToggle" title="Сменить направление">${dirLabel}</button>
       </div>
       <div class="flashcard ${ui.flipped ? "flipped" : ""}" id="card">
         <div class="flashcard-inner">
           <div class="face front">
             <div class="cat-badge">${esc(word.cat)}</div>
             <button class="speak-btn" id="speakF" title="Озвучить">🔊</button>
             <div class="word">${esc(prompt)}</div>
             <div class="hint">нажми, чтобы перевернуть</div>
           </div>
           <div class="face back">
             <div class="cat-badge">${esc(word.cat)}${
        isReady() && word.edited ? " ✎" : ""
      }</div>
             <button class="speak-btn" id="speakB" title="Озвучить">🔊</button>
             <div class="orig">${esc(prompt)}</div>
             <div class="word">${esc(answer)}</div>
             ${
               isReady()
                 ? `<button class="copy-mine" id="copyMine">＋ в мою базу</button>`
                 : `<div class="hint">куда положить слово?</div>`
             }
           </div>
         </div>
       </div>
       <div class="answer-row">
         <button class="btn ans-dont" data-move="learning">Не знаю</button>
         <button class="btn ans-review" data-move="review">Повторить</button>
         <button class="btn ans-know" data-move="known">Знаю</button>
       </div>`;

    document.getElementById("dirToggle").addEventListener("click", () => {
      ui.reverse = !ui.reverse;
      localStorage.setItem("bahasa_reverse", ui.reverse ? "1" : "0");
      ui.flipped = false;
      renderStudy();
    });

    // Озвучка (всегда читаем слово на бахаса = word.indo), без переворота
    ["speakF", "speakB"].forEach((bid) => {
      const b = document.getElementById(bid);
      if (b)
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          speak(word.indo);
        });
    });
    // Копировать в свою базу (готовая база)
    const cm = document.getElementById("copyMine");
    if (cm)
      cm.addEventListener("click", async (e) => {
        e.stopPropagation();
        cm.disabled = true;
        const res = await copyToMine(word.indo, word.rus, word.cat);
        cm.textContent = res.ok ? "✓ добавлено" : res.error || "уже есть";
      });

    const cardEl = document.getElementById("card");

    // Тап/клик — перевернуть. Но если это был свайп — не переворачивать.
    let swiped = false;
    cardEl.addEventListener("click", () => {
      if (swiped) {
        swiped = false;
        return;
      }
      toggleFlip();
    });

    // Свайп влево/вправо — листать карточки.
    let sx = 0,
      sy = 0;
    cardEl.addEventListener(
      "touchstart",
      (e) => {
        sx = e.changedTouches[0].screenX;
        sy = e.changedTouches[0].screenY;
        swiped = false;
      },
      { passive: true }
    );
    cardEl.addEventListener(
      "touchend",
      (e) => {
        const dx = e.changedTouches[0].screenX - sx;
        const dy = e.changedTouches[0].screenY - sy;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
          swiped = true; // подавляем последующий click(=переворот)
          navigateCard(dx < 0 ? 1 : -1);
        }
      },
      { passive: true }
    );

    root.querySelectorAll("[data-move]").forEach((b) =>
      b.addEventListener("click", () => {
        curSetStatus(word.id, b.dataset.move);
        ui.qIndex++;
        ui.flipped = false;
        renderStats();
        renderStudy();
      })
    );

    bindDeckPick();
  }

  function toggleFlip() {
    const card = document.getElementById("card");
    if (!card) return;
    ui.flipped = !ui.flipped;
    card.classList.toggle("flipped", ui.flipped);
  }

  // Листать карточки: delta = +1 (следующая) / -1 (предыдущая).
  function navigateCard(delta) {
    const n = ui.queue.length;
    if (!n) return;
    let i = ui.qIndex + delta;
    if (i < 0) i = 0;
    if (i > n - 1) i = n - 1;
    if (i === ui.qIndex) return;
    ui.qIndex = i;
    ui.flipped = false;
    renderStudy();
  }

  // Клавиатура на компьютере: ← → листать, пробел — перевернуть.
  function onKeydown(e) {
    if (ui.tab !== "study") return;
    const t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (e.key === "ArrowRight") {
      navigateCard(1);
      e.preventDefault();
    } else if (e.key === "ArrowLeft") {
      navigateCard(-1);
      e.preventDefault();
    } else if (e.key === " " || e.key === "Spacebar") {
      toggleFlip();
      e.preventDefault();
    }
  }

  function bindDeckPick() {
    root.querySelectorAll(".deck-pick button").forEach((b) =>
      b.addEventListener("click", () => {
        ui.deck = b.dataset.deck;
        startDeck();
        renderStudy();
      })
    );
    const sc = document.getElementById("studyCat");
    if (sc)
      sc.addEventListener("change", (e) => {
        ui.studyCat = e.target.value;
        startDeck();
        renderStudy();
      });
  }

  // ---------- List ----------
  const LIST_CAP = 400; // максимум строк за раз (готовая база большая)
  function renderList() {
    const ready = isReady();
    const cats = curCategories();
    let words = curAll();
    const q = ui.search.toLowerCase().trim();
    if (q)
      words = words.filter(
        (w) =>
          w.indo.toLowerCase().includes(q) || w.rus.toLowerCase().includes(q)
      );
    if (ui.filterStatus !== "all")
      words = words.filter((w) => w.status === ui.filterStatus);
    if (ui.listCat !== "all") words = words.filter((w) => w.cat === ui.listCat);

    const total = words.length;
    const shown = words.slice(0, LIST_CAP);

    const catOptions = `
      <select id="fcat">
        <option value="all">📂 Все темы</option>
        ${cats
          .map(
            (c) =>
              `<option value="${esc(c)}" ${
                ui.listCat === c ? "selected" : ""
              }>${esc(c)}</option>`
          )
          .join("")}
      </select>`;

    const toolbar = `
      <div class="toolbar">
        <input id="search" placeholder="Поиск…" value="${esc(ui.search)}">
        <select id="fstatus">
          <option value="all">Все</option>
          <option value="learning">Учу</option>
          <option value="review">Повторение</option>
          <option value="known">Знаю</option>
        </select>
      </div>
      ${cats.length > 1 ? `<div class="toolbar">${catOptions}</div>` : ""}`;

    const rows = shown.length
      ? shown
          .map((w) => {
            const st = S[w.status];
            return `
        <div class="word-row" data-id="${w.id}">
          <span class="status-dot" style="background:${st.color}"></span>
          <div class="info">
            <div class="indo">${esc(w.indo)}</div>
            <div class="rus">${esc(w.rus)}</div>
            <div class="cat">${esc(w.cat)}</div>
          </div>
          <div class="row-actions">
            <div class="seg">
              ${["learning", "review", "known"]
                .map(
                  (s) =>
                    `<button data-set="${s}" class="${
                      w.status === s ? "on " + s : ""
                    }">${S[s].label}</button>`
                )
                .join("")}
            </div>
            <div class="row-icons">
              <button class="mini" data-speak title="Озвучить">🔊</button>
              <button class="mini" data-edit title="Изменить перевод">✎</button>
              ${
                ready
                  ? `<button class="mini" data-copy title="В мою базу">＋</button>`
                  : `<button class="mini" data-del title="Удалить">✕</button>`
              }
            </div>
          </div>
        </div>`;
          })
          .join("")
      : `<div class="list-empty">Ничего не найдено</div>`;

    const moreNote =
      total > LIST_CAP
        ? `<div class="list-note">Показаны первые ${LIST_CAP} из ${total}. Уточни поиск или выбери тему.</div>`
        : "";

    const footer = ready
      ? ""
      : `<div class="footer-actions">
           <button class="link-btn" id="export">Экспорт JSON</button>
           <button class="link-btn" id="reset">Сбросить к исходному набору</button>
         </div>`;

    root.innerHTML = toolbar + moreNote + rows + footer;

    const search = document.getElementById("search");
    search.addEventListener("input", (e) => {
      ui.search = e.target.value;
      const pos = e.target.selectionStart;
      renderList();
      const ns = document.getElementById("search");
      ns.focus();
      ns.setSelectionRange(pos, pos);
    });
    const sel = document.getElementById("fstatus");
    sel.value = ui.filterStatus;
    sel.addEventListener("change", (e) => {
      ui.filterStatus = e.target.value;
      renderList();
    });
    const fcat = document.getElementById("fcat");
    if (fcat)
      fcat.addEventListener("change", (e) => {
        ui.listCat = e.target.value;
        renderList();
      });

    const byId = {};
    shown.forEach((w) => (byId[w.id] = w));
    root.querySelectorAll(".word-row").forEach((rowEl) => {
      const id = rowEl.dataset.id;
      const w = byId[id];
      rowEl.querySelectorAll("[data-set]").forEach((b) =>
        b.addEventListener("click", () => {
          curSetStatus(id, b.dataset.set);
          renderStats();
          renderList();
        })
      );
      const sp = rowEl.querySelector("[data-speak]");
      if (sp) sp.addEventListener("click", () => speak(w.indo));

      const ed = rowEl.querySelector("[data-edit]");
      if (ed)
        ed.addEventListener("click", () => {
          if (ready) {
            const nr = prompt("Перевод (для тебя):", w.rus);
            if (nr != null && nr.trim()) {
              curEdit(id, { rus: nr });
              renderList();
            }
          } else {
            const ni = prompt("Слово на бахаса:", w.indo);
            if (ni == null) return;
            const nr = prompt("Перевод:", w.rus);
            if (nr == null) return;
            Store.update(id, { indo: ni, rus: nr });
            renderList();
          }
        });

      const cp = rowEl.querySelector("[data-copy]");
      if (cp)
        cp.addEventListener("click", async () => {
          cp.disabled = true;
          const res = await copyToMine(w.indo, w.rus, w.cat);
          cp.textContent = res.ok ? "✓" : "•";
          cp.title = res.ok ? "Добавлено в мою базу" : res.error || "Уже есть";
        });

      const del = rowEl.querySelector("[data-del]");
      if (del)
        del.addEventListener("click", () => {
          if (confirm("Удалить слово?")) {
            Store.remove(id);
            renderStats();
            renderList();
          }
        });
    });

    const exp = document.getElementById("export");
    if (exp)
      exp.addEventListener("click", () => {
        const blob = new Blob([Store.exportJSON()], {
          type: "application/json",
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "bahasa-words.json";
        a.click();
      });
    const reset = document.getElementById("reset");
    if (reset)
      reset.addEventListener("click", async () => {
        if (confirm("Сбросить все слова и прогресс к исходному набору?")) {
          await Store.resetAll();
          renderStats();
          render();
        }
      });
  }

  // ---------- Add ----------
  function renderAdd() {
    const cats = Store.categories();
    root.innerHTML = `
      <div class="form-card">
        <div class="field">
          <label>Слово на бахаса</label>
          <input id="f-indo" placeholder="напр. Selamat" autocomplete="off">
        </div>
        <div class="field">
          <label>Перевод</label>
          <input id="f-rus" placeholder="напр. поздравляю / благополучный" autocomplete="off">
        </div>
        <div class="field">
          <label>Категория</label>
          <input id="f-cat" list="cats" placeholder="напр. Приветствия" autocomplete="off">
          <datalist id="cats">
            ${cats.map((c) => `<option value="${esc(c)}">`).join("")}
          </datalist>
        </div>
        <div class="form-msg" id="msg"></div>
        <button class="btn btn-primary btn-block" id="save">Добавить карточку</button>
      </div>

      <div class="import-box">
        <div class="import-title">📘 Слова из 4 уроков</div>
        <div class="import-sub">Готовый набор лексики из уроков (${
          (window.LESSON_WORDS || []).length
        } слов) — добавить в мою базу. Дубликаты пропускаются.</div>
        <button class="btn btn-ghost btn-block" id="importLessons">Загрузить уроки в мою базу</button>
        <div class="form-msg" id="imsg"></div>
      </div>`;

    const indo = document.getElementById("f-indo");
    const rus = document.getElementById("f-rus");
    const cat = document.getElementById("f-cat");
    const msg = document.getElementById("msg");

    async function save() {
      const saveBtn = document.getElementById("save");
      saveBtn.disabled = true;
      msg.className = "form-msg";
      msg.textContent = "Сохраняю…";
      const res = await Store.add({
        indo: indo.value,
        rus: rus.value,
        cat: cat.value,
      });
      saveBtn.disabled = false;
      if (!res.ok) {
        msg.className = "form-msg err";
        msg.textContent = res.error;
        return;
      }
      msg.className = "form-msg ok";
      msg.textContent = `Добавлено: ${res.word.indo} → ${res.word.rus}`;
      indo.value = "";
      rus.value = "";
      indo.focus();
      renderStats();
    }

    document.getElementById("save").addEventListener("click", save);
    [indo, rus, cat].forEach((el) =>
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") save();
      })
    );

    const imp = document.getElementById("importLessons");
    const imsg = document.getElementById("imsg");
    imp.addEventListener("click", async () => {
      imp.disabled = true;
      imsg.className = "form-msg";
      imsg.textContent = "Загружаю слова из уроков…";
      const res = await Store.importLessons();
      imp.disabled = false;
      if (res.error) {
        imsg.className = "form-msg err";
        imsg.textContent = "Ошибка: " + res.error;
        return;
      }
      imsg.className = "form-msg ok";
      imsg.textContent =
        res.added > 0
          ? `Добавлено ${res.added} слов из уроков` +
            (res.skipped ? ` (пропущено дубликатов: ${res.skipped})` : "")
          : "Все слова из уроков уже есть в твоей базе";
      renderStats();
    });

    indo.focus();
  }

  // ---------- Router (приложение, когда вошёл) ----------
  function render() {
    renderBaseSwitch();
    renderTabs();
    if (ui.tab === "study") renderStudy();
    else if (ui.tab === "list") renderList();
    else renderAdd();
    // плавающую кнопку «+» прячем на вкладке «Добавить» и в готовой базе
    const fab = document.getElementById("fab");
    if (fab) fab.classList.toggle("hidden", ui.tab === "add" || isReady());
  }

  // ---------- Экран входа / регистрации ----------
  function renderUserbar() {
    const bar = document.getElementById("userbar");
    const u = Store.currentUser();
    if (u) {
      bar.innerHTML = `
        <button class="userbar-btn" id="feedback" title="Обратная связь">✉️ Отзыв</button>
        <button class="logout-btn" id="logout" title="${esc(
          u.email || ""
        )}">Выйти</button>`;
      document.getElementById("logout").addEventListener("click", async () => {
        await Store.signOut();
        renderShell();
      });
      document
        .getElementById("feedback")
        .addEventListener("click", openFeedback);
    } else {
      bar.innerHTML = "";
    }
  }

  // ---------- Обратная связь (модальное окно) ----------
  function openFeedback() {
    const old = document.getElementById("fbOverlay");
    if (old) old.remove();
    const ov = document.createElement("div");
    ov.id = "fbOverlay";
    ov.className = "modal-overlay";
    ov.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>Обратная связь</h3>
        <p class="modal-lead">Нашёл ошибку в переводе, есть идея или вопрос — напиши, я прочитаю.</p>
        <textarea id="fbText" rows="5" placeholder="Твоё сообщение…"></textarea>
        <div class="form-msg" id="fbMsg"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="fbCancel">Отмена</button>
          <button class="btn btn-primary" id="fbSend">Отправить</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.addEventListener("click", (e) => {
      if (e.target === ov) close();
    });
    document.getElementById("fbCancel").addEventListener("click", close);
    const text = document.getElementById("fbText");
    const msg = document.getElementById("fbMsg");
    const send = document.getElementById("fbSend");
    text.focus();
    send.addEventListener("click", async () => {
      send.disabled = true;
      msg.className = "form-msg";
      msg.textContent = "Отправляю…";
      const res = await Store.sendFeedback(text.value);
      if (!res.ok) {
        send.disabled = false;
        msg.className = "form-msg err";
        msg.textContent = res.error;
        return;
      }
      msg.className = "form-msg ok";
      msg.textContent = "Спасибо! Сообщение отправлено.";
      text.value = "";
      setTimeout(close, 1200);
    });
  }

  function renderAuth() {
    ui.authMode = ui.authMode || "login";
    const isLogin = ui.authMode === "login";
    statsEl.innerHTML = "";
    tabsEl.innerHTML = "";
    document.getElementById("baseswitch").innerHTML = "";
    document.getElementById("fab").classList.add("hidden");
    document.body.classList.add("auth-mode");

    root.innerHTML = `
      <div class="auth-card">
        <h2>${isLogin ? "Вход" : "Регистрация"}</h2>
        <p class="auth-lead">${
          isLogin
            ? "Войди, чтобы открыть свою базу слов."
            : "Создай аккаунт — у тебя будет своя база слов и прогресс на любом устройстве."
        }</p>
        <div class="field">
          <label>Email</label>
          <input id="a-email" type="email" autocomplete="email" placeholder="you@example.com">
        </div>
        <div class="field">
          <label>Пароль</label>
          <input id="a-pass" type="password" autocomplete="${
            isLogin ? "current-password" : "new-password"
          }" placeholder="минимум 6 символов">
        </div>
        <div class="form-msg" id="a-msg"></div>
        <button class="btn btn-primary btn-block" id="a-submit">${
          isLogin ? "Войти" : "Зарегистрироваться"
        }</button>
        <div class="auth-switch">
          ${
            isLogin
              ? `Нет аккаунта? <button class="link-btn" id="a-toggle">Зарегистрироваться</button>`
              : `Уже есть аккаунт? <button class="link-btn" id="a-toggle">Войти</button>`
          }
        </div>
      </div>`;

    const email = document.getElementById("a-email");
    const pass = document.getElementById("a-pass");
    const msg = document.getElementById("a-msg");
    const submit = document.getElementById("a-submit");

    document.getElementById("a-toggle").addEventListener("click", () => {
      ui.authMode = isLogin ? "register" : "login";
      renderAuth();
    });

    async function go() {
      const e = email.value.trim();
      const p = pass.value;
      if (!e || !p) {
        msg.className = "form-msg err";
        msg.textContent = "Введи email и пароль";
        return;
      }
      submit.disabled = true;
      msg.className = "form-msg";
      msg.textContent = isLogin ? "Вхожу…" : "Создаю аккаунт…";
      const res = isLogin
        ? await Store.signIn(e, p)
        : await Store.signUp(e, p);
      submit.disabled = false;
      if (!res.ok) {
        msg.className = "form-msg err";
        msg.textContent = res.error;
        return;
      }
      if (res.needConfirm) {
        msg.className = "form-msg ok";
        msg.textContent =
          "Аккаунт создан. Подтверди email по ссылке из письма, затем войди.";
        ui.authMode = "login";
        return;
      }
      renderShell(); // вошли — показываем приложение
    }

    submit.addEventListener("click", go);
    [email, pass].forEach((el) =>
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") go();
      })
    );
    email.focus();
  }

  // ---------- Экран «нужна настройка Supabase» ----------
  function renderSetupNeeded() {
    statsEl.innerHTML = "";
    tabsEl.innerHTML = "";
    document.getElementById("baseswitch").innerHTML = "";
    document.getElementById("fab").classList.add("hidden");
    document.body.classList.add("auth-mode");
    root.innerHTML = `
      <div class="auth-card">
        <h2>Почти готово</h2>
        <p class="auth-lead">Чтобы заработали аккаунты, нужно один раз подключить
        бесплатную базу Supabase.</p>
        <ol class="setup-steps">
          <li>Зарегистрируйся на <b>supabase.com</b> и создай проект (бесплатно).</li>
          <li>В проекте открой <b>SQL Editor</b> и выполни скрипт из файла
              <code>supabase-setup.sql</code>.</li>
          <li>В <b>Project Settings → API</b> скопируй <b>Project URL</b> и
              <b>anon public key</b>.</li>
          <li>Вставь их в файл <code>app/config.js</code> и обнови страницу.</li>
        </ol>
        <p class="auth-lead">Подробная инструкция — в <code>README.md</code>.</p>
      </div>`;
  }

  // ---------- Переключение экранов ----------
  function renderShell() {
    renderUserbar();
    if (Store.currentUser()) {
      document.body.classList.remove("auth-mode");
      ui.tab = "study";
      renderStats();
      startDeck();
      render();
    } else {
      renderAuth();
    }
  }

  // ---------- Init ----------
  document.addEventListener("keydown", onKeydown);
  document.getElementById("fab").addEventListener("click", () => {
    ui.tab = "add";
    render();
  });
  // если сессия истекла во время работы — вернуть на экран входа
  Store.onAuth((u) => {
    if (!u) renderShell();
  });

  (async () => {
    const res = await Store.init();
    if (!res.configured) {
      renderSetupNeeded();
      return;
    }
    renderShell();
  })();
})();
