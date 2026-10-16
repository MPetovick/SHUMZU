// Códec de alto nivel: archivo <-> fotogramas fountain <-> texto base45 (para QR).
import { encodeSymbol, FountainDecoder } from './fountain.js';
import {
  encodeFrame, decodeFrame, packPlain, unpackPlain, toHex,
  FLAG_ENCRYPTED, FLAG_DEFLATE, SESSION_BYTES, MAX_SYMBOL,
} from './format.js';
import { encrypt, decrypt, deflate, inflate, randomBytes, randomU32, sha256Hex } from './crypto.js';
import { b45encode, b45decode } from './base45.js';

export const MIN_PASSWORD = 8;
export const DEFAULT_S = 200;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

// Prepara el flujo a transmitir: cabecera + contenido -> deflate (si ayuda) -> AES-GCM.
// El nombre y el tipo viajan cifrados dentro del flujo, no en claro.
export async function prepareBytes({ name, mime = '', data }, password, { S = DEFAULT_S } = {}) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`);
  }
  if (!Number.isInteger(S) || S < 16 || S > MAX_SYMBOL) throw new Error('tamaño de símbolo no válido');
  if (data.length > MAX_FILE_BYTES) throw new Error('archivo demasiado grande para v0.0.1a (máx. 8 MB)');

  const sha256 = await sha256Hex(data);
  const plain = packPlain({ name, mime, size: data.length, sha256, data });
  let body = plain;
  let flags = FLAG_ENCRYPTED;
  const z = await deflate(plain);
  if (z.length < plain.length) {
    body = z;
    flags |= FLAG_DEFLATE;
  }

  const session = randomBytes(SESSION_BYTES);
  const cipher = await encrypt(body, password, session);
  const K = Math.ceil(cipher.length / S);
  const source = new Uint8Array(K * S);
  source.set(cipher);
  return { session, flags, L: cipher.length, K, S, source };
}

// Fotograma i-ésimo del emisor. La semilla es el índice: los K primeros son sistemáticos.
// Infinito: el emisor puede seguir emitiendo sin límite.
export function frameAt(prep, i) {
  const seed = i >>> 0;
  const payload = encodeSymbol(prep.source, prep.K, prep.S, seed);
  return encodeFrame({
    session: prep.session, flags: prep.flags, K: prep.K, S: prep.S, L: prep.L, seed, payload,
  });
}

// Cuántos fotogramas conviene emitir para que un receptor sin pérdidas termine (LT tiene
// sobrecarga; esto es un valor conservador, el test mide la real).
export function recommendedCount(prep) {
  if (prep.K === 1) return 3;
  return Math.ceil(prep.K * 1.5) + 8;
}

export const frameToText = (bytes) => b45encode(bytes);
export const textToFrame = (text) => b45decode(text.trim());

export function sessionIdOf(bytes) {
  return toHex(decodeFrame(bytes).session);
}

// Receptor de una sesión. Acepta fotogramas en cualquier orden, con duplicados y pérdidas.
export class Receiver {
  constructor() {
    this.meta = null;
    this.dec = null;
    this.seen = new Set();
  }

  get sid() {
    return this.meta ? toHex(this.meta.session) : null;
  }

  get progress() {
    return this.dec ? this.dec.solvedCount / this.dec.K : 0;
  }

  get complete() {
    return !!this.dec && this.dec.complete;
  }

  get K() {
    return this.meta ? this.meta.K : 0;
  }

  // Devuelve 'new' | 'dup' | 'done' | 'other' | 'invalid'.
  add(bytes) {
    let f;
    try {
      f = decodeFrame(bytes);
    } catch {
      return 'invalid';
    }
    if (!this.meta) {
      this.meta = { session: f.session, K: f.K, S: f.S, L: f.L, flags: f.flags };
      this.dec = new FountainDecoder(f.K, f.S);
    } else {
      if (toHex(f.session) !== this.sid) return 'other';
      if (f.K !== this.meta.K || f.S !== this.meta.S || f.L !== this.meta.L) return 'invalid';
    }
    if (this.seen.has(f.seed)) return 'dup';
    this.seen.add(f.seed);
    this.dec.addSymbol(f.seed, f.payload);
    return this.complete ? 'done' : 'new';
  }

  async assemble(password) {
    if (!this.complete) throw new Error('faltan fragmentos');
    const cipher = this.dec.result(this.meta.L);
    const body = await decrypt(cipher, password, this.meta.session);
    const plain = this.meta.flags & FLAG_DEFLATE ? await inflate(body) : body;
    const { meta, data } = unpackPlain(plain);
    if ((await sha256Hex(data)) !== meta.h) throw new Error('verificación SHA-256 fallida');
    return { name: meta.n, mime: meta.t, data };
  }
}
