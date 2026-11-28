// Interface languages. Same file in FileCompressor and PdfEditor.
//   locales/en.txt   "n|English text"      locales/<code>.txt   "n|translation" (same numbers)
// T("English {0}", value) gives the text in the chosen language; texts written straight into the page
// (index.html, pieces of HTML built in code, messages from the engine) are translated as they appear.
// The language comes from the program (Desktop.lang(), set by the installer or the flag button).

export const LANGS = [
  ["ceb", "Bisaya (Cebuano)"], ["bs", "Bosanski"], ["cs", "Čeština"], ["cnr", "Crnogorski"], ["de", "Deutsch"], ["et", "Eesti"],
  ["en", "English"], ["es-ES", "Español (España)"], ["es-419", "Español (Latinoamérica)"], ["fr", "Français"], ["hr", "Hrvatski"],
  ["it", "Italiano"], ["pl", "Polski"], ["pt-BR", "Português (Brasil)"], ["pt-PT", "Português (Portugal)"], ["fi", "Suomi"],
  ["tl", "Tagalog"], ["el", "Ελληνικά"], ["bg", "Български"], ["ru", "Русский"], ["sr", "Српски"],
];
const CODES = LANGS.map(l => l[0]);

function pickLang() {
  let c = "";
  try { c = (window.Desktop && window.Desktop.lang && window.Desktop.lang()) || ""; } catch (_) { /* */ }
  if (!c) try { c = localStorage.getItem("ui.lang") || ""; } catch (_) { /* */ }
  if (!c && !window.Desktop) {
    // phone, never chosen: the phone's language when the app has it
    const n = String(navigator.language || "en").toLowerCase();
    const b = n.split("-")[0];
    c = n === "pt-br" ? "pt-BR" : b === "pt" ? "pt-PT" : n === "es-es" ? "es-ES" : b === "es" ? "es-419" : b === "fil" ? "tl" : b === "sh" ? "hr" : b;
  }
  return CODES.includes(c) ? c : "en";
}
export const LANG = pickLang();

function parse(txt) {
  const m = new Map();
  for (const line of String(txt || "").split(/\r?\n/)) {
    const i = line.indexOf("|");
    if (i > 0 && /^\d+$/.test(line.slice(0, i))) m.set(+line.slice(0, i), line.slice(i + 1).replace(/\\n/g, "\n"));
  }
  return m;
}
async function load(code) {
  try { const r = await fetch(`locales/${code}.txt`); return r.ok ? await r.text() : ""; } catch (_) { return ""; }
}
const DICT = new Map();          // English -> translation
const PATTERNS = [];             // [regex, translation] for texts with {0}...
if (LANG !== "en") {
  const [en, tr] = await Promise.all([load("en"), load(LANG)]);
  const E = parse(en), L = parse(tr);
  for (const [n, eng] of E) {
    const t = L.get(n);
    if (!t || !t.trim()) continue;
    DICT.set(eng, t);
    if (/\{\d+\}/.test(eng)) {
      const rx = "^" + eng.split(/(\{\d+\})/).map(p => /^\{\d+\}$/.test(p) ? "(.+?)" : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("") + "$";
      const order = [...eng.matchAll(/\{(\d+)\}/g)].map(m => +m[1]);
      try { PATTERNS.push([new RegExp(rx, "s"), t, order, eng.replace(/\{\d+\}/g, "").length]); } catch (_) { /* */ }
    }
  }
  PATTERNS.sort((a, b) => b[3] - a[3]);   // the most specific first
}
const fill = (t, args) => t.replace(/\{(\d+)\}/g, (m, i) => (args[+i] !== undefined ? String(args[+i]) : m));

/** The text in the chosen language; values go into {0}, {1}... */
export function T(text, ...args) {
  const s = String(text);
  if (LANG === "en" || !DICT.size) return fill(s, args);
  const core = s.trim();
  const t = DICT.get(core);
  if (t === undefined) return fill(s, args);
  const lead = s.slice(0, s.indexOf(core)), trail = s.slice(s.indexOf(core) + core.length);
  return lead + fill(t, args) + trail;
}

// ------------------------------------------------------------------ texts already in the page
const cache = new Map();
function translateCore(core, depth = 0) {
  if (cache.has(core)) return cache.get(core);
  let out = DICT.get(core);
  if (out === undefined && depth < 2) {
    for (const [rx, t, order] of PATTERNS) {
      const m = rx.exec(core);
      if (!m) continue;
      const vals = [];
      order.forEach((n, k) => { vals[n] = translateCore(m[k + 1].trim(), depth + 1); });
      out = fill(t, vals);
      break;
    }
  }
  if (out === undefined && depth < 1 && /[.!?:]\s+\S/.test(core)) {
    // messages joined from several sentences: translate each one
    const parts = core.split(/(?<=[.!?:])\s+/);
    if (parts.length > 1) {
      let any = false;
      const tr = parts.map(p => { const q = p.replace(/[.!?:]$/, ""); const x = DICT.get(p) ?? DICT.get(q); if (x !== undefined) { any = true; return x + (x === DICT.get(q) && p !== q && !/[.!?:]$/.test(x) ? p.slice(-1) : ""); } return translateCore(p, depth + 1); });
      if (any) out = tr.join(" ");
    }
  }
  if (out === undefined) out = core;
  if (cache.size > 5000) cache.clear();
  cache.set(core, out);
  return out;
}
function translateString(s) {
  const core = s.trim();
  if (!core || !/[A-Za-z]/.test(core)) return s;
  const t = translateCore(core);
  if (t === core) return s;
  const i = s.indexOf(core);
  return s.slice(0, i) + t + s.slice(i + core.length);
}
const ATTRS = ["title", "placeholder", "aria-label", "alt", "data-tip"];
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "PRE"]);
const done = new WeakMap();     // node -> text it was given, so it isn't done twice
function noTr(el) { return el && el.closest && el.closest("[translate=no],.no-tr,[contenteditable=true]"); }
function doText(n) {
  const p = n.parentElement;
  if (!p || SKIP.has(p.tagName) || noTr(p)) return;
  const v = n.nodeValue;
  if (done.get(n) === v) return;
  const t = translateString(v);
  done.set(n, t);
  if (t !== v) n.nodeValue = t;
}
function doEl(el) {
  if (noTr(el)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v) { const t = translateString(v); if (t !== v) el.setAttribute(a, t); }
  }
  if (el.tagName === "INPUT" && (el.type === "button" || el.type === "submit") && el.value) el.value = translateString(el.value);
}
function walk(root) {
  if (root.nodeType === 3) return doText(root);
  if (root.nodeType !== 1 || SKIP.has(root.tagName)) return;
  doEl(root);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = it.nextNode(); n; n = it.nextNode()) n.nodeType === 3 ? doText(n) : doEl(n);
}
if (LANG !== "en" && DICT.size) {
  document.documentElement.lang = LANG;
  document.title = translateString(document.title);
  walk(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") doText(m.target);
      else if (m.type === "attributes") doEl(m.target);
      else m.addedNodes.forEach(walk);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

// ------------------------------------------------------------------ flags (simple drawings: Windows has no flag emoji)
const R = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
const V3 = (a, b, c) => R(0, 0, 10, 20, a) + R(10, 0, 10, 20, b) + R(20, 0, 10, 20, c);
const H3 = (a, b, c) => R(0, 0, 30, 6.67, a) + R(0, 6.67, 30, 6.67, b) + R(0, 13.33, 30, 6.67, c);
const PH = R(0, 0, 30, 10, "#0038a8") + R(0, 10, 30, 10, "#ce1126") + `<path d="M0 0L17 10L0 20Z" fill="#fff"/><circle cx="5.5" cy="10" r="2.2" fill="#fcd116"/>`;
const FLAG = {
  en: R(0, 0, 30, 20, "#012169") + `<path d="M0 0L30 20M30 0L0 20" stroke="#fff" stroke-width="4"/><path d="M0 0L30 20M30 0L0 20" stroke="#c8102e" stroke-width="1.6"/><path d="M15 0V20M0 10H30" stroke="#fff" stroke-width="6"/><path d="M15 0V20M0 10H30" stroke="#c8102e" stroke-width="3.4"/>`,
  it: V3("#009246", "#fff", "#ce2b37"), fr: V3("#0055a4", "#fff", "#ef4135"),
  de: H3("#000", "#dd0000", "#ffce00"), ru: H3("#fff", "#0039a6", "#d52b1e"), bg: H3("#fff", "#00966e", "#d62612"),
  et: H3("#0072ce", "#000", "#fff"), sr: H3("#c6363c", "#0c4076", "#fff"),
  hr: H3("#ff0000", "#fff", "#171796") + `<path d="M12 4h6v7a3 3 0 0 1-6 0z" fill="#fff" stroke="#ff0000" stroke-width=".6"/><path d="M12 4h2v2h-2zM16 4h2v2h-2zM14 6h2v2h-2zM12 8h2v2h-2zM16 8h2v2h-2z" fill="#ff0000"/>`,
  pl: R(0, 0, 30, 10, "#fff") + R(0, 10, 30, 10, "#dc143c"),
  cs: R(0, 0, 30, 10, "#fff") + R(0, 10, 30, 10, "#d7141a") + `<path d="M0 0L15 10L0 20Z" fill="#11457e"/>`,
  fi: R(0, 0, 30, 20, "#fff") + R(8, 0, 5, 20, "#002f6c") + R(0, 7.5, 30, 5, "#002f6c"),
  el: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => R(0, i * 20 / 9, 30, 20 / 9 + .05, i % 2 ? "#fff" : "#0d5eaf")).join("") + R(0, 0, 11.1, 11.1, "#0d5eaf") + R(4.44, 0, 2.22, 11.1, "#fff") + R(0, 4.44, 11.1, 2.22, "#fff"),
  cnr: R(0, 0, 30, 20, "#c40308") + `<rect x=".8" y=".8" width="28.4" height="18.4" fill="none" stroke="#d3ae3b" stroke-width="1.6"/><circle cx="15" cy="10" r="4" fill="#d3ae3b"/>`,
  bs: R(0, 0, 30, 20, "#002395") + `<path d="M8 0H24V16Z" fill="#fecb00"/>` + [0, 1, 2, 3, 4, 5].map(i => `<circle cx="${6.5 + i * 2.6}" cy="${1.2 + i * 2.6}" r=".9" fill="#fff"/>`).join(""),
  "pt-PT": R(0, 0, 12, 20, "#006600") + R(12, 0, 18, 20, "#ff0000") + `<circle cx="12" cy="10" r="4" fill="#ffe900"/><circle cx="12" cy="10" r="2.2" fill="#ff0000"/>`,
  "pt-BR": R(0, 0, 30, 20, "#009c3b") + `<path d="M15 2L28 10L15 18L2 10Z" fill="#ffdf00"/><circle cx="15" cy="10" r="4.2" fill="#002776"/>`,
  "es-ES": R(0, 0, 30, 5, "#aa151b") + R(0, 5, 30, 10, "#f1bf00") + R(0, 15, 30, 5, "#aa151b"),
  "es-419": V3("#006847", "#fff", "#ce1126") + `<circle cx="15" cy="10" r="2.4" fill="#8c5a2b"/>`,
  tl: PH, ceb: PH,
};
export function flag(code, size = 20) {
  return `<svg class="flag" viewBox="0 0 30 20" width="${size * 1.5}" height="${size}" aria-hidden="true" style="border-radius:3px;box-shadow:0 0 0 1px rgba(0,0,0,.15);display:block">${FLAG[code] || FLAG.en}</svg>`;
}

/** The flag button: a list of every language; picking one restarts the window in that language. */
export function languageButton(className = "icon-btn") {
  const b = document.createElement("button");
  b.className = className + " lang-btn";
  b.type = "button";
  b.title = T("Language");
  b.setAttribute("aria-label", T("Language"));
  b.setAttribute("translate", "no");
  b.innerHTML = flag(LANG, 16);
  b.onclick = (e) => { e.stopPropagation(); openMenu(b); };
  return b;
}
function openMenu(anchor) {
  if (document.getElementById("langMenu")) { document.getElementById("langMenu").remove(); return; }
  const m = document.createElement("div");
  m.id = "langMenu";
  m.setAttribute("translate", "no");
  m.style.cssText = "position:fixed;z-index:9999;background:var(--raised,#fff);color:var(--text,#111);border-radius:var(--r-l,12px);box-shadow:var(--shadow-3,0 20px 50px rgba(0,0,0,.3));padding:6px;max-height:min(70vh,560px);overflow:auto;min-width:230px;font:inherit";
  m.innerHTML = LANGS.map(([c, n]) => `<button type="button" data-c="${c}" style="display:flex;align-items:center;gap:10px;width:100%;border:0;background:${c === LANG ? "var(--accent-tint,rgba(0,0,0,.08))" : "none"};color:inherit;font:inherit;padding:8px 10px;border-radius:var(--r-s,7px);cursor:pointer;text-align:left">${flag(c, 14)}<span>${n}</span></button>`).join("");
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.top = Math.min(r.bottom + 6, innerHeight - m.offsetHeight - 8) + "px";
  m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + "px";
  m.querySelectorAll("button").forEach(x => {
    x.onmouseenter = () => { if (x.dataset.c !== LANG) x.style.background = "var(--hover,rgba(0,0,0,.05))"; };
    x.onmouseleave = () => { if (x.dataset.c !== LANG) x.style.background = "none"; };
    x.onclick = () => setLanguage(x.dataset.c);
  });
  const close = (e) => { if (!m.contains(e.target)) { m.remove(); removeEventListener("pointerdown", close, true); } };
  setTimeout(() => addEventListener("pointerdown", close, true), 0);
  addEventListener("keydown", function esc(e) { if (e.key === "Escape") { m.remove(); removeEventListener("keydown", esc); } });
}
export function setLanguage(code) {
  if (!CODES.includes(code) || code === LANG) { const m = document.getElementById("langMenu"); if (m) m.remove(); return; }
  try { localStorage.setItem("ui.lang", code); } catch (_) { /* */ }
  try { if (window.Desktop && window.Desktop.setLang) window.Desktop.setLang(code); } catch (_) { /* */ }
  location.reload();
}
