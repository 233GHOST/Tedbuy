import type { DropshipDb } from './db.js';
import { extractCloudinaryInfo } from '../cloudinaryInfo.js';

// Guards for legacy read/delete paths (Phase 3 ARCHITECTURE §2). Listing mirror rows live in
// public.products with ids starting "dsl_"; legacy code must not show them unless Dropship is
// enabled and the listing is currently available, and must never delete supplier-product media.

const CACHE_MS = 60_000;
const LOG_MS = 60_000;
const MAX_LISTINGS_PER_SUPPLIER_PRODUCT = 2;

export function isDropshipRowId(id: unknown): boolean {
  return typeof id === 'string' && id.toLowerCase().startsWith('dsl_');
}

// Legacy create/sync of a products row (POST /api/products/sync, /api/products/create).
// A dsl_ row is written only by Dropship; legacy code may change only its social fields
// (likes/views), unless the caller is an admin.
export function legacySyncDecision(input: { productId: string; isAdmin: boolean; socialOnly: boolean; exists: boolean }): 'allow' | 'reject_dsl' {
  if (!isDropshipRowId(input.productId) || input.isAdmin) return 'allow';
  return input.exists && input.socialOnly ? 'allow' : 'reject_dsl';
}

// Legacy product delete endpoints never delete a dsl_ row; Dropship removes listings itself.
export function legacyDeleteDecision(productId: string): 'allow' | 'reject_dsl' {
  return isDropshipRowId(productId) ? 'reject_dsl' : 'allow';
}

// POST /api/cloudinary/cleanup-orphans: a dsl_ row is never evidence that the caller owns its
// media (its images are the supplier's), so its productId is refused outright.
export function cleanupOrphansDecision(productId: string): { ok: true } | { ok: false; status: 409; error: string } {
  return legacyDeleteDecision(productId) === 'reject_dsl'
    ? { ok: false, status: 409, error: 'Manage this listing from Dropship' }
    : { ok: true };
}

// POST /api/admin/users/delete, decided before anything is deleted: dropship_participants,
// dropship_listings and dropship_supplier_products reference users ON DELETE RESTRICT, so the
// final users-row delete would fail after products, reviews and chats were already gone.
// hasRecords: guards.userHasDropshipRecords (null = Dropship can't tell). When it can't tell,
// refuse only if a legacy signal (the user owns a dsl_ products row) says there are records.
export type AdminUserDeleteDecision = { ok: true } | { ok: false; status: 409 | 503; error: string };
export async function adminUserDeleteDecision(hasRecords: boolean | null, ownsDropshipRows: () => Promise<boolean>): Promise<AdminUserDeleteDecision> {
  if (hasRecords === true) {
    return { ok: false, status: 409, error: 'This account has Dropship records; suspend or revoke it in Dropship admin instead.' };
  }
  if (hasRecords === false) return { ok: true };
  return (await ownsDropshipRows())
    ? { ok: false, status: 503, error: "Dropship records can't be checked right now. Please try again later." }
    : { ok: true };
}

// List responses (N6): at most 2 listings of one supplier product per response, applied after
// search/category narrowing. A seller-scoped list (store page, My Listings) is never capped:
// a dropshipper must see every listing of their own.
export async function capListResponse<T extends { id: string }>(
  rows: T[], scope: { sellerId?: string; sellerEmail?: string }, guards: Pick<LegacyGuards, 'capPerSupplierProduct'>,
): Promise<T[]> {
  if (scope.sellerId || scope.sellerEmail) return rows;
  return guards.capPerSupplierProduct(rows);
}

// /api/products response payloads (including whole-response cache hits): drops dsl_ products
// the guards hide. Returns the same payload object when nothing is dropped.
export async function filterVisiblePayload<P extends { products?: unknown }>(payload: P, guards: Pick<LegacyGuards, 'filterVisible'>): Promise<P> {
  const list = payload?.products;
  const isDsl = (p: any) => !!p && isDropshipRowId(p.id);
  if (!Array.isArray(list) || !list.some(isDsl)) return payload;
  const visible = new Set<unknown>(await guards.filterVisible(list.filter(isDsl)));
  const products = list.filter(p => !isDsl(p) || visible.has(p));
  return products.length === list.length ? payload : { ...payload, products };
}

// Legacy media-ownership evidence (/api/cloudinary/delete): a dsl_ row never proves that the
// caller owns a media URL (its images are the supplier's).
export function productsOwnMediaUrl(rows: any[] | null | undefined, url: string): boolean {
  return (rows || []).some(p => !!p && !isDropshipRowId(p.id)
    && [p.images, p.imageUrls, p.videos, p.videoUrls].some((arr: any) => Array.isArray(arr) && arr.includes(url)));
}

// Legacy bulk products updates that must leave dsl_ rows alone (e.g. merge-account repointing
// sellerId): adds `id NOT ILIKE 'dsl\_%'` to a PostgREST filter builder.
export const DROPSHIP_ROW_ID_ILIKE = 'dsl\\_%';
export function excludeDropshipRows<Q extends { not(column: string, operator: string, value: unknown): Q }>(query: Q): Q {
  return query.not('id', 'ilike', DROPSHIP_ROW_ID_ILIKE);
}

// POST /api/cloudinary/delete: which asset to delete. Non-admins may delete only the asset of
// the url whose ownership is checked (any body publicId/resourceType is ignored), so a body
// publicId can't point the delete at someone else's (or a supplier's) media. Admins: unchanged
// (body publicId wins; url is the fallback). Web and mobile callers send only url.
export type CloudinaryDeleteTarget =
  | { ok: true; publicId: string; resourceType: 'image' | 'video'; url: string | null }
  | { ok: false; status: 400 | 403; error: string };
export function resolveCloudinaryDeleteTarget(
  input: { isAdmin: boolean; publicId?: unknown; resourceType?: unknown; url?: unknown },
  extract: (url: string) => { publicId: string; resourceType: 'image' | 'video' } | null,
): CloudinaryDeleteTarget {
  const missing = { ok: false as const, status: 400 as const, error: 'Missing publicId or valid Cloudinary url' };
  const url = typeof input.url === 'string' && input.url ? input.url : null;
  if (!input.isAdmin) {
    if (!url) {
      return input.publicId
        ? { ok: false, status: 403, error: 'Forbidden: cannot verify ownership without a url' }
        : missing;
    }
    const info = extract(url);
    return info && info.publicId ? { ok: true, publicId: info.publicId, resourceType: info.resourceType, url } : missing;
  }
  let publicId = typeof input.publicId === 'string' && input.publicId ? input.publicId : null;
  let resourceType: 'image' | 'video' = input.resourceType === 'video' ? 'video' : 'image';
  if (!publicId && url) {
    const info = extract(url);
    if (info) { publicId = info.publicId; resourceType = info.resourceType; }
  }
  return publicId ? { ok: true, publicId, resourceType, url } : missing;
}

export interface LegacyGuards {
  // Visibility only: drops hidden/unknown dsl_ rows (all dsl_ rows when disabled or on DB error).
  filterVisible<T extends { id: string }>(rows: T[]): Promise<T[]>;
  // Feed cap (N6): keeps at most 2 dsl_ rows per supplier product, first in input order. Apply
  // per list response after narrowing (see capListResponse); unknown dsl_ rows are dropped.
  capPerSupplierProduct<T extends { id: string }>(rows: T[]): Promise<T[]>;
  isVisibleProduct(id: string): Promise<boolean>;
  // Protection is by Cloudinary publicId (what a delete hits), so any URL variant of a
  // supplier image (transformed, other version, other extension) is protected.
  filterProtectedMedia(urls: string[]): Promise<{ deletable: string[]; protected: string[] }>;
  isProtectedPublicId(publicId: string): Promise<boolean>;
  // Admin user delete: true/false when the Dropship DB answers; null when there is no DB or it errors.
  userHasDropshipRecords(uid: string): Promise<boolean | null>;
  isLinkedProduct(id: string): boolean;
  // A dsl_ id with a live listing (present in the snapshot), whether or not it is currently
  // hidden; used to apply an already-paid boost. False when disabled or the DB can't answer.
  isLiveListing(id: string): Promise<boolean>;
  // True when media protection can actually be checked (a Dropship DB exists).
  mediaGuardAvailable(): boolean;
  invalidate(): void;
  // Account deletion: removes the user's listings (mirror rows) and archives their supplier
  // products via dropship_remove_user_listings, before legacy code touches their products.
  // Returns the number removed, or null when the call could not run; in that case it resolves
  // only if the user owns no dsl_ products row (listUserProductIds), and otherwise rejects so
  // the caller stops instead of half-deleting (products.id is ON DELETE RESTRICT).
  removeUserListings(uid: string, reason: string, listUserProductIds: () => Promise<string[]>): Promise<number | null>;
}

interface HiddenSnapshot {
  hidden: Set<string>;
  supplierProductOf: Map<string, string>;
}

export function createLegacyGuards(opts: {
  db: DropshipDb | null; enabled: boolean; now?: () => number;
  // Legacy product caches: told after removeUserListings removes mirror rows (undefined = clear broadly).
  onProductsChanged?: (productIds?: string[]) => void;
}): LegacyGuards {
  const now = opts.now ?? Date.now;
  const live = opts.enabled && opts.db !== null;
  let cache: { at: number; snap: HiddenSnapshot } | null = null;
  let generation = 0;
  let lastLogAt: number | null = null;

  const logOnce = (what: string, err: unknown) => {
    const t = now();
    if (lastLogAt !== null && t - lastLogAt < LOG_MS) return;
    lastLogAt = t;
    console.error(`[Dropship] legacy guard ${what} failed; failing closed.`, err);
  };

  // Returns null when the database can't answer (callers fail closed).
  const snapshot = async (): Promise<HiddenSnapshot | null> => {
    const t = now();
    if (cache && t - cache.at < CACHE_MS) return cache.snap;
    const startedIn = generation;
    try {
      const out = await opts.db!.call<{ hidden?: string[]; supplierProductOf?: Record<string, string> }>('dropship_hidden_product_ids', {});
      const snap: HiddenSnapshot = {
        hidden: new Set(out?.hidden ?? []),
        supplierProductOf: new Map(Object.entries(out?.supplierProductOf ?? {})),
      };
      // An invalidate() during the call means this answer may already be stale; use it once, don't keep it.
      if (startedIn === generation) cache = { at: t, snap };
      return snap;
    } catch (err) {
      logOnce('hidden-ids lookup', err);
      return null;
    }
  };

  // The publicIds (of ids) that belong to supplier media; null when the DB can't answer.
  const protectedPublicIds = async (ids: string[]): Promise<Set<string> | null> => {
    try {
      return new Set(await opts.db!.call<string[] | null>('dropship_is_protected_media', { p_public_ids: ids }) ?? []);
    } catch (err) {
      logOnce('media protection lookup', err);
      return null;
    }
  };

  return {
    async filterVisible(rows) {
      if (!live) return rows.filter(r => !isDropshipRowId(r.id));
      if (!rows.some(r => isDropshipRowId(r.id))) return rows;
      const snap = await snapshot();
      if (!snap) return rows.filter(r => !isDropshipRowId(r.id));
      // Unknown dsl_ ids (no live listing, or not lower-case) are hidden.
      return rows.filter(r => !isDropshipRowId(r.id) || (!snap.hidden.has(r.id) && snap.supplierProductOf.has(r.id)));
    },

    async capPerSupplierProduct(rows) {
      if (!rows.some(r => isDropshipRowId(r.id))) return rows;
      const snap = live ? await snapshot() : null;
      if (!snap) return rows.filter(r => !isDropshipRowId(r.id));
      const perSupplierProduct = new Map<string, number>();
      const out: typeof rows = [];
      for (const r of rows) {
        if (!isDropshipRowId(r.id)) { out.push(r); continue; }
        const sp = snap.supplierProductOf.get(r.id);
        if (sp === undefined) continue;
        const n = perSupplierProduct.get(sp) ?? 0;
        if (n >= MAX_LISTINGS_PER_SUPPLIER_PRODUCT) continue;
        perSupplierProduct.set(sp, n + 1);
        out.push(r);
      }
      return out;
    },

    async isVisibleProduct(id) {
      if (!isDropshipRowId(id)) return true;
      if (!live) return false;
      const snap = await snapshot();
      return !!snap && snap.supplierProductOf.has(id) && !snap.hidden.has(id);
    },

    async filterProtectedMedia(urls) {
      if (urls.length === 0) return { deletable: [], protected: [] };
      // No Dropship DB (disabled/unconfigured): there is nothing to protect against, so legacy
      // media deletion works exactly as before. Fail closed only on a DB error.
      if (!opts.db) return { deletable: [...urls], protected: [] };
      // A URL without a Cloudinary publicId names no asset a delete could reach.
      const idOf = urls.map(u => (typeof u === 'string' ? extractCloudinaryInfo(u)?.publicId ?? null : null));
      const ids = [...new Set(idOf.filter((x): x is string => x !== null))];
      if (ids.length === 0) return { deletable: [...urls], protected: [] };
      const set = await protectedPublicIds(ids);
      if (!set) return { deletable: [], protected: [...urls] };
      const isProt = (i: number) => idOf[i] !== null && set.has(idOf[i]!);
      return { deletable: urls.filter((_, i) => !isProt(i)), protected: urls.filter((_, i) => isProt(i)) };
    },

    async isProtectedPublicId(publicId) {
      if (!opts.db) return false;
      const set = await protectedPublicIds([publicId]);
      return !set || set.has(publicId);
    },

    async userHasDropshipRecords(uid) {
      if (!opts.db) return null;
      try {
        return (await opts.db.call<boolean>('dropship_user_has_records', { p_user: uid })) === true;
      } catch (err) {
        console.error('[Dropship] dropship_user_has_records failed.', err);
        return null;
      }
    },

    isLinkedProduct: id => isDropshipRowId(id),

    async isLiveListing(id) {
      if (!isDropshipRowId(id) || !live) return false;
      const snap = await snapshot();
      return !!snap && snap.supplierProductOf.has(id);
    },

    mediaGuardAvailable: () => opts.db !== null,

    async removeUserListings(uid, reason, listUserProductIds) {
      if (opts.db) {
        try {
          const n = await opts.db.call<number>('dropship_remove_user_listings', { p_user: uid, p_reason: reason });
          cache = null;
          generation++;
          opts.onProductsChanged?.(undefined);
          return Number(n) || 0;
        } catch (err) {
          console.error('[Dropship] dropship_remove_user_listings failed.', err);
        }
      }
      const ids = await listUserProductIds();
      if (ids.some(isDropshipRowId)) {
        throw new Error('Dropship listings could not be removed for this account. Please try again later.');
      }
      return null;
    },

    invalidate() {
      cache = null;
      generation++;
    },
  };
}
