// SHUMZU v0.2.0 · controlador de la interfaz.
// Todo texto que venga de fuera (nombres de archivo, contenido) se inserta con textContent.
import {
  prepareBytes, frameAt, frameToText, textToFrame, Receiver, leanCount, minSeconds,
  MIN_PASSWORD, MAX_FILE_BYTES, SIZE_PRESETS, DEFAULT_S,
} from './core/codec.js';
import { encodeBag, decodeBag, FrameStore, variantKey } from './core/bag.js';
import { decodeFrame } from './core/format.js';
import { qrGifBytes, qrMake } from './core/qrgif.js';
import { packFiles, unpackFiles, PACK_MIME } from './core/pack.js';
import { zipStore } from './core/zip.js';
import { renderMosaic, matrixOf, drawFragmentMap, Scanner } from './visual.js';
import { codesFromFile } from './scan.js';
import { FrameDB } from './store.js';

const $ = (id) => document.getElementById(id);
const LEGACY_KEY = 'shumzu.v1.frames';
const GIF_MAX_FRAMES = 3000; // por encima, el GIF pesa decenas de MB: mejor la bolsa
const FMAP = { on: [57, 242, 255], off: [42, 32, 80], bg: [10, 7, 22], lockOn: [255, 194, 61] };

// ---------- estado ----------
const store = new FrameStore();          // fotogramas por variante (sesión+K+S+L), deduplicados por seed
const db = new FrameDB();
const entries = new Map();               // vid -> { vid, sid, rx, src, num, plain }
const rows = new Map();                  // vid -> <li> reutilizado
const recent = new Set();                // textos leídos hace poco (la cámara repite mucho)
let seq = 0;
const counters = { bad: 0, dup: 0 };
let current = null;                      // vid abierto en el detalle
let active = null;                       // vid del último fotograma nuevo (mapa en vivo)
let previewUrl = null;
let renderQueued = false;
let mapQueued = false;

// ---------- utilidades ----------
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else n.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) n.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
}

const keyOf = (vid, seed) => `${vid}:${seed}`;
const safeName = (s) => (s || 'archivo').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').slice(0, 120) || 'archivo';
const fmtBytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB');
const fmtTime = (s) => {
  if (!isFinite(s)) return '–';
  s = Math.ceil(s);
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : m ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s} s`;
};
const pad = (n) => '#' + String(n).padStart(3, '0');
const title = (e) => (e.plain ? (e.plain.files ? `${e.plain.files.length} archivos` : e.plain.name) : 'sesión ' + e.sid.slice(0, 8));
const solved = (e) => (e.rx.dec ? e.rx.dec.solvedCount : 0);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const isTyping = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');

function toast(msg, tone = '') {
  const t = $('toast');
  t.textContent = msg;
  t.dataset.tone = tone;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

function log(msg, tone = '') {
  const time = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const list = $('log');
  list.append(el('li', { class: tone }, el('time', {}, time), el('span', {}, msg)));
  while (list.children.length > 60) list.firstChild.remove();
  list.scrollTop = list.scrollHeight;
}

function download(bytes, name, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

function fromB64(str) {
  const bin = atob(str);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// Mantener la pantalla encendida mientras se emite o se escanea (si el navegador lo permite).
const wake = {
  lock: null,
  want: new Set(),
  async sync() {
    const need = this.want.size > 0 && !document.hidden;
    try {
      if (need && !this.lock && navigator.wakeLock) {
        this.lock = await navigator.wakeLock.request('screen');
        this.lock.addEventListener('release', () => { this.lock = null; });
      } else if (!need && this.lock) {
        await this.lock.release();
        this.lock = null;
      }
    } catch {
      this.lock = null;
    }
  },
  on(who) { this.want.add(who); this.sync(); },
  off(who) { this.want.delete(who); this.sync(); },
};

// ---------- ingesta ----------
// Cada fotograma se decodifica UNA vez (0.0.1a lo hacía tres veces: almacén, id, receptor).
function ingestBytes(bytes, src, { persist = true } = {}) {
  let f;
  try {
    f = decodeFrame(bytes);
  } catch {
    counters.bad++;
    return { st: 'invalid', e: null };
  }
  const { st, vid } = store.addParsed(f, bytes);
  if (st === 'dup') {
    counters.dup++;
    return { st, e: entries.get(vid) || null };
  }
  if (persist) db.put(keyOf(vid, f.seed), bytes);
  let e = entries.get(vid);
  if (!e) {
    e = { vid, sid: vid.slice(0, 32), rx: new Receiver(), src, num: ++seq, plain: null };
    entries.set(vid, e);
  }
  const wasDone = e.rx.complete;
  const r = e.rx.addFrame(f);
  active = vid;
  return { st: r === 'done' && !wasDone ? 'done' : 'new', e };
}

function ingestTexts(texts, src) {
  let fresh = 0;
  const done = [];
  for (const t of texts) {
    if (recent.has(t)) continue;
    recent.add(t);
    if (recent.size > 512) recent.delete(recent.values().next().value);
    let bytes;
    try {
      bytes = textToFrame(t);
    } catch {
      counters.bad++;
      continue;
    }
    const { st, e } = ingestBytes(bytes, src);
    if (st === 'new' || st === 'done') fresh++;
    if (st === 'done') done.push(e);
  }
  if (fresh) {
    scheduleRender();
    scheduleMap();
  }
  return { fresh, done };
}

function forgetEntry(vid) {
  const s = store.sessions.get(vid);
  if (s) for (const seed of s.frames.keys()) db.del(keyOf(vid, seed));
  store.remove(vid);
  entries.delete(vid);
  rows.get(vid)?.remove();
  rows.delete(vid);
  if (active === vid) active = null;
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

// ---------- mapa de fragmentos ----------
function sizeCanvas(c) {
  const w = Math.max(64, Math.round(c.clientWidth * Math.min(2, devicePixelRatio || 1)));
  if (c.width !== w) c.width = w;
}

function paintMap(canvas, e) {
  if (!e || !e.rx.dec) return;
  sizeCanvas(canvas);
  const locked = e.rx.complete && !e.plain;
  drawFragmentMap(canvas, e.rx.dec.solved, e.rx.K, {
    on: locked ? FMAP.lockOn : FMAP.on, off: FMAP.off, bg: FMAP.bg,
  });
}

function scheduleMap() {
  if (mapQueued) return;
  mapQueued = true;
  requestAnimationFrame(() => {
    mapQueued = false;
    const e = active && entries.get(active);
    if (e && $('v-scan').classList.contains('active')) {
      $('scan-map-box').hidden = false;
      $('scan-map-title').textContent = `${pad(e.num)} ${title(e)}`;
      $('scan-map-count').textContent = `${solved(e)}/${e.rx.K} · ${Math.round(e.rx.progress * 100)} %`;
      paintMap($('scan-map'), e);
    }
    if (current && $('detail').open) {
      const d = entries.get(current);
      if (d) {
        $('d-solved').textContent = solved(d);
        $('d-frames').textContent = store.count(current);
        paintMap($('d-map'), d);
      }
    }
  });
}

// ---------- cámara ----------
let hitTimer = null;
const scanner = new Scanner($('cam'), (texts) => {
  const { fresh, done } = ingestTexts(texts, 'QR');
  if (fresh) {
    $('scanner').classList.add('hit');
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => $('scanner').classList.remove('hit'), 140);
  }
  for (const e of done) {
    log(`${pad(e.num)} completo · ${e.rx.K} bloques`, 'ok');
    toast(`${pad(e.num)} completo: ábrelo en dex para descifrar`, 'ok');
    navigator.vibrate?.([30, 40, 30]);
  }
}, (s) => {
  const engine = s.engine === 'native' ? 'nativo' : s.engine === 'main' ? 'jsqr·hilo' : `jsqr×${s.workers}`;
  const hint = s.closer ? ' · acerca la cámara' : '';
  $('hud').textContent = `${engine} · ${s.fps.toFixed(0)} an/s · ${s.ms.toFixed(0)} ms · ${s.codesPerSec.toFixed(1)} qr/s${s.ppm ? ` · ${s.ppm.toFixed(1)} px/mód` : ''}${s.roi ? ' · roi' : ''}${hint}`;
  $('hud').classList.toggle('warn', !!s.closer);
});

function stopCamera() {
  scanner.stop();
  wake.off('scan');
  $('scanner').classList.remove('live');
  $('cam-stop').hidden = true;
  $('torch-btn').hidden = true;
  $('hud').textContent = 'cámara apagada';
}

async function startCamera() {
  try {
    $('hud').textContent = 'abriendo cámara…';
    await scanner.start();
    wake.on('scan');
    $('scanner').classList.add('live');
    $('cam-stop').hidden = false;
    $('torch-btn').hidden = !scanner.hasTorch;
    $('hud').textContent = 'buscando QR…';
    log('cámara activa', 'ok');
  } catch (e) {
    $('hud').textContent = 'cámara apagada';
    const msg = e?.name === 'NotAllowedError' ? 'Permiso de cámara denegado. Actívalo en los ajustes del sitio.' : e?.message || 'No se pudo abrir la cámara';
    toast(msg, 'err');
    log(msg, 'err');
  }
}

$('cam-btn').addEventListener('click', startCamera);
$('cam-stop').addEventListener('click', stopCamera);
$('torch-btn').addEventListener('click', async () => {
  const on = $('torch-btn').getAttribute('aria-pressed') !== 'true';
  try {
    if (await scanner.setTorch(on)) $('torch-btn').setAttribute('aria-pressed', String(on));
  } catch {
    toast('Linterna no disponible', 'warn');
  }
});

// ---------- importación ----------
async function importFiles(files) {
  for (const f of files) {
    try {
      if (/\.szb$/i.test(f.name)) {
        const frames = decodeBag(new Uint8Array(await f.arrayBuffer()));
        let fresh = 0;
        for (const fr of frames) {
          const { st } = ingestBytes(fr, 'BOLSA');
          if (st === 'new' || st === 'done') fresh++;
        }
        log(`${f.name}: bolsa · ${frames.length} fragmentos, ${fresh} nuevos`, 'ok');
        continue;
      }
      const t0 = performance.now();
      const r = await codesFromFile(f, (n) => { $('imp-state').textContent = `· ${f.name} · fotograma ${n}`; });
      const { fresh, done } = ingestTexts(r.texts, r.kind);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      if (!r.texts.length) log(`${f.name}: sin QR legibles (${r.frames} fotograma(s))`, 'warn');
      else log(`${f.name}: ${r.frames} fotograma(s), ${r.texts.length} QR, ${fresh} nuevos · ${secs} s`, 'ok');
      if (done.length) toast(`${done.length} envío(s) completo(s)`, 'ok');
    } catch (e) {
      log(`${f.name}: ${e.message}`, 'err');
    }
  }
  $('imp-state').textContent = '';
  scheduleRender();
  scheduleMap();
}

$('imp-btn').addEventListener('click', () => $('imp-input').click());
$('imp-input').accept = 'image/*,.szb';
$('imp-input').addEventListener('change', (ev) => {
  const files = [...ev.target.files];
  ev.target.value = '';
  if (files.length) importFiles(files);
});

function wireDrop(zone, onFiles, onClick) {
  for (const type of ['dragenter', 'dragover']) {
    zone.addEventListener(type, (ev) => { ev.preventDefault(); zone.classList.add('over'); });
  }
  for (const type of ['dragleave', 'drop']) {
    zone.addEventListener(type, (ev) => { ev.preventDefault(); zone.classList.remove('over'); });
  }
  zone.addEventListener('drop', (ev) => {
    const files = [...(ev.dataTransfer?.files || [])];
    if (files.length) onFiles(files);
  });
  zone.addEventListener('click', onClick);
  zone.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      onClick();
    }
  });
}
wireDrop($('drop'), importFiles, () => $('imp-input').click());

$('paste-btn').addEventListener('click', () => {
  const text = $('paste-text').value.trim();
  recent.delete(text);
  const { fresh } = ingestTexts([text], 'TEXTO');
  if (!fresh) {
    toast('Ese texto no es un fotograma SHUMZU nuevo', 'err');
    return;
  }
  log('fotograma pegado', 'ok');
  $('paste-text').value = '';
});

// ---------- dex ----------
function render() {
  renderStats();
  renderList();
}

function renderStats() {
  let done = 0;
  for (const e of entries.values()) if (e.rx.complete) done++;
  $('st-entries').textContent = entries.size;
  $('st-done').textContent = done;
  $('st-frames').textContent = store.total;
  $('dex-summary').textContent = entries.size
    ? `${entries.size} envío(s) · ${done} completo(s) · ${store.total} fragmentos guardados${counters.bad ? ` · ${counters.bad} ilegibles` : ''}`
    : '';
}

function stateOf(e) {
  if (e.plain) return 'done';
  if (e.rx.complete) return 'locked';
  return 'open';
}

// Las variantes de una misma sesión (≠) indican fotogramas dañados o manipulados.
function variantCount(sid) {
  let n = 0;
  for (const e of entries.values()) if (e.sid === sid) n++;
  return n;
}

function rowFor(e) {
  let li = rows.get(e.vid);
  if (!li) {
    const vid = e.vid;
    const btn = el('button', { type: 'button' },
      el('span', { class: 'n' }), el('span', { class: 'src' }), el('span', { class: 'name' }),
      el('span', { class: 'pct' }), el('span', { class: 'bar' }, el('i')), el('span', { class: 'cnt' }));
    btn.addEventListener('click', () => openDetail(vid));
    li = el('li', {}, btn);
    rows.set(vid, li);
  }
  const b = li.firstChild;
  const st = stateOf(e);
  const pct = Math.round(e.rx.progress * 100);
  b.className = `${st}${variantCount(e.sid) > 1 ? ' variant' : ''}`;
  b.children[0].textContent = pad(e.num);
  b.children[1].textContent = e.src.toLowerCase();
  b.children[2].textContent = title(e);
  b.children[3].textContent = st === 'locked' ? 'clave' : `${pct}%`;
  b.children[4].firstChild.style.width = pct + '%';
  b.children[5].textContent = `${solved(e)}/${e.rx.K}`;
  b.setAttribute('aria-label', `${pad(e.num)} ${title(e)}, ${st === 'done' ? 'descifrado' : st === 'locked' ? 'completo, falta la clave' : pct + ' por ciento'}`);
  return li;
}

function renderList() {
  const q = $('dex-filter').value.trim().toLowerCase();
  const list = [...entries.values()]
    .filter((e) => !q || title(e).toLowerCase().includes(q) || e.sid.includes(q))
    .sort((a, b) => b.num - a.num);
  for (const vid of [...rows.keys()]) {
    if (!entries.has(vid)) {
      rows.get(vid).remove();
      rows.delete(vid);
    }
  }
  $('dex-list').replaceChildren(...list.map(rowFor));
  $('dex-empty').hidden = entries.size > 0;
  $('dex-bag').disabled = store.total === 0;
}

$('dex-filter').addEventListener('input', scheduleRender);
$('dex-bag').addEventListener('click', () => {
  const frames = store.allFrames();
  if (frames.length) download(encodeBag(frames), 'shumzu-relevo.szb');
});
for (const b of document.querySelectorAll('[data-goto]')) b.addEventListener('click', () => show(b.dataset.goto));

// ---------- detalle ----------
function openDetail(vid) {
  const e = entries.get(vid);
  if (!e) return;
  current = vid;
  $('d-num').textContent = pad(e.num);
  $('d-src').textContent = e.src.toLowerCase();
  $('d-sid').textContent = e.sid + (variantCount(e.sid) > 1 ? `  (variante K=${e.rx.K})` : '');
  $('d-k').textContent = e.rx.K;
  $('d-frames').textContent = store.count(vid);
  $('d-err').hidden = true;
  $('d-pass').value = '';
  renderDetail(e);
  $('detail').showModal();
  requestAnimationFrame(() => paintMap($('d-map'), e));
}

function renderDetail(e) {
  const missing = e.rx.K - solved(e);
  $('d-title').textContent = title(e);
  $('d-solved').textContent = solved(e);
  $('d-lock').hidden = !e.rx.complete || !!e.plain;
  $('d-hint').textContent = e.plain
    ? 'Descifrado y verificado con SHA-256. El contenido solo existe en esta pestaña.'
    : e.rx.complete
      ? 'Envío completo. Escribe la clave para descifrarlo.'
      : `Faltan ${missing} bloque(s). Sigue escaneando o importa otro GIF o bolsa de este envío.`;
  revokePreview();
  $('d-files').replaceChildren();
  $('d-files').hidden = true;
  if (!e.plain) return;
  if (e.plain.files) renderFileList(e.plain);
  else renderPreview(e.plain);
}

function revokePreview() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  $('d-preview').replaceChildren();
}

const SAFE_IMG = /^image\/(png|jpeg|gif|webp|avif|bmp)$/;

function kindOf(p) {
  const m = (p.mime || '').toLowerCase();
  if (SAFE_IMG.test(m)) return 'image';
  if (/^audio\//.test(m)) return 'audio';
  if (/^video\//.test(m)) return 'video';
  if (m === 'application/pdf') return 'pdf';
  const head = p.data.subarray(0, 4096);
  const textual = m.startsWith('text/') || m === 'application/json' || /\.(txt|md|csv|json|log|ini|xml|yml|yaml)$/i.test(p.name);
  if (textual && !head.includes(0)) return 'text';
  return 'binary';
}

function hexdump(bytes) {
  const lines = [];
  const n = Math.min(bytes.length, 512);
  for (let i = 0; i < n; i += 16) {
    const chunk = bytes.subarray(i, i + 16);
    const hex = [...chunk].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const asc = [...chunk].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('');
    lines.push(i.toString(16).padStart(6, '0') + '  ' + hex.padEnd(47) + '  ' + asc);
  }
  return lines.join('\n') + (bytes.length > n ? '\n…' : '');
}

function renderPreview(p, { withSave = true } = {}) {
  revokePreview();
  const box = $('d-preview');
  const kind = kindOf(p);
  const showType = kind === 'image' || kind === 'audio' || kind === 'video' || kind === 'pdf' ? p.mime : 'application/octet-stream';
  previewUrl = URL.createObjectURL(new Blob([p.data], { type: showType }));
  box.append(el('span', { class: 'verified' }, `✓ ${p.name} · ${fmtBytes(p.data.length)}`));
  if (kind === 'image') box.append(el('img', { src: previewUrl, alt: p.name }));
  else if (kind === 'audio') box.append(el('audio', { src: previewUrl, controls: '' }));
  else if (kind === 'video') box.append(el('video', { src: previewUrl, controls: '', playsinline: '' }));
  else if (kind === 'pdf') box.append(el('iframe', { src: previewUrl, title: p.name }));
  else if (kind === 'text') {
    const limit = 200000;
    box.append(el('pre', {}, new TextDecoder().decode(p.data.subarray(0, limit))));
    if (p.data.length > limit) box.append(el('p', { class: 'dim small' }, 'Mostrando los primeros 200 KB.'));
  } else {
    box.append(el('pre', { class: 'hexprev' }, hexdump(p.data)));
  }
  if (withSave) {
    const save = el('button', { class: 'btn primary', type: 'button' }, `guardar ${safeName(p.name)}`);
    save.addEventListener('click', () => download(p.data, safeName(p.name), p.mime || 'application/octet-stream'));
    box.append(el('div', { class: 'row' }, save));
  }
}

function renderFileList(plain) {
  const box = $('d-files');
  const ul = el('ul');
  const total = plain.files.reduce((s, f) => s + f.data.length, 0);
  for (const f of plain.files) {
    const view = el('button', { class: 'btn ghost', type: 'button' }, 'ver');
    const save = el('button', { class: 'btn', type: 'button' }, 'guardar');
    view.addEventListener('click', () => renderPreview(f, { withSave: false }));
    save.addEventListener('click', () => download(f.data, safeName(f.name), f.mime || 'application/octet-stream'));
    ul.append(el('li', {}, el('span', {}, f.name), view, save, el('small', {}, fmtBytes(f.data.length))));
  }
  const all = el('button', { class: 'btn primary', type: 'button' }, `guardar todo (.zip · ${fmtBytes(total)})`);
  all.addEventListener('click', () => {
    const zip = zipStore(plain.files.map((f) => ({ name: safeName(f.name), data: f.data })));
    download(zip, `shumzu-${current ? current.slice(0, 8) : 'paquete'}.zip`, 'application/zip');
  });
  box.append(el('p', { class: 'verified' }, `✓ SHA-256 verificado · ${plain.files.length} archivos · ${fmtBytes(total)}`), ul, all);
  box.hidden = false;
}

$('detail').addEventListener('close', () => {
  revokePreview();
  current = null;
});

$('d-decrypt').addEventListener('click', async () => {
  const e = current && entries.get(current);
  if (!e) return;
  const pass = $('d-pass').value;
  if (!pass) {
    $('d-err').textContent = 'Escribe la clave del envío.';
    $('d-err').hidden = false;
    return;
  }
  const btn = $('d-decrypt');
  btn.disabled = true;
  btn.textContent = 'descifrando…';
  try {
    const out = await e.rx.assemble(pass);
    if (out.mime === PACK_MIME) out.files = unpackFiles(out.data);
    e.plain = out;
    $('d-pass').value = '';
    $('d-err').hidden = true;
    renderDetail(e);
    paintMap($('d-map'), e);
    scheduleRender();
    toast(`${out.name} verificado`, 'ok');
  } catch (err) {
    $('d-err').textContent = err.message;
    $('d-err').hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'descifrar';
  }
});
$('d-pass').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    $('d-decrypt').click();
  }
});

$('d-bag').addEventListener('click', () => {
  if (!current) return;
  const frames = store.framesOf(current);
  if (frames.length) download(encodeBag(frames), `${current.slice(0, 8)}.szb`);
});

$('d-del').addEventListener('click', () => {
  if (!current) return;
  if (!confirm('¿Borrar esta entrada y sus fragmentos de este dispositivo?')) return;
  forgetEntry(current);
  $('detail').close();
  scheduleRender();
  toast('Entrada borrada', 'ok');
});

// ---------- envío ----------
let sendFiles = [];
let prep = null;
let fileName = '';
let idx = 0;
let playing = true;
let sizeChoice = DEFAULT_S;
let perScreen = 2;
let tickTimer = null;
let sendStart = 0;
const sCanvas = $('s-canvas');
const fps = () => Number($('s-speed').value);
const sendActive = () => $('v-send').classList.contains('active') && !document.hidden;

// Selector de tamaño de QR a partir de los presets medidos.
for (const p of SIZE_PRESETS) {
  const b = el('button', { type: 'button', role: 'radio', 'data-s': String(p.S), 'aria-checked': String(p.S === sizeChoice), title: `${p.S} B por QR · ${p.label}` },
    p.label.split(' · ')[0]);
  if (p.S === sizeChoice) b.classList.add('on');
  $('s-size').append(b);
}

function segPick(group, btn) {
  for (const x of group.children) {
    const on = x === btn;
    x.classList.toggle('on', on);
    x.setAttribute('aria-checked', String(on));
  }
}

$('s-size').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-s]');
  if (!b) return;
  sizeChoice = Number(b.dataset.s);
  segPick($('s-size'), b);
  updateEstimate();
});

$('s-mosaic').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-n]');
  if (!b) return;
  perScreen = Number(b.dataset.n);
  segPick($('s-mosaic'), b);
  updateEstimate();
  if (prep) showFrame();
});

function setSendFiles(files) {
  sendFiles = files;
  const ul = $('s-files');
  ul.replaceChildren(...files.map((f) => el('li', {}, el('span', {}, f.name), el('span', {}, fmtBytes(f.size)))));
  const total = files.reduce((s, f) => s + f.size, 0);
  $('s-fname').textContent = files.length
    ? `${files.length} archivo(s) · ${fmtBytes(total)} · tocar para cambiar`
    : 'elige o suelta archivos · máx. 32 MB en total';
  updateEstimate();
}

// Estimación previa: el tamaño final depende de la compresión, así que es una cota superior.
function updateEstimate() {
  const S = prep ? prep.S : sizeChoice;
  const n = perScreen;
  if (prep) {
    $('s-est').replaceChildren('emitiendo ', el('b', {}, `${prep.K} bloques`), ` · mínimo ${fmtTime(minSeconds(prep.K, fps(), n))} a ${fps()} fps × ${n} QR`);
    $('k-min').textContent = fmtTime(minSeconds(prep.K, fps(), n));
    return;
  }
  const total = sendFiles.reduce((s, f) => s + f.size, 0);
  if (!total) {
    $('s-est').textContent = '';
    return;
  }
  const K = Math.ceil((total + 200 + 16) / S);
  const t = minSeconds(K, fps(), n);
  $('s-est').replaceChildren('≤ ', el('b', {}, `${K} bloques`), ` · mínimo ≈ ${fmtTime(t)} a ${fps()} fps × ${n} QR (menos si comprime)`);
}

$('s-file').addEventListener('change', (ev) => setSendFiles([...ev.target.files]));
wireDrop($('send-drop'), (files) => setSendFiles(files), () => $('s-file').click());

$('s-eye').addEventListener('click', () => {
  const p = $('s-pass');
  const show = p.type === 'password';
  p.type = show ? 'text' : 'password';
  $('s-eye').textContent = show ? 'ocultar' : 'ver';
  $('s-eye').setAttribute('aria-pressed', String(show));
});

function showSendErr(msg) {
  $('s-err').textContent = msg;
  $('s-err').hidden = false;
}

// Recompresión opcional de fotos a WebP: solo JPEG/PNG, solo si el resultado es menor.
async function toWebp(file) {
  if (!/^image\/(jpeg|png)$/.test(file.type)) return null;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.8));
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return null;
    return { name: file.name.replace(/\.(jpe?g|png)$/i, '') + '.webp', mime: 'image/webp', data: new Uint8Array(await blob.arrayBuffer()) };
  } catch {
    return null;
  }
}

$('s-go').addEventListener('click', async () => {
  $('s-err').hidden = true;
  const pass = $('s-pass').value;
  if (!sendFiles.length) return showSendErr('Elige al menos un archivo.');
  const total = sendFiles.reduce((s, f) => s + f.size, 0);
  if (total > MAX_FILE_BYTES) return showSendErr(`Los archivos suman ${fmtBytes(total)}; el máximo es ${fmtBytes(MAX_FILE_BYTES)}.`);
  if (pass.length < MIN_PASSWORD) return showSendErr(`La clave debe tener al menos ${MIN_PASSWORD} caracteres.`);

  const btn = $('s-go');
  btn.disabled = true;
  btn.textContent = 'preparando…';
  try {
    const webp = $('s-webp').checked;
    let saved = 0;
    const items = [];
    for (const f of sendFiles) {
      const w = webp ? await toWebp(f) : null;
      if (w) {
        saved += f.size - w.data.length;
        items.push(w);
      } else {
        items.push({ name: f.name, mime: f.type, data: new Uint8Array(await f.arrayBuffer()) });
      }
    }
    const one = items.length === 1;
    const payload = one ? items[0] : { name: `${items.length} archivos.szpk`, mime: PACK_MIME, data: packFiles(items) };
    await nextFrame();
    prep = await prepareBytes(payload, pass, { S: sizeChoice });
    fileName = payload.name;
    $('s-pass').value = '';
    idx = 0;
    playing = true;
    sendStart = performance.now();
    $('s-play').textContent = 'pausa';
    $('k-k').textContent = prep.K;
    $('s-form').hidden = true;
    $('s-out').hidden = false;
    $('s-gif').disabled = leanCount(prep) > GIF_MAX_FRAMES;
    $('s-gif').title = $('s-gif').disabled ? `Más de ${GIF_MAX_FRAMES} fotogramas: usa la bolsa .szb` : '';
    updateEstimate();
    showFrame();
    startTick();
    wake.on('send');
    toast(`${prep.K} bloques listos${saved > 0 ? ` · WebP ahorró ${fmtBytes(saved)}` : ''}`, 'ok');
  } catch (e) {
    showSendErr(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'preparar envío';
  }
});

function stageTarget() {
  const stage = $('s-stage');
  const dpr = Math.min(3, devicePixelRatio || 1);
  const full = document.fullscreenElement === stage;
  const w = full ? Math.min(innerWidth, innerHeight * (perScreen === 2 ? 0.5 : 1)) : stage.clientWidth || 340;
  return Math.max(200, Math.round(w * dpr));
}

function textsAt(i) {
  const out = [];
  for (let k = 0; k < perScreen; k++) out.push(frameToText(frameAt(prep, i + k)));
  return out;
}

function showFrame() {
  renderMosaic(sCanvas, textsAt(idx), { cols: perScreen === 4 ? 2 : 1, target: stageTarget() });
  $('k-seed').textContent = idx;
  $('k-t').textContent = fmtTime((performance.now() - sendStart) / 1000);
  prefetchNext();
}

// Calcula las matrices de la pantalla siguiente en tiempo ocioso: el cambio es instantáneo.
function prefetchNext() {
  const p = prep;
  const i = idx + perScreen;
  const n = perScreen;
  const job = () => {
    if (p !== prep) return;
    for (let k = 0; k < n; k++) matrixOf(frameToText(frameAt(p, i + k)));
  };
  if ('requestIdleCallback' in window) requestIdleCallback(job, { timeout: 300 });
  else setTimeout(job, 0);
}

function stopTick() {
  clearTimeout(tickTimer);
  tickTimer = null;
}

function runTick() {
  tickTimer = null;
  if (!prep || !playing || !sendActive()) return;
  idx += perScreen;
  showFrame();
  tickTimer = setTimeout(runTick, 1000 / fps());
}

function startTick() {
  stopTick();
  if (prep && playing && sendActive()) tickTimer = setTimeout(runTick, 1000 / fps());
}

$('s-play').addEventListener('click', () => {
  playing = !playing;
  $('s-play').textContent = playing ? 'pausa' : 'reanudar';
  if (playing) wake.on('send');
  else wake.off('send');
  startTick();
});

$('s-speed').addEventListener('input', () => {
  $('s-fps-label').textContent = fps();
  updateEstimate();
  startTick();
});

$('s-full').addEventListener('click', async () => {
  const stage = $('s-stage');
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await stage.requestFullscreen();
  } catch {
    toast('Pantalla completa no disponible', 'warn');
  }
});
document.addEventListener('fullscreenchange', () => { if (prep) showFrame(); });

$('s-new').addEventListener('click', () => {
  prep = null;
  stopTick();
  wake.off('send');
  $('s-out').hidden = true;
  $('s-form').hidden = false;
  updateEstimate();
});

$('s-gif').addEventListener('click', async () => {
  if (!prep) return;
  const btn = $('s-gif');
  btn.disabled = true;
  btn.textContent = 'generando…';
  try {
    await nextFrame();
    const n = leanCount(prep);
    const texts = Array.from({ length: n }, (_, i) => frameToText(frameAt(prep, i)));
    const bytes = qrGifBytes(texts, qrMake, { px: 4, quiet: 4, delayCs: Math.max(2, Math.round(100 / fps())) });
    download(bytes, `${safeName(fileName)}.gif`, 'image/gif');
    toast(`GIF · ${n} fotogramas · ${fmtBytes(bytes.length)}`, 'ok');
  } catch (e) {
    toast(e.message || 'No se pudo generar el GIF', 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'GIF';
  }
});

$('s-bag').addEventListener('click', () => {
  if (!prep) return;
  const frames = Array.from({ length: leanCount(prep) }, (_, i) => frameAt(prep, i));
  download(encodeBag(frames), `${safeName(fileName)}.szb`);
});

// ---------- navegación ----------
function show(view) {
  for (const b of document.querySelectorAll('.tabs .tab')) {
    const on = b.dataset.view === view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  }
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('active', v.id === view);
  if (view !== 'v-scan' && scanner.running) stopCamera();
  if (view === 'v-dex') scheduleRender();
  if (view === 'v-scan') scheduleMap();
  if (view === 'v-send') startTick();
  else stopTick();
}

for (const btn of document.querySelectorAll('.tabs .tab')) btn.addEventListener('click', () => show(btn.dataset.view));

document.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey || ev.metaKey || ev.altKey || isTyping() || $('detail').open) return;
  const v = { 1: 'v-dex', 2: 'v-scan', 3: 'v-send' }[ev.key];
  if (v) show(v);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopTick();
  else startTick();
  wake.sync();
});

addEventListener('resize', () => scheduleMap());

function updateConn() {
  const on = navigator.onLine;
  $('conn').textContent = on ? 'local' : 'sin red';
  $('conn').dataset.online = String(on);
  $('conn').title = 'Todo ocurre en este dispositivo; la red no se usa para transferir.';
}
addEventListener('online', updateConn);
addEventListener('offline', updateConn);

// ---------- persistencia y arranque ----------
function readLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw ? decodeBag(fromB64(raw)) : null;
  } catch {
    localStorage.removeItem(LEGACY_KEY);
    return null;
  }
}

async function boot() {
  db.onError = () => toast('No se pudo guardar en este navegador (¿cuota llena?)', 'err');
  const persistent = await db.init();
  if (persistent) {
    // 0.0.1a: base64 en localStorage -> IndexedDB (una vez).
    const legacy = readLegacy();
    if (legacy) {
      for (const f of legacy) ingestBytes(f, 'LOCAL');
      try {
        await db.flush();
        localStorage.removeItem(LEGACY_KEY);
      } catch {
        // se conserva para el siguiente arranque
      }
    }
    try {
      // 0.1.0 guardaba «sid:seed»; ahora la clave es «variante:seed». Se migra al vuelo.
      let migrated = 0;
      for (const { key, bytes } of await db.loadEntries()) {
        const { st } = ingestBytes(bytes, 'LOCAL', { persist: false });
        if (st === 'invalid') continue;
        const f = decodeFrame(bytes);
        const want = keyOf(variantKey(f), f.seed);
        if (key !== want) {
          db.put(want, bytes);
          db.del(key);
          migrated++;
        }
      }
      if (migrated) await db.flush();
    } catch {
      toast('No se pudieron leer las capturas guardadas', 'err');
    }
  } else {
    toast('Este navegador no guarda en disco: las capturas se pierden al cerrar', 'warn');
    for (const f of readLegacy() || []) ingestBytes(f, 'LOCAL', { persist: false });
  }
  navigator.storage?.persist?.().catch(() => {});
  render();
}

updateConn();
show('v-dex');
boot();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
