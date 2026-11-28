// Main process side of the languages (same files as the page: www/locales) and the log file.
// Same file in FileCompressor and PdfEditor.
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const CODES = ["en", "it", "pt-BR", "pt-PT", "es-ES", "es-419", "de", "fr", "tl", "ceb", "cs", "pl", "fi", "et", "sr", "hr", "cnr", "bs", "bg", "ru", "el"];
let WWW = "", lang = "en", dict = null;
const langFile = () => path.join(app.getPath("userData"), "language.txt");

/** Call once at start: the folder with locales/, and the folder of the exe (where the installer leaves lang.txt). */
function init(www, exeDir) {
  WWW = www;
  // picked in the installer: it wins once, then the app's own choice is kept
  try {
    const f = path.join(exeDir, "lang.txt");
    if (fs.existsSync(f)) {
      const c = fs.readFileSync(f, "utf8").trim();
      if (CODES.includes(c)) { fs.mkdirSync(path.dirname(langFile()), { recursive: true }); fs.writeFileSync(langFile(), c); }
      try { fs.unlinkSync(f); } catch (_) { /* read-only folder: it is read again next time, same result */ }
    }
  } catch (_) { /* */ }
  try { const c = fs.readFileSync(langFile(), "utf8").trim(); if (CODES.includes(c)) lang = c; } catch (_) { /* */ }
}
function getLang() { return lang; }
function setLang(c) {
  if (!CODES.includes(c)) return false;
  lang = c; dict = null;
  try { fs.mkdirSync(path.dirname(langFile()), { recursive: true }); fs.writeFileSync(langFile(), c); } catch (_) { /* */ }
  return true;
}
function parse(p) {
  const m = new Map();
  try {
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const i = line.indexOf("|");
      if (i > 0 && /^\d+$/.test(line.slice(0, i))) m.set(+line.slice(0, i), line.slice(i + 1).replace(/\\n/g, "\n"));
    }
  } catch (_) { /* */ }
  return m;
}
const fill = (t, a) => t.replace(/\{(\d+)\}/g, (m, i) => (a[+i] !== undefined ? String(a[+i]) : m));
function T(text, ...args) {
  if (lang !== "en" && !dict) {
    dict = new Map();
    const E = parse(path.join(WWW, "locales", "en.txt")), L = parse(path.join(WWW, "locales", lang + ".txt"));
    for (const [n, e] of E) { const t = L.get(n); if (t && t.trim()) dict.set(e, t); }
  }
  const s = String(text), core = s.trim();
  const t = lang === "en" ? undefined : dict.get(core);
  if (t === undefined) return fill(s, args);
  const i = s.indexOf(core);
  return s.slice(0, i) + fill(t, args) + s.slice(i + core.length);
}

// ------------------------------------------------------------------ log: <App>.log in the program folder (or in its data folder)
let logPath = "";
function startLog(name, exeDir) {
  const can = (d) => { try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return true; } catch (_) { return false; } };
  const dir = app.isPackaged && can(exeDir) ? exeDir : app.getPath("userData");
  logPath = path.join(dir, name + ".log");
  try {
    // keep it small: over 2 MB the old part becomes <name>.old.log
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 2 * 1024 * 1024) fs.renameSync(logPath, path.join(dir, name + ".old.log"));
  } catch (_) { /* */ }
  log("info", `----- ${name} ${app.getVersion()} started (Windows ${require("os").release()}, language ${lang})`);
  process.on("uncaughtException", (e) => log("error", "main: " + ((e && e.stack) || e)));
  process.on("unhandledRejection", (e) => log("error", "main (promise): " + ((e && e.stack) || e)));
  app.on("render-process-gone", (_e, _w, d) => log("error", `window stopped: ${d.reason} (code ${d.exitCode})`));
  app.on("child-process-gone", (_e, d) => { if (d.reason !== "clean-exit") log("error", `${d.type} ${d.name || ""} stopped: ${d.reason} (code ${d.exitCode})`); });
  return logPath;
}
function log(level, msg) {
  if (!logPath) return;
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  try { fs.appendFileSync(logPath, `${stamp} [${String(level).toUpperCase()}] ${String(msg).slice(0, 4000)}\r\n`); } catch (_) { /* */ }
}
/** Errors printed by the page go to the log too. */
function watchWindow(win) {
  win.webContents.on("console-message", (e) => {
    if (e && e.level === "error") log("error", `page: ${e.message}${e.sourceId ? ` (${String(e.sourceId).split("/").pop()}:${e.lineNumber})` : ""}`);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => log("error", `page didn't load: ${desc} (${code}) ${url}`));
  win.webContents.on("unresponsive", () => log("warn", "the window stopped responding"));
}
module.exports = { init, T, getLang, setLang, CODES, startLog, log, watchWindow, logFile: () => logPath };
