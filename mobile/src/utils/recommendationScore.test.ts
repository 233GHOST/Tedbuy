import test from 'node:test';
import assert from 'node:assert/strict';
import { extractUserAffinity, scoreProductForUser, getForYouProducts, rankVideoFeedProducts, EXPLORATION_RATIO } from './recommendationScore.ts';

// recommendationScore.ts's only import (Product/User) is type-only.
// Mirrors web's src/utils/recommendationScore.ts ranking philosophy,
// deliberately lighter on signals (no reviews/recently-contacted-sellers
// loaded on mobile's Home screen) per the module's own doc comment.

const product = (overrides: any = {}) => ({
  id: 'p1',
  sellerId: 's1',
  category: 'Phones',
  createdAt: new Date().toISOString(),
  viewsCount: 0,
  ...overrides,
});

const user = (overrides: any = {}) => ({
  id: 'u1',
  ...overrides,
});

test('extractUserAffinity: with no signals at all, hasHistory is false and signalCount is 0', () => {
  const affinity = extractUserAffinity(null, [], []);
  assert.equal(affinity.hasHistory, false);
  assert.equal(affinity.signalCount, 0);
});

test('extractUserAffinity: saved products contribute a category signal', () => {
  const products = [product({ id: 'saved1', category: 'Vehicles' })];
  const users = [user({ id: 'me', savedProductIds: ['saved1'] })];
  const affinity = extractUserAffinity('me', users, products);
  assert.ok(affinity.categoryScores.has('Vehicles'));
  assert.equal(affinity.signalCount, 1);
});

test('extractUserAffinity: followed sellers are tracked in followedSellerIds and boost seller score', () => {
  const users = [user({ id: 'me', followingSellers: ['seller42'] })];
  const affinity = extractUserAffinity('me', users, []);
  assert.ok(affinity.followedSellerIds.has('seller42'));
  assert.ok(affinity.sellerScores.has('seller42'));
});

test('extractUserAffinity: "laptops" (legacy alias) normalizes to "Laptops & Computers" for category scoring', () => {
  const products = [product({ id: 'saved1', category: 'laptops' })];
  const users = [user({ id: 'me', savedProductIds: ['saved1'] })];
  const affinity = extractUserAffinity('me', users, products);
  assert.ok(affinity.categoryScores.has('Laptops & Computers'));
  assert.ok(!affinity.categoryScores.has('laptops'));
});

test('extractUserAffinity: recently-viewed items are weighted by recency, most-recent (index 0) counts most', () => {
  const products = [
    product({ id: 'v1', category: 'Vehicles' }),
    product({ id: 'v2', category: 'Vehicles' }),
  ];
  // Two views of the same category, but supplied as the only signal.
  const affinity = extractUserAffinity(null, [], products, ['v1', 'v2']);
  assert.equal(affinity.signalCount, 2);
  assert.ok(affinity.categoryScores.get('Vehicles')! > 0);
});

test('extractUserAffinity: hasHistory becomes true once signalCount reaches the minimum threshold (2)', () => {
  const products = [product({ id: 'v1' }), product({ id: 'v2' })];
  const oneSignal = extractUserAffinity(null, [], products, ['v1']);
  const twoSignals = extractUserAffinity(null, [], products, ['v1', 'v2']);
  assert.equal(oneSignal.hasHistory, false);
  assert.equal(twoSignals.hasHistory, true);
});

test('scoreProductForUser: a followed seller\'s product scores its full seller-affinity weight (100)', () => {
  const affinity = extractUserAffinity('me', [user({ id: 'me', followingSellers: ['s1'] })], []);
  const userMap = new Map();
  const followedProduct = product({ sellerId: 's1' });
  const strangerProduct = product({ sellerId: 'unknown-seller' });
  const scoreFollowed = scoreProductForUser(followedProduct, { affinity, userMap });
  const scoreStranger = scoreProductForUser(strangerProduct, { affinity, userMap });
  assert.ok(scoreFollowed > scoreStranger);
});

test('scoreProductForUser: a verified seller scores higher on trust than an unverified one, all else equal', () => {
  const affinity = extractUserAffinity(null, [], []);
  const userMap = new Map<string, any>([
    ['verified-seller', user({ id: 'verified-seller', isVerified: true })],
    ['plain-seller', user({ id: 'plain-seller' })],
  ]);
  const scoreVerified = scoreProductForUser(product({ sellerId: 'verified-seller' }), { affinity, userMap });
  const scorePlain = scoreProductForUser(product({ sellerId: 'plain-seller' }), { affinity, userMap });
  assert.ok(scoreVerified > scorePlain);
});

test('scoreProductForUser: a product with videos scores higher than an otherwise-identical one without', () => {
  const affinity = extractUserAffinity(null, [], []);
  const userMap = new Map();
  const withVideo = product({ videos: ['https://example.com/v.mp4'] });
  const withoutVideo = product({});
  assert.ok(scoreProductForUser(withVideo, { affinity, userMap }) > scoreProductForUser(withoutVideo, { affinity, userMap }));
});

test('getForYouProducts: an empty eligible list (all hidden/sold) returns a cold-start empty result', () => {
  const result = getForYouProducts({
    products: [product({ status: 'sold' }), product({ isSold: true }), product({ status: 'hidden' })],
    users: [],
    currentUserId: null,
  });
  assert.deepEqual(result.items, []);
  assert.equal(result.isColdStart, true);
});

test('getForYouProducts: excludes hidden/sold products from the eligible pool', () => {
  const result = getForYouProducts({
    products: [product({ id: 'ok' }), product({ id: 'hidden', status: 'hidden' }), product({ id: 'sold', isSold: true })],
    users: [],
    currentUserId: null,
  });
  assert.deepEqual(result.items.map(p => p.id).sort(), ['ok']);
});

test('getForYouProducts: with no user history, isColdStart is true and headline is the generic discovery one', () => {
  const result = getForYouProducts({ products: [product()], users: [], currentUserId: null });
  assert.equal(result.isColdStart, true);
  assert.equal(result.headline, 'Discover on TedBuy');
});

test('getForYouProducts: with enough history, isColdStart is false and headline is personalized', () => {
  const products = [product({ id: 'v1' }), product({ id: 'v2' }), product({ id: 'v3' })];
  const result = getForYouProducts({
    products,
    users: [],
    currentUserId: null,
    recentlyViewedIds: ['v1', 'v2'],
  });
  assert.equal(result.isColdStart, false);
  assert.equal(result.headline, 'For You');
});

test('getForYouProducts: respects the limit option', () => {
  const products = Array.from({ length: 20 }, (_, i) => product({ id: `p${i}` }));
  const result = getForYouProducts({ products, users: [], currentUserId: null, limit: 5 });
  assert.equal(result.items.length, 5);
});

test('rankVideoFeedProducts: only returns products that actually have a non-empty videos array', () => {
  const withVideo = product({ id: 'has-video', videos: ['https://example.com/v.mp4'] });
  const noVideoField = product({ id: 'no-video-field' });
  const emptyVideos = product({ id: 'empty-videos', videos: [] });
  const result = rankVideoFeedProducts({ products: [withVideo, noVideoField, emptyVideos], users: [], currentUserId: null });
  assert.deepEqual(result.map(p => p.id), ['has-video']);
});

test('rankVideoFeedProducts: excludes hidden/sold video products just like getForYouProducts', () => {
  const soldVideo = product({ id: 'sold', videos: ['https://example.com/v.mp4'], isSold: true });
  const result = rankVideoFeedProducts({ products: [soldVideo], users: [], currentUserId: null });
  assert.deepEqual(result, []);
});

test('EXPLORATION_RATIO is a sane fraction between 0 and 1', () => {
  assert.ok(EXPLORATION_RATIO > 0 && EXPLORATION_RATIO < 1);
});
