// Checks the interface translations (www/locales). Started by check_translations.bat, which runs it with the app's own
// exe (Electron works as Node), so nothing has to be installed.
//  1. Quick check, offline: missing or extra lines, {0} placeholders, HTML tags, lines left in English.
//  2. Review by Gemini (optional): a native-speaker check of every line, language by language.
// Writes translation_check.txt (readable) and translation_check.json next to this script. Nothing in the app is changed.
//   check_translations.bat              all languages
//   check_translations.bat it de fr     only these
"use strict";
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const HERE = __dirname;
const APP = /PdfEditor/i.test(HERE) ? "PdfEditor" : "FileCompressor";
const NAMES = { "it": "Italian", "pt-BR": "Brazilian Portuguese", "pt-PT": "European Portuguese", "es-ES": "Spanish (Spain)", "es-419": "Latin American Spanish",
  "de": "German", "fr": "French", "tl": "Tagalog (Filipino)", "ceb": "Cebuano (Bisaya)", "cs": "Czech", "pl": "Polish", "fi": "Finnish", "et": "Estonian",
  "sr": "Serbian (Cyrillic, ekavian)", "hr": "Croatian", "cnr": "Montenegrin (Latin script)", "bs": "Bosnian", "bg": "Bulgarian", "ru": "Russian", "el": "Greek" };
const WHAT = APP === "PdfEditor" ? "a Windows and Android PDF editor (view, annotate, sign, convert and compress PDFs)"
  : "a Windows file compressor for videos, photos, PDFs, audio and Office files";
const color = (c, s) => (process.stdout.isTTY ? `\x1b[${c}m${s}\x1b[0m` : s);
const LA = process.env.LOCALAPPDATA || "";

// ---------------------------------------------------------------- where the texts are
const CANDIDATES = [process.env.LOCALES_DIR, path.join(HERE, "..", "www", "locales"), path.join(HERE, "www", "locales"),
  path.join(HERE, APP, "resources", "app", "www", "locales"), LA && path.join(LA, "Programs", APP, "resources", "app", "www", "locales")].filter(Boolean);
const LOC = CANDIDATES.find(d => fs.existsSync(path.join(d, "en.txt")));
if (!LOC) { console.log(color(31, "Can't find the www\\locales folder with en.txt.")); process.exit(1); }

function readLocale(file) {
  const m = new Map();
  for (const line of fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const i = line.indexOf("|");
    if (i > 0 && /^\d+$/.test(line.slice(0, i))) m.set(+line.slice(0, i), line.slice(i + 1));
  }
  return m;
}
const EN = readLocale(path.join(LOC, "en.txt"));
const args = process.argv.slice(2).filter(a => a.trim());
const CODES = args.length ? args.filter(c => NAMES[c]) : Object.keys(NAMES);

// texts that are the same in every language (names, units, formats)
const KEEP = /^(?:[\d\s.,:;×x%()\-–+/{}·…"“”„«»]|MB|KB|GB|fps|px|PDFs?|MP4|MP3|M4A|JPG|PNG|MKV|OCR|EXIF|GPS|DRM|AES-256|Excel|Word|PowerPoint|Office|WhatsApp|Telegram|Instagram|Discord|Opus|E-?mail|Audio|Video|Auto|Letter|PdfEditor|FileCompressor|Windows|Ctrl|Shift|Original|Compressed|zip|ffmpeg|Gabriele|Format|Privacy|System|Slide|Text|Draft|Final|Program|Field|Initials|Stamp|Signature|Margin|Opacity|Position|Resolution|Expired|Media|Title|Author|Instagram|Ink|Bold|Unit|Arrow)+$/;

const txt = [];
const report = {};
const D = new Date(), P = (x) => String(x).padStart(2, "0");
txt.push(`${APP} - translation check, ${D.getFullYear()}-${P(D.getMonth() + 1)}-${P(D.getDate())} ${P(D.getHours())}:${P(D.getMinutes())}`);
txt.push(`Texts: ${LOC}  (${EN.size} lines in English)`, "", "================ 1. QUICK CHECK (offline) ================");
console.log(color(36, `Checking the ${APP} translations in ${LOC}`));

// ---------------------------------------------------------------- 1. quick check
let total = 0;
const tags = (s) => (s.match(/<\/?[a-z]+/g) || []).join("");
const holders = (s) => [...new Set(s.match(/\{\d+\}/g) || [])].sort();
for (const c of CODES) {
  const file = path.join(LOC, c + ".txt");
  const issues = [];
  if (!fs.existsSync(file)) issues.push({ n: 0, kind: "file missing" });
  else {
    const TR = readLocale(file);
    for (const [n, e] of EN) {
      const t = TR.get(n);
      if (t === undefined || !t.trim()) { issues.push({ n, kind: "missing", en: e }); continue; }
      const pe = holders(e), pt = holders(t);
      const extra = pt.filter(x => !pe.includes(x)), lost = pe.filter(x => !pt.includes(x));
      if (extra.length || (lost.length && !/subtitle track/.test(e))) issues.push({ n, kind: `placeholders differ (${[...extra, ...lost].join(" ")})`, en: e, tr: t });
      if (tags(e) !== tags(t)) issues.push({ n, kind: "HTML tags differ", en: e, tr: t });
      if (t === e && /[A-Za-z]{3,}\s+\S*[A-Za-z]{3,}/.test(e.replace(/\{\d+\}/g, "")) && !KEEP.test(e)) issues.push({ n, kind: "still in English", en: e, tr: t });
      if (/(\.\.\.|…)$/.test(e) && !/(\.\.\.|…)$/.test(t)) issues.push({ n, kind: "the … at the end is missing", en: e, tr: t });
      if (/^\s/.test(e) !== /^\s/.test(t) || /\s$/.test(e) !== /\s$/.test(t)) issues.push({ n, kind: "space at the start or end differs", en: JSON.stringify(e), tr: JSON.stringify(t) });
    }
    for (const [n, t] of TR) if (!EN.has(n)) issues.push({ n, kind: "extra line (not in en.txt)", tr: t });
  }
  total += issues.length;
  report[c] = { quick: issues, review: [] };
  txt.push("", `--- ${NAMES[c]} (${c}): ${issues.length} problem(s)`);
  for (const x of issues) {
    txt.push(`  [${x.n}] ${x.kind}`);
    if (x.en) txt.push(`      EN: ${x.en}`);
    if (x.tr) txt.push(`      ${c}: ${x.tr}`);
  }
  console.log(`  ${c.padEnd(7)} ${issues.length ? color(33, issues.length + " problem(s)") : color(32, "ok")}`);
}
console.log(color(36, `\nQuick check: ${total} problem(s) in total.`));

function save() {
  fs.writeFileSync(path.join(HERE, "translation_check.txt"), "\uFEFF" + txt.join("\r\n") + "\r\n");
  fs.writeFileSync(path.join(HERE, "translation_check.json"), JSON.stringify(report, null, 1));
}
save();

// ---------------------------------------------------------------- 2. review by Gemini (optional)
const ask = (q) => new Promise(res => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, a => { rl.close(); res(a.trim()); }); });
function findKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  // the key already saved in AudioTranscriber's settings, if there is one
  const dirs = ["G:\\AudioTranscriber", LA && path.join(LA, "Programs", "AudioTranscriber"), "G:\\Progetti\\1. AudioTranscriber"].filter(Boolean);
  try {
    const out = require("child_process").execFileSync("reg", ["query", "HKCU\\Software\\AudioTranscriber", "/v", "InstallDir"], { encoding: "utf8", windowsHide: true });
    const m = /InstallDir\s+REG_SZ\s+(.+)/.exec(out); if (m) dirs.unshift(m[1].trim());
  } catch (_) { /* not installed */ }
  for (const d of dirs) {
    try { const k = JSON.parse(fs.readFileSync(path.join(d, "settings.json"), "utf8")).gemini_key; if (k) return String(k).trim(); } catch (_) { /* */ }
  }
  return "";
}
const MODELS = ["gemma-4-31b-it", "gemma-4-26b-a4b-it", "gemini-flash-lite-latest", "gemini-flash-latest"];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function gemini(key, prompt) {
  const body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } });
  for (let tr = 0; tr < 16; tr++) {
    const m = MODELS[tr % MODELS.length];
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body, signal: AbortSignal.timeout(300000) });
    } catch (e) { console.log(color(90, `     no answer from ${m}, retrying…`)); await sleep(10000); continue; }
    if (r.ok) {
      const d = await r.json();
      return ((d.candidates && d.candidates[0].content && d.candidates[0].content.parts) || []).filter(p => !p.thought).map(p => p.text || "").join("");
    }
    if ([400, 401, 403].includes(r.status)) throw Object.assign(new Error(`Gemini refused the request (${r.status}). Check the key.`), { fatal: true });
    console.log(color(90, `     ${m} busy (${r.status}), trying another…`));
    await sleep((tr + 1) % MODELS.length ? 3000 : 20000);
  }
  throw new Error("Google stayed busy");
}
const parseList = (t) => { const a = t.indexOf("["), b = t.lastIndexOf("]"); try { return a >= 0 && b > a ? JSON.parse(t.slice(a, b + 1)) : []; } catch (_) { return []; } };

(async () => {
  const yes = await ask("\nAlso ask Gemini to review every line? It takes 15-40 minutes. [y/N] ");
  if (/^(y|yes|s|si|sì)$/i.test(yes)) {
    let key = findKey();
    if (!key) key = await ask("Paste your Gemini API key (used only now, not saved): ");
    if (key) {
      txt.push("", "================ 2. REVIEW BY GEMINI ================");
      outer: for (const c of CODES) {
        const file = path.join(LOC, c + ".txt");
        if (!fs.existsSync(file)) continue;
        const TR = readLocale(file), lang = NAMES[c], nums = [...EN.keys()].filter(n => TR.has(n)), found = [];
        console.log(color(36, `  ${c} (${lang}): reviewing…`));
        for (let i = 0; i < nums.length; i += 60) {
          const items = nums.slice(i, i + 60).map(n => JSON.stringify({ n, en: EN.get(n), tr: TR.get(n) })).join("\n");
          const prompt = `You are a native ${lang} speaker and a professional software localizer.
Below are user-interface texts of ${WHAT}. Each item has the English original and the current ${lang} translation.
Report ONLY items where the ${lang} text is wrong, unnatural, ungrammatical, misleading, uses the wrong regional variant,
or is inconsistent with the other items. Keep placeholders like {0} exactly, keep \\n and HTML tags exactly, keep product names
(PdfEditor, FileCompressor, WhatsApp, Discord, Word, Excel, PowerPoint, Office) and the folder names Compressed and Original in English.
Do not report matters of taste. Answer ONLY with a JSON list: [{"n": number, "fix": "corrected text", "why": "short reason in English"}]. [] if all is fine.

ITEMS:
${items}`;
          try { found.push(...parseList(await gemini(key, prompt))); }
          catch (e) { console.log(color(31, "     " + e.message)); found.push({ n: 0, fix: "", why: "error: " + e.message }); if (e.fatal) break outer; }
          await sleep(3000);
        }
        report[c].review = found;
        txt.push("", `--- ${lang} (${c}): ${found.length} suggestion(s)`);
        for (const x of found) {
          const n = +x.n;
          txt.push(`  [${n}] ${x.why || ""}`);
          if (EN.has(n)) txt.push(`      EN:  ${EN.get(n)}`, `      now: ${TR.get(n)}`);
          txt.push(`      fix: ${x.fix || ""}`);
        }
        console.log(`     ${found.length ? color(33, found.length + " suggestion(s)") : color(32, "nothing to change")}`);
        save();
      }
    }
  }
  save();
  console.log(color(32, `\nReport: ${path.join(HERE, "translation_check.txt")}`));
})();
