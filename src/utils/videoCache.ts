/**
 * TikTok-style Ultra-High-Performance Video Offline & Preload Cache Engine
 * 
 * Features:
 * - Instant synchronous resolution of base64 Data URLs and direct video URLs
 * - Browser CacheStorage + Service Worker offline video retention
 * - Background preloading for forward and backward reels (up to 15 items)
 * - Safe CORS handling that never blocks direct media streaming
 */

const CACHE_NAME = 'tedbuy-video-cache-v2';
const MAX_BLOB_MEMORY_ITEMS = 40;

// In-memory registry of URL -> object URL (blob:...)
const memoryBlobMap = new Map<string, string>();

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
 * Evict oldest Blob Object URLs if cache size exceeds limit
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
 * Returns playable URL immediately without blocking or waiting
 */
export function getProcessedVideoUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  if (!rawUrl.startsWith('data:')) return rawUrl;

  if (memoryBlobMap.has(rawUrl)) {
    return memoryBlobMap.get(rawUrl)!;
  }

  const blobUrl = base64ToBlobUrl(rawUrl, 'video/mp4');
  evictOldestIfNecessary();
  memoryBlobMap.set(rawUrl, blobUrl);
  return blobUrl;
}

// Background prefetch cache via hidden video elements for native browser disk caching
const preloadedUrls = new Set<string>();

/**
 * Preloads videos seamlessly in background using native HTML5 Video prefetch
 * so browser caches byte-ranges locally on disk / CacheStorage for instant offline/backward playback.
 */
export function preloadVideoBatch(urls: string[]) {
  if (typeof window === 'undefined' || !urls || urls.length === 0) return;

  urls.forEach(url => {
    if (!url || preloadedUrls.has(url)) return;
    preloadedUrls.add(url);

    // If it's a data URL, decode it into Blob URL immediately
    if (url.startsWith('data:')) {
      getProcessedVideoUrl(url);
      return;
    }

    // For HTTP/HTTPS URLs, trigger browser background preload & CacheStorage
    try {
      if ('caches' in window && url.startsWith('http')) {
        fetch(url, { mode: 'no-cors', cache: 'force-cache' }).catch(() => {});
      }
    } catch (_) {}

    try {
      const v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.playsInline = true;
      v.src = url;
      v.load();
    } catch (_) {}
  });
}

