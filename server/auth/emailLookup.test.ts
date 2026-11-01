import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exactIlikePattern, sameEmail, pickEmailMatch } from './emailLookup.js';

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

test('pickEmailMatch: duplicate rows in different capitals pick one instead of failing', () => {
  const rows = [
    { id: 'a', email: 'Ama@Gmail.com', isDeleted: false },
    { id: 'b', email: 'ama@gmail.com', isDeleted: false },
  ];
  assert.equal(pickEmailMatch(rows, 'ama@gmail.com')?.id, 'b', 'exact spelling wins');
  assert.equal(pickEmailMatch(rows, 'AMA@GMAIL.COM')?.id, 'a', 'otherwise the first active row');
  assert.equal(pickEmailMatch([{ id: 'x', email: 'ama@gmail.com', isDeleted: true }, { id: 'y', email: 'Ama@gmail.com' }], 'AMA@gmail.com')?.id, 'y', 'active beats deleted');
  assert.equal(pickEmailMatch([], 'ama@gmail.com'), null);
  assert.equal(pickEmailMatch([{ id: 'z', email: 'other@gmail.com' }], 'ama@gmail.com'), null, 'never a different address');
});

test('pickEmailMatch: a live account beats a deleted one even when the deleted one is spelled exactly', () => {
  const rows = [
    { id: 'x', email: 'ama@gmail.com', isDeleted: true },
    { id: 'y', email: 'Ama@Gmail.com', isDeleted: false },
  ];
  assert.equal(pickEmailMatch(rows, 'ama@gmail.com')?.id, 'y');
  assert.equal(pickEmailMatch([{ id: 'x', email: 'ama@gmail.com', status: 'deleted' }], 'ama@gmail.com')?.id, 'x', 'only deleted: still found (admins can see it)');
});
