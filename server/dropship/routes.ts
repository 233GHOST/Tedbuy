import express from 'express';
import { DropshipError } from './errors.js';
import { unavailable, type DropshipCause, type DropshipDb, type UserRestrictionLoader } from './db.js';
import {
  PARTICIPANT_STATUSES, PRODUCT_STATUSES, parseAdminStatus, parseApplication, parseModeration,
  encodeCatalogueCursor, parseCatalogueQuery, parseListingCreate, parseListingRemove, parseListingUpdate, parseQuote,
  parseParticipationDecision, parseProductCreate, parseProductUpdate, parseStock, parseSupplierStatus,
  queryEnum, uuidParam,
} from './validation.js';

export interface DropshipVerifiedUser {
  uid: string;
  email: string;
  isAdmin?: boolean;
  isImpersonating?: boolean;
  originalAdmin?: { uid: string; email: string };
  emailVerified?: boolean;
}

export interface DropshipDeps {
  enabled: boolean;
  cause?: DropshipCause;
  db: DropshipDb | null;
  verifyUser: (authHeader?: string, impersonationSessionId?: string | string[]) => Promise<DropshipVerifiedUser | null>;
  loadUserRestriction: UserRestrictionLoader | null;
  cloudinaryCloudName: string;
  rateLimit?: (windowMs: number, max: number, prefix: string) => express.RequestHandler;
}

type Handler = (req: express.Request, res: express.Response, db: DropshipDb) => Promise<void>;

// ---------------------------------------------------------------------------------------
// Projections (API_SPEC Appendix A.2): explicit whitelists, never row spreading.
// ---------------------------------------------------------------------------------------
function participantForOwner(p: any) {
  if (!p) return undefined;
  return {
    id: p.id, kind: p.kind, status: p.status, statusReason: p.statusReason, displayName: p.displayName,
    contactPhone: p.contactPhone, region: p.region, city: p.city, addressLine: p.addressLine,
    businessRegNo: p.businessRegNo, identityVerified: p.identityVerified,
    restrictions: p.status === 'suspended' ? ['fulfilment_only'] : [],
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

function participantForAdmin(p: any) {
  return {
    id: p.id, userId: p.userId, kind: p.kind, status: p.status, statusChangedAt: p.statusChangedAt,
    statusReason: p.statusReason, displayName: p.displayName, contactPhone: p.contactPhone, region: p.region,
    city: p.city, addressLine: p.addressLine, businessRegNo: p.businessRegNo, termsVersion: p.termsVersion,
    termsAcceptedAt: p.termsAcceptedAt, reviewedBy: p.reviewedBy, reviewedAt: p.reviewedAt,
    adminNotes: p.adminNotes, identityVerified: p.identityVerified, createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

// Supplier products are seen only by their owner and admins in this slice.
function productView(sp: any) {
  return {
    id: sp.id, supplierId: sp.supplierId, title: sp.title, description: sp.description, category: sp.category,
    condition: sp.condition, brand: sp.brand, images: sp.images,
    wholesalePricePesewas: sp.wholesalePricePesewas, suggestedRetailPesewas: sp.suggestedRetailPesewas,
    stockOnHand: sp.stockOnHand, stockReserved: sp.stockReserved, stockAvailable: sp.stockAvailable,
    maxPerOrder: sp.maxPerOrder, shipsFromRegion: sp.shipsFromRegion, shipsFromCity: sp.shipsFromCity,
    deliveryFeeSameRegionPesewas: sp.deliveryFeeSameRegionPesewas,
    deliveryFeeOtherRegionPesewas: sp.deliveryFeeOtherRegionPesewas,
    leadTimeMinDays: sp.leadTimeMinDays, leadTimeMaxDays: sp.leadTimeMaxDays,
    returnWindowDays: sp.returnWindowDays, returnConditions: sp.returnConditions,
    status: sp.status, moderationReason: sp.moderationReason, publishedAt: sp.publishedAt,
    contentVersion: sp.contentVersion, priceVersion: sp.priceVersion,
    createdAt: sp.createdAt, updatedAt: sp.updatedAt,
  };
}

// Phase 3 views. Supplier identity (id, name, contact) is never in any of these.
function catalogueItemView(row: any, viewer: 'dropshipper' | 'teaser') {
  if (viewer === 'teaser') {
    return { supplierProductId: row.supplierProductId, title: row.title, images: row.images, category: row.category };
  }
  return {
    supplierProductId: row.supplierProductId, title: row.title, images: row.images, category: row.category,
    condition: row.condition, brand: row.brand,
    wholesalePricePesewas: row.wholesalePricePesewas, suggestedRetailPesewas: row.suggestedRetailPesewas,
    minRetailPesewas: row.minRetailPesewas, available: row.available, leadTimeDays: row.leadTimeDays,
    shipsFromRegion: row.shipsFromRegion, deliveryFees: row.deliveryFees, returnWindowDays: row.returnWindowDays,
    alreadyListed: row.alreadyListed, listingCount: row.listingCount,
  };
}

function listingView(l: any) {
  return {
    id: l.id, supplierProductId: l.supplierProductId, productId: l.productId,
    retailPricePesewas: l.retailPricePesewas, status: l.status, createdAt: l.createdAt, updatedAt: l.updatedAt,
  };
}

// The dropshipper's own view: precise internal unavailable reason and margin.
function myListingView(l: any) {
  return {
    id: l.id, productId: l.productId, supplierProductId: l.supplierProductId, title: l.title, image: l.image,
    retailPricePesewas: l.retailPricePesewas, wholesalePricePesewas: l.wholesalePricePesewas,
    platformFeePesewas: l.platformFeePesewas, estimatedMarginPesewas: l.estimatedMarginPesewas,
    minRetailPesewas: l.minRetailPesewas, status: l.status, effectiveAvailable: l.effectiveAvailable,
    unavailableReason: l.unavailableReason ?? null, unitsSold: l.unitsSold, createdAt: l.createdAt, updatedAt: l.updatedAt,
  };
}

function quoteView(q: any) {
  return {
    valid: q.valid, platformFeePesewas: q.platformFeePesewas, estimatedMarginPesewas: q.estimatedMarginPesewas,
    minRetailPesewas: q.minRetailPesewas, ...(q.reason ? { reason: q.reason } : {}),
  };
}

// Customers only ever see out_of_stock or unavailable (A-04), whatever the database says.
function purchaseInfoView(r: any) {
  return {
    listingId: r.listingId, available: r.available, unitPricePesewas: r.unitPricePesewas, maxQuantity: r.maxQuantity,
    deliveryFees: r.deliveryFees, shipsFromRegion: r.shipsFromRegion, leadTimeDays: r.leadTimeDays,
    returnWindowDays: r.returnWindowDays, returnPolicyText: r.returnPolicyText,
    seller: { id: r.seller?.id, storeName: r.seller?.storeName },
    ...(r.available ? {} : { unavailableReason: r.unavailableReason === 'out_of_stock' ? 'out_of_stock' : 'unavailable' }),
  };
}

export function createDropshipRouter(deps: DropshipDeps): express.Router {
  const router = express.Router();
  const limit = (max: number, prefix: string): express.RequestHandler =>
    deps.rateLimit ? deps.rateLimit(60 * 1000, max, prefix) : (_req, _res, next) => next();

  const sendError = (res: express.Response, err: unknown) => {
    const e = err instanceof DropshipError ? err : new DropshipError('SERVER', 'Unexpected server error.');
    if (!(err instanceof DropshipError)) console.error('[Dropship] unexpected error', err);
    if (e.code === 'DROPSHIP_UNAVAILABLE') res.setHeader('Retry-After', '60');
    res.status(e.status).json({ success: false, error: e.message, errorCode: e.code });
  };

  const handle = (fn: Handler): express.RequestHandler => async (req, res) => {
    try {
      if (!deps.enabled || !deps.db) throw unavailable();
      await fn(req, res, deps.db);
    } catch (err) {
      sendError(res, err);
    }
  };

  // ---- gates (ARCHITECTURE §3) --------------------------------------------------------
  const authenticate = async (req: express.Request): Promise<DropshipVerifiedUser> => {
    const user = await deps.verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
    if (!user) throw new DropshipError('UNAUTHENTICATED', 'Sign in to continue.');
    return user;
  };

  const assertNotRestricted = async (uid: string, who: 'you' | 'supplier') => {
    if (!deps.loadUserRestriction) throw unavailable();
    const r = await deps.loadUserRestriction(uid);
    if (!r.exists) throw new DropshipError('NOT_FOUND', who === 'you' ? 'Account not found.' : 'Supplier not found.');
    if (r.restricted) {
      throw new DropshipError('ACCOUNT_RESTRICTED', who === 'you' ? 'Your account is restricted.' : 'The supplier account is restricted.');
    }
  };

  // A signed-in, unrestricted user acting for themselves. Writes refuse impersonation.
  const requireActor = async (req: express.Request, write: boolean) => {
    const user = await authenticate(req);
    if (write && (user.isImpersonating || user.originalAdmin)) {
      throw new DropshipError('IMPERSONATION_FORBIDDEN', 'This action is not allowed while impersonating.');
    }
    await assertNotRestricted(user.uid, 'you');
    return user;
  };

  // Admin, never while impersonating (API_SPEC §5).
  const requireAdmin = async (req: express.Request) => {
    const user = await authenticate(req);
    if (user.isImpersonating || user.originalAdmin) {
      throw new DropshipError('IMPERSONATION_FORBIDDEN', 'Exit impersonation to use admin tools.');
    }
    if (!user.isAdmin) throw new DropshipError('FORBIDDEN', 'Administrator privileges required.');
    return user;
  };

  // A supplier may read while approved or suspended (API_SPEC §4); writes are checked again
  // in the database under a participant lock.
  const requireSupplierParticipation = async (db: DropshipDb, uid: string) => {
    const parts = await db.call<Record<string, any>>('dropship_get_participations', { p_user: uid });
    const status = parts?.supplier?.status;
    if (status !== 'approved' && status !== 'suspended') {
      throw new DropshipError('NOT_APPROVED', 'An approved supplier participation is required.');
    }
  };

  // ---- public / participation -----------------------------------------------------------
  router.get('/api/dropship/status', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json({ success: true, enabled: deps.enabled && !!deps.db });
  });

  router.get('/api/dropship/me', limit(60, 'dropship-me'), async (req, res) => {
    try {
      if (!deps.enabled || !deps.db) {
        res.json({ success: true, enabled: false, mode: 'off' });
        return;
      }
      const user = await authenticate(req);
      let accountRestricted = false;
      if (deps.loadUserRestriction) accountRestricted = (await deps.loadUserRestriction(user.uid)).restricted;
      const parts = await deps.db.call<Record<string, any>>('dropship_get_participations', { p_user: user.uid });
      res.json({
        success: true, enabled: true, mode: 'on', accountRestricted,
        participations: { supplier: participantForOwner(parts?.supplier), dropshipper: participantForOwner(parts?.dropshipper) },
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/api/dropship/applications', limit(10, 'dropship-apply'), handle(async (req, res, db) => {
    const user = await requireActor(req, true);
    if (user.emailVerified !== true) throw new DropshipError('FORBIDDEN', 'Verify your email address before applying.');
    const input = parseApplication(req.body);
    const result = await db.call('dropship_submit_application', {
      p_user: user.uid, p_kind: input.kind, p_fields: input.fields, p_client_request_id: input.clientRequestId,
    });
    res.status(result.created ? 201 : 200).json({ success: true, participation: participantForOwner(result.participant) });
  }));

  // ---- supplier (API_SPEC §4) -----------------------------------------------------------
  router.get('/api/dropship/supplier/products', limit(120, 'dropship-supplier-read'), handle(async (req, res, db) => {
    const user = await requireActor(req, false);
    await requireSupplierParticipation(db, user.uid);
    const status = queryEnum(req.query.status, PRODUCT_STATUSES, 'status');
    const rows = await db.call<any[]>('dropship_list_supplier_products', { p_supplier_id: user.uid, p_status: status, p_limit: 200 });
    res.json({ success: true, products: rows.map(productView) });
  }));

  router.post('/api/dropship/supplier/products', limit(30, 'dropship-supplier-write'), handle(async (req, res, db) => {
    const user = await requireActor(req, true);
    const input = parseProductCreate(req.body, deps.cloudinaryCloudName, false);
    const result = await db.call('dropship_create_supplier_product', {
      p_actor: user.uid, p_actor_role: 'supplier', p_supplier_id: user.uid, p_fields: input.fields,
      p_submit: input.submit, p_client_request_id: input.clientRequestId, p_reason: null,
    });
    res.status(result.created ? 201 : 200).json({ success: true, product: productView(result.product) });
  }));

  router.patch('/api/dropship/supplier/products/:id', limit(60, 'dropship-supplier-write'), handle(async (req, res, db) => {
    const user = await requireActor(req, true);
    const id = uuidParam(req.params.id, 'product');
    const input = parseProductUpdate(req.body, deps.cloudinaryCloudName, false);
    const result = await db.call('dropship_update_supplier_product', {
      p_actor: user.uid, p_actor_role: 'supplier', p_id: id, p_fields: input.fields,
      p_expected_content_version: input.expectedContentVersion, p_reason: null,
    });
    res.json({ success: true, product: productView(result.product) });
  }));

  router.post('/api/dropship/supplier/products/:id/stock', limit(60, 'dropship-supplier-write'), handle(async (req, res, db) => {
    const user = await requireActor(req, true);
    const id = uuidParam(req.params.id, 'product');
    const input = parseStock(req.body, false);
    const result = await db.call('dropship_set_stock', {
      p_actor: user.uid, p_actor_role: 'supplier', p_id: id, p_new_on_hand: input.stockOnHand,
      p_expected_on_hand: input.expectedOnHand, p_reason: null,
    });
    const p = productView(result.product);
    res.json({ success: true, stockOnHand: p.stockOnHand, stockReserved: p.stockReserved, available: p.stockAvailable, product: p });
  }));

  router.post('/api/dropship/supplier/products/:id/status', limit(60, 'dropship-supplier-write'), handle(async (req, res, db) => {
    const user = await requireActor(req, true);
    const id = uuidParam(req.params.id, 'product');
    const input = parseSupplierStatus(req.body);
    const result = await db.call('dropship_set_supplier_product_status', {
      p_actor: user.uid, p_actor_role: 'supplier', p_id: id, p_status: input.status, p_reason: null,
    });
    res.json({ success: true, product: productView(result.product) });
  }));

  // ---- admin (API_SPEC §5) --------------------------------------------------------------
  router.get('/api/admin/dropship/applications', limit(60, 'dropship-admin-read'), handle(async (req, res, db) => {
    await requireAdmin(req);
    const status = queryEnum(req.query.status, PARTICIPANT_STATUSES, 'status');
    const kind = queryEnum(req.query.kind, ['supplier', 'dropshipper'] as const, 'kind');
    const rows = await db.call<any[]>('dropship_admin_list_participants', { p_status: status, p_kind: kind, p_limit: 200 });
    res.json({ success: true, participants: rows.map(participantForAdmin) });
  }));

  router.post('/api/admin/dropship/applications/:id/decision', limit(30, 'dropship-admin-write'), handle(async (req, res, db) => {
    const admin = await requireAdmin(req);
    const id = uuidParam(req.params.id, 'participation');
    const input = parseParticipationDecision(req.body);
    const result = await db.call('dropship_admin_decide_participation', {
      p_admin: admin.uid, p_participant_id: id, p_decision: input.decision, p_reason: input.reason,
      p_notes: input.adminNotes, p_expected_status: input.expectedStatus,
    });

    // Revocation side effects run after the status change committed, one product per
    // transaction (V22-01). Anything not finished is reported so the admin can retry it.
    const archived: string[] = [];
    const notArchived: string[] = [];
    for (const productId of (result.supplierProductsToArchive || []) as string[]) {
      try {
        await db.call('dropship_set_supplier_product_status', {
          p_actor: admin.uid, p_actor_role: 'admin', p_id: productId, p_status: 'archived',
          p_reason: `Supplier participation revoked: ${input.reason}`,
        });
        archived.push(productId);
      } catch (err) {
        console.error('[Dropship] revocation side effect failed for product', productId, err);
        notArchived.push(productId);
      }
    }
    res.json({ success: true, participant: participantForAdmin(result.participant), sideEffects: { archived, notArchived } });
  }));

  router.get('/api/admin/dropship/supplier-products', limit(60, 'dropship-admin-read'), handle(async (req, res, db) => {
    await requireAdmin(req);
    const status = queryEnum(req.query.status, PRODUCT_STATUSES, 'status');
    const supplierId = typeof req.query.supplierId === 'string' && req.query.supplierId.trim() ? req.query.supplierId.trim() : null;
    const rows = await db.call<any[]>('dropship_list_supplier_products', { p_supplier_id: supplierId, p_status: status, p_limit: 200 });
    res.json({ success: true, products: rows.map(productView) });
  }));

  router.post('/api/admin/dropship/supplier-products', limit(30, 'dropship-admin-write'), handle(async (req, res, db) => {
    const admin = await requireAdmin(req);
    const input = parseProductCreate(req.body, deps.cloudinaryCloudName, true);
    await assertNotRestricted(input.supplierId as string, 'supplier');
    const result = await db.call('dropship_create_supplier_product', {
      p_actor: admin.uid, p_actor_role: 'admin', p_supplier_id: input.supplierId, p_fields: input.fields,
      p_submit: input.submit, p_client_request_id: input.clientRequestId, p_reason: input.reason,
    });
    res.status(result.created ? 201 : 200).json({ success: true, product: productView(result.product) });
  }));

  router.patch('/api/admin/dropship/supplier-products/:id', limit(60, 'dropship-admin-write'), handle(async (req, res, db) => {
    const admin = await requireAdmin(req);
    const id = uuidParam(req.params.id, 'product');
    const input = parseProductUpdate(req.body, deps.cloudinaryCloudName, true);
    const result = await db.call('dropship_update_supplier_product', {
      p_actor: admin.uid, p_actor_role: 'admin', p_id: id, p_fields: input.fields,
      p_expected_content_version: input.expectedContentVersion, p_reason: input.reason,
    });
    res.json({ success: true, product: productView(result.product) });
  }));

  router.post('/api/admin/dropship/supplier-products/:id/moderate', limit(60, 'dropship-admin-write'), handle(async (req, res, db) => {
    const admin = await requireAdmin(req);
    const id = uuidParam(req.params.id, 'product');
    const input = parseModeration(req.body);
    const result = await db.call('dropship_admin_moderate_supplier_product', {
      p_admin: admin.uid, p_id: id, p_decision: input.decision, p_reason: input.reason,
    });
    res.json({ success: true, product: productView(result.product) });
  }));

  router.post('/api/admin/dropship/supplier-products/:id/stock', limit(60, 'dropship-admin-write'), handle(async (req, res, db) => {
    const admin = await requireAdmin(req);
    const id = uuidParam(req.params.id, 'product');
    const input = parseStock(req.body, true);
    const result = await db.call('dropship_set_stock', {
      p_actor: admin.uid, p_actor_role: 'admin', p_id: id, p_new_on_hand: input.stockOnHand,
      p_expected_on_hand: input.expectedOnHand, p_reason: input.reason,
    });
    res.json({ success: true, product: productView(result.product) });
  }));

  router.post('/api/admin/dropship/supplier-products/:id/status', limit(60, 'dropship-admin-write'), handle(async (req, res, db) => {
    const admin = await requireAdmin(req);
    const id = uuidParam(req.params.id, 'product');
    const input = parseAdminStatus(req.body);
    const result = await db.call('dropship_set_supplier_product_status', {
      p_actor: admin.uid, p_actor_role: 'admin', p_id: id, p_status: input.status, p_reason: input.reason,
    });
    res.json({ success: true, product: productView(result.product) });
  }));

  // ---- dropshipper catalogue and listings (Phase 3) ---------------------------------------
  const CATALOGUE_PAGE = 24;
  const catalogueViewer = async (db: DropshipDb, uid: string): Promise<'dropshipper' | 'teaser'> => {
    const parts = await db.call<Record<string, any>>('dropship_get_participations', { p_user: uid });
    return parts?.dropshipper?.status === 'approved' ? 'dropshipper' : 'teaser';
  };
  const cataloguePage = (db: DropshipDb, uid: string, q: ReturnType<typeof parseCatalogueQuery>, limitN: number) =>
    db.call<{ items: any[]; nextCursor: { afterCreated: string; afterId: string } | null }>('dropship_catalogue', {
      p_viewer: uid, p_category: q.category, p_q: q.q, p_after_created: q.afterCreated, p_after_id: q.afterId, p_limit: limitN,
    });

  router.get('/api/dropship/catalogue', limit(120, 'dropship-catalogue'), handle(async (req, res, db) => {
    const user = await requireActor(req, false);
    const q = parseCatalogueQuery(req.query);
    const viewer = await catalogueViewer(db, user.uid);
    const page = await cataloguePage(db, user.uid, q, CATALOGUE_PAGE);
    res.json({ success: true, items: page.items.map(i => catalogueItemView(i, viewer)), nextCursor: encodeCatalogueCursor(page.nextCursor) });
  }));

  // No single-item SQL function exists, so walk the keyset pages (bounded) to find the item.
  router.get('/api/dropship/catalogue/:supplierProductId', limit(120, 'dropship-catalogue'), handle(async (req, res, db) => {
    const user = await requireActor(req, false);
    const id = uuidParam(req.params.supplierProductId, 'product');
    const viewer = await catalogueViewer(db, user.uid);
    let q = parseCatalogueQuery({});
    for (let pageNo = 0; pageNo < 20; pageNo++) {
      const page = await cataloguePage(db, user.uid, q, 50);
      const hit = page.items.find(i => i.supplierProductId === id);
      if (hit) {
        res.json({ success: true, item: catalogueItemView(hit, viewer) });
        return;
      }
      if (!page.nextCursor) break;
      q = { ...q, afterCreated: page.nextCursor.afterCreated, afterId: page.nextCursor.afterId };
    }
    throw new DropshipError('NOT_FOUND', 'Product not found.');
  }));

  router.post('/api/dropship/catalogue/:supplierProductId/quote', limit(120, 'dropship-quote'), handle(async (req, res, db) => {
    const user = await requireActor(req, false);
    const id = uuidParam(req.params.supplierProductId, 'product');
    const input = parseQuote(req.body);
    const quote = await db.call('dropship_quote', { p_viewer: user.uid, p_supplier_product_id: id, p_retail_pesewas: input.retailPricePesewas });
    res.json({ success: true, quote: quoteView(quote) });
  }));

  router.post('/api/dropship/listings', limit(30, 'dropship-listing-write'), handle(async (req, res, db) => {
    const user = await requireActor(req, true);
    const input = parseListingCreate(req.body);
    const result = await db.call('dropship_create_listing', {
      p_actor: user.uid, p_supplier_product_id: input.supplierProductId, p_retail_pesewas: input.retailPricePesewas,
      p_client_request_id: input.clientRequestId,
    });
    res.status(result.created ? 201 : 200).json({ success: true, listing: listingView(result.listing), productId: result.productId });
  }));

  router.get('/api/dropship/listings/mine', limit(120, 'dropship-listing-read'), handle(async (req, res, db) => {
    const user = await requireActor(req, false);
    const out = await db.call('dropship_list_my_listings', { p_actor: user.uid });
    res.json({ success: true, listings: ((out?.listings ?? []) as any[]).map(myListingView) });
  }));

  router.patch('/api/dropship/listings/:listingId', limit(60, 'dropship-listing-write'), handle(async (req, res, db) => {
    const user = await requireActor(req, true);
    const id = uuidParam(req.params.listingId, 'listing');
    const input = parseListingUpdate(req.body);
    const result = await db.call('dropship_update_listing', {
      p_actor: user.uid, p_actor_role: 'dropshipper', p_listing_id: id, p_retail_pesewas: input.retailPricePesewas,
      p_status: input.status, p_reason: null,
    });
    res.json({ success: true, listing: listingView(result.listing) });
  }));

  // Owner removes without a body; an admin must send a reason (an admin request without a
  // reason is handled as the owner path, so it is NOT_FOUND unless the admin owns it).
  router.delete('/api/dropship/listings/:listingId', limit(30, 'dropship-listing-write'), handle(async (req, res, db) => {
    const user = await requireActor(req, true);
    const id = uuidParam(req.params.listingId, 'listing');
    const input = parseListingRemove(req.body);
    const asAdmin = user.isAdmin === true && input.reason !== null;
    const result = await db.call('dropship_remove_listing', {
      p_actor: user.uid, p_actor_role: asAdmin ? 'admin' : 'dropshipper', p_listing_id: id, p_reason: asAdmin ? input.reason : null,
    });
    res.json({ success: true, listing: listingView(result.listing) });
  }));

  // Public: what a buyer needs to purchase a mirror row. Never reveals supplier identity.
  router.get('/api/dropship/purchase-info/:productId', limit(240, 'dropship-purchase-info'), handle(async (req, res, db) => {
    const productId = String(req.params.productId || '');
    if (!productId || productId.length > 100) throw new DropshipError('NOT_FOUND', 'Listing not found.');
    const info = await db.call('dropship_purchase_info', { p_product_id: productId });
    if (!info) throw new DropshipError('NOT_FOUND', 'Listing not found.');
    res.json({ success: true, info: purchaseInfoView(info) });
  }));

  return router;
}
