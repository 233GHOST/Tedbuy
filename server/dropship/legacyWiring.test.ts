import test from 'node:test';
import assert from 'node:assert/strict';
import type { DropshipDb } from './db.js';
import {
  adminUserDeleteDecision, cleanupOrphansDecision, createLegacyGuards, DROPSHIP_ROW_ID_ILIKE, excludeDropshipRows,
  filterVisiblePayload, legacyDeleteDecision, legacySyncDecision, productsOwnMediaUrl, resolveCloudinaryDeleteTarget,
} from './legacyGuards.js';
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

test('cleanupOrphansDecision: a dsl_ productId is never ownership evidence (409), ordinary ids proceed', () => {
  for (const id of ['dsl_abc', 'DSL_abc']) {
    assert.deepEqual(cleanupOrphansDecision(id), { ok: false, status: 409, error: 'Manage this listing from Dropship' });
  }
  assert.deepEqual(cleanupOrphansDecision('prod_1'), { ok: true });
});

test('adminUserDeleteDecision: refuses a Dropship participant before anything is deleted', async () => {
  const calls: string[] = [];
  const ownsDsl = (v: boolean) => async () => { calls.push('ownsDsl'); return v; };
  // Dropship records exist => 409, without needing the legacy signal.
  assert.deepEqual(await adminUserDeleteDecision(true, ownsDsl(false)), {
    ok: false, status: 409, error: 'This account has Dropship records; suspend or revoke it in Dropship admin instead.',
  });
  assert.deepEqual(calls, []);
  // No Dropship records => proceed.
  assert.deepEqual(await adminUserDeleteDecision(false, ownsDsl(true)), { ok: true });
  assert.deepEqual(calls, []);
  // Dropship can't tell (disabled/DB error): refuse only when the user owns a dsl_ products row.
  assert.deepEqual(await adminUserDeleteDecision(null, ownsDsl(true)), {
    ok: false, status: 503, error: "Dropship records can't be checked right now. Please try again later.",
  });
  assert.deepEqual(await adminUserDeleteDecision(null, ownsDsl(false)), { ok: true });
  assert.deepEqual(calls, ['ownsDsl', 'ownsDsl']);
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

// ---- Pre-review fixes (controller rulings) ----

const A = 'https://res.cloudinary.com/c/image/upload/a.jpg';
const B = 'https://res.cloudinary.com/c/image/upload/b.jpg';

test('media: disabled guards (no db) ⇒ every URL deletable, guard reported unavailable', async () => {
  for (const g of [createLegacyGuards({ db: null, enabled: false }), createLegacyGuards({ db: null, enabled: true })]) {
    assert.deepEqual(await g.filterProtectedMedia([A, B]), { deletable: [A, B], protected: [] });
    assert.equal(g.mediaGuardAvailable(), false);
  }
});

test('media: enabled + DB error ⇒ every URL protected', async () => {
  const db: DropshipDb = { async call() { throw new Error('db down'); } };
  const g = createLegacyGuards({ db, enabled: true });
  assert.equal(g.mediaGuardAvailable(), true);
  await quiet(async () => assert.deepEqual(await g.filterProtectedMedia([A, B]), { deletable: [], protected: [A, B] }));
});

test('productsOwnMediaUrl: dsl_ rows are never ownership evidence', () => {
  assert.equal(productsOwnMediaUrl([{ id: 'dsl_1', images: [A] }], A), false);
  assert.equal(productsOwnMediaUrl([{ id: 'DSL_1', images: [A] }], A), false);
  assert.equal(productsOwnMediaUrl([{ id: 'dsl_1', images: [A] }, { id: 'p1', videos: [A] }], A), true);
  assert.equal(productsOwnMediaUrl([{ id: 'p1', imageUrls: [A] }], A), true);
  assert.equal(productsOwnMediaUrl([{ id: 'p1', images: [B] }], A), false);
  assert.equal(productsOwnMediaUrl(null, A), false);
});

test('filterVisiblePayload: drops hidden dsl_ products from a (cached) response payload', async () => {
  const g = createLegacyGuards({ db: snapDb({ hidden: ['dsl_2'], supplierProductOf: { dsl_1: 's', dsl_2: 's' } }), enabled: true });
  const payload = { products: [{ id: 'a' }, null, { id: 'dsl_1' }, { id: 'dsl_2' }, { id: 'dsl_x' }], total: 5, page: 1 };
  const out = await filterVisiblePayload(payload, g);
  assert.deepEqual(out.products.map(p => p?.id ?? null), ['a', null, 'dsl_1']);
  assert.equal(out.total, 5);
  assert.deepEqual(payload.products.length, 5); // input untouched
  const off = await filterVisiblePayload(payload, createLegacyGuards({ db: null, enabled: false }));
  assert.deepEqual(off.products.map(p => p?.id ?? null), ['a', null]);
});

test('filterVisiblePayload: payload without dsl_ products is returned as-is', async () => {
  const g = createLegacyGuards({ db: null, enabled: false });
  const p1 = { products: [{ id: 'a' }, null] };
  assert.equal(await filterVisiblePayload(p1, g), p1);
  const p2 = { other: 1 } as { products?: unknown; other: number };
  assert.equal(await filterVisiblePayload(p2, g), p2);
});

test('isLiveListing: live listing counts even while hidden; unknown, disabled and DB error do not', async () => {
  const g = createLegacyGuards({ db: snapDb({ hidden: ['dsl_2'], supplierProductOf: { dsl_1: 's', dsl_2: 's' } }), enabled: true });
  assert.equal(await g.isLiveListing('dsl_1'), true);
  assert.equal(await g.isLiveListing('dsl_2'), true);
  assert.equal(await g.isVisibleProduct('dsl_2'), false);
  assert.equal(await g.isLiveListing('dsl_x'), false);
  assert.equal(await g.isLiveListing('prod_1'), false);
  assert.equal(await createLegacyGuards({ db: null, enabled: false }).isLiveListing('dsl_1'), false);
  const bad = createLegacyGuards({ db: { async call() { throw new Error('down'); } }, enabled: true });
  await quiet(async () => assert.equal(await bad.isLiveListing('dsl_1'), false));
});

// Postgres ILIKE semantics for the pattern (backslash is the default escape character).
const ilike = (pattern: string, s: string) => {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') { re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    re += c === '%' ? '.*' : c === '_' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i').test(s);
};

test('excludeDropshipRows: merge-account leaves dsl_ rows untouched', () => {
  const calls: unknown[][] = [];
  const q = { not(column: string, operator: string, value: unknown) { calls.push([column, operator, value]); return q; } };
  assert.equal(excludeDropshipRows(q), q);
  assert.deepEqual(calls, [['id', 'ilike', DROPSHIP_ROW_ID_ILIKE]]);
  for (const id of ['dsl_abc', 'DSL_abc', 'Dsl_1']) assert.equal(ilike(DROPSHIP_ROW_ID_ILIKE, id), true, id);
  for (const id of ['dslx', 'prod_1', 'xdsl_1']) assert.equal(ilike(DROPSHIP_ROW_ID_ILIKE, id), false, id);
});

// ---- Fix round 1: /api/cloudinary/delete target resolution ----

// Same shape as server.ts extractCloudinaryInfo (simplified; injected so server.ts isn't imported).
const extract = (u: string) => {
  if (!u.includes('res.cloudinary.com')) return null;
  const after = u.split('/upload/')[1];
  if (!after) return null;
  const segs = after.split('/');
  const v = segs.findIndex(x => /^v\d+$/.test(x));
  const path = (v === -1 ? segs : segs.slice(v + 1)).join('/');
  return { publicId: path.replace(/\.[^.]+$/, ''), resourceType: (u.includes('/video/upload/') ? 'video' : 'image') as 'image' | 'video' };
};
const OWN = 'https://res.cloudinary.com/c/image/upload/v1/users/me.jpg';
const OWN_VIDEO = 'https://res.cloudinary.com/c/video/upload/v1/products/clip.mp4';
const resolve = (o: { isAdmin?: boolean; publicId?: unknown; resourceType?: unknown; url?: unknown }) =>
  resolveCloudinaryDeleteTarget({ isAdmin: false, ...o }, extract);

test('delete target: non-admin with a mismatched publicId deletes only the url\'s own asset', () => {
  assert.deepEqual(resolve({ url: OWN, publicId: 'suppliers/their-photo', resourceType: 'video' }),
    { ok: true, publicId: 'users/me', resourceType: 'image', url: OWN });
});

test('delete target: non-admin with matching or absent publicId works as before', () => {
  assert.deepEqual(resolve({ url: OWN }), { ok: true, publicId: 'users/me', resourceType: 'image', url: OWN });
  assert.deepEqual(resolve({ url: OWN, publicId: 'users/me' }), { ok: true, publicId: 'users/me', resourceType: 'image', url: OWN });
  assert.deepEqual(resolve({ url: OWN_VIDEO }), { ok: true, publicId: 'products/clip', resourceType: 'video', url: OWN_VIDEO });
});

test('delete target: non-admin refusals keep their existing status codes', () => {
  assert.deepEqual(resolve({ publicId: 'x' }), { ok: false, status: 403, error: 'Forbidden: cannot verify ownership without a url' });
  assert.deepEqual(resolve({}), { ok: false, status: 400, error: 'Missing publicId or valid Cloudinary url' });
  assert.deepEqual(resolve({ url: 'https://example.com/a.jpg' }), { ok: false, status: 400, error: 'Missing publicId or valid Cloudinary url' });
  assert.deepEqual(resolve({ url: 'https://example.com/a.jpg', publicId: 'x' }), { ok: false, status: 400, error: 'Missing publicId or valid Cloudinary url' });
});

test('delete target: admin behaviour unchanged (body publicId wins, url fallback)', () => {
  assert.deepEqual(resolve({ isAdmin: true, publicId: 'any/asset' }), { ok: true, publicId: 'any/asset', resourceType: 'image', url: null });
  assert.deepEqual(resolve({ isAdmin: true, publicId: 'any/asset', resourceType: 'video', url: OWN }),
    { ok: true, publicId: 'any/asset', resourceType: 'video', url: OWN });
  assert.deepEqual(resolve({ isAdmin: true, url: OWN_VIDEO }), { ok: true, publicId: 'products/clip', resourceType: 'video', url: OWN_VIDEO });
  assert.deepEqual(resolve({ isAdmin: true }), { ok: false, status: 400, error: 'Missing publicId or valid Cloudinary url' });
});
