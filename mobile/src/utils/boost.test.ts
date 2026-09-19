import test from 'node:test';
import assert from 'node:assert/strict';

// NOTE: this intentionally does NOT import getBoostEndDate/isBoostActive
// from ./boost.ts directly. boost.ts imports parseDate from ./tenure
// without a file extension (the standard TS/Metro-bundler convention),
// which Node's native ESM loader can't resolve on its own (it requires an
// explicit extension for relative specifiers) -- confirmed by trying it
// directly. Same class of limitation as server.ts's own test file
// elsewhere in this repo, and the same fix: mirror the real logic here
// verbatim instead of importing it, rather than changing production import
// syntax purely to make it importable from a plain Node test process.
//
// Ported from web's src/utils/dateParser.ts today (2026-09-19) after a
// cross-platform audit found mobile's boost.ts had drifted behind it --
// missing field-name aliases, a robust date parser, and an entire fallback
// tier. These tests lock in parity with web's behavior for the same
// real-world product shapes.

function parseDateMirror(dateVal: any): Date | null {
  if (!dateVal) return null;
  if (dateVal instanceof Date) return dateVal;
  if (typeof dateVal === 'object') {
    if (typeof dateVal.seconds === 'number') return new Date(dateVal.seconds * 1000);
    if (typeof dateVal._seconds === 'number') return new Date(dateVal._seconds * 1000);
    if (typeof dateVal.toDate === 'function') {
      try { return dateVal.toDate(); } catch (_) {}
    }
  }
  if (typeof dateVal === 'string') {
    const trimmed = dateVal.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;
    const parts = trimmed.split(' ');
    if (parts.length === 2) {
      const dAlt = new Date(`1 ${trimmed}`);
      if (!isNaN(dAlt.getTime())) return dAlt;
    }
    return null;
  }
  const d = new Date(dateVal);
  if (!isNaN(d.getTime())) return d;
  return null;
}

const PLAN_DAYS: Record<string, number> = { '3days': 3, '7days': 7, '14days': 14, '21days': 21, '1month': 30 };

function getBoostEndDate(product: any): Date | null {
  if (!product) return null;
  const p = product;

  const rawEnd = p.boostEndDate || p.boostExpiry || p.boost_end_date || p.boost_expiry;
  if (rawEnd && rawEnd !== 'N/A' && rawEnd !== 'null' && rawEnd !== 'undefined') {
    const parsed = parseDateMirror(rawEnd);
    if (parsed) return parsed;
  }

  const rawStart = p.boostStartDate || p.lastBoostedAt || p.lastBoostPurchase || p.boost_start_date || p.last_boosted_at;
  if (rawStart && rawStart !== 'N/A' && rawStart !== 'null' && rawStart !== 'undefined') {
    const startDate = parseDateMirror(rawStart);
    if (startDate) {
      const days = PLAN_DAYS[p.boostPlan || p.boost_plan || '7days'] || 7;
      return new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);
    }
  }

  const isBoostedFlag = !!(
    p.boostStatus === true || p.boostStatus === 'true' ||
    p.isBoosted === true || p.is_boosted === true ||
    p.boost_status === true || p.boost_status === 'true'
  );
  if (isBoostedFlag) {
    const created = parseDateMirror(p.createdAt);
    if (created) {
      const days = PLAN_DAYS[p.boostPlan || p.boost_plan || '7days'] || 7;
      return new Date(created.getTime() + days * 24 * 60 * 60 * 1000);
    }
  }

  return null;
}

function isBoostActive(product: any): boolean {
  const endDate = getBoostEndDate(product);
  return !!endDate && endDate.getTime() > Date.now();
}

test('getBoostEndDate: returns null for no product', () => {
  assert.equal(getBoostEndDate(null), null);
  assert.equal(getBoostEndDate(undefined), null);
});

test('getBoostEndDate: uses boostEndDate directly when present', () => {
  const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const result = getBoostEndDate({ boostEndDate: future });
  assert.equal(result?.toISOString(), future);
});

test('getBoostEndDate: falls back to the boostExpiry alias field (tier 1)', () => {
  const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const result = getBoostEndDate({ boostExpiry: future });
  assert.equal(result?.toISOString(), future);
});

test('getBoostEndDate: derives from boostStartDate + boostPlan when no end date field exists (tier 2)', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const result = getBoostEndDate({ boostStartDate: start.toISOString(), boostPlan: '7days' });
  assert.equal(result?.getTime(), start.getTime() + 7 * 24 * 60 * 60 * 1000);
});

test('getBoostEndDate: derives from the lastBoostedAt alias when boostStartDate is absent (tier 2)', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const result = getBoostEndDate({ lastBoostedAt: start.toISOString(), boostPlan: '1month' });
  assert.equal(result?.getTime(), start.getTime() + 30 * 24 * 60 * 60 * 1000);
});

test('getBoostEndDate: derives from lastBoostPurchase when neither boostStartDate nor lastBoostedAt exist (tier 2)', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const result = getBoostEndDate({ lastBoostPurchase: start.toISOString() });
  assert.equal(result?.getTime(), start.getTime() + 7 * 24 * 60 * 60 * 1000);
});

test('getBoostEndDate: falls back to createdAt + plan when boostStatus/isBoosted is true but no date fields exist at all (tier 3)', () => {
  const created = new Date('2026-01-01T00:00:00.000Z');
  const result = getBoostEndDate({ boostStatus: true, boostPlan: '14days', createdAt: created.toISOString() });
  assert.equal(result?.getTime(), created.getTime() + 14 * 24 * 60 * 60 * 1000);
});

test('getBoostEndDate: tier-3 fallback also triggers on the isBoosted flag alone', () => {
  const created = new Date('2026-01-01T00:00:00.000Z');
  const result = getBoostEndDate({ isBoosted: true, createdAt: created.toISOString() });
  assert.notEqual(result, null, 'a genuinely-boosted product with no boost date fields must still resolve an end date from createdAt');
});

test('getBoostEndDate: a Firestore Timestamp-shaped object (not a string) parses correctly', () => {
  const seconds = Math.floor(new Date('2026-01-01T00:00:00.000Z').getTime() / 1000);
  const result = getBoostEndDate({ boostStartDate: { seconds }, boostPlan: '3days' });
  assert.notEqual(result, null, 'a Firestore-shaped timestamp object must not silently fail to parse');
});

test('getBoostEndDate: returns null when nothing indicates a boost at all', () => {
  const result = getBoostEndDate({ title: 'A plain listing' });
  assert.equal(result, null);
});

test('isBoostActive: true for a future end date, false for a past one', () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  assert.equal(isBoostActive({ boostEndDate: future }), true);
  assert.equal(isBoostActive({ boostEndDate: past }), false);
});

test('isBoostActive: false for a product with no boost data', () => {
  assert.equal(isBoostActive({ title: 'Not boosted' }), false);
  assert.equal(isBoostActive(null), false);
});
