// Conversions that run in the page: PDF -> Word / Excel / PowerPoint / images / text, Office -> PDF, OCR.
import { T } from "./i18n.js";
import { call, loadScript, progress, checkCancel, u8ToB64, ext, baseName, esc } from "./ui.js";

const LIB = "lib/";

// ------------------------------------------------------------------ helpers
function median(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; }
function joinLines(ls) {
  let out = "";
  for (const l of ls) {
    const t = l.text.trim();
    if (!out) out = t;
    else if (/[-­]$/.test(out) && /^[a-zà-ÿ]/.test(t)) out = out.replace(/[-­]$/, "") + t;
    else out += " " + t;
  }
  return out;
}
/** Paragraphs of a page: lines grouped by text block, split where the gap between lines is large. */
export function paragraphs(ls) {
  const out = [];
  let cur = null;
  for (const l of ls) {
    const prev = cur && cur.lines[cur.lines.length - 1];
    const gap = prev ? l.y0 - prev.y1 : 0;
    if (!cur || l.block !== cur.block || gap > l.size * 0.9 || Math.abs(l.size - prev.size) > 1.5) {
      cur = { block: l.block, lines: [] };
      out.push(cur);
    }
    cur.lines.push(l);
  }
  return out.map(p => {
    const f = p.lines[0];
    return { text: joinLines(p.lines), size: median(p.lines.map(l => l.size)), bold: p.lines.every(l => l.bold), italic: p.lines.every(l => l.italic),
      color: f.color, x0: Math.min(...p.lines.map(l => l.x0)), x1: Math.max(...p.lines.map(l => l.x1)), y0: f.y0, lines: p.lines };
  });
}
function hexNoHash(c) { return (c || "#000000").replace("#", "").toUpperCase(); }
function chars(ls) { return ls.reduce((n, l) => n + l.text.length, 0); }

// ------------------------------------------------------------------ PDF -> Word
export async function toWord(id, pages) {
  await loadScript(LIB + "index.iife.js");
  const { Document, Packer, Paragraph, TextRun, ImageRun, PageBreak, AlignmentType } = window.docx;
  const children = [];
  const first = pages[0];
  for (let i = 0; i < pages.length; i++) {
    checkCancel();
    progress(i / pages.length, T("Page {0} of {1}", i + 1, pages.length));
    const pg = pages[i];
    const ls = await call("lines", id, i);
    if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    if (chars(ls) < 20) {
      // scanned page: keep it as a picture
      const jpg = await call("renderJPEG", id, i, 1.6, 80);
      const wpx = Math.min(624, pg.w * 96 / 72), hpx = wpx * pg.h / pg.w;
      children.push(new Paragraph({ children: [new ImageRun({ type: "jpg", data: jpg, transformation: { width: wpx, height: hpx } })] }));
      continue;
    }
    const body = median(ls.map(l => l.size)) || 11;
    for (const p of paragraphs(ls)) {
      const width = p.x1 - p.x0, mid = (p.x0 + p.x1) / 2;
      const centered = width < pg.w * 0.6 && Math.abs(mid - pg.w / 2) < pg.w * 0.06;
      const heading = p.size > body * 1.25;
      children.push(new Paragraph({
        alignment: centered ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { after: heading ? 160 : 100 },
        children: [new TextRun({ text: p.text, bold: p.bold || heading, italics: p.italic, size: Math.round(p.size * 2), color: hexNoHash(p.color), font: "Calibri" })],
      }));
    }
  }
  const doc = new Document({
    creator: "PdfEditor",
    sections: [{ properties: { page: { size: { width: Math.round(first.w * 20), height: Math.round(first.h * 20) },
      margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}

// ------------------------------------------------------------------ PDF -> Excel
function toNumber(s) {
  const t = s.replace(/[€$£%\s]/g, "");
  if (!/^-?[\d.,]+$/.test(t) || !/\d/.test(t)) return null;
  let v = null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) v = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) v = t.replace(/,/g, "");
  else if (/^-?\d+([.,]\d+)?$/.test(t)) v = t.replace(",", ".");
  if (v == null) return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  return s.includes("%") ? n / 100 : n;
}

/** Rows and columns from word positions. */
export function tableFromWords(ws) {
  ws = ws.filter(w => w.text.trim());
  ws.sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);
  const rows = [];
  for (const w of ws) {
    const yc = (w.y0 + w.y1) / 2, h = w.y1 - w.y0;
    let r = rows.length ? rows[rows.length - 1] : null;
    if (!r || Math.abs(yc - r.yc) > Math.max(h, r.h) * 0.55) { r = { yc, h, words: [] }; rows.push(r); }
    r.words.push(w);
  }
  // cells: split a row where the gap is wider than about two spaces
  const rowCells = rows.map(r => {
    r.words.sort((a, b) => a.x0 - b.x0);
    const cells = [];
    for (const w of r.words) {
      const c = cells[cells.length - 1];
      if (c && w.x0 - c.x1 < Math.max(w.size || 10, 6) * 0.9) { c.text += " " + w.text; c.x1 = w.x1; }
      else cells.push({ x0: w.x0, x1: w.x1, text: w.text });
    }
    return cells;
  });
  // columns: cluster the left edges
  const edges = rowCells.flat().map(c => c.x0).sort((a, b) => a - b);
  const cols = [];
  for (const x of edges) { if (!cols.length || x - cols[cols.length - 1].max > 14) cols.push({ min: x, max: x }); else cols[cols.length - 1].max = x; }
  const colOf = (x) => { let best = 0, d = Infinity; cols.forEach((c, k) => { const dd = x < c.min ? c.min - x : x > c.max ? x - c.max : 0; if (dd < d) { d = dd; best = k; } }); return best; };
  return rowCells.map(cells => {
    const row = new Array(cols.length).fill(null);
    for (const c of cells) {
      let k = colOf(c.x0);
      while (row[k] != null && k < row.length - 1) k++;
      const n = toNumber(c.text);
      row[k] = row[k] == null ? (n != null ? n : c.text) : row[k] + " " + c.text;
    }
    return row;
  });
}

export async function toExcel(id, pages, oneSheet = false) {
  await loadScript(LIB + "xlsx.full.min.js");
  const X = window.XLSX;
  const wb = X.utils.book_new();
  let all = [];
  for (let i = 0; i < pages.length; i++) {
    checkCancel();
    progress(i / pages.length, T("Page {0} of {1}", i + 1, pages.length));
    const aoa = tableFromWords(await call("words", id, i));
    if (oneSheet) { if (all.length && aoa.length) all.push([]); all = all.concat(aoa); continue; }
    const ws = X.utils.aoa_to_sheet(aoa.length ? aoa : [[""]]);
    ws["!cols"] = widths(aoa);
    X.utils.book_append_sheet(wb, ws, T("Page {0}{1}", i, 1));
  }
  if (oneSheet) { const ws = X.utils.aoa_to_sheet(all.length ? all : [[""]]); ws["!cols"] = widths(all); X.utils.book_append_sheet(wb, ws, "PDF"); }
  return new Uint8Array(X.write(wb, { type: "array", bookType: "xlsx" }));
}
function widths(aoa) {
  const w = [];
  for (const r of aoa) r.forEach((v, k) => { w[k] = Math.max(w[k] || 6, Math.min(60, String(v ?? "").length + 2)); });
  return w.map(wch => ({ wch }));
}

// ------------------------------------------------------------------ PDF -> PowerPoint
export async function toPowerPoint(id, pages) {
  await loadScript(LIB + "pptxgen.bundle.js");
  const pptx = new window.PptxGenJS();
  const W = pages[0].w / 72, H = pages[0].h / 72;
  pptx.defineLayout({ name: "PDF", width: W, height: H });
  pptx.layout = "PDF";
  for (let i = 0; i < pages.length; i++) {
    checkCancel();
    progress(i / pages.length, T("Page {0} of {1}", i + 1, pages.length));
    const pg = pages[i];
    const k = Math.min(W / (pg.w / 72), H / (pg.h / 72));
    const slide = pptx.addSlide();
    const png = await call("renderWithoutText", id, i, 2);
    slide.background = { data: "image/png;base64," + u8ToB64(png) };
    const ls = await call("lines", id, i);
    for (const l of ls) {
      if (!l.text.trim()) continue;
      const h = (l.y1 - l.y0) / 72 * k;
      slide.addText(l.text, {
        x: l.x0 / 72 * k, y: l.y0 / 72 * k - h * 0.12, w: (l.x1 - l.x0) / 72 * k * 1.08 + 0.1, h: h * 1.25,
        fontSize: Math.max(4, l.size * k), bold: l.bold, italic: l.italic, color: hexNoHash(l.color), fontFace: "Arial",
        margin: 0, valign: "top", wrap: false, fit: "none",
      });
    }
  }
  return new Uint8Array(await pptx.write({ outputType: "uint8array" }));
}

// ------------------------------------------------------------------ PDF -> images / text
export async function toImages(id, pages, dpi = 150, format = "jpg") {
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    checkCancel();
    progress(i / pages.length, T("Page {0} of {1}", i + 1, pages.length));
    const bytes = format === "png" ? await call("renderPNG", id, i, dpi / 72) : await call("renderJPEG", id, i, dpi / 72, 88);
    out.push(bytes);
  }
  return out;
}
export async function zip(files) {
  await loadScript(LIB + "jszip.min.js");
  const z = new window.JSZip();
  for (const f of files) z.file(f.name, f.bytes);
  return await z.generateAsync({ type: "uint8array", compression: "STORE" });
}
export async function toText(id, n) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    checkCancel();
    progress(i / n);
    parts.push(await call("pageText", id, i));
  }
  return new TextEncoder().encode(parts.map((t, i) => `--- Page ${i + 1} ---\n${t.trim()}\n`).join("\n"));
}

// ------------------------------------------------------------------ Office & others -> PDF
const CSS = `<style>
@page { margin: 2cm 1.8cm; }
body { font-family: sans-serif; font-size: 11pt; line-height: 1.35; }
h1 { font-size: 20pt; } h2 { font-size: 16pt; } h3 { font-size: 13pt; }
table { border-collapse: collapse; margin: 6pt 0; }
td, th { border: 0.5pt solid #999; padding: 2pt 4pt; vertical-align: top; font-size: 9.5pt; }
img { max-width: 100%; }
.pb { page-break-before: always; }
.slide { border-bottom: 0.5pt solid #bbb; padding-bottom: 8pt; margin-bottom: 12pt; }
</style>`;
const wrapHtml = (body) => `<!doctype html><html><head><meta charset="utf-8">${CSS}</head><body>${body}</body></html>`;

export const OFFICE_EXT = ["docx", "xlsx", "xls", "xlsm", "ods", "csv", "pptx", "txt", "md", "html", "htm", "rtf", "odt", "doc", "ppt"];
export const NATIVE_EXT = ["epub", "xps", "oxps", "cbz", "fb2", "mobi", "svg", "jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff", "jxr", "pnm", "webp"];

/** Any supported file to PDF bytes. */
export async function fileToPdf(bytes, name) {
  const e = ext(name);
  if (e === "pdf") return bytes;
  if (NATIVE_EXT.includes(e)) return await call("anyToPdf", bytes, name);
  if (e === "docx") {
    await loadScript(LIB + "mammoth.browser.min.js");
    const r = await window.mammoth.convertToHtml({ arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    return await call("htmlToPdf", wrapHtml(r.value), false);
  }
  if (["xlsx", "xls", "xlsm", "ods", "csv"].includes(e)) {
    await loadScript(LIB + "xlsx.full.min.js");
    const X = window.XLSX;
    const wb = X.read(bytes, { type: "array", cellDates: true });
    let maxCols = 0;
    const parts = wb.SheetNames.map((sn, k) => {
      const ws = wb.Sheets[sn];
      if (ws["!ref"]) { const r = X.utils.decode_range(ws["!ref"]); maxCols = Math.max(maxCols, r.e.c - r.s.c + 1); }
      const t = X.utils.sheet_to_html(ws, { header: "", footer: "" }).replace(/^[\s\S]*?<table/i, "<table").replace(/<\/table>[\s\S]*$/i, "</table>");
      return `<div class="${k ? "pb" : ""}">${wb.SheetNames.length > 1 ? `<h3>${esc(sn)}</h3>` : ""}${t}</div>`;
    });
    return await call("htmlToPdf", wrapHtml(parts.join("")), maxCols > 7);
  }
  if (e === "pptx") return await call("htmlToPdf", wrapHtml(await pptxHtml(bytes)), true);
  if (e === "txt" || e === "md" || e === "csv") {
    const t = new TextDecoder().decode(bytes);
    return await call("htmlToPdf", wrapHtml(`<pre style="white-space:pre-wrap;font-family:monospace;font-size:9.5pt">${esc(t)}</pre>`), false);
  }
  if (e === "html" || e === "htm") return await call("htmlToPdf", new TextDecoder().decode(bytes), false);
  if (e === "odt") return await call("htmlToPdf", wrapHtml(await odtHtml(bytes)), false);
  if (e === "doc" || e === "ppt" || e === "rtf") throw new Error(`.${e} files cannot be converted on the phone. Save the file as .docx or .pptx first (or use the Windows app).`);
  // last try: let MuPDF guess
  return await call("anyToPdf", bytes, name);
}

async function pptxHtml(bytes) {
  await loadScript(LIB + "jszip.min.js");
  const z = await window.JSZip.loadAsync(bytes);
  const slides = Object.keys(z.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => +a.match(/(\d+)\.xml/)[1] - +b.match(/(\d+)\.xml/)[1]);
  const dp = new DOMParser();
  const out = [];
  for (const [k, f] of slides.entries()) {
    const xml = dp.parseFromString(await z.file(f).async("string"), "application/xml");
    const paras = [...xml.getElementsByTagName("a:p")].map(p => [...p.getElementsByTagName("a:t")].map(t => t.textContent).join("")).filter(t => t.trim());
    // pictures used by the slide
    const imgs = [];
    const relsFile = z.file(f.replace("slides/", "slides/_rels/") + ".rels");
    if (relsFile) {
      const rels = dp.parseFromString(await relsFile.async("string"), "application/xml");
      for (const r of rels.getElementsByTagName("Relationship")) {
        const t = r.getAttribute("Target") || "";
        if (!/\.(png|jpe?g|gif)$/i.test(t)) continue;
        const path = "ppt/" + t.replace(/^\.\.\//, "");
        const file = z.file(path);
        if (file) imgs.push(`<img src="data:image/${/png$/i.test(t) ? "png" : "jpeg"};base64,${await file.async("base64")}" style="max-height:9cm">`);
      }
    }
    out.push(`<div class="${k ? "pb " : ""}slide"><p class="muted" style="color:#888;font-size:9pt">Slide ${k + 1}</p>` +
      paras.map((t, j) => j === 0 ? `<h2>${esc(t)}</h2>` : `<p>${esc(t)}</p>`).join("") + imgs.join("") + "</div>");
  }
  return out.join("") || "<p>(empty presentation)</p>";
}

async function odtHtml(bytes) {
  await loadScript(LIB + "jszip.min.js");
  const z = await window.JSZip.loadAsync(bytes);
  const xml = new DOMParser().parseFromString(await z.file("content.xml").async("string"), "application/xml");
  const out = [];
  for (const el of xml.getElementsByTagName("*")) {
    if (el.localName === "h") out.push(`<h2>${esc(el.textContent)}</h2>`);
    else if (el.localName === "p" && el.parentNode.localName !== "list-item") out.push(`<p>${esc(el.textContent)}</p>`);
  }
  return out.join("");
}

// ------------------------------------------------------------------ OCR (tesseract.js)
let ocrWorker = null, ocrLangs = "";
async function getOcr(langs) {
  if (ocrWorker && ocrLangs === langs) return ocrWorker;
  if (ocrWorker) { await ocrWorker.terminate(); ocrWorker = null; }
  if (!window.Tesseract) await loadScript(LIB + "tesseract/tesseract.min.js");
  const abs = (p) => new URL(p, location.href).href;
  ocrWorker = await window.Tesseract.createWorker(langs.split("+"), 1, {
    workerPath: abs(LIB + "tesseract/worker.min.js"),
    corePath: abs(LIB + "tesseract/" + (simdOk() ? "tesseract-core-simd-lstm.wasm.js" : "tesseract-core-lstm.wasm.js")),
    langPath: abs(LIB + "tessdata"),
    workerBlobURL: false,
    cacheMethod: "none",
    gzip: true,
  });
  ocrLangs = langs;
  return ocrWorker;
}
function simdOk() {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch (_) { return false; }
}

/** OCR one page: returns words in page coordinates. */
export async function ocrPage(id, i, page, langs) {
  const w = await getOcr(langs);
  const scale = Math.min(300 / 72, 2600 / Math.max(page.w, page.h));
  const png = await call("renderPNG", id, i, scale);
  const res = await w.recognize(new Blob([png], { type: "image/png" }), {}, { blocks: true, text: false });
  const words = [];
  for (const b of res.data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const wd of l.words || []) {
    if (!wd.text || !wd.text.trim() || wd.confidence < 20) continue;
    const bb = wd.bbox;
    words.push({ text: wd.text, x0: bb.x0 / scale, y0: bb.y0 / scale, x1: bb.x1 / scale, y1: bb.y1 / scale });
  }
  return words;
}
export async function stopOcr() { if (ocrWorker) { try { await ocrWorker.terminate(); } catch (_) { /* */ } ocrWorker = null; } }

export function suggestName(name, suffix, extension) { return baseName(name) + (suffix || "") + "." + extension; }
