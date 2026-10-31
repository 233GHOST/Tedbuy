import test from 'node:test';
import assert from 'node:assert/strict';
import { redactUserSecrets } from './redactUser.js';

test('user rows sent to clients never carry passwords or push tokens', () => {
  const out = redactUserSecrets({ id: 'u1', username: 'Ama', password: 'x', password_hash: 'y',
    pushToken: 'ExponentPushToken[abc]', pushTokenPlatform: 'android', pushTokenUpdatedAt: '2026-10-31' }) as any;
  assert.deepEqual(out, { id: 'u1', username: 'Ama' });
});

test('null and non-objects pass through', () => {
  assert.equal(redactUserSecrets(null), null);
  assert.equal(redactUserSecrets(undefined), undefined);
});
