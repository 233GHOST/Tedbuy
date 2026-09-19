import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInputLength, validateStoreName } from './inputValidation.ts';

// This module's default export (DOMPurify) needs a real DOM and throws
// under plain Node ("DOMPurify.sanitize is not a function", confirmed
// empirically) -- sanitizeText() itself is out of scope for this test
// runner. validateInputLength/validateStoreName don't touch DOMPurify at
// all, so importing the module and testing just those two is safe.

test('validateInputLength: text within [minLen, maxLen] is valid', () => {
  assert.equal(validateInputLength('hello', 10, 2).isValid, true);
});

test('validateInputLength: text shorter than minLen is rejected', () => {
  const result = validateInputLength('h', 10, 3);
  assert.equal(result.isValid, false);
  assert.match(result.error || '', /at least 3/);
});

test('validateInputLength: text longer than maxLen is rejected', () => {
  const result = validateInputLength('a'.repeat(11), 10);
  assert.equal(result.isValid, false);
  assert.match(result.error || '', /cannot exceed 10/i);
});

test('validateInputLength: empty/falsy text is treated as length 0', () => {
  assert.equal(validateInputLength('', 10, 0).isValid, true);
  assert.equal(validateInputLength(undefined as any, 10, 0).isValid, true);
});

test('validateInputLength: boundary lengths (exactly minLen/maxLen) are valid', () => {
  assert.equal(validateInputLength('abc', 3, 3).isValid, true);
});

test('validateStoreName: a normal alphanumeric name with spaces/hyphens/underscores is valid', () => {
  assert.equal(validateStoreName('Vince Store-1_shop').isValid, true);
});

test('validateStoreName: empty or whitespace-only name is rejected', () => {
  assert.equal(validateStoreName('').isValid, false);
  assert.equal(validateStoreName('   ').isValid, false);
});

test('validateStoreName: shorter than 3 or longer than 30 characters (after trim) is rejected', () => {
  assert.equal(validateStoreName('ab').isValid, false);
  assert.equal(validateStoreName('a'.repeat(31)).isValid, false);
});

test('validateStoreName: exactly 3 and exactly 30 characters are both valid (boundary)', () => {
  assert.equal(validateStoreName('abc').isValid, true);
  assert.equal(validateStoreName('a'.repeat(30)).isValid, true);
});

test('validateStoreName: punctuation outside the allowed set is rejected', () => {
  assert.equal(validateStoreName("Vince's Store").isValid, false);
  assert.equal(validateStoreName('Store@Home').isValid, false);
  assert.equal(validateStoreName('Store!').isValid, false);
});

test('validateStoreName: leading/trailing whitespace is trimmed before length/pattern checks', () => {
  assert.equal(validateStoreName('  Valid Name  ').isValid, true);
});
