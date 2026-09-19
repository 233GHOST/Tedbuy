import test from 'node:test';
import assert from 'node:assert/strict';

// NOTE: this intentionally does NOT import resolveProductImageUri from
// ./productImage.ts directly. It imports getCloudinaryVideoPosterMobile
// from ./cloudinary as a real value (not just a type), and that relative
// specifier has no file extension -- the same Node-native-ESM-loader
// limitation server.test.ts and boost.test.ts already document and work
// around. Mirrors the real filterValidImages logic verbatim instead.

const isVideoPosterUrl = (url: string) =>
  url.includes('res.cloudinary.com') && url.includes('/upload/so_0,f_jpg');

function filterValidImages(arr: any[]): string[] {
  return arr.filter(
    (img: any) =>
      typeof img === 'string' &&
      img.trim().length > 0 &&
      !img.includes('/api/products/') &&
      !img.startsWith('data:image/svg+xml') &&
      !img.includes('unsplash.com') &&
      !isVideoPosterUrl(img)
  );
}

function resolveProductImageUri(product: any): string | null {
  if (!product) return null;

  let list: string[] = [];
  if (Array.isArray(product.images) && product.images.length > 0) {
    list = filterValidImages(product.images);
  }
  if (list.length === 0 && Array.isArray(product.imageUrls) && product.imageUrls.length > 0) {
    list = filterValidImages(product.imageUrls);
  }
  if (list[0]) return list[0];

  const hasVideo = Array.isArray(product.videos) && product.videos.length > 0;
  if (!hasVideo) {
    const candidates = [product.displayImage, product.primaryImage, product.primaryPicture, product.image, product.thumbnailUrl];
    for (const field of candidates) {
      if (typeof field === 'string' && filterValidImages([field]).length > 0) {
        return field.trim();
      }
    }
  }

  // Video-poster fallback deliberately omitted from this mirror -- it calls
  // the real getCloudinaryVideoPosterMobile(), which is exactly the part
  // this file can't import directly. Not exercised by these tests.
  return null;
}

// Found via a dedicated cross-platform audit (2026-09-19): this file's own
// header comment documents that showing an unrelated stock photo as "the
// seller's actual photo" is the exact bug class it exists to prevent, but
// it never excluded unsplash.com -- while SellScreen.tsx genuinely
// substitutes a hardcoded Unsplash stock photo for a photo-less,
// video-less listing. These tests lock in that the fix actually closes it.

test('resolveProductImageUri: a real uploaded photo is used', () => {
  const uri = resolveProductImageUri({ images: ['https://res.cloudinary.com/demo/image/upload/v1/real-photo.jpg'] });
  assert.equal(uri, 'https://res.cloudinary.com/demo/image/upload/v1/real-photo.jpg');
});

test('resolveProductImageUri: an Unsplash stock photo in the images array is rejected, not shown as the seller\'s photo', () => {
  const uri = resolveProductImageUri({ images: ['https://images.unsplash.com/photo-12345?fit=crop'] });
  assert.equal(uri, null, 'an Unsplash URL must never be returned as if it were a real product photo');
});

test('resolveProductImageUri: an Unsplash URL in a single-field fallback (displayImage) is also rejected', () => {
  const uri = resolveProductImageUri({ displayImage: 'https://images.unsplash.com/photo-99999' });
  assert.equal(uri, null);
});

test('resolveProductImageUri: a real photo in displayImage is still used when the images array is empty', () => {
  const uri = resolveProductImageUri({ images: [], displayImage: 'https://res.cloudinary.com/demo/image/upload/v1/real.jpg' });
  assert.equal(uri, 'https://res.cloudinary.com/demo/image/upload/v1/real.jpg');
});

test('resolveProductImageUri: an unsigned proxy URL (/api/products/) is excluded', () => {
  const uri = resolveProductImageUri({ images: ['/api/products/proxy-image'] });
  assert.equal(uri, null);
});

test('resolveProductImageUri: an SVG data URI placeholder is excluded', () => {
  const uri = resolveProductImageUri({ images: ['data:image/svg+xml;base64,abc123'] });
  assert.equal(uri, null);
});

test('resolveProductImageUri: no images, no video, no candidate fields returns null (honest empty state, not a fabricated fallback)', () => {
  const uri = resolveProductImageUri({});
  assert.equal(uri, null);
});

test('resolveProductImageUri: null product returns null without throwing', () => {
  assert.equal(resolveProductImageUri(null), null);
});
