import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImageFile } from './fileValidation.ts';

// Zero imports, safe to import directly. Uses duck-typed objects (only
// .name/.type/.size are ever read) rather than a real browser File instance.

const fakeFile = (overrides: Partial<{ name: string; type: string; size: number }>) =>
  ({ name: 'photo.jpg', type: 'image/jpeg', size: 1024, ...overrides }) as File;

test('validateImageFile: a normal JPEG under the size limit is valid', () => {
  assert.equal(validateImageFile(fakeFile({})).isValid, true);
});

test('validateImageFile: SVG is strictly blocked by extension, a real security control against stored XSS', () => {
  const result = validateImageFile(fakeFile({ name: 'evil.svg', type: 'image/svg+xml' }));
  assert.equal(result.isValid, false);
  assert.match(result.error || '', /XSS|SVG/i);
});

test('validateImageFile: SVG is also blocked by MIME type alone, even with a non-.svg filename', () => {
  const result = validateImageFile(fakeFile({ name: 'disguised.jpg', type: 'image/svg+xml' }));
  assert.equal(result.isValid, false);
});

test('validateImageFile: an unsupported extension (e.g. .exe, .gif) is rejected', () => {
  assert.equal(validateImageFile(fakeFile({ name: 'file.exe', type: 'application/x-msdownload' })).isValid, false);
  assert.equal(validateImageFile(fakeFile({ name: 'anim.gif', type: 'image/gif' })).isValid, false);
});

test('validateImageFile: a mismatched MIME type for an allowed extension is rejected', () => {
  // .jpg extension but a MIME type that isn't in the allowed list at all
  const result = validateImageFile(fakeFile({ name: 'photo.jpg', type: 'application/octet-stream' }));
  assert.equal(result.isValid, false);
});

test('validateImageFile: a file over 50MB is rejected', () => {
  const result = validateImageFile(fakeFile({ size: 51 * 1024 * 1024 }));
  assert.equal(result.isValid, false);
});

test('validateImageFile: a file exactly at the 50MB boundary is still valid', () => {
  const result = validateImageFile(fakeFile({ size: 50 * 1024 * 1024 }));
  assert.equal(result.isValid, true);
});

test('validateImageFile: each allowed extension/MIME pair (jpg, png, webp, heic) passes', () => {
  assert.equal(validateImageFile(fakeFile({ name: 'a.png', type: 'image/png' })).isValid, true);
  assert.equal(validateImageFile(fakeFile({ name: 'a.webp', type: 'image/webp' })).isValid, true);
  assert.equal(validateImageFile(fakeFile({ name: 'a.heic', type: 'image/heic' })).isValid, true);
});

test('validateImageFile: an empty file.type (some browsers/pickers omit it) still passes on a valid extension', () => {
  const result = validateImageFile(fakeFile({ name: 'photo.jpg', type: '' }));
  assert.equal(result.isValid, true);
});
