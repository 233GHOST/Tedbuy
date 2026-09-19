import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCloudinaryTransformations, getOptimizedImageUrl } from './imageOptimizer.ts';

// Only the two pure, DOM-free functions in this file are tested here --
// compressImage/downscaleDataUrlForAI depend on File/FileReader/Image/canvas
// (real browser globals), not available or meaningfully mockable under
// plain Node, so they're out of scope for this test runner.

test('validateCloudinaryTransformations: a non-Cloudinary URL is passed through untouched and reported valid', () => {
  const result = validateCloudinaryTransformations('https://images.unsplash.com/photo-123');
  assert.equal(result.isValid, true);
  assert.equal(result.transformedUrl, 'https://images.unsplash.com/photo-123');
  assert.deepEqual(result.missingParams, []);
});

test('validateCloudinaryTransformations: an empty/falsy url is handled without throwing', () => {
  const result = validateCloudinaryTransformations('');
  assert.equal(result.isValid, true);
  assert.equal(result.transformedUrl, '');
});

test('validateCloudinaryTransformations: a Cloudinary URL missing f_auto/q_auto is flagged invalid and gets both appended', () => {
  const url = 'https://res.cloudinary.com/demo/image/upload/v1234/sample.jpg';
  const result = validateCloudinaryTransformations(url);
  assert.equal(result.isValid, false);
  assert.deepEqual(result.missingParams.sort(), ['f_auto', 'q_auto']);
  assert.match(result.transformedUrl, /\/upload\/f_auto,q_auto\/v1234\/sample\.jpg/);
});

test('validateCloudinaryTransformations: a URL that already has both params is reported valid, unchanged content', () => {
  const url = 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/v1234/sample.jpg';
  const result = validateCloudinaryTransformations(url);
  assert.equal(result.isValid, true);
  assert.deepEqual(result.missingParams, []);
});

test('validateCloudinaryTransformations: an existing transform segment is preserved, not duplicated', () => {
  const url = 'https://res.cloudinary.com/demo/image/upload/w_400,c_fill/v1234/sample.jpg';
  const result = validateCloudinaryTransformations(url);
  assert.match(result.transformedUrl, /w_400/);
  assert.match(result.transformedUrl, /c_fill/);
  assert.match(result.transformedUrl, /f_auto/);
  assert.match(result.transformedUrl, /q_auto/);
});

test('validateCloudinaryTransformations: an explicit width option overwrites an existing w_ flag rather than duplicating it', () => {
  const url = 'https://res.cloudinary.com/demo/image/upload/w_200/v1234/sample.jpg';
  const result = validateCloudinaryTransformations(url, { width: 800 });
  const transformSegment = result.transformedUrl.split('/upload/')[1].split('/')[0];
  const wFlags = transformSegment.split(',').filter(f => f.startsWith('w_'));
  assert.deepEqual(wFlags, ['w_800']);
});

test('validateCloudinaryTransformations: a width option with no existing c_ flag adds a default "limit" fit', () => {
  const url = 'https://res.cloudinary.com/demo/image/upload/v1234/sample.jpg';
  const result = validateCloudinaryTransformations(url, { width: 500 });
  assert.match(result.transformedUrl, /c_limit/);
});

test('validateCloudinaryTransformations: a Cloudinary URL with no /upload/ segment at all is returned unmodified', () => {
  const url = 'https://res.cloudinary.com/demo/some/other/path.jpg';
  const result = validateCloudinaryTransformations(url);
  assert.equal(result.transformedUrl, url);
});

test('getOptimizedImageUrl: an empty url returns an empty string', () => {
  assert.equal(getOptimizedImageUrl(''), '');
});

test('getOptimizedImageUrl: a data: URL is returned as-is (cannot optimize base64 client-side)', () => {
  const dataUrl = 'data:image/png;base64,abc123';
  assert.equal(getOptimizedImageUrl(dataUrl), dataUrl);
});

test('getOptimizedImageUrl: an Unsplash URL gets width/quality/auto=format query params applied', () => {
  const result = getOptimizedImageUrl('https://images.unsplash.com/photo-123', 600, 70);
  assert.match(result, /w=600/);
  assert.match(result, /q=70/);
  assert.match(result, /auto=format/);
});

test('getOptimizedImageUrl: an Unsplash URL with an existing w= param gets it replaced, not duplicated', () => {
  const result = getOptimizedImageUrl('https://images.unsplash.com/photo-123?w=200', 900);
  const wMatches = result.match(/w=\d+/g);
  assert.deepEqual(wMatches, ['w=900']);
});

test('getOptimizedImageUrl: a Cloudinary URL is routed through validateCloudinaryTransformations', () => {
  const result = getOptimizedImageUrl('https://res.cloudinary.com/demo/image/upload/v1/sample.jpg', 400);
  assert.match(result, /f_auto/);
  assert.match(result, /q_auto/);
  assert.match(result, /w_400/);
});

test('getOptimizedImageUrl: a local /api/products/ image URL gets w/q/fmt query params set', () => {
  const result = getOptimizedImageUrl('/api/products/abc123/image', 300, 85, 'avif');
  assert.match(result, /^\/api\/products\/abc123\/image\?/);
  const params = new URLSearchParams(result.split('?')[1]);
  assert.equal(params.get('w'), '300');
  assert.equal(params.get('q'), '85');
  assert.equal(params.get('fmt'), 'avif');
});

test('getOptimizedImageUrl: an unrecognized external URL is returned unchanged (safe passthrough)', () => {
  const url = 'https://example.com/some-other-image.png';
  assert.equal(getOptimizedImageUrl(url), url);
});
