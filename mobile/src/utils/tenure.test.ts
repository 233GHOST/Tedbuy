import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, formatTedbuyTenure } from './tenure.ts';

// Confirmed byte-for-byte identical to web's src/utils/dateParser.ts
// equivalent while investigating the boost.ts drift bug (2026-09-19) --
// this file has zero imports, so it's safe to import directly here (unlike
// boost.ts, which pulls in a not-Node-loader-resolvable relative import).

test('parseDate: a plain ISO string parses correctly', () => {
  const d = parseDate('2026-01-01T00:00:00.000Z');
  assert.equal(d?.toISOString(), '2026-01-01T00:00:00.000Z');
});

test('parseDate: a Firestore Timestamp-shaped object (seconds) parses correctly', () => {
  const seconds = Math.floor(new Date('2026-01-01T00:00:00.000Z').getTime() / 1000);
  const d = parseDate({ seconds });
  assert.equal(d?.getTime(), seconds * 1000);
});

test('parseDate: an already-real Date instance is returned as-is', () => {
  const original = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(parseDate(original), original);
});

test('parseDate: null/undefined/empty string all return null', () => {
  assert.equal(parseDate(null), null);
  assert.equal(parseDate(undefined), null);
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('   '), null);
});

test('parseDate: a genuinely unparseable string returns null, not an Invalid Date', () => {
  assert.equal(parseDate('not a date at all'), null);
});

test('formatTedbuyTenure: a brand-new account (less than 2 months) reads "New on TedBuy"', () => {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  assert.equal(formatTedbuyTenure(oneWeekAgo.toISOString()), 'New on TedBuy');
});

test('formatTedbuyTenure: no join date at all reads "New on TedBuy" (never crashes)', () => {
  assert.equal(formatTedbuyTenure(null), 'New on TedBuy');
  assert.equal(formatTedbuyTenure(undefined), 'New on TedBuy');
});

test('formatTedbuyTenure: a join date in the future (clock skew / bad data) reads "New on TedBuy", not a negative tenure', () => {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  assert.equal(formatTedbuyTenure(future.toISOString()), 'New on TedBuy');
});

test('formatTedbuyTenure: 6 months ago reads "6+ months on TedBuy"', () => {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  sixMonthsAgo.setDate(1); // avoid month-boundary day-of-month flakiness
  assert.equal(formatTedbuyTenure(sixMonthsAgo.toISOString()), '6+ months on TedBuy');
});

test('formatTedbuyTenure: exactly 1 year ago reads "1+ year on TedBuy" (singular, not "1+ years")', () => {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  oneYearAgo.setDate(1);
  assert.equal(formatTedbuyTenure(oneYearAgo.toISOString()), '1+ year on TedBuy');
});

test('formatTedbuyTenure: 3 years ago reads "3+ years on TedBuy" (plural)', () => {
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  threeYearsAgo.setDate(1);
  assert.equal(formatTedbuyTenure(threeYearsAgo.toISOString()), '3+ years on TedBuy');
});
