-- TedBuy Dropship Phase 3: reseller listings, pricing, catalogue, availability, media protection.
--
-- Source design: DATABASE_DESIGN v0.2.3 §0, §3.5, §5.1, §5.2; ARCHITECTURE §2.1, §2.2;
-- API_SPEC §1 (purchase-info), §3, Appendix A.3; PAYMENTS_AND_FINANCIALS §3.
-- Requires: 20261026120000_dropship_supplier_catalogue.sql (applied first).
-- Scope: dropship_listings and their mirror rows in public.products, pricing quote, the
-- dropshipper catalogue, listing availability, the media-protection check, account
-- deletion clean-up. No orders, payments or payouts.
--
-- Function template: as the Phase 2 migration (no SECURITY DEFINER; search_path '' with
-- schema-qualified names; lock_timeout 5 s on writes; EXECUTE revoked from public, anon and
-- authenticated and granted to service_role only, by the loop at the end).
--
-- The listing mirror row (ARCHITECTURE §2.1, RN-05): every listing owns one public.products
-- row with id 'dsl_' || the listing id without hyphens, written only by these functions and
-- only with baseline products columns (products gets no new column).
--
-- Locking (DB §5.1, §5.2): global order listing -> supplier product -> products mirror row
-- -> participant. Rows to change are locked FOR NO KEY UPDATE, rows only read FOR SHARE;
-- never FOR UPDATE. Two statements take a FOR UPDATE-strength lock implicitly, as the
-- design requires: the DELETE of a mirror row and setting dropship_listings.product_id to
-- null when a listing is removed (product_id is a unique column); nothing references a
-- listing row yet (no orders in this phase).
--
-- Pilot pricing (D3, D10, N6): fee 0 bps, minimum margin 100 pesewas per unit, no maximum
-- markup, at most 10 live listings per supplier product, all in dropship_pricing_config().
-- The dated fee-change system (dropship_config_versions) is not built in this phase.

-- ---------------------------------------------------------------------------------------
-- Preconditions
-- ---------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.dropship_supplier_products') is null then
    raise exception 'Dropship Phase 3 needs the Phase 2 migration 20261026120000_dropship_supplier_catalogue.sql applied first';
  end if;
  -- Evidence E8: the dsl_ prefix must be unused by legacy rows.
  if exists (select 1 from public.products where id ilike 'dsl\_%') then
    raise exception 'public.products already has ids starting with dsl_; the prefix is reserved for Dropship listings';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- Tables (DB §3.5)
-- ---------------------------------------------------------------------------------------
create table public.dropship_listings (
  id                     uuid primary key default gen_random_uuid(),
  supplier_product_id    uuid not null references public.dropship_supplier_products(id) on delete restrict,
  dropshipper_id         text not null references public.users(id) on delete restrict,
  product_id             text unique references public.products(id) on delete restrict, -- null once removed
  client_request_id      uuid,
  retail_price_pesewas   bigint not null check (retail_price_pesewas > 0),
  status                 text not null default 'active' check (status in ('active','paused','removed')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  removed_at             timestamptz,
  unique (dropshipper_id, client_request_id)
);
create unique index dl_one_live_per_dropshipper
  on public.dropship_listings (dropshipper_id, supplier_product_id) where status <> 'removed';
create index on public.dropship_listings (supplier_product_id) where status <> 'removed';
create index on public.dropship_listings (dropshipper_id, status);

-- Keyset index for the dropshipper catalogue (created_at desc, id desc).
create index dsp_catalogue_created_idx on public.dropship_supplier_products (created_at desc, id desc) where status = 'active';

-- Listings are audited too.
alter table public.dropship_audit_events drop constraint dropship_audit_events_target_type_check;
alter table public.dropship_audit_events add constraint dropship_audit_events_target_type_check
  check (target_type in ('participant','supplier_product','listing'));

-- ---------------------------------------------------------------------------------------
-- Pricing (PAYMENTS §3), integer pesewas
-- ---------------------------------------------------------------------------------------
create function public.dropship_pricing_config() returns jsonb
language sql stable set search_path = '' as
$$ select jsonb_build_object('platformFeeBps', 0, 'minMarginPesewas', 100, 'maxListingsPerSupplierProduct', 10) $$;

-- R >= ceil((W + m) * 10000 / (10000 - f))
create function public.dropship_min_retail_pesewas(p_wholesale bigint) returns bigint
language sql stable set search_path = '' as
$$
  select ((p_wholesale + (c->>'minMarginPesewas')::bigint) * 10000 + (10000 - (c->>'platformFeeBps')::bigint) - 1)
         / (10000 - (c->>'platformFeeBps')::bigint)
    from (select public.dropship_pricing_config() as c) cfg
$$;

-- round_half_up(R * f / 10000)
create function public.dropship_platform_fee_pesewas(p_retail bigint) returns bigint
language sql stable set search_path = '' as
$$
  select (p_retail * (c->>'platformFeeBps')::bigint + 5000) / 10000
    from (select public.dropship_pricing_config() as c) cfg
$$;

-- Display price for products.price: GH¢ as plain numeric text ('150', '150.5').
create function public.dropship_price_text(p_pesewas bigint) returns text
language sql immutable set search_path = '' as
$$ select trim_scale(p_pesewas / 100.0)::text $$;

-- ---------------------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------------------
create function public.dropship_listing_json(l public.dropship_listings) returns jsonb
language sql stable set search_path = '' as
$$
  select jsonb_build_object(
    'id', l.id, 'supplierProductId', l.supplier_product_id, 'dropshipperId', l.dropshipper_id,
    'productId', l.product_id, 'retailPricePesewas', l.retail_price_pesewas, 'status', l.status,
    'createdAt', l.created_at, 'updatedAt', l.updated_at, 'removedAt', l.removed_at)
$$;

-- Legacy account restrictions (same rule as the Node gate). A missing user is unavailable.
create function public.dropship_user_unavailable(p_user text) returns boolean
language sql stable set search_path = '' as
$$
  select coalesce((select coalesce(u."isSuspended", false) or coalesce(u."securityHold", false)
                          or coalesce(u."isDeleted", false) or coalesce(u.status, '') in ('suspended','deleted')
                     from public.users u where u.id = p_user), true)
$$;

create function public.dropship_delivery_fees_json(sp public.dropship_supplier_products) returns jsonb
language sql stable set search_path = '' as
$$
  select jsonb_build_array(jsonb_build_object('scope', 'same_region', 'regionNote', 'Within ' || sp.ships_from_region,
                                              'feePesewas', sp.delivery_fee_same_region_pesewas))
      || case when sp.delivery_fee_other_region_pesewas is null then '[]'::jsonb
              else jsonb_build_array(jsonb_build_object('scope', 'other_region', 'regionNote', 'Outside ' || sp.ships_from_region,
                                                        'feePesewas', sp.delivery_fee_other_region_pesewas)) end
$$;

create function public.dropship_check_listing_actor(p_actor text, p_actor_role text, p_reason text) returns void
language plpgsql set search_path = '' as
$$
begin
  if p_actor is null or char_length(p_actor) = 0 then
    perform public.dropship_fail('VALIDATION', 'actor is required');
  end if;
  if p_actor_role is null or p_actor_role not in ('dropshipper','admin') then
    perform public.dropship_fail('VALIDATION', 'actor role must be dropshipper or admin');
  end if;
  if p_actor_role = 'admin' and (p_reason is null or char_length(btrim(p_reason)) < 3) then
    perform public.dropship_fail('VALIDATION', 'a reason is required for admin changes');
  end if;
end $$;

-- Locks the dropshipper's participation FOR SHARE (class 7) and requires it to be approved.
create function public.dropship_require_approved_dropshipper(p_user text) returns void
language plpgsql set search_path = '' as
$$
declare v_status text;
begin
  select status into v_status from public.dropship_participants
   where user_id = p_user and kind = 'dropshipper'
   for share;
  if v_status is null or v_status in ('pending','rejected','revoked') then
    perform public.dropship_fail('NOT_APPROVED', 'dropshipper participation is ' || coalesce(v_status, 'missing'));
  elsif v_status = 'suspended' then
    perform public.dropship_fail('FULFILMENT_ONLY', 'dropshipper participation is suspended');
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- Availability (DB §3.5, A-04): one row per live listing with the precise internal reason.
-- Security invoker: callers need their own privileges (service_role only).
-- ---------------------------------------------------------------------------------------
create view public.dropship_listing_availability with (security_invoker = true) as
select l.id as listing_id, l.product_id, l.supplier_product_id, l.dropshipper_id,
       r.reason is null as is_available, r.reason as unavailable_reason
  from public.dropship_listings l
  join public.dropship_supplier_products sp on sp.id = l.supplier_product_id
  left join public.dropship_participants sup on sup.user_id = sp.supplier_id and sup.kind = 'supplier'
  left join public.dropship_participants dsp on dsp.user_id = l.dropshipper_id and dsp.kind = 'dropshipper'
  left join public.users su on su.id = sp.supplier_id
  left join public.users du on du.id = l.dropshipper_id
  cross join lateral (
    select case
      when l.status = 'paused' then 'listing_paused'
      when sp.status <> 'active' then 'product_inactive'
      when sup.status is distinct from 'approved' or dsp.status is distinct from 'approved'
        or su.id is null or du.id is null
        or coalesce(su."isSuspended", false) or coalesce(su."securityHold", false) or coalesce(su."isDeleted", false)
        or coalesce(su.status, '') in ('suspended','deleted')
        or coalesce(du."isSuspended", false) or coalesce(du."securityHold", false) or coalesce(du."isDeleted", false)
        or coalesce(du.status, '') in ('suspended','deleted')
        then 'participant_unavailable'
      when l.retail_price_pesewas < public.dropship_min_retail_pesewas(sp.wholesale_price_pesewas) then 'price_below_minimum'
      when sp.stock_on_hand - sp.stock_reserved <= 0 then 'out_of_stock'
    end as reason
  ) r
 where l.status <> 'removed';

-- ---------------------------------------------------------------------------------------
-- #6 Participation application (user): suppliers and, from Phase 3, dropshippers.
-- Replaces the Phase 2 version; only the kind check and the address rule change.
-- Locks: participant (class 7) only (rule M7).
-- ---------------------------------------------------------------------------------------
create or replace function public.dropship_submit_application(p_user text, p_kind text, p_fields jsonb, p_client_request_id uuid)
returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_row public.dropship_participants;
begin
  if p_kind is null or p_kind not in ('supplier','dropshipper') then
    perform public.dropship_fail('VALIDATION', 'kind must be supplier or dropshipper');
  end if;
  if p_client_request_id is null then
    perform public.dropship_fail('VALIDATION', 'clientRequestId is required');
  end if;
  if p_kind = 'supplier' and coalesce(btrim(p_fields->>'addressLine'), '') = '' then
    perform public.dropship_fail('VALIDATION', 'addressLine is required for suppliers');
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
-- #12 Update supplier product content and prices. Replaces the Phase 2 version: content
-- changes are copied to the mirror rows of the product's live listings in the same
-- transaction.
-- Locks: supplier product NKU (6) -> products mirror rows NKU (6b, ascending id, content
-- changes only) -> participant FOR SHARE (7).
-- ---------------------------------------------------------------------------------------
create or replace function public.dropship_update_supplier_product(p_actor text, p_actor_role text, p_id uuid, p_fields jsonb,
                                                                    p_expected_content_version integer, p_reason text)
returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_row public.dropship_supplier_products;
  v_price_changed boolean;
  v_content boolean;
  v_mirrors integer := 0;
begin
  perform public.dropship_check_actor(p_actor, p_actor_role, p_reason);
  perform public.dropship_check_product_fields(p_fields);
  v_row := public.dropship_lock_product_for_actor(p_actor, p_actor_role, p_id);

  -- Fields copied to the listing mirror rows (ARCHITECTURE §2.1).
  v_content := p_fields ?| array['title','description','category','condition','brand','images','shipsFromCity'];
  if v_content then
    perform 1 from public.products
     where id in (select l.product_id from public.dropship_listings l
                   where l.supplier_product_id = v_row.id and l.status <> 'removed')
     order by id
     for no key update;
  end if;

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

  if v_content then
    update public.products set
      title = v_row.title, description = v_row.description, category = v_row.category,
      condition = v_row.condition, brand = v_row.brand, images = v_row.images, location = v_row.ships_from_city
    where id in (select l.product_id from public.dropship_listings l
                  where l.supplier_product_id = v_row.id and l.status <> 'removed');
    get diagnostics v_mirrors = row_count;
  end if;

  perform public.dropship_audit(p_actor, p_actor_role, 'supplier_product_updated', 'supplier_product', v_row.id, p_reason,
                                jsonb_build_object('fields', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p_fields) k),
                                                   'priceChanged', v_price_changed, 'mirrorRowsUpdated', v_mirrors));
  return jsonb_build_object('product', public.dropship_supplier_product_json(v_row));
end $$;

-- ---------------------------------------------------------------------------------------
-- Pricing quote (approved dropshippers).
-- ---------------------------------------------------------------------------------------
create function public.dropship_quote(p_viewer text, p_supplier_product_id uuid, p_retail_pesewas bigint)
returns jsonb
language plpgsql stable set search_path = '' as
$$
declare
  v_sp public.dropship_supplier_products;
  v_min bigint;
  v_fee bigint;
  v_retail bigint := coalesce(p_retail_pesewas, 0);
  v_out jsonb;
begin
  if not exists (select 1 from public.dropship_participants
                  where user_id = p_viewer and kind = 'dropshipper' and status = 'approved') then
    perform public.dropship_fail('NOT_APPROVED', 'only approved dropshippers can get a quote');
  end if;
  select * into v_sp from public.dropship_supplier_products where id = p_supplier_product_id;
  if v_sp.id is null or v_sp.published_at is null then
    perform public.dropship_fail('NOT_FOUND', 'supplier product not found');
  end if;

  v_min := public.dropship_min_retail_pesewas(v_sp.wholesale_price_pesewas);
  v_fee := public.dropship_platform_fee_pesewas(v_retail);
  v_out := jsonb_build_object('valid', p_retail_pesewas is not null and p_retail_pesewas >= v_min,
                              'platformFeePesewas', v_fee,
                              'estimatedMarginPesewas', v_retail - v_fee - v_sp.wholesale_price_pesewas,
                              'minRetailPesewas', v_min);
  if p_retail_pesewas is null then
    v_out := v_out || jsonb_build_object('reason', 'not_integer');
  elsif p_retail_pesewas < v_min then
    v_out := v_out || jsonb_build_object('reason', 'below_minimum');
  end if;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------------------
-- #16 Create a listing (approved dropshipper). Idempotent on clientRequestId; an existing
-- live listing of the same supplier product is returned instead of a second one (C-08).
-- Locks: supplier product FOR SHARE (6) -> participants FOR SHARE (7, ascending id) ->
-- inserts (the listing insert is the only step that can wait on a unique key, M8).
-- ---------------------------------------------------------------------------------------
create function public.dropship_create_listing(p_actor text, p_supplier_product_id uuid, p_retail_pesewas bigint,
                                               p_client_request_id uuid)
returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_l public.dropship_listings;
  v_sp public.dropship_supplier_products;
  v_sup_status text;
  v_live integer;
  v_id uuid;
  v_pid text;
begin
  if p_actor is null or char_length(p_actor) = 0 then
    perform public.dropship_fail('VALIDATION', 'actor is required');
  end if;
  if p_client_request_id is null then
    perform public.dropship_fail('VALIDATION', 'clientRequestId is required');
  end if;
  if p_supplier_product_id is null then
    perform public.dropship_fail('VALIDATION', 'supplierProductId is required');
  end if;
  if p_retail_pesewas is null then
    perform public.dropship_fail('VALIDATION', 'retailPricePesewas is required');
  end if;

  -- Idempotent replay, then an existing live listing of the same supplier product.
  select * into v_l from public.dropship_listings
   where dropshipper_id = p_actor and client_request_id = p_client_request_id;
  if v_l.id is null then
    select * into v_l from public.dropship_listings
     where dropshipper_id = p_actor and supplier_product_id = p_supplier_product_id and status <> 'removed';
  end if;
  if v_l.id is not null then
    return jsonb_build_object('listing', public.dropship_listing_json(v_l), 'productId', v_l.product_id, 'created', false);
  end if;

  select * into v_sp from public.dropship_supplier_products where id = p_supplier_product_id for share;
  if v_sp.id is null then
    perform public.dropship_fail('NOT_FOUND', 'supplier product not found');
  end if;
  if v_sp.supplier_id = p_actor then
    perform public.dropship_fail('FORBIDDEN', 'you cannot list your own supplier product');
  end if;

  perform 1 from public.dropship_participants
   where (user_id = p_actor and kind = 'dropshipper') or (user_id = v_sp.supplier_id and kind = 'supplier')
   order by id
   for share;
  perform public.dropship_require_approved_dropshipper(p_actor);

  if v_sp.status <> 'active' then
    perform public.dropship_fail('STATE_CONFLICT', 'this product is not available to list');
  end if;
  select status into v_sup_status from public.dropship_participants
   where user_id = v_sp.supplier_id and kind = 'supplier';
  if v_sup_status is distinct from 'approved' or public.dropship_user_unavailable(v_sp.supplier_id) then
    perform public.dropship_fail('STATE_CONFLICT', 'this product is not available to list');
  end if;
  if p_retail_pesewas < public.dropship_min_retail_pesewas(v_sp.wholesale_price_pesewas) then
    perform public.dropship_fail('PRICE_INVALID', 'retail price is below the minimum of '
                                 || public.dropship_min_retail_pesewas(v_sp.wholesale_price_pesewas) || ' pesewas');
  end if;

  select count(*) into v_live from public.dropship_listings
   where supplier_product_id = v_sp.id and status <> 'removed';
  if v_live >= (public.dropship_pricing_config()->>'maxListingsPerSupplierProduct')::integer then
    perform public.dropship_fail('STATE_CONFLICT', 'this product has reached its listing limit');
  end if;

  v_id := gen_random_uuid();
  insert into public.dropship_listings (id, supplier_product_id, dropshipper_id, client_request_id, retail_price_pesewas)
  values (v_id, v_sp.id, p_actor, p_client_request_id, p_retail_pesewas)
  on conflict do nothing
  returning * into v_l;

  if v_l.id is null then
    -- A concurrent request for the same clientRequestId or supplier product committed first.
    select * into v_l from public.dropship_listings
     where dropshipper_id = p_actor
       and (client_request_id = p_client_request_id or (supplier_product_id = v_sp.id and status <> 'removed'))
     order by (client_request_id = p_client_request_id) desc
     limit 1;
    if v_l.id is null then
      perform public.dropship_fail('STATE_CONFLICT', 'the listing could not be created; retry');
    end if;
    return jsonb_build_object('listing', public.dropship_listing_json(v_l), 'productId', v_l.product_id, 'created', false);
  end if;

  v_pid := 'dsl_' || replace(v_id::text, '-', '');
  insert into public.products
    (id, title, description, price, category, location, images, brand, condition, negotiable,
     "sellerId", "sellerName", "createdAt", status, "isApproved")
  values
    (v_pid, v_sp.title, v_sp.description, public.dropship_price_text(p_retail_pesewas), v_sp.category,
     v_sp.ships_from_city, v_sp.images, v_sp.brand, v_sp.condition, false,
     p_actor, (select u.username from public.users u where u.id = p_actor),
     to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'active', true);

  update public.dropship_listings set product_id = v_pid where id = v_id
  returning * into v_l;

  perform public.dropship_audit(p_actor, 'dropshipper', 'listing_created', 'listing', v_l.id, null,
                                jsonb_build_object('supplierProductId', v_sp.id, 'productId', v_pid,
                                                   'retailPricePesewas', p_retail_pesewas));
  return jsonb_build_object('listing', public.dropship_listing_json(v_l), 'productId', v_pid, 'created', true);
end $$;

-- ---------------------------------------------------------------------------------------
-- #17 Change a listing's retail price and/or status (active|paused). Null = unchanged.
-- Locks: listing NKU (5) -> supplier product FOR SHARE (6) -> products mirror row NKU (6b)
-- -> participant FOR SHARE (7, dropshipper raising or activating only).
-- ---------------------------------------------------------------------------------------
create function public.dropship_update_listing(p_actor text, p_actor_role text, p_listing_id uuid,
                                               p_retail_pesewas bigint, p_status text, p_reason text)
returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_l public.dropship_listings;
  v_sp public.dropship_supplier_products;
  v_from jsonb;
  v_min bigint;
begin
  perform public.dropship_check_listing_actor(p_actor, p_actor_role, p_reason);
  if p_status is not null and p_status not in ('active','paused') then
    perform public.dropship_fail('VALIDATION', 'status must be active or paused');
  end if;
  if p_retail_pesewas is null and p_status is null then
    perform public.dropship_fail('VALIDATION', 'nothing to change');
  end if;

  select * into v_l from public.dropship_listings where id = p_listing_id for no key update;
  if v_l.id is null or (p_actor_role = 'dropshipper' and v_l.dropshipper_id <> p_actor) then
    perform public.dropship_fail('NOT_FOUND', 'listing not found');
  end if;
  if v_l.status = 'removed' then
    perform public.dropship_fail('STATE_CONFLICT', 'removed listings cannot be changed');
  end if;

  select * into v_sp from public.dropship_supplier_products where id = v_l.supplier_product_id for share;
  v_min := public.dropship_min_retail_pesewas(v_sp.wholesale_price_pesewas);
  if p_retail_pesewas is not null and p_retail_pesewas < v_min then
    perform public.dropship_fail('PRICE_INVALID', 'retail price is below the minimum of ' || v_min || ' pesewas');
  end if;

  perform 1 from public.products where id = v_l.product_id for no key update;

  if p_actor_role = 'dropshipper' and (p_retail_pesewas is not null or p_status = 'active') then
    perform public.dropship_require_approved_dropshipper(p_actor);
  end if;

  v_from := jsonb_build_object('retailPricePesewas', v_l.retail_price_pesewas, 'status', v_l.status);
  update public.dropship_listings set
    retail_price_pesewas = coalesce(p_retail_pesewas, retail_price_pesewas),
    status = coalesce(p_status, status),
    updated_at = now()
  where id = v_l.id
  returning * into v_l;

  if p_retail_pesewas is not null then
    update public.products set price = public.dropship_price_text(v_l.retail_price_pesewas)
    where id = v_l.product_id;
  end if;

  perform public.dropship_audit(p_actor, p_actor_role, 'listing_updated', 'listing', v_l.id, p_reason,
                                jsonb_build_object('from', v_from,
                                                   'to', jsonb_build_object('retailPricePesewas', v_l.retail_price_pesewas, 'status', v_l.status)));
  return jsonb_build_object('listing', public.dropship_listing_json(v_l));
end $$;

-- ---------------------------------------------------------------------------------------
-- #18 Remove a listing (owner or admin): status removed, product_id null, mirror row deleted.
-- Media is never deleted here (C-17). Removing a removed listing is a no-op.
-- Locks: listing NKU (5) -> products mirror row (6b, the DELETE).
-- ---------------------------------------------------------------------------------------
create function public.dropship_remove_listing(p_actor text, p_actor_role text, p_listing_id uuid, p_reason text)
returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_l public.dropship_listings;
  v_pid text;
begin
  perform public.dropship_check_listing_actor(p_actor, p_actor_role, p_reason);
  select * into v_l from public.dropship_listings where id = p_listing_id for no key update;
  if v_l.id is null or (p_actor_role = 'dropshipper' and v_l.dropshipper_id <> p_actor) then
    perform public.dropship_fail('NOT_FOUND', 'listing not found');
  end if;
  if v_l.status = 'removed' then
    return jsonb_build_object('listing', public.dropship_listing_json(v_l), 'changed', false);
  end if;

  v_pid := v_l.product_id;
  update public.dropship_listings set
    status = 'removed', removed_at = now(), product_id = null, updated_at = now()
  where id = v_l.id
  returning * into v_l;
  delete from public.products where id = v_pid;

  perform public.dropship_audit(p_actor, p_actor_role, 'listing_removed', 'listing', v_l.id, p_reason,
                                jsonb_build_object('productId', v_pid));
  return jsonb_build_object('listing', public.dropship_listing_json(v_l), 'changed', true);
end $$;

-- ---------------------------------------------------------------------------------------
-- Account deletion clean-up: removes every live listing of the user (mirror rows deleted,
-- media kept) and archives every non-archived supplier product of the user. Returns the
-- number of listings removed. Audited as the user, with the caller's reason.
-- Locks: the user's listings NKU (5, ascending id) -> the user's supplier products NKU
-- (6, ascending id) -> mirror rows (6b, the DELETEs).
-- ---------------------------------------------------------------------------------------
create function public.dropship_remove_user_listings(p_user text, p_reason text)
returns integer
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_l public.dropship_listings;
  v_sp public.dropship_supplier_products;
  v_pid text;
  v_n integer := 0;
  v_from text;
begin
  if p_user is null or char_length(p_user) = 0 then
    perform public.dropship_fail('VALIDATION', 'user is required');
  end if;

  perform 1 from public.dropship_listings
   where dropshipper_id = p_user and status <> 'removed' order by id for no key update;
  perform 1 from public.dropship_supplier_products
   where supplier_id = p_user and status <> 'archived' order by id for no key update;

  for v_l in select * from public.dropship_listings
              where dropshipper_id = p_user and status <> 'removed' order by id loop
    v_pid := v_l.product_id;
    update public.dropship_listings set
      status = 'removed', removed_at = now(), product_id = null, updated_at = now()
    where id = v_l.id;
    delete from public.products where id = v_pid;
    perform public.dropship_audit(p_user, 'user', 'listing_removed', 'listing', v_l.id, p_reason,
                                  jsonb_build_object('productId', v_pid, 'source', 'account_deletion'));
    v_n := v_n + 1;
  end loop;

  for v_sp in select * from public.dropship_supplier_products
               where supplier_id = p_user and status <> 'archived' order by id loop
    v_from := v_sp.status;
    update public.dropship_supplier_products set status = 'archived', updated_at = now()
    where id = v_sp.id;
    perform public.dropship_audit(p_user, 'user', 'supplier_product_status', 'supplier_product', v_sp.id, p_reason,
                                  jsonb_build_object('from', v_from, 'to', 'archived', 'source', 'account_deletion'));
  end loop;

  return v_n;
end $$;

-- ---------------------------------------------------------------------------------------
-- Read functions (no locks)
-- ---------------------------------------------------------------------------------------

-- Legacy read paths: every live listing's mirror row id, which of them to hide, and the
-- supplier product of each (for the per-response cap of 2 per supplier product).
create function public.dropship_hidden_product_ids() returns jsonb
language sql stable set search_path = '' as
$$
  select jsonb_build_object(
    'hidden', coalesce(jsonb_agg(a.product_id order by a.product_id) filter (where not a.is_available), '[]'::jsonb),
    'supplierProductOf', coalesce(jsonb_object_agg(a.product_id, a.supplier_product_id), '{}'::jsonb))
    from public.dropship_listing_availability a
   where a.product_id is not null
$$;

-- The URLs (of p_urls, in order) that legacy code must never delete: any URL in any
-- supplier product's images, whatever its status (ARCHITECTURE §2.2).
create function public.dropship_is_protected_media(p_urls text[]) returns text[]
language sql stable set search_path = '' as
$$
  select coalesce(array_agg(t.u order by t.i), '{}'::text[])
    from unnest(p_urls) with ordinality as t(u, i)
   where t.u is not null
     and exists (select 1 from public.dropship_supplier_products sp where sp.images @> jsonb_build_array(t.u))
$$;

-- Shared by dropship_catalogue and dropship_catalogue_item: who may see a supplier product
-- in the catalogue, and how an item is projected (full for approved dropshippers, else teaser).
create function public.dropship_catalogue_eligible(sp public.dropship_supplier_products) returns boolean
language sql stable set search_path = '' as
$$
  select sp.status = 'active'
     and exists (select 1 from public.dropship_participants sup
                  where sup.user_id = sp.supplier_id and sup.kind = 'supplier' and sup.status = 'approved')
     and not public.dropship_user_unavailable(sp.supplier_id)
$$;

create function public.dropship_catalogue_item_json(sp public.dropship_supplier_products, p_viewer text, p_full boolean)
returns jsonb
language sql stable set search_path = '' as
$$
  select case when p_full then jsonb_build_object(
             'supplierProductId', sp.id, 'title', sp.title, 'images', sp.images, 'category', sp.category,
             'condition', sp.condition, 'brand', sp.brand,
             'wholesalePricePesewas', sp.wholesale_price_pesewas,
             'suggestedRetailPesewas', sp.suggested_retail_pesewas,
             'minRetailPesewas', public.dropship_min_retail_pesewas(sp.wholesale_price_pesewas),
             'available', sp.stock_on_hand - sp.stock_reserved > 0,
             'leadTimeDays', jsonb_build_object('min', sp.lead_time_min_days, 'max', sp.lead_time_max_days),
             'shipsFromRegion', sp.ships_from_region,
             'deliveryFees', public.dropship_delivery_fees_json(sp),
             'returnWindowDays', sp.return_window_days,
             'alreadyListed', exists (select 1 from public.dropship_listings l
                                       where l.supplier_product_id = sp.id and l.dropshipper_id = p_viewer and l.status <> 'removed'),
             'listingCount', (select count(*) from public.dropship_listings l
                               where l.supplier_product_id = sp.id and l.status <> 'removed'))
           else jsonb_build_object('supplierProductId', sp.id, 'title', sp.title, 'images', sp.images, 'category', sp.category)
         end
$$;

-- Dropshipper catalogue (API §3, A.3). Approved dropshippers get full items; every other
-- viewer gets a teaser (supplierProductId, title, images, category). Supplier identity is
-- never included (D7). Keyset on (created_at desc, id desc); out-of-stock items are listed.
create function public.dropship_catalogue(p_viewer text, p_category text, p_q text, p_after_created timestamptz,
                                          p_after_id uuid, p_limit integer)
returns jsonb
language plpgsql stable set search_path = '' as
$$
declare
  v_full boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 50);
  v_q text := nullif(btrim(p_q), '');
  v_ids uuid[];
  v_items jsonb;
  v_next jsonb := null;
begin
  v_full := exists (select 1 from public.dropship_participants
                     where user_id = p_viewer and kind = 'dropshipper' and status = 'approved');
  if v_q is not null then
    v_q := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  select coalesce(array_agg(pg.id order by pg.created_at desc, pg.id desc), '{}') into v_ids
    from (select sp.id, sp.created_at from public.dropship_supplier_products sp
           where public.dropship_catalogue_eligible(sp)
             and (p_category is null or sp.category = p_category)
             and (v_q is null or sp.title ilike v_q or coalesce(sp.brand, '') ilike v_q)
             and (p_after_created is null or p_after_id is null or (sp.created_at, sp.id) < (p_after_created, p_after_id))
           order by sp.created_at desc, sp.id desc
           limit v_limit + 1) pg;

  if cardinality(v_ids) > v_limit then
    v_ids := v_ids[1:v_limit];
    select jsonb_build_object('afterCreated', sp.created_at, 'afterId', sp.id) into v_next
      from public.dropship_supplier_products sp where sp.id = v_ids[v_limit];
  end if;

  select coalesce(jsonb_agg(public.dropship_catalogue_item_json(sp, p_viewer, v_full) order by o.n), '[]'::jsonb) into v_items
    from unnest(v_ids) with ordinality as o(id, n)
    join public.dropship_supplier_products sp on sp.id = o.id;

  return jsonb_build_object('items', v_items, 'nextCursor', v_next);
end $$;

-- One catalogue item, limit-independent; null when absent or not eligible for the catalogue.
create function public.dropship_catalogue_item(p_viewer text, p_supplier_product_id uuid) returns jsonb
language sql stable set search_path = '' as
$$
  select public.dropship_catalogue_item_json(sp, p_viewer,
           exists (select 1 from public.dropship_participants
                    where user_id = p_viewer and kind = 'dropshipper' and status = 'approved'))
    from public.dropship_supplier_products sp
   where sp.id = p_supplier_product_id and public.dropship_catalogue_eligible(sp)
$$;

-- The dropshipper's live listings with the precise internal unavailable reason (A-04).
create function public.dropship_list_my_listings(p_actor text) returns jsonb
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

-- Public purchase information for a mirror row (API §1). Null when the id is not a live
-- listing. Customers see only 'out_of_stock' or 'unavailable' (A-04); no supplier identity.
create function public.dropship_purchase_info(p_product_id text) returns jsonb
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

-- ---------------------------------------------------------------------------------------
-- Grants and RLS (DB §2, §8): only service_role may touch Dropship objects.
-- ---------------------------------------------------------------------------------------
alter table public.dropship_listings enable row level security;
revoke all on table public.dropship_listings, public.dropship_listing_availability from public, anon, authenticated;
grant select, insert, update on table public.dropship_listings to service_role;
grant select on table public.dropship_listing_availability to service_role;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'dropship\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
