// Worker de decodificación QR · v0.2.0
//
// Motores, por orden:
//   1. BarcodeDetector nativo (Chrome/Edge Android, ChromeOS, macOS): acelerado por el sistema
//      y devuelve TODOS los QR del fotograma de una vez.
//   2. jsQR con lectura múltiple (multiqr.js): portable, en este hilo.
//
// Entrada:  { id, bitmap?: ImageBitmap, buf?: ArrayBuffer, w, h, max, inv, grid?, engine?: 'auto'|'jsqr' }
// Salida:   { id, texts, boxes, grid, ms, engine } · boxes en coordenadas de la imagen recibida;
//           grid = cuadrícula [cols, rows] con la que jsQR separó un mosaico (pista para el siguiente).
self.window = self;
importScripts('../../vendor/jsQR.js', './multiqr.js');

let detector = null;
let detectorChecked = false;
let canvas = null;
let ctx = null;

async function getDetector() {
  if (detectorChecked) return detector;
  detectorChecked = true;
  try {
    if (typeof self.BarcodeDetector === 'function') {
      const formats = await self.BarcodeDetector.getSupportedFormats();
      if (formats.includes('qr_code')) detector = new self.BarcodeDetector({ formats: ['qr_code'] });
    }
  } catch {
    detector = null;
  }
  return detector;
}

function pixelsOf(bitmap) {
  if (typeof OffscreenCanvas === 'undefined') throw new Error('nocanvas');
  if (!canvas) {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
  if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
}

self.onmessage = async (ev) => {
  const { id, bitmap, buf, w, h, max = 1, inv = 'dontInvert', engine = 'auto', grid = null } = ev.data;
  const t0 = performance.now();
  try {
    if (engine !== 'jsqr') {
      const det = await getDetector();
      if (det) {
        try {
          const src = bitmap || new ImageData(new Uint8ClampedArray(buf), w, h);
          const found = await det.detect(src);
          bitmap?.close();
          const texts = [];
          const boxes = [];
          for (const c of found) {
            if (!c.rawValue || texts.includes(c.rawValue)) continue;
            texts.push(c.rawValue);
            const b = c.boundingBox;
            boxes.push({ x: b.x, y: b.y, w: b.width, h: b.height });
          }
          self.postMessage({ id, texts, boxes, ms: performance.now() - t0, engine: 'native' });
          return;
        } catch {
          detector = null; // falla en este dispositivo: jsQR a partir de ahora
        }
      }
    }
    let rgba;
    if (bitmap) {
      rgba = pixelsOf(bitmap);
      bitmap.close();
    } else {
      rgba = new Uint8ClampedArray(buf);
    }
    const r = self.shumzuMulti(self.jsQR, rgba, w, h, max, inv, grid);
    self.postMessage({ id, texts: r.texts, boxes: r.boxes, grid: r.grid, screen: r.screen, ms: performance.now() - t0, engine: 'jsqr' });
  } catch (e) {
    bitmap?.close?.();
    self.postMessage({ id, texts: [], boxes: [], ms: performance.now() - t0, engine: 'error', error: String(e && e.message || e) });
  }
};
