// Cifrado, hash y compresión con WebCrypto y CompressionStream (sin dependencias).
//
// Diseño:
// - Una sola derivación de clave por sesión (PBKDF2-SHA256, 310 000 iteraciones).
//   Antes de v0.0.1a el cifrado era por bloque; eso multiplicaba el coste por el número de QR.
// - La sal es el id de sesión, aleatorio de 16 bytes. Cada sesión tiene clave propia,
//   por eso el IV puede ser fijo a cero sin reutilizar par (clave, IV).
// - AES-GCM autentica: una contraseña incorrecta o un flujo dañado falla al descifrar.

export const PBKDF2_ITERATIONS = 310000;
const ZERO_IV = new Uint8Array(12);

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function randomU32() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  let s = '';
  for (const b of new Uint8Array(digest)) s += b.toString(16).padStart(2, '0');
  return s;
}

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password.normalize('NFC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encrypt(bytes, password, salt) {
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ZERO_IV }, key, bytes);
  return new Uint8Array(ct);
}

export async function decrypt(bytes, password, salt) {
  const key = await deriveKey(password, salt);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ZERO_IV }, key, bytes);
    return new Uint8Array(pt);
  } catch {
    throw new Error('Contraseña incorrecta o archivo dañado');
  }
}

async function pipe(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const deflate = (bytes) => pipe(bytes, new CompressionStream('deflate-raw'));
export const inflate = (bytes) => pipe(bytes, new DecompressionStream('deflate-raw'));
