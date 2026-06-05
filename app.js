/* UI приложения карточек. Чистый JS, без сборки. Локализация через window.t(). */
(() => {
  const S = Store.STATUS;
  const t = window.t;
  const getUiLang = window.getUiLang;
  const setUiLang = window.setUiLang;
  const root = document.getElementById("view");
  const tabsEl = document.getElementById("tabs");
  const statsEl = document.getElementById("stats");

  const ui = {
    tab: "study",
    authMode: "login",
    base: "mine",
    deck: "learning",
    studyCat: "all",
    reverse: localStorage.getItem("bahasa_reverse") === "1",
    flipped: false,
    queue: [],
    qIndex: 0,
    search: "",
    filterStatus: "all",
    listCat: "all",
  };

  // --- активная база ---
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

  const statusLabel = (s) => t("st_" + s);

  // Озвучка
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

  async function copyToMine(indo, rus, cat) {
    return await Store.add({ indo, rus, cat });
  }

  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );

  // язык перевода (готовая база)
  const LANGS = { ru: "🇷🇺 Рус", en: "🇬🇧 Eng", uk: "🇺🇦 Укр" };
  const langFlag = { ru: "🇷🇺", en: "🇬🇧", uk: "🇺🇦" };
  function langSelectHTML() {
    const cur = Store.getLang();
    return `<select class="lang-sel" id="langSel" title="${t("ttl_transLang")}">${Object.entries(
      LANGS
    )
      .map(
        ([k, v]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${v}</option>`
      )
      .join("")}</select>`;
  }

  // --- переключатель ЯЗЫКА ИНТЕРФЕЙСА ---
  function renderUiLang() {
    const box = document.getElementById("uilangbox");
    if (!box) return;
    const cur = getUiLang();
    box.innerHTML = `<select class="uilang-sel" id="uilangSel" title="${t(
      "ttl_uiLang"
    )}">${Object.entries(window.UI_LANGS)
      .map(
        ([k, v]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${v}</option>`
      )
      .join("")}</select>`;
    document.getElementById("uilangSel").addEventListener("change", (e) => {
      setUiLang(e.target.value);
      refreshUi();
    });
  }

  // перерисовать весь интерфейс под новый язык (без сброса позиции в колоде)
  function refreshUi() {
    window.applyStaticI18n();
    renderUiLang();
    if (Store.currentUser()) {
      document.body.classList.remove("auth-mode");
      renderUserbar();
      renderStats();
      render();
    } else {
      renderAuth();
    }
  }

  // ---------- Переключатель базы ----------
  function renderBaseSwitch() {
    const el = document.getElementById("baseswitch");
    if (!Store.currentUser()) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = `
      <div class="base-switch">
        <button data-base="mine" class="${ui.base === "mine" ? "active" : ""}">${t("base_mine")}</button>
        <button data-base="ready" class="${ui.base === "ready" ? "active" : ""}">${t("base_ready")}</button>
      </div>`;
    el.querySelectorAll("[data-base]").forEach((b) =>
      b.addEventListener("click", async () => {
        const next = b.dataset.base;
        if (next === ui.base) return;
        if (next === "ready" && !Store.dictLoaded()) {
          b.textContent = t("loading");
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
        <div class="num">${c.learning}</div><div class="lbl">${t("st_learning")}</div>
      </div>
      <div class="stat" data-deck="review">
        <div class="num">${c.review}</div><div class="lbl">${t("st_review")}</div>
      </div>
      <div class="stat" data-deck="known">
        <div class="num">${c.known}</div><div class="lbl">${t("st_known")}</div>
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
      ["study", t("tab_study")],
      ["list", t("tab_list")],
    ];
    if (!isReady()) tabs.push(["add", t("tab_add")]);
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
      due: t("deck_due"),
      learning: t("st_learning"),
      review: t("st_review"),
      known: t("st_known"),
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
             <option value="all">${t("allThemes")}</option>
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
      const dn = deckLabels[ui.deck];
      let emptyMsg;
      if (ui.studyCat !== "all") emptyMsg = t("emptyNoneTheme", dn, ui.studyCat);
      else if (ui.deck === "learning") emptyMsg = t("emptyDone", dn);
      else emptyMsg = t("emptyNone", dn);
      root.innerHTML =
        deckPick +
        catFilter +
        `<div class="study-empty">
           <div class="big">🎉</div>
           <div>${esc(emptyMsg)}</div>
         </div>`;
      bindDeckPick();
      return;
    }

    const prompt = ui.reverse ? word.rus : word.indo;
    const answer = ui.reverse ? word.indo : word.rus;
    const tf = isReady() ? langFlag[Store.getLang()] || "🇷🇺" : "🔤";
    const dirLabel = ui.reverse ? `${tf} → 🇮🇩` : `🇮🇩 → ${tf}`;

    root.innerHTML =
      deckPick +
      catFilter +
      `<div class="study-bar">
         <span class="progress-line">${ui.qIndex + 1} / ${ui.queue.length}</span>
         ${isReady() ? langSelectHTML() : ""}
         <button class="dir-toggle" id="dirToggle" title="${t("ttl_dir")}">${dirLabel}</button>
       </div>
       <div class="flashcard ${ui.flipped ? "flipped" : ""}" id="card">
         <div class="flashcard-inner">
           <div class="face front">
             <div class="cat-badge">${esc(word.cat)}</div>
             <button class="speak-btn" id="speakF" title="${t("ttl_speak")}">🔊</button>
             <div class="word">${esc(prompt)}</div>
             <div class="hint">${t("flipHint")}</div>
           </div>
           <div class="face back">
             <div class="cat-badge">${esc(word.cat)}${
        isReady() && word.edited ? " ✎" : ""
      }</div>
             <button class="speak-btn" id="speakB" title="${t("ttl_speak")}">🔊</button>
             <div class="orig">${esc(prompt)}</div>
             <div class="word">${esc(answer)}</div>
             ${
               isReady()
                 ? `<button class="copy-mine" id="copyMine">${t("copyMine")}</button>`
                 : `<div class="hint">${t("whereHint")}</div>`
             }
           </div>
         </div>
       </div>
       <div class="answer-row">
         <button class="btn ans-dont" data-move="learning">${t("ans_dont")}</button>
         <button class="btn ans-review" data-move="review">${t("ans_review")}</button>
         <button class="btn ans-know" data-move="known">${t("ans_know")}</button>
       </div>`;

    document.getElementById("dirToggle").addEventListener("click", () => {
      ui.reverse = !ui.reverse;
      localStorage.setItem("bahasa_reverse", ui.reverse ? "1" : "0");
      ui.flipped = false;
      renderStudy();
    });

    ["speakF", "speakB"].forEach((bid) => {
      const b = document.getElementById(bid);
      if (b)
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          speak(word.indo);
        });
    });
    const cm = document.getElementById("copyMine");
    if (cm)
      cm.addEventListener("click", async (e) => {
        e.stopPropagation();
        cm.disabled = true;
        const res = await copyToMine(word.indo, word.rus, word.cat);
        cm.textContent = res.ok ? t("added") : res.error || t("alreadyHave");
      });

    const cardEl = document.getElementById("card");
    let swiped = false;
    cardEl.addEventListener("click", () => {
      if (swiped) {
        swiped = false;
        return;
      }
      toggleFlip();
    });

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
          swiped = true;
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

  function onKeydown(e) {
    if (ui.tab !== "study") return;
    const tg = e.target;
    if (tg && /^(INPUT|SELECT|TEXTAREA)$/.test(tg.tagName)) return;
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
    const ls = document.getElementById("langSel");
    if (ls)
      ls.addEventListener("change", (e) => {
        Store.setLang(e.target.value);
        renderStudy();
      });
  }

  // ---------- List ----------
  const LIST_CAP = 400;
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
        <option value="all">${t("allThemes")}</option>
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
        <input id="search" placeholder="${t("search_ph")}" value="${esc(ui.search)}">
        <select id="fstatus">
          <option value="all">${t("filter_all")}</option>
          <option value="learning">${t("st_learning")}</option>
          <option value="review">${t("st_review")}</option>
          <option value="known">${t("st_known")}</option>
        </select>
      </div>
      <div class="toolbar">
        ${cats.length > 1 ? catOptions : ""}
        ${ready ? langSelectHTML() : ""}
      </div>`;

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
                    }">${statusLabel(s)}</button>`
                )
                .join("")}
            </div>
            <div class="row-icons">
              <button class="mini" data-speak title="${t("ttl_speak")}">🔊</button>
              <button class="mini" data-edit title="${t("ttl_edit")}">✎</button>
              ${
                ready
                  ? `<button class="mini" data-copy title="${t("ttl_toMy")}">＋</button>`
                  : `<button class="mini" data-del title="${t("ttl_del")}">✕</button>`
              }
            </div>
          </div>
        </div>`;
          })
          .join("")
      : `<div class="list-empty">${t("nothingFound")}</div>`;

    const moreNote =
      total > LIST_CAP
        ? `<div class="list-note">${t("moreNote", LIST_CAP, total)}</div>`
        : "";

    const footer = ready
      ? ""
      : `<div class="footer-actions">
           <button class="link-btn" id="export">${t("exportJSON")}</button>
           <button class="link-btn" id="reset">${t("clearBase")}</button>
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
    const ls = document.getElementById("langSel");
    if (ls)
      ls.addEventListener("change", (e) => {
        Store.setLang(e.target.value);
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
            const nr = prompt(t("prompt_editTr"), w.rus);
            if (nr != null && nr.trim()) {
              curEdit(id, { rus: nr });
              renderList();
            }
          } else {
            const ni = prompt(t("prompt_indo"), w.indo);
            if (ni == null) return;
            const nr = prompt(t("prompt_tr"), w.rus);
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
          cp.title = res.ok ? t("addedToMy") : res.error || t("alreadyHave");
        });

      const del = rowEl.querySelector("[data-del]");
      if (del)
        del.addEventListener("click", () => {
          if (confirm(t("confirm_del"))) {
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
        if (confirm(t("confirm_clear"))) {
          await Store.clearAll();
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
          <label>${t("add_word_label")}</label>
          <input id="f-indo" placeholder="${t("add_word_ph")}" autocomplete="off">
        </div>
        <div class="field">
          <label>${t("add_tr_label")}</label>
          <input id="f-rus" placeholder="${t("add_tr_ph")}" autocomplete="off">
        </div>
        <div class="field">
          <label>${t("add_cat_label")}</label>
          <input id="f-cat" list="cats" placeholder="${t("add_cat_ph")}" autocomplete="off">
          <datalist id="cats">
            ${cats.map((c) => `<option value="${esc(c)}">`).join("")}
          </datalist>
        </div>
        <div class="form-msg" id="msg"></div>
        <button class="btn btn-primary btn-block" id="save">${t("add_btn")}</button>
      </div>`;

    const indo = document.getElementById("f-indo");
    const rus = document.getElementById("f-rus");
    const cat = document.getElementById("f-cat");
    const msg = document.getElementById("msg");

    async function save() {
      const saveBtn = document.getElementById("save");
      saveBtn.disabled = true;
      msg.className = "form-msg";
      msg.textContent = t("saving");
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
      msg.textContent = t("added_log", res.word.indo, res.word.rus);
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
    indo.focus();
  }

  // ---------- Приветствие при первом заходе ----------
  function setupWelcome() {
    if (localStorage.getItem("bahasa_welcome") === "1") return;
    const ov = document.createElement("div");
    ov.id = "welcomeOverlay";
    ov.className = "modal-overlay";
    ov.innerHTML = `
      <div class="modal welcome-modal" role="dialog" aria-modal="true">
        <div class="welcome-emoji">🇮🇩</div>
        <h3>Bahasa · ${t("cards")}</h3>
        <p class="modal-lead">${t("tagline")}.</p>
        <ul class="welcome-list">
          <li><span>📱</span><div>${t("welcome_install")}</div></li>
          <li><span>📶</span><div>${t("welcome_offline")}</div></li>
          <li><span>🔄</span><div>${t("welcome_sync")}</div></li>
        </ul>
        <button class="btn btn-primary btn-block" id="welcomeOk">${t("welcome_ok")}</button>
      </div>`;
    document.body.appendChild(ov);
    document.getElementById("welcomeOk").addEventListener("click", () => {
      localStorage.setItem("bahasa_welcome", "1");
      ov.remove();
    });
  }

  // ---------- Подсказка «Установить приложение» ----------
  function setupInstallBanner() {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    if (standalone) return;
    if (localStorage.getItem("pwa_hide") === "1") return;

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    let shown = false;

    function showBar(inner, onInstall) {
      if (shown || document.getElementById("installBar")) return;
      shown = true;
      const bar = document.createElement("div");
      bar.id = "installBar";
      bar.className = "install-bar";
      bar.innerHTML =
        inner +
        `<button class="install-x" id="installX" aria-label="${t("close")}">✕</button>`;
      document.body.appendChild(bar);
      document.getElementById("installX").addEventListener("click", () => {
        bar.remove();
        localStorage.setItem("pwa_hide", "1");
      });
      const go = document.getElementById("installGo");
      if (go && onInstall) go.addEventListener("click", () => onInstall(bar));
    }

    function showAndroid() {
      showBar(
        `<span class="install-txt">${t("install_title")}</span>
         <button class="btn btn-primary install-go" id="installGo">${t("install_btn")}</button>`,
        async (bar) => {
          const ev = window._installEvent;
          if (!ev) return;
          bar.remove();
          ev.prompt();
          try {
            await ev.userChoice;
          } catch (e) {}
          localStorage.setItem("pwa_hide", "1");
          window._installEvent = null;
        }
      );
    }

    if (window._installEvent) showAndroid();
    window.addEventListener("install-available", showAndroid);

    if (isIOS && !window._installEvent) {
      setTimeout(
        () => showBar(`<span class="install-txt">${t("install_ios")}</span>`),
        1800
      );
    }
  }

  // ---------- Router ----------
  function render() {
    renderBaseSwitch();
    renderTabs();
    if (ui.tab === "study") renderStudy();
    else if (ui.tab === "list") renderList();
    else renderAdd();
    const fab = document.getElementById("fab");
    if (fab) fab.classList.toggle("hidden", ui.tab === "add" || isReady());
  }

  // ---------- Шапка пользователя ----------
  function renderUserbar() {
    const bar = document.getElementById("userbar");
    const u = Store.currentUser();
    if (u) {
      const D = window.DONATE;
      const donateOn = D && (D.url || (D.crypto && D.crypto.address));
      bar.innerHTML = `
        <button class="userbar-btn" id="search-btn" title="${t("ttl_search")}">🔍</button>
        ${
          donateOn
            ? `<button class="userbar-btn donate-btn" id="donate" title="${t("ttl_donate")}">${t("ub_donate")}</button>`
            : ""
        }
        <button class="userbar-btn" id="feedback" title="${t("ttl_feedback")}">${t("ub_feedback")}</button>
        <button class="logout-btn" id="logout" title="${esc(u.email || "")}">${t("ub_logout")}</button>`;
      document.getElementById("logout").addEventListener("click", async () => {
        await Store.signOut();
        renderShell();
      });
      document.getElementById("feedback").addEventListener("click", openFeedback);
      document.getElementById("search-btn").addEventListener("click", openSearch);
      const dn = document.getElementById("donate");
      if (dn) dn.addEventListener("click", openDonate);
    } else {
      bar.innerHTML = "";
    }
  }

  // ---------- Донат ----------
  function openDonate() {
    const cfg = window.DONATE || {};
    const cr = cfg.crypto && cfg.crypto.address ? cfg.crypto : null;
    if (!cfg.url && !cr) return;
    const old = document.getElementById("dnOverlay");
    if (old) old.remove();

    const linkBlock = cfg.url
      ? `<a class="btn btn-primary btn-block" href="${esc(
          cfg.url
        )}" target="_blank" rel="noopener">${t("donate_pay")}</a>`
      : "";

    const cryptoBlock = cr
      ? `<div class="crypto-box">
           <div class="crypto-net">${esc(cr.coin || "")} · ${esc(cr.network || "")}</div>
           <img class="crypto-qr" alt="QR" src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data=${encodeURIComponent(
             cr.address
           )}">
           <div class="crypto-addr" id="dnAddr">${esc(cr.address)}</div>
           <button class="btn btn-ghost btn-block" id="dnCopy">${t("donate_copy")}</button>
         </div>`
      : "";

    const ov = document.createElement("div");
    ov.id = "dnOverlay";
    ov.className = "modal-overlay";
    ov.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${t("donate_title")}</h3>
        <p class="modal-lead">${esc(cfg.note || t("donate_default"))}</p>
        ${linkBlock}
        ${cryptoBlock}
        <div class="modal-actions">
          <button class="btn btn-ghost" id="dnClose">${t("close")}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.addEventListener("click", (e) => {
      if (e.target === ov) close();
    });
    document.getElementById("dnClose").addEventListener("click", close);

    const copy = document.getElementById("dnCopy");
    if (copy)
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(cr.address);
          copy.textContent = t("donate_copied");
        } catch (e) {
          const r = document.createRange();
          r.selectNodeContents(document.getElementById("dnAddr"));
          const s = window.getSelection();
          s.removeAllRanges();
          s.addRange(r);
          copy.textContent = t("donate_selectCopy");
        }
      });
  }

  // ---------- Обратная связь ----------
  function openFeedback() {
    const old = document.getElementById("fbOverlay");
    if (old) old.remove();
    const ov = document.createElement("div");
    ov.id = "fbOverlay";
    ov.className = "modal-overlay";
    ov.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${t("fb_title")}</h3>
        <p class="modal-lead">${t("fb_lead")}</p>
        <textarea id="fbText" rows="5" placeholder="${t("fb_ph")}"></textarea>
        <div class="form-msg" id="fbMsg"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="fbCancel">${t("cancel")}</button>
          <button class="btn btn-primary" id="fbSend">${t("send")}</button>
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
      msg.textContent = t("sending");
      const res = await Store.sendFeedback(text.value);
      if (!res.ok) {
        send.disabled = false;
        msg.className = "form-msg err";
        msg.textContent = res.error;
        return;
      }
      msg.className = "form-msg ok";
      msg.textContent = t("fb_thanks");
      text.value = "";
      setTimeout(close, 1200);
    });
  }

  // ---------- Быстрый поиск по обеим базам ----------
  function combinedCounts() {
    const a = Store.counts();
    const d = Store.dictLoaded()
      ? Store.dictCounts()
      : { learning: 0, review: 0, known: 0 };
    return {
      learning: a.learning + d.learning,
      review: a.review + d.review,
      known: a.known + d.known,
    };
  }

  async function openSearch() {
    const old = document.getElementById("searchOverlay");
    if (old) old.remove();
    const ov = document.createElement("div");
    ov.id = "searchOverlay";
    ov.className = "modal-overlay search-overlay";
    ov.innerHTML = `
      <div class="search-modal">
        <div class="search-head">
          <input id="searchInput" type="search" placeholder="${t("search_ph")}" autocomplete="off">
          <button class="mini" id="searchClose" aria-label="${t("close")}">✕</button>
        </div>
        <div class="search-counts" id="searchCounts"></div>
        <div class="search-results" id="searchResults"></div>
      </div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    document.getElementById("searchClose").addEventListener("click", close);
    ov.addEventListener("click", (e) => {
      if (e.target === ov) close();
    });

    if (!Store.dictLoaded()) await Store.dictLoad();

    const input = document.getElementById("searchInput");
    const resultsEl = document.getElementById("searchResults");
    const countsEl = document.getElementById("searchCounts");

    function renderCounts() {
      const c = combinedCounts();
      countsEl.innerHTML =
        `<span class="sc learning"><i></i>${t("st_learning")}: <b>${c.learning}</b></span>` +
        `<span class="sc review"><i></i>${t("st_review")}: <b>${c.review}</b></span>` +
        `<span class="sc known"><i></i>${t("st_known")}: <b>${c.known}</b></span>`;
    }

    function renderResults() {
      const q = input.value.toLowerCase().trim();
      if (!q) {
        resultsEl.innerHTML = `<div class="list-empty">${t("search_min")}</div>`;
        return;
      }
      const matches = [];
      const push = (w, base) => {
        if (w.indo.toLowerCase().includes(q) || w.rus.toLowerCase().includes(q))
          matches.push({ ...w, base });
      };
      Store.all().forEach((w) => push(w, "mine"));
      Store.dictAll().forEach((w) => push(w, "ready"));
      const shown = matches.slice(0, 80);
      if (!shown.length) {
        resultsEl.innerHTML = `<div class="list-empty">${t("nothingFound")}</div>`;
        return;
      }
      resultsEl.innerHTML = shown
        .map((w, idx) => {
          const st = S[w.status];
          const baseLbl =
            w.base === "mine" ? t("search_in_mine") : t("search_in_ready");
          return `
        <div class="word-row" data-idx="${idx}">
          <span class="status-dot" style="background:${st.color}"></span>
          <div class="info">
            <div class="indo">${esc(w.indo)} <span class="base-tag">${baseLbl}</span></div>
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
                    }">${statusLabel(s)}</button>`
                )
                .join("")}
            </div>
            <div class="row-icons"><button class="mini" data-speak title="${t("ttl_speak")}">🔊</button></div>
          </div>
        </div>`;
        })
        .join("");
      resultsEl.querySelectorAll(".word-row").forEach((rowEl) => {
        const w = shown[+rowEl.dataset.idx];
        rowEl.querySelectorAll("[data-set]").forEach((b) =>
          b.addEventListener("click", () => {
            if (w.base === "mine") Store.setStatus(w.id, b.dataset.set);
            else Store.dictSetStatus(w.id, b.dataset.set);
            renderStats();
            renderCounts();
            renderResults();
          })
        );
        const sp = rowEl.querySelector("[data-speak]");
        if (sp) sp.addEventListener("click", () => speak(w.indo));
      });
    }

    input.addEventListener("input", renderResults);
    renderCounts();
    renderResults();
    input.focus();
  }

  // ---------- Вход / регистрация ----------
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
        <h2>${isLogin ? t("auth_login") : t("auth_register")}</h2>
        <p class="auth-lead">${isLogin ? t("auth_leadLogin") : t("auth_leadReg")}</p>
        <div class="field">
          <label>Email</label>
          <input id="a-email" type="email" autocomplete="email" placeholder="you@example.com">
        </div>
        <div class="field">
          <label>${t("auth_pass")}</label>
          <input id="a-pass" type="password" autocomplete="${
            isLogin ? "current-password" : "new-password"
          }" placeholder="${t("auth_passPh")}">
        </div>
        <div class="form-msg" id="a-msg"></div>
        <button class="btn btn-primary btn-block" id="a-submit">${
          isLogin ? t("auth_loginBtn") : t("auth_regBtn")
        }</button>
        <div class="auth-switch">
          ${
            isLogin
              ? `${t("auth_noAcc")} <button class="link-btn" id="a-toggle">${t("auth_regBtn")}</button>`
              : `${t("auth_haveAcc")} <button class="link-btn" id="a-toggle">${t("auth_loginBtn")}</button>`
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
        msg.textContent = t("auth_needEmailPass");
        return;
      }
      submit.disabled = true;
      msg.className = "form-msg";
      msg.textContent = isLogin ? t("auth_loggingIn") : t("auth_creating");
      const res = isLogin ? await Store.signIn(e, p) : await Store.signUp(e, p);
      submit.disabled = false;
      if (!res.ok) {
        msg.className = "form-msg err";
        msg.textContent = res.error;
        return;
      }
      if (res.needConfirm) {
        msg.className = "form-msg ok";
        msg.textContent = t("auth_confirm");
        ui.authMode = "login";
        return;
      }
      renderShell();
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
      </div>`;
  }

  // ---------- Переключение экранов ----------
  function renderShell() {
    renderUiLang();
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
  window.applyStaticI18n();
  document.addEventListener("keydown", onKeydown);
  document.getElementById("fab").addEventListener("click", () => {
    ui.tab = "add";
    render();
  });
  Store.onAuth((u) => {
    if (!u) renderShell();
  });
  setupWelcome();
  setupInstallBanner();
  window.addEventListener("online", async () => {
    if (!Store.currentUser()) return;
    await Store.syncNow();
    renderStats();
    if (ui.tab === "study") {
      startDeck();
      renderStudy();
    } else if (ui.tab === "list") renderList();
  });

  Store.subscribe(() => {
    if (Store.currentUser() && !document.body.classList.contains("auth-mode")) {
      renderStats();
    }
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
