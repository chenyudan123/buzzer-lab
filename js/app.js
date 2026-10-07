/* Buzzer Lab — Science Bowl practice app. Data stays on the device (IndexedDB). */
(function () {
"use strict";
const P = self.NSBParser;
const CAT = P.CATEGORY_NAMES;
const L = ["W", "X", "Y", "Z"];
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

/* ---------------- storage ---------------- */
const idb = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("buzzerlab", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  get(k) { return new Promise((res, rej) => { const t = this.db.transaction("kv").objectStore("kv").get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); },
  set(k, v) { return new Promise((res, rej) => { const t = this.db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
  del(k) { return new Promise((res, rej) => { const t = this.db.transaction("kv", "readwrite"); t.objectStore("kv").delete(k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
};
const DEFAULT_SETTINGS = { mode: "mix", cats: null, level: "all", kind: "both", count: 20, focus: "all", round: "", gameFlow: true,
  read: "voice", show: "text", rate: 1, voice: "", wordMs: 300, speed: "normal" };
const SPEEDS = { relaxed: ["Relaxed", 0.95], normal: ["Normal", 1.1], quick: ["Quick", 1.25], fast: ["Fast", 1.4] };
const speechRate = () => (SPEEDS[prog.settings.speed] || SPEEDS.normal)[1];
let rounds = [];              // [{source,label,level,set,year,round,count,added}]
let Q = new Map();            // id -> question
let prog = { qstats: {}, attempts: [], sessions: [], settings: { ...DEFAULT_SETTINGS }, directBlocked: false };

async function loadAll() {
  await idb.open();
  rounds = (await idb.get("rounds")) || [];
  for (const r of rounds) { const qs = (await idb.get("round:" + r.source)) || []; qs.forEach((q) => Q.set(q.id, q)); }
  const p = await idb.get("progress");
  if (p) prog = { ...prog, ...p, settings: { ...DEFAULT_SETTINGS, ...(p.settings || {}) } };
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  await loadSharedBank();
}
/* Shared question bank: questions.json uploaded next to index.html gives every device the same rounds. */
async function loadSharedBank() {
  let bank;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch("questions.json", { cache: "no-cache", signal: ctl.signal }); clearTimeout(t);
    if (!res.ok) return;
    bank = await res.json();
  } catch (e) { return; }
  if (!bank || bank.app !== "buzzer-lab" || !Array.isArray(bank.rounds)) return;
  if (prog.bankStamp === bank.exportedAt) return;   // already loaded this version of the bank
  for (const r of bank.rounds) {
    if (!r || !r.source || !Array.isArray(r.questions) || !r.questions.length) continue;
    await idb.set("round:" + r.source, r.questions);
    [...Q.keys()].forEach((id) => { if (Q.get(id).source === r.source) Q.delete(id); });
    r.questions.forEach((q) => Q.set(q.id, q));
    rounds = rounds.filter((x) => x.source !== r.source);
    rounds.push({ source: r.source, label: r.label, level: r.level, count: r.questions.length, problems: r.problems || 0, added: r.added || Date.now(), shared: true });
  }
  await idb.set("rounds", rounds);
  prog.bankStamp = bank.exportedAt;
  await idb.set("progress", prog);
}
function exportBank() {
  const bank = { app: "buzzer-lab", v: 1, exportedAt: new Date().toISOString(),
    rounds: rounds.map((r) => ({ ...r, shared: undefined, questions: [...Q.values()].filter((q) => q.source === r.source) })).filter((r) => r.questions.length) };
  const blob = new Blob([JSON.stringify(bank)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "questions.json";
  document.body.appendChild(a); a.click(); a.remove();
  return bank.rounds.length;
}
let saveT = null;
function saveProgress() { clearTimeout(saveT); saveT = setTimeout(() => idb.set("progress", prog).catch(() => toast("Couldn't save progress on this device.")), 250); }

/* ---------------- helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600); }
const catsPresent = () => [...new Set([...Q.values()].map((q) => q.cat))].sort((a, b) => Object.keys(CAT).indexOf(a) - Object.keys(CAT).indexOf(b));
const answerText = (q) => (q.format === "mc" ? `${q.a}) ${q.ch[L.indexOf(q.a)]}` : q.display);
const catDot = (c) => `<i class="dot c-${c}"></i>`;
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

/* ---------------- routing ---------------- */
let tab = "practice", view = "setup";
function go(t, v) { stopAll(); tab = t; view = v || (t === "practice" ? "setup" : t); render(); window.scrollTo(0, 0); }
function render() {
  $$("nav.tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === tab));
  const app = $("#app");
  if (view === "setup") { app.innerHTML = setupHTML(); bindSetup(); }
  else if (view === "play") renderPlay();
  else if (view === "summary") { app.innerHTML = summaryHTML(); bindSummary(); }
  else if (view === "progress") { app.innerHTML = progressHTML(); bindProgress(); }
  else if (view === "rounds") { app.innerHTML = roundsHTML(); bindRounds(); }
}

/* ================= PRACTICE SETUP ================= */
function chip(name, value, label, checked, type = "radio", extra = "") {
  return `<label class="chip ${extra}"><input type="${type}" name="${name}" value="${esc(value)}" ${checked ? "checked" : ""}><span>${label}</span></label>`;
}
function pool(st) {
  const cats = new Set(st.cats || catsPresent());
  let qs = [...Q.values()].filter((q) => cats.has(q.cat) && (st.level === "all" || q.level === st.level) && (st.kind === "both" || q.kind === st.kind));
  if (st.focus === "missed") qs = qs.filter((q) => prog.qstats[q.id] && prog.qstats[q.id].last === 0);
  if (st.focus === "new") qs = qs.filter((q) => !prog.qstats[q.id]);
  return qs;
}
function setupHTML() {
  if (!Q.size) return `<div class="stack">
    <div><div class="eyebrow">Welcome</div><h2>Add your first official round</h2></div>
    <div class="panel stack">
      <p class="lead">Buzzer Lab practices with the real sample rounds that the U.S. Department of Energy publishes for the National Science Bowl: ${NSB_CATALOG.filter((r) => r[0] === "MS").length} middle school rounds and ${NSB_CATALOG.filter((r) => r[0] === "HS").length} high school rounds.</p>
      <ol class="steps">
        <li>Open the <b>Rounds</b> tab and pick a round from the list.</li>
        <li>Tap <b>Add</b>. If DOE's site won't hand the file over directly, tap <b>Open PDF</b>, save it, then tap <b>Import PDFs</b> and choose it.</li>
        <li>Come back here and start practicing. Each round adds about 40 to 50 questions.</li>
      </ol>
      <div><button class="btn go" id="toRounds">Go to Rounds</button></div>
    </div></div>`;
  const st = prog.settings, present = catsPresent();
  const sel = st.cats ? st.cats.filter((c) => present.includes(c)) : present;
  const levels = [...new Set([...Q.values()].map((q) => q.level))];
  const n = pool({ ...st, cats: sel }).length;
  const t = totals();
  const roundOpts = rounds.map((r) => `<option value="${esc(r.source)}" ${st.round === r.source ? "selected" : ""}>${esc(r.label)} (${r.count})</option>`).join("");
  return `<div class="stack">
  <div class="row between end"><div><div class="eyebrow">Practice</div><h2>Ready to buzz?</h2></div>
    <span class="small muted">${Q.size} questions from ${rounds.length} round${rounds.length === 1 ? "" : "s"}</span></div>
  <div class="stats">
    <div class="stat"><div class="v">${t.seen ? pct(t.ok, t.seen) + "%" : "–"}</div><div class="k">accuracy</div></div>
    <div class="stat"><div class="v">${t.bp != null ? t.bp + "%" : "–"}</div><div class="k">avg. buzz point</div></div>
    <div class="stat"><div class="v">${t.seen}</div><div class="k">questions answered</div></div>
  </div>
  <form class="panel stack" id="setup">
    <fieldset><legend><h3>What to play</h3></legend><div class="chips">
      ${chip("mode", "mix", "Mixed practice", st.mode === "mix")}${chip("mode", "round", "A full round, in order", st.mode === "round")}</div></fieldset>
    <div id="mixOpts" class="stack" ${st.mode === "round" ? "hidden" : ""}>
      <fieldset><legend><h3>Categories</h3></legend><div class="chips">${present.map((c) => chip("cat", c, catDot(c) + esc(CAT[c]), sel.includes(c), "checkbox")).join("")}</div></fieldset>
      <div class="grid2">
        ${levels.length > 1 ? `<fieldset><legend><h3>Level</h3></legend><div class="chips">${chip("level", "all", "Both", st.level === "all")}${chip("level", "MS", "Middle school", st.level === "MS")}${chip("level", "HS", "High school", st.level === "HS")}</div></fieldset>` : ""}
        <fieldset><legend><h3>Questions</h3></legend><div class="chips">${chip("kind", "both", "Both", st.kind === "both")}${chip("kind", "T", "Toss-ups", st.kind === "T")}${chip("kind", "B", "Bonuses", st.kind === "B")}</div></fieldset>
        <fieldset><legend><h3>Focus</h3></legend><div class="chips">${chip("focus", "all", "Everything", st.focus === "all")}${chip("focus", "new", "Not seen yet", st.focus === "new")}${chip("focus", "missed", "Missed last time", st.focus === "missed")}</div></fieldset>
        <fieldset><legend><h3>Length</h3></legend><div class="chips">${[10, 20, 40].map((c) => chip("count", c, String(c), +st.count === c)).join("")}</div></fieldset>
      </div>
    </div>
    <div id="roundOpts" class="stack" ${st.mode === "round" ? "" : "hidden"}>
      <label class="field"><span>Round</span><select id="roundSel">${roundOpts}</select></label>
      <label class="check"><input type="checkbox" id="gameFlow" ${st.gameFlow ? "checked" : ""}> Play bonuses only after a correct toss-up, like a real match</label>
    </div>
    <div class="grid2">
      <fieldset><legend><h3>Moderator</h3></legend><div class="chips">${chip("read", "voice", "Read aloud", st.read === "voice")}${chip("read", "text", "Text only", st.read === "text")}</div></fieldset>
      <fieldset id="showFs" ${st.read === "voice" ? "" : "hidden"}><legend><h3>While reading</h3></legend><div class="chips">${chip("show", "text", "Show the words", st.show === "text")}${chip("show", "listen", "Listen only", st.show === "listen")}</div></fieldset>
    </div>
    <div id="voiceOpts" class="stack tight" ${st.read === "voice" && speech.ok ? "" : "hidden"}>
      <div class="grid2">
        <label class="field"><span>Voice</span><span class="row" style="flex-wrap:nowrap"><select id="voiceSel" style="flex:1">${voiceOptions()}</select><button type="button" class="btn small" id="testVoice">Test</button></span></label>
        <fieldset><legend><h3>Reading speed</h3></legend><div class="chips">${Object.entries(SPEEDS).map(([k, [lbl]]) => chip("speed", k, lbl, (st.speed || "normal") === k)).join("")}</div></fieldset>
      </div>
      <p class="small muted" id="voiceTip">${voiceTip()}</p>
    </div>
    <div class="row between">
      <span class="small muted" id="poolNote">${st.mode === "round" ? "" : `${n} matching question${n === 1 ? "" : "s"}`}</span>
      <button class="btn go" type="submit" id="startBtn" ${st.mode === "mix" && !n ? "disabled" : ""}>Start</button>
    </div>
  </form>
  <details class="panel howto"><summary><h3>How scoring works</h3></summary>
    <p><b>Toss-ups</b> (+4): buzz with the big button or the space bar as soon as you know it. After the moderator finishes you have 5 seconds to buzz. Buzzing before the question is finished is an <b>interrupt</b>; a wrong interrupt costs 4 points.</p>
    <p><b>Bonuses</b> (+10): you get 20 seconds after the reading ends. Multiple-choice answers use the competition letters W, X, Y and Z.</p>
    <p><b>Buzz point</b> is how much of the question had been read when you buzzed. Lower means faster.</p>
  </details></div>`;
}
function readSetup() {
  const f = $("#setup"), st = prog.settings;
  const v = (n) => { const i = f.querySelector(`input[name=${n}]:checked`); return i ? i.value : null; };
  st.mode = v("mode") || st.mode;
  const present = catsPresent(), cs = $$("input[name=cat]:checked", f).map((i) => i.value);
  st.cats = cs.length === present.length ? null : cs;
  ["level", "kind", "focus", "read", "show", "speed"].forEach((k) => { const x = v(k); if (x) st[k] = x; });
  const vs = $("#voiceSel"); if (vs && vs.value) st.voice = vs.value;
  const c = v("count"); if (c) st.count = +c;
  const rs = $("#roundSel"); if (rs) st.round = rs.value;
  const gf = $("#gameFlow"); if (gf) st.gameFlow = gf.checked;
}
function bindSetup() {
  const tr = $("#toRounds"); if (tr) { tr.onclick = () => go("rounds"); return; }
  const f = $("#setup");
  f.addEventListener("change", () => {
    readSetup(); const st = prog.settings;
    $("#mixOpts").hidden = st.mode !== "mix"; $("#roundOpts").hidden = st.mode !== "round"; $("#showFs").hidden = st.read !== "voice";
    $("#voiceOpts").hidden = st.read !== "voice" || !speech.ok;
    const n = pool(st).length;
    $("#poolNote").textContent = st.mode === "round" ? "" : `${n} matching question${n === 1 ? "" : "s"}`;
    $("#startBtn").disabled = st.mode === "mix" && !n;
    saveProgress();
  });
  const tv = $("#testVoice"); if (tv) tv.onclick = () => { readSetup(); saveProgress(); speech.sample(); };
  f.addEventListener("submit", (e) => {
    e.preventDefault(); readSetup(); saveProgress(); speech.unlock();
    const st = prog.settings;
    if (st.mode === "round") {
      const qs = [...Q.values()].filter((q) => q.source === st.round).sort((a, b) => a.num - b.num || (a.kind === "T" ? -1 : 1));
      startRound(qs, { inOrder: true, gameFlow: st.gameFlow, label: (rounds.find((r) => r.source === st.round) || {}).label });
    } else startRound(pool(st), { label: "Mixed practice" });
  });
}

/* ================= SPEECH ================= */
// Novelty and very old voices that ship on Apple devices: robotic, so never pick them by default.
const BAD_VOICES = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Fred|Good News|Hysterical|Jester|Junior|Kathy|Organ|Pipe Organ|Ralph|Superstar|Trinoids|Whisper|Wobble|Zarvox|Grandma|Grandpa|Eddy|Flo|Reed|Rocko|Sandy|Shelley|Princess|Bruce|Agnes|Vicki|Victoria)\b/i;
const GOOD_VOICES = /\b(Ava|Samantha|Allison|Susan|Zoe|Evan|Nathan|Joelle|Noelle|Tom|Alex|Aaron|Nicky|Serena|Daniel|Karen|Moira|Tessa|Aria|Jenny|Guy|Michelle|Ana|Christopher|Eric|Emma|Brian|Andrew|Ryan|Sonia|Libby|Natasha|William)\b/i;
function voiceScore(v) {
  let s = 0;
  if (BAD_VOICES.test(v.name)) s -= 100;
  if (/premium|enhanced|natural|neural/i.test(v.name)) s += 60;      // downloaded high-quality or neural voices
  else if (/online/i.test(v.name)) s += 45;                           // Microsoft Edge online voices
  if (/^Google/i.test(v.name)) s += 35;
  if (GOOD_VOICES.test(v.name)) s += 20;
  if (/en[-_]US/i.test(v.lang)) s += 10; else if (/en[-_](GB|AU|CA|IE|NZ)/i.test(v.lang)) s += 6;
  if (v.default) s += 3;
  return s;
}
const speech = {
  ok: "speechSynthesis" in self,
  voices: [],
  unlock() { if (!this.ok) return; try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } catch (e) {} },
  loadVoices() {
    if (!this.ok) return;
    const pick = () => {
      const seen = new Set();
      this.voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang) && !seen.has(v.voiceURI) && seen.add(v.voiceURI))
        .sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name));
      const sel = $("#voiceSel"); if (sel) { sel.innerHTML = voiceOptions(); const tip = $("#voiceTip"); if (tip) tip.innerHTML = voiceTip(); }
    };
    pick(); speechSynthesis.onvoiceschanged = pick;
    setTimeout(pick, 600); setTimeout(pick, 2000);   // some browsers fill the list late and never fire the event
  },
  voice() {
    const want = prog.settings.voice;
    return this.voices.find((v) => v.voiceURI === want) || this.voices[0] || null;
  },
  sample() {
    if (!this.ok) return; this.cancel();
    const u = new SpeechSynthesisUtterance("Toss-up 1. Physics. Short answer. What is the SI unit of force? Remember, you have five seconds to buzz.");
    const v = this.voice(); if (v) { u.voice = v; u.lang = v.lang; } u.rate = speechRate();
    speechSynthesis.speak(u);
  },
  cancel() { if (this.ok) try { speechSynthesis.cancel(); } catch (e) {} },
};
function voiceLabel(v) {
  const lang = /GB/i.test(v.lang) ? " · British" : /AU/i.test(v.lang) ? " · Australian" : /IE/i.test(v.lang) ? " · Irish" : /IN/i.test(v.lang) ? " · Indian" : /ZA/i.test(v.lang) ? " · S. African" : "";
  return v.name.replace(/^Microsoft\s+/i, "").replace(/\s*-\s*English.*$/i, "") + lang;
}
function voiceOptions() {
  const list = speech.voices.filter((v) => voiceScore(v) > -50);
  if (!list.length) return `<option value="">Default voice</option>`;
  const cur = speech.voice();
  return list.slice(0, 40).map((v) => `<option value="${esc(v.voiceURI)}" ${cur && cur.voiceURI === v.voiceURI ? "selected" : ""}>${esc(voiceLabel(v))}</option>`).join("");
}
function voiceTip() {
  const hasGreat = speech.voices.some((v) => /premium|enhanced|natural|neural|online/i.test(v.name));
  if (hasGreat) return "Voices marked Premium, Enhanced, or Natural sound the most human.";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document))
    return "For a much more natural voice, download one: <b>Settings → Accessibility → Spoken Content → Voices → English</b>, pick a voice such as Ava or Zoe, and choose the <b>Premium</b> or <b>Enhanced</b> version. Then fully close and reopen this app.";
  if (/Android/.test(ua))
    return "For a more natural voice: <b>Settings → Accessibility → Text-to-speech output</b>, choose <b>Speech Services by Google</b>, tap the gear, then <b>Install voice data → English (United States)</b> and pick a voice.";
  if (/Edg\//.test(ua)) return "Voices whose names end in Online (Natural) sound the most human.";
  return "Tip: the Microsoft Edge browser includes very natural voices, marked Online (Natural).";
}

/* ================= PLAY ================= */
let G = null, timers = [];
function stopTimers() { timers.forEach((t) => { clearInterval(t); clearTimeout(t); }); timers = []; }
function stopAll() { stopTimers(); speech.cancel(); }
function weight(q) { const s = prog.qstats[q.id]; if (!s) return 1.2; if (s.last === 0) return 2; return Math.max(0, 1 - s.c / s.n); }

function startRound(qs, opts) {
  let list = qs.slice();
  if (!opts.inOrder) list = list.map((q) => [q, weight(q) + Math.random() * 1.3]).sort((a, b) => b[1] - a[1]).map((x) => x[0]).slice(0, prog.settings.count);
  if (!list.length) { toast("No questions match those choices."); return; }
  G = { list, i: -1, log: [], pts: 0, opts, startedAt: Date.now() };
  tab = "practice"; view = "play"; nextQ();
}
function nextQ() {
  stopAll();
  let i = G.i + 1;
  if (G.opts.gameFlow) {
    // skip a bonus unless its toss-up was answered correctly
    while (i < G.list.length && G.list[i].kind === "B") {
      const prev = G.log.find((x) => x.id === G.list[i].id.replace(/-B(\d+)$/, "-T$1"));
      if (prev && prev.ok) break;
      i++;
    }
  }
  G.i = i;
  if (i >= G.list.length) return endRound();
  const q = G.list[i];
  const toks = buildTokens(q);
  G.cur = { q, toks, shown: 0, phase: "reading", readEnd: null };
  renderPlay();
  if (prog.settings.read === "voice" && speech.ok) readAloud(); else readByTimer();
}
function buildTokens(q) {
  // each token: {t: display text, s: spoken text, line: starts a choice line, head: format label}
  const toks = [];
  const head = `${q.kind === "B" ? "Bonus" : "Toss-up"}. ${CAT[q.cat] || q.catLabel}. ${q.format === "mc" ? "Multiple choice" : "Short answer"}.`;
  toks.push({ t: q.format === "mc" ? "Multiple Choice" : "Short Answer", s: head.replace(/^(Bonus|Toss-up)\./, `$1 ${q.num}.`), head: 1 });
  const words = (s) => s.split(/\s+/).filter(Boolean).map((w) => ({ t: w, s: /^\[.*\]$|^\[|\]$/.test(w) ? "" : say(w) }));
  // keep bracketed pronunciations out of speech even when they span words
  let inBr = false;
  // inside a [pronunciation guide] say nothing, but keep punctuation that follows it ("[GAM-eets]?")
  const brPunct = (t) => { const m = t.match(/\]([.,?!;:]+)$/); return m ? m[1] : ""; };
  words(q.q).forEach((w) => { if (w.t.startsWith("[")) inBr = true; toks.push({ t: w.t, s: inBr ? brPunct(w.t) : say(w.t) }); if (w.t.includes("]")) inBr = false; });
  if (q.format === "mc") q.ch.forEach((c, ix) => {
    toks.push({ t: L[ix] + ")", s: L[ix] + ",", line: 1 });
    inBr = false;
    words(c).forEach((w) => { if (w.t.startsWith("[")) inBr = true; toks.push({ t: w.t, s: inBr ? brPunct(w.t) : say(w.t) }); if (w.t.includes("]")) inBr = false; });
    // a short pause after each choice
    for (let k = toks.length - 1; k >= 0 && !toks[k].line; k--) if (toks[k].s) { if (!/[.?!,;:]$/.test(toks[k].s)) toks[k].s += "."; break; }
  });
  return toks;
}
// how symbols should sound when read aloud
const SUPN = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "negative ", "ⁿ": "n", "⁺": "" };
function say(w) {
  return w
    .replace(/([0-9A-Za-z)])²(?![⁰-⁹])/g, "$1 squared").replace(/([0-9A-Za-z)])³(?![⁰-⁹])/g, "$1 cubed")
    .replace(/[⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ]+/g, (m) => {
      const n = [...m].map((c) => SUPN[c] ?? c).join("");
      const sfx = /n$/.test(n) ? "th" : /1[123]$/.test(n) ? "th" : /1$/.test(n) ? "st" : /2$/.test(n) ? "nd" : /3$/.test(n) ? "rd" : "th";
      return " to the " + n + sfx + " power";
    })
    .replace(/√/g, "square root of ").replace(/π/g, "pi").replace(/×/g, " times ").replace(/÷/g, " divided by ")
    .replace(/°/g, " degrees").replace(/≤/g, " less than or equal to ").replace(/≥/g, " greater than or equal to ")
    .replace(/\s+/g, " ").trim();
}
function readByTimer() {
  const c = G.cur, ms = prog.settings.read === "voice" && !speech.ok ? 300 : prog.settings.wordMs || 300;
  timers.push(setInterval(() => { c.shown++; paintText(); if (c.shown >= c.toks.length) { stopTimers(); readDone(); } }, ms));
}
function readAloud() {
  const c = G.cur;
  // Read the whole question as one continuous utterance so there are no gaps between pieces.
  // Network voices (e.g. Chrome's "Google" voices) stop after ~15 seconds, so those get sentence-sized chunks.
  const voice = speech.voice();
  const chunky = voice && !voice.localService;
  const segs = []; let cur = null;
  c.toks.forEach((t, i) => {
    const prev = c.toks[i - 1];
    const brk = chunky && cur && cur.text.length > 60 && (t.line && !prev.line ? true : prev && /[.?!]$/.test(prev.s || "") && !t.line && cur.text.length > 140);
    if (!cur || brk) { cur = { from: i, offs: [], text: "" }; segs.push(cur); }
    cur.offs.push(cur.text.length);
    if (t.s && /^[.,?!;:]+$/.test(t.s)) cur.text = cur.text.replace(/\s+$/, "") + t.s + " ";
    else cur.text += (t.s ? t.s + " " : "");
  });
  let boundaryWorks = false, started = false, finished = false;
  const fallbackMs = 330 / speechRate();
  const reveal = (n) => { if (n > c.shown) { c.shown = Math.min(n, c.toks.length); paintText(); } };
  timers.push(setInterval(() => { if (started && !boundaryWorks && c.phase === "reading" && c.shown < c.toks.length - 1) reveal(c.shown + 1); }, fallbackMs));
  // if the voice never starts (no voices installed, muted engine), fall back to timed reveal
  timers.push(setTimeout(() => { if (!started && c === G.cur && c.phase === "reading") readByTimerFrom(); }, 4000));
  segs.forEach((sg, k) => {
    const u = new SpeechSynthesisUtterance(sg.text);
    if (voice) u.voice = voice;
    u.lang = voice ? voice.lang : "en-US"; u.rate = speechRate();
    u.onstart = () => { started = true; reveal(sg.from + 1); };
    u.onboundary = (e) => {
      if (e.name && e.name !== "word") return;
      boundaryWorks = true;
      let j = 0; while (j + 1 < sg.offs.length && sg.offs[j + 1] <= e.charIndex) j++;
      reveal(sg.from + j + 1);
    };
    u.onend = () => { if (k === segs.length - 1) done(); else reveal(segs[k + 1].from); };
    u.onerror = (e) => { if (e.error !== "interrupted" && e.error !== "canceled") { readByTimerFrom(); } };
    speechSynthesis.speak(u);
  });
  function done() { if (finished || c !== G.cur || c.phase !== "reading") return; finished = true; stopTimers(); reveal(c.toks.length); readDone(); }
  function readByTimerFrom() { if (finished) return; finished = true; stopTimers(); speech.cancel(); readByTimer(); }
  // safety net for browsers that never fire onend
  let idle = 0;
  timers.push(setInterval(() => {
    if (c.phase !== "reading" || !started) return;
    idle = speechSynthesis.speaking || speechSynthesis.pending ? 0 : idle + 1;
    if (idle >= 6) done();
  }, 250));
}
function readDone() {
  const c = G.cur; if (c.phase !== "reading") return;
  c.readEnd = Date.now();
  if (c.q.kind === "B") { c.phase = "answering"; startClock(20, () => finish(null, "time")); renderControls(); }
  else { c.phase = "window"; startClock(5, () => finish(null, "time")); renderControls(); }
}
function startClock(sec, onEnd) {
  const c = G.cur; c.clockEnd = Date.now() + sec * 1000; c.clockSec = sec;
  timers.push(setInterval(() => {
    const left = Math.max(0, c.clockEnd - Date.now());
    const bar = $("#clockbar"), lbl = $("#clocklbl");
    if (bar) { bar.firstElementChild.style.width = 100 * (1 - left / (sec * 1000)) + "%"; bar.classList.toggle("urgent", left < sec * 300); }
    if (lbl) lbl.textContent = (left / 1000).toFixed(1) + " s";
    if (left <= 0) { stopTimers(); onEnd(); }
  }, 100));
}
function buzz() {
  const c = G && G.cur; if (!c || c.q.kind !== "T" || !(c.phase === "reading" || c.phase === "window")) return;
  stopTimers(); speech.cancel();
  c.interrupt = c.phase === "reading" && c.shown < c.toks.length;
  c.bp = c.phase === "reading" ? Math.min(1, c.shown / c.toks.length) : 1;
  c.rt = c.phase === "window" ? Date.now() - c.readEnd : 0;
  c.phase = "answering"; c.shown = c.toks.length; c.forceShow = true; c.buzzedAt = Date.now();
  if (navigator.vibrate) try { navigator.vibrate(30); } catch (e) {}
  paintText(); renderControls();
}
function finish(given, reason) {
  const c = G.cur; if (c.phase === "result") return;
  stopAll();
  const q = c.q;
  c.ok = reason === "time" ? false : q.format === "mc" ? given === q.a : P.checkShort(q, given || "");
  c.given = given; c.reason = reason; c.phase = "result"; c.shown = c.toks.length; c.forceShow = true;
  record(); paintText(); renderControls();
}
function record() {
  const c = G.cur, q = c.q;
  const pts = c.ok ? (q.kind === "B" ? 10 : 4) : c.interrupt && c.reason !== "time" ? -4 : 0;
  if (c.logIx == null) {
    c.logIx = G.log.length;
    G.log.push({ t: Date.now(), id: q.id, cat: q.cat, k: q.kind, ok: c.ok, pts, int: !!c.interrupt, bp: q.kind === "T" && c.bp != null ? +c.bp.toFixed(3) : null, rt: q.kind === "T" && c.bp != null ? c.rt : null, to: c.reason === "time" });
    const s = prog.qstats[q.id] || { n: 0, c: 0 }; s.n++; if (c.ok) s.c++; s.last = c.ok ? 1 : 0; s.t = Date.now(); prog.qstats[q.id] = s;
    G.pts += pts;
  } else {
    // self-judged override
    const e = G.log[c.logIx]; G.pts += pts - e.pts;
    const s = prog.qstats[q.id]; s.c += (c.ok ? 1 : 0) - (e.ok ? 1 : 0); s.last = c.ok ? 1 : 0;
    e.ok = c.ok; e.pts = pts;
  }
  saveProgress();
  const sc = $("#score"); if (sc) sc.innerHTML = scoreLine();
}
function override(ok) { const c = G.cur; if (c.ok === ok) return; c.ok = ok; if (c.reason === "time") c.reason = "self"; record(); renderControls(); }
const scoreLine = () => `<b>${G.pts}</b> pts · ${Math.min(G.i + 1, G.list.length)}/${G.list.length}`;

function renderPlay() {
  const c = G.cur, q = c.q;
  $("#app").innerHTML = `<div class="stack play">
    <div class="row between">
      <span class="tag"><span class="kind ${q.kind === "B" ? "b" : ""}">${q.kind === "B" ? "Bonus" : "Toss-up"} ${q.num}</span><span class="cat c-${q.cat}">${catDot(q.cat)}${esc(CAT[q.cat] || q.catLabel)}</span></span>
      <span class="score" id="score">${scoreLine()}</span>
    </div>
    <div class="panel qpanel">
      <div class="qtext" id="qtext"></div>
      <div id="clockwrap" hidden><div class="clockbar" id="clockbar"><div></div></div><div class="clockrow"><span id="clockwhat"></span><span id="clocklbl"></span></div></div>
    </div>
    <div id="controls"></div>
    <div class="row between"><span class="small muted">${esc(G.opts.label || "")}</span><button class="btn ghost small" id="quit">End round</button></div>
  </div>`;
  $("#quit").onclick = () => endRound();
  paintText(); renderControls();
}
function paintText() {
  const c = G.cur, el = $("#qtext"); if (!el) return;
  const listen = prog.settings.read === "voice" && speech.ok && prog.settings.show === "listen" && !c.forceShow;
  if (listen) { el.innerHTML = `<div class="listening"><span class="wave"><i></i><i></i><i></i><i></i></span>${c.phase === "reading" ? "Listening…" : "Reading finished"}</div>`; return; }
  let html = "", open = false;
  c.toks.forEach((t, i) => {
    const cls = i < c.shown ? "" : "hid";
    if (t.line) { if (open) html += "</span>"; html += '<span class="choice">'; open = true; }
    else if (i > 0 && !c.toks[i - 1].line) html += " ";
    html += `<span class="${t.head ? "fmt " : ""}${cls}">${esc(t.t)}</span>`;
    if (t.line) html += " ";
  });
  if (open) html += "</span>";
  el.innerHTML = html;
}
function renderControls() {
  const c = G.cur, q = c.q, box = $("#controls"); if (!box) return;
  const cw = $("#clockwrap");
  if (cw) { cw.hidden = !(c.phase === "window" || (c.phase === "answering" && q.kind === "B" && c.readEnd)); $("#clockwhat").textContent = c.phase === "window" ? "Time to buzz" : "Time to answer"; }
  if (q.kind === "T" && (c.phase === "reading" || c.phase === "window")) {
    box.innerHTML = `<div class="buzz-zone"><button class="buzzer" id="buzzer" aria-label="Buzz in">BUZZ</button><span class="small muted hide-touch">or press <span class="kbd">Space</span></span></div>`;
    $("#buzzer").addEventListener("pointerdown", (e) => { e.preventDefault(); buzz(); });
    $("#buzzer").addEventListener("click", buzz);
    return;
  }
  if (c.phase === "reading" || c.phase === "answering") {
    const head = q.kind === "T" ? `<div class="answer-now">${c.interrupt ? "Interrupt! " : ""}Answer now</div>` : `<div class="small muted">Answer when ready. The 20-second clock starts when the reading ends.</div>`;
    if (q.format === "mc") {
      box.innerHTML = `<div class="stack tight">${head}<div class="mc">${q.ch.map((t, i) => `<button data-l="${L[i]}"><span class="L">${L[i]}</span><span>${esc(t)}</span></button>`).join("")}</div></div>`;
      $$(".mc button", box).forEach((b) => (b.onclick = () => { if (c.buzzedAt && Date.now() - c.buzzedAt < 450) return; finish(b.dataset.l, "answer"); }));
    } else {
      const prev = $("#sainput") ? $("#sainput").value : "";
      box.innerHTML = `<form class="stack tight" id="saform">${head}<div class="sa"><input id="sainput" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="Type your answer"><button class="btn primary" type="submit">Submit</button></div></form>`;
      const inp = $("#sainput"); inp.value = prev; if (!("ontouchstart" in self) || q.kind === "T") inp.focus({ preventScroll: true });
      $("#saform").onsubmit = (e) => { e.preventDefault(); finish(inp.value, "answer"); };
    }
    return;
  }
  if (c.phase === "result") {
    const e = G.log[c.logIx];
    const cls = c.ok ? "ok" : c.reason === "time" ? "skip" : "no";
    const verdict = c.ok ? "Correct" : c.reason === "time" ? "Time's up" : "Not quite";
    const said = c.reason === "time" ? "" : `<div class="ans"><b>You said</b>${esc(q.format === "mc" ? `${c.given}) ${q.ch[L.indexOf(c.given)]}` : c.given || "(blank)")}</div>`;
    const speed = q.kind === "T" && c.bp != null ? `<div class="small muted">${c.interrupt ? `Buzzed at ${Math.round(100 * c.bp)}% of the question` : `Buzzed ${(c.rt / 1000).toFixed(1)} s after the reading ended`}</div>` : "";
    const last = G.i + 1 >= G.list.length;
    box.innerHTML = `<div class="result ${cls}">
      <div class="row between"><span class="verdict">${verdict}</span><span class="score">${e.pts > 0 ? "+" : ""}${e.pts} pts</span></div>
      ${said}<div class="ans"><b>Answer</b>${esc(answerText(q))}</div>${speed}
      <div class="row between wrap-gap">
        <span>${q.format === "sa" && c.reason !== "time" ? `<button class="btn ghost small" id="ovr">${c.ok ? "Actually, mark it wrong" : "I was right"}</button>` : ""}</span>
        <button class="btn primary" id="next">${last ? "See results" : "Next question"}</button>
      </div></div>`;
    const o = $("#ovr"); if (o) o.onclick = () => override(!c.ok);
    $("#next").onclick = () => nextQ();
    $("#next").focus({ preventScroll: true });
  }
}
document.addEventListener("keydown", (e) => {
  if (view !== "play" || !G || !G.cur) return;
  const c = G.cur, typing = document.activeElement && document.activeElement.tagName === "INPUT";
  if (e.code === "Space" && !typing && c.q.kind === "T" && (c.phase === "reading" || c.phase === "window")) { e.preventDefault(); buzz(); return; }
  if (!typing && c.q.format === "mc" && (c.phase === "answering" || (c.q.kind === "B" && c.phase === "reading"))) {
    const k = e.key.toUpperCase(); if (L.includes(k)) { e.preventDefault(); finish(k, "answer"); return; }
  }
  if (e.key === "Enter" && c.phase === "result" && document.activeElement && document.activeElement.id !== "ovr") { e.preventDefault(); nextQ(); }
});

/* ================= SUMMARY ================= */
function endRound() {
  stopAll();
  if (G && G.log.length) {
    const log = G.log, tossBuzz = log.filter((x) => x.bp != null);
    prog.attempts.push(...log);
    if (prog.attempts.length > 20000) prog.attempts = prog.attempts.slice(-20000);
    prog.sessions.push({ t: Date.now(), label: G.opts.label || "", n: log.length, c: log.filter((x) => x.ok).length, pts: G.pts,
      bp: tossBuzz.length ? tossBuzz.reduce((a, x) => a + x.bp, 0) / tossBuzz.length : null, int: log.filter((x) => x.int).length });
    saveProgress(); view = "summary";
  } else view = "setup";
  render();
}
function summaryHTML() {
  const log = G.log, n = log.length, ok = log.filter((x) => x.ok).length;
  const tb = log.filter((x) => x.bp != null);
  const missed = log.filter((x) => !x.ok).map((x) => Q.get(x.id)).filter(Boolean);
  const cats = [...new Set(log.map((x) => x.cat))];
  return `<div class="stack">
    <div><div class="eyebrow">Round complete</div><h2>${ok} of ${n} correct · ${G.pts} points</h2></div>
    <div class="stats">
      <div class="stat"><div class="v">${pct(ok, n)}%</div><div class="k">accuracy</div></div>
      <div class="stat"><div class="v">${tb.length ? Math.round((100 * tb.reduce((a, x) => a + x.bp, 0)) / tb.length) + "%" : "–"}</div><div class="k">avg. buzz point</div></div>
      <div class="stat"><div class="v">${log.filter((x) => x.int).length}</div><div class="k">interrupts</div></div>
    </div>
    <div class="panel stack"><h3>By category</h3><div class="bars">${cats.map((k) => { const r = log.filter((x) => x.cat === k); return bar(k, r.filter((x) => x.ok).length, r.length); }).join("")}</div></div>
    <div class="panel stack"><h3>Missed this round</h3>${missed.length ? `<div class="list">${missed.map((q) => qItem(q, true)).join("")}</div>` : `<div class="empty">Nothing missed. Nice work.</div>`}</div>
    <div class="row">${missed.length ? `<button class="btn go" id="redo">Retry the ${missed.length} missed</button>` : ""}<button class="btn primary" id="again">New round</button><button class="btn" id="toProg">See progress</button></div>
  </div>`;
}
function bindSummary() {
  const r = $("#redo"); if (r) r.onclick = () => { speech.unlock(); const ids = new Set(G.log.filter((x) => !x.ok).map((x) => x.id)); startRound([...ids].map((id) => Q.get(id)).filter(Boolean), { label: "Retry missed" }); };
  $("#again").onclick = () => go("practice");
  $("#toProg").onclick = () => go("progress");
}
function bar(k, ok, n, right) {
  const p = pct(ok, n);
  return `<div class="bar-row"><span class="name">${catDot(k)}${esc(CAT[k] || k)}</span><div class="track"><div class="c-${k}" style="width:${p}%"></div></div><span class="pct">${right || `<b>${p}%</b> ${ok}/${n}`}</span></div>`;
}
function qItem(q, showAns) {
  const s = prog.qstats[q.id];
  return `<div class="item"><i class="dot c-${q.cat}" style="margin-top:8px"></i><div class="body">
    <div class="q"><span class="muted small">${q.kind === "B" ? "Bonus" : "Toss-up"} ${q.num} · ${esc(q.round)}</span><br>${esc(q.q)}${q.format === "mc" ? `<span class="muted"> ${q.ch.map((c, i) => `${L[i]}) ${esc(c)}`).join("  ")}</span>` : ""}</div>
    ${showAns ? `<div class="a">Answer: ${esc(answerText(q))}</div>` : `<details><summary>Show answer</summary><div class="a">${esc(answerText(q))}</div></details>`}
  </div>${s ? `<span class="pill ${s.last ? "good" : "bad"}">${s.c}/${s.n}</span>` : ""}</div>`;
}

/* ================= PROGRESS ================= */
function totals() {
  let seen = 0, ok = 0; Object.values(prog.qstats).forEach((s) => { seen += s.n; ok += s.c; });
  const recent = prog.attempts.filter((a) => a.bp != null).slice(-200);
  return { seen, ok, bp: recent.length ? Math.round((100 * recent.reduce((a, x) => a + x.bp, 0)) / recent.length) : null };
}
function lineChart(points, opts) {
  if (points.length < 2) return `<div class="empty">${opts.empty}</div>`;
  const W = 640, H = 210, pl = 44, pr = 16, pt = 14, pb = 28, iw = W - pl - pr, ih = H - pt - pb;
  const x = (i) => pl + (i * iw) / (points.length - 1), y = (v) => pt + ih * (1 - v);
  const pts = points.map((p, i) => [x(i), y(p.v)]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${pl - 8}" y="${y(v) + 4}" text-anchor="end" class="axis">${v * 100}%</text>`).join("");
  const lab = points.map((p, i) => (i === 0 || i === points.length - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="${i ? "end" : "start"}" class="axis">${p.label}</text>` : "")).join("");
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria)}">${grid}
    <path d="${line} L ${last[0]} ${y(0)} L ${pts[0][0]} ${y(0)} Z" fill="${opts.color}" opacity=".12"/>
    <path d="${line}" fill="none" stroke="${opts.color}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="5.5" fill="var(--surface)" stroke="${opts.color}" stroke-width="2.5"/>
    <text x="${Math.min(last[0], W - pr)}" y="${last[1] - 12}" text-anchor="end" class="axis strong">${Math.round(points[points.length - 1].v * 100)}%</text>${lab}</svg>`;
}
function progressHTML() {
  const t = totals();
  if (!t.seen) return `<div class="stack"><div><div class="eyebrow">Progress</div><h2>Nothing tracked yet</h2></div><div class="empty">Play a round and accuracy and buzz speed by category will show up here.</div></div>`;
  const A = prog.attempts;
  const cats = Object.keys(CAT).filter((k) => A.some((a) => a.cat === k));
  const rows = cats.map((k) => {
    const all = A.filter((a) => a.cat === k), ok = all.filter((a) => a.ok).length;
    const tb = all.filter((a) => a.bp != null);
    const early = tb.filter((a) => a.int), earlyOk = early.filter((a) => a.ok).length;
    const rts = tb.filter((a) => !a.int && a.rt != null);
    return { k, n: all.length, ok, bp: tb.length ? tb.reduce((s, a) => s + a.bp, 0) / tb.length : null, rt: rts.length ? rts.reduce((s, a) => s + a.rt, 0) / rts.length : null, early: early.length, earlyOk };
  });
  const weakest = rows.filter((r) => r.n >= 5).sort((a, b) => a.ok / a.n - b.ok / b.n)[0];
  const ss = prog.sessions.slice(-20);
  const fmtD = (ts) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const accPts = ss.map((s) => ({ v: s.c / s.n, label: fmtD(s.t) }));
  const bpPts = ss.filter((s) => s.bp != null).map((s) => ({ v: s.bp, label: fmtD(s.t) }));
  const missedN = Object.values(prog.qstats).filter((s) => s.last === 0).length;
  return `<div class="stack">
    <div><div class="eyebrow">Progress</div><h2>How practice is going</h2></div>
    <div class="stats">
      <div class="stat"><div class="v">${pct(t.ok, t.seen)}%</div><div class="k">overall accuracy</div></div>
      <div class="stat"><div class="v">${t.bp != null ? t.bp + "%" : "–"}</div><div class="k">avg. buzz point, recent toss-ups</div></div>
      <div class="stat"><div class="v">${prog.sessions.length}</div><div class="k">rounds played</div></div>
    </div>
    ${weakest ? `<div class="panel row between"><div><div class="eyebrow">Next focus</div><div class="lead">${esc(CAT[weakest.k])} is lowest at ${pct(weakest.ok, weakest.n)}%.</div></div><button class="btn primary" id="focus" data-k="${weakest.k}">Practice ${esc(CAT[weakest.k])}</button></div>` : ""}
    <div class="panel stack"><h3>Accuracy by category</h3><div class="bars">${rows.map((r) => bar(r.k, r.ok, r.n)).join("")}</div></div>
    <div class="panel stack"><div><h3>Buzz speed by category</h3><p class="small muted">Buzz point is how much of the toss-up was read when he buzzed. Reaction is the time to buzz after the reading ended.</p></div>
      <div class="table-wrap"><table><thead><tr><th>Category</th><th>Buzz point</th><th>Reaction</th><th>Early right</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${catDot(r.k)}${esc(CAT[r.k])}</td><td>${r.bp != null ? Math.round(r.bp * 100) + "%" : "–"}</td><td>${r.rt != null ? (r.rt / 1000).toFixed(1) + " s" : "–"}</td><td>${r.early ? `${r.earlyOk}/${r.early}` : "–"}</td></tr>`).join("")}
      </tbody></table></div></div>
    <div class="panel stack"><div class="row between"><h3>Accuracy by round</h3><span class="small muted">last ${ss.length}</span></div><div class="chart">${lineChart(accPts, { color: "var(--lab)", aria: "Accuracy over recent rounds", empty: "Play two rounds to see a trend." })}</div></div>
    <div class="panel stack"><div class="row between"><h3>Buzz point by round</h3><span class="small muted">lower is faster</span></div><div class="chart">${lineChart(bpPts, { color: "var(--accent)", aria: "Average buzz point over recent rounds", empty: "Play two rounds with toss-ups to see a trend." })}</div></div>
    <div class="panel stack"><div class="row between"><h3>Missed last time (${missedN})</h3>${missedN ? `<button class="btn go" id="redoMissed">Practice these</button>` : ""}</div>
      ${missedN ? `<div class="list">${Object.entries(prog.qstats).filter(([, s]) => s.last === 0).sort((a, b) => b[1].t - a[1].t).slice(0, 12).map(([id]) => Q.get(id)).filter(Boolean).map((q) => qItem(q, false)).join("")}</div>` : `<div class="empty">No missed questions waiting.</div>`}</div>
    <div class="panel stack"><h3>Backup</h3><p class="small muted">Progress lives on this device. Save a backup file now and then, and restore it if you switch devices.</p>
      <div class="row"><button class="btn" id="exp">Save backup file</button><label class="btn">Restore from backup<input type="file" id="imp" accept="application/json,.json" hidden></label>
      <button class="btn ghost small" id="reset">Reset progress</button></div><span class="small muted" id="resetNote"></span></div>
  </div>`;
}
function bindProgress() {
  const f = $("#focus"); if (f) f.onclick = () => { Object.assign(prog.settings, { mode: "mix", cats: [f.dataset.k], focus: "all" }); saveProgress(); go("practice"); };
  const r = $("#redoMissed"); if (r) r.onclick = () => { speech.unlock(); startRound(Object.entries(prog.qstats).filter(([, s]) => s.last === 0).map(([id]) => Q.get(id)).filter(Boolean), { label: "Missed questions" }); };
  const ex = $("#exp"); if (ex) ex.onclick = () => {
    const blob = new Blob([JSON.stringify({ app: "buzzer-lab", v: 1, savedAt: new Date().toISOString(), progress: prog })], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `buzzer-lab-backup-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove();
  };
  const im = $("#imp"); if (im) im.onchange = async () => {
    try { const d = JSON.parse(await im.files[0].text()); if (d.app !== "buzzer-lab") throw 0; prog = { ...prog, ...d.progress, settings: { ...DEFAULT_SETTINGS, ...(d.progress.settings || {}) } }; saveProgress(); toast("Backup restored"); render(); }
    catch (e) { toast("That file isn't a Buzzer Lab backup."); }
  };
  const rs = $("#reset"); let armed = false;
  if (rs) rs.onclick = () => {
    if (!armed) { armed = true; rs.textContent = "Tap again to erase all progress"; rs.classList.add("danger"); $("#resetNote").textContent = "Imported rounds are kept."; return; }
    prog.qstats = {}; prog.attempts = []; prog.sessions = []; saveProgress(); toast("Progress reset"); render();
  };
}

/* ================= ROUNDS (import) ================= */
let pendingEntry = null, importLevel = "MS", openSet = null;
const srcOf = (r) => `${r[0]}-S${r[1]}-R${r[3]}`;
const labelOf = (r) => `${r[0] === "MS" ? "Middle school" : "High school"} · Set ${r[1]} (${r[2]}) · Round ${r[3]}`;
function roundsHTML() {
  const have = new Map(rounds.map((r) => [r.source, r]));
  const sets = {};
  NSB_CATALOG.forEach((r) => { const k = r[0] + "-" + r[1]; (sets[k] = sets[k] || { lv: r[0], set: r[1], year: r[2], rows: [] }).rows.push(r); });
  const setList = (lv) => Object.values(sets).filter((s) => s.lv === lv).sort((a, b) => b.year - a.year || b.set - a.set).map((s) => {
    const got = s.rows.filter((r) => have.has(srcOf(r))).length, key = s.lv + "-" + s.set;
    return `<details class="set" data-set="${key}" ${openSet === key ? "open" : ""}><summary><span><b>Set ${s.set}</b> <span class="muted">· ${s.year}</span></span><span class="pill ${got ? "good" : ""}">${got}/${s.rows.length} added</span></summary>
      <div class="rlist">${s.rows.map((r) => { const h = have.get(srcOf(r)); return `<div class="rrow"><span>Round ${r[3]}</span>${h ? `<span class="pill good">${h.count} questions</span>` : `${prog.directBlocked ? "" : `<button class="btn small" data-add="${srcOf(r)}">Add</button>`}<a class="btn small ${prog.directBlocked ? "" : "ghost"}" href="${r[4]}" target="_blank" rel="noopener" data-open="${srcOf(r)}">Open PDF</a>`}</div>`; }).join("")}</div></details>`;
  }).join("");
  const mine = rounds.slice().sort((a, b) => b.added - a.added);
  return `<div class="stack">
    <div><div class="eyebrow">Rounds</div><h2>Official DOE question sets</h2>
      <p class="small muted maxw">These are the sample rounds the Department of Energy posts on <a href="https://science.osti.gov/wdts/nsb/Regional-Competitions/Resources" target="_blank" rel="noopener">science.osti.gov</a>. Questions are read from the PDFs on this device.</p></div>
    <div class="panel stack">
      <div class="row between"><h3>Import PDFs you've saved</h3>
        <div class="chips">${chip("ilv", "MS", "Middle school", importLevel === "MS")}${chip("ilv", "HS", "High school", importLevel === "HS")}</div></div>
      <p class="small muted">${prog.directBlocked ? "DOE's site doesn't allow direct downloads into the app on this device. Tap <b>Open PDF</b> on a round, save or download it, then import it here. You can pick many files at once." : "Tap <b>Add</b> on a round below. If that doesn't work, use <b>Open PDF</b>, save the file, and import it here."}</p>
      <div class="row"><label class="btn go">Import PDFs<input type="file" id="pdfIn" accept="application/pdf,.pdf" multiple hidden></label><span class="small muted" id="impStatus" aria-live="polite"></span></div>
      <details><summary class="small">Paste the text of a round instead</summary>
        <div class="stack tight" style="margin-top:10px"><textarea id="pasteIn" rows="6" placeholder="Copy everything from a round PDF and paste it here"></textarea><div class="row"><button class="btn" id="pasteGo">Add pasted round</button></div></div></details>
    </div>
    ${mine.length ? `<div class="panel stack"><div><h3>Share these rounds with every device</h3>
      <p class="small muted maxw">Save all ${mine.length} round${mine.length === 1 ? "" : "s"} as one file named <b>questions.json</b>, then upload it to your GitHub repository next to index.html. Every phone, tablet, or computer that opens your link will then load them automatically. Export and upload again whenever you add rounds.</p></div>
      <div><button class="btn primary" id="expBank">Export question bank</button></div></div>` : ""}
    ${mine.length ? `<div class="panel stack"><h3>Added (${mine.length} round${mine.length === 1 ? "" : "s"} · ${Q.size} questions)</h3><div class="list">${mine.map((r) => `<div class="item"><div class="body"><div class="q">${esc(r.label)}</div><div class="a">${r.count} questions${r.problems ? ` · ${r.problems} couldn't be read` : ""}</div></div><button class="btn ghost small" data-rm="${esc(r.source)}">Remove</button></div>`).join("")}</div></div>` : ""}
    <div class="panel stack"><h3>Middle school</h3>${setList("MS")}</div>
    <div class="panel stack"><h3>High school</h3>${setList("HS")}</div>
  </div>`;
}
function bindRounds() {
  $$("details.set").forEach((d) => d.addEventListener("toggle", () => { if (d.open) openSet = d.dataset.set; }));
  $$("input[name=ilv]").forEach((i) => (i.onchange = () => (importLevel = i.value)));
  $("#pdfIn").onchange = async (e) => { const files = [...e.target.files]; e.target.value = ""; await importFiles(files); };
  const eb = $("#expBank"); if (eb) eb.onclick = () => { const n = exportBank(); toast(`Saved questions.json with ${n} round${n === 1 ? "" : "s"}`); };
  $("#pasteGo").onclick = async () => {
    const txt = $("#pasteIn").value; if (!txt.trim()) return;
    const src = "paste-" + hash(txt.slice(0, 2000));
    await addRound(txt, { source: src, label: `Pasted round (${new Date().toLocaleDateString()})`, level: importLevel });
  };
  $$("[data-add]").forEach((b) => (b.onclick = () => directAdd(b.dataset.add, b)));
  $$("[data-open]").forEach((a) => (a.onclick = () => { pendingEntry = NSB_CATALOG.find((r) => srcOf(r) === a.dataset.open); importLevel = pendingEntry[0]; }));
  $$("[data-rm]").forEach((b) => (b.onclick = async () => {
    const s = b.dataset.rm; await idb.del("round:" + s);
    rounds = rounds.filter((r) => r.source !== s); await idb.set("rounds", rounds);
    [...Q.keys()].forEach((id) => { if (Q.get(id).source === s) Q.delete(id); });
    toast("Round removed"); render();
  }));
}
let pdfjsReady = null;
function loadPdfJs() {
  if (!pdfjsReady) pdfjsReady = new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = PDFJS;
    s.onload = () => { self.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; res(self.pdfjsLib); };
    s.onerror = () => { pdfjsReady = null; rej(new Error("The PDF reader couldn't load. Connect to the internet once and try again.")); };
    document.head.appendChild(s);
  });
  return pdfjsReady;
}
const SUP = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "+": "⁺", "-": "⁻", "−": "⁻", "–": "⁻", n: "ⁿ" };
async function pdfText(buf) {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
  let out = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p), tc = await page.getTextContent();
    let lastY = null, lastEnd = null, lineSize = null;
    for (const it of tc.items) {
      if (!("str" in it) || !it.str) continue;
      const x = it.transform[4], y = it.transform[5], size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      const raw = it.str.trim();
      // exponents (11², 10⁶) are printed smaller and raised: keep them as superscripts
      if (lastY !== null && lineSize && size < 0.8 * lineSize && y > lastY + 0.3 && y - lastY < lineSize && /^[0-9n+\-−–]{1,3}$/.test(raw)) {
        out += [...raw].map((ch) => SUP[ch] || ch).join(""); lastEnd = x + (it.width || 0); continue;
      }
      if (lastY !== null && Math.abs(y - lastY) > 0.6 * Math.max(size, lineSize || size)) { out += "\n"; lastEnd = null; lineSize = null; }
      else if (lastEnd !== null && x - lastEnd > 1 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += " ";
      out += it.str;
      if (it.hasEOL) { out += "\n"; lastY = null; lastEnd = null; lineSize = null; }
      else { lastY = y; lastEnd = x + (it.width || 0); lineSize = Math.max(lineSize || 0, raw ? size : 0) || null; }
    }
    out += "\n";
  }
  return out;
}
async function addRound(text, meta) {
  const { questions, problems } = P.parseRound(text, meta);
  if (questions.length < 4) throw new Error(`Couldn't find Science Bowl questions in ${meta.fileName || "that text"}.`);
  questions.forEach((q) => { q.level = meta.level; q.round = meta.label; });
  await idb.set("round:" + meta.source, questions);
  rounds = rounds.filter((r) => r.source !== meta.source);
  rounds.push({ source: meta.source, label: meta.label, level: meta.level, count: questions.length, problems: problems.length, added: Date.now() });
  await idb.set("rounds", rounds);
  [...Q.keys()].forEach((id) => { if (Q.get(id).source === meta.source) Q.delete(id); });
  questions.forEach((q) => Q.set(q.id, q));
  if (view === "rounds") render();
  return questions.length;
}
function metaForFile(name, text) {
  const lower = name.toLowerCase();
  let entry = null;
  if (pendingEntry && pendingEntry[4].toLowerCase().endsWith("/" + lower)) entry = pendingEntry;
  if (!entry) {
    const lv = /middle\s+school/i.test(text) ? "MS" : /high\s+school/i.test(text) ? "HS" : importLevel;
    const hits = NSB_CATALOG.filter((r) => r[4].toLowerCase().endsWith("/" + lower) && r[0] === lv);
    if (hits.length === 1) entry = hits[0];
  }
  if (entry) return { source: srcOf(entry), label: labelOf(entry), level: entry[0], fileName: name };
  const lv = /middle\s+school/i.test(text) ? "MS" : /high\s+school/i.test(text) ? "HS" : importLevel;
  return { source: "file-" + hash(text.slice(0, 4000)), label: `${lv === "MS" ? "Middle school" : "High school"} · ${name.replace(/\.pdf$/i, "")}`, level: lv, fileName: name };
}
async function importFiles(files) {
  const st = $("#impStatus"); let added = 0, qn = 0; const errs = [];
  for (const [i, f] of files.entries()) {
    if (st) st.textContent = `Reading ${i + 1} of ${files.length}: ${f.name}`;
    try { const text = await pdfText(await f.arrayBuffer()); qn += await addRound(text, metaForFile(f.name, text)); added++; }
    catch (e) { errs.push(e.message || `${f.name} couldn't be read.`); }
  }
  pendingEntry = null;
  if (view === "rounds") render();
  const s2 = $("#impStatus"); if (s2) s2.textContent = errs.length ? errs.join(" ") : "";
  if (added) toast(`Added ${added} round${added > 1 ? "s" : ""} · ${qn} questions`);
}
async function directAdd(src, btn) {
  const r = NSB_CATALOG.find((x) => srcOf(x) === src); if (!r) return;
  btn.disabled = true; btn.textContent = "Adding…";
  try {
    const res = await fetch(r[4], { mode: "cors" }); if (!res.ok) throw new Error("http");
    const text = await pdfText(await res.arrayBuffer());
    const n = await addRound(text, { source: src, label: labelOf(r), level: r[0] });
    toast(`Added ${n} questions`);
  } catch (e) {
    if (e && /PDF reader|Science Bowl questions/.test(e.message)) { toast(e.message); btn.disabled = false; btn.textContent = "Add"; return; }
    prog.directBlocked = true; saveProgress(); openSet = r[0] + "-" + r[1]; render();
    toast("DOE's site blocks direct downloads. Use Open PDF, then Import PDFs.");
  }
}

/* ================= boot ================= */
$$("nav.tabs button").forEach((b) => (b.onclick = () => { if (view === "play" && G && G.log.length) endRound(); go(b.dataset.tab); }));
speech.loadVoices();
loadAll().then(render).catch(() => { $("#app").innerHTML = `<div class="empty">This browser won't let the app store data. Turn off private browsing and reopen it.</div>`; });
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
