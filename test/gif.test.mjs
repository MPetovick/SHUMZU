import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import QRCode from 'qrcode';
import { encodeGif, gifFrames } from '../js/core/gif.js';
import { qrGifBytes } from '../js/core/qrgif.js';
import {
  prepareBytes, frameAt, frameToText, textToFrame, Receiver, recommendedCount,
} from '../js/core/codec.js';

const here = dirname(fileURLToPath(import.meta.url));

// jsQR es un script UMD pensado para navegador: lo cargamos en un contexto aislado.
const jsCtx = { window: {}, console };
vm.createContext(jsCtx);
vm.runInContext(readFileSync(join(here, '../vendor/jsQR.js'), 'utf8'), jsCtx);
const jsQR = jsCtx.jsQR;

const make = (text) => {
  const q = QRCode.create(text, { errorCorrectionLevel: 'L' });
  return { size: q.modules.size, data: q.modules.data };
};

// Lee todos los códigos de un GIF, fotograma a fotograma, como haría la app.
function readAll(bytes) {
  const out = [];
  for (const f of gifFrames(bytes)) {
    const code = jsQR(f.rgba, f.width, f.height, { inversionAttempts: 'dontInvert' });
    out.push(code ? code.data : null);
  }
  return out;
}

// Píxeles pseudoaleatorios con rachas (comprimen) y ruido (fuerzan reinicios LZW).
function pixels(n, seed, bias) {
  const out = new Uint8Array(n);
  let x = seed;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    const r = (x >>> 16) & 255;
    prev = r < bias ? prev : r & 1;
    out[i] = prev;
  }
  return out;
}

test('GIF: ida y vuelta de píxeles con rachas y con ruido', () => {
  for (const [w, h, bias] of [[97, 61, 200], [300, 300, 60], [400, 400, 0]]) {
    const frames = [pixels(w * h, 7, bias), pixels(w * h, 99, bias)];
    const gif = encodeGif(frames, w, h, 10);
    const got = [];
    for (const f of gifFrames(gif)) {
      assert.equal(f.width, w);
      assert.equal(f.height, h);
      const px = new Uint8Array(w * h);
      // Paleta: índice 0 = blanco (255), índice 1 = oscuro (20, 26, 11).
      for (let i = 0; i < w * h; i++) px[i] = f.rgba[i * 4] < 128 ? 1 : 0;
      got.push(px);
    }
    assert.equal(got.length, 2);
    for (let k = 0; k < 2; k++) assert.deepEqual(got[k], frames[k], `fotograma ${k} (${w}x${h})`);
  }
});

test('GIF: rechaza algo que no es un GIF', () => {
  assert.throws(() => [...gifFrames(Uint8Array.from([1, 2, 3, 4, 5, 6]))], /no es un GIF/);
});

test('cadena completa: archivo -> QR -> GIF -> jsQR -> archivo idéntico', async () => {
  const data = Uint8Array.from({ length: 3000 }, (_, i) => (i * 131 + 17) & 255);
  const prep = await prepareBytes({ name: 'prueba.bin', mime: 'application/octet-stream', data }, 'contraseña-gif-1', { S: 200 });
  const n = recommendedCount(prep);
  const texts = Array.from({ length: n }, (_, i) => frameToText(frameAt(prep, i)));
  const gif = qrGifBytes(texts, make, { px: 4, quiet: 4, delayCs: 17 });

  const codes = readAll(gif).filter((t) => t !== null);
  assert.equal(codes.length, n, `jsQR debe leer los ${n} códigos del GIF (leyó ${codes.length})`);

  const rx = new Receiver();
  for (const t of codes) if (rx.add(textToFrame(t)) === 'done') break;
  assert.ok(rx.complete);
  const out = await rx.assemble('contraseña-gif-1');
  assert.equal(out.name, 'prueba.bin');
  assert.deepEqual(out.data, data);
});

test('cadena completa con pérdida de un 25 % de fotogramas del GIF', async () => {
  const data = Uint8Array.from({ length: 6000 }, (_, i) => (i * 73 + 5) & 255);
  const prep = await prepareBytes({ name: 'x.bin', data }, 'contraseña-gif-2', { S: 200 });
  const n = recommendedCount(prep) * 2;
  const texts = Array.from({ length: n }, (_, i) => frameToText(frameAt(prep, i)));
  const codes = readAll(qrGifBytes(texts, make)).filter((t, i) => t !== null && i % 4 !== 1);
  const rx = new Receiver();
  for (const t of codes) if (rx.add(textToFrame(t)) === 'done') break;
  assert.ok(rx.complete, 'debe completarse con pérdidas');
  assert.deepEqual((await rx.assemble('contraseña-gif-2')).data, data);
});
