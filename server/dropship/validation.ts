import { GHANA_REGIONS } from '../../src/regions.js';
import { DropshipError } from './errors.js';

// Request validation (API_SPEC §0): unknown fields rejected, strings trimmed and bounded,
// money as integer pesewas. The database repeats the critical checks (CHECK constraints
// and function checks), so this layer exists for clear errors, not as the only guard.

type Body = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REGION_NAMES = new Set(GHANA_REGIONS.map(r => r.name));

function fail(message: string): never {
  throw new DropshipError('VALIDATION', message);
}

export function asBody(value: unknown): Body {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Request body must be a JSON object.');
  return value as Body;
}

export function rejectUnknown(body: Body, allowed: readonly string[]): void {
  const unknown = Object.keys(body).filter(k => !allowed.includes(k));
  if (unknown.length) fail(`Unknown field(s): ${unknown.join(', ')}.`);
}

export function str(body: Body, key: string, min: number, max: number, required: true): string;
export function str(body: Body, key: string, min: number, max: number, required: false): string | null;
export function str(body: Body, key: string, min: number, max: number, required: boolean): string | null {
  const v = body[key];
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '' && !required)) {
    if (required) fail(`${key} is required.`);
    return null;
  }
  if (typeof v !== 'string') fail(`${key} must be text.`);
  const t = v.trim();
  if (t.length < min || t.length > max) fail(`${key} must be ${min}–${max} characters.`);
  return t;
}

export function int(body: Body, key: string, min: number, max: number, required: true): number;
export function int(body: Body, key: string, min: number, max: number, required: false): number | null;
export function int(body: Body, key: string, min: number, max: number, required: boolean): number | null {
  const v = body[key];
  if (v === undefined || v === null) {
    if (required) fail(`${key} is required.`);
    return null;
  }
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) fail(`${key} must be a whole number.`);
  if (v < min || v > max) fail(`${key} must be between ${min} and ${max}.`);
  return v;
}

export function bool(body: Body, key: string, fallback: boolean): boolean {
  const v = body[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'boolean') fail(`${key} must be true or false.`);
  return v;
}

export function uuid(body: Body, key: string): string {
  const v = body[key];
  if (typeof v !== 'string' || !UUID_RE.test(v)) fail(`${key} must be a UUID.`);
  return v.toLowerCase();
}

export function uuidParam(value: unknown, name = 'id'): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new DropshipError('NOT_FOUND', `Unknown ${name}.`);
  return value.toLowerCase();
}

export function oneOf<T extends string>(body: Body, key: string, values: readonly T[]): T {
  const v = body[key];
  if (typeof v !== 'string' || !values.includes(v as T)) fail(`${key} must be one of: ${values.join(', ')}.`);
  return v as T;
}

function region(body: Body, key: string, required: boolean): string | null {
  const v = required ? str(body, key, 2, 60, true) : str(body, key, 2, 60, false);
  if (v !== null && !REGION_NAMES.has(v)) fail(`${key} must be a Ghana region.`);
  return v;
}

export function reason(body: Body, required: boolean): string | null {
  return required ? str(body, 'reason', 3, 500, true) : str(body, 'reason', 3, 500, false);
}

// ---------------------------------------------------------------------------------------
// Supplier application (API_SPEC §2). Payout details are not collected in this slice.
// ---------------------------------------------------------------------------------------
const APPLICATION_FIELDS = ['clientRequestId', 'kind', 'displayName', 'contactPhone', 'region', 'city',
  'addressLine', 'businessRegNo', 'answers', 'termsVersion'] as const;

export function parseApplication(raw: unknown) {
  const body = asBody(raw);
  rejectUnknown(body, APPLICATION_FIELDS);
  const kind = oneOf(body, 'kind', ['supplier'] as const);
  const phoneRaw = str(body, 'contactPhone', 9, 20, true).replace(/[\s-]/g, '');
  if (!/^\+?[0-9]{9,15}$/.test(phoneRaw)) fail('contactPhone must be a phone number.');
  const answers = body.answers;
  if (answers !== undefined) {
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) fail('answers must be an object.');
    const entries = Object.entries(answers as Body);
    if (entries.length > 20) fail('answers has too many entries.');
    for (const [, v] of entries) {
      if (typeof v !== 'string' || v.length > 500) fail('answers values must be text of at most 500 characters.');
    }
  }
  return {
    clientRequestId: uuid(body, 'clientRequestId'),
    kind,
    fields: {
      displayName: str(body, 'displayName', 2, 80, true),
      contactPhone: phoneRaw,
      region: region(body, 'region', true),
      city: str(body, 'city', 2, 60, true),
      addressLine: str(body, 'addressLine', 5, 200, true),
      businessRegNo: str(body, 'businessRegNo', 1, 60, false),
      termsVersion: str(body, 'termsVersion', 1, 40, true),
      answers: (answers as Body | undefined) ?? {},
    },
  };
}

// ---------------------------------------------------------------------------------------
// Supplier products (API_SPEC §4)
// ---------------------------------------------------------------------------------------
const MAX_PRICE = 100_000_000;     // GH₵1,000,000 in pesewas
const MAX_FEE = 10_000_000;
const MAX_STOCK = 1_000_000;

const PRODUCT_CONTENT_FIELDS = ['title', 'description', 'category', 'condition', 'brand', 'images',
  'wholesalePricePesewas', 'suggestedRetailPesewas', 'maxPerOrder', 'shipsFromRegion', 'shipsFromCity',
  'deliveryFeeSameRegionPesewas', 'deliveryFeeOtherRegionPesewas', 'leadTimeMinDays', 'leadTimeMaxDays',
  'returnWindowDays', 'returnConditions'] as const;

// Image URLs must be on TedBuy's Cloudinary cloud and in tedbuy_products/ (C-21), because
// the legacy upload route accepts a client-chosen folder.
export function isTedbuyProductImageUrl(url: string, cloudName: string): boolean {
  if (url.length > 500 || /[?#\s]|\.\./.test(url)) return false;
  const prefix = `https://res.cloudinary.com/${cloudName}/image/upload/`;
  if (!url.startsWith(prefix)) return false;
  return /^(?:[A-Za-z0-9_,.:-]+\/)*tedbuy_products\/[A-Za-z0-9_\-./]+$/.test(url.slice(prefix.length));
}

function images(body: Body, cloudName: string): string[] {
  const v = body.images;
  if (!Array.isArray(v) || v.length < 1 || v.length > 10) fail('images must contain 1 to 10 URLs.');
  const urls = v.map(u => {
    if (typeof u !== 'string' || !isTedbuyProductImageUrl(u.trim(), cloudName)) {
      fail('Each image must be an image uploaded to TedBuy (Cloudinary tedbuy_products folder).');
    }
    return u.trim();
  });
  if (new Set(urls).size !== urls.length) fail('images must not repeat.');
  return urls;
}

function productFields(body: Body, cloudName: string, partial: boolean): Record<string, unknown> {
  const req = !partial;
  const out: Record<string, unknown> = {};
  const has = (k: string) => body[k] !== undefined;
  const put = (k: string, v: unknown) => { if (req || has(k)) out[k] = v; };

  put('title', req || has('title') ? str(body, 'title', 3, 128, true) : undefined);
  put('description', req || has('description') ? str(body, 'description', 10, 5000, true) : undefined);
  put('category', req || has('category') ? str(body, 'category', 2, 60, true) : undefined);
  if (has('condition')) out.condition = str(body, 'condition', 2, 40, true);
  if (has('brand')) out.brand = str(body, 'brand', 1, 60, false);
  put('images', req || has('images') ? images(body, cloudName) : undefined);
  put('wholesalePricePesewas', req || has('wholesalePricePesewas') ? int(body, 'wholesalePricePesewas', 1, MAX_PRICE, true) : undefined);
  if (has('suggestedRetailPesewas')) out.suggestedRetailPesewas = int(body, 'suggestedRetailPesewas', 1, MAX_PRICE, false);
  if (has('maxPerOrder')) out.maxPerOrder = int(body, 'maxPerOrder', 1, 100, true);
  put('shipsFromRegion', req || has('shipsFromRegion') ? region(body, 'shipsFromRegion', true) : undefined);
  put('shipsFromCity', req || has('shipsFromCity') ? str(body, 'shipsFromCity', 2, 60, true) : undefined);
  put('deliveryFeeSameRegionPesewas', req || has('deliveryFeeSameRegionPesewas') ? int(body, 'deliveryFeeSameRegionPesewas', 0, MAX_FEE, true) : undefined);
  if (has('deliveryFeeOtherRegionPesewas')) out.deliveryFeeOtherRegionPesewas = int(body, 'deliveryFeeOtherRegionPesewas', 0, MAX_FEE, false);
  put('leadTimeMinDays', req || has('leadTimeMinDays') ? int(body, 'leadTimeMinDays', 0, 30, true) : undefined);
  put('leadTimeMaxDays', req || has('leadTimeMaxDays') ? int(body, 'leadTimeMaxDays', 1, 30, true) : undefined);
  if (has('returnWindowDays')) out.returnWindowDays = int(body, 'returnWindowDays', 0, 30, true);
  if (has('returnConditions')) out.returnConditions = str(body, 'returnConditions', 1, 1000, false);

  // Cross-field rules when both values are in the request; otherwise the table CHECKs
  // compare against the stored value.
  const w = out.wholesalePricePesewas as number | undefined;
  const r = out.suggestedRetailPesewas as number | null | undefined;
  if (typeof w === 'number' && typeof r === 'number' && r < w) fail('suggestedRetailPesewas must not be below the wholesale price.');
  const lmin = out.leadTimeMinDays as number | undefined;
  const lmax = out.leadTimeMaxDays as number | undefined;
  if (typeof lmin === 'number' && typeof lmax === 'number' && lmin > lmax) fail('leadTimeMinDays must not exceed leadTimeMaxDays.');
  return out;
}

export function parseProductCreate(raw: unknown, cloudName: string, asAdmin: boolean) {
  const body = asBody(raw);
  rejectUnknown(body, [...PRODUCT_CONTENT_FIELDS, 'clientRequestId', 'stockOnHand', 'submit',
    ...(asAdmin ? ['supplierId', 'reason'] : [])]);
  const fields = productFields(body, cloudName, false);
  fields.stockOnHand = int(body, 'stockOnHand', 0, MAX_STOCK, true);
  return {
    clientRequestId: uuid(body, 'clientRequestId'),
    submit: bool(body, 'submit', false),
    supplierId: asAdmin ? str(body, 'supplierId', 1, 128, true) : null,
    reason: asAdmin ? reason(body, true) : null,
    fields,
  };
}

export function parseProductUpdate(raw: unknown, cloudName: string, asAdmin: boolean) {
  const body = asBody(raw);
  rejectUnknown(body, [...PRODUCT_CONTENT_FIELDS, 'expectedContentVersion', ...(asAdmin ? ['reason'] : [])]);
  const fields = productFields(body, cloudName, true);
  if (Object.keys(fields).length === 0) fail('No product fields to change.');
  return {
    expectedContentVersion: int(body, 'expectedContentVersion', 1, 2_000_000_000, true),
    reason: asAdmin ? reason(body, true) : null,
    fields,
  };
}

export function parseStock(raw: unknown, asAdmin: boolean) {
  const body = asBody(raw);
  rejectUnknown(body, ['stockOnHand', 'expectedOnHand', ...(asAdmin ? ['reason'] : [])]);
  return {
    stockOnHand: int(body, 'stockOnHand', 0, MAX_STOCK, true),
    // Admin corrections must say what they are correcting (API_SPEC §5).
    expectedOnHand: asAdmin ? int(body, 'expectedOnHand', 0, MAX_STOCK, true) : int(body, 'expectedOnHand', 0, MAX_STOCK, false),
    reason: asAdmin ? reason(body, true) : null,
  };
}

export function parseSupplierStatus(raw: unknown) {
  const body = asBody(raw);
  rejectUnknown(body, ['status']);
  return { status: oneOf(body, 'status', ['pending_review', 'paused', 'active', 'archived'] as const) };
}

export function parseAdminStatus(raw: unknown) {
  const body = asBody(raw);
  rejectUnknown(body, ['status', 'reason']);
  return { status: oneOf(body, 'status', ['paused', 'archived'] as const), reason: reason(body, true) as string };
}

export function parseModeration(raw: unknown) {
  const body = asBody(raw);
  rejectUnknown(body, ['decision', 'reason']);
  const decision = oneOf(body, 'decision', ['approve', 'reject', 'pause'] as const);
  return { decision, reason: reason(body, decision !== 'approve') };
}

export function parseParticipationDecision(raw: unknown) {
  const body = asBody(raw);
  rejectUnknown(body, ['decision', 'expectedStatus', 'reason', 'adminNotes']);
  const decision = oneOf(body, 'decision', ['approve', 'reject', 'suspend', 'reinstate', 'revoke'] as const);
  return {
    decision,
    expectedStatus: oneOf(body, 'expectedStatus', ['pending', 'approved', 'rejected', 'suspended', 'revoked'] as const),
    reason: reason(body, decision !== 'approve'),
    adminNotes: str(body, 'adminNotes', 1, 1000, false),
  };
}

export function queryEnum<T extends string>(value: unknown, values: readonly T[], name: string): T | null {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !values.includes(value as T)) fail(`${name} must be one of: ${values.join(', ')}.`);
  return value as T;
}

export const PARTICIPANT_STATUSES = ['pending', 'approved', 'rejected', 'suspended', 'revoked'] as const;
export const PRODUCT_STATUSES = ['draft', 'pending_review', 'active', 'paused', 'rejected', 'archived'] as const;
