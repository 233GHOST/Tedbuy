import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { MIGRATION_PATH } from './testing/pgliteDb.js';

// Up -> down -> up cycle of the supplier catalogue migration on a fresh in-process
// PostgreSQL 17 (PGlite). Checks that the rollback removes exactly what the up migration
// created, leaves pre-existing objects alone, refuses to run without confirmation, and
// refuses to run when something unexpected depends on Dropship objects.

const ROLLBACK_PATH = path.resolve(path.dirname(MIGRATION_PATH), '../rollbacks/20261026120000_dropship_supplier_catalogue.down.sql');
const CONFIRM = "set dropship.rollback_confirm = 'DELETE-DROPSHIP-SUPPLIER-CATALOGUE-DATA'";

// A small stand-in for the pre-existing TedBuy/Supabase schema.
const PRE_EXISTING = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create table public.users (id text primary key, username text not null);
  create table public.products (id text primary key, title text not null);
  create function public.legacy_helper() returns int language sql as 'select 1';
  insert into public.users values ('u1', 'kofi');
  insert into public.products values ('p1', 'Phone');
`;

let pg: PGlite;
const up = fs.readFileSync(MIGRATION_PATH, 'utf8');
const down = fs.readFileSync(ROLLBACK_PATH, 'utf8');

// Every object in the public schema plus roles and their privileges-relevant attributes.
async function snapshot() {
  const q = async (sql: string) => (await pg.query<{ x: string }>(sql)).rows.map(r => r.x);
  return {
    relations: await q(`select c.relkind::text || ' ' || c.relname as x from pg_class c join pg_namespace n on n.oid = c.relnamespace
                         where n.nspname = 'public' order by 1`),
    functions: await q(`select p.oid::regprocedure::text as x from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' order by 1`),
    constraints: await q(`select conrelid::regclass || ' ' || conname as x from pg_constraint c join pg_namespace n on n.oid = c.connamespace
                           where n.nspname = 'public' order by 1`),
    triggers: await q(`select tgrelid::regclass || ' ' || tgname as x from pg_trigger where not tgisinternal order by 1`),
    types: await q(`select t.typname as x from pg_type t join pg_namespace n on n.oid = t.typnamespace
                     where n.nspname = 'public' order by 1`),
    roles: await q(`select rolname || ' bypassrls=' || rolbypassrls as x from pg_roles where rolname in ('anon','authenticated','service_role') order by 1`),
    userRows: await q(`select id || ':' || username as x from public.users order by 1`),
    productRows: await q(`select id || ':' || title as x from public.products order by 1`),
    usersAcl: await q(`select coalesce(relacl::text, 'default') as x from pg_class where oid = 'public.users'::regclass`),
  };
}

async function dropshipObjects() {
  const q = async (sql: string) => Number((await pg.query<{ n: number }>(sql)).rows[0].n);
  return {
    tables: await q(`select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname='public' and c.relname like 'dropship\\_%' and c.relkind='r'`),
    sequences: await q(`select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname='public' and c.relname like 'dropship\\_%' and c.relkind='S'`),
    indexes: await q(`select count(*)::int as n from pg_index i join pg_class c on c.oid = i.indrelid where c.relname like 'dropship\\_%'`),
    functions: await q(`select count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname='public' and p.proname like 'dropship\\_%'`),
    triggers: await q(`select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname like 'dropship\\_%' and not t.tgisinternal`),
    rlsTables: await q(`select count(*)::int as n from pg_class where relname like 'dropship\\_%' and relkind='r' and relrowsecurity`),
    fksToUsers: await q(`select count(*)::int as n from pg_constraint where contype='f' and confrelid='public.users'::regclass`),
  };
}

// Runs the rollback; on failure, ends the aborted transaction it leaves open.
async function runDown(confirm: boolean) {
  await pg.exec(confirm ? CONFIRM : 'reset dropship.rollback_confirm');
  try {
    await pg.exec(down);
  } catch (err) {
    await pg.exec('rollback');
    throw err;
  } finally {
    await pg.exec('reset dropship.rollback_confirm');
  }
}

let before_up: Awaited<ReturnType<typeof snapshot>>;

before(async () => {
  pg = new PGlite();
  await pg.exec(PRE_EXISTING);
  before_up = await snapshot();
});
after(async () => { await pg.close(); });

test('up migration creates the expected Dropship objects', async () => {
  await pg.exec(up);
  assert.deepEqual(await dropshipObjects(), {
    tables: 4, sequences: 2, indexes: 14, functions: 19, triggers: 2, rlsTables: 4, fksToUsers: 2,
  });
  // Some data, so the rollback really deletes rows.
  await pg.query(`insert into public.dropship_participants (user_id, kind, display_name, contact_phone, region, city, address_line, terms_version, terms_accepted_at)
                  values ('u1','supplier','Kofi Supplies','0241234567','Greater Accra','Accra','12 Ring Road','t1', now())`);
});

test('rollback refuses to run without explicit confirmation and changes nothing', async () => {
  await assert.rejects(runDown(false), /rollback refused/);
  assert.equal((await dropshipObjects()).tables, 4);
  assert.equal(Number((await pg.query<any>('select count(*)::int as n from public.dropship_participants')).rows[0].n), 1);
});

test('rollback aborts, changing nothing, when an unexpected object depends on Dropship tables', async () => {
  const cases: Array<[string, string, RegExp]> = [
    ['view', 'create view public.legacy_report as select id from public.dropship_participants', /expected tables|views or rules/],
    ['foreign key', 'create table public.other_table (p uuid references public.dropship_participants(id))', /foreign keys from other tables/],
    ['extra function', 'create function public.dropship_future() returns int language sql as \'select 1\'', /expected functions/],
    ['RLS policy', 'create policy p_read on public.dropship_participants for select using (true)', /RLS policies/],
    ['publication', 'create publication test_pub for table public.dropship_participants', /published/],
  ];
  for (const [name, setup, expected] of cases) {
    await pg.exec(setup);
    await assert.rejects(runDown(true), expected, name);
    assert.equal((await dropshipObjects()).tables, 4, `${name}: nothing dropped`);
    await pg.exec({
      view: 'drop view public.legacy_report',
      'foreign key': 'drop table public.other_table',
      'extra function': 'drop function public.dropship_future()',
      'RLS policy': 'drop policy p_read on public.dropship_participants',
      publication: 'drop publication test_pub',
    }[name]!);
  }
});

test('confirmed rollback removes every Dropship object and leaves pre-existing objects intact', async () => {
  await runDown(true);
  assert.deepEqual(await dropshipObjects(), {
    tables: 0, sequences: 0, indexes: 0, functions: 0, triggers: 0, rlsTables: 0, fksToUsers: 0,
  });
  assert.deepEqual(await snapshot(), before_up, 'public schema, roles and legacy rows are exactly as before the up migration');
});

test('up migration applies again after the rollback, and the functions work', async () => {
  await pg.exec(up);
  assert.equal((await dropshipObjects()).functions, 19);
  const r = await pg.transaction(async tx => {
    await tx.exec('set local role service_role');
    return (await tx.query<any>('select public.dropship_submit_application($1, $2, $3, $4) as r',
      ['u1', 'supplier', JSON.stringify({ displayName: 'Kofi Supplies', contactPhone: '0241234567', region: 'Greater Accra', city: 'Accra', addressLine: '12 Ring Road', termsVersion: 't1' }), crypto.randomUUID()])).rows[0].r;
  });
  assert.equal(r.participant.status, 'pending');
  assert.equal(r.created, true, 'tables were recreated empty');
});
