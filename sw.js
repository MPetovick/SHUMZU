// Offline support: the app shell is cached on install; fonts and PeerJS are cached
// the first time they load. Bump CACHE when shipping a new version.

const CACHE = 'sembrado-0.0.1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/ui/styles.css',
  './app.bundle.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const cacheable = sameOrigin || /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.host);
  if (!cacheable) return;

  // Network first for our own files (so updates arrive), cache as fallback offline.
  // Cache first for third-party fonts and libraries, which are versioned.
  if (sameOrigin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
    );
  } else {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok || res.type === 'opaque') caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          })
      )
    );
  }
});
