import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from './slugify.ts';

test('slugify: lowercases and replaces spaces with hyphens', () => {
  assert.equal(slugify('iPhone 13 Pro Max'), 'iphone-13-pro-max');
});

test('slugify: strips punctuation/special characters', () => {
  assert.equal(slugify("Vince's Store & Co."), 'vinces-store-co');
});

test('slugify: collapses multiple consecutive hyphens into one', () => {
  assert.equal(slugify('too   many   spaces'), 'too-many-spaces');
});

test('slugify: trims leading/trailing hyphens', () => {
  assert.equal(slugify('  -leading and trailing-  '), 'leading-and-trailing');
});

test('slugify: empty or falsy input returns an empty string, never throws', () => {
  assert.equal(slugify(''), '');
  assert.equal(slugify(null as any), '');
  assert.equal(slugify(undefined as any), '');
});

test('slugify: a non-string (number) is coerced via toString()', () => {
  assert.equal(slugify(12345 as any), '12345');
});
