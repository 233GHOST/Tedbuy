# Dropship orders: reseller-funded Cash on Delivery — audit and design

Status: DRAFT for owner review (2026-10-30). Replaces the money parts of design v0.2.3
(TedBuy collecting payment, payouts, settlements). TedBuy never collects, holds or moves
Dropship money. Paystack stays for listing boosts only.

## 1. Audit — what exists today (live on www.tedbuy.store)

| Area | What is there | Reuse |
|---|---|---|
| Participants | `dropship_participants` (kind supplier / dropshipper, status, contact phone, region, city, address, payout_* columns, identity fields) | Reuse as-is. Supplier contact + address become the pickup details shown to a reseller after a reservation is confirmed. `payout_*` columns stay unused. |
| Supplier catalogue | `dropship_supplier_products` with `wholesale_price_pesewas`, `stock_on_hand`, **`stock_reserved` (already there, always 0)**, `max_per_order`, `price_version`, return window, supplier delivery fees | Reservations use `stock_reserved` + `price_version` directly. Supplier delivery fees no longer apply (supplier never delivers to the buyer). |
| Stock ledger | `dropship_stock_events` with event types `reserve`, `release`, and an `order_id` column (unused) | Reuse for every reserve / release / commit. |
| Reseller listings | `dropship_listings` (supplier product → reseller, `retail_price_pesewas`, mirror row in `products` with id `dsl_…`), availability view | Order created from a live listing. |
| Buyer product page | `DropshipPurchasePanel` (web) + `ProductDetailScreen` (app): shows delivery fees, "Ships from", return window, "Message seller" button | Replace the panel with order button + COD wording. The supplier delivery fee and "Ships from" lines are **wrong under the new model** and must go. |
| Audit | `dropship_audit_events` (target_type limited to participant / supplier_product), `admin_audit_logs` | Add an order history table of its own (append-only), and widen target_type for admin order actions. |
| Server | `server/dropship/routes.ts` (Express, Firebase-verified user, rate limits, `DROPSHIP_ENABLED` flag, staging ref guard), all writes via `dropship_*` SQL functions with service role, no RLS access for anon/authenticated | Same pattern: one SQL function per transition, called from thin routes. |
| Tests | PGlite SQL tests, route tests, rollback tests (`npm run test:dropship`) | Same pattern. PGlite is one connection, so true concurrent-reservation tests run against staging Postgres. |
| Marketplace orders | **None.** TedBuy listings are contact-the-seller only. | New. |
| Messages to users | Email via Brevo (sign-up codes); in-app `notifications` table; chat (`chats` / `messages`). **No SMS provider.** | Order updates: in-app notification + email. Delivery code: shown in the buyer's own order page and emailed. |
| App | Buyers browse natively; Dropship management (supplier, reseller, admin) runs in the in-app WebView | Reseller / supplier / admin order screens are web pages, so the app gets them for free. The buyer's order flow must also be built in the app (needs an app release). |

Problems found while auditing (not part of this feature, flagged):
- `server.ts:7316` writes every sign-up code to the server log in plain text, and codes come from `Math.random`. Fix in passing (log nothing, use `crypto.randomInt`).
- The live purchase panel tells buyers supplier delivery fees and where items ship from, which leaks supplier info and won't apply under this model.

## 2. Decisions needed from the owner (recommended answer first)

1. **Buyers must be signed in with a verified account to order.** That gives us a stable identity for reliability history, a place to show the order and the delivery code, and it cuts fake orders. (Guest checkout: more orders, much more fake-order risk.)
2. **Delivery fee: the reseller sets it on their listing** (one fee, or free). The buyer sees item price + delivery fee = total before ordering. The reseller can change the total only by sending a new price for the buyer to accept.
3. **Delivery code: 6 digits, shown on the buyer's order page and emailed.** No SMS (there is no SMS provider; adding one is a separate cost decision).
4. **Time limits:** buyer confirms within 24 h; reseller accepts within 24 h; supplier answers a reservation within 24 h; a reservation holds stock for 24 h (supplier may pick 12–72 h). Anything that runs out is cancelled automatically with no blame.
5. **Starting reseller limits (admin can change):** new reseller GH₵200 wholesale per order and GH₵400 open at once. After 3 completed orders with no upheld dispute: GH₵500 / GH₵1,000. After 10: GH₵1,500 / GH₵3,000. Admin can set any reseller's limits by hand.
6. **Who sees what:** supplier sees the reseller's store name + phone, never the buyer or the retail price. Reseller sees the supplier's name, phone and pickup address only once a reservation is confirmed. Buyer never sees the supplier or the wholesale price.
7. **Returns** go buyer → reseller → supplier, inside the supplier's return window. Any refund is paid outside TedBuy; TedBuy only records who said what.

## 3. Order lifecycle

One `status` column, moved only by SQL functions that check the current status, the actor's role and ownership. Every move writes a history row.

```
placed ─(buyer confirms)→ buyer_confirmed ─(reseller accepts)→ accepted
accepted ─(reseller requests reservation)→ reservation_requested
reservation_requested ─(supplier confirms stock+price)→ reserved
        └─ price changed → price_review ─(reseller accepts new price)→ reserved
                                         └─(reseller declines)→ cancelled
reserved ─(reseller declares payment)→ supplier_payment_declared
supplier_payment_declared ─(supplier confirms money received)→ supplier_paid
supplier_paid ─(supplier marks released)→ released
released ─(reseller confirms collection)→ collected
collected → out_for_delivery → delivered (buyer's code entered, or buyer taps "I received it")
delivered ─(reseller records payment)→ completed
```

Side exits, each with who / when / reason / evidence:
- `cancelled`: buyer or reseller before `supplier_payment_declared`; system on timeouts; supplier says no stock; reseller declines a price change. No penalty before the reseller has paid.
- `delivery_failed`: from `out_for_delivery`, with reason (buyer unreachable / refused / wrong address / other). Reseller may retry → `out_for_delivery`, or close it as a refusal.
- `disputed`: anyone involved can open one from `supplier_payment_declared` onwards (for example "I paid, supplier won't confirm or release"). The order is frozen until an admin resolves it.
- `return_requested` → `returned` / `return_rejected`: buyer, within the return window after `completed`.

Rules the database enforces: collection needs `released`; completion needs both a delivery record and a buyer-payment record; supplier-paid needs the supplier's own confirmation (a reseller's screenshot doesn't count); the supplier can never set delivery or buyer payment; terminal states (`completed`, `cancelled`, `returned`) accept no further normal moves.

The owner's 20 suggested statuses map onto this list. "Awaiting stock confirmation" and "Product reserved" are both covered by `reservation_requested` / `reserved`. "Preparing for delivery" is folded into `collected`. "Payment received" is the same moment as `completed`.

## 4. Database (one new migration + rollback, staging first)

- `dropship_orders`: buyer, reseller, supplier, listing, supplier product, quantity, **snapshots** (title, image, retail unit price, delivery fee, total, wholesale unit price + `price_version` at order time, current agreed wholesale price), delivery details (name, phone, region/area, address, instructions), status, `client_request_id` unique per buyer (makes retries safe), deadline columns, timestamps.
- `dropship_order_events`: append-only history (actor, role, from → to, reason, details json). Triggers reject UPDATE / DELETE.
- `dropship_reservations`: order, quantity, status (requested / confirmed / expired / released / committed), expires_at. Reserve = lock the supplier product row, check `stock_on_hand - stock_reserved >= qty`, add to `stock_reserved`, write a stock event. That row lock is what stops two reservations selling the same stock. Release / expire reverses it. A paid release commits it (on_hand −qty, reserved −qty).
- `dropship_order_payments`: kind (`reseller_to_supplier` / `buyer_to_reseller`), amount, method (cash / momo / bank / other), date, optional reference, optional evidence image, `declared_by`, `confirmed_by` + `confirmed_at` (supplier confirmation for the first kind; always empty for buyer payments, because TedBuy can't verify those and will say so).
- `dropship_delivery_codes`: order, code **hash** (HMAC), expires_at, attempts, used_at. Max 5 wrong tries, then the reseller must ask for a new code (max 3 per order). The code is never returned to the reseller or written to logs.
- `dropship_disputes` (+ returns as a dispute kind): order, opened_by, kind, description, evidence, status, admin resolution, fault finding (none / buyer / reseller / supplier).
- `dropship_reliability_events`: subject user, role (buyer / reseller / supplier), event type, order, `verified` flag. Scores count **verified** events only: system facts like completion or a timeout, or an admin finding. An unproven complaint is stored but scores nothing.
- `dropship_reseller_limits`: settings row (tiers) + per-reseller admin override. Exposure = sum of agreed wholesale amounts on the reseller's orders from `reserved` up to `collected`.
- Expiry: a sweep function (`dropship_expire_due()`) that the server calls every minute and at the start of reads, so it works without pg_cron.

All money is integer pesewas checked on the server. Prices always come from the database, never from the browser.

## 5. API (under the existing Dropship router and flag; adds `DROPSHIP_ORDERS_ENABLED`)

Buyer: `POST /api/dropship/orders` (from listing id + quantity + delivery details), `GET /orders/mine`, `GET /orders/:id`, `POST /orders/:id/confirm`, `/cancel`, `/received`, `/issue`, `/return`.
Reseller: `GET /reseller/orders`, `POST …/accept`, `/reject`, `/request-reservation`, `/accept-price`, `/declare-supplier-payment`, `/collected`, `/out-for-delivery`, `/delivery-code` (send / resend to the buyer), `/verify-code`, `/delivery-failed`, `/record-payment`, `/cancel`, `/dispute`, plus a summary (exposure, limits, margins).
Supplier: `GET /supplier/orders`, `POST …/reservation/confirm` (with current stock + price), `/reservation/decline`, `/confirm-payment`, `/reject-payment`, `/released`, `/dispute`.
Admin: order list + filters, order detail with full history, dispute resolve, reliability view, limit settings + overrides, suspend participant (existing).

Every route: Firebase-verified user, role and ownership checked inside the SQL function, rate-limited, mutation endpoints idempotent (repeating the same move returns the current state).

## 6. Screens

- **Buyer (web + app):** order form on the product page (quantity, delivery details, total, "Pay only when you receive your order"); My orders list + an order page with a timeline, a confirm button, the delivery code, "I received it", and report-a-problem / return.
- **Reseller (web, in the app via WebView):** Orders tab in the Dropship hub. Each order shows the next action, the buyer's reliability badge (completed / refused counts, no private data), and margin figures: gross = retail − wholesale; estimated net = gross − delivery cost − other costs the reseller enters (labelled "estimate, not profit"). Exposure and limit are shown at the top.
- **Supplier (web):** Orders tab: reservation requests, payment confirmations, releases, history, own reliability summary. No retail price and no buyer details.
- **Admin (web):** Orders, Disputes, Reliability and Limits sections in the existing Dropship admin panel.

## 7. Delivery slices (each one tested, reviewed, then staging; live only with owner OK)

1. Schema + order placement + buyer / reseller confirmation + cancellations + timeouts + buyer screens on web. (Orders flag off on live.)
2. Reservations + price review + reseller limits + supplier order screen.
3. Supplier payment declare / confirm + release + collection.
4. Delivery + delivery code + buyer payment record + completion.
5. Failed delivery, returns, disputes + admin dispute tool.
6. Reliability events / badges + admin limits screen.
7. App: native buyer order flow → app release 1.4.0.
8. Staging end-to-end run with synthetic accounts (the owner's test list), then live migration + flag on, with owner approval.

## 8. Testing

PGlite SQL tests for every transition (allowed and refused), ownership, idempotent retries, money checks, code attempts / expiry, expiry sweeps. Route tests for auth and roles. A concurrency test on staging Postgres (parallel reservations for the last unit: exactly one wins). Browser checks on staging with three synthetic accounts (buyer, reseller, supplier) and the emulator for the app. Reports will say which tests used mocks and which used real services.
