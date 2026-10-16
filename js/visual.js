// Transporte visual: dibujo de QR (vía window.QRCode) y escaneo con cámara.
//
// - Las matrices de QR se cachean: el carrusel no recalcula el mismo código dos veces.
// - El dibujo usa rectángulos por tramos horizontales, a escala entera (nítido en móvil).
// - El escáner entrega un fotograma solo cuando el decodificador está libre (sin cola),
//   usa requestVideoFrameCallback (un decode por fotograma real de cámara) y se pausa
//   cuando la pestaña no está visible.
import { decodeRgba } from './decoder.js';

const MATRIX_CACHE_MAX = 64;
const matrices = new Map();

export function matrixOf(text) {
  const hit = matrices.get(text);
  if (hit) {
    matrices.delete(text); // LRU: el uso reciente pasa al final
    matrices.set(text, hit);
    return hit;
  }
  const q = window.QRCode.create(text, { errorCorrectionLevel: 'L' });
  const m = { size: q.modules.size, data: q.modules.data };
  matrices.set(text, m);
  if (matrices.size > MATRIX_CACHE_MAX) matrices.delete(matrices.keys().next().value);
  return m;
}

// Dibuja el QR en `canvas` con escala entera y sin interpolar; el CSS lo escala a pantalla.
export function renderFrame(canvas, text, { target = 360, quiet = 2 } = {}) {
  const m = matrixOf(text);
  const n = m.size;
  const total = n + quiet * 2;
  const px = Math.max(2, Math.floor(target / total));
  const side = total * px;
  if (canvas.width !== side) canvas.width = side;
  if (canvas.height !== side) canvas.height = side;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, side, side);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!m.data[r * n + c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && m.data[r * n + c]) c++;
      ctx.fillRect((quiet + start) * px, (quiet + r) * px, (c - start) * px, px);
    }
  }
}

export class Scanner {
  constructor(video, onText) {
    this.video = video;
    this.onText = onText;
    this.stream = null;
    this.running = false;
    this.busy = false;
    this.handle = null;
    this.handleKind = null;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    document.addEventListener('visibilitychange', () => this._sync());
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar la cámara');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    this.video.hidden = false;
    await this.video.play();
    this.running = true;
    this._sync();
  }

  stop() {
    this.running = false;
    this._cancel();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.video.hidden = true;
  }

  _sync() {
    if (!this.running) return;
    if (document.hidden) {
      this._cancel();
      return;
    }
    if (this.handle === null) this._schedule();
  }

  _schedule() {
    if (typeof this.video.requestVideoFrameCallback === 'function') {
      this.handleKind = 'rvfc';
      this.handle = this.video.requestVideoFrameCallback(() => {
        this.handle = null;
        this._frame();
      });
    } else {
      this.handleKind = 'timeout';
      this.handle = setTimeout(() => {
        this.handle = null;
        this._frame();
      }, 80);
    }
  }

  _cancel() {
    if (this.handle === null) return;
    if (this.handleKind === 'rvfc') this.video.cancelVideoFrameCallback(this.handle);
    else clearTimeout(this.handle);
    this.handle = null;
  }

  async _frame() {
    if (!this.running || document.hidden) return;
    const v = this.video;
    if (!this.busy && v.readyState >= 2 && v.videoWidth) {
      this.busy = true;
      try {
        const k = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
        const w = Math.round(v.videoWidth * k);
        const h = Math.round(v.videoHeight * k);
        if (this.canvas.width !== w) this.canvas.width = w;
        if (this.canvas.height !== h) this.canvas.height = h;
        this.ctx.drawImage(v, 0, 0, w, h);
        const img = this.ctx.getImageData(0, 0, w, h);
        const text = await decodeRgba(img.data, w, h, 'dontInvert');
        if (text && this.running) this.onText(text);
      } catch {
        // Un fotograma malo no detiene la cámara.
      } finally {
        this.busy = false;
      }
    }
    if (this.running && this.handle === null) this._schedule();
  }
}
