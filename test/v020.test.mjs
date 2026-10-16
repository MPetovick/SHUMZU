// Pruebas de las novedades de v0.2.0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import QRCode from 'qrcode';
import {
  prepareBytes, frameAt, frameToText, textToFrame, Receiver, recommendedCount, leanCount,
  SIZE_PRESETS, MAX_QR_S, MAX_FILE_BYTES, variantOf,
} from '../js/core/codec.js';
import { encodeFrame, decodeFrame, crc32 } from '../js/core/format.js';
import { FrameStore, encodeBag, decodeBag } from '../js/core/bag.js';
import { packFiles, unpackFiles, isPack } from '../js/core/pack.js';
import { zipStore } from '../js/core/zip.js';
import { b45encode, b45decode } from '../js/core/base45.js';

const here = dirname(fileURLToPath(import.meta.url));
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

// jsQR + multiqr.js en un contexto aislado, como en el worker.
const ctx = { console };
ctx.self = ctx;
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(join(here, '../vendor/jsQR.js'), 'utf8'), ctx);
vm.runInContext(readFileSync(join(here, '../js/workers/multiqr.js'), 'utf8'), ctx);

// Imagen RGBA con varios QR en cuadrícula (como el mosaico del emisor).
function mosaicRgba(texts, cols, px = 3, quiet = 3) {
  const ms = texts.map((t) => QRCode.create(t, { errorCorrectionLevel: 'L' }).modules);
  const n = Math.max(...ms.map((m) => m.size));
  const cell = n + quiet * 2;
  const rows = Math.ceil(texts.length / cols);
  const W = cols * cell * px;
  const H = rows * cell * px;
  const rgba = new Uint8ClampedArray(W * H * 4).fill(255);
  ms.forEach((m, i) => {
    const ox = (i % cols) * cell + quiet;
    const oy = Math.floor(i / cols) * cell + quiet;
    for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) {
      if (!m.data[y * m.size + x]) continue;
      for (let dy = 0; dy < px; dy++) for (let dx = 0; dx < px; dx++) {
        const p = (((oy + y) * px + dy) * W + (ox + x) * px + dx) * 4;
        rgba[p] = rgba[p + 1] = rgba[p + 2] = 0;
      }
    }
  });
  return { rgba, W, H };
}

test('tamaños de símbolo: versión QR real de cada preset', async () => {
  const prep = await prepareBytes({ name: 'x', data: sample(5000) }, PASS, { S: 200 });
  for (const p of SIZE_PRESETS) {
    const pp = await prepareBytes({ name: 'x', data: sample(p.S * 3, 7) }, PASS, { S: p.S });
    const t = frameToText(frameAt(pp, 0));
    const q = QRCode.create(t, { errorCorrectionLevel: 'L' });
    console.log(`  S=${p.S}: ${t.length} caracteres -> QR v${q.version} (${q.modules.size} módulos) · etiqueta «${p.label}»`);
    assert.ok(p.label.startsWith(`v${q.version} `), `etiqueta de S=${p.S} debe decir v${q.version}`);
  }
  // El máximo teórico cabe en un QR v40.
  const big = await prepareBytes({ name: 'x', data: sample(MAX_QR_S * 2, 3) }, PASS, { S: MAX_QR_S });
  const qb = QRCode.create(frameToText(frameAt(big, 0)), { errorCorrectionLevel: 'L' });
  assert.ok(qb.version <= 40);
  assert.ok(prep.K > 0);
});

test('archivo grande (12 MiB > límite antiguo de 8 MB) con S=1000', async () => {
  assert.ok(MAX_FILE_BYTES >= 32 * 1024 * 1024);
  const data = sample(12 * 1024 * 1024, 11);
  const t0 = Date.now();
  const prep = await prepareBytes({ name: 'grande.bin', data }, PASS, { S: 1000 });
  const rx = new Receiver();
  let i = 0;
  while (rx.add(frameAt(prep, i++)) !== 'done') assert.ok(i <= prep.K + 5);
  const out = await rx.assemble(PASS);
  assert.equal(out.data.length, data.length);
  assert.deepEqual(out.data.subarray(0, 4096), data.subarray(0, 4096));
  assert.equal(crc32(out.data), crc32(data));
  console.log(`  K=${prep.K}, ${i} fotogramas, ${(Date.now() - t0) / 1000} s`);
});

test('recuento para GIF/bolsa: menor que el de cámara y suficiente sin pérdidas', async () => {
  const prep = await prepareBytes({ name: 'x', data: sample(40000, 5) }, PASS, { S: 200 });
  const lean = leanCount(prep);
  const old = recommendedCount(prep);
  assert.ok(lean < old);
  const rx = new Receiver();
  for (let i = 0; i < lean; i++) rx.add(frameAt(prep, i));
  assert.ok(rx.complete);
  console.log(`  K=${prep.K}: GIF/bolsa ${lean} fotogramas frente a ${old} (−${Math.round((1 - lean / old) * 100)} %)`);
  // Con un 8 % de fotogramas estropeados (p. ej. recompresión), el margen sigue bastando.
  const rx2 = new Receiver();
  let r = 12345;
  for (let i = 0; i < lean; i++) {
    r = (Math.imul(r, 1103515245) + 12345) >>> 0;
    if ((r >>> 16) % 100 < 8) continue;
    rx2.add(frameAt(prep, i));
  }
  console.log(`  con 8 % perdido: ${rx2.complete ? 'completo' : 'incompleto'} (${rx2.dec.solvedCount}/${prep.K})`);
  assert.ok(rx2.complete, 'el margen del 25 % cubre un 8 % de fotogramas estropeados');
});

test('variantes: un fotograma envenenado no bloquea el envío legítimo', async () => {
  const data = sample(3000, 21);
  const prep = await prepareBytes({ name: 'ok.bin', data }, PASS, { S: 200 });
  const legit = frameAt(prep, 0);
  const f = decodeFrame(legit);
  // Misma sesión, otra L, CRC correcto: lo que un relevo malicioso podría inyectar.
  const poison = encodeFrame({ ...f, L: f.L + 7, seed: 999 });
  const store = new FrameStore();
  const rxs = new Map();
  const feed = (bytes) => {
    const ff = decodeFrame(bytes);
    const { st, vid } = store.addParsed(ff, bytes);
    if (st !== 'new') return;
    if (!rxs.has(vid)) rxs.set(vid, new Receiver());
    rxs.get(vid).addFrame(ff);
  };
  feed(poison); // llega primero
  for (let i = 0; i < prep.K; i++) feed(frameAt(prep, i));
  const good = rxs.get(variantOf(f));
  assert.ok(good.complete, 'la variante legítima se completa');
  assert.equal(rxs.size, 2);
  assert.deepEqual((await good.assemble(PASS)).data, data);
  // Y el almacén clásico ya no devuelve 'invalid' para los legítimos.
  const s2 = new FrameStore();
  assert.equal(s2.add(poison), 'new');
  assert.equal(s2.add(legit), 'new');
});

test('paquete multiarchivo: ida y vuelta y errores', () => {
  const files = [
    { name: 'foto.webp', mime: 'image/webp', data: sample(1000, 1) },
    { name: 'nota ñ.txt', mime: 'text/plain', data: new TextEncoder().encode('hola') },
    { name: 'vacío', mime: '', data: new Uint8Array(0) },
  ];
  const p = packFiles(files);
  assert.ok(isPack(p));
  const back = unpackFiles(p);
  assert.equal(back.length, 3);
  back.forEach((b, i) => {
    assert.equal(b.name, files[i].name);
    assert.equal(b.mime, files[i].mime);
    assert.deepEqual(new Uint8Array(b.data), files[i].data);
  });
  assert.throws(() => unpackFiles(p.subarray(0, p.length - 1)), /truncado/);
  assert.throws(() => unpackFiles(sample(20)), /no es un paquete/);
});

test('paquete dentro del cifrado: se transmite como un archivo más', async () => {
  const files = [
    { name: 'a.txt', mime: 'text/plain', data: new TextEncoder().encode('A'.repeat(500)) },
    { name: 'b.bin', mime: '', data: sample(2000, 4) },
  ];
  const prep = await prepareBytes({ name: '2 archivos.szpk', mime: 'application/x-shumzu-pack', data: packFiles(files) }, PASS, { S: 200 });
  const rx = new Receiver();
  for (let i = 0; rx.add(textToFrame(frameToText(frameAt(prep, i)))) !== 'done'; i++);
  const out = await rx.assemble(PASS);
  const back = unpackFiles(out.data);
  assert.deepEqual(new Uint8Array(back[1].data), files[1].data);
});

test('ZIP «stored»: estructura y CRC correctos', () => {
  const files = [
    { name: 'a.txt', data: new TextEncoder().encode('hola mundo') },
    { name: 'a.txt', data: sample(300, 9) },
  ];
  const z = zipStore(files, new Date(2026, 9, 16, 12, 0, 0));
  const dv = new DataView(z.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  const eocd = z.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50);
  assert.equal(dv.getUint16(eocd + 10, true), 2);
  const cd = dv.getUint32(eocd + 16, true);
  assert.equal(dv.getUint32(cd, true), 0x02014b50);
  assert.equal(dv.getUint32(cd + 16, true), crc32(files[0].data));
  // Nombres duplicados se desambiguan.
  const nl = dv.getUint16(cd + 28, true);
  const cd2 = cd + 46 + nl;
  const name2 = new TextDecoder().decode(z.subarray(cd2 + 46, cd2 + 46 + dv.getUint16(cd2 + 28, true)));
  assert.equal(name2, 'a (2).txt');
});

test('multi-QR: lee los 4 códigos de un mosaico 2×2 y los 2 de uno 1×2', async () => {
  const prep = await prepareBytes({ name: 'm', data: sample(4000, 8) }, PASS, { S: 200 });
  const texts = [0, 1, 2, 3].map((i) => frameToText(frameAt(prep, i)));
  const m4 = mosaicRgba(texts, 2);
  const r4 = ctx.shumzuMulti(ctx.jsQR, m4.rgba, m4.W, m4.H, 4, 'dontInvert');
  assert.deepEqual([...r4.texts].sort(), [...texts].sort());
  assert.equal(r4.boxes.length, 4);
  const m2 = mosaicRgba(texts.slice(0, 2), 1);
  const r2 = ctx.shumzuMulti(ctx.jsQR, m2.rgba, m2.W, m2.H, 4, 'dontInvert');
  assert.equal(r2.texts.length, 2);
  // jsQR a secas (max=1) no lee NINGUNO en un mosaico: mezcla patrones de códigos distintos.
  // Es el motivo de la lectura por celdas.
  const m1 = mosaicRgba(texts, 2);
  assert.equal(ctx.shumzuMulti(ctx.jsQR, m1.rgba, m1.W, m1.H, 1, 'dontInvert').texts.length, 0);
  // Con la cuadrícula recordada (pista) se leen todos sin probar la imagen completa.
  const m5 = mosaicRgba(texts, 2);
  assert.equal(ctx.shumzuMulti(ctx.jsQR, m5.rgba, m5.W, m5.H, 4, 'dontInvert', r4.grid).texts.length, 4);
});

test('multi-QR en cámara: mosaico 2×2 que NO llena el encuadre (fondo oscuro alrededor)', async () => {
  const prep = await prepareBytes({ name: 'm', data: sample(4000, 9) }, PASS, { S: 225 });
  const texts = [0, 1, 2, 3].map((i) => frameToText(frameAt(prep, i)));
  const m = mosaicRgba(texts, 2, 3, 4);
  // Lienzo vertical 540×960 gris oscuro con el mosaico centrado (como lo ve un móvil).
  const W = 540;
  const H = 960;
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < rgba.length; p += 4) { rgba[p] = rgba[p + 1] = rgba[p + 2] = 45; rgba[p + 3] = 255; }
  const ox = Math.floor((W - m.W) / 2);
  const oy = Math.floor((H - m.H) / 2);
  for (let y = 0; y < m.H; y++) rgba.set(m.rgba.subarray(y * m.W * 4, (y + 1) * m.W * 4), ((oy + y) * W + ox) * 4);
  const r = ctx.shumzuMulti(ctx.jsQR, rgba, W, H, 4, 'dontInvert');
  assert.deepEqual([...r.texts].sort(), [...texts].sort());
});

test('base45 optimizado: equivalente en datos largos y rechaza errores', () => {
  for (const n of [0, 1, 2, 3, 999, 1000, 4097]) {
    const b = sample(n, n + 1);
    assert.deepEqual(b45decode(b45encode(b)), b);
  }
  assert.throws(() => b45decode('A'), /longitud/);
  assert.throws(() => b45decode('ab'), /carácter/);
  assert.throws(() => b45decode(':::'), /rango/);
});

test('bolsa grande: allFrames no desborda la pila con muchos fotogramas', async () => {
  const prep = await prepareBytes({ name: 'x', data: sample(4000, 2) }, PASS, { S: 16 });
  const store = new FrameStore();
  for (let i = 0; i < 150000; i++) store.add(frameAt(prep, i));
  assert.equal(store.allFrames().length, 150000);
  assert.equal(store.total, 150000);
  assert.equal(decodeBag(encodeBag(store.allFrames().slice(0, 10))).length, 10);
});
