import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationTarget, resolveOrderAudience } from './notificationTarget.ts';

test('order notices open the order for their audience; older ones have no audience', () => {
  assert.deepEqual(notificationTarget({ type: 'dropship_order_reseller', relatedId: 'o1' }), { kind: 'order', as: 'reseller', orderId: 'o1' });
  assert.deepEqual(notificationTarget({ type: 'dropship_order', relatedId: 'o1' }), { kind: 'order', as: null, orderId: 'o1' });
});

test('a notice with no type does not throw and opens nothing', () => {
  assert.deepEqual(notificationTarget({ type: null as any }), { kind: 'none' });
  assert.deepEqual(notificationTarget({} as any), { kind: 'none' });
});

test('other types keep their meaning', () => {
  assert.deepEqual(notificationTarget({ type: 'new_message', chatId: 'c1' }), { kind: 'chat', chatId: 'c1' });
  assert.deepEqual(notificationTarget({ type: 'new_follower', triggerUserId: 'u1' }), { kind: 'store', userId: 'u1' });
  assert.deepEqual(notificationTarget({ type: 'post_created', productId: 'p1' }), { kind: 'product', productId: 'p1' });
});

test('older order notices without an audience open My orders when the user is the buyer', async () => {
  const yes = async () => true, no = async () => false, boom = async () => { throw new Error('404'); };
  assert.equal(await resolveOrderAudience('reseller', 'o1', no), 'reseller', 'a known audience is kept');
  assert.equal(await resolveOrderAudience(null, 'o1', yes), 'buyer');
  assert.equal(await resolveOrderAudience(null, 'o1', no), null);
  assert.equal(await resolveOrderAudience(null, 'o1', boom), null);
});
