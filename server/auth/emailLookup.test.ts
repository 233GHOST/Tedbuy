import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exactIlikePattern, sameEmail } from './emailLookup.js';

test('plain email is unchanged', () => {
  assert.equal(exactIlikePattern('ama@gmail.com'), 'ama@gmail.com');
});
test('% and _ are escaped so they match only themselves', () => {
  assert.equal(exactIlikePattern('a_b%c@x.com'), 'a\\_b\\%c@x.com');
});
test('backslash is escaped', () => {
  assert.equal(exactIlikePattern('a\\b@x.com'), 'a\\\\b@x.com');
});
test('* cannot be escaped for PostgREST -> null', () => {
  assert.equal(exactIlikePattern('a*b@x.com'), null);
});
test('sameEmail ignores case and spaces, rejects others', () => {
  assert.equal(sameEmail('Ama@Gmail.com', 'ama@gmail.com'), true);
  assert.equal(sameEmail(' ama@gmail.com ', 'AMA@gmail.com'), true);
  assert.equal(sameEmail('amb@gmail.com', 'ama@gmail.com'), false);
  assert.equal(sameEmail(undefined, 'ama@gmail.com'), false);
});
