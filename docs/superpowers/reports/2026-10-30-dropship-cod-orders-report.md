# Dropship COD orders — implementation report (2026-10-30)

Branch `dropship-cod-orders` (not pushed, not deployed). Design: docs/superpowers/specs/2026-10-30-dropship-cod-orders-design.md.

## Stages
1-6 server: migration `supabase/migrations/20261031120000_dropship_orders.sql` (+ rollback `supabase/rollbacks/20261031120000_dropship_orders.down.sql`), routes `server/dropship/orderRoutes.ts`, validation `orderValidation.ts`. Switch: `DROPSHIP_ORDERS_ENABLED=true` (off by default).
Web: checkout on Dropship product pages, `/orders` (buyer), Orders tabs for reseller / supplier / admin, reseller delivery fee.
App 1.4.0: native checkout; My orders = website `/orders` in the signed-in WebView. Old apps keep working (purchase-info keeps `shipsFromRegion`/`deliveryFees`, now describing the reseller).
Sign-up code fix: `crypto.randomInt`, no longer logged, discarded after 5 wrong tries.
8 staging: BLOCKED on owner applying the migration (no direct DB access here).

## Database
New tables: dropship_orders, dropship_order_events (append-only), dropship_reservations, dropship_order_payments (records only), dropship_delivery_codes, dropship_disputes, dropship_reliability_events (append-only), dropship_order_settings, dropship_reseller_limit_overrides. Listings gain delivery_fee_pesewas. Service-role only, RLS on.

## Tests (all passing)
npm run test:dropship: 157 (22 order SQL scenarios, 4 rollback, 6 HTTP route, 5 UI-label). test:auth 65, test:config 20. App unit tests 189. Web + app type-check clean; web build OK.
Mocked: Firebase sign-in, email, notifications (route tests). Real: all SQL on PostgreSQL 17 (PGlite). Not yet run: real concurrency on staging, browser checks, emulator checks.

## Limitations / assumptions
- Concurrency proven only single-connection; staging script pending.
- No SMS; delivery code by email + order page.
- Buyer payments are recorded by the reseller, never verified (shown as such).
- Web notification list UI doesn't exist; notices are stored (app shows them) + emails.
- Order pages not visually checked in a browser yet.
- Synthetic rows `zzconc_*` exist on staging from a script dry run.

## Staging verification (owner)
1. Supabase SQL editor (staging djlvwjkrcsfpxfjovelc): run the migration file.
2. `npx tsx scripts/dropship-orders-concurrency.ts` → expect PASS (1 of 8 holds).
3. Local .env: add `DROPSHIP_ORDERS_ENABLED=true`, `npm run dev`, use 3 test accounts (buyer, reseller, supplier) and walk: order → confirm → accept → hold → pay supplier → supplier confirms → release → collect → out for delivery (code email) → enter code → record payment. Also: cancel, price change, wrong code x5, failed delivery, return, dispute + admin resolve.
4. Emulator: EAS preview build of 1.4.0, order from a Dropship product, open My orders.
5. Live only after sign-off: migration on live, Render env, deploy, app release.
