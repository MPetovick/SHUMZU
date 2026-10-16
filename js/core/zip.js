// Escritor ZIP mínimo (método «stored», sin compresión) para «Guardar todo».
// Los datos ya llegaron comprimidos con deflate por el canal; recomprimir no compensa.
// Nombres en UTF-8 (bit 11). Sin ZIP64: cada archivo y el total < 4 GiB (aquí ≤ 32 MiB).
import { crc32 } from './format.js';

const enc = new TextEncoder();

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// Evita nombres duplicados y rutas: «a.txt», «a (2).txt»…
function uniqueNames(files) {
  const seen = new Map();
  return files.map((f) => {
    const base = String(f.name || 'archivo').replace(/[\\/]+/g, '_').replace(/^\.+/, '_') || 'archivo';
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    if (n === 1) return base;
    const dot = base.lastIndexOf('.');
    return dot > 0 ? `${base.slice(0, dot)} (${n})${base.slice(dot)}` : `${base} (${n})`;
  });
}

export function zipStore(files, now = new Date()) {
  const { time, date } = dosTime(now);
  const names = uniqueNames(files).map((n) => enc.encode(n));
  const crcs = files.map((f) => crc32(f.data));
  let size = 22;
  for (let i = 0; i < files.length; i++) size += 30 + names[i].length + files[i].data.length + 46 + names[i].length;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  const offsets = [];
  let o = 0;
  for (let i = 0; i < files.length; i++) {
    const d = files[i].data;
    offsets.push(o);
    dv.setUint32(o, 0x04034b50, true);
    dv.setUint16(o + 4, 20, true);
    dv.setUint16(o + 6, 0x0800, true);
    dv.setUint16(o + 8, 0, true);
    dv.setUint16(o + 10, time, true);
    dv.setUint16(o + 12, date, true);
    dv.setUint32(o + 14, crcs[i], true);
    dv.setUint32(o + 18, d.length, true);
    dv.setUint32(o + 22, d.length, true);
    dv.setUint16(o + 26, names[i].length, true);
    dv.setUint16(o + 28, 0, true);
    out.set(names[i], o + 30);
    out.set(d, o + 30 + names[i].length);
    o += 30 + names[i].length + d.length;
  }
  const cdStart = o;
  for (let i = 0; i < files.length; i++) {
    const d = files[i].data;
    dv.setUint32(o, 0x02014b50, true);
    dv.setUint16(o + 4, 20, true);
    dv.setUint16(o + 6, 20, true);
    dv.setUint16(o + 8, 0x0800, true);
    dv.setUint16(o + 10, 0, true);
    dv.setUint16(o + 12, time, true);
    dv.setUint16(o + 14, date, true);
    dv.setUint32(o + 16, crcs[i], true);
    dv.setUint32(o + 20, d.length, true);
    dv.setUint32(o + 24, d.length, true);
    dv.setUint16(o + 28, names[i].length, true);
    dv.setUint16(o + 30, 0, true);
    dv.setUint16(o + 32, 0, true);
    dv.setUint16(o + 34, 0, true);
    dv.setUint16(o + 36, 0, true);
    dv.setUint32(o + 38, 0, true);
    dv.setUint32(o + 42, offsets[i], true);
    out.set(names[i], o + 46);
    o += 46 + names[i].length;
  }
  dv.setUint32(o, 0x06054b50, true);
  dv.setUint16(o + 8, files.length, true);
  dv.setUint16(o + 10, files.length, true);
  dv.setUint32(o + 12, o - cdStart, true);
  dv.setUint32(o + 16, cdStart, true);
  return out;
}
