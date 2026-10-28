import test from 'node:test';
import assert from 'node:assert/strict';
import { isDropshipRowId, formatDeliveryWindow, formatPesewas } from './dropship.ts';

test('isDropshipRowId matches dsl_ prefix case-insensitively', () => {
  assert.equal(isDropshipRowId('dsl_abc'), true);
  assert.equal(isDropshipRowId('DSL_X'), true);
  assert.equal(isDropshipRowId('dslx'), false);
  assert.equal(isDropshipRowId(undefined), false);
  assert.equal(isDropshipRowId(42 as any), false);
});

test('formatDeliveryWindow', () => {
  assert.equal(formatDeliveryWindow(2, 5), '2–5 days');
  assert.equal(formatDeliveryWindow(3, 3), '3 days');
  assert.equal(formatDeliveryWindow(1, 1), '1 day');
});

test('formatPesewas matches web formatting (GH₵, two decimals)', () => {
  assert.equal(formatPesewas(1250), 'GH₵12.50');
  assert.equal(formatPesewas(0), 'GH₵0.00');
});
