// Shared helpers: DOM, sheets, busy overlay, worker calls and the bridge to the host app
// (Android WebView on the phone, Electron on the PC, or a plain browser for testing).
import { icon } from "./icons.js";
import { T } from "./i18n.js";

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const A = window.Android || null;     // the Android app
export const D = window.Desktop || null;     // the Windows / desktop app
export const PHONE = !!A || (!D && matchMedia("(pointer: coarse)").matches);
/** Wording: the same sentences are written for touch; on a PC they talk about the mouse. */
export function tx(s) {
  if (PHONE || s == null) return s;
  return String(s).replace(/\bTap\b/g, "Click").replace(/\btap\b/g, "click").replace(/with your finger/g, "with the mouse")
    .replace(/on (this|the) phone/g, "on this computer").replace(/to phone/g, "to this computer");
}

export function fmtSize(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}
export function baseName(name) { return String(name || "document").replace(/\.[^.]+$/, ""); }
export function ext(name) { const m = /\.([^.]+)$/.exec(name || ""); return m ? m[1].toLowerCase() : ""; }

// ------------------------------------------------------------------ worker (MuPDF)
const worker = new Worker("worker.js", { type: "module" });
let workerReady;
const readyP = new Promise((res, rej) => { workerReady = res; setTimeout(() => rej(new Error(T("The PDF engine did not start."))), 60000); });
readyP.catch(() => {});
const calls = new Map();
let seq = 0;
worker.onmessage = (e) => {
  const m = e.data;
  if (m.ready) { workerReady(); return; }
  const c = calls.get(m.id);
  if (!c) return;
  calls.delete(m.id);
  if (m.ok) c.res(m.result); else c.rej(new Error(m.error));
};
worker.onerror = (e) => { toast(T("PDF engine error: {0}", (e.message || T("could not load")))); };

export async function call(fn, ...args) {
  await readyP;
  return new Promise((res, rej) => {
    const id = ++seq;
    calls.set(id, { res, rej });
    const transfer = [];
    for (const a of args) if (a instanceof Uint8Array && a.byteOffset === 0 && a.byteLength === a.buffer.byteLength) transfer.push(a.buffer);
    worker.postMessage({ id, fn, args }, transfer);
  });
}

// ------------------------------------------------------------------ toast, hint, busy
let toastTimer = 0;
export function toast(text, ms = 2600) {
  const t = $("toast");
  t.textContent = tx(text);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

export const busyState = { on: false, cancelled: false };
export function busy(text, { cancellable = false, progress = false } = {}) {
  busyState.on = true; busyState.cancelled = false;
  $("busyText").textContent = text;
  $("busyBar").style.width = "0";
  $("busyBar").parentElement.classList.toggle("hidden", !progress);
  $("busyCancel").classList.toggle("hidden", !cancellable);
  clearTimeout(busyTimer);
  $("busy").classList.remove("hidden", "closing");
}
export function progress(frac, text) {
  $("busyBar").parentElement.classList.remove("hidden");
  $("busyBar").style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + "%";
  if (text) $("busyText").textContent = text;
}
let busyTimer = 0;
export function idle() {
  busyState.on = false;
  const b = $("busy");
  if (b.classList.contains("hidden")) return;
  b.classList.add("closing");
  clearTimeout(busyTimer);
  busyTimer = setTimeout(() => { if (!busyState.on) b.classList.add("hidden"); b.classList.remove("closing"); }, 160);
}
$("busyCancel").onclick = () => { busyState.cancelled = true; $("busyText").textContent = T("Stopping…"); };
export class Cancelled extends Error { constructor() { super(T("Cancelled")); } }
export function checkCancel() { if (busyState.cancelled) throw new Cancelled(); }

/** Run a job behind the busy overlay; errors become a message. */
export async function task(text, fn, opts = {}) {
  busy(text, opts);
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Cancelled) toast(T("Stopped."));
    else { console.error(e); showError(e); }
    return undefined;
  } finally {
    idle();
  }
}
// ------------------------------------------------------------------ log: on Windows PdfEditor.log in the program folder,
// on the phone the last lines are kept here and can be saved as a text file (Downloads) when an error shows up
const LOG = [];
export function logLine(level, msg) {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  const line = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} [${String(level).toUpperCase()}] ${String(msg).slice(0, 4000)}`;
  LOG.push(line);
  if (LOG.length > 400) LOG.splice(0, LOG.length - 400);
  try { if (D && D.log) D.log(level, msg); } catch (_) { /* */ }
}
export function logText() {
  const ua = navigator.userAgent.replace(/\s*\(KHTML[^)]*\)/, "");
  return `PdfEditor log\r\n${A ? "Android" : D ? "Windows" : "Browser"} · ${ua}\r\nLanguage: ${document.documentElement.lang || "en"}\r\n\r\n` + LOG.join("\r\n") + "\r\n";
}
/** Phone: the log as a .txt file; the save window opens in Downloads. */
export async function saveLog() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  const name = `PdfEditor-log-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.txt`;
  const r = await saveAs(new TextEncoder().encode(logText()), name, "text/plain");
  if (r && r.ok) toast(T("Log saved: {0}", r.name || name));
}
addEventListener("error", (e) => logLine("error", `${e.message} (${String(e.filename || "").split("/").pop()}:${e.lineno})`));
addEventListener("unhandledrejection", (e) => logLine("error", String((e.reason && e.reason.stack) || e.reason)));
logLine("info", `PdfEditor started (${A ? "Android" : D ? "Windows" : "browser"})`);

export function showError(e) {
  const msg = String((e && e.message) || e).replace(/^Error:\s*/, "");
  logLine("error", (e && e.stack) || msg);
  if (!A) { alertBox(T("Something went wrong"), msg); return; }
  // phone: offer to save the log
  sheet(`<h3>${esc(T("Something went wrong"))}</h3><p class="muted">${esc(msg)}</p><div class="btns"><button data-log>${esc(T("Save log"))}</button><button class="ok" data-ok>OK</button></div>`,
    card => {
      card.querySelector("[data-ok]").onclick = () => closeSheet(true);
      card.querySelector("[data-log]").onclick = () => { closeSheet(true); setTimeout(saveLog, 250); };
    });
}

// ------------------------------------------------------------------ bottom sheets
let sheetResolve = null;
export const sheetOpen = () => sheetResolve !== null;
export function sheet(html, onReady, kind = "") {
  return new Promise(res => {
    if (sheetResolve) sheetResolve(null);
    sheetResolve = res;
    const card = $("sheetCard"), box = $("sheet");
    // one sheet replacing another: keep the backdrop, only the content changes
    const swap = !box.classList.contains("hidden");
    clearTimeout(sheetTimer);
    card.innerHTML = tx(html);
    box.classList.remove("hidden", "closing", "swap");
    box.classList.toggle("menu", kind === "menu");
    box.classList.toggle("wide-sheet", kind === "wide-sheet");
    if (swap) { void card.offsetWidth; box.classList.add("swap"); }
    card.scrollTop = 0;
    if (onReady) onReady(card);
  });
}
let sheetTimer = 0;
export function closeSheet(value = null) {
  const box = $("sheet");
  const r = sheetResolve;
  sheetResolve = null;
  if (!box.classList.contains("hidden")) {
    box.classList.remove("swap");
    box.classList.add("closing");
    clearTimeout(sheetTimer);
    // if the next sheet opens right away, sheet() cancels this and swaps the content instead
    sheetTimer = setTimeout(() => { box.classList.add("hidden"); box.classList.remove("closing"); $("sheetCard").innerHTML = ""; }, 190);
  }
  if (r) r(value);
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && sheetResolve && !busyState.on) { e.preventDefault(); closeSheet(null); }
});
$("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) closeSheet(null); });

export function alertBox(title, text) {
  return sheet(`<h3>${esc(title)}</h3><p class="muted">${esc(text)}</p><div class="btns"><button class="ok" data-ok>OK</button></div>`,
    card => { card.querySelector("[data-ok]").onclick = () => closeSheet(true); });
}

export function confirmBox(title, text, ok = "OK", cancel = T("Cancel")) {
  return sheet(`<h3>${esc(title)}</h3>${text ? `<p class="muted">${esc(text)}</p>` : ""}
    <div class="btns"><button data-no>${esc(cancel)}</button><button class="ok" data-ok>${esc(ok)}</button></div>`,
  card => {
    card.querySelector("[data-ok]").onclick = () => closeSheet(true);
    card.querySelector("[data-no]").onclick = () => closeSheet(false);
  }).then(v => v === true);
}

/** List of choices. items: [{value, label, sub, icon, html}] */
export function choose(title, items, note = "", kind = "") {
  return sheet(`<h3>${esc(title)}</h3>${note ? `<p class="muted small">${esc(note)}</p>` : ""}<div class="list">` +
    items.map((it, k) => `<button class="item" data-k="${k}">${it.html || (it.icon ? icon(it.icon) : "")}
      <span><b style="font-weight:500">${esc(it.label)}</b>${it.sub ? `<br><span class="muted small">${esc(it.sub)}</span>` : ""}</span></button>`).join("") + "</div>",
  card => card.querySelectorAll(".item").forEach(b => { b.onclick = () => closeSheet(items[+b.dataset.k].value); }), kind);
}

export const PALETTE = ["#ffd43b", "#69db7c", "#4dabf7", "#f783ac", "#e0383e", "#ff922b", "#7950f2", "#1d2026", "#ffffff"];

/**
 * A form in a sheet. fields: [{name, label, type, value, options, min, max, step, placeholder, rows}]
 * types: text, number, password, textarea, select, seg, check, color, range, info
 */
export function form(title, fields, ok = "OK", note = "") {
  const row = (f, inner) => f.label ? `<div class="row"><label>${esc(f.label)}</label>${inner}</div>` : `<div class="row">${inner}</div>`;
  const opts = (f) => (f.options || []).map(o => typeof o === "object" ? o : { value: o, label: o });
  const html = (f) => {
    const v = f.value ?? "";
    switch (f.type) {
      case "textarea": return `${f.label ? `<p class="muted small" style="margin:10px 0 4px">${esc(f.label)}</p>` : ""}<textarea data-k="${f.name}" rows="${f.rows || 4}" placeholder="${esc(f.placeholder || "")}">${esc(v)}</textarea>`;
      case "select": return row(f, `<select data-k="${f.name}">${opts(f).map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`);
      case "seg": return row(f, `<div class="seg" data-k="${f.name}" data-v="${esc(v)}">${opts(f).map(o => `<button data-val="${esc(o.value)}" class="${String(o.value) === String(v) ? "on" : ""}">${esc(o.label)}</button>`).join("")}</div>`);
      case "check": return `<label class="chk"><input type="checkbox" data-k="${f.name}" ${v ? "checked" : ""}> <span>${esc(f.text || f.label)}</span></label>`;
      case "color": return row(f, `<div class="colors" data-k="${f.name}" data-v="${esc(v)}">${(f.options || PALETTE).map(c => `<button class="color ${c === v ? "on" : ""}" data-val="${c}" style="background:${c}"></button>`).join("")}</div>`);
      case "range": return row(f, `<input type="range" data-k="${f.name}" min="${f.min}" max="${f.max}" step="${f.step || 1}" value="${v}" style="flex:1"><span class="muted small rv" style="min-width:42px;text-align:right">${esc(f.fmt ? f.fmt(v) : v)}</span>`);
      case "info": return `<p class="muted small" style="margin:8px 0">${f.html || esc(v)}</p>`;
      default: return row(f, `<input data-k="${f.name}" type="${f.type || "text"}" value="${esc(v)}" placeholder="${esc(f.placeholder || "")}"
        ${f.min != null ? `min="${f.min}"` : ""} ${f.max != null ? `max="${f.max}"` : ""} ${f.type === "number" ? 'inputmode="decimal"' : ""} autocomplete="off">`);
    }
  };
  return sheet(`<h3>${esc(title)}</h3>${note ? `<p class="muted small">${esc(note)}</p>` : ""}${fields.map(html).join("")}
    <div class="btns"><button data-no>Cancel</button><button class="ok" data-ok>${esc(ok)}</button></div>`,
  card => {
    card.querySelectorAll(".seg, .colors").forEach(g => g.querySelectorAll("button").forEach(b => {
      b.onclick = () => { g.querySelectorAll("button").forEach(x => x.classList.remove("on")); b.classList.add("on"); g.dataset.v = b.dataset.val; };
    }));
    card.querySelectorAll('input[type=range]').forEach(r => {
      const f = fields.find(x => x.name === r.dataset.k);
      r.oninput = () => { r.parentElement.querySelector(".rv").textContent = f.fmt ? f.fmt(r.value) : r.value; };
    });
    const submit = () => {
      const out = {};
      card.querySelectorAll("[data-k]").forEach(el => {
        const f = fields.find(x => x.name === el.dataset.k);
        if (el.classList.contains("seg") || el.classList.contains("colors")) out[f.name] = el.dataset.v;
        else if (el.type === "checkbox") out[f.name] = el.checked;
        else if (el.type === "number" || el.type === "range") out[f.name] = el.value === "" ? null : Number(el.value);
        else out[f.name] = el.value;
      });
      for (const f of fields) {
        if (f.required && (out[f.name] == null || out[f.name] === "")) { toast(T("{0} is required.", (f.label || T("This field")))); return; }
        if (f.validate) { const err = f.validate(out[f.name], out); if (err) { toast(err); return; } }
      }
      closeSheet(out);
    };
    card.querySelector("[data-ok]").onclick = submit;
    card.querySelector("[data-no]").onclick = () => closeSheet(null);
    card.querySelectorAll("input:not([type=checkbox]):not([type=range])").forEach(i => {
      i.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    });
    const first = card.querySelector("input:not([type=checkbox]):not([type=range]), textarea");
    if (first && fields[0] && fields[0].focus !== false) setTimeout(() => { first.focus(); if (first.select && first.type !== "number") first.select(); }, 60);
  });
}

// ------------------------------------------------------------------ files: Android bridge or browser fallback
const picks = new Map();
const saves = new Map();
let pickSeq = 0;
export const incoming = { handler: null };

window.GPE = window.GPE || {};
GPE.onFilesOpened = (files, mode) => {
  if (picks.has(mode)) { const r = picks.get(mode); picks.delete(mode); r(files || []); return; }
  if (incoming.handler && files && files.length) incoming.handler(files, mode);
};
GPE.onSaved = (ok, name, cb) => { const r = saves.get(cb); saves.delete(cb); if (r) r({ ok: !!ok, name }); };

/** Ask the user for files. mimes: "application/pdf" or a comma separated list. */
const FILTERS = {
  "application/pdf": { name: "PDF", extensions: ["pdf"] },
  "image/*": { name: "Pictures", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "tif", "tiff"] },
};
function filtersFor(mimes) {
  const out = [], all = [];
  for (const m of mimes.split(",")) {
    const f = FILTERS[m.trim()];
    if (f) { out.push(f); all.push(...f.extensions); }
  }
  if (!out.length) {   // Office and text types, given as a list of mime types
    const map = { wordprocessingml: "docx", spreadsheetml: "xlsx", presentationml: "pptx", "text/plain": "txt", "text/csv": "csv",
      "text/html": "html", "text/markdown": "md", msword: "doc", "ms-excel": "xls", "ms-powerpoint": "ppt", rtf: "rtf", "image/": null };
    for (const m of mimes.split(",")) for (const k in map) if (m.includes(k) && map[k]) all.push(map[k]);
    if (all.length) out.push({ name: "Documents", extensions: [...new Set(all)] });
  } else if (out.length > 1) out.unshift({ name: "PDF and pictures", extensions: all });
  out.push({ name: "All files", extensions: ["*"] });
  return out;
}
const deskFile = (f) => ({ name: f.name, size: f.size, mime: "", path: f.path, token: f.path, canSave: true });

export function pickFiles(mimes = "application/pdf", multiple = false) {
  if (D) return D.pick({ filters: filtersFor(mimes), multiple }).then(list => (list || []).map(deskFile));
  if (A) {
    return new Promise(res => {
      const mode = "pick" + (++pickSeq);
      picks.set(mode, res);
      A.openFiles(mimes, multiple, mode);
    });
  }
  return new Promise(res => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.multiple = multiple;
    inp.accept = mimes.split(",").map(m => m === "*/*" ? "" : m).join(",");
    inp.onchange = () => res([...inp.files].map(f => ({ name: f.name, size: f.size, mime: f.type, file: f, url: URL.createObjectURL(f), canSave: false })));
    inp.click();
  });
}

export async function readFile(f) {
  if (f.file) return new Uint8Array(await f.file.arrayBuffer());
  if (D && f.path) {
    const b = await D.read(f.path);
    if (!b) throw new Error(T("Could not read {0}", f.name));
    return new Uint8Array(b);
  }
  const r = await fetch(f.url);
  if (!r.ok) throw new Error(T("Could not read {0}", f.name));
  return new Uint8Array(await r.arrayBuffer());
}
export function releaseFile(f) {
  if (!f) return;
  if (A && f.token) { try { A.releaseFile(f.token); } catch (_) { /* */ } }
  if (f.file && f.url) URL.revokeObjectURL(f.url);
}

function b64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function toTemp(bytes) {
  const h = A.beginWrite();
  if (!h) throw new Error(T("No space to write the file."));
  const CH = 3 * 512 * 1024;
  for (let i = 0; i < bytes.length; i += CH) {
    if (!A.writeChunk(h, b64(bytes.subarray(i, i + CH)))) throw new Error(T("Could not write the file."));
  }
  return h;
}
function download(bytes, name, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Overwrite the file the document came from. */
export function saveOver(bytes, token) {
  if (D) return D.write(token, bytes);
  if (!A) { download(bytes, "document.pdf", "application/pdf"); return true; }
  return A.saveOver(toTemp(bytes), token);
}
/** Let the user pick where to save. Resolves {ok, name}. */
export function saveAs(bytes, name, mime) {
  if (D) return D.saveAs(bytes, name).then(r => r || { ok: false });
  if (!A) { download(bytes, name, mime); return Promise.resolve({ ok: true, name }); }
  return new Promise(res => {
    const cb = "s" + (++pickSeq);
    saves.set(cb, res);
    A.saveAs(toTemp(bytes), name, mime, cb);
  });
}
export function share(bytes, name, mime) {
  if (!A) {
    const f = new File([bytes], name, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [f] })) return navigator.share({ files: [f] }).catch(() => {});
    download(bytes, name, mime);
    return;
  }
  A.share(toTemp(bytes), name, mime);
}
export function openWith(bytes, name, mime) {
  if (D) { D.openTemp(bytes, name); return; }
  if (!A) { window.open(URL.createObjectURL(new Blob([bytes], { type: mime }))); return; }
  A.open(toTemp(bytes), name, mime);
}
export function openUrl(url) { if (D) D.openUrl(url); else if (A && A.openUrl) A.openUrl(url); else window.open(url, "_blank"); }

/** Files dropped on the window or passed to the program: same shape as picked files. */
export function droppedFiles(list) {
  return [...list].map(f => {
    const path = D ? D.pathOf(f) : "";
    return path ? deskFile({ name: f.name, size: f.size, path }) : { name: f.name, size: f.size, mime: f.type, file: f, url: URL.createObjectURL(f), canSave: false };
  });
}
if (D) D.onOpen((files) => { if (incoming.handler && files && files.length) incoming.handler(files.map(deskFile), "open"); });

export const MIME = {
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip", jpg: "image/jpeg", png: "image/png", txt: "text/plain",
};

/** A finished file: offer Save / Share / Open. */
export async function deliver(bytes, name, mime, title = T("Ready")) {
  const v = await sheet(`<h3>${esc(title)}</h3><p class="muted">${esc(name)}, ${fmtSize(bytes.length)}</p>
    <button class="item" data-v="save">${icon("save")}<span>${PHONE ? T("Save to phone") : T("Save as…")}</span></button>
    ${PHONE ? `<button class="item" data-v="share">${icon("link")}<span>Share</span></button>` : ""}
    <button class="item" data-v="open">${icon("open")}<span>${PHONE ? T("Open with another app") : T("Open now")}</span></button>`,
  card => card.querySelectorAll(".item").forEach(b => { b.onclick = () => closeSheet(b.dataset.v); }));
  if (v === "save") {
    const r = await saveAs(bytes, name, mime);
    if (r.ok) toast(T("Saved") + (r.name ? ": " + r.name : "."));
  } else if (v === "share") share(bytes, name, mime);
  else if (v === "open") openWith(bytes, name, mime);
}

// ------------------------------------------------------------------ lazy loaded libraries
const libs = new Map();
export function loadScript(src) {
  if (!libs.has(src)) {
    libs.set(src, new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => res();
      s.onerror = () => { libs.delete(src); rej(new Error(T("Could not load {0}", src))); };
      document.head.appendChild(s);
    }));
  }
  return libs.get(src);
}

export function u8ToB64(u8) { return b64(u8); }

/** Turn any picture the browser can show into JPEG/PNG bytes MuPDF understands. */
export async function normalizeImage(bytes, mime, name) {
  const e = ext(name);
  if (/jpe?g|png/.test(mime || "") || ["jpg", "jpeg", "png"].includes(e)) return bytes;
  const bmp = await createImageBitmap(new Blob([bytes], { type: mime || "image/*" }));
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.9));
  return new Uint8Array(await blob.arrayBuffer());
}

export function storeGet(k, d) { try { const v = localStorage.getItem("gpe." + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } }
export function storeSet(k, v) { try { localStorage.setItem("gpe." + k, JSON.stringify(v)); } catch (_) { /* full or blocked */ } }
