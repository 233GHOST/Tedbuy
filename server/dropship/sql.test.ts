import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { DropshipError } from './errors.js';
import { createPgliteDropship, MIGRATION_PATH, type PgliteDropship } from './testing/pgliteDb.js';

// Runs the real migration on an in-process PostgreSQL 17 (PGlite) and calls the functions
// as service_role. Single connection: these tests cover behaviour, grants and lock-mode
// design rules, not concurrent interleavings.

let h: PgliteDropship;
const IMG = 'https://res.cloudinary.com/dfm3g2qvg/image/upload/v1/tedbuy_products/abc.jpg';

const product = (over: Record<string, unknown> = {}) => ({
  title: 'Rice cooker 1.8L', description: 'Non-stick rice cooker, 700W, keeps warm.', category: 'Home Appliances',
  images: [IMG], wholesalePricePesewas: 25000, suggestedRetailPesewas: 32000, stockOnHand: 10,
  shipsFromRegion: 'Greater Accra', shipsFromCity: 'Accra', deliveryFeeSameRegionPesewas: 1500,
  leadTimeMinDays: 1, leadTimeMaxDays: 3, ...over,
});

const application = {
  displayName: 'Kofi Supplies', contactPhone: '0241234567', region: 'Greater Accra', city: 'Accra',
  addressLine: '12 Ring Road, Osu', termsVersion: 'supplier-2026-10',
};

async function expectCode(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof DropshipError && e.code === code ? true : (assert.fail(`expected ${code}, got ${(e as any)?.code}: ${(e as any)?.message}`), false));
}

async function approvedSupplier(id: string) {
  await h.addUser(id);
  const app = await h.db.call('dropship_submit_application', { p_user: id, p_kind: 'supplier', p_fields: application, p_client_request_id: crypto.randomUUID() });
  await h.db.call('dropship_admin_decide_participation', { p_admin: 'admin1', p_participant_id: app.participant.id, p_decision: 'approve', p_reason: null, p_notes: null, p_expected_status: 'pending' });
  return app.participant.id as string;
}

async function createProduct(supplier: string, submit = true, over = {}) {
  const r = await h.db.call('dropship_create_supplier_product', {
    p_actor: supplier, p_actor_role: 'supplier', p_supplier_id: supplier, p_fields: product(over),
    p_submit: submit, p_client_request_id: crypto.randomUUID(), p_reason: null,
  });
  return r.product;
}

before(async () => { h = await createPgliteDropship(); });
after(async () => { await h.close(); });

test('anon and authenticated cannot read tables or execute functions; service_role can', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const sql of ['select * from public.dropship_participants', "select public.dropship_get_participations('x')"]) {
      await assert.rejects(
        h.pg.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.query(sql); }),
        (e: any) => e.code === '42501',
        `${role} must get permission denied for: ${sql}`,
      );
    }
  }
  const r = await h.db.call('dropship_get_participations', { p_user: 'nobody' });
  assert.deepEqual(r, {});
  const rls = await h.pg.query<any>("select relname from pg_class where relname like 'dropship\\_%' and relkind = 'r' and not relrowsecurity");
  assert.deepEqual(rls.rows, [], 'RLS must be enabled on every Dropship table');
});

test('application: pending, idempotent replay, admin decisions follow the state machine', async () => {
  await h.addUser('sup-app');
  const reqId = crypto.randomUUID();
  const a = await h.db.call('dropship_submit_application', { p_user: 'sup-app', p_kind: 'supplier', p_fields: application, p_client_request_id: reqId });
  assert.equal(a.created, true);
  assert.equal(a.participant.status, 'pending');
  const replay = await h.db.call('dropship_submit_application', { p_user: 'sup-app', p_kind: 'supplier', p_fields: application, p_client_request_id: reqId });
  assert.equal(replay.participant.id, a.participant.id);

  await expectCode(h.db.call('dropship_submit_application', { p_user: 'sup-app', p_kind: 'reseller', p_fields: application, p_client_request_id: crypto.randomUUID() }), 'VALIDATION');
  await expectCode(h.db.call('dropship_submit_application', { p_user: 'missing-user', p_kind: 'supplier', p_fields: application, p_client_request_id: crypto.randomUUID() }), 'NOT_FOUND');

  const decide = (decision: string, expected: string, reason: string | null = 'checked by phone') =>
    h.db.call('dropship_admin_decide_participation', { p_admin: 'admin1', p_participant_id: a.participant.id, p_decision: decision, p_reason: reason, p_notes: null, p_expected_status: expected });

  await expectCode(decide('approve', 'approved'), 'STATE_CONFLICT');       // stale expected status
  await expectCode(decide('suspend', 'pending'), 'STATE_CONFLICT');        // not allowed from pending
  await expectCode(decide('reject', 'pending', null), 'VALIDATION');       // reason required
  assert.equal((await decide('approve', 'pending', null)).participant.status, 'approved');
  assert.equal((await decide('suspend', 'approved')).participant.status, 'suspended');
  assert.equal((await decide('reinstate', 'suspended')).participant.status, 'approved');

  // An approved participation can't be overwritten by a new application.
  await expectCode(h.db.call('dropship_submit_application', { p_user: 'sup-app', p_kind: 'supplier', p_fields: application, p_client_request_id: crypto.randomUUID() }), 'STATE_CONFLICT');

  const audit = await h.pg.query<any>("select action from public.dropship_audit_events where target_id = $1 order by id", [a.participant.id]);
  assert.deepEqual(audit.rows.map(r => r.action), ['application_submitted', 'participation_approve', 'participation_suspend', 'participation_reinstate']);
});

test('only approved suppliers create products; suppliers only for themselves; replay is idempotent', async () => {
  await h.addUser('sup-pending');
  await h.db.call('dropship_submit_application', { p_user: 'sup-pending', p_kind: 'supplier', p_fields: application, p_client_request_id: crypto.randomUUID() });
  await expectCode(createProduct('sup-pending'), 'NOT_APPROVED');
  await expectCode(createProduct('no-participation-user'), 'NOT_APPROVED');

  await approvedSupplier('sup-a');
  await expectCode(h.db.call('dropship_create_supplier_product', {
    p_actor: 'sup-a', p_actor_role: 'supplier', p_supplier_id: 'sup-pending', p_fields: product(),
    p_submit: true, p_client_request_id: crypto.randomUUID(), p_reason: null,
  }), 'FORBIDDEN');

  const reqId = crypto.randomUUID();
  const args = { p_actor: 'sup-a', p_actor_role: 'supplier', p_supplier_id: 'sup-a', p_fields: product(), p_submit: false, p_client_request_id: reqId, p_reason: null };
  const first = await h.db.call('dropship_create_supplier_product', args);
  const second = await h.db.call('dropship_create_supplier_product', args);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.product.id, first.product.id);
  assert.equal(first.product.status, 'draft');
  const ev = await h.pg.query<any>('select count(*)::int as n from public.dropship_stock_events where supplier_product_id = $1', [first.product.id]);
  assert.equal(ev.rows[0].n, 1, 'one initial stock event, not one per replay');

  // Admin on behalf needs a reason.
  await expectCode(h.db.call('dropship_create_supplier_product', { ...args, p_actor: 'admin1', p_actor_role: 'admin', p_client_request_id: crypto.randomUUID() }), 'VALIDATION');
  const byAdmin = await h.db.call('dropship_create_supplier_product', { ...args, p_actor: 'admin1', p_actor_role: 'admin', p_client_request_id: crypto.randomUUID(), p_reason: 'entered from supplier price list' });
  assert.equal(byAdmin.product.supplierId, 'sup-a');
});

test('the database rejects invalid prices, stock and images even if Node validation is bypassed', async () => {
  await approvedSupplier('sup-v');
  await expectCode(createProduct('sup-v', true, { wholesalePricePesewas: 0 }), 'VALIDATION');
  await expectCode(createProduct('sup-v', true, { wholesalePricePesewas: -5 }), 'VALIDATION');
  await expectCode(createProduct('sup-v', true, { suggestedRetailPesewas: 100 }), 'VALIDATION');
  await expectCode(createProduct('sup-v', true, { stockOnHand: -1 }), 'VALIDATION');
  await expectCode(createProduct('sup-v', true, { wholesalePricePesewas: 'abc' }), 'VALIDATION');
  await expectCode(createProduct('sup-v', true, { images: ['https://evil.example/x.jpg'] }), 'VALIDATION');
  await expectCode(createProduct('sup-v', true, { images: [] }), 'VALIDATION');
  await expectCode(createProduct('sup-v', true, { leadTimeMinDays: 5, leadTimeMaxDays: 2 }), 'VALIDATION');
  await expectCode(createProduct('sup-v', true, { title: 'ab' }), 'VALIDATION');
});

test('suspended suppliers are fulfilment-only: no product creation, edits or stock changes', async () => {
  const pid = await approvedSupplier('sup-s');
  const p = await createProduct('sup-s');
  await h.db.call('dropship_admin_decide_participation', { p_admin: 'admin1', p_participant_id: pid, p_decision: 'suspend', p_reason: 'late deliveries', p_notes: null, p_expected_status: 'approved' });
  await expectCode(createProduct('sup-s'), 'FULFILMENT_ONLY');
  await expectCode(h.db.call('dropship_update_supplier_product', { p_actor: 'sup-s', p_actor_role: 'supplier', p_id: p.id, p_fields: { title: 'New title here' }, p_expected_content_version: 1, p_reason: null }), 'FULFILMENT_ONLY');
  await expectCode(h.db.call('dropship_set_stock', { p_actor: 'sup-s', p_actor_role: 'supplier', p_id: p.id, p_new_on_hand: 3, p_expected_on_hand: null, p_reason: null }), 'FULFILMENT_ONLY');
});

test('updates: ownership, content-version compare-and-set, price version bump', async () => {
  await approvedSupplier('sup-u');
  await approvedSupplier('sup-other');
  const p = await createProduct('sup-u');
  const upd = (actor: string, fields: object, version: number) =>
    h.db.call('dropship_update_supplier_product', { p_actor: actor, p_actor_role: 'supplier', p_id: p.id, p_fields: fields, p_expected_content_version: version, p_reason: null });

  await expectCode(upd('sup-other', { title: 'Hijacked title' }, 1), 'NOT_FOUND');
  const r1 = await upd('sup-u', { title: 'Rice cooker 1.8L (white)' }, 1);
  assert.equal(r1.product.contentVersion, 2);
  assert.equal(r1.product.priceVersion, 1);
  await expectCode(upd('sup-u', { title: 'Stale edit title' }, 1), 'STATE_CONFLICT');
  const r2 = await upd('sup-u', { wholesalePricePesewas: 26000 }, 2);
  assert.equal(r2.product.priceVersion, 2);
  assert.equal(r2.product.wholesalePricePesewas, 26000);
  await expectCode(upd('sup-u', { wholesalePricePesewas: 40000 }, 3), 'VALIDATION'); // above suggested retail 32000
});

test('stock: compare-and-set, never below reserved, every change recorded; admin needs a reason', async () => {
  await approvedSupplier('sup-k');
  const p = await createProduct('sup-k');
  const set = (n: number, expected: number | null, role = 'supplier', actor = 'sup-k', reason: string | null = null) =>
    h.db.call('dropship_set_stock', { p_actor: actor, p_actor_role: role, p_id: p.id, p_new_on_hand: n, p_expected_on_hand: expected, p_reason: reason });

  assert.equal((await set(7, 10)).product.stockOnHand, 7);
  await expectCode(set(5, 10), 'STATE_CONFLICT');
  await expectCode(set(-1, null), 'VALIDATION');

  await h.pg.query('update public.dropship_supplier_products set stock_reserved = 4 where id = $1', [p.id]); // simulate reservations
  await expectCode(set(3, null), 'VALIDATION');
  assert.equal((await set(4, null)).product.stockAvailable, 0);

  await expectCode(set(20, 4, 'admin', 'admin1', null), 'VALIDATION');
  assert.equal((await set(20, 4, 'admin', 'admin1', 'stock count after audit')).product.stockOnHand, 20);

  const ev = await h.pg.query<any>('select delta_on_hand, on_hand_after from public.dropship_stock_events where supplier_product_id = $1 order by id', [p.id]);
  assert.deepEqual(ev.rows.map(r => [r.delta_on_hand, r.on_hand_after]), [[10, 10], [-3, 7], [-3, 4], [16, 20]]);
});

test('status and moderation transitions', async () => {
  await approvedSupplier('sup-m');
  const p = await createProduct('sup-m', false); // draft
  const status = (s: string) => h.db.call('dropship_set_supplier_product_status', { p_actor: 'sup-m', p_actor_role: 'supplier', p_id: p.id, p_status: s, p_reason: null });
  const moderate = (d: string, reason: string | null = 'blurry photos') => h.db.call('dropship_admin_moderate_supplier_product', { p_admin: 'admin1', p_id: p.id, p_decision: d, p_reason: reason });

  await expectCode(status('active'), 'STATE_CONFLICT');          // never approved
  await expectCode(moderate('approve', null), 'STATE_CONFLICT'); // drafts aren't reviewed
  assert.equal((await status('pending_review')).product.status, 'pending_review');
  await expectCode(moderate('reject', null), 'VALIDATION');
  assert.equal((await moderate('reject')).product.status, 'rejected');
  assert.equal((await status('pending_review')).product.status, 'pending_review');
  const approved = await moderate('approve', null);
  assert.equal(approved.product.status, 'active');
  assert.ok(approved.product.publishedAt);
  assert.equal((await status('paused')).product.status, 'paused');
  assert.equal((await status('active')).product.status, 'active');
  assert.equal((await status('archived')).product.status, 'archived');
  await expectCode(status('active'), 'STATE_CONFLICT');
  await expectCode(h.db.call('dropship_update_supplier_product', { p_actor: 'sup-m', p_actor_role: 'supplier', p_id: p.id, p_fields: { title: 'After archive' }, p_expected_content_version: 1, p_reason: null }), 'STATE_CONFLICT');
});

test('revocation returns the supplier products to archive; admin can archive them afterwards', async () => {
  const pid = await approvedSupplier('sup-r');
  const p1 = await createProduct('sup-r');
  const p2 = await createProduct('sup-r');
  const r = await h.db.call('dropship_admin_decide_participation', { p_admin: 'admin1', p_participant_id: pid, p_decision: 'revoke', p_reason: 'fraud report', p_notes: null, p_expected_status: 'approved' });
  assert.equal(r.participant.status, 'revoked');
  assert.deepEqual([...r.supplierProductsToArchive].sort(), [p1.id, p2.id].sort());
  const a = await h.db.call('dropship_set_supplier_product_status', { p_actor: 'admin1', p_actor_role: 'admin', p_id: p1.id, p_status: 'archived', p_reason: 'revoked' });
  assert.equal(a.product.status, 'archived');
  await expectCode(createProduct('sup-r'), 'NOT_APPROVED');
});

test('stock and audit events are append-only', async () => {
  await assert.rejects(h.pg.query('update public.dropship_stock_events set delta_on_hand = 0'), /append-only/);
  await assert.rejects(h.pg.query('delete from public.dropship_audit_events'), /append-only/);
});

// Self-audit F1: an UPDATE that changes a column of a non-partial unique index takes a
// FOR UPDATE row lock, which conflicts with foreign-key checks. No function in this
// migration may update such a column.
test('no function updates a column of a non-partial unique index (implicit FOR UPDATE)', async () => {
  const keyCols = await h.pg.query<{ rel: string; col: string }>(`
    select distinct c.relname as rel, a.attname as col
      from pg_index i
      join pg_class c on c.oid = i.indrelid
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any (i.indkey)
     where c.relname like 'dropship\\_%' and i.indisunique and i.indpred is null and i.indexprs is null`);
  const keys = new Map<string, Set<string>>();
  for (const r of keyCols.rows) keys.set(r.rel, (keys.get(r.rel) ?? new Set()).add(r.col));
  assert.ok(keys.get('dropship_supplier_products')?.has('client_request_id'), 'expected key columns found');
  assert.ok(keys.get('dropship_participants')?.has('user_id'), 'expected key columns found');

  const keyAssignments = (sql: string) =>
    [...sql.matchAll(/update public\.(dropship_\w+)\s+set\s+([\s\S]*?)\n?\s*where /gi)].map(m => {
      const tableKeys = keys.get(m[1]) ?? new Set<string>();
      const assigned = [...m[2].matchAll(/(?:^|,)\s*([a-z_]+)\s*=/g)].map(x => x[1]);
      return { table: m[1], bad: assigned.filter(c => tableKeys.has(c)) };
    });

  // Negative control: the check must flag a statement that does assign a key column.
  const control = keyAssignments('update public.dropship_supplier_products set title = $1, client_request_id = $2 where id = $3');
  assert.deepEqual(control, [{ table: 'dropship_supplier_products', bad: ['client_request_id'] }]);

  const found = keyAssignments(fs.readFileSync(MIGRATION_PATH, 'utf8'));
  assert.ok(found.length >= 8, `found ${found.length} UPDATE statements`);
  for (const f of found) assert.deepEqual(f.bad, [], `UPDATE of ${f.table} assigns key column(s): ${f.bad.join(', ')}`);
});
