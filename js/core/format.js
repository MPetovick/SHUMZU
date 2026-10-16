// Formato binario de fotograma SHUMZU v1.
//
// Un fotograma es un símbolo fountain (LT) con su cabecera y un CRC32:
//
//   offset  tamaño  campo
//   0       2       magia "SZ"
//   2       1       versión de formato (1)
//   3       1       banderas: bit0 = cifrado, bit1 = deflate
//   4       16      id de sesión (también sal PBKDF2 cuando hay cifrado)
//   20      4       K  · número de símbolos fuente
//   24      2       S  · tamaño de cada símbolo en bytes
//   26      4       L  · longitud real del flujo (sin relleno)
//   30      4       seed del símbolo (determina qué fuentes combina)
//   34      S       carga: XOR de los símbolos fuente indicados por seed
//   34+S    4       CRC32 de todo lo anterior
//
// Cada fotograma se transmite como base45 dentro de un QR.
// Con 300 B de carga son 38 B de cabecera+CRC, un 11 % de sobrecarga por fotograma.

export const MAGIC = Uint8Array.of(0x53, 0x5a);
export const VERSION = 1;
export const FLAG_ENCRYPTED = 0x01;
export const FLAG_DEFLATE = 0x02;
export const SESSION_BYTES = 16;
export const HEADER_BYTES = 34;
export const TRAILER_BYTES = 4;
export const MAX_SYMBOL = 4096;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, end = bytes.length) {
  let c = 0xffffffff;
  for (let i = 0; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function encodeFrame({ session, flags, K, S, L, seed, payload }) {
  if (session.length !== SESSION_BYTES) throw new Error('sesión no válida');
  if (payload.length !== S) throw new Error('carga de tamaño incorrecto');
  const out = new Uint8Array(HEADER_BYTES + S + TRAILER_BYTES);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  out[2] = VERSION;
  out[3] = flags & 0xff;
  out.set(session, 4);
  dv.setUint32(20, K);
  dv.setUint16(24, S);
  dv.setUint32(26, L);
  dv.setUint32(30, seed >>> 0);
  out.set(payload, HEADER_BYTES);
  dv.setUint32(HEADER_BYTES + S, crc32(out, HEADER_BYTES + S));
  return out;
}

export function decodeFrame(bytes) {
  if (bytes.length < HEADER_BYTES + TRAILER_BYTES) throw new Error('fotograma demasiado corto');
  if (bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1]) throw new Error('no es un fotograma SHUMZU');
  if (bytes[2] !== VERSION) throw new Error('versión de formato no soportada');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const S = dv.getUint16(24);
  if (S === 0 || S > MAX_SYMBOL || bytes.length !== HEADER_BYTES + S + TRAILER_BYTES) {
    throw new Error('longitud de fotograma no válida');
  }
  if (dv.getUint32(HEADER_BYTES + S) !== crc32(bytes, HEADER_BYTES + S)) {
    throw new Error('fotograma dañado (CRC)');
  }
  return {
    flags: bytes[3],
    session: bytes.slice(4, 4 + SESSION_BYTES),
    K: dv.getUint32(20),
    S,
    L: dv.getUint32(26),
    seed: dv.getUint32(30),
    payload: bytes.slice(HEADER_BYTES, HEADER_BYTES + S),
  };
}

// Cabecera de archivo dentro del flujo (se cifra junto con el contenido).
export function packPlain({ name, mime, size, sha256, data }) {
  const meta = new TextEncoder().encode(JSON.stringify({ n: name, t: mime || '', s: size, h: sha256, v: 1 }));
  if (meta.length > 65535) throw new Error('nombre de archivo demasiado largo');
  const out = new Uint8Array(2 + meta.length + data.length);
  new DataView(out.buffer).setUint16(0, meta.length);
  out.set(meta, 2);
  out.set(data, 2 + meta.length);
  return out;
}

export function unpackPlain(bytes) {
  if (bytes.length < 2) throw new Error('flujo demasiado corto');
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0);
  if (2 + n > bytes.length) throw new Error('cabecera de archivo no válida');
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(2, 2 + n)));
  return { meta, data: bytes.subarray(2 + n) };
}

export function toHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}
