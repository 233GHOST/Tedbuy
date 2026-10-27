import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { BASELINE_PRODUCTS_TABLE, LISTINGS_MIGRATION_PATH, MIGRATION_PATH } from './testing/pgliteDb.js';

// Phase 3 listings migration: Phase 2 up -> Phase 3 up -> Phase 3 down -> Phase 3 up, on a
// fresh in-process PostgreSQL 17 (PGlite). Checks that the rollback restores the exact
// post-Phase-2 schema (including the two replaced functions and the audit check), deletes
// the mirror rows but no legacy row, refuses without confirmation, refuses when something
// unexpected depends on the new objects, and leaves the Phase 2 rollback runnable.

const ROLLBACKS = path.resolve(path.dirname(MIGRATION_PATH), '../rollbacks');
const DOWN = fs.readFileSync(path.join(ROLLBACKS, '20261028120000_dropship_listings.down.sql'), 'utf8');
const PHASE2_DOWN = fs.readFileSync(path.join(ROLLBACKS, '20261026120000_dropship_supplier_catalogue.down.sql'), 'utf8');
const PHASE2_UP = fs.readFileSync(MIGRATION_PATH, 'utf8');
const UP = fs.readFileSync(LISTINGS_MIGRATION_PATH, 'utf8');
const IMG = 'https://res.cloudinary.com/dfm3g2qvg/image/upload/v1/tedbuy_products/rb.jpg';

const PRE_EXISTING = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create table public.users (
    id text primary key, username text not null, "isSuspended" boolean default false,
    "securityHold" boolean default false, "isDeleted" boolean default false, status text default 'active');
  ${BASELINE_PRODUCTS_TABLE}
  grant select on public.users to service_role;
  grant select, insert, update, delete on public.products to service_role;
  insert into public.users (id, username) values ('sup', 'kofi'), ('ds', 'ama');
  insert into public.products (id, title) values ('p1', 'Legacy phone');
`;

let pg: PGlite;

async function snapshot() {
  const q = async (sql: string) => (await pg.query<{ x: string }>(sql)).rows.map(r => r.x);
  return {
    relations: await q(`select c.relkind::text || ' ' || c.relname as x from pg_class c join pg_namespace n on n.oid = c.relnamespace
                         where n.nspname = 'public' order by 1`),
    functions: await q(`select p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)) || ' ' || coalesce(p.proacl::text, '') as x
                          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' order by 1`),
    constraints: await q(`select conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(c.oid) as x
                            from pg_constraint c join pg_namespace n on n.oid = c.connamespace
                           where n.nspname = 'public' order by 1`),
    indexes: await q(`select indexrelid::regclass::text as x from pg_index i join pg_class c on c.oid = i.indrelid
                       join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' order by 1`),
    triggers: await q(`select tgrelid::regclass || ' ' || tgname || ' ' || tgenabled::text as x from pg_trigger where not tgisinternal order by 1`),
    acls: await q(`select c.relname || ' ' || coalesce(c.relacl::text, 'default') as x from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relkind in ('r','v') order by 1`),
    products: await q(`select id as x from public.products order by 1`),
  };
}

async function asService<T>(sql: string, params: unknown[]): Promise<T> {
  return pg.transaction(async tx => {
    await tx.exec('set local role service_role');
    return (await tx.query<{ r: T }>(sql, params)).rows[0].r;
  });
}

async function runDown(confirm: boolean) {
  await pg.exec(confirm ? "set dropship.rollback_confirm = 'DELETE-DROPSHIP-LISTINGS-DATA'" : 'reset dropship.rollback_confirm');
  try {
    await pg.exec(DOWN);
  } catch (err) {
    await pg.exec('rollback');
    throw err;
  } finally {
    await pg.exec('reset dropship.rollback_confirm');
  }
}

const count = async (sql: string) => Number((await pg.query<{ n: number }>(sql)).rows[0].n);

let afterPhase2: Awaited<ReturnType<typeof snapshot>>;
let listingProductId: string;

before(async () => {
  pg = new PGlite();
  await pg.exec(PRE_EXISTING);
  await pg.exec(PHASE2_UP);
  afterPhase2 = await snapshot();
});
after(async () => { await pg.close(); });

test('up migration applies on top of Phase 2 and works', async () => {
  await pg.exec(UP);
  const supApp = await asService<any>('select public.dropship_submit_application($1, $2, $3, $4) as r', ['sup', 'supplier',
    JSON.stringify({ displayName: 'Kofi Supplies', contactPhone: '0241234567', region: 'Greater Accra', city: 'Accra', addressLine: '12 Ring Road', termsVersion: 't1' }), crypto.randomUUID()]);
  const dsApp = await asService<any>('select public.dropship_submit_application($1, $2, $3, $4) as r', ['ds', 'dropshipper',
    JSON.stringify({ displayName: 'Ama Store', contactPhone: '0201234567', region: 'Ashanti', city: 'Kumasi', termsVersion: 't1' }), crypto.randomUUID()]);
  for (const app of [supApp, dsApp]) {
    await asService('select public.dropship_admin_decide_participation($1, $2, $3, null, null, $4) as r', ['admin1', app.participant.id, 'approve', 'pending']);
  }
  const sp = await asService<any>('select public.dropship_create_supplier_product($1, $2, $3, $4, true, $5, null) as r', ['sup', 'supplier', 'sup', JSON.stringify({
    title: 'Rice cooker 1.8L', description: 'Non-stick rice cooker, 700W.', category: 'Home', images: [IMG], wholesalePricePesewas: 10000,
    stockOnHand: 4, shipsFromRegion: 'Greater Accra', shipsFromCity: 'Accra', deliveryFeeSameRegionPesewas: 1500, leadTimeMinDays: 1, leadTimeMaxDays: 3,
  }), crypto.randomUUID()]);
  await asService('select public.dropship_admin_moderate_supplier_product($1, $2, $3, null) as r', ['admin1', sp.product.id, 'approve']);
  const l = await asService<any>('select public.dropship_create_listing($1, $2, $3, $4) as r', ['ds', sp.product.id, 15000, crypto.randomUUID()]);
  listingProductId = l.productId;
  assert.equal(await count(`select count(*)::int as n from public.products where id like 'dsl\\_%'`), 1);
  assert.equal(await count(`select count(*)::int as n from public.dropship_audit_events where target_type = 'listing'`), 1);
});

test('rollback refuses to run without explicit confirmation and changes nothing', async () => {
  await assert.rejects(runDown(false), /rollback refused/);
  assert.equal(await count('select count(*)::int as n from public.dropship_listings'), 1);
});

test('rollback aborts, changing nothing, when an unexpected object depends on the new objects', async () => {
  const cases: Array<[string, string, string, RegExp]> = [
    ['view', 'create view public.legacy_report as select id from public.dropship_listings', 'drop view public.legacy_report', /views or rules/],
    ['view on availability', 'create view public.legacy_avail as select * from public.dropship_listing_availability', 'drop view public.legacy_avail', /views or rules/],
    ['foreign key', 'create table public.other_table (l uuid references public.dropship_listings(id))', 'drop table public.other_table', /foreign keys from other tables/],
    ['extra function', "create function public.dropship_future() returns int language sql as 'select 1'", 'drop function public.dropship_future()', /expected functions/],
    ['RLS policy', 'create policy p_read on public.dropship_listings for select using (true)', 'drop policy p_read on public.dropship_listings', /RLS policies/],
    ['publication', 'create publication test_pub for table public.dropship_listings', 'drop publication test_pub', /published/],
  ];
  for (const [name, setup, teardown, expected] of cases) {
    await pg.exec(setup);
    await assert.rejects(runDown(true), expected, name);
    assert.equal(await count('select count(*)::int as n from public.dropship_listings'), 1, `${name}: nothing dropped`);
    await pg.exec(teardown);
  }
});

test('confirmed rollback restores the exact post-Phase-2 schema and deletes only Dropship listing data', async () => {
  await runDown(true);
  assert.deepEqual(await snapshot(), afterPhase2, 'schema, replaced functions, grants and legacy products are exactly as after Phase 2');
  assert.equal(await count(`select count(*)::int as n from public.products where id = '${listingProductId}'`), 0);
  assert.equal(await count(`select count(*)::int as n from public.dropship_audit_events where target_type = 'listing'`), 0);
  assert.equal(await count('select count(*)::int as n from public.dropship_supplier_products'), 1, 'supplier products kept');
  assert.equal(await count("select count(*)::int as n from public.dropship_participants where kind = 'dropshipper'"), 1, 'participations kept');
  // The restored Phase 2 application function rejects dropshipper applications again.
  await assert.rejects(asService('select public.dropship_submit_application($1, $2, $3, $4) as r', ['sup', 'dropshipper', '{}', crypto.randomUUID()]),
    /DS_VALIDATION/);
  await assert.rejects(pg.query('delete from public.dropship_audit_events'), /append-only/, 'append-only trigger is enabled again');
});

test('up migration applies again after the rollback, then both rollbacks run in order', async () => {
  await pg.exec(UP);
  assert.deepEqual(await asService('select public.dropship_pricing_config() as r', []), { platformFeeBps: 0, minMarginPesewas: 100, maxListingsPerSupplierProduct: 10 });
  await runDown(true);
  // Phase 2's rollback deletes its own audit rows (append-only trigger dropped with the table).
  await pg.exec("set dropship.rollback_confirm = 'DELETE-DROPSHIP-SUPPLIER-CATALOGUE-DATA'");
  await pg.exec(PHASE2_DOWN);
  await pg.exec('reset dropship.rollback_confirm');
  assert.equal(await count(`select count(*)::int as n from pg_proc where proname like 'dropship\\_%'`), 0);
  assert.deepEqual((await pg.query<any>('select id from public.products order by id')).rows, [{ id: 'p1' }]);
});
