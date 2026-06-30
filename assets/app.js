(() => {
  "use strict";

  // ---------- config / mode ----------
  const CFG = window.SSM_CONFIG || {};
  const LOCAL_MODE = !CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY;
  let supabase = null;
  if (!LOCAL_MODE && window.supabase) {
    supabase = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  }

  // ---------- localStorage keys ----------
  const LS_STORE = "ssm_study_v2";        // current attempt's full state
  const LS_DEVICE = "ssm_device_id";      // stable across attempts (links redo attempts)
  const LS_ATTEMPTS = "ssm_attempt_count"; // total attempts ever started in this browser

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const uuid = () =>
    (crypto.randomUUID && crypto.randomUUID()) ||
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  let toastTimer = null;
  const toast = (msg) => {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
  };
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  // ---------- state ----------
  let MANIFEST = null;
  let STORE = null;       // persisted attempt state
  let visitStart = 0;     // dwell timer for current scenario visit

  function getDeviceId() {
    let id = lsGet(LS_DEVICE);
    if (!id) { id = uuid(); lsSet(LS_DEVICE, id); }
    return id;
  }

  function persist() {
    if (STORE) lsSet(LS_STORE, JSON.stringify(STORE));
  }

  function loadStore() {
    try {
      const raw = lsGet(LS_STORE);
      if (!raw) return null;
      const s = JSON.parse(raw);
      // validate against current manifest (scenario ids must still exist)
      const ids = new Set(MANIFEST.scenarios.map((x) => x.id));
      if (!Array.isArray(s.order) || s.order.length !== MANIFEST.scenarios.length) return null;
      if (!s.order.every((id) => ids.has(id))) return null;
      return s;
    } catch { return null; }
  }

  function newStore() {
    const attempts = (parseInt(lsGet(LS_ATTEMPTS) || "0", 10) || 0) + 1;
    lsSet(LS_ATTEMPTS, String(attempts));
    const scenarios = shuffle(MANIFEST.scenarios);
    const displayOrders = {};
    scenarios.forEach((sc) => {
      displayOrders[sc.id] = shuffle(Object.keys(sc.videos));
    });
    return {
      version: 2,
      device_id: getDeviceId(),
      session_id: uuid(),
      attempt: attempts,
      started_at: new Date().toISOString(),
      order: scenarios.map((sc) => sc.id),
      displayOrders,
      scIndex: 0,
      data: {},          // { scenarioId: { ranked:[], ratings:{}, dwell_ms:0 } }
      finished: false,
    };
  }

  const scById = (id) => MANIFEST.scenarios.find((s) => s.id === id);
  const curId = () => STORE.order[STORE.scIndex];
  function curData() {
    const id = curId();
    if (!STORE.data[id]) STORE.data[id] = { ranked: [], ratings: {}, worst: null, dwell_ms: 0 };
    const d = STORE.data[id];
    if (d.worst === undefined) d.worst = null; // backfill older saved state
    return d;
  }

  // ---------- init ----------
  async function init() {
    if (LOCAL_MODE) $("localBanner").style.display = "block";
    try {
      const res = await fetch("data/manifest.json", { cache: "no-store" });
      MANIFEST = await res.json();
    } catch (e) {
      $("introScreen").innerHTML =
        '<h1>Could not load study data</h1><p class="muted">data/manifest.json failed to load.</p>';
      return;
    }
    $("introCount").textContent = MANIFEST.scenarios.length;

    $("startBtn").addEventListener("click", () => { STORE = newStore(); persist(); enterStudy(); });
    $("nextBtn").addEventListener("click", onNext);
    $("backBtn").addEventListener("click", onBack);
    $("redoBtn").addEventListener("click", onRedo);

    const saved = loadStore();
    if (saved && saved.finished) {
      STORE = saved;
      // already completed in this browser — show the thanks screen with redo option
      showDoneScreen();
      showThanks(LOCAL_MODE, "You've already completed this survey on this device. Thank you!");
      if (LOCAL_MODE) setupDownload(buildPayload());
    } else if (saved) {
      STORE = saved;
      enterStudy(true); // resume
    }
    // else: stay on intro
  }

  // ---------- screens ----------
  function enterStudy(resuming) {
    $("introScreen").style.display = "none";
    $("doneScreen").style.display = "none";
    $("topbar").style.display = "block";
    $("scenarioScreen").style.display = "block";
    renderScenario();
    if (resuming) toast("Welcome back — resuming where you left off.");
  }

  function renderScenario() {
    const id = curId();
    const sc = scById(id);
    const d = curData();
    visitStart = performance.now();

    $("scEyebrow").textContent = `Scenario ${STORE.scIndex + 1} of ${STORE.order.length}`;
    $("scPrompt").textContent = `“${sc.prompt}”`;
    $("backBtn").style.display = STORE.scIndex > 0 ? "inline-block" : "none";
    $("nextBtn").textContent = STORE.scIndex === STORE.order.length - 1 ? "Finish ✓" : "Next →";
    updateProgress();

    const order = STORE.displayOrders[id];
    const grid = $("grid");
    grid.innerHTML = "";
    order.forEach((cond, i) => grid.appendChild(makeCard(sc, cond, i, d)));
    refreshUI();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function makeCard(sc, cond, displayIdx, d) {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.cond = cond;

    const vidwrap = document.createElement("div");
    vidwrap.className = "vidwrap";

    const v = document.createElement("video");
    v.src = sc.videos[cond];
    v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
    v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
    v.preload = "auto";
    v.addEventListener("loadeddata", () => v.play().catch(() => {}));

    const tag = document.createElement("div");
    tag.className = "opt-tag";
    tag.textContent = "Clip " + (displayIdx + 1);

    const hint = document.createElement("div");
    hint.className = "click-hint";
    hint.textContent = "Tap to rank";

    const badge = document.createElement("div");
    badge.className = "rank-badge";

    vidwrap.append(v, tag, hint, badge);
    // touch-friendly: respond to click (covers tap)
    vidwrap.addEventListener("click", () => toggleRank(cond));

    const ratingsEl = document.createElement("div");
    ratingsEl.className = "ratings";
    ratingsEl.append(
      makeRatingRow(cond, "motion", "Motion quality"),
      makeRatingRow(cond, "visual", "Visual quality")
    );

    // "mark as worst" footer (shown only for non-top-3 clips, once top 3 are chosen)
    const worstEl = document.createElement("div");
    worstEl.className = "worst-toggle";
    const worstBtn = document.createElement("button");
    worstBtn.type = "button";
    worstBtn.className = "worst-btn";
    worstBtn.textContent = "✗ Mark as worst";
    worstBtn.addEventListener("click", (e) => { e.stopPropagation(); setWorst(cond); });
    worstEl.appendChild(worstBtn);

    card.append(vidwrap, ratingsEl, worstEl);
    return card;
  }

  function makeRatingRow(cond, dim, label) {
    const row = document.createElement("div");
    row.className = "rating-row";
    row.dataset.dim = dim;

    const lab = document.createElement("div");
    lab.className = "rating-label";
    lab.innerHTML = `<span>${label}</span><span class="val unset" data-valfor="${dim}">— / 5</span>`;

    const scale = document.createElement("div");
    scale.className = "scale";
    for (let v = 0; v <= 5; v++) {
      const tick = document.createElement("div");
      tick.className = "tick";
      tick.dataset.v = v;
      tick.textContent = v;
      tick.addEventListener("click", (e) => { e.stopPropagation(); setRating(cond, dim, v); });
      scale.appendChild(tick);
    }

    const legend = document.createElement("div");
    legend.className = "scale-legend";
    legend.innerHTML = "<span>0 — awful</span><span>5 — perfect</span>";

    row.append(lab, scale, legend);
    return row;
  }

  // ---------- interactions ----------
  function toggleRank(cond) {
    const d = curData();
    const idx = d.ranked.indexOf(cond);
    if (idx >= 0) {
      d.ranked.splice(idx, 1);
      delete d.ratings[cond];
    } else if (d.ranked.length < 3) {
      if (d.worst === cond) d.worst = null; // can't be both top-3 and worst
      d.ranked.push(cond);
      d.ratings[cond] = { motion: null, visual: null };
    } else {
      toast("You've picked 3. Tap a chosen clip to undo first.");
      return;
    }
    persist();
    refreshUI();
  }

  function setWorst(cond) {
    const d = curData();
    if (d.ranked.includes(cond)) return;     // top-3 can't be worst
    d.worst = d.worst === cond ? null : cond; // toggle
    persist();
    refreshUI();
  }

  function setRating(cond, dim, value) {
    const d = curData();
    if (!d.ratings[cond]) return; // only ranked clips
    d.ratings[cond][dim] = value;
    persist();
    refreshUI();
  }

  function refreshUI() {
    const d = curData();
    const top3done = d.ranked.length === 3;
    document.querySelectorAll(".card").forEach((card) => {
      const cond = card.dataset.cond;
      const rank = d.ranked.indexOf(cond);
      const isWorst = d.worst === cond;
      const badge = card.querySelector(".rank-badge");
      if (rank >= 0) {
        card.classList.add("ranked");
        card.classList.remove("worst");
        badge.className = `rank-badge show rank-${rank + 1}`;
        badge.textContent = rank + 1;
        card.querySelector(".click-hint").textContent = "Tap to undo";
      } else if (isWorst) {
        card.classList.remove("ranked");
        card.classList.add("worst");
        badge.className = "rank-badge show worst-badge";
        badge.textContent = "✗";
        card.querySelector(".click-hint").textContent = "Tap to rank";
      } else {
        card.classList.remove("ranked", "worst");
        badge.className = "rank-badge";
        badge.textContent = "";
        card.querySelector(".click-hint").textContent = "Tap to rank";
      }
      // reveal the "mark as worst" control only after top 3 are chosen, for non-top-3 clips
      card.classList.toggle("show-worst", top3done && rank < 0);
      const wbtn = card.querySelector(".worst-btn");
      if (wbtn) wbtn.textContent = isWorst ? "✗ Worst (tap to undo)" : "✗ Mark as worst";
      ["motion", "visual"].forEach((dim) => {
        const cur = d.ratings[cond] ? d.ratings[cond][dim] : null;
        const val = card.querySelector(`.val[data-valfor="${dim}"]`);
        if (val) {
          val.textContent = cur == null ? "— / 5" : `${cur} / 5`;
          val.classList.toggle("unset", cur == null);
        }
        const row = card.querySelector(`.rating-row[data-dim="${dim}"]`);
        if (row) row.querySelectorAll(".tick").forEach((tk) => {
          const tv = +tk.dataset.v;
          tk.classList.toggle("filled", cur != null && tv <= cur);
          tk.classList.toggle("sel", cur != null && tv === cur);
        });
      });
    });
    validate();
  }

  function ratingsDone() {
    const d = curData();
    return d.ranked.length === 3 &&
      d.ranked.every((c) => d.ratings[c] && d.ratings[c].motion != null && d.ratings[c].visual != null);
  }
  function sceneComplete() {
    const d = curData();
    return ratingsDone() && d.worst != null && !d.ranked.includes(d.worst);
  }

  function validate() {
    const d = curData();
    const ok = sceneComplete();
    $("nextBtn").disabled = !ok;
    const hint = $("scHint");
    if (d.ranked.length < 3) {
      const left = 3 - d.ranked.length;
      hint.textContent = `Pick ${left} more clip${left === 1 ? "" : "s"} (top 3).`;
    } else if (!ratingsDone()) {
      hint.textContent = "Set both ratings for each of your top 3.";
    } else if (d.worst == null) {
      hint.textContent = "Finally, mark the single worst clip (✗) to continue.";
    } else {
      hint.textContent = "All set — continue.";
    }
  }

  // ---------- navigation ----------
  function accrueDwell() {
    const d = curData();
    d.dwell_ms = (d.dwell_ms || 0) + Math.round(performance.now() - visitStart);
  }

  function onNext() {
    if (!sceneComplete()) return;
    accrueDwell();
    if (STORE.scIndex < STORE.order.length - 1) {
      STORE.scIndex++;
      persist();
      renderScenario();
    } else {
      persist();
      finish();
    }
  }

  function onBack() {
    if (STORE.scIndex === 0) return;
    accrueDwell();
    STORE.scIndex--;
    persist();
    renderScenario();
  }

  function updateProgress() {
    const n = STORE.order.length;
    $("progressFill").style.width = `${(STORE.scIndex / n) * 100}%`;
    $("progressMeta").textContent = `${STORE.scIndex} / ${n} done`;
  }

  // ---------- finish / submit ----------
  function buildPayload() {
    const responses = STORE.order.map((id, i) => {
      const d = STORE.data[id] || { ranked: [], ratings: {}, dwell_ms: 0 };
      const positions = {};
      (STORE.displayOrders[id] || []).forEach((cond, idx) => (positions[cond] = idx));
      return {
        scenario_id: id,
        scenario_order: i,
        rank1: d.ranked[0] || null,
        rank2: d.ranked[1] || null,
        rank3: d.ranked[2] || null,
        worst: d.worst || null,
        ratings: d.ratings,
        positions,
        dwell_ms: d.dwell_ms || 0,
      };
    });
    return {
      session_id: STORE.session_id,
      device_id: STORE.device_id,
      attempt: STORE.attempt,
      started_at: STORE.started_at,
      finished_at: new Date().toISOString(),
      user_agent: navigator.userAgent,
      screen: `${window.screen.width}x${window.screen.height}`,
      responses,
    };
  }

  function showDoneScreen() {
    $("introScreen").style.display = "none";
    $("scenarioScreen").style.display = "none";
    $("topbar").style.display = "block";
    $("doneScreen").style.display = "block";
    $("progressFill").style.width = "100%";
    $("progressMeta").textContent = `${STORE.order.length} / ${STORE.order.length} done`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function finish() {
    STORE.finished = true;
    persist();
    showDoneScreen();

    const payload = buildPayload();
    console.log("[study] session payload:", payload);

    if (LOCAL_MODE) {
      showThanks(true, "Local preview — no server. Download your responses below.");
      setupDownload(payload);
      return;
    }

    try {
      const rows = payload.responses.map((r) => ({
        session_id: payload.session_id,
        device_id: payload.device_id,
        attempt: payload.attempt,
        scenario_id: r.scenario_id,
        scenario_order: r.scenario_order,
        rank1: r.rank1, rank2: r.rank2, rank3: r.rank3,
        worst: r.worst,
        ratings: r.ratings,
        positions: r.positions,
        dwell_ms: r.dwell_ms,
        user_agent: payload.user_agent,
        screen_size: payload.screen,
      }));
      const { error } = await supabase.from("responses").insert(rows);
      if (error) throw error;
      showThanks(false);
    } catch (e) {
      console.error("[study] submit failed:", e);
      showThanks(true, "We couldn't reach the server. Please download your responses and send them to the researcher.");
      setupDownload(payload);
    }
  }

  function showThanks(showDownload, msg) {
    $("submitting").style.display = "none";
    $("thanks").style.display = "block";
    if (msg) $("thanksMsg").textContent = msg;
    $("downloadBtn").style.display = showDownload ? "inline-block" : "none";
  }

  function setupDownload(payload) {
    const btn = $("downloadBtn");
    btn.onclick = () => {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `study_${payload.session_id.slice(0, 8)}_attempt${payload.attempt}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };
  }

  function onRedo() {
    // start a brand-new attempt (flagged via attempt++ and a fresh session_id),
    // keeping device_id so repeated attempts from the same browser can be linked.
    STORE = newStore();
    persist();
    $("thanks").style.display = "none";
    $("submitting").style.display = "block";
    enterStudy();
    toast(`Starting attempt #${STORE.attempt}. Thanks for going again!`);
  }

  init();
})();
