import test from 'node:test';
import assert from 'node:assert/strict';

// NOTE: same reasoning as productPrice.test.ts -- productUtils.ts
// transitively imports src/firebase.ts (via cloudinary.ts's getAuthHeader,
// module-scope side effects unsafe under plain Node) and has its own
// extensionless directory import of `../types` (ERR_UNSUPPORTED_DIR_IMPORT
// under Node's ESM resolver). getCategoryPlaceholder, getCanonicalMediaKey,
// and deduplicateImageUrls are self-contained (no calls into any other
// productUtils.ts function or import), so they're mirrored verbatim here.

function getCategoryPlaceholder(category?: string): string {
  const cat = (category || 'Other').toLowerCase();
  let iconColor = '%233b82f6';
  if (cat.includes('phone')) iconColor = '%236366f1';
  else if (cat.includes('laptop') || cat.includes('electronic')) iconColor = '%230284c7';
  else if (cat.includes('fashion')) iconColor = '%23ec4899';
  else if (cat.includes('vehicle')) iconColor = '%23f59e0b';
  else if (cat.includes('property') || cat.includes('home')) iconColor = '%2310b981';

  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300" fill="none"><rect width="400" height="300" fill="%23f8fafc"/><path d="M160 110h80v80h-80z" fill="${iconColor}" opacity="0.15"/><circle cx="200" cy="150" r="30" fill="${iconColor}" opacity="0.3"/><text x="50%" y="85%" dominant-baseline="middle" text-anchor="middle" fill="%2394a3b8" font-family="sans-serif" font-size="14">${encodeURIComponent(category || 'TedBuy Product')}</text></svg>`;
}

function getCanonicalMediaKey(url: string): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  if (trimmed.includes('res.cloudinary.com')) {
    try {
      const parsedUrl = new URL(trimmed);
      const pathname = parsedUrl.pathname;
      const uploadIdx = pathname.indexOf('/upload/');
      if (uploadIdx !== -1) {
        const prefix = pathname.substring(0, uploadIdx + 8);
        const rest = pathname.substring(uploadIdx + 8);
        const segments = rest.split('/');
        const cleanSegments = segments.filter(seg => {
          if (!seg) return false;
          if (seg.includes(',') || /^[a-z]{1,3}_/.test(seg)) {
            return false;
          }
          return true;
        });
        return `${parsedUrl.host}${prefix}${cleanSegments.join('/')}`;
      }
    } catch (_) {}
  }

  return trimmed.split('?')[0].replace(/\/+$/, '').toLowerCase();
}

function deduplicateImageUrls(urls: string[]): string[] {
  if (!Array.isArray(urls)) return [];
  const seenKeys = new Set<string>();
  const result: string[] = [];

  for (const rawUrl of urls) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) continue;
    const url = rawUrl.trim();
    if (url.includes('/api/products/') || url.startsWith('data:image/svg+xml')) continue;
    const key = getCanonicalMediaKey(url);
    if (key && !seenKeys.has(key)) {
      seenKeys.add(key);
      result.push(url);
    }
  }

  return result;
}

test('getCategoryPlaceholder: returns a data: SVG URL that embeds the category name', () => {
  const result = getCategoryPlaceholder('Phones');
  assert.match(result, /^data:image\/svg\+xml/);
  assert.match(result, /Phones/);
});

test('getCategoryPlaceholder: an unrecognized/missing category falls back to "TedBuy Product" (URL-encoded)', () => {
  const result = getCategoryPlaceholder(undefined);
  assert.match(result, /TedBuy%20Product/);
});

test('getCanonicalMediaKey: two Cloudinary URLs differing only by transformation params resolve to the same key', () => {
  const a = 'https://res.cloudinary.com/demo/image/upload/c_fill,w_200/v1/photo.jpg';
  const b = 'https://res.cloudinary.com/demo/image/upload/w_800,q_auto/v1/photo.jpg';
  assert.equal(getCanonicalMediaKey(a), getCanonicalMediaKey(b));
});

test('getCanonicalMediaKey: a non-Cloudinary URL is lowercased with its query string and trailing slash stripped', () => {
  assert.equal(getCanonicalMediaKey('HTTPS://Example.com/Photo.JPG?w=200'), 'https://example.com/photo.jpg');
});

test('getCanonicalMediaKey: empty/falsy input returns an empty string, never throws', () => {
  assert.equal(getCanonicalMediaKey(''), '');
  assert.equal(getCanonicalMediaKey(null as any), '');
});

test('deduplicateImageUrls: removes Cloudinary transformation-variant duplicates of the same underlying image', () => {
  const urls = [
    'https://res.cloudinary.com/demo/image/upload/c_fill,w_200/v1/photo.jpg',
    'https://res.cloudinary.com/demo/image/upload/w_800/v1/photo.jpg',
  ];
  assert.equal(deduplicateImageUrls(urls).length, 1);
});

test('deduplicateImageUrls: excludes stale local proxy URLs and inline SVG placeholders', () => {
  const urls = [
    '/api/products/abc/image',
    'data:image/svg+xml;utf8,<svg></svg>',
    'https://res.cloudinary.com/demo/image/upload/v1/real.jpg',
  ];
  assert.deepEqual(deduplicateImageUrls(urls), ['https://res.cloudinary.com/demo/image/upload/v1/real.jpg']);
});

test('deduplicateImageUrls: a non-array input returns an empty array without throwing', () => {
  assert.deepEqual(deduplicateImageUrls(null as any), []);
});

test('deduplicateImageUrls: preserves the original order of first occurrence', () => {
  const urls = [
    'https://res.cloudinary.com/demo/image/upload/v1/a.jpg',
    'https://res.cloudinary.com/demo/image/upload/v1/b.jpg',
    'https://res.cloudinary.com/demo/image/upload/w_100/v1/a.jpg',
  ];
  assert.deepEqual(deduplicateImageUrls(urls), [
    'https://res.cloudinary.com/demo/image/upload/v1/a.jpg',
    'https://res.cloudinary.com/demo/image/upload/v1/b.jpg',
  ]);
});
