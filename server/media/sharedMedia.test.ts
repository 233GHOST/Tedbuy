import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStillReferenced, mediaUrlsOf } from './sharedMedia.js';

const URL_A = 'https://res.cloudinary.com/demo/image/upload/v1700000000/tedbuy/products/abc123.jpg';
const URL_A_TRANSFORMED = 'https://res.cloudinary.com/demo/image/upload/w_400,q_auto/f_jpg/v1700000000/tedbuy/products/abc123.jpg';
const URL_B = 'https://res.cloudinary.com/demo/image/upload/v1700000001/tedbuy/products/other.jpg';
const VIDEO_A = 'https://res.cloudinary.com/demo/video/upload/v1700000002/tedbuy/videos/clip1.mp4';

test("another seller's product references the URL -> still referenced", () => {
  const products = [
    { productId: 'mine', images: [URL_A] },
    { productId: 'victim', images: [URL_A, URL_B] },
  ];
  assert.equal(isStillReferenced(URL_A, products, [], { productId: 'mine' }), true);
});

test('same asset under a different transformation URL -> still referenced', () => {
  const products = [{ productId: 'victim', images: [URL_A] }];
  assert.equal(isStillReferenced(URL_A_TRANSFORMED, products, [], {}), true);
  // and the other way round
  const products2 = [{ productId: 'victim', images: [URL_A_TRANSFORMED] }];
  assert.equal(isStillReferenced(URL_A, products2, [], {}), true);
});

test('only the excluded product references it -> not referenced', () => {
  const products = [
    { productId: 'p1', images: [URL_A], videos: [VIDEO_A] },
    { productId: 'p2', images: [URL_B] },
  ];
  assert.equal(isStillReferenced(URL_A, products, [], { productId: 'p1' }), false);
  assert.equal(isStillReferenced(VIDEO_A, products, [], { productId: 'p1' }), false);
});

test('excluded product id compared as a string (numeric ids)', () => {
  const products = [{ productId: 42 as unknown as string, images: [URL_A] }];
  assert.equal(isStillReferenced(URL_A, products, [], { productId: '42' }), false);
});

test("another user's photoUrl equals it -> still referenced; the excluded user's own -> not", () => {
  const users = [
    { id: 'u1', photoUrl: URL_A },
    { id: 'u2', photoUrl: null },
  ];
  assert.equal(isStillReferenced(URL_A, [], users, { userId: 'u2' }), true);
  assert.equal(isStillReferenced(URL_A, [], users, { userId: 'u1' }), false);
  // transformed variant of another user's photo counts too
  assert.equal(isStillReferenced(URL_A_TRANSFORMED, [], users, { userId: 'u2' }), true);
});

test('string-encoded JSON media arrays are parsed', () => {
  const products = [
    { productId: 'p2', images: JSON.stringify([URL_B]), videos: JSON.stringify(JSON.stringify([VIDEO_A])) },
    { productId: 'p3', videoUrls: JSON.stringify([URL_A]) },
  ];
  assert.equal(isStillReferenced(VIDEO_A, products, [], { productId: 'p1' }), true);
  assert.equal(isStillReferenced(URL_A, products, [], { productId: 'p1' }), true);
  assert.deepEqual(mediaUrlsOf(products[0]), [URL_B, VIDEO_A]);
});

test('no references -> not referenced', () => {
  assert.equal(isStillReferenced(URL_A, [], [], {}), false);
  assert.equal(isStillReferenced(URL_A, [{ productId: 'p', images: [URL_B] }], [{ id: 'u', photoUrl: URL_B }], {}), false);
  assert.equal(isStillReferenced(URL_A, [{ productId: 'p', images: null, videos: undefined }], [], {}), false);
});

test('a bare publicId target (admin delete without url) matches by publicId', () => {
  const products = [{ productId: 'victim', images: [URL_A_TRANSFORMED] }];
  assert.equal(isStillReferenced({ publicId: 'tedbuy/products/abc123' }, products, [], {}), true);
  assert.equal(isStillReferenced({ publicId: 'tedbuy/products/nope' }, products, [], {}), false);
});

test('non-Cloudinary references still match by exact URL', () => {
  const plain = 'https://example.com/a.jpg';
  assert.equal(isStillReferenced(plain, [{ productId: 'x', images: [plain] }], [], {}), true);
  assert.equal(isStillReferenced(plain, [{ productId: 'x', images: ['https://example.com/b.jpg'] }], [], {}), false);
});

test('same asset under a different URL in the edited listing\'s new media -> not deleted', () => {
  const newMediaRef = { productId: '__new__', images: [URL_A_TRANSFORMED] };
  assert.equal(isStillReferenced(URL_A, [newMediaRef], [], { productId: 'edited' }), true);
  assert.equal(isStillReferenced(URL_B, [newMediaRef], [], { productId: 'edited' }), false);
});
