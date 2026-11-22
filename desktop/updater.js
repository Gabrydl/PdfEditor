// Auto-update for the portable Windows build. Runs in the main process, as soon as the app opens.
// 1. asks GitHub for the latest release, 2. if it is newer asks the user, 3. downloads the zip with a progress bar,
// 4. closes the app, swaps the files (the "data" folder with settings/history is never touched) and starts it again.
// Every failure (offline, rate limit, read-only folder...) is silent: the app just opens normally.
const { app, dialog, shell, BrowserWindow } = require("electron");
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

function canWrite(dir) {
  try { fs.accessSync(dir, fs.constants.W_OK); const t = path.join(dir, ".w" + process.pid); fs.writeFileSync(t, "1"); fs.unlinkSync(t); return true; } catch (_) { return false; }
}

/**
 * opts: { repo: "owner/Name", asset: "Name-Windows.zip", exe: "Name.exe", name: "Name", getWin: () => BrowserWindow|null }
 */
async function start(opts) {
  if (!app.isPackaged || process.platform !== "win32" || !opts.repo || /^__/.test(opts.repo)) return;
  try {
    const rel = await getJson(`https://api.github.com/repos/${opts.repo}/releases/latest`);
    const asset = (rel.assets || []).find((a) => a.name.toLowerCase() === opts.asset.toLowerCase());
    const current = app.getVersion();
    if (!asset || !isNewer(rel.tag_name, current)) return;

    const win = opts.getWin ? opts.getWin() : null;
    const latest = tuple(rel.tag_name).join(".");
    const appDir = path.dirname(app.getPath("exe"));
    const portable = canWrite(appDir);
    const r = await dialog.showMessageBox(win || undefined, {
      type: "info", title: opts.name, defaultId: 0, cancelId: 1, noLink: true,
      buttons: [portable ? "Update now" : "Open download page", "Later"],
      message: `${opts.name} ${latest} is available`,
      detail: `You have version ${current}. ` + (portable ? "The update downloads in a minute and the app restarts by itself. Your settings are kept." : "This folder can't be changed by the app, so the new version has to be copied by hand."),
    });
    if (r.response !== 0) return;
    if (!portable) { shell.openExternal(rel.html_url); return; }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "upd-"));
    const zip = path.join(tmp, "update.zip");
    const setBar = (f) => { const w = opts.getWin && opts.getWin(); if (w && !w.isDestroyed()) { w.setProgressBar(f); w.setTitle(`${opts.name} - downloading update ${Math.round(Math.max(f, 0) * 100)}%`); } };
    await download(asset.browser_download_url, zip, setBar);
    setBar(-1);

    // Helper script: waits for this app to close, unpacks, copies everything except "data", starts the app again.
    const ps = path.join(tmp, "update.ps1");
    const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
    fs.writeFileSync(ps, [
      "$ErrorActionPreference = 'Continue'",
      `try { Wait-Process -Id ${process.pid} -Timeout 60 } catch {}`,
      "Start-Sleep -Milliseconds 800",
      `$tmp = ${q(tmp)}; $zip = ${q(zip)}; $dst = ${q(appDir)}; $exe = ${q(opts.exe)}`,
      "$out = Join-Path $tmp 'x'; New-Item -ItemType Directory -Force -Path $out | Out-Null",
      "tar -xf $zip -C $out",
      "if ($LASTEXITCODE -ne 0) { Expand-Archive -Force -Path $zip -DestinationPath $out }",
      "$found = Get-ChildItem -Path $out -Recurse -Filter $exe -File | Select-Object -First 1",
      "if ($found) {",
      "  robocopy $found.DirectoryName $dst /E /XD data /R:3 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null",
      "}",
      "Start-Process -FilePath (Join-Path $dst $exe)",
      "Start-Sleep -Seconds 2",
      "Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue",
    ].join("\r\n"), "utf8");
    spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", ps], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    for (const w of BrowserWindow.getAllWindows()) { try { w.destroy(); } catch (_) { /* */ } }
    app.exit(0);
  } catch (_) { /* offline or any other trouble: no message, the app keeps working */ }
}

module.exports = { start };
