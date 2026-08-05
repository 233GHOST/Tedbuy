/**
 * Service Worker and Background Sync registration helper.
 */
export function registerServiceWorker(onSyncNeeded: () => void) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  // Register the service worker
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('[Service Worker] Registered successfully with scope:', registration.scope);
      })
      .catch((err) => {
        console.warn('[Service Worker] Registration failed:', err);
      });
  });

  // Listen for sync messages from the service worker
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SYNC_OFFLINE_MESSAGES') {
      console.log('[Service Worker] Background Sync broadcast received. Processing offline queue...');
      onSyncNeeded();
    }
  });
}

/**
 * Request background sync tag registration or fallback triggers
 */
export async function triggerBackgroundSync() {
  if (typeof window === 'undefined') return;

  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      // Use standard SyncManager background sync if available
      if ('sync' in reg) {
        // @ts-ignore - sync is not defined in older TS types but exists in draft standard
        await reg.sync.register('sync-messages');
        console.log('[Background Sync] Registered sync tag "sync-messages"');
      } else {
        // Fallback: Post simple request to SW to broadcast back
        if (reg.active) {
          reg.active.postMessage({ type: 'REQUEST_SYNC' });
        }
      }
    } catch (err) {
      console.warn('[Background Sync] Failed to register sync tag, using network listener fallback:', err);
    }
  }
}
