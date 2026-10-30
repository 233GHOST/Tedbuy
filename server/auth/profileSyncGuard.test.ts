import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILE_EXISTS_ERROR,
  decideProfileSync,
  preserveExistingProfileFields,
} from './profileSyncGuard.js';

const existing = {
  joinDate: 'Mar 2025',
  createdAt: '2025-03-04T10:00:00.000Z',
  welcomeSent: true,
  phoneNumber: '0241234567',
  whatsAppNumber: '0241234567',
  photoUrl: 'https://img/old.png',
  bio: 'Old bio',
  savedProductIds: ['p1', 'p2'],
};

// --- decideProfileSync ---

test('existing row + request joinDate differs -> refuse PROFILE_EXISTS', () => {
  const r = decideProfileSync({ existingReadFailed: false, existing, request: { joinDate: 'Oct 2026' } });
  assert.deepEqual(r, { ok: false, status: 409, code: 'PROFILE_EXISTS', error: PROFILE_EXISTS_ERROR });
  assert.equal(PROFILE_EXISTS_ERROR, 'Your profile already exists. Please reopen the app to load it.');
});

test('existing row + same joinDate -> allow', () => {
  const r = decideProfileSync({ existingReadFailed: false, existing, request: { joinDate: 'Mar 2025' } });
  assert.deepEqual(r, { ok: true });
});

test('existing row + request without joinDate -> allow (cannot judge)', () => {
  assert.deepEqual(decideProfileSync({ existingReadFailed: false, existing, request: {} }), { ok: true });
  assert.deepEqual(decideProfileSync({ existingReadFailed: false, existing, request: { joinDate: '' } }), { ok: true });
});

test('no existing row -> allow', () => {
  const r = decideProfileSync({ existingReadFailed: false, existing: null, request: { joinDate: 'Oct 2026' } });
  assert.deepEqual(r, { ok: true });
});

test('existing row without joinDate -> allow (cannot judge)', () => {
  const r = decideProfileSync({ existingReadFailed: false, existing: { ...existing, joinDate: null }, request: { joinDate: 'Oct 2026' } });
  assert.deepEqual(r, { ok: true });
});

test('stored server default "Joined recently" still counts as a saved joinDate', () => {
  const row = { ...existing, joinDate: 'Joined recently' };
  assert.equal(decideProfileSync({ existingReadFailed: false, existing: row, request: { joinDate: 'Oct 2026' } }).ok, false);
  assert.equal(decideProfileSync({ existingReadFailed: false, existing: row, request: { joinDate: 'Joined recently' } }).ok, true);
});

test('existing-row read failed -> refuse with 500, never treated as a brand-new row', () => {
  const r = decideProfileSync({ existingReadFailed: true, existing: null, request: { joinDate: 'Oct 2026' } }) as any;
  assert.equal(r.ok, false);
  assert.equal(r.status, 500);
  assert.equal(r.code, undefined);
});

// --- preserveExistingProfileFields ---

const clean = () => ({
  id: 'u1',
  username: 'Ama',
  phoneNumber: null as string | null,
  whatsAppNumber: null as string | null,
  photoUrl: null as string | null,
  joinDate: 'Joined recently',
  createdAt: '2026-10-30T00:00:00.000Z',
  welcomeSent: false,
  savedProductIds: [] as string[],
});

test('no existing row -> nothing preserved, row unchanged', () => {
  const c = clean();
  assert.deepEqual(preserveExistingProfileFields(c, null), clean());
});

test('joinDate and createdAt keep the existing values', () => {
  const out = preserveExistingProfileFields({ ...clean(), joinDate: 'Oct 2026' }, existing);
  assert.equal(out.joinDate, 'Mar 2025');
  assert.equal(out.createdAt, '2025-03-04T10:00:00.000Z');
});

test('joinDate/createdAt taken from the request when the existing row has none', () => {
  const out = preserveExistingProfileFields(clean(), { ...existing, joinDate: '', createdAt: null });
  assert.equal(out.joinDate, 'Joined recently');
  assert.equal(out.createdAt, '2026-10-30T00:00:00.000Z');
});

test('welcomeSent never goes true -> false', () => {
  assert.equal(preserveExistingProfileFields(clean(), existing).welcomeSent, true);
  assert.equal(preserveExistingProfileFields({ ...clean(), welcomeSent: true }, { ...existing, welcomeSent: false }).welcomeSent, true);
  assert.equal(preserveExistingProfileFields(clean(), { ...existing, welcomeSent: false }).welcomeSent, false);
});

test('phone/whatsApp/photoUrl are NOT kept when absent: every client clears them by omitting the key', () => {
  const out = preserveExistingProfileFields(clean(), existing);
  assert.equal(out.phoneNumber, null);
  assert.equal(out.whatsAppNumber, null);
  assert.equal(out.photoUrl, null);
});

test('bio absent from the row object stays absent (column untouched by the upsert)', () => {
  const out = preserveExistingProfileFields(clean(), existing) as any;
  assert.equal('bio' in out, false);
});

test("explicit '' bio still clears", () => {
  const out = preserveExistingProfileFields({ ...clean(), bio: '' }, existing) as any;
  assert.equal(out.bio, '');
});

test('savedProductIds left as sent: web prunes saved items through sync, so [] can be legitimate', () => {
  const out = preserveExistingProfileFields(clean(), existing);
  assert.deepEqual(out.savedProductIds, []);
});

test('does not mutate its input', () => {
  const c = { ...clean(), joinDate: 'Oct 2026' };
  preserveExistingProfileFields(c, existing);
  assert.equal(c.joinDate, 'Oct 2026');
  assert.equal(c.welcomeSent, false);
});
