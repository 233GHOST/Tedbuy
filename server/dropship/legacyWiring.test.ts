import test from 'node:test';
import assert from 'node:assert/strict';
import type { DropshipDb } from './db.js';
import { createLegacyGuards, legacyDeleteDecision, legacySyncDecision } from './legacyGuards.js';
import { filterSitemapProducts, type CachedSitemapData } from '../../src/utils/sitemap.js';

// Task 4: helpers server.ts uses at legacy call sites. server.ts itself is never imported here
// (see the NOTE at the top of server.test.ts).

const sync = (productId: string, o: Partial<{ isAdmin: boolean; socialOnly: boolean; exists: boolean }> = {}) =>
  legacySyncDecision({ productId, isAdmin: false, socialOnly: false, exists: false, ...o });

test('legacySyncDecision: ordinary ids are always allowed', () => {
  assert.equal(sync('prod_1'), 'allow');
  assert.equal(sync('prod_1', { exists: true }), 'allow');
  assert.equal(sync('dslx', { exists: true }), 'allow');
});

test('legacySyncDecision: new dsl_ ids rejected in any case', () => {
  assert.equal(sync('dsl_abc'), 'reject_dsl');
  assert.equal(sync('DSL_abc'), 'reject_dsl');
  assert.equal(sync('Dsl_abc'), 'reject_dsl');
  // socialOnly is meaningless without an existing row
  assert.equal(sync('dsl_abc', { socialOnly: true }), 'reject_dsl');
});

test('legacySyncDecision: existing dsl_ rows allow social-only changes only', () => {
  assert.equal(sync('dsl_abc', { exists: true }), 'reject_dsl');
  assert.equal(sync('dsl_abc', { exists: true, socialOnly: true }), 'allow');
});

test('legacySyncDecision: admin calls allowed', () => {
  assert.equal(sync('dsl_abc', { isAdmin: true, exists: true }), 'allow');
  assert.equal(sync('dsl_abc', { isAdmin: true }), 'allow');
});

test('legacyDeleteDecision', () => {
  assert.equal(legacyDeleteDecision('dsl_abc'), 'reject_dsl');
  assert.equal(legacyDeleteDecision('DSL_abc'), 'reject_dsl');
  assert.equal(legacyDeleteDecision('prod_1'), 'allow');
  assert.equal(legacyDeleteDecision(''), 'allow');
});

function snapDb(state: { hidden: string[]; supplierProductOf: Record<string, string> }) {
  const db: DropshipDb = {
    async call<T = any>(fn: string): Promise<T> {
      if (fn === 'dropship_hidden_product_ids') return { hidden: state.hidden, supplierProductOf: state.supplierProductOf } as T;
      throw new Error(`unexpected ${fn}`);
    },
  };
  return db;
}

test('guards: unknown dsl_ ids (not in supplierProductOf) are hidden', async () => {
  const g = createLegacyGuards({ db: snapDb({ hidden: [], supplierProductOf: { dsl_1: 's' } }), enabled: true });
  const out = await g.filterVisible([{ id: 'a' }, { id: 'dsl_1' }, { id: 'dsl_unknown' }]);
  assert.deepEqual(out.map(r => r.id), ['a', 'dsl_1']);
  assert.equal(await g.isVisibleProduct('dsl_unknown'), false);
  assert.equal(await g.isVisibleProduct('dsl_1'), true);
});

test('guards: upper-case DSL_ ids are hidden (mirror ids are always lower-case)', async () => {
  const g = createLegacyGuards({ db: snapDb({ hidden: [], supplierProductOf: { dsl_1: 's' } }), enabled: true });
  const out = await g.filterVisible([{ id: 'a' }, { id: 'DSL_1' }]);
  assert.deepEqual(out.map(r => r.id), ['a']);
  assert.equal(await g.isVisibleProduct('DSL_1'), false);
});

// Account deletion: dropship_remove_user_listings must run before legacy code touches the user's products.
function removeDb(opts: { fail?: boolean; removed?: number }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: DropshipDb = {
    async call<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ fn, args });
      if (opts.fail) throw new Error('db down');
      if (fn === 'dropship_remove_user_listings') return (opts.removed ?? 0) as T;
      if (fn === 'dropship_hidden_product_ids') return { hidden: [], supplierProductOf: {} } as T;
      throw new Error(`unexpected ${fn}`);
    },
  };
  return { db, calls };
}

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const orig = console.error; const origWarn = console.warn;
  console.error = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.error = orig; console.warn = origWarn; }
};

test('removeUserListings: calls dropship_remove_user_listings and invalidates the hidden cache', async () => {
  const { db, calls } = removeDb({ removed: 2 });
  const g = createLegacyGuards({ db, enabled: true });
  await g.filterVisible([{ id: 'dsl_1' }]); // primes the cache
  let listed = false;
  const n = await g.removeUserListings('u1', 'account_deletion', async () => { listed = true; return []; });
  assert.equal(n, 2);
  assert.equal(listed, false);
  assert.deepEqual(calls.filter(c => c.fn === 'dropship_remove_user_listings'), [
    { fn: 'dropship_remove_user_listings', args: { p_user: 'u1', p_reason: 'account_deletion' } },
  ]);
  await g.filterVisible([{ id: 'dsl_1' }]);
  assert.equal(calls.filter(c => c.fn === 'dropship_hidden_product_ids').length, 2);
});

test('removeUserListings: no db (disabled) and no dsl_ products ⇒ resolves, deletion proceeds as today', async () => {
  const g = createLegacyGuards({ db: null, enabled: false });
  assert.equal(await g.removeUserListings('u1', 'r', async () => ['prod_1', 'dslx']), null);
  assert.equal(await g.removeUserListings('u1', 'r', async () => []), null);
});

test('removeUserListings: no db and the user owns a dsl_ row (any case) ⇒ rejects', async () => {
  const g = createLegacyGuards({ db: null, enabled: false });
  await quiet(async () => {
    await assert.rejects(g.removeUserListings('u1', 'r', async () => ['prod_1', 'dsl_9']));
    await assert.rejects(g.removeUserListings('u1', 'r', async () => ['DSL_9']));
  });
});

test('removeUserListings: DB call fails ⇒ proceeds only when the user owns no dsl_ rows', async () => {
  const g = createLegacyGuards({ db: removeDb({ fail: true }).db, enabled: true });
  await quiet(async () => {
    assert.equal(await g.removeUserListings('u1', 'r', async () => ['prod_1']), null);
    await assert.rejects(g.removeUserListings('u1', 'r', async () => ['dsl_1']));
  });
});

test('removeUserListings: product lookup failing when the remove call could not run ⇒ rejects (never half-delete)', async () => {
  const g = createLegacyGuards({ db: null, enabled: false });
  await quiet(async () => {
    await assert.rejects(g.removeUserListings('u1', 'r', async () => { throw new Error('lookup failed'); }));
  });
});

// Sitemap: getSitemapDataset(isVisible) drops product URLs the filter rejects.
const url = (loc: string, productId?: string) => ({ loc, lastmod: '2026-10-27', changefreq: 'weekly' as const, priority: '0.8', ...(productId ? { productId } : {}) });
const dataset = (): CachedSitemapData => ({
  staticUrls: [url('')],
  categoryUrls: [url('/category/phones')],
  productUrls: [url('/product/prod_1-phone', 'prod_1'), url('/product/dsl_a-phone', 'dsl_a'), url('/product/DSL_b-x', 'DSL_b'), url('/product/dsl_c-y', 'dsl_c')],
  storeUrls: [url('/seller/u1')],
  loadedAt: 1,
});

test('sitemap dataset built with a filter excludes dsl_ rows the filter rejects', async () => {
  const visible = new Set(['dsl_c']);
  const isVisible = (id: string) => !id.toLowerCase().startsWith('dsl_') || Promise.resolve(visible.has(id));
  const out = await filterSitemapProducts(dataset(), isVisible);
  assert.deepEqual(out.productUrls.map(u => u.productId), ['prod_1', 'dsl_c']);
  assert.equal(out.staticUrls.length, 1);
  assert.equal(out.storeUrls.length, 1);
});

test('sitemap dataset without a filter is returned unchanged', async () => {
  const d = dataset();
  assert.equal(await filterSitemapProducts(d), d);
  assert.equal(await filterSitemapProducts(d, () => true), d);
});
