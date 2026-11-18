/* SHUMZU · service worker: todo en caché para funcionar sin conexión; avisa de versiones nuevas. */
const VERSION = 'shumzu-0.0.1-436cc3901f';
const FILES = ["./","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","icons/icon.svg","index.html","js/app.js","js/emit.worker.js","js/join.worker.js","js/scan.worker.js","manifest.webmanifest","styles.css","view.html","wasm/raptorq_bg.wasm","wasm/zxing_reader.wasm"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skip') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(r, { ignoreSearch: true }) || (r.mode === 'navigate' ? await c.match('./') : null);
    if (hit) return hit;
    try { return await fetch(r); } catch (err) { return (await c.match('./')) || Response.error(); }
  })());
});
