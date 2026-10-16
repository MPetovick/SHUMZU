// GIF de dos colores para QR: codificador y decodificador propios, sin dependencias.
// El codificador escribe LZW con ancho variable. El decodificador lee GIF externos
// (entrelazado, transparencia, disposición), para poder escanear capturas reenviadas.

const u16 = (n) => [n & 255, (n >> 8) & 255];

function lzwEncode(indices, minCode) {
  const CLEAR = 1 << minCode;
  const FIN = CLEAR + 1;
  const out = [];
  let width = minCode + 1;
  let next = FIN + 1;
  let dict = new Map();
  let acc = 0;
  let bits = 0;
  const emit = (code) => {
    acc |= code << bits;
    bits += width;
    while (bits >= 8) {
      out.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
    }
  };
  const reset = () => {
    dict = new Map();
    next = FIN + 1;
    width = minCode + 1;
  };
  emit(CLEAR);
  reset();
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 4096 + k;
    const hit = dict.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    dict.set(key, next++);
    if (next > 1 << width) {
      if (width < 12) width++;
      else {
        emit(CLEAR);
        reset();
      }
    }
    prefix = k;
  }
  emit(prefix);
  emit(FIN);
  if (bits > 0) out.push(acc & 255);
  const blocks = [];
  for (let i = 0; i < out.length; i += 255) {
    const n = Math.min(255, out.length - i);
    blocks.push(n);
    for (let j = 0; j < n; j++) blocks.push(out[i + j]);
  }
  blocks.push(0);
  return blocks;
}

// Codifica fotogramas de índices (0 = claro, 1 = oscuro) en un GIF animado.
export function encodeGif(frames, width, height, delayCs = 12) {
  const parts = [];
  const push = (arr) => parts.push(Uint8Array.from(arr));
  push([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...u16(width), ...u16(height), 0x80, 0, 0, 255, 255, 255, 20, 26, 11]);
  push([0x21, 0xff, 0x0b, ...Array.from('NETSCAPE2.0', (c) => c.charCodeAt(0)), 3, 1, 0, 0, 0]);
  for (const f of frames) {
    push([0x21, 0xf9, 4, 4, ...u16(delayCs), 0, 0]);
    push([0x2c, 0, 0, 0, 0, ...u16(width), ...u16(height), 0, 2]);
    push(lzwEncode(f, 2));
  }
  push([0x3b]);
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function lzwDecode(src, minCode, npx) {
  const CLEAR = 1 << minCode;
  const FIN = CLEAR + 1;
  const out = new Uint8Array(npx);
  let o = 0;
  let dict = [];
  let width = minCode + 1;
  let prev = null;
  const reset = () => {
    dict = [];
    for (let i = 0; i < CLEAR; i++) dict.push([i]);
    dict.push(null, null);
    width = minCode + 1;
    prev = null;
  };
  reset();
  let acc = 0;
  let bits = 0;
  let p = 0;
  for (;;) {
    while (bits < width && p < src.length) {
      acc |= src[p++] << bits;
      bits += 8;
    }
    if (bits < width) break;
    const code = acc & ((1 << width) - 1);
    acc >>>= width;
    bits -= width;
    if (code === CLEAR) {
      reset();
      continue;
    }
    if (code === FIN) break;
    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (code === dict.length && prev) entry = prev.concat([prev[0]]);
    else break; // datos corruptos: se conserva lo decodificado
    for (let j = 0; j < entry.length && o < npx; j++) out[o++] = entry[j];
    if (prev) {
      dict.push(prev.concat([entry[0]]));
      if (dict.length === 1 << width && width < 12) width++;
    }
    prev = entry;
  }
  return out;
}

function interlaceRows(h) {
  const rows = [];
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) {
    for (let y = start; y < h; y += step) rows.push(y);
  }
  return rows;
}

const skipSub = (bytes, p) => {
  while (bytes[p]) p += bytes[p] + 1;
  return p + 1;
};

// Recorre los fotogramas de un GIF. El buffer RGBA es compartido: se usa dentro del
// bucle y no se guarda, para no tener N fotogramas de píxeles en memoria a la vez.
export function* gifFrames(bytes) {
  if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) throw new Error('no es un GIF');
  const u16at = (q) => bytes[q] | (bytes[q + 1] << 8);
  const W = u16at(6);
  const H = u16at(8);
  const flags = bytes[10];
  let p = 13;
  let gct = null;
  if (flags & 0x80) {
    const n = 2 << (flags & 7);
    gct = bytes.subarray(p, p + 3 * n);
    p += 3 * n;
  }
  const canvas = new Uint8ClampedArray(W * H * 4);
  let gce = null;
  let index = 0;
  while (p < bytes.length) {
    const b = bytes[p++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = bytes[p++];
      if (label === 0xf9) {
        const packed = bytes[p + 1];
        gce = {
          disposal: (packed >> 2) & 7,
          transparent: packed & 1 ? bytes[p + 4] : -1,
          delay: u16at(p + 2),
        };
      }
      p = skipSub(bytes, p);
      continue;
    }
    if (b !== 0x2c) break;
    const x = u16at(p);
    const y = u16at(p + 2);
    const w = u16at(p + 4);
    const h = u16at(p + 6);
    const lp = bytes[p + 8];
    p += 9;
    let pal = gct;
    if (lp & 0x80) {
      const n = 2 << (lp & 7);
      pal = bytes.subarray(p, p + 3 * n);
      p += 3 * n;
    }
    const interlaced = !!(lp & 0x40);
    const minCode = bytes[p++];
    const parts = [];
    let total = 0;
    while (bytes[p]) {
      const n = bytes[p];
      parts.push(bytes.subarray(p + 1, p + 1 + n));
      total += n;
      p += n + 1;
    }
    p++;
    const data = new Uint8Array(total);
    let q = 0;
    for (const part of parts) {
      data.set(part, q);
      q += part.length;
    }
    const idx = lzwDecode(data, minCode, w * h);
    const rows = interlaced ? interlaceRows(h) : null;
    const transparent = gce ? gce.transparent : -1;
    for (let r = 0; r < h; r++) {
      const dy = y + (rows ? rows[r] : r);
      if (dy >= H) continue;
      for (let c = 0; c < w; c++) {
        const dx = x + c;
        if (dx >= W) continue;
        const v = idx[r * w + c];
        if (v === transparent) continue;
        const o = (dy * W + dx) * 4;
        const k = v * 3;
        canvas[o] = pal ? pal[k] : 0;
        canvas[o + 1] = pal ? pal[k + 1] : 0;
        canvas[o + 2] = pal ? pal[k + 2] : 0;
        canvas[o + 3] = 255;
      }
    }
    yield { index: index++, width: W, height: H, rgba: canvas, delay: gce ? gce.delay : 0 };
    if (gce && gce.disposal === 2) {
      for (let r = 0; r < h; r++) {
        const dy = y + (rows ? rows[r] : r);
        if (dy >= H) continue;
        for (let c = 0; c < w; c++) {
          const dx = x + c;
          if (dx < W) canvas.fill(0, (dy * W + dx) * 4, (dy * W + dx) * 4 + 4);
        }
      }
    }
    gce = null;
  }
}
