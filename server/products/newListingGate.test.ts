import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideNewListing, EMAIL_NOT_VERIFIED_CODE, EMAIL_NOT_VERIFIED_MESSAGE, ACCOUNT_CHECK_FAILED_MESSAGE } from './newListingGate.js';

test('editing an existing listing is allowed even when unverified', () => {
  assert.deepEqual(decideNewListing({ isNewListing: false, emailVerified: false }), { ok: true });
});
test('new listing from a verified account is allowed', () => {
  assert.deepEqual(decideNewListing({ isNewListing: true, emailVerified: true }), { ok: true });
});
test('new listing from an unverified account -> 403 EMAIL_NOT_VERIFIED', () => {
  assert.deepEqual(decideNewListing({ isNewListing: true, emailVerified: false }), {
    ok: false,
    status: 403,
    code: EMAIL_NOT_VERIFIED_CODE,
    error: EMAIL_NOT_VERIFIED_MESSAGE,
  });
  assert.equal(EMAIL_NOT_VERIFIED_CODE, 'EMAIL_NOT_VERIFIED');
  assert.equal(EMAIL_NOT_VERIFIED_MESSAGE, 'Please verify your email address before posting a new ad.');
});
test('new listing when the verified lookup failed -> 503, not EMAIL_NOT_VERIFIED', () => {
  assert.deepEqual(decideNewListing({ isNewListing: true, emailVerified: null }), {
    ok: false,
    status: 503,
    error: 'Could not confirm your account right now. Please try again.',
  });
  assert.equal(ACCOUNT_CHECK_FAILED_MESSAGE, 'Could not confirm your account right now. Please try again.');
});
test('editing is allowed even when the verified lookup failed', () => {
  assert.deepEqual(decideNewListing({ isNewListing: false, emailVerified: null }), { ok: true });
});
