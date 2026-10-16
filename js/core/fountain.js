// Códigos fuente tipo LT (Luby, 2002) con distribución Robust Soliton.
//
// Por qué fountain y no bloques numerados: con bloques hacen falta TODOS los QR en
// concreto. Aquí cualquier conjunto de fotogramas suficiente sirve, sin importar el
// orden, ni de qué encuentro o de qué bolsa vengan. Eso es lo que permite el reenvío
// entre personas (bolsas) sin coordinación: cada fotograma aporta información nueva.
//
// Cada seed define, de forma determinista, un grado d y d índices fuente.
// El emisor y el receptor reproducen la misma selección a partir de (K, seed).

const CDF_CACHE = new Map();

// Mulberry32: PRNG pequeño, determinista y rápido.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function robustSolitonCdf(K, c = 0.1, delta = 0.05) {
  const key = `${K}:${c}:${delta}`;
  const cached = CDF_CACHE.get(key);
  if (cached) return cached;

  const cdf = new Float64Array(K + 1);
  if (K === 1) {
    cdf[1] = 1;
  } else {
    const rho = new Float64Array(K + 1);
    rho[1] = 1 / K;
    for (let d = 2; d <= K; d++) rho[d] = 1 / (d * (d - 1));

    const R = c * Math.log(K / delta) * Math.sqrt(K);
    const pivot = Math.min(K, Math.max(1, Math.floor(K / R)));
    const tau = new Float64Array(K + 1);
    for (let d = 1; d < pivot; d++) tau[d] = R / (d * K);
    tau[pivot] = Math.max(0, (R * Math.log(R / delta)) / K);

    const mu = new Float64Array(K + 1);
    let z = 0;
    for (let d = 1; d <= K; d++) {
      mu[d] = rho[d] + tau[d];
      z += mu[d];
    }
    let acc = 0;
    for (let d = 1; d <= K; d++) {
      acc += mu[d] / z;
      cdf[d] = acc;
    }
    cdf[K] = 1;
  }
  if (CDF_CACHE.size > 64) CDF_CACHE.clear();
  CDF_CACHE.set(key, cdf);
  return cdf;
}

function sampleDegree(u, cdf) {
  let lo = 1;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] >= u) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// Índices fuente combinados por un símbolo. Es determinista en (K, seed).
export function neighbors(K, seed) {
  if (K === 1) return [0];
  // Fase sistemática: los primeros K marcos llevan cada bloque en claro. Escaneando en
  // orden basta con K marcos (medido: 1,00 frente a 1,3–1,7 de LT pura).
  if (seed < K) return [seed];
  const r = rng(seed);
  const d = sampleDegree(r(), robustSolitonCdf(K));
  if (d >= K) return Array.from({ length: K }, (_, i) => i);
  const set = new Set();
  while (set.size < d) set.add(Math.floor(r() * K));
  return [...set];
}

function xorInto(dst, src) {
  for (let j = 0; j < dst.length; j++) dst[j] ^= src[j];
}

export function encodeSymbol(source, K, S, seed) {
  const out = new Uint8Array(S);
  for (const i of neighbors(K, seed)) {
    const off = i * S;
    for (let j = 0; j < S; j++) out[j] ^= source[off + j];
  }
  return out;
}

// Decodificador por propagación ("peeling"): mientras haya una ecuación con una sola
// incógnita, se resuelve y se retira de las demás. Coste ~ O(sum de grados × S).
export class FountainDecoder {
  constructor(K, S) {
    this.K = K;
    this.S = S;
    this.solved = new Array(K).fill(null);
    this.solvedCount = 0;
    this.eqs = new Map();
    this.byIdx = Array.from({ length: K }, () => new Set());
    this.nextId = 0;
  }

  get complete() {
    return this.solvedCount === this.K;
  }

  addSymbol(seed, payload) {
    if (this.complete) return false;
    const nb = neighbors(this.K, seed);
    // Atajo: si todos los vecinos ya están resueltos, el símbolo no aporta nada y no se copia.
    let open = 0;
    for (const i of nb) if (!this.solved[i]) open++;
    if (open === 0) return false;
    const idx = new Set(nb);
    const data = Uint8Array.from(payload);
    for (const i of nb) {
      const s = this.solved[i];
      if (s) {
        xorInto(data, s);
        idx.delete(i);
      }
    }
    if (idx.size === 1) {
      this._solveFrom({ id: -1, idx, data });
      return true;
    }
    const id = this.nextId++;
    const eq = { id, idx, data };
    this.eqs.set(id, eq);
    for (const i of idx) this.byIdx[i].add(id);
    return true;
  }

  _solveFrom(start) {
    const queue = [start];
    while (queue.length) {
      const e = queue.pop();
      if (e.idx.size !== 1) continue;
      const [i] = e.idx;
      e.idx.clear();
      this.eqs.delete(e.id);
      if (this.solved[i]) continue;
      this.solved[i] = e.data;
      this.solvedCount++;
      for (const id of this.byIdx[i]) {
        const f = this.eqs.get(id);
        if (!f) continue;
        xorInto(f.data, e.data);
        f.idx.delete(i);
        if (f.idx.size === 1) queue.push(f);
        else if (f.idx.size === 0) this.eqs.delete(id);
      }
      this.byIdx[i].clear();
    }
  }

  result(L) {
    if (!this.complete) throw new Error('faltan fragmentos');
    const out = new Uint8Array(this.K * this.S);
    for (let i = 0; i < this.K; i++) out.set(this.solved[i], i * this.S);
    return out.slice(0, L);
  }
}
