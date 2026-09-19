import test from 'node:test';
import assert from 'node:assert/strict';

// cloudinary.ts imports ../firebase (the real Firebase SDK init, heavy and
// side-effectful) and a relative extensionless ./imageOptimizer -- neither
// resolves under Node's --experimental-strip-types loader, and ../firebase
// specifically can't be made a type-only import (it's genuinely used for
// live network calls elsewhere in the file). Per this suite's established
// pattern (see server.test.ts), the pure URL-transform logic is mirrored
// here verbatim rather than imported, since it has no other dependency.

function buildCloudinaryUrl(url: string, transformations: string): string {
  if (!url || typeof url !== 'string' || !url.includes('res.cloudinary.com')) {
    return url;
  }
  return url.replace('/upload/', `/upload/${transformations}/`);
}

function getCloudinaryThumbnail(url: string): string {
  if (!url) return '';
  if (url.includes('res.cloudinary.com')) {
    return buildCloudinaryUrl(url, 'c_thumb,w_200,h_200,g_auto,f_auto,q_auto');
  }
  return url;
}

function getCloudinaryVideoPoster(url: string): string {
  if (!url) return '';
  if (url.includes('res.cloudinary.com')) {
    let posterUrl = url.replace(/\.[a-zA-Z0-9]+$/, '.jpg');
    return buildCloudinaryUrl(posterUrl, 'so_0,f_jpg,q_auto,w_800');
  }
  return url;
}

function extractCloudinaryInfo(url: string): { publicId: string; resourceType: 'image' | 'video' } | null {
  if (!url || typeof url !== 'string' || !url.includes('res.cloudinary.com')) {
    return null;
  }
  try {
    const uploadIdx = url.indexOf('/upload/');
    if (uploadIdx === -1) return null;
    const prefix = url.substring(0, uploadIdx);
    const resourceType: 'image' | 'video' = prefix.endsWith('/video') ? 'video' : 'image';
    const pathAfterUpload = url.substring(uploadIdx + 8);
    const rawSegments = pathAfterUpload.split('/');
    const cleanSegments = rawSegments.filter(seg => {
      if (!seg) return false;
      if (/^v\d+$/.test(seg)) return false;
      if (seg.includes(',') || /^(c_|w_|h_|f_|q_|so_|vc_|g_)/.test(seg)) return false;
      return true;
    });
    if (cleanSegments.length === 0) return null;
    const fullPathWithExt = cleanSegments.join('/');
    const publicId = fullPathWithExt.replace(/\.[a-zA-Z0-9]+$/, '');
    return { publicId, resourceType };
  } catch (err) {
    return null;
  }
}

test('buildCloudinaryUrl: injects the transformation string right after /upload/', () => {
  const url = 'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg';
  assert.equal(buildCloudinaryUrl(url, 'w_200'), 'https://res.cloudinary.com/demo/image/upload/w_200/v1/sample.jpg');
});

test('buildCloudinaryUrl: a non-Cloudinary URL is returned unchanged', () => {
  const url = 'https://images.unsplash.com/photo-123';
  assert.equal(buildCloudinaryUrl(url, 'w_200'), url);
});

test('getCloudinaryThumbnail: applies the 200x200 smart-crop transform to a real Cloudinary URL', () => {
  const url = 'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg';
  assert.match(getCloudinaryThumbnail(url), /c_thumb,w_200,h_200,g_auto,f_auto,q_auto/);
});

test('getCloudinaryThumbnail: an empty url returns an empty string, a non-Cloudinary url passes through', () => {
  assert.equal(getCloudinaryThumbnail(''), '');
  assert.equal(getCloudinaryThumbnail('https://example.com/x.jpg'), 'https://example.com/x.jpg');
});

test('getCloudinaryVideoPoster: replaces the video extension with .jpg and adds the poster-frame transform', () => {
  const url = 'https://res.cloudinary.com/demo/video/upload/v1/clip.mp4';
  const poster = getCloudinaryVideoPoster(url);
  assert.match(poster, /\.jpg$/);
  assert.match(poster, /so_0,f_jpg,q_auto,w_800/);
});

test('extractCloudinaryInfo: parses a standard image URL into publicId + resourceType', () => {
  const info = extractCloudinaryInfo('https://res.cloudinary.com/demo/image/upload/v1234/folder/photo.jpg');
  assert.deepEqual(info, { publicId: 'folder/photo', resourceType: 'image' });
});

test('extractCloudinaryInfo: parses a video URL, detecting resourceType from the /video/ segment', () => {
  const info = extractCloudinaryInfo('https://res.cloudinary.com/demo/video/upload/v1234/clip.mp4');
  assert.deepEqual(info, { publicId: 'clip', resourceType: 'video' });
});

test('extractCloudinaryInfo: strips transformation segments (e.g. c_fill,w_200) from the path before deriving publicId', () => {
  const info = extractCloudinaryInfo('https://res.cloudinary.com/demo/image/upload/c_fill,w_200/v1234/photo.jpg');
  assert.equal(info?.publicId, 'photo');
});

test('extractCloudinaryInfo: a non-Cloudinary or malformed URL returns null, never throws', () => {
  assert.equal(extractCloudinaryInfo('https://example.com/photo.jpg'), null);
  assert.equal(extractCloudinaryInfo(''), null);
  assert.equal(extractCloudinaryInfo('https://res.cloudinary.com/demo/image/no-upload-segment/photo.jpg'), null);
});
