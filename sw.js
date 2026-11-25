const CACHE_NAME = 'hungrybirds-cache-v4';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/appwebsite.js',
  '/firebase-config.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
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

  // Let browser handle Firebase SDK scripts, Firestore/Auth APIs, and Analytics directly
  if (
    url.hostname === 'www.gstatic.com' ||
    url.hostname.includes('firebaseio') ||
    url.hostname.includes('firebaseapp') ||
    url.hostname.includes('firebasestorage.app') ||
    url.hostname.includes('firestore') ||
    url.hostname.includes('identitytoolkit') ||
    url.hostname.includes('securetoken') ||
    url.hostname.includes('google-analytics') ||
    (url.hostname.includes('googleapis.com') && !url.hostname.includes('firebasestorage'))
  ) {
    return;
  }

  // Same-origin static assets: network-first so updates propagate immediately, cache fallback offline
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
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
    return;
  }

  // External CDN / Firebase Storage images: cache-first with network population
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.ok &&
          (event.request.url.includes('firebasestorage') || event.request.url.includes('cdnjs.cloudflare.com'))
        ) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return networkResponse;
      });
    })
  );
});
