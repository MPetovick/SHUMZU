// Lectura de códigos desde archivos: GIF animados (cada fotograma) e imágenes sueltas.
// La decodificación va al Worker (decoder.js), así que la interfaz sigue fluida.
import { gifFrames } from './core/gif.js';
import { decodeRgba } from './decoder.js';

// `inv`: 'dontInvert' es más rápido para QR oscuro sobre claro, que es lo que generamos.
export const readCode = (rgba, w, h, inv = 'attemptBoth') => decodeRgba(rgba, w, h, inv);

export async function codesFromFile(file, onProgress) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    const texts = new Set();
    let n = 0;
    for (const f of gifFrames(buf)) {
      n++;
      // El buffer del generador se reutiliza: copiamos antes de cederlo al Worker.
      const t = await readCode(f.rgba.slice(), f.width, f.height, 'dontInvert');
      if (t) texts.add(t);
      if (onProgress) onProgress(n);
    }
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
  bmp.close();
  const img = ctx.getImageData(0, 0, w, h);
  const t = await readCode(img.data, w, h);
  return { kind: 'IMG', frames: 1, texts: t ? [t] : [] };
}
