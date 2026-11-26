// PdfEditor: the whole user interface. The same code runs in the Android app (WebView) and in the Windows app (Electron).
import { icon } from "./icons.js";
import {
  $, esc, A, D, PHONE, tx, droppedFiles, call, toast, task, busy, idle, progress, busyState, checkCancel, sheet, sheetOpen, closeSheet, alertBox, confirmBox,
  choose, form, PALETTE, pickFiles, readFile, releaseFile, saveOver, saveAs, share, deliver, openUrl, MIME, incoming,
  fmtSize, baseName, ext, normalizeImage, storeGet, storeSet, showError, sleep, u8ToB64,
} from "./ui.js";
import * as C from "./convert.js";

// Update check (phone app): looks at the latest GitHub release when the app opens. The Windows app does the same in desktop/updater.js.
const REPO = "Gabrydl/PdfEditor";
const APP_VERSION = "1.6.0";   // phone app version; the release build keeps it equal to desktop/package.json

// ================================================================== state
const S = {
  doc: null,          // { id, name, file, canSave, pages:[{w,h}], toc, forms, encrypted, canUndo, canRedo }
  dirty: false,
  gen: 0,             // bumps when a different document (or page layout) is shown
  zoom: 1, base: 1, tops: [],
  mode: "view", tool: null,
  color: storeGet("color", "#e0383e"), hlColor: storeGet("hlColor", "#ffd43b"), width: storeGet("width", 2),
  night: false, showFields: false,
  search: { needle: "", hits: [], cur: -1 },
  sel: null,          // selected annotation {page, index, rect, type}
  pending: null,      // object waiting to be placed (signature image, picture, stamp)
};
let PE = [];          // page elements: {el, canvas, ov, key, ver, cache:{}}

// settings (Settings window, one section per topic); every feature can be switched off
const PREF_DEFAULTS = {
  tabs: true, lastPage: true, recentThumbs: true, recentPhone: true, openWith: false,
  nightDefault: false, spreadDefault: false, readRate: 1,
  quickColors: true, shortcuts: true,
  autosave: true, autosaveMin: 2,
  cleanMeta: true, cleanFonts: true,
  printPerSheet: 1,
};
const P = { ...PREF_DEFAULTS, ...storeGet("prefs", {}) };
const savePrefs = () => storeSet("prefs", P);
// every function can be switched off in Settings › Features: its buttons, menu entries and shortcuts disappear
const FEATURES = [
  { f: "search", label: "Find in document", sub: "Search button, Ctrl+F" },
  { f: "bookmarks", label: "Bookmarks panel", sub: "Add, rename and move bookmarks" },
  { f: "night", label: "Night mode", sub: "Dark pages for reading" },
  { f: "spread", label: "Two pages side by side" },
  { f: "reflow", label: "Reading mode", sub: "Text only, bigger letters" },
  { f: "read", label: "Read aloud" },
  { f: "compare", label: "Compare two versions" },
  { f: "print", label: "Print", sub: "Chosen pages, several per sheet" },
  { f: "exportnotes", label: "Export highlights and notes", sub: "As a text file" },
  { f: "copyto", label: "Copy pages to another open PDF" },
  { f: "dragpages", label: "Drag pages to reorder them", sub: "In the Pages view, and onto a tab to copy them", desk: true },
  { f: "dropfiles", label: "Drop files on the window", sub: "Open, merge or add them to the open PDF", desk: true },
  { f: "split", label: "Split", sub: "By page ranges or every N pages" },
  { f: "compress", label: "Compress" },
  { f: "protect", label: "Add or remove a password" },
  { f: "ocr", label: "OCR", sub: "Make scans searchable" },
  { f: "convert", label: "Convert", sub: "PDF to Word, Excel, PowerPoint, images, text" },
];
const on = (f) => !f || P["f_" + f] !== false;
// which function each button belongs to
const FEATURE_OF = { read: "read", reflow: "reflow", night: "night", toc: "bookmarks", spread: "spread", compare: "compare", print: "print",
  exportnotes: "exportnotes", split: "split", compress: "compress", protect: "protect", unlock: "protect", ocr: "ocr",
  toword: "convert", toexcel: "convert", toppt: "convert", toimg: "convert", totxt: "convert", copyto: "copyto" };
const toolOn = (t) => on(FEATURE_OF[t.id]);
for (const x of FEATURES) if (P["f_" + x.f] == null) P["f_" + x.f] = true;
S.spread = false;
// open documents (tabs): { key, doc, dirty, zoom, page, night, spread }
let TABS = [];
const tabOf = (doc) => TABS.find(t => t.doc === doc);

const screens = ["home", "viewer", "organize", "reading", "compare"];
function show(name) { screens.forEach(s => $(s).classList.toggle("active", s === name)); }
const curScreen = () => screens.find(s => $(s).classList.contains("active"));

// ================================================================== theme
const themeMq = matchMedia("(prefers-color-scheme: dark)");
const wantsDark = (t = storeGet("theme", "auto")) => t === "dark" || (t === "auto" && themeMq.matches);
function applyTheme() {
  const t = storeGet("theme", "auto");
  const dark = wantsDark(t);
  document.documentElement.classList.toggle("dark", dark);
  $("themeBtn").innerHTML = $("themeBtn2").innerHTML = icon(dark ? "sun" : "moon");
  $("themeSeg").querySelectorAll("button").forEach(b => { b.classList.toggle("on", b.dataset.val === t); b.setAttribute("aria-checked", b.dataset.val === t); });
  if (A && A.setBarColor) A.setBarColor(dark ? "#1a1c20" : "#ffffff");
  if (D) D.setTheme(t, dark);
}
/** Change the theme; the new colours open out in a circle from where the user pressed. */
function setTheme(t, ev) {
  const before = document.documentElement.classList.contains("dark");
  storeSet("theme", t);
  const still = before === wantsDark(t) || !document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (still) { applyTheme(); return; }
  const r = ev && ev.currentTarget ? ev.currentTarget.getBoundingClientRect() : null;
  const x = r ? r.left + r.width / 2 : innerWidth / 2, y = r ? r.top + r.height / 2 : innerHeight / 2;
  const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const vt = document.startViewTransition(applyTheme);
  vt.ready.then(() => {
    document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
      { duration: 520, easing: "cubic-bezier(.22, 1, .36, 1)", pseudoElement: "::view-transition-new(root)" });
  }).catch(() => {});
}
const flipTheme = (e) => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark", e);
$("themeBtn").onclick = flipTheme;
$("themeBtn2").onclick = flipTheme;
$("themeSeg").querySelectorAll("button").forEach(b => { b.onclick = (e) => setTheme(b.dataset.val, e); });

// ================================================================== icons on static buttons
const ICONS = { backBtn: "left", undoBtn: "undo", redoBtn: "redo", searchBtn: "search", moreBtn: "more", searchPrev: "up",
  searchNext: "down", searchClose: "close", bannerClose: "close", orgBack: "left", readBack: "left", saveBtn: "save",
  zoomOut: "minus", zoomIn: "plus", settingsBtn: "settings", sideClose: "close", cmpBack: "left", cmpPrev: "left", cmpNext: "right" };
for (const [id, name] of Object.entries(ICONS)) $(id).innerHTML = icon(name);
$("openIc").innerHTML = icon("open");
if (!PHONE) $("openSub").textContent = D ? "Drop a file here, or click to browse" : "Drop a file here, or click to choose one";
if (PHONE) $("privacy").textContent = "Your files never leave this phone.";
else $("privacy").textContent = "Works offline. Your files never leave this computer.";

// ================================================================== home
const GROUPS = [
  { t: "Edit and sign", tiles: [
    { icon: "edit", t: "Edit PDF", s: "Change text, add text and pictures", run: () => openThen(() => setMode("edit")) },
    { icon: "sign", t: "Fill and sign", s: "Forms, signature, initials", run: () => openThen(() => setMode("sign")) },
    { icon: "highlight", t: "Annotate", s: "Highlight, draw, notes", run: () => openThen(() => setMode("comment")) },
    { icon: "redact", t: "Redact", s: "Black out private data", run: () => openThen(() => { setMode("edit"); selectTool("redact"); }) },
    { icon: "watermark", t: "Watermark", s: "Text over every page", run: () => openThen(() => watermarkTool()) },
  ] },
  { t: "Convert", tiles: [
    { icon: "image", t: "Photos to PDF", s: "Pictures or scans", run: () => imagesFlow() },
    { icon: "office", t: "Office to PDF", s: "Word, Excel, PowerPoint, text", run: () => officeFlow() },
    { f: "convert", icon: "word", t: "PDF to Word", s: "Editable .docx", run: () => openThen(() => convertTool("word")) },
    { f: "convert", icon: "excel", t: "PDF to Excel", s: "Tables as .xlsx", run: () => openThen(() => convertTool("excel")) },
    { f: "convert", icon: "ppt", t: "PDF to PowerPoint", s: "One slide per page", run: () => openThen(() => convertTool("ppt")) },
    { f: "convert", icon: "image", t: "PDF to images", s: "JPG or PNG", run: () => openThen(() => convertTool("images")) },
  ] },
  { t: "Pages", tiles: [
    { icon: "merge", t: "Merge PDFs", s: "Join several files", run: () => mergeFlow() },
    { icon: "thumbs", t: "Organize pages", s: "Move, rotate, delete", run: () => openThen(() => openOrganize()) },
    { f: "split", icon: "split", t: "Split", s: "Into smaller PDFs", run: () => openThen(() => splitTool()) },
  ] },
  { t: "Optimize and protect", tiles: [
    { f: "compress", icon: "compress", t: "Compress", s: "Make the file smaller", run: () => openThen(() => compressTool()) },
    { f: "ocr", icon: "ocr", t: "OCR", s: "Make scans searchable", run: () => openThen(() => ocrTool()) },
    { f: "protect", icon: "lock", t: "Protect", s: "Add a password", run: () => openThen(() => protectTool()) },
    { f: "protect", icon: "unlock", t: "Unlock", s: "Remove the password", run: () => openThen(() => unlockTool()) },
    { f: "read", icon: "speaker", t: "Read aloud", s: "Listen to a PDF", run: () => openThen(() => startReading()) },
  ] },
];
const TILES = GROUPS.flatMap(g => g.tiles);
function drawTiles() {
  $("tiles").innerHTML = '<div class="cols">' + GROUPS.map(g => ({ ...g, tiles: g.tiles.filter(t => on(t.f)) })).filter(g => g.tiles.length).map((g, gi) => `<section class="group" style="--k:${gi}"><h2>${esc(g.t)}</h2><div class="rows">` +
    g.tiles.map(t => `<button class="tile" data-k="${TILES.indexOf(t)}"><span class="tic">${icon(t.icon)}</span>
      <span class="tx"><b>${esc(t.t)}</b><small>${esc(t.s)}</small></span>${icon("right", "chev")}</button>`).join("") + "</div></section>").join("") + "</div>";
}
drawTiles();
$("tiles").onclick = (e) => { const b = e.target.closest(".tile"); if (b) TILES[+b.dataset.k].run(); };
$("openBtn").onclick = () => openThen(null);

// recent files. PC: reopened from their path. Phone: the phone app can't open a file again later by itself,
// so PdfEditor keeps its own copy of the last PDFs (in its storage) and opens that copy with one tap.
const PHONE_RECENT_MAX = 8, PHONE_RECENT_BYTES = 60 * 1048576;
const recentStore = (() => {
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open("gpe-recent", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files", { keyPath: "key" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction("files", mode); const out = fn(t.objectStore("files")); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error); }); };
  return {
    put: (rec) => tx("readwrite", st => st.put(rec)).catch(() => {}),
    get: (key) => tx("readonly", st => st.get(key)).catch(() => null),
    drop: (key) => tx("readwrite", st => st.delete(key)).catch(() => {}),
    clear: () => tx("readwrite", st => st.clear()).catch(() => {}),
  };
})();
const recentList = () => storeGet(D ? "recent" : "recentPhone", []);
const recentSave = (list) => storeSet(D ? "recent" : "recentPhone", list);
const recentOn = () => D ? true : P.recentPhone;
function drawRecent() {
  const list = recentOn() ? recentList() : [];
  const thumbs = P.recentThumbs && list.some(f => f.thumb);
  $("recentBox").classList.toggle("hidden", !list.length);
  $("recent").classList.toggle("thumbs", thumbs);
  const where = (f) => f.path ? esc(f.path.replace(/[\\/][^\\/]*$/, "")) : (f.size ? fmtSize(f.size) : "");
  $("recent").innerHTML = list.slice(0, thumbs ? 12 : 8).map((f, k) => thumbs
    ? `<button class="rec card" data-k="${k}" title="${esc(f.path || f.name)}"><span class="rt">${f.thumb ? `<img src="${f.thumb}" alt="">` : icon("pdf")}</span><b>${esc(f.name)}</b><small class="${f.path && !f.page ? "" : "ltr"}">${f.page ? "Page " + (f.page + 1) : where(f)}</small></button>`
    : `<button class="rec" data-k="${k}" title="${esc(f.path || f.name)}">${icon("pdf")}<span><b>${esc(f.name)}</b><small class="${f.path && !f.page ? "" : "ltr"}">${f.page ? "Page " + (f.page + 1) : where(f)}&lrm;</small></span></button>`).join("");
}
/** Put a file at the top of Recent. On the phone `bytes` is the copy that will be reopened. */
async function addRecent(f, thumb = null, bytes = null) {
  if (!f) return;
  if (D) {
    if (!f.path) return;
    const all = recentList();
    const old = all.find(x => x.path === f.path) || {};
    const list = all.filter(x => x.path !== f.path);
    list.unshift({ name: f.name, path: f.path, thumb: thumb || old.thumb || null, page: old.page || 0 });
    recentSave(list.slice(0, 12));
    drawRecent();
    return;
  }
  if (!P.recentPhone) return;
  const key = placeKey(f);
  if (!key) return;
  const all = recentList();
  const old = all.find(x => x.key === key);
  if (!old && !bytes) return;                     // nothing kept to reopen it from
  if (bytes && bytes.length > PHONE_RECENT_BYTES) return;
  if (bytes) await recentStore.put({ key, bytes });
  const list = all.filter(x => x.key !== key);
  list.unshift({ key, name: f.name, size: f.size || (bytes ? bytes.length : 0), thumb: thumb || (old && old.thumb) || null, page: (old && old.page) || 0 });
  for (const gone of list.slice(PHONE_RECENT_MAX)) recentStore.drop(gone.key);
  recentSave(list.slice(0, PHONE_RECENT_MAX));
  drawRecent();
}
/** A small picture of the first page for the Recent list. */
async function recentThumb(d) {
  if (!P.recentThumbs || !d.file || !recentOn()) return;
  if (D ? !d.file.path : !recentList().some(x => x.key === placeKey(d.file))) return;
  try {
    const p = d.pages[0];
    const jpg = await call("renderJPEG", d.id, 0, Math.min(1, 150 / Math.max(p.w, p.h)), 68);
    addRecent(d.file, "data:image/jpeg;base64," + u8ToB64(jpg));
  } catch (_) { /* */ }
}
// where each file was left (by path on PC, by name + size on the phone)
const placeKey = (f) => f ? (f.path || f.recentKey || (f.name + ":" + (f.size || 0))) : "";
function rememberPage() {
  if (!P.lastPage || !S.doc || !S.doc.file) return;
  const k = placeKey(S.doc.file);
  if (!k) return;
  const map = storeGet("lastPages", {});
  map[k] = { page: currentPage(), at: Date.now() };
  const keys = Object.keys(map);
  if (keys.length > 300) keys.sort((a, b) => map[a].at - map[b].at).slice(0, keys.length - 300).forEach(x => delete map[x]);
  storeSet("lastPages", map);
  const list = recentList(), r = list.find(x => (D ? x.path : x.key) === k);
  if (r) { r.page = map[k].page; recentSave(list); }
}
$("recent").onclick = async (e) => {
  const b = e.target.closest(".rec");
  if (!b) return;
  const list = recentList(), f = list[+b.dataset.k];
  if (!f) return;
  if (D) {
    const ok = await openFile({ name: f.name, path: f.path, token: f.path, canSave: true });
    if (!ok && !(await D.exists(f.path))) { recentSave(list.filter(x => x.path !== f.path)); drawRecent(); }
    return;
  }
  const rec = await recentStore.get(f.key);
  if (!rec || !rec.bytes) { recentSave(list.filter(x => x.key !== f.key)); drawRecent(); toast("That copy is gone. Open the file again."); return; }
  await openFile({ name: f.name, size: f.size, recentKey: f.key, canSave: false }, new Uint8Array(rec.bytes));
};
$("recentClear") && ($("recentClear").onclick = async () => {
  if (!(await confirmBox("Clear Recent?", PHONE ? "The copies PdfEditor kept are deleted too. Your files stay where they are." : "Only the list is cleared. Your files stay where they are.", "Clear"))) return;
  if (!D) for (const f of recentList()) recentStore.drop(f.key);
  recentSave([]);
  drawRecent();
});
drawRecent();

async function openThen(after) {
  const files = await pickFiles("application/pdf", false);
  if (!files.length) return;
  if (await openFile(files[0]) && after) after();
}

// ================================================================== opening & closing documents
async function openFile(f, given = null) {
  const e = ext(f.name);
  if (e && e !== "pdf" && (C.OFFICE_EXT.includes(e) || C.NATIVE_EXT.includes(e))) {
    const pdf = await task("Converting " + f.name + "…", async () => C.fileToPdf(await readFile(f), f.name));
    releaseFile(f);
    if (!pdf) return false;
    return openBytes(pdf, baseName(f.name) + ".pdf", null);
  }
  // already open in a tab: just show it
  const k = placeKey(f);
  const open = k && TABS.find(t => t.doc.file && placeKey(t.doc.file) === k);
  if (open && (f.path || f.recentKey)) { switchTab(open); releaseFile(f); return true; }
  let bytes = given || await task("Opening…", () => readFile(f));
  if (!bytes) return false;
  // phone: keep a copy for Recent (the open call hands the bytes over to the PDF engine)
  if (!D && !f.recentKey) f.recentKey = f.name + ":" + (f.size || 0);   // stays the same after saving
  const keep = !D && P.recentPhone && (!f.size || f.size <= PHONE_RECENT_BYTES) && bytes.length <= PHONE_RECENT_BYTES ? bytes.slice() : null;
  const ok = await openBytes(bytes, f.name || "document.pdf", f);
  if (ok) {
    await addRecent(f, null, keep);
    recentThumb(S.doc);
    const last = P.lastPage && storeGet("lastPages", {})[k];
    if (last && last.page > 0 && last.page < S.doc.pages.length) { requestAnimationFrame(() => goToPage(last.page, false)); toast(`Back where you left it: page ${last.page + 1}.`); }
  }
  return ok;
}

async function openBytes(bytes, name, file, password = null) {
  // with tabs the open document stays open; without, it is closed first (asking to save)
  if (password === null && !(P.tabs && S.doc) && !(await confirmLeave())) { if (file) releaseFile(file); return false; }
  const copy = bytes.slice();
  let r = await task("Opening…", () => call("open", bytes, name, password));
  if (!r) { if (file) releaseFile(file); return false; }
  if (r.needsPassword) {
    const v = await form("Password needed", [{ name: "pw", label: "Password", type: "password", placeholder: "Password" }], "Open",
      password ? "Wrong password, try again." : `“${name}” is protected.`);
    if (!v) { if (file) releaseFile(file); return false; }
    return openBytes(copy, name, file, v.pw);
  }
  if (P.tabs && S.doc) stashTab(); else closeDoc(true);
  S.doc = { id: r.id, name, file, canSave: !!(file && file.canSave), password, ...r };
  S.dirty = !file;  // converted/new documents are not saved anywhere yet
  S.gen++;
  S.zoom = 1;
  S.search = { needle: "", hits: [], cur: -1 };
  S.night = !!P.nightDefault && on("night");
  S.spread = !!P.spreadDefault && on("spread");
  TABS.push({ key: "t" + Date.now() + Math.random().toString(36).slice(2, 6), doc: S.doc, dirty: S.dirty, zoom: 1, page: 0, night: S.night, spread: S.spread });
  $("docTitle").textContent = name;
  show("viewer");
  setMode("view");
  moveModeMarker(true);
  markDirty();
  buildPages();
  $("scroller").scrollTop = 0;
  updateUndo();
  if (r.forms) banner("This document has fillable fields.", "Fill in", () => setMode("sign"));
  else hideBanner();
  drawTabs();
  drawSide();
  return true;
}

function closeDoc(silent = false) {
  stopReading();
  if (!S.doc) return;
  rememberPage();
  const t = tabOf(S.doc);
  if (t) recovery.drop(t.key);
  const at = TABS.indexOf(t);
  TABS = TABS.filter(x => x !== t);
  call("close", S.doc.id).catch(() => {});
  releaseFile(S.doc.file);
  S.doc = null; S.dirty = false; S.gen++;
  PE = []; $("pages").innerHTML = "";
  markDirty();
  drawTabs();
  if (silent) return;
  if (TABS.length) switchTab(TABS[Math.min(Math.max(0, at), TABS.length - 1)], true);
  else { show("home"); drawRecent(); }
}

async function confirmLeave() {
  if (!S.doc || !S.dirty) return true;
  const v = await choose(`Save changes to “${S.doc.name}”?`, [
    { value: "save", label: "Save", icon: "save" },
    { value: "discard", label: "Don't save", icon: "trash" },
    { value: "cancel", label: "Cancel", icon: "close" },
  ]);
  if (v === "save") return await saveDoc(false);
  return v === "discard";
}

async function saveDoc(asNew) {
  if (!S.doc) return false;
  const d = S.doc;
  const bytes = await task("Saving…", () => call("save", d.id, {}));
  if (!bytes) return false;
  if (!asNew && d.file && d.file.token && d.canSave) {
    if (await saveOver(bytes, d.file.token)) { S.dirty = false; markDirty(); toast("Saved."); const t = tabOf(d); if (t) recovery.drop(t.key); keepRecentCopy(d, bytes); return true; }
    toast("Could not overwrite the file. Choose where to save it.");
  }
  const r = await saveAs(bytes, d.name.toLowerCase().endsWith(".pdf") ? d.name : d.name + ".pdf", MIME.pdf);
  if (r.ok) {
    S.dirty = false; toast("Saved" + (r.name ? ": " + r.name : "."));
    if (r.name) { d.name = r.name; $("docTitle").textContent = r.name; }
    if (r.path) { d.file = { name: r.name, path: r.path, token: r.path, canSave: true }; d.canSave = true; addRecent(d.file); recentThumb(d); }
    const t = tabOf(d); if (t) recovery.drop(t.key);
    keepRecentCopy(d, bytes);
    markDirty();
  }
  return r.ok;
}

/** Phone: after saving, the copy kept for Recent becomes the saved version. */
function keepRecentCopy(d, bytes) {
  if (D || !P.recentPhone || !bytes || bytes.length > PHONE_RECENT_BYTES) return;
  if (!d.file) d.file = { name: d.name, size: bytes.length, recentKey: d.name + ":" + bytes.length, canSave: false };
  addRecent({ ...d.file, name: d.name, size: bytes.length }, null, bytes.slice()).then(() => recentThumb(d));
}

// files arriving from other apps ("Open with", "Share")
incoming.handler = async (files, how) => {
  if (how === "drop") { dropFiles(files); return; }
  const images = files.filter(f => /^image\//.test(f.mime || "") || ["jpg", "jpeg", "png", "webp", "heic", "gif", "bmp"].includes(ext(f.name)));
  if (images.length && images.length === files.length) { await imagesFlow(images); return; }
  if (P.tabs) { for (const f of files.filter(f => !images.includes(f))) await openFile(f); return; }
  await openFile(files[0]);
};

// ================================================================== page layout & rendering
function buildPages() {
  const host = $("pages");
  host.innerHTML = "";
  PE = S.doc.pages.map((p, i) => {
    const el = document.createElement("div");
    el.className = "page";
    el.dataset.i = i;
    el.innerHTML = `<canvas class="pc"></canvas><div class="ov"></div><span class="num">${i + 1}</span>`;
    host.appendChild(el);
    return { el, canvas: el.firstChild, ov: el.children[1], key: "", ver: 0, cache: {} };
  });
  layout();
}

function layout() {
  if (!S.doc) return;
  const sc = $("scroller");
  const wide = sc.clientWidth >= 760;
  const two = !!S.spread && S.doc.pages.length > 1;
  const avail = two ? Math.max(200, sc.clientWidth - (wide ? 56 : 16) - 16) / 2 : Math.min(Math.max(200, sc.clientWidth - (wide ? 56 : 16)), wide ? 900 : 1e9);
  const maxW = Math.max(...S.doc.pages.map(p => p.w));
  S.base = avail / maxW;
  $("pages").classList.toggle("spread", two);
  const s = S.base * S.zoom;
  // wider than the window only when zoomed in; otherwise follow the window (so no stray sideways scrollbar)
  const need = maxW * s * (two ? 2 : 1) + (two ? 16 : 0) + (wide ? 56 : 16);
  $("pages").style.width = need > sc.clientWidth ? need + "px" : "auto";
  S.doc.pages.forEach((p, i) => {
    const pe = PE[i];
    pe.el.style.width = p.w * s + "px";
    pe.el.style.height = p.h * s + "px";
  });
  // where every page really sits (works for one column and for two pages side by side)
  S.tops = PE.map(pe => pe.el.offsetTop - 2);
  $("pages").classList.toggle("night", S.night);
  $("zoomLabel").textContent = Math.round(S.zoom * 100) + "%";
  scheduleRender();
}
const scale = () => S.base * S.zoom;

function visibleRange() {
  const sc = $("scroller");
  const y0 = sc.scrollTop, y1 = y0 + sc.clientHeight;
  let a = 0;
  while (a < S.tops.length - 1 && S.tops[a + 1] <= y0) a++;
  let b = a;
  while (b < S.tops.length - 1 && S.tops[b + 1] < y1) b++;
  return [a, b];
}
function currentPage() {
  if (!S.doc) return 0;
  const sc = $("scroller");
  const mid = sc.scrollTop + sc.clientHeight / 3;
  let i = 0;
  while (i < S.tops.length - 1 && S.tops[i + 1] <= mid) i++;
  return i;
}

let renderQueued = false, rendering = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderLoop(); });
}
async function renderLoop() {
  if (rendering || !S.doc) return;
  rendering = true;
  try {
    for (;;) {
      if (!S.doc) break;
      const [a, b] = visibleRange();
      // free pages far away
      PE.forEach((pe, i) => { if ((i < a - 4 || i > b + 4) && pe.key) { pe.canvas.width = 0; pe.canvas.height = 0; pe.key = ""; } });
      const order = [];
      for (let i = a; i <= b; i++) order.push(i);
      if (b + 1 < PE.length) order.push(b + 1);
      if (a - 1 >= 0) order.push(a - 1);
      const next = order.find(i => PE[i] && S.doc.pages[i] && PE[i].key !== wantKey(i));   // the page list can change while drawing
      if (next == null) break;
      await renderPage(next);
    }
  } catch (e) { console.error(e); }
  rendering = false;
}
function pixelScale(i) {
  const p = S.doc.pages[i];
  const dpr = window.devicePixelRatio || 1;
  return Math.min(scale() * dpr, Math.sqrt(9e6 / (p.w * p.h)), 4096 / Math.max(p.w, p.h));
}
const wantKey = (i) => pixelScale(i).toFixed(3) + ":" + PE[i].ver + ":" + (S.night ? 1 : 0);
async function renderPage(i) {
  const gen = S.gen, pe = PE[i], key = wantKey(i);
  const r = await call("render", S.doc.id, i, pixelScale(i), S.night);
  if (gen !== S.gen || PE[i] !== pe) return;
  pe.canvas.width = r.width; pe.canvas.height = r.height;
  pe.canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(r.pixels.buffer), r.width, r.height), 0, 0);
  pe.key = key;
  refreshOverlay(i);
}

/** Page content changed: re-render and refresh info (undo state, sizes). */
async function changed(pages = "all", newInfo = null) {
  S.dirty = true;
  markDirty();
  const inf = newInfo || await call("info", S.doc.id);
  const sizesChanged = inf.pages.length !== S.doc.pages.length || inf.pages.some((p, i) => Math.abs(p.w - S.doc.pages[i].w) > 0.1 || Math.abs(p.h - S.doc.pages[i].h) > 0.1);
  Object.assign(S.doc, { pages: inf.pages, toc: inf.toc, forms: inf.forms, canUndo: inf.canUndo, canRedo: inf.canRedo });
  S.sel = null;
  if (sizesChanged) {
    const keep = currentPage();
    S.gen++;
    buildPages();
    goToPage(Math.min(keep, PE.length - 1), false);
  } else {
    const list = pages === "all" ? PE.map((_, i) => i) : pages;
    for (const i of list) if (PE[i]) { PE[i].ver++; PE[i].cache = {}; }
    scheduleRender();
    for (const i of list) refreshOverlay(i);
  }
  updateUndo();
}
/** Run an engine operation on the document, then refresh. */
async function apply(label, fn, args, pages) {
  if (!S.doc) return false;
  const r = await task(label, () => call(fn, S.doc.id, ...args));
  if (r === undefined) return false;
  await changed(pages);
  return r;
}

function markDirty() {
  const on = !!(S.doc && S.dirty);
  const t = S.doc && tabOf(S.doc);
  if (t && t.dirty !== S.dirty) { t.dirty = S.dirty; drawTabs(); }
  $("docTitle").classList.toggle("dirty", on);
  if (D) D.setTitle(S.doc ? S.doc.name + (on ? " (edited)" : "") : "");
}
function updateUndo() {
  $("undoBtn").disabled = !(S.doc && S.doc.canUndo);
  $("redoBtn").disabled = !(S.doc && S.doc.canRedo);
}
$("undoBtn").onclick = async () => { if (!S.doc) return; const inf = await call("undo", S.doc.id); await changed("all", inf); };
$("redoBtn").onclick = async () => { if (!S.doc) return; const inf = await call("redo", S.doc.id); await changed("all", inf); };

// ------------------------------------------------------------------ scrolling, page indicator, zoom
let indTimer = 0;
$("scroller").addEventListener("scroll", () => {
  if (!S.doc) return;
  scheduleRender();
  const ind = $("pageInd");
  ind.textContent = `${currentPage() + 1} / ${S.doc.pages.length}`;
  ind.style.opacity = 1;
  clearTimeout(indTimer);
  indTimer = setTimeout(() => { ind.style.opacity = 0; rememberPage(); }, 1300);
  if (sideOpen) markSideCurrent();
}, { passive: true });
window.addEventListener("resize", () => { if (S.doc && curScreen() === "viewer") { const p = currentPage(); layout(); goToPage(p, false); } });

function goToPage(i, smooth = true, y = 0) {
  if (!S.doc) return;
  i = Math.max(0, Math.min(S.doc.pages.length - 1, i));
  $("scroller").scrollTo({ top: S.tops[i] + y * scale() - (y ? 80 : 0), behavior: smooth ? "smooth" : "auto" });
}

function setZoom(z, cx, cy) {
  const sc = $("scroller");
  z = Math.max(PHONE ? 0.5 : 0.3, Math.min(6, z));
  const f = z / S.zoom;
  if (Math.abs(f - 1) < 0.001) return;
  cx = cx ?? sc.clientWidth / 2; cy = cy ?? sc.clientHeight / 2;
  const ax = sc.scrollLeft + cx, ay = sc.scrollTop + cy;
  S.zoom = z;
  layout();
  sc.scrollLeft = ax * f - cx;
  sc.scrollTop = ay * f - cy;
  scheduleRender();
}

// pinch to zoom (two fingers), with a live CSS preview
const pinch = { on: false };
$("scroller").addEventListener("touchstart", (e) => {
  if (e.touches.length !== 2 || !S.doc) return;
  cancelGesture();
  const sc = $("scroller"), r = sc.getBoundingClientRect();
  const [t0, t1] = e.touches;
  pinch.on = true;
  pinch.d0 = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
  pinch.mx = (t0.clientX + t1.clientX) / 2 - r.left; pinch.my = (t0.clientY + t1.clientY) / 2 - r.top;
  pinch.cx = sc.scrollLeft + pinch.mx; pinch.cy = sc.scrollTop + pinch.my;
  pinch.f = 1;
}, { passive: true });
$("scroller").addEventListener("touchmove", (e) => {
  if (!pinch.on || e.touches.length !== 2) return;
  e.preventDefault();
  const sc = $("scroller"), r = sc.getBoundingClientRect();
  const [t0, t1] = e.touches;
  const d = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
  let f = d / pinch.d0;
  f = Math.max(0.5 / S.zoom, Math.min(6 / S.zoom, f));
  pinch.f = f;
  const mx = (t0.clientX + t1.clientX) / 2 - r.left, my = (t0.clientY + t1.clientY) / 2 - r.top;
  pinch.nx = mx; pinch.ny = my;
  const tx = pinch.cx * (1 - f) + (mx - pinch.mx), ty = pinch.cy * (1 - f) + (my - pinch.my);
  $("pages").style.transform = `translate(${tx}px, ${ty}px) scale(${f})`;
}, { passive: false });
$("scroller").addEventListener("touchend", (e) => {
  if (!pinch.on || e.touches.length > 1) return;
  pinch.on = false;
  $("pages").style.transform = "";
  const sc = $("scroller");
  const z = Math.max(0.5, Math.min(6, S.zoom * pinch.f));
  const f = z / S.zoom;
  S.zoom = z;
  layout();
  sc.scrollLeft = pinch.cx * f - (pinch.nx ?? pinch.mx);
  sc.scrollTop = pinch.cy * f - (pinch.ny ?? pinch.my);
  pinch.nx = pinch.ny = undefined;
  scheduleRender();
});

// ================================================================== overlays (search hits, fields, text blocks, selection)
const pct = (r, p) => `left:${r[0] / p.w * 100}%;top:${r[1] / p.h * 100}%;width:${(r[2] - r[0]) / p.w * 100}%;height:${(r[3] - r[1]) / p.h * 100}%`;
async function cached(i, what, fn) {
  const pe = PE[i];
  if (!pe) return [];
  if (!pe.cache[what]) pe.cache[what] = call(fn, S.doc.id, i).catch(() => []);
  return pe.cache[what];
}
async function refreshOverlay(i) {
  const pe = PE[i];
  if (!pe || !S.doc) return;
  const p = S.doc.pages[i];
  let html = "";
  S.search.hits.forEach((h, k) => { if (h.i === i) html += `<div class="hit ${k === S.search.cur ? "cur" : ""}" style="${pct(h.r, p)}"></div>`; });
  if (S.mode === "sign" || S.showFields) {
    for (const w of await cached(i, "widgets", "widgets")) if (!w.readOnly) html += `<div class="field" style="${pct(w.rect, p)}"></div>`;
  }
  if (S.tool && S.tool.id === "edittext") {
    for (const b of await cached(i, "blocks", "textBlocks")) html += `<div class="edit-block" style="${pct(b.rect, p)}"></div>`;
  }
  if (S.sel && S.sel.page === i) html += `<div class="box" style="${pct(S.sel.rect, p)}"></div>`;
  if (PE[i] === pe) pe.ov.innerHTML = html;
}
function refreshVisibleOverlays() { if (!S.doc) return; const [a, b] = visibleRange(); for (let i = Math.max(0, a - 1); i <= Math.min(PE.length - 1, b + 1); i++) refreshOverlay(i); }

// ================================================================== modes & tools
const MODES = [
  { id: "view", label: "View" }, { id: "comment", label: "Comment" }, { id: "edit", label: "Edit" },
  { id: "sign", label: "Fill & Sign" }, { id: "pages", label: "Pages" }, { id: "tools", label: "Tools" },
];
$("modes").innerHTML = MODES.map(m => `<button class="mode" data-m="${m.id}">${m.label}</button>`).join("");
$("modes").onclick = (e) => { const b = e.target.closest(".mode"); if (b) setMode(b.dataset.m); };

// kind: "draw" (drag on the page), "tap" (tap to place), "action" (runs at once)
const TOOLS = {
  view: [
    { id: "read", icon: "speaker", label: "Read aloud", kind: "action", run: () => startReading() },
    { id: "reflow", icon: "book", label: "Reading", kind: "action", run: () => openReadingMode() },
    { id: "night", icon: "moon", label: "Night", kind: "action", run: () => toggleNight() },
    { id: "toc", icon: "bookmark", label: "Bookmarks", kind: "action", run: () => toggleSide() },
    { id: "spread", icon: "layers", label: "Two pages", kind: "action", run: () => toggleSpread() },
    { id: "compare", icon: "split", label: "Compare", kind: "action", run: () => compareTool() },
    { id: "print", icon: "print", label: "Print", kind: "action", run: () => printTool() },
    { id: "goto", icon: "pages", label: "Go to page", kind: "action", run: () => askGoTo() },
    { id: "fit", icon: "fit_width", label: "Fit width", kind: "action", run: () => setZoom(1) },
    { id: "copytext", icon: "copy", label: "Copy text", kind: "draw", hint: "Drag over the text to select it." },
    { id: "info", icon: "info", label: "Properties", kind: "action", run: () => propertiesTool() },
  ],
  comment: [
    { id: "select", icon: "cursor", label: "Select", kind: "draw", hint: "Tap a comment to edit, move or delete it." },
    { id: "highlight", icon: "highlight", label: "Highlight", kind: "draw", hint: "Drag over the text." },
    { id: "underline", icon: "underline", label: "Underline", kind: "draw", hint: "Drag over the text." },
    { id: "strike", icon: "strike", label: "Strike out", kind: "draw", hint: "Drag over the text." },
    { id: "squiggly", icon: "squiggly", label: "Squiggly", kind: "draw", hint: "Drag over the text." },
    { id: "pen", icon: "pen", label: "Draw", kind: "draw", hint: "Draw with your finger. Tap Draw again to scroll." },
    { id: "rect", icon: "rect", label: "Rectangle", kind: "draw", hint: "Drag to draw a rectangle." },
    { id: "ellipse", icon: "ellipse", label: "Ellipse", kind: "draw", hint: "Drag to draw an ellipse." },
    { id: "arrow", icon: "arrow", label: "Arrow", kind: "draw", hint: "Drag to draw an arrow." },
    { id: "line", icon: "line", label: "Line", kind: "draw", hint: "Drag to draw a line." },
    { id: "note", icon: "note", label: "Note", kind: "tap", hint: "Tap where the note goes." },
    { id: "textbox", icon: "textbox", label: "Text box", kind: "tap", hint: "Tap where the text box goes." },
    { id: "stamp", icon: "stamp", label: "Stamp", kind: "tap", hint: "Tap where the stamp goes." },
    { id: "eraser", icon: "eraser", label: "Eraser", kind: "tap", hint: "Tap a comment to delete it." },
    { id: "color", icon: "color", label: "Color", kind: "action", run: () => colorTool() },
    { id: "exportnotes", icon: "text_file", label: "Export notes", kind: "action", run: () => exportNotesTool() },
  ],
  edit: [
    { id: "edittext", icon: "edit", label: "Edit text", kind: "tap", hint: "Tap a paragraph to change it." },
    { id: "addtext", icon: "add_text", label: "Add text", kind: "tap", hint: "Tap where the text goes." },
    { id: "addimage", icon: "add_image", label: "Add picture", kind: "tap", hint: "Tap where the picture goes." },
    { id: "redact", icon: "redact", label: "Redact", kind: "draw", hint: "Drag over what must disappear." },
    { id: "applyredact", icon: "redact_apply", label: "Apply redaction", kind: "action", run: () => applyRedactions() },
    { id: "watermark", icon: "watermark", label: "Watermark", kind: "action", run: () => watermarkTool() },
    { id: "pagenum", icon: "page_number", label: "Page numbers", kind: "action", run: () => pageNumbersTool() },
  ],
  sign: [
    { id: "signature", icon: "sign", label: "Signature", kind: "tap", hint: "Tap where to sign." },
    { id: "initials", icon: "pen", label: "Initials", kind: "tap", hint: "Tap where to put your initials." },
    { id: "filltext", icon: "add_text", label: "Text", kind: "tap", hint: "Tap where to write." },
    { id: "check", icon: "check", label: "Check", kind: "tap", hint: "Tap to put a check mark." },
    { id: "cross", icon: "cross", label: "Cross", kind: "tap", hint: "Tap to put a cross." },
    { id: "dot", icon: "dot", label: "Dot", kind: "tap", hint: "Tap to put a dot." },
    { id: "date", icon: "date", label: "Date", kind: "tap", hint: "Tap where the date goes." },
    { id: "flatten", icon: "flatten", label: "Flatten", kind: "action", run: () => flattenTool() },
  ],
  pages: [
    { id: "organize", icon: "thumbs", label: "Organize", kind: "action", run: () => openOrganize() },
    { id: "rotl", icon: "rotate_left", label: "Rotate left", kind: "action", run: () => rotateCurrent(-90) },
    { id: "rotr", icon: "rotate_right", label: "Rotate right", kind: "action", run: () => rotateCurrent(90) },
    { id: "blank", icon: "insert_blank", label: "Blank page", kind: "action", run: () => insertBlank(currentPage() + 1) },
    { id: "insertfile", icon: "insert", label: "Insert file", kind: "action", run: () => insertFileTool(currentPage() + 1) },
    { id: "crop", icon: "crop", label: "Crop", kind: "draw", hint: "Drag the area to keep." },
    { id: "extract", icon: "extract", label: "Extract", kind: "action", run: () => extractTool() },
    { id: "split", icon: "split", label: "Split", kind: "action", run: () => splitTool() },
    { id: "delpage", icon: "trash", label: "Delete page", kind: "action", run: () => deletePages([currentPage()]) },
  ],
  tools: [
    { id: "compress", icon: "compress", label: "Compress", kind: "action", run: () => compressTool() },
    { id: "ocr", icon: "ocr", label: "OCR", kind: "action", run: () => ocrTool() },
    { id: "toword", icon: "word", label: "To Word", kind: "action", run: () => convertTool("word") },
    { id: "toexcel", icon: "excel", label: "To Excel", kind: "action", run: () => convertTool("excel") },
    { id: "toppt", icon: "ppt", label: "To PowerPoint", kind: "action", run: () => convertTool("ppt") },
    { id: "toimg", icon: "image", label: "To images", kind: "action", run: () => convertTool("images") },
    { id: "totxt", icon: "text_file", label: "To text", kind: "action", run: () => convertTool("text") },
    { id: "protect", icon: "lock", label: "Protect", kind: "action", run: () => protectTool() },
    { id: "unlock", icon: "unlock", label: "Unlock", kind: "action", run: () => unlockTool() },
    { id: "merge", icon: "merge", label: "Merge", kind: "action", run: () => insertFileTool(S.doc.pages.length) },
    { id: "flat", icon: "flatten", label: "Flatten", kind: "action", run: () => flattenTool() },
    { id: "props", icon: "info", label: "Properties", kind: "action", run: () => propertiesTool() },
  ],
};

function moveModeMarker(snap = false) {
  const nav = $("modes"), on = nav.querySelector(".mode.on");
  if (!on) return;
  nav.classList.toggle("snap", snap);
  nav.style.setProperty("--ix", on.offsetLeft + "px");
  nav.style.setProperty("--iw", on.offsetWidth + "px");
  if (snap) { void nav.offsetWidth; nav.classList.remove("snap"); }
}
const wideMq = matchMedia("(min-width: 860px)");
function placeModes() {
  const nav = $("modes");
  if (wideMq.matches) { if (nav.parentElement.id !== "topbar") $("topbar").appendChild(nav); }
  else if (nav.parentElement.id === "topbar") $("viewer").appendChild(nav);
  moveModeMarker(true);
}
wideMq.addEventListener("change", placeModes);
window.addEventListener("resize", () => moveModeMarker(true));
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => moveModeMarker(true));
let stripMode = "";

function setMode(m) {
  S.mode = m;
  S.tool = null; S.sel = null; S.pending = null;
  document.querySelectorAll(".mode").forEach(b => b.classList.toggle("on", b.dataset.m === m));
  moveModeMarker();
  renderToolstrip();
  updateDrawing();
  hint(null);
  refreshVisibleOverlays();
  if (m === "sign" && S.doc && S.doc.forms) hint("Tap a blue field to fill it in.", 3000);
}
function renderToolstrip() {
  const list = TOOLS[S.mode];
  // the tools slide in only when the tab changes, not every time one of them is switched on
  $("toolstrip").classList.toggle("still", stripMode === S.mode);
  if (stripMode !== S.mode) $("toolstrip").scrollTo(0, 0);
  stripMode = S.mode;
  const key = (id) => (SHORTCUT_OF[id] ? ` (${SHORTCUT_OF[id]})` : "");
  $("toolstrip").innerHTML = list.filter(toolOn).map((t, k) => `<button class="tool ${S.tool && S.tool.id === t.id ? "on" : ""}" data-t="${t.id}" style="--k:${k}" title="${esc(t.label + (P.shortcuts ? key(t.id) : ""))}">${icon(t.icon)}${t.id === "color" ? `<span class="dot" style="background:${S.color}"></span>` : ""}<span>${esc(t.label)}</span></button>`).join("")
    + quickColorsHtml();
}
/** Coloured dots under the tools while highlighting or drawing: one click changes the colour. */
const MARKUP = ["highlight", "underline", "strike", "squiggly"];
function quickColorsHtml() {
  if (!P.quickColors || S.mode !== "comment" || !S.tool) return "";
  const hl = MARKUP.includes(S.tool.id);
  if (!hl && !["pen", "rect", "ellipse", "arrow", "line", "textbox", "note"].includes(S.tool.id)) return "";
  const list = hl ? ["#ffd43b", "#69db7c", "#4dabf7", "#f783ac", "#ff922b"] : ["#e0383e", "#1d2026", "#2c6bed", "#17894a", "#ff922b", "#7950f2"];
  const cur = hl ? S.hlColor : S.color;
  return `<div class="quick" role="group" aria-label="Colour">${list.map(c => `<button class="qc ${c === cur ? "on" : ""}" data-qc="${c}" data-hl="${hl ? 1 : 0}" style="--c:${c}" title="${c}"></button>`).join("")}</div>`;
}
$("toolstrip").onclick = (e) => {
  const q = e.target.closest(".qc");
  if (q) {
    if (q.dataset.hl === "1") { S.hlColor = q.dataset.qc; storeSet("hlColor", S.hlColor); } else { S.color = q.dataset.qc; storeSet("color", S.color); }
    renderToolstrip();
    return;
  }
  const b = e.target.closest(".tool");
  if (!b) return;
  const t = TOOLS[S.mode].find(x => x.id === b.dataset.t);
  if (t.kind === "action") { selectTool(null); t.run(); return; }
  selectTool(S.tool && S.tool.id === t.id ? null : t.id);
};
async function selectTool(id) {
  const t = id ? Object.values(TOOLS).flat().find(x => x.id === id) : null;
  S.sel = null; S.pending = null;
  if (t && t.id === "stamp") { const st = await chooseStamp(); if (!st) return; S.pending = { stamp: st }; }
  if (t && t.id === "addimage") { const img = await choosePicture(); if (!img) return; S.pending = { image: img }; }
  if (t && (t.id === "signature" || t.id === "initials")) { const sig = await chooseSignature(t.id); if (!sig) return; S.pending = { image: sig }; }
  S.tool = t;
  renderToolstrip();
  updateDrawing();
  hint(t ? t.hint : null);
  refreshVisibleOverlays();
}
function updateDrawing() { document.body.classList.toggle("drawing", !!(S.tool && S.tool.kind !== "action")); }
let hintTimer = 0;
function hint(text, ms = 2600) {
  const h = $("hint");
  clearTimeout(hintTimer);
  if (!text) { h.classList.add("hidden"); return; }
  h.textContent = tx(text);
  h.classList.remove("hidden");
  hintTimer = setTimeout(() => h.classList.add("hidden"), ms);
}

function banner(text, btn, fn) {
  $("bannerText").textContent = text;
  $("bannerBtn").textContent = btn || "";
  $("bannerBtn").classList.toggle("hidden", !btn);
  $("bannerBtn").onclick = () => { hideBanner(); fn && fn(); };
  $("banner").classList.remove("hidden");
}
function hideBanner() { $("banner").classList.add("hidden"); }
$("bannerClose").onclick = hideBanner;

// ================================================================== pointer input on pages
const G = { on: false };   // current gesture
function pagePoint(e, i) {
  const r = PE[i].el.getBoundingClientRect();
  const p = S.doc.pages[i];
  return [(e.clientX - r.left) / r.width * p.w, (e.clientY - r.top) / r.height * p.h];
}
function cancelGesture() {
  if (!G.on) return;
  G.on = false;
  if (G.preview) G.preview.remove();
  if (G.i != null) refreshOverlay(G.i);
}
function svgPreview(i) {
  const p = S.doc.pages[i];
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("class", "preview");
  s.setAttribute("viewBox", `0 0 ${p.w} ${p.h}`);
  s.setAttribute("preserveAspectRatio", "none");
  PE[i].el.appendChild(s);
  return s;
}

$("pages").addEventListener("pointerdown", (e) => {
  if (!S.doc || !S.tool || S.tool.kind === "action" || pinch.on) return;
  const el = e.target.closest(".page");
  if (!el || (e.pointerType === "mouse" && e.button !== 0)) return;
  const i = +el.dataset.i;
  const pt = pagePoint(e, i);
  Object.assign(G, { on: true, i, p0: pt, p1: pt, pts: [pt], moved: false, id: e.pointerId, preview: null });
  const t = S.tool.id;
  if (t === "select" && S.sel && S.sel.page === i && inRect(pt, S.sel.rect, 8)) { G.move = true; }
  else G.move = false;
  if (S.tool.kind === "draw") { try { el.setPointerCapture(e.pointerId); } catch (_) { /* */ } }
  if (t === "pen") {
    G.preview = svgPreview(i);
    G.path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    G.path.setAttribute("fill", "none"); G.path.setAttribute("stroke", S.color);
    G.path.setAttribute("stroke-width", S.width); G.path.setAttribute("stroke-linecap", "round"); G.path.setAttribute("stroke-linejoin", "round");
    G.preview.appendChild(G.path);
  }
});
$("pages").addEventListener("pointermove", (e) => {
  if (!G.on || e.pointerId !== G.id) return;
  if (pinch.on) { cancelGesture(); return; }
  const pt = pagePoint(e, G.i);
  if (Math.hypot(pt[0] - G.p0[0], pt[1] - G.p0[1]) > 3) G.moved = true;
  G.p1 = pt;
  const t = S.tool.id, p = S.doc.pages[G.i];
  if (t === "pen") {
    G.pts.push(pt);
    G.path.setAttribute("points", G.pts.map(q => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" "));
  } else if (["highlight", "underline", "strike", "squiggly", "copytext"].includes(t)) {
    markSelection(G.i, G.p0, pt);
  } else if (t === "select" && G.move) {
    const dx = pt[0] - G.p0[0], dy = pt[1] - G.p0[1], r = S.sel.rect;
    PE[G.i].ov.innerHTML = `<div class="box" style="${pct([r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy], p)}"></div>`;
  } else if (["rect", "ellipse", "arrow", "line", "redact", "crop"].includes(t)) {
    if (!G.preview) G.preview = svgPreview(G.i);
    const [a, b] = [G.p0, pt];
    const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(a[0] - b[0]), h = Math.abs(a[1] - b[1]);
    const col = t === "redact" ? "#000" : t === "crop" ? "#2f6fed" : S.color;
    const sw = (t === "redact" || t === "crop") ? 1.5 : S.width;
    let inner;
    if (t === "ellipse") inner = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="none" stroke="${col}" stroke-width="${sw}"/>`;
    else if (t === "arrow" || t === "line") inner = `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>`;
    else inner = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${t === "redact" ? "rgba(0,0,0,.35)" : "none"}" stroke="${col}" stroke-width="${sw}" ${t === "crop" ? 'stroke-dasharray="6 4"' : ""}/>`;
    G.preview.innerHTML = inner;
  }
});
$("pages").addEventListener("pointerup", (e) => { if (G.on && e.pointerId === G.id) finishGesture(); });
$("pages").addEventListener("pointercancel", (e) => { if (G.on && e.pointerId === G.id) cancelGesture(); });

function inRect(pt, r, pad = 0) { return pt[0] >= r[0] - pad && pt[0] <= r[2] + pad && pt[1] >= r[1] - pad && pt[1] <= r[3] + pad; }
function rectOf(a, b) { return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; }

// ---- text selection by dragging: words between the start and end point, in reading order
async function wordsOf(i) { return cached(i, "words", "words"); }
let selWords = [];
async function markSelection(i, a, b) {
  const ws = await wordsOf(i);
  if (!ws.length) return;
  const near = (pt) => {
    let best = 0, bd = Infinity;
    ws.forEach((w, k) => {
      const dx = pt[0] < w.x0 ? w.x0 - pt[0] : pt[0] > w.x1 ? pt[0] - w.x1 : 0;
      const dy = pt[1] < w.y0 ? w.y0 - pt[1] : pt[1] > w.y1 ? pt[1] - w.y1 : 0;
      const d = dx + dy * 3;
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  };
  let k0 = near(a), k1 = near(b);
  if (k0 > k1) [k0, k1] = [k1, k0];
  selWords = ws.slice(k0, k1 + 1);
  const p = S.doc.pages[i];
  if (G.on) PE[i].ov.innerHTML = selWords.map(w => `<div class="sel" style="${pct([w.x0, w.y0, w.x1, w.y1], p)}"></div>`).join("");
}
function lineRects(ws) {
  const m = new Map();
  for (const w of ws) {
    const k = w.block + ":" + w.line;
    const r = m.get(k);
    m.set(k, r ? [Math.min(r[0], w.x0), Math.min(r[1], w.y0), Math.max(r[2], w.x1), Math.max(r[3], w.y1)] : [w.x0, w.y0, w.x1, w.y1]);
  }
  return [...m.values()];
}
function selectionText(ws) {
  let out = "", prev = null;
  for (const w of ws) { out += prev ? (prev.line !== w.line || prev.block !== w.block ? "\n" : " ") : ""; out += w.text; prev = w; }
  return out;
}

async function finishGesture() {
  const { i, p0, p1, moved } = G;
  const t = S.tool && S.tool.id;
  G.on = false;
  if (G.preview) { G.preview.remove(); G.preview = null; }
  if (!t || !S.doc) return;
  const id = S.doc.id;
  try {
    if (t === "pen") {
      if (G.pts.length > 1) await apply("Drawing…", "addInk", [i, [G.pts.map(q => [q[0], q[1]])], S.color, S.width, 1, ""], [i]);
      return;
    }
    if (["highlight", "underline", "strike", "squiggly"].includes(t)) {
      await markSelection(i, p0, p1);
      const rects = lineRects(selWords);
      selWords = [];
      if (!rects.length) { toast("No text here. Use Draw or a shape for pictures."); refreshOverlay(i); return; }
      await apply("Adding…", "addMarkup", [i, t, rects, t === "highlight" ? S.hlColor : S.color, 1, ""], [i]);
      return;
    }
    if (t === "copytext") {
      await markSelection(i, p0, p1);
      const text = selectionText(selWords);
      selWords = [];
      refreshOverlay(i);
      if (text) textActions(i, text);
      return;
    }
    if (["rect", "ellipse", "arrow", "line"].includes(t)) {
      if (!moved) return;
      await apply("Adding…", "addShape", [i, t, p0, p1, S.color, S.width, null, ""], [i]);
      return;
    }
    if (t === "redact") {
      if (!moved) return;
      await apply("Marking…", "addRedaction", [i, rectOf(p0, p1)], [i]);
      banner("Marked areas are not removed until you apply the redaction.", "Apply now", () => applyRedactions());
      return;
    }
    if (t === "crop") {
      if (!moved) return;
      const r = rectOf(p0, p1);
      const v = await choose("Crop", [{ value: "one", label: "This page", icon: "crop" }, { value: "all", label: "All pages", icon: "pages" }]);
      if (!v) return;
      const pages = v === "all" ? S.doc.pages.map((_, k) => k) : [i];
      await apply("Cropping…", "cropPages", [pages, r], pages);
      selectTool(null);
      return;
    }
    if (t === "select") {
      if (G.move && moved && S.sel) {
        const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
        const ok = await apply("Moving…", "moveAnnot", [i, S.sel.index, dx, dy], [i]);
        if (ok === false) toast("Highlights stay on their text.");
        return;
      }
      if (!moved) await tapSelect(i, p0);
      return;
    }
    if (moved) return;  // the remaining tools react to taps
    await tapTool(t, i, p0);
  } catch (e) { showError(e); }
}

async function annotAt(i, pt) {
  const list = await call("annotations", S.doc.id, i);
  let best = null;
  for (const a of list) if (inRect(pt, a.rect, 6)) { if (!best || area(a.rect) < area(best.rect)) best = a; }
  return best;
}
const area = (r) => (r[2] - r[0]) * (r[3] - r[1]);

async function tapSelect(i, pt) {
  const a = await annotAt(i, pt);
  if (!a) { S.sel = null; refreshOverlay(i); return; }
  S.sel = { page: i, index: a.index, rect: a.rect, type: a.type };
  refreshOverlay(i);
  annotActions(i, a);
}
async function annotActions(i, a) {
  const items = [];
  if (["Text", "FreeText"].includes(a.type) || a.contents) items.push({ value: "text", label: a.type === "FreeText" ? "Edit text" : "Edit note", icon: "edit", sub: a.contents ? a.contents.slice(0, 80) : "" });
  items.push({ value: "color", label: "Change color", icon: "color" });
  if (!["Highlight", "Underline", "StrikeOut", "Squiggly"].includes(a.type)) items.push({ value: "move", label: "Move", icon: "hand", sub: "Drag the blue box" });
  items.push({ value: "delete", label: "Delete", icon: "trash" });
  const v = await choose(typeName(a.type) + (a.author ? " · " + a.author : ""), items);
  if (v === "delete") { await apply("Deleting…", "deleteAnnot", [i, a.index], [i]); }
  else if (v === "color") {
    const c = await pickColor(a.color || S.color);
    if (c) await apply("Changing…", "setAnnotColor", [i, a.index, c], [i]);
  } else if (v === "text") {
    const r = await form(typeName(a.type), [{ name: "t", type: "textarea", value: a.contents }], "Save");
    if (r) await apply("Saving…", "setAnnotText", [i, a.index, r.t], [i]);
  } else if (v === "move") hint("Drag the blue box to move it.");
  else { S.sel = null; refreshOverlay(i); }
}
function typeName(t) {
  return ({ Text: "Note", FreeText: "Text box", Highlight: "Highlight", Underline: "Underline", StrikeOut: "Strike out", Squiggly: "Squiggly",
    Ink: "Drawing", Square: "Rectangle", Circle: "Ellipse", Line: "Line", Stamp: "Stamp", Redact: "Redaction mark" })[t] || t;
}

async function textActions(i, text) {
  const v = await choose("Selected text", [
    { value: "copy", label: "Copy", icon: "copy", sub: text.slice(0, 120) },
    { value: "speak", label: "Read aloud", icon: "speaker" },
    { value: "search", label: "Find in document", icon: "search" },
  ]);
  if (v === "copy") {
    try { await navigator.clipboard.writeText(text); toast("Copied."); }
    catch (_) {
      const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove(); toast("Copied.");
    }
  } else if (v === "speak") speakText(text);
  else if (v === "search") { openSearch(); $("searchInput").value = text.slice(0, 60); runSearch(); }
}

// ---- tap tools
async function tapTool(t, i, pt) {
  const id = S.doc.id, p = S.doc.pages[i];
  if (t === "note") {
    const r = await form("Note", [{ name: "t", type: "textarea", placeholder: "Write a note" }], "Add");
    if (r && r.t.trim()) await apply("Adding…", "addNote", [i, [pt[0] - 10, pt[1] - 10], r.t, S.hlColor, ""], [i]);
  } else if (t === "textbox") {
    const r = await form("Text box", [{ name: "t", type: "textarea", placeholder: "Text" }, { name: "size", label: "Size", type: "number", value: 12, min: 4, max: 96 }], "Add");
    if (r && r.t.trim()) {
      const size = r.size || 12, lines = r.t.split("\n");
      const longest = Math.max(...lines.map(l => l.length));
      const w = Math.min(p.w - pt[0] - 4, Math.max(60, longest * size * 0.55 + 10)), h = lines.length * size * 1.3 + 8;
      await apply("Adding…", "addTextBox", [i, [pt[0], pt[1], pt[0] + w, pt[1] + h], r.t, size, S.color, ""], [i]);
    }
  } else if (t === "stamp" && S.pending && S.pending.stamp) {
    const w = 150, h = 42;
    await apply("Adding…", "addStamp", [i, [pt[0] - w / 2, pt[1] - h / 2, pt[0] + w / 2, pt[1] + h / 2], null, S.pending.stamp, ""], [i]);
  } else if (t === "eraser") {
    const a = await annotAt(i, pt);
    if (a) await apply("Deleting…", "deleteAnnot", [i, a.index], [i]);
    else toast("No comment here.");
  } else if (t === "edittext") {
    const blocks = await cached(i, "blocks", "textBlocks");
    const b = blocks.find(b => inRect(pt, b.rect, 3));
    if (!b) { toast("Tap on a paragraph."); return; }
    const r = await form("Edit text", [
      { name: "t", type: "textarea", value: b.text, rows: Math.min(10, b.lines.length + 1) },
      { name: "size", label: "Size", type: "number", value: Math.round(b.size * 10) / 10, min: 3, max: 120 },
      { name: "color", label: "Color", type: "color", value: b.color || "#000000", options: ["#000000", "#1d2026", "#5d6470", "#e0383e", "#1c7ed6", "#2b8a3e", "#ffffff"] },
      { name: "bold", type: "check", text: "Bold", value: b.bold },
    ], "Save", "The paragraph is rewritten with a standard font.");
    if (r) await apply("Saving…", "replaceText", [i, b.rect, r.t, r.size || b.size, r.color || "#000000", r.bold ? "Helvetica-Bold" : "Helvetica"], [i]);
  } else if (t === "addtext" || t === "filltext") {
    const r = await form(t === "filltext" ? "Text" : "Add text", [
      { name: "t", type: "textarea", placeholder: "Text", rows: 3 },
      { name: "size", label: "Size", type: "number", value: t === "filltext" ? 11 : 12, min: 3, max: 120 },
      { name: "color", label: "Color", type: "color", value: "#000000", options: ["#000000", "#e0383e", "#1c7ed6", "#2b8a3e", "#5d6470", "#ffffff"] },
      { name: "bold", type: "check", text: "Bold", value: false },
    ], "Add");
    if (r && r.t.trim()) await apply("Adding…", "addText", [i, pt[0], pt[1] + (r.size || 12) * 0.35, r.t, r.size || 12, r.color, r.bold ? "Helvetica-Bold" : "Helvetica"], [i]);
  } else if ((t === "addimage" || t === "signature" || t === "initials") && S.pending && S.pending.image) {
    const img = S.pending.image;
    const w = t === "addimage" ? Math.min(220, p.w * 0.45) : t === "initials" ? 60 : 150;
    const h = w * img.h / img.w;
    const r = [pt[0] - w / 2, pt[1] - h / 2, pt[0] + w / 2, pt[1] + h / 2];
    await apply("Adding…", "addImage", [i, r, img.bytes.slice()], [i]);
    if (t === "addimage") selectTool(null);
  } else if (t === "check" || t === "cross" || t === "dot") {
    const s = 12;
    await apply("Adding…", "drawSymbol", [i, [pt[0] - s / 2, pt[1] - s / 2, pt[0] + s / 2, pt[1] + s / 2], t, "#000000"], [i]);
  } else if (t === "date") {
    const d = new Date().toLocaleDateString(navigator.language || "en-GB");
    await apply("Adding…", "addText", [i, pt[0], pt[1] + 4, d, 11, "#000000", "Helvetica"], [i]);
  }
}

// ---- taps without a tool: links, notes, form fields, double tap to zoom
let lastTap = { t: 0, x: 0, y: 0 };
$("pages").addEventListener("click", async (e) => {
  if (!S.doc || (S.tool && S.tool.kind !== "action")) return;
  const el = e.target.closest(".page");
  if (!el) return;
  const i = +el.dataset.i, pt = pagePoint(e, i);
  const now = Date.now();
  if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
    lastTap.t = 0;
    const r = $("scroller").getBoundingClientRect();
    setZoom(S.zoom > 1.3 ? 1 : 2.2, e.clientX - r.left, e.clientY - r.top);
    return;
  }
  lastTap = { t: now, x: e.clientX, y: e.clientY };
  // form fields
  if (S.doc.forms) {
    const ws = await cached(i, "widgets", "widgets");
    const w = ws.find(w => inRect(pt, w.rect, 2) && !w.readOnly);
    if (w) { await fillField(i, w); return; }
  }
  // links
  const ls = await cached(i, "links", "links");
  const l = ls.find(l => inRect(pt, l.rect, 2));
  if (l) {
    if (l.page >= 0) goToPage(l.page);
    else if (l.uri && /^(https?|mailto|tel):/i.test(l.uri)) { if (await confirmBox("Open link?", l.uri, "Open")) openUrl(l.uri); }
    return;
  }
  // notes and other comments
  const a = await annotAt(i, pt);
  if (a && (a.type === "Text" || a.type === "FreeText" || S.mode === "comment")) {
    S.sel = { page: i, index: a.index, rect: a.rect, type: a.type };
    refreshOverlay(i);
    annotActions(i, a);
  }
});

// ================================================================== forms
async function fillField(i, w) {
  const t = w.type;
  if (t === "checkbox" || t === "radiobutton") {
    await apply("Saving…", "setWidget", [i, w.index, ""], [i]);
    return;
  }
  if (t === "signature") {
    const sig = await chooseSignature("signature");
    if (!sig) return;
    const r = w.rect, bw = r[2] - r[0], bh = r[3] - r[1];
    const k = Math.min(bw / sig.w, bh / sig.h);
    const iw = sig.w * k, ih = sig.h * k;
    const x = r[0] + (bw - iw) / 2, y = r[1] + (bh - ih) / 2;
    await apply("Signing…", "addImage", [i, [x, y, x + iw, y + ih], sig.bytes.slice()], [i]);
    return;
  }
  let v;
  if (t === "combobox" || t === "listbox") {
    const opts = (w.options || []).map(o => Array.isArray(o) ? o[o.length - 1] : o);
    v = await choose(w.name || "Choose", opts.map(o => ({ value: String(o), label: String(o), icon: String(o) === w.value ? "check" : "dot" })));
    if (v == null) return;
  } else {
    const r = await form(w.name || "Field", [{ name: "v", type: w.multiline ? "textarea" : "text", value: w.value || "" }], "OK");
    if (!r) return;
    v = r.v;
  }
  await apply("Saving…", "setWidget", [i, w.index, v], [i]);
}

// ================================================================== pickers: color, stamp, picture, signature
function pickColor(value) {
  return form("Color", [{ name: "c", type: "color", value, options: PALETTE }], "OK").then(r => r && r.c);
}
async function colorTool() {
  const r = await form("Color & line", [
    { name: "c", label: "Pen & shapes", type: "color", value: S.color },
    { name: "h", label: "Highlight", type: "color", value: S.hlColor, options: ["#ffd43b", "#69db7c", "#4dabf7", "#f783ac", "#ff922b"] },
    { name: "w", label: "Line width", type: "range", min: 1, max: 12, step: 0.5, value: S.width },
  ], "OK");
  if (!r) return;
  S.color = r.c || S.color; S.hlColor = r.h || S.hlColor; S.width = r.w || S.width;
  storeSet("color", S.color); storeSet("hlColor", S.hlColor); storeSet("width", S.width);
  renderToolstrip();
}
const STAMPS = ["Approved", "Draft", "Confidential", "Final", "Not Approved", "For Comment", "Expired", "Top Secret", "Departmental", "For Public Release"];
async function chooseStamp() {
  const mine = storeGet("stamps", []);
  const v = await choose("Stamp", [
    ...mine.map(s => ({ value: "m:" + s, label: s, icon: "stamp", sub: "Your stamp" })),
    ...STAMPS.map(s => ({ value: s, label: s, icon: "stamp" })),
    { value: "+new", label: "New stamp…", icon: "plus", sub: "Your own text, saved for next time" },
    ...(mine.length ? [{ value: "+del", label: "Delete one of your stamps", icon: "trash" }] : []),
  ]);
  if (!v) return null;
  if (v === "+new") {
    const r = await form("New stamp", [{ name: "t", label: "Text", type: "text", placeholder: "e.g. Checked by Gabriele", required: true }], "Save");
    if (!r || !r.t.trim()) return null;
    const t = r.t.trim().slice(0, 40);
    storeSet("stamps", [t, ...mine.filter(x => x !== t)].slice(0, 20));
    return t;
  }
  if (v === "+del") {
    const d = await choose("Delete which stamp?", mine.map(s => ({ value: s, label: s, icon: "trash" })));
    if (d) { storeSet("stamps", mine.filter(x => x !== d)); toast("Deleted."); }
    return null;
  }
  return v.startsWith("m:") ? v.slice(2) : v;
}

async function imageInfo(bytes, mime) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: mime || "image/jpeg" }));
  const r = { w: bmp.width, h: bmp.height };
  bmp.close && bmp.close();
  return r;
}
async function choosePicture() {
  const files = await pickFiles("image/*", false);
  if (!files.length) return null;
  const f = files[0];
  try {
    let bytes = await readFile(f);
    bytes = await normalizeImage(bytes, f.mime, f.name);
    const dim = await imageInfo(bytes, /png/.test(f.mime || "") ? "image/png" : "image/jpeg");
    return { bytes, ...dim };
  } catch (e) { showError(e); return null; } finally { releaseFile(f); }
}

// signatures: drawn with the finger, remembered on the phone
async function chooseSignature(kind) {
  const key = kind === "initials" ? "initials" : "signatures";
  const saved = storeGet(key, []);
  if (saved.length) {
    const items = saved.map((s, k) => ({ value: "s" + k, label: kind === "initials" ? "Initials " + (k + 1) : "Signature " + (k + 1),
      html: `<img src="${s.url}" style="height:38px;max-width:140px;background:#fff;border-radius:6px;padding:2px">` }));
    items.push({ value: "new", label: "New " + (kind === "initials" ? "initials" : "signature"), icon: "plus" });
    items.push({ value: "manage", label: "Delete saved", icon: "trash" });
    const v = await choose(kind === "initials" ? "Initials" : "Signature", items);
    if (!v) return null;
    if (v === "manage") {
      const d = await choose("Delete which one?", saved.map((s, k) => ({ value: k, label: "Delete " + (k + 1), html: `<img src="${s.url}" style="height:34px;background:#fff;border-radius:6px">` })));
      if (d != null) { saved.splice(d, 1); storeSet(key, saved); toast("Deleted."); }
      return null;
    }
    if (v !== "new") return dataUrlToSig(saved[+v.slice(1)].url);
  }
  const url = await drawPad(kind === "initials" ? "Draw your initials" : "Draw your signature");
  if (!url) return null;
  if (url.remember) { saved.unshift({ url: url.url }); storeSet(key, saved.slice(0, 6)); }
  return dataUrlToSig(url.url);
}
async function dataUrlToSig(url) {
  const bytes = Uint8Array.from(atob(url.split(",")[1]), c => c.charCodeAt(0));
  const dim = await imageInfo(bytes, "image/png");
  return { bytes, ...dim };
}
function drawPad(title) {
  let color = "#1d2026";
  return sheet(`<h3>${esc(title)}</h3><canvas class="pad"></canvas>
    <div class="row"><div class="colors">${["#1d2026", "#1c4fd6", "#e0383e"].map((c, k) => `<button class="color ${k ? "" : "on"}" data-c="${c}" style="background:${c}"></button>`).join("")}</div>
    <button class="text-btn" data-clear style="margin-left:auto">Clear</button></div>
    <label class="chk"><input type="checkbox" data-rem checked> <span>Remember on this phone</span></label>
    <div class="btns"><button data-no>Cancel</button><button class="ok" data-ok>Use</button></div>`,
  card => {
    const cv = card.querySelector("canvas");
    const dpr = window.devicePixelRatio || 1;
    cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
    const g = cv.getContext("2d");
    g.lineCap = "round"; g.lineJoin = "round"; g.lineWidth = 2.6 * dpr;
    let drawing = false, any = false, last = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr]; };
    cv.onpointerdown = (e) => { drawing = true; any = true; last = pos(e); cv.setPointerCapture(e.pointerId); g.strokeStyle = color; g.beginPath(); g.arc(last[0], last[1], g.lineWidth / 2, 0, 7); g.fillStyle = color; g.fill(); };
    cv.onpointermove = (e) => {
      if (!drawing) return;
      const p = pos(e);
      g.beginPath(); g.moveTo(last[0], last[1]);
      const mid = [(last[0] + p[0]) / 2, (last[1] + p[1]) / 2];
      g.quadraticCurveTo(last[0], last[1], mid[0], mid[1]); g.lineTo(p[0], p[1]); g.stroke();
      last = p;
    };
    cv.onpointerup = cv.onpointercancel = () => { drawing = false; };
    card.querySelectorAll(".color").forEach(b => b.onclick = () => { card.querySelectorAll(".color").forEach(x => x.classList.remove("on")); b.classList.add("on"); color = b.dataset.c; });
    card.querySelector("[data-clear]").onclick = () => { g.clearRect(0, 0, cv.width, cv.height); any = false; };
    card.querySelector("[data-no]").onclick = () => closeSheet(null);
    card.querySelector("[data-ok]").onclick = () => {
      if (!any) { toast("Draw first."); return; }
      closeSheet({ url: trimCanvas(cv), remember: card.querySelector("[data-rem]").checked });
    };
  });
}
function trimCanvas(cv) {
  const g = cv.getContext("2d");
  const { width: w, height: h } = cv;
  const d = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const c = document.createElement("canvas");
  c.width = x1 - x0 + 1; c.height = y1 - y0 + 1;
  c.getContext("2d").drawImage(cv, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

// ================================================================== edit tools
async function applyRedactions() {
  const n = await apply("Removing content…", "applyRedactions", [], "all");
  hideBanner();
  if (n === 0) toast("Nothing is marked. Use Redact to mark areas first.");
  else if (n) toast(`${n} area(s) removed for good. Save to keep the change.`);
}
async function askPages(title) {
  const n = S.doc.pages.length;
  if (n === 1) return [0];
  const r = await form(title, [{ name: "which", label: "Pages", type: "seg", value: "all", options: [{ value: "all", label: "All" }, { value: "cur", label: "This page" }, { value: "range", label: "Range" }] },
    { name: "range", label: "Range", type: "text", placeholder: "e.g. 1-3, 5", value: "" }], "Next");
  if (!r) return null;
  if (r.which === "all") return [...Array(n).keys()];
  if (r.which === "cur") return [currentPage()];
  const pages = parseRange(r.range, n);
  if (!pages.length) { toast("Write the pages like 1-3, 5."); return null; }
  return pages;
}
function parseRange(s, n) {
  const out = new Set();
  for (const part of String(s || "").split(/[,;\s]+/)) {
    const m = /^(\d+)(?:-(\d*))?$/.exec(part.trim());
    if (!m) continue;
    const a = +m[1], b = m[2] === undefined ? a : m[2] === "" ? n : +m[2];
    for (let k = Math.min(a, b); k <= Math.max(a, b); k++) if (k >= 1 && k <= n) out.add(k - 1);
  }
  return [...out].sort((a, b) => a - b);
}
async function watermarkTool() {
  const r = await form("Watermark", [
    { name: "text", label: "Text", type: "text", value: "CONFIDENTIAL" },
    { name: "size", label: "Size", type: "number", value: 60, min: 8, max: 300 },
    { name: "color", label: "Color", type: "color", value: "#e0383e", options: ["#e0383e", "#1d2026", "#5d6470", "#1c7ed6", "#2b8a3e"] },
    { name: "opacity", label: "Opacity", type: "range", min: 5, max: 100, step: 5, value: 25, fmt: v => v + "%" },
    { name: "angle", label: "Angle", type: "seg", value: "45", options: [{ value: "0", label: "0°" }, { value: "45", label: "45°" }, { value: "90", label: "90°" }] },
    { name: "tile", type: "check", text: "Repeat across the page", value: false },
  ], "Next");
  if (!r || !r.text.trim()) return;
  const pages = await askPages("Watermark pages");
  if (!pages) return;
  await apply("Adding watermark…", "watermark", [pages, r.text, r.size || 60, r.color, (r.opacity || 25) / 100, +r.angle, r.tile], pages);
}
async function pageNumbersTool() {
  const r = await form("Page numbers", [
    { name: "fmt", label: "Format", type: "select", value: "{n}", options: [{ value: "{n}", label: "1" }, { value: "{n} / {total}", label: "1 / 10" }, { value: "Page {n}", label: "Page 1" }, { value: "Page {n} of {total}", label: "Page 1 of 10" }, { value: "- {n} -", label: "- 1 -" }] },
    { name: "pos", label: "Position", type: "select", value: "bottom-center", options: [
      { value: "bottom-center", label: "Bottom center" }, { value: "bottom-right", label: "Bottom right" }, { value: "bottom-left", label: "Bottom left" },
      { value: "top-center", label: "Top center" }, { value: "top-right", label: "Top right" }, { value: "top-left", label: "Top left" }] },
    { name: "start", label: "Start at", type: "number", value: 1, min: 0 },
    { name: "size", label: "Size", type: "number", value: 11, min: 5, max: 40 },
  ], "Next");
  if (!r) return;
  const pages = await askPages("Number which pages");
  if (!pages) return;
  await apply("Numbering…", "pageNumbers", [pages, r.fmt, r.pos, r.start ?? 1, r.size || 11, "#000000", 28], pages);
}
async function flattenTool() {
  if (!(await confirmBox("Flatten", "Comments and form fields become part of the page and can no longer be changed.", "Flatten"))) return;
  await apply("Flattening…", "flatten", [], "all");
}

// ================================================================== pages
async function rotateCurrent(delta) { const i = currentPage(); await apply("Rotating…", "rotatePages", [[i], delta], [i]); }
async function insertBlank(at) { await apply("Adding page…", "insertBlank", [at], "all"); goToPage(at); }
async function deletePages(pages) {
  if (pages.length >= S.doc.pages.length) { toast("A PDF must keep at least one page."); return false; }
  if (!(await confirmBox(`Delete ${pages.length === 1 ? "page " + (pages[0] + 1) : pages.length + " pages"}?`, "", "Delete"))) return false;
  await apply("Deleting…", "deletePages", [pages], "all");
  return true;
}
async function insertFileTool(at) {
  const files = await pickFiles("application/pdf,image/*", true);
  if (!files.length) return;
  for (const f of files) {
    try {
      let bytes = await readFile(f);
      if (/^image\//.test(f.mime || "")) bytes = await call("imagesToPdf", [{ bytes: await normalizeImage(bytes, f.mime, f.name), name: f.name }], "A4", 0);
      let pw = null;
      for (;;) {
        try {
          await task("Inserting " + f.name + "…", async () => { const inf = await call("insertFile", S.doc.id, at, bytes.slice(), f.name.endsWith(".pdf") ? f.name : "x.pdf", pw); await changed("all", inf); });
          break;
        } catch (e) {
          if (!/NEEDS_PASSWORD/.test(e.message)) throw e;
          const r = await form("Password needed", [{ name: "pw", label: "Password", type: "password" }], "OK", f.name);
          if (!r) break;
          pw = r.pw;
        }
      }
    } catch (e) { showError(e); } finally { releaseFile(f); }
  }
  toast("Pages added.");
}
async function extractTool(pages) {
  pages = pages || await askPages("Extract pages");
  if (!pages) return;
  const bytes = await task("Extracting…", () => call("extract", S.doc.id, pages));
  if (bytes) await deliver(bytes, `${baseName(S.doc.name)}-pages.pdf`, MIME.pdf, "Extracted pages");
}
async function splitTool() {
  const n = S.doc.pages.length;
  const r = await form("Split", [
    { name: "how", label: "Split", type: "seg", value: "every", options: [{ value: "every", label: "Every N pages" }, { value: "ranges", label: "By ranges" }] },
    { name: "n", label: "N", type: "number", value: 1, min: 1, max: n },
    { name: "ranges", label: "Ranges", type: "text", placeholder: "e.g. 1-3; 4-6; 7-" },
  ], "Split");
  if (!r) return;
  let groups = [];
  if (r.how === "every") { const k = Math.max(1, r.n || 1); for (let a = 0; a < n; a += k) groups.push([...Array(Math.min(k, n - a)).keys()].map(x => x + a)); }
  else groups = String(r.ranges || "").split(";").map(s => parseRange(s, n)).filter(g => g.length);
  if (!groups.length) { toast("Nothing to split."); return; }
  const out = await task("Splitting…", async () => {
    const files = [];
    for (const [k, g] of groups.entries()) {
      checkCancel();
      progress(k / groups.length);
      files.push({ name: `${baseName(S.doc.name)}-${g[0] + 1}${g.length > 1 ? "-" + (g[g.length - 1] + 1) : ""}.pdf`, bytes: await call("extract", S.doc.id, g) });
    }
    return files.length === 1 ? files[0] : { name: baseName(S.doc.name) + "-split.zip", bytes: await C.zip(files) };
  }, { cancellable: true, progress: true });
  if (out) await deliver(out.bytes, out.name, out.name.endsWith(".zip") ? MIME.zip : MIME.pdf, `${groups.length} file(s)`);
}

// ---- organize screen (thumbnails)
const ORG = { sel: new Set() };
async function openOrganize() {
  if (!S.doc) return;
  show("organize");
  ORG.sel = new Set();
  buildGrid();
}
function buildGrid() {
  const g = $("grid");
  const gen = S.gen + ":" + Date.now();
  g.dataset.gen = gen;
  g.innerHTML = S.doc.pages.map((p, i) => `<button class="thumb" data-i="${i}" ${PHONE || !on("dragpages") ? "" : 'draggable="true"'}><div class="tw"><img alt="" style="aspect-ratio:${p.w}/${p.h};width:${p.w > p.h ? 100 : 100 * p.w / p.h}%"></div>${i + 1}</button>`).join("");
  const io = new IntersectionObserver(async (entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      const i = +en.target.dataset.i;
      try {
        const p = S.doc.pages[i];
        const jpg = await call("renderJPEG", S.doc.id, i, Math.min(1, 220 / Math.max(p.w, p.h)), 70);
        if (g.dataset.gen !== gen) return;
        const img = en.target.querySelector("img");
        img.src = URL.createObjectURL(new Blob([jpg], { type: "image/jpeg" }));
        img.onload = () => URL.revokeObjectURL(img.src);
      } catch (_) { /* */ }
    }
  }, { root: g, rootMargin: "300px" });
  g.querySelectorAll(".thumb").forEach(t => io.observe(t));
  updateOrgBar();
}
$("grid").onclick = (e) => {
  const t = e.target.closest(".thumb");
  if (!t) return;
  const i = +t.dataset.i;
  if (ORG.sel.has(i)) ORG.sel.delete(i); else ORG.sel.add(i);
  t.classList.toggle("on", ORG.sel.has(i));
  updateOrgBar();
};
$("orgAll").onclick = () => {
  const all = ORG.sel.size !== S.doc.pages.length;
  ORG.sel = new Set(all ? S.doc.pages.map((_, i) => i) : []);
  $("grid").querySelectorAll(".thumb").forEach(t => t.classList.toggle("on", ORG.sel.has(+t.dataset.i)));
  updateOrgBar();
};
$("orgBack").onclick = () => closeOrganize();
function closeOrganize() { show("viewer"); layout(); }
const ORG_ACTIONS = [
  { id: "left", icon: "left", label: "Move left", need: 1 }, { id: "right", icon: "right", label: "Move right", need: 1 },
  { id: "rotl", icon: "rotate_left", label: "Rotate", need: 1 }, { id: "rotr", icon: "rotate_right", label: "Rotate", need: 1 },
  { id: "dup", icon: "duplicate", label: "Duplicate", need: 1 }, { id: "extract", icon: "extract", label: "Extract", need: 1 },
  { id: "del", icon: "trash", label: "Delete", need: 1 }, { id: "blank", icon: "insert_blank", label: "Blank page", need: 0 },
  { id: "file", icon: "insert", label: "Insert file", need: 0 },
  { id: "copyto", icon: "copy", label: "Copy to tab", need: 1, tabs: true },
];
function updateOrgBar() {
  $("orgTitle").textContent = ORG.sel.size ? `${ORG.sel.size} selected` : `${S.doc.pages.length} pages`;
  $("orgAll").textContent = ORG.sel.size === S.doc.pages.length ? "Select none" : "Select all";
  $("orgActions").innerHTML = ORG_ACTIONS.filter(a => (!a.tabs || (TABS.length > 1 && on("copyto")))).map(a => `<button class="tool" data-a="${a.id}" ${a.need && !ORG.sel.size ? "disabled style=opacity:.4" : ""}>${icon(a.icon)}<span>${a.label}</span></button>`).join("");
}
$("orgActions").onclick = async (e) => {
  const b = e.target.closest(".tool");
  if (!b || b.disabled) return;
  const sel = [...ORG.sel].sort((a, b) => a - b);
  const n = S.doc.pages.length;
  const after = sel.length ? sel[sel.length - 1] + 1 : n;
  const id = S.doc.id;
  let keepSel = null;
  switch (b.dataset.a) {
    case "left": case "right": {
      const order = [...Array(n).keys()];
      const set = new Set(sel);
      if (b.dataset.a === "left") { for (let k = 1; k < n; k++) if (set.has(order[k]) && !set.has(order[k - 1])) [order[k - 1], order[k]] = [order[k], order[k - 1]]; }
      else { for (let k = n - 2; k >= 0; k--) if (set.has(order[k]) && !set.has(order[k + 1])) [order[k + 1], order[k]] = [order[k], order[k + 1]]; }
      await task("Moving…", async () => { const inf = await call("reorder", id, order); await changed("all", inf); });
      keepSel = sel.map(i => order.indexOf(i));
      break;
    }
    case "rotl": case "rotr":
      await task("Rotating…", async () => { const inf = await call("rotatePages", id, sel, b.dataset.a === "rotl" ? -90 : 90); await changed(sel, inf); });
      keepSel = sel; break;
    case "dup": await task("Duplicating…", async () => { const inf = await call("duplicatePages", id, sel); await changed("all", inf); }); break;
    case "extract": await extractTool(sel); return;
    case "del": if (!(await deletePages(sel))) return; break;
    case "blank": await task("Adding…", async () => { const inf = await call("insertBlank", id, after); await changed("all", inf); }); break;
    case "file": await insertFileTool(after); break;
    case "copyto": {
      const others = TABS.filter(t => t.doc !== S.doc);
      const v = await choose("Copy the pages to…", others.map((t, k) => ({ value: k, label: t.doc.name, icon: "pdf", sub: "At the end" })));
      if (v != null) await copyPagesTo(sel, others[v]);
      keepSel = sel; break;
    }
  }
  ORG.sel = new Set(keepSel || []);
  buildGrid();
  $("grid").querySelectorAll(".thumb").forEach(t => t.classList.toggle("on", ORG.sel.has(+t.dataset.i)));
};

// ================================================================== tools: compress, OCR, conversions, security
async function compressTool() {
  const v = await choose("Compress", [
    { value: "lossless", label: "No quality loss", sub: "Removes metadata, trims fonts, packs the file tighter. Pages look exactly the same.", icon: "check" },
    { value: "rec", label: "Recommended", sub: "Pictures at good quality, text untouched", icon: "compress" },
    { value: "strong", label: "Strong", sub: "Smaller pictures, still readable", icon: "compress" },
    { value: "max", label: "Smallest", sub: "Every page becomes a picture (text can no longer be selected)", icon: "image" },
  ]);
  if (!v) return;
  const d = S.doc;
  const res = await task("Compressing…", async () => {
    const before = (await call("save", d.id, {})).length;
    if (v === "max") {
      const bytes = await call("rasterize", d.id, 110, 55);
      return { before, bytes };
    }
    if (v === "lossless") { const after = await call("cleanup", d.id, { meta: P.cleanMeta, fonts: P.cleanFonts }); return { before, after, n: 0, lossless: true }; }
    const n = await call("compressImages", d.id, v === "rec" ? 1700 : 1100, v === "rec" ? 72 : 52);
    const after = await call("cleanup", d.id, { meta: P.cleanMeta, fonts: P.cleanFonts });
    return { before, after, n };
  });
  if (!res) return;
  if (res.bytes) {
    if (res.bytes.length >= res.before) { toast("This PDF is already as small as it can get."); return; }
    await deliver(res.bytes, `${baseName(d.name)}-compressed.pdf`, MIME.pdf, `${fmtSize(res.before)} → ${fmtSize(res.bytes.length)}`);
    return;
  }
  await changed("all");
  const pctv = Math.round((1 - res.after / res.before) * 100);
  if (res.after < res.before * 0.97) {
    alertBox("Compressed", `${fmtSize(res.before)} → ${fmtSize(res.after)} (−${pctv}%). Save the document to keep the smaller file.`);
  } else {
    alertBox("Already small", `There is not much to gain here (${fmtSize(res.before)}). ${res.lossless ? "Try “Recommended” if the file has photos, or “Smallest” for scans." : "Try “Smallest” if the file is a scan."}`);
  }
}

async function ocrTool() {
  const d = S.doc;
  const r = await form("Recognize text (OCR)", [
    { name: "lang", label: "Language", type: "seg", value: storeGet("ocrLang", "eng+ita"), options: [{ value: "eng", label: "English" }, { value: "ita", label: "Italian" }, { value: "eng+ita", label: "Both" }] },
    { name: "all", type: "check", text: "Also pages that already have text", value: false },
  ], "Start", "Scanned pages get an invisible text layer: you can then search, select and copy the text.");
  if (!r) return;
  storeSet("ocrLang", r.lang);
  const done = await task("Preparing OCR…", async () => {
    const n = d.pages.length;
    let count = 0;
    for (let i = 0; i < n; i++) {
      checkCancel();
      progress(i / n, `Reading page ${i + 1} of ${n}…`);
      if (!r.all) { const t = (await call("pageText", d.id, i)).trim(); if (t.length > 20) continue; }
      const words = await C.ocrPage(d.id, i, d.pages[i], r.lang);
      checkCancel();
      if (words.length) { await call("addInvisibleWords", d.id, i, words); count++; }
    }
    return count;
  }, { cancellable: true, progress: true });
  if (done === undefined) return;
  await changed("all");
  if (done) toast(`Text recognized on ${done} page(s). Save to keep it.`);
  else toast("No pages needed OCR (they already have text).");
}

async function convertTool(kind) {
  const d = S.doc;
  const n = d.pages.length;
  const base = baseName(d.name);
  if (kind === "images") {
    const r = await form("PDF to images", [
      { name: "fmt", label: "Format", type: "seg", value: "jpg", options: [{ value: "jpg", label: "JPG" }, { value: "png", label: "PNG" }] },
      { name: "dpi", label: "Quality", type: "seg", value: "150", options: [{ value: "96", label: "Low" }, { value: "150", label: "Medium" }, { value: "300", label: "High" }] },
    ], "Next");
    if (!r) return;
    const pages = await askPages("Which pages");
    if (!pages) return;
    const out = await task("Making images…", async () => {
      const imgs = [];
      for (const [k, i] of pages.entries()) {
        checkCancel(); progress(k / pages.length, `Page ${i + 1}`);
        imgs.push({ name: `${base}-${i + 1}.${r.fmt}`, bytes: r.fmt === "png" ? await call("renderPNG", d.id, i, +r.dpi / 72) : await call("renderJPEG", d.id, i, +r.dpi / 72, 88) });
      }
      return imgs.length === 1 ? imgs[0] : { name: base + "-images.zip", bytes: await C.zip(imgs) };
    }, { cancellable: true, progress: true });
    if (out) await deliver(out.bytes, out.name, out.name.endsWith(".zip") ? MIME.zip : MIME[r.fmt], "Images ready");
    return;
  }
  let opts = {};
  if (kind === "excel") {
    const r = await form("PDF to Excel", [{ name: "one", label: "Sheets", type: "seg", value: "page", options: [{ value: "page", label: "One per page" }, { value: "one", label: "All in one" }] }], "Convert",
      "Tables are rebuilt from the position of the text.");
    if (!r) return;
    opts.one = r.one === "one";
  }
  const pageList = d.pages;
  const names = { word: ["docx", "Word"], excel: ["xlsx", "Excel"], ppt: ["pptx", "PowerPoint"], text: ["txt", "Text"] };
  const [e, label] = names[kind];
  const bytes = await task(`Converting to ${label}…`, async () => {
    if (kind === "word") return C.toWord(d.id, pageList);
    if (kind === "excel") return C.toExcel(d.id, pageList, opts.one);
    if (kind === "ppt") return C.toPowerPoint(d.id, pageList);
    return C.toText(d.id, n);
  }, { cancellable: true, progress: true });
  if (bytes) await deliver(bytes, `${base}.${e}`, MIME[e], `${label} file ready`);
}

async function protectTool() {
  const d = S.doc;
  const r = await form("Protect with a password", [
    { name: "pw", label: "Password", type: "password", required: true },
    { name: "pw2", label: "Repeat", type: "password", validate: (v, all) => v !== all.pw ? "The passwords are different." : null },
    { name: "print", type: "check", text: "Allow printing", value: true },
    { name: "copy", type: "check", text: "Allow copying text", value: true },
    { name: "edit", type: "check", text: "Allow changes and comments", value: false },
  ], "Protect");
  if (!r) return;
  // PDF permission bits: print 4 (+2048 high quality), modify 8, copy 16 (+512 accessibility), comments 32, forms 256, assemble 1024
  let p = -3904;
  if (r.print) p += 4 + 2048;
  if (r.copy) p += 16 + 512;
  if (r.edit) p += 8 + 32 + 256 + 1024;
  const bytes = await task("Encrypting…", () => call("save", d.id, { encrypt: true, userPassword: r.pw, ownerPassword: r.pw + "#owner" + Math.random().toString(36).slice(2, 8), permissions: p }));
  if (bytes) await deliver(bytes, `${baseName(d.name)}-protected.pdf`, MIME.pdf, "Protected PDF (AES-256)");
}
async function unlockTool() {
  const d = S.doc;
  if (!d.encrypted) { toast("This PDF has no password to remove."); return; }
  const bytes = await task("Removing password…", () => call("save", d.id, { decrypt: true }));
  if (bytes) await deliver(bytes, `${baseName(d.name)}-unlocked.pdf`, MIME.pdf, "PDF without password");
}

async function propertiesTool() {
  const d = S.doc;
  const m = await call("metadata", d.id);
  const size = (await call("save", d.id, {})).length;
  const r = await form("Properties", [
    { name: "info", type: "info", html: `${esc(d.name)}<br>${d.pages.length} page(s) · ${fmtSize(size)} · ${esc(m.format)} · Encryption: ${esc(m.encryption)}<br>
      Page size: ${Math.round(d.pages[0].w / 72 * 25.4)} × ${Math.round(d.pages[0].h / 72 * 25.4)} mm${m.Producer ? "<br>Made with: " + esc(m.Producer) : ""}` },
    { name: "Title", label: "Title", value: m.Title }, { name: "Author", label: "Author", value: m.Author },
    { name: "Subject", label: "Subject", value: m.Subject }, { name: "Keywords", label: "Keywords", value: m.Keywords },
  ], "Save", "");
  if (!r) return;
  const meta = {};
  for (const k of ["Title", "Author", "Subject", "Keywords"]) if ((r[k] || "") !== (m[k] || "")) meta[k] = r[k] || "";
  if (Object.keys(meta).length) await apply("Saving…", "setMetadata", [meta], []);
}

// ================================================================== home flows: merge, photos, office
async function fileListSheet(title, files, extra = []) {
  // lets the user reorder/remove files; resolves the ordered list (+ extra form values) or null
  let list = [...files];
  return sheet(`<h3>${esc(title)}</h3><div class="filelist list"></div>${extra.map(x => x.html).join("")}
    <button class="text-btn" data-add>${icon("plus")} Add files</button>
    <div class="btns"><button data-no>Cancel</button><button class="ok" data-ok>${esc(extra.okLabel || "OK")}</button></div>`,
  card => {
    const box = card.querySelector(".filelist");
    const draw = () => {
      box.innerHTML = list.map((f, k) => `<div class="f">${icon(/^image/.test(f.mime || "") ? "image" : "pdf")}<span>${esc(f.name)}</span>
        <button class="icon-btn" data-up="${k}">${icon("up")}</button><button class="icon-btn" data-down="${k}">${icon("down")}</button><button class="icon-btn" data-del="${k}">${icon("close")}</button></div>`).join("");
    };
    draw();
    box.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const k = +(b.dataset.up ?? b.dataset.down ?? b.dataset.del);
      if (b.dataset.up != null && k > 0) [list[k - 1], list[k]] = [list[k], list[k - 1]];
      if (b.dataset.down != null && k < list.length - 1) [list[k + 1], list[k]] = [list[k], list[k + 1]];
      if (b.dataset.del != null) { releaseFile(list[k]); list.splice(k, 1); }
      draw();
    };
    card.querySelector("[data-add]").onclick = async () => {
      const more = await pickFilesKeepSheet(files.mimes);
      list = list.concat(more);
      draw();
    };
    card.querySelectorAll(".seg").forEach(g => g.querySelectorAll("button").forEach(b => {
      b.onclick = () => { g.querySelectorAll("button").forEach(x => x.classList.remove("on")); b.classList.add("on"); g.dataset.v = b.dataset.val; };
    }));
    card.querySelector("[data-no]").onclick = () => { list.forEach(releaseFile); closeSheet(null); };
    card.querySelector("[data-ok]").onclick = () => {
      if (!list.length) { toast("Add at least one file."); return; }
      const vals = {};
      card.querySelectorAll(".seg[data-k]").forEach(g => { vals[g.dataset.k] = g.dataset.v; });
      closeSheet({ list, ...vals });
    };
  });
}
async function pickFilesKeepSheet(mimes) { return pickFiles(mimes || "application/pdf", true); }

async function mergeFlow(given = null) {
  const mimes = "application/pdf,image/*";
  const files = given || await pickFiles(mimes, true);
  if (!files.length) return;
  files.mimes = mimes;
  const extra = []; extra.okLabel = "Merge";
  const r = await sheetFiles("Merge PDFs", files, extra);
  if (!r) return;
  const bytes = await task("Merging…", async () => {
    const items = [];
    for (const [k, f] of r.list.entries()) {
      checkCancel(); progress(k / r.list.length, "Reading " + f.name);
      let b = await readFile(f);
      if (/^image\//.test(f.mime || "") || ["jpg", "jpeg", "png", "webp", "heic"].includes(ext(f.name))) {
        b = await call("imagesToPdf", [{ bytes: await normalizeImage(b, f.mime, f.name), name: f.name }], "A4", 0);
        items.push({ bytes: b, name: "image.pdf" });
      } else items.push({ bytes: b, name: f.name.toLowerCase().endsWith(".pdf") ? f.name : f.name + ".pdf", password: null });
    }
    progress(0.95, "Merging…");
    return await mergeWithPasswords(items);
  }, { cancellable: true, progress: true });
  r.list.forEach(releaseFile);
  if (bytes) await openBytes(bytes, "Merged.pdf", null);
}
async function mergeWithPasswords(items) {
  for (;;) {
    try { return await call("merge", items.map(i => ({ ...i, bytes: i.bytes.slice() }))); }
    catch (e) {
      const m = /NEEDS_PASSWORD:(.*)/.exec(e.message);
      if (!m) throw e;
      idle();
      const r = await form("Password needed", [{ name: "pw", label: "Password", type: "password" }], "OK", m[1]);
      if (!r) throw new Error("Merge stopped: “" + m[1] + "” is protected.");
      busy("Merging…");
      items.find(i => i.name === m[1]).password = r.pw;
    }
  }
}
function sheetFiles(title, files, extra) { return fileListSheet(title, files, extra); }

async function imagesFlow(given) {
  const mimes = "image/*";
  const files = given || await pickFiles(mimes, true);
  if (!files.length) return;
  files.mimes = mimes;
  const extra = [
    { html: `<div class="row"><label>Page size</label><div class="seg" data-k="size" data-v="A4"><button data-val="fit">Fit picture</button><button data-val="A4" class="on">A4</button><button data-val="Letter">Letter</button></div></div>` },
    { html: `<div class="row"><label>Margin</label><div class="seg" data-k="margin" data-v="0"><button data-val="0" class="on">None</button><button data-val="20">Small</button><button data-val="40">Large</button></div></div>` },
  ];
  extra.okLabel = "Make PDF";
  const r = await fileListSheet("Photos to PDF", files, extra);
  if (!r) return;
  const bytes = await task("Making the PDF…", async () => {
    const items = [];
    for (const [k, f] of r.list.entries()) {
      checkCancel(); progress(k / r.list.length, `Picture ${k + 1} of ${r.list.length}`);
      items.push({ bytes: await normalizeImage(await readFile(f), f.mime, f.name), name: f.name });
    }
    return await call("imagesToPdf", items, r.size || "A4", +(r.margin || 0));
  }, { cancellable: true, progress: true });
  r.list.forEach(releaseFile);
  if (bytes) await openBytes(bytes, (r.list.length === 1 ? baseName(r.list[0].name) : "Photos") + ".pdf", null);
}

async function officeFlow() {
  const mimes = [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/vnd.ms-excel", "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet", "text/plain", "text/csv", "text/html", "application/epub+zip", "application/msword",
    "application/vnd.ms-powerpoint", "application/octet-stream",
  ].join(",");
  const files = await pickFiles(mimes, false);
  if (!files.length) return;
  await openFile(files[0]);
}

// ================================================================== search
function openSearch() {
  $("searchbar").classList.remove("hidden");
  setTimeout(() => $("searchInput").focus(), 50);
}
function closeSearch() {
  $("searchbar").classList.add("hidden");
  S.search = { needle: "", hits: [], cur: -1 };
  $("searchCount").textContent = "";
  refreshVisibleOverlays();
}
$("searchBtn").onclick = () => $("searchbar").classList.contains("hidden") ? openSearch() : closeSearch();
$("searchClose").onclick = closeSearch;
$("searchInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if ($("searchInput").value.trim() === S.search.needle && S.search.hits.length) stepSearch(1); else runSearch(); } });
$("searchNext").onclick = () => stepSearch(1);
$("searchPrev").onclick = () => stepSearch(-1);
let searchGen = 0;
async function runSearch() {
  const needle = $("searchInput").value.trim();
  if (!needle || !S.doc) return;
  $("searchInput").blur();
  const my = ++searchGen;
  S.search = { needle, hits: [], cur: -1 };
  const n = S.doc.pages.length;
  const start = currentPage();
  for (let k = 0; k < n; k++) {
    if (my !== searchGen || !S.doc) return;
    const i = k;
    const rs = await call("search", S.doc.id, i, needle);
    for (const r of rs) S.search.hits.push({ i, r });
    $("searchCount").textContent = `${S.search.hits.length}${k < n - 1 ? "…" : ""}`;
    if (S.search.cur < 0 && S.search.hits.length && S.search.hits[S.search.hits.length - 1].i >= start) {
      S.search.cur = S.search.hits.findIndex(h => h.i >= start);
      showHit();
    }
  }
  if (!S.search.hits.length) { $("searchCount").textContent = "0"; toast("Not found."); return; }
  if (S.search.cur < 0) { S.search.cur = 0; showHit(); }
  $("searchCount").textContent = `${S.search.cur + 1}/${S.search.hits.length}`;
  refreshVisibleOverlays();
}
function stepSearch(d) {
  const h = S.search.hits;
  if (!h.length) { runSearch(); return; }
  S.search.cur = (S.search.cur + d + h.length) % h.length;
  showHit();
}
function showHit() {
  const h = S.search.hits[S.search.cur];
  if (!h) return;
  $("searchCount").textContent = `${S.search.cur + 1}/${S.search.hits.length}`;
  goToPage(h.i, false, h.r[1]);
  const sc = $("scroller");
  const x = h.r[0] * scale() + PE[h.i].el.offsetLeft - sc.clientWidth / 3;
  if (x > sc.scrollLeft + sc.clientWidth * 0.6 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x);
  refreshVisibleOverlays();
  setTimeout(refreshVisibleOverlays, 120);
}

// ================================================================== view helpers
function toggleNight() {
  S.night = !S.night;
  $("pages").classList.toggle("night", S.night);
  scheduleRender();
  toast(S.night ? "Night mode on." : "Night mode off.");
}
async function showToc() {
  const toc = S.doc.toc || [];
  if (!toc.length) { toast("This PDF has no table of contents."); return; }
  const v = await choose("Contents", toc.map((t, k) => ({ value: k, label: " ".repeat((t.level - 1) * 3) + t.title, sub: t.page >= 0 ? "Page " + (t.page + 1) : "" })));
  if (v != null && toc[v].page >= 0) goToPage(toc[v].page);
}
async function askGoTo() {
  const r = await form("Go to page", [{ name: "p", label: `Page (1–${S.doc.pages.length})`, type: "number", value: currentPage() + 1, min: 1, max: S.doc.pages.length }], "Go");
  if (r && r.p) goToPage(r.p - 1, false);
}

// ---- reading mode (reflowed text)
async function openReadingMode() {
  const d = S.doc;
  const html = await task("Preparing…", async () => {
    const parts = [];
    for (let i = 0; i < d.pages.length; i++) {
      checkCancel(); progress(i / d.pages.length);
      const ls = await call("lines", d.id, i);
      const paras = C.paragraphs(ls);
      const body = paras.length ? paras.map(p => p.size).sort((a, b) => a - b)[paras.length >> 1] : 11;
      parts.push(`<div class="pg">Page ${i + 1}</div>` + (paras.length ? paras.map(p => p.size > body * 1.3 ? `<h2>${esc(p.text)}</h2>` : `<p>${esc(p.text)}</p>`).join("") : `<p class="muted">(no text on this page – try OCR)</p>`));
    }
    return parts.join("");
  }, { cancellable: true, progress: true });
  if (html === undefined) return;
  $("readText").innerHTML = html;
  $("readText").style.fontSize = storeGet("readSize", 18) + "px";
  show("reading");
  $("readText").scrollTop = 0;
}
$("readBack").onclick = () => show("viewer");
$("readSmaller").onclick = () => { const s = Math.max(12, storeGet("readSize", 18) - 2); storeSet("readSize", s); $("readText").style.fontSize = s + "px"; };
$("readBigger").onclick = () => { const s = Math.min(34, storeGet("readSize", 18) + 2); storeSet("readSize", s); $("readText").style.fontSize = s + "px"; };

// ---- read aloud
const R = { on: false, paused: false, page: 0, chunks: [], k: 0, rate: storeGet("rate", 1), lang: storeGet("ttsLang", (navigator.language || "en").slice(0, 2) === "it" ? "it" : "en") };
function splitChunks(text) {
  text = text.replace(/-\n(\w)/g, "$1").replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
  const out = [];
  while (text.length > 3500) {
    let cut = text.lastIndexOf(". ", 3500);
    if (cut < 1000) cut = text.lastIndexOf(" ", 3500);
    out.push(text.slice(0, cut + 1)); text = text.slice(cut + 1);
  }
  if (text) out.push(text);
  return out;
}
async function startReading(from) {
  if (!S.doc) return;
  R.on = true; R.paused = false; R.page = from ?? currentPage(); R.single = null;
  if (A && A.keepScreenOn) A.keepScreenOn(true);
  drawReadbar();
  await readPage();
}
function speakText(text) {
  stopReading();
  R.on = true; R.paused = false; R.single = splitChunks(text); R.chunks = R.single; R.k = 0;
  drawReadbar();
  speakChunk();
}
async function readPage() {
  if (!R.on || !S.doc) return;
  if (R.page >= S.doc.pages.length) { stopReading(); toast("Finished reading."); return; }
  goToPage(R.page);
  R.chunks = splitChunks(await call("pageText", S.doc.id, R.page));
  R.k = 0;
  drawReadbar();
  if (!R.chunks.length) { R.page++; readPage(); return; }
  speakChunk();
}
function speakChunk() {
  if (!R.on || R.paused) return;
  const text = R.chunks[R.k];
  const lang = R.lang === "it" ? "it-IT" : "en-US";
  if (A && A.speak) {
    if (!A.speak(text, R.rate, lang)) { toast("Text-to-speech is not available on this phone."); stopReading(); }
  } else if (window.speechSynthesis) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang; u.rate = R.rate;
    u.onend = () => GPE.onSpeakDone();
    speechSynthesis.speak(u);
  } else { toast("Text-to-speech is not available."); stopReading(); }
}
GPE.onSpeakDone = () => {
  if (!R.on || R.paused) return;
  R.k++;
  if (R.k < R.chunks.length) speakChunk();
  else if (R.single) stopReading();
  else { R.page++; readPage(); }
};
function stopSpeech() { if (A && A.stopSpeaking) A.stopSpeaking(); else if (window.speechSynthesis) speechSynthesis.cancel(); }
function stopReading() {
  if (!R.on) return;
  R.on = false;
  stopSpeech();
  if (A && A.keepScreenOn) A.keepScreenOn(false);
  $("readbar").classList.add("hidden");
}
function drawReadbar() {
  const b = $("readbar");
  b.classList.remove("hidden");
  b.innerHTML = `<button class="icon-btn" data-a="pp">${icon(R.paused ? "play" : "pause")}</button>
    <button class="icon-btn" data-a="prev">${icon("left")}</button><button class="icon-btn" data-a="next">${icon("right")}</button>
    <span>${R.single ? "Selection" : "Page " + (R.page + 1)}</span>
    <button class="text-btn" data-a="lang">${R.lang.toUpperCase()}</button>
    <input type="range" min="0.5" max="2" step="0.1" value="${R.rate}" title="Speed">
    <button class="icon-btn" data-a="stop">${icon("close")}</button>`;
  b.querySelector("input").onchange = (e) => { R.rate = +e.target.value; storeSet("rate", R.rate); restartChunk(); };
}
function restartChunk() { if (!R.on || R.paused) return; stopSpeech(); setTimeout(speakChunk, 150); }
$("readbar").onclick = (e) => {
  const a = e.target.closest("[data-a]");
  if (!a) return;
  switch (a.dataset.a) {
    case "pp": R.paused = !R.paused; if (R.paused) stopSpeech(); else speakChunk(); drawReadbar(); break;
    case "stop": stopReading(); break;
    case "next": if (!R.single) { stopSpeech(); R.page++; readPage(); } break;
    case "prev": if (!R.single) { stopSpeech(); R.page = Math.max(0, R.page - 1); readPage(); } break;
    case "lang": R.lang = R.lang === "it" ? "en" : "it"; storeSet("ttsLang", R.lang); drawReadbar(); restartChunk(); break;
  }
};

// ================================================================== top bar: back & more
$("backBtn").onclick = () => goBack();
async function goBack() {
  if (!(await confirmLeave())) return;
  closeDoc();
}
$("moreBtn").onclick = async () => {
  if (!S.doc) return;
  const v = await choose(S.doc.name, [
    { value: "save", label: "Save", icon: "save", sub: S.doc.canSave ? "Overwrite the original file" : "Choose where to save" },
    { value: "saveas", label: PHONE ? "Save as copy" : "Save as…", icon: "saveas" },
    PHONE && { value: "share", label: "Share", icon: "link" },
    on("read") && { value: "read", label: "Read aloud", icon: "speaker" },
    on("reflow") && { value: "reflow", label: "Reading mode", icon: "book" },
    on("night") && { value: "night", label: S.night ? "Night mode off" : "Night mode", icon: "moon", sub: "Dark pages for reading" },
    { value: "goto", label: "Go to page", icon: "pages" },
    on("print") && { value: "print", label: "Print…", icon: "print", sub: "Some pages, or several on one sheet" },
    { value: "props", label: "Properties", icon: "info" },
    { value: "settings", label: "Settings", icon: "settings" },
    { value: "theme", label: "Appearance", icon: document.documentElement.classList.contains("dark") ? "sun" : "moon",
      sub: { auto: "Follows the system", light: "Light", dark: "Dark" }[storeGet("theme", "auto")] },
    { value: "close", label: "Close", icon: "close" },
  ].filter(Boolean), "", "menu");
  switch (v) {
    case "save": await saveDoc(false); break;
    case "saveas": await saveDoc(true); break;
    case "share": { const b = await task("Preparing…", () => call("save", S.doc.id, {})); if (b) share(b, S.doc.name.endsWith(".pdf") ? S.doc.name : S.doc.name + ".pdf", MIME.pdf); break; }
    case "read": startReading(); break;
    case "reflow": openReadingMode(); break;
    case "night": toggleNight(); break;
    case "goto": askGoTo(); break;
    case "props": propertiesTool(); break;
    case "print": printTool(); break;
    case "settings": settingsSheet(); break;
    case "close": goBack(); break;
    case "theme": {
      const t = await choose("Appearance", [
        { value: "auto", label: "System", sub: "Follow the device setting", icon: "layers" },
        { value: "light", label: "Light", icon: "sun" }, { value: "dark", label: "Dark", icon: "moon" }]);
      if (t) setTheme(t);
      break;
    }
  }
};
$("saveBtn").onclick = () => saveDoc(false);

// ================================================================== mouse & keyboard (PC)
$("zoomIn").onclick = () => setZoom(S.zoom * 1.2);
$("zoomOut").onclick = () => setZoom(S.zoom / 1.2);
$("zoomLabel").onclick = () => setZoom(1);
$("scroller").addEventListener("wheel", (e) => {
  if (!e.ctrlKey || !S.doc) return;
  e.preventDefault();
  const r = $("scroller").getBoundingClientRect();
  setZoom(S.zoom * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

document.addEventListener("keydown", (e) => {
  if (busyState.on) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  const inViewer = curScreen() === "viewer" && S.doc;
  if (mod && (k === "o" || (k === "t" && P.tabs))) { e.preventDefault(); if (!sheetOpen()) openThen(null); return; }
  if (curScreen() === "compare" && !sheetOpen()) {
    if (e.key === "Escape") { closeCompare(); return; }
    if (k === "arrowright" || k === "pagedown") { e.preventDefault(); cmpStep(1); return; }
    if (k === "arrowleft" || k === "pageup") { e.preventDefault(); cmpStep(-1); return; }
  }
  if (!inViewer || sheetOpen()) return;
  if (mod && k === "s") { e.preventDefault(); saveDoc(e.shiftKey); return; }
  if (mod && k === "f") { e.preventDefault(); if (on("search")) { openSearch(); $("searchInput").select(); } return; }
  if (mod && k === "p") { e.preventDefault(); if (on("print")) printTool(); return; }
  if (mod && k === "w") { e.preventDefault(); goBack(); return; }
  if (mod && k === "tab" && TABS.length > 1) { e.preventDefault(); const i = TABS.indexOf(tabOf(S.doc)); switchTab(TABS[(i + (e.shiftKey ? -1 : 1) + TABS.length) % TABS.length]); return; }
  if (mod && k === "b") { e.preventDefault(); if (on("bookmarks")) toggleSide(); return; }
  if (mod && e.shiftKey && k === "n") { e.preventDefault(); if (on("night")) toggleNight(); return; }
  if (mod && k === "2") { e.preventDefault(); if (!S.spread && on("spread")) toggleSpread(); return; }
  if (mod && k === "1") { e.preventDefault(); if (S.spread) toggleSpread(); return; }
  if (e.key === "Escape") {
    if (!$("searchbar").classList.contains("hidden")) closeSearch();
    else if (S.tool) selectTool(null);
    else if (S.sel) { S.sel = null; refreshVisibleOverlays(); }
    return;
  }
  if (typing) return;
  if (mod && k === "z") { e.preventDefault(); (e.shiftKey ? $("redoBtn") : $("undoBtn")).click(); return; }
  if (mod && k === "y") { e.preventDefault(); $("redoBtn").click(); return; }
  if (mod && (k === "=" || k === "+")) { e.preventDefault(); setZoom(S.zoom * 1.2); return; }
  if (mod && k === "-") { e.preventDefault(); setZoom(S.zoom / 1.2); return; }
  if (mod && k === "0") { e.preventDefault(); setZoom(1); return; }
  if (mod && k === "g") { e.preventDefault(); askGoTo(); return; }
  if (mod) return;
  if (P.shortcuts && !e.altKey) {
    if (e.key === "?" || e.key === "F1") { e.preventDefault(); shortcutsSheet(); return; }
    const sc = SHORTCUTS.find(x => x.key && x.key.toLowerCase() === k && !x.mod);
    if (sc) { e.preventDefault(); sc.run(); return; }
  }
  const sc = $("scroller");
  if (k === "pagedown" || k === " ") { e.preventDefault(); sc.scrollBy({ top: sc.clientHeight * .9 * (e.shiftKey ? -1 : 1), behavior: "smooth" }); }
  else if (k === "pageup") { e.preventDefault(); sc.scrollBy({ top: -sc.clientHeight * .9, behavior: "smooth" }); }
  else if (k === "home") { e.preventDefault(); goToPage(0); }
  else if (k === "end") { e.preventDefault(); goToPage(S.doc.pages.length - 1); }
  else if (k === "arrowdown") { sc.scrollBy({ top: 60 }); }
  else if (k === "arrowup") { sc.scrollBy({ top: -60 }); }
});

// drag files onto the window
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $("dropveil").classList.add("on"); });
window.addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
window.addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $("dropveil").classList.remove("on"); });
window.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0; $("dropveil").classList.remove("on");
  if (busyState.on || sheetOpen()) return;
  if (D && !on("dropfiles")) { toast("Dropping files is switched off in Settings › Features."); return; }
  const files = droppedFiles(e.dataTransfer.files);
  if (files.length) dropFiles(files);
});

// closing the window with unsaved changes (PC)
if (D) D.onCloseRequest(async () => {
  if (busyState.on) return;
  if (sheetOpen()) closeSheet(null);
  stashTab();
  for (const t of [...TABS]) {
    if (!t.dirty) continue;
    switchTab(t, true);
    if (!(await confirmLeave())) return;
  }
  rememberPage();
  await recovery.clear();
  D.closeNow();
});

// hardware back button (called by the Android app; true = handled)
GPE.back = () => {
  if (busyState.on) return true;
  if (sheetOpen()) { closeSheet(null); return true; }
  if (R.on) { stopReading(); return true; }
  const scr = curScreen();
  if (scr === "compare") { closeCompare(); return true; }
  if (sideOpen && PHONE) { toggleSide(false); return true; }
  if (scr === "organize") { closeOrganize(); return true; }
  if (scr === "reading") { show("viewer"); return true; }
  if (scr === "viewer") {
    if (!$("searchbar").classList.contains("hidden")) { closeSearch(); return true; }
    if (S.tool) { selectTool(null); return true; }
    if (S.sel) { S.sel = null; refreshVisibleOverlays(); return true; }
    goBack();
    return true;
  }
  return false;
};

// ================================================================== tabs (several PDFs open)
/** Keep the shown document's place before showing another one. */
function stashTab() {
  const t = S.doc && tabOf(S.doc);
  if (!t) return;
  Object.assign(t, { dirty: S.dirty, zoom: S.zoom, page: currentPage(), night: S.night, spread: S.spread, mode: S.mode });
  rememberPage();
}
async function switchTab(t, noStash = false) {
  if (!t) return;
  if (S.doc === t.doc && curScreen() === "viewer") return;
  if (!noStash) stashTab();
  stopReading();
  if (curScreen() === "organize" || curScreen() === "reading") show("viewer");
  S.doc = t.doc; S.dirty = t.dirty; S.zoom = t.zoom || 1; S.night = !!t.night; S.spread = !!t.spread;
  S.search = { needle: "", hits: [], cur: -1 };
  S.sel = null; S.pending = null; S.gen++;
  try { Object.assign(S.doc, await call("info", S.doc.id)); } catch (_) { /* */ }
  $("docTitle").textContent = S.doc.name;
  show("viewer");
  setMode(t.mode || "view");
  moveModeMarker(true);
  closeSearch();
  hideBanner();
  buildPages();
  goToPage(t.page || 0, false);
  markDirty(); updateUndo(); drawTabs(); drawSide();
}
function drawTabs() {
  const bar = $("tabbar");
  if (!bar) return;
  const on = P.tabs && TABS.length > 1;
  bar.classList.toggle("hidden", !on);
  if (!on) return;
  bar.innerHTML = TABS.map((t, k) => `<div class="tab ${t.doc === S.doc ? "on" : ""}" data-k="${k}" title="${esc(t.doc.file && t.doc.file.path || t.doc.name)}">
    ${icon("pdf")}<span class="tn">${esc(t.doc.name)}</span>${(t.doc === S.doc ? S.dirty : t.dirty) ? '<i class="tdot"></i>' : ""}
    <button class="tx" data-close="${k}" aria-label="Close" title="Close (Ctrl+W)">${icon("close")}</button></div>`).join("")
    + `<button class="tab-add" id="tabAdd" title="Open another PDF (Ctrl+T)">${icon("plus")}</button>`;
  requestAnimationFrame(() => { const cur = bar.querySelector(".tab.on"); if (cur) cur.scrollIntoView({ block: "nearest", inline: "nearest" }); });
}
document.addEventListener("click", async (e) => {
  const bar = $("tabbar");
  if (!bar || !bar.contains(e.target)) return;
  if (e.target.closest("#tabAdd")) { openThen(null); return; }
  const x = e.target.closest("[data-close]");
  if (x) { await closeTab(TABS[+x.dataset.close]); return; }
  const tab = e.target.closest(".tab");
  if (tab) switchTab(TABS[+tab.dataset.k]);
});
document.addEventListener("auxclick", (e) => { const tab = e.button === 1 && e.target.closest("#tabbar .tab"); if (tab) closeTab(TABS[+tab.dataset.k]); });
async function closeTab(t) {
  if (!t) return;
  if (t.doc !== S.doc) await switchTab(t);
  goBack();
}
// pages dragged from the Pages view onto another tab are copied there
document.addEventListener("dragover", (e) => { const tab = e.target.closest && e.target.closest("#tabbar .tab"); if (tab && e.dataTransfer.types.includes("pe/pages")) { e.preventDefault(); tab.classList.add("drop"); } });
document.addEventListener("dragleave", (e) => { const tab = e.target.closest && e.target.closest("#tabbar .tab"); if (tab) tab.classList.remove("drop"); });
document.addEventListener("drop", async (e) => {
  const tab = e.target.closest && e.target.closest("#tabbar .tab");
  if (!tab || !e.dataTransfer.types.includes("pe/pages")) return;
  e.preventDefault(); e.stopPropagation();
  tab.classList.remove("drop");
  const t = TABS[+tab.dataset.k];
  if (!t || t.doc === S.doc) return;
  copyPagesTo(JSON.parse(e.dataTransfer.getData("pe/pages")), t);
}, true);
async function copyPagesTo(pages, t) {
  const ok = await task("Copying pages…", async () => {
    const bytes = await call("extract", S.doc.id, pages);
    const inf = await call("insertFile", t.doc.id, t.doc.pages.length, bytes, "pages.pdf");
    Object.assign(t.doc, inf);
    t.dirty = true;
    return true;
  });
  if (ok) { drawTabs(); toast(`${pages.length} page${pages.length === 1 ? "" : "s"} copied to the end of “${t.doc.name}”.`); }
}

// ================================================================== dropping files on the window
async function dropFiles(files) {
  const isImg = (f) => /^image\//.test(f.mime || "") || ["jpg", "jpeg", "png", "webp", "heic", "gif", "bmp"].includes(ext(f.name));
  if (files.every(isImg)) { await imagesFlow(files); return; }
  const pdfs = files.filter(f => ext(f.name) === "pdf");
  if (!pdfs.length || (files.length === 1 && !S.doc)) { incoming.handler(files, "open"); return; }
  const many = pdfs.length > 1;
  const v = await choose(many ? `${pdfs.length} PDFs` : pdfs[0].name, [
    { value: "open", label: many ? (P.tabs ? "Open each in its own tab" : "Open the first one") : (P.tabs ? "Open in a new tab" : "Open it"), icon: "open" },
    ...(many ? [{ value: "merge", label: "Merge them into one PDF", icon: "merge", sub: "You can change the order first" }] : []),
    ...(S.doc ? [{ value: "add", label: `Add to the end of “${S.doc.name}”`, icon: "insert" }] : []),
  ]);
  if (v === "open") { if (P.tabs) { for (const f of pdfs) await openFile(f); } else await openFile(pdfs[0]); }
  else if (v === "merge") await mergeFlow(pdfs);
  else if (v === "add") {
    await task("Adding…", async () => {
      for (const f of pdfs) { const b = await readFile(f); const inf = await call("insertFile", S.doc.id, S.doc.pages.length, b, f.name); await changed("all", inf); releaseFile(f); }
    });
    toast("Added at the end.");
  } else pdfs.forEach(releaseFile);
}

// ================================================================== two pages side by side
function toggleSpread() {
  if (!S.doc) return;
  const p = currentPage();
  S.spread = !S.spread;
  S.zoom = 1;
  layout();
  goToPage(p, false);
  toast(S.spread ? "Two pages side by side." : "One page at a time.");
}

// ================================================================== bookmarks panel (add, rename, move, delete)
let sideOpen = false;
function toggleSide(force) {
  sideOpen = force ?? !sideOpen;
  $("side").classList.toggle("open", sideOpen);
  $("viewer").classList.toggle("side-on", sideOpen);
  drawSide();
  if (S.doc && !PHONE) { const p = currentPage(); layout(); goToPage(p, false); }
}
function drawSide() {
  if (!sideOpen || !S.doc) return;
  const toc = S.doc.toc || [];
  $("sideList").innerHTML = toc.length ? toc.map((b, k) => `<div class="bm" data-k="${k}" style="--lv:${Math.min(5, b.level - 1)}">
      <button class="bm-go" data-go="${k}"><span class="bt">${esc(b.title)}</span><small>${b.page >= 0 ? b.page + 1 : ""}</small></button>
      <button class="icon-btn bm-more" data-more="${k}" aria-label="More">${icon("more")}</button></div>`).join("")
    : `<p class="muted small side-empty">No bookmarks yet. Go to a page and press <b>Add</b> to mark it.</p>`;
  markSideCurrent();
}
function markSideCurrent() {
  if (!sideOpen || !S.doc) return;
  const p = currentPage(), toc = S.doc.toc || [];
  let best = -1;
  toc.forEach((b, k) => { if (b.page >= 0 && b.page <= p && (best < 0 || b.page >= toc[best].page)) best = k; });
  $("sideList").querySelectorAll(".bm").forEach(el => el.classList.toggle("cur", +el.dataset.k === best));
}
async function saveOutline(list) {
  const inf = await task("Saving bookmarks…", () => call("setOutline", S.doc.id, list));
  if (!inf) return;
  S.doc.toc = inf.toc;
  await changed([], inf);
  drawSide();
}
$("sideAdd") && ($("sideAdd").onclick = async () => {
  if (!S.doc) return;
  const p = currentPage();
  const r = await form("New bookmark", [{ name: "t", label: "Name", type: "text", value: `Page ${p + 1}`, required: true }], "Add", `It points to page ${p + 1}.`);
  if (!r) return;
  const toc = [...(S.doc.toc || [])];
  let at = toc.findIndex(b => b.page > p);
  if (at < 0) at = toc.length;
  const level = at > 0 ? toc[at - 1].level : 1;
  toc.splice(at, 0, { title: r.t.trim(), page: p, level });
  saveOutline(toc);
});
$("sideClose") && ($("sideClose").onclick = () => toggleSide(false));
// phone: a tap outside the panel closes it
$("viewer").addEventListener("pointerdown", (e) => { if (sideOpen && PHONE && !e.target.closest("#side")) { e.preventDefault(); toggleSide(false); } }, true);
$("sideList") && ($("sideList").onclick = async (e) => {
  const go = e.target.closest("[data-go]");
  const toc = [...(S.doc.toc || [])].map(b => ({ ...b }));
  if (go) { const b = toc[+go.dataset.go]; if (b.page >= 0) goToPage(b.page); if (PHONE) toggleSide(false); return; }
  const more = e.target.closest("[data-more]");
  if (!more) return;
  const k = +more.dataset.more, b = toc[k];
  const v = await choose(b.title, [
    { value: "rename", label: "Rename", icon: "edit" },
    { value: "here", label: `Point it to this page (${currentPage() + 1})`, icon: "bookmark" },
    { value: "up", label: "Move up", icon: "up" }, { value: "down", label: "Move down", icon: "down" },
    { value: "in", label: "Move inside the one above", icon: "right" }, { value: "out", label: "Move out one level", icon: "left" },
    { value: "del", label: "Delete", icon: "trash" },
  ]);
  if (!v) return;
  if (v === "rename") { const r = await form("Rename bookmark", [{ name: "t", label: "Name", type: "text", value: b.title, required: true }], "OK"); if (!r) return; b.title = r.t.trim(); }
  else if (v === "here") b.page = currentPage();
  else if (v === "up" && k > 0) [toc[k - 1], toc[k]] = [toc[k], toc[k - 1]];
  else if (v === "down" && k < toc.length - 1) [toc[k + 1], toc[k]] = [toc[k], toc[k + 1]];
  else if (v === "in" && k > 0 && b.level <= toc[k - 1].level) b.level++;
  else if (v === "out" && b.level > 1) b.level--;
  else if (v === "del") toc.splice(k, 1);
  else return;
  saveOutline(toc);
});
$("sideList") && $("sideList").addEventListener("dblclick", async (e) => {
  const el = e.target.closest(".bm");
  if (!el) return;
  const toc = [...(S.doc.toc || [])].map(b => ({ ...b }));
  const b = toc[+el.dataset.k];
  const r = await form("Rename bookmark", [{ name: "t", label: "Name", type: "text", value: b.title, required: true }], "OK");
  if (r) { b.title = r.t.trim(); saveOutline(toc); }
});

// ================================================================== autosave and recovery (kept in this app's own storage)
const recovery = (() => {
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open("gpe-recovery", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("docs", { keyPath: "key" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction("docs", mode); const st = t.objectStore("docs"); const out = fn(st); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error); }); };
  return {
    put: (rec) => tx("readwrite", st => st.put(rec)).catch(() => {}),
    drop: (key) => tx("readwrite", st => st.delete(key)).catch(() => {}),
    list: () => tx("readonly", st => st.getAll()).catch(() => []),
    clear: () => tx("readwrite", st => st.clear()).catch(() => {}),
  };
})();
let autosaving = false;
async function autosaveNow() {
  if (!P.autosave || autosaving || busyState.on) return;
  autosaving = true;
  try {
    stashTab();
    for (const t of TABS) {
      if (!t.dirty) continue;
      const bytes = await call("save", t.doc.id, {});
      await recovery.put({ key: t.key, name: t.doc.name, path: t.doc.file && t.doc.file.path || "", at: Date.now(), bytes });
    }
  } catch (_) { /* never in the way */ }
  autosaving = false;
}
setInterval(autosaveNow, 30000);
let lastAuto = Date.now();
setInterval(() => { if (Date.now() - lastAuto >= (P.autosaveMin || 2) * 60000) { lastAuto = Date.now(); autosaveNow(); } }, 15000);
async function offerRecovery() {
  const list = (await recovery.list()) || [];
  if (!list.length) return;
  const when = (t) => new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const v = await choose("Recover unsaved work?", [
    ...list.map((r, k) => ({ value: "o" + k, label: r.name, sub: `Changes kept ${when(r.at)}`, icon: "restore" })),
    { value: "drop", label: "Throw them away", icon: "trash" },
  ], "PdfEditor closed before these changes were saved.");
  if (!v) return;
  if (v === "drop") { await recovery.clear(); toast("Removed."); return; }
  const r = list[+v.slice(1)];
  const file = D && r.path ? { name: r.name, path: r.path, token: r.path, canSave: true } : null;
  if (await openBytes(new Uint8Array(r.bytes), r.name, file)) {
    S.dirty = true; markDirty();
    await recovery.drop(r.key);
    const t = tabOf(S.doc); if (t) { t.dirty = true; recovery.put({ ...r, key: t.key }); }
    toast("Recovered. Save it to keep the changes.");
  }
}

// ================================================================== export highlights and notes
async function exportNotesTool() {
  if (!S.doc) return;
  const d = S.doc;
  const text = await task("Collecting highlights and notes…", async () => {
    const out = [];
    for (let i = 0; i < d.pages.length; i++) {
      checkCancel(); progress(i / d.pages.length);
      const an = await call("annotations", d.id, i);
      if (!an.length) continue;
      let ws = null;
      const lines = [];
      for (const a of an) {
        if (["Highlight", "Underline", "StrikeOut", "Squiggly"].includes(a.type)) {
          ws = ws || await call("words", d.id, i);
          const r = a.rect;
          const inside = ws.filter(w => { const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2; return cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3]; });
          const t = inside.map(w => w.text).join(" ").trim();
          const kind = { Highlight: "Highlight", Underline: "Underlined", StrikeOut: "Struck out", Squiggly: "Squiggly" }[a.type];
          if (t || a.contents) lines.push(`  • ${kind}: ${t || "(no text)"}${a.contents ? `\n    Comment: ${a.contents}` : ""}`);
        } else if (a.contents && a.contents.trim()) {
          const kind = { Text: "Note", FreeText: "Text box", Stamp: "Stamp" }[a.type] || a.type;
          lines.push(`  • ${kind}: ${a.contents.trim()}`);
        }
      }
      if (lines.length) out.push(`Page ${i + 1}\n${lines.join("\n")}`);
    }
    return out.length ? `${d.name}\nHighlights and notes, exported ${new Date().toLocaleString()}\n\n${out.join("\n\n")}\n` : "";
  }, { cancellable: true, progress: true });
  if (text == null) return;
  if (!text) { toast("There are no highlights or notes in this PDF."); return; }
  await deliver(new TextEncoder().encode(text), baseName(d.name) + " - notes.txt", "text/plain", "Highlights and notes");
}

// ================================================================== print: some pages, or several on one sheet
async function printTool() {
  if (!S.doc) return;
  const n = S.doc.pages.length, cur = currentPage();
  const r = await form("Print", [
    { name: "which", label: "Pages", type: "seg", value: "all", options: [{ value: "all", label: `All ${n}` }, { value: "cur", label: `This one (${cur + 1})` }, { value: "range", label: "Choose" }] },
    { name: "range", label: "Which", type: "text", placeholder: "e.g. 1-3, 7, 10-" },
    { name: "per", label: "Per sheet", type: "seg", value: String(P.printPerSheet || 1), options: ["1", "2", "4", "6", "9"] },
  ], D ? "Print…" : "Make the PDF", "Several pages per sheet saves paper (2 = side by side, 4 = two by two).");
  if (!r) return;
  const list = r.which === "cur" ? [cur] : r.which === "range" ? parseRange(r.range, n) : [...Array(n).keys()];
  if (!list.length) { toast("No pages to print."); return; }
  const per = +r.per || 1;
  P.printPerSheet = per; savePrefs();
  const d = S.doc;
  if (D && D.printImages) {
    const imgs = await task("Preparing the pages…", async () => {
      const out = [];
      for (const [k, i] of list.entries()) {
        checkCancel(); progress(k / list.length);
        const p = d.pages[i];
        // about 200 dpi for one page per sheet, less when they get smaller
        const dpi = per === 1 ? 200 : per <= 4 ? 150 : 120;
        out.push({ png: await call("renderPNG", d.id, i, dpi / 72), w: p.w, h: p.h });
      }
      return out;
    }, { cancellable: true, progress: true });
    if (imgs) { const ok = await D.printImages(imgs, per, d.name); if (!ok) toast("Printing didn't start."); }
    return;
  }
  // phone: a PDF with the chosen pages (and layout), to send to the printer app
  const bytes = await task("Preparing…", async () => {
    if (per === 1) return call("extract", d.id, list);
    const items = [];
    for (const [k, i] of list.entries()) { checkCancel(); progress(k / list.length); items.push({ bytes: await call("renderJPEG", d.id, i, 130 / 72, 82), name: "p.jpg" }); }
    return call("nUp", items, per);
  }, { cancellable: true, progress: true });
  if (bytes) await deliver(bytes, baseName(d.name) + "-print.pdf", MIME.pdf, "Ready to print");
}

// ================================================================== compare two versions
const CMP = { a: null, b: null, page: 0, pages: 0, changes: [], aName: "", bName: "", tmp: null };
async function compareTool() {
  if (!S.doc) return;
  const others = TABS.filter(t => t.doc !== S.doc);
  const v = await choose(`Compare “${S.doc.name}” with…`, [
    ...others.map((t, k) => ({ value: "t" + k, label: t.doc.name, sub: "Open in a tab", icon: "pdf" })),
    { value: "file", label: "Another file…", icon: "open" },
  ], "Words that were added are marked green, removed ones red.");
  if (!v) return;
  let b = null, tmp = null;
  if (v === "file") {
    const f = (await pickFiles("application/pdf", false))[0];
    if (!f) return;
    const bytes = await task("Opening…", () => readFile(f));
    releaseFile(f);
    if (!bytes) return;
    const r = await task("Opening…", () => call("open", bytes, f.name, null));
    if (!r || r.needsPassword) { toast("That PDF can't be opened here."); return; }
    tmp = r.id; b = { id: r.id, name: f.name, pages: r.pages };
  } else { const t = others[+v.slice(1)]; b = t.doc; }
  Object.assign(CMP, { a: S.doc, b, tmp, page: 0, pages: Math.max(S.doc.pages.length, b.pages.length), changes: [] });
  show("compare");
  $("cmpTitle").textContent = `${S.doc.name}  ↔  ${b.name}`;
  drawCompare();
  findChanges();
}
function closeCompare() {
  if (CMP.tmp != null) { call("close", CMP.tmp).catch(() => {}); CMP.tmp = null; }
  CMP.a = CMP.b = null;
  show("viewer");
  layout();
}
$("cmpBack") && ($("cmpBack").onclick = closeCompare);
function cmpStep(d) { CMP.page = Math.max(0, Math.min(CMP.pages - 1, CMP.page + d)); drawCompare(); }
$("cmpPrev") && ($("cmpPrev").onclick = () => cmpStep(-1));
$("cmpNext") && ($("cmpNext").onclick = () => cmpStep(1));
$("cmpNextChange") && ($("cmpNextChange").onclick = () => {
  const next = CMP.changes.find(p => p > CMP.page) ?? CMP.changes[0];
  if (next == null) { toast(CMP.done ? "No differences in the text." : "Still looking…"); return; }
  CMP.page = next; drawCompare();
});
/** Which words differ: longest common sequence of the words of both pages. */
function diffWords(A, B) {
  const a = A.map(w => w.text), b = B.map(w => w.text);
  const n = a.length, m = b.length;
  if (n * m > 4e6) return { del: A.map((_, i) => i).filter(i => !b.includes(a[i])), add: B.map((_, i) => i).filter(i => !a.includes(b[i])) };
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const del = [], add = [];
  let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) del.push(i++); else add.push(j++); }
  while (i < n) del.push(i++);
  while (j < m) add.push(j++);
  return { del, add };
}
async function pageDiff(k) {
  const wa = k < CMP.a.pages.length ? await call("words", CMP.a.id, k) : [];
  const wb = k < CMP.b.pages.length ? await call("words", CMP.b.id, k) : [];
  const d = diffWords(wa, wb);
  return { wa, wb, ...d };
}
async function findChanges() {
  const a = CMP.a;
  CMP.done = false;
  for (let k = 0; k < CMP.pages; k++) {
    if (CMP.a !== a) return;
    try { const d = await pageDiff(k); if (d.del.length || d.add.length) { CMP.changes.push(k); drawCmpInfo(); } } catch (_) { /* */ }
  }
  CMP.done = true;
  drawCmpInfo();
}
function drawCmpInfo() {
  const n = CMP.changes.length;
  $("cmpInfo").textContent = `Page ${CMP.page + 1} of ${CMP.pages} · ` + (n ? `${n} page${n === 1 ? "" : "s"} with differences` : CMP.done ? "no differences in the text" : "looking for differences…");
}
let cmpGen = 0;
async function drawCompare() {
  const my = ++cmpGen;
  drawCmpInfo();
  const k = CMP.page;
  const side = async (doc, words, marks, cls, el) => {
    if (k >= doc.pages.length) { el.innerHTML = `<div class="cmp-none">No page ${k + 1} in this version</div>`; return; }
    const p = doc.pages[k];
    const w = Math.min(el.clientWidth || 500, 900);
    const sc = w / p.w;
    const jpg = await call("renderJPEG", doc.id, k, Math.min(3, sc * (window.devicePixelRatio || 1)), 82);
    if (my !== cmpGen) return;
    const url = URL.createObjectURL(new Blob([jpg], { type: "image/jpeg" }));
    el.innerHTML = `<div class="cmp-page" style="aspect-ratio:${p.w}/${p.h}"><img src="${url}" alt="">${marks.map(i => { const w = words[i], r = [w.x0, w.y0, w.x1, w.y1]; return `<span class="cmp-mark ${cls}" style="${pct(r, p)}"></span>`; }).join("")}</div>`;
    el.querySelector("img").onload = () => URL.revokeObjectURL(url);
  };
  const d = await pageDiff(k).catch(() => ({ wa: [], wb: [], del: [], add: [] }));
  if (my !== cmpGen) return;
  $("cmpLabelA").textContent = `${CMP.a.name}${d.del.length ? ` · ${d.del.length} removed` : ""}`;
  $("cmpLabelB").textContent = `${CMP.b.name}${d.add.length ? ` · ${d.add.length} added` : ""}`;
  await side(CMP.a, d.wa, d.del, "del", $("cmpA"));
  await side(CMP.b, d.wb, d.add, "add", $("cmpB"));
}

// ================================================================== keyboard shortcuts
const tool = (m, id) => () => { if (!S.doc) return; if (S.mode !== m) setMode(m); selectTool(S.tool && S.tool.id === id ? null : id); };
const SHORTCUTS = [
  { key: "V", label: "Select comments", run: tool("comment", "select"), id: "select" },
  { key: "H", label: "Highlight", run: tool("comment", "highlight"), id: "highlight" },
  { key: "U", label: "Underline", run: tool("comment", "underline"), id: "underline" },
  { key: "K", label: "Strike out", run: tool("comment", "strike"), id: "strike" },
  { key: "P", label: "Draw (pen)", run: tool("comment", "pen"), id: "pen" },
  { key: "R", label: "Rectangle", run: tool("comment", "rect"), id: "rect" },
  { key: "O", label: "Ellipse", run: tool("comment", "ellipse"), id: "ellipse" },
  { key: "A", label: "Arrow", run: tool("comment", "arrow"), id: "arrow" },
  { key: "L", label: "Line", run: tool("comment", "line"), id: "line" },
  { key: "N", label: "Note", run: tool("comment", "note"), id: "note" },
  { key: "X", label: "Text box", run: tool("comment", "textbox"), id: "textbox" },
  { key: "M", label: "Stamp", run: tool("comment", "stamp"), id: "stamp" },
  { key: "E", label: "Eraser", run: tool("comment", "eraser"), id: "eraser" },
  { key: "T", label: "Edit text", run: tool("edit", "edittext"), id: "edittext" },
  { key: "I", label: "Add picture", run: tool("edit", "addimage"), id: "addimage" },
  { key: "D", label: "Redact", run: tool("edit", "redact"), id: "redact" },
  { key: "S", label: "Signature", run: tool("sign", "signature"), id: "signature" },
  { key: "C", label: "Copy text", run: tool("view", "copytext"), id: "copytext" },
  { key: "G", label: "Pages view (organize)", run: () => S.doc && openOrganize(), id: "organize" },
  { key: "Ctrl+O", mod: true, label: "Open a PDF" }, { key: "Ctrl+T", mod: true, label: "Open in a new tab" },
  { key: "Ctrl+Tab", mod: true, label: "Next tab (Shift: previous)" }, { key: "Ctrl+W", mod: true, label: "Close tab" },
  { key: "Ctrl+S", mod: true, label: "Save (Shift: save as)" }, { key: "Ctrl+P", mod: true, label: "Print" },
  { key: "Ctrl+F", mod: true, label: "Find" }, { key: "Ctrl+G", mod: true, label: "Go to page" },
  { key: "Ctrl+B", mod: true, label: "Bookmarks panel" }, { key: "Ctrl+1 / Ctrl+2", mod: true, label: "One page / two pages side by side" },
  { key: "Ctrl+Shift+N", mod: true, label: "Night mode" }, { key: "Ctrl+Z / Ctrl+Y", mod: true, label: "Undo / redo" },
  { key: "Ctrl + / − / 0", mod: true, label: "Zoom in / out / fit" }, { key: "Esc", mod: true, label: "Stop the tool, close search" },
  { key: "?", mod: true, label: "This list" },
];
const SHORTCUT_OF = Object.fromEntries(SHORTCUTS.filter(x => x.id).map(x => [x.id, x.key]));
function shortcutsSheet() {
  return sheet(`<h3>Keyboard shortcuts</h3><p class="muted small">Letters work while a PDF is open and you're not typing. They can be switched off in Settings.</p>
    <div class="keys">${SHORTCUTS.map(x => `<div class="krow"><kbd>${esc(x.key)}</kbd><span>${esc(x.label)}</span></div>`).join("")}</div>
    <div class="btns"><button class="ok" data-ok>OK</button></div>`, card => { card.querySelector("[data-ok]").onclick = () => closeSheet(); });
}

// ================================================================== settings, one section per topic
const SETTINGS = [
  { id: "general", label: "General", icon: "settings", items: [
    { k: "tabs", label: "Open several PDFs in tabs", sub: "Off: opening a PDF closes the one you're reading." },
    { k: "lastPage", label: "Reopen each PDF where you left it" },
    { k: "recentPhone", label: "Recent files on the home screen", sub: "PdfEditor keeps a copy of the last 8 PDFs you opened, so they open again with one tap. Saving updates the copy.", phone: true },
    { k: "recentThumbs", label: "Show a small picture in Recent" },
    { k: "openWith", label: "“Open with PdfEditor” in the right-click menu", sub: "Also lists PdfEditor among the apps for PDFs.", desk: true, act: "openWith" },
    { btn: "default", label: "Make PdfEditor the default PDF app…", desk: true },
  ] },
  { id: "reading", label: "Reading", icon: "book", items: [
    { k: "nightDefault", label: "Open PDFs in night mode", sub: "Dark pages, light text. Switch any time with Ctrl+Shift+N." },
    { k: "spreadDefault", label: "Open PDFs with two pages side by side" },
    { k: "readRate", label: "Reading-aloud speed", type: "range", min: 0.6, max: 1.8, step: 0.1, fmt: v => (+v).toFixed(1) + "×" },
  ] },
  { id: "editing", label: "Editing", icon: "edit", items: [
    { k: "quickColors", label: "Colour dots while highlighting or drawing" },
    { k: "shortcuts", label: "One-letter keyboard shortcuts (H, P, N…)", desk: true },
    { btn: "keys", label: "See all shortcuts", desk: true },
    { btn: "stamps", label: "Your saved stamps" },
    { btn: "sigs", label: "Your saved signatures" },
  ] },
  { id: "features", label: "Features", icon: "layers", note: "Switch off what you don't use: its buttons, menu entries and shortcuts disappear.",
    items: FEATURES.map(x => ({ k: "f_" + x.f, label: x.label, sub: x.sub, desk: x.desk })) },
  { id: "saving", label: "Saving", icon: "save", items: [
    { k: "autosave", label: "Keep a recovery copy of unsaved changes", sub: "If PdfEditor or the computer stops, you're offered your work back next time." },
    { k: "autosaveMin", label: "Every", type: "range", min: 1, max: 10, step: 1, fmt: v => v + " min" },
    { k: "cleanMeta", label: "Compress: remove metadata", sub: "Used by every Compress option." },
    { k: "cleanFonts", label: "Compress: trim fonts to the letters used" },
  ] },
];
let setTab = "general";
function settingsSheet() {
  P.readRate = R.rate;
  const draw = (card) => {
    const sec = SETTINGS.find(x => x.id === setTab);
    card.querySelector(".set-tabs").innerHTML = SETTINGS.map(x => `<button data-tab="${x.id}" class="${x.id === setTab ? "on" : ""}">${icon(x.icon)}<span>${esc(x.label)}</span></button>`).join("");
    card.querySelector(".set-body").innerHTML = (sec.note ? `<p class="muted small set-note">${esc(sec.note)}</p>` : "") + sec.items.filter(it => (!it.desk || D) && (!it.phone || !D)).map(it => {
      if (it.btn) return `<button class="item set-btn" data-btn="${it.btn}">${icon(it.btn === "keys" ? "info" : it.btn === "default" ? "check" : it.btn === "stamps" ? "stamp" : "sign")}<span>${esc(it.label)}</span>${icon("right", "chev")}</button>`;
      if (it.type === "range") return `<div class="set-range"><span>${esc(it.label)}</span><input type="range" data-k="${it.k}" min="${it.min}" max="${it.max}" step="${it.step}" value="${P[it.k]}"><b>${esc(it.fmt(P[it.k]))}</b></div>`;
      return `<label class="set-row"><span class="tx"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span><input type="checkbox" data-k="${it.k}" ${P[it.k] ? "checked" : ""}><span class="sw"></span></label>`;
    }).join("");
    card.querySelectorAll(".set-tabs button").forEach(b => { b.onclick = () => { setTab = b.dataset.tab; draw(card); }; });
    card.querySelectorAll('.set-body input[type=checkbox]').forEach(c => {
      c.onchange = async () => {
        P[c.dataset.k] = c.checked; savePrefs();
        const it = sec.items.find(x => x.k === c.dataset.k);
        if (it && it.act === "openWith" && D && D.openWith) { const ok = await D.openWith(c.checked); toast(c.checked ? (ok ? "Added to the right-click menu." : "Couldn't add it.") : "Removed from the right-click menu."); }
        if (c.dataset.k === "tabs") drawTabs();
        if (c.dataset.k === "recentThumbs") drawRecent();
        if (c.dataset.k === "recentPhone") { if (!c.checked) { for (const f of recentList()) recentStore.drop(f.key); recentSave([]); } drawRecent(); }
        if (c.dataset.k === "quickColors" || c.dataset.k === "shortcuts") renderToolstrip();
        if (c.dataset.k.startsWith("f_")) applyFeatures();
      };
    });
    card.querySelectorAll('.set-body input[type=range]').forEach(r => {
      const it = sec.items.find(x => x.k === r.dataset.k);
      r.oninput = () => { P[it.k] = +r.value; r.nextElementSibling.textContent = it.fmt(r.value); savePrefs(); if (it.k === "readRate") { R.rate = +r.value; storeSet("rate", R.rate); restartChunk(); } };
    });
    card.querySelectorAll("[data-btn]").forEach(b => {
      b.onclick = async () => {
        const w = b.dataset.btn;
        if (w === "keys") { shortcutsSheet(); return; }
        if (w === "default") { if (!P.openWith) { P.openWith = true; savePrefs(); if (D.openWith) await D.openWith(true); } D.openDefaultApps(); toast("In Windows Settings, choose PdfEditor for .pdf files."); return; }
        if (w === "stamps") { await chooseStamp(); return; }
        if (w === "sigs") { await chooseSignature("signature"); return; }
      };
    });
  };
  return sheet(`<h3>Settings</h3><div class="set-tabs" role="tablist"></div><div class="set-body"></div>
    <p class="muted small set-ver">PdfEditor ${esc(D ? D.version : APP_VERSION)}</p>
    <div class="btns"><button class="ok" data-ok>Done</button></div>`, card => { card.querySelector("[data-ok]").onclick = () => closeSheet(); draw(card); }, "wide-sheet");
}
$("settingsBtn") && ($("settingsBtn").onclick = () => settingsSheet());

// ================================================================== Pages view: drag pages to reorder, or onto a tab to copy them
$("grid").addEventListener("dragstart", (e) => {
  const t = e.target.closest(".thumb");
  if (!t || PHONE || !on("dragpages")) return;
  const i = +t.dataset.i;
  const pages = ORG.sel.has(i) ? [...ORG.sel].sort((a, b) => a - b) : [i];
  e.dataTransfer.setData("pe/pages", JSON.stringify(pages));
  e.dataTransfer.effectAllowed = "copyMove";
  $("grid").classList.add("dragging");
  ORG.drag = pages;
});
$("grid").addEventListener("dragend", () => { $("grid").classList.remove("dragging"); $("grid").querySelectorAll(".thumb").forEach(t => t.classList.remove("before", "after")); ORG.drag = null; });
$("grid").addEventListener("dragover", (e) => {
  if (!ORG.drag) return;
  const t = e.target.closest(".thumb");
  if (!t) return;
  e.preventDefault();
  const r = t.getBoundingClientRect();
  const after = e.clientX > r.left + r.width / 2;
  $("grid").querySelectorAll(".thumb").forEach(x => x.classList.remove("before", "after"));
  t.classList.add(after ? "after" : "before");
});
$("grid").addEventListener("drop", async (e) => {
  if (!ORG.drag) return;
  const t = e.target.closest(".thumb");
  if (!t) return;
  e.preventDefault();
  const r = t.getBoundingClientRect();
  let at = +t.dataset.i + (e.clientX > r.left + r.width / 2 ? 1 : 0);
  const moving = ORG.drag, n = S.doc.pages.length;
  const rest = [...Array(n).keys()].filter(i => !moving.includes(i));
  const before = rest.filter(i => i < at).length;
  const order = [...rest.slice(0, before), ...moving, ...rest.slice(before)];
  ORG.drag = null;
  if (order.every((v, k) => v === k)) return;
  await task("Moving…", async () => { const inf = await call("reorder", S.doc.id, order); await changed("all", inf); });
  ORG.sel = new Set(moving.map(i => order.indexOf(i)));
  buildGrid();
  $("grid").querySelectorAll(".thumb").forEach(x => x.classList.toggle("on", ORG.sel.has(+x.dataset.i)));
});

/** After a function is switched on or off: hide or show its buttons everywhere. */
function applyFeatures() {
  $("searchBtn").classList.toggle("hidden", !on("search"));
  if (!on("search") && !$("searchbar").classList.contains("hidden")) closeSearch();
  if (!on("bookmarks") && sideOpen) toggleSide(false);
  if (S.doc && !on("spread") && S.spread) toggleSpread();
  if (S.doc && !on("night") && S.night) toggleNight();
  drawTiles();
  if (S.doc) renderToolstrip();
  if (S.doc && curScreen() === "organize") buildGrid();
}

// ================================================================== update check
function verTuple(s) { return (String(s || "").match(/\d+/g) || ["0"]).slice(0, 3).map(Number); }
function newer(a, b) { const x = verTuple(a), y = verTuple(b); for (let k = 0; k < 3; k++) { if ((x[k] || 0) !== (y[k] || 0)) return (x[k] || 0) > (y[k] || 0); } return false; }
async function checkUpdates() {
  if (!REPO || !A) return;
  try {
    const current = APP_VERSION;
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    const apk = (j.assets || []).find(a => /\.apk$/i.test(a.name));
    if (!apk || !newer(j.tag_name, current)) return;
    if (sheetOpen() || busyState.on) return;
    const v = await choose("Update available", [
      { value: "dl", label: "Download version " + verTuple(j.tag_name).join("."), sub: `You have ${current}. Open the downloaded file to install it.`, icon: "drop" },
      { value: "later", label: "Later", icon: "close" },
    ]);
    if (v === "dl") openUrl(apk.browser_download_url);
  } catch (_) { /* offline: say nothing */ }
}

// ================================================================== start
applyTheme();
applyFeatures();
themeMq.addEventListener?.("change", applyTheme);
placeModes();
show("home");
drawTabs();
if (D) D.ready();
setTimeout(checkUpdates, 2500);
setTimeout(offerRecovery, 1200);
if (D && P.openWith && D.openWith) D.openWith(true);   // keeps "Open with" pointing to this folder
window.__gpe2 = { TABS: () => TABS, switchTab, toggleSide, toggleSpread, settingsSheet, compareTool, autosaveNow, recovery, P, exportNotesTool, printTool, shortcutsSheet, saveOutline };
window.__gpe = { S, openBytes, setMode, selectTool, call, convertTool, compressTool, apply, changed, PE: () => PE, finishGesture, G, tapTool };
