import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideNewListing, EMAIL_NOT_VERIFIED_CODE, EMAIL_NOT_VERIFIED_MESSAGE } from './newListingGate.js';

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
