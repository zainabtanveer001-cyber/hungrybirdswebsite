const CACHE_NAME = 'hungrybirds-cache-v12';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/sw-register.js',
  '/appwebsite.js',
  '/ai-assistant.js',
  '/firebase-config.js',
  '/assets/logo.png',
  '/assets/hero-feast.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(ASSETS.map((asset) => cache.add(asset)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Never intercept cross-origin requests (Firebase SDKs, Firestore/Auth APIs, CDNs, Storage images)
  if (url.origin !== self.location.origin) return;

  // Never cache or intercept serverless API endpoints or Service Worker bootstrap scripts
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname === '/sw.js' ||
    url.pathname === '/sw-register.js'
  ) {
    return;
  }

  // Same-origin static assets: bypass HTTP disk cache so deployments propagate immediately, cache fallback offline
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then((networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return Response.error();
        })
      )
  );
});
