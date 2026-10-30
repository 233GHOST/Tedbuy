import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECKED_EMAIL_TTL_MS,
  createCheckedEmailStore,
  decideCompleteRegistration,
} from './registrationVerification.js';

test('markChecked then consume -> true, second consume -> false', () => {
  const s = createCheckedEmailStore();
  s.markChecked('a@b.com');
  assert.equal(s.consume('a@b.com'), true);
  assert.equal(s.consume('a@b.com'), false);
});
test('consume after TTL -> false', () => {
  let t = 1000;
  const s = createCheckedEmailStore(() => t);
  s.markChecked('a@b.com');
  t += CHECKED_EMAIL_TTL_MS + 1;
  assert.equal(s.has('a@b.com'), false);
  assert.equal(s.consume('a@b.com'), false);
});
test('case and spaces are ignored', () => {
  const s = createCheckedEmailStore();
  s.markChecked(' Ama@Gmail.com ');
  assert.equal(s.consume('ama@gmail.com'), true);
});
test('consume of an email never checked -> false', () => {
  assert.equal(createCheckedEmailStore().consume('x@y.com'), false);
});
test('has does not consume', () => {
  const s = createCheckedEmailStore();
  s.markChecked('a@b.com');
  assert.equal(s.has('a@b.com'), true);
  assert.equal(s.has('a@b.com'), true);
  assert.equal(s.consume('a@b.com'), true);
});
test('decide: verified null -> 401', () => {
  const r = decideCompleteRegistration({ verified: null, alreadyVerified: false, checked: true }) as any;
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});
test('decide: impersonating (flag, originalAdmin, or header) -> 403', () => {
  const base = { alreadyVerified: false, checked: true };
  assert.equal((decideCompleteRegistration({ ...base, verified: { uid: 'u', email: 'a@b.com', isImpersonating: true } }) as any).status, 403);
  assert.equal((decideCompleteRegistration({ ...base, verified: { uid: 'u', email: 'a@b.com', originalAdmin: { uid: 'a' } } }) as any).status, 403);
  assert.equal((decideCompleteRegistration({ ...base, verified: { uid: 'u', email: 'a@b.com' }, impersonationHeaderPresent: true }) as any).status, 403);
});
test('decide: no email on token -> 400', () => {
  const r = decideCompleteRegistration({ verified: { uid: 'u' }, alreadyVerified: false, checked: true }) as any;
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});
test('decide: alreadyVerified -> already-verified even when not checked', () => {
  assert.deepEqual(
    decideCompleteRegistration({ verified: { uid: 'u', email: 'a@b.com' }, alreadyVerified: true, checked: false }),
    { ok: true, action: 'already-verified' },
  );
});
test('decide: checked false -> 403', () => {
  assert.deepEqual(
    decideCompleteRegistration({ verified: { uid: 'u', email: 'a@b.com' }, alreadyVerified: false, checked: false }),
    { ok: false, status: 403, error: 'No checked sign-up code for this email. Request a new code.' },
  );
});
test('decide: checked true -> mark-verified', () => {
  assert.deepEqual(
    decideCompleteRegistration({ verified: { uid: 'u', email: 'a@b.com' }, alreadyVerified: false, checked: true }),
    { ok: true, action: 'mark-verified' },
  );
});
test('checked record lasts 15 minutes', () => {
  assert.equal(CHECKED_EMAIL_TTL_MS, 15 * 60 * 1000);
  let t = 0;
  const s = createCheckedEmailStore(() => t);
  s.markChecked('a@b.com');
  t += CHECKED_EMAIL_TTL_MS - 1;
  assert.equal(s.has('a@b.com'), true);
});
