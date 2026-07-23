const CACHE_NAME = 'tedbuy-cache-v2';
const STATIC_ASSETS = [
  '/',
  '/favicon.svg',
  '/favicon-48.png',
  '/icon-192.png',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // Skip non-GET or cross-origin POST/API calls
  if (request.method !== 'GET') return;
  if (request.url.includes('/api/auth') || request.url.includes('/__/auth')) return;

  // Stale-While-Revalidate strategy for static assets & images
  if (
    request.destination === 'image' ||
    request.destination === 'font' ||
    request.destination === 'style' ||
    request.destination === 'script'
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(request).then((cachedResponse) => {
          const fetchPromise = fetch(request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => cachedResponse);

          return cachedResponse || fetchPromise;
        });
      })
    );
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-messages') {
    event.waitUntil(broadcastSyncRequest());
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'REQUEST_SYNC') {
    broadcastSyncRequest();
  }
});

async function broadcastSyncRequest() {
  const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientsList) {
    client.postMessage({ type: 'SYNC_OFFLINE_MESSAGES' });
  }
}
