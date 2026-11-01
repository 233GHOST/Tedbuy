import test from 'node:test';
import assert from 'node:assert/strict';
import { pushDeliveryOptions } from './pushOptions.js';

test('order pushes use the Orders channel at high priority', () => {
  assert.deepEqual(pushDeliveryOptions('dropship_order_buyer'), { channelId: 'orders', priority: 'high' });
});

test('everything else uses the default channel at normal priority', () => {
  assert.deepEqual(pushDeliveryOptions('new_follower'), { channelId: 'default', priority: 'normal' });
  assert.deepEqual(pushDeliveryOptions(undefined), { channelId: 'default', priority: 'normal' });
});
