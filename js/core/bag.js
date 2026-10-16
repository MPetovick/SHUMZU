// Bolsas: contenedor de fotogramas para transporte por proximidad (archivo .szb o Web Share).
//
// Formato:
//   "SZB1" (4 bytes) · u32 número de fotogramas · por cada uno: u16 longitud + fotograma
//
// Los fotogramas están cifrados de extremo a extremo y son autodescriptivos (sesión + seed),
// así que un intermediario puede copiarlos y reenviarlos sin conocer la contraseña
// y sin riesgo de duplicarlos: la clave de deduplicación es (sesión, seed).
import { decodeFrame, toHex } from './format.js';

const MAGIC = Uint8Array.of(0x53, 0x5a, 0x42, 0x31);

export function encodeBag(frames) {
  let total = 8;
  for (const f of frames) total += 2 + f.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  dv.setUint32(4, frames.length);
  let off = 8;
  for (const f of frames) {
    dv.setUint16(off, f.length);
    out.set(f, off + 2);
    off += 2 + f.length;
  }
  return out;
}

export function decodeBag(bytes) {
  if (bytes.length < 8 || bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1] || bytes[2] !== MAGIC[2] || bytes[3] !== MAGIC[3]) {
    throw new Error('no es una bolsa SHUMZU');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(4);
  const frames = [];
  let off = 8;
  for (let i = 0; i < count; i++) {
    if (off + 2 > bytes.length) throw new Error('bolsa truncada');
    const len = dv.getUint16(off);
    off += 2;
    if (off + len > bytes.length) throw new Error('bolsa truncada');
    frames.push(bytes.slice(off, off + len));
    off += len;
  }
  return frames;
}

// Almacén de fotogramas recibidos, agrupados por sesión y deduplicados por seed.
export class FrameStore {
  constructor() {
    this.sessions = new Map(); // sid -> { K, S, L, frames: Map<seed, bytes> }
  }

  // Devuelve 'new' | 'dup' | 'invalid'. Solo guarda fotogramas bien formados.
  add(bytes) {
    let f;
    try {
      f = decodeFrame(bytes);
    } catch {
      return 'invalid';
    }
    const sid = toHex(f.session);
    let s = this.sessions.get(sid);
    if (!s) {
      s = { K: f.K, S: f.S, L: f.L, frames: new Map() };
      this.sessions.set(sid, s);
    } else if (s.K !== f.K || s.S !== f.S || s.L !== f.L) {
      return 'invalid';
    }
    if (s.frames.has(f.seed)) return 'dup';
    s.frames.set(f.seed, bytes.slice());
    return 'new';
  }

  remove(sid) {
    return this.sessions.delete(sid);
  }

  count(sid) {
    const s = this.sessions.get(sid);
    return s ? s.frames.size : 0;
  }

  framesOf(sid) {
    const s = this.sessions.get(sid);
    return s ? [...s.frames.values()] : [];
  }

  allFrames() {
    const out = [];
    for (const s of this.sessions.values()) out.push(...s.frames.values());
    return out;
  }
}
