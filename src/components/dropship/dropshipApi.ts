import { useEffect, useState } from 'react';
import { getAuthHeader } from '../../firebase';
import { dropshipErrorMessage, type ParticipantStatus, type ProductStatus, type SupplierProduct } from './dropshipFormat';

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

export interface AdminParticipant extends Omit<SupplierParticipation, 'restrictions'> {
  userId: string;
  statusChangedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  adminNotes: string | null;
  termsVersion: string;
  createdAt: string;
}

export type ParticipationDecision = 'approve' | 'reject' | 'suspend' | 'reinstate' | 'revoke';

const enc = encodeURIComponent;
const query = (params: Record<string, string | undefined>) => {
  const q = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${enc(v as string)}`).join('&');
  return q ? `?${q}` : '';
};

export const dropshipApi = {
  status: () => request<{ enabled: boolean }>('GET', '/api/dropship/status'),
  me: () => request<{ enabled: boolean; accountRestricted?: boolean; participations?: { supplier?: SupplierParticipation } }>('GET', '/api/dropship/me'),
  apply: (body: Record<string, unknown>) => request<{ participation: SupplierParticipation }>('POST', '/api/dropship/applications', body),

  myProducts: (status?: ProductStatus) => request<{ products: SupplierProduct[] }>('GET', `/api/dropship/supplier/products${query({ status })}`),
  createProduct: (body: Record<string, unknown>) => request<{ product: SupplierProduct }>('POST', '/api/dropship/supplier/products', body),
  updateProduct: (id: string, body: Record<string, unknown>) => request<{ product: SupplierProduct }>('PATCH', `/api/dropship/supplier/products/${enc(id)}`, body),
  setStock: (id: string, stockOnHand: number, expectedOnHand: number) =>
    request<{ product: SupplierProduct }>('POST', `/api/dropship/supplier/products/${enc(id)}/stock`, { stockOnHand, expectedOnHand }),
  setStatus: (id: string, status: ProductStatus) => request<{ product: SupplierProduct }>('POST', `/api/dropship/supplier/products/${enc(id)}/status`, { status }),

  adminApplications: (status?: ParticipantStatus) => request<{ participants: AdminParticipant[] }>('GET', `/api/admin/dropship/applications${query({ status, kind: 'supplier' })}`),
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
let statusPromise: Promise<boolean> | null = null;
export function useDropshipEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    // A failed check hides the entry point now and is retried on the next mount.
    statusPromise ??= dropshipApi.status().then(r => r.enabled === true).catch(() => { statusPromise = null; return false; });
    let live = true;
    statusPromise.then(v => { if (live) setEnabled(v); });
    return () => { live = false; };
  }, []);
  return enabled;
}
