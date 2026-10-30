import test from 'node:test';
import assert from 'node:assert/strict';
import { isEmailIdentifier, normalizeOtpInput, RESERVED_REGISTRATION_EMAIL, RESERVED_EMAIL_MESSAGE, isMergeableProfile } from './authFlow.ts';

test('isEmailIdentifier: only values containing @ are emails', () => {
  assert.equal(isEmailIdentifier('a@b.com'), true);
  assert.equal(isEmailIdentifier('0241234567'), false);
  assert.equal(isEmailIdentifier(' nana_gadgets '), false);
});

test('normalizeOtpInput: keeps digits only, max 6', () => {
  assert.equal(normalizeOtpInput('12 34-56'), '123456');
  assert.equal(normalizeOtpInput('1234567'), '123456');
});

test('reserved email message names the reserved address', () => {
  assert.ok(RESERVED_EMAIL_MESSAGE.includes(RESERVED_REGISTRATION_EMAIL));
});

test('isMergeableProfile: only a different, non-deleted profile', () => {
  assert.equal(isMergeableProfile({ id: 'old' }, 'new'), true);
  assert.equal(isMergeableProfile({ id: 'new' }, 'new'), false);
  assert.equal(isMergeableProfile({ id: 'old', isDeleted: true }, 'new'), false);
  assert.equal(isMergeableProfile({ id: 'old', status: 'deleted' }, 'new'), false);
  assert.equal(isMergeableProfile(null, 'new'), false);
  assert.equal(isMergeableProfile({}, 'new'), false);
});
