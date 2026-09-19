import test from 'node:test';
import assert from 'node:assert/strict';
import { getModelsForBrand } from './filterConfig.ts';

// Zero imports, safe to import directly. Mirrors
// src/utils/filterConfig.test.ts -- getModelsForBrand carries the
// Apple/Samsung laptop-vs-phone category special case previously fixed as
// a real cross-platform bug (see this file's own comment on the function).

test('getModelsForBrand: an empty/falsy brand returns an empty array', () => {
  assert.deepEqual(getModelsForBrand('', 'Phones'), []);
});

test('getModelsForBrand: Apple in a Phones category returns iPhone models, not laptops', () => {
  const models = getModelsForBrand('Apple', 'Phones');
  assert.ok(models.some(m => m.includes('iPhone')));
  assert.ok(!models.some(m => m.includes('MacBook')));
});

test('getModelsForBrand: Apple in "Laptops & Computers" returns MacBook models, not phones', () => {
  const models = getModelsForBrand('Apple', 'Laptops & Computers');
  assert.ok(models.some(m => m.includes('MacBook')));
  assert.ok(!models.some(m => m.includes('iPhone')));
});

test('getModelsForBrand: Apple in the legacy "Laptops" alias category also returns MacBook models', () => {
  const models = getModelsForBrand('Apple', 'Laptops');
  assert.ok(models.some(m => m.includes('MacBook')));
});

test('getModelsForBrand: Samsung in "Laptops & Computers" returns Galaxy Book laptops, not phones', () => {
  const models = getModelsForBrand('Samsung', 'Laptops & Computers');
  assert.ok(models.some(m => m.includes('Galaxy Book')));
  assert.ok(!models.some(m => m.startsWith('Galaxy S')));
});

test('getModelsForBrand: Samsung in Phones returns Galaxy S/A/Note phones, not laptops', () => {
  const models = getModelsForBrand('Samsung', 'Phones');
  assert.ok(models.some(m => m.startsWith('Galaxy S')));
  assert.ok(!models.some(m => m.includes('Galaxy Book')));
});

test('getModelsForBrand: brand lookup is case-insensitive and trims whitespace', () => {
  const models = getModelsForBrand('  toyota  ', 'Vehicles');
  assert.ok(models.includes('Corolla'));
});

test('getModelsForBrand: an unknown brand returns an empty array', () => {
  assert.deepEqual(getModelsForBrand('NotARealBrand', 'Phones'), []);
});
