// Genera un vídeo Y4M que simula la cámara del receptor mirando la pantalla del emisor.
// Uso: VW=1920 VH=1080 WS=460 FACT=2 node tools/camara-simulada.mjs <qr_por_pantalla> <salida.y4m> [fps_emisor] [bytes]
// Chromium: --use-fake-device-for-media-stream --use-file-for-fake-video-capture=<salida.y4m>
// Requiere la dependencia de desarrollo qrcode (npm install).
import QRCode from 'qrcode';
import { openSync, writeSync, closeSync } from 'node:fs';
import { prepareBytes, frameAt, frameToText } from '../js/core/codec.js';
const [, , N, OUT, SENDER_FPS = '10', BYTES = '10000'] = process.argv;
const n = Number(N);
const W = Number(process.env.VW || 540), H = Number(process.env.VH || 960), CAM_FPS = 30, FILL = Number(process.env.FILL || 0.9);
let x = 7; const data = new Uint8Array(Number(BYTES)).map(() => (x = (Math.imul(x, 1103515245) + 12345) >>> 0) >>> 24);
const prep = await prepareBytes({ name: 'cam.bin', data }, 'clave-camara-1', { S: 225 });
const screens = Math.ceil((prep.K * Number(process.env.FACT || 2.6)) / n);
const per = Math.round(CAM_FPS / Number(SENDER_FPS));
const fd = openSync(OUT, 'w');
writeSync(fd, `YUV4MPEG2 W${W} H${H} F${CAM_FPS}:1 Ip A1:1 C420jpeg\n`);
const uv = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
let rnd = 99;
for (let s = 0; s < screens; s++) {
  const ms = []; for (let k = 0; k < n; k++) ms.push(QRCode.create(frameToText(frameAt(prep, s * n + k)), { errorCorrectionLevel: 'L' }).modules);
  const m0 = ms[0].size, q = 4, cell = m0 + 2 * q, cols = n === 4 ? 2 : 1, rows = Math.ceil(n / cols);
  const scale = process.env.WS ? Number(process.env.WS) / (cols * cell) : Math.min((W * FILL) / (cols * cell), (H * 0.85) / (rows * cell));
  const mw = cols * cell * scale, mh = rows * cell * scale, ox = (W - mw) / 2, oy = (H - mh) / 2;
  const Y = new Float32Array(W * H);
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    let v = 45; // marco oscuro alrededor de la pantalla del emisor
    const u = (xx - ox) / scale, w = (yy - oy) / scale;
    if (u >= 0 && w >= 0 && u < cols * cell && w < rows * cell) {
      v = 235;
      const c = Math.floor(u / cell), r = Math.floor(w / cell), i = r * cols + c;
      const mx = Math.floor(u - c * cell - q), my = Math.floor(w - r * cell - q);
      if (i < n && mx >= 0 && my >= 0 && mx < m0 && my < m0 && ms[i].data[my * m0 + mx]) v = 25;
    }
    Y[yy * W + xx] = v;
  }
  // Desenfoque 3×3 y ruido: la cámara no ve bordes perfectos.
  const out = Buffer.alloc(W * H);
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    let acc = 0, cnt = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const a = xx + dx, b = yy + dy; if (a >= 0 && b >= 0 && a < W && b < H) { acc += Y[b * W + a]; cnt++; } }
    rnd = (Math.imul(rnd, 1103515245) + 12345) >>> 0;
    out[yy * W + xx] = Math.max(0, Math.min(255, Math.round(acc / cnt + ((rnd >>> 24) % 17) - 8)));
  }
  for (let f = 0; f < per; f++) { writeSync(fd, 'FRAME\n'); writeSync(fd, out); writeSync(fd, uv); }
}
closeSync(fd);
console.log(JSON.stringify({ n, K: prep.K, screens, frames: screens * per, seconds: (screens * per) / CAM_FPS, minSeconds: prep.K / (Number(SENDER_FPS) * n) }));
