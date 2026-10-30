-- TedBuy Dropship Phase 4: reseller-funded Cash on Delivery orders.
--
-- Source design: docs/superpowers/specs/2026-10-30-dropship-cod-orders-design.md (owner
-- approved 2026-10-30). TedBuy never collects, holds, splits or moves Dropship money: every
-- payment row here is a RECORD of money that moved outside TedBuy.
--   Reseller -> supplier: declared by the reseller, confirmed only by the supplier.
--   Buyer -> reseller: recorded by the reseller at handover; never independently verified.
-- The delivery code proves the buyer received the item, not that they paid.
--
-- Requires: 20261026120000_dropship_supplier_catalogue.sql, 20261028120000_dropship_listings.sql.
--
-- Function template: as Phases 2-3 (no SECURITY DEFINER; search_path ''; lock_timeout 5 s on
-- writes; EXECUTE for service_role only, by the loop at the end). Business errors are raised
-- with dropship_fail(); a wrong delivery code is a normal result (the attempt counter must
-- commit), not an error.
--
-- Locking: global order order (5a) -> listing (5) -> supplier product (6) -> participant (7).
-- Every order function locks its order row FOR NO KEY UPDATE first, so moves on one order
-- are serialised. Reservations lock the supplier product row FOR NO KEY UPDATE and re-check
-- stock_on_hand - stock_reserved under that lock, so two reservations can never hold more
-- than the stock on hand.
--
-- Idempotency: placing an order is idempotent on (buyer, clientRequestId). Every move whose
-- target status the order is already in returns {changed: false} instead of failing, so a
-- retried request is harmless.

do $$
begin
  if to_regclass('public.dropship_listings') is null then
    raise exception 'Dropship Phase 4 needs 20261028120000_dropship_listings.sql applied first';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- Listings: the reseller's delivery fee (0 = free delivery).
-- ---------------------------------------------------------------------------------------
alter table public.dropship_listings
  add column delivery_fee_pesewas bigint not null default 0
  check (delivery_fee_pesewas between 0 and 10000000);

create or replace function public.dropship_listing_json(l public.dropship_listings) returns jsonb
language sql stable set search_path = '' as
$$
  select jsonb_build_object(
    'id', l.id, 'supplierProductId', l.supplier_product_id, 'dropshipperId', l.dropshipper_id,
    'productId', l.product_id, 'retailPricePesewas', l.retail_price_pesewas,
    'deliveryFeePesewas', l.delivery_fee_pesewas, 'status', l.status,
    'createdAt', l.created_at, 'updatedAt', l.updated_at, 'removedAt', l.removed_at)
$$;

-- ---------------------------------------------------------------------------------------
-- Settings (admin-configurable): reseller limit tiers and time limits.
-- ---------------------------------------------------------------------------------------
create table public.dropship_order_settings (
  id                       boolean primary key default true check (id),
  -- [{minCompleted, perOrderPesewas, openPesewas}], ascending minCompleted, first is 0.
  limit_tiers              jsonb not null,
  buyer_confirm_hours      integer not null check (buyer_confirm_hours between 1 and 168),
  reseller_accept_hours    integer not null check (reseller_accept_hours between 1 and 168),
  supplier_response_hours  integer not null check (supplier_response_hours between 1 and 168),
  reservation_hours        integer not null check (reservation_hours between 1 and 168),
  reservation_min_hours    integer not null check (reservation_min_hours between 1 and 168),
  reservation_max_hours    integer not null check (reservation_max_hours between 1 and 168),
  code_valid_hours         integer not null check (code_valid_hours between 1 and 720),
  max_open_orders_per_buyer integer not null check (max_open_orders_per_buyer between 1 and 100),
  updated_by               text,
  updated_at               timestamptz not null default now()
);
insert into public.dropship_order_settings
  (limit_tiers, buyer_confirm_hours, reseller_accept_hours, supplier_response_hours,
   reservation_hours, reservation_min_hours, reservation_max_hours, code_valid_hours, max_open_orders_per_buyer)
values ('[{"minCompleted":0,"perOrderPesewas":20000,"openPesewas":40000},
          {"minCompleted":3,"perOrderPesewas":50000,"openPesewas":100000},
          {"minCompleted":10,"perOrderPesewas":150000,"openPesewas":300000}]'::jsonb,
        24, 24, 24, 24, 12, 72, 72, 5);

create table public.dropship_reseller_limit_overrides (
  dropshipper_id     text primary key references public.users(id) on delete restrict,
  per_order_pesewas  bigint not null check (per_order_pesewas between 0 and 100000000),
  open_pesewas       bigint not null check (open_pesewas between 0 and 1000000000),
  reason             text not null,
  set_by             text not null,
  set_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------------------
create table public.dropship_orders (
  id                         uuid primary key default gen_random_uuid(),
  order_number               text not null unique,
  buyer_id                   text not null references public.users(id) on delete restrict,
  client_request_id          uuid not null,
  listing_id                 uuid not null references public.dropship_listings(id) on delete restrict,
  dropshipper_id             text not null references public.users(id) on delete restrict,
  supplier_id                text not null references public.users(id) on delete restrict,
  supplier_product_id        uuid not null references public.dropship_supplier_products(id) on delete restrict,
  product_id                 text,          -- mirror row id at order time (row may be gone later)
  title                      text not null,
  image                      text,
  quantity                   integer not null check (quantity between 1 and 100),
  -- Buyer side (snapshots)
  retail_unit_pesewas        bigint not null check (retail_unit_pesewas > 0),
  delivery_fee_pesewas       bigint not null check (delivery_fee_pesewas >= 0),
  total_pesewas              bigint not null,
  -- Supplier side (snapshots)
  wholesale_unit_at_order    bigint not null check (wholesale_unit_at_order > 0),
  price_version_at_order     integer not null,
  wholesale_unit_proposed    bigint check (wholesale_unit_proposed is null or wholesale_unit_proposed > 0),
  wholesale_unit_agreed      bigint check (wholesale_unit_agreed is null or wholesale_unit_agreed > 0),
  return_window_days         integer not null,
  -- Delivery details (seen by the buyer, the reseller and admins only)
  buyer_name                 text not null check (char_length(buyer_name) between 2 and 80),
  buyer_phone                text not null check (buyer_phone ~ '^\+?[0-9]{9,15}$'),
  buyer_email                text,
  delivery_region            text not null check (char_length(delivery_region) between 2 and 60),
  delivery_area              text not null check (char_length(delivery_area) between 2 and 80),
  delivery_address           text not null check (char_length(delivery_address) between 5 and 300),
  delivery_instructions      text check (delivery_instructions is null or char_length(delivery_instructions) <= 500),
  -- Reseller's own cost estimates (for the net-margin estimate only)
  reseller_delivery_cost_pesewas bigint not null default 0 check (reseller_delivery_cost_pesewas between 0 and 100000000),
  reseller_other_cost_pesewas    bigint not null default 0 check (reseller_other_cost_pesewas between 0 and 100000000),
  -- State
  status                     text not null default 'placed' check (status in (
                               'placed','buyer_confirmed','accepted','reservation_requested','price_review','reserved',
                               'supplier_payment_declared','supplier_paid','released','collected','out_for_delivery',
                               'delivered','completed','delivery_failed','disputed','return_requested','returned','cancelled')),
  status_changed_at          timestamptz not null default now(),
  deadline_at                timestamptz,
  buyer_confirmed_at         timestamptz,
  accepted_at                timestamptz,
  reserved_at                timestamptz,
  supplier_paid_at           timestamptz,
  released_at                timestamptz,
  collected_at               timestamptz,
  delivered_at               timestamptz,
  delivery_confirmation      text check (delivery_confirmation in ('code','buyer','reseller_only')),
  delivery_attempts          integer not null default 0,
  completed_at               timestamptz,
  cancelled_at               timestamptz,
  cancelled_by_role          text check (cancelled_by_role in ('buyer','dropshipper','supplier','admin','system')),
  cancel_reason              text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (buyer_id, client_request_id),
  constraint dso_total check (total_pesewas = retail_unit_pesewas * quantity + delivery_fee_pesewas)
);
create index on public.dropship_orders (buyer_id, created_at desc);
create index on public.dropship_orders (dropshipper_id, created_at desc);
create index on public.dropship_orders (supplier_id, created_at desc);
create index on public.dropship_orders (status, created_at desc);
create index dso_deadline_idx on public.dropship_orders (deadline_at) where deadline_at is not null;

-- Append-only order history.
create table public.dropship_order_events (
  id            bigint generated always as identity primary key,
  order_id      uuid not null references public.dropship_orders(id) on delete restrict,
  actor_user_id text not null,
  actor_role    text not null check (actor_role in ('buyer','dropshipper','supplier','admin','system')),
  action        text not null,
  from_status   text,
  to_status     text,
  reason        text,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index on public.dropship_order_events (order_id, id);
create trigger order_events_immutable before update or delete on public.dropship_order_events
  for each row execute function public.dropship_forbid_mutation();

create table public.dropship_reservations (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.dropship_orders(id) on delete restrict,
  supplier_product_id  uuid not null references public.dropship_supplier_products(id) on delete restrict,
  quantity             integer not null check (quantity > 0),
  hold_hours           integer not null,
  status               text not null default 'requested'
                       check (status in ('requested','confirmed','declined','expired','released','committed')),
  requested_at         timestamptz not null default now(),
  responded_at         timestamptz,
  expires_at           timestamptz,
  ended_at             timestamptz,
  end_reason           text
);
create unique index dsr_one_live_per_order on public.dropship_reservations (order_id)
  where status in ('requested','confirmed');
create index on public.dropship_reservations (supplier_product_id, status);

-- Records of money that moved OUTSIDE TedBuy.
create table public.dropship_order_payments (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.dropship_orders(id) on delete restrict,
  kind             text not null check (kind in ('reseller_to_supplier','buyer_to_reseller',
                                                 'refund_to_buyer','supplier_refund_to_reseller')),
  amount_pesewas   bigint not null check (amount_pesewas > 0 and amount_pesewas <= 1000000000),
  method           text not null check (method in ('cash','momo','bank','other')),
  paid_on          date not null,
  reference        text check (reference is null or char_length(reference) <= 100),
  evidence_url     text check (evidence_url is null or char_length(evidence_url) <= 500),
  recorded_by      text not null,
  recorded_role    text not null check (recorded_role in ('buyer','dropshipper','supplier','admin')),
  -- Only reseller_to_supplier is ever confirmed (by the supplier). Everything else stays
  -- 'recorded': TedBuy cannot verify it and never claims to.
  status           text not null check (status in ('recorded','declared','confirmed','rejected')),
  confirmed_by     text,
  confirmed_at     timestamptz,
  rejected_reason  text,
  created_at       timestamptz not null default now()
);
create index on public.dropship_order_payments (order_id, created_at);
create unique index dsop_one_live_supplier_payment on public.dropship_order_payments (order_id)
  where kind = 'reseller_to_supplier' and status in ('declared','confirmed');

-- Delivery code. Readable only through the buyer's own order view; never logged.
create table public.dropship_delivery_codes (
  order_id     uuid primary key references public.dropship_orders(id) on delete restrict,
  code         text not null check (code ~ '^[0-9]{6}$'),
  issued_count integer not null default 1,
  attempts     integer not null default 0,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz
);

-- Disputes and returns (kind = 'return').
create table public.dropship_disputes (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.dropship_orders(id) on delete restrict,
  kind          text not null check (kind in ('dispute','return')),
  reason_code   text not null check (reason_code in (
                  'paid_not_released','payment_not_received','wrong_item','defective','not_delivered',
                  'advance_payment_requested','buyer_refused','fake_order','invalid_contact','price_dispute',
                  'changed_mind','other')),
  description   text not null check (char_length(description) between 5 and 2000),
  evidence      jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 5),
  opened_by     text not null,
  opened_role   text not null check (opened_role in ('buyer','dropshipper','supplier','admin')),
  from_status   text not null,
  status        text not null default 'open' check (status in ('open','resolved')),
  outcome       text check (outcome in ('resumed','cancelled','completed','returned','rejected')),
  fault         text check (fault in ('none','buyer','dropshipper','supplier','unclear')),
  fault_type    text,
  resolution    text,
  resolved_by   text,
  resolved_role text check (resolved_role in ('dropshipper','admin')),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create unique index dsd_one_open_per_order on public.dropship_disputes (order_id) where status = 'open';
create index on public.dropship_disputes (status, created_at desc);

-- Reliability: facts the system saw, or findings an admin made, are 'verified'. A report by
-- one party about another is stored unverified and never counts as a problem on its own.
create table public.dropship_reliability_events (
  id               bigint generated always as identity primary key,
  subject_user_id  text not null,
  subject_role     text not null check (subject_role in ('buyer','dropshipper','supplier')),
  event_type       text not null,
  weight           text not null check (weight in ('positive','neutral','negative')),
  verified         boolean not null,
  order_id         uuid references public.dropship_orders(id) on delete restrict,
  source           text not null check (source in ('system','admin','report')),
  details          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index on public.dropship_reliability_events (subject_user_id, subject_role, id);
create trigger reliability_events_immutable before update or delete on public.dropship_reliability_events
  for each row execute function public.dropship_forbid_mutation();

-- Admin order actions are also written to the shared Dropship audit table.
alter table public.dropship_audit_events drop constraint dropship_audit_events_target_type_check;
alter table public.dropship_audit_events add constraint dropship_audit_events_target_type_check
  check (target_type in ('participant','supplier_product','listing','order','settings'));

-- Stock events gain the reservation life cycle names used here.
alter table public.dropship_stock_events drop constraint dropship_stock_events_event_type_check;
alter table public.dropship_stock_events add constraint dropship_stock_events_event_type_check
  check (event_type in ('set_on_hand','reserve','release','commit_dispatch','commit_replacement','restock_return',
                        'return_damaged','return_not_received','return_lost','expire'));

-- ---------------------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------------------
create function public.dropship_settings() returns public.dropship_order_settings
language sql stable set search_path = '' as
$$ select * from public.dropship_order_settings where id $$;

create function public.dropship_order_event(p_order uuid, p_actor text, p_role text, p_action text,
                                            p_from text, p_to text, p_reason text, p_details jsonb) returns void
language sql set search_path = '' as
$$
  insert into public.dropship_order_events (order_id, actor_user_id, actor_role, action, from_status, to_status, reason, details)
  values (p_order, p_actor, p_role, p_action, p_from, p_to, nullif(btrim(p_reason), ''), coalesce(p_details, '{}'::jsonb))
$$;

create function public.dropship_reliability(p_user text, p_role text, p_type text, p_weight text, p_verified boolean,
                                            p_order uuid, p_source text, p_details jsonb) returns void
language sql set search_path = '' as
$$
  insert into public.dropship_reliability_events (subject_user_id, subject_role, event_type, weight, verified, order_id, source, details)
  values (p_user, p_role, p_type, p_weight, p_verified, p_order, p_source, coalesce(p_details, '{}'::jsonb))
$$;

-- Locks and returns an order the actor may act on in the given role; NOT_FOUND otherwise
-- (an order you are not part of looks exactly like one that does not exist).
create function public.dropship_lock_order(p_actor text, p_role text, p_order uuid) returns public.dropship_orders
language plpgsql set search_path = '' as
$$
declare v_o public.dropship_orders;
begin
  if p_actor is null or char_length(p_actor) = 0 then
    perform public.dropship_fail('VALIDATION', 'actor is required');
  end if;
  select * into v_o from public.dropship_orders where id = p_order for no key update;
  if v_o.id is null
     or (p_role = 'buyer' and v_o.buyer_id <> p_actor)
     or (p_role = 'dropshipper' and v_o.dropshipper_id <> p_actor)
     or (p_role = 'supplier' and v_o.supplier_id <> p_actor)
     or p_role not in ('buyer','dropshipper','supplier','admin','system') then
    perform public.dropship_fail('NOT_FOUND', 'order not found');
  end if;
  -- Resellers and suppliers keep fulfilling while suspended (FULFILMENT_ONLY), but not
  -- after revocation.
  if p_role in ('dropshipper','supplier') and not exists (
       select 1 from public.dropship_participants
        where user_id = p_actor and kind = p_role and status in ('approved','suspended')) then
    perform public.dropship_fail('NOT_APPROVED', 'an approved ' || p_role || ' participation is required');
  end if;
  return v_o;
end $$;

create function public.dropship_require_status(v_o public.dropship_orders, p_allowed text[]) returns void
language plpgsql set search_path = '' as
$$
begin
  if not (v_o.status = any (p_allowed)) then
    perform public.dropship_fail('STATE_CONFLICT', 'this step is not possible while the order is ' || v_o.status);
  end if;
end $$;

-- The deadline that applies when an order enters a status.
create function public.dropship_deadline_for(p_status text, p_reservation_expires timestamptz) returns timestamptz
language sql stable set search_path = '' as
$$
  select case p_status
    when 'placed' then now() + make_interval(hours => s.buyer_confirm_hours)
    when 'buyer_confirmed' then now() + make_interval(hours => s.reseller_accept_hours)
    when 'accepted' then now() + make_interval(hours => s.reseller_accept_hours)
    when 'reservation_requested' then now() + make_interval(hours => s.supplier_response_hours)
    when 'price_review' then p_reservation_expires
    when 'reserved' then p_reservation_expires
    else null end
    from public.dropship_order_settings s where s.id
$$;

-- Moves an order and writes its history row. Callers have already locked and checked it.
create function public.dropship_order_move(v_o public.dropship_orders, p_actor text, p_role text, p_action text,
                                           p_to text, p_reason text, p_details jsonb) returns public.dropship_orders
language plpgsql set search_path = '' as
$$
declare
  v_res timestamptz;
  v_new public.dropship_orders;
begin
  select expires_at into v_res from public.dropship_reservations
   where order_id = v_o.id and status = 'confirmed';
  update public.dropship_orders set
    status = p_to,
    status_changed_at = now(),
    deadline_at = public.dropship_deadline_for(p_to, v_res),
    buyer_confirmed_at = case when p_to = 'buyer_confirmed' then now() else buyer_confirmed_at end,
    accepted_at = case when p_to = 'accepted' then now() else accepted_at end,
    supplier_paid_at = case when p_to = 'supplier_paid' then now() else supplier_paid_at end,
    released_at = case when p_to = 'released' then now() else released_at end,
    collected_at = case when p_to = 'collected' then now() else collected_at end,
    delivered_at = case when p_to = 'delivered' then now() else delivered_at end,
    completed_at = case when p_to = 'completed' then now() else completed_at end,
    cancelled_at = case when p_to = 'cancelled' then now() else cancelled_at end,
    cancelled_by_role = case when p_to = 'cancelled' then p_role else cancelled_by_role end,
    cancel_reason = case when p_to = 'cancelled' then nullif(btrim(p_reason), '') else cancel_reason end,
    updated_at = now()
  where id = v_o.id
  returning * into v_new;
  perform public.dropship_order_event(v_o.id, p_actor, p_role, p_action, v_o.status, p_to, p_reason, p_details);
  return v_new;
end $$;

-- Ends the order's live reservation (if any), giving reserved stock back.
create function public.dropship_release_reservation(p_order uuid, p_actor text, p_new_status text, p_reason text) returns void
language plpgsql set search_path = '' as
$$
declare
  v_r public.dropship_reservations;
  v_sp public.dropship_supplier_products;
begin
  select * into v_r from public.dropship_reservations
   where order_id = p_order and status in ('requested','confirmed') for no key update;
  if v_r.id is null then return; end if;
  if v_r.status = 'confirmed' then
    select * into v_sp from public.dropship_supplier_products where id = v_r.supplier_product_id for no key update;
    update public.dropship_supplier_products
       set stock_reserved = greatest(stock_reserved - v_r.quantity, 0), updated_at = now()
     where id = v_sp.id
    returning * into v_sp;
    insert into public.dropship_stock_events
      (supplier_product_id, order_id, event_type, delta_on_hand, delta_reserved, on_hand_after, reserved_after, actor, reason)
    values (v_sp.id, p_order, case when p_new_status = 'expired' then 'expire' else 'release' end,
            0, -v_r.quantity, v_sp.stock_on_hand, v_sp.stock_reserved, p_actor, p_reason);
  end if;
  update public.dropship_reservations
     set status = p_new_status,
         ended_at = now(), end_reason = p_reason
   where id = v_r.id;
end $$;

-- Cancels an order from any non-terminal status, releasing a held reservation.
create function public.dropship_order_cancel_internal(v_o public.dropship_orders, p_actor text, p_role text,
                                                      p_action text, p_reason text, p_details jsonb) returns public.dropship_orders
language plpgsql set search_path = '' as
$$
begin
  perform public.dropship_release_reservation(v_o.id, p_actor, 'released', p_reason);
  return public.dropship_order_move(v_o, p_actor, p_role, p_action, 'cancelled', p_reason, p_details);
end $$;

-- ---------------------------------------------------------------------------------------
-- Limits and reliability
-- ---------------------------------------------------------------------------------------
create function public.dropship_reseller_exposure(p_user text) returns bigint
language sql stable set search_path = '' as
$$
  select coalesce(sum(coalesce(o.wholesale_unit_agreed, o.wholesale_unit_proposed, o.wholesale_unit_at_order) * o.quantity), 0)::bigint
    from public.dropship_orders o
   where o.dropshipper_id = p_user
     and o.status in ('reservation_requested','price_review','reserved','supplier_payment_declared','supplier_paid',
                      'released','collected','out_for_delivery','delivered','delivery_failed','disputed')
$$;

-- Tier rule: the highest tier whose minCompleted the reseller has reached, but only while no
-- admin has upheld a fault against them as a reseller; an admin override replaces the tier.
create function public.dropship_reseller_limits(p_user text) returns jsonb
language plpgsql stable set search_path = '' as
$$
declare
  v_completed integer;
  v_faults integer;
  v_tier jsonb;
  v_idx integer := 0;
  v_ov public.dropship_reseller_limit_overrides;
begin
  select count(*) into v_completed from public.dropship_orders where dropshipper_id = p_user and status in ('completed','returned');
  select count(*) into v_faults from public.dropship_reliability_events
   where subject_user_id = p_user and subject_role = 'dropshipper' and verified and weight = 'negative';
  select t.value, (t.ord - 1)::integer into v_tier, v_idx
    from public.dropship_order_settings s, jsonb_array_elements(s.limit_tiers) with ordinality t(value, ord)
   where s.id and (t.value->>'minCompleted')::integer <= case when v_faults > 0 then 0 else v_completed end
   order by (t.value->>'minCompleted')::integer desc limit 1;
  select * into v_ov from public.dropship_reseller_limit_overrides where dropshipper_id = p_user;
  return jsonb_build_object(
    'perOrderPesewas', coalesce(v_ov.per_order_pesewas, (v_tier->>'perOrderPesewas')::bigint),
    'openPesewas', coalesce(v_ov.open_pesewas, (v_tier->>'openPesewas')::bigint),
    'tier', v_idx, 'completedOrders', v_completed, 'upheldFaults', v_faults,
    'source', case when v_ov.dropshipper_id is null then 'tier' else 'admin_override' end,
    'exposurePesewas', public.dropship_reseller_exposure(p_user));
end $$;

-- Raises PRICE_INVALID (422) when taking on p_amount more would break a limit.
create function public.dropship_check_exposure(p_user text, p_order uuid, p_amount bigint) returns void
language plpgsql stable set search_path = '' as
$$
declare
  v_l jsonb := public.dropship_reseller_limits(p_user);
  v_open bigint;
begin
  if p_amount > (v_l->>'perOrderPesewas')::bigint then
    perform public.dropship_fail('LIMIT_EXCEEDED', 'this order needs ' || p_amount || ' pesewas wholesale; your per-order limit is '
                                 || (v_l->>'perOrderPesewas'));
  end if;
  select coalesce(sum(coalesce(o.wholesale_unit_agreed, o.wholesale_unit_proposed, o.wholesale_unit_at_order) * o.quantity), 0)
    into v_open
    from public.dropship_orders o
   where o.dropshipper_id = p_user and o.id <> p_order
     and o.status in ('reservation_requested','price_review','reserved','supplier_payment_declared','supplier_paid',
                      'released','collected','out_for_delivery','delivered','delivery_failed','disputed');
  if v_open + p_amount > (v_l->>'openPesewas')::bigint then
    perform public.dropship_fail('LIMIT_EXCEEDED', 'open orders would reach ' || (v_open + p_amount)
                                 || ' pesewas wholesale; your limit is ' || (v_l->>'openPesewas'));
  end if;
end $$;

-- Explainable summary. Level: 'caution' with 2+ verified problems, or 1 verified problem and
-- fewer than 3 completed orders; 'good' with 3+ completed and no verified problem; else 'new'.
create function public.dropship_reliability_summary(p_user text, p_role text) returns jsonb
language sql stable set search_path = '' as
$$
  select jsonb_build_object(
    'completed', c.completed, 'verifiedProblems', c.verified_neg, 'reportedProblems', c.reported_neg,
    'cancelledEarly', c.cancelled_early,
    'level', case when c.verified_neg >= 2 or (c.verified_neg = 1 and c.completed < 3) then 'caution'
                  when c.completed >= 3 and c.verified_neg = 0 then 'good' else 'new' end)
    from (select count(*) filter (where weight = 'positive' and verified) as completed,
                 count(*) filter (where weight = 'negative' and verified) as verified_neg,
                 count(*) filter (where weight = 'negative' and not verified) as reported_neg,
                 count(*) filter (where event_type = 'cancelled_before_purchase') as cancelled_early
            from public.dropship_reliability_events
           where subject_user_id = p_user and subject_role = p_role) c
$$;

-- ---------------------------------------------------------------------------------------
-- Projections. Each audience gets an explicit whitelist.
-- ---------------------------------------------------------------------------------------
create function public.dropship_order_timeline(p_order uuid, p_audience text) returns jsonb
language sql stable set search_path = '' as
$$
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', e.created_at, 'action', e.action, 'by', e.actor_role, 'from', e.from_status, 'to', e.to_status,
           'reason', case when p_audience in ('admin','dropshipper') or e.actor_role = p_audience then e.reason end)
         order by e.id), '[]'::jsonb)
    from public.dropship_order_events e
   where e.order_id = p_order
     -- Suppliers see only the steps that concern them.
     and (p_audience <> 'supplier' or e.action in ('reservation_requested','reservation_confirmed','reservation_declined',
          'price_accepted','price_declined','supplier_payment_declared','supplier_payment_confirmed','supplier_payment_rejected',
          'released','collected','cancelled','expired','dispute_opened','dispute_resolved','admin_cancelled'))
$$;

create function public.dropship_order_payments_json(p_order uuid, p_kinds text[]) returns jsonb
language sql stable set search_path = '' as
$$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'kind', p.kind, 'amountPesewas', p.amount_pesewas, 'method', p.method, 'paidOn', p.paid_on,
           'reference', p.reference, 'evidenceUrl', p.evidence_url, 'recordedRole', p.recorded_role, 'status', p.status,
           'confirmedAt', p.confirmed_at, 'rejectedReason', p.rejected_reason, 'createdAt', p.created_at)
         order by p.created_at), '[]'::jsonb)
    from public.dropship_order_payments p
   where p.order_id = p_order and p.kind = any (p_kinds)
$$;

create function public.dropship_order_dispute_json(p_order uuid, p_audience text) returns jsonb
language sql stable set search_path = '' as
$$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'kind', d.kind, 'reasonCode', d.reason_code,
           'description', case when p_audience in ('admin') or d.opened_role = p_audience then d.description end,
           'evidence', case when p_audience in ('admin') or d.opened_role = p_audience then d.evidence else '[]'::jsonb end,
           'openedRole', d.opened_role, 'status', d.status, 'outcome', d.outcome, 'resolution', d.resolution,
           'fault', case when p_audience = 'admin' then d.fault end, 'createdAt', d.created_at, 'resolvedAt', d.resolved_at)
         order by d.created_at), '[]'::jsonb)
    from public.dropship_disputes d where d.order_id = p_order
$$;

create function public.dropship_order_json(o public.dropship_orders, p_audience text) returns jsonb
language plpgsql stable set search_path = '' as
$$
declare
  v_base jsonb;
  v_code public.dropship_delivery_codes;
  v_sup public.dropship_participants;
  v_dsp public.dropship_participants;
  v_res public.dropship_reservations;
  v_wholesale bigint := coalesce(o.wholesale_unit_agreed, o.wholesale_unit_proposed, o.wholesale_unit_at_order);
begin
  v_base := jsonb_build_object(
    'id', o.id, 'orderNumber', o.order_number, 'title', o.title, 'image', o.image, 'quantity', o.quantity,
    'status', o.status, 'statusChangedAt', o.status_changed_at, 'deadlineAt', o.deadline_at,
    'createdAt', o.created_at, 'deliveredAt', o.delivered_at, 'completedAt', o.completed_at,
    'cancelledAt', o.cancelled_at, 'cancelledByRole', o.cancelled_by_role);
  select * into v_res from public.dropship_reservations where order_id = o.id order by requested_at desc limit 1;

  if p_audience = 'buyer' then
    select * into v_code from public.dropship_delivery_codes where order_id = o.id;
    select * into v_dsp from public.dropship_participants where user_id = o.dropshipper_id and kind = 'dropshipper';
    return v_base || jsonb_build_object(
      'productId', o.product_id, 'unitPricePesewas', o.retail_unit_pesewas, 'deliveryFeePesewas', o.delivery_fee_pesewas,
      'totalPesewas', o.total_pesewas,
      'delivery', jsonb_build_object('name', o.buyer_name, 'phone', o.buyer_phone, 'region', o.delivery_region,
                                     'area', o.delivery_area, 'address', o.delivery_address, 'instructions', o.delivery_instructions),
      'seller', jsonb_build_object('id', o.dropshipper_id, 'storeName', coalesce(v_dsp.display_name, 'Seller'),
                                   'phone', case when o.buyer_confirmed_at is not null then v_dsp.contact_phone end),
      'deliveryConfirmation', o.delivery_confirmation,
      'deliveryCode', case when v_code.order_id is not null and v_code.used_at is null and v_code.expires_at > now()
                                and o.status in ('collected','out_for_delivery','delivery_failed')
                           then v_code.code end,
      'deliveryCodeExpiresAt', case when v_code.used_at is null and o.status in ('collected','out_for_delivery','delivery_failed') then v_code.expires_at end,
      'returnWindowDays', o.return_window_days,
      'returnUntil', case when o.delivered_at is not null then o.delivered_at + make_interval(days => o.return_window_days) end,
      'payments', public.dropship_order_payments_json(o.id, array['buyer_to_reseller','refund_to_buyer']),
      'disputes', public.dropship_order_dispute_json(o.id, 'buyer'),
      'timeline', public.dropship_order_timeline(o.id, 'buyer'));
  end if;

  if p_audience = 'supplier' then
    select * into v_dsp from public.dropship_participants where user_id = o.dropshipper_id and kind = 'dropshipper';
    return v_base || jsonb_build_object(
      'supplierProductId', o.supplier_product_id,
      'wholesaleUnitPesewas', v_wholesale, 'wholesaleUnitAtOrder', o.wholesale_unit_at_order,
      'wholesaleTotalPesewas', v_wholesale * o.quantity,
      'reseller', jsonb_build_object('storeName', v_dsp.display_name, 'phone', v_dsp.contact_phone,
                                     'reliability', public.dropship_reliability_summary(o.dropshipper_id, 'dropshipper')),
      'reservation', case when v_res.id is null then null else jsonb_build_object(
                        'status', v_res.status, 'quantity', v_res.quantity, 'holdHours', v_res.hold_hours,
                        'requestedAt', v_res.requested_at, 'expiresAt', v_res.expires_at) end,
      'payments', public.dropship_order_payments_json(o.id, array['reseller_to_supplier','supplier_refund_to_reseller']),
      'disputes', public.dropship_order_dispute_json(o.id, 'supplier'),
      'timeline', public.dropship_order_timeline(o.id, 'supplier'));
  end if;

  -- dropshipper and admin
  select * into v_sup from public.dropship_participants where user_id = o.supplier_id and kind = 'supplier';
  v_base := v_base || jsonb_build_object(
    'productId', o.product_id, 'supplierProductId', o.supplier_product_id, 'listingId', o.listing_id,
    'unitPricePesewas', o.retail_unit_pesewas, 'deliveryFeePesewas', o.delivery_fee_pesewas, 'totalPesewas', o.total_pesewas,
    'wholesaleUnitAtOrder', o.wholesale_unit_at_order, 'wholesaleUnitProposed', o.wholesale_unit_proposed,
    'wholesaleUnitAgreed', o.wholesale_unit_agreed, 'wholesaleTotalPesewas', v_wholesale * o.quantity,
    'margin', jsonb_build_object(
      'retailTotalPesewas', o.total_pesewas,
      'wholesaleTotalPesewas', v_wholesale * o.quantity,
      'grossPesewas', o.total_pesewas - v_wholesale * o.quantity,
      'deliveryCostPesewas', o.reseller_delivery_cost_pesewas,
      'otherCostPesewas', o.reseller_other_cost_pesewas,
      'estimatedNetPesewas', o.total_pesewas - v_wholesale * o.quantity - o.reseller_delivery_cost_pesewas - o.reseller_other_cost_pesewas),
    'buyer', jsonb_build_object('name', o.buyer_name, 'phone', o.buyer_phone,
                                'reliability', public.dropship_reliability_summary(o.buyer_id, 'buyer')),
    'delivery', jsonb_build_object('region', o.delivery_region, 'area', o.delivery_area, 'address', o.delivery_address,
                                   'instructions', o.delivery_instructions),
    -- Pickup details only once the supplier has confirmed the reservation.
    'supplier', case when o.reserved_at is not null then jsonb_build_object(
                  'name', v_sup.display_name, 'phone', v_sup.contact_phone, 'region', v_sup.region, 'city', v_sup.city,
                  'address', v_sup.address_line) end,
    'reservation', case when v_res.id is null then null else jsonb_build_object(
                      'status', v_res.status, 'quantity', v_res.quantity, 'holdHours', v_res.hold_hours,
                      'requestedAt', v_res.requested_at, 'expiresAt', v_res.expires_at) end,
    'deliveryConfirmation', o.delivery_confirmation, 'deliveryAttempts', o.delivery_attempts,
    'returnUntil', case when o.delivered_at is not null then o.delivered_at + make_interval(days => o.return_window_days) end,
    'cancelReason', o.cancel_reason,
    'payments', public.dropship_order_payments_json(o.id, array['reseller_to_supplier','buyer_to_reseller','refund_to_buyer','supplier_refund_to_reseller']),
    'disputes', public.dropship_order_dispute_json(o.id, p_audience),
    'timeline', public.dropship_order_timeline(o.id, p_audience));

  if p_audience = 'admin' then
    v_base := v_base || jsonb_build_object(
      'buyerId', o.buyer_id, 'dropshipperId', o.dropshipper_id, 'supplierId', o.supplier_id,
      'resellerName', (select display_name from public.dropship_participants where user_id = o.dropshipper_id and kind = 'dropshipper'),
      'supplier', jsonb_build_object('name', v_sup.display_name, 'phone', v_sup.contact_phone, 'region', v_sup.region,
                                     'city', v_sup.city, 'address', v_sup.address_line),
      'supplierReliability', public.dropship_reliability_summary(o.supplier_id, 'supplier'),
      'resellerReliability', public.dropship_reliability_summary(o.dropshipper_id, 'dropshipper'),
      'codeAttempts', (select attempts from public.dropship_delivery_codes where order_id = o.id));
  end if;
  return v_base;
end $$;

-- Compact list rows.
create function public.dropship_order_row_json(o public.dropship_orders, p_audience text) returns jsonb
language sql stable set search_path = '' as
$$
  select jsonb_build_object('id', o.id, 'orderNumber', o.order_number, 'title', o.title, 'image', o.image,
           'quantity', o.quantity, 'status', o.status, 'deadlineAt', o.deadline_at, 'createdAt', o.created_at,
           'statusChangedAt', o.status_changed_at)
      || case when p_audience = 'supplier'
              then jsonb_build_object('wholesaleTotalPesewas',
                     coalesce(o.wholesale_unit_agreed, o.wholesale_unit_proposed, o.wholesale_unit_at_order) * o.quantity)
              else jsonb_build_object('totalPesewas', o.total_pesewas) end
      || case when p_audience = 'admin'
              then jsonb_build_object('buyerId', o.buyer_id, 'dropshipperId', o.dropshipper_id, 'supplierId', o.supplier_id)
              else '{}'::jsonb end
$$;

-- Who to tell about a change: [{userId, audience}]. Node turns these into notifications.
create function public.dropship_order_result(o public.dropship_orders, p_audience text, p_changed boolean, p_notify text[])
returns jsonb
language sql stable set search_path = '' as
$$
  select jsonb_build_object('order', public.dropship_order_json(o, p_audience), 'changed', p_changed,
    'notify', coalesce((select jsonb_agg(jsonb_build_object('userId', u.uid, 'audience', u.aud))
                          from (select case a when 'buyer' then o.buyer_id when 'dropshipper' then o.dropshipper_id
                                              when 'supplier' then o.supplier_id end as uid, a as aud
                                  from unnest(p_notify) a) u
                         where p_changed and u.uid is not null), '[]'::jsonb),
    'orderId', o.id, 'orderNumber', o.order_number, 'status', o.status, 'buyerEmail', o.buyer_email, 'title', o.title)
$$;

-- ---------------------------------------------------------------------------------------
-- Buyer: place an order. Idempotent on clientRequestId. The price, delivery fee and all
-- supplier values come from the database, never from the request.
-- Locks: listing FOR SHARE (5) -> supplier product FOR SHARE (6).
-- ---------------------------------------------------------------------------------------
create function public.dropship_place_order(p_buyer text, p_buyer_email text, p_product_id text, p_quantity integer,
                                            p_delivery jsonb, p_client_request_id uuid) returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_o public.dropship_orders;
  v_l public.dropship_listings;
  v_sp public.dropship_supplier_products;
  v_avail boolean;
  v_open integer;
  v_id uuid := gen_random_uuid();
  s public.dropship_order_settings := public.dropship_settings();
begin
  if p_client_request_id is null then
    perform public.dropship_fail('VALIDATION', 'clientRequestId is required');
  end if;
  select * into v_o from public.dropship_orders where buyer_id = p_buyer and client_request_id = p_client_request_id;
  if v_o.id is not null then
    return public.dropship_order_result(v_o, 'buyer', false, array[]::text[]);
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then
    perform public.dropship_fail('VALIDATION', 'quantity must be between 1 and 100');
  end if;

  select * into v_l from public.dropship_listings where product_id = p_product_id and status <> 'removed' for share;
  if v_l.id is null then
    perform public.dropship_fail('NOT_FOUND', 'listing not found');
  end if;
  select * into v_sp from public.dropship_supplier_products where id = v_l.supplier_product_id for share;
  if p_buyer = v_l.dropshipper_id or p_buyer = v_sp.supplier_id then
    perform public.dropship_fail('FORBIDDEN', 'you cannot order your own product');
  end if;
  select is_available into v_avail from public.dropship_listing_availability where listing_id = v_l.id;
  if not coalesce(v_avail, false) then
    perform public.dropship_fail('STATE_CONFLICT', 'this product is not available right now');
  end if;
  if p_quantity > v_sp.max_per_order or p_quantity > v_sp.stock_on_hand - v_sp.stock_reserved then
    perform public.dropship_fail('VALIDATION', 'you can order at most '
      || greatest(least(v_sp.max_per_order, v_sp.stock_on_hand - v_sp.stock_reserved), 0) || ' of this item');
  end if;

  select count(*) into v_open from public.dropship_orders
   where buyer_id = p_buyer and status not in ('completed','returned','cancelled');
  if v_open >= s.max_open_orders_per_buyer then
    perform public.dropship_fail('STATE_CONFLICT', 'you have too many open orders; finish or cancel one first');
  end if;

  insert into public.dropship_orders
    (id, order_number, buyer_id, client_request_id, listing_id, dropshipper_id, supplier_id, supplier_product_id, product_id,
     title, image, quantity, retail_unit_pesewas, delivery_fee_pesewas, total_pesewas,
     wholesale_unit_at_order, price_version_at_order, return_window_days,
     buyer_name, buyer_phone, buyer_email, delivery_region, delivery_area, delivery_address, delivery_instructions,
     deadline_at)
  values
    (v_id, 'TB-' || upper(substr(replace(v_id::text, '-', ''), 1, 8)), p_buyer, p_client_request_id, v_l.id, v_l.dropshipper_id,
     v_sp.supplier_id, v_sp.id, v_l.product_id, v_sp.title, v_sp.images->>0, p_quantity,
     v_l.retail_price_pesewas, v_l.delivery_fee_pesewas, v_l.retail_price_pesewas * p_quantity + v_l.delivery_fee_pesewas,
     v_sp.wholesale_price_pesewas, v_sp.price_version, v_sp.return_window_days,
     btrim(p_delivery->>'name'), regexp_replace(coalesce(p_delivery->>'phone', ''), '[\s-]', '', 'g'), nullif(btrim(p_buyer_email), ''),
     btrim(p_delivery->>'region'), btrim(p_delivery->>'area'), btrim(p_delivery->>'address'),
     nullif(btrim(p_delivery->>'instructions'), ''),
     now() + make_interval(hours => s.buyer_confirm_hours))
  on conflict (buyer_id, client_request_id) do nothing
  returning * into v_o;
  if v_o.id is null then
    select * into v_o from public.dropship_orders where buyer_id = p_buyer and client_request_id = p_client_request_id;
    return public.dropship_order_result(v_o, 'buyer', false, array[]::text[]);
  end if;

  perform public.dropship_order_event(v_o.id, p_buyer, 'buyer', 'placed', null, 'placed', null,
    jsonb_build_object('quantity', p_quantity, 'totalPesewas', v_o.total_pesewas));
  return public.dropship_order_result(v_o, 'buyer', true, array['buyer','dropshipper']);
end $$;

-- ---------------------------------------------------------------------------------------
-- One entry point per role. p_action picks the move; p_input carries its fields.
-- ---------------------------------------------------------------------------------------

-- Buyer moves: confirm | cancel | received | return | dispute
create function public.dropship_buyer_order_action(p_buyer text, p_order uuid, p_action text, p_input jsonb) returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_o public.dropship_orders := public.dropship_lock_order(p_buyer, 'buyer', p_order);
  v_in jsonb := coalesce(p_input, '{}'::jsonb);
begin
  if p_action = 'confirm' then
    if v_o.status <> 'placed' and v_o.buyer_confirmed_at is not null then
      return public.dropship_order_result(v_o, 'buyer', false, array[]::text[]);
    end if;
    perform public.dropship_require_status(v_o, array['placed']);
    v_o := public.dropship_order_move(v_o, p_buyer, 'buyer', 'buyer_confirmed', 'buyer_confirmed', null, '{}'::jsonb);
    return public.dropship_order_result(v_o, 'buyer', true, array['dropshipper']);

  elsif p_action = 'cancel' then
    if v_o.status = 'cancelled' then
      return public.dropship_order_result(v_o, 'buyer', false, array[]::text[]);
    end if;
    -- Only before the reseller has paid the supplier.
    perform public.dropship_require_status(v_o, array['placed','buyer_confirmed','accepted','reservation_requested','price_review','reserved']);
    v_o := public.dropship_order_cancel_internal(v_o, p_buyer, 'buyer', 'cancelled',
                                                 coalesce(nullif(btrim(v_in->>'reason'), ''), 'Buyer cancelled'), '{}'::jsonb);
    perform public.dropship_reliability(v_o.buyer_id, 'buyer', 'cancelled_before_purchase', 'neutral', true, v_o.id, 'system', '{}'::jsonb);
    return public.dropship_order_result(v_o, 'buyer', true,
      case when v_o.reserved_at is not null or v_o.accepted_at is not null then array['dropshipper','supplier'] else array['dropshipper'] end);

  elsif p_action = 'received' then
    if v_o.status in ('delivered','completed') then
      if v_o.delivery_confirmation = 'reseller_only' then
        update public.dropship_orders set delivery_confirmation = 'buyer', updated_at = now() where id = v_o.id returning * into v_o;
        perform public.dropship_order_event(v_o.id, p_buyer, 'buyer', 'buyer_confirmed_receipt', v_o.status, v_o.status, null, '{}'::jsonb);
        return public.dropship_order_result(v_o, 'buyer', true, array['dropshipper']);
      end if;
      return public.dropship_order_result(v_o, 'buyer', false, array[]::text[]);
    end if;
    perform public.dropship_require_status(v_o, array['collected','out_for_delivery','delivery_failed']);
    update public.dropship_delivery_codes set used_at = now() where order_id = v_o.id and used_at is null;
    update public.dropship_orders set delivery_confirmation = 'buyer' where id = v_o.id returning * into v_o;
    v_o := public.dropship_order_move(v_o, p_buyer, 'buyer', 'delivered', 'delivered', null,
                                      jsonb_build_object('confirmation', 'buyer'));
    return public.dropship_order_result(v_o, 'buyer', true, array['dropshipper']);

  elsif p_action in ('return', 'dispute') then
    return public.dropship_open_dispute(v_o, p_buyer, 'buyer', p_action, v_in);
  end if;
  perform public.dropship_fail('VALIDATION', 'unknown action');
  return null;
end $$;

-- Dispute / return opening shared by all roles. Returns move the order to return_requested;
-- disputes freeze it in 'disputed' until an admin resolves it.
create function public.dropship_open_dispute(v_o public.dropship_orders, p_actor text, p_role text, p_kind text, p_in jsonb)
returns jsonb
language plpgsql set search_path = '' as
$$
declare
  v_reason text := p_in->>'reasonCode';
  v_to text;
begin
  if exists (select 1 from public.dropship_disputes where order_id = v_o.id and status = 'open') then
    if v_o.status in ('disputed','return_requested') then
      return public.dropship_order_result(v_o, p_role, false, array[]::text[]);
    end if;
    perform public.dropship_fail('STATE_CONFLICT', 'this order already has an open case');
  end if;
  if p_kind = 'return' then
    if p_role <> 'buyer' then perform public.dropship_fail('FORBIDDEN', 'only the buyer can request a return'); end if;
    perform public.dropship_require_status(v_o, array['completed']);
    if v_o.delivered_at + make_interval(days => v_o.return_window_days) < now() then
      perform public.dropship_fail('STATE_CONFLICT', 'the return window for this order has ended');
    end if;
    if v_reason is null or v_reason not in ('wrong_item','defective','changed_mind','other') then
      perform public.dropship_fail('VALIDATION', 'reasonCode must be wrong_item, defective, changed_mind or other');
    end if;
    v_to := 'return_requested';
  else
    if p_role = 'buyer' then
      -- Buyers can raise a problem at any point after placing, and after completion inside
      -- the return window.
      if v_o.status in ('cancelled','returned','disputed','return_requested') then
        perform public.dropship_fail('STATE_CONFLICT', 'a problem cannot be reported on this order now');
      end if;
      if v_o.status = 'completed' and v_o.delivered_at + make_interval(days => greatest(v_o.return_window_days, 7)) < now() then
        perform public.dropship_fail('STATE_CONFLICT', 'this order closed too long ago to report a problem here');
      end if;
    else
      -- Resellers and suppliers: once money has moved (payment declared) and before the end.
      perform public.dropship_require_status(v_o, array['supplier_payment_declared','supplier_paid','released','collected',
                                                        'out_for_delivery','delivered','delivery_failed']);
    end if;
    if v_reason is null or v_reason not in ('paid_not_released','payment_not_received','wrong_item','defective','not_delivered',
                                            'advance_payment_requested','buyer_refused','fake_order','invalid_contact',
                                            'price_dispute','other') then
      perform public.dropship_fail('VALIDATION', 'unknown reasonCode');
    end if;
    v_to := 'disputed';
  end if;

  insert into public.dropship_disputes (order_id, kind, reason_code, description, evidence, opened_by, opened_role, from_status)
  values (v_o.id, p_kind, v_reason, btrim(coalesce(p_in->>'description', '')), coalesce(p_in->'evidence', '[]'::jsonb),
          p_actor, p_role, v_o.status);
  v_o := public.dropship_order_move(v_o, p_actor, p_role, case when p_kind = 'return' then 'return_requested' else 'dispute_opened' end,
                                    v_to, p_in->>'description', jsonb_build_object('reasonCode', v_reason));
  -- A report by one party is stored unverified; it never counts against anyone on its own.
  return public.dropship_order_result(v_o, p_role, true,
    case when p_kind = 'return' then array['dropshipper']
         when p_role = 'buyer' then array['dropshipper']
         when p_role = 'dropshipper' then array['supplier']
         else array['dropshipper'] end);
end $$;

-- Reseller moves.
create function public.dropship_reseller_order_action(p_actor text, p_order uuid, p_action text, p_input jsonb) returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_o public.dropship_orders := public.dropship_lock_order(p_actor, 'dropshipper', p_order);
  v_in jsonb := coalesce(p_input, '{}'::jsonb);
  v_sp public.dropship_supplier_products;
  v_hold integer;
  v_amount bigint;
  v_code public.dropship_delivery_codes;
  v_reason text;
  s public.dropship_order_settings := public.dropship_settings();
  v_d public.dropship_disputes;
begin
  if p_action = 'accept' then
    if v_o.accepted_at is not null and v_o.status <> 'cancelled' then
      return public.dropship_order_result(v_o, 'dropshipper', false, array[]::text[]);
    end if;
    perform public.dropship_require_status(v_o, array['buyer_confirmed']);
    v_o := public.dropship_order_move(v_o, p_actor, 'dropshipper', 'accepted', 'accepted', null, '{}'::jsonb);
    return public.dropship_order_result(v_o, 'dropshipper', true, array['buyer']);

  elsif p_action in ('reject', 'cancel') then
    if v_o.status = 'cancelled' then
      return public.dropship_order_result(v_o, 'dropshipper', false, array[]::text[]);
    end if;
    perform public.dropship_require_status(v_o, array['placed','buyer_confirmed','accepted','reservation_requested','price_review','reserved']);
    v_reason := btrim(coalesce(v_in->>'reason', ''));
    if char_length(v_reason) < 3 then
      perform public.dropship_fail('VALIDATION', 'a reason is required');
    end if;
    v_o := public.dropship_order_cancel_internal(v_o, p_actor, 'dropshipper', case when p_action = 'reject' then 'rejected' else 'cancelled' end,
                                                 v_reason, jsonb_build_object('reasonCode', v_in->>'reasonCode'));
    return public.dropship_order_result(v_o, 'dropshipper', true,
      case when v_o.reserved_at is not null or exists (select 1 from public.dropship_reservations r where r.order_id = v_o.id)
           then array['buyer','supplier'] else array['buyer'] end);

  elsif p_action = 'request_reservation' then
    if v_o.status in ('reservation_requested','price_review','reserved') then
      return public.dropship_order_result(v_o, 'dropshipper', false, array[]::text[]);
    end if;
    perform public.dropship_require_status(v_o, array['accepted']);
    v_hold := coalesce((v_in->>'holdHours')::integer, s.reservation_hours);
    if v_hold < s.reservation_min_hours or v_hold > s.reservation_max_hours then
      perform public.dropship_fail('VALIDATION', 'holdHours must be between ' || s.reservation_min_hours || ' and ' || s.reservation_max_hours);
    end if;
    select * into v_sp from public.dropship_supplier_products where id = v_o.supplier_product_id for share;
    -- Limits use today's wholesale price: the reseller would pay at least this much.
    perform public.dropship_check_exposure(p_actor, v_o.id, greatest(v_sp.wholesale_price_pesewas, v_o.wholesale_unit_at_order) * v_o.quantity);
    insert into public.dropship_reservations (order_id, supplier_product_id, quantity, hold_hours)
    values (v_o.id, v_o.supplier_product_id, v_o.quantity, v_hold);
    v_o := public.dropship_order_move(v_o, p_actor, 'dropshipper', 'reservation_requested', 'reservation_requested', null,
                                      jsonb_build_object('holdHours', v_hold));
    return public.dropship_order_result(v_o, 'dropshipper', true, array['supplier']);

  elsif p_action = 'accept_price' then
    if v_o.status = 'reserved' and v_o.wholesale_unit_agreed is not null then
      return public.dropship_order_result(v_o, 'dropshipper', false, array[]::text[]);
    end if;
    perform public.dropship_require_status(v_o, array['price_review']);
    if (v_in->>'wholesaleUnitPesewas')::bigint is distinct from v_o.wholesale_unit_proposed then
      perform public.dropship_fail('STATE_CONFLICT', 'the price you saw is not the current proposed price; reload the order');
    end if;
    perform public.dropship_check_exposure(p_actor, v_o.id, v_o.wholesale_unit_proposed * v_o.quantity);
    update public.dropship_orders set wholesale_unit_agreed = wholesale_unit_proposed where id = v_o.id returning * into v_o;
    v_o := public.dropship_order_move(v_o, p_actor, 'dropshipper', 'price_accepted', 'reserved', null,
                                      jsonb_build_object('wholesaleUnitPesewas', v_o.wholesale_unit_agreed));
    return public.dropship_order_result(v_o, 'dropshipper', true, array['supplier']);

  elsif p_action = 'decline_price' then
    if v_o.status = 'cancelled' then
      return public.dropship_order_result(v_o, 'dropshipper', false, array[]::text[]);
    end if;
    perform public.dropship_require_status(v_o, array['price_review']);
    v_o := public.dropship_order_cancel_internal(v_o, p_actor, 'dropshipper', 'price_declined',
                                                 'Reseller declined the new wholesale price', '{}'::jsonb);
    return public.dropship_order_result(v_o, 'dropshipper', true, array['buyer','supplier']);

  elsif p_action = 'declare_supplier_payment' then
    if v_o.status in ('supplier_payment_declared','supplier_paid') then
      return public.dropship_order_result(v_o, 'dropshipper', false, array[]::text[]);
    end if;
    perform public.dropship_require_status(v_o, array['reserved']);
    v_amount := (v_in->>'amountPesewas')::bigint;
    if v_amount is null or v_amount <= 0 then
      perform public.dropship_fail('VALIDATION', 'amountPesewas is required');
    end if;
    insert into public.dropship_order_payments
      (order_id, kind, amount_pesewas, method, paid_on, reference, evidence_url, recorded_by, recorded_role, status)
    values (v_o.id, 'reseller_to_supplier', v_amount, v_in->>'method', coalesce((v_in->>'paidOn')::date, current_date),
            nullif(btrim(v_in->>'reference'), ''), nullif(btrim(v_in->>'evidenceUrl'), ''), p_actor, 'dropshipper', 'declared');
    v_o := public.dropship_order_move(v_o, p_actor, 'dropshipper', 'supplier_payment_declared', 'supplier_payment_declared', null,
                                      jsonb_build_object('amountPesewas', v_amount, 'method', v_in->>'method'));
    return public.dropship_order_result(v_o, 'dropshipper', true, array['supplier']);

  elsif p_action = 'collected' then
    if v_o.collected_at is not null and v_o.status <> 'released' then
      return public.dropship_order_result(v_o, 'dropshipper', false, array[]::text[]);
    end if;
    perform public.dropship_require_status(v_o, array['released']);
    v_o := public.dropship_order_move(v_o, p_actor, 'dropshipper', 'collected', 'collected', null, '{}'::jsonb);
    return public.dropship_order_result(v_o, 'dropshipper', true, array['buyer','supplier']);

  elsif p_action = 'out_for_delivery' then
    -- p_input.code is generated by the server (crypto.randomInt), never by the client.
    if v_o.status = 'out_for_delivery' then
      return public.dropship_order_result(v_o, 'dropshipper', false, array[]::text[]);
    end if;
    perform public.dropship_require_status(v_o, array['collected','delivery_failed']);
    if coalesce(v_in->>'code', '') !~ '^[0-9]{6}$' then
      perform public.dropship_fail('VALIDATION', 'code is required');
    end if;
    insert into public.dropship_delivery_codes (order_id, code, expires_at)
    values (v_o.id, v_in->>'code', now() + make_interval(hours => s.code_valid_hours))
    on conflict (order_id) do update set code = excluded.code, attempts = 0, issued_at = now(), expires_at = excluded.expires_at,
      used_at = null, issued_count = 1;
    update public.dropship_orders set delivery_attempts = delivery_attempts + 1 where id = v_o.id returning * into v_o;
    v_o := public.dropship_order_move(v_o, p_actor, 'dropshipper', 'out_for_delivery', 'out_for_delivery', null,
                                      jsonb_build_object('attempt', v_o.delivery_attempts));
    return public.dropship_order_result(v_o, 'dropshipper', true, array['buyer']) || jsonb_build_object('codeIssued', true);

  elsif p_action = 'resend_code' then
    perform public.dropship_require_status(v_o, array['out_for_delivery']);
    select * into v_code from public.dropship_delivery_codes where order_id = v_o.id for no key update;
    -- At most 3 codes per delivery attempt.
    if v_code.issued_count >= 3 then
      perform public.dropship_fail('STATE_CONFLICT', 'no more new codes for this delivery; ask the buyer to tap "I received it" or contact support');
    end if;
    if coalesce(v_in->>'code', '') !~ '^[0-9]{6}$' then
      perform public.dropship_fail('VALIDATION', 'code is required');
    end if;
    update public.dropship_delivery_codes set code = v_in->>'code', attempts = 0, issued_at = now(),
      expires_at = now() + make_interval(hours => s.code_valid_hours), issued_count = issued_count + 1
     where order_id = v_o.id;
    perform public.dropship_order_event(v_o.id, p_actor, 'dropshipper', 'code_resent', v_o.status, v_o.status, null, '{}'::jsonb);
    return public.dropship_order_result(v_o, 'dropshipper', true, array['buyer']) || jsonb_build_object('codeIssued', true);

  elsif p_action = 'verify_code' then
    if v_o.status in ('delivered','completed') then
      return public.dropship_order_result(v_o, 'dropshipper', false, array[]::text[]) || jsonb_build_object('codeOk', true);
    end if;
    perform public.dropship_require_status(v_o, array['out_for_delivery']);
    select * into v_code from public.dropship_delivery_codes where order_id = v_o.id for no key update;
    if v_code.order_id is null or v_code.used_at is not null then
      perform public.dropship_fail('STATE_CONFLICT', 'there is no active code for this delivery');
    end if;
    if v_code.expires_at <= now() then
      return public.dropship_order_result(v_o, 'dropshipper', false, array[]::text[])
             || jsonb_build_object('codeOk', false, 'codeProblem', 'expired', 'attemptsLeft', 0);
    end if;
    if v_code.attempts >= 5 then
      return public.dropship_order_result(v_o, 'dropshipper', false, array[]::text[])
             || jsonb_build_object('codeOk', false, 'codeProblem', 'locked', 'attemptsLeft', 0);
    end if;
    if coalesce(v_in->>'code', '') <> v_code.code then
      -- A normal result, so the attempt counter commits.
      update public.dropship_delivery_codes set attempts = attempts + 1 where order_id = v_o.id;
      perform public.dropship_order_event(v_o.id, p_actor, 'dropshipper', 'code_wrong', v_o.status, v_o.status, null,
                                          jsonb_build_object('attempt', v_code.attempts + 1));
      return public.dropship_order_result(v_o, 'dropshipper', false, array[]::text[])
             || jsonb_build_object('codeOk', false, 'codeProblem', case when v_code.attempts + 1 >= 5 then 'locked' else 'wrong' end,
                                   'attemptsLeft', greatest(4 - v_code.attempts, 0));
    end if;
    update public.dropship_delivery_codes set used_at = now() where order_id = v_o.id;
    update public.dropship_orders set delivery_confirmation = 'code' where id = v_o.id returning * into v_o;
    v_o := public.dropship_order_move(v_o, p_actor, 'dropshipper', 'delivered', 'delivered', null,
                                      jsonb_build_object('confirmation', 'code'));
    return public.dropship_order_result(v_o, 'dropshipper', true, array['buyer']) || jsonb_build_object('codeOk', true);

  elsif p_action = 'delivered_without_code' then
    if v_o.status in ('delivered','completed') then
      return public.dropship_order_result(v_o, 'dropshipper', false, array[]::text[]);
    end if;
    perform public.dropship_require_status(v_o, array['out_for_delivery']);
    v_reason := btrim(coalesce(v_in->>'note', ''));
    if char_length(v_reason) < 5 then
      perform public.dropship_fail('VALIDATION', 'explain why the code could not be used');
    end if;
    update public.dropship_delivery_codes set used_at = now() where order_id = v_o.id and used_at is null;
    update public.dropship_orders set delivery_confirmation = 'reseller_only' where id = v_o.id returning * into v_o;
    v_o := public.dropship_order_move(v_o, p_actor, 'dropshipper', 'delivered', 'delivered', v_reason,
                                      jsonb_build_object('confirmation', 'reseller_only'));
    return public.dropship_order_result(v_o, 'dropshipper', true, array['buyer']);

  elsif p_action = 'delivery_failed' then
    if v_o.status = 'delivery_failed' then
      return public.dropship_order_result(v_o, 'dropshipper', false, array[]::text[]);
    end if;
    perform public.dropship_require_status(v_o, array['out_for_delivery']);
    v_reason := v_in->>'reasonCode';
    if v_reason is null or v_reason not in ('buyer_unreachable','buyer_refused','wrong_address','other') then
      perform public.dropship_fail('VALIDATION', 'reasonCode must be buyer_unreachable, buyer_refused, wrong_address or other');
    end if;
    v_o := public.dropship_order_move(v_o, p_actor, 'dropshipper', 'delivery_failed', 'delivery_failed', v_in->>'note',
                                      jsonb_build_object('reasonCode', v_reason));
    if v_reason <> 'other' then
      -- The reseller's word only: stored unverified.
      perform public.dropship_reliability(v_o.buyer_id, 'buyer', 'reported_' || v_reason, 'negative', false, v_o.id, 'report',
                                          jsonb_build_object('by', 'dropshipper'));
    end if;
    return public.dropship_order_result(v_o, 'dropshipper', true, array['buyer']);

  elsif p_action = 'close_failed' then
    if v_o.status = 'cancelled' then
      return public.dropship_order_result(v_o, 'dropshipper', false, array[]::text[]);
    end if;
    perform public.dropship_require_status(v_o, array['delivery_failed']);
    v_o := public.dropship_order_cancel_internal(v_o, p_actor, 'dropshipper', 'closed_after_failed_delivery',
                                                 coalesce(nullif(btrim(v_in->>'reason'), ''), 'Delivery failed'), '{}'::jsonb);
    return public.dropship_order_result(v_o, 'dropshipper', true, array['buyer']);

  elsif p_action = 'record_payment' then
    if v_o.status = 'completed' then
      return public.dropship_order_result(v_o, 'dropshipper', false, array[]::text[]);
    end if;
    -- Delivery must be recorded first: a code, the buyer's tap, or the reseller's note.
    perform public.dropship_require_status(v_o, array['delivered']);
    v_amount := (v_in->>'amountPesewas')::bigint;
    if v_amount is null or v_amount <= 0 then
      perform public.dropship_fail('VALIDATION', 'amountPesewas is required');
    end if;
    insert into public.dropship_order_payments
      (order_id, kind, amount_pesewas, method, paid_on, reference, recorded_by, recorded_role, status)
    values (v_o.id, 'buyer_to_reseller', v_amount, v_in->>'method', coalesce((v_in->>'paidOn')::date, current_date),
            nullif(btrim(v_in->>'reference'), ''), p_actor, 'dropshipper', 'recorded');
    v_o := public.dropship_order_move(v_o, p_actor, 'dropshipper', 'buyer_payment_recorded', 'completed', null,
                                      jsonb_build_object('amountPesewas', v_amount, 'method', v_in->>'method',
                                                         'matchesTotal', v_amount = v_o.total_pesewas));
    perform public.dropship_reliability(v_o.buyer_id, 'buyer', 'order_completed', 'positive', true, v_o.id, 'system', '{}'::jsonb);
    perform public.dropship_reliability(v_o.dropshipper_id, 'dropshipper', 'order_completed', 'positive', true, v_o.id, 'system', '{}'::jsonb);
    return public.dropship_order_result(v_o, 'dropshipper', true, array['buyer']);

  elsif p_action = 'set_costs' then
    update public.dropship_orders set
      reseller_delivery_cost_pesewas = coalesce((v_in->>'deliveryCostPesewas')::bigint, reseller_delivery_cost_pesewas),
      reseller_other_cost_pesewas = coalesce((v_in->>'otherCostPesewas')::bigint, reseller_other_cost_pesewas),
      updated_at = now()
     where id = v_o.id returning * into v_o;
    return public.dropship_order_result(v_o, 'dropshipper', true, array[]::text[]);

  elsif p_action in ('return_accept', 'return_reject') then
    select * into v_d from public.dropship_disputes where order_id = v_o.id and status = 'open' and kind = 'return' for no key update;
    if v_d.id is null then
      if v_o.status in ('returned','completed') then
        return public.dropship_order_result(v_o, 'dropshipper', false, array[]::text[]);
      end if;
      perform public.dropship_fail('STATE_CONFLICT', 'there is no open return request');
    end if;
    perform public.dropship_require_status(v_o, array['return_requested']);
    if p_action = 'return_accept' then
      -- The item has come back and any refund was paid outside TedBuy; record it.
      v_amount := (v_in->>'refundPesewas')::bigint;
      if v_amount is not null and v_amount > 0 then
        insert into public.dropship_order_payments
          (order_id, kind, amount_pesewas, method, paid_on, reference, recorded_by, recorded_role, status)
        values (v_o.id, 'refund_to_buyer', v_amount, coalesce(v_in->>'method', 'other'), coalesce((v_in->>'paidOn')::date, current_date),
                nullif(btrim(v_in->>'reference'), ''), p_actor, 'dropshipper', 'recorded');
      end if;
      update public.dropship_disputes set status = 'resolved', outcome = 'returned', resolution = nullif(btrim(v_in->>'note'), ''),
        resolved_by = p_actor, resolved_role = 'dropshipper', resolved_at = now() where id = v_d.id;
      v_o := public.dropship_order_move(v_o, p_actor, 'dropshipper', 'returned', 'returned', v_in->>'note',
                                        jsonb_build_object('refundPesewas', v_amount));
      return public.dropship_order_result(v_o, 'dropshipper', true, array['buyer','supplier']);
    end if;
    v_reason := btrim(coalesce(v_in->>'note', ''));
    if char_length(v_reason) < 5 then
      perform public.dropship_fail('VALIDATION', 'explain why the return is refused');
    end if;
    update public.dropship_disputes set status = 'resolved', outcome = 'rejected', resolution = v_reason,
      resolved_by = p_actor, resolved_role = 'dropshipper', resolved_at = now() where id = v_d.id;
    v_o := public.dropship_order_move(v_o, p_actor, 'dropshipper', 'return_refused', 'completed', v_reason, '{}'::jsonb);
    return public.dropship_order_result(v_o, 'dropshipper', true, array['buyer']);

  elsif p_action = 'dispute' then
    return public.dropship_open_dispute(v_o, p_actor, 'dropshipper', 'dispute', v_in);
  end if;
  perform public.dropship_fail('VALIDATION', 'unknown action');
  return null;
end $$;

-- Supplier moves.
create function public.dropship_supplier_order_action(p_actor text, p_order uuid, p_action text, p_input jsonb) returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_o public.dropship_orders := public.dropship_lock_order(p_actor, 'supplier', p_order);
  v_in jsonb := coalesce(p_input, '{}'::jsonb);
  v_r public.dropship_reservations;
  v_sp public.dropship_supplier_products;
  v_p public.dropship_order_payments;
  v_reason text;
begin
  if p_action = 'confirm_reservation' then
    if v_o.status in ('reserved','price_review') then
      return public.dropship_order_result(v_o, 'supplier', false, array[]::text[]);
    end if;
    perform public.dropship_require_status(v_o, array['reservation_requested']);
    select * into v_r from public.dropship_reservations where order_id = v_o.id and status = 'requested' for no key update;
    -- The row lock on the supplier product serialises every reservation of this product.
    select * into v_sp from public.dropship_supplier_products where id = v_o.supplier_product_id for no key update;
    if v_sp.stock_on_hand - v_sp.stock_reserved < v_r.quantity then
      perform public.dropship_fail('STATE_CONFLICT', 'only ' || greatest(v_sp.stock_on_hand - v_sp.stock_reserved, 0)
                                   || ' available; update your stock or decline the request');
    end if;
    update public.dropship_supplier_products set stock_reserved = stock_reserved + v_r.quantity, updated_at = now()
     where id = v_sp.id returning * into v_sp;
    insert into public.dropship_stock_events
      (supplier_product_id, order_id, event_type, delta_on_hand, delta_reserved, on_hand_after, reserved_after, actor, reason)
    values (v_sp.id, v_o.id, 'reserve', 0, v_r.quantity, v_sp.stock_on_hand, v_sp.stock_reserved, p_actor, null);
    update public.dropship_reservations set status = 'confirmed', responded_at = now(),
      expires_at = now() + make_interval(hours => hold_hours) where id = v_r.id;
    -- The price is today's catalogue price, read here; a change goes to the reseller first.
    if v_sp.wholesale_price_pesewas = v_o.wholesale_unit_at_order then
      update public.dropship_orders set wholesale_unit_agreed = v_sp.wholesale_price_pesewas, reserved_at = now()
       where id = v_o.id returning * into v_o;
      v_o := public.dropship_order_move(v_o, p_actor, 'supplier', 'reservation_confirmed', 'reserved', null, '{}'::jsonb);
    else
      update public.dropship_orders set wholesale_unit_proposed = v_sp.wholesale_price_pesewas, reserved_at = now()
       where id = v_o.id returning * into v_o;
      v_o := public.dropship_order_move(v_o, p_actor, 'supplier', 'reservation_confirmed', 'price_review', null,
                                        jsonb_build_object('priceChangedFrom', v_o.wholesale_unit_at_order,
                                                           'priceChangedTo', v_sp.wholesale_price_pesewas));
    end if;
    return public.dropship_order_result(v_o, 'supplier', true, array['dropshipper']);

  elsif p_action = 'decline_reservation' then
    if v_o.status = 'cancelled' then
      return public.dropship_order_result(v_o, 'supplier', false, array[]::text[]);
    end if;
    perform public.dropship_require_status(v_o, array['reservation_requested']);
    v_reason := v_in->>'reasonCode';
    if v_reason is null or v_reason not in ('out_of_stock','cannot_release','other') then
      perform public.dropship_fail('VALIDATION', 'reasonCode must be out_of_stock, cannot_release or other');
    end if;
    perform public.dropship_release_reservation(v_o.id, p_actor, 'declined', v_reason);
    v_o := public.dropship_order_move(v_o, p_actor, 'supplier', 'reservation_declined', 'cancelled',
                                      coalesce(nullif(btrim(v_in->>'note'), ''), 'Supplier could not reserve the item'),
                                      jsonb_build_object('reasonCode', v_reason));
    perform public.dropship_reliability(v_o.supplier_id, 'supplier', 'reservation_declined', 'neutral', true, v_o.id, 'system',
                                        jsonb_build_object('reasonCode', v_reason));
    return public.dropship_order_result(v_o, 'supplier', true, array['buyer','dropshipper']);

  elsif p_action in ('confirm_payment', 'reject_payment') then
    if (p_action = 'confirm_payment' and v_o.supplier_paid_at is not null)
       or (p_action = 'reject_payment' and v_o.status = 'reserved') then
      return public.dropship_order_result(v_o, 'supplier', false, array[]::text[]);
    end if;
    perform public.dropship_require_status(v_o, array['supplier_payment_declared']);
    select * into v_p from public.dropship_order_payments
     where order_id = v_o.id and kind = 'reseller_to_supplier' and status = 'declared' for no key update;
    if p_action = 'confirm_payment' then
      update public.dropship_order_payments set status = 'confirmed', confirmed_by = p_actor, confirmed_at = now() where id = v_p.id;
      v_o := public.dropship_order_move(v_o, p_actor, 'supplier', 'supplier_payment_confirmed', 'supplier_paid', null,
                                        jsonb_build_object('amountPesewas', v_p.amount_pesewas));
      return public.dropship_order_result(v_o, 'supplier', true, array['dropshipper']);
    end if;
    v_reason := btrim(coalesce(v_in->>'reason', ''));
    if char_length(v_reason) < 3 then
      perform public.dropship_fail('VALIDATION', 'a reason is required');
    end if;
    update public.dropship_order_payments set status = 'rejected', rejected_reason = v_reason where id = v_p.id;
    -- Back to reserved. If the reservation has run out meanwhile, give it a short new window
    -- so the reseller can pay again or open a dispute (money may already have moved).
    update public.dropship_reservations set expires_at = greatest(expires_at, now() + interval '24 hours')
     where order_id = v_o.id and status = 'confirmed';
    v_o := public.dropship_order_move(v_o, p_actor, 'supplier', 'supplier_payment_rejected', 'reserved', v_reason, '{}'::jsonb);
    return public.dropship_order_result(v_o, 'supplier', true, array['dropshipper']);

  elsif p_action = 'released' then
    if v_o.released_at is not null then
      return public.dropship_order_result(v_o, 'supplier', false, array[]::text[]);
    end if;
    -- Never before the supplier has confirmed the money.
    perform public.dropship_require_status(v_o, array['supplier_paid']);
    select * into v_r from public.dropship_reservations where order_id = v_o.id and status = 'confirmed' for no key update;
    select * into v_sp from public.dropship_supplier_products where id = v_o.supplier_product_id for no key update;
    update public.dropship_supplier_products set
      stock_on_hand = greatest(stock_on_hand - v_r.quantity, 0),
      stock_reserved = greatest(stock_reserved - v_r.quantity, 0), updated_at = now()
     where id = v_sp.id returning * into v_sp;
    insert into public.dropship_stock_events
      (supplier_product_id, order_id, event_type, delta_on_hand, delta_reserved, on_hand_after, reserved_after, actor, reason)
    values (v_sp.id, v_o.id, 'commit_dispatch', -v_r.quantity, -v_r.quantity, v_sp.stock_on_hand, v_sp.stock_reserved, p_actor, null);
    update public.dropship_reservations set status = 'committed', ended_at = now(), end_reason = 'released' where id = v_r.id;
    v_o := public.dropship_order_move(v_o, p_actor, 'supplier', 'released', 'released', null,
                                      jsonb_build_object('quantity', v_r.quantity));
    perform public.dropship_reliability(v_o.supplier_id, 'supplier', 'order_fulfilled', 'positive', true, v_o.id, 'system', '{}'::jsonb);
    return public.dropship_order_result(v_o, 'supplier', true, array['dropshipper']);

  elsif p_action = 'record_refund' then
    -- Supplier records a refund it paid the reseller (outside TedBuy) after a return.
    perform public.dropship_require_status(v_o, array['returned','return_requested','disputed']);
    insert into public.dropship_order_payments
      (order_id, kind, amount_pesewas, method, paid_on, reference, recorded_by, recorded_role, status)
    values (v_o.id, 'supplier_refund_to_reseller', (v_in->>'amountPesewas')::bigint, coalesce(v_in->>'method', 'other'),
            coalesce((v_in->>'paidOn')::date, current_date), nullif(btrim(v_in->>'reference'), ''), p_actor, 'supplier', 'recorded');
    perform public.dropship_order_event(v_o.id, p_actor, 'supplier', 'supplier_refund_recorded', v_o.status, v_o.status, null,
                                        jsonb_build_object('amountPesewas', (v_in->>'amountPesewas')::bigint));
    return public.dropship_order_result(v_o, 'supplier', true, array['dropshipper']);

  elsif p_action = 'dispute' then
    return public.dropship_open_dispute(v_o, p_actor, 'supplier', 'dispute', v_in);
  end if;
  perform public.dropship_fail('VALIDATION', 'unknown action');
  return null;
end $$;

-- ---------------------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------------------

-- Resolve the open case on an order. outcome: resumed (back to where it was) | cancelled |
-- completed | returned. fault: none | buyer | dropshipper | supplier | unclear; a fault on a
-- party is a verified negative reliability event of p_fault_type.
create function public.dropship_admin_resolve_dispute(p_admin text, p_order uuid, p_outcome text, p_fault text,
                                                      p_fault_type text, p_resolution text) returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_o public.dropship_orders := public.dropship_lock_order(p_admin, 'admin', p_order);
  v_d public.dropship_disputes;
  v_to text;
  v_subject text;
begin
  if p_resolution is null or char_length(btrim(p_resolution)) < 5 then
    perform public.dropship_fail('VALIDATION', 'a resolution note is required');
  end if;
  if p_outcome is null or p_outcome not in ('resumed','cancelled','completed','returned') then
    perform public.dropship_fail('VALIDATION', 'outcome must be resumed, cancelled, completed or returned');
  end if;
  if p_fault is null or p_fault not in ('none','buyer','dropshipper','supplier','unclear') then
    perform public.dropship_fail('VALIDATION', 'fault must be none, buyer, dropshipper, supplier or unclear');
  end if;
  if p_fault in ('buyer','dropshipper','supplier') and coalesce(btrim(p_fault_type), '') = '' then
    perform public.dropship_fail('VALIDATION', 'faultType is required when a party is at fault');
  end if;
  select * into v_d from public.dropship_disputes where order_id = v_o.id and status = 'open' for no key update;
  if v_d.id is null then
    perform public.dropship_fail('STATE_CONFLICT', 'this order has no open case');
  end if;

  v_to := case p_outcome when 'resumed' then v_d.from_status else p_outcome end;
  -- Completion still needs delivery recorded; return needs a completed sale.
  if v_to = 'completed' and v_o.delivered_at is null then
    perform public.dropship_fail('STATE_CONFLICT', 'an order that was never delivered cannot be completed');
  end if;
  if v_to = 'returned' and v_o.delivered_at is null then
    perform public.dropship_fail('STATE_CONFLICT', 'an order that was never delivered cannot be returned');
  end if;

  update public.dropship_disputes set status = 'resolved', outcome = p_outcome, fault = p_fault,
    fault_type = nullif(btrim(p_fault_type), ''), resolution = btrim(p_resolution),
    resolved_by = p_admin, resolved_role = 'admin', resolved_at = now()
   where id = v_d.id;
  if v_to = 'cancelled' then
    perform public.dropship_release_reservation(v_o.id, p_admin, 'released', 'dispute resolved: cancelled');
  end if;
  v_o := public.dropship_order_move(v_o, p_admin, 'admin', 'dispute_resolved', v_to, p_resolution,
                                    jsonb_build_object('outcome', p_outcome, 'fault', p_fault, 'faultType', p_fault_type));

  if p_fault in ('buyer','dropshipper','supplier') then
    v_subject := case p_fault when 'buyer' then v_o.buyer_id when 'dropshipper' then v_o.dropshipper_id else v_o.supplier_id end;
    perform public.dropship_reliability(v_subject, p_fault, btrim(p_fault_type), 'negative', true, v_o.id, 'admin',
                                        jsonb_build_object('disputeId', v_d.id));
  end if;
  perform public.dropship_audit(p_admin, 'admin', 'dispute_resolved', 'order', v_o.id, p_resolution,
                                jsonb_build_object('outcome', p_outcome, 'fault', p_fault, 'faultType', p_fault_type));
  return public.dropship_order_result(v_o, 'admin', true, array['buyer','dropshipper','supplier']);
end $$;

create function public.dropship_admin_cancel_order(p_admin text, p_order uuid, p_reason text) returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_o public.dropship_orders := public.dropship_lock_order(p_admin, 'admin', p_order);
begin
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    perform public.dropship_fail('VALIDATION', 'a reason is required');
  end if;
  if v_o.status = 'cancelled' then
    return public.dropship_order_result(v_o, 'admin', false, array[]::text[]);
  end if;
  if v_o.status in ('completed','returned') then
    perform public.dropship_fail('STATE_CONFLICT', 'finished orders cannot be cancelled');
  end if;
  update public.dropship_disputes set status = 'resolved', outcome = 'cancelled', fault = 'unclear',
    resolution = btrim(p_reason), resolved_by = p_admin, resolved_role = 'admin', resolved_at = now()
   where order_id = v_o.id and status = 'open';
  v_o := public.dropship_order_cancel_internal(v_o, p_admin, 'admin', 'admin_cancelled', p_reason, '{}'::jsonb);
  perform public.dropship_audit(p_admin, 'admin', 'order_cancelled', 'order', v_o.id, p_reason, '{}'::jsonb);
  return public.dropship_order_result(v_o, 'admin', true, array['buyer','dropshipper','supplier']);
end $$;

create function public.dropship_admin_update_settings(p_admin text, p_settings jsonb, p_reason text) returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_old public.dropship_order_settings;
  v_new public.dropship_order_settings;
  v_tiers jsonb := p_settings->'limitTiers';
  v_prev integer := -1;
  t jsonb;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    perform public.dropship_fail('VALIDATION', 'a reason is required');
  end if;
  select * into v_old from public.dropship_order_settings where id for no key update;
  if v_tiers is not null then
    if jsonb_typeof(v_tiers) <> 'array' or jsonb_array_length(v_tiers) not between 1 and 10 then
      perform public.dropship_fail('VALIDATION', 'limitTiers must be a list of 1 to 10 tiers');
    end if;
    for t in select value from jsonb_array_elements(v_tiers) loop
      if (t->>'minCompleted')::integer is null or (t->>'minCompleted')::integer <= v_prev
         or (t->>'perOrderPesewas')::bigint is null or (t->>'perOrderPesewas')::bigint < 0
         or (t->>'openPesewas')::bigint is null or (t->>'openPesewas')::bigint < (t->>'perOrderPesewas')::bigint then
        perform public.dropship_fail('VALIDATION', 'each tier needs a rising minCompleted and openPesewas >= perOrderPesewas');
      end if;
      v_prev := (t->>'minCompleted')::integer;
    end loop;
    if (v_tiers->0->>'minCompleted')::integer <> 0 then
      perform public.dropship_fail('VALIDATION', 'the first tier must start at 0 completed orders');
    end if;
  end if;
  update public.dropship_order_settings set
    limit_tiers = coalesce(v_tiers, limit_tiers),
    buyer_confirm_hours = coalesce((p_settings->>'buyerConfirmHours')::integer, buyer_confirm_hours),
    reseller_accept_hours = coalesce((p_settings->>'resellerAcceptHours')::integer, reseller_accept_hours),
    supplier_response_hours = coalesce((p_settings->>'supplierResponseHours')::integer, supplier_response_hours),
    reservation_hours = coalesce((p_settings->>'reservationHours')::integer, reservation_hours),
    updated_by = p_admin, updated_at = now()
   where id returning * into v_new;
  if v_new.reservation_hours not between v_new.reservation_min_hours and v_new.reservation_max_hours then
    perform public.dropship_fail('VALIDATION', 'reservationHours must be between '
                                 || v_new.reservation_min_hours || ' and ' || v_new.reservation_max_hours);
  end if;
  perform public.dropship_audit(p_admin, 'admin', 'order_settings_updated', 'settings', '00000000-0000-0000-0000-000000000000'::uuid,
                                p_reason, jsonb_build_object('to', p_settings));
  return public.dropship_get_settings();
end $$;

create function public.dropship_get_settings() returns jsonb
language sql stable set search_path = '' as
$$
  select jsonb_build_object('limitTiers', s.limit_tiers, 'buyerConfirmHours', s.buyer_confirm_hours,
           'resellerAcceptHours', s.reseller_accept_hours, 'supplierResponseHours', s.supplier_response_hours,
           'reservationHours', s.reservation_hours, 'reservationMinHours', s.reservation_min_hours,
           'reservationMaxHours', s.reservation_max_hours, 'codeValidHours', s.code_valid_hours,
           'maxOpenOrdersPerBuyer', s.max_open_orders_per_buyer, 'updatedAt', s.updated_at)
    from public.dropship_order_settings s where s.id
$$;

-- p_per_order null = remove the override.
create function public.dropship_admin_set_limit_override(p_admin text, p_user text, p_per_order bigint, p_open bigint, p_reason text)
returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare v_pid uuid;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    perform public.dropship_fail('VALIDATION', 'a reason is required');
  end if;
  select id into v_pid from public.dropship_participants where user_id = p_user and kind = 'dropshipper';
  if v_pid is null then
    perform public.dropship_fail('NOT_FOUND', 'reseller not found');
  end if;
  if p_per_order is null then
    delete from public.dropship_reseller_limit_overrides where dropshipper_id = p_user;
  else
    if p_open is null or p_open < p_per_order then
      perform public.dropship_fail('VALIDATION', 'open limit must be at least the per-order limit');
    end if;
    insert into public.dropship_reseller_limit_overrides (dropshipper_id, per_order_pesewas, open_pesewas, reason, set_by)
    values (p_user, p_per_order, p_open, btrim(p_reason), p_admin)
    on conflict (dropshipper_id) do update set per_order_pesewas = excluded.per_order_pesewas,
      open_pesewas = excluded.open_pesewas, reason = excluded.reason, set_by = excluded.set_by, set_at = now();
  end if;
  perform public.dropship_audit(p_admin, 'admin', 'limit_override_set', 'participant', v_pid, p_reason,
                                jsonb_build_object('perOrderPesewas', p_per_order, 'openPesewas', p_open));
  return public.dropship_reseller_limits(p_user);
end $$;

-- ---------------------------------------------------------------------------------------
-- Time limits. Cancels orders whose step deadline has passed, releasing held stock.
-- Nobody is blamed: each timeout is a neutral, recorded fact.
-- ---------------------------------------------------------------------------------------
create function public.dropship_expire_due(p_limit integer) returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare
  v_id uuid;
  v_o public.dropship_orders;
  v_out jsonb := '[]'::jsonb;
  v_reason text;
  v_who text;
begin
  for v_id in select id from public.dropship_orders
               where deadline_at is not null and deadline_at <= now()
                 and status in ('placed','buyer_confirmed','accepted','reservation_requested','price_review','reserved')
               order by deadline_at limit least(greatest(coalesce(p_limit, 100), 1), 500) loop
    v_o := null;
    select * into v_o from public.dropship_orders where id = v_id for no key update skip locked;
    continue when v_o.id is null or v_o.deadline_at is null or v_o.deadline_at > now()
      or v_o.status not in ('placed','buyer_confirmed','accepted','reservation_requested','price_review','reserved');
    v_reason := case v_o.status
      when 'placed' then 'The buyer did not confirm in time'
      when 'buyer_confirmed' then 'The seller did not accept in time'
      when 'accepted' then 'The seller did not request the item in time'
      when 'reservation_requested' then 'The supplier did not answer in time'
      else 'The item hold ran out before payment' end;
    v_who := case v_o.status when 'placed' then 'buyer' when 'reservation_requested' then 'supplier' else 'dropshipper' end;
    perform public.dropship_release_reservation(v_o.id, 'system', 'expired', v_reason);
    v_o := public.dropship_order_move(v_o, 'system', 'system', 'expired', 'cancelled', v_reason,
                                      jsonb_build_object('timedOutStep', v_o.status));
    perform public.dropship_reliability(case v_who when 'buyer' then v_o.buyer_id when 'supplier' then v_o.supplier_id else v_o.dropshipper_id end,
                                        v_who, 'timeout', 'neutral', true, v_o.id, 'system', '{}'::jsonb);
    v_out := v_out || jsonb_build_array(public.dropship_order_result(v_o, 'admin', true,
               array['buyer','dropshipper'] || case when v_o.reserved_at is not null or v_who = 'supplier' then array['supplier'] else array[]::text[] end)
               - 'order');
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------------------
create function public.dropship_get_order(p_actor text, p_role text, p_order uuid) returns jsonb
language plpgsql stable set search_path = '' as
$$
declare v_o public.dropship_orders;
begin
  select * into v_o from public.dropship_orders where id = p_order;
  if v_o.id is null
     or (p_role = 'buyer' and v_o.buyer_id <> p_actor)
     or (p_role = 'dropshipper' and v_o.dropshipper_id <> p_actor)
     or (p_role = 'supplier' and (v_o.supplier_id <> p_actor
                                  or not exists (select 1 from public.dropship_reservations r where r.order_id = v_o.id)))
     or p_role not in ('buyer','dropshipper','supplier','admin') then
    perform public.dropship_fail('NOT_FOUND', 'order not found');
  end if;
  return jsonb_build_object('order', public.dropship_order_json(v_o, p_role));
end $$;

-- Keyset list (created_at desc, id desc). p_scope: 'open' | 'done' | 'cases' | null (all).
create function public.dropship_list_orders(p_actor text, p_role text, p_scope text, p_status text,
                                            p_after_created timestamptz, p_after_id uuid, p_limit integer) returns jsonb
language plpgsql stable set search_path = '' as
$$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_ids uuid[];
  v_next jsonb := null;
  v_rows jsonb;
begin
  if p_role is null or p_role not in ('buyer','dropshipper','supplier','admin') then
    perform public.dropship_fail('VALIDATION', 'bad role');
  end if;
  select coalesce(array_agg(pg.id order by pg.created_at desc, pg.id desc), '{}') into v_ids
    from (select o.id, o.created_at from public.dropship_orders o
           where (p_role = 'admin'
                  or (p_role = 'buyer' and o.buyer_id = p_actor)
                  or (p_role = 'dropshipper' and o.dropshipper_id = p_actor)
                  -- Suppliers see an order only once a reservation was requested from them.
                  or (p_role = 'supplier' and o.supplier_id = p_actor
                      and exists (select 1 from public.dropship_reservations r where r.order_id = o.id)))
             and (p_status is null or o.status = p_status)
             and (p_scope is null
                  or (p_scope = 'open' and o.status not in ('completed','returned','cancelled'))
                  or (p_scope = 'done' and o.status in ('completed','returned','cancelled'))
                  or (p_scope = 'cases' and o.status in ('disputed','return_requested')))
             and (p_after_created is null or p_after_id is null or (o.created_at, o.id) < (p_after_created, p_after_id))
           order by o.created_at desc, o.id desc
           limit v_limit + 1) pg;
  if cardinality(v_ids) > v_limit then
    v_ids := v_ids[1:v_limit];
    select jsonb_build_object('afterCreated', o.created_at, 'afterId', o.id) into v_next
      from public.dropship_orders o where o.id = v_ids[v_limit];
  end if;
  select coalesce(jsonb_agg(public.dropship_order_row_json(o, p_role) order by x.n), '[]'::jsonb) into v_rows
    from unnest(v_ids) with ordinality as x(id, n)
    join public.dropship_orders o on o.id = x.id;
  return jsonb_build_object('orders', v_rows, 'nextCursor', v_next);
end $$;

-- Reseller's dashboard figures.
create function public.dropship_reseller_summary(p_actor text) returns jsonb
language sql stable set search_path = '' as
$$
  select public.dropship_reseller_limits(p_actor) || jsonb_build_object(
    'openOrders', (select count(*) from public.dropship_orders where dropshipper_id = p_actor
                     and status not in ('completed','returned','cancelled')),
    'needsAction', (select count(*) from public.dropship_orders where dropshipper_id = p_actor
                     and status in ('buyer_confirmed','accepted','price_review','reserved','released','collected',
                                    'out_for_delivery','delivered','delivery_failed','return_requested')),
    'reliability', public.dropship_reliability_summary(p_actor, 'dropshipper'))
$$;

create function public.dropship_supplier_summary(p_actor text) returns jsonb
language sql stable set search_path = '' as
$$
  select jsonb_build_object(
    'needsAction', (select count(*) from public.dropship_orders where supplier_id = p_actor
                     and status in ('reservation_requested','supplier_payment_declared','supplier_paid')),
    'reliability', public.dropship_reliability_summary(p_actor, 'supplier'))
$$;

-- Admin: reliability of one user in each role, with the event list.
create function public.dropship_admin_reliability(p_user text) returns jsonb
language sql stable set search_path = '' as
$$
  select jsonb_build_object(
    'buyer', public.dropship_reliability_summary(p_user, 'buyer'),
    'dropshipper', public.dropship_reliability_summary(p_user, 'dropshipper'),
    'supplier', public.dropship_reliability_summary(p_user, 'supplier'),
    'limits', public.dropship_reseller_limits(p_user),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('at', e.created_at, 'role', e.subject_role, 'type', e.event_type,
                 'weight', e.weight, 'verified', e.verified, 'source', e.source, 'orderId', e.order_id) order by e.id desc), '[]'::jsonb)
                 from (select * from public.dropship_reliability_events where subject_user_id = p_user order by id desc limit 200) e))
$$;

-- ---------------------------------------------------------------------------------------
-- Listing delivery fee (reseller).
-- ---------------------------------------------------------------------------------------
create function public.dropship_set_listing_delivery_fee(p_actor text, p_listing_id uuid, p_fee bigint) returns jsonb
language plpgsql set search_path = '' set lock_timeout = '5s' as
$$
declare v_l public.dropship_listings;
begin
  if p_fee is null or p_fee < 0 or p_fee > 10000000 then
    perform public.dropship_fail('VALIDATION', 'deliveryFeePesewas must be between 0 and 10000000');
  end if;
  select * into v_l from public.dropship_listings where id = p_listing_id for no key update;
  if v_l.id is null or v_l.dropshipper_id <> p_actor then
    perform public.dropship_fail('NOT_FOUND', 'listing not found');
  end if;
  if v_l.status = 'removed' then
    perform public.dropship_fail('STATE_CONFLICT', 'removed listings cannot be changed');
  end if;
  update public.dropship_listings set delivery_fee_pesewas = p_fee, updated_at = now() where id = v_l.id returning * into v_l;
  perform public.dropship_audit(p_actor, 'dropshipper', 'listing_delivery_fee', 'listing', v_l.id, null,
                                jsonb_build_object('deliveryFeePesewas', p_fee));
  return jsonb_build_object('listing', public.dropship_listing_json(v_l));
end $$;

-- The reseller's listings now include the delivery fee.
create or replace function public.dropship_list_my_listings(p_actor text) returns jsonb
language sql stable set search_path = '' as
$$
  select jsonb_build_object('listings', coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'productId', l.product_id, 'supplierProductId', l.supplier_product_id,
           'title', sp.title, 'image', sp.images->>0,
           'retailPricePesewas', l.retail_price_pesewas, 'deliveryFeePesewas', l.delivery_fee_pesewas,
           'wholesalePricePesewas', sp.wholesale_price_pesewas,
           'platformFeePesewas', public.dropship_platform_fee_pesewas(l.retail_price_pesewas),
           'estimatedMarginPesewas', l.retail_price_pesewas - public.dropship_platform_fee_pesewas(l.retail_price_pesewas) - sp.wholesale_price_pesewas,
           'minRetailPesewas', public.dropship_min_retail_pesewas(sp.wholesale_price_pesewas),
           'status', l.status, 'effectiveAvailable', a.is_available, 'unavailableReason', a.unavailable_reason,
           'unitsSold', (select coalesce(sum(o.quantity), 0) from public.dropship_orders o
                          where o.listing_id = l.id and o.status in ('completed','returned')),
           'createdAt', l.created_at, 'updatedAt', l.updated_at)
         order by l.created_at desc, l.id desc), '[]'::jsonb))
    from public.dropship_listings l
    join public.dropship_supplier_products sp on sp.id = l.supplier_product_id
    join public.dropship_listing_availability a on a.listing_id = l.id
   where l.dropshipper_id = p_actor and l.status <> 'removed'
$$;

-- Buyer purchase info under COD: the reseller's delivery fee; no supplier location or
-- supplier delivery fees (the reseller delivers).
create or replace function public.dropship_purchase_info(p_product_id text) returns jsonb
language sql stable set search_path = '' as
$$
  select jsonb_build_object(
           'listingId', l.id,
           'available', a.is_available,
           'unitPricePesewas', l.retail_price_pesewas,
           'deliveryFeePesewas', l.delivery_fee_pesewas,
           'maxQuantity', case when a.is_available
                               then greatest(least(sp.max_per_order, sp.stock_on_hand - sp.stock_reserved), 0)
                               else 0 end,
           'leadTimeDays', jsonb_build_object('min', sp.lead_time_min_days, 'max', sp.lead_time_max_days),
           'returnWindowDays', sp.return_window_days,
           'returnPolicyText', 'You can ask the seller for a return within ' || sp.return_window_days
                               || ' days of delivery if the item is wrong or faulty.',
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

-- Orders reference users too (admin user delete must not proceed).
create or replace function public.dropship_user_has_records(p_user text) returns boolean
language sql stable set search_path = '' as
$$
  select exists (select 1 from public.dropship_participants where user_id = p_user)
      or exists (select 1 from public.dropship_listings where dropshipper_id = p_user)
      or exists (select 1 from public.dropship_supplier_products where supplier_id = p_user)
      or exists (select 1 from public.dropship_orders where buyer_id = p_user)
$$;

-- ---------------------------------------------------------------------------------------
-- Grants and RLS: only service_role may touch Dropship objects.
-- ---------------------------------------------------------------------------------------
alter table public.dropship_order_settings enable row level security;
alter table public.dropship_reseller_limit_overrides enable row level security;
alter table public.dropship_orders enable row level security;
alter table public.dropship_order_events enable row level security;
alter table public.dropship_reservations enable row level security;
alter table public.dropship_order_payments enable row level security;
alter table public.dropship_delivery_codes enable row level security;
alter table public.dropship_disputes enable row level security;
alter table public.dropship_reliability_events enable row level security;
revoke all on table public.dropship_order_settings, public.dropship_reseller_limit_overrides, public.dropship_orders,
  public.dropship_order_events, public.dropship_reservations, public.dropship_order_payments, public.dropship_delivery_codes,
  public.dropship_disputes, public.dropship_reliability_events from public, anon, authenticated;
grant select, update on table public.dropship_order_settings to service_role;
grant select, insert, update, delete on table public.dropship_reseller_limit_overrides to service_role;
grant select, insert, update on table public.dropship_orders, public.dropship_reservations, public.dropship_order_payments,
  public.dropship_delivery_codes, public.dropship_disputes to service_role;
grant select, insert on table public.dropship_order_events, public.dropship_reliability_events to service_role;

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
