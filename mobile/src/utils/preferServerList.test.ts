import test from 'node:test';
import assert from 'node:assert/strict';
import { preferServerList } from './preferServerList.ts';

test('null server list falls back to local', () => {
  assert.deepEqual(preferServerList(null, [1, 2]), [1, 2]);
  assert.deepEqual(preferServerList(undefined, [1]), [1]);
});
test('empty server list wins (server said none)', () => {
  assert.deepEqual(preferServerList([], [1, 2]), []);
});
test('non-empty server list wins', () => {
  assert.deepEqual(preferServerList([3], [1, 2]), [3]);
});
