const CACHE_NAME = 'tedbuy-cache-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
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
