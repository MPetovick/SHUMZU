// Paquete multiarchivo: varios archivos en un solo envío.
//
// Va DENTRO del flujo cifrado como un archivo más (tipo PACK_MIME), así que el formato de
// fotograma no cambia: una versión antigua lo recibe como un único archivo «.szpk».
//
//   "SZPK" · u8 versión (1) · u32 número de archivos
//   por archivo: u16 longitud nombre · nombre UTF-8 · u8 longitud tipo · tipo · u32 tamaño · datos
//
// Todo big-endian. La integridad la cubren AES-GCM y el SHA-256 del paquete completo.

export const PACK_MIME = 'application/x-shumzu-pack';
const MAGIC = [0x53, 0x5a, 0x50, 0x4b];
const enc = new TextEncoder();
const dec = new TextDecoder();

export function packFiles(files) {
  if (!files.length) throw new Error('paquete vacío');
  const heads = files.map((f) => {
    const name = enc.encode(String(f.name || 'archivo')).subarray(0, 1024);
    const mime = enc.encode(String(f.mime || '')).subarray(0, 255);
    return { name, mime, data: f.data };
  });
  let total = 9;
  for (const h of heads) total += 2 + h.name.length + 1 + h.mime.length + 4 + h.data.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  out[4] = 1;
  dv.setUint32(5, heads.length);
  let o = 9;
  for (const h of heads) {
    dv.setUint16(o, h.name.length); o += 2;
    out.set(h.name, o); o += h.name.length;
    out[o++] = h.mime.length;
    out.set(h.mime, o); o += h.mime.length;
    dv.setUint32(o, h.data.length); o += 4;
    out.set(h.data, o); o += h.data.length;
  }
  return out;
}

export function isPack(bytes) {
  return bytes.length >= 9 && MAGIC.every((m, i) => bytes[i] === m);
}

// Devuelve [{ name, mime, data }] con `data` como vista (sin copiar) sobre `bytes`.
export function unpackFiles(bytes) {
  if (!isPack(bytes)) throw new Error('no es un paquete SHUMZU');
  if (bytes[4] !== 1) throw new Error('versión de paquete no soportada');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(5);
  const out = [];
  let o = 9;
  const need = (n) => {
    if (o + n > bytes.length) throw new Error('paquete truncado');
  };
  for (let i = 0; i < count; i++) {
    need(2);
    const nl = dv.getUint16(o); o += 2;
    need(nl);
    const name = dec.decode(bytes.subarray(o, o + nl)); o += nl;
    need(1);
    const ml = bytes[o++];
    need(ml);
    const mime = dec.decode(bytes.subarray(o, o + ml)); o += ml;
    need(4);
    const size = dv.getUint32(o); o += 4;
    need(size);
    out.push({ name, mime, data: bytes.subarray(o, o + size) });
    o += size;
  }
  if (o !== bytes.length) throw new Error('paquete con datos sobrantes');
  return out;
}
