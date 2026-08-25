/**
 * TikTok-style Ultra-High-Performance Video Offline & Preload Cache Engine
 * 
 * Features:
 * - Persistent browser CacheStorage (`caches.open('tedbuy-video-cache-v2')`)
 * - In-memory Blob Object URL registry (`Map<string, string>`)
 * - Proactive background prefetching for forward and backward reel items
 * - Complete offline playback resilience when internet is disconnected
 */

const CACHE_NAME = 'tedbuy-video-cache-v2';
const MAX_BLOB_MEMORY_ITEMS = 40; // Cache up to 40 video Blobs simultaneously in memory

// In-memory registry of URL -> object URL (blob:...)
const memoryBlobMap = new Map<string, string>();
const inFlightRequests = new Map<string, Promise<string>>();

/**
 * Base64 decoder converting Data URLs directly into native browser Blob URLs
 */
export const base64ToBlobUrl = (base64Str: string, defaultMime = 'video/mp4'): string => {
  if (!base64Str) return '';
  if (!base64Str.startsWith('data:')) return base64Str;

  try {
    const parts = base64Str.split(',');
    if (parts.length < 2) return base64Str;
    const header = parts[0];
    const base64Part = parts.slice(1).join(',');

    const mimeMatch = header.match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : defaultMime;

    let normalizedBase64 = base64Part.trim().replace(/-/g, '+').replace(/_/g, '/');
    normalizedBase64 = normalizedBase64.replace(/[^A-Za-z0-9+/=]/g, '');

    const pad = normalizedBase64.length % 4;
    if (pad === 2) normalizedBase64 += '==';
    else if (pad === 3) normalizedBase64 += '=';

    const binaryStr = atob(normalizedBase64);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: mime });
    return URL.createObjectURL(blob);
  } catch (error) {
    console.warn('[VideoCache] base64ToBlobUrl decode error:', error);
    return base64Str;
  }
};

/**
 * Evict oldest Blob Object URLs if cache size exceeds limit to prevent excessive memory usage
 */
function evictOldestIfNecessary() {
  if (memoryBlobMap.size >= MAX_BLOB_MEMORY_ITEMS) {
    const firstKey = memoryBlobMap.keys().next().value;
    if (firstKey) {
      const blobUrl = memoryBlobMap.get(firstKey);
      if (blobUrl && blobUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch (_) {}
      }
      memoryBlobMap.delete(firstKey);
    }
  }
}

/**
 * Returns cached Object URL if available synchronously in memory
 */
export function getCachedVideoUrlSync(rawUrl: string): string | null {
  if (!rawUrl) return null;
  if (rawUrl.startsWith('blob:')) return rawUrl;
  if (memoryBlobMap.has(rawUrl)) {
    return memoryBlobMap.get(rawUrl)!;
  }
  return null;
}

/**
 * Downloads and caches video file into browser CacheStorage and memory Blob URL.
 * Once downloaded, plays seamlessly even when user is offline / internet is disabled.
 */
export async function getOrFetchCachedVideoUrl(rawUrl: string): Promise<string> {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('blob:')) return rawUrl;

  // 1. Check synchronous in-memory registry
  if (memoryBlobMap.has(rawUrl)) {
    return memoryBlobMap.get(rawUrl)!;
  }

  // 2. Handle Data URLs
  if (rawUrl.startsWith('data:')) {
    const blobUrl = base64ToBlobUrl(rawUrl, 'video/mp4');
    evictOldestIfNecessary();
    memoryBlobMap.set(rawUrl, blobUrl);
    return blobUrl;
  }

  // 3. Deduplicate in-flight downloads for the same URL
  if (inFlightRequests.has(rawUrl)) {
    return inFlightRequests.get(rawUrl)!;
  }

  const fetchPromise = (async () => {
    try {
      // Check CacheStorage first (works offline across sessions)
      if ('caches' in window) {
        try {
          const cache = await caches.open(CACHE_NAME);
          const cachedResponse = await cache.match(rawUrl);
          if (cachedResponse) {
            const blob = await cachedResponse.blob();
            const blobUrl = URL.createObjectURL(blob);
            evictOldestIfNecessary();
            memoryBlobMap.set(rawUrl, blobUrl);
            return blobUrl;
          }
        } catch (cacheErr) {
          console.warn('[VideoCache] CacheStorage lookup skipped:', cacheErr);
        }
      }

      // If offline and not in cache, fallback to rawUrl
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return rawUrl;
      }

      // Fetch from network with CORS support
      const response = await fetch(rawUrl, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'default'
      });

      if (!response.ok) {
        return rawUrl;
      }

      // Clone response to put into persistent CacheStorage
      if ('caches' in window) {
        try {
          const cache = await caches.open(CACHE_NAME);
          // Only cache successful standard HTTP/HTTPS responses
          if (rawUrl.startsWith('http')) {
            await cache.put(rawUrl, response.clone());
          }
        } catch (putErr) {
          console.warn('[VideoCache] Failed writing to CacheStorage:', putErr);
        }
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      evictOldestIfNecessary();
      memoryBlobMap.set(rawUrl, blobUrl);
      return blobUrl;
    } catch (err) {
      console.warn('[VideoCache] Failed downloading video for offline cache:', rawUrl, err);
      return rawUrl;
    } finally {
      inFlightRequests.delete(rawUrl);
    }
  })();

  inFlightRequests.set(rawUrl, fetchPromise);
  return fetchPromise;
}

/**
 * Preloads an array of video URLs silently in the background
 */
export function preloadVideoBatch(urls: string[]) {
  if (!urls || urls.length === 0) return;
  urls.forEach(url => {
    if (!url || memoryBlobMap.has(url) || inFlightRequests.has(url)) return;
    // Download asynchronously without blocking
    getOrFetchCachedVideoUrl(url).catch(() => {});
  });
}
