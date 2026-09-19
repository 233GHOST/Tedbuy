import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTrendingProducts } from './trendingProducts.ts';

// trendingProducts.ts's only import (Product) is type-only, converted to
// `import type` to allow this direct import. Mobile-only file, no web
// equivalent (used by the Home carousel and the "Trending Ads" screen).

const product = (overrides: any = {}) => ({
  id: 'p1',
  title: 'Item',
  category: 'Phones',
  createdAt: new Date().toISOString(),
  viewsCount: 0,
  ...overrides,
});

test('computeTrendingProducts: sorts by view count descending', () => {
  const products = [
    product({ id: 'low', viewsCount: 5 }),
    product({ id: 'high', viewsCount: 50 }),
    product({ id: 'mid', viewsCount: 20 }),
  ];
  const result = computeTrendingProducts(products);
  assert.deepEqual(result.map(p => p.id), ['high', 'mid', 'low']);
});

test('computeTrendingProducts: ties in view count break by newest createdAt first', () => {
  const older = product({ id: 'older', viewsCount: 10, createdAt: new Date(Date.now() - 100000).toISOString() });
  const newer = product({ id: 'newer', viewsCount: 10, createdAt: new Date().toISOString() });
  const result = computeTrendingProducts([older, newer]);
  assert.deepEqual(result.map(p => p.id), ['newer', 'older']);
});

test('computeTrendingProducts: hidden, sold (isSold or status==="sold") listings are excluded', () => {
  const products = [
    product({ id: 'ok' }),
    product({ id: 'hidden', status: 'hidden' }),
    product({ id: 'isSold', isSold: true }),
    product({ id: 'soldStatus', status: 'sold' }),
  ];
  const result = computeTrendingProducts(products);
  assert.deepEqual(result.map(p => p.id), ['ok']);
});

test('computeTrendingProducts: falsy/null entries in the array are excluded without throwing', () => {
  const products = [null, undefined, product({ id: 'ok' })] as any;
  const result = computeTrendingProducts(products);
  assert.deepEqual(result.map((p: any) => p.id), ['ok']);
});

test('computeTrendingProducts: category filter matches case-insensitively and partially', () => {
  const products = [
    product({ id: 'phones', category: 'Phones' }),
    product({ id: 'vehicles', category: 'Vehicles' }),
  ];
  const result = computeTrendingProducts(products, 'phones');
  assert.deepEqual(result.map(p => p.id), ['phones']);
});

test('computeTrendingProducts: "All" category is treated as no filter', () => {
  const products = [product({ id: 'a', category: 'Phones' }), product({ id: 'b', category: 'Vehicles' })];
  const result = computeTrendingProducts(products, 'All');
  assert.equal(result.length, 2);
});

test('computeTrendingProducts: an undefined limit returns everything, a numeric limit truncates', () => {
  const products = [product({ id: '1' }), product({ id: '2' }), product({ id: '3' })];
  assert.equal(computeTrendingProducts(products).length, 3);
  assert.equal(computeTrendingProducts(products, undefined, 2).length, 2);
});

test('computeTrendingProducts: "views" is used as a fallback field when viewsCount is absent', () => {
  const products = [
    product({ id: 'legacy', viewsCount: undefined, views: 30 }),
    product({ id: 'modern', viewsCount: 10 }),
  ];
  const result = computeTrendingProducts(products);
  assert.deepEqual(result.map(p => p.id), ['legacy', 'modern']);
});
