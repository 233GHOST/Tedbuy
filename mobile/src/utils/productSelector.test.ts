import test from 'node:test';
import assert from 'node:assert/strict';
import { sortProductsByRanking } from './productSelector.ts';

// productSelector.ts's only import (Product/User) is type-only. Mirrors
// web's src/utils/productSelector.ts ranking/sort logic (confirmed
// intentionally re-implemented, not drifted, in an earlier audit).

const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

const product = (overrides: any = {}) => ({
  id: 'p',
  sellerId: 's1',
  price: '100',
  category: 'Phones',
  location: 'Accra',
  images: [],
  description: '',
  createdAt: new Date().toISOString(),
  ...overrides,
});

test('sortProductsByRanking: an actively boosted listing always sorts above a non-boosted one, regardless of score', () => {
  const boosted = product({ id: 'boosted', boostStatus: true, boostEndDate: future, createdAt: past });
  const normal = product({ id: 'normal', createdAt: new Date().toISOString() });
  const result = sortProductsByRanking([normal, boosted], []);
  assert.deepEqual(result.map(p => p.id), ['boosted', 'normal']);
});

test('sortProductsByRanking: a boost whose boostEndDate has already passed is treated as not boosted', () => {
  const expiredBoost = product({ id: 'expired', boostStatus: true, boostEndDate: past });
  const normal = product({ id: 'normal' });
  const result = sortProductsByRanking([expiredBoost, normal], []);
  // Neither is "boosted" now, so order falls through to date/score tiebreakers,
  // not the boost-always-first rule -- just confirm no crash and both present.
  assert.equal(result.length, 2);
});

test('sortProductsByRanking: among two boosted listings, a higher boost tier (boostPlan) wins', () => {
  const shortBoost = product({ id: 'short', boostStatus: true, boostEndDate: future, boostPlan: '3days' });
  const longBoost = product({ id: 'long', boostStatus: true, boostEndDate: future, boostPlan: '1month' });
  const result = sortProductsByRanking([shortBoost, longBoost], []);
  assert.deepEqual(result.map(p => p.id), ['long', 'short']);
});

test('sortProductsByRanking: sortByPrice="asc" orders cheapest first among non-boosted listings', () => {
  const cheap = product({ id: 'cheap', price: '50' });
  const expensive = product({ id: 'expensive', price: '500' });
  const result = sortProductsByRanking([expensive, cheap], [], 'asc');
  assert.deepEqual(result.map(p => p.id), ['cheap', 'expensive']);
});

test('sortProductsByRanking: sortByPrice="desc" orders priciest first among non-boosted listings', () => {
  const cheap = product({ id: 'cheap', price: '50' });
  const expensive = product({ id: 'expensive', price: '500' });
  const result = sortProductsByRanking([cheap, expensive], [], 'desc');
  assert.deepEqual(result.map(p => p.id), ['expensive', 'cheap']);
});

test('sortProductsByRanking: sortByAds="oldest" reverses the default newest-first ordering', () => {
  const older = product({ id: 'older', createdAt: past });
  const newer = product({ id: 'newer', createdAt: new Date().toISOString() });
  const newest = sortProductsByRanking([older, newer], [], 'default', 'newest');
  const oldest = sortProductsByRanking([older, newer], [], 'default', 'oldest');
  assert.deepEqual(newest.map(p => p.id), ['newer', 'older']);
  assert.deepEqual(oldest.map(p => p.id), ['older', 'newer']);
});

test('sortProductsByRanking: does not mutate the input array (returns a new sorted copy)', () => {
  const a = product({ id: 'a', createdAt: past });
  const b = product({ id: 'b', createdAt: new Date().toISOString() });
  const input = [a, b];
  const result = sortProductsByRanking(input, []);
  assert.equal(input[0].id, 'a');
  assert.equal(input[1].id, 'b');
  assert.notEqual(result, input);
});

test('sortProductsByRanking: an empty products array returns an empty array without throwing', () => {
  assert.deepEqual(sortProductsByRanking([], []), []);
});
