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

// Identidad de un envío: sesión + K/S/L (ver codec.variantOf; se repite aquí para no
// crear dependencia circular).
export const variantKey = (f) => `${toHex(f.session)}.${f.K}.${f.S}.${f.L}`;

// Almacén de fotogramas recibidos, agrupados por variante y deduplicados por seed.
//
// 0.0.1a agrupaba solo por sesión y fijaba K/S/L con el PRIMER fotograma visto: un único
// fotograma malintencionado en una bolsa de relevo (misma sesión, otra L) hacía que todos
// los legítimos se rechazaran como 'invalid'. Ahora cada variante es independiente.
export class FrameStore {
  constructor() {
    this.sessions = new Map(); // vid -> { sid, K, S, L, frames: Map<seed, bytes> }
    this.total = 0;
  }

  // Devuelve 'new' | 'dup' | 'invalid'. Solo guarda fotogramas bien formados.
  add(bytes) {
    let f;
    try {
      f = decodeFrame(bytes);
    } catch {
      return 'invalid';
    }
    return this.addParsed(f, bytes).st;
  }

  // Con el fotograma ya decodificado. Devuelve { st: 'new' | 'dup', vid }.
  addParsed(f, bytes) {
    const vid = variantKey(f);
    let s = this.sessions.get(vid);
    if (!s) {
      s = { sid: toHex(f.session), K: f.K, S: f.S, L: f.L, frames: new Map() };
      this.sessions.set(vid, s);
    }
    if (s.frames.has(f.seed)) return { st: 'dup', vid };
    s.frames.set(f.seed, bytes.slice());
    this.total++;
    return { st: 'new', vid };
  }

  remove(vid) {
    const s = this.sessions.get(vid);
    if (s) this.total -= s.frames.size;
    return this.sessions.delete(vid);
  }

  count(vid) {
    const s = this.sessions.get(vid);
    return s ? s.frames.size : 0;
  }

  seedsOf(vid) {
    const s = this.sessions.get(vid);
    return s ? [...s.frames.keys()] : [];
  }

  framesOf(vid) {
    const s = this.sessions.get(vid);
    return s ? [...s.frames.values()] : [];
  }

  allFrames() {
    const out = [];
    for (const s of this.sessions.values()) for (const f of s.frames.values()) out.push(f);
    return out;
  }
}
