import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DropshipError } from './errors.js';
import { createPgliteDropship, type PgliteDropship } from './testing/pgliteDb.js';

// Phase 4 (COD orders) SQL functions on PGlite with all Dropship migrations applied, called
// as service_role. Single connection: true concurrent interleavings are covered by the
// staging script (scripts/dropship-orders-concurrency.ts); here, reservations racing for the
// last unit are run back to back.

let h: PgliteDropship;
const IMG = 'https://res.cloudinary.com/dfm3g2qvg/image/upload/v1/tedbuy_products/order-a.jpg';
const W = 10000; // GH₵100 wholesale
const R = 15000; // GH₵150 retail

const productFields = (over: Record<string, unknown> = {}) => ({
  title: 'Bluetooth speaker X2', description: 'Portable speaker, 12 hours battery, splash resistant.',
  category: 'Electronics', brand: 'Sonix', images: [IMG], wholesalePricePesewas: W, suggestedRetailPesewas: R,
  stockOnHand: 5, maxPerOrder: 3, shipsFromRegion: 'Greater Accra', shipsFromCity: 'Tema',
  deliveryFeeSameRegionPesewas: 1500, deliveryFeeOtherRegionPesewas: 3000, leadTimeMinDays: 1, leadTimeMaxDays: 3,
  returnWindowDays: 3, ...over,
});
const supplierApplication = {
  displayName: 'Kofi Supplies', contactPhone: '0241234567', region: 'Greater Accra', city: 'Accra',
  addressLine: '12 Ring Road, Osu', termsVersion: 'supplier-2026-10',
};
const dropshipperApplication = (name: string) => ({
  displayName: `${name} Store`, contactPhone: '0201234567', region: 'Ashanti', city: 'Kumasi', termsVersion: 'dropshipper-2026-10',
});
const delivery = { name: 'Ama Buyer', phone: '0551234567', region: 'Ashanti', area: 'Adum', address: 'House 4, Prempeh II Street', instructions: 'Call first' };

async function expectCode(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof DropshipError && e.code === code ? true : (assert.fail(`expected ${code}, got ${(e as any)?.code}: ${(e as any)?.message}`), false));
}

async function ensureUser(id: string) {
  const r = await h.pg.query('select 1 from public.users where id = $1', [id]);
  if (r.rows.length === 0) await h.addUser(id);
}

async function approvedParticipant(id: string, kind: 'supplier' | 'dropshipper') {
  await ensureUser(id);
  const app = await h.db.call('dropship_submit_application', {
    p_user: id, p_kind: kind, p_fields: kind === 'supplier' ? supplierApplication : dropshipperApplication(id), p_client_request_id: crypto.randomUUID(),
  });
  await h.db.call('dropship_admin_decide_participation', { p_admin: 'admin1', p_participant_id: app.participant.id, p_decision: 'approve', p_reason: null, p_notes: null, p_expected_status: 'pending' });
}

interface World { buyer: string; reseller: string; supplier: string; spId: string; productId: string; listingId: string }

// A supplier with an active product, a reseller listing it at GH₵150 with a GH₵20 delivery
// fee, and a buyer.
async function world(tag: string, over: Record<string, unknown> = {}): Promise<World> {
  const supplier = `sup_${tag}`, reseller = `res_${tag}`, buyer = `buy_${tag}`;
  await approvedParticipant(supplier, 'supplier');
  await approvedParticipant(reseller, 'dropshipper');
  await ensureUser(buyer);
  const r = await h.db.call('dropship_create_supplier_product', {
    p_actor: supplier, p_actor_role: 'supplier', p_supplier_id: supplier, p_fields: productFields(over),
    p_submit: true, p_client_request_id: crypto.randomUUID(), p_reason: null,
  });
  await h.db.call('dropship_admin_moderate_supplier_product', { p_admin: 'admin1', p_id: r.product.id, p_decision: 'approve', p_reason: null });
  const l = await h.db.call('dropship_create_listing', { p_actor: reseller, p_supplier_product_id: r.product.id, p_retail_pesewas: R, p_client_request_id: crypto.randomUUID() });
  await h.db.call('dropship_set_listing_delivery_fee', { p_actor: reseller, p_listing_id: l.listing.id, p_fee: 2000 });
  return { buyer, reseller, supplier, spId: r.product.id, productId: l.productId, listingId: l.listing.id };
}

const place = (w: World, qty = 1, reqId: string = crypto.randomUUID(), buyer = w.buyer) =>
  h.db.call('dropship_place_order', { p_buyer: buyer, p_buyer_email: `${buyer}@example.com`, p_product_id: w.productId, p_quantity: qty, p_delivery: delivery, p_client_request_id: reqId });
const buyerAct = (w: World, id: string, action: string, input: Record<string, unknown> = {}, buyer = w.buyer) =>
  h.db.call('dropship_buyer_order_action', { p_buyer: buyer, p_order: id, p_action: action, p_input: input });
const resellerAct = (w: World, id: string, action: string, input: Record<string, unknown> = {}, actor = w.reseller) =>
  h.db.call('dropship_reseller_order_action', { p_actor: actor, p_order: id, p_action: action, p_input: input });
const supplierAct = (w: World, id: string, action: string, input: Record<string, unknown> = {}, actor = w.supplier) =>
  h.db.call('dropship_supplier_order_action', { p_actor: actor, p_order: id, p_action: action, p_input: input });
const stock = async (spId: string) => (await h.pg.query<any>('select stock_on_hand, stock_reserved from public.dropship_supplier_products where id = $1', [spId])).rows[0];
const status = async (id: string) => (await h.pg.query<any>('select status from public.dropship_orders where id = $1', [id])).rows[0].status;
const reliability = (user: string, role: string) => h.db.call('dropship_reliability_summary', { p_user: user, p_role: role });

// Drives an order to the given point of the happy path and returns its id.
async function to(w: World, point: 'buyer_confirmed' | 'accepted' | 'reserved' | 'declared' | 'released' | 'collected' | 'out' | 'delivered', qty = 1) {
  const id = (await place(w, qty)).order.id as string;
  await buyerAct(w, id, 'confirm');
  if (point === 'buyer_confirmed') return id;
  await resellerAct(w, id, 'accept');
  if (point === 'accepted') return id;
  await resellerAct(w, id, 'request_reservation');
  await supplierAct(w, id, 'confirm_reservation');
  if (point === 'reserved') return id;
  await resellerAct(w, id, 'declare_supplier_payment', { amountPesewas: W * qty, method: 'momo', reference: 'MM123' });
  if (point === 'declared') return id;
  await supplierAct(w, id, 'confirm_payment');
  await supplierAct(w, id, 'released');
  if (point === 'released') return id;
  await resellerAct(w, id, 'collected');
  if (point === 'collected') return id;
  await resellerAct(w, id, 'out_for_delivery', { code: '123456' });
  if (point === 'out') return id;
  await resellerAct(w, id, 'verify_code', { code: '123456' });
  return id;
}

before(async () => { h = await createPgliteDropship(); });
after(async () => { await h.close(); });

test('successful COD order: every step, money records, stock and history', async () => {
  const w = await world('happy');
  const placed = await place(w, 2);
  const id = placed.order.id;
  assert.equal(placed.order.status, 'placed');
  assert.equal(placed.order.totalPesewas, R * 2 + 2000, 'total = retail x qty + reseller delivery fee');
  assert.deepEqual(placed.notify.map((n: any) => n.audience).sort(), ['buyer', 'dropshipper']);

  assert.equal((await buyerAct(w, id, 'confirm')).order.status, 'buyer_confirmed');
  assert.equal((await resellerAct(w, id, 'accept')).order.status, 'accepted');
  assert.equal((await resellerAct(w, id, 'request_reservation', { holdHours: 24 })).order.status, 'reservation_requested');
  assert.deepEqual(await stock(w.spId), { stock_on_hand: 5, stock_reserved: 0 }, 'a request alone holds nothing');

  const reserved = await supplierAct(w, id, 'confirm_reservation');
  assert.equal(reserved.order.status, 'reserved');
  assert.deepEqual(await stock(w.spId), { stock_on_hand: 5, stock_reserved: 2 });

  const declared = await resellerAct(w, id, 'declare_supplier_payment', { amountPesewas: W * 2, method: 'cash' });
  assert.equal(declared.order.status, 'supplier_payment_declared');
  assert.equal(declared.order.payments[0].status, 'declared', 'a declaration is not a confirmation');

  const paid = await supplierAct(w, id, 'confirm_payment');
  assert.equal(paid.order.status, 'supplier_paid');
  assert.equal(paid.order.payments[0].status, 'confirmed');
  assert.equal((await supplierAct(w, id, 'released')).order.status, 'released');
  assert.deepEqual(await stock(w.spId), { stock_on_hand: 3, stock_reserved: 0 }, 'release commits the held stock');
  assert.equal(await status(id), 'released', 'release does not mark collection');

  assert.equal((await resellerAct(w, id, 'collected')).order.status, 'collected');
  const out = await resellerAct(w, id, 'out_for_delivery', { code: '654321' });
  assert.equal(out.order.status, 'out_for_delivery');
  assert.ok(!JSON.stringify(out.order).includes('654321'), 'the reseller never sees the code');
  const buyerView = await h.db.call('dropship_get_order', { p_actor: w.buyer, p_role: 'buyer', p_order: id });
  assert.equal(buyerView.order.deliveryCode, '654321');

  const delivered = await resellerAct(w, id, 'verify_code', { code: '654321' });
  assert.equal(delivered.codeOk, true);
  assert.equal(delivered.order.status, 'delivered', 'delivery code = received, payment still pending');
  assert.equal(delivered.order.deliveryConfirmation, 'code');

  const done = await resellerAct(w, id, 'record_payment', { amountPesewas: R * 2 + 2000, method: 'momo', reference: 'BUY1' });
  assert.equal(done.order.status, 'completed');
  const buyerPay = done.order.payments.find((p: any) => p.kind === 'buyer_to_reseller');
  assert.equal(buyerPay.status, 'recorded', 'buyer payments are recorded, never shown as verified');

  const events = (await h.pg.query<any>('select action, to_status from public.dropship_order_events where order_id = $1 order by id', [id])).rows;
  assert.deepEqual(events.map(e => e.action), ['placed', 'buyer_confirmed', 'accepted', 'reservation_requested', 'reservation_confirmed',
    'supplier_payment_declared', 'supplier_payment_confirmed', 'released', 'collected', 'out_for_delivery', 'delivered', 'buyer_payment_recorded']);
  assert.equal((await reliability(w.buyer, 'buyer')).completed, 1);
  assert.equal((await reliability(w.supplier, 'supplier')).completed, 1);
  const mine = await h.db.call('dropship_list_my_listings', { p_actor: w.reseller });
  assert.equal(mine.listings[0].unitsSold, 2);
});

test('steps cannot be skipped, and each role can only make its own moves', async () => {
  const w = await world('skip');
  const id = (await place(w)).order.id;
  await expectCode(resellerAct(w, id, 'accept'), 'STATE_CONFLICT'); // buyer has not confirmed
  await buyerAct(w, id, 'confirm');
  await expectCode(resellerAct(w, id, 'request_reservation'), 'STATE_CONFLICT'); // not accepted yet
  await resellerAct(w, id, 'accept');
  await expectCode(resellerAct(w, id, 'declare_supplier_payment', { amountPesewas: W, method: 'cash' }), 'STATE_CONFLICT');
  await resellerAct(w, id, 'request_reservation');
  await supplierAct(w, id, 'confirm_reservation');
  await expectCode(supplierAct(w, id, 'released'), 'STATE_CONFLICT'); // no payment confirmed
  await expectCode(resellerAct(w, id, 'collected'), 'STATE_CONFLICT');
  await resellerAct(w, id, 'declare_supplier_payment', { amountPesewas: W, method: 'cash', evidenceUrl: 'https://res.cloudinary.com/x/image/upload/v1/s.jpg' });
  // A reseller's declaration (even with a screenshot) never moves it to supplier-paid.
  assert.equal(await status(id), 'supplier_payment_declared');
  await expectCode(resellerAct(w, id, 'confirm_payment'), 'VALIDATION'); // not a reseller action
  await expectCode(supplierAct(w, id, 'released'), 'STATE_CONFLICT');
  await supplierAct(w, id, 'confirm_payment');
  await supplierAct(w, id, 'released');
  // The supplier can never mark delivery or the buyer's payment.
  await expectCode(supplierAct(w, id, 'verify_code', { code: '000000' }), 'VALIDATION');
  await expectCode(supplierAct(w, id, 'record_payment', { amountPesewas: R, method: 'cash' }), 'VALIDATION');
  await expectCode(resellerAct(w, id, 'record_payment', { amountPesewas: R, method: 'cash' }), 'STATE_CONFLICT'); // not delivered
  await resellerAct(w, id, 'collected');
  await expectCode(resellerAct(w, id, 'record_payment', { amountPesewas: R, method: 'cash' }), 'STATE_CONFLICT');
  // Cancelled orders never continue.
  const c = (await place(w)).order.id;
  await buyerAct(w, c, 'cancel');
  await expectCode(buyerAct(w, c, 'confirm'), 'STATE_CONFLICT');
  await expectCode(resellerAct(w, c, 'accept'), 'STATE_CONFLICT');
});

test('repeated requests are safe (idempotent moves and order placement)', async () => {
  const w = await world('idem');
  const req = crypto.randomUUID();
  const a = await place(w, 1, req);
  const b = await place(w, 1, req);
  assert.equal(a.order.id, b.order.id);
  assert.equal(b.changed, false);
  assert.equal((await h.pg.query('select 1 from public.dropship_orders where buyer_id = $1', [w.buyer])).rows.length, 1);
  const id = a.order.id;
  await buyerAct(w, id, 'confirm');
  assert.equal((await buyerAct(w, id, 'confirm')).changed, false);
  await resellerAct(w, id, 'accept');
  assert.equal((await resellerAct(w, id, 'accept')).changed, false);
  await resellerAct(w, id, 'request_reservation');
  assert.equal((await resellerAct(w, id, 'request_reservation')).changed, false);
  await supplierAct(w, id, 'confirm_reservation');
  assert.equal((await supplierAct(w, id, 'confirm_reservation')).changed, false);
  assert.equal((await stock(w.spId)).stock_reserved, 1, 'a repeated confirm does not reserve twice');
  await resellerAct(w, id, 'declare_supplier_payment', { amountPesewas: W, method: 'cash' });
  assert.equal((await resellerAct(w, id, 'declare_supplier_payment', { amountPesewas: W, method: 'cash' })).changed, false);
  assert.equal((await h.pg.query('select 1 from public.dropship_order_payments where order_id = $1', [id])).rows.length, 1);
});

test('buyer cancellation before purchase is free; after the reseller pays it is refused', async () => {
  const w = await world('bcancel');
  const id = await to(w, 'reserved');
  assert.equal((await stock(w.spId)).stock_reserved, 1);
  const c = await buyerAct(w, id, 'cancel', { reason: 'Changed my mind' });
  assert.equal(c.order.status, 'cancelled');
  assert.equal((await stock(w.spId)).stock_reserved, 0, 'held stock goes back');
  const rel = await reliability(w.buyer, 'buyer');
  assert.equal(rel.cancelledEarly, 1);
  assert.equal(rel.verifiedProblems, 0, 'an early cancellation is not a problem');
  assert.equal(rel.level, 'new');

  const paidId = await to(w, 'declared');
  await expectCode(buyerAct(w, paidId, 'cancel'), 'STATE_CONFLICT');
});

test('reseller can reject an order (e.g. buyer unreachable on confirmation call)', async () => {
  const w = await world('reject');
  const id = await to(w, 'buyer_confirmed');
  await expectCode(resellerAct(w, id, 'reject', {}), 'VALIDATION');
  const r = await resellerAct(w, id, 'reject', { reason: 'Buyer phone number is not reachable', reasonCode: 'invalid_contact' });
  assert.equal(r.order.status, 'cancelled');
  assert.equal(r.order.cancelReason, 'Buyer phone number is not reachable');
});

test('supplier says out of stock: cancelled without anyone paying, no blame', async () => {
  const w = await world('oos');
  const id = await to(w, 'accepted');
  await resellerAct(w, id, 'request_reservation');
  const d = await supplierAct(w, id, 'decline_reservation', { reasonCode: 'out_of_stock' });
  assert.equal(d.order.status, 'cancelled');
  assert.equal((await h.pg.query('select 1 from public.dropship_order_payments where order_id = $1', [id])).rows.length, 0);
  assert.equal((await reliability(w.supplier, 'supplier')).verifiedProblems, 0);
});

test('supplier confirms more than is free: refused under the product lock (last unit)', async () => {
  const w = await world('race', { stockOnHand: 1, maxPerOrder: 1 });
  const a = await to(w, 'accepted');
  const b = await to(w, 'accepted');
  await resellerAct(w, a, 'request_reservation');
  await resellerAct(w, b, 'request_reservation');
  await supplierAct(w, a, 'confirm_reservation');
  await expectCode(supplierAct(w, b, 'confirm_reservation'), 'STATE_CONFLICT');
  assert.deepEqual(await stock(w.spId), { stock_on_hand: 1, stock_reserved: 1 });
  // The listing is now out of stock for new buyers too.
  await expectCode(place(w), 'STATE_CONFLICT');
  // Stock can't be set below what is held.
  await expectCode(h.db.call('dropship_set_stock', { p_actor: w.supplier, p_actor_role: 'supplier', p_id: w.spId, p_new_on_hand: 0, p_expected_on_hand: null, p_reason: null }), 'VALIDATION');
});

test('price changed after the order: reseller must accept or decline; margin never changes silently', async () => {
  const w = await world('price');
  const id = await to(w, 'accepted');
  await resellerAct(w, id, 'request_reservation');
  const sp = (await h.pg.query<any>('select content_version from public.dropship_supplier_products where id = $1', [w.spId])).rows[0];
  await h.db.call('dropship_update_supplier_product', { p_actor: w.supplier, p_actor_role: 'supplier', p_id: w.spId, p_fields: { wholesalePricePesewas: 12000 }, p_expected_content_version: sp.content_version, p_reason: null });
  const r = await supplierAct(w, id, 'confirm_reservation');
  assert.equal(r.order.status, 'price_review');
  const view = (await h.db.call('dropship_get_order', { p_actor: w.reseller, p_role: 'dropshipper', p_order: id })).order;
  assert.equal(view.wholesaleUnitAtOrder, W);
  assert.equal(view.wholesaleUnitProposed, 12000);
  assert.equal(view.wholesaleUnitAgreed, null);
  assert.equal(view.margin.grossPesewas, R + 2000 - 12000, 'margin shown at the new price');
  await expectCode(resellerAct(w, id, 'declare_supplier_payment', { amountPesewas: 12000, method: 'cash' }), 'STATE_CONFLICT');
  await expectCode(resellerAct(w, id, 'accept_price', { wholesaleUnitPesewas: W }), 'STATE_CONFLICT'); // stale price
  const ok = await resellerAct(w, id, 'accept_price', { wholesaleUnitPesewas: 12000 });
  assert.equal(ok.order.status, 'reserved');
  assert.equal(ok.order.wholesaleUnitAgreed, 12000);

  const id2 = await to(w, 'accepted');
  await resellerAct(w, id2, 'request_reservation');
  const sp2 = (await h.pg.query<any>('select content_version from public.dropship_supplier_products where id = $1', [w.spId])).rows[0];
  await h.db.call('dropship_update_supplier_product', { p_actor: w.supplier, p_actor_role: 'supplier', p_id: w.spId, p_fields: { wholesalePricePesewas: 13000 }, p_expected_content_version: sp2.content_version, p_reason: null });
  // Order 2 was placed at 12000; now 13000.
  await supplierAct(w, id2, 'confirm_reservation');
  const before = (await stock(w.spId)).stock_reserved;
  const d = await resellerAct(w, id2, 'decline_price');
  assert.equal(d.order.status, 'cancelled');
  assert.equal((await stock(w.spId)).stock_reserved, before - 1);
});

test('time limits: expired steps cancel without blame and release held stock', async () => {
  const w = await world('expire');
  const placedOnly = (await place(w)).order.id;
  const reserved = await to(w, 'reserved');
  const declared = await to(w, 'declared');
  assert.equal((await stock(w.spId)).stock_reserved, 2);
  await h.pg.query(`update public.dropship_orders set deadline_at = now() - interval '1 minute' where id in ($1, $2)`, [placedOnly, reserved]);
  // A paid (declared) order never expires, even with an old reservation.
  await h.pg.query(`update public.dropship_reservations set expires_at = now() - interval '1 minute' where order_id = $1`, [declared]);
  const out = await h.db.call('dropship_expire_due', { p_limit: 50 });
  assert.equal(out.length, 2);
  assert.equal(await status(placedOnly), 'cancelled');
  assert.equal(await status(reserved), 'cancelled');
  assert.equal(await status(declared), 'supplier_payment_declared');
  assert.equal((await stock(w.spId)).stock_reserved, 1);
  const res = (await h.pg.query<any>('select status from public.dropship_reservations where order_id = $1', [reserved])).rows[0];
  assert.equal(res.status, 'expired');
  for (const role of ['buyer', 'dropshipper', 'supplier']) {
    const user = role === 'buyer' ? w.buyer : role === 'supplier' ? w.supplier : w.reseller;
    assert.equal((await reliability(user, role)).verifiedProblems, 0, `${role} not blamed`);
  }
  assert.equal((await h.db.call('dropship_expire_due', { p_limit: 50 })).length, 0, 'second sweep does nothing');
});

test('supplier says the money did not arrive: back to reserved, reseller can pay again or dispute', async () => {
  const w = await world('nopay');
  const id = await to(w, 'declared');
  await expectCode(supplierAct(w, id, 'reject_payment', {}), 'VALIDATION');
  const r = await supplierAct(w, id, 'reject_payment', { reason: 'No MoMo received' });
  assert.equal(r.order.status, 'reserved');
  const again = await resellerAct(w, id, 'declare_supplier_payment', { amountPesewas: W, method: 'momo', reference: 'MM999' });
  assert.equal(again.order.status, 'supplier_payment_declared');
  const pays = (await h.pg.query<any>('select status from public.dropship_order_payments where order_id = $1 order by created_at', [id])).rows;
  assert.deepEqual(pays.map(p => p.status), ['rejected', 'declared']);
  // Still no confirmation: the reseller disputes; the order freezes for an admin.
  const d = await resellerAct(w, id, 'dispute', { reasonCode: 'paid_not_released', description: 'I paid by MoMo, reference MM999.' });
  assert.equal(d.order.status, 'disputed');
  await expectCode(supplierAct(w, id, 'confirm_payment'), 'STATE_CONFLICT');
  // The complaint alone does not count against the supplier.
  assert.equal((await reliability(w.supplier, 'supplier')).verifiedProblems, 0);
});

test('delivery code: wrong codes are counted, lock after 5, expire, and can be reissued', async () => {
  const w = await world('code');
  const id = await to(w, 'out');
  const wrong = await resellerAct(w, id, 'verify_code', { code: '000000' });
  assert.equal(wrong.codeOk, false);
  assert.equal(wrong.codeProblem, 'wrong');
  assert.equal(wrong.attemptsLeft, 4);
  for (let i = 0; i < 4; i++) await resellerAct(w, id, 'verify_code', { code: '000001' });
  const locked = await resellerAct(w, id, 'verify_code', { code: '123456' });
  assert.equal(locked.codeOk, false, 'even the right code is refused once locked');
  assert.equal(locked.codeProblem, 'locked');
  assert.equal(await status(id), 'out_for_delivery');
  await resellerAct(w, id, 'resend_code', { code: '222222' });
  assert.equal((await resellerAct(w, id, 'verify_code', { code: '222222' })).codeOk, true);
  assert.equal(await status(id), 'delivered');

  const id2 = await to(w, 'out');
  await h.pg.query(`update public.dropship_delivery_codes set expires_at = now() - interval '1 minute' where order_id = $1`, [id2]);
  const exp = await resellerAct(w, id2, 'verify_code', { code: '123456' });
  assert.equal(exp.codeProblem, 'expired');
  const bv = (await h.db.call('dropship_get_order', { p_actor: w.buyer, p_role: 'buyer', p_order: id2 })).order;
  assert.equal(bv.deliveryCode, null, 'expired codes are not shown');
  // Reissue limit.
  await resellerAct(w, id2, 'resend_code', { code: '333333' });
  await resellerAct(w, id2, 'resend_code', { code: '444444' });
  await expectCode(resellerAct(w, id2, 'resend_code', { code: '555555' }), 'STATE_CONFLICT');
  // Codes are never in the event history.
  const hist = JSON.stringify((await h.pg.query('select * from public.dropship_order_events where order_id = $1', [id2])).rows);
  assert.ok(!/123456|333333|444444/.test(hist));
});

test('buyer received but has not paid: payment stays pending until recorded', async () => {
  const w = await world('pending');
  const id = await to(w, 'out');
  const r = await buyerAct(w, id, 'received');
  assert.equal(r.order.status, 'delivered');
  assert.equal(r.order.deliveryConfirmation, 'buyer');
  assert.deepEqual(r.order.payments, []);
  await expectCode(h.db.call('dropship_admin_resolve_dispute', { p_admin: 'admin1', p_order: id, p_outcome: 'completed', p_fault: 'none', p_fault_type: null, p_resolution: 'no case open' }), 'STATE_CONFLICT');
  assert.equal(await status(id), 'delivered');
  assert.equal((await resellerAct(w, id, 'record_payment', { amountPesewas: R + 2000, method: 'cash' })).order.status, 'completed');
});

test('delivered without code needs a note, and the buyer can confirm afterwards', async () => {
  const w = await world('nocode');
  const id = await to(w, 'out');
  await expectCode(resellerAct(w, id, 'delivered_without_code', { note: '' }), 'VALIDATION');
  const r = await resellerAct(w, id, 'delivered_without_code', { note: 'Buyer phone was off; neighbour received' });
  assert.equal(r.order.deliveryConfirmation, 'reseller_only');
  const b = await buyerAct(w, id, 'received');
  assert.equal(b.order.deliveryConfirmation, 'buyer');
  assert.equal(b.order.status, 'delivered');
});

test('failed delivery and refusal: reported unverified, retry or close', async () => {
  const w = await world('fail');
  const id = await to(w, 'out');
  await expectCode(resellerAct(w, id, 'delivery_failed', { reasonCode: 'nope' }), 'VALIDATION');
  const f = await resellerAct(w, id, 'delivery_failed', { reasonCode: 'buyer_refused', note: 'Refused at the door' });
  assert.equal(f.order.status, 'delivery_failed');
  const rel = await reliability(w.buyer, 'buyer');
  assert.equal(rel.reportedProblems, 1);
  assert.equal(rel.verifiedProblems, 0, 'one unverified report never counts as a problem');
  assert.equal(rel.level, 'new');
  // Retry with a new code.
  const again = await resellerAct(w, id, 'out_for_delivery', { code: '777777' });
  assert.equal(again.order.status, 'out_for_delivery');
  assert.equal(again.order.deliveryAttempts, 2);
  await resellerAct(w, id, 'delivery_failed', { reasonCode: 'buyer_unreachable' });
  const closed = await resellerAct(w, id, 'close_failed', { reason: 'Buyer never answered after two attempts' });
  assert.equal(closed.order.status, 'cancelled');
});

test('return: inside the window, accepted with refund record, or refused', async () => {
  const w = await world('ret');
  const id = await to(w, 'delivered');
  await expectCode(buyerAct(w, id, 'return', { reasonCode: 'defective', description: 'Does not charge' }), 'STATE_CONFLICT'); // not completed
  await resellerAct(w, id, 'record_payment', { amountPesewas: R + 2000, method: 'cash' });
  await expectCode(buyerAct(w, id, 'return', { reasonCode: 'buyer_refused', description: 'bad reason code' }), 'VALIDATION');
  const r = await buyerAct(w, id, 'return', { reasonCode: 'defective', description: 'Does not charge at all' });
  assert.equal(r.order.status, 'return_requested');
  const a = await resellerAct(w, id, 'return_accept', { refundPesewas: R + 2000, method: 'momo', note: 'Item collected back' });
  assert.equal(a.order.status, 'returned');
  assert.ok(a.order.payments.some((p: any) => p.kind === 'refund_to_buyer' && p.status === 'recorded'));
  const s = await supplierAct(w, id, 'record_refund', { amountPesewas: W, method: 'cash' });
  assert.ok(s.order.payments.some((p: any) => p.kind === 'supplier_refund_to_reseller'));

  const id2 = await to(w, 'delivered');
  await resellerAct(w, id2, 'record_payment', { amountPesewas: R + 2000, method: 'cash' });
  await buyerAct(w, id2, 'return', { reasonCode: 'changed_mind', description: 'Do not want it' });
  const rej = await resellerAct(w, id2, 'return_reject', { note: 'Seal broken and used; not a fault' });
  assert.equal(rej.order.status, 'completed');

  const id3 = await to(w, 'delivered');
  await resellerAct(w, id3, 'record_payment', { amountPesewas: R + 2000, method: 'cash' });
  await h.pg.query(`update public.dropship_orders set delivered_at = now() - interval '4 days' where id = $1`, [id3]);
  await expectCode(buyerAct(w, id3, 'return', { reasonCode: 'defective', description: 'Broke after 4 days' }), 'STATE_CONFLICT');
});

test('wrong or defective item dispute: admin finding is the only thing that counts', async () => {
  const w = await world('disp');
  const id = await to(w, 'delivered');
  const d = await buyerAct(w, id, 'dispute', { reasonCode: 'wrong_item', description: 'Got a different model', evidence: ['https://res.cloudinary.com/x/image/upload/v1/e.jpg'] });
  assert.equal(d.order.status, 'disputed');
  assert.equal((await buyerAct(w, id, 'dispute', { reasonCode: 'other', description: 'second' })).changed, false, 'a retry, not a second case');
  assert.equal((await h.pg.query('select 1 from public.dropship_disputes where order_id = $1', [id])).rows.length, 1);
  assert.equal((await reliability(w.supplier, 'supplier')).verifiedProblems, 0);
  await expectCode(h.db.call('dropship_admin_resolve_dispute', { p_admin: 'admin1', p_order: id, p_outcome: 'returned', p_fault: 'supplier', p_fault_type: null, p_resolution: 'Supplier sent wrong model' }), 'VALIDATION');
  const r = await h.db.call('dropship_admin_resolve_dispute', { p_admin: 'admin1', p_order: id, p_outcome: 'returned', p_fault: 'supplier', p_fault_type: 'incorrect_product', p_resolution: 'Photos show a different model; supplier at fault' });
  assert.equal(r.order.status, 'returned');
  assert.equal((await reliability(w.supplier, 'supplier')).verifiedProblems, 1);
  const audit = (await h.pg.query<any>(`select action from public.dropship_audit_events where target_type = 'order' and target_id = $1`, [id])).rows;
  assert.deepEqual(audit.map(a => a.action), ['dispute_resolved']);

  // 'resumed' goes back to where it was; a never-delivered order can't be "completed".
  const id2 = await to(w, 'declared');
  await resellerAct(w, id2, 'dispute', { reasonCode: 'paid_not_released', description: 'Paid, nothing released' });
  await expectCode(h.db.call('dropship_admin_resolve_dispute', { p_admin: 'admin1', p_order: id2, p_outcome: 'completed', p_fault: 'none', p_fault_type: null, p_resolution: 'not possible' }), 'STATE_CONFLICT');
  const res = await h.db.call('dropship_admin_resolve_dispute', { p_admin: 'admin1', p_order: id2, p_outcome: 'resumed', p_fault: 'none', p_fault_type: null, p_resolution: 'Supplier found the payment' });
  assert.equal(res.order.status, 'supplier_payment_declared');
});

test('who sees what: buyer, supplier and reseller projections; strangers get NOT_FOUND', async () => {
  const w = await world('priv');
  const id = await to(w, 'accepted');
  const resellerBefore = (await h.db.call('dropship_get_order', { p_actor: w.reseller, p_role: 'dropshipper', p_order: id })).order;
  assert.equal(resellerBefore.supplier, null, 'no pickup details before the hold is confirmed');
  // The supplier can't even see it before a reservation is requested.
  await expectCode(h.db.call('dropship_get_order', { p_actor: w.supplier, p_role: 'supplier', p_order: id }), 'NOT_FOUND');
  assert.equal((await h.db.call('dropship_list_orders', { p_actor: w.supplier, p_role: 'supplier', p_scope: null, p_status: null, p_after_created: null, p_after_id: null, p_limit: 10 })).orders.length, 0);
  await resellerAct(w, id, 'request_reservation');
  await supplierAct(w, id, 'confirm_reservation');

  const sup = JSON.stringify((await h.db.call('dropship_get_order', { p_actor: w.supplier, p_role: 'supplier', p_order: id })).order);
  for (const secret of ['Ama Buyer', '0551234567', 'Prempeh', 'Adum', w.buyer, String(R), 'totalPesewas', 'unitPricePesewas', 'margin']) {
    assert.ok(!sup.includes(secret), `supplier view leaks ${secret}`);
  }
  const supList = JSON.stringify(await h.db.call('dropship_list_orders', { p_actor: w.supplier, p_role: 'supplier', p_scope: null, p_status: null, p_after_created: null, p_after_id: null, p_limit: 10 }));
  assert.ok(!supList.includes('totalPesewas') && !supList.includes(w.buyer));

  const buy = JSON.stringify((await h.db.call('dropship_get_order', { p_actor: w.buyer, p_role: 'buyer', p_order: id })).order);
  for (const secret of ['Kofi Supplies', '0241234567', 'Ring Road', w.supplier, String(W), 'wholesale']) {
    assert.ok(!buy.includes(secret), `buyer view leaks ${secret}`);
  }
  const res = (await h.db.call('dropship_get_order', { p_actor: w.reseller, p_role: 'dropshipper', p_order: id })).order;
  assert.equal(res.supplier.address, '12 Ring Road, Osu', 'pickup address once reserved');
  assert.equal(res.buyer.phone, '0551234567');
  assert.ok(!JSON.stringify(res).includes(`${w.buyer}@example.com`), 'buyer email stays private');

  await ensureUser('stranger');
  for (const role of ['buyer', 'dropshipper', 'supplier']) {
    await expectCode(h.db.call('dropship_get_order', { p_actor: 'stranger', p_role: role, p_order: id }), 'NOT_FOUND');
  }
  await expectCode(buyerAct(w, id, 'cancel', {}, 'stranger'), 'NOT_FOUND');
  // Another approved reseller can't act on it either.
  await approvedParticipant('res_other', 'dropshipper');
  await expectCode(resellerAct(w, id, 'cancel', { reason: 'not mine' }, 'res_other'), 'NOT_FOUND');
});

test('reseller limits: per-order and open totals, tiers by completed orders, admin override', async () => {
  const w = await world('limit', { wholesalePricePesewas: 9000, suggestedRetailPesewas: 12000, stockOnHand: 50, maxPerOrder: 10 });
  // GH₵90 x 3 = GH₵270 > GH₵200 per order.
  const big = await to(w, 'accepted', 3);
  await expectCode(resellerAct(w, big, 'request_reservation'), 'LIMIT_EXCEEDED');
  // Two orders of GH₵180 = GH₵360 open; a third pushes past GH₵400.
  const o1 = await to(w, 'accepted', 2);
  const o2 = await to(w, 'accepted', 2);
  const o3 = await to(w, 'accepted', 1);
  await resellerAct(w, o1, 'request_reservation');
  await resellerAct(w, o2, 'request_reservation');
  await expectCode(resellerAct(w, o3, 'request_reservation'), 'LIMIT_EXCEEDED');
  const s = await h.db.call('dropship_reseller_summary', { p_actor: w.reseller });
  assert.equal(s.exposurePesewas, 36000);
  assert.equal(s.perOrderPesewas, 20000);
  assert.equal(s.openPesewas, 40000);
  // Admin override lifts it.
  await expectCode(h.db.call('dropship_admin_set_limit_override', { p_admin: 'admin1', p_user: w.reseller, p_per_order: 50000, p_open: 1000, p_reason: 'trusted' }), 'VALIDATION');
  await h.db.call('dropship_admin_set_limit_override', { p_admin: 'admin1', p_user: w.reseller, p_per_order: 50000, p_open: 100000, p_reason: 'Known trader' });
  assert.equal((await resellerAct(w, big, 'request_reservation')).order.status, 'reservation_requested');
  await h.db.call('dropship_admin_set_limit_override', { p_admin: 'admin1', p_user: w.reseller, p_per_order: null, p_open: null, p_reason: 'Back to tiers' });
  // Tier 2 after 3 completed orders.
  const t = await world('tier');
  for (let i = 0; i < 3; i++) {
    const id = await to(t, 'delivered');
    await resellerAct(t, id, 'record_payment', { amountPesewas: R + 2000, method: 'cash' });
  }
  const lim = await h.db.call('dropship_reseller_limits', { p_user: t.reseller });
  assert.deepEqual([lim.tier, lim.perOrderPesewas, lim.openPesewas], [1, 50000, 100000]);
  // Admin settings change the tiers.
  await expectCode(h.db.call('dropship_admin_update_settings', { p_admin: 'admin1', p_settings: { limitTiers: [{ minCompleted: 1, perOrderPesewas: 1, openPesewas: 1 }] }, p_reason: 'test' }), 'VALIDATION');
  const st = await h.db.call('dropship_admin_update_settings', { p_admin: 'admin1', p_settings: { limitTiers: [{ minCompleted: 0, perOrderPesewas: 30000, openPesewas: 60000 }] }, p_reason: 'Owner change' });
  assert.equal(st.limitTiers.length, 1);
  assert.equal((await h.db.call('dropship_reseller_limits', { p_user: t.reseller })).perOrderPesewas, 30000);
  await h.db.call('dropship_admin_update_settings', { p_admin: 'admin1', p_settings: { limitTiers: [
    { minCompleted: 0, perOrderPesewas: 20000, openPesewas: 40000 }, { minCompleted: 3, perOrderPesewas: 50000, openPesewas: 100000 },
    { minCompleted: 10, perOrderPesewas: 150000, openPesewas: 300000 }] }, p_reason: 'restore' });
});

test('placing orders: own product, quantity, availability and open-order cap', async () => {
  const w = await world('placing');
  await expectCode(place(w, 1, crypto.randomUUID(), w.reseller), 'FORBIDDEN');
  await expectCode(place(w, 4), 'VALIDATION'); // max 3 per order
  await expectCode(h.db.call('dropship_place_order', { p_buyer: w.buyer, p_buyer_email: null, p_product_id: w.productId, p_quantity: 1, p_delivery: { ...delivery, phone: '12' }, p_client_request_id: crypto.randomUUID() }), 'VALIDATION');
  await expectCode(h.db.call('dropship_place_order', { p_buyer: w.buyer, p_buyer_email: null, p_product_id: 'dsl_nothere', p_quantity: 1, p_delivery: delivery, p_client_request_id: crypto.randomUUID() }), 'NOT_FOUND');
  for (let i = 0; i < 5; i++) await place(w);
  await expectCode(place(w), 'STATE_CONFLICT');
});

test('history and reliability tables are append-only', async () => {
  const w = await world('immut');
  const id = (await place(w)).order.id;
  await assert.rejects(h.pg.query(`update public.dropship_order_events set action = 'x' where order_id = $1`, [id]));
  await assert.rejects(h.pg.query(`delete from public.dropship_order_events where order_id = $1`, [id]));
  await buyerAct(w, id, 'cancel');
  await assert.rejects(h.pg.query(`delete from public.dropship_reliability_events where order_id = $1`, [id]));
});

test('admin cancel closes any open case and releases stock; finished orders stay finished', async () => {
  const w = await world('acancel');
  const id = await to(w, 'declared');
  await resellerAct(w, id, 'dispute', { reasonCode: 'paid_not_released', description: 'Supplier not answering' });
  await expectCode(h.db.call('dropship_admin_cancel_order', { p_admin: 'admin1', p_order: id, p_reason: '' }), 'VALIDATION');
  const c = await h.db.call('dropship_admin_cancel_order', { p_admin: 'admin1', p_order: id, p_reason: 'Supplier account closed' });
  assert.equal(c.order.status, 'cancelled');
  assert.equal((await stock(w.spId)).stock_reserved, 0);
  const done = await to(w, 'delivered');
  await resellerAct(w, done, 'record_payment', { amountPesewas: R + 2000, method: 'cash' });
  await expectCode(h.db.call('dropship_admin_cancel_order', { p_admin: 'admin1', p_order: done, p_reason: 'try to cancel' }), 'STATE_CONFLICT');
});

test('only service_role can touch order tables and functions', async () => {
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(h.pg.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.query('select * from public.dropship_orders'); }));
    await assert.rejects(h.pg.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.query('select * from public.dropship_delivery_codes'); }));
    await assert.rejects(h.pg.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.query(`select public.dropship_expire_due(1)`); }));
  }
});
