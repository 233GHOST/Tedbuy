import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createDropshipRouter, type DropshipDeps, type DropshipVerifiedUser } from './routes.js';
import { runOrderExpiry, type OrderMail, type OrderNotice } from './orderRoutes.js';
import { createPgliteDropship, type PgliteDropship } from './testing/pgliteDb.js';

// HTTP tests of the COD order routes against the real migrations (PGlite). Firebase token
// checks, email and notifications are replaced by in-memory fakes (mocked); everything
// from the router down is the real code and SQL.

const CLOUD = 'dfm3g2qvg';
const IMG = `https://res.cloudinary.com/${CLOUD}/image/upload/v1712/tedbuy_products/speaker.jpg`;
const USERS: Record<string, DropshipVerifiedUser> = {
  admin: { uid: 'o-admin', email: 'admin@example.com', isAdmin: true, emailVerified: true },
  sup: { uid: 'o-sup', email: 'sup@example.com', emailVerified: true },
  res: { uid: 'o-res', email: 'res@example.com', emailVerified: true },
  buyer: { uid: 'o-buyer', email: 'buyer@example.com', emailVerified: true },
  unverified: { uid: 'o-unv', email: 'unv@example.com', emailVerified: false },
  stranger: { uid: 'o-stranger', email: 'x@example.com', emailVerified: true },
  impersonating: { uid: 'o-buyer', email: 'buyer@example.com', isAdmin: true, isImpersonating: true, originalAdmin: { uid: 'o-admin', email: 'admin@example.com' } },
};
const VERIFIED = new Set(['o-admin', 'o-sup', 'o-res', 'o-buyer', 'o-stranger']);

let h: PgliteDropship;
let base: string;
let offBase: string;
let tokenBase: string;
const servers: import('node:http').Server[] = [];
const mails: OrderMail[] = [];
const notices: OrderNotice[] = [];
let nextCode = '246810';
let productId = '';

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

const delivery = { name: 'Ama Buyer', phone: '055 123 4567', region: 'Ashanti', area: 'Adum', address: 'House 4, Prempeh II Street' };
const placeBody = (over: Record<string, unknown> = {}) => ({ productId, quantity: 1, delivery, clientRequestId: crypto.randomUUID(), ...over });

before(async () => {
  h = await createPgliteDropship();
  for (const u of Object.values(USERS)) if (!u.isImpersonating) await h.addUser(u.uid);
  const deps: DropshipDeps = {
    enabled: true, db: h.db, loadUserRestriction: h.loadUserRestriction, cloudinaryCloudName: CLOUD,
    verifyUser: async auth => (auth?.startsWith('Bearer ') ? USERS[auth.slice(7)] ?? null : null),
    orders: {
      ordersEnabled: true,
      isEmailVerified: async uid => VERIFIED.has(uid),
      notify: async n => { notices.push(...n); },
      sendMail: async m => { mails.push(m); },
      makeCode: () => nextCode,
    },
  };
  base = await listen(deps);
  offBase = await listen({ ...deps, orders: { ...deps.orders!, ordersEnabled: false } });
  // Staging wiring: no Firebase Admin lookup, so the token's email_verified claim decides.
  tokenBase = await listen({ ...deps, orders: { ...deps.orders!, isEmailVerified: undefined } });

  // Supplier + reseller + listing, through the real API.
  for (const [who, kind, extra] of [['sup', 'supplier', { addressLine: '12 Ring Road, Osu' }], ['res', 'dropshipper', {}]] as const) {
    const a = await api('POST', '/api/dropship/applications', who, { clientRequestId: crypto.randomUUID(), kind, displayName: `${who} biz`,
      contactPhone: '0241234567', region: 'Greater Accra', city: 'Accra', termsVersion: 't-2026-10', ...extra });
    await api('POST', `/api/admin/dropship/applications/${a.body.participation.id}/decision`, 'admin', { decision: 'approve', expectedStatus: 'pending' });
  }
  const p = await api('POST', '/api/dropship/supplier/products', 'sup', { clientRequestId: crypto.randomUUID(), title: 'Bluetooth speaker X2',
    description: 'Portable speaker, 12 hours battery.', category: 'Electronics', images: [IMG], wholesalePricePesewas: 10000,
    stockOnHand: 10, shipsFromRegion: 'Greater Accra', shipsFromCity: 'Accra', deliveryFeeSameRegionPesewas: 1500,
    leadTimeMinDays: 1, leadTimeMaxDays: 3, submit: true });
  await api('POST', `/api/admin/dropship/supplier-products/${p.body.product.id}/moderate`, 'admin', { decision: 'approve' });
  const l = await api('POST', '/api/dropship/listings', 'res', { supplierProductId: p.body.product.id, retailPricePesewas: 15000, clientRequestId: crypto.randomUUID() });
  productId = l.body.productId;
  const fee = await api('PATCH', `/api/dropship/listings/${l.body.listing.id}/delivery-fee`, 'res', { deliveryFeePesewas: 2000 });
  assert.equal(fee.status, 200);
});

after(async () => {
  for (const s of servers) s.close();
  await h.close();
});

test('orders switch: off means 503 for ordering, status says so', async () => {
  const st = await api('GET', '/api/dropship/status', undefined, undefined, offBase);
  assert.equal(st.body.ordersEnabled, false);
  const r = await api('POST', '/api/dropship/orders', 'buyer', placeBody(), offBase);
  assert.equal(r.status, 503);
  assert.equal((await api('GET', '/api/dropship/status')).body.ordersEnabled, true);
});

test('buyer must be signed in, verified, and not impersonated; prices come from the server', async () => {
  assert.equal((await api('POST', '/api/dropship/orders', undefined, placeBody())).body.errorCode, 'UNAUTHENTICATED');
  const unv = await api('POST', '/api/dropship/orders', 'unverified', placeBody());
  assert.equal(unv.status, 403);
  assert.match(unv.body.error, /Verify your email/);
  assert.equal((await api('POST', '/api/dropship/orders', 'impersonating', placeBody())).body.errorCode, 'IMPERSONATION_FORBIDDEN');
  // A client-sent price is an unknown field, not a discount.
  assert.equal((await api('POST', '/api/dropship/orders', 'buyer', { ...placeBody(), unitPricePesewas: 1 })).body.errorCode, 'VALIDATION');
  assert.equal((await api('POST', '/api/dropship/orders', 'buyer', placeBody({ productId: 'p1' }))).body.errorCode, 'VALIDATION');
});

test('without an Admin lookup (staging), the token email_verified claim decides', async () => {
  const unv = await api('POST', '/api/dropship/orders', 'unverified', placeBody(), tokenBase);
  assert.equal(unv.status, 403);
  assert.match(unv.body.error, /Verify your email/);
  const ok = await api('POST', '/api/dropship/orders', 'buyer', placeBody(), tokenBase);
  assert.equal(ok.status, 201);
  assert.equal((await api('POST', `/api/dropship/orders/${ok.body.order.id}/cancel`, 'buyer', { reason: 'test' })).status, 200);
});

test('full COD flow over HTTP: code goes to the buyer only; notices and emails', async () => {
  mails.length = 0; notices.length = 0;
  const req = placeBody({ quantity: 2 });
  const placed = await api('POST', '/api/dropship/orders', 'buyer', req);
  assert.equal(placed.status, 201);
  assert.equal(placed.body.order.totalPesewas, 32000);
  assert.ok(!('buyerEmail' in placed.body) && !('notify' in placed.body), 'internal fields are not sent');
  assert.equal((await api('POST', '/api/dropship/orders', 'buyer', req)).status, 200, 'retry returns the same order');
  assert.match(mails[0].subject, /Please confirm/);
  assert.match(mails[0].text, /Pay only when you receive your order/);
  const id = placed.body.order.id;

  const step = async (who: 'buyer' | 'res' | 'sup', action: string, body: unknown = {}) => {
    const prefix = who === 'buyer' ? '/api/dropship/orders' : who === 'res' ? '/api/dropship/reseller/orders' : '/api/dropship/supplier/orders';
    const r = await api('POST', `${prefix}/${id}/${action}`, who, body);
    assert.equal(r.status, 200, `${who} ${action}: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  await step('buyer', 'confirm');
  await step('res', 'accept');
  await step('res', 'request_reservation', { holdHours: 24 });
  await step('sup', 'confirm_reservation');
  await step('res', 'declare_supplier_payment', { amountPesewas: 20000, method: 'momo', reference: 'MM1', paidOn: new Date().toISOString().slice(0, 10) });
  await step('sup', 'confirm_payment');
  await step('sup', 'released');
  await step('res', 'collected');
  nextCode = '135790';
  // The code is made by the server; a client-sent code is refused.
  assert.equal((await api('POST', `/api/dropship/reseller/orders/${id}/out_for_delivery`, 'res', { code: '000000' })).body.errorCode, 'VALIDATION');
  const out = await step('res', 'out_for_delivery');
  assert.ok(!JSON.stringify(out).includes('135790'));
  const codeMail = mails.find(m => /delivery code/.test(m.subject))!;
  assert.match(codeMail.text, /135790/);
  assert.match(codeMail.text, /It is not a payment/);
  assert.equal(codeMail.to, 'buyer@example.com');
  const buyerView = await api('GET', `/api/dropship/orders/${id}`, 'buyer');
  assert.equal(buyerView.body.order.deliveryCode, '135790');
  const resView = await api('GET', `/api/dropship/reseller/orders/${id}`, 'res');
  assert.ok(!JSON.stringify(resView.body).includes('135790'));
  const wrong = await step('res', 'verify_code', { code: '111111' });
  assert.equal(wrong.codeOk, false);
  assert.equal(wrong.attemptsLeft, 4);
  const ok = await step('res', 'verify_code', { code: '135790' });
  assert.equal(ok.order.status, 'delivered');
  const done = await step('res', 'record_payment', { amountPesewas: 32000, method: 'cash' });
  assert.equal(done.order.status, 'completed');
  assert.ok(notices.some(n => n.userId === 'o-sup' && /hold stock/.test(n.message)));
  assert.ok(notices.every(n => n.orderId === id));
});

test('access: strangers, wrong roles and unknown actions', async () => {
  const placed = await api('POST', '/api/dropship/orders', 'buyer', placeBody());
  const id = placed.body.order.id;
  assert.equal((await api('GET', `/api/dropship/orders/${id}`, 'stranger')).status, 404);
  assert.equal((await api('GET', `/api/dropship/reseller/orders/${id}`, 'stranger')).body.errorCode, 'NOT_FOUND');
  assert.equal((await api('POST', `/api/dropship/orders/${id}/cancel`, 'stranger', {})).status, 404);
  assert.equal((await api('POST', `/api/dropship/orders/${id}/accept`, 'buyer', {})).status, 404, 'buyer route has no accept');
  assert.equal((await api('POST', `/api/dropship/supplier/orders/${id}/record_payment`, 'sup', {})).status, 404, 'supplier cannot record buyer payment');
  assert.equal((await api('POST', `/api/dropship/supplier/orders/${id}/verify_code`, 'sup', {})).status, 404, 'supplier cannot mark delivery');
  assert.equal((await api('GET', `/api/admin/dropship/orders/${id}`, 'res')).status, 403);
  const admin = await api('GET', `/api/admin/dropship/orders/${id}`, 'admin');
  assert.equal(admin.body.order.buyerId, 'o-buyer');
  await api('POST', `/api/dropship/orders/${id}/cancel`, 'buyer', {});
});

test('admin settings, limits override and reliability', async () => {
  const s = await api('GET', '/api/admin/dropship/order-settings', 'admin');
  assert.equal(s.body.settings.limitTiers[0].perOrderPesewas, 20000);
  assert.equal((await api('PUT', '/api/admin/dropship/order-settings', 'res', { reason: 'x', buyerConfirmHours: 12 })).status, 403);
  const u = await api('PUT', '/api/admin/dropship/order-settings', 'admin', { reason: 'Owner asked', buyerConfirmHours: 12 });
  assert.equal(u.body.settings.buyerConfirmHours, 12);
  await api('PUT', '/api/admin/dropship/order-settings', 'admin', { reason: 'Back', buyerConfirmHours: 24 });
  const half = await api('PUT', '/api/admin/dropship/resellers/o-res/limits', 'admin', { perOrderPesewas: 50000, reason: 'one only' });
  assert.equal(half.body.errorCode, 'VALIDATION');
  const ov = await api('PUT', '/api/admin/dropship/resellers/o-res/limits', 'admin', { perOrderPesewas: 50000, openPesewas: 90000, reason: 'Known trader' });
  assert.equal(ov.body.limits.source, 'admin_override');
  const rel = await api('GET', '/api/admin/dropship/reliability/o-buyer', 'admin');
  assert.ok(rel.body.reliability.buyer.completed >= 1);
});

test('expiry sweep cancels overdue orders and notifies', async () => {
  const placed = await api('POST', '/api/dropship/orders', 'buyer', placeBody());
  await h.pg.query(`update public.dropship_orders set deadline_at = now() - interval '1 minute' where id = $1`, [placed.body.order.id]);
  notices.length = 0;
  const n = await runOrderExpiry(h.db, async x => { notices.push(...x); });
  assert.equal(n, 1);
  assert.ok(notices.some(x => x.userId === 'o-buyer' && /Nobody was charged/.test(x.message)));
  assert.equal((await api('GET', `/api/dropship/orders/${placed.body.order.id}`, 'buyer')).body.order.status, 'cancelled');
});
