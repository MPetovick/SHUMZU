// Convierte textos de fotograma en un GIF de QR. Cada fotograma es un código centrado.
import { encodeGif } from './gif.js';

// `make(texto)` devuelve { size, data } con los módulos (1 = oscuro).
// En el navegador se usa qrMake; en Node, un generador equivalente.
export function qrGifBytes(texts, make, { px = 4, quiet = 4, delayCs = 17 } = {}) {
  const mats = texts.map((t) => make(t));
  const n = Math.max(...mats.map((m) => m.size));
  const side = (n + quiet * 2) * px;
  const frames = mats.map((m) => {
    const img = new Uint8Array(side * side);
    const off = (quiet + Math.floor((n - m.size) / 2)) * px;
    for (let r = 0; r < m.size; r++) {
      for (let c = 0; c < m.size; c++) {
        if (!m.data[r * m.size + c]) continue;
        for (let dy = 0; dy < px; dy++) {
          const row = (off + r * px + dy) * side + off + c * px;
          img.fill(1, row, row + px);
        }
      }
    }
    return img;
  });
  return encodeGif(frames, side, side, delayCs);
}

export function qrMake(text) {
  const q = window.QRCode.create(text, { errorCorrectionLevel: 'L' });
  return { size: q.modules.size, data: q.modules.data };
}
