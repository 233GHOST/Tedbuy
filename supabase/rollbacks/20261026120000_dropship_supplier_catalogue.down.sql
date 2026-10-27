-- ROLLBACK for supabase/migrations/20261026120000_dropship_supplier_catalogue.sql
--
-- *** DESTRUCTIVE. THIS PERMANENTLY DELETES DATA. IT IS NOT A LOSSLESS REVERSAL. ***
-- Dropping the four tables deletes every row in them, with no copy kept:
--   * dropship_participants      - every supplier/dropshipper application and participation,
--                                  contact details, review decisions and admin notes
--   * dropship_supplier_products - every supplier product, price, stock level and status
--   * dropship_stock_events      - the complete stock-change history
--   * dropship_audit_events      - the complete Dropship audit trail
-- Re-applying the up migration recreates empty tables only. If the data matters, export it
-- first (for example `pg_dump --data-only --table='public.dropship_*'`) and keep the export.
--
-- Location: this file is deliberately NOT in supabase/migrations/. Supabase has no down
-- migrations; files there are applied in timestamp order by `supabase db push` / `db reset`,
-- so a rollback stored there could run as a forward migration.
--
-- Safety:
--   * Runs only when the session setting dropship.rollback_confirm equals
--     'DELETE-DROPSHIP-SUPPLIER-CATALOGUE-DATA'; otherwise it raises and changes nothing.
--   * One transaction: any error rolls back everything.
--   * Aborts if the Dropship objects in the database are not exactly the set created by the
--     up migration (a later Dropship migration must be rolled back first, or this one was
--     never applied completely).
--   * Aborts if anything outside this migration depends on its objects: foreign keys from
--     other tables, views, RLS policies, publication membership (e.g. Supabase Realtime).
--   * No CASCADE anywhere. Every drop names one object; PostgreSQL's default RESTRICT
--     behaviour makes any unforeseen dependency an error instead of a silent drop.
--   * Touches nothing else: not public.users, not the Supabase roles, not other functions.
--
-- Run (development or staging only, never production, never a database with real users):
--   PGOPTIONS='-c dropship.rollback_confirm=DELETE-DROPSHIP-SUPPLIER-CATALOGUE-DATA' \
--     psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/rollbacks/20261026120000_dropship_supplier_catalogue.down.sql
-- Do not add psql's -1/--single-transaction flag: the script manages its own transaction.
-- If the up migration is recorded in supabase_migrations.schema_migrations, also mark it
-- reverted afterwards: `supabase migration repair --status reverted 20261026120000`.

begin;

do $$
declare
  expected_tables constant text[] := array[
    'dropship_audit_events', 'dropship_participants', 'dropship_stock_events', 'dropship_supplier_products'];
  expected_sequences constant text[] := array[
    'dropship_audit_events_id_seq', 'dropship_stock_events_id_seq'];
  expected_functions constant text[] := array[
    'dropship_admin_decide_participation(text,uuid,text,text,text,text)',
    'dropship_admin_list_participants(text,text,integer)',
    'dropship_admin_moderate_supplier_product(text,uuid,text,text)',
    'dropship_audit(text,text,text,text,uuid,text,jsonb)',
    'dropship_check_actor(text,text,text)',
    'dropship_check_product_fields(jsonb)',
    'dropship_create_supplier_product(text,text,text,jsonb,boolean,uuid,text)',
    'dropship_fail(text,text)',
    'dropship_forbid_mutation()',
    'dropship_get_participations(text)',
    'dropship_list_supplier_products(text,text,integer)',
    'dropship_lock_product_for_actor(text,text,uuid)',
    'dropship_participant_json(dropship_participants)',
    'dropship_require_approved_supplier(text)',
    'dropship_set_stock(text,text,uuid,integer,integer,text)',
    'dropship_set_supplier_product_status(text,text,uuid,text,text)',
    'dropship_submit_application(text,text,jsonb,uuid)',
    'dropship_supplier_product_json(dropship_supplier_products)',
    'dropship_update_supplier_product(text,text,uuid,jsonb,integer,text)'];
  expected_triggers constant text[] := array[
    'dropship_audit_events.audit_events_immutable', 'dropship_stock_events.stock_events_immutable'];
  found text[];
  problem text;
  n bigint;
  t text;
begin
  -- 0. Explicit confirmation.
  if coalesce(current_setting('dropship.rollback_confirm', true), '') <> 'DELETE-DROPSHIP-SUPPLIER-CATALOGUE-DATA' then
    raise exception 'Dropship rollback refused: it permanently deletes all Dropship participant, product, stock-event and audit data. '
      'Set dropship.rollback_confirm = ''DELETE-DROPSHIP-SUPPLIER-CATALOGUE-DATA'' for this session to proceed.';
  end if;

  -- 1. The Dropship objects present must be exactly those created by the up migration.
  select coalesce(array_agg(c.relname::text order by c.relname), '{}') into found
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname like 'dropship\_%' and c.relkind in ('r','p','v','m','f');
  if found is distinct from expected_tables then
    raise exception 'Dropship rollback aborted: expected tables %, found %. Roll back later Dropship migrations first, or inspect the schema by hand.',
      expected_tables, found;
  end if;

  select coalesce(array_agg(c.relname::text order by c.relname), '{}') into found
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname like 'dropship\_%' and c.relkind = 'S';
  if found is distinct from expected_sequences then
    raise exception 'Dropship rollback aborted: expected sequences %, found %.', expected_sequences, found;
  end if;

  select coalesce(array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '{}') into found
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname like 'dropship\_%';
  -- regprocedure prints types schema-qualified only when they are not on the search_path.
  found := array(select replace(f, 'public.', '') from unnest(found) f order by 1);
  if found is distinct from expected_functions then
    raise exception 'Dropship rollback aborted: expected functions %, found %.', expected_functions, found;
  end if;

  select coalesce(array_agg(c.relname || '.' || tg.tgname order by 1), '{}') into found
    from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname = any (expected_tables) and not tg.tgisinternal;
  if found is distinct from expected_triggers then
    raise exception 'Dropship rollback aborted: expected triggers %, found %.', expected_triggers, found;
  end if;

  -- 2. Nothing outside this migration may depend on its objects.
  select string_agg(format('%s references %s', conrelid::regclass, confrelid::regclass), '; ') into problem
    from pg_constraint
   where contype = 'f'
     and confrelid in (select c.oid from pg_class c join pg_namespace s on s.oid = c.relnamespace
                        where s.nspname = 'public' and c.relname = any (expected_tables))
     and conrelid not in (select c.oid from pg_class c join pg_namespace s on s.oid = c.relnamespace
                           where s.nspname = 'public' and c.relname = any (expected_tables));
  if problem is not null then
    raise exception 'Dropship rollback aborted: foreign keys from other tables: %', problem;
  end if;

  select string_agg(format('%I on %I', pol.polname, c.relname), '; ') into problem
    from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname = any (expected_tables);
  if problem is not null then
    raise exception 'Dropship rollback aborted: RLS policies were added after the migration: %', problem;
  end if;

  select string_agg(format('%I in publication %I', c.relname, pub.pubname), '; ') into problem
    from pg_publication_rel pr join pg_publication pub on pub.oid = pr.prpubid
    join pg_class c on c.oid = pr.prrelid join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname = any (expected_tables);
  if problem is not null then
    raise exception 'Dropship rollback aborted: tables are published (e.g. Realtime): %. Remove them from the publication deliberately first.', problem;
  end if;

  -- Views, rules or functions created elsewhere on top of these objects would otherwise
  -- make the RESTRICT drops below fail; report them up front with their names.
  select string_agg(distinct format('%s depends on %s', r.ev_class::regclass, d.refobjid::regclass), '; ') into problem
    from pg_depend d
    join pg_rewrite r on d.classid = 'pg_rewrite'::regclass and r.oid = d.objid
   where d.refclassid = 'pg_class'::regclass
     and d.refobjid in (select c.oid from pg_class c join pg_namespace s on s.oid = c.relnamespace
                         where s.nspname = 'public' and c.relname = any (expected_tables))
     and r.ev_class not in (select c.oid from pg_class c join pg_namespace s on s.oid = c.relnamespace
                             where s.nspname = 'public' and c.relname = any (expected_tables));
  if problem is not null then
    raise exception 'Dropship rollback aborted: views or rules depend on Dropship tables: %', problem;
  end if;

  -- 3. Report what will be deleted.
  foreach t in array expected_tables loop
    execute format('select count(*) from public.%I', t) into n;
    raise notice 'Dropship rollback: deleting % row(s) from public.%', n, t;
  end loop;
end $$;

-- 4. Triggers first (they depend on dropship_forbid_mutation()).
drop trigger stock_events_immutable on public.dropship_stock_events;
drop trigger audit_events_immutable on public.dropship_audit_events;

-- 5. Functions. Three take or return the tables' row types, so they must go before the
--    tables; dropping all 19 here keeps the order simple. Plain SQL/PL/pgSQL bodies create
--    no dependencies, so the order among functions doesn't matter.
drop function public.dropship_admin_decide_participation(text, uuid, text, text, text, text);
drop function public.dropship_admin_list_participants(text, text, integer);
drop function public.dropship_admin_moderate_supplier_product(text, uuid, text, text);
drop function public.dropship_audit(text, text, text, text, uuid, text, jsonb);
drop function public.dropship_check_actor(text, text, text);
drop function public.dropship_check_product_fields(jsonb);
drop function public.dropship_create_supplier_product(text, text, text, jsonb, boolean, uuid, text);
drop function public.dropship_fail(text, text);
drop function public.dropship_forbid_mutation();
drop function public.dropship_get_participations(text);
drop function public.dropship_list_supplier_products(text, text, integer);
drop function public.dropship_lock_product_for_actor(text, text, uuid);
drop function public.dropship_participant_json(public.dropship_participants);
drop function public.dropship_require_approved_supplier(text);
drop function public.dropship_set_stock(text, text, uuid, integer, integer, text);
drop function public.dropship_set_supplier_product_status(text, text, uuid, text, text);
drop function public.dropship_submit_application(text, text, jsonb, uuid);
drop function public.dropship_supplier_product_json(public.dropship_supplier_products);
drop function public.dropship_update_supplier_product(text, text, uuid, jsonb, integer, text);

-- 6. Tables, referencing tables first. Each DROP TABLE also removes that table's indexes,
--    constraints (including its foreign keys to public.users, which leaves public.users
--    itself unchanged), RLS setting, grants and identity sequence.
drop table public.dropship_stock_events;       -- references dropship_supplier_products
drop table public.dropship_audit_events;
drop table public.dropship_supplier_products;
drop table public.dropship_participants;

commit;
