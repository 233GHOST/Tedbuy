import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEmailSecure, validatePasswordStrength, validateUsernameSecure, validatePhoneSecure } from './registrationValidation.ts';

// This file has zero imports of its own, so it's safe to import directly,
// and is genuinely shared (not duplicated) between the client (Navbar.tsx,
// immediate UI feedback) and server.ts (the actual registration
// enforcement, imported via ./src/utils/registrationValidation.js) -- a bug
// here affects both the client hint and the real server-side gate. Had
// zero test coverage before now despite that reach.

test('validateEmailSecure: a normal, real-looking email is valid', () => {
  assert.equal(validateEmailSecure('user@example.com').isValid, true);
});

test('validateEmailSecure: missing or non-string email is rejected', () => {
  assert.equal(validateEmailSecure('').isValid, false);
  assert.equal(validateEmailSecure(undefined as any).isValid, false);
});

test('validateEmailSecure: malformed email format is rejected', () => {
  assert.equal(validateEmailSecure('not-an-email').isValid, false);
  assert.equal(validateEmailSecure('missing@domain').isValid, false);
  assert.equal(validateEmailSecure('@missinglocal.com').isValid, false);
});

test('validateEmailSecure: known disposable email domains are rejected', () => {
  assert.equal(validateEmailSecure('someone@mailinator.com').isValid, false);
  assert.equal(validateEmailSecure('someone@10minutemail.com').isValid, false);
  assert.equal(validateEmailSecure('someone@yopmail.com').isValid, false);
});

test('validateEmailSecure: disposable-domain check is case-insensitive (email is lowercased first)', () => {
  assert.equal(validateEmailSecure('Someone@MAILINATOR.COM').isValid, false);
});

test('validateEmailSecure: a domain merely containing a suspicious keyword is also rejected', () => {
  assert.equal(validateEmailSecure('user@my-tempmail-service.com').isValid, false);
});

test('validatePasswordStrength: a genuinely strong password passes', () => {
  assert.equal(validatePasswordStrength('Str0ng!Pass').isValid, true);
});

test('validatePasswordStrength: too short is rejected', () => {
  assert.equal(validatePasswordStrength('Sh0rt!').isValid, false);
});

test('validatePasswordStrength: missing uppercase/lowercase/number/special are each individually rejected', () => {
  assert.equal(validatePasswordStrength('nouppercase1!').isValid, false);
  assert.equal(validatePasswordStrength('NOLOWERCASE1!').isValid, false);
  assert.equal(validatePasswordStrength('NoNumberHere!').isValid, false);
  assert.equal(validatePasswordStrength('NoSpecialChar1').isValid, false);
});

test('validatePasswordStrength: missing or non-string password is rejected', () => {
  assert.equal(validatePasswordStrength('').isValid, false);
  assert.equal(validatePasswordStrength(undefined as any).isValid, false);
});

test('validateUsernameSecure: a normal alphanumeric username is valid', () => {
  assert.equal(validateUsernameSecure('vince_store-1').isValid, true);
});

test('validateUsernameSecure: too short (under 3) or too long (over 30) is rejected', () => {
  assert.equal(validateUsernameSecure('ab').isValid, false);
  assert.equal(validateUsernameSecure('a'.repeat(31)).isValid, false);
});

test('validateUsernameSecure: exactly 3 and exactly 30 characters are both valid (boundary)', () => {
  assert.equal(validateUsernameSecure('abc').isValid, true);
  assert.equal(validateUsernameSecure('a'.repeat(30)).isValid, true);
});

test('validateUsernameSecure: spaces or punctuation outside [a-zA-Z0-9_-] are rejected', () => {
  assert.equal(validateUsernameSecure('John Doe').isValid, false);
  assert.equal(validateUsernameSecure("O'Brien").isValid, false);
  assert.equal(validateUsernameSecure('user@name').isValid, false);
});

test('validatePhoneSecure: a Ghana local number (0XXXXXXXXX, 10 digits) is valid', () => {
  assert.equal(validatePhoneSecure('0241234567').isValid, true);
});

test('validatePhoneSecure: a Ghana international number (+233XXXXXXXXX, 13 chars) is valid', () => {
  assert.equal(validatePhoneSecure('+233241234567').isValid, true);
});

test('validatePhoneSecure: a local number with the wrong digit count is rejected', () => {
  assert.equal(validatePhoneSecure('024123456').isValid, false); // 9 digits, not 10
  assert.equal(validatePhoneSecure('02412345678').isValid, false); // 11 digits
});

test('validatePhoneSecure: an international number with the wrong length is rejected', () => {
  assert.equal(validatePhoneSecure('+23324123456').isValid, false); // 12 chars, not 13
});

test('validatePhoneSecure: non-numeric characters are rejected', () => {
  assert.equal(validatePhoneSecure('024-123-4567').isValid, false);
});

test('validatePhoneSecure: missing or non-string phone is rejected', () => {
  assert.equal(validatePhoneSecure('').isValid, false);
  assert.equal(validatePhoneSecure(undefined as any).isValid, false);
});
