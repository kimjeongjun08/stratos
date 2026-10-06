// STRATOS — minimal offline-first service worker.
// Caches the static shell; always lets API + WebSocket traffic hit the network.

const CACHE = 'stratos-v1';
// Relative so the site works both at the server root (Node) and under a
// project subpath (GitHub Pages, e.g. /stratos/). Resolved against the SW scope.
const SHELL = [
  './',
  'index.html',
  'styles/reset.css',
  'styles/variables.css',
  'styles/main.css',
  'styles/animations.css',
  'styles/responsive.css',
  'scripts/main.mjs',
  'assets/favicon.svg',
  'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Never cache API or cross-origin (CDN) requests.
  if (url.pathname.startsWith('/api/') || url.origin !== self.location.origin) return;

  // stale-while-revalidate for same-origin GETs
  if (request.method === 'GET') {
    e.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
