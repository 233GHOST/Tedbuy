import type { DropshipDb } from './db.js';

// Guards for legacy read/delete paths (Phase 3 ARCHITECTURE §2). Listing mirror rows live in
// public.products with ids starting "dsl_"; legacy code must not show them unless Dropship is
// enabled and the listing is currently available, and must never delete supplier-product media.

const CACHE_MS = 60_000;
const LOG_MS = 60_000;
const MAX_LISTINGS_PER_SUPPLIER_PRODUCT = 2;

export function isDropshipRowId(id: unknown): boolean {
  return typeof id === 'string' && id.toLowerCase().startsWith('dsl_');
}

export interface LegacyGuards {
  filterVisible<T extends { id: string }>(rows: T[]): Promise<T[]>;
  isVisibleProduct(id: string): Promise<boolean>;
  filterProtectedMedia(urls: string[]): Promise<{ deletable: string[]; protected: string[] }>;
  isLinkedProduct(id: string): boolean;
  invalidate(): void;
}

interface HiddenSnapshot {
  hidden: Set<string>;
  supplierProductOf: Map<string, string>;
}

export function createLegacyGuards(opts: { db: DropshipDb | null; enabled: boolean; now?: () => number }): LegacyGuards {
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

  return {
    async filterVisible(rows) {
      if (!live) return rows.filter(r => !isDropshipRowId(r.id));
      if (!rows.some(r => isDropshipRowId(r.id))) return rows;
      const snap = await snapshot();
      if (!snap) return rows.filter(r => !isDropshipRowId(r.id));
      const perSupplierProduct = new Map<string, number>();
      const out: typeof rows = [];
      for (const r of rows) {
        if (!isDropshipRowId(r.id)) { out.push(r); continue; }
        if (snap.hidden.has(r.id)) continue;
        const sp = snap.supplierProductOf.get(r.id);
        if (sp !== undefined) {
          const n = perSupplierProduct.get(sp) ?? 0;
          if (n >= MAX_LISTINGS_PER_SUPPLIER_PRODUCT) continue;
          perSupplierProduct.set(sp, n + 1);
        }
        out.push(r);
      }
      return out;
    },

    async isVisibleProduct(id) {
      if (!isDropshipRowId(id)) return true;
      if (!live) return false;
      const snap = await snapshot();
      return !!snap && !snap.hidden.has(id);
    },

    async filterProtectedMedia(urls) {
      if (urls.length === 0) return { deletable: [], protected: [] };
      const failClosed = { deletable: [] as string[], protected: [...urls] };
      if (!opts.db) return failClosed;
      try {
        const prot = await opts.db.call<string[] | null>('dropship_is_protected_media', { p_urls: urls });
        const set = new Set(prot ?? []);
        return { deletable: urls.filter(u => !set.has(u)), protected: urls.filter(u => set.has(u)) };
      } catch (err) {
        logOnce('media protection lookup', err);
        return failClosed;
      }
    },

    isLinkedProduct: id => isDropshipRowId(id),

    invalidate() {
      cache = null;
      generation++;
    },
  };
}
