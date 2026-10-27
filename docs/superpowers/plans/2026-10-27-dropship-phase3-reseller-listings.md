# TedBuy Dropship Phase 3: Reseller Listings and Legacy Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Approved dropshippers add supplier products to their own TedBuy store at a retail price they choose; buyers see those listings in the feed, search, storefronts and product pages (no buying yet: that is Phase 4/5), and no existing TedBuy code path can edit, delete or strip the media of a Dropship listing.

**Architecture:** A new migration adds `dropship_listings`, pricing, listing, catalogue, availability and media-protection functions on top of the live Phase 1–2 schema. Each listing owns one mirror row in `public.products` with id `dsl_<listing uuid without hyphens>`, created and changed only by Dropship SQL functions. `server/dropship/legacyGuards.ts` gives `server.ts` a pure id check plus cached database lookups, wired into each legacy path in a few lines. Web UI adds the dropshipper side of the existing Dropship hub and a read-only info panel on product pages.

**Tech Stack:** PostgreSQL 17 (Supabase) SQL functions; Express + TypeScript (`server.ts`, `server/dropship/*`); React + Tailwind (`src/components/dropship/*`); tests with `node:test` via `tsx --test` against PGlite (`server/dropship/testing/pgliteDb.ts`).

**Spec:** TedBuy Dropship design v0.2.3, `~/Desktop/tedbuy-dropship-v0.2.3-review.zip`: IMPLEMENTATION_PLAN.md "Phase 3"; DATABASE_DESIGN.md §0, §3.5; ARCHITECTURE.md §2, §2.1, §2.2, §6, §12.4; API_SPEC.md §0, §1 (purchase-info), §3, Appendix A.3; PAYMENTS_AND_FINANCIALS.md §3; UI_UX_SPEC.md §1, §3.1–§3.5; OPEN_DECISIONS.md D7, D10, N1, N2, N5, N6.

## Global Constraints

- Everything stays behind `DROPSHIP_ENABLED`; the live code treats "enabled" as mode `on` and anything else as mode `off` (Phase 1–2 never built `servicing`). Mode `off` ⇒ every `dsl_` row is hidden from every legacy read path.
- Listing mirror row id: `'dsl_' || replace(listing.id::text, '-', '')`. Legacy create/sync reject any id starting with `dsl_`, case-insensitive (RN-05).
- `products` gets **no new column**. Mirror row fields: `sellerId` = dropshipper uid, `sellerName` = dropshipper's `users.username`, title/description/category/condition/brand/images copied from the supplier product, `location` = supplier `ships_from_city`, `negotiable = false`, `status = 'active'`, `isApproved = true`, `createdAt` = now as ISO text, `price` = retail in GH₵ as plain numeric text (`trim_scale(retail_pesewas / 100.0)::text`, e.g. `'150'`, `'150.5'`). `products.price` is display-only.
- Pricing (PAYMENTS §3), integer pesewas: `platform_fee = round_half_up(R × f / 10000)`; valid iff `R × (10000 − f)/10000 − W ≥ m`, i.e. `R ≥ ceil((W + m) × 10000 / (10000 − f))`. Pilot values (D3, D10): `f = 0` bps, `m = 100` pesewas (GH₵1.00), no max markup. **Our call:** these live in one SQL function `dropship_pricing_config()` returning `{platformFeeBps:0, minMarginPesewas:100, maxListingsPerSupplierProduct:10}`; the dated fee-change system (`dropship_config_versions`, O-1) is not built in this phase.
- Listing cap: 10 live (non-`removed`) listings per supplier product (N6). One live listing per (dropshipper, supplier product).
- A user cannot list their own supplier product (N5).
- Supplier identity (id, name, contact) never appears in any customer or dropshipper response (D7). Wholesale price, stock and supplier score: approved dropshippers, the owning supplier, admins only (A.3). Teaser viewers (signed-in, not an approved dropshipper): title, images, category only (N2).
- Customer-facing unavailable reasons: only `out_of_stock` or `unavailable`; the precise internal reason (`out_of_stock`, `listing_paused`, `product_inactive`, `participant_unavailable`, `price_below_minimum`) is shown only to the listing's dropshipper (A-04).
- Media of any supplier product (any status) is never deleted by any legacy path; skip reason string `dropship_protected`.
- Feed: at most 2 listings of the same supplier product per list response (N6). **Our call:** applied per response of `/api/products` and the other list endpoints, since they do not page server-side.
- WhatsApp button hidden on `dsl_` product pages (N1). No **Buy now** in this phase.
- Error envelope and codes as in API_SPEC §0, using the existing `DropshipError` codes; writes refuse impersonated sessions.
- Every write function writes a `dropship_audit_events` row via the existing `dropship_audit(...)`.

## Review Focus

1. A seller edits or deletes a `dsl_` listing from the ordinary "My Listings" UI. Expected: a clear "Manage this listing from Dropship" message, nothing changed. Test in Task 4 (`sync with content change → 409`, `delete → 409`).
2. A supplier changes title/images or archives a product that 10 dropshippers have listed. Expected: all mirror rows show the new content at once; archived ⇒ hidden everywhere. Test in Task 1 (`content fan-out`, `archived ⇒ product_inactive`).
3. A dropshipper's participation is suspended or revoked, or their TedBuy account is suspended. Expected: their listings disappear from feed and search within 60 s, but their ordinary listings stay. Test in Task 1 (`participant_unavailable`) and Task 3 (`hidden set refresh`).
4. Dropship is switched off (`DROPSHIP_ENABLED` unset) with listings in place. Expected: no `dsl_` row in feed, search, store pages, trending, sitemap; a direct product link says "This item isn't available right now"; the rest of TedBuy unaffected. Test in Task 3 and Task 4.
5. A user deletes their account (or an admin deletes it) while holding listings. Expected: their listings are removed (mirror rows gone), supplier products archived, and no supplier image is deleted from Cloudinary. Test in Task 4 (`account delete removes listings, keeps media`).

---

### Task 1: Database: listings, pricing, catalogue, availability, media protection

**Files:**
- Create: `supabase/migrations/20261028120000_dropship_listings.sql`
- Create: `supabase/rollbacks/20261028120000_dropship_listings.down.sql`
- Modify: `server/dropship/testing/pgliteDb.ts` (stub `public.products` with the baseline columns used here; apply both migrations in order)
- Test: `server/dropship/listings.sql.test.ts` (add to `test:dropship` in `package.json`)

**Interfaces:**
- Consumes: Phase 1–2 tables/functions in `20261026120000_dropship_supplier_catalogue.sql` (`dropship_participants`, `dropship_supplier_products`, `dropship_fail`, `dropship_audit`, `dropship_update_supplier_product`, `dropship_set_supplier_product_status`, `dropship_submit_application`).
- Produces (all `security definer`, `set search_path = public`, `revoke all … from public, anon, authenticated`, `grant execute … to service_role`, same template as Phase 2):
  - table `dropship_listings` exactly as DATABASE_DESIGN §3.5 (incl. `dl_one_live_per_dropshipper`).
  - `dropship_pricing_config() returns jsonb`.
  - `dropship_quote(p_viewer text, p_supplier_product_id uuid, p_retail_pesewas bigint) returns jsonb` → `{valid, reason?: 'below_minimum'|'not_integer', platformFeePesewas, estimatedMarginPesewas, minRetailPesewas}`.
  - `dropship_create_listing(p_actor text, p_supplier_product_id uuid, p_retail_pesewas bigint, p_client_request_id uuid) returns jsonb` → `{listing, productId, created: boolean}`.
  - `dropship_update_listing(p_actor text, p_actor_role text, p_listing_id uuid, p_retail_pesewas bigint, p_status text, p_reason text) returns jsonb` (null = unchanged; status only `active|paused`).
  - `dropship_remove_listing(p_actor text, p_actor_role text, p_listing_id uuid, p_reason text) returns jsonb`: sets `removed`, `removed_at`, `product_id = null`, deletes the mirror `products` row.
  - `dropship_remove_user_listings(p_user text, p_reason text) returns integer` (removes every live listing of the user and archives every non-archived supplier product of the user; used by account deletion).
  - view `dropship_listing_availability (listing_id, product_id, supplier_product_id, dropshipper_id, is_available, unavailable_reason)` with `security_invoker = true`, privileges revoked from anon/authenticated.
  - `dropship_hidden_product_ids() returns jsonb` → `{hidden: [product_id…], supplierProductOf: {product_id: supplier_product_id}}` for every live listing (hidden = not available).
  - `dropship_is_protected_media(p_urls text[]) returns text[]`.
  - `dropship_catalogue(p_viewer text, p_category text, p_q text, p_after_created timestamptz, p_after_id uuid, p_limit integer) returns jsonb` (keyset on `(created_at desc, id desc)`; only `active` products of approved, unrestricted suppliers; each item's `available = stock_on_hand − stock_reserved > 0`; out-of-stock items are listed, not hidden).
  - `dropship_list_my_listings(p_actor text) returns jsonb`.
  - `dropship_purchase_info(p_product_id text) returns jsonb` (null when not a live listing).
  - `dropship_submit_application` replaced so `p_kind in ('supplier','dropshipper')`; `addressLine` required only for `supplier`.
  - `dropship_update_supplier_product` replaced so content changes (title, description, category, condition, brand, images) are copied to the mirror rows of that product's live listings in the same transaction.

- [ ] **Step 1: Write the failing tests** in `server/dropship/listings.sql.test.ts`, using `createPgliteDropship()` and helpers to create an approved supplier with an `active` product (W = 10000 pesewas, stock 5) and an approved dropshipper:
  - `quote: minimum is W + 100 at 0% fee` → `minRetailPesewas === 10100`; `quote(10099).valid === false, reason 'below_minimum'`; `quote(15000)` → `{valid:true, platformFeePesewas:0, estimatedMarginPesewas:5000}`.
  - `create listing writes mirror row` → products row id `'dsl_' + listingId.replaceAll('-','')`, `sellerId` = dropshipper, `price === '150'`, title/images equal the supplier product's, `negotiable === false`.
  - `create is idempotent` → same `clientRequestId` twice returns the same listing, `created:false` the second time; a second request with a new `clientRequestId` for the same product also returns the existing live listing.
  - `cannot list own supplier product` → user approved as both kinds gets `FORBIDDEN`.
  - `cap of 10 live listings` → 11th dropshipper gets `STATE_CONFLICT`; after one removal, the 11th succeeds.
  - `not approved dropshipper` → `NOT_APPROVED`; `product not active` → `STATE_CONFLICT`; `price below minimum` → `PRICE_INVALID`.
  - `update price and pause` → mirror `price` follows; paused ⇒ availability `listing_paused`.
  - `remove listing` → status `removed`, `product_id` null, mirror row gone, images still returned by `dropship_is_protected_media`.
  - `content fan-out` → supplier edits title and images ⇒ every live listing's mirror row has the new title/images.
  - `availability reasons` → stock 0 ⇒ `out_of_stock`; supplier product `paused` or `archived` ⇒ `product_inactive`; supplier or dropshipper participation `suspended`/`revoked`, or `users.isSuspended`/`securityHold`/`isDeleted` on either ⇒ `participant_unavailable`; retail now below minimum (wholesale raised) ⇒ `price_below_minimum`; otherwise `is_available = true`.
  - `catalogue projections` → approved dropshipper item has `wholesalePricePesewas`, `minRetailPesewas`, `alreadyListed`, `listingCount`; a non-dropshipper viewer item has exactly keys `supplierProductId,title,images,category`; neither contains `supplierId`.
  - `purchase-info projection` → keys exactly `listingId,available,unavailableReason?,unitPricePesewas,maxQuantity,deliveryFees,shipsFromRegion,leadTimeDays,returnWindowDays,returnPolicyText,seller` with `seller = {id: dropshipperId, storeName}`; internal reason `listing_paused` is exposed as `unavailable`.
  - `remove user listings` → all of a user's listings removed and their supplier products `archived`; returns the count.
  - `one live listing per dropshipper and product` → inserting a second live row for the same (dropshipper, supplier product) directly raises a unique violation (`dl_one_live_per_dropshipper`); PGlite is single-connection, so true parallel add-to-store is covered by this index rather than a race test.
  - `dropshipper applications open` → `dropship_submit_application(kind 'dropshipper')` without `addressLine` succeeds; supplier without it still fails.

- [ ] **Step 2: Run to verify failure**
  Run: `npx tsx --test server/dropship/listings.sql.test.ts`
  Expected: FAIL (functions do not exist).

- [ ] **Step 3: Write the migration** with the interfaces above. Lock order inside functions: listing → supplier product → products mirror row → participant (DATABASE §0 lock classes), `FOR NO KEY UPDATE` for rows changed, `FOR SHARE` for rows only read. `returnPolicyText` exact copy: `"Report damaged or wrong items within N days of delivery. Report a missing delivery until your order is settled."` with N = the product's return window. Write the rollback file dropping everything this migration adds and restoring the two replaced functions from the Phase 2 migration.

- [ ] **Step 4: Run tests**
  Run: `npm run test:dropship`
  Expected: all pass, including the Phase 1–2 suites (no regressions in `sql.test.ts`, `rollback.test.ts`).

- [ ] **Step 5: Commit**
  `git add supabase/ server/dropship/ package.json && git commit -m "Dropship Phase 3: listings, pricing, catalogue and availability (DB)"`

### Task 2: API: dropshipper applications, catalogue, quote, listings, purchase-info

**Files:**
- Modify: `server/dropship/validation.ts`, `server/dropship/routes.ts`
- Test: `server/dropship/routes.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 SQL functions via the existing `db.call(name, params)`.
- Produces HTTP endpoints (all return `503 DROPSHIP_UNAVAILABLE` when disabled, like the existing ones):
  - `POST /api/dropship/applications` now accepts `kind: 'supplier' | 'dropshipper'`.
  - `GET /api/dropship/catalogue?category=&q=&cursor=` (signed-in; cursor = opaque base64 of `{createdAt,id}`; page size 24).
  - `GET /api/dropship/catalogue/:supplierProductId`.
  - `POST /api/dropship/catalogue/:supplierProductId/quote` `{retailPricePesewas}` (approved dropshipper; rate limit 120/min).
  - `POST /api/dropship/listings` `{clientRequestId, supplierProductId, retailPricePesewas}` → `{listing, productId}`.
  - `GET /api/dropship/listings/mine`.
  - `PATCH /api/dropship/listings/:listingId` `{retailPricePesewas?, status?}`.
  - `DELETE /api/dropship/listings/:listingId` (owner, or admin with `reason`).
  - `GET /api/dropship/purchase-info/:productId` (public; 404 `NOT_FOUND` when not a live listing).
  - Every catalogue/listing/purchase-info response is built by an explicit whitelist function in `routes.ts` (`catalogueItemView(row, viewer: 'dropshipper'|'teaser')`, `listingView(row)`, `purchaseInfoView(row)`); no spreading.

- [ ] **Step 1: Write the failing tests** (HTTP, PGlite, mocked Firebase identity, same harness as today):
  - `dropshipper can apply and admin can approve` (kind `dropshipper`).
  - `catalogue teaser vs full` → teaser keys exactly `supplierProductId,title,images,category`; no response anywhere contains `supplierId`, `supplierName` or `contactPhone` (deep key scan).
  - `quote requires approved dropshipper` → 403 `NOT_APPROVED` otherwise.
  - `create listing → 201-style success; replay same clientRequestId → same productId`.
  - `listing endpoints refuse other users` → PATCH/DELETE another user's listing → 404 `NOT_FOUND`.
  - `listings/mine shows precise reason` → paused ⇒ `unavailableReason: 'listing_paused'`.
  - `purchase-info public and coarse` → no auth needed; paused ⇒ `unavailableReason: 'unavailable'`; unknown or removed ⇒ 404.
  - `unknown fields rejected` → `VALIDATION` for an extra body key on every new write.
  - `impersonated session cannot write` → `IMPERSONATION_FORBIDDEN` on POST/PATCH/DELETE listings.

- [ ] **Step 2: Run to verify failure:** `npm run test:dropship` → new tests FAIL.
- [ ] **Step 3: Implement** validators (`parseListingCreate`, `parseListingUpdate`, `parseQuote`, `parseCatalogueQuery`) and routes. Retail price input: integer pesewas, `1 ≤ R ≤ 100_000_000`.
- [ ] **Step 4: Run:** `npm run test:dropship` → all pass.
- [ ] **Step 5: Commit** `"Dropship Phase 3: dropshipper, catalogue and listing API"`.

### Task 3: Legacy guard helpers

**Files:**
- Create: `server/dropship/legacyGuards.ts`
- Test: `server/dropship/legacyGuards.test.ts` (add to `test:dropship`)

**Interfaces:**
- Consumes: Task 1 `dropship_hidden_product_ids`, `dropship_is_protected_media`, the `DropshipDb` from `server/dropship/db.ts`.
- Produces:
  - `isDropshipRowId(id: unknown): boolean`: `typeof id === 'string' && id.toLowerCase().startsWith('dsl_')`; no DB access.
  - `createLegacyGuards(opts: { db: DropshipDb | null; enabled: boolean; now?: () => number }): LegacyGuards` where
    - `filterVisible<T extends { id: string }>(rows: T[]): Promise<T[]>`: disabled or `db` null ⇒ drop every `dsl_` row; enabled ⇒ drop hidden ids and keep at most 2 rows per supplier product (first two in input order). Uses a 60 s cache of `dropship_hidden_product_ids`; on DB error, drops every `dsl_` row (fail closed) and logs once per minute.
    - `isVisibleProduct(id: string): Promise<boolean>` (same rules for one id).
    - `filterProtectedMedia(urls: string[]): Promise<{ deletable: string[]; protected: string[] }>`: on DB error or disabled-with-no-db, treat every Cloudinary URL as protected (fail closed).
    - `isLinkedProduct(id: string): boolean` = `isDropshipRowId(id)` (mirror rows are the only linked rows by construction).
    - `invalidate(): void` (clears the 60 s cache; called after every Dropship listing write in `routes.ts`).
  - `registerDropship` in `server/dropship/index.ts` returns the `LegacyGuards` instance so `server.ts` can use it.

- [ ] **Step 1: Write failing tests:** `isDropshipRowId('DSL_x') === true`, `('dslx') === false`, `(42) === false`; `filterVisible` drops all `dsl_` rows when disabled; drops hidden ids when enabled; keeps 2 of 3 rows of one supplier product; DB throwing ⇒ all `dsl_` dropped and ordinary rows kept; cache refreshes after 60 s (fake `now`) and after `invalidate()`; `filterProtectedMedia` splits correctly and fails closed on DB error.
- [ ] **Step 2: Run:** `npx tsx --test server/dropship/legacyGuards.test.ts` → FAIL.
- [ ] **Step 3: Implement** in `server/dropship/legacyGuards.ts`.
- [ ] **Step 4: Run:** `npm run test:dropship` → PASS.
- [ ] **Step 5: Commit** `"Dropship Phase 3: legacy guard helpers"`.

### Task 4: Wire guards into server.ts

**Files:**
- Modify: `server.ts` (call sites only, a few lines each; locations as of commit `97608c6`):
  - `getProductsListData` (`:2497`): return rows through `guards.filterVisible` (after the raw cache, so the 60 s hidden set applies on every call).
  - `GET /api/products/:productId` (`:3260`): `dsl_` id not visible ⇒ `404 { success:false, error: "This item isn't available right now" }`.
  - `POST /api/products/sync` (`:3716`) and `POST /api/products/create` (`:4113`): new or incoming id starting `dsl_` from a non-admin ⇒ `409 { error: 'Manage this listing from Dropship' }`; for an existing `dsl_` row only the existing social-only change path (likes/views) is allowed.
  - `upsertProductToSupabase` (`:3405`): add 4th parameter `allowDropshipRow = false`; throw for a `dsl_` id unless true. Boost writes (`/api/verify-payment` `:6388`, `/api/admin/boost-control` `:6729`) pass `true` only when `guards` reports the row visible.
  - `/api/paystack/initialize-boost` (`:6649`): refuse a `dsl_` product that is not visible.
  - `POST /api/products/delete` (`:4272`), `DELETE /api/products/:productId` (`:4343`): `dsl_` ⇒ 409 "Manage this listing from Dropship".
  - `deleteProductFromBackend` (`:4145`): pass the row's media URLs through `filterProtectedMedia` and delete only `deletable`.
  - `/api/cloudinary/delete` (`:1759`), `/api/cloudinary/cleanup-orphans` (`:1845`): skip `protected` URLs with reason `dropship_protected`.
  - `purgeExpiredSoldProducts` (`:4244`): skip `dsl_` rows.
  - `POST /api/auth/delete-account` (`:8876`) and `POST /api/admin/users/delete`: call `dropship_remove_user_listings(uid, reason)` before the user's products are touched; if it fails, stop with the endpoint's existing 500 response.
  - Sitemap: `getSitemapDataset` (`src/utils/sitemap.ts:212`) takes an optional `isVisible(id) => boolean` filter; `server.ts` passes one that drops `dsl_` rows when Dropship is disabled or the id is hidden.
- Test: `server/dropship/legacyWiring.test.ts` (unit tests over small exported helpers, see Step 1) plus the manual regression checklist in Task 6.

**Interfaces:**
- Consumes: Task 3 `LegacyGuards`, `isDropshipRowId`.
- Produces: exported pure helpers in `server/dropship/legacyGuards.ts` used by `server.ts` and tested directly: `legacySyncDecision(input: { productId: string; isAdmin: boolean; socialOnly: boolean; exists: boolean }): 'allow' | 'reject_dsl'`, `legacyDeleteDecision(productId: string): 'allow' | 'reject_dsl'`.

- [ ] **Step 1: Write failing tests:** the product-detail serializer output for a `dsl_` mirror row has no keys beyond those of an ordinary product row (snapshot over `normalizeServerProductRow`, exported for the test); `legacySyncDecision` rejects new `dsl_` ids (any case) and content changes to existing ones, allows social-only changes and admin calls; `legacyDeleteDecision('dsl_abc') === 'reject_dsl'`, ordinary ids allowed; a sitemap dataset built with a filter excludes `dsl_` rows.
- [ ] **Step 2: Run:** `npx tsx --test server/dropship/legacyWiring.test.ts` → FAIL.
- [ ] **Step 3: Implement** the helpers and wire every call site listed above.
- [ ] **Step 4: Run all suites:** `npm run test:dropship && npm run test:config && npm run test:auth && npx tsx --test server.test.ts && npx tsc --noEmit -p . && npm run build` → all pass, build exits 0.
- [ ] **Step 5: Commit** `"Dropship Phase 3: guard legacy product paths against Dropship listings"`.

### Task 5: Web UI: dropshipper hub, catalogue, calculator, my products, product page panel

**Files:**
- Modify: `src/components/dropship/dropshipApi.ts` (typed calls for Task 2 endpoints), `src/components/dropship/DropshipHub.tsx` (dropshipper section), `src/components/dropship/AdminDropshipPanel.tsx` (applications list shows both kinds, kind badge), `src/components/dropship/dropshipFormat.ts` (`formatPesewas` reuse; `parseCedisToPesewas(input: string): number | null`)
- Create: `src/components/dropship/DropshipperPanel.tsx` (apply form for `kind:'dropshipper'`, status cards, sub-tabs Catalogue · My products), `src/components/dropship/CatalogueView.tsx` (grid, category chips, search, cursor "Load more", teaser mode), `src/components/dropship/CatalogueItem.tsx` (gallery, terms block, calculator with 400 ms debounced `/quote`, "Add to my store"), `src/components/dropship/MyDropshipProducts.tsx` (rows, precise status pill, edit price modal reusing the calculator, pause/resume, remove with confirm, Boost via existing `BoostModal`), `src/components/dropship/DropshipPurchasePanel.tsx` (product page: "Ships from {region}", "Delivery in X–Y days after confirmation", delivery fees, return policy text, stock state; **no Buy now**; shows "Message seller")
- Modify: `src/components/ProductDetail.tsx` (render `DropshipPurchasePanel` when `isDropshipRowId(product.id)`; hide WhatsApp for those rows)
- Test: `src/components/dropship/dropshipFormat.test.ts` (extend)

**Interfaces:**
- Consumes: Task 2 endpoints and response shapes.
- Produces: `isDropshipRowId` re-exported for the client from `src/components/dropship/dropshipFormat.ts` (same rule as the server).

- [ ] **Step 1: Write failing tests:** `parseCedisToPesewas('150') === 15000`, `('150.5') === 15050`, `('1,250.00') === 125000`, `('abc') === null`, `('-1') === null`, `('0.001') === null`; client `isDropshipRowId` matches the server rule.
- [ ] **Step 2: Run:** `npx tsx --test src/components/dropship/dropshipFormat.test.ts` → FAIL.
- [ ] **Step 3: Implement** the helpers and components. Copy (UI_UX §3.1, §3.4): hero "Start selling without buying stock first"; calculator label "Estimate. You earn this only after the order is delivered and the hold period ends."; empty catalogue "No products in this category yet". Follow the existing Dropship component styles in `dropshipUi.tsx`.
- [ ] **Step 4: Run:** `npm run test:dropship && npx tsc --noEmit -p . && npm run build` → pass.
- [ ] **Step 5: Commit** `"Dropship Phase 3: dropshipper web UI and product page info panel"`.

### Task 6: Staging verification, production checks and release

**Files:**
- Modify: `server/dropship/MANUAL_TEST_CHECKLIST.md` (add Phase 3 rows below)

- [ ] **Step 1: Production evidence E8 (owner, read-only, live SQL editor):** `select count(*) from public.products where lower(id) like 'dsl\_%';` Expected: `0`.
- [ ] **Step 2: Apply to staging** (`djlvwjkrcsfpxfjovelc`): run `20261028120000_dropship_listings.sql` in the SQL editor. Expected: "Success. No rows returned."
- [ ] **Step 3: Browser checks on localhost against staging** (add as checklist rows 13–20): dropshipper applies → admin approves; catalogue full vs teaser; calculator min price GH₵1 above wholesale; add to store → listing visible in feed, search, own storefront, product page with info panel and no WhatsApp; edit price, pause (disappears from feed within 60 s), resume, remove; supplier edits title → listing title follows; supplier archives → listing disappears; legacy "My Listings" edit/delete/mark-sold of the `dsl_` row → "Manage this listing from Dropship"; account deletion of a test dropshipper removes listings and leaves supplier photos in Cloudinary.
- [ ] **Step 4: Regression checklist** (IMPLEMENTATION_PLAN "Regression suite"): sign-in (email + Google); create/edit/delete/mark-sold an ordinary listing; boost an ordinary listing (Paystack test mode if configured, else skip and note); storefront + share link; feed/search/trending/video feed; chat; account deletion of a user with no Dropship data; admin user management. All pass.
- [ ] **Step 5: Release:** push to `main`; after Render shows Live, owner runs the migration in the live SQL editor; verify `/api/dropship/status` and that `GET /api/dropship/catalogue` answers 401 signed out.
- [ ] **Step 6: Commit** checklist updates with the recorded results.
