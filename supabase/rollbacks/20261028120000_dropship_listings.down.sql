-- ROLLBACK for supabase/migrations/20261028120000_dropship_listings.sql
--
-- *** DESTRUCTIVE. THIS PERMANENTLY DELETES DATA. IT IS NOT A LOSSLESS REVERSAL. ***
--   * dropship_listings is dropped: every reseller listing, price and status, with no copy kept.
--   * Every listing mirror row in public.products (id starting with 'dsl_') is deleted.
--     Their images are supplier product images and are NOT deleted from Cloudinary.
--   * Audit events about listings (dropship_audit_events.target_type = 'listing') are
--     deleted, so the Phase 2 check constraint can be restored.
-- Kept: dropshipper participations (valid rows under the Phase 2 schema; Phase 2 code just
-- stops accepting new dropshipper applications), supplier products, stock events, other
-- audit events, and supplier products archived by account deletion stay archived.
-- If the data matters, export it first (for example
-- `pg_dump --data-only --table=public.dropship_listings --table=public.dropship_audit_events`
-- and `select * from public.products where id like 'dsl\_%'`) and keep the export.
--
-- Location: deliberately NOT in supabase/migrations/ (see the Phase 2 rollback header).
--
-- Order: roll this back BEFORE the Phase 2 rollback (that one refuses to run while these
-- objects exist).
--
-- Safety:
--   * Runs only when the session setting dropship.rollback_confirm equals
--     'DELETE-DROPSHIP-LISTINGS-DATA'; otherwise it raises and changes nothing.
--   * One transaction: any error rolls back everything.
--   * Aborts if the Dropship objects in the database are not exactly the Phase 2 set plus
--     the set created by this migration.
--   * Aborts if anything outside the migrations depends on the new objects: foreign keys
--     from other tables, views or rules, RLS policies, publication membership.
--   * No CASCADE anywhere. Restores the two functions this migration replaced
--     (dropship_submit_application, dropship_update_supplier_product) exactly as in the
--     Phase 2 migration, and the Phase 2 audit target_type check.
--
-- Run (development or staging only):
--   PGOPTIONS='-c dropship.rollback_confirm=DELETE-DROPSHIP-LISTINGS-DATA' \
--     psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/rollbacks/20261028120000_dropship_listings.down.sql
-- Do not add psql's -1/--single-transaction flag: the script manages its own transaction.
-- If the up migration is recorded in supabase_migrations.schema_migrations, also mark it
-- reverted afterwards: `supabase migration repair --status reverted 20261028120000`.

begin;

do $$
declare
  expected_relations constant text[] := array[
    'dropship_audit_events', 'dropship_listing_availability', 'dropship_listings', 'dropship_participants',
    'dropship_stock_events', 'dropship_supplier_products'];
  new_relations constant text[] := array['dropship_listing_availability', 'dropship_listings'];
  expected_functions constant text[] := array[
    'dropship_admin_decide_participation(text,uuid,text,text,text,text)',
    'dropship_admin_list_participants(text,text,integer)',
    'dropship_admin_moderate_supplier_product(text,uuid,text,text)',
    'dropship_audit(text,text,text,text,uuid,text,jsonb)',
    'dropship_catalogue(text,text,text,timestamp with time zone,uuid,integer)',
    'dropship_catalogue_eligible(dropship_supplier_products)',
    'dropship_catalogue_item(text,uuid)',
    'dropship_catalogue_item_json(dropship_supplier_products,text,boolean)',
    'dropship_check_actor(text,text,text)',
    'dropship_check_listing_actor(text,text,text)',
    'dropship_check_product_fields(jsonb)',
    'dropship_create_listing(text,uuid,bigint,uuid)',
    'dropship_create_supplier_product(text,text,text,jsonb,boolean,uuid,text)',
    'dropship_delivery_fees_json(dropship_supplier_products)',
    'dropship_fail(text,text)',
    'dropship_forbid_mutation()',
    'dropship_get_participations(text)',
    'dropship_hidden_product_ids()',
    'dropship_is_protected_media(text[])',
    'dropship_list_my_listings(text)',
    'dropship_list_supplier_products(text,text,integer)',
    'dropship_listing_json(dropship_listings)',
    'dropship_lock_product_for_actor(text,text,uuid)',
    'dropship_media_public_id(text)',
    'dropship_media_public_ids(jsonb)',
    'dropship_min_retail_pesewas(bigint)',
    'dropship_participant_json(dropship_participants)',
    'dropship_platform_fee_pesewas(bigint)',
    'dropship_price_text(bigint)',
    'dropship_pricing_config()',
    'dropship_purchase_info(text)',
    'dropship_quote(text,uuid,bigint)',
    'dropship_remove_listing(text,text,uuid,text)',
    'dropship_remove_user_listings(text,text)',
    'dropship_require_approved_dropshipper(text)',
    'dropship_require_approved_supplier(text)',
    'dropship_set_stock(text,text,uuid,integer,integer,text)',
    'dropship_set_supplier_product_status(text,text,uuid,text,text)',
    'dropship_submit_application(text,text,jsonb,uuid)',
    'dropship_supplier_product_json(dropship_supplier_products)',
    'dropship_update_listing(text,text,uuid,bigint,text,text)',
    'dropship_update_supplier_product(text,text,uuid,jsonb,integer,text)',
    'dropship_user_has_records(text)',
    'dropship_user_unavailable(text)'];
  found text[];
  problem text;
  n bigint;
begin
  -- 0. Explicit confirmation.
  if coalesce(current_setting('dropship.rollback_confirm', true), '') <> 'DELETE-DROPSHIP-LISTINGS-DATA' then
    raise exception 'Dropship listings rollback refused: it permanently deletes every Dropship listing, its products row and its audit events. '
      'Set dropship.rollback_confirm = ''DELETE-DROPSHIP-LISTINGS-DATA'' for this session to proceed.';
  end if;

  -- 1. The Dropship objects present must be exactly Phase 2 plus this migration.
  select coalesce(array_agg(c.relname::text order by c.relname), '{}') into found
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname like 'dropship\_%' and c.relkind in ('r','p','v','m','f');
  if found is distinct from expected_relations then
    raise exception 'Dropship listings rollback aborted: expected tables and views %, found %. Roll back later Dropship migrations first, or inspect the schema by hand.',
      expected_relations, found;
  end if;

  select coalesce(array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '{}') into found
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname like 'dropship\_%';
  found := array(select replace(f, 'public.', '') from unnest(found) f order by 1);
  if found is distinct from expected_functions then
    raise exception 'Dropship listings rollback aborted: expected functions %, found %.', expected_functions, found;
  end if;

  -- 2. Nothing outside the migrations may depend on the new objects.
  select string_agg(format('%s references %s', conrelid::regclass, confrelid::regclass), '; ') into problem
    from pg_constraint
   where contype = 'f' and confrelid = 'public.dropship_listings'::regclass
     and conrelid <> 'public.dropship_listings'::regclass;
  if problem is not null then
    raise exception 'Dropship listings rollback aborted: foreign keys from other tables: %', problem;
  end if;

  select string_agg(format('%I on %I', pol.polname, c.relname), '; ') into problem
    from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname = 'dropship_listings';
  if problem is not null then
    raise exception 'Dropship listings rollback aborted: RLS policies were added after the migration: %', problem;
  end if;

  select string_agg(format('%I in publication %I', c.relname, pub.pubname), '; ') into problem
    from pg_publication_rel pr join pg_publication pub on pub.oid = pr.prpubid
    join pg_class c on c.oid = pr.prrelid join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname = 'dropship_listings';
  if problem is not null then
    raise exception 'Dropship listings rollback aborted: tables are published (e.g. Realtime): %. Remove them from the publication deliberately first.', problem;
  end if;

  -- Views or rules (other than dropship_listing_availability itself) on the new objects.
  select string_agg(distinct format('%s depends on %s', r.ev_class::regclass, d.refobjid::regclass), '; ') into problem
    from pg_depend d
    join pg_rewrite r on d.classid = 'pg_rewrite'::regclass and r.oid = d.objid
   where d.refclassid = 'pg_class'::regclass
     and d.refobjid in ('public.dropship_listings'::regclass, 'public.dropship_listing_availability'::regclass)
     and r.ev_class not in ('public.dropship_listings'::regclass, 'public.dropship_listing_availability'::regclass);
  if problem is not null then
    raise exception 'Dropship listings rollback aborted: views or rules depend on Dropship listing objects: %', problem;
  end if;

  -- 3. Report what will be deleted.
  select count(*) into n from public.dropship_listings;
  raise notice 'Dropship listings rollback: deleting % row(s) from public.dropship_listings', n;
  select count(*) into n from public.products where id like 'dsl\_%';
  raise notice 'Dropship listings rollback: deleting % listing mirror row(s) from public.products', n;
  select count(*) into n from public.dropship_audit_events where target_type = 'listing';
  raise notice 'Dropship listings rollback: deleting % listing audit event(s) from public.dropship_audit_events', n;
end $$;

-- 4. The view, then the functions this migration added (the publicId index on
--    dropship_supplier_products goes before the function it uses). Two take the tables' row types.
drop view public.dropship_listing_availability;

drop function public.dropship_catalogue(text, text, text, timestamptz, uuid, integer);
drop function public.dropship_catalogue_item(text, uuid);
drop function public.dropship_catalogue_item_json(public.dropship_supplier_products, text, boolean);
drop function public.dropship_catalogue_eligible(public.dropship_supplier_products);
drop function public.dropship_check_listing_actor(text, text, text);
drop function public.dropship_create_listing(text, uuid, bigint, uuid);
drop function public.dropship_delivery_fees_json(public.dropship_supplier_products);
drop function public.dropship_hidden_product_ids();
drop function public.dropship_is_protected_media(text[]);
drop index public.dsp_image_public_ids_idx;
drop function public.dropship_media_public_ids(jsonb);
drop function public.dropship_media_public_id(text);
drop function public.dropship_list_my_listings(text);
drop function public.dropship_listing_json(public.dropship_listings);
drop function public.dropship_min_retail_pesewas(bigint);
drop function public.dropship_platform_fee_pesewas(bigint);
drop function public.dropship_price_text(bigint);
drop function public.dropship_pricing_config();
drop function public.dropship_purchase_info(text);
drop function public.dropship_quote(text, uuid, bigint);
drop function public.dropship_remove_listing(text, text, uuid, text);
drop function public.dropship_remove_user_listings(text, text);
drop function public.dropship_require_approved_dropshipper(text);
drop function public.dropship_update_listing(text, text, uuid, bigint, text, text);
drop function public.dropship_user_has_records(text);
drop function public.dropship_user_unavailable(text);

-- 5. The listings table (its foreign key to public.products goes with it), then the mirror
--    rows it pointed at. The dsl_ prefix is reserved for Dropship (the up migration checked
--    that no legacy row used it).
drop table public.dropship_listings;
delete from public.products where id like 'dsl\_%';

-- 6. The catalogue keyset index on the Phase 2 table.
drop index public.dsp_catalogue_created_idx;

-- 7. Listing audit events, then the Phase 2 target_type check. The append-only trigger is
--    switched off for this one statement, inside this transaction.
alter table public.dropship_audit_events disable trigger audit_events_immutable;
delete from public.dropship_audit_events where target_type = 'listing';
alter table public.dropship_audit_events enable trigger audit_events_immutable;
alter table public.dropship_audit_events drop constraint dropship_audit_events_target_type_check;
alter table public.dropship_audit_events add constraint dropship_audit_events_target_type_check
  check (target_type in ('participant','supplier_product'));

-- 8. The two functions the migration replaced, exactly as in the Phase 2 migration
--    (CREATE OR REPLACE keeps their owner and grants).
-- ---------------------------------------------------------------------------------------
-- #6 Supplier application (user) - create, or resubmit while pending/rejected
-- Locks: participant (class 7) only (rule M7).
-- ---------------------------------------------------------------------------------------
create or replace function public.dropship_submit_application(p_user text, p_kind text, p_fields jsonb, p_client_request_id uuid)
returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_row public.dropship_participants;
begin
  if p_kind is distinct from 'supplier' then
    perform public.dropship_fail('VALIDATION', 'only supplier applications are open');
  end if;
  if p_client_request_id is null then
    perform public.dropship_fail('VALIDATION', 'clientRequestId is required');
  end if;

  insert into public.dropship_participants
    (user_id, kind, display_name, contact_phone, region, city, address_line, business_reg_no,
     terms_version, terms_accepted_at, client_request_id, application)
  values
    (p_user, p_kind, p_fields->>'displayName', p_fields->>'contactPhone', p_fields->>'region',
     p_fields->>'city', p_fields->>'addressLine', p_fields->>'businessRegNo',
     p_fields->>'termsVersion', now(), p_client_request_id, coalesce(p_fields->'answers', '{}'::jsonb))
  on conflict (user_id, kind) do nothing
  returning * into v_row;

  if v_row.id is not null then
    perform public.dropship_audit(p_user, 'user', 'application_submitted', 'participant', v_row.id, null, '{}'::jsonb);
    return jsonb_build_object('participant', public.dropship_participant_json(v_row), 'created', true);
  end if;

  -- An application already exists: lock it to change it (no upgrade later).
  select * into v_row from public.dropship_participants
   where user_id = p_user and kind = p_kind
   for no key update;

  if v_row.client_request_id = p_client_request_id then
    return jsonb_build_object('participant', public.dropship_participant_json(v_row), 'created', false);
  end if;
  if v_row.status not in ('pending','rejected') then
    perform public.dropship_fail('STATE_CONFLICT', 'participation is already ' || v_row.status);
  end if;

  update public.dropship_participants set
    display_name = p_fields->>'displayName', contact_phone = p_fields->>'contactPhone',
    region = p_fields->>'region', city = p_fields->>'city', address_line = p_fields->>'addressLine',
    business_reg_no = p_fields->>'businessRegNo', terms_version = p_fields->>'termsVersion',
    terms_accepted_at = now(), client_request_id = p_client_request_id,
    application = coalesce(p_fields->'answers', '{}'::jsonb),
    status = 'pending', status_changed_at = case when status = 'pending' then status_changed_at else now() end,
    status_reason = null, updated_at = now()
  where id = v_row.id
  returning * into v_row;

  perform public.dropship_audit(p_user, 'user', 'application_resubmitted', 'participant', v_row.id, null, '{}'::jsonb);
  return jsonb_build_object('participant', public.dropship_participant_json(v_row), 'created', false);
end $$;

-- ---------------------------------------------------------------------------------------
-- #12 Update supplier product content and prices (not stock, not status)
-- Locks: supplier product NKU (6) -> participant FOR SHARE (7).
-- ---------------------------------------------------------------------------------------
create or replace function public.dropship_update_supplier_product(p_actor text, p_actor_role text, p_id uuid, p_fields jsonb,
                                                         p_expected_content_version integer, p_reason text)
returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_row public.dropship_supplier_products;
  v_price_changed boolean;
begin
  perform public.dropship_check_actor(p_actor, p_actor_role, p_reason);
  perform public.dropship_check_product_fields(p_fields);
  v_row := public.dropship_lock_product_for_actor(p_actor, p_actor_role, p_id);
  perform public.dropship_require_approved_supplier(v_row.supplier_id);

  if v_row.status = 'archived' then
    perform public.dropship_fail('STATE_CONFLICT', 'archived products cannot be edited');
  end if;
  if p_expected_content_version is null or v_row.content_version <> p_expected_content_version then
    perform public.dropship_fail('STATE_CONFLICT', 'product was changed by someone else; reload it');
  end if;

  v_price_changed :=
       (p_fields ? 'wholesalePricePesewas' and (p_fields->>'wholesalePricePesewas')::bigint is distinct from v_row.wholesale_price_pesewas)
    or (p_fields ? 'deliveryFeeSameRegionPesewas' and (p_fields->>'deliveryFeeSameRegionPesewas')::bigint is distinct from v_row.delivery_fee_same_region_pesewas)
    or (p_fields ? 'deliveryFeeOtherRegionPesewas' and (p_fields->>'deliveryFeeOtherRegionPesewas')::bigint is distinct from v_row.delivery_fee_other_region_pesewas);

  update public.dropship_supplier_products set
    title = case when p_fields ? 'title' then p_fields->>'title' else title end,
    description = case when p_fields ? 'description' then p_fields->>'description' else description end,
    category = case when p_fields ? 'category' then p_fields->>'category' else category end,
    condition = case when p_fields ? 'condition' then p_fields->>'condition' else condition end,
    brand = case when p_fields ? 'brand' then p_fields->>'brand' else brand end,
    images = case when p_fields ? 'images' then p_fields->'images' else images end,
    wholesale_price_pesewas = case when p_fields ? 'wholesalePricePesewas' then (p_fields->>'wholesalePricePesewas')::bigint else wholesale_price_pesewas end,
    suggested_retail_pesewas = case when p_fields ? 'suggestedRetailPesewas' then (p_fields->>'suggestedRetailPesewas')::bigint else suggested_retail_pesewas end,
    max_per_order = case when p_fields ? 'maxPerOrder' then (p_fields->>'maxPerOrder')::integer else max_per_order end,
    ships_from_region = case when p_fields ? 'shipsFromRegion' then p_fields->>'shipsFromRegion' else ships_from_region end,
    ships_from_city = case when p_fields ? 'shipsFromCity' then p_fields->>'shipsFromCity' else ships_from_city end,
    delivery_fee_same_region_pesewas = case when p_fields ? 'deliveryFeeSameRegionPesewas' then (p_fields->>'deliveryFeeSameRegionPesewas')::bigint else delivery_fee_same_region_pesewas end,
    delivery_fee_other_region_pesewas = case when p_fields ? 'deliveryFeeOtherRegionPesewas' then (p_fields->>'deliveryFeeOtherRegionPesewas')::bigint else delivery_fee_other_region_pesewas end,
    lead_time_min_days = case when p_fields ? 'leadTimeMinDays' then (p_fields->>'leadTimeMinDays')::integer else lead_time_min_days end,
    lead_time_max_days = case when p_fields ? 'leadTimeMaxDays' then (p_fields->>'leadTimeMaxDays')::integer else lead_time_max_days end,
    return_window_days = case when p_fields ? 'returnWindowDays' then (p_fields->>'returnWindowDays')::integer else return_window_days end,
    return_conditions = case when p_fields ? 'returnConditions' then p_fields->>'returnConditions' else return_conditions end,
    content_version = content_version + 1,
    price_version = price_version + case when v_price_changed then 1 else 0 end,
    updated_at = now()
  where id = v_row.id
  returning * into v_row;

  perform public.dropship_audit(p_actor, p_actor_role, 'supplier_product_updated', 'supplier_product', v_row.id, p_reason,
                                jsonb_build_object('fields', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p_fields) k),
                                                   'priceChanged', v_price_changed));
  return jsonb_build_object('product', public.dropship_supplier_product_json(v_row));
end $$;

commit;
