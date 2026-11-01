import test from 'node:test';
import assert from 'node:assert/strict';
import { decideVerifiedAction } from './verifiedAction.js';

test('a verified account may chat, message and review', () => {
  assert.deepEqual(decideVerifiedAction({ action: 'message', adminFlag: true, tokenClaim: false }), { ok: true });
});

test('an unverified account is refused with a plain reason per action', () => {
  for (const [action, word] of [['chat', 'starting a chat'], ['message', 'sending messages'], ['review', 'writing a review']] as const) {
    const d = decideVerifiedAction({ action, adminFlag: false, tokenClaim: true });
    assert.equal(d.ok, false);
    assert.equal(d.status, 403);
    assert.equal(d.code, 'EMAIL_NOT_VERIFIED');
    assert.match(d.error ?? '', new RegExp(word));
  }
});

test('when Google cannot be asked, the signed token claim decides (no chat outage)', () => {
  assert.deepEqual(decideVerifiedAction({ action: 'chat', adminFlag: null, tokenClaim: true }), { ok: true });
  assert.equal(decideVerifiedAction({ action: 'chat', adminFlag: null, tokenClaim: false }).ok, false);
  assert.equal(decideVerifiedAction({ action: 'chat', adminFlag: null, tokenClaim: undefined }).ok, false);
});

test('admins (and admins acting for a user) are never blocked', () => {
  assert.deepEqual(decideVerifiedAction({ action: 'message', adminFlag: false, tokenClaim: false, isAdmin: true }), { ok: true });
});
