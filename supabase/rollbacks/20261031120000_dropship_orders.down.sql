-- ROLLBACK for supabase/migrations/20261031120000_dropship_orders.sql
--
-- *** DESTRUCTIVE. THIS PERMANENTLY DELETES DATA. IT IS NOT A LOSSLESS REVERSAL. ***
--   * Every Dropship order, its history, reservations, payment records, delivery codes,
--     disputes, reliability events, reseller limit overrides and the order settings are
--     dropped, with no copy kept.
--   * Stock held by live reservations is given back (stock_reserved returns to 0, with a
--     'release' stock event per product). Stock events named 'expire' are renamed 'release'
--     (same effect) so the Phase 2/3 check can be restored.
--   * Audit events about orders and order settings are deleted.
--   * Listings lose their delivery fee.
-- Kept: participants, supplier products and stock on hand, listings, other audit events.
-- If the data matters, export it first (pg_dump --data-only of the dropship_order*,
-- dropship_reservations, dropship_disputes, dropship_reliability_events tables).
--
-- Order: roll this back BEFORE the Phase 3 rollback (that one refuses to run while these
-- objects exist).
--
-- Safety: runs only when dropship.rollback_confirm = 'DELETE-DROPSHIP-ORDERS-DATA'; one
-- transaction; aborts if the Dropship objects are not exactly Phases 2-4, or if anything
-- outside the migrations references the new tables. No CASCADE.
--
-- Run (development or staging only):
--   PGOPTIONS='-c dropship.rollback_confirm=DELETE-DROPSHIP-ORDERS-DATA' \
--     psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/rollbacks/20261031120000_dropship_orders.down.sql

begin;

do $$
declare
  expected_relations constant text[] := array[
    'dropship_audit_events',
    'dropship_delivery_codes',
    'dropship_disputes',
    'dropship_listing_availability',
    'dropship_listings',
    'dropship_order_events',
    'dropship_order_payments',
    'dropship_order_settings',
    'dropship_orders',
    'dropship_participants',
    'dropship_reliability_events',
    'dropship_reseller_limit_overrides',
    'dropship_reservations',
    'dropship_stock_events',
    'dropship_supplier_products'];
  new_relations constant text[] := array[
    'dropship_delivery_codes',
    'dropship_disputes',
    'dropship_order_events',
    'dropship_order_payments',
    'dropship_order_settings',
    'dropship_orders',
    'dropship_reliability_events',
    'dropship_reseller_limit_overrides',
    'dropship_reservations'];
  expected_functions constant text[] := array[
    'dropship_admin_cancel_order(text,uuid,text)',
    'dropship_admin_decide_participation(text,uuid,text,text,text,text)',
    'dropship_admin_list_participants(text,text,integer)',
    'dropship_admin_moderate_supplier_product(text,uuid,text,text)',
    'dropship_admin_reliability(text)',
    'dropship_admin_resolve_dispute(text,uuid,text,text,text,text)',
    'dropship_admin_set_limit_override(text,text,bigint,bigint,text)',
    'dropship_admin_update_settings(text,jsonb,text)',
    'dropship_audit(text,text,text,text,uuid,text,jsonb)',
    'dropship_buyer_order_action(text,uuid,text,jsonb)',
    'dropship_catalogue(text,text,text,timestamp with time zone,uuid,integer)',
    'dropship_catalogue_eligible(dropship_supplier_products)',
    'dropship_catalogue_item(text,uuid)',
    'dropship_catalogue_item_json(dropship_supplier_products,text,boolean)',
    'dropship_check_actor(text,text,text)',
    'dropship_check_exposure(text,uuid,bigint)',
    'dropship_check_listing_actor(text,text,text)',
    'dropship_check_product_fields(jsonb)',
    'dropship_create_listing(text,uuid,bigint,uuid)',
    'dropship_create_supplier_product(text,text,text,jsonb,boolean,uuid,text)',
    'dropship_deadline_for(text,timestamp with time zone)',
    'dropship_delivery_fees_json(dropship_supplier_products)',
    'dropship_expire_due(integer)',
    'dropship_fail(text,text)',
    'dropship_forbid_mutation()',
    'dropship_get_order(text,text,uuid)',
    'dropship_get_participations(text)',
    'dropship_get_settings()',
    'dropship_hidden_product_ids()',
    'dropship_is_protected_media(text[])',
    'dropship_list_my_listings(text)',
    'dropship_list_orders(text,text,text,text,timestamp with time zone,uuid,integer)',
    'dropship_list_supplier_products(text,text,integer)',
    'dropship_listing_json(dropship_listings)',
    'dropship_lock_order(text,text,uuid)',
    'dropship_lock_product_for_actor(text,text,uuid)',
    'dropship_media_public_id(text)',
    'dropship_media_public_ids(jsonb)',
    'dropship_min_retail_pesewas(bigint)',
    'dropship_open_dispute(dropship_orders,text,text,text,jsonb)',
    'dropship_order_cancel_internal(dropship_orders,text,text,text,text,jsonb)',
    'dropship_order_dispute_json(uuid,text)',
    'dropship_order_event(uuid,text,text,text,text,text,text,jsonb)',
    'dropship_order_json(dropship_orders,text)',
    'dropship_order_move(dropship_orders,text,text,text,text,text,jsonb)',
    'dropship_order_payments_json(uuid,text[])',
    'dropship_order_result(dropship_orders,text,boolean,text[])',
    'dropship_order_row_json(dropship_orders,text)',
    'dropship_order_timeline(uuid,text)',
    'dropship_participant_json(dropship_participants)',
    'dropship_place_order(text,text,text,integer,jsonb,uuid)',
    'dropship_platform_fee_pesewas(bigint)',
    'dropship_price_text(bigint)',
    'dropship_pricing_config()',
    'dropship_purchase_info(text)',
    'dropship_quote(text,uuid,bigint)',
    'dropship_release_reservation(uuid,text,text,text)',
    'dropship_reliability(text,text,text,text,boolean,uuid,text,jsonb)',
    'dropship_reliability_summary(text,text)',
    'dropship_remove_listing(text,text,uuid,text)',
    'dropship_remove_user_listings(text,text)',
    'dropship_require_approved_dropshipper(text)',
    'dropship_require_approved_supplier(text)',
    'dropship_require_status(dropship_orders,text[])',
    'dropship_reseller_exposure(text)',
    'dropship_reseller_limits(text)',
    'dropship_reseller_order_action(text,uuid,text,jsonb)',
    'dropship_reseller_summary(text)',
    'dropship_set_listing_delivery_fee(text,uuid,bigint)',
    'dropship_set_stock(text,text,uuid,integer,integer,text)',
    'dropship_set_supplier_product_status(text,text,uuid,text,text)',
    'dropship_settings()',
    'dropship_submit_application(text,text,jsonb,uuid)',
    'dropship_supplier_order_action(text,uuid,text,jsonb)',
    'dropship_supplier_product_json(dropship_supplier_products)',
    'dropship_supplier_summary(text)',
    'dropship_update_listing(text,text,uuid,bigint,text,text)',
    'dropship_update_supplier_product(text,text,uuid,jsonb,integer,text)',
    'dropship_user_has_records(text)',
    'dropship_user_unavailable(text)'];
  found text[];
  problem text;
  n bigint;
begin
  if coalesce(current_setting('dropship.rollback_confirm', true), '') <> 'DELETE-DROPSHIP-ORDERS-DATA' then
    raise exception 'Dropship orders rollback refused: it permanently deletes every Dropship order and its records. '
      'Set dropship.rollback_confirm = ''DELETE-DROPSHIP-ORDERS-DATA'' for this session to proceed.';
  end if;

  select coalesce(array_agg(c.relname::text order by c.relname), '{}') into found
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname like 'dropship\_%' and c.relkind in ('r','p','v','m','f');
  -- Compare as sets: array order depends on the database collation (staging differs from tests).
  if array(select f from unnest(found) f order by f collate "C") is distinct from array(select f from unnest(expected_relations) f order by f collate "C") then
    raise exception 'Dropship orders rollback aborted: expected tables and views %, found %.', expected_relations, found;
  end if;

  select coalesce(array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '{}') into found
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname like 'dropship\_%';
  found := array(select replace(f, 'public.', '') from unnest(found) f order by 1);
  -- Compare as sets: array order depends on the database collation (staging differs from tests).
  if array(select f from unnest(found) f order by f collate "C") is distinct from array(select f from unnest(expected_functions) f order by f collate "C") then
    raise exception 'Dropship orders rollback aborted: expected functions %, found %.', expected_functions, found;
  end if;

  select string_agg(format('%s references %s', conrelid::regclass, confrelid::regclass), '; ') into problem
    from pg_constraint
   where contype = 'f'
     and confrelid in (select ('public.' || x)::regclass from unnest(new_relations) x)
     and conrelid not in (select ('public.' || x)::regclass from unnest(new_relations) x);
  if problem is not null then
    raise exception 'Dropship orders rollback aborted: foreign keys from other tables: %', problem;
  end if;

  select string_agg(format('%I on %I', pol.polname, c.relname), '; ') into problem
    from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname = any (new_relations);
  if problem is not null then
    raise exception 'Dropship orders rollback aborted: RLS policies were added after the migration: %', problem;
  end if;

  select string_agg(format('%I in publication %I', c.relname, pub.pubname), '; ') into problem
    from pg_publication_rel pr join pg_publication pub on pub.oid = pr.prpubid
    join pg_class c on c.oid = pr.prrelid join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname = any (new_relations);
  if problem is not null then
    raise exception 'Dropship orders rollback aborted: tables are published (e.g. Realtime): %.', problem;
  end if;

  select count(*) into n from public.dropship_orders;
  raise notice 'Dropship orders rollback: deleting % order(s)', n;
end $$;

-- 1. Functions added by the migration.
drop function public.dropship_admin_cancel_order(text,uuid,text);
drop function public.dropship_admin_reliability(text);
drop function public.dropship_admin_resolve_dispute(text,uuid,text,text,text,text);
drop function public.dropship_admin_set_limit_override(text,text,bigint,bigint,text);
drop function public.dropship_admin_update_settings(text,jsonb,text);
drop function public.dropship_buyer_order_action(text,uuid,text,jsonb);
drop function public.dropship_check_exposure(text,uuid,bigint);
drop function public.dropship_deadline_for(text,timestamp with time zone);
drop function public.dropship_expire_due(integer);
drop function public.dropship_get_order(text,text,uuid);
drop function public.dropship_get_settings();
drop function public.dropship_list_orders(text,text,text,text,timestamp with time zone,uuid,integer);
drop function public.dropship_lock_order(text,text,uuid);
drop function public.dropship_open_dispute(public.dropship_orders,text,text,text,jsonb);
drop function public.dropship_order_cancel_internal(public.dropship_orders,text,text,text,text,jsonb);
drop function public.dropship_order_dispute_json(uuid,text);
drop function public.dropship_order_event(uuid,text,text,text,text,text,text,jsonb);
drop function public.dropship_order_json(public.dropship_orders,text);
drop function public.dropship_order_move(public.dropship_orders,text,text,text,text,text,jsonb);
drop function public.dropship_order_payments_json(uuid,text[]);
drop function public.dropship_order_result(public.dropship_orders,text,boolean,text[]);
drop function public.dropship_order_row_json(public.dropship_orders,text);
drop function public.dropship_order_timeline(uuid,text);
drop function public.dropship_place_order(text,text,text,integer,jsonb,uuid);
drop function public.dropship_release_reservation(uuid,text,text,text);
drop function public.dropship_reliability(text,text,text,text,boolean,uuid,text,jsonb);
drop function public.dropship_reliability_summary(text,text);
drop function public.dropship_require_status(public.dropship_orders,text[]);
drop function public.dropship_reseller_exposure(text);
drop function public.dropship_reseller_limits(text);
drop function public.dropship_reseller_order_action(text,uuid,text,jsonb);
drop function public.dropship_reseller_summary(text);
drop function public.dropship_set_listing_delivery_fee(text,uuid,bigint);
drop function public.dropship_settings();
drop function public.dropship_supplier_order_action(text,uuid,text,jsonb);
drop function public.dropship_supplier_summary(text);

-- 2. Give back held stock.
insert into public.dropship_stock_events
  (supplier_product_id, event_type, delta_on_hand, delta_reserved, on_hand_after, reserved_after, actor, reason)
select id, 'release', 0, -stock_reserved, stock_on_hand, 0, 'rollback', 'orders rollback'
  from public.dropship_supplier_products where stock_reserved > 0;
update public.dropship_supplier_products set stock_reserved = 0 where stock_reserved > 0;

-- 3. Tables (children first).
drop table public.dropship_reliability_events;
drop table public.dropship_delivery_codes;
drop table public.dropship_order_payments;
drop table public.dropship_disputes;
drop table public.dropship_reservations;
drop table public.dropship_order_events;
drop table public.dropship_orders;
drop table public.dropship_reseller_limit_overrides;
drop table public.dropship_order_settings;

-- 4. Phase 3 constraints, with the append-only triggers off for these statements only.
alter table public.dropship_stock_events disable trigger stock_events_immutable;
update public.dropship_stock_events set event_type = 'release' where event_type = 'expire';
alter table public.dropship_stock_events enable trigger stock_events_immutable;
alter table public.dropship_stock_events drop constraint dropship_stock_events_event_type_check;
alter table public.dropship_stock_events add constraint dropship_stock_events_event_type_check
  check (event_type in ('set_on_hand','reserve','release','commit_dispatch','commit_replacement','restock_return',
                        'return_damaged','return_not_received','return_lost'));
alter table public.dropship_audit_events disable trigger audit_events_immutable;
delete from public.dropship_audit_events where target_type in ('order','settings');
alter table public.dropship_audit_events enable trigger audit_events_immutable;
alter table public.dropship_audit_events drop constraint dropship_audit_events_target_type_check;
alter table public.dropship_audit_events add constraint dropship_audit_events_target_type_check
  check (target_type in ('participant','supplier_product','listing'));

-- 5. The functions the migration replaced, exactly as in the Phase 3 migration, then the
--    delivery fee column (dropship_listing_json takes the listings row type, so it is
--    restored first).
create or replace function public.dropship_listing_json(l public.dropship_listings) returns jsonb
language sql stable set search_path = '' as
$$
  select jsonb_build_object(
    'id', l.id, 'supplierProductId', l.supplier_product_id, 'dropshipperId', l.dropshipper_id,
    'productId', l.product_id, 'retailPricePesewas', l.retail_price_pesewas, 'status', l.status,
    'createdAt', l.created_at, 'updatedAt', l.updated_at, 'removedAt', l.removed_at)
$$;

create or replace function public.dropship_list_my_listings(p_actor text) returns jsonb
language sql stable set search_path = '' as
$$
  select jsonb_build_object('listings', coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'productId', l.product_id, 'supplierProductId', l.supplier_product_id,
           'title', sp.title, 'image', sp.images->>0,
           'retailPricePesewas', l.retail_price_pesewas,
           'wholesalePricePesewas', sp.wholesale_price_pesewas,
           'platformFeePesewas', public.dropship_platform_fee_pesewas(l.retail_price_pesewas),
           'estimatedMarginPesewas', l.retail_price_pesewas - public.dropship_platform_fee_pesewas(l.retail_price_pesewas) - sp.wholesale_price_pesewas,
           'minRetailPesewas', public.dropship_min_retail_pesewas(sp.wholesale_price_pesewas),
           'status', l.status, 'effectiveAvailable', a.is_available, 'unavailableReason', a.unavailable_reason,
           'unitsSold', 0, 'createdAt', l.created_at, 'updatedAt', l.updated_at)
         order by l.created_at desc, l.id desc), '[]'::jsonb))
    from public.dropship_listings l
    join public.dropship_supplier_products sp on sp.id = l.supplier_product_id
    join public.dropship_listing_availability a on a.listing_id = l.id
   where l.dropshipper_id = p_actor and l.status <> 'removed'
$$;

create or replace function public.dropship_purchase_info(p_product_id text) returns jsonb
language sql stable set search_path = '' as
$$
  select jsonb_build_object(
           'listingId', l.id,
           'available', a.is_available,
           'unitPricePesewas', l.retail_price_pesewas,
           'maxQuantity', case when a.is_available
                               then greatest(least(sp.max_per_order, sp.stock_on_hand - sp.stock_reserved), 0)
                               else 0 end,
           'deliveryFees', public.dropship_delivery_fees_json(sp),
           'shipsFromRegion', sp.ships_from_region,
           'leadTimeDays', jsonb_build_object('min', sp.lead_time_min_days, 'max', sp.lead_time_max_days),
           'returnWindowDays', sp.return_window_days,
           'returnPolicyText', 'Report damaged or wrong items within ' || sp.return_window_days
                               || ' days of delivery. Report a missing delivery until your order is settled.',
           'seller', jsonb_build_object('id', l.dropshipper_id,
                                        'storeName', coalesce(dsp.display_name, (select u.username from public.users u where u.id = l.dropshipper_id))))
         || case when a.is_available then '{}'::jsonb
                 else jsonb_build_object('unavailableReason',
                        case when a.unavailable_reason = 'out_of_stock' then 'out_of_stock' else 'unavailable' end) end
    from public.dropship_listings l
    join public.dropship_supplier_products sp on sp.id = l.supplier_product_id
    join public.dropship_listing_availability a on a.listing_id = l.id
    left join public.dropship_participants dsp on dsp.user_id = l.dropshipper_id and dsp.kind = 'dropshipper'
   where l.product_id = p_product_id and l.status <> 'removed'
$$;

create or replace function public.dropship_user_has_records(p_user text) returns boolean
language sql stable set search_path = '' as
$$
  select exists (select 1 from public.dropship_participants where user_id = p_user)
      or exists (select 1 from public.dropship_listings where dropshipper_id = p_user)
      or exists (select 1 from public.dropship_supplier_products where supplier_id = p_user)
$$;

alter table public.dropship_listings drop column delivery_fee_pesewas;

commit;
