import test from 'node:test';
import assert from 'node:assert/strict';
import { orderRouteFromPush } from './orderPush.ts';
import { embedUrl } from './webHandoff.ts';

const ID = '3a9241b3-0000-4000-8000-000000000001';

test('a buyer order push opens My orders on that order', () => {
  assert.deepEqual(orderRouteFromPush({ type: 'dropship_order_buyer', relatedId: ID }), { screen: 'OrdersWeb', params: { orderId: ID, as: 'buyer' } });
});

test('reseller, supplier and older order pushes open Dropship', () => {
  assert.deepEqual(orderRouteFromPush({ type: 'dropship_order_reseller', relatedId: ID }), { screen: 'DropshipWeb', params: { orderId: ID, as: 'reseller' } });
  assert.deepEqual(orderRouteFromPush({ type: 'dropship_order_supplier', relatedId: ID }), { screen: 'DropshipWeb', params: { orderId: ID, as: 'supplier' } });
  assert.deepEqual(orderRouteFromPush({ type: 'dropship_order', relatedId: ID }), { screen: 'DropshipWeb', params: { orderId: ID } });
});

test('other pushes, or an order push without a valid id, open nothing', () => {
  assert.equal(orderRouteFromPush({ type: 'new_message', relatedId: ID }), null);
  assert.equal(orderRouteFromPush({ type: 'dropship_order_buyer', relatedId: 'x"><script>' }), null);
  assert.equal(orderRouteFromPush(undefined), null);
});

test('embedUrl adds the order to the start page', () => {
  assert.equal(embedUrl('orders'), 'https://www.tedbuy.store/orders?embed=app');
  assert.equal(embedUrl('dropship'), 'https://www.tedbuy.store/dropship?embed=app');
  assert.equal(embedUrl('orders', ID, 'buyer'), `https://www.tedbuy.store/orders?embed=app&order=${ID}&as=buyer`);
  assert.equal(embedUrl('dropship', ID), `https://www.tedbuy.store/dropship?embed=app&order=${ID}`);
  assert.equal(embedUrl('dropship', 'not-an-id', 'reseller'), 'https://www.tedbuy.store/dropship?embed=app');
});
