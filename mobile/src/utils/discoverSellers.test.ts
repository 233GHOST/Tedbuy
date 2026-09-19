import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDiscoverSellers } from './discoverSellers.ts';

// Imports and tests the real computeDiscoverSellers directly -- safe now
// that its only import (Product from ../types) is `import type`, which
// Node's stripped-types mode elides entirely rather than trying to resolve.

const activeProduct = (overrides: Record<string, any> = {}) => ({
  id: 'p1',
  sellerId: 'u1',
  status: 'active',
  isSold: false,
  category: 'Phones',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

test('computeDiscoverSellers: returns [] when there are no users or no products', () => {
  assert.deepEqual(computeDiscoverSellers([], [{ id: 'u1' }] as any), []);
  assert.deepEqual(computeDiscoverSellers([activeProduct()] as any, []), []);
});

test('computeDiscoverSellers: location prefers region over location (matches web parity)', () => {
  const [seller] = computeDiscoverSellers(
    [activeProduct()] as any,
    [{ id: 'u1', region: 'Ashanti', location: 'Some Street, Kumasi' }]
  );
  assert.equal(seller.location, 'Ashanti', 'region must be checked before the more specific location field');
});

test('computeDiscoverSellers: falls back to location when region is absent', () => {
  const [seller] = computeDiscoverSellers(
    [activeProduct()] as any,
    [{ id: 'u1', location: 'Kumasi' }]
  );
  assert.equal(seller.location, 'Kumasi');
});

test('computeDiscoverSellers: falls back to "Ghana" when neither region nor location nor the product location exist', () => {
  const [seller] = computeDiscoverSellers(
    [activeProduct()] as any,
    [{ id: 'u1' }]
  );
  assert.equal(seller.location, 'Ghana');
});

test('computeDiscoverSellers: listing count resolves via a displayName-keyed entry in sellerListingCounts (matches web parity)', () => {
  const [seller] = computeDiscoverSellers(
    [activeProduct()] as any,
    [{ id: 'u1', displayName: 'Vince Store' }],
    undefined,
    undefined,
    { 'vince store': 42 } // keyed by lowercased displayName, no id/uid/username/email keys present
  );
  assert.equal(seller.listingCount, 42, 'a displayName-only key in sellerListingCounts must still resolve, matching web');
});

test('computeDiscoverSellers: listing count falls back to the locally-computed count when no key in sellerListingCounts matches at all', () => {
  const [seller] = computeDiscoverSellers(
    [activeProduct(), activeProduct({ id: 'p2' })] as any,
    [{ id: 'u1' }],
    undefined,
    undefined,
    { 'someone-else': 99 }
  );
  assert.equal(seller.listingCount, 2, 'must fall back to the real local count of this seller\'s own active listings');
});

test('computeDiscoverSellers: a seller with no matching user row still appears, using the product\'s own denormalized sellerName/sellerPhoto', () => {
  const [seller] = computeDiscoverSellers(
    [activeProduct({ sellerName: 'Fallback Seller', sellerPhoto: 'https://example.com/p.jpg', location: 'Tema' })] as any,
    [{ id: 'someone-unrelated' }]
  );
  assert.equal(seller.name, 'Fallback Seller');
  assert.equal(seller.photo, 'https://example.com/p.jpg');
  assert.equal(seller.location, 'Tema');
});

test('computeDiscoverSellers: excludes hidden/sold products from a seller\'s active listing count and category', () => {
  const [seller] = computeDiscoverSellers(
    [
      activeProduct({ id: 'p1', category: 'Phones' }),
      activeProduct({ id: 'p2', status: 'hidden' }),
      activeProduct({ id: 'p3', isSold: true }),
    ] as any,
    [{ id: 'u1' }]
  );
  assert.equal(seller.listingCount, 1);
});

test('computeDiscoverSellers: sorts sellers by most-recently-posted first', () => {
  const result = computeDiscoverSellers(
    [
      activeProduct({ id: 'p1', sellerId: 'old-seller', createdAt: '2025-01-01T00:00:00.000Z' }),
      activeProduct({ id: 'p2', sellerId: 'new-seller', createdAt: '2026-06-01T00:00:00.000Z' }),
    ] as any,
    [{ id: 'old-seller' }, { id: 'new-seller' }]
  );
  assert.equal(result[0].id, 'new-seller');
  assert.equal(result[1].id, 'old-seller');
});
