import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAppHandoff, isRestrictedUserRow } from './appHandoff.js';

test('no verified identity -> 401', () => {
  const r = decideAppHandoff({ verified: null, restricted: false });
  assert.deepEqual(r, { ok: false, status: 401, error: 'Unauthorized' });
});
test('impersonation -> 403', () => {
  assert.equal((decideAppHandoff({ verified: { uid: 'u', isImpersonating: true }, restricted: false }) as any).status, 403);
  assert.equal((decideAppHandoff({ verified: { uid: 'u', originalAdmin: { uid: 'a' } }, restricted: false }) as any).status, 403);
});
test('restricted -> 403', () => {
  assert.equal((decideAppHandoff({ verified: { uid: 'u' }, restricted: true }) as any).status, 403);
});
test('normal -> ok with verified uid', () => {
  assert.deepEqual(decideAppHandoff({ verified: { uid: 'u1' }, restricted: false }), { ok: true, uid: 'u1' });
});
test('isRestrictedUserRow', () => {
  assert.equal(isRestrictedUserRow(null), false);
  assert.equal(isRestrictedUserRow({ isSuspended: true }), true);
  assert.equal(isRestrictedUserRow({ securityHold: true }), true);
  assert.equal(isRestrictedUserRow({ isDeleted: true }), true);
  assert.equal(isRestrictedUserRow({ status: 'suspended' }), true);
  assert.equal(isRestrictedUserRow({ status: 'deleted' }), true);
  assert.equal(isRestrictedUserRow({ status: 'active', isSuspended: false }), false);
});
