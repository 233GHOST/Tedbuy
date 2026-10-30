import { useEffect, useState } from 'react';
import { getAuthHeader } from '../../firebase';
import { dropshipErrorMessage, type ParticipantStatus, type ProductStatus, type SupplierProduct } from './dropshipFormat';
import type { OrderStatus } from './orderFormat';

// Client for the Dropship API (server/dropship/routes.ts). Every call carries the signed-in
// user's Firebase ID token via getAuthHeader(); the server decides what the user may do.

export class DropshipApiError extends Error {
  constructor(message: string, public code: string, public status: number) {
    super(message);
  }
}

async function request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new DropshipApiError(dropshipErrorMessage(data?.errorCode, data?.error), data?.errorCode || 'SERVER', res.status);
  }
  return data as T;
}

export interface SupplierParticipation {
  id: string;
  kind: 'supplier';
  status: ParticipantStatus;
  statusReason: string | null;
  displayName: string;
  contactPhone: string;
  region: string;
  city: string;
  addressLine: string | null;
  businessRegNo: string | null;
  restrictions: string[];
}

export interface AdminParticipant extends Omit<SupplierParticipation, 'restrictions' | 'kind'> {
  kind: 'supplier' | 'dropshipper';
  userId: string;
  statusChangedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  adminNotes: string | null;
  termsVersion: string;
  createdAt: string;
}

export interface DropshipperParticipation extends Omit<SupplierParticipation, 'kind'> { kind: 'dropshipper' }

export interface DeliveryFee { scope: 'same_region' | 'other_region'; regionNote: string; feePesewas: number }

export interface CatalogueItemData {
  supplierProductId: string;
  title: string;
  images: string[];
  category: string;
  // Present only for approved dropshippers (teaser items carry just the four fields above).
  condition?: string;
  brand?: string | null;
  wholesalePricePesewas?: number;
  suggestedRetailPesewas?: number | null;
  minRetailPesewas?: number;
  available?: boolean;
  leadTimeDays?: { min: number; max: number };
  shipsFromRegion?: string;
  deliveryFees?: DeliveryFee[];
  returnWindowDays?: number;
  alreadyListed?: boolean;
  listingCount?: number;
}

export interface Quote { valid: boolean; platformFeePesewas: number; estimatedMarginPesewas: number; minRetailPesewas: number; reason?: string }

export interface MyListing {
  id: string; productId: string; supplierProductId: string; title: string; image: string | null;
  retailPricePesewas: number; deliveryFeePesewas: number; wholesalePricePesewas: number; platformFeePesewas: number;
  estimatedMarginPesewas: number; minRetailPesewas: number; status: 'active' | 'paused' | 'removed';
  effectiveAvailable: boolean; unavailableReason: string | null; unitsSold: number;
}

export interface PurchaseInfo {
  listingId: string; available: boolean; unavailableReason?: 'out_of_stock' | 'unavailable';
  unitPricePesewas: number; maxQuantity: number; deliveryFeePesewas: number;
  leadTimeDays: { min: number; max: number }; returnWindowDays: number; returnPolicyText: string;
  seller: { id: string; storeName: string };
}

// ---- COD orders (server/dropship/orderRoutes.ts). Each audience gets its own projection;
// fields a viewer must not see are simply absent.
export interface Reliability { completed: number; verifiedProblems: number; reportedProblems: number; cancelledEarly: number; level: 'new' | 'good' | 'caution' }
export interface OrderPayment {
  id: string; kind: string; amountPesewas: number; method: string; paidOn: string; reference: string | null;
  evidenceUrl: string | null; recordedRole: string; status: string; confirmedAt: string | null; rejectedReason: string | null; createdAt: string;
}
export interface OrderCase {
  id: string; kind: 'dispute' | 'return'; reasonCode: string; description: string | null; evidence: string[]; openedRole: string;
  status: 'open' | 'resolved'; outcome: string | null; resolution: string | null; fault?: string | null; createdAt: string; resolvedAt: string | null;
}
export interface TimelineEntry { at: string; action: string; by: string; from: string | null; to: string | null; reason: string | null }
export interface OrderRow {
  id: string; orderNumber: string; title: string; image: string | null; quantity: number; status: OrderStatus;
  deadlineAt: string | null; createdAt: string; statusChangedAt: string; totalPesewas?: number; wholesaleTotalPesewas?: number;
  buyerId?: string; dropshipperId?: string; supplierId?: string;
}
export interface Order extends OrderRow {
  deliveredAt: string | null; completedAt: string | null; cancelledAt: string | null; cancelledByRole: string | null;
  productId?: string; unitPricePesewas?: number; deliveryFeePesewas?: number;
  delivery?: { name?: string; phone?: string; region: string; area: string; address: string; instructions: string | null };
  seller?: { id: string; storeName: string; phone: string | null };
  buyer?: { name: string; phone: string; reliability: Reliability };
  reseller?: { storeName: string; phone: string; reliability: Reliability };
  resellerName?: string;
  supplier?: { name: string; phone: string; region: string; city: string; address: string | null } | null;
  supplierReliability?: Reliability; resellerReliability?: Reliability;
  wholesaleUnitPesewas?: number; wholesaleUnitAtOrder?: number; wholesaleUnitProposed?: number | null; wholesaleUnitAgreed?: number | null;
  margin?: { retailTotalPesewas: number; wholesaleTotalPesewas: number; grossPesewas: number; deliveryCostPesewas: number; otherCostPesewas: number; estimatedNetPesewas: number };
  reservation?: { status: string; quantity: number; holdHours: number; requestedAt: string; expiresAt: string | null } | null;
  deliveryConfirmation?: 'code' | 'buyer' | 'reseller_only' | null; deliveryAttempts?: number;
  deliveryCode?: string | null; deliveryCodeExpiresAt?: string | null;
  returnWindowDays?: number; returnUntil?: string | null; cancelReason?: string | null; codeAttempts?: number | null;
  payments: OrderPayment[]; disputes: OrderCase[]; timeline: TimelineEntry[];
}
export interface ActionResult { order: Order; changed: boolean; codeOk?: boolean; codeProblem?: 'wrong' | 'locked' | 'expired'; attemptsLeft?: number }
export interface ResellerSummary {
  perOrderPesewas: number; openPesewas: number; tier: number; completedOrders: number; upheldFaults: number;
  source: 'tier' | 'admin_override'; exposurePesewas: number; openOrders: number; needsAction: number; reliability: Reliability;
}
export interface OrderSettings {
  limitTiers: Array<{ minCompleted: number; perOrderPesewas: number; openPesewas: number }>;
  buyerConfirmHours: number; resellerAcceptHours: number; supplierResponseHours: number; reservationHours: number;
  reservationMinHours: number; reservationMaxHours: number; codeValidHours: number; maxOpenOrdersPerBuyer: number; updatedAt: string;
}
export type OrderScope = 'open' | 'done' | 'cases' | '';

export type ParticipationDecision = 'approve' | 'reject' | 'suspend' | 'reinstate' | 'revoke';

const enc = encodeURIComponent;
const query = (params: Record<string, string | undefined>) => {
  const q = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${enc(v as string)}`).join('&');
  return q ? `?${q}` : '';
};

const ORDER_BASE = {
  buyer: '/api/dropship/orders', reseller: '/api/dropship/reseller/orders',
  supplier: '/api/dropship/supplier/orders', admin: '/api/admin/dropship/orders',
} as const;

export const dropshipApi = {
  status: () => request<{ enabled: boolean; ordersEnabled?: boolean }>('GET', '/api/dropship/status'),
  me: () => request<{ enabled: boolean; accountRestricted?: boolean; participations?: { supplier?: SupplierParticipation; dropshipper?: DropshipperParticipation } }>('GET', '/api/dropship/me'),
  apply: (body: Record<string, unknown>) => request<{ participation: SupplierParticipation | DropshipperParticipation }>('POST', '/api/dropship/applications', body),

  myProducts: (status?: ProductStatus) => request<{ products: SupplierProduct[] }>('GET', `/api/dropship/supplier/products${query({ status })}`),
  createProduct: (body: Record<string, unknown>) => request<{ product: SupplierProduct }>('POST', '/api/dropship/supplier/products', body),
  updateProduct: (id: string, body: Record<string, unknown>) => request<{ product: SupplierProduct }>('PATCH', `/api/dropship/supplier/products/${enc(id)}`, body),
  setStock: (id: string, stockOnHand: number, expectedOnHand: number) =>
    request<{ product: SupplierProduct }>('POST', `/api/dropship/supplier/products/${enc(id)}/stock`, { stockOnHand, expectedOnHand }),
  setStatus: (id: string, status: ProductStatus) => request<{ product: SupplierProduct }>('POST', `/api/dropship/supplier/products/${enc(id)}/status`, { status }),

  catalogue: (p: { category?: string; q?: string; cursor?: string }) =>
    request<{ items: CatalogueItemData[]; nextCursor: string | null }>('GET', `/api/dropship/catalogue${query(p)}`),
  catalogueItem: (id: string) => request<{ item: CatalogueItemData }>('GET', `/api/dropship/catalogue/${enc(id)}`),
  quote: (id: string, retailPricePesewas: number) =>
    request<{ quote: Quote }>('POST', `/api/dropship/catalogue/${enc(id)}/quote`, { retailPricePesewas }),
  createListing: (body: { clientRequestId: string; supplierProductId: string; retailPricePesewas: number }) =>
    request<{ listing: { id: string }; productId: string }>('POST', '/api/dropship/listings', body),
  myListings: () => request<{ listings: MyListing[] }>('GET', '/api/dropship/listings/mine'),
  updateListing: (id: string, body: { retailPricePesewas?: number; status?: 'active' | 'paused' }) =>
    request<{ listing: { id: string } }>('PATCH', `/api/dropship/listings/${enc(id)}`, body),
  removeListing: (id: string) => request<{ listing: { id: string } }>('DELETE', `/api/dropship/listings/${enc(id)}`),
  purchaseInfo: (productId: string) => request<{ info: PurchaseInfo }>('GET', `/api/dropship/purchase-info/${enc(productId)}`),
  setDeliveryFee: (listingId: string, deliveryFeePesewas: number) =>
    request<{ listing: { id: string } }>('PATCH', `/api/dropship/listings/${enc(listingId)}/delivery-fee`, { deliveryFeePesewas }),

  placeOrder: (body: { productId: string; quantity: number; clientRequestId: string; delivery: Record<string, string | undefined> }) =>
    request<ActionResult>('POST', '/api/dropship/orders', body),
  // One list/get/act trio per audience; the server decides what each may see and do.
  orders: (who: 'buyer' | 'reseller' | 'supplier' | 'admin', p: { scope?: OrderScope; cursor?: string } = {}) =>
    request<{ orders: OrderRow[]; nextCursor: string | null }>('GET', `${ORDER_BASE[who]}${who === 'buyer' ? '/mine' : ''}${query({ scope: p.scope || undefined, cursor: p.cursor })}`),
  order: (who: 'buyer' | 'reseller' | 'supplier' | 'admin', id: string) =>
    request<{ order: Order }>('GET', `${ORDER_BASE[who]}/${enc(id)}`),
  orderAction: (who: 'buyer' | 'reseller' | 'supplier', id: string, action: string, body: Record<string, unknown> = {}) =>
    request<ActionResult>('POST', `${ORDER_BASE[who]}/${enc(id)}/${enc(action)}`, body),
  resellerSummary: () => request<{ summary: ResellerSummary }>('GET', '/api/dropship/reseller/summary'),
  supplierSummary: () => request<{ summary: { needsAction: number; reliability: Reliability } }>('GET', '/api/dropship/supplier/order-summary'),
  adminResolve: (id: string, body: { outcome: string; fault: string; faultType?: string; resolution: string }) =>
    request<ActionResult>('POST', `/api/admin/dropship/orders/${enc(id)}/resolve`, body),
  adminCancelOrder: (id: string, reason: string) => request<ActionResult>('POST', `/api/admin/dropship/orders/${enc(id)}/cancel`, { reason }),
  adminSettings: () => request<{ settings: OrderSettings }>('GET', '/api/admin/dropship/order-settings'),
  adminUpdateSettings: (body: Record<string, unknown>) => request<{ settings: OrderSettings }>('PUT', '/api/admin/dropship/order-settings', body),
  adminSetLimits: (userId: string, body: { perOrderPesewas?: number; openPesewas?: number; reason: string }) =>
    request<{ limits: ResellerSummary }>('PUT', `/api/admin/dropship/resellers/${enc(userId)}/limits`, body),
  adminReliability: (userId: string) => request<{ reliability: any }>('GET', `/api/admin/dropship/reliability/${enc(userId)}`),

  adminApplications: (status?: ParticipantStatus, kind: 'supplier' | 'dropshipper' | '' = '') =>
    request<{ participants: AdminParticipant[] }>('GET', `/api/admin/dropship/applications${query({ status, kind: kind || undefined })}`),
  adminDecide: (id: string, body: { decision: ParticipationDecision; expectedStatus: ParticipantStatus; reason?: string }) =>
    request<{ participant: AdminParticipant; sideEffects: { archived: string[]; notArchived: string[] } }>('POST', `/api/admin/dropship/applications/${enc(id)}/decision`, body),
  adminProducts: (status?: ProductStatus) => request<{ products: SupplierProduct[] }>('GET', `/api/admin/dropship/supplier-products${query({ status })}`),
  adminModerate: (id: string, decision: 'approve' | 'reject' | 'pause', reason?: string) =>
    request<{ product: SupplierProduct }>('POST', `/api/admin/dropship/supplier-products/${enc(id)}/moderate`, { decision, ...(reason ? { reason } : {}) }),
  adminStock: (id: string, stockOnHand: number, expectedOnHand: number, reason: string) =>
    request<{ product: SupplierProduct }>('POST', `/api/admin/dropship/supplier-products/${enc(id)}/stock`, { stockOnHand, expectedOnHand, reason }),
  adminArchive: (id: string, reason: string) =>
    request<{ product: SupplierProduct }>('POST', `/api/admin/dropship/supplier-products/${enc(id)}/status`, { status: 'archived', reason }),
};

// Whether Dropship is switched on (public, cached for the page's lifetime). Entry points
// stay hidden unless the server says it is enabled.
let statusPromise: Promise<{ enabled: boolean; ordersEnabled: boolean }> | null = null;
function loadStatus() {
  // A failed check hides the entry point now and is retried on the next mount.
  statusPromise ??= dropshipApi.status()
    .then(r => ({ enabled: r.enabled === true, ordersEnabled: r.enabled === true && r.ordersEnabled === true }))
    .catch(() => { statusPromise = null; return { enabled: false, ordersEnabled: false }; });
  return statusPromise;
}
export function useDropshipEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    loadStatus().then(v => { if (live) setEnabled(v.enabled); });
    return () => { live = false; };
  }, []);
  return enabled;
}
// Whether COD ordering is switched on (DROPSHIP_ORDERS_ENABLED).
export function useDropshipOrdersEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    loadStatus().then(v => { if (live) setEnabled(v.ordersEnabled); });
    return () => { live = false; };
  }, []);
  return enabled;
}
