import test from 'node:test';
import assert from 'node:assert/strict';
import type { DropshipDb } from './db.js';
import { capListResponse, createLegacyGuards, isDropshipRowId } from './legacyGuards.js';

// Fake DB: counts calls so cache behaviour is observable.
function fakeDb(state: { hidden: string[]; supplierProductOf: Record<string, string>; protectedPublicIds?: string[]; usersWithRecords?: string[]; fail?: boolean }) {
  const calls: string[] = [];
  const argsSeen: Record<string, unknown>[] = [];
  const db: DropshipDb = {
    async call<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push(fn);
      argsSeen.push(args);
      if (state.fail) throw new Error('db down');
      if (fn === 'dropship_hidden_product_ids') return { hidden: state.hidden, supplierProductOf: state.supplierProductOf } as T;
      if (fn === 'dropship_is_protected_media') return (args.p_public_ids as string[]).filter(u => (state.protectedPublicIds ?? []).includes(u)) as T;
      if (fn === 'dropship_user_has_records') return (state.usersWithRecords ?? []).includes(args.p_user as string) as T;
      if (fn === 'dropship_remove_user_listings') return 2 as T;
      throw new Error(`unexpected ${fn}`);
    },
  };
  return { db, calls, args: argsSeen };
}

const rows = (...ids: string[]) => ids.map(id => ({ id }));
const ids = (r: { id: string }[]) => r.map(x => x.id);

test('isDropshipRowId', () => {
  assert.equal(isDropshipRowId('DSL_x'), true);
  assert.equal(isDropshipRowId('dsl_x'), true);
  assert.equal(isDropshipRowId('dslx'), false);
  assert.equal(isDropshipRowId(42), false);
  assert.equal(isDropshipRowId(null), false);
});

test('disabled or no db: every dsl_ row is hidden, ordinary rows kept', async () => {
  const { db, calls } = fakeDb({ hidden: [], supplierProductOf: {} });
  for (const g of [createLegacyGuards({ db, enabled: false }), createLegacyGuards({ db: null, enabled: true })]) {
    assert.deepEqual(ids(await g.filterVisible(rows('a', 'dsl_1', 'DSL_2', 'b'))), ['a', 'b']);
    assert.equal(await g.isVisibleProduct('dsl_1'), false);
    assert.equal(await g.isVisibleProduct('a'), true);
  }
  assert.equal(calls.length, 0);
});

test('enabled: hidden ids dropped, others kept', async () => {
  const { db } = fakeDb({ hidden: ['dsl_2'], supplierProductOf: { dsl_1: 's1', dsl_2: 's2' } });
  const g = createLegacyGuards({ db, enabled: true });
  assert.deepEqual(ids(await g.filterVisible(rows('a', 'dsl_1', 'dsl_2'))), ['a', 'dsl_1']);
  assert.equal(await g.isVisibleProduct('dsl_2'), false);
  assert.equal(await g.isVisibleProduct('dsl_1'), true);
  assert.equal(g.isLinkedProduct('dsl_1'), true);
  assert.equal(g.isLinkedProduct('a'), false);
});

test('filterVisible does visibility only: no per-supplier-product cap', async () => {
  const { db } = fakeDb({ hidden: [], supplierProductOf: { dsl_1: 's', dsl_2: 's', dsl_3: 's', dsl_4: 't' } });
  const g = createLegacyGuards({ db, enabled: true });
  assert.deepEqual(ids(await g.filterVisible(rows('dsl_3', 'x', 'dsl_1', 'dsl_4', 'dsl_2'))), ['dsl_3', 'x', 'dsl_1', 'dsl_4', 'dsl_2']);
});

test('capPerSupplierProduct keeps at most 2 listings per supplier product (first two in input order)', async () => {
  const { db } = fakeDb({ hidden: [], supplierProductOf: { dsl_1: 's', dsl_2: 's', dsl_3: 's', dsl_4: 't' } });
  const g = createLegacyGuards({ db, enabled: true });
  assert.deepEqual(ids(await g.capPerSupplierProduct(rows('dsl_3', 'x', 'dsl_1', 'dsl_4', 'dsl_2'))), ['dsl_3', 'x', 'dsl_1', 'dsl_4']);
  const plain = rows('a', 'b');
  assert.equal(await g.capPerSupplierProduct(plain), plain);
  // Disabled: no dsl_ row survives (nothing to cap).
  assert.deepEqual(ids(await createLegacyGuards({ db: null, enabled: false }).capPerSupplierProduct(rows('a', 'dsl_1'))), ['a']);
});

test('capListResponse: a seller-scoped list keeps the 3rd listing of one supplier product; the general feed caps at 2', async () => {
  const { db } = fakeDb({ hidden: [], supplierProductOf: { dsl_1: 's', dsl_2: 's', dsl_3: 's' } });
  const g = createLegacyGuards({ db, enabled: true });
  const list = rows('dsl_1', 'a', 'dsl_2', 'dsl_3');
  assert.deepEqual(ids(await capListResponse(list, { sellerId: 'u-ds' }, g)), ['dsl_1', 'a', 'dsl_2', 'dsl_3']);
  assert.deepEqual(ids(await capListResponse(list, { sellerEmail: 'ds@example.com' }, g)), ['dsl_1', 'a', 'dsl_2', 'dsl_3']);
  assert.deepEqual(ids(await capListResponse(list, {}, g)), ['dsl_1', 'a', 'dsl_2']);
  assert.deepEqual(ids(await capListResponse(list, { sellerId: '', sellerEmail: '' }, g)), ['dsl_1', 'a', 'dsl_2']);
});

test('DB error: dsl_ rows dropped, ordinary kept, logs at most once per minute', async () => {
  const state = { hidden: [] as string[], supplierProductOf: {}, fail: true };
  const { db } = fakeDb(state);
  let t = 1_000_000;
  const g = createLegacyGuards({ db, enabled: true, now: () => t });
  const logged: unknown[][] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { logged.push(a); };
  try {
    assert.deepEqual(ids(await g.filterVisible(rows('a', 'dsl_1'))), ['a']);
    assert.deepEqual(ids(await g.filterVisible(rows('a', 'dsl_1'))), ['a']);
    assert.equal(await g.isVisibleProduct('dsl_1'), false);
    assert.equal(logged.length, 1);
    t += 61_000;
    await g.filterVisible(rows('dsl_1'));
    assert.equal(logged.length, 2);
  } finally { console.error = orig; }
});

test('cache: reused within 60s, refreshed after 60s and after invalidate()', async () => {
  const state = { hidden: [] as string[], supplierProductOf: { dsl_1: 's' } as Record<string, string> };
  const { db, calls } = fakeDb(state);
  let t = 0;
  const g = createLegacyGuards({ db, enabled: true, now: () => t });
  assert.deepEqual(ids(await g.filterVisible(rows('dsl_1'))), ['dsl_1']);
  state.hidden = ['dsl_1'];
  t += 59_000;
  assert.deepEqual(ids(await g.filterVisible(rows('dsl_1'))), ['dsl_1']);
  assert.equal(calls.length, 1);
  t += 2_000;
  assert.deepEqual(ids(await g.filterVisible(rows('dsl_1'))), []);
  assert.equal(calls.length, 2);
  state.hidden = [];
  g.invalidate();
  assert.deepEqual(ids(await g.filterVisible(rows('dsl_1'))), ['dsl_1']);
  assert.equal(calls.length, 3);
});

test('filterProtectedMedia protects by publicId: transformed and version-less variants are protected; fails closed on DB error; no db => all deletable', async () => {
  const A = 'https://res.cloudinary.com/c/image/upload/v123/folder/abc.jpg';
  const A_TRANSFORMED = 'https://res.cloudinary.com/c/image/upload/w_10,h_10/c_fill/v123/folder/abc.jpg';
  const A_NO_VERSION = 'https://res.cloudinary.com/c/image/upload/folder/abc.png';
  const B = 'https://res.cloudinary.com/c/image/upload/v9/folder/b.jpg';
  const { db, args } = fakeDb({ hidden: [], supplierProductOf: {}, protectedPublicIds: ['folder/abc'] });
  const g = createLegacyGuards({ db, enabled: true });
  assert.deepEqual(await g.filterProtectedMedia([A, A_TRANSFORMED, B, A_NO_VERSION]), { deletable: [B], protected: [A, A_TRANSFORMED, A_NO_VERSION] });
  assert.deepEqual(args.at(-1), { p_public_ids: ['folder/abc', 'folder/b'] });
  assert.deepEqual(await g.filterProtectedMedia([]), { deletable: [], protected: [] });
  // A non-Cloudinary URL has no publicId: nothing to protect (and nothing a Cloudinary delete could reach).
  assert.deepEqual(await g.filterProtectedMedia(['https://example.com/x.jpg']), { deletable: ['https://example.com/x.jpg'], protected: [] });
  assert.equal(await g.isProtectedPublicId('folder/abc'), true);
  assert.equal(await g.isProtectedPublicId('folder/b'), false);

  const bad = createLegacyGuards({ db: fakeDb({ hidden: [], supplierProductOf: {}, fail: true }).db, enabled: true });
  const orig = console.error; console.error = () => {};
  try {
    assert.deepEqual(await bad.filterProtectedMedia([A, B]), { deletable: [], protected: [A, B] });
    assert.equal(await bad.isProtectedPublicId('folder/b'), true);
  } finally { console.error = orig; }
  // No Dropship DB (disabled/unconfigured): ordinary media deletion works as before.
  const none = createLegacyGuards({ db: null, enabled: false });
  assert.deepEqual(await none.filterProtectedMedia([A]), { deletable: [A], protected: [] });
  assert.equal(await none.isProtectedPublicId('folder/abc'), false);
});

test('userHasDropshipRecords: true/false from the DB; null when there is no DB or it errors', async () => {
  const { db } = fakeDb({ hidden: [], supplierProductOf: {}, usersWithRecords: ['u-ds'] });
  const g = createLegacyGuards({ db, enabled: true });
  assert.equal(await g.userHasDropshipRecords('u-ds'), true);
  assert.equal(await g.userHasDropshipRecords('u-plain'), false);
  // Disabled with a DB configured still answers (read-only check).
  assert.equal(await createLegacyGuards({ db, enabled: false }).userHasDropshipRecords('u-ds'), true);
  assert.equal(await createLegacyGuards({ db: null, enabled: false }).userHasDropshipRecords('u-ds'), null);
  const orig = console.error; console.error = () => {};
  try {
    assert.equal(await createLegacyGuards({ db: fakeDb({ hidden: [], supplierProductOf: {}, fail: true }).db, enabled: true }).userHasDropshipRecords('u-ds'), null);
  } finally { console.error = orig; }
});

test('removeUserListings tells onProductsChanged (product caches) after removing listings', async () => {
  const { db } = fakeDb({ hidden: [], supplierProductOf: {} });
  const seen: (string[] | undefined)[] = [];
  const g = createLegacyGuards({ db, enabled: true, onProductsChanged: ids => { seen.push(ids); } });
  assert.equal(await g.removeUserListings('u-ds', 'account_deletion', async () => []), 2);
  assert.deepEqual(seen, [undefined]);
});
