import crypto from 'node:crypto';
import type express from 'express';
import { DropshipError } from './errors.js';
import type { DropshipDb } from './db.js';
import type { DropshipVerifiedUser } from './routes.js';
import {
  BUYER_ACTIONS, RESELLER_ACTIONS, SUPPLIER_ACTIONS, actionParam, parseBuyerAction, parseLimitOverride, parseOrderListQuery,
  parsePlaceOrder, parseResellerAction, parseResolveDispute, parseSettings, parseSupplierAction,
} from './orderValidation.js';
import { int, asBody, rejectUnknown, uuidParam } from './validation.js';

// COD orders (Phase 4). TedBuy records each step; it never collects, holds or moves money.
// Every move is one dropship_* SQL function that checks the order's status, the caller's
// role and ownership under a row lock. This layer authenticates, validates input, makes the
// delivery code (crypto.randomInt; never logged, never returned to the reseller), and sends
// notifications after a move commits.

export interface OrderNotice { userId: string; title: string; message: string; orderId: string }
export interface OrderMail { to: string; subject: string; text: string }

export interface OrderDeps {
  ordersEnabled: boolean;
  cloudinaryCloudName: string;
  // Firebase Admin's emailVerified for the uid; null when the lookup failed.
  isEmailVerified?: (uid: string) => Promise<boolean | null>;
  notify?: (notices: OrderNotice[]) => Promise<void>;
  sendMail?: (mail: OrderMail) => Promise<void>;
  makeCode?: () => string;
}

export interface OrderRouteHelpers {
  limit: (max: number, prefix: string) => express.RequestHandler;
  handle: (fn: (req: express.Request, res: express.Response, db: DropshipDb) => Promise<void>) => express.RequestHandler;
  requireActor: (req: express.Request, write: boolean) => Promise<DropshipVerifiedUser>;
  requireAdmin: (req: express.Request) => Promise<DropshipVerifiedUser>;
}

const SITE = 'https://www.tedbuy.store';
const defaultCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

export function encodeOrderCursor(next: { afterCreated: string; afterId: string } | null): string | null {
  return next ? Buffer.from(JSON.stringify({ createdAt: next.afterCreated, id: next.afterId })).toString('base64') : null;
}

// What each party is told after a move, in plain words. Keyed by the order's new status.
const NOTICE: Record<string, Partial<Record<'buyer' | 'dropshipper' | 'supplier', string>>> = {
  placed: { buyer: 'Please confirm your order so the seller can start on it.', dropshipper: 'New order. The buyer has been asked to confirm it.' },
  buyer_confirmed: { dropshipper: 'The buyer confirmed the order. Call them, then accept or reject it.' },
  accepted: { buyer: 'The seller accepted your order and is getting the item ready.' },
  reservation_requested: { supplier: 'A reseller asked you to hold stock for an order.' },
  price_review: { dropshipper: 'The supplier\'s price has changed. Review the new price to continue.' },
  reserved: { dropshipper: 'The supplier is holding the item. Pay the supplier, then mark the payment.', supplier: 'The reseller accepted the price.' },
  supplier_payment_declared: { supplier: 'The reseller says they paid you. Confirm once the money has reached you.' },
  supplier_paid: { dropshipper: 'The supplier confirmed your payment and will release the item.' },
  released: { dropshipper: 'The supplier released the item. Collect it and confirm collection.' },
  collected: { buyer: 'The seller has your item and will deliver it soon.', supplier: 'The reseller collected the item.' },
  out_for_delivery: { buyer: 'Your order is on its way. Pay the seller only when you receive it.' },
  delivered: { buyer: 'Delivery recorded. Pay the seller only if you have received your item.', dropshipper: 'Delivery recorded. Record the buyer\'s payment to finish the order.' },
  completed: { buyer: 'Your order is complete. Thank you for shopping on TedBuy.' },
  delivery_failed: { buyer: 'The seller could not deliver your order. They will contact you.' },
  disputed: { buyer: 'A problem was reported on your order. TedBuy will review it.', dropshipper: 'A problem was reported on this order. TedBuy will review it.', supplier: 'A problem was reported on an order. TedBuy will review it.' },
  return_requested: { dropshipper: 'The buyer asked to return an item. Accept or refuse the return.' },
  returned: { buyer: 'Your return was accepted.', supplier: 'An order was returned by the buyer.' },
  cancelled: { buyer: 'Your order was cancelled.', dropshipper: 'An order was cancelled.', supplier: 'An order was cancelled.' },
};

function noticesFor(result: any, actorUid: string): OrderNotice[] {
  const out: OrderNotice[] = [];
  for (const n of (result?.notify ?? []) as Array<{ userId: string; audience: 'buyer' | 'dropshipper' | 'supplier' }>) {
    if (!n.userId || n.userId === actorUid) continue;
    const message = NOTICE[result.status]?.[n.audience];
    if (!message) continue;
    out.push({ userId: n.userId, orderId: result.orderId, title: `Order ${result.orderNumber}`, message });
  }
  return out;
}

export function addOrderRoutes(router: express.Router, deps: OrderDeps, h: OrderRouteHelpers): void {
  const makeCode = deps.makeCode ?? defaultCode;

  const requireOrders = () => {
    if (!deps.ordersEnabled) throw new DropshipError('DROPSHIP_UNAVAILABLE', 'Ordering is not open yet.');
  };

  // Notifications and email never change the outcome of a committed move.
  const afterMove = async (result: any, actorUid: string, mail?: OrderMail | null) => {
    try {
      const notices = noticesFor(result, actorUid);
      if (notices.length && deps.notify) await deps.notify(notices);
    } catch (err) {
      console.error('[Dropship orders] notification failed', (err as Error)?.message);
    }
    if (mail && deps.sendMail) {
      try { await deps.sendMail(mail); } catch (err) { console.error('[Dropship orders] email failed', (err as Error)?.message); }
    }
  };

  // The delivery code email. The code is read back from the buyer's own projection so the
  // email always matches the order page.
  const codeMail = async (db: DropshipDb, result: any): Promise<OrderMail | null> => {
    if (!result?.codeIssued || !result.buyerEmail) return null;
    const buyerId = result.notify?.find((n: any) => n.audience === 'buyer')?.userId;
    if (!buyerId) return null;
    const view = await db.call('dropship_get_order', { p_actor: buyerId, p_role: 'buyer', p_order: result.order.id });
    const code = view?.order?.deliveryCode;
    if (!code) return null;
    return {
      to: result.buyerEmail,
      subject: `Your TedBuy delivery code for order ${result.orderNumber}`,
      text: `Your order ${result.orderNumber} (${result.title}) is on its way.\n\n`
        + `Your delivery code is ${code}. Give it to the seller only when you have the item in your hands.\n\n`
        + `The code shows that you received the item. It is not a payment. Pay the seller only when you receive your order.\n\n`
        + `See your order: ${SITE}/#/orders\n\nTedBuy`,
    };
  };

  const send = (res: express.Response, result: any, status = 200) => {
    const extra: Record<string, unknown> = {};
    for (const k of ['codeOk', 'codeProblem', 'attemptsLeft']) if (k in result) extra[k] = result[k];
    res.status(status).json({ success: true, order: result.order, changed: result.changed, ...extra });
  };

  // ---- buyer -------------------------------------------------------------------------
  router.post('/api/dropship/orders', h.limit(10, 'dropship-order-place'), h.handle(async (req, res, db) => {
    requireOrders();
    const user = await h.requireActor(req, true);
    const input = parsePlaceOrder(req.body);
    // Decision 1: signed-in buyers with a verified email only. Fails closed.
    const verified = deps.isEmailVerified ? await deps.isEmailVerified(user.uid) : user.emailVerified === true;
    if (verified === null) throw new DropshipError('SERVER', 'Could not check your account; please try again.', true);
    if (!verified) throw new DropshipError('FORBIDDEN', 'Verify your email address before ordering.');
    const result = await db.call('dropship_place_order', {
      p_buyer: user.uid, p_buyer_email: user.email || null, p_product_id: input.productId, p_quantity: input.quantity,
      p_delivery: input.delivery, p_client_request_id: input.clientRequestId,
    });
    await afterMove(result, '', result.changed && result.buyerEmail ? {
      to: result.buyerEmail,
      subject: `Please confirm your TedBuy order ${result.orderNumber}`,
      text: `You ordered ${result.title}. Total to pay on delivery: GH₵${(result.order.totalPesewas / 100).toFixed(2)}.\n\n`
        + `Pay only when you receive your order. Do not send money in advance.\n\n`
        + `Please confirm the order so the seller can start: ${SITE}/#/orders\n\n`
        + `If you did not place this order, ignore this email and it will be cancelled automatically.\n\nTedBuy`,
    } : null);
    send(res, result, result.changed ? 201 : 200);
  }));

  router.get('/api/dropship/orders/mine', h.limit(120, 'dropship-order-read'), h.handle(async (req, res, db) => {
    requireOrders();
    const user = await h.requireActor(req, false);
    const q = parseOrderListQuery(req.query);
    const out = await db.call('dropship_list_orders', { p_actor: user.uid, p_role: 'buyer', p_scope: q.scope, p_status: q.status,
      p_after_created: q.afterCreated, p_after_id: q.afterId, p_limit: 30 });
    res.json({ success: true, orders: out.orders, nextCursor: encodeOrderCursor(out.nextCursor) });
  }));

  router.get('/api/dropship/orders/:orderId', h.limit(240, 'dropship-order-read'), h.handle(async (req, res, db) => {
    requireOrders();
    const user = await h.requireActor(req, false);
    res.setHeader('Cache-Control', 'no-store');
    const out = await db.call('dropship_get_order', { p_actor: user.uid, p_role: 'buyer', p_order: uuidParam(req.params.orderId, 'order') });
    res.json({ success: true, order: out.order });
  }));

  router.post('/api/dropship/orders/:orderId/:action', h.limit(30, 'dropship-order-buyer'), h.handle(async (req, res, db) => {
    requireOrders();
    const user = await h.requireActor(req, true);
    const id = uuidParam(req.params.orderId, 'order');
    const action = actionParam(req.params.action, BUYER_ACTIONS);
    const input = parseBuyerAction(action, req.body, deps.cloudinaryCloudName);
    const result = await db.call('dropship_buyer_order_action', { p_buyer: user.uid, p_order: id, p_action: action, p_input: input });
    await afterMove(result, user.uid);
    send(res, result);
  }));

  // ---- reseller ----------------------------------------------------------------------
  router.get('/api/dropship/reseller/summary', h.limit(120, 'dropship-order-read'), h.handle(async (req, res, db) => {
    requireOrders();
    const user = await h.requireActor(req, false);
    res.json({ success: true, summary: await db.call('dropship_reseller_summary', { p_actor: user.uid }) });
  }));

  const listFor = (role: 'dropshipper' | 'supplier', path: string) =>
    router.get(path, h.limit(120, 'dropship-order-read'), h.handle(async (req, res, db) => {
      requireOrders();
      const user = await h.requireActor(req, false);
      const q = parseOrderListQuery(req.query);
      const out = await db.call('dropship_list_orders', { p_actor: user.uid, p_role: role, p_scope: q.scope, p_status: q.status,
        p_after_created: q.afterCreated, p_after_id: q.afterId, p_limit: 30 });
      res.json({ success: true, orders: out.orders, nextCursor: encodeOrderCursor(out.nextCursor) });
    }));
  const getFor = (role: 'dropshipper' | 'supplier', path: string) =>
    router.get(path, h.limit(240, 'dropship-order-read'), h.handle(async (req, res, db) => {
      requireOrders();
      const user = await h.requireActor(req, false);
      res.setHeader('Cache-Control', 'no-store');
      const out = await db.call('dropship_get_order', { p_actor: user.uid, p_role: role, p_order: uuidParam(req.params.orderId, 'order') });
      res.json({ success: true, order: out.order });
    }));

  listFor('dropshipper', '/api/dropship/reseller/orders');
  getFor('dropshipper', '/api/dropship/reseller/orders/:orderId');

  router.post('/api/dropship/reseller/orders/:orderId/:action', h.limit(60, 'dropship-order-reseller'), h.handle(async (req, res, db) => {
    requireOrders();
    const user = await h.requireActor(req, true);
    const id = uuidParam(req.params.orderId, 'order');
    const action = actionParam(req.params.action, RESELLER_ACTIONS);
    const input = parseResellerAction(action, req.body, deps.cloudinaryCloudName);
    if (action === 'out_for_delivery' || action === 'resend_code') input.code = makeCode();
    const result = await db.call('dropship_reseller_order_action', { p_actor: user.uid, p_order: id, p_action: action, p_input: input });
    await afterMove(result, user.uid, await codeMail(db, result));
    send(res, result);
  }));

  router.patch('/api/dropship/listings/:listingId/delivery-fee', h.limit(60, 'dropship-listing-write'), h.handle(async (req, res, db) => {
    const user = await h.requireActor(req, true);
    const id = uuidParam(req.params.listingId, 'listing');
    const b = asBody(req.body);
    rejectUnknown(b, ['deliveryFeePesewas']);
    const fee = int(b, 'deliveryFeePesewas', 0, 10_000_000, true);
    const out = await db.call('dropship_set_listing_delivery_fee', { p_actor: user.uid, p_listing_id: id, p_fee: fee });
    res.json({ success: true, listing: { id: out.listing.id, deliveryFeePesewas: out.listing.deliveryFeePesewas } });
  }));

  // ---- supplier ----------------------------------------------------------------------
  router.get('/api/dropship/supplier/order-summary', h.limit(120, 'dropship-order-read'), h.handle(async (req, res, db) => {
    requireOrders();
    const user = await h.requireActor(req, false);
    res.json({ success: true, summary: await db.call('dropship_supplier_summary', { p_actor: user.uid }) });
  }));
  listFor('supplier', '/api/dropship/supplier/orders');
  getFor('supplier', '/api/dropship/supplier/orders/:orderId');

  router.post('/api/dropship/supplier/orders/:orderId/:action', h.limit(60, 'dropship-order-supplier'), h.handle(async (req, res, db) => {
    requireOrders();
    const user = await h.requireActor(req, true);
    const id = uuidParam(req.params.orderId, 'order');
    const action = actionParam(req.params.action, SUPPLIER_ACTIONS);
    const input = parseSupplierAction(action, req.body, deps.cloudinaryCloudName);
    const result = await db.call('dropship_supplier_order_action', { p_actor: user.uid, p_order: id, p_action: action, p_input: input });
    await afterMove(result, user.uid);
    send(res, result);
  }));

  // ---- admin -------------------------------------------------------------------------
  router.get('/api/admin/dropship/orders', h.limit(60, 'dropship-admin-read'), h.handle(async (req, res, db) => {
    const user = await h.requireAdmin(req);
    const q = parseOrderListQuery(req.query);
    const out = await db.call('dropship_list_orders', { p_actor: user.uid, p_role: 'admin', p_scope: q.scope, p_status: q.status,
      p_after_created: q.afterCreated, p_after_id: q.afterId, p_limit: 50 });
    res.json({ success: true, orders: out.orders, nextCursor: encodeOrderCursor(out.nextCursor) });
  }));

  router.get('/api/admin/dropship/orders/:orderId', h.limit(120, 'dropship-admin-read'), h.handle(async (req, res, db) => {
    const user = await h.requireAdmin(req);
    res.setHeader('Cache-Control', 'no-store');
    const out = await db.call('dropship_get_order', { p_actor: user.uid, p_role: 'admin', p_order: uuidParam(req.params.orderId, 'order') });
    res.json({ success: true, order: out.order });
  }));

  router.post('/api/admin/dropship/orders/:orderId/resolve', h.limit(30, 'dropship-admin-write'), h.handle(async (req, res, db) => {
    const user = await h.requireAdmin(req);
    const input = parseResolveDispute(req.body);
    const result = await db.call('dropship_admin_resolve_dispute', { p_admin: user.uid, p_order: uuidParam(req.params.orderId, 'order'),
      p_outcome: input.outcome, p_fault: input.fault, p_fault_type: input.faultType, p_resolution: input.resolution });
    await afterMove(result, user.uid);
    send(res, result);
  }));

  router.post('/api/admin/dropship/orders/:orderId/cancel', h.limit(30, 'dropship-admin-write'), h.handle(async (req, res, db) => {
    const user = await h.requireAdmin(req);
    const b = asBody(req.body);
    rejectUnknown(b, ['reason']);
    const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (reason.length < 5 || reason.length > 500) throw new DropshipError('VALIDATION', 'reason must be 5–500 characters.');
    const result = await db.call('dropship_admin_cancel_order', { p_admin: user.uid, p_order: uuidParam(req.params.orderId, 'order'), p_reason: reason });
    await afterMove(result, user.uid);
    send(res, result);
  }));

  router.get('/api/admin/dropship/order-settings', h.limit(60, 'dropship-admin-read'), h.handle(async (req, res, db) => {
    await h.requireAdmin(req);
    res.json({ success: true, settings: await db.call('dropship_get_settings', {}) });
  }));

  router.put('/api/admin/dropship/order-settings', h.limit(20, 'dropship-admin-write'), h.handle(async (req, res, db) => {
    const user = await h.requireAdmin(req);
    const input = parseSettings(req.body);
    res.json({ success: true, settings: await db.call('dropship_admin_update_settings', { p_admin: user.uid, p_settings: input.settings, p_reason: input.reason }) });
  }));

  router.put('/api/admin/dropship/resellers/:userId/limits', h.limit(30, 'dropship-admin-write'), h.handle(async (req, res, db) => {
    const user = await h.requireAdmin(req);
    const target = String(req.params.userId || '');
    if (!target || target.length > 128) throw new DropshipError('NOT_FOUND', 'Reseller not found.');
    const input = parseLimitOverride(req.body);
    if ((input.perOrderPesewas === null) !== (input.openPesewas === null)) {
      throw new DropshipError('VALIDATION', 'Send both limits to set an override, or neither to remove it.');
    }
    const limits = await db.call('dropship_admin_set_limit_override', { p_admin: user.uid, p_user: target,
      p_per_order: input.perOrderPesewas, p_open: input.openPesewas, p_reason: input.reason });
    res.json({ success: true, limits });
  }));

  router.get('/api/admin/dropship/reliability/:userId', h.limit(60, 'dropship-admin-read'), h.handle(async (req, res, db) => {
    await h.requireAdmin(req);
    const target = String(req.params.userId || '');
    if (!target || target.length > 128) throw new DropshipError('NOT_FOUND', 'User not found.');
    res.json({ success: true, reliability: await db.call('dropship_admin_reliability', { p_user: target }) });
  }));
}

// Time limits: cancels overdue orders (no blame) and tells the people involved. Called on a
// timer by registerDropship; safe to run from several server instances (rows are locked
// with SKIP LOCKED).
export async function runOrderExpiry(db: DropshipDb, notify?: OrderDeps['notify'], onStockChanged?: () => void): Promise<number> {
  const results = await db.call<any[]>('dropship_expire_due', { p_limit: 200 });
  if (results?.length) onStockChanged?.();
  if (notify && results?.length) {
    const notices: OrderNotice[] = [];
    for (const r of results) {
      for (const n of (r.notify ?? []) as Array<{ userId: string; audience: string }>) {
        notices.push({ userId: n.userId, orderId: r.orderId, title: `Order ${r.orderNumber}`,
          message: 'This order was cancelled because a step was not completed in time. Nobody was charged.' });
      }
    }
    try { await notify(notices); } catch (err) { console.error('[Dropship orders] expiry notification failed', (err as Error)?.message); }
  }
  return results?.length ?? 0;
}
