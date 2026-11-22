// PDF engine for the phone app, built on MuPDF.js (WebAssembly).
// Runs inside a Web Worker (see worker.js); also importable from Node for tests.
// All coordinates are page display coordinates (points, origin top-left, page rotation applied).

let mupdf = null;
export function setMupdf(m) { mupdf = m; }

const docs = new Map();
let nextId = 1;

// ------------------------------------------------------------------ helpers
function D(id) {
  const d = docs.get(id);
  if (!d) throw new Error("Document is not open.");
  return d;
}
function pdfPage(d, i) { return d.doc.loadPage(i); }
function hexToRgb(h) {
  h = (h || "#000000").replace("#", "");
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}
function rgbToHex(c) {
  if (!c || !c.length) return null;
  if (c.length === 1) c = [c[0], c[0], c[0]];
  if (c.length === 4) { const k = c[3]; c = [(1 - c[0]) * (1 - k), (1 - c[1]) * (1 - k), (1 - c[2]) * (1 - k)]; }
  return "#" + c.slice(0, 3).map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}
function rectFromPoints(a, b) { return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; }
function op(d, name, fn) {
  d.doc.beginOperation(name);
  try {
    const r = fn();
    d.doc.endOperation();
    d.changed = true;
    return r;
  } catch (e) {
    try { d.doc.abandonOperation(); } catch (_) { /* ignore */ }
    throw e;
  }
}
function pageInfo(d) {
  const n = d.doc.countPages();
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = d.doc.loadPage(i);
    const b = p.getBounds();
    out.push({ w: b[2] - b[0], h: b[3] - b[1] });
  }
  return out;
}
function flatOutline(items, level = 1, out = []) {
  for (const it of items || []) {
    out.push({ level, title: it.title || "", page: typeof it.page === "number" ? it.page : -1 });
    if (it.down) flatOutline(it.down, level + 1, out);
  }
  return out;
}

// ------------------------------------------------------------------ open / info / save
export function open(bytes, name = "document.pdf", password = null) {
  let doc = mupdf.Document.openDocument(bytes, name.toLowerCase().endsWith(".pdf") ? "application/pdf" : name);
  if (!doc.isPDF()) {
    // ebooks, images, XPS: convert to PDF
    if (doc.needsPassword() && !(password && doc.authenticatePassword(password))) {
      return { needsPassword: true };
    }
    doc = convertToPdf(doc);
  }
  doc = doc.asPDF ? (doc.asPDF() || doc) : doc;
  if (doc.needsPassword()) {
    if (!password || !doc.authenticatePassword(password)) return { needsPassword: true };
  }
  const id = nextId++;
  const d = { doc, name, password, changed: false };
  try { doc.enableJournal(); } catch (_) { /* no undo for this file */ }
  docs.set(id, d);
  return { id, ...info(id) };
}

export function info(id) {
  const d = D(id);
  let toc = [];
  try { toc = flatOutline(d.doc.loadOutline()); } catch (_) { /* none */ }
  let forms = false;
  const n = d.doc.countPages();
  for (let i = 0; i < Math.min(n, 30) && !forms; i++) {
    try { forms = d.doc.loadPage(i).getWidgets().length > 0; } catch (_) { /* ignore */ }
  }
  return {
    pages: pageInfo(d), toc, forms, name: d.name,
    title: d.doc.getMetaData("info:Title") || "",
    canUndo: safe(() => d.doc.canUndo(), false), canRedo: safe(() => d.doc.canRedo(), false),
    encrypted: !!d.password, changed: d.changed,
  };
}
function safe(fn, dflt) { try { return fn(); } catch (_) { return dflt; } }

export function close(id) { const d = docs.get(id); if (d) { try { d.doc.destroy?.(); } catch (_) { /* */ } docs.delete(id); } }

function convertToPdf(src) {
  const buf = new mupdf.Buffer();
  const w = new mupdf.DocumentWriter(buf, "pdf", "");
  const n = src.countPages();
  for (let i = 0; i < n; i++) {
    const p = src.loadPage(i);
    const dev = w.beginPage(p.getBounds());
    p.run(dev, mupdf.Matrix.identity);
    w.endPage();
  }
  w.close();
  return mupdf.Document.openDocument(buf.asUint8Array(), "application/pdf");
}

export function save(id, opts = {}) {
  const d = D(id);
  const o = ["garbage=compact", "compress=yes", "compress-images=yes", "compress-fonts=yes"];
  if (opts.clean) o.push("clean=yes");
  if (opts.pack) { o[0] = "garbage=deduplicate"; o.push("objstms=yes"); }
  if (opts.encrypt) {
    o.push("encrypt=aes-256");
    if (opts.userPassword) o.push("user-password=" + opts.userPassword);
    o.push("owner-password=" + (opts.ownerPassword || opts.userPassword || Math.random().toString(36).slice(2)));
    if (opts.permissions != null) o.push("permissions=" + opts.permissions);
  } else if (opts.decrypt) {
    o.push("decrypt=yes");
  } else if (d.password) {
    o.push("encrypt=keep");
  }
  if (opts.subsetFonts) safe(() => d.doc.subsetFonts(), null);
  return d.doc.saveToBuffer(o.join(",")).asUint8Array().slice();
}

/** Replace the bookmarks (outline) with a flat list [{title, page, level}] (levels make the tree). */
export function setOutline(id, list) {
  const d = D(id);
  const it = d.doc.outlineIterator();
  // remove everything
  let guard = 0;
  while (it.item() && guard++ < 100000) it.delete();
  // build again, level by level
  const uri = (p) => { try { return d.doc.formatLinkURI({ page: Math.max(0, p | 0), type: "Fit" }); } catch (_) { return "#page=" + ((p | 0) + 1); } };
  let level = 1;
  for (const b of list) {
    const want = Math.max(1, Math.min(level + 1, b.level | 0 || 1));
    while (level > want) { it.up(); it.next(); level--; }
    if (want > level) { it.prev(); it.down(); level++; }
    it.insert({ title: String(b.title || "Untitled"), uri: uri(b.page), open: true });
  }
  d.changed = true;
  return info(id);
}

/** Lossless clean-up: metadata off, fonts trimmed, packed tighter. Returns the new size. */
export function cleanup(id, { meta = true, fonts = true } = {}) {
  const d = D(id);
  if (meta) {
    try {
      op(d, "Remove metadata", () => {
      const tr = d.doc.getTrailer();
      const inf = tr.get("Info");
      if (inf && inf.isDictionary()) { const keys = []; inf.forEach((_v, k) => keys.push(k)); keys.forEach(k => inf.delete(k)); }
      const root = tr.get("Root");
      if (!root.get("Metadata").isNull()) root.delete("Metadata");
      });
    } catch (_) { /* */ }
  }
  if (fonts) safe(() => op(d, "Trim fonts", () => d.doc.subsetFonts()), null);
  d.changed = true;
  return save(id, { pack: true }).length;
}

export function undo(id) { const d = D(id); if (d.doc.canUndo()) { d.doc.undo(); d.changed = true; } return info(id); }
export function redo(id) { const d = D(id); if (d.doc.canRedo()) { d.doc.redo(); d.changed = true; } return info(id); }

// ------------------------------------------------------------------ rendering & text
export function render(id, i, scale, night = false) {
  const d = D(id);
  const p = pdfPage(d, i);
  const pix = p.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, true, true);
  if (night) pix.invertLuminance();
  const w = pix.getWidth(), h = pix.getHeight();
  const px = pix.getPixels().slice();
  pix.destroy?.();
  return { width: w, height: h, pixels: px };
}

export function renderPNG(id, i, scale) {
  const p = pdfPage(D(id), i);
  const pix = p.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
  const out = pix.asPNG().slice();
  pix.destroy?.();
  return out;
}

export function renderJPEG(id, i, scale, quality = 80) {
  const p = pdfPage(D(id), i);
  const pix = p.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
  const out = pix.asJPEG(quality).slice();
  pix.destroy?.();
  return out;
}

/** Words with boxes (for selection, OCR checks, conversions). */
export function words(id, i) {
  const p = pdfPage(D(id), i);
  const st = p.toStructuredText("preserve-whitespace");
  const out = [];
  let cur = null, line = 0, block = 0;
  const flush = () => { if (cur && cur.text.trim()) out.push(cur); cur = null; };
  st.walk({
    beginTextBlock() { block++; },
    beginLine() { flush(); line++; },
    onChar(c, origin, font, size, q, color) {
      if (c === " " || c === "\t") { flush(); return; }
      const x0 = Math.min(q[0], q[4]), y0 = Math.min(q[1], q[3]), x1 = Math.max(q[2], q[6]), y1 = Math.max(q[5], q[7]);
      if (!cur) cur = { x0, y0, x1, y1, text: "", line, block, size, font: font.getName(), color: rgbToHex(color),
        bold: font.isBold(), italic: font.isItalic() };
      cur.text += c;
      cur.x0 = Math.min(cur.x0, x0); cur.y0 = Math.min(cur.y0, y0);
      cur.x1 = Math.max(cur.x1, x1); cur.y1 = Math.max(cur.y1, y1);
    },
    endLine() { flush(); },
  });
  flush();
  st.destroy?.();
  return out;
}

/** Text lines with style, for conversions and reading mode. */
export function lines(id, i) {
  const ws = words(id, i);
  const map = new Map();
  for (const w of ws) {
    const k = w.block + ":" + w.line;
    if (!map.has(k)) map.set(k, { block: w.block, x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1, words: [] });
    const l = map.get(k);
    l.words.push(w);
    l.x0 = Math.min(l.x0, w.x0); l.y0 = Math.min(l.y0, w.y0); l.x1 = Math.max(l.x1, w.x1); l.y1 = Math.max(l.y1, w.y1);
  }
  return [...map.values()].map(l => ({
    ...l, text: l.words.map(w => w.text).join(" "),
    size: l.words[0].size, bold: l.words.every(w => w.bold), italic: l.words.every(w => w.italic),
    color: l.words[0].color, font: l.words[0].font,
  }));
}

export function pageText(id, i) {
  const p = pdfPage(D(id), i);
  const st = p.toStructuredText("preserve-whitespace");
  const t = st.asText();
  st.destroy?.();
  return t;
}

export function search(id, i, needle) {
  const p = pdfPage(D(id), i);
  const hits = p.search(needle);
  return hits.map(quads => {
    let r = null;
    for (const q of quads) {
      const b = [Math.min(q[0], q[4]), Math.min(q[1], q[3]), Math.max(q[2], q[6]), Math.max(q[5], q[7])];
      r = r ? [Math.min(r[0], b[0]), Math.min(r[1], b[1]), Math.max(r[2], b[2]), Math.max(r[3], b[3])] : b;
    }
    return r;
  });
}

export function links(id, i) {
  const d = D(id);
  const p = pdfPage(d, i);
  return p.getLinks().map(l => {
    const uri = l.getURI();
    let page = -1;
    if (uri && !/^[a-z]+:/i.test(uri)) {
      try { page = d.doc.resolveLink(uri); } catch (_) { /* */ }
    } else if (uri && uri.startsWith("#")) {
      try { page = d.doc.resolveLink(uri); } catch (_) { /* */ }
    }
    return { rect: l.getBounds(), uri, page };
  });
}

// ------------------------------------------------------------------ annotations
const MARKUP = { highlight: "Highlight", underline: "Underline", strike: "StrikeOut", squiggly: "Squiggly" };

export function annotations(id, i) {
  const p = pdfPage(D(id), i);
  return p.getAnnotations().map((a, k) => {
    const t = a.getType();
    let contents = safe(() => a.getContents(), "");
    return { index: k, type: t, rect: a.getBounds(), color: rgbToHex(safe(() => a.getColor(), [])),
      contents, author: safe(() => a.getAuthor(), "") };
  }).filter(a => a.type !== "Popup" && a.type !== "Link" && a.type !== "Widget");
}

function annotByIndex(p, index) {
  const list = p.getAnnotations();
  const a = list[index];
  if (!a) throw new Error("This comment no longer exists.");
  return a;
}

function finishAnnot(a, author) {
  if (author) safe(() => a.setAuthor(author), null);
  safe(() => a.setModificationDate(new Date()), null);
  a.update();
}

export function addMarkup(id, i, kind, rects, color, opacity = 1, author = "") {
  const d = D(id);
  return op(d, "Markup", () => {
    const p = pdfPage(d, i);
    const a = p.createAnnotation(MARKUP[kind]);
    a.setQuadPoints(rects.map(r => [r[0], r[1], r[2], r[1], r[0], r[3], r[2], r[3]]));
    a.setColor(hexToRgb(color));
    if (opacity < 1) a.setOpacity(opacity);
    finishAnnot(a, author);
    return true;
  });
}

export function addInk(id, i, strokes, color, width = 2, opacity = 1, author = "") {
  const d = D(id);
  return op(d, "Draw", () => {
    const p = pdfPage(d, i);
    const a = p.createAnnotation("Ink");
    a.setInkList(strokes);
    a.setColor(hexToRgb(color));
    a.setBorderWidth(width);
    if (opacity < 1) a.setOpacity(opacity);
    finishAnnot(a, author);
    return true;
  });
}

export function addShape(id, i, kind, a0, a1, color, width = 2, fill = null, author = "") {
  const d = D(id);
  return op(d, "Shape", () => {
    const p = pdfPage(d, i);
    let a;
    if (kind === "rect" || kind === "ellipse") {
      a = p.createAnnotation(kind === "rect" ? "Square" : "Circle");
      a.setRect(rectFromPoints(a0, a1));
      if (fill) a.setInteriorColor(hexToRgb(fill));
    } else {
      a = p.createAnnotation("Line");
      a.setLine(a0, a1);
      if (kind === "arrow") a.setLineEndingStyles("None", "OpenArrow");
    }
    a.setColor(hexToRgb(color));
    a.setBorderWidth(width);
    finishAnnot(a, author);
    return true;
  });
}

export function addNote(id, i, pt, text, color = "#ffd43b", author = "") {
  const d = D(id);
  return op(d, "Note", () => {
    const p = pdfPage(d, i);
    const a = p.createAnnotation("Text");
    a.setRect([pt[0], pt[1], pt[0] + 20, pt[1] + 20]);
    a.setContents(text);
    a.setIcon("Comment");
    a.setColor(hexToRgb(color));
    finishAnnot(a, author);
    return true;
  });
}

export function addTextBox(id, i, rect, text, size = 12, color = "#e0383e", author = "") {
  const d = D(id);
  return op(d, "Text box", () => {
    const p = pdfPage(d, i);
    const a = p.createAnnotation("FreeText");
    a.setRect(rect);
    a.setContents(text);
    a.setDefaultAppearance("Helv", size, hexToRgb(color));
    finishAnnot(a, author);
    return true;
  });
}

export function addStamp(id, i, rect, imageBytes = null, label = "Stamp", author = "") {
  const d = D(id);
  return op(d, "Stamp", () => {
    const p = pdfPage(d, i);
    const a = p.createAnnotation("Stamp");
    a.setRect(rect);
    if (imageBytes) {
      a.setStampImage(new mupdf.Image(imageBytes));
    } else {
      a.setIcon(label.replace(/\s+/g, ""));
    }
    a.setContents(label);
    finishAnnot(a, author);
    return true;
  });
}

export function addRedaction(id, i, rect) {
  const d = D(id);
  return op(d, "Mark redaction", () => {
    const p = pdfPage(d, i);
    const a = p.createAnnotation("Redact");
    a.setRect(rect);
    a.update();
    return true;
  });
}

export function applyRedactions(id) {
  const d = D(id);
  let n = 0;
  return op(d, "Apply redactions", () => {
    for (let i = 0; i < d.doc.countPages(); i++) {
      const p = pdfPage(d, i);
      const marks = p.getAnnotations().filter(a => a.getType() === "Redact");
      if (marks.length) {
        n += marks.length;
        p.applyRedactions(true, 2, 1, 0);  // black boxes, remove image pixels, remove covered line art, remove text
      }
    }
    return n;
  });
}

export function deleteAnnot(id, i, index) {
  const d = D(id);
  return op(d, "Delete", () => { const p = pdfPage(d, i); p.deleteAnnotation(annotByIndex(p, index)); return true; });
}

export function moveAnnot(id, i, index, dx, dy) {
  const d = D(id);
  return op(d, "Move", () => {
    const p = pdfPage(d, i);
    const a = annotByIndex(p, index);
    const t = a.getType();
    if (t === "Ink") {
      a.setInkList(a.getInkList().map(s => s.map(pt => [pt[0] + dx, pt[1] + dy])));
    } else if (t === "Line") {
      const [p0, p1] = a.getLine();
      a.setLine([p0[0] + dx, p0[1] + dy], [p1[0] + dx, p1[1] + dy]);
    } else if (t === "Polygon" || t === "PolyLine") {
      a.setVertices(a.getVertices().map(pt => [pt[0] + dx, pt[1] + dy]));
    } else if (a.hasQuadPoints && a.hasQuadPoints()) {
      return false;
    } else {
      const r = a.getRect();
      a.setRect([r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy]);
    }
    a.update();
    return true;
  });
}

export function resizeAnnot(id, i, index, rect) {
  const d = D(id);
  return op(d, "Resize", () => { const a = annotByIndex(pdfPage(d, i), index); a.setRect(rect); a.update(); return true; });
}

export function setAnnotColor(id, i, index, color) {
  const d = D(id);
  return op(d, "Color", () => {
    const a = annotByIndex(pdfPage(d, i), index);
    if (a.getType() === "FreeText") {
      const da = a.getDefaultAppearance();
      a.setDefaultAppearance(da.font || "Helv", da.size || 12, hexToRgb(color));
    } else {
      a.setColor(hexToRgb(color));
    }
    a.update();
    return true;
  });
}

export function setAnnotText(id, i, index, text) {
  const d = D(id);
  return op(d, "Edit comment", () => { const a = annotByIndex(pdfPage(d, i), index); a.setContents(text); a.update(); return true; });
}

// ------------------------------------------------------------------ forms
export function widgets(id, i) {
  const p = pdfPage(D(id), i);
  return p.getWidgets().map((w, k) => ({
    index: k, name: safe(() => w.getName(), ""), rect: w.getBounds(), type: safe(() => w.getFieldType(), ""),
    value: safe(() => w.getValue(), ""), options: safe(() => w.getOptions(), []), multiline: safe(() => w.isMultiline(), false),
    readOnly: safe(() => w.isReadOnly(), false),
  }));
}

export function setWidget(id, i, index, value) {
  const d = D(id);
  return op(d, "Fill form", () => {
    const p = pdfPage(d, i);
    const w = p.getWidgets()[index];
    if (!w) return false;
    if (w.isCheckbox() || w.isRadioButton()) w.toggle();
    else if (w.isChoice()) w.setChoiceValue(String(value));
    else if (w.isText()) w.setTextValue(String(value));
    w.update();
    return true;
  });
}

// ------------------------------------------------------------------ drawing content onto pages
// Draws with a MuPDF device into a 1-page PDF, then places that page on the target page as a Form XObject.
function overlay(d, i, draw) {
  const page = pdfPage(d, i);
  const b = page.getBounds();
  const W = b[2] - b[0], H = b[3] - b[1];
  const buf = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(buf, "pdf", "");
  const dev = writer.beginPage([0, 0, W, H]);
  draw(dev, W, H);
  writer.endPage();
  writer.close();
  const src = mupdf.Document.openDocument(buf.asUint8Array(), "application/pdf").asPDF();
  const srcPage = src.findPage(0);
  const map = d.doc.newGraftMap();
  const resources = map.graftObject(srcPage.get("Resources"));
  const contents = srcPage.get("Contents");
  let data;
  if (contents.isArray()) {
    data = "";
    contents.forEach(c => { data += c.readStream().asString() + "\n"; });
  } else {
    data = contents.readStream().asString();
  }
  // overlay user space (y up, W x H) -> display (flip) -> target page user space (inverse page transform)
  const flip = [1, 0, 0, -1, 0, H];
  const inv = mupdf.Matrix.invert(page.getTransform());
  const m = mupdf.Matrix.concat(flip, inv);
  const dict = d.doc.newDictionary();
  dict.put("Type", d.doc.newName("XObject"));
  dict.put("Subtype", d.doc.newName("Form"));
  dict.put("BBox", arr(d, [0, 0, W, H]));
  dict.put("Matrix", arr(d, m));
  dict.put("Resources", resources);
  const xo = d.doc.addStream(data, dict);
  const pobj = page.getObject();
  let res = pobj.getInheritable("Resources");
  if (!res || res.isNull()) { res = d.doc.newDictionary(); pobj.put("Resources", res); }
  else if (res.isIndirect()) { /* shared resources: copy so other pages are not touched */
    const copy = d.doc.newDictionary();
    res.forEach((v, k) => copy.put(k, v));
    res = copy;
    pobj.put("Resources", res);
  } else if (!pobj.get("Resources") || pobj.get("Resources").isNull()) {
    const copy = d.doc.newDictionary();
    res.forEach((v, k) => copy.put(k, v));
    res = copy;
    pobj.put("Resources", res);
  }
  let xobjs = res.get("XObject");
  if (!xobjs || xobjs.isNull()) { xobjs = d.doc.newDictionary(); res.put("XObject", xobjs); }
  let n = 0, name;
  do { name = "GPE" + (++n); } while (!xobjs.get(name).isNull());
  xobjs.put(name, xo);
  const stream = d.doc.addStream(`q /${name} Do Q\n`, d.doc.newDictionary());
  let cont = pobj.get("Contents");
  if (cont.isArray()) {
    cont.push(stream);
  } else {
    const a = d.doc.newArray();
    if (!cont.isNull()) {
      // wrap the old content in q/Q so its graphics state does not leak into ours
      a.push(d.doc.addStream("q\n", d.doc.newDictionary()));
      a.push(cont);
      a.push(d.doc.addStream("Q\n", d.doc.newDictionary()));
    }
    a.push(stream);
    pobj.put("Contents", a);
  }
  try { page.update(); } catch (_) { /* */ }
}
function arr(d, nums) { const a = d.doc.newArray(); for (const v of nums) a.push(d.doc.newReal(v)); return a; }

const fontCache = {};
function font(name) {
  return fontCache[name] || (fontCache[name] = new mupdf.Font(name));
}

function textObj(f, size, x, y, str, angle = 0, stretch = 1) {
  const t = new mupdf.Text();
  const rad = angle * Math.PI / 180;
  // text matrix: scale (y flipped for the top-left device space), rotate, translate
  let trm = [size * stretch, 0, 0, -size, 0, 0];
  trm = mupdf.Matrix.concat(trm, [Math.cos(rad), -Math.sin(rad), Math.sin(rad), Math.cos(rad), 0, 0]);
  trm[4] = x; trm[5] = y;
  t.showString(f, trm, str);
  return t;
}

function textWidth(f, size, str) {
  let w = 0;
  for (const ch of str) w += f.advanceGlyph(f.encodeCharacter(ch.codePointAt(0)));
  return w * size;
}

/** Write lines of text (baseline of the first line at x,y). */
export function addText(id, i, x, y, text, size = 12, color = "#000000", fontName = "Helvetica") {
  const d = D(id);
  return op(d, "Add text", () => {
    const f = font(fontName);
    overlay(d, i, dev => {
      text.split("\n").forEach((ln, k) => {
        if (ln) dev.fillText(textObj(f, size, x, y + k * size * 1.25, ln), mupdf.Matrix.identity,
          mupdf.ColorSpace.DeviceRGB, hexToRgb(color), 1);
      });
    });
    return true;
  });
}

export function addImage(id, i, rect, bytes) {
  const d = D(id);
  return op(d, "Add image", () => {
    const img = new mupdf.Image(bytes);
    overlay(d, i, dev => {
      const w = rect[2] - rect[0], h = rect[3] - rect[1];
      dev.fillImage(img, [w, 0, 0, h, rect[0], rect[1]], 1);
    });
    return true;
  });
}

export function drawSymbol(id, i, rect, kind, color = "#000000") {
  const d = D(id);
  return op(d, "Mark", () => {
    overlay(d, i, dev => {
      const [x0, y0, x1, y1] = rect, w = x1 - x0, h = y1 - y0;
      const P = (a, b) => [x0 + a * w, y0 + b * h];
      const path = new mupdf.Path();
      const stroke = new mupdf.StrokeState({ lineWidth: Math.max(1.2, w / 9), lineCap: "Round", lineJoin: "Round", miterLimit: 10 });
      const col = hexToRgb(color);
      if (kind === "check") {
        path.moveTo(...P(0.08, 0.55)); path.lineTo(...P(0.38, 0.85)); path.lineTo(...P(0.92, 0.15));
        dev.strokePath(path, stroke, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, col, 1);
      } else if (kind === "cross") {
        path.moveTo(...P(0.12, 0.12)); path.lineTo(...P(0.88, 0.88));
        path.moveTo(...P(0.88, 0.12)); path.lineTo(...P(0.12, 0.88));
        dev.strokePath(path, stroke, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, col, 1);
      } else {
        const r = Math.min(w, h) * 0.3, c = P(0.5, 0.5), k = 0.5523 * r;
        path.moveTo(c[0] + r, c[1]);
        path.curveTo(c[0] + r, c[1] + k, c[0] + k, c[1] + r, c[0], c[1] + r);
        path.curveTo(c[0] - k, c[1] + r, c[0] - r, c[1] + k, c[0] - r, c[1]);
        path.curveTo(c[0] - r, c[1] - k, c[0] - k, c[1] - r, c[0], c[1] - r);
        path.curveTo(c[0] + k, c[1] - r, c[0] + r, c[1] - k, c[0] + r, c[1]);
        path.closePath();
        dev.fillPath(path, false, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, col, 1);
      }
    });
    return true;
  });
}

export function watermark(id, pages, text, size = 60, color = "#d03030", opacity = 0.25, angle = 45, tile = false) {
  const d = D(id);
  return op(d, "Watermark", () => {
    const f = font("Helvetica-Bold");
    for (const i of pages) {
      overlay(d, i, (dev, W, H) => {
        let s = size;
        let tw = textWidth(f, s, text);
        const a = angle * Math.PI / 180;
        if (!tile) {
          const span = Math.abs(tw * Math.cos(a)) + Math.abs(s * Math.sin(a));
          if (span > W * 0.9) { s = s * W * 0.9 / span; tw = textWidth(f, s, text); }
        }
        const centers = [];
        if (tile) {
          const sx = Math.max(tw * 0.9, 150), sy = Math.max(s * 4, 120);
          for (let y = sy / 2; y < H; y += sy) for (let x = sx / 2; x < W; x += sx) centers.push([x, y]);
        } else centers.push([W / 2, H / 2]);
        for (const [cx, cy] of centers) {
          const bx = cx - tw / 2 * Math.cos(a) + s * 0.35 * Math.sin(a);
          const by = cy + tw / 2 * Math.sin(a) + s * 0.35 * Math.cos(a);
          dev.fillText(textObj(f, s, bx, by, text, angle), mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB,
            hexToRgb(color), opacity);
        }
      });
    }
    return true;
  });
}

export function pageNumbers(id, pages, fmt = "{n}", position = "bottom-center", start = 1, size = 11, color = "#000000", margin = 28) {
  const d = D(id);
  return op(d, "Page numbers", () => {
    const f = font("Helvetica");
    pages.forEach((i, k) => {
      const text = fmt.replace("{n}", String(start + k)).replace("{total}", String(start + pages.length - 1));
      overlay(d, i, (dev, W, H) => {
        const tw = textWidth(f, size, text);
        const [v, hpos] = position.split("-");
        const y = v === "top" ? margin + size * 0.8 : H - margin;
        const x = hpos === "left" ? margin : hpos === "right" ? W - margin - tw : (W - tw) / 2;
        dev.fillText(textObj(f, size, x, y, text), mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, hexToRgb(color), 1);
      });
    });
    return true;
  });
}

/** Invisible, searchable text from OCR words (display coordinates). */
export function addInvisibleWords(id, i, ws) {
  const d = D(id);
  return op(d, "Recognize text", () => {
    const f = font("Helvetica");
    overlay(d, i, dev => {
      for (const w of ws) {
        const h = w.y1 - w.y0;
        if (!w.text.trim() || h <= 0) continue;
        const size = h * 0.82;
        const tw = textWidth(f, size, w.text);
        const stretch = tw > 0 ? Math.max(0.2, Math.min(5, (w.x1 - w.x0) / tw)) : 1;
        const t = textObj(f, size, w.x0, w.y1 - h * 0.2, w.text, 0, stretch);
        dev.fillText(t, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, [0, 0, 0], 0);
      }
    });
    return true;
  });
}

/** Replace a text area: black-box-free redaction of the old text, then new text in the same place. */
export function replaceText(id, i, rect, text, size, color = "#000000", fontName = "Helvetica") {
  const d = D(id);
  return op(d, "Edit text", () => {
    const p = pdfPage(d, i);
    // keep other pending redactions out of the way
    const pending = p.getAnnotations().filter(a => a.getType() === "Redact").map(a => a.getRect());
    for (const a of p.getAnnotations().filter(a => a.getType() === "Redact")) p.deleteAnnotation(a);
    const r = p.createAnnotation("Redact");
    const h = rect[3] - rect[1];
    r.setRect([rect[0] - 0.5, rect[1] + h * 0.1, rect[2] + 0.5, rect[3] - h * 0.1]);
    r.update();
    p.applyRedactions(false, 0, 0, 0);
    for (const pr of pending) { const a = p.createAnnotation("Redact"); a.setRect(pr); a.update(); }
    if (text.trim()) {
      const f = font(fontName);
      const width = rect[2] - rect[0];
      const out = wrap(f, size, text, Math.max(width, 40));
      overlay(d, i, dev => {
        out.forEach((ln, k) => dev.fillText(textObj(f, size, rect[0], rect[1] + size * 0.95 + k * size * 1.22, ln),
          mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, hexToRgb(color), 1));
      });
    }
    return true;
  });
}

function wrap(f, size, text, width) {
  const out = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const test = line ? line + " " + word : word;
      if (line && textWidth(f, size, test) > width) { out.push(line); line = word; } else line = test;
    }
    out.push(line);
  }
  return out;
}

/** Text blocks (paragraphs) for the edit mode. */
export function textBlocks(id, i) {
  const ls = lines(id, i);
  const blocks = new Map();
  for (const l of ls) {
    if (!blocks.has(l.block)) blocks.set(l.block, { rect: [l.x0, l.y0, l.x1, l.y1], lines: [], size: l.size, color: l.color, bold: l.bold, font: l.font });
    const b = blocks.get(l.block);
    b.lines.push(l.text);
    b.rect = [Math.min(b.rect[0], l.x0), Math.min(b.rect[1], l.y0), Math.max(b.rect[2], l.x1), Math.max(b.rect[3], l.y1)];
  }
  return [...blocks.values()].map(b => ({ ...b, text: b.lines.join("\n") }));
}

// ------------------------------------------------------------------ pages
export function rotatePages(id, pages, delta) {
  const d = D(id);
  return op(d, "Rotate", () => {
    for (const i of pages) {
      const o = d.doc.findPage(i);
      const cur = o.getInheritable("Rotate");
      const r = ((cur && !cur.isNull() ? cur.asNumber() : 0) + delta + 360) % 360;
      o.put("Rotate", d.doc.newInteger(r));
    }
    return info(id);
  });
}

export function deletePages(id, pages) {
  const d = D(id);
  if (pages.length >= d.doc.countPages()) throw new Error("A PDF must keep at least one page.");
  return op(d, "Delete pages", () => {
    [...pages].sort((a, b) => b - a).forEach(i => d.doc.deletePage(i));
    return info(id);
  });
}

export function reorder(id, order) {
  const d = D(id);
  return op(d, "Move pages", () => { d.doc.rearrangePages(order); return info(id); });
}

export function insertBlank(id, at, w = null, h = null) {
  const d = D(id);
  return op(d, "Insert page", () => {
    const n = d.doc.countPages();
    if (w == null) {
      const ref = d.doc.loadPage(Math.max(0, Math.min(at - 1, n - 1))).getBounds();
      w = ref[2] - ref[0]; h = ref[3] - ref[1];
    }
    const obj = d.doc.addPage([0, 0, w, h], 0, d.doc.newDictionary(), "");
    d.doc.insertPage(at, obj);
    return info(id);
  });
}

export function duplicatePages(id, pages) {
  const d = D(id);
  return op(d, "Duplicate pages", () => {
    const sorted = [...pages].sort((a, b) => a - b);
    sorted.forEach((i, k) => d.doc.graftPage(i + k + 1, d.doc, i + k));
    return info(id);
  });
}

export function extract(id, pages) {
  const d = D(id);
  const out = new mupdf.PDFDocument();
  pages.forEach((i, k) => out.graftPage(k, d.doc, i));
  return out.saveToBuffer("garbage=compact,compress=yes").asUint8Array().slice();
}

export function insertFile(id, at, bytes, name = "file.pdf", password = null) {
  const d = D(id);
  let src = mupdf.Document.openDocument(bytes, name.toLowerCase().endsWith(".pdf") ? "application/pdf" : name);
  if (!src.isPDF()) src = convertToPdf(src);
  src = src.asPDF();
  if (src.needsPassword() && !(password && src.authenticatePassword(password))) throw new Error("NEEDS_PASSWORD");
  return op(d, "Insert pages", () => {
    const n = src.countPages();
    for (let k = 0; k < n; k++) d.doc.graftPage(at + k, src, k);
    return info(id);
  });
}

export function merge(files) {
  // files: [{bytes, name, password}]
  const out = new mupdf.PDFDocument();
  let at = 0;
  for (const f of files) {
    let src = mupdf.Document.openDocument(f.bytes, f.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : f.name);
    if (!src.isPDF()) src = convertToPdf(src);
    src = src.asPDF();
    if (src.needsPassword() && !(f.password && src.authenticatePassword(f.password))) throw new Error("NEEDS_PASSWORD:" + f.name);
    const n = src.countPages();
    for (let k = 0; k < n; k++) out.graftPage(at++, src, k);
  }
  return out.saveToBuffer("garbage=compact,compress=yes").asUint8Array().slice();
}

export function cropPages(id, pages, rect) {
  // rect in display coordinates of the first page; applied the same way to each page
  const d = D(id);
  return op(d, "Crop", () => {
    for (const i of pages) {
      const p = pdfPage(d, i);
      const inv = mupdf.Matrix.invert(p.getTransform());
      const r = mupdf.Rect.transform(rect, inv);
      p.setPageBox("CropBox", r);
    }
    return info(id);
  });
}

export function flatten(id) {
  const d = D(id);
  return op(d, "Flatten", () => { d.doc.bake(true, true); return true; });
}

export function setMetadata(id, meta) {
  const d = D(id);
  return op(d, "Properties", () => {
    for (const [k, v] of Object.entries(meta)) d.doc.setMetaData("info:" + k, v);
    return true;
  });
}

export function metadata(id) {
  const d = D(id);
  const m = {};
  for (const k of ["Title", "Author", "Subject", "Keywords", "Creator", "Producer"]) m[k] = d.doc.getMetaData("info:" + k) || "";
  m.format = d.doc.getMetaData("format") || "";
  m.encryption = d.doc.getMetaData("encryption") || "None";
  return m;
}

/** Remove the text of a page (for slides where the text becomes editable boxes). */
export function renderWithoutText(id, i, scale) {
  const d = D(id);
  const bytes = extract(id, [i]);
  const tmp = mupdf.Document.openDocument(bytes, "application/pdf").asPDF();
  const p = tmp.loadPage(0);
  const r = p.createAnnotation("Redact");
  r.setRect(p.getBounds());
  r.update();
  p.applyRedactions(false, 0, 0, 0);
  const pix = p.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
  return pix.asPNG().slice();
}

/** Images to a new PDF. items: [{bytes, name}] */
/** Several pages (as pictures) on each A4 sheet, for printing: per = 2, 4, 6 or 9. */
export function nUp(items, per = 2) {
  const out = new mupdf.PDFDocument();
  const grid = { 2: [2, 1, true], 4: [2, 2, false], 6: [3, 2, true], 9: [3, 3, false] }[per] || [1, 1, false];
  const [cols, rows, land] = grid;
  const [pw, ph] = land ? [841.89, 595.28] : [595.28, 841.89];
  const m = 18, gap = 10;
  const cw = (pw - 2 * m - (cols - 1) * gap) / cols, ch = (ph - 2 * m - (rows - 1) * gap) / rows;
  let k = 0;
  for (let at = 0; at < items.length; at += cols * rows) {
    const res = out.newDictionary(), xo = out.newDictionary();
    let content = "";
    items.slice(at, at + cols * rows).forEach((it, j) => {
      const img = new mupdf.Image(it.bytes);
      const iw = img.getWidth(), ih = img.getHeight();
      const s = Math.min(cw / iw, ch / ih);
      const w = iw * s, h = ih * s;
      const c = j % cols, r = Math.floor(j / cols);
      const x = m + c * (cw + gap) + (cw - w) / 2, y = ph - m - (r + 1) * ch - r * gap + (ch - h) / 2;
      xo.put("Im" + j, out.addImage(img));
      content += `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${j} Do Q `;
    });
    res.put("XObject", xo);
    out.insertPage(k++, out.addPage([0, 0, pw, ph], 0, res, content));
  }
  return out.saveToBuffer("garbage=compact,compress=yes").asUint8Array().slice();
}

export function imagesToPdf(items, pageSize = "fit", margin = 0) {
  const out = new mupdf.PDFDocument();
  const sizes = { A4: [595.28, 841.89], Letter: [612, 792] };
  let k = 0;
  for (const it of items) {
    const img = new mupdf.Image(it.bytes);
    let w = img.getWidth() * 72 / (img.getXResolution() || 96), h = img.getHeight() * 72 / (img.getYResolution() || 96);
    let pw = w + 2 * margin, ph = h + 2 * margin;
    if (pageSize !== "fit") {
      [pw, ph] = sizes[pageSize] || sizes.A4;
      if (w > h) [pw, ph] = [ph, pw];
      const s = Math.min((pw - 2 * margin) / w, (ph - 2 * margin) / h);
      w *= s; h *= s;
    }
    const res = out.newDictionary();
    const xo = out.newDictionary();
    xo.put("Im0", out.addImage(img));
    res.put("XObject", xo);
    const x = (pw - w) / 2, y = (ph - h) / 2;
    const page = out.addPage([0, 0, pw, ph], 0, res, `q ${w} 0 0 ${h} ${x} ${y} cm /Im0 Do Q`);
    out.insertPage(k++, page);
  }
  return out.saveToBuffer("garbage=compact,compress=yes").asUint8Array().slice();
}

/** Strong compression for scans: every page becomes a JPEG at the given dpi (text is lost). */
export function rasterize(id, dpi = 120, quality = 70) {
  const d = D(id);
  const out = new mupdf.PDFDocument();
  const n = d.doc.countPages();
  for (let i = 0; i < n; i++) {
    const p = d.doc.loadPage(i);
    const b = p.getBounds();
    const pix = p.toPixmap(mupdf.Matrix.scale(dpi / 72, dpi / 72), mupdf.ColorSpace.DeviceRGB, false, true);
    const img = new mupdf.Image(pix.asJPEG(quality));
    const W = b[2] - b[0], H = b[3] - b[1];
    const res = out.newDictionary(); const xo = out.newDictionary();
    xo.put("Im0", out.addImage(img)); res.put("XObject", xo);
    out.insertPage(i, out.addPage([0, 0, W, H], 0, res, `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`));
  }
  return out.saveToBuffer("garbage=compact,compress=yes").asUint8Array().slice();
}

/** Re-encode big pictures as JPEG, at most maxDim pixels on the long side. Text stays as it is. */
export function compressImages(id, maxDim = 1600, quality = 70) {
  const d = D(id);
  let count = 0;
  op(d, "Compress", () => {
    const n = d.doc.countObjects();
    for (let num = 1; num < n; num++) {
      try {
        // note: PDFObject.resolve() corrupts the document in MuPDF.js 1.28, so work on the reference
        const ref = d.doc.newIndirect(num);
        const obj = ref;
        if (!obj.isStream()) continue;
        const sub = obj.get("Subtype");
        if (!sub.isName() || sub.asName() !== "Image") continue;
        if (!obj.get("SMask").isNull() || !obj.get("Mask").isNull()) continue;
        const im = obj.get("ImageMask");
        if (!im.isNull() && im.asBoolean()) continue;
        const bpc = obj.get("BitsPerComponent");
        if (!bpc.isNull() && bpc.asNumber() < 8) continue;
        const rawLen = obj.readRawStream().getLength();
        if (rawLen < 40000) continue;
        const filter = obj.get("Filter");
        const isJpeg = filter.isName() && filter.asName() === "DCTDecode";
        const img = d.doc.loadImage(ref);
        const W = img.getWidth(), H = img.getHeight();
        if (!isJpeg && W * H < 400000) continue;  // small lossless pictures (logos, drawings) stay sharp
        const s = Math.min(1, maxDim / Math.max(W, H));
        const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
        const gray = img.getNumberOfComponents() === 1;
        const pix = new mupdf.Pixmap(gray ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false);
        pix.clear(255);
        const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
        dev.fillImage(img, [w, 0, 0, h, 0, 0], 1);
        dev.close();
        const jpg = pix.asJPEG(quality);
        if (jpg.length > rawLen * 0.85) continue;
        const nref = d.doc.addImage(new mupdf.Image(jpg));
        const nobj = nref;
        const dict = d.doc.newDictionary();
        nobj.forEach((v, k) => { if (k !== "Length") dict.put(k, v); });
        ref.writeObject(dict);
        ref.writeRawStream(nobj.readRawStream());
        count++;
      } catch (_) { /* leave this object alone */ }
    }
  });
  return count;
}

/** HTML (from Word/Excel files converted in the app) to PDF. */
export function htmlToPdf(html, landscape = false) {
  const src = mupdf.Document.openDocument(new TextEncoder().encode(html), "text/html");
  const [w, h] = landscape ? [841.89, 595.28] : [595.28, 841.89];
  src.layout(w, h, 11);
  const pdf = convertToPdf(src);
  return pdf.saveToBuffer("garbage=compact,compress=yes").asUint8Array().slice();
}

/** Open an image or ebook as bytes and return the PDF bytes. */
export function anyToPdf(bytes, name) {
  const src = mupdf.Document.openDocument(bytes, name);
  const pdf = src.isPDF() ? src.asPDF() : convertToPdf(src);
  return pdf.saveToBuffer("garbage=compact,compress=yes").asUint8Array().slice();
}
