import test from 'node:test';
import assert from 'node:assert/strict';
import type { DropshipDb } from './db.js';
import { createLegacyGuards, isDropshipRowId } from './legacyGuards.js';

// Fake DB: counts calls so cache behaviour is observable.
function fakeDb(state: { hidden: string[]; supplierProductOf: Record<string, string>; protectedUrls?: string[]; fail?: boolean }) {
  const calls: string[] = [];
  const db: DropshipDb = {
    async call<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push(fn);
      if (state.fail) throw new Error('db down');
      if (fn === 'dropship_hidden_product_ids') return { hidden: state.hidden, supplierProductOf: state.supplierProductOf } as T;
      if (fn === 'dropship_is_protected_media') return (args.p_urls as string[]).filter(u => (state.protectedUrls ?? []).includes(u)) as T;
      throw new Error(`unexpected ${fn}`);
    },
  };
  return { db, calls };
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

test('feed keeps at most 2 listings per supplier product (first two in input order)', async () => {
  const { db } = fakeDb({ hidden: [], supplierProductOf: { dsl_1: 's', dsl_2: 's', dsl_3: 's', dsl_4: 't' } });
  const g = createLegacyGuards({ db, enabled: true });
  assert.deepEqual(ids(await g.filterVisible(rows('dsl_3', 'x', 'dsl_1', 'dsl_4', 'dsl_2'))), ['dsl_3', 'x', 'dsl_1', 'dsl_4']);
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

test('filterProtectedMedia splits; fails closed on DB error; no db ⇒ all deletable', async () => {
  const A = 'https://res.cloudinary.com/c/image/upload/a.jpg';
  const B = 'https://res.cloudinary.com/c/image/upload/b.jpg';
  const { db } = fakeDb({ hidden: [], supplierProductOf: {}, protectedUrls: [A] });
  const g = createLegacyGuards({ db, enabled: true });
  assert.deepEqual(await g.filterProtectedMedia([A, B]), { deletable: [B], protected: [A] });
  assert.deepEqual(await g.filterProtectedMedia([]), { deletable: [], protected: [] });

  const bad = createLegacyGuards({ db: fakeDb({ hidden: [], supplierProductOf: {}, fail: true }).db, enabled: true });
  const orig = console.error; console.error = () => {};
  try { assert.deepEqual(await bad.filterProtectedMedia([A, B]), { deletable: [], protected: [A, B] }); } finally { console.error = orig; }
  // No Dropship DB (disabled/unconfigured): ordinary media deletion works as before.
  assert.deepEqual(await createLegacyGuards({ db: null, enabled: false }).filterProtectedMedia([A]), { deletable: [A], protected: [] });
});
