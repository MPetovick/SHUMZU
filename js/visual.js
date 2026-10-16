// Transporte visual · v0.2.0: mosaico de QR, mapa de fragmentos y escáner «ráfaga».
//
// Escáner ráfaga = cinco técnicas que se suman:
//   1. Pool de workers: varios fotogramas de cámara en paralelo (decoder.js).
//   2. BarcodeDetector nativo cuando existe: detección del sistema, varios QR a la vez.
//   3. Mosaico: el emisor muestra 1, 2 o 4 QR por pantalla y el lector los lee todos
//      (jsQR por celdas de una cuadrícula, ver multiqr.js; el detector nativo, de una vez).
//   4. ROI: tras una lectura, solo se analiza la zona donde estaban los códigos, a resolución
//      nativa (más detalle por módulo y menos píxeles que procesar).
//   5. Sin cola: un fotograma de cámara solo se envía si hay un worker libre.
import { decode, idle, poolInfo } from './decoder.js';

const MATRIX_CACHE_MAX = 96;
const matrices = new Map();

export function matrixOf(text) {
  const hit = matrices.get(text);
  if (hit) {
    matrices.delete(text);
    matrices.set(text, hit);
    return hit;
  }
  const q = window.QRCode.create(text, { errorCorrectionLevel: 'L' });
  const m = { size: q.modules.size, data: q.modules.data, version: q.version };
  matrices.set(text, m);
  if (matrices.size > MATRIX_CACHE_MAX) matrices.delete(matrices.keys().next().value);
  return m;
}

function drawMatrix(ctx, m, ox, oy, px) {
  const n = m.size;
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!m.data[r * n + c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && m.data[r * n + c]) c++;
      ctx.fillRect(ox + start * px, oy + r * px, (c - start) * px, px);
    }
  }
}

// Dibuja `texts` en una cuadrícula de `cols` columnas, a escala entera de píxel.
// Cada código lleva su zona de silencio de `quiet` módulos: entre dos códigos hay 2·quiet.
export function renderMosaic(canvas, texts, { cols = 1, target = 360, quiet = 4 } = {}) {
  const ms = texts.map(matrixOf);
  const n = Math.max(...ms.map((m) => m.size));
  const cell = n + quiet * 2;
  const rows = Math.ceil(texts.length / cols);
  const px = Math.max(2, Math.floor(target / (cols * cell)));
  const W = cols * cell * px;
  const H = rows * cell * px;
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ms.forEach((m, i) => {
    const cx = (i % cols) * cell * px;
    const cy = Math.floor(i / cols) * cell * px;
    const off = Math.floor((n - m.size) / 2);
    drawMatrix(ctx, m, cx + (quiet + off) * px, cy + (quiet + off) * px, px);
  });
  return { version: ms[0]?.version, modules: n, px };
}

// Compatibilidad: un solo código.
export function renderFrame(canvas, text, { target = 360, quiet = 2 } = {}) {
  return renderMosaic(canvas, [text], { cols: 1, target, quiet });
}

// Mapa de fragmentos: una celda por bloque fuente, encendida si ya está resuelto.
// Coste acotado: se pinta con ImageData sobre un lienzo de tamaño fijo, sea K 10 o 100 000.
export function drawFragmentMap(canvas, solved, K, { on = [57, 242, 255], off = [42, 32, 80], bg = [10, 7, 22] } = {}) {
  const W = canvas.width;
  if (!W || !K) return;
  let cell = Math.floor(Math.sqrt((W * W * 0.28) / K));
  cell = Math.max(1, Math.min(18, cell));
  const gap = cell >= 4 ? 1 : 0;
  const cols = Math.max(1, Math.floor(W / cell));
  const rows = Math.ceil(K / cols);
  const H = Math.max(cell, rows * cell);
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let p = 0; p < d.length; p += 4) {
    d[p] = bg[0]; d[p + 1] = bg[1]; d[p + 2] = bg[2]; d[p + 3] = 255;
  }
  for (let i = 0; i < K; i++) {
    const c = solved[i] ? on : off;
    const x0 = (i % cols) * cell;
    const y0 = Math.floor(i / cols) * cell;
    for (let y = y0; y < y0 + cell - gap; y++) {
      let p = (y * W + x0) * 4;
      for (let x = 0; x < cell - gap; x++, p += 4) {
        d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2];
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Capacidad alfanumérica de QR nivel L por versión (1..40): de la longitud del texto leído
// se deduce la versión y, con el tamaño de su caja, los píxeles de cámara por módulo.
const ALNUM_L = [25, 47, 77, 114, 154, 195, 224, 279, 335, 395, 468, 535, 619, 667, 758, 854, 938, 1046,
  1153, 1249, 1352, 1460, 1588, 1704, 1853, 1990, 2132, 2223, 2369, 2520, 2677, 2840, 3009, 3183, 3351,
  3537, 3729, 3927, 4087, 4296];
function modulesFor(chars) {
  const v = ALNUM_L.findIndex((c) => chars <= c);
  return v < 0 ? 0 : 17 + 4 * (v + 1);
}
const MIN_PPM = 4.5; // por debajo, jsQR falla a menudo: se pide acercar la cámara

const FULL_MAX_SIDE = 960;   // fotograma completo: lado mayor máximo que se analiza
const ROI_MAX_SIDE = 960;    // recorte ROI: se analiza a resolución nativa hasta este lado
const ROI_MARGIN = 0.35;     // margen alrededor de los códigos encontrados
const ROI_MISSES = 4;        // fallos seguidos antes de volver al fotograma completo
const FULL_EVERY = 24;       // cada N análisis, uno completo para descubrir códigos nuevos

export class Scanner {
  // onCodes(texts: string[]) · onStats({ fps, ms, engine, workers, roi, codesPerSec })
  constructor(video, onCodes, onStats = () => {}) {
    this.video = video;
    this.onCodes = onCodes;
    this.onStats = onStats;
    this.stream = null;
    this.track = null;
    this.running = false;
    this.handle = null;
    this.handleKind = null;
    this.useBitmap = typeof createImageBitmap === 'function';
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.roi = null;
    this.roiMiss = 0;
    this.n = 0;
    this.maxCodes = 1;
    this.grid = null; // cuadrícula del mosaico detectada por jsQR (pista para el siguiente análisis)
    this.ppm = Infinity; // píxeles de cámara por módulo QR en la última lectura
    this.engine = 'jsqr';
    this.forceJsqr = false;
    this._resetStats();
    document.addEventListener('visibilitychange', () => this._sync());
  }

  _resetStats() {
    this.stat = { t0: performance.now(), decodes: 0, codes: 0, ms: 0 };
  }

  get hasTorch() {
    try {
      return !!this.track?.getCapabilities?.().torch;
    } catch {
      return false;
    }
  }

  async setTorch(on) {
    if (!this.hasTorch) return false;
    await this.track.applyConstraints({ advanced: [{ torch: !!on }] });
    return true;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar la cámara');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });
    this.track = this.stream.getVideoTracks()[0] || null;
    // Enfoque continuo donde se pueda (Android): los QR densos lo necesitan.
    try {
      const caps = this.track?.getCapabilities?.() || {};
      if (caps.focusMode?.includes?.('continuous')) {
        await this.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      }
    } catch {
      // opcional
    }
    this.video.srcObject = this.stream;
    this.video.hidden = false;
    await this.video.play();
    this.running = true;
    this.roi = null;
    this._resetStats();
    this._sync();
  }

  stop() {
    this.running = false;
    this._cancel();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
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
      }, 33);
    }
  }

  _cancel() {
    if (this.handle === null) return;
    if (this.handleKind === 'rvfc') this.video.cancelVideoFrameCallback(this.handle);
    else clearTimeout(this.handle);
    this.handle = null;
  }

  // Zona a analizar y escala, en coordenadas del vídeo.
  _region() {
    const v = this.video;
    const VW = v.videoWidth;
    const VH = v.videoHeight;
    const full = !this.roi || this.n % FULL_EVERY === 0;
    const r = full ? { x: 0, y: 0, w: VW, h: VH } : this.roi;
    const k = Math.min(1, (full ? FULL_MAX_SIDE : ROI_MAX_SIDE) / Math.max(r.w, r.h));
    return { ...r, k, full, ow: Math.max(1, Math.round(r.w * k)), oh: Math.max(1, Math.round(r.h * k)) };
  }

  async _grab(g) {
    const v = this.video;
    if (this.useBitmap) {
      try {
        const bitmap = await createImageBitmap(v, g.x, g.y, g.w, g.h, {
          resizeWidth: g.ow, resizeHeight: g.oh, resizeQuality: 'low',
        });
        return { bitmap };
      } catch {
        this.useBitmap = false;
      }
    }
    if (this.canvas.width !== g.ow) this.canvas.width = g.ow;
    if (this.canvas.height !== g.oh) this.canvas.height = g.oh;
    this.ctx.drawImage(v, g.x, g.y, g.w, g.h, 0, 0, g.ow, g.oh);
    return { rgba: this.ctx.getImageData(0, 0, g.ow, g.oh).data, w: g.ow, h: g.oh };
  }

  async _frame() {
    if (!this.running || document.hidden) return;
    const v = this.video;
    if (v.readyState >= 2 && v.videoWidth && idle()) {
      this.n++;
      const g = this._region();
      // Lectura múltiple adaptativa (solo jsQR la necesita): con un mosaico ya detectado se
      // buscan hasta 4; con un solo código, 1; cada 10 análisis se sondea con 4 por si el
      // emisor cambió a mosaico.
      const lost = !this.roi && this.roiMiss >= 2; // dos análisis vacíos: buscar la pantalla
      const max = this.grid || this.maxCodes > 1 || lost || this.n % 10 === 0 ? 4 : 1;
      try {
        const input = await this._grab(g);
        decode(input, { max, inv: 'dontInvert', engine: this.forceJsqr ? 'jsqr' : 'auto', grid: this.grid })
          .then((r) => this._done(r, g))
          .catch(() => {});
      } catch {
        // fotograma no disponible: se reintenta en el siguiente
      }
    }
    if (this.running && this.handle === null) this._schedule();
  }

  _done(r, g) {
    if (!this.running) return;
    if (r.engine === 'error' && r.error === 'nocanvas') this.useBitmap = false;
    if (r.engine && r.engine !== 'error') this.engine = r.engine;
    this.stat.decodes++;
    this.stat.ms = this.stat.ms ? this.stat.ms * 0.85 + r.ms * 0.15 : r.ms;
    const found = r.texts.length;
    if (found) {
      this.stat.codes += found;
      this.maxCodes = Math.max(1, found);
      if (r.grid) this.grid = r.grid;
      else if (found === 1 && r.engine !== 'native') this.grid = null;
      this.roiMiss = 0;
      // Resolución efectiva: píxeles de cámara por módulo del QR más pequeño leído.
      let ppm = Infinity;
      r.boxes.forEach((b, i) => {
        const mods = modulesFor(r.texts[i].length);
        if (mods) ppm = Math.min(ppm, b.w / g.k / mods);
      });
      this.ppm = ppm;
      // Zona para el siguiente análisis. Si se localizó la pantalla del emisor, se usa ENTERA:
      // con la unión de los códigos leídos, un mosaico del que solo salió uno quedaba recortado
      // y el resto no volvía a entrar (medido: mosaico de 2 más lento que de 1).
      let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
      const boxes = r.screen ? [r.screen] : r.boxes;
      for (const b of boxes) {
        x0 = Math.min(x0, g.x + b.x / g.k);
        y0 = Math.min(y0, g.y + b.y / g.k);
        x1 = Math.max(x1, g.x + (b.x + b.w) / g.k);
        y1 = Math.max(y1, g.y + (b.y + b.h) / g.k);
      }
      const margin = r.screen ? 0.06 : ROI_MARGIN;
      const mw = (x1 - x0) * margin;
      const mh = (y1 - y0) * margin;
      const VW = this.video.videoWidth;
      const VH = this.video.videoHeight;
      const rx = Math.max(0, Math.floor(x0 - mw));
      const ry = Math.max(0, Math.floor(y0 - mh));
      this.roi = {
        x: rx,
        y: ry,
        w: Math.min(VW - rx, Math.ceil(x1 - x0 + 2 * mw)),
        h: Math.min(VH - ry, Math.ceil(y1 - y0 + 2 * mh)),
      };
      if (this.roi.w < 32 || this.roi.h < 32) this.roi = null;
      this.onCodes(r.texts);
    } else if (r.screen && !this.roi && g.full) {
      // Nada legible, pero se localizó la pantalla del emisor: el siguiente análisis la
      // recorta a resolución nativa (un mosaico de 4 QR no se lee con el fotograma reducido).
      const s = r.screen;
      const mx = s.w * 0.06;
      const my = s.h * 0.06;
      const VW = this.video.videoWidth;
      const VH = this.video.videoHeight;
      const rx = Math.max(0, Math.floor(g.x + (s.x - mx) / g.k));
      const ry = Math.max(0, Math.floor(g.y + (s.y - my) / g.k));
      this.roi = {
        x: rx,
        y: ry,
        w: Math.min(VW - rx, Math.ceil((s.w + 2 * mx) / g.k)),
        h: Math.min(VH - ry, Math.ceil((s.h + 2 * my) / g.k)),
      };
      this.maxCodes = 4;
      this.roiMiss = 0;
    } else if (++this.roiMiss >= ROI_MISSES) {
      this.roi = null;
      this.maxCodes = 1;
      this.grid = null;
    }
    const dt = (performance.now() - this.stat.t0) / 1000;
    if (dt >= 1) {
      this.onStats({
        fps: this.stat.decodes / dt,
        codesPerSec: this.stat.codes / dt,
        ms: this.stat.ms,
        engine: this.engine,
        workers: poolInfo().size,
        roi: !!this.roi,
        ppm: isFinite(this.ppm) ? this.ppm : null,
        closer: isFinite(this.ppm) && this.ppm < MIN_PPM,
      });
      this.stat.t0 = performance.now();
      this.stat.decodes = 0;
      this.stat.codes = 0;
    }
  }
}
