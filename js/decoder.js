// Pool de decodificación QR fuera del hilo principal · v0.2.0
//
// 0.1.0 tenía un único worker con un fotograma en vuelo: la cámara iba al ritmo de UN núcleo.
// Ahora hay hasta 3 workers (según navigator.hardwareConcurrency) y cada uno procesa su
// fotograma en paralelo. `idle()` dice si hay alguno libre: el escáner nunca encola.
// Sin Worker (entorno raro) se decodifica en el hilo principal con jsQR + multiqr.js.

const WORKER_URL = new URL('./workers/decode.worker.js', import.meta.url);

function poolSize() {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  return Math.max(1, Math.min(3, cores - 1));
}

class Slot {
  constructor() {
    this.worker = new Worker(WORKER_URL);
    this.busy = false;
    this.resolve = null;
    this.worker.onmessage = (ev) => {
      const r = this.resolve;
      this.resolve = null;
      this.busy = false;
      r?.(ev.data);
    };
    this.worker.onerror = () => {
      const r = this.resolve;
      this.resolve = null;
      this.busy = false;
      this.dead = true;
      r?.({ texts: [], boxes: [], ms: 0, engine: 'error', error: 'worker' });
    };
  }

  run(msg, transfer) {
    this.busy = true;
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.worker.postMessage(msg, transfer);
    });
  }
}

let slots = null;
let seq = 0;

function getSlots() {
  if (slots) return slots;
  slots = [];
  if (typeof Worker === 'undefined') return slots;
  try {
    for (let i = 0; i < poolSize(); i++) slots.push(new Slot());
  } catch {
    slots = [];
  }
  return slots;
}

let mainReady = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('no se pudo cargar ' + src));
    document.head.append(s);
  });
}
function loadMain() {
  if (!mainReady) {
    mainReady = (window.jsQR ? Promise.resolve() : loadScript('vendor/jsQR.js'))
      .then(() => (window.shumzuMulti ? null : loadScript('js/workers/multiqr.js')));
  }
  return mainReady;
}

export const poolInfo = () => ({ size: getSlots().filter((s) => !s.dead).length || 1 });

// ¿Hay un worker libre ahora mismo? (sin workers: un único «hueco» en el hilo principal)
let mainBusy = false;
export function idle() {
  const s = getSlots();
  if (!s.length) return !mainBusy;
  return s.some((x) => !x.busy && !x.dead);
}

// Decodifica `input` = { bitmap } (ImageBitmap, se transfiere) o { rgba, w, h }.
// Devuelve { texts, boxes, ms, engine }.
export async function decode(input, { max = 1, inv = 'dontInvert', engine = 'auto', grid = null } = {}) {
  const s = getSlots().find((x) => !x.busy && !x.dead);
  const id = ++seq;
  if (s) {
    if (input.bitmap) {
      const b = input.bitmap;
      return s.run({ id, bitmap: b, w: b.width, h: b.height, max, inv, engine, grid }, [b]);
    }
    const px = input.rgba;
    const own = px.byteOffset === 0 && px.byteLength === px.buffer.byteLength ? px : px.slice();
    return s.run({ id, buf: own.buffer, w: input.w, h: input.h, max, inv, engine, grid }, [own.buffer]);
  }
  // Hilo principal (sin workers, o todos ocupados: el llamador debería haber mirado idle()).
  mainBusy = true;
  try {
    await loadMain();
    const t0 = performance.now();
    let rgba = input.rgba;
    let w = input.w;
    let h = input.h;
    if (input.bitmap) {
      const b = input.bitmap;
      const c = document.createElement('canvas');
      c.width = w = b.width;
      c.height = h = b.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(b, 0, 0);
      b.close();
      rgba = g.getImageData(0, 0, w, h).data;
    }
    const r = window.shumzuMulti(window.jsQR, rgba, w, h, max, inv, grid);
    return { texts: r.texts, boxes: r.boxes, grid: r.grid, screen: r.screen, ms: performance.now() - t0, engine: 'main' };
  } finally {
    mainBusy = false;
  }
}

// Compatibilidad con 0.1.0: un solo texto o null.
export async function decodeRgba(rgba, w, h, inv = 'attemptBoth') {
  const r = await decode({ rgba, w, h }, { max: 1, inv });
  return r.texts[0] ?? null;
}
