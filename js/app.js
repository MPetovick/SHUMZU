// SHUMZU v0.1.0 · controlador de la interfaz.
// Todo texto que venga de fuera (nombres de archivo, contenido) se inserta con textContent.
//
// Rendimiento:
// - La Pokédex actualiza las tarjetas por clave (sesión) en vez de reconstruir el DOM.
// - Las escrituras van a IndexedDB por fotograma, no como base64 completo.
// - El carrusel dibuja con matrices cacheadas y precalienta el siguiente fotograma
//   en tiempo ocioso; se detiene fuera de la vista de envío o con la pestaña oculta.
// - Los renders se agrupan en un solo frame de animación.
import {
  prepareBytes, frameAt, frameToText, textToFrame, Receiver, recommendedCount,
  MIN_PASSWORD, MAX_FILE_BYTES,
} from './core/codec.js';
import { encodeBag, decodeBag, FrameStore } from './core/bag.js';
import { decodeFrame, toHex } from './core/format.js';
import { qrGifBytes, qrMake } from './core/qrgif.js';
import { renderFrame, matrixOf, Scanner } from './visual.js';
import { codesFromFile } from './scan.js';
import { FrameDB } from './store.js';

const $ = (id) => document.getElementById(id);
const LEGACY_KEY = 'shumzu.v1.frames';
const TYPE_CLASS = { QR: 't-qr', GIF: 't-gif', IMG: 't-img', LOCAL: 't-local', PEGADO: 't-paste' };

// ---------- estado ----------
const store = new FrameStore();          // fotogramas, deduplicados por (sesión, seed)
const db = new FrameDB();                // persistencia por fotograma
const entries = new Map();               // sid -> { sid, rx, src, num, plain }
const cards = new Map();                 // sid -> nodo de tarjeta (reutilizado)
let seq = 0;
let frameCount = 0;
const counters = { bad: 0, dup: 0 };
let current = null;                      // sid abierto en el diálogo
let previewUrl = null;
let renderQueued = false;
let lastScan = '';

// ---------- utilidades ----------
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else n.setAttribute(k, v);
  }
  for (const c of kids) n.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
}

const keyOf = (sid, seed) => `${sid}:${seed}`;
const safeName = (s) => (s || 'archivo').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').slice(0, 120) || 'archivo';
const fmtBytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB');
const pad = (n) => '#' + String(n).padStart(3, '0');
const title = (e) => (e.plain ? e.plain.name : 'Sesión ' + e.sid.slice(0, 8).toUpperCase());
const solved = (e) => (e.rx.dec ? e.rx.dec.solvedCount : 0);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

function toast(msg, tone = '') {
  const t = $('toast');
  t.textContent = msg;
  t.dataset.tone = tone;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2400);
}

function log(msg, tone = '') {
  const time = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const list = $('log');
  list.prepend(el('li', { class: tone }, el('time', {}, time), el('span', {}, msg)));
  while (list.children.length > 80) list.lastChild.remove();
}

function download(bytes, name, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(str) {
  const bin = atob(str);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// ---------- captura ----------
// Un fotograma nuevo entra en el almacén, en el receptor de su sesión y (opcional) en disco.
function ingestBytes(bytes, src, { persist = true } = {}) {
  const st = store.add(bytes);
  if (st === 'dup') counters.dup++;
  if (st === 'invalid') counters.bad++;
  if (st !== 'new') return { st, e: null };
  frameCount++;
  const f = decodeFrame(bytes);
  const sid = toHex(f.session);
  if (persist) db.put(keyOf(sid, f.seed), bytes.slice());
  let e = entries.get(sid);
  if (!e) {
    e = { sid, rx: new Receiver(), src, num: ++seq, plain: null };
    entries.set(sid, e);
  }
  const r = e.rx.add(bytes);
  return { st: r === 'done' ? 'done' : 'new', e };
}

function ingestText(text, src) {
  let bytes;
  try {
    bytes = textToFrame(text);
  } catch {
    counters.bad++;
    return { st: 'invalid', e: null };
  }
  return ingestBytes(bytes, src);
}

// Borra una sesión de memoria y de disco.
function forgetSession(sid) {
  for (const f of store.framesOf(sid)) {
    db.del(keyOf(sid, decodeFrame(f).seed));
    frameCount--;
  }
  store.remove(sid);
  entries.delete(sid);
  cards.get(sid)?.remove();
  cards.delete(sid);
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

async function importFiles(files) {
  for (const f of files) {
    try {
      const r = await codesFromFile(f, (n) => { $('imp-state').textContent = `${f.name} · fotograma ${n}`; });
      let nuevos = 0;
      let completas = 0;
      for (const t of r.texts) {
        const { st } = ingestText(t, r.kind);
        if (st === 'new' || st === 'done') nuevos++;
        if (st === 'done') completas++;
      }
      if (!r.texts.length) log(`${f.name}: sin QR legibles (${r.frames} fotograma(s))`, 'warn');
      else log(`${f.name}: ${r.frames} fotograma(s), ${r.texts.length} QR, ${nuevos} nuevos`, 'ok');
      if (completas) toast(`${completas} envío(s) completo(s)`, 'ok');
    } catch (e) {
      log(`${f.name}: ${e.message}`, 'err');
    }
  }
  $('imp-state').textContent = '';
  scheduleRender();
}

// ---------- cámara ----------
const scanner = new Scanner($('cam'), (text) => {
  if (text === lastScan) return; // el mismo código sigue en cámara: no reprocesar
  lastScan = text;
  const { st, e } = ingestText(text, 'QR');
  if (st === 'new' || st === 'done') {
    log(`${pad(e.num)} · ${solved(e)}/${e.rx.K} símbolos`, 'ok');
    if (st === 'done') toast(`${pad(e.num)} completo`, 'ok');
    scheduleRender();
  }
  $('scan-state').textContent = `Escaneando · ${frameCount} fotogramas`;
});

function stopCamera() {
  scanner.stop();
  $('scanner').classList.remove('live');
  $('cam-btn').textContent = 'Activar cámara';
  $('scan-state').textContent = 'Cámara apagada';
}

$('cam-btn').addEventListener('click', async () => {
  if (scanner.running) return stopCamera();
  try {
    await scanner.start();
    $('scanner').classList.add('live');
    $('cam-btn').textContent = 'Detener cámara';
    $('scan-state').textContent = 'Escaneando…';
  } catch (e) {
    toast(e.message || 'No se pudo abrir la cámara', 'err');
  }
});

$('imp-btn').addEventListener('click', () => $('imp-input').click());
$('imp-input').addEventListener('change', (ev) => {
  const files = [...ev.target.files];
  ev.target.value = '';
  if (files.length) importFiles(files);
});

const drop = $('drop');
for (const type of ['dragenter', 'dragover']) {
  drop.addEventListener(type, (ev) => { ev.preventDefault(); drop.classList.add('over'); });
}
for (const type of ['dragleave', 'drop']) {
  drop.addEventListener(type, (ev) => { ev.preventDefault(); drop.classList.remove('over'); });
}
drop.addEventListener('drop', (ev) => {
  const files = [...(ev.dataTransfer?.files || [])];
  if (files.length) importFiles(files);
});
drop.addEventListener('click', () => $('imp-input').click());
drop.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault();
    $('imp-input').click();
  }
});

$('paste-btn').addEventListener('click', () => {
  const text = $('paste-text').value;
  const { st, e } = ingestText(text, 'PEGADO');
  if (st === 'invalid') {
    toast('Ese texto no es un fotograma SHUMZU', 'err');
    return;
  }
  if (st === 'new' || st === 'done') {
    log(`${pad(e.num)} · pegado · ${solved(e)}/${e.rx.K}`, 'ok');
    $('paste-text').value = '';
    scheduleRender();
  }
});

// ---------- Pokédex ----------
function render() {
  renderStats();
  renderGrid();
}

function renderStats() {
  const all = [...entries.values()];
  $('st-entries').textContent = all.length;
  $('st-done').textContent = all.filter((e) => e.rx.complete).length;
  $('st-frames').textContent = frameCount;
  $('st-open').textContent = all.filter((e) => !e.rx.complete).length;
}

function cardState(e) {
  if (e.plain) return 'done';
  if (e.rx.complete) return 'locked';
  return 'open';
}

// Crea la tarjeta una vez y después solo actualiza sus campos.
function cardFor(e) {
  let c = cards.get(e.sid);
  if (!c) {
    const sid = e.sid;
    c = el('button', { class: 'card', type: 'button' },
      el('div', { class: 'card-top' }, el('span', { class: 'num' }), el('span', { class: 'type' })),
      el('div', { class: 'title' }),
      el('div', { class: 'track' }, el('i')),
      el('div', { class: 'meta' }, el('span'), el('b')));
    c.addEventListener('click', () => openDetail(sid));
    cards.set(sid, c);
  }
  const state = cardState(e);
  const label = state === 'done' ? 'descifrado' : state === 'locked' ? 'listo · falta clave' : 'en curso';
  c.className = `card ${state} ${TYPE_CLASS[e.src] || 't-local'}`;
  c.firstChild.firstChild.textContent = pad(e.num);
  c.firstChild.lastChild.textContent = e.src;
  c.children[1].textContent = title(e);
  c.children[2].firstChild.style.width = Math.round(e.rx.progress * 100) + '%';
  c.children[3].firstChild.textContent = `${solved(e)}/${e.rx.K}`;
  c.children[3].lastChild.textContent = label;
  return c;
}

function renderGrid() {
  const q = $('dex-filter').value.trim().toLowerCase();
  const list = [...entries.values()]
    .filter((e) => !q || title(e).toLowerCase().includes(q) || e.sid.includes(q))
    .sort((a, b) => a.num - b.num);
  // Quita las tarjetas de sesiones que ya no existen.
  for (const sid of [...cards.keys()]) {
    if (!entries.has(sid)) {
      cards.get(sid).remove();
      cards.delete(sid);
    }
  }
  $('dex-grid').replaceChildren(...list.map(cardFor));
  $('dex-empty').hidden = entries.size > 0;
  $('dex-bag').disabled = frameCount === 0;
}

$('dex-filter').addEventListener('input', scheduleRender);
$('dex-bag').addEventListener('click', () => {
  const frames = store.allFrames();
  if (frames.length) download(encodeBag(frames), 'shumzu-relevo.szb');
});

// ---------- detalle y revisión ----------
function openDetail(sid) {
  const e = entries.get(sid);
  if (!e) return;
  current = sid;
  $('d-num').textContent = pad(e.num);
  $('d-src').textContent = e.src;
  $('d-sid').textContent = e.sid;
  $('d-k').textContent = e.rx.K;
  $('d-frames').textContent = store.count(sid);
  $('d-err').hidden = true;
  $('d-pass').value = '';
  renderDetail(e);
  $('detail').showModal();
}

function renderDetail(e) {
  const missing = e.rx.K - solved(e);
  $('d-title').textContent = title(e);
  $('d-solved').textContent = solved(e);
  $('d-bar').style.width = Math.round(e.rx.progress * 100) + '%';
  $('d-lock').hidden = !e.rx.complete || !!e.plain;
  $('d-hint').textContent = e.plain
    ? 'Descifrado y verificado con SHA-256. Solo existe en esta pestaña.'
    : e.rx.complete
      ? 'Envío completo. Introduce la contraseña para revisarlo.'
      : `Faltan ${missing} símbolo(s). Escanea más QR o importa otro GIF de este envío.`;
  if (e.plain) renderPreview(e.plain);
  else revokePreview();
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
  const textual = m.startsWith('text/') || m === 'application/json' || /\.(txt|md|csv|json|log|ini|xml)$/i.test(p.name);
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

function renderPreview(p) {
  revokePreview();
  const box = $('d-preview');
  const kind = kindOf(p);
  const showType = kind === 'image' || kind === 'audio' || kind === 'video' || kind === 'pdf' ? p.mime : 'application/octet-stream';
  previewUrl = URL.createObjectURL(new Blob([p.data], { type: showType }));
  box.append(el('span', { class: 'verified' }, '✓ SHA-256 verificado · ' + fmtBytes(p.data.length)));

  if (kind === 'image') box.append(el('img', { src: previewUrl, alt: p.name }));
  else if (kind === 'audio') box.append(el('audio', { src: previewUrl, controls: '' }));
  else if (kind === 'video') box.append(el('video', { src: previewUrl, controls: '', playsinline: '' }));
  else if (kind === 'pdf') box.append(el('iframe', { src: previewUrl, title: p.name }));
  else if (kind === 'text') {
    const limit = 200000;
    const text = new TextDecoder().decode(p.data.subarray(0, limit));
    box.append(el('pre', { class: 'textprev' }, text));
    if (p.data.length > limit) box.append(el('p', { class: 'hint' }, 'Mostrando los primeros 200 KB.'));
  } else {
    box.append(el('pre', { class: 'hexprev' }, hexdump(p.data)));
  }

  box.append(el('div', { class: 'row' },
    el('a', { class: 'btn-link', href: previewUrl, download: safeName(p.name) },
      el('button', { class: 'primary', type: 'button' }, 'Guardar ' + safeName(p.name)))));
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
    $('d-err').textContent = 'Escribe la contraseña del envío.';
    $('d-err').hidden = false;
    return;
  }
  const btn = $('d-decrypt');
  btn.disabled = true;
  btn.textContent = 'Descifrando…';
  try {
    e.plain = await e.rx.assemble(pass);
    $('d-pass').value = '';
    $('d-err').hidden = true;
    renderDetail(e);
    scheduleRender();
    toast(`${e.plain.name} verificado`, 'ok');
  } catch (err) {
    $('d-err').textContent = err.message;
    $('d-err').hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Descifrar';
  }
});

$('d-bag').addEventListener('click', () => {
  if (!current) return;
  const frames = store.framesOf(current);
  if (frames.length) download(encodeBag(frames), `${current.slice(0, 8)}.szb`);
});

$('d-del').addEventListener('click', () => {
  if (!current) return;
  if (!confirm('¿Borrar esta entrada y sus fotogramas de este dispositivo?')) return;
  forgetSession(current);
  $('detail').close();
  scheduleRender();
  toast('Entrada borrada', 'ok');
});

// ---------- envío ----------
let prep = null;
let fileName = '';
let idx = 0;
let playing = true;
let sizeChoice = 200;
let tickTimer = null;
const sCanvas = $('s-canvas');
const fps = () => Number($('s-speed').value);
const sendActive = () => $('v-send').classList.contains('active') && !document.hidden;

function showFrame() {
  renderFrame(sCanvas, frameToText(frameAt(prep, idx)));
  $('k-t').textContent = Math.ceil(idx / fps()) + ' s';
  prefetchNext();
}

// Calcula la matriz del siguiente fotograma en tiempo ocioso, para que el cambio sea instantáneo.
function prefetchNext() {
  const p = prep;
  const i = idx + 1;
  const job = () => { if (p === prep) matrixOf(frameToText(frameAt(p, i))); };
  if ('requestIdleCallback' in window) requestIdleCallback(job, { timeout: 500 });
  else setTimeout(job, 0);
}

function stopTick() {
  clearTimeout(tickTimer);
  tickTimer = null;
}

function runTick() {
  tickTimer = null;
  if (!prep || !playing || !sendActive()) return;
  idx++;
  showFrame();
  tickTimer = setTimeout(runTick, 1000 / fps());
}

function startTick() {
  stopTick();
  if (prep && playing && sendActive()) tickTimer = setTimeout(runTick, 1000 / fps());
}

$('s-file').addEventListener('change', (ev) => {
  const f = ev.target.files[0];
  $('s-fname').textContent = f ? `${f.name} · ${fmtBytes(f.size)}` : 'Elige o arrastra un archivo (máx. 8 MB)';
});

const sendDrop = $('send-drop');
sendDrop.addEventListener('dragover', (ev) => { ev.preventDefault(); sendDrop.classList.add('over'); });
sendDrop.addEventListener('dragleave', () => sendDrop.classList.remove('over'));
sendDrop.addEventListener('drop', (ev) => {
  ev.preventDefault();
  sendDrop.classList.remove('over');
  const f = ev.dataTransfer?.files?.[0];
  if (f) {
    const input = $('s-file');
    const dt = new DataTransfer();
    dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  }
});

$('s-eye').addEventListener('click', () => {
  const p = $('s-pass');
  p.type = p.type === 'password' ? 'text' : 'password';
  $('s-eye').textContent = p.type === 'password' ? 'Ver' : 'Ocultar';
});

$('s-size').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-s]');
  if (!b) return;
  sizeChoice = Number(b.dataset.s);
  for (const x of $('s-size').children) {
    const on = x === b;
    x.classList.toggle('on', on);
    x.setAttribute('aria-checked', String(on));
  }
});

function showSendErr(msg) {
  $('s-err').textContent = msg;
  $('s-err').hidden = false;
}

$('s-go').addEventListener('click', async () => {
  $('s-err').hidden = true;
  const file = $('s-file').files[0];
  const pass = $('s-pass').value;
  if (!file) return showSendErr('Elige un archivo.');
  if (file.size > MAX_FILE_BYTES) return showSendErr('El archivo supera 8 MB en esta versión.');
  if (pass.length < MIN_PASSWORD) return showSendErr(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);

  const btn = $('s-go');
  btn.disabled = true;
  btn.textContent = 'Preparando…';
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    prep = await prepareBytes({ name: file.name, mime: file.type, data }, pass, { S: sizeChoice });
    fileName = file.name;
    $('s-pass').value = '';
    idx = 0;
    playing = true;
    $('s-play').textContent = 'Pausa';
    $('k-k').textContent = prep.K;
    $('k-f').textContent = recommendedCount(prep);
    $('s-out').hidden = false;
    showFrame();
    startTick();
    toast(`${prep.K} bloques listos`, 'ok');
  } catch (e) {
    showSendErr(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Preparar envío';
  }
});

$('s-play').addEventListener('click', () => {
  playing = !playing;
  $('s-play').textContent = playing ? 'Pausa' : 'Reanudar';
  startTick();
});

$('s-speed').addEventListener('input', () => {
  $('s-fps-label').textContent = fps() + ' fps';
  startTick();
});

$('s-gif').addEventListener('click', async () => {
  if (!prep) return;
  const btn = $('s-gif');
  btn.disabled = true;
  btn.textContent = 'Generando…';
  try {
    await nextFrame();
    const n = recommendedCount(prep);
    const texts = Array.from({ length: n }, (_, i) => frameToText(frameAt(prep, i)));
    const bytes = qrGifBytes(texts, qrMake, { px: 4, quiet: 4, delayCs: Math.round(100 / fps()) });
    download(bytes, `${safeName(fileName)}.gif`, 'image/gif');
    toast(`GIF · ${n} fotogramas · ${fmtBytes(bytes.length)}`, 'ok');
  } catch (e) {
    toast(e.message || 'No se pudo generar el GIF', 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Descargar GIF';
  }
});

$('s-bag').addEventListener('click', () => {
  if (!prep) return;
  const frames = Array.from({ length: recommendedCount(prep) }, (_, i) => frameAt(prep, i));
  download(encodeBag(frames), `${safeName(fileName)}.szb`);
});

// ---------- navegación ----------
function show(view) {
  for (const b of document.querySelectorAll('.dock .tab')) {
    const on = b.dataset.view === view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  }
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('active', v.id === view);
  if (view !== 'v-scan' && scanner.running) stopCamera();
  if (view === 'v-dex') scheduleRender();
  if (view === 'v-send') startTick();
  else stopTick();
}

for (const btn of document.querySelectorAll('.dock .tab')) {
  btn.addEventListener('click', () => show(btn.dataset.view));
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopTick();
  else startTick();
});

function updateConn() {
  const on = navigator.onLine;
  $('conn').textContent = on ? 'Todo local' : 'Sin red · local';
  $('conn').dataset.online = String(on);
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
    // Migración única desde la versión anterior (base64 en localStorage).
    const legacy = readLegacy();
    if (legacy) {
      for (const f of legacy) ingestBytes(f, 'LOCAL');
      try {
        await db.flush();
        localStorage.removeItem(LEGACY_KEY);
      } catch {
        // Si falla, se conserva la clave antigua para el siguiente arranque.
      }
    }
    try {
      for (const f of await db.loadAll()) ingestBytes(f, 'LOCAL', { persist: false });
    } catch {
      toast('No se pudieron leer las capturas guardadas', 'err');
    }
  } else {
    toast('Este navegador no guarda en disco: las capturas se pierden al cerrar', 'err');
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
