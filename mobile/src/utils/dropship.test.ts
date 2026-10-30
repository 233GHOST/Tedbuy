import test from 'node:test';
import assert from 'node:assert/strict';
import { isDropshipRowId, formatDeliveryWindow, formatPesewas, makeRequestId, deliveryDetailsProblem } from './dropship.ts';

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

test('makeRequestId is a v4 UUID the server accepts, and unique', () => {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ids = new Set(Array.from({ length: 200 }, () => makeRequestId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, re);
});

test('deliveryDetailsProblem', () => {
  const ok = { name: 'Ama B', phone: '055 123 4567', region: 'Ashanti', area: 'Adum', address: 'House 4, Main St' };
  assert.equal(deliveryDetailsProblem(ok), null);
  assert.match(deliveryDetailsProblem({ ...ok, phone: '12' })!, /phone/);
  assert.match(deliveryDetailsProblem({ ...ok, region: '' })!, /region/);
});
