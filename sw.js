/* L.A.D.D.E.R. service worker
 * Network-first for app shell + data; cache-first for fonts;
 * everything else (e.g. api.github.com) passes through untouched.
 */
const CACHE_NAME = 'ladder-v1';
const FONT_CACHE = 'ladder-fonts-v1';

const SHELL = [
  './',
  './index.html',
  './elevator-data.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== CACHE_NAME && n !== FONT_CACHE)
          .map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

function isDataOrShell(url) {
  return url.pathname.endsWith('/elevator-data.js')
      || url.pathname.endsWith('/index.html')
      || url.pathname.endsWith('/manifest.json');
}

function isFont(url) {
  return url.hostname === 'fonts.googleapis.com'
      || url.hostname === 'fonts.gstatic.com';
}

async function broadcast(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach((c) => c.postMessage(msg));
}

async function networkFirst(request, cache) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
      if (request.url.endsWith('/elevator-data.js')) {
        broadcast({ type: 'data-refreshed', ts: new Date().toISOString() });
      }
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request, cache) {
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Pass through GitHub API and any other cross-origin API calls
  if (url.hostname === 'api.github.com') return;

  // App shell + data: network-first
  if (url.origin === self.location.origin
      && (request.mode === 'navigate' || isDataOrShell(url))) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => networkFirst(request, cache))
    );
    return;
  }

  // Fonts: cache-first
  if (isFont(url)) {
    event.respondWith(
      caches.open(FONT_CACHE).then((cache) => cacheFirst(request, cache))
    );
    return;
  }

  // Everything else same-origin: try network, fall back to cache
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => networkFirst(request, cache))
    );
  }
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'force-refresh') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      const keys = await cache.keys();
      await Promise.all(keys.map((k) => cache.delete(k)));
      await broadcast({ type: 'cache-cleared' });
    })());
  }
});
