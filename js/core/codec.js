// Códec de alto nivel: archivo <-> fotogramas fountain <-> texto base45 (para QR).
//
// v0.2.0: el formato de fotograma (v1) NO cambia; lo que emite 0.0.1a/0.1.0 se lee aquí.
// Cambios: límite 32 MiB, tamaños de símbolo grandes, recuento ajustado para medios sin
// pérdidas (GIF, bolsa) y un camino de ingesta que decodifica cada fotograma una sola vez.
import { encodeSymbol, FountainDecoder } from './fountain.js';
import {
  encodeFrame, decodeFrame, packPlain, unpackPlain, toHex,
  FLAG_ENCRYPTED, FLAG_DEFLATE, SESSION_BYTES, MAX_SYMBOL, HEADER_BYTES, TRAILER_BYTES,
} from './format.js';
import { encrypt, decrypt, deflate, inflate, randomBytes, sha256Hex } from './crypto.js';
import { b45encode, b45decode } from './base45.js';

export const MIN_PASSWORD = 8;
// 0.0.1a usaba S=200: 357 caracteres -> QR v10 (no v9 como decía su README), con el 10 %
// de la capacidad sin usar. S=225 llena el mismo v10: +12,5 % de datos por QR, mismo código.
export const DEFAULT_S = 225;
export const MAX_FILE_BYTES = 32 * 1024 * 1024;

// Capacidad alfanumérica de un QR versión 40, nivel L: 4296 caracteres -> 2864 bytes base45.
export const MAX_QR_S = Math.floor((4296 / 3) * 2) - HEADER_BYTES - TRAILER_BYTES;

// Tamaños de símbolo ofrecidos en la interfaz (bytes de carga por QR). Cada uno es el MÁXIMO
// que cabe en su versión de QR (nivel L, modo alfanumérico), medido con la librería qrcode:
// mismo código en pantalla, más datos. Los grandes necesitan buena cámara y pantalla nítida.
export const SIZE_PRESETS = [
  { id: 'xs', S: 148, label: 'v8 · robusto' },
  { id: 's', S: 225, label: 'v10 · estándar' },
  { id: 'm', S: 374, label: 'v13 · denso' },
  { id: 'l', S: 587, label: 'v17 · muy denso' },
  { id: 'xl', S: 794, label: 'v20 · máximo' },
];

// Prepara el flujo a transmitir: cabecera + contenido -> deflate (si ayuda) -> AES-GCM.
// El nombre y el tipo viajan cifrados dentro del flujo, no en claro.
export async function prepareBytes({ name, mime = '', data }, password, { S = DEFAULT_S } = {}) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`);
  }
  if (!Number.isInteger(S) || S < 16 || S > Math.min(MAX_SYMBOL, MAX_QR_S)) throw new Error('tamaño de símbolo no válido');
  if (data.length > MAX_FILE_BYTES) {
    throw new Error(`archivo demasiado grande (máx. ${MAX_FILE_BYTES / 1048576} MB)`);
  }

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
  // Evita una copia completa cuando el cifrado ya ocupa exactamente K·S bytes.
  let source = cipher;
  if (cipher.length !== K * S) {
    source = new Uint8Array(K * S);
    source.set(cipher);
  }
  return { session, flags, L: cipher.length, K, S, source };
}

// Fotograma i-ésimo del emisor. La semilla es el índice: los K primeros son sistemáticos.
// Infinito: el emisor puede seguir emitiendo sin límite y cada repetición es nueva.
export function frameAt(prep, i) {
  const seed = i >>> 0;
  const payload = encodeSymbol(prep.source, prep.K, prep.S, seed);
  return encodeFrame({
    session: prep.session, flags: prep.flags, K: prep.K, S: prep.S, L: prep.L, seed, payload,
  });
}

// Para la cámara (con pérdidas): valor conservador de 0.0.1a.
export function recommendedCount(prep) {
  if (prep.K === 1) return 3;
  return Math.ceil(prep.K * 1.5) + 8;
}

// Para medios sin pérdidas (GIF, bolsa): los K sistemáticos ya bastan; se añade un margen
// pequeño de reparación por si una app de mensajería recomprime y estropea algún fotograma.
// 0.0.1a usaba recommendedCount también aquí: GIF y bolsas ~45 % más grandes de lo necesario.
export function leanCount(prep, redundancy = 0.25) {
  if (prep.K === 1) return 2;
  return prep.K + Math.ceil(prep.K * redundancy) + 2;
}

// Segundos mínimos de emisión sin pérdidas: K fotogramas a `fps` pantallas/s con `perScreen` QR.
export function minSeconds(K, fps, perScreen = 1) {
  return K / Math.max(0.1, fps * perScreen);
}

export const frameToText = (bytes) => b45encode(bytes);
// El primer carácter de un fotograma siempre es '8' (magia "SZ") y el último nunca es un
// espacio, así que recortar espacios del lector es seguro aunque ' ' esté en el alfabeto.
export const textToFrame = (text) => b45decode(text.trim());

export function sessionIdOf(bytes) {
  return toHex(decodeFrame(bytes).session);
}

// Identidad de un envío: sesión + parámetros. Un fotograma con la misma sesión pero otros
// K/S/L (dañado o malintencionado) abre otra variante en vez de bloquear la legítima.
export const variantOf = (f) => `${toHex(f.session)}.${f.K}.${f.S}.${f.L}`;

// Receptor de una variante. Acepta fotogramas en cualquier orden, con duplicados y pérdidas.
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
    return this.addFrame(f);
  }

  // Igual que add() pero con el fotograma ya decodificado (evita repetir CRC y parseo).
  addFrame(f) {
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
    if (typeof meta.s === 'number' && meta.s !== data.length) throw new Error('tamaño declarado incorrecto');
    if ((await sha256Hex(data)) !== meta.h) throw new Error('verificación SHA-256 fallida');
    return { name: meta.n, mime: meta.t, data };
  }
}
