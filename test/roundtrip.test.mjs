import { test } from 'node:test';
import assert from 'node:assert/strict';
import { b45encode, b45decode } from '../js/core/base45.js';
import { encodeFrame, decodeFrame } from '../js/core/format.js';
import {
  prepareBytes, frameAt, frameToText, textToFrame, Receiver, recommendedCount,
} from '../js/core/codec.js';
import { encodeBag, decodeBag, FrameStore } from '../js/core/bag.js';

const PASS = 'contraseña-de-prueba';

function sample(n, seed = 1) {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out[i] = (x >>> 16) & 255;
  }
  return out;
}

// Un texto compresible, para que el deflate también se ejercite.
const text = (n) => new TextEncoder().encode('SHUMZU transmite archivos por QR. '.repeat(Math.ceil(n / 32)).slice(0, n));

test('base45: ida y vuelta para todas las longitudes pequeñas', () => {
  for (let n = 0; n < 40; n++) {
    const b = sample(n, n + 7);
    assert.deepEqual(b45decode(b45encode(b)), b);
  }
});

test('base45: rechaza caracteres fuera del alfabeto', () => {
  assert.throws(() => b45decode('abc'));
});

test('formato: cabecera y CRC detectan corrupción', () => {
  const frame = encodeFrame({
    session: sample(16), flags: 3, K: 5, S: 20, L: 90, seed: 42, payload: sample(20),
  });
  const f = decodeFrame(frame);
  assert.equal(f.K, 5);
  assert.equal(f.seed, 42);
  const bad = frame.slice();
  bad[40] ^= 1;
  assert.throws(() => decodeFrame(bad), /CRC/);
});

test('transmisión completa sin pérdidas, en orden aleatorio', async () => {
  // Datos incomprimibles para que K sea realista (con texto repetitivo K sería ~1).
  const data = sample(6000, 3);
  const prep = await prepareBytes({ name: 'nota.txt', mime: 'text/plain', data }, PASS, { S: 200 });
  const frames = [];
  for (let i = 0; i < recommendedCount(prep) * 2; i++) frames.push(frameAt(prep, i));
  frames.sort(() => Math.random() - 0.5);

  const rx = new Receiver();
  let used = 0;
  for (const f of frames) {
    used++;
    if (rx.add(f) === 'done') break;
  }
  assert.ok(rx.complete, 'debe completarse');
  const out = await rx.assemble(PASS);
  assert.equal(out.name, 'nota.txt');
  assert.deepEqual(out.data, data);
  console.log(`  K=${prep.K} símbolos, ${used} fotogramas usados (${(used / prep.K).toFixed(2)}x)`);
});

test('pérdida del 30 % de fotogramas: sigue recuperando', async () => {
  const data = sample(9000, 99);
  const prep = await prepareBytes({ name: 'bin.dat', data }, PASS, { S: 200 });
  const rx = new Receiver();
  let i = 0;
  while (!rx.complete && i < prep.K * 8) {
    const f = frameAt(prep, i++);
    if (Math.random() < 0.7) rx.add(f);
  }
  assert.ok(rx.complete, `no completó tras ${i} emisiones (K=${prep.K})`);
  const out = await rx.assemble(PASS);
  assert.deepEqual(out.data, data);
});

test('fotogramas duplicados no cuentan como progreso', async () => {
  const prep = await prepareBytes({ name: 'a', data: text(500) }, PASS, { S: 120 });
  const rx = new Receiver();
  const f = frameAt(prep, 0);
  assert.equal(rx.add(f), 'new');
  assert.equal(rx.add(f), 'dup');
});

test('contraseña incorrecta: falla al final y no entrega datos', async () => {
  const data = text(2000);
  const prep = await prepareBytes({ name: 'x', data }, PASS, { S: 200 });
  const rx = new Receiver();
  for (let i = 0; rx.add(frameAt(prep, i)) !== 'done'; i++) {
    assert.ok(i < prep.K * 4);
  }
  await assert.rejects(rx.assemble('otra-contraseña'), /Contraseña incorrecta/);
});

test('contraseña demasiado corta se rechaza al preparar', async () => {
  await assert.rejects(prepareBytes({ name: 'x', data: text(10) }, 'corta'), /al menos 8/);
});

test('texto base45 para QR: el fotograma sobrevive la conversión', async () => {
  const prep = await prepareBytes({ name: 'q', data: text(800) }, PASS, { S: 200 });
  const rx = new Receiver();
  let i = 0;
  let res;
  do {
    const t = frameToText(frameAt(prep, i++));
    assert.match(t, /^[0-9A-Z $%*+\-./:]+$/, 'solo alfabeto alfanumérico de QR');
    res = rx.add(textToFrame(t));
  } while (res !== 'done' && i < prep.K * 4);
  assert.ok(rx.complete);
  assert.deepEqual((await rx.assemble(PASS)).data, text(800));
});

test('bolsas: exportar, importar, deduplicar y relevar sin contraseña', async () => {
  const data = sample(4000, 5);
  const prep = await prepareBytes({ name: 'bolsa.bin', data }, PASS, { S: 200 });

  // A crea su bolsa con parte de los fotogramas.
  const bagA = encodeBag(Array.from({ length: Math.ceil(prep.K * 0.6) }, (_, i) => frameAt(prep, i)));

  // B recibe la bolsa de A, y después la de C (que solapa con A), y la reenvía tal cual.
  const storeB = new FrameStore();
  for (const f of decodeBag(bagA)) storeB.add(f);
  // C aporta un presupuesto completo de fotogramas nuevos (la sobrecarga LT es ~1,4×).
  const bagC = encodeBag(Array.from({ length: recommendedCount(prep) }, (_, i) => frameAt(prep, i + prep.K)));
  let dup = 0;
  for (const f of decodeBag(bagC)) if (storeB.add(f) === 'dup') dup++;
  for (const f of decodeBag(bagA)) if (storeB.add(f) === 'dup') dup++;
  assert.equal(dup, decodeBag(bagA).length, 'los fotogramas de A repetidos se detectan');

  // Carol recibe solo la bolsa reenviada por B.
  const relay = encodeBag(storeB.allFrames());
  const rx = new Receiver();
  for (const f of decodeBag(relay)) {
    if (rx.add(f) === 'done') break;
  }
  assert.ok(rx.complete, 'el relevo permite completar');
  assert.deepEqual((await rx.assemble(PASS)).data, data);
});

test('bolsa inválida se rechaza', () => {
  assert.throws(() => decodeBag(Uint8Array.of(1, 2, 3, 4, 0, 0, 0, 1)), /no es una bolsa/);
});
