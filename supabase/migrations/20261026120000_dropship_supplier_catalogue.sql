-- TedBuy Dropship: supplier participation and supplier catalogue (first slice).
--
-- Source design: DATABASE_DESIGN v0.2.3 §2, §3.2-3.4, §5 (#6, #8, #11-#15), §5.1, §8.
-- Scope: participants, supplier products, stock events, a Dropship audit table, and the
-- functions that change them. No orders, payments, refunds, payouts or settlements.
--
-- Deviation from the design: admin writes are audited in dropship_audit_events (same
-- transaction, so a failed audit insert fails the write) instead of admin_audit_logs,
-- because admin_audit_logs is approved but not confirmed to exist in any database.
--
-- Locking (v0.2.3 self-audit constraints):
--   * Every function runs in one transaction at the default READ COMMITTED level and is
--     VOLATILE, so each statement sees rows committed before it (needed by the re-checks).
--   * Lock order follows DB §5.2: supplier product (class 6) before participant (class 7).
--   * Rows to change are locked FOR NO KEY UPDATE; rows only read are locked FOR SHARE.
--   * No function updates a column of a non-partial unique index (supplier_id,
--     client_request_id, user_id, kind), so no UPDATE here needs an implicit FOR UPDATE
--     lock (self-audit F1). Nothing is deleted.
--   * lock_timeout is 5 s per function.
--
-- Apply only to a local or staging database. Never apply to production before the owner
-- has completed evidence E1-E10 (DATABASE_DESIGN §10).

-- ---------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------

create table public.dropship_participants (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  text not null references public.users(id) on delete restrict,
  kind                     text not null check (kind in ('supplier','dropshipper')),
  status                   text not null default 'pending'
                           check (status in ('pending','approved','rejected','suspended','revoked')),
  status_changed_at        timestamptz not null default now(),
  status_reason            text,
  display_name             text not null check (char_length(display_name) between 2 and 80),
  contact_phone            text not null check (contact_phone ~ '^\+?[0-9]{9,15}$'),
  region                   text not null check (char_length(region) between 2 and 60),
  city                     text not null check (char_length(city) between 2 and 60),
  address_line             text check (address_line is null or char_length(address_line) <= 200),
  business_reg_no          text check (business_reg_no is null or char_length(business_reg_no) <= 60),
  payout_method            text check (payout_method in ('momo','bank')),
  payout_provider          text,
  payout_account_no        text,
  payout_account_name      text,
  payout_details_changed_at timestamptz,
  payout_hold              boolean not null default false,
  payout_hold_reason       text,
  identity_verified        boolean not null default false,
  identity_doc_type        text check (identity_doc_type in ('ghana_card')),
  identity_last4           text check (identity_last4 ~ '^[0-9]{4}$'),
  identity_hmac            text,
  identity_hmac_key_version integer,
  identity_verified_at     timestamptz,
  identity_verified_by     text,
  identity_note            text,
  application              jsonb not null default '{}'::jsonb,
  client_request_id        uuid,
  terms_version            text not null check (char_length(terms_version) between 1 and 40),
  terms_accepted_at        timestamptz not null,
  reviewed_by              text,
  reviewed_at              timestamptz,
  admin_notes              text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (user_id, kind),
  constraint identity_complete check (not identity_verified or (identity_last4 is not null and identity_verified_at is not null and identity_verified_by is not null)),
  constraint supplier_needs_address check (kind <> 'supplier' or address_line is not null)
);
create index on public.dropship_participants (status, kind, created_at);
create index on public.dropship_participants (identity_hmac) where identity_hmac is not null;

create table public.dropship_supplier_products (
  id                          uuid primary key default gen_random_uuid(),
  supplier_id                 text not null references public.users(id) on delete restrict,
  client_request_id           uuid,
  title                       text not null check (char_length(title) between 3 and 128),
  description                 text not null check (char_length(description) between 10 and 5000),
  category                    text not null check (char_length(category) between 2 and 60),
  condition                   text not null default 'Brand New' check (char_length(condition) between 2 and 40),
  brand                       text check (brand is null or char_length(brand) <= 60),
  images                      jsonb not null check (jsonb_typeof(images) = 'array' and jsonb_array_length(images) between 1 and 10),
  wholesale_price_pesewas     bigint not null check (wholesale_price_pesewas > 0 and wholesale_price_pesewas <= 100000000),
  suggested_retail_pesewas    bigint check (suggested_retail_pesewas is null or suggested_retail_pesewas >= wholesale_price_pesewas),
  stock_on_hand               integer not null check (stock_on_hand >= 0 and stock_on_hand <= 1000000),
  stock_reserved              integer not null default 0 check (stock_reserved >= 0),
  max_per_order               integer not null default 5 check (max_per_order between 1 and 100),
  ships_from_region           text not null check (char_length(ships_from_region) between 2 and 60),
  ships_from_city             text not null check (char_length(ships_from_city) between 2 and 60),
  delivery_fee_same_region_pesewas  bigint not null check (delivery_fee_same_region_pesewas between 0 and 10000000),
  delivery_fee_other_region_pesewas bigint check (delivery_fee_other_region_pesewas is null or delivery_fee_other_region_pesewas between 0 and 10000000),
  lead_time_min_days          integer not null check (lead_time_min_days >= 0),
  lead_time_max_days          integer not null check (lead_time_max_days between 1 and 30),
  return_window_days          integer not null default 3 check (return_window_days between 0 and 30),
  return_conditions           text check (return_conditions is null or char_length(return_conditions) <= 1000),
  status                      text not null default 'pending_review'
                              check (status in ('draft','pending_review','active','paused','rejected','archived')),
  moderation_reason           text,
  published_at                timestamptz,
  content_version             integer not null default 1,
  price_version               integer not null default 1,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (supplier_id, client_request_id),
  constraint stock_reserved_le_on_hand check (stock_reserved <= stock_on_hand),
  constraint lead_time_order check (lead_time_min_days <= lead_time_max_days)
);
create index on public.dropship_supplier_products (supplier_id, status);
create index dsp_catalogue_idx on public.dropship_supplier_products (published_at desc, id) where status = 'active';
create index on public.dropship_supplier_products (status, updated_at desc);
create index dsp_images_gin on public.dropship_supplier_products using gin (images jsonb_path_ops);

create table public.dropship_stock_events (
  id                   bigint generated always as identity primary key,
  supplier_product_id  uuid not null references public.dropship_supplier_products(id) on delete restrict,
  order_id             uuid,
  event_type           text not null check (event_type in ('set_on_hand','reserve','release','commit_dispatch','commit_replacement','restock_return',
                         'return_damaged','return_not_received','return_lost')),
  delta_on_hand        integer not null,
  delta_reserved       integer not null,
  on_hand_after        integer not null,
  reserved_after       integer not null,
  actor                text not null,
  reason               text,
  created_at           timestamptz not null default now()
);
create index on public.dropship_stock_events (supplier_product_id, id);

create table public.dropship_audit_events (
  id            bigint generated always as identity primary key,
  actor_user_id text not null,
  actor_role    text not null check (actor_role in ('admin','supplier','dropshipper','user')),
  action        text not null,
  target_type   text not null check (target_type in ('participant','supplier_product')),
  target_id     uuid not null,
  reason        text,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index on public.dropship_audit_events (target_type, target_id, id);

-- Append-only protection (DB §3.7).
create function public.dropship_forbid_mutation() returns trigger
language plpgsql set search_path = '' as
$$ begin raise exception 'append-only table %', tg_table_name; end $$;

create trigger stock_events_immutable before update or delete on public.dropship_stock_events
  for each row execute function public.dropship_forbid_mutation();
create trigger audit_events_immutable before update or delete on public.dropship_audit_events
  for each row execute function public.dropship_forbid_mutation();

-- ---------------------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------------------

-- Raises an error the Node layer maps to an API error code.
create function public.dropship_fail(p_code text, p_detail text) returns void
language plpgsql set search_path = '' as
$$ begin raise exception using errcode = 'P0001', message = 'DS_' || p_code, detail = coalesce(p_detail, ''); end $$;

create function public.dropship_participant_json(p public.dropship_participants) returns jsonb
language sql stable set search_path = '' as
$$
  select jsonb_build_object(
    'id', p.id, 'userId', p.user_id, 'kind', p.kind, 'status', p.status,
    'statusChangedAt', p.status_changed_at, 'statusReason', p.status_reason,
    'displayName', p.display_name, 'contactPhone', p.contact_phone, 'region', p.region,
    'city', p.city, 'addressLine', p.address_line, 'businessRegNo', p.business_reg_no,
    'termsVersion', p.terms_version, 'termsAcceptedAt', p.terms_accepted_at,
    'reviewedBy', p.reviewed_by, 'reviewedAt', p.reviewed_at, 'adminNotes', p.admin_notes,
    'identityVerified', p.identity_verified,
    'createdAt', p.created_at, 'updatedAt', p.updated_at)
$$;

create function public.dropship_supplier_product_json(sp public.dropship_supplier_products) returns jsonb
language sql stable set search_path = '' as
$$
  select jsonb_build_object(
    'id', sp.id, 'supplierId', sp.supplier_id, 'title', sp.title, 'description', sp.description,
    'category', sp.category, 'condition', sp.condition, 'brand', sp.brand, 'images', sp.images,
    'wholesalePricePesewas', sp.wholesale_price_pesewas,
    'suggestedRetailPesewas', sp.suggested_retail_pesewas,
    'stockOnHand', sp.stock_on_hand, 'stockReserved', sp.stock_reserved,
    'stockAvailable', sp.stock_on_hand - sp.stock_reserved,
    'maxPerOrder', sp.max_per_order, 'shipsFromRegion', sp.ships_from_region,
    'shipsFromCity', sp.ships_from_city,
    'deliveryFeeSameRegionPesewas', sp.delivery_fee_same_region_pesewas,
    'deliveryFeeOtherRegionPesewas', sp.delivery_fee_other_region_pesewas,
    'leadTimeMinDays', sp.lead_time_min_days, 'leadTimeMaxDays', sp.lead_time_max_days,
    'returnWindowDays', sp.return_window_days, 'returnConditions', sp.return_conditions,
    'status', sp.status, 'moderationReason', sp.moderation_reason, 'publishedAt', sp.published_at,
    'contentVersion', sp.content_version, 'priceVersion', sp.price_version,
    'createdAt', sp.created_at, 'updatedAt', sp.updated_at)
$$;

-- Locks the supplier's participation FOR SHARE (class 7) and requires it to be approved.
-- Callers that also lock a supplier product must lock it first (class 6).
create function public.dropship_require_approved_supplier(p_supplier_id text) returns void
language plpgsql set search_path = '' as
$$
declare v_status text;
begin
  select status into v_status from public.dropship_participants
   where user_id = p_supplier_id and kind = 'supplier'
   for share;
  if v_status is null or v_status in ('pending','rejected','revoked') then
    perform public.dropship_fail('NOT_APPROVED', 'supplier participation is ' || coalesce(v_status, 'missing'));
  elsif v_status = 'suspended' then
    perform public.dropship_fail('FULFILMENT_ONLY', 'supplier participation is suspended');
  end if;
end $$;

create function public.dropship_check_actor(p_actor text, p_actor_role text, p_reason text) returns void
language plpgsql set search_path = '' as
$$
begin
  if p_actor is null or char_length(p_actor) = 0 then
    perform public.dropship_fail('VALIDATION', 'actor is required');
  end if;
  if p_actor_role is null or p_actor_role not in ('supplier','admin') then
    perform public.dropship_fail('VALIDATION', 'actor role must be supplier or admin');
  end if;
  if p_actor_role = 'admin' and (p_reason is null or char_length(btrim(p_reason)) < 3) then
    perform public.dropship_fail('VALIDATION', 'a reason is required for admin changes');
  end if;
end $$;

create function public.dropship_audit(p_actor text, p_actor_role text, p_action text, p_target_type text,
                                      p_target_id uuid, p_reason text, p_details jsonb) returns void
language sql set search_path = '' as
$$
  insert into public.dropship_audit_events (actor_user_id, actor_role, action, target_type, target_id, reason, details)
  values (p_actor, p_actor_role, p_action, p_target_type, p_target_id, nullif(btrim(p_reason), ''), coalesce(p_details, '{}'::jsonb))
$$;

-- Checks for product fields that the table CHECKs don't cover. Image URLs are validated
-- precisely (cloud name and folder) in Node; here only the shape is enforced.
create function public.dropship_check_product_fields(p_fields jsonb) returns void
language plpgsql set search_path = '' as
$$
declare v_img jsonb;
begin
  if p_fields ? 'images' then
    if jsonb_typeof(p_fields->'images') <> 'array' then
      perform public.dropship_fail('VALIDATION', 'images must be an array');
    end if;
    for v_img in select * from jsonb_array_elements(p_fields->'images') loop
      if jsonb_typeof(v_img) <> 'string' or (v_img #>> '{}') !~ '^https://res\.cloudinary\.com/[a-z0-9_-]+/image/upload/' then
        perform public.dropship_fail('VALIDATION', 'images must be Cloudinary image URLs');
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- #6 Supplier application (user) - create, or resubmit while pending/rejected
-- Locks: participant (class 7) only (rule M7).
-- ---------------------------------------------------------------------------------------
create function public.dropship_submit_application(p_user text, p_kind text, p_fields jsonb, p_client_request_id uuid)
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
-- #8 Admin decision on a participation. Commits the status change only; side effects on
-- supplier products (revocation archives them) are applied afterwards one product per
-- transaction (V22-01), using the returned ids.
-- Locks: participant (class 7) only.
-- ---------------------------------------------------------------------------------------
create function public.dropship_admin_decide_participation(p_admin text, p_participant_id uuid, p_decision text,
                                                           p_reason text, p_notes text, p_expected_status text)
returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_row public.dropship_participants;
  v_to text;
  v_allowed text[];
  v_products jsonb := '[]'::jsonb;
begin
  case p_decision
    when 'approve'   then v_to := 'approved';  v_allowed := array['pending'];
    when 'reinstate' then v_to := 'approved';  v_allowed := array['suspended'];
    when 'reject'    then v_to := 'rejected';  v_allowed := array['pending'];
    when 'suspend'   then v_to := 'suspended'; v_allowed := array['approved'];
    when 'revoke'    then v_to := 'revoked';   v_allowed := array['approved','suspended'];
    else perform public.dropship_fail('VALIDATION', 'unknown decision');
  end case;
  if p_decision <> 'approve' and (p_reason is null or char_length(btrim(p_reason)) < 3) then
    perform public.dropship_fail('VALIDATION', 'a reason is required');
  end if;

  select * into v_row from public.dropship_participants where id = p_participant_id for no key update;
  if v_row.id is null then
    perform public.dropship_fail('NOT_FOUND', 'participation not found');
  end if;
  if p_expected_status is null or v_row.status <> p_expected_status then
    perform public.dropship_fail('STATE_CONFLICT', 'participation is ' || v_row.status);
  end if;
  if not (v_row.status = any (v_allowed)) then
    perform public.dropship_fail('STATE_CONFLICT', 'cannot ' || p_decision || ' a participation that is ' || v_row.status);
  end if;

  update public.dropship_participants set
    status = v_to, status_changed_at = now(), status_reason = nullif(btrim(p_reason), ''),
    reviewed_by = p_admin, reviewed_at = now(),
    admin_notes = coalesce(nullif(btrim(p_notes), ''), admin_notes), updated_at = now()
  where id = v_row.id
  returning * into v_row;

  perform public.dropship_audit(p_admin, 'admin', 'participation_' || p_decision, 'participant', v_row.id, p_reason,
                                jsonb_build_object('to', v_to));

  if v_to = 'revoked' and v_row.kind = 'supplier' then
    select coalesce(jsonb_agg(id), '[]'::jsonb) into v_products
      from public.dropship_supplier_products
     where supplier_id = v_row.user_id and status <> 'archived';
  end if;

  return jsonb_build_object('participant', public.dropship_participant_json(v_row),
                            'supplierProductsToArchive', v_products);
end $$;

-- ---------------------------------------------------------------------------------------
-- #11 Create a supplier product (supplier, or admin on behalf with a reason)
-- Locks: participant FOR SHARE (class 7); the new product row is an insert.
-- ---------------------------------------------------------------------------------------
create function public.dropship_create_supplier_product(p_actor text, p_actor_role text, p_supplier_id text,
                                                         p_fields jsonb, p_submit boolean, p_client_request_id uuid,
                                                         p_reason text)
returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_row public.dropship_supplier_products;
begin
  perform public.dropship_check_actor(p_actor, p_actor_role, p_reason);
  if p_actor_role = 'supplier' and p_supplier_id is distinct from p_actor then
    perform public.dropship_fail('FORBIDDEN', 'suppliers can only create their own products');
  end if;
  if p_client_request_id is null then
    perform public.dropship_fail('VALIDATION', 'clientRequestId is required');
  end if;
  perform public.dropship_check_product_fields(p_fields);

  -- Idempotent replay: the same request returns the same product.
  select * into v_row from public.dropship_supplier_products
   where supplier_id = p_supplier_id and client_request_id = p_client_request_id;
  if v_row.id is not null then
    return jsonb_build_object('product', public.dropship_supplier_product_json(v_row), 'created', false);
  end if;

  perform public.dropship_require_approved_supplier(p_supplier_id);

  insert into public.dropship_supplier_products
    (supplier_id, client_request_id, title, description, category, condition, brand, images,
     wholesale_price_pesewas, suggested_retail_pesewas, stock_on_hand, max_per_order,
     ships_from_region, ships_from_city, delivery_fee_same_region_pesewas, delivery_fee_other_region_pesewas,
     lead_time_min_days, lead_time_max_days, return_window_days, return_conditions, status)
  values
    (p_supplier_id, p_client_request_id, p_fields->>'title', p_fields->>'description', p_fields->>'category',
     coalesce(p_fields->>'condition', 'Brand New'), p_fields->>'brand', p_fields->'images',
     (p_fields->>'wholesalePricePesewas')::bigint, (p_fields->>'suggestedRetailPesewas')::bigint,
     (p_fields->>'stockOnHand')::integer, coalesce((p_fields->>'maxPerOrder')::integer, 5),
     p_fields->>'shipsFromRegion', p_fields->>'shipsFromCity',
     (p_fields->>'deliveryFeeSameRegionPesewas')::bigint, (p_fields->>'deliveryFeeOtherRegionPesewas')::bigint,
     (p_fields->>'leadTimeMinDays')::integer, (p_fields->>'leadTimeMaxDays')::integer,
     coalesce((p_fields->>'returnWindowDays')::integer, 3), p_fields->>'returnConditions',
     case when p_submit then 'pending_review' else 'draft' end)
  on conflict (supplier_id, client_request_id) do nothing
  returning * into v_row;

  if v_row.id is null then
    -- A concurrent identical request committed first.
    select * into v_row from public.dropship_supplier_products
     where supplier_id = p_supplier_id and client_request_id = p_client_request_id;
    return jsonb_build_object('product', public.dropship_supplier_product_json(v_row), 'created', false);
  end if;

  insert into public.dropship_stock_events
    (supplier_product_id, event_type, delta_on_hand, delta_reserved, on_hand_after, reserved_after, actor, reason)
  values (v_row.id, 'set_on_hand', v_row.stock_on_hand, 0, v_row.stock_on_hand, 0, p_actor, 'initial stock');

  perform public.dropship_audit(p_actor, p_actor_role, 'supplier_product_created', 'supplier_product', v_row.id, p_reason,
                                jsonb_build_object('status', v_row.status));
  return jsonb_build_object('product', public.dropship_supplier_product_json(v_row), 'created', true);
end $$;

-- Locks a supplier product FOR NO KEY UPDATE (class 6) and checks the actor may change it.
create function public.dropship_lock_product_for_actor(p_actor text, p_actor_role text, p_id uuid)
returns public.dropship_supplier_products
language plpgsql set search_path = '' as
$$
declare v_row public.dropship_supplier_products;
begin
  select * into v_row from public.dropship_supplier_products where id = p_id for no key update;
  -- A supplier gets NOT_FOUND for another supplier's product (no existence leak).
  if v_row.id is null or (p_actor_role = 'supplier' and v_row.supplier_id <> p_actor) then
    perform public.dropship_fail('NOT_FOUND', 'supplier product not found');
  end if;
  return v_row;
end $$;

-- ---------------------------------------------------------------------------------------
-- #12 Update supplier product content and prices (not stock, not status)
-- Locks: supplier product NKU (6) -> participant FOR SHARE (7).
-- ---------------------------------------------------------------------------------------
create function public.dropship_update_supplier_product(p_actor text, p_actor_role text, p_id uuid, p_fields jsonb,
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

-- ---------------------------------------------------------------------------------------
-- #13 Set stock on hand (compare-and-set optional; never below reserved)
-- Locks: supplier product NKU (6) -> participant FOR SHARE (7, supplier actor only).
-- ---------------------------------------------------------------------------------------
create function public.dropship_set_stock(p_actor text, p_actor_role text, p_id uuid, p_new_on_hand integer,
                                          p_expected_on_hand integer, p_reason text)
returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_row public.dropship_supplier_products;
  v_old integer;
begin
  perform public.dropship_check_actor(p_actor, p_actor_role, p_reason);
  if p_new_on_hand is null or p_new_on_hand < 0 or p_new_on_hand > 1000000 then
    perform public.dropship_fail('VALIDATION', 'stockOnHand must be between 0 and 1000000');
  end if;
  v_row := public.dropship_lock_product_for_actor(p_actor, p_actor_role, p_id);
  if p_actor_role = 'supplier' then
    perform public.dropship_require_approved_supplier(v_row.supplier_id);
  end if;
  if v_row.status = 'archived' then
    perform public.dropship_fail('STATE_CONFLICT', 'archived products cannot change stock');
  end if;
  if p_expected_on_hand is not null and p_expected_on_hand <> v_row.stock_on_hand then
    perform public.dropship_fail('STATE_CONFLICT', 'stock was changed by someone else; reload it');
  end if;
  if p_new_on_hand < v_row.stock_reserved then
    perform public.dropship_fail('VALIDATION', 'stockOnHand cannot be below the reserved quantity ' || v_row.stock_reserved);
  end if;

  v_old := v_row.stock_on_hand;
  update public.dropship_supplier_products
     set stock_on_hand = p_new_on_hand, updated_at = now()
   where id = v_row.id
  returning * into v_row;

  insert into public.dropship_stock_events
    (supplier_product_id, event_type, delta_on_hand, delta_reserved, on_hand_after, reserved_after, actor, reason)
  values (v_row.id, 'set_on_hand', p_new_on_hand - v_old, 0, v_row.stock_on_hand, v_row.stock_reserved, p_actor, nullif(btrim(p_reason), ''));

  if p_actor_role = 'admin' then
    perform public.dropship_audit(p_actor, 'admin', 'stock_corrected', 'supplier_product', v_row.id, p_reason,
                                  jsonb_build_object('from', v_old, 'to', p_new_on_hand));
  end if;
  return jsonb_build_object('product', public.dropship_supplier_product_json(v_row));
end $$;

-- ---------------------------------------------------------------------------------------
-- #14 Supplier status change: submit (draft/rejected -> pending_review), pause, activate
-- (only previously approved products), archive. Admins may archive or pause with a reason
-- (used for revocation side effects, whatever the participation status).
-- Locks: supplier product NKU (6) -> participant FOR SHARE (7, supplier actor only).
-- ---------------------------------------------------------------------------------------
create function public.dropship_set_supplier_product_status(p_actor text, p_actor_role text, p_id uuid,
                                                             p_status text, p_reason text)
returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_row public.dropship_supplier_products;
  v_from text;
begin
  perform public.dropship_check_actor(p_actor, p_actor_role, p_reason);
  if p_status is null or p_status not in ('pending_review','paused','active','archived') then
    perform public.dropship_fail('VALIDATION', 'status must be pending_review, paused, active or archived');
  end if;
  if p_actor_role = 'admin' and p_status not in ('paused','archived') then
    perform public.dropship_fail('VALIDATION', 'admins approve products through moderation');
  end if;
  v_row := public.dropship_lock_product_for_actor(p_actor, p_actor_role, p_id);
  if p_actor_role = 'supplier' then
    perform public.dropship_require_approved_supplier(v_row.supplier_id);
  end if;
  v_from := v_row.status;

  if v_from = p_status then
    return jsonb_build_object('product', public.dropship_supplier_product_json(v_row), 'changed', false);
  end if;
  if v_from = 'archived' then
    perform public.dropship_fail('STATE_CONFLICT', 'archived products cannot change status');
  end if;
  if p_status = 'pending_review' and v_from not in ('draft','rejected') then
    perform public.dropship_fail('STATE_CONFLICT', 'only draft or rejected products can be submitted');
  end if;
  if p_status = 'active' and not (v_from = 'paused' and v_row.published_at is not null) then
    perform public.dropship_fail('STATE_CONFLICT', 'only paused, previously approved products can be activated');
  end if;
  if p_status = 'paused' and v_from <> 'active' then
    perform public.dropship_fail('STATE_CONFLICT', 'only active products can be paused');
  end if;

  update public.dropship_supplier_products
     set status = p_status, updated_at = now(),
         moderation_reason = case when p_status = 'pending_review' then null else moderation_reason end
   where id = v_row.id
  returning * into v_row;

  perform public.dropship_audit(p_actor, p_actor_role, 'supplier_product_status', 'supplier_product', v_row.id, p_reason,
                                jsonb_build_object('from', v_from, 'to', p_status));
  return jsonb_build_object('product', public.dropship_supplier_product_json(v_row), 'changed', true);
end $$;

-- ---------------------------------------------------------------------------------------
-- #15 Admin moderation: approve (pending_review -> active), reject, pause
-- Locks: supplier product NKU (6) -> participant FOR SHARE (7, approve only).
-- ---------------------------------------------------------------------------------------
create function public.dropship_admin_moderate_supplier_product(p_admin text, p_id uuid, p_decision text, p_reason text)
returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_row public.dropship_supplier_products;
  v_from text;
begin
  if p_decision is null or p_decision not in ('approve','reject','pause') then
    perform public.dropship_fail('VALIDATION', 'decision must be approve, reject or pause');
  end if;
  if p_decision <> 'approve' and (p_reason is null or char_length(btrim(p_reason)) < 3) then
    perform public.dropship_fail('VALIDATION', 'a reason is required');
  end if;
  v_row := public.dropship_lock_product_for_actor(p_admin, 'admin', p_id);
  v_from := v_row.status;

  if p_decision = 'approve' then
    if v_from <> 'pending_review' then
      perform public.dropship_fail('STATE_CONFLICT', 'only products pending review can be approved');
    end if;
    perform public.dropship_require_approved_supplier(v_row.supplier_id);
    update public.dropship_supplier_products
       set status = 'active', published_at = coalesce(published_at, now()), moderation_reason = null, updated_at = now()
     where id = v_row.id returning * into v_row;
  elsif p_decision = 'reject' then
    if v_from <> 'pending_review' then
      perform public.dropship_fail('STATE_CONFLICT', 'only products pending review can be rejected');
    end if;
    update public.dropship_supplier_products
       set status = 'rejected', moderation_reason = btrim(p_reason), updated_at = now()
     where id = v_row.id returning * into v_row;
  else
    if v_from <> 'active' then
      perform public.dropship_fail('STATE_CONFLICT', 'only active products can be paused');
    end if;
    update public.dropship_supplier_products
       set status = 'paused', moderation_reason = btrim(p_reason), updated_at = now()
     where id = v_row.id returning * into v_row;
  end if;

  perform public.dropship_audit(p_admin, 'admin', 'supplier_product_' || p_decision, 'supplier_product', v_row.id, p_reason,
                                jsonb_build_object('from', v_from, 'to', v_row.status));
  return jsonb_build_object('product', public.dropship_supplier_product_json(v_row));
end $$;

-- ---------------------------------------------------------------------------------------
-- Read functions (no locks)
-- ---------------------------------------------------------------------------------------
create function public.dropship_get_participations(p_user text) returns jsonb
language sql stable set search_path = '' as
$$
  select coalesce(jsonb_object_agg(p.kind, public.dropship_participant_json(p)), '{}'::jsonb)
    from public.dropship_participants p where p.user_id = p_user
$$;

create function public.dropship_admin_list_participants(p_status text, p_kind text, p_limit integer) returns jsonb
language sql stable set search_path = '' as
$$
  select coalesce(jsonb_agg(public.dropship_participant_json(p) order by p.created_at desc), '[]'::jsonb)
    from (select * from public.dropship_participants
           where (p_status is null or status = p_status) and (p_kind is null or kind = p_kind)
           order by created_at desc
           limit least(greatest(coalesce(p_limit, 50), 1), 200)) p
$$;

create function public.dropship_list_supplier_products(p_supplier_id text, p_status text, p_limit integer) returns jsonb
language sql stable set search_path = '' as
$$
  select coalesce(jsonb_agg(public.dropship_supplier_product_json(sp) order by sp.updated_at desc), '[]'::jsonb)
    from (select * from public.dropship_supplier_products
           where (p_supplier_id is null or supplier_id = p_supplier_id) and (p_status is null or status = p_status)
           order by updated_at desc
           limit least(greatest(coalesce(p_limit, 50), 1), 200)) sp
$$;

-- ---------------------------------------------------------------------------------------
-- Grants and RLS (DB §2, §8): only service_role may touch Dropship objects.
-- ---------------------------------------------------------------------------------------
alter table public.dropship_participants      enable row level security;
alter table public.dropship_supplier_products enable row level security;
alter table public.dropship_stock_events      enable row level security;
alter table public.dropship_audit_events      enable row level security;

revoke all on table public.dropship_participants, public.dropship_supplier_products,
                    public.dropship_stock_events, public.dropship_audit_events
  from public, anon, authenticated;
grant select, insert, update on table public.dropship_participants, public.dropship_supplier_products
  to service_role;
grant select, insert on table public.dropship_stock_events, public.dropship_audit_events to service_role;

revoke all on sequence public.dropship_stock_events_id_seq, public.dropship_audit_events_id_seq
  from public, anon, authenticated;
grant usage, select on sequence public.dropship_stock_events_id_seq, public.dropship_audit_events_id_seq
  to service_role;

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
