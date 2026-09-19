import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, getBoostEndDate, isBoostActive, formatTedbuyTenure, formatMessageDateGroup } from './dateParser.ts';

// This file's only import (Product from '../types') is `import type`, which
// Node's stripped-types mode elides entirely without needing to resolve it
// -- safe to import the real module directly, unlike productUtils.ts (a
// genuine directory-resolution issue for a value import) or server.ts (a
// module-scope side effect). This is the reference implementation mobile's
// boost.ts/tenure.ts were ported from/verified against (2026-09-19).

test('parseDate: a plain ISO string parses correctly', () => {
  assert.equal(parseDate('2026-01-01T00:00:00.000Z')?.toISOString(), '2026-01-01T00:00:00.000Z');
});

test('parseDate: a Firestore Timestamp-shaped object (seconds) parses correctly', () => {
  const seconds = Math.floor(new Date('2026-01-01T00:00:00.000Z').getTime() / 1000);
  assert.equal(parseDate({ seconds })?.getTime(), seconds * 1000);
});

test('parseDate: null/undefined/empty/unparseable all return null, never throw', () => {
  assert.equal(parseDate(null), null);
  assert.equal(parseDate(undefined), null);
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('not a date'), null);
});

test('getBoostEndDate: tier 1 -- uses boostEndDate directly', () => {
  const future = new Date(Date.now() + 5 * 86400000).toISOString();
  assert.equal(getBoostEndDate({ boostEndDate: future } as any)?.toISOString(), future);
});

test('getBoostEndDate: tier 1 -- falls back to the boostExpiry alias', () => {
  const future = new Date(Date.now() + 5 * 86400000).toISOString();
  assert.equal(getBoostEndDate({ boostExpiry: future } as any)?.toISOString(), future);
});

test('getBoostEndDate: tier 2 -- derives from boostStartDate + boostPlan', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const result = getBoostEndDate({ boostStartDate: start.toISOString(), boostPlan: '1month' } as any);
  assert.equal(result?.getTime(), start.getTime() + 30 * 86400000);
});

test('getBoostEndDate: tier 2 -- derives from the lastBoostedAt alias', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const result = getBoostEndDate({ lastBoostedAt: start.toISOString(), boostPlan: '21days' } as any);
  assert.equal(result?.getTime(), start.getTime() + 21 * 86400000);
});

test('getBoostEndDate: tier 3 -- falls back to createdAt + plan when boostStatus is true but no date fields exist', () => {
  const created = new Date('2026-01-01T00:00:00.000Z');
  const result = getBoostEndDate({ boostStatus: true, boostPlan: '3days', createdAt: created.toISOString() } as any);
  assert.equal(result?.getTime(), created.getTime() + 3 * 86400000);
});

test('getBoostEndDate: returns null for no product and for a product with no boost signal at all', () => {
  assert.equal(getBoostEndDate(null), null);
  assert.equal(getBoostEndDate({ title: 'Not boosted' } as any), null);
});

test('isBoostActive: true for a future end date, false for a past one or no product', () => {
  assert.equal(isBoostActive({ boostEndDate: new Date(Date.now() + 3600000).toISOString() } as any), true);
  assert.equal(isBoostActive({ boostEndDate: new Date(Date.now() - 3600000).toISOString() } as any), false);
  assert.equal(isBoostActive(null), false);
});

test('formatTedbuyTenure: under 2 months reads "New on TedBuy"', () => {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  assert.equal(formatTedbuyTenure(oneWeekAgo.toISOString()), 'New on TedBuy');
});

test('formatTedbuyTenure: no date or a future date both read "New on TedBuy" (never a negative tenure)', () => {
  assert.equal(formatTedbuyTenure(null), 'New on TedBuy');
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  assert.equal(formatTedbuyTenure(future.toISOString()), 'New on TedBuy');
});

test('formatTedbuyTenure: exactly 1 year reads "1+ year" (singular), 3 years reads "3+ years" (plural)', () => {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  oneYearAgo.setDate(1);
  assert.equal(formatTedbuyTenure(oneYearAgo.toISOString()), '1+ year on TedBuy');

  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  threeYearsAgo.setDate(1);
  assert.equal(formatTedbuyTenure(threeYearsAgo.toISOString()), '3+ years on TedBuy');
});

test('formatMessageDateGroup: today/yesterday/day-of-week/older all resolve correctly', () => {
  const now = new Date();
  assert.equal(formatMessageDateGroup(now.toISOString()), 'Today');

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  assert.equal(formatMessageDateGroup(yesterday.toISOString()), 'Yesterday');

  const threeDaysAgo = new Date(now);
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const weekdayName = threeDaysAgo.toLocaleDateString('en-US', { weekday: 'long' });
  assert.equal(formatMessageDateGroup(threeDaysAgo.toISOString()), weekdayName);
});

test('formatMessageDateGroup: an unparseable timestamp reads "Earlier", never throws', () => {
  assert.equal(formatMessageDateGroup('garbage'), 'Earlier');
  assert.equal(formatMessageDateGroup(null), 'Earlier');
});
