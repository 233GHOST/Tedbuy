import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { DropshipError } from './errors.js';
import { createPgliteDropship, LISTINGS_MIGRATION_PATH, type PgliteDropship } from './testing/pgliteDb.js';

// Phase 3 (reseller listings) SQL functions on an in-process PostgreSQL 17 (PGlite), with
// the Phase 2 and Phase 3 migrations applied in order and called as service_role. Single
// connection: these tests cover behaviour and projections, not concurrent interleavings.

let h: PgliteDropship;
const IMG = 'https://res.cloudinary.com/dfm3g2qvg/image/upload/v1/tedbuy_products/listing-a.jpg';
const IMG2 = 'https://res.cloudinary.com/dfm3g2qvg/image/upload/v1/tedbuy_products/listing-b.jpg';
const W = 10000;

const BASELINE_PRODUCT_COLUMNS = [
  'id', 'title', 'description', 'price', 'category', 'location', 'images', 'videos', 'brand', 'condition', 'negotiable',
  'sellerId', 'sellerName', 'createdAt', 'viewsCount', 'likesCount', 'likedUserIds', 'boostStatus', 'boostPlan',
  'boostStartDate', 'boostEndDate', 'boostPriority', 'priorityScore', 'boostPriorityLevel', 'boostPackagePrice',
  'remainingBoostTime', 'boostAmount', 'lastBoostedAt', 'lastBoostPurchase', 'paymentStatus', 'paymentReference',
  'boostHistory', 'visitCount', 'isApproved', 'status', 'isDeleted', 'archivedAt', 'securityHold', 'isSold', 'soldAt',
];

const productFields = (over: Record<string, unknown> = {}) => ({
  title: 'Bluetooth speaker X2', description: 'Portable speaker, 12 hours battery, splash resistant.',
  category: 'Electronics', brand: 'Sonix', images: [IMG], wholesalePricePesewas: W, suggestedRetailPesewas: 15000,
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

async function expectCode(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof DropshipError && e.code === code ? true : (assert.fail(`expected ${code}, got ${(e as any)?.code}: ${(e as any)?.message}`), false));
}

async function ensureUser(id: string) {
  const r = await h.pg.query('select 1 from public.users where id = $1', [id]);
  if (r.rows.length === 0) await h.addUser(id);
}

async function approve(participantId: string) {
  await h.db.call('dropship_admin_decide_participation', { p_admin: 'admin1', p_participant_id: participantId, p_decision: 'approve', p_reason: null, p_notes: null, p_expected_status: 'pending' });
}

async function approvedSupplier(id: string) {
  await ensureUser(id);
  const app = await h.db.call('dropship_submit_application', { p_user: id, p_kind: 'supplier', p_fields: supplierApplication, p_client_request_id: crypto.randomUUID() });
  await approve(app.participant.id);
  return app.participant.id as string;
}

async function approvedDropshipper(id: string) {
  await ensureUser(id);
  const app = await h.db.call('dropship_submit_application', { p_user: id, p_kind: 'dropshipper', p_fields: dropshipperApplication(id), p_client_request_id: crypto.randomUUID() });
  await approve(app.participant.id);
  return app.participant.id as string;
}

async function activeProduct(supplier: string, over: Record<string, unknown> = {}) {
  const r = await h.db.call('dropship_create_supplier_product', {
    p_actor: supplier, p_actor_role: 'supplier', p_supplier_id: supplier, p_fields: productFields(over),
    p_submit: true, p_client_request_id: crypto.randomUUID(), p_reason: null,
  });
  const a = await h.db.call('dropship_admin_moderate_supplier_product', { p_admin: 'admin1', p_id: r.product.id, p_decision: 'approve', p_reason: null });
  return a.product;
}

const createListing = (actor: string, spId: string, retail = 15000, reqId: string = crypto.randomUUID()) =>
  h.db.call('dropship_create_listing', { p_actor: actor, p_supplier_product_id: spId, p_retail_pesewas: retail, p_client_request_id: reqId });

const quote = (viewer: string, spId: string, retail: number | null) =>
  h.db.call('dropship_quote', { p_viewer: viewer, p_supplier_product_id: spId, p_retail_pesewas: retail });

const updateListing = (actor: string, id: string, retail: number | null, status: string | null, role = 'dropshipper', reason: string | null = null) =>
  h.db.call('dropship_update_listing', { p_actor: actor, p_actor_role: role, p_listing_id: id, p_retail_pesewas: retail, p_status: status, p_reason: reason });

const removeListing = (actor: string, id: string, role = 'dropshipper', reason: string | null = null) =>
  h.db.call('dropship_remove_listing', { p_actor: actor, p_actor_role: role, p_listing_id: id, p_reason: reason });

async function mirror(productId: string) {
  return (await h.pg.query<any>('select * from public.products where id = $1', [productId])).rows[0];
}

async function availability(listingId: string) {
  const r = await h.pg.query<any>('select is_available, unavailable_reason from public.dropship_listing_availability where listing_id = $1', [listingId]);
  return r.rows[0];
}

// One approved supplier with an active product (W = 10000, stock 5) and one approved dropshipper.
async function scenario(tag: string, over: Record<string, unknown> = {}) {
  const supplier = `sup-${tag}`;
  const dropshipper = `ds-${tag}`;
  await approvedSupplier(supplier);
  await approvedDropshipper(dropshipper);
  const sp = await activeProduct(supplier, over);
  return { supplier, dropshipper, sp };
}

before(async () => { h = await createPgliteDropship(); });
after(async () => { await h.close(); });

test('pricing config has the pilot values', async () => {
  assert.deepEqual(await h.db.call('dropship_pricing_config', {}), { platformFeeBps: 0, minMarginPesewas: 100, maxListingsPerSupplierProduct: 10 });
});

test('quote: minimum is W + 100 at 0% fee', async () => {
  const { dropshipper, sp } = await scenario('quote');
  const q1 = await quote(dropshipper, sp.id, 10100);
  assert.equal(q1.minRetailPesewas, 10100);
  assert.equal(q1.valid, true);
  const q2 = await quote(dropshipper, sp.id, 10099);
  assert.equal(q2.valid, false);
  assert.equal(q2.reason, 'below_minimum');
  const q3 = await quote(dropshipper, sp.id, 15000);
  assert.deepEqual(q3, { valid: true, platformFeePesewas: 0, estimatedMarginPesewas: 5000, minRetailPesewas: 10100 });
  const q4 = await quote(dropshipper, sp.id, null);
  assert.equal(q4.valid, false);
  assert.equal(q4.reason, 'not_integer');
  await expectCode(quote(dropshipper, crypto.randomUUID(), 15000), 'NOT_FOUND');
});

test('create listing writes mirror row', async () => {
  const { dropshipper, sp } = await scenario('create');
  const r = await createListing(dropshipper, sp.id, 15000);
  assert.equal(r.created, true);
  assert.equal(r.productId, 'dsl_' + r.listing.id.replaceAll('-', ''));
  assert.equal(r.listing.productId, r.productId);
  assert.equal(r.listing.status, 'active');
  assert.equal(r.listing.retailPricePesewas, 15000);
  const row = await mirror(r.productId);
  assert.equal(row.sellerId, dropshipper);
  assert.equal(row.sellerName, dropshipper); // users.username (the stub sets username = id)
  assert.equal(row.price, '150');
  assert.equal(row.title, sp.title);
  assert.equal(row.description, sp.description);
  assert.equal(row.category, sp.category);
  assert.equal(row.condition, sp.condition);
  assert.equal(row.brand, sp.brand);
  assert.deepEqual(row.images, sp.images);
  assert.equal(row.location, 'Tema');
  assert.equal(row.negotiable, false);
  assert.equal(row.status, 'active');
  assert.equal(row.isApproved, true);
  assert.match(row.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const audit = await h.pg.query<any>("select action, actor_role from public.dropship_audit_events where target_type = 'listing' and target_id = $1", [r.listing.id]);
  assert.deepEqual(audit.rows, [{ action: 'listing_created', actor_role: 'dropshipper' }]);
});

test('mirror row is written only with baseline products columns (no new column on products)', async () => {
  const cols = await h.pg.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'products' order by ordinal_position");
  assert.deepEqual(cols.rows.map(c => c.column_name), BASELINE_PRODUCT_COLUMNS, 'products has exactly the baseline columns');

  const sql = fs.readFileSync(LISTINGS_MIGRATION_PATH, 'utf8');
  assert.doesNotMatch(sql, /alter\s+table\s+(public\.)?products\b/i, 'the migration never alters products');
  const inserts = [...sql.matchAll(/insert\s+into\s+public\.products\s*\(([^)]*)\)/gi)];
  assert.ok(inserts.length >= 1, 'found the mirror insert');
  const updates = [...sql.matchAll(/update\s+public\.products\s+set\s+([\s\S]*?)\s+where\s/gi)];
  assert.ok(updates.length >= 1, 'found the mirror updates');
  const named = [
    ...inserts.flatMap(m => m[1].split(',')),
    ...updates.flatMap(m => [...m[1].matchAll(/(?:^|,)\s*("?[A-Za-z_]+"?)\s*=/g)].map(x => x[1])),
  ].map(c => c.trim().replaceAll('"', ''));
  for (const c of named) assert.ok(BASELINE_PRODUCT_COLUMNS.includes(c), `column ${c} is not a baseline products column`);
});

test('create is idempotent', async () => {
  const { dropshipper, sp } = await scenario('idem');
  const reqId = crypto.randomUUID();
  const first = await createListing(dropshipper, sp.id, 15000, reqId);
  const second = await createListing(dropshipper, sp.id, 15000, reqId);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.listing.id, first.listing.id);
  assert.equal(second.productId, first.productId);
  const third = await createListing(dropshipper, sp.id, 16000);
  assert.equal(third.created, false);
  assert.equal(third.listing.id, first.listing.id);
  const n = await h.pg.query<any>('select count(*)::int as n from public.dropship_listings where supplier_product_id = $1', [sp.id]);
  assert.equal(n.rows[0].n, 1);
});

test('cannot list own supplier product', async () => {
  await approvedSupplier('both-kinds');
  await approvedDropshipper('both-kinds');
  const sp = await activeProduct('both-kinds');
  await expectCode(createListing('both-kinds', sp.id), 'FORBIDDEN');
});

test('cap of 10 live listings', async () => {
  await approvedSupplier('sup-cap');
  const sp = await activeProduct('sup-cap');
  const listings = [];
  for (let i = 0; i < 10; i++) {
    await approvedDropshipper(`ds-cap-${i}`);
    listings.push(await createListing(`ds-cap-${i}`, sp.id));
  }
  await approvedDropshipper('ds-cap-10');
  await expectCode(createListing('ds-cap-10', sp.id), 'STATE_CONFLICT');
  await removeListing('ds-cap-3', listings[3].listing.id);
  const r = await createListing('ds-cap-10', sp.id);
  assert.equal(r.created, true);
});

test('not approved dropshipper, product not active, price below minimum', async () => {
  const { dropshipper, supplier, sp } = await scenario('rules');
  await ensureUser('plain-user');
  await expectCode(createListing('plain-user', sp.id), 'NOT_APPROVED');
  await ensureUser('ds-pending');
  await h.db.call('dropship_submit_application', { p_user: 'ds-pending', p_kind: 'dropshipper', p_fields: dropshipperApplication('p'), p_client_request_id: crypto.randomUUID() });
  await expectCode(createListing('ds-pending', sp.id), 'NOT_APPROVED');

  const draft = await h.db.call('dropship_create_supplier_product', {
    p_actor: supplier, p_actor_role: 'supplier', p_supplier_id: supplier, p_fields: productFields(),
    p_submit: true, p_client_request_id: crypto.randomUUID(), p_reason: null,
  });
  await expectCode(createListing(dropshipper, draft.product.id), 'STATE_CONFLICT');
  await expectCode(createListing(dropshipper, sp.id, 10099), 'PRICE_INVALID');
  await expectCode(createListing(dropshipper, crypto.randomUUID()), 'NOT_FOUND');
  assert.equal((await createListing(dropshipper, sp.id, 10100)).created, true);
});

test('update price and pause', async () => {
  const { dropshipper, sp } = await scenario('upd');
  await approvedDropshipper('ds-upd-other');
  const r = await createListing(dropshipper, sp.id, 15000);
  const u1 = await updateListing(dropshipper, r.listing.id, 20000, null);
  assert.equal(u1.listing.retailPricePesewas, 20000);
  assert.equal((await mirror(r.productId)).price, '200');
  await updateListing(dropshipper, r.listing.id, 20050, null);
  assert.equal((await mirror(r.productId)).price, '200.5');
  await expectCode(updateListing(dropshipper, r.listing.id, 10099, null), 'PRICE_INVALID');
  await expectCode(updateListing(dropshipper, r.listing.id, null, 'removed'), 'VALIDATION');
  await expectCode(updateListing('ds-upd-other', r.listing.id, 20000, null), 'NOT_FOUND');

  const p = await updateListing(dropshipper, r.listing.id, null, 'paused');
  assert.equal(p.listing.status, 'paused');
  assert.equal(p.listing.retailPricePesewas, 20050);
  assert.deepEqual(await availability(r.listing.id), { is_available: false, unavailable_reason: 'listing_paused' });
  const hidden = await h.db.call('dropship_hidden_product_ids', {});
  assert.ok(hidden.hidden.includes(r.productId));
  assert.equal(hidden.supplierProductOf[r.productId], sp.id);

  await updateListing(dropshipper, r.listing.id, null, 'active');
  assert.deepEqual(await availability(r.listing.id), { is_available: true, unavailable_reason: null });
  const shown = await h.db.call('dropship_hidden_product_ids', {});
  assert.ok(!shown.hidden.includes(r.productId));
  assert.equal(shown.supplierProductOf[r.productId], sp.id);

  await expectCode(updateListing('admin1', r.listing.id, null, 'paused', 'admin', null), 'VALIDATION');
  assert.equal((await updateListing('admin1', r.listing.id, null, 'paused', 'admin', 'reported listing')).listing.status, 'paused');
});

test('remove listing', async () => {
  const { dropshipper, sp } = await scenario('rm');
  const r = await createListing(dropshipper, sp.id, 15000);
  const rm = await removeListing(dropshipper, r.listing.id);
  assert.equal(rm.listing.status, 'removed');
  assert.equal(rm.listing.productId, null);
  assert.ok(rm.listing.removedAt);
  assert.equal(await mirror(r.productId), undefined);
  const row = (await h.pg.query<any>('select status, product_id, removed_at from public.dropship_listings where id = $1', [r.listing.id])).rows[0];
  assert.equal(row.status, 'removed');
  assert.equal(row.product_id, null);
  assert.ok(row.removed_at);
  const protectedUrls = await h.db.call('dropship_is_protected_media', { p_urls: [IMG, 'https://res.cloudinary.com/dfm3g2qvg/image/upload/v1/tedbuy_products/unrelated.jpg'] });
  assert.deepEqual(protectedUrls, [IMG]);
  await expectCode(updateListing(dropshipper, r.listing.id, 16000, null), 'STATE_CONFLICT');
  // Removing again is a no-op.
  assert.equal((await removeListing(dropshipper, r.listing.id)).listing.status, 'removed');
  // A removed listing frees the slot: the dropshipper can list the product again.
  assert.equal((await createListing(dropshipper, sp.id)).created, true);
});

test('content fan-out', async () => {
  const { supplier, dropshipper, sp } = await scenario('fan');
  await approvedDropshipper('ds-fan-2');
  const a = await createListing(dropshipper, sp.id);
  const b = await createListing('ds-fan-2', sp.id);
  await h.db.call('dropship_update_supplier_product', {
    p_actor: supplier, p_actor_role: 'supplier', p_id: sp.id,
    p_fields: { title: 'Bluetooth speaker X3', images: [IMG2, IMG], brand: 'Sonix Pro' },
    p_expected_content_version: sp.contentVersion, p_reason: null,
  });
  for (const pid of [a.productId, b.productId]) {
    const row = await mirror(pid);
    assert.equal(row.title, 'Bluetooth speaker X3');
    assert.deepEqual(row.images, [IMG2, IMG]);
    assert.equal(row.brand, 'Sonix Pro');
    assert.equal(row.price, '150', 'price is not content');
  }
});

test('availability reasons', async () => {
  const { supplier, dropshipper, sp } = await scenario('av');
  const r = await createListing(dropshipper, sp.id, 15000);
  const id = r.listing.id;
  const ok = { is_available: true, unavailable_reason: null };
  const down = (reason: string) => ({ is_available: false, unavailable_reason: reason });
  assert.deepEqual(await availability(id), ok);

  const stock = (n: number) => h.db.call('dropship_set_stock', { p_actor: supplier, p_actor_role: 'supplier', p_id: sp.id, p_new_on_hand: n, p_expected_on_hand: null, p_reason: null });
  await stock(0);
  assert.deepEqual(await availability(id), down('out_of_stock'));
  await stock(5);
  assert.deepEqual(await availability(id), ok);

  const status = (s: string) => h.db.call('dropship_set_supplier_product_status', { p_actor: supplier, p_actor_role: 'supplier', p_id: sp.id, p_status: s, p_reason: null });
  await status('paused');
  assert.deepEqual(await availability(id), down('product_inactive'));
  await status('active');
  assert.deepEqual(await availability(id), ok);

  for (const [user, kind] of [[supplier, 'supplier'], [dropshipper, 'dropshipper']]) {
    for (const s of ['suspended', 'revoked']) {
      await h.pg.query('update public.dropship_participants set status = $1 where user_id = $2 and kind = $3', [s, user, kind]);
      assert.deepEqual(await availability(id), down('participant_unavailable'), `${kind} ${s}`);
      await h.pg.query("update public.dropship_participants set status = 'approved' where user_id = $1 and kind = $2", [user, kind]);
    }
    for (const flag of ['isSuspended', 'securityHold', 'isDeleted']) {
      await h.pg.query(`update public.users set "${flag}" = true where id = $1`, [user]);
      assert.deepEqual(await availability(id), down('participant_unavailable'), `${kind} ${flag}`);
      await h.pg.query(`update public.users set "${flag}" = false where id = $1`, [user]);
    }
  }
  assert.deepEqual(await availability(id), ok);

  const current = (await h.db.call('dropship_list_supplier_products', { p_supplier_id: supplier, p_status: null, p_limit: 10 }))[0];
  await h.db.call('dropship_update_supplier_product', {
    p_actor: supplier, p_actor_role: 'supplier', p_id: sp.id, p_fields: { wholesalePricePesewas: 15000 },
    p_expected_content_version: current.contentVersion, p_reason: null,
  });
  assert.deepEqual(await availability(id), down('price_below_minimum'));
  await updateListing(dropshipper, id, 15100, null);
  assert.deepEqual(await availability(id), ok);

  await status('archived');
  assert.deepEqual(await availability(id), down('product_inactive'));
});

test('catalogue projections', async () => {
  const cat = 'Catalogue Test Category';
  const { supplier, dropshipper, sp } = await scenario('cat', { category: cat });
  const sp2 = await activeProduct(supplier, { category: cat, title: 'Second catalogue item' });
  const sp3 = await activeProduct(supplier, { category: cat, title: 'Out of stock item', stockOnHand: 0 });
  const hidden = await h.db.call('dropship_create_supplier_product', {
    p_actor: supplier, p_actor_role: 'supplier', p_supplier_id: supplier, p_fields: productFields({ category: cat }),
    p_submit: true, p_client_request_id: crypto.randomUUID(), p_reason: null,
  }); // pending_review: not in the catalogue
  await createListing(dropshipper, sp.id);
  await ensureUser('teaser-user');

  const page = (viewer: string, afterCreated: string | null = null, afterId: string | null = null, limit = 50, q: string | null = null) =>
    h.db.call('dropship_catalogue', { p_viewer: viewer, p_category: cat, p_q: q, p_after_created: afterCreated, p_after_id: afterId, p_limit: limit });

  const full = await page(dropshipper);
  assert.deepEqual(full.items.map((i: any) => i.supplierProductId), [sp3.id, sp2.id, sp.id], 'newest first; pending products excluded');
  assert.ok(!full.items.some((i: any) => i.supplierProductId === hidden.product.id));
  const item = full.items.find((i: any) => i.supplierProductId === sp.id);
  assert.equal(item.wholesalePricePesewas, W);
  assert.equal(item.minRetailPesewas, 10100);
  assert.equal(item.alreadyListed, true);
  assert.equal(item.listingCount, 1);
  assert.equal(item.available, true);
  assert.equal(full.items.find((i: any) => i.supplierProductId === sp3.id).available, false, 'out of stock is listed, not hidden');
  assert.equal(full.items.find((i: any) => i.supplierProductId === sp2.id).alreadyListed, false);

  const teaser = await page('teaser-user');
  assert.equal(teaser.items.length, 3);
  for (const i of teaser.items) assert.deepEqual(Object.keys(i).sort(), ['category', 'images', 'supplierProductId', 'title']);

  for (const body of [full, teaser]) {
    const text = JSON.stringify(body);
    assert.ok(!text.includes('supplierId'), 'no supplierId key');
    assert.ok(!text.includes(supplier), 'no supplier uid');
    assert.ok(!text.includes('Kofi Supplies'), 'no supplier name');
    assert.ok(!text.includes('0241234567'), 'no supplier contact');
  }

  const p1 = await page(dropshipper, null, null, 2);
  assert.deepEqual(p1.items.map((i: any) => i.supplierProductId), [sp3.id, sp2.id]);
  assert.ok(p1.nextCursor);
  const p2 = await page(dropshipper, p1.nextCursor.afterCreated, p1.nextCursor.afterId, 2);
  assert.deepEqual(p2.items.map((i: any) => i.supplierProductId), [sp.id]);
  assert.equal(p2.nextCursor, null);

  const searched = await page(dropshipper, null, null, 50, 'second');
  assert.deepEqual(searched.items.map((i: any) => i.supplierProductId), [sp2.id]);

  // Products of a suspended supplier leave the catalogue.
  await h.pg.query(`update public.users set "isSuspended" = true where id = $1`, [supplier]);
  assert.equal((await page(dropshipper)).items.length, 0);
  await h.pg.query(`update public.users set "isSuspended" = false where id = $1`, [supplier]);
});

test('purchase-info projection', async () => {
  const { dropshipper, supplier, sp } = await scenario('pi');
  const r = await createListing(dropshipper, sp.id, 15000);
  const info = await h.db.call('dropship_purchase_info', { p_product_id: r.productId });
  assert.deepEqual(Object.keys(info).sort(), ['available', 'deliveryFees', 'leadTimeDays', 'listingId', 'maxQuantity', 'returnPolicyText',
    'returnWindowDays', 'seller', 'shipsFromRegion', 'unitPricePesewas'].sort());
  assert.equal(info.listingId, r.listing.id);
  assert.equal(info.available, true);
  assert.equal(info.unitPricePesewas, 15000);
  assert.equal(info.maxQuantity, 3);
  assert.deepEqual(info.leadTimeDays, { min: 1, max: 3 });
  assert.equal(info.returnWindowDays, 3);
  assert.equal(info.returnPolicyText, 'Report damaged or wrong items within 3 days of delivery. Report a missing delivery until your order is settled.');
  assert.equal(info.shipsFromRegion, 'Greater Accra');
  assert.deepEqual(info.seller, { id: dropshipper, storeName: `${dropshipper} Store` });
  assert.deepEqual(info.deliveryFees.map((f: any) => [f.scope, f.feePesewas]), [['same_region', 1500], ['other_region', 3000]]);
  const text = JSON.stringify(info);
  assert.ok(!text.includes(supplier) && !text.includes('Kofi Supplies') && !text.includes('0241234567'), 'no supplier identity');

  await updateListing(dropshipper, r.listing.id, null, 'paused');
  const paused = await h.db.call('dropship_purchase_info', { p_product_id: r.productId });
  assert.deepEqual(Object.keys(paused).sort(), ['available', 'deliveryFees', 'leadTimeDays', 'listingId', 'maxQuantity', 'returnPolicyText',
    'returnWindowDays', 'seller', 'shipsFromRegion', 'unavailableReason', 'unitPricePesewas'].sort());
  assert.equal(paused.available, false);
  assert.equal(paused.unavailableReason, 'unavailable');
  assert.equal(paused.maxQuantity, 0);
  await updateListing(dropshipper, r.listing.id, null, 'active');

  await h.db.call('dropship_set_stock', { p_actor: supplier, p_actor_role: 'supplier', p_id: sp.id, p_new_on_hand: 0, p_expected_on_hand: null, p_reason: null });
  assert.equal((await h.db.call('dropship_purchase_info', { p_product_id: r.productId })).unavailableReason, 'out_of_stock');

  assert.equal(await h.db.call('dropship_purchase_info', { p_product_id: 'not-a-listing' }), null);
  await removeListing(dropshipper, r.listing.id);
  assert.equal(await h.db.call('dropship_purchase_info', { p_product_id: r.productId }), null);
});

test('list my listings shows the precise reason', async () => {
  const { dropshipper, sp } = await scenario('mine');
  const r = await createListing(dropshipper, sp.id, 15000);
  await updateListing(dropshipper, r.listing.id, null, 'paused');
  const mine = await h.db.call('dropship_list_my_listings', { p_actor: dropshipper });
  assert.equal(mine.listings.length, 1);
  const l = mine.listings[0];
  assert.equal(l.id, r.listing.id);
  assert.equal(l.productId, r.productId);
  assert.equal(l.title, sp.title);
  assert.equal(l.image, IMG);
  assert.equal(l.retailPricePesewas, 15000);
  assert.equal(l.wholesalePricePesewas, W);
  assert.equal(l.estimatedMarginPesewas, 5000);
  assert.equal(l.status, 'paused');
  assert.equal(l.effectiveAvailable, false);
  assert.equal(l.unavailableReason, 'listing_paused');
  assert.ok(!JSON.stringify(mine).includes('supplierId'));
});

test('remove user listings', async () => {
  await approvedSupplier('sup-del');
  const spA = await activeProduct('sup-del');
  const spB = await activeProduct('sup-del');
  // The user being deleted is both a dropshipper and a supplier.
  await approvedDropshipper('user-del');
  await approvedSupplier('user-del');
  const own1 = await activeProduct('user-del');
  const own2 = await activeProduct('user-del');
  await approvedDropshipper('ds-del-other');
  const otherOnOwn = await createListing('ds-del-other', own1.id);
  const a = await createListing('user-del', spA.id);
  const b = await createListing('user-del', spB.id);

  const n = await h.db.call('dropship_remove_user_listings', { p_user: 'user-del', p_reason: 'account deleted' });
  assert.equal(n, 2);
  for (const l of [a, b]) {
    const row = (await h.pg.query<any>('select status, product_id from public.dropship_listings where id = $1', [l.listing.id])).rows[0];
    assert.deepEqual(row, { status: 'removed', product_id: null });
    assert.equal(await mirror(l.productId), undefined);
  }
  const own = await h.pg.query<any>('select status from public.dropship_supplier_products where id = any($1::uuid[])', [[own1.id, own2.id]]);
  assert.deepEqual(own.rows.map(r => r.status), ['archived', 'archived']);
  // Another dropshipper's listing of the archived product stays, but is unavailable.
  assert.deepEqual(await availability(otherOnOwn.listing.id), { is_available: false, unavailable_reason: 'product_inactive' });
  assert.equal(await h.db.call('dropship_remove_user_listings', { p_user: 'user-del', p_reason: 'account deleted' }), 0);
});

test('one live listing per dropshipper and product', async () => {
  const { dropshipper, sp } = await scenario('uniq');
  const ins = `insert into public.dropship_listings (supplier_product_id, dropshipper_id, retail_price_pesewas, status) values ($1, $2, 15000, $3)`;
  await h.pg.query(ins, [sp.id, dropshipper, 'removed']);
  await h.pg.query(ins, [sp.id, dropshipper, 'active']);
  await assert.rejects(h.pg.query(ins, [sp.id, dropshipper, 'paused']),
    (e: any) => e.code === '23505' && /dl_one_live_per_dropshipper/.test(e.message));
});

test('dropshipper applications open', async () => {
  await ensureUser('ds-apply');
  const r = await h.db.call('dropship_submit_application', { p_user: 'ds-apply', p_kind: 'dropshipper', p_fields: dropshipperApplication('apply'), p_client_request_id: crypto.randomUUID() });
  assert.equal(r.created, true);
  assert.equal(r.participant.kind, 'dropshipper');
  assert.equal(r.participant.addressLine, null);
  await ensureUser('sup-noaddr');
  const { addressLine: _omit, ...noAddress } = supplierApplication;
  await expectCode(h.db.call('dropship_submit_application', { p_user: 'sup-noaddr', p_kind: 'supplier', p_fields: noAddress, p_client_request_id: crypto.randomUUID() }), 'VALIDATION');
  await expectCode(h.db.call('dropship_submit_application', { p_user: 'ds-apply', p_kind: 'reseller', p_fields: noAddress, p_client_request_id: crypto.randomUUID() }), 'VALIDATION');
});

test('anon and authenticated cannot read listings or the availability view, or execute the new functions', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const sql of ['select * from public.dropship_listings', 'select * from public.dropship_listing_availability',
      'select public.dropship_pricing_config()', "select public.dropship_purchase_info('x')"]) {
      await assert.rejects(
        h.pg.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.query(sql); }),
        (e: any) => e.code === '42501',
        `${role} must get permission denied for: ${sql}`,
      );
    }
  }
  const rls = await h.pg.query<any>("select relrowsecurity from pg_class where relname = 'dropship_listings'");
  assert.equal(rls.rows[0].relrowsecurity, true);
  const view = await h.pg.query<any>("select reloptions from pg_class where relname = 'dropship_listing_availability'");
  assert.ok(String(view.rows[0].reloptions).includes('security_invoker=true'));
});

test('lock modes: the listings migration never takes FOR UPDATE explicitly', async () => {
  const sql = fs.readFileSync(LISTINGS_MIGRATION_PATH, 'utf8').replace(/--.*$/gm, '');
  assert.doesNotMatch(sql, /for\s+update/i);
  assert.match(sql, /for no key update/i);
  assert.match(sql, /for share/i);
});
