import test from 'node:test';
import assert from 'node:assert/strict';
import { isEmailIdentifier, normalizeOtpInput, RESERVED_REGISTRATION_EMAIL, RESERVED_EMAIL_MESSAGE, isMergeableProfile, nextProfileStep, classifyEmailMatch } from './authFlow.ts';

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

test('nextProfileStep: id lookup error fails, never creates', () => {
  assert.equal(nextProfileStep({ byId: 'error' }), 'fail');
});

test('nextProfileStep: id found uses the existing profile', () => {
  assert.equal(nextProfileStep({ byId: 'found' }), 'use-existing');
});

test('nextProfileStep: id not found asks for the email lookup', () => {
  assert.equal(nextProfileStep({ byId: 'not-found' }), 'lookup-email');
});

test('nextProfileStep: id not found + email lookup error fails', () => {
  assert.equal(nextProfileStep({ byId: 'not-found', byEmail: 'error' }), 'fail');
});

test('nextProfileStep: id not found + email not found creates fresh', () => {
  assert.equal(nextProfileStep({ byId: 'not-found', byEmail: 'not-found' }), 'create-fresh');
});

test('nextProfileStep: email found with the same uid uses the existing profile', () => {
  assert.equal(nextProfileStep({ byId: 'not-found', byEmail: 'found', emailMatch: 'same-uid' }), 'use-existing');
});

test('nextProfileStep: email found but deleted creates fresh', () => {
  assert.equal(nextProfileStep({ byId: 'not-found', byEmail: 'found', emailMatch: 'unmergeable' }), 'create-fresh');
});

test('nextProfileStep: mergeable profile is merged; a failed merge fails', () => {
  const base = { byId: 'not-found', byEmail: 'found', emailMatch: 'mergeable' } as const;
  assert.equal(nextProfileStep(base), 'merge');
  assert.equal(nextProfileStep({ ...base, merge: 'ok' }), 'merged');
  assert.equal(nextProfileStep({ ...base, merge: 'error' }), 'fail');
});

test('classifyEmailMatch: same uid, mergeable, deleted', () => {
  assert.equal(classifyEmailMatch({ id: 'u1' }, 'u1'), 'same-uid');
  assert.equal(classifyEmailMatch({ id: 'old' }, 'u1'), 'mergeable');
  assert.equal(classifyEmailMatch({ id: 'old', status: 'deleted' }, 'u1'), 'unmergeable');
});
