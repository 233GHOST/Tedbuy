/**
 * TikTok-style Ultra-High-Performance Video Playback & Offline Cache Engine
 * 
 * Key Principles:
 * 1. Zero Playback Delay: Always return a playable stream URL immediately (synchronously)
 *    so browser native media hardware decoders start playing on frame 1.
 * 2. Instant Base64 to Blob conversion with memoization so data: URIs play at native speed.
 * 3. Background caching into CacheStorage and memory Blob store without ever blocking playback.
 * 4. Offline resilience: Videos once viewed or preloaded remain in cache for offline scrolling.
 */

const CACHE_NAME = 'tedbuy-video-cache-v2';
const MAX_BLOB_MEMORY_ITEMS = 50;

// In-memory cache for base64 data URIs converted to Blob URLs
const dataUriToBlobMap = new Map<string, string>();
// In-memory cache for downloaded offline video blobs
const offlineBlobMap = new Map<string, string>();

/**
 * High-performance base64 to Blob URL converter with memoization
 */
export const base64ToBlobUrl = (base64Str: string, defaultMime = 'video/mp4'): string => {
  if (!base64Str) return '';
  if (!base64Str.startsWith('data:')) return base64Str;

  if (dataUriToBlobMap.has(base64Str)) {
    return dataUriToBlobMap.get(base64Str)!;
  }

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
    const blobUrl = URL.createObjectURL(blob);

    if (dataUriToBlobMap.size >= MAX_BLOB_MEMORY_ITEMS) {
      const oldest = dataUriToBlobMap.keys().next().value;
      if (oldest) {
        try {
          URL.revokeObjectURL(dataUriToBlobMap.get(oldest)!);
        } catch (_) {}
        dataUriToBlobMap.delete(oldest);
      }
    }

    dataUriToBlobMap.set(base64Str, blobUrl);
    return blobUrl;
  } catch (error) {
    console.warn('[VideoCache] base64 decode fallback:', error);
    return base64Str;
  }
};

/**
 * Returns a playable URL IMMEDIATELY without any async delay or network blocking
 */
export function getInstantVideoUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  // If we already have an offline blob ready, use it
  if (offlineBlobMap.has(rawUrl)) {
    return offlineBlobMap.get(rawUrl)!;
  }
  // If it's a data URI, convert synchronously to Blob URL
  if (rawUrl.startsWith('data:')) {
    return base64ToBlobUrl(rawUrl);
  }
  // Otherwise return raw URL directly for immediate native browser streaming
  return rawUrl;
}

/**
 * Non-blocking background caching for offline playback
 */
export async function cacheVideoInBackground(rawUrl: string): Promise<void> {
  if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:') || offlineBlobMap.has(rawUrl)) {
    return;
  }

  try {
    if ('caches' in window) {
      const cache = await caches.open(CACHE_NAME);
      const match = await cache.match(rawUrl);
      if (match) {
        const blob = await match.blob();
        const blobUrl = URL.createObjectURL(blob);
        offlineBlobMap.set(rawUrl, blobUrl);
        return;
      }

      // Fetch silently only when online
      if (navigator.onLine && rawUrl.startsWith('http')) {
        const response = await fetch(rawUrl, { mode: 'no-cors' });
        if (response) {
          await cache.put(rawUrl, response);
        }
      }
    }
  } catch (_) {
    // Fail silently in background
  }
}

/**
 * Preload batch of videos silently in background
 */
export function preloadVideoBatch(urls: string[]) {
  if (!urls || urls.length === 0) return;
  urls.forEach(url => {
    if (!url) return;
    if (url.startsWith('data:')) {
      base64ToBlobUrl(url);
    } else {
      cacheVideoInBackground(url);
    }
  });
}
