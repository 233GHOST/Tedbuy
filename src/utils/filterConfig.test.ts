import test from 'node:test';
import assert from 'node:assert/strict';
import { getModelsForBrand } from './filterConfig.ts';

// filterConfig.ts's only remaining import (Category) is type-only, so it's
// been converted to `import type` to allow this direct import -- Node's
// --experimental-strip-types elides type-only imports without resolving
// them. getModelsForBrand carries the Apple/Samsung laptop-vs-phone
// special-case logic previously fixed for a real cross-platform bug (see
// mobile/src/utils/filterConfig.ts's comment on the same function).

test('getModelsForBrand: an empty/falsy brand returns an empty array', () => {
  assert.deepEqual(getModelsForBrand('', 'Phones' as any), []);
});

test('getModelsForBrand: Apple in a Phones category returns iPhone models, not laptops', () => {
  const models = getModelsForBrand('Apple', 'Phones' as any);
  assert.ok(models.some(m => m.includes('iPhone')));
  assert.ok(!models.some(m => m.includes('MacBook')));
});

test('getModelsForBrand: Apple in "Laptops & Computers" returns MacBook models, not phones', () => {
  const models = getModelsForBrand('Apple', 'Laptops & Computers' as any);
  assert.ok(models.some(m => m.includes('MacBook')));
  assert.ok(!models.some(m => m.includes('iPhone')));
});

test('getModelsForBrand: Apple in the legacy "Laptops" alias category also returns MacBook models', () => {
  const models = getModelsForBrand('Apple', 'Laptops' as any);
  assert.ok(models.some(m => m.includes('MacBook')));
});

test('getModelsForBrand: Samsung in "Laptops & Computers" returns Galaxy Book laptops, not phones', () => {
  const models = getModelsForBrand('Samsung', 'Laptops & Computers' as any);
  assert.ok(models.some(m => m.includes('Galaxy Book')));
  assert.ok(!models.some(m => m.startsWith('Galaxy S')));
});

test('getModelsForBrand: Samsung in Phones returns Galaxy S/A/Note phones, not laptops', () => {
  const models = getModelsForBrand('Samsung', 'Phones' as any);
  assert.ok(models.some(m => m.startsWith('Galaxy S')));
  assert.ok(!models.some(m => m.includes('Galaxy Book')));
});

test('getModelsForBrand: brand lookup is case-insensitive and trims whitespace', () => {
  const models = getModelsForBrand('  toyota  ', 'Vehicles' as any);
  assert.ok(models.includes('Corolla'));
});

test('getModelsForBrand: an unknown brand returns an empty array', () => {
  assert.deepEqual(getModelsForBrand('NotARealBrand', 'Phones' as any), []);
});
