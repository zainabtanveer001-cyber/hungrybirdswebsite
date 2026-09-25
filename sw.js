const CACHE_NAME = 'hungrybirds-cache-v1';
const ASSETS = [
  '/',
  '/Index.html',
  '/styles.css',
  '/Appwebsite.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Only cache GET requests
  if (event.request.method !== 'GET') return;
  // Ignore Firestore / Firebase / Analytics requests for static cache to avoid stale DB data
  if (event.request.url.includes('firestore') || event.request.url.includes('identitytoolkit') || event.request.url.includes('google-analytics')) return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      // Return cached response if found, else fetch from network
      return cachedResponse || fetch(event.request).then(networkResponse => {
        // Optionally cache new dynamic assets (like images)
        if (event.request.url.includes('firebasestorage')) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return networkResponse;
      });
    }).catch(() => {
      // Offline fallback for navigation requests
      if (event.request.mode === 'navigate') {
        return caches.match('/Index.html');
      }
    })
  );
});
