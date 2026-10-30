import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { mapDbError } from './errors.js';
import { resolveDropshipConfig } from './db.js';
import { createDropshipRouter, type DropshipDeps, type DropshipVerifiedUser } from './routes.js';
import { isTedbuyProductImageUrl } from './validation.js';
import { createLegacyGuards, type LegacyGuards } from './legacyGuards.js';
import { createPgliteDropship, type PgliteDropship } from './testing/pgliteDb.js';

// HTTP tests of the Dropship router against the real migration (PGlite). Firebase token
// verification is replaced by a token -> user map; everything after it is the real code.

const CLOUD = 'dfm3g2qvg';
const IMG = `https://res.cloudinary.com/${CLOUD}/image/upload/v1712/tedbuy_products/cooker.jpg`;

const USERS: Record<string, DropshipVerifiedUser> = {
  admin: { uid: 'u-admin', email: 'admin@example.com', isAdmin: true, emailVerified: true },
  supplier: { uid: 'u-sup', email: 'sup@example.com', emailVerified: true },
  other: { uid: 'u-other', email: 'other@example.com', emailVerified: true },
  unverified: { uid: 'u-unverified', email: 'unv@example.com', emailVerified: false },
  restricted: { uid: 'u-restricted', email: 'r@example.com', emailVerified: true },
  supplier2: { uid: 'u-sup2', email: 'sup2@example.com', emailVerified: true },
  ds: { uid: 'u-ds', email: 'ds@example.com', emailVerified: true },
  ds2: { uid: 'u-ds2', email: 'ds2@example.com', emailVerified: true },
  sup3: { uid: 'u-sup3', email: 'sup3@example.com', emailVerified: true },
  dsImp: { uid: 'u-ds', email: 'ds@example.com', isAdmin: true, isImpersonating: true, originalAdmin: { uid: 'u-admin', email: 'admin@example.com' } },
  impersonating: { uid: 'u-sup', email: 'sup@example.com', isAdmin: true, isImpersonating: true, originalAdmin: { uid: 'u-admin', email: 'admin@example.com' } },
};

let h: PgliteDropship;
let guards: LegacyGuards;
let base: string;
let disabledBase: string;
// onProductsChanged spy: every call's ids (undefined = clear broadly).
const productChanges: (string[] | undefined)[] = [];
const servers: import('node:http').Server[] = [];

function listen(deps: DropshipDeps): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use(createDropshipRouter(deps));
  return new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`));
    servers.push(s);
  });
}

async function api(method: string, path: string, who?: keyof typeof USERS, body?: unknown, root = base) {
  const res = await fetch(root + path, {
    method,
    headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${who}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

const productBody = (over: Record<string, unknown> = {}) => ({
  clientRequestId: crypto.randomUUID(), title: 'Rice cooker 1.8L', description: 'Non-stick rice cooker, 700W, keeps warm.',
  category: 'Home Appliances', images: [IMG], wholesalePricePesewas: 25000, suggestedRetailPesewas: 32000,
  stockOnHand: 10, shipsFromRegion: 'Greater Accra', shipsFromCity: 'Accra', deliveryFeeSameRegionPesewas: 1500,
  leadTimeMinDays: 1, leadTimeMaxDays: 3, submit: true, ...over,
});

const applicationBody = () => ({
  clientRequestId: crypto.randomUUID(), kind: 'supplier', displayName: 'Kofi Supplies', contactPhone: '024 123 4567',
  region: 'Greater Accra', city: 'Accra', addressLine: '12 Ring Road, Osu', termsVersion: 'supplier-2026-10',
});

before(async () => {
  h = await createPgliteDropship();
  for (const u of ['u-admin', 'u-sup', 'u-other', 'u-unverified', 'u-sup2', 'u-ds', 'u-ds2', 'u-sup3']) await h.addUser(u);
  await h.addUser('u-restricted', { securityHold: true });
  guards = createLegacyGuards({ db: h.db, enabled: true });
  const deps: DropshipDeps = {
    enabled: true, db: h.db, guards, loadUserRestriction: h.loadUserRestriction, cloudinaryCloudName: CLOUD,
    onProductsChanged: ids => { productChanges.push(ids); },
    verifyUser: async auth => (auth?.startsWith('Bearer ') ? USERS[auth.slice(7)] ?? null : null),
  };
  base = await listen(deps);
  disabledBase = await listen({ ...deps, enabled: false, cause: 'disabled', db: null });
});

after(async () => {
  for (const s of servers) s.close();
  await h.close();
});

test('disabled mode: status false, /me says off, every other route 503 DROPSHIP_UNAVAILABLE', async () => {
  assert.deepEqual((await api('GET', '/api/dropship/status', undefined, undefined, disabledBase)).body, { success: true, enabled: false, ordersEnabled: false });
  assert.deepEqual((await api('GET', '/api/dropship/me', 'supplier', undefined, disabledBase)).body, { success: true, enabled: false, mode: 'off' });
  const r = await api('GET', '/api/admin/dropship/applications', 'admin', undefined, disabledBase);
  assert.equal(r.status, 503);
  assert.equal(r.body.errorCode, 'DROPSHIP_UNAVAILABLE');
});

test('authentication and authorization gates', async () => {
  assert.equal((await api('GET', '/api/admin/dropship/applications')).body.errorCode, 'UNAUTHENTICATED');
  for (const [method, path] of [
    ['GET', '/api/admin/dropship/applications'],
    ['GET', '/api/admin/dropship/supplier-products'],
    ['POST', `/api/admin/dropship/applications/${crypto.randomUUID()}/decision`],
    ['POST', `/api/admin/dropship/supplier-products/${crypto.randomUUID()}/moderate`],
    ['POST', '/api/admin/dropship/supplier-products'],
  ] as const) {
    const r = await api(method, path, 'supplier', method === 'POST' ? {} : undefined);
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.body.errorCode, 'FORBIDDEN');
  }
  const imp = await api('GET', '/api/admin/dropship/applications', 'impersonating');
  assert.equal(imp.body.errorCode, 'IMPERSONATION_FORBIDDEN');
  const impWrite = await api('POST', '/api/dropship/supplier/products', 'impersonating', productBody());
  assert.equal(impWrite.body.errorCode, 'IMPERSONATION_FORBIDDEN');
  const restricted = await api('POST', '/api/dropship/applications', 'restricted', applicationBody());
  assert.equal(restricted.body.errorCode, 'ACCOUNT_RESTRICTED');
  const unverified = await api('POST', '/api/dropship/applications', 'unverified', applicationBody());
  assert.equal(unverified.status, 403);
  assert.equal(unverified.body.errorCode, 'FORBIDDEN');
});

test('end-to-end: apply, approve, create, moderate, stock, pause, revoke', async () => {
  // Not yet a supplier.
  assert.equal((await api('GET', '/api/dropship/supplier/products', 'supplier')).body.errorCode, 'NOT_APPROVED');
  assert.equal((await api('POST', '/api/dropship/supplier/products', 'supplier', productBody())).body.errorCode, 'NOT_APPROVED');

  const applied = await api('POST', '/api/dropship/applications', 'supplier', applicationBody());
  assert.equal(applied.status, 201);
  assert.equal(applied.body.participation.status, 'pending');
  assert.equal(applied.body.participation.contactPhone, '0241234567');
  for (const hidden of ['userId', 'adminNotes', 'reviewedBy', 'termsVersion']) assert.ok(!(hidden in applied.body.participation), `${hidden} hidden from owner`);

  const queue = await api('GET', '/api/admin/dropship/applications?status=pending', 'admin');
  const app = queue.body.participants.find((p: any) => p.userId === 'u-sup');
  assert.ok(app);
  const approved = await api('POST', `/api/admin/dropship/applications/${app.id}/decision`, 'admin', { decision: 'approve', expectedStatus: 'pending' });
  assert.equal(approved.body.participant.status, 'approved');

  const me = await api('GET', '/api/dropship/me', 'supplier');
  assert.equal(me.body.participations.supplier.status, 'approved');

  const created = await api('POST', '/api/dropship/supplier/products', 'supplier', productBody());
  assert.equal(created.status, 201);
  const p = created.body.product;
  assert.equal(p.status, 'pending_review');
  assert.equal(p.stockAvailable, 10);

  const mod = await api('POST', `/api/admin/dropship/supplier-products/${p.id}/moderate`, 'admin', { decision: 'approve' });
  assert.equal(mod.body.product.status, 'active');

  const stock = await api('POST', `/api/dropship/supplier/products/${p.id}/stock`, 'supplier', { stockOnHand: 6, expectedOnHand: 10 });
  assert.deepEqual([stock.body.stockOnHand, stock.body.stockReserved, stock.body.available], [6, 0, 6]);
  const stale = await api('POST', `/api/dropship/supplier/products/${p.id}/stock`, 'supplier', { stockOnHand: 2, expectedOnHand: 10 });
  assert.equal(stale.status, 409);

  const edit = await api('PATCH', `/api/dropship/supplier/products/${p.id}`, 'supplier', { expectedContentVersion: 1, wholesalePricePesewas: 26000 });
  assert.equal(edit.body.product.priceVersion, 2);

  // Another supplier can't see or change it (no existence leak).
  const otherEdit = await api('PATCH', `/api/dropship/supplier/products/${p.id}`, 'other', { expectedContentVersion: 2, title: 'Not mine at all' });
  assert.equal(otherEdit.status, 404);
  assert.equal(otherEdit.body.errorCode, 'NOT_FOUND');

  assert.equal((await api('POST', `/api/dropship/supplier/products/${p.id}/status`, 'supplier', { status: 'paused' })).body.product.status, 'paused');
  const list = await api('GET', '/api/dropship/supplier/products?status=paused', 'supplier');
  assert.deepEqual(list.body.products.map((x: any) => x.id), [p.id]);

  // Admin stock correction requires expectedOnHand and a reason.
  assert.equal((await api('POST', `/api/admin/dropship/supplier-products/${p.id}/stock`, 'admin', { stockOnHand: 9 })).status, 400);
  const corr = await api('POST', `/api/admin/dropship/supplier-products/${p.id}/stock`, 'admin', { stockOnHand: 9, expectedOnHand: 6, reason: 'warehouse recount' });
  assert.equal(corr.body.product.stockOnHand, 9);

  const revoke = await api('POST', `/api/admin/dropship/applications/${app.id}/decision`, 'admin', { decision: 'revoke', expectedStatus: 'approved', reason: 'repeated counterfeit reports' });
  assert.equal(revoke.body.participant.status, 'revoked');
  assert.deepEqual(revoke.body.sideEffects, { archived: [p.id], notArchived: [] });
  const after = await api('GET', `/api/admin/dropship/supplier-products?supplierId=u-sup`, 'admin');
  assert.equal(after.body.products[0].status, 'archived');
  assert.equal((await api('GET', '/api/dropship/supplier/products', 'supplier')).body.errorCode, 'NOT_APPROVED');
});

test('input validation is strict and server-side', async () => {
  const cases: Array<[string, unknown]> = [
    ['unknown field', productBody({ isFeatured: true })],
    ['fractional price', productBody({ wholesalePricePesewas: 250.5 })],
    ['price as string', productBody({ wholesalePricePesewas: '25000' })],
    ['negative stock', productBody({ stockOnHand: -2 })],
    ['foreign image', productBody({ images: ['https://example.com/a.jpg'] })],
    ['other cloud', productBody({ images: ['https://res.cloudinary.com/othercloud/image/upload/tedbuy_products/a.jpg'] })],
    ['wrong folder', productBody({ images: [`https://res.cloudinary.com/${CLOUD}/image/upload/uploads/a.jpg`] })],
    ['too many images', productBody({ images: Array.from({ length: 11 }, (_, i) => IMG.replace('cooker', `c${i}`)) })],
    ['retail below wholesale', productBody({ suggestedRetailPesewas: 100 })],
    ['bad region', productBody({ shipsFromRegion: 'Atlantis' })],
    ['missing clientRequestId', productBody({ clientRequestId: undefined })],
  ];
  for (const [name, body] of cases) {
    const r = await api('POST', '/api/dropship/supplier/products', 'admin', body); // admin passes the gate, but the body is a supplier body
    assert.equal(r.status, 400, name);
    assert.equal(r.body.errorCode, 'VALIDATION', name);
  }
  const adminNoReason = await api('POST', '/api/admin/dropship/supplier-products', 'admin', { ...productBody(), supplierId: 'u-sup' });
  assert.equal(adminNoReason.body.errorCode, 'VALIDATION');
  const badId = await api('PATCH', '/api/dropship/supplier/products/not-a-uuid', 'supplier', { expectedContentVersion: 1, title: 'x' });
  assert.equal(badId.status, 404);
});

test('configuration fails closed and never uses an anon key', () => {
  const jwt = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
  const ok = { DROPSHIP_ENABLED: 'true', SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', DROPSHIP_EXPECTED_SUPABASE_REF: 'abcdefghijklmnopqrst', SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: 'abcdefghijklmnopqrst' }) };
  assert.equal(resolveDropshipConfig(ok).enabled, true);
  assert.equal(resolveDropshipConfig({ ...ok, DROPSHIP_ENABLED: undefined }).cause, 'disabled');
  assert.equal(resolveDropshipConfig({ ...ok, SUPABASE_SERVICE_ROLE_KEY: undefined }).cause, 'config_missing');
  assert.equal(resolveDropshipConfig({ ...ok, SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'anon', ref: 'abcdefghijklmnopqrst' }) }).cause, 'config_invalid');
  assert.equal(resolveDropshipConfig({ ...ok, VITE_SUPABASE_URL: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co' }).cause, 'config_invalid');
  assert.equal(resolveDropshipConfig({ ...ok, DROPSHIP_EXPECTED_SUPABASE_REF: 'zzzzzzzzzzzzzzzzzzzz' }).cause, 'identity_mismatch');
  assert.equal(resolveDropshipConfig({ ...ok, SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: 'zzzzzzzzzzzzzzzzzzzz' }) }).cause, 'identity_mismatch');
});

test('database error mapping', () => {
  assert.equal(mapDbError({ message: 'DS_STATE_CONFLICT', details: 'stale' }).code, 'STATE_CONFLICT');
  assert.equal(mapDbError({ code: '23514', message: 'check' }).code, 'VALIDATION');
  assert.equal(mapDbError({ code: 'PGRST202', message: 'not found' }).code, 'DROPSHIP_UNAVAILABLE');
  assert.equal(mapDbError({ code: '40P01', message: 'deadlock' }).retryable, true);
  assert.equal(mapDbError({ message: 'DS_NOT_A_CODE' }).code, 'SERVER');
});

test('buyers and anonymous callers never receive supplier products or wholesale prices', async () => {
  const leaks = (body: unknown) => /wholesale|stockOnHand|supplierId/i.test(JSON.stringify(body));
  const status = await api('GET', '/api/dropship/status');
  assert.deepEqual(Object.keys(status.body).sort(), ['enabled', 'ordersEnabled', 'success']);
  for (const [who, path] of [
    [undefined, '/api/dropship/supplier/products'],
    [undefined, '/api/admin/dropship/supplier-products'],
    ['other', '/api/dropship/supplier/products'],
    ['other', '/api/admin/dropship/supplier-products'],
    ['other', '/api/dropship/me'],
  ] as const) {
    const r = await api('GET', path, who);
    assert.ok(!leaks(r.body), `${who ?? 'anonymous'} ${path} leaked supplier data: ${JSON.stringify(r.body)}`);
  }
});

test('stale edits conflict; a suspended supplier can read but not change anything', async () => {
  await api('POST', '/api/dropship/applications', 'supplier2', applicationBody());
  const app = (await api('GET', '/api/admin/dropship/applications?status=pending', 'admin')).body.participants.find((p: any) => p.userId === 'u-sup2');
  await api('POST', `/api/admin/dropship/applications/${app.id}/decision`, 'admin', { decision: 'approve', expectedStatus: 'pending' });
  const p = (await api('POST', '/api/dropship/supplier/products', 'supplier2', productBody())).body.product;

  // Two tabs editing the same product: the second save is refused, not silently applied.
  assert.equal((await api('PATCH', `/api/dropship/supplier/products/${p.id}`, 'supplier2', { expectedContentVersion: 1, title: 'First tab title' })).status, 200);
  const stale = await api('PATCH', `/api/dropship/supplier/products/${p.id}`, 'supplier2', { expectedContentVersion: 1, title: 'Second tab title' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.errorCode, 'STATE_CONFLICT');

  await api('POST', `/api/admin/dropship/applications/${app.id}/decision`, 'admin', { decision: 'suspend', expectedStatus: 'approved', reason: 'late deliveries' });
  const me = await api('GET', '/api/dropship/me', 'supplier2');
  assert.deepEqual(me.body.participations.supplier.restrictions, ['fulfilment_only']);
  assert.equal((await api('GET', '/api/dropship/supplier/products', 'supplier2')).status, 200, 'still readable');
  for (const [method, path, body] of [
    ['POST', '/api/dropship/supplier/products', productBody()],
    ['PATCH', `/api/dropship/supplier/products/${p.id}`, { expectedContentVersion: 2, title: 'Edited while suspended' }],
    ['POST', `/api/dropship/supplier/products/${p.id}/stock`, { stockOnHand: 1 }],
    ['POST', `/api/dropship/supplier/products/${p.id}/status`, { status: 'archived' }],
  ] as const) {
    const r = await api(method, path, 'supplier2', body);
    assert.equal(r.body.errorCode, 'FULFILMENT_ONLY', `${method} ${path}`);
  }
});

test('image URL rule', () => {
  assert.ok(isTedbuyProductImageUrl(`https://res.cloudinary.com/${CLOUD}/image/upload/f_auto,q_auto/v1/tedbuy_products/a_b-1.webp`, CLOUD));
  assert.ok(!isTedbuyProductImageUrl(`https://res.cloudinary.com/${CLOUD}/image/upload/tedbuy_products/../x.jpg`, CLOUD));
  assert.ok(!isTedbuyProductImageUrl(`https://res.cloudinary.com/${CLOUD}/image/upload/tedbuy_products/a.jpg?x=1`, CLOUD));
  assert.ok(!isTedbuyProductImageUrl(`http://res.cloudinary.com/${CLOUD}/image/upload/tedbuy_products/a.jpg`, CLOUD));
});

// ---------------------------------------------------------------------------------------
// Phase 3: dropshipper applications, catalogue, quote, listings, purchase-info
// ---------------------------------------------------------------------------------------
const dsApplication = () => ({
  clientRequestId: crypto.randomUUID(), kind: 'dropshipper', displayName: 'Ama Store', contactPhone: '0551234567',
  region: 'Ashanti', city: 'Kumasi', termsVersion: 'dropshipper-2026-10',
});

async function approve(who: keyof typeof USERS, uid: string, body: any) {
  const applied = await api('POST', '/api/dropship/applications', who, body);
  assert.ok(applied.status === 201 || applied.status === 200, JSON.stringify(applied.body));
  const q = await api('GET', `/api/admin/dropship/applications?status=pending&kind=${body.kind}`, 'admin');
  const app = q.body.participants.find((p: any) => p.userId === uid);
  const r = await api('POST', `/api/admin/dropship/applications/${app.id}/decision`, 'admin', { decision: 'approve', expectedStatus: 'pending' });
  assert.equal(r.body.participant.status, 'approved');
}

function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach(x => keysDeep(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out); }
  return out;
}
const noSupplierIdentity = (body: unknown) => {
  const ks = keysDeep(body);
  for (const k of ['supplierId', 'supplierName', 'contactPhone']) assert.ok(!ks.has(k), `${k} leaked`);
};

let spId: string;
let listing: any;
let productId: string;

test('dropshipper can apply and admin can approve', async () => {
  const noAddr = await api('POST', '/api/dropship/applications', 'ds', dsApplication());
  assert.equal(noAddr.status, 201);
  assert.equal(noAddr.body.participation.kind, 'dropshipper');
  const queue = await api('GET', '/api/admin/dropship/applications?status=pending&kind=dropshipper', 'admin');
  const app = queue.body.participants.find((p: any) => p.userId === 'u-ds');
  const r = await api('POST', `/api/admin/dropship/applications/${app.id}/decision`, 'admin', { decision: 'approve', expectedStatus: 'pending' });
  assert.equal(r.body.participant.status, 'approved');
  assert.equal((await api('GET', '/api/dropship/me', 'ds')).body.participations.dropshipper.status, 'approved');
  // Suppliers still need an address.
  const sup = await api('POST', '/api/dropship/applications', 'other', { ...applicationBody(), addressLine: undefined });
  assert.equal(sup.body.errorCode, 'VALIDATION');
  assert.equal((await api('POST', '/api/dropship/applications', 'other', { ...dsApplication(), kind: 'admin' })).body.errorCode, 'VALIDATION');
});

test('catalogue teaser vs full; no supplier identity anywhere', async () => {
  await approve('sup3', 'u-sup3', applicationBody());
  const created = await api('POST', '/api/dropship/supplier/products', 'sup3', productBody());
  spId = created.body.product.id;
  await api('POST', `/api/admin/dropship/supplier-products/${spId}/moderate`, 'admin', { decision: 'approve' });

  assert.equal((await api('GET', '/api/dropship/catalogue')).body.errorCode, 'UNAUTHENTICATED');
  const teaser = await api('GET', '/api/dropship/catalogue', 'other');
  assert.equal(teaser.status, 200);
  const item = teaser.body.items.find((i: any) => i.supplierProductId === spId);
  assert.deepEqual(Object.keys(item).sort(), ['category', 'images', 'supplierProductId', 'title']);
  noSupplierIdentity(teaser.body);
  assert.ok(!/wholesale|stock/i.test(JSON.stringify(teaser.body)));

  const full = await api('GET', '/api/dropship/catalogue?category=Home%20Appliances&q=rice', 'ds');
  const f = full.body.items.find((i: any) => i.supplierProductId === spId);
  assert.equal(f.wholesalePricePesewas, 25000);
  assert.equal(f.alreadyListed, false);
  assert.ok(f.minRetailPesewas > 25000);
  noSupplierIdentity(full.body);

  const one = await api('GET', `/api/dropship/catalogue/${spId}`, 'ds');
  assert.equal(one.body.item.supplierProductId, spId);
  assert.equal(one.body.item.wholesalePricePesewas, 25000);
  noSupplierIdentity(one.body);
  const oneTeaser = await api('GET', `/api/dropship/catalogue/${spId}`, 'other');
  assert.deepEqual(Object.keys(oneTeaser.body.item).sort(), ['category', 'images', 'supplierProductId', 'title']);
  assert.equal((await api('GET', `/api/dropship/catalogue/${crypto.randomUUID()}`, 'ds')).status, 404);
  assert.equal((await api('GET', '/api/dropship/catalogue/nope', 'ds')).status, 404);

  // Cursor paging: two more products, page through with a tiny page is not exposed (24), so
  // check the cursor is validated and a well-formed one is accepted.
  assert.equal((await api('GET', '/api/dropship/catalogue?cursor=garbage', 'ds')).body.errorCode, 'VALIDATION');
  const badCursor = Buffer.from(JSON.stringify({ createdAt: 'x', id: 'y' })).toString('base64');
  assert.equal((await api('GET', `/api/dropship/catalogue?cursor=${encodeURIComponent(badCursor)}`, 'ds')).body.errorCode, 'VALIDATION');
  const oneSided = Buffer.from(JSON.stringify({ createdAt: new Date().toISOString() })).toString('base64');
  assert.equal((await api('GET', `/api/dropship/catalogue?cursor=${encodeURIComponent(oneSided)}`, 'ds')).body.errorCode, 'VALIDATION');
  const okCursor = Buffer.from(JSON.stringify({ createdAt: new Date().toISOString(), id: crypto.randomUUID() })).toString('base64');
  assert.equal((await api('GET', `/api/dropship/catalogue?cursor=${encodeURIComponent(okCursor)}`, 'ds')).status, 200);
});

test('catalogue pagination returns an opaque nextCursor', async () => {
  for (let i = 0; i < 25; i++) {
    const c = await api('POST', '/api/dropship/supplier/products', 'sup3', productBody({ title: `Pager item ${i} cooker`, images: [IMG.replace('cooker', `p${i}`)] }));
    await api('POST', `/api/admin/dropship/supplier-products/${c.body.product.id}/moderate`, 'admin', { decision: 'approve' });
  }
  const p1 = await api('GET', '/api/dropship/catalogue?q=Pager', 'ds');
  assert.equal(p1.body.items.length, 24);
  assert.equal(typeof p1.body.nextCursor, 'string');
  const p2 = await api('GET', `/api/dropship/catalogue?q=Pager&cursor=${encodeURIComponent(p1.body.nextCursor)}`, 'ds');
  assert.equal(p2.body.items.length, 1);
  assert.equal(p2.body.nextCursor, null);
});

test('quote requires approved dropshipper', async () => {
  const body = { retailPricePesewas: 40000 };
  assert.equal((await api('POST', `/api/dropship/catalogue/${spId}/quote`, 'other', body)).body.errorCode, 'NOT_APPROVED');
  assert.equal((await api('POST', `/api/dropship/catalogue/${spId}/quote`, undefined, body)).body.errorCode, 'UNAUTHENTICATED');
  const q = await api('POST', `/api/dropship/catalogue/${spId}/quote`, 'ds', body);
  assert.equal(q.status, 200);
  assert.equal(q.body.quote.valid, true);
  assert.deepEqual(Object.keys(q.body.quote).sort(), ['estimatedMarginPesewas', 'minRetailPesewas', 'platformFeePesewas', 'valid']);
  const low = await api('POST', `/api/dropship/catalogue/${spId}/quote`, 'ds', { retailPricePesewas: 100 });
  assert.equal(low.body.quote.valid, false);
  assert.equal(low.body.quote.reason, 'below_minimum');
  for (const bad of [{ retailPricePesewas: 0 }, { retailPricePesewas: 1.5 }, { retailPricePesewas: 100_000_001 }, { retailPricePesewas: 5, x: 1 }, {}]) {
    assert.equal((await api('POST', `/api/dropship/catalogue/${spId}/quote`, 'ds', bad)).body.errorCode, 'VALIDATION');
  }
});

test('create listing is idempotent; unknown fields rejected; impersonation refused', async () => {
  const crid = crypto.randomUUID();
  const body = { clientRequestId: crid, supplierProductId: spId, retailPricePesewas: 40000 };
  const c = await api('POST', '/api/dropship/listings', 'ds', body);
  assert.equal(c.status, 201, JSON.stringify(c.body));
  listing = c.body.listing;
  productId = c.body.productId;
  assert.ok(productId);
  assert.equal(listing.retailPricePesewas, 40000);
  const again = await api('POST', '/api/dropship/listings', 'ds', body);
  assert.equal(again.body.productId, productId);
  assert.equal(again.body.listing.id, listing.id);

  assert.equal((await api('POST', '/api/dropship/listings', 'other', { ...body, clientRequestId: crypto.randomUUID() })).body.errorCode, 'NOT_APPROVED');
  const lowR = await api('PATCH', `/api/dropship/listings/${listing.id}`, 'ds', { retailPricePesewas: 100 });
  assert.equal(lowR.body.errorCode, 'PRICE_INVALID');
  assert.equal(lowR.status, 422);

  const extra = [
    ['POST', '/api/dropship/listings', { ...body, clientRequestId: crypto.randomUUID(), x: 1 }],
    ['PATCH', `/api/dropship/listings/${listing.id}`, { retailPricePesewas: 41000, x: 1 }],
    ['PATCH', `/api/dropship/listings/${listing.id}`, {}],
    ['PATCH', `/api/dropship/listings/${listing.id}`, { status: 'removed' }],
    ['DELETE', `/api/dropship/listings/${listing.id}`, { x: 1 }],
    ['POST', `/api/dropship/catalogue/${spId}/quote`, { retailPricePesewas: 41000, x: 1 }],
  ] as const;
  for (const [m, p, b] of extra) assert.equal((await api(m, p, 'ds', b)).body.errorCode, 'VALIDATION', `${m} ${p}`);

  for (const [m, p, b] of [
    ['POST', '/api/dropship/listings', { ...body, clientRequestId: crypto.randomUUID() }],
    ['PATCH', `/api/dropship/listings/${listing.id}`, { retailPricePesewas: 41000 }],
    ['DELETE', `/api/dropship/listings/${listing.id}`, undefined],
  ] as const) assert.equal((await api(m, p, 'dsImp', b)).body.errorCode, 'IMPERSONATION_FORBIDDEN', `${m} ${p}`);
});

test('listing endpoints refuse other users', async () => {
  await approve('ds2', 'u-ds2', dsApplication());
  const patch = await api('PATCH', `/api/dropship/listings/${listing.id}`, 'ds2', { retailPricePesewas: 45000 });
  assert.equal(patch.status, 404);
  assert.equal(patch.body.errorCode, 'NOT_FOUND');
  assert.equal((await api('DELETE', `/api/dropship/listings/${listing.id}`, 'ds2')).body.errorCode, 'NOT_FOUND');
  // Admin without a reason is treated as a non-owner.
  assert.equal((await api('DELETE', `/api/dropship/listings/${listing.id}`, 'admin')).status, 404);
  assert.equal((await api('PATCH', '/api/dropship/listings/nope', 'ds', { status: 'paused' })).status, 404);
  assert.equal((await api('GET', '/api/dropship/listings/mine')).body.errorCode, 'UNAUTHENTICATED');
  assert.deepEqual((await api('GET', '/api/dropship/listings/mine', 'ds2')).body.listings, []);
});

test('listings/mine shows precise reason; purchase-info public and coarse', async () => {
  const live = await api('GET', '/api/dropship/listings/mine', 'ds');
  assert.equal(live.body.listings.length, 1);
  assert.equal(live.body.listings[0].effectiveAvailable, true);
  assert.equal(live.body.listings[0].wholesalePricePesewas, 25000);
  noSupplierIdentity(live.body);

  const pub = await api('GET', `/api/dropship/purchase-info/${productId}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.info.available, true);
  assert.equal(pub.body.info.unitPricePesewas, 40000);
  noSupplierIdentity(pub.body);
  assert.ok(!/wholesale|stockOnHand|stockReserved/i.test(JSON.stringify(pub.body)));

  assert.equal(await guards.isVisibleProduct(productId), true); // warms the 60 s cache
  const paused = await api('PATCH', `/api/dropship/listings/${listing.id}`, 'ds', { status: 'paused' });
  assert.equal(paused.body.listing.status, 'paused');
  // Guards were primed (cache warm) before the pause; the API write must invalidate them.
  assert.equal(await guards.isVisibleProduct(productId), false);
  assert.deepEqual(await guards.filterVisible([{ id: productId }, { id: 'ordinary' }]), [{ id: 'ordinary' }]);
  const mine = await api('GET', '/api/dropship/listings/mine', 'ds');
  assert.equal(mine.body.listings[0].unavailableReason, 'listing_paused');
  const info = await api('GET', `/api/dropship/purchase-info/${productId}`);
  assert.equal(info.body.info.available, false);
  assert.equal(info.body.info.unavailableReason, 'unavailable');

  assert.equal((await api('PATCH', `/api/dropship/listings/${listing.id}`, 'ds', { status: 'active' })).status, 200);
  assert.equal(await guards.isVisibleProduct(productId), true);
  const raised = await api('PATCH', `/api/dropship/listings/${listing.id}`, 'ds', { retailPricePesewas: 42000, status: 'active' });
  assert.equal(raised.body.listing.retailPricePesewas, 42000);
  assert.equal((await api('GET', `/api/dropship/purchase-info/${productId}`)).body.info.unitPricePesewas, 42000);

  assert.equal((await api('DELETE', `/api/dropship/listings/${listing.id}`, 'ds')).status, 200);
  assert.equal((await api('GET', `/api/dropship/purchase-info/${productId}`)).status, 404);
  assert.equal((await api('GET', `/api/dropship/purchase-info/${productId}`)).body.errorCode, 'NOT_FOUND');
  assert.equal((await api('GET', '/api/dropship/purchase-info/no-such-product')).status, 404);
  assert.deepEqual((await api('GET', '/api/dropship/listings/mine', 'ds')).body.listings, []);
});

test('admin can remove a listing with a reason; disabled mode 503s the new routes', async () => {
  const c = await api('POST', '/api/dropship/listings', 'ds', { clientRequestId: crypto.randomUUID(), supplierProductId: spId, retailPricePesewas: 40000 });
  const id = c.body.listing.id;
  assert.equal((await api('DELETE', `/api/dropship/listings/${id}`, 'admin', { reason: 'counterfeit report' })).status, 200);
  assert.equal((await api('GET', '/api/dropship/listings/mine', 'ds')).body.listings.length, 0);
  for (const [m, p] of [
    ['GET', '/api/dropship/catalogue'], ['GET', `/api/dropship/catalogue/${spId}`],
    ['POST', `/api/dropship/catalogue/${spId}/quote`], ['POST', '/api/dropship/listings'],
    ['GET', '/api/dropship/listings/mine'], ['PATCH', `/api/dropship/listings/${id}`],
    ['DELETE', `/api/dropship/listings/${id}`], ['GET', '/api/dropship/purchase-info/x'],
  ] as const) {
    const r = await api(m, p, 'ds', m === 'GET' || m === 'DELETE' ? undefined : {}, disabledBase);
    assert.equal(r.status, 503, `${m} ${p}`);
    assert.equal(r.body.errorCode, 'DROPSHIP_UNAVAILABLE');
  }
});

test('onProductsChanged (legacy product caches) runs after listing and supplier-product writes, not after reads', async () => {
  const c = await api('POST', '/api/dropship/listings', 'ds', { clientRequestId: crypto.randomUUID(), supplierProductId: spId, retailPricePesewas: 40000 });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const { productId: pid, listing: l } = c.body;
  assert.deepEqual(productChanges.at(-1), [pid]);

  productChanges.length = 0;
  const priced = await api('PATCH', `/api/dropship/listings/${l.id}`, 'ds', { retailPricePesewas: 43000 });
  assert.equal(priced.status, 200);
  assert.deepEqual(productChanges, [[pid]]);

  productChanges.length = 0;
  await api('GET', '/api/dropship/listings/mine', 'ds');
  await api('POST', `/api/dropship/catalogue/${spId}/quote`, 'ds', { retailPricePesewas: 43000 });
  assert.deepEqual(productChanges, []);

  // Supplier content/stock writes fan out to unknown mirror rows: clear broadly.
  const stock = await api('POST', `/api/dropship/supplier/products/${spId}/stock`, 'sup3', { stockOnHand: 9 });
  assert.equal(stock.status, 200, JSON.stringify(stock.body));
  assert.deepEqual(productChanges, [undefined]);

  productChanges.length = 0;
  assert.equal((await api('DELETE', `/api/dropship/listings/${l.id}`, 'ds')).status, 200);
  assert.deepEqual(productChanges, [[pid]]);
});
