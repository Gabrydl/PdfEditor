// Auto-update for the installed Windows app. Runs in the main process, as soon as the app opens.
// 1. asks GitHub for the latest release, 2. if it is newer asks the user, 3. downloads the new Setup with a progress bar,
// 4. runs it silently: it closes the app, installs over it (settings are kept) and opens it again.
// Every failure (offline, rate limit...) is silent: the app just opens normally.
const { app, dialog, BrowserWindow } = require("electron");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

function tuple(s) { return (String(s || "").match(/\d+/g) || ["0"]).slice(0, 3).map(Number); }
function isNewer(a, b) {
  const x = tuple(a), y = tuple(b);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "auto-updater", Accept: "application/vnd.github+json" }, timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { body += c; });
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

function download(url, dest, onProgress, hops = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "auto-updater" }, timeout: 30000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 5) {
        res.resume();
        return resolve(download(res.headers.location, dest, onProgress, hops + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
      const total = +res.headers["content-length"] || 0;
      let got = 0;
      const out = fs.createWriteStream(dest);
      res.on("data", (c) => { got += c.length; if (total) onProgress(got / total); });
      res.pipe(out);
      out.on("finish", () => out.close(() => resolve()));
      out.on("error", reject);
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}


/**
 * opts: { repo: "owner/Name", asset: "Name-Setup.exe", name: "Name", getWin: () => BrowserWindow|null }
 */
async function start(opts) {
  if (!app.isPackaged || process.platform !== "win32" || !opts.repo) return;
  try {
    const rel = await getJson(`https://api.github.com/repos/${opts.repo}/releases/latest`);
    const asset = (rel.assets || []).find((a) => a.name.toLowerCase() === opts.asset.toLowerCase());
    const current = app.getVersion();
    if (!asset || !isNewer(rel.tag_name, current)) return;

    const win = opts.getWin ? opts.getWin() : null;
    const latest = tuple(rel.tag_name).join(".");
    const r = await dialog.showMessageBox(win || undefined, {
      type: "info", title: opts.name, defaultId: 0, cancelId: 1, noLink: true,
      buttons: ["Update now", "Later"],
      message: `${opts.name} ${latest} is available`,
      detail: `You have version ${current}. The update downloads in a minute, installs by itself and the app opens again. Your settings are kept.`,
    });
    if (r.response !== 0) return;

    const setup = path.join(os.tmpdir(), `${opts.name}-Setup-${latest}.exe`);
    const setBar = (f) => { const w = opts.getWin && opts.getWin(); if (w && !w.isDestroyed()) { w.setProgressBar(f); w.setTitle(`${opts.name} - downloading update ${Math.round(Math.max(f, 0) * 100)}%`); } };
    await download(asset.browser_download_url, setup + ".part", setBar);
    fs.renameSync(setup + ".part", setup);
    setBar(-1);
    spawn(setup, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-"], { detached: true, stdio: "ignore" }).unref();
    for (const w of BrowserWindow.getAllWindows()) { try { w.destroy(); } catch (_) { /* */ } }
    app.exit(0);
  } catch (e) {
    const w = opts.getWin && opts.getWin();
    if (w && !w.isDestroyed()) { w.setProgressBar(-1); w.setTitle(opts.name); }
  }
}

module.exports = { start };
