// PdfEditor for Windows: a small Electron shell around the same web app the phone uses (the "www" folder).
const { app, BrowserWindow, protocol, dialog, shell, ipcMain, nativeTheme, Menu } = require("electron");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const WWW = path.join(__dirname, "www");
const OPENABLE = ["pdf", "jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "docx", "xlsx", "pptx", "txt", "csv", "html", "md"];

// Portable: settings live in a "data" folder next to the exe when that folder can be written.
if (app.isPackaged) {
  try {
    const dir = path.join(path.dirname(app.getPath("exe")), "data");
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    app.setPath("userData", dir);
  } catch (_) { /* read-only place (e.g. Program Files): fall back to the user's AppData */ }
}

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }]);

const MIME = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json", wasm: "application/wasm", png: "image/png", jpg: "image/jpeg",
  svg: "image/svg+xml", woff2: "font/woff2", ttf: "font/ttf", gz: "application/gzip", txt: "text/plain; charset=utf-8", ico: "image/x-icon" };

let win = null;
let rendererReady = false;
let pendingFiles = [];
let closing = false;

function filesFromArgs(argv) {
  const out = [];
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith("-")) continue;
    try {
      const p = path.resolve(a);
      const ext = path.extname(p).slice(1).toLowerCase();
      if (OPENABLE.includes(ext) && fs.statSync(p).isFile()) out.push(info(p));
    } catch (_) { /* not a file */ }
  }
  return out;
}
function info(p) { let size = 0; try { size = fs.statSync(p).size; } catch (_) { /* */ } return { name: path.basename(p), size, path: p }; }
function sendFiles(files) {
  if (!files.length) return;
  if (win && rendererReady) win.webContents.send("open-files", files); else pendingFiles.push(...files);
}

// window size and place are remembered
const stateFile = () => path.join(app.getPath("userData"), "window.json");
function loadState() { try { return JSON.parse(fs.readFileSync(stateFile(), "utf8")); } catch (_) { return {}; } }
function saveState() {
  if (!win) return;
  try {
    const st = { max: win.isMaximized(), ...(win.isMaximized() || win.isMinimized() ? (loadState().bounds ? { bounds: loadState().bounds } : {}) : { bounds: win.getBounds() }), theme: currentTheme };
    fs.writeFileSync(stateFile(), JSON.stringify(st));
  } catch (_) { /* */ }
}
let currentTheme = "auto";

function createWindow() {
  const st = loadState();
  currentTheme = st.theme || "auto";
  nativeTheme.themeSource = currentTheme === "auto" ? "system" : currentTheme;
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1280, height: 860, ...(st.bounds || {}), minWidth: 400, minHeight: 560,
    show: false, backgroundColor: dark ? "#121316" : "#f3f4f6", title: "PdfEditor",
    icon: path.join(__dirname, "icon.png"), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  if (st.max) win.maximize();
  win.once("ready-to-show", () => win.show());
  win.loadURL("app://pdfeditor/index.html");
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("app://pdfeditor/")) e.preventDefault(); });
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.on("close", (e) => {
    saveState();
    if (closing || !rendererReady) return;
    e.preventDefault();                       // let the page ask about unsaved changes first
    win.webContents.send("close-request");
  });
  win.on("closed", () => { win = null; });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    sendFiles(filesFromArgs(argv));
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    protocol.handle("app", async (req) => {
      try {
        const u = new URL(req.url);
        const file = path.normalize(path.join(WWW, decodeURIComponent(u.pathname)));
        if (!file.startsWith(WWW + path.sep)) return new Response("Forbidden", { status: 403 });
        const data = await fs.promises.readFile(file);
        const ext = path.extname(file).slice(1).toLowerCase();
        return new Response(data, { headers: { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-cache" } });
      } catch (_) { return new Response("Not found", { status: 404 }); }
    });
    pendingFiles = filesFromArgs(process.argv);
    createWindow();
    // checks GitHub for a newer version as soon as the app opens
    require("./updater").start({ repo: "Gabrydl/PdfEditor", asset: "PdfEditor-Setup.exe", name: "PdfEditor", getWin: () => win });
  });
  app.on("window-all-closed", () => app.quit());
}

// ------------------------------------------------------------------ what the page may ask for
ipcMain.handle("pick", async (_e, opts) => {
  const r = await dialog.showOpenDialog(win, { properties: ["openFile", ...(opts && opts.multiple ? ["multiSelections"] : [])], filters: (opts && opts.filters) || [] });
  return r.canceled ? [] : r.filePaths.map(info);
});
ipcMain.handle("read", async (_e, p) => { try { return await fs.promises.readFile(p); } catch (_) { return null; } });
ipcMain.handle("exists", async (_e, p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } });
ipcMain.handle("write", async (_e, p, bytes) => {
  try {
    // write next to the target first, then swap: a crash never leaves half a file
    const tmp = p + ".saving";
    await fs.promises.writeFile(tmp, Buffer.from(bytes));
    await fs.promises.rename(tmp, p);
    return true;
  } catch (_) { try { await fs.promises.unlink(p + ".saving"); } catch (_e2) { /* */ } return false; }
});
ipcMain.handle("save-as", async (_e, bytes, name) => {
  const ext = path.extname(name).slice(1).toLowerCase() || "pdf";
  const last = loadState().saveDir;
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(last && fs.existsSync(last) ? last : app.getPath("documents"), name),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }, { name: "All files", extensions: ["*"] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  try {
    await fs.promises.writeFile(r.filePath, Buffer.from(bytes));
    try { fs.writeFileSync(stateFile(), JSON.stringify({ ...loadState(), saveDir: path.dirname(r.filePath) })); } catch (_) { /* */ }
    return { ok: true, name: path.basename(r.filePath), path: r.filePath };
  } catch (err) { dialog.showErrorBox("Could not save", String(err.message || err)); return { ok: false }; }
});
ipcMain.handle("open-temp", async (_e, bytes, name) => {
  const dir = path.join(os.tmpdir(), "PdfEditor");
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, String(name || "file").replace(/[\\/:*?"<>|]/g, "_"));
  await fs.promises.writeFile(file, Buffer.from(bytes));
  const err = await shell.openPath(file);
  return !err;
});
ipcMain.on("open-url", (_e, url) => { if (/^https?:\/\//i.test(String(url))) shell.openExternal(url); });
ipcMain.on("set-theme", (_e, theme, dark) => {
  currentTheme = ["auto", "light", "dark"].includes(theme) ? theme : "auto";
  nativeTheme.themeSource = currentTheme === "auto" ? "system" : currentTheme;
  if (win) win.setBackgroundColor(dark ? "#121316" : "#f3f4f6");
});
ipcMain.on("set-title", (_e, t) => { if (win) win.setTitle(t ? `${t} - PdfEditor` : "PdfEditor"); });
ipcMain.on("ready", () => { rendererReady = true; const f = pendingFiles; pendingFiles = []; if (f.length && win) win.webContents.send("open-files", f); });
ipcMain.on("close-now", () => { closing = true; if (win) win.close(); });
ipcMain.on("version", (e) => { e.returnValue = app.getVersion(); });

// ------------------------------------------------------------------ print: chosen pages, 1 to 9 per sheet, through the Windows print window
ipcMain.handle("print-images", async (_e, imgs, per, title) => {
  const dir = path.join(os.tmpdir(), "PdfEditor-print-" + Date.now());
  await fs.promises.mkdir(dir, { recursive: true });
  const files = [];
  for (const [k, im] of imgs.entries()) { const f = path.join(dir, `p${k}.png`); await fs.promises.writeFile(f, Buffer.from(im.png)); files.push({ f: "p" + k + ".png", w: im.w, h: im.h }); }
  const grid = { 1: [1, 1], 2: [2, 1], 4: [2, 2], 6: [3, 2], 9: [3, 3] }[per] || [1, 1];
  const [cols, rows] = grid;
  // portrait pages: 2 and 6 per sheet go landscape so they stay big
  const land = per === 1 ? (files[0] && files[0].w > files[0].h) : (per === 2 || per === 6);
  const sheets = [];
  for (let k = 0; k < files.length; k += cols * rows) sheets.push(files.slice(k, k + cols * rows));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${String(title || "Print").replace(/[<&]/g, "")}</title><style>
    @page { size: A4 ${land ? "landscape" : "portrait"}; margin: ${per === 1 ? 0 : 8}mm; }
    html, body { margin: 0; padding: 0; }
    .sheet { width: 100%; height: 100vh; display: grid; grid-template-columns: repeat(${cols}, 1fr); grid-template-rows: repeat(${rows}, 1fr); gap: ${per === 1 ? 0 : 4}mm; page-break-after: always; break-after: page; box-sizing: border-box; }
    .sheet:last-child { page-break-after: auto; break-after: auto; }
    .cell { display: flex; align-items: center; justify-content: center; overflow: hidden; min-width: 0; min-height: 0; }
    img { max-width: 100%; max-height: 100%; object-fit: contain; ${per === 1 ? "" : "outline: 0.2mm solid #ccc;"} }
  </style></head><body>${sheets.map(sh => `<div class="sheet">${sh.map(x => `<div class="cell"><img src="${x.f}"></div>`).join("")}</div>`).join("")}</body></html>`;
  const file = path.join(dir, "print.html");
  await fs.promises.writeFile(file, html);
  const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    await pw.loadFile(file);
    await pw.webContents.executeJavaScript("Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })))");
    const ok = await new Promise(res => pw.webContents.print({ silent: false, printBackground: true, landscape: !!land }, (success) => res(success)));
    return ok;
  } catch (_) { return false; } finally {
    setTimeout(() => { try { pw.destroy(); } catch (_) { /* */ } fs.rm(dir, { recursive: true, force: true }, () => {}); }, 1000);
  }
});

// ------------------------------------------------------------------ "Open with PdfEditor" (right-click) and listing among the PDF apps
function reg(args) { return new Promise(res => execFile("reg.exe", args, { windowsHide: true }, (err) => res(!err))); }
async function setOpenWith(on) {
  if (process.platform !== "win32" || !app.isPackaged) return false;
  const exe = app.getPath("exe");
  const C = "HKCU\\Software\\Classes";
  const keys = [`${C}\\PdfEditor.PDF`, `${C}\\SystemFileAssociations\\.pdf\\shell\\PdfEditor`, `${C}\\Applications\\PdfEditor.exe`, "HKCU\\Software\\PdfEditor"];
  if (!on) {
    for (const k of keys) await reg(["delete", k, "/f"]);
    await reg(["delete", `${C}\\.pdf\\OpenWithProgids`, "/v", "PdfEditor.PDF", "/f"]);
    await reg(["delete", "HKCU\\Software\\RegisteredApplications", "/v", "PdfEditor", "/f"]);
    return true;
  }
  const cmd = `"${exe}" "%1"`;
  const steps = [
    ["add", `${C}\\PdfEditor.PDF`, "/ve", "/d", "PDF document", "/f"],
    ["add", `${C}\\PdfEditor.PDF\\DefaultIcon`, "/ve", "/d", `"${exe}",0`, "/f"],
    ["add", `${C}\\PdfEditor.PDF\\shell\\open\\command`, "/ve", "/d", cmd, "/f"],
    ["add", `${C}\\.pdf\\OpenWithProgids`, "/v", "PdfEditor.PDF", "/t", "REG_NONE", "/f"],
    ["add", `${C}\\SystemFileAssociations\\.pdf\\shell\\PdfEditor`, "/ve", "/d", "Open with PdfEditor", "/f"],
    ["add", `${C}\\SystemFileAssociations\\.pdf\\shell\\PdfEditor`, "/v", "Icon", "/d", `"${exe}"`, "/f"],
    ["add", `${C}\\SystemFileAssociations\\.pdf\\shell\\PdfEditor\\command`, "/ve", "/d", cmd, "/f"],
    ["add", `${C}\\Applications\\PdfEditor.exe\\shell\\open\\command`, "/ve", "/d", cmd, "/f"],
    ["add", `${C}\\Applications\\PdfEditor.exe\\SupportedTypes`, "/v", ".pdf", "/d", "", "/f"],
    ["add", "HKCU\\Software\\PdfEditor\\Capabilities", "/v", "ApplicationName", "/d", "PdfEditor", "/f"],
    ["add", "HKCU\\Software\\PdfEditor\\Capabilities", "/v", "ApplicationDescription", "/d", "Everything for PDFs, offline.", "/f"],
    ["add", "HKCU\\Software\\PdfEditor\\Capabilities\\FileAssociations", "/v", ".pdf", "/d", "PdfEditor.PDF", "/f"],
    ["add", "HKCU\\Software\\RegisteredApplications", "/v", "PdfEditor", "/d", "Software\\PdfEditor\\Capabilities", "/f"],
  ];
  let ok = true;
  for (const a of steps) ok = (await reg(a)) && ok;
  return ok;
}
ipcMain.handle("open-with", (_e, on) => setOpenWith(!!on));
ipcMain.on("default-apps", () => { shell.openExternal("ms-settings:defaultapps?registeredAppUser=PdfEditor").catch(() => shell.openExternal("ms-settings:defaultapps")); });
