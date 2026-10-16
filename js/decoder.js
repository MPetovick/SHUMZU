// Decodificación de QR fuera del hilo principal: un único Worker con jsQR.
// Si Worker no existe (entorno raro), cae al hilo principal cargando vendor/jsQR.js bajo demanda.

const pending = new Map();
let worker = null;
let seq = 0;

function getWorker() {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./workers/decode.worker.js', import.meta.url));
  } catch {
    worker = null;
    return null;
  }
  worker.onmessage = (ev) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    p.resolve(ev.data.text ?? null);
  };
  worker.onerror = () => {
    for (const p of pending.values()) p.resolve(null);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function loadJsQR() {
  if (window.jsQR) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/jsQR.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('no se pudo cargar jsQR'));
    document.head.append(s);
  });
}

// `rgba`: Uint8ClampedArray RGBA de w×h. Devuelve el texto del QR o null.
export async function decodeRgba(rgba, w, h, inv = 'attemptBoth') {
  // Se transfiere el buffer al Worker: solo copiamos si no es exclusivo de estos píxeles.
  const buf = rgba.byteOffset === 0 && rgba.byteLength === rgba.buffer.byteLength ? rgba : rgba.slice();
  const wk = getWorker();
  if (!wk) {
    await loadJsQR();
    const c = window.jsQR(buf, w, h, { inversionAttempts: inv });
    return c && c.data ? c.data : null;
  }
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    wk.postMessage({ id, buf: buf.buffer, w, h, inv }, [buf.buffer]);
  });
}
