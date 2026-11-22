// The only bridge between the page and the computer: a short list of file actions.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("Desktop", {
  platform: process.platform,
  version: ipcRenderer.sendSync("version"),
  pick: (opts) => ipcRenderer.invoke("pick", opts),
  read: (p) => ipcRenderer.invoke("read", p),
  exists: (p) => ipcRenderer.invoke("exists", p),
  write: (p, bytes) => ipcRenderer.invoke("write", p, bytes),
  saveAs: (bytes, name) => ipcRenderer.invoke("save-as", bytes, name),
  openTemp: (bytes, name) => ipcRenderer.invoke("open-temp", bytes, name),
  openUrl: (url) => ipcRenderer.send("open-url", url),
  pathOf: (file) => { try { return webUtils.getPathForFile(file) || ""; } catch (_) { return ""; } },
  setTheme: (theme, dark) => ipcRenderer.send("set-theme", theme, dark),
  setTitle: (t) => ipcRenderer.send("set-title", t),
  onOpen: (cb) => ipcRenderer.on("open-files", (_e, files) => cb(files)),
  onCloseRequest: (cb) => ipcRenderer.on("close-request", () => cb()),
  closeNow: () => ipcRenderer.send("close-now"),
  ready: () => ipcRenderer.send("ready"),
  printImages: (imgs, per, title) => ipcRenderer.invoke("print-images", imgs, per, title),
  openWith: (on) => ipcRenderer.invoke("open-with", on),
  openDefaultApps: () => ipcRenderer.send("default-apps"),
});
