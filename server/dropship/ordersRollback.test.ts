import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { BASELINE_PRODUCTS_TABLE, LISTINGS_MIGRATION_PATH, MIGRATION_PATH, ORDERS_MIGRATION_PATH } from './testing/pgliteDb.js';

// Phase 4 orders migration: Phases 2-3 up -> Phase 4 up (+ an order holding stock) -> Phase 4
// down -> exact post-Phase-3 schema, held stock given back -> Phase 4 up again -> all three
// rollbacks in order.

const ROLLBACKS = path.resolve(path.dirname(MIGRATION_PATH), '../rollbacks');
const DOWN = fs.readFileSync(path.join(ROLLBACKS, '20261031120000_dropship_orders.down.sql'), 'utf8');
const P3_DOWN = fs.readFileSync(path.join(ROLLBACKS, '20261028120000_dropship_listings.down.sql'), 'utf8');
const P2_DOWN = fs.readFileSync(path.join(ROLLBACKS, '20261026120000_dropship_supplier_catalogue.down.sql'), 'utf8');
const IMG = 'https://res.cloudinary.com/dfm3g2qvg/image/upload/v1/tedbuy_products/orb.jpg';

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
  insert into public.users (id, username) values ('sup', 'kofi'), ('ds', 'ama'), ('buyer', 'yaw');
  insert into public.products (id, title) values ('p1', 'Legacy phone');
`;

let pg: PGlite;
let afterPhase3: Awaited<ReturnType<typeof snapshot>>;
let spId: string;

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
    columns: await q(`select table_name || '.' || column_name || ' ' || data_type as x from information_schema.columns
                       where table_schema = 'public' order by 1`),
    indexes: await q(`select indexrelid::regclass::text as x from pg_index i join pg_class c on c.oid = i.indrelid
                       join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' order by 1`),
    triggers: await q(`select tgrelid::regclass || ' ' || tgname || ' ' || tgenabled::text as x from pg_trigger where not tgisinternal order by 1`),
    acls: await q(`select c.relname || ' ' || coalesce(c.relacl::text, 'default') as x from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relkind in ('r','v') order by 1`),
  };
}

async function asService<T>(sql: string, params: unknown[]): Promise<T> {
  return pg.transaction(async tx => {
    await tx.exec('set local role service_role');
    return (await tx.query<{ r: T }>(sql, params)).rows[0].r;
  });
}

async function runDown(sql: string, confirm: string | null) {
  await pg.exec(confirm ? `set dropship.rollback_confirm = '${confirm}'` : 'reset dropship.rollback_confirm');
  try {
    await pg.exec(sql);
  } catch (err) {
    await pg.exec('rollback');
    throw err;
  } finally {
    await pg.exec('reset dropship.rollback_confirm');
  }
}

const count = async (sql: string) => Number((await pg.query<{ n: number }>(sql)).rows[0].n);

before(async () => {
  pg = new PGlite();
  await pg.exec(PRE_EXISTING);
  await pg.exec(fs.readFileSync(MIGRATION_PATH, 'utf8'));
  await pg.exec(fs.readFileSync(LISTINGS_MIGRATION_PATH, 'utf8'));
  afterPhase3 = await snapshot();
});
after(async () => { await pg.close(); });

test('up migration applies on top of Phase 3; an order holds stock', async () => {
  await pg.exec(fs.readFileSync(ORDERS_MIGRATION_PATH, 'utf8'));
  for (const [user, kind, fields] of [
    ['sup', 'supplier', { displayName: 'Kofi Supplies', contactPhone: '0241234567', region: 'Greater Accra', city: 'Accra', addressLine: '12 Ring Road', termsVersion: 't1' }],
    ['ds', 'dropshipper', { displayName: 'Ama Store', contactPhone: '0201234567', region: 'Ashanti', city: 'Kumasi', termsVersion: 't1' }],
  ] as const) {
    const app = await asService<any>('select public.dropship_submit_application($1, $2, $3, $4) as r', [user, kind, JSON.stringify(fields), crypto.randomUUID()]);
    await asService('select public.dropship_admin_decide_participation($1, $2, $3, null, null, $4) as r', ['admin1', app.participant.id, 'approve', 'pending']);
  }
  const sp = await asService<any>('select public.dropship_create_supplier_product($1, $2, $3, $4, true, $5, null) as r', ['sup', 'supplier', 'sup', JSON.stringify({
    title: 'Rice cooker 1.8L', description: 'Non-stick rice cooker, 700W.', category: 'Home', images: [IMG], wholesalePricePesewas: 10000,
    stockOnHand: 4, shipsFromRegion: 'Greater Accra', shipsFromCity: 'Accra', deliveryFeeSameRegionPesewas: 1500, leadTimeMinDays: 1, leadTimeMaxDays: 3,
  }), crypto.randomUUID()]);
  spId = sp.product.id;
  await asService('select public.dropship_admin_moderate_supplier_product($1, $2, $3, null) as r', ['admin1', spId, 'approve']);
  const l = await asService<any>('select public.dropship_create_listing($1, $2, $3, $4) as r', ['ds', spId, 15000, crypto.randomUUID()]);
  const o = await asService<any>('select public.dropship_place_order($1, null, $2, 1, $3, $4) as r', ['buyer', l.productId,
    JSON.stringify({ name: 'Yaw B', phone: '0551234567', region: 'Ashanti', area: 'Adum', address: 'House 4, Main St' }), crypto.randomUUID()]);
  const id = o.order.id;
  await asService(`select public.dropship_buyer_order_action('buyer', $1, 'confirm', '{}') as r`, [id]);
  await asService(`select public.dropship_reseller_order_action('ds', $1, 'accept', '{}') as r`, [id]);
  await asService(`select public.dropship_reseller_order_action('ds', $1, 'request_reservation', '{}') as r`, [id]);
  await asService(`select public.dropship_supplier_order_action('sup', $1, 'confirm_reservation', '{}') as r`, [id]);
  assert.equal(await count(`select stock_reserved::int as n from public.dropship_supplier_products`), 1);
  // An expired hold elsewhere leaves an 'expire' stock event behind.
  await pg.exec(`insert into public.dropship_stock_events (supplier_product_id, event_type, delta_on_hand, delta_reserved, on_hand_after, reserved_after, actor)
                 values ('${spId}', 'expire', 0, 0, 4, 1, 'system')`);
});

test('rollback refuses without confirmation, and when something unexpected depends on it', async () => {
  await assert.rejects(runDown(DOWN, null), /rollback refused/);
  const cases: Array<[string, string, string, RegExp]> = [
    ['foreign key', 'create table public.other_table (o uuid references public.dropship_orders(id))', 'drop table public.other_table', /foreign keys from other tables/],
    ['extra function', "create function public.dropship_future() returns int language sql as 'select 1'", 'drop function public.dropship_future()', /expected functions/],
    ['RLS policy', 'create policy p_read on public.dropship_orders for select using (true)', 'drop policy p_read on public.dropship_orders', /RLS policies/],
    ['publication', 'create publication test_pub for table public.dropship_orders', 'drop publication test_pub', /published/],
  ];
  for (const [name, setup, teardown, expected] of cases) {
    await pg.exec(setup);
    await assert.rejects(runDown(DOWN, 'DELETE-DROPSHIP-ORDERS-DATA'), expected, name);
    assert.equal(await count('select count(*)::int as n from public.dropship_orders'), 1, `${name}: nothing dropped`);
    await pg.exec(teardown);
  }
});

test('confirmed rollback restores the exact post-Phase-3 schema and gives back held stock', async () => {
  await runDown(DOWN, 'DELETE-DROPSHIP-ORDERS-DATA');
  assert.deepEqual(await snapshot(), afterPhase3);
  assert.equal(await count('select stock_reserved::int as n from public.dropship_supplier_products'), 0);
  assert.equal(await count('select stock_on_hand::int as n from public.dropship_supplier_products'), 4);
  assert.equal(await count(`select count(*)::int as n from public.dropship_listings`), 1, 'listings kept');
  await assert.rejects(pg.query('delete from public.dropship_stock_events'), /append-only/);
});

test('up applies again, then all three rollbacks run in order', async () => {
  await pg.exec(fs.readFileSync(ORDERS_MIGRATION_PATH, 'utf8'));
  await runDown(DOWN, 'DELETE-DROPSHIP-ORDERS-DATA');
  await runDown(P3_DOWN, 'DELETE-DROPSHIP-LISTINGS-DATA');
  await runDown(P2_DOWN, 'DELETE-DROPSHIP-SUPPLIER-CATALOGUE-DATA');
  assert.equal(await count(`select count(*)::int as n from pg_proc where proname like 'dropship\\_%'`), 0);
  assert.deepEqual((await pg.query<any>('select id from public.products order by id')).rows, [{ id: 'p1' }]);
});
