import test from 'node:test';
import assert from 'node:assert/strict';
import { formatProductPrice } from './formatPrice.ts';

test('formatProductPrice: formats a real number as GHS currency', () => {
  assert.equal(formatProductPrice(1500), 'GH₵1,500');
});

test('formatProductPrice: "Contact for Price" (and variants) become "Inquire"', () => {
  assert.equal(formatProductPrice('Contact for Price'), 'Inquire');
  assert.equal(formatProductPrice('contact for price'), 'Inquire');
  assert.equal(formatProductPrice('Please Contact for Price'), 'Inquire');
});

test('formatProductPrice: a numeric string with GHS/commas is parsed and reformatted', () => {
  assert.equal(formatProductPrice('GHS 1,500'), 'GH₵1,500');
  assert.equal(formatProductPrice('1,500'), 'GH₵1,500');
});

test('formatProductPrice: a genuinely non-numeric literal price phrase is returned as-is', () => {
  assert.equal(formatProductPrice('Inquire'), 'Inquire');
  assert.equal(formatProductPrice('Negotiable'), 'Negotiable');
});

test('formatProductPrice: zero is a valid, real price and formats normally (not treated as "no price")', () => {
  assert.equal(formatProductPrice(0), 'GH₵0');
});
