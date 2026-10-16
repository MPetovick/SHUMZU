// Service worker: la aplicación entera funciona sin red después de la primera visita.
// Estrategia: caché primero para los recursos propios; cualquier cambio se publica
// subiendo CACHE_VERSION (los antiguos se borran en activate).
const CACHE_VERSION = 'shumzu-v0.2.0';

const ASSETS = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/visual.js',
  'js/scan.js',
  'js/store.js',
  'js/decoder.js',
  'js/workers/decode.worker.js',
  'js/workers/multiqr.js',
  'js/core/base45.js',
  'js/core/bag.js',
  'js/core/codec.js',
  'js/core/crypto.js',
  'js/core/format.js',
  'js/core/fountain.js',
  'js/core/gif.js',
  'js/core/pack.js',
  'js/core/zip.js',
  'js/core/qrgif.js',
  'vendor/qrcode.bundle.js',
  'vendor/jsQR.js',
  'manifest.webmanifest',
  'icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(event.request).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(event.request, copy));
        }
        return res;
      });
    }),
  );
});
