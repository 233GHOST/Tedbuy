import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { mapDbError } from './errors.js';
import { resolveDropshipConfig } from './db.js';
import { createDropshipRouter, type DropshipDeps, type DropshipVerifiedUser } from './routes.js';
import { isTedbuyProductImageUrl } from './validation.js';
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
  impersonating: { uid: 'u-sup', email: 'sup@example.com', isAdmin: true, isImpersonating: true, originalAdmin: { uid: 'u-admin', email: 'admin@example.com' } },
};

let h: PgliteDropship;
let base: string;
let disabledBase: string;
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
  for (const u of ['u-admin', 'u-sup', 'u-other', 'u-unverified', 'u-sup2']) await h.addUser(u);
  await h.addUser('u-restricted', { securityHold: true });
  const deps: DropshipDeps = {
    enabled: true, db: h.db, loadUserRestriction: h.loadUserRestriction, cloudinaryCloudName: CLOUD,
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
  assert.deepEqual((await api('GET', '/api/dropship/status', undefined, undefined, disabledBase)).body, { success: true, enabled: false });
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
  assert.deepEqual(Object.keys(status.body).sort(), ['enabled', 'success']);
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
