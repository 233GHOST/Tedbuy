import { GHANA_REGIONS } from '../../src/regions.js';
import { DropshipError } from './errors.js';
import { asBody, int, oneOf, rejectUnknown, str, uuid } from './validation.js';

// Request validation for COD orders. As for the rest of Dropship, the database repeats the
// checks that matter (statuses, ownership, money); this layer gives clear errors and keeps
// the client from choosing anything it must not choose (prices, codes, roles, statuses).

type Body = Record<string, unknown>;

const REGION_NAMES = new Set(GHANA_REGIONS.map(r => r.name));
const PAY_METHODS = ['cash', 'momo', 'bank', 'other'] as const;
const PHONE_RE = /^\+?[0-9]{9,15}$/;

function fail(message: string): never {
  throw new DropshipError('VALIDATION', message);
}

function money(body: Body, key: string, required: boolean, max = 1_000_000_000): number | null {
  return required ? int(body, key, 1, max, true) : int(body, key, 0, max, false);
}

function isoDate(body: Body, key: string): string | null {
  const v = body[key];
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) fail(`${key} must be a date (YYYY-MM-DD).`);
  const d = Date.parse(v);
  if (d > Date.now() + 86_400_000 || d < Date.now() - 366 * 86_400_000) fail(`${key} must be within the last year.`);
  return v;
}

function phone(body: Body, key: string): string {
  const raw = str(body, key, 9, 20, true).replace(/[\s-]/g, '');
  if (!PHONE_RE.test(raw)) fail(`${key} must be a phone number.`);
  return raw;
}

// Evidence photos: uploaded to TedBuy's Cloudinary cloud through the normal upload route.
function evidenceUrl(url: unknown, cloudName: string): string {
  if (typeof url !== 'string') fail('evidence must be image links.');
  const u = url.trim();
  if (u.length > 500 || /[?#\s]|\.\./.test(u) || !u.startsWith(`https://res.cloudinary.com/${cloudName}/image/upload/`)) {
    fail('evidence must be photos uploaded to TedBuy.');
  }
  return u;
}

export function parsePlaceOrder(raw: unknown) {
  const b = asBody(raw);
  rejectUnknown(b, ['productId', 'quantity', 'delivery', 'clientRequestId']);
  const productId = str(b, 'productId', 5, 100, true);
  if (!/^dsl_[0-9a-f]{32}$/.test(productId)) fail('productId is not a Dropship product.');
  const d = asBody(b.delivery);
  rejectUnknown(d, ['name', 'phone', 'region', 'area', 'address', 'instructions']);
  const region = str(d, 'region', 2, 60, true);
  if (!REGION_NAMES.has(region)) fail('delivery.region must be a Ghana region.');
  return {
    productId,
    quantity: int(b, 'quantity', 1, 100, true),
    clientRequestId: uuid(b, 'clientRequestId'),
    delivery: {
      name: str(d, 'name', 2, 80, true), phone: phone(d, 'phone'), region,
      area: str(d, 'area', 2, 80, true), address: str(d, 'address', 5, 300, true),
      instructions: str(d, 'instructions', 1, 500, false),
    },
  };
}

export const BUYER_ACTIONS = ['confirm', 'cancel', 'received', 'return', 'dispute'] as const;
export const RESELLER_ACTIONS = ['accept', 'reject', 'cancel', 'request_reservation', 'accept_price', 'decline_price',
  'declare_supplier_payment', 'collected', 'out_for_delivery', 'resend_code', 'verify_code', 'delivered_without_code',
  'delivery_failed', 'close_failed', 'record_payment', 'set_costs', 'return_accept', 'return_reject', 'dispute'] as const;
export const SUPPLIER_ACTIONS = ['confirm_reservation', 'decline_reservation', 'confirm_payment', 'reject_payment',
  'released', 'record_refund', 'dispute'] as const;
export type BuyerAction = typeof BUYER_ACTIONS[number];
export type ResellerAction = typeof RESELLER_ACTIONS[number];
export type SupplierAction = typeof SUPPLIER_ACTIONS[number];

export function actionParam<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new DropshipError('NOT_FOUND', 'Unknown action.');
  return value as T;
}

function caseInput(b: Body, cloudName: string, reasons: readonly string[]) {
  rejectUnknown(b, ['reasonCode', 'description', 'evidence']);
  const ev = b.evidence === undefined ? [] : b.evidence;
  if (!Array.isArray(ev) || ev.length > 5) fail('evidence must be up to 5 photos.');
  return {
    reasonCode: oneOf(b, 'reasonCode', reasons),
    description: str(b, 'description', 5, 2000, true),
    evidence: ev.map(u => evidenceUrl(u, cloudName)),
  };
}

const DISPUTE_REASONS = ['paid_not_released', 'payment_not_received', 'wrong_item', 'defective', 'not_delivered',
  'advance_payment_requested', 'buyer_refused', 'fake_order', 'invalid_contact', 'price_dispute', 'other'] as const;

// Returns the p_input object for the SQL function. Inputs the server makes (the delivery
// code) are added by the route, never taken from the body.
export function parseBuyerAction(action: BuyerAction, raw: unknown, cloudName: string): Record<string, unknown> {
  const b = raw === undefined || raw === null ? {} : asBody(raw);
  switch (action) {
    case 'confirm':
    case 'received':
      rejectUnknown(b, []);
      return {};
    case 'cancel':
      rejectUnknown(b, ['reason']);
      return { reason: str(b, 'reason', 1, 300, false) };
    case 'return':
      return caseInput(b, cloudName, ['wrong_item', 'defective', 'changed_mind', 'other']);
    case 'dispute':
      return caseInput(b, cloudName, DISPUTE_REASONS);
  }
}

function payment(b: Body, cloudName: string, withEvidence: boolean) {
  rejectUnknown(b, withEvidence ? ['amountPesewas', 'method', 'paidOn', 'reference', 'evidenceUrl'] : ['amountPesewas', 'method', 'paidOn', 'reference']);
  return {
    amountPesewas: money(b, 'amountPesewas', true),
    method: oneOf(b, 'method', PAY_METHODS),
    paidOn: isoDate(b, 'paidOn'),
    reference: str(b, 'reference', 1, 100, false),
    ...(withEvidence && b.evidenceUrl ? { evidenceUrl: evidenceUrl(b.evidenceUrl, cloudName) } : {}),
  };
}

export function parseResellerAction(action: ResellerAction, raw: unknown, cloudName: string): Record<string, unknown> {
  const b = raw === undefined || raw === null ? {} : asBody(raw);
  switch (action) {
    case 'accept': case 'decline_price': case 'collected': case 'out_for_delivery': case 'resend_code':
      rejectUnknown(b, []);
      return {};
    case 'reject': case 'cancel':
      rejectUnknown(b, ['reason', 'reasonCode']);
      return { reason: str(b, 'reason', 3, 300, true),
               reasonCode: b.reasonCode === undefined ? null : oneOf(b, 'reasonCode', ['buyer_unreachable', 'invalid_contact', 'stock_unavailable', 'price_declined', 'suspicious', 'other']) };
    case 'request_reservation':
      rejectUnknown(b, ['holdHours']);
      return { holdHours: int(b, 'holdHours', 1, 168, false) };
    case 'accept_price':
      rejectUnknown(b, ['wholesaleUnitPesewas']);
      return { wholesaleUnitPesewas: money(b, 'wholesaleUnitPesewas', true) };
    case 'declare_supplier_payment':
      return payment(b, cloudName, true);
    case 'record_payment':
      return payment(b, cloudName, false);
    case 'verify_code': {
      rejectUnknown(b, ['code']);
      const code = str(b, 'code', 6, 6, true);
      if (!/^[0-9]{6}$/.test(code)) fail('code must be 6 digits.');
      return { code };
    }
    case 'delivered_without_code':
      rejectUnknown(b, ['note']);
      return { note: str(b, 'note', 5, 500, true) };
    case 'delivery_failed':
      rejectUnknown(b, ['reasonCode', 'note']);
      return { reasonCode: oneOf(b, 'reasonCode', ['buyer_unreachable', 'buyer_refused', 'wrong_address', 'other']),
               note: str(b, 'note', 1, 500, false) };
    case 'close_failed':
      rejectUnknown(b, ['reason']);
      return { reason: str(b, 'reason', 3, 300, true) };
    case 'set_costs':
      rejectUnknown(b, ['deliveryCostPesewas', 'otherCostPesewas']);
      return { deliveryCostPesewas: money(b, 'deliveryCostPesewas', false, 100_000_000),
               otherCostPesewas: money(b, 'otherCostPesewas', false, 100_000_000) };
    case 'return_accept':
      rejectUnknown(b, ['refundPesewas', 'method', 'paidOn', 'reference', 'note']);
      return { refundPesewas: money(b, 'refundPesewas', false),
               method: b.method === undefined ? 'other' : oneOf(b, 'method', PAY_METHODS),
               paidOn: isoDate(b, 'paidOn'), reference: str(b, 'reference', 1, 100, false), note: str(b, 'note', 1, 500, false) };
    case 'return_reject':
      rejectUnknown(b, ['note']);
      return { note: str(b, 'note', 5, 500, true) };
    case 'dispute':
      return caseInput(b, cloudName, DISPUTE_REASONS);
  }
}

export function parseSupplierAction(action: SupplierAction, raw: unknown, cloudName: string): Record<string, unknown> {
  const b = raw === undefined || raw === null ? {} : asBody(raw);
  switch (action) {
    case 'confirm_reservation': case 'confirm_payment': case 'released':
      rejectUnknown(b, []);
      return {};
    case 'decline_reservation':
      rejectUnknown(b, ['reasonCode', 'note']);
      return { reasonCode: oneOf(b, 'reasonCode', ['out_of_stock', 'cannot_release', 'other']), note: str(b, 'note', 1, 300, false) };
    case 'reject_payment':
      rejectUnknown(b, ['reason']);
      return { reason: str(b, 'reason', 3, 300, true) };
    case 'record_refund':
      return payment(b, cloudName, false);
    case 'dispute':
      return caseInput(b, cloudName, DISPUTE_REASONS);
  }
}

export function parseOrderListQuery(query: unknown) {
  const q = asBody(query);
  const scope = q.scope === undefined || q.scope === '' ? null : oneOf(q, 'scope', ['open', 'done', 'cases']);
  const status = str(q, 'status', 3, 40, false);
  let afterCreated: string | null = null;
  let afterId: string | null = null;
  if (typeof q.cursor === 'string' && q.cursor !== '') {
    let parsed: any;
    try { parsed = JSON.parse(Buffer.from(q.cursor, 'base64').toString('utf8')); } catch { fail('cursor is invalid.'); }
    if (!parsed || typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) fail('cursor is invalid.');
    afterCreated = parsed.createdAt;
    afterId = uuid({ id: parsed.id }, 'id');
  }
  return { scope, status, afterCreated, afterId };
}

export function parseResolveDispute(raw: unknown) {
  const b = asBody(raw);
  rejectUnknown(b, ['outcome', 'fault', 'faultType', 'resolution']);
  return {
    outcome: oneOf(b, 'outcome', ['resumed', 'cancelled', 'completed', 'returned']),
    fault: oneOf(b, 'fault', ['none', 'buyer', 'dropshipper', 'supplier', 'unclear']),
    faultType: str(b, 'faultType', 3, 60, false),
    resolution: str(b, 'resolution', 5, 2000, true),
  };
}

export function parseSettings(raw: unknown) {
  const b = asBody(raw);
  rejectUnknown(b, ['limitTiers', 'buyerConfirmHours', 'resellerAcceptHours', 'supplierResponseHours', 'reservationHours', 'reason']);
  const out: Record<string, unknown> = {};
  if (b.limitTiers !== undefined) {
    if (!Array.isArray(b.limitTiers) || b.limitTiers.length < 1 || b.limitTiers.length > 10) fail('limitTiers must have 1 to 10 tiers.');
    out.limitTiers = b.limitTiers.map(t => {
      const tb = asBody(t);
      rejectUnknown(tb, ['minCompleted', 'perOrderPesewas', 'openPesewas']);
      return { minCompleted: int(tb, 'minCompleted', 0, 100000, true), perOrderPesewas: int(tb, 'perOrderPesewas', 0, 100_000_000, true),
               openPesewas: int(tb, 'openPesewas', 0, 1_000_000_000, true) };
    });
  }
  for (const k of ['buyerConfirmHours', 'resellerAcceptHours', 'supplierResponseHours', 'reservationHours']) {
    const v = int(b, k, 1, 168, false);
    if (v !== null) out[k] = v;
  }
  return { settings: out, reason: str(b, 'reason', 3, 300, true) };
}

export function parseLimitOverride(raw: unknown) {
  const b = asBody(raw);
  rejectUnknown(b, ['perOrderPesewas', 'openPesewas', 'reason']);
  return {
    perOrderPesewas: int(b, 'perOrderPesewas', 0, 100_000_000, false),
    openPesewas: int(b, 'openPesewas', 0, 1_000_000_000, false),
    reason: str(b, 'reason', 3, 300, true),
  };
}
