// Base45 (RFC 9285). Su alfabeto coincide con el modo alfanumérico de QR,
// que es el modo más denso que soporta la especificación para texto.
// Coste: 1,5 caracteres por byte frente a 2,0 de base64 o 1,0 de binario en modo byte,
// pero en modo alfanumérico cada carácter ocupa 5,5 bits, así que el coste real
// en el código QR es ~3 % sobre el binario puro, frente a ~33 % de base64.

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
// Tabla por código ASCII (más rápida que un Map en el bucle de decodificación).
const LOOKUP = new Int8Array(128).fill(-1);
for (let i = 0; i < CHARSET.length; i++) LOOKUP[CHARSET.charCodeAt(i)] = i;

export function b45encode(bytes) {
  let out = '';
  let i = 0;
  for (; i + 1 < bytes.length; i += 2) {
    const n = bytes[i] * 256 + bytes[i + 1];
    out += CHARSET[n % 45] + CHARSET[Math.floor(n / 45) % 45] + CHARSET[Math.floor(n / 2025)];
  }
  if (i < bytes.length) {
    const n = bytes[i];
    out += CHARSET[n % 45] + CHARSET[Math.floor(n / 45)];
  }
  return out;
}

export function b45decode(text) {
  const value = (c) => {
    const code = c.charCodeAt(0);
    const v = code < 128 ? LOOKUP[code] : -1;
    if (v < 0) throw new Error('base45: carácter no válido');
    return v;
  };
  const full = Math.floor(text.length / 3);
  const rest = text.length - full * 3;
  if (rest === 1) throw new Error('base45: longitud no válida');
  // Búfer preasignado: 0.0.1a acumulaba en un array JS y copiaba al final.
  const out = new Uint8Array(full * 2 + (rest === 2 ? 1 : 0));
  let o = 0;
  let i = 0;
  for (; i + 2 < text.length; i += 3) {
    const n = value(text[i]) + value(text[i + 1]) * 45 + value(text[i + 2]) * 2025;
    if (n > 65535) throw new Error('base45: grupo fuera de rango');
    out[o++] = n >> 8;
    out[o++] = n & 255;
  }
  if (rest === 2) {
    const n = value(text[i]) + value(text[i + 1]) * 45;
    if (n > 255) throw new Error('base45: grupo fuera de rango');
    out[o] = n;
  }
  return out;
}

export const B45_CHARSET = CHARSET;
