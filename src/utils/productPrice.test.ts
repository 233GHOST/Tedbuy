import test from 'node:test';
import assert from 'node:assert/strict';

// NOTE: this intentionally does NOT import normalizeClientPrice from
// productUtils.ts directly. That file transitively imports src/firebase.ts
// (via cloudinary.ts's getAuthHeader), which -- like server.ts elsewhere in
// this repo -- has module-scope side effects (Firebase SDK init reading
// import.meta.env) unsafe to trigger from a plain Node test process, and
// productUtils.ts's own `../types` import is an extensionless directory
// import Node's ESM resolver can't follow outside a bundler (confirmed:
// `ERR_UNSUPPORTED_DIR_IMPORT`). This mirrors the exact expression at
// src/utils/productUtils.ts's normalizeClientPrice() verbatim instead.

function normalizeClientPrice(raw: unknown): string | number {
  if (raw === undefined || raw === null || raw === '') return 0;
  if (typeof raw === 'number') return isNaN(raw) ? 0 : raw;
  const cleanStr = String(raw).replace(/GHS/gi, '').replace(/,/g, '').trim();
  if (cleanStr !== '' && !isNaN(Number(cleanStr))) return Number(cleanStr);
  return String(raw).trim() || 0;
}

test('normalizeClientPrice: a literal price phrase (Services/Jobs listings) is preserved as text, not coerced to NaN', () => {
  assert.equal(normalizeClientPrice('Inquire'), 'Inquire');
  assert.equal(normalizeClientPrice('Contact for Price'), 'Contact for Price');
});

test('normalizeClientPrice: a real numeric price, with or without GHS/commas, becomes a number', () => {
  assert.equal(normalizeClientPrice(1500), 1500);
  assert.equal(normalizeClientPrice('1,500'), 1500);
  assert.equal(normalizeClientPrice('GHS 1,500'), 1500);
});

test('normalizeClientPrice: missing/empty/NaN price falls back to 0, never NaN', () => {
  assert.equal(normalizeClientPrice(undefined), 0);
  assert.equal(normalizeClientPrice(null), 0);
  assert.equal(normalizeClientPrice(''), 0);
  assert.equal(normalizeClientPrice(NaN), 0);
});
