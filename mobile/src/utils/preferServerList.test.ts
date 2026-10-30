import test from 'node:test';
import assert from 'node:assert/strict';
import { preferServerList, dropUnavailable } from './preferServerList.ts';

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

test('dropUnavailable removes locally sold/hidden items, passes null through', () => {
  const server = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const local = [{ id: 'a', isSold: true }, { id: 'b', status: 'hidden' }, { id: 'c' }];
  assert.deepEqual(dropUnavailable(server, local), [{ id: 'c' }]);
  assert.equal(dropUnavailable(null, local), null);
  assert.deepEqual(dropUnavailable([], local), []);
  assert.deepEqual(dropUnavailable(server, []), server);
});
