// Pure helpers for the Dropship screens (no React, no Firebase), so they can be unit
// tested. The server validates everything again; these exist for clear, early messages.

export type ParticipantStatus = 'pending' | 'approved' | 'rejected' | 'suspended' | 'revoked';
export type ProductStatus = 'draft' | 'pending_review' | 'active' | 'paused' | 'rejected' | 'archived';

export interface SupplierProduct {
  id: string;
  supplierId: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  brand: string | null;
  images: string[];
  wholesalePricePesewas: number;
  suggestedRetailPesewas: number | null;
  stockOnHand: number;
  stockReserved: number;
  stockAvailable: number;
  maxPerOrder: number;
  shipsFromRegion: string;
  shipsFromCity: string;
  deliveryFeeSameRegionPesewas: number;
  deliveryFeeOtherRegionPesewas: number | null;
  leadTimeMinDays: number;
  leadTimeMaxDays: number;
  returnWindowDays: number;
  returnConditions: string | null;
  status: ProductStatus;
  moderationReason: string | null;
  publishedAt: string | null;
  contentVersion: number;
  priceVersion: number;
  createdAt: string;
  updatedAt: string;
}

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  draft: 'Draft',
  pending_review: 'In review',
  active: 'Active',
  paused: 'Paused',
  rejected: 'Rejected',
  archived: 'Archived',
};

export const PARTICIPANT_STATUS_LABEL: Record<ParticipantStatus, string> = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
  revoked: 'Revoked',
};

// "250", "250.5", "1,250.00" -> pesewas as an exact integer (no floating-point maths).
export function cedisToPesewas(input: string): number | null {
  const s = input.trim().replace(/,/g, '');
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

// Typed cedis input -> integer pesewas, or null when it is not a valid amount.
export const parseCedisToPesewas = cedisToPesewas;

// Same rule as server/dropship/legacyGuards.ts: listing mirror rows have ids starting "dsl_".
export function isDropshipRowId(id: unknown): boolean {
  return typeof id === 'string' && id.toLowerCase().startsWith('dsl_');
}

export type ListingStatus = 'active' | 'paused' | 'removed';

// The dropshipper's precise status for one of their listings (customers only see coarse reasons).
export function listingStatusLabel(l: { status: string; effectiveAvailable?: boolean; unavailableReason?: string | null }): { key: string; label: string } {
  if (l.status === 'paused' || l.unavailableReason === 'listing_paused') return { key: 'paused', label: 'Paused' };
  if (l.effectiveAvailable === false || l.unavailableReason) {
    switch (l.unavailableReason) {
      case 'out_of_stock': return { key: 'out_of_stock', label: 'Out of stock' };
      case 'price_below_minimum': return { key: 'reprice', label: 'Reprice needed' };
      default: return { key: 'unavailable', label: 'Supplier unavailable' };
    }
  }
  return { key: 'active', label: 'Active' };
}

// StatusPill tone for a listingStatusLabel key: only Active is green, Paused is neutral and
// every "needs attention" state is a warning (never the red rejected style).
export function listingPillTone(key: string): 'active' | 'paused' | 'pending' {
  return key === 'active' ? 'active' : key === 'paused' ? 'paused' : 'pending';
}

export function pesewasToCedisInput(pesewas: number | null | undefined): string {
  if (pesewas === null || pesewas === undefined) return '';
  return `${Math.floor(pesewas / 100)}.${String(pesewas % 100).padStart(2, '0')}`;
}

export function formatPesewas(pesewas: number): string {
  return `GH₵${(pesewas / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Error codes from the Dropship API (API_SPEC §0) mapped to user-facing guidance.
export function dropshipErrorMessage(code: string | undefined, serverMessage: string | undefined): string {
  switch (code) {
    case 'UNAUTHENTICATED': return 'Please sign in again to continue.';
    case 'ACCOUNT_RESTRICTED': return 'Your account is restricted, so Dropship actions are unavailable.';
    case 'NOT_APPROVED': return 'You need an approved supplier account for this.';
    case 'FULFILMENT_ONLY': return 'Your supplier account is suspended. Product and stock changes are paused.';
    case 'IMPERSONATION_FORBIDDEN': return 'This action is not available while viewing as another user.';
    case 'DROPSHIP_UNAVAILABLE': return "TedBuy Dropship isn't available right now. Please try again later.";
    case 'RATE_LIMIT': return 'Too many requests. Please wait a moment and try again.';
    case 'STATE_CONFLICT': return serverMessage ? `${serverMessage}.` : 'This was changed elsewhere. Reload and try again.';
    case 'SERVER': return 'Something went wrong on our side. Please try again.';
    default: return serverMessage || 'Request failed.';
  }
}

export interface ProductFormState {
  title: string;
  description: string;
  category: string;
  condition: string;
  brand: string;
  images: string[];
  wholesale: string;
  suggestedRetail: string;
  stockOnHand: string;
  maxPerOrder: string;
  shipsFromRegion: string;
  shipsFromCity: string;
  deliverySame: string;
  deliveryOther: string;
  leadMin: string;
  leadMax: string;
  returnWindowDays: string;
  returnConditions: string;
}

export function emptyProductForm(): ProductFormState {
  return {
    title: '', description: '', category: '', condition: 'Brand New', brand: '', images: [],
    wholesale: '', suggestedRetail: '', stockOnHand: '', maxPerOrder: '5', shipsFromRegion: '', shipsFromCity: '',
    deliverySame: '', deliveryOther: '', leadMin: '1', leadMax: '3', returnWindowDays: '3', returnConditions: '',
  };
}

export function productToForm(p: SupplierProduct): ProductFormState {
  return {
    title: p.title, description: p.description, category: p.category, condition: p.condition, brand: p.brand ?? '',
    images: [...p.images], wholesale: pesewasToCedisInput(p.wholesalePricePesewas),
    suggestedRetail: pesewasToCedisInput(p.suggestedRetailPesewas), stockOnHand: String(p.stockOnHand),
    maxPerOrder: String(p.maxPerOrder), shipsFromRegion: p.shipsFromRegion, shipsFromCity: p.shipsFromCity,
    deliverySame: pesewasToCedisInput(p.deliveryFeeSameRegionPesewas), deliveryOther: pesewasToCedisInput(p.deliveryFeeOtherRegionPesewas),
    leadMin: String(p.leadTimeMinDays), leadMax: String(p.leadTimeMaxDays), returnWindowDays: String(p.returnWindowDays),
    returnConditions: p.returnConditions ?? '',
  };
}

function wholeNumber(value: string, label: string, min: number, max: number): number {
  const s = value.trim();
  if (!/^\d+$/.test(s)) throw new Error(`${label} must be a whole number.`);
  const n = Number(s);
  if (n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return n;
}

function money(value: string, label: string, required: boolean): number | null {
  if (!value.trim()) {
    if (required) throw new Error(`${label} is required.`);
    return null;
  }
  const p = cedisToPesewas(value);
  if (p === null) throw new Error(`${label} must be an amount in cedis, e.g. 250 or 250.50.`);
  return p;
}

// Converts the form to the API body. For edits, only changed fields are sent; the server
// checks the content version, so stale edits are refused rather than overwriting.
export function buildProductPayload(form: ProductFormState, original?: SupplierProduct): Record<string, unknown> {
  const text = (v: string) => v.trim();
  if (text(form.title).length < 3) throw new Error('Title must be at least 3 characters.');
  if (text(form.description).length < 10) throw new Error('Description must be at least 10 characters.');
  if (text(form.category).length < 2) throw new Error('Choose a category.');
  if (form.images.length < 1) throw new Error('Add at least one product photo.');
  if (!form.shipsFromRegion) throw new Error('Choose the region you ship from.');
  if (text(form.shipsFromCity).length < 2) throw new Error('Enter the city you ship from.');

  const wholesale = money(form.wholesale, 'Wholesale price', true) as number;
  if (wholesale < 1) throw new Error('Wholesale price must be more than zero.');
  const retail = money(form.suggestedRetail, 'Suggested retail price', false);
  if (retail !== null && retail < wholesale) throw new Error('Suggested retail price must not be below the wholesale price.');
  const leadMin = wholeNumber(form.leadMin, 'Minimum lead time', 0, 30);
  const leadMax = wholeNumber(form.leadMax, 'Maximum lead time', 1, 30);
  if (leadMin > leadMax) throw new Error('Minimum lead time must not exceed the maximum.');

  const full: Record<string, unknown> = {
    title: text(form.title),
    description: text(form.description),
    category: text(form.category),
    condition: text(form.condition) || 'Brand New',
    brand: text(form.brand) || null,
    images: form.images,
    wholesalePricePesewas: wholesale,
    suggestedRetailPesewas: retail,
    maxPerOrder: wholeNumber(form.maxPerOrder, 'Maximum per order', 1, 100),
    shipsFromRegion: form.shipsFromRegion,
    shipsFromCity: text(form.shipsFromCity),
    deliveryFeeSameRegionPesewas: money(form.deliverySame, 'Delivery fee (same region)', true),
    deliveryFeeOtherRegionPesewas: money(form.deliveryOther, 'Delivery fee (other regions)', false),
    leadTimeMinDays: leadMin,
    leadTimeMaxDays: leadMax,
    returnWindowDays: wholeNumber(form.returnWindowDays, 'Return window', 0, 30),
    returnConditions: text(form.returnConditions) || null,
  };

  if (!original) {
    return { ...full, stockOnHand: wholeNumber(form.stockOnHand, 'Stock on hand', 0, 1_000_000) };
  }
  const before: Record<string, unknown> = {
    title: original.title, description: original.description, category: original.category, condition: original.condition,
    brand: original.brand, images: original.images, wholesalePricePesewas: original.wholesalePricePesewas,
    suggestedRetailPesewas: original.suggestedRetailPesewas, maxPerOrder: original.maxPerOrder,
    shipsFromRegion: original.shipsFromRegion, shipsFromCity: original.shipsFromCity,
    deliveryFeeSameRegionPesewas: original.deliveryFeeSameRegionPesewas,
    deliveryFeeOtherRegionPesewas: original.deliveryFeeOtherRegionPesewas,
    leadTimeMinDays: original.leadTimeMinDays, leadTimeMaxDays: original.leadTimeMaxDays,
    returnWindowDays: original.returnWindowDays, returnConditions: original.returnConditions,
  };
  const changed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(full)) {
    if (JSON.stringify(v) !== JSON.stringify(before[k])) changed[k] = v;
  }
  return changed;
}

// Supplier status actions the server allows from each product status (mirrors
// dropship_set_supplier_product_status; the server still decides).
export function supplierStatusActions(p: Pick<SupplierProduct, 'status' | 'publishedAt'>): Array<{ to: ProductStatus; label: string }> {
  switch (p.status) {
    case 'draft':
    case 'rejected':
      return [{ to: 'pending_review', label: 'Submit for review' }, { to: 'archived', label: 'Archive' }];
    case 'pending_review':
      return [{ to: 'archived', label: 'Archive' }];
    case 'active':
      return [{ to: 'paused', label: 'Pause' }, { to: 'archived', label: 'Archive' }];
    case 'paused':
      return [...(p.publishedAt ? [{ to: 'active' as const, label: 'Reactivate' }] : []), { to: 'archived', label: 'Archive' }];
    default:
      return [];
  }
}

// Quote reason code -> wording for the price calculator (the code itself is never shown).
export function quoteReasonText(reason: string | null | undefined): string {
  return reason === 'not_integer' ? 'Enter a valid price.' : 'This price is too low.';
}
