/* Parses the text of an official National Science Bowl round (DOE sample PDFs) into questions.
   Works with both the older layout ("TOSS-UP 1) LIFE SCIENCE Multiple Choice ...")
   and the newer one ("TOSS-UP\n1) Biology — Multiple Choice ..."). */
(function (root) {
  const CATEGORY_MAP = [
    [/^(life\s*science|biology|life)$/, "life"],
    [/^physical\s*science$/, "physical"],
    [/^chemistry$/, "chem"],
    [/^physics$/, "physics"],
    [/^(earth\s*(and|&)\s*space(\s*science)?|earth\s*science|astronomy|earth\s*and\s*space\s*science)$/, "earth"],
    [/^energy$/, "energy"],
    [/^(math|mathematics)$/, "math"],
    [/^general\s*science$/, "general"],
    [/^earth\b/, "earth"],
  ];
  const CATEGORY_NAMES = {
    life: "Life Science", physical: "Physical Science", chem: "Chemistry", physics: "Physics",
    earth: "Earth & Space", energy: "Energy", math: "Math", general: "General Science", other: "Other",
  };

  function categoryKey(raw) {
    const s = String(raw || "").toLowerCase().replace(/[^a-z& ]/g, " ").replace(/\s+/g, " ").trim();
    for (const [re, key] of CATEGORY_MAP) if (re.test(s)) return key;
    const w = s.split(" ");
    for (const n of [4, 3, 2, 1]) {   // e.g. "MATH Math" or "Earth and Space Science extra"
      const head = w.slice(0, n).join(" ");
      for (const [re, key] of CATEGORY_MAP) if (re.test(head)) return key;
    }
    return "other";
  }

  const JUNK_LINE = [
    /^\s*page\s+\d+(\s+of\s+\d+)?\s*$/i,
    /\bpage\s+\d+\s*$/i,
    /^\s*round\s+[\w-]+\s*$/i,
    /^\s*[~_=\-*]{3,}\s*$/,
    /^\s*\d{4}\s+(regional|national).*$/i,
    /^\s*(high|middle)\s+school\s+(regional|national).*$/i,
    /^\s*national\s+science\s+bowl.*$/i,
  ];

  function clean(text) {
    return String(text)
      .replace(/\r/g, "\n")
      .replace(/ /g, " ")
      .replace(/[ﬁ]/g, "fi").replace(/[ﬂ]/g, "fl")
      .split("\n")
      .filter((line) => !JUNK_LINE.some((re) => re.test(line)))
      .join("\n");
  }

  const squash = (s) => s.replace(/\s+/g, " ").trim();
  const forSpeech = (s) => squash(String(s).replace(/\s*\[[^\]]*\]/g, ""));

  function splitRejects(answer) {
    const out = [];
    String(answer).replace(/(?:DO\s+NOT|DON'T)\s+ACCEPT\s*:?\s*([^)]*)/gi, (_, list) => { out.push(...list.split(/[;,]|\bOR\b/i)); return ""; });
    return out.map(squash).filter(Boolean);
  }
  function splitAccepts(answer) {
    // "RNA POLYMERASE (ACCEPT: RNAP; do not accept: RNA polymerase II)"
    let main = answer, accepts = [];
    main = main.replace(/\(\s*(?:DO\s+NOT|DON'T)\s+ACCEPT[^)]*\)/gi, "");
    main = main.replace(/\(\s*ACCEPT\s*:?\s*([^)]*)\)/gi, (_, list) => {
      const keep = list.split(/;\s*(?:do\s+not|don't)\s+accept.*$/i)[0];
      accepts.push(...keep.split(/[;,]|\bOR\b/i));
      return " ";
    });
    main = main.replace(/\bDO\s+NOT\s+ACCEPT\b.*$/i, "");
    main = main.replace(/\[[^\]]*\]/g, " ");
    const mains = main.split(/\s+OR\s+|\s*;\s*/i);
    return mains.concat(accepts).map(squash).map((s) => s.replace(/^[\s,.:]+|[\s,.:]+$/g, "")).filter(Boolean);
  }

  function parseRound(rawText, meta) {
    meta = meta || {};
    const text = clean(rawText);
    const marker = /\b(TOSS[\s-]*UP|BONUS)\b\s*(\d{1,2})\s*[).]\s*/gi;
    const hits = [];
    let m;
    while ((m = marker.exec(text))) hits.push({ kind: /^B/i.test(m[1]) ? "B" : "T", num: +m[2], start: m.index, bodyStart: marker.lastIndex });
    const out = [], problems = [];
    hits.forEach((h, i) => {
      const body = text.slice(h.bodyStart, i + 1 < hits.length ? hits[i + 1].start : text.length);
      const q = parseOne(body, h, meta);
      if (q) out.push(q); else problems.push(`${h.kind === "B" ? "Bonus" : "Toss-up"} ${h.num}`);
    });
    // drop duplicates (some PDFs repeat a question on a page break)
    const seen = new Set();
    const questions = out.filter((q) => (seen.has(q.id) ? false : (seen.add(q.id), true)));
    return { questions, problems };
  }

  function parseOne(body, h, meta) {
    // "ANSWER:", "ANSWER W)", "ANWER:", "Answer:" (but not the "Short Answer" label)
    let ansIdx = -1, ansLen = 0;
    const ar = /\b(?:ANS?WER\b\s*:?|Ans?wer\s*:)\s*/g;
    let am;
    while ((am = ar.exec(body))) {
      if (/short\s*$/i.test(body.slice(Math.max(0, am.index - 7), am.index))) continue;
      ansIdx = am.index; ansLen = am[0].length; break;
    }
    if (ansIdx < 0) return null;
    let head = body.slice(0, ansIdx);
    let rest = body.slice(ansIdx + ansLen);
    // stop at a following question that lost its TOSS-UP/BONUS label, or at end-of-round moderator script
    const stop = rest.search(/\n\s*\d{1,2}\)\s+[A-Z]|\bBefore we leave\b|\bEND OF ROUND\b|\bTIE[\s-]?BREAKER\b/i);
    if (stop >= 0) rest = rest.slice(0, stop);
    let answer = squash(rest);
    if (!answer) return null;

    const fm = head.match(/^\s*([A-Za-z&,\s]*?)\s*[—–\-:]*\s*(Multiple[\s-]*Choice|Short[\s-]*Answer)\s*[:.\-—]?\s*/i);
    let catRaw = "", format = "sa";
    if (fm) { catRaw = fm[1]; format = /^m/i.test(fm[2]) ? "mc" : "sa"; head = head.slice(fm[0].length); }
    else {
      const dm = head.match(/^\s*([A-Za-z& ]{3,40}?)\s*[\u2014\u2013\-:]\s+/);
      const cm = head.match(/^\s*([A-Z][A-Z &]+?)\s{1,}(?=[A-Z][a-z])/);
      if (dm && categoryKey(dm[1]) !== "other") { catRaw = dm[1]; head = head.slice(dm[0].length); }
      else if (cm) { catRaw = cm[1]; head = head.slice(cm[0].length); }
    }
    const cat = categoryKey(catRaw);

    let stem = head, choices = null, letter = null;
    const labeledMC = format === "mc";
    if (labeledMC || /^\(?[WXYZ]\)/.test(answer)) {
      const pos = [];
      const re = /(^|[\s(])([WXYZ])\)\s+/g;
      let c;
      while ((c = re.exec(head))) pos.push({ L: c[2], at: c.index + c[1].length, end: re.lastIndex });
      const seq = [];
      for (const L of ["W", "X", "Y", "Z"]) {
        const p = pos.find((x) => x.L === L && (!seq.length || x.at > seq[seq.length - 1].at));
        if (p) seq.push(p);
      }
      if (seq.length < 4) {
        // choices printed out of order (e.g. W, Y, X, Z): accept when each letter appears exactly once
        const tail = pos.slice(-4);
        if (pos.length >= 4 && new Set(tail.map((p) => p.L)).size === 4) {
          const texts = {};
          tail.forEach((p, i) => (texts[p.L] = squash(head.slice(p.end, i < 3 ? tail[i + 1].at : head.length))));
          stem = head.slice(0, tail[0].at);
          choices = ["W", "X", "Y", "Z"].map((L) => texts[L]);
          seq.length = 0;
        }
      }
      if (seq.length === 4) {
        stem = head.slice(0, seq[0].at);
        choices = seq.map((p, i) => squash(head.slice(p.end, i < 3 ? seq[i + 1].at : head.length)));
      }
      if (choices) {
        const lm = answer.match(/^\(?([WXYZ])\b/);
        letter = lm ? lm[1] : null;
        if (!letter) {
          const hit = choices.findIndex((ch) => squash(answer).toLowerCase().includes(ch.toLowerCase()) && ch.length > 2);
          if (hit >= 0) letter = "WXYZ"[hit];
        }
      }
      if (choices && choices.some((x) => !x || x.length > 300)) choices = null;   // garbled layout (e.g. stacked fractions)
      if (choices && letter) format = "mc";
      else if (/^\(?[WXYZ]\)/.test(answer)) return null;          // a choice question we can't show properly
      else { choices = null; format = "sa"; }
    }
    stem = squash(stem);
    if (!stem) return null;
    const id = `${meta.source || "import"}-${h.kind}${h.num}`;
    return {
      id, source: meta.source || "import", level: meta.level || "MS", round: meta.label || "",
      kind: h.kind, num: h.num, cat, catLabel: squash(catRaw), format,
      q: stem, ch: choices, a: format === "mc" ? letter : answer,
      display: answer, acc: format === "mc" ? [] : splitAccepts(answer),
      rej: format === "mc" ? [] : splitRejects(answer),
    };
  }

  // ---- answer checking for short-answer questions ----
  function norm(s) {
    return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/π/g, "pi").replace(/[−–—]/g, "-")
      .replace(/[^a-z0-9./\- ]/g, " ").replace(/\b(the|a|an)\b/g, " ")
      .replace(/\s+/g, " ").trim();
  }
  function toNum(s) {
    s = s.replace(/\s|,/g, "");
    if (/^-?\d*\.?\d+$/.test(s)) return parseFloat(s);
    const f = s.match(/^(-?\d+)\/(\d+)$/);
    return f ? +f[1] / +f[2] : NaN;
  }
  function checkShort(q, input) {
    const n = norm(input);
    if (!n) return false;
    if ((q.rej || []).map(norm).includes(n)) return false;
    const accs = (q.acc && q.acc.length ? q.acc : [q.a]).map(norm).filter(Boolean);
    for (const a of accs) {
      if (n === a) return true;
      const x = toNum(n), y = toNum(a.split(" ")[0]);
      if (!isNaN(x) && !isNaN(y) && Math.abs(x - y) < 1e-9 && (a.split(" ").length === 1 || /^[\d./-]+ [a-z ]+$/.test(a))) return true;
      if (a.length >= 4 && (" " + n + " ").includes(" " + a + " ")) return true;
    }
    return false;
  }

  const api = { splitRejects, parseRound, categoryKey, CATEGORY_NAMES, checkShort, forSpeech, splitAccepts };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.NSBParser = api;
})(typeof self !== "undefined" ? self : globalThis);
