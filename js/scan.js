// Lectura de códigos desde archivos · v0.2.0
// - GIF: los fotogramas se reparten entre los workers del pool (en paralelo, sin cola larga).
// - Imagen: se leen TODOS los QR de la captura (0.0.1a solo leía uno).
import { gifFrames } from './core/gif.js';
import { decode, idle, poolInfo } from './decoder.js';

const waitIdle = () => new Promise((r) => setTimeout(r, 0));

export async function codesFromFile(file, onProgress) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    const texts = new Set();
    const inflight = new Set();
    const limit = poolInfo().size;
    let n = 0;
    let maxCodes = 4; // el primer fotograma sondea por si es un GIF de mosaico
    let grid = null;
    for (const f of gifFrames(buf)) {
      n++;
      while (inflight.size >= limit || !idle()) {
        if (inflight.size) await Promise.race(inflight);
        else await waitIdle();
      }
      const p = decode({ rgba: f.rgba.slice(), w: f.width, h: f.height }, { max: maxCodes, inv: 'dontInvert', grid })
        .then((r) => {
          for (const t of r.texts) texts.add(t);
          if (r.grid) grid = r.grid;
          maxCodes = grid || r.texts.length > 1 ? 4 : 1;
        })
        .finally(() => inflight.delete(p));
      inflight.add(p);
      if (onProgress && n % 4 === 0) onProgress(n);
    }
    await Promise.all(inflight);
    if (onProgress) onProgress(n);
    return { kind: 'GIF', frames: n, texts: [...texts] };
  }
  const bmp = await createImageBitmap(new Blob([buf], { type: file.type }));
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const img = ctx.getImageData(0, 0, w, h);
  while (!idle()) await waitIdle();
  const r = await decode({ rgba: img.data, w, h }, { max: 8, inv: 'attemptBoth' });
  return { kind: 'IMG', frames: 1, texts: r.texts };
}
