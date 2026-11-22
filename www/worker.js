// Web Worker: runs the MuPDF engine off the main thread.
import * as mupdf from "./lib/mupdf/mupdf.js";
import * as E from "./engine.js";
E.setMupdf(mupdf);

self.onmessage = (e) => {
  const { id, fn, args } = e.data;
  try {
    const result = E[fn](...(args || []));
    const transfer = [];
    if (result && result.pixels) transfer.push(result.pixels.buffer);
    else if (result instanceof Uint8Array) transfer.push(result.buffer);
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
self.postMessage({ ready: true });
