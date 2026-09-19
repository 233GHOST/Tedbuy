import test from 'node:test';
import assert from 'node:assert/strict';

// mobile's cloudinary.ts imports ../firebase (getAuthHeaderMobile) --
// resolving the whole module for even a zero-dependency export pulls in
// that heavy, side-effectful import, so it can't be direct-imported. Same
// mirrored-logic approach as src/utils/cloudinary.test.ts on web.

function getCloudinaryThumbnailMobile(url?: string | null, size = 400): string {
  if (!url || !url.includes('res.cloudinary.com')) return url || '';
  if (url.includes('/upload/')) {
    return url.replace('/upload/', `/upload/w_${size},h_${size},c_fill,q_auto,f_auto/`);
  }
  return url;
}

function getCloudinaryVideoPosterMobile(url?: string): string {
  if (!url || !url.includes('res.cloudinary.com')) return '';
  const posterUrl = url.replace(/\.[a-zA-Z0-9]+$/, '.jpg');
  return posterUrl.replace('/upload/', '/upload/so_0,f_jpg,q_auto,w_800/');
}

function isFullVideoRange(trimStart: number, trimEnd: number, durationSec: number): boolean {
  const start = Math.max(0, Math.round(trimStart));
  const end = Math.max(start + 1, Math.round(trimEnd));
  return start <= 0 && durationSec > 0 && end >= Math.floor(durationSec);
}

test('getCloudinaryThumbnailMobile: applies a square c_fill transform at the given size', () => {
  const url = 'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg';
  assert.match(getCloudinaryThumbnailMobile(url, 300), /w_300,h_300,c_fill,q_auto,f_auto/);
});

test('getCloudinaryThumbnailMobile: defaults to size 400 when omitted', () => {
  const url = 'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg';
  assert.match(getCloudinaryThumbnailMobile(url), /w_400,h_400/);
});

test('getCloudinaryThumbnailMobile: a null/undefined/non-Cloudinary url is handled safely', () => {
  assert.equal(getCloudinaryThumbnailMobile(null), '');
  assert.equal(getCloudinaryThumbnailMobile(undefined), '');
  assert.equal(getCloudinaryThumbnailMobile('https://example.com/x.jpg'), 'https://example.com/x.jpg');
});

test('getCloudinaryVideoPosterMobile: replaces the extension with .jpg and adds the poster transform', () => {
  const url = 'https://res.cloudinary.com/demo/video/upload/v1/clip.mp4';
  const poster = getCloudinaryVideoPosterMobile(url);
  assert.match(poster, /\.jpg$/);
  assert.match(poster, /so_0,f_jpg,q_auto,w_800/);
});

test('getCloudinaryVideoPosterMobile: a non-Cloudinary or missing url returns an empty string', () => {
  assert.equal(getCloudinaryVideoPosterMobile(undefined), '');
  assert.equal(getCloudinaryVideoPosterMobile('https://example.com/v.mp4'), '');
});

test('isFullVideoRange: an untouched full-length trim (0 to duration) is recognized as full', () => {
  assert.equal(isFullVideoRange(0, 30, 30), true);
});

test('isFullVideoRange: a genuinely trimmed range is recognized as not full', () => {
  assert.equal(isFullVideoRange(5, 20, 30), false);
});

test('isFullVideoRange: a trim starting after 0 is never full, even if it reaches the end', () => {
  assert.equal(isFullVideoRange(2, 30, 30), false);
});

test('isFullVideoRange: a trim ending before the true duration is never full', () => {
  assert.equal(isFullVideoRange(0, 25, 30), false);
});

test('isFullVideoRange: a zero/unknown duration is never treated as a full range', () => {
  assert.equal(isFullVideoRange(0, 0, 0), false);
});
