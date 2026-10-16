// Deterministic PRNG. Same parts -> same sequence on every device,
// which is what lets two peers compute the same game without a server.

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** makeRng(seed, round, 'loot') */
export function makeRng(...parts) {
  return mulberry32(hashString(parts.join('|')));
}

/** Random hex string for salts and seed shares (not used by game logic). */
export function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}
