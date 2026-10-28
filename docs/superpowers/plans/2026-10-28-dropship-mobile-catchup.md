# Dropship Mobile Catch-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Android app shows Dropship listings the way the website does (no WhatsApp, delivery/returns info, no Buy now yet), gives every user a way into the Dropship hub from Profile, and explains refused edits of Dropship listings.

**Architecture:** Mobile-only changes in `mobile/` (Expo SDK 57, React Native). Product page reads the existing public endpoint `GET /api/dropship/purchase-info/:productId`. The Dropship hub opens the live website page `https://www.tedbuy.store/dropship` in an in-app Chrome Custom Tab via `expo-web-browser` (owner's design default UI_UX §1: management via responsive web inside the app; Custom Tab rather than WebView because Google blocks OAuth sign-in in embedded WebViews).

**Tech Stack:** Expo SDK 57, React Native 0.86, TypeScript; tests with `node --test` like `mobile/src/regions.test.ts`.

**Spec:** TedBuy Dropship v0.2.3 (`~/Desktop/tedbuy-dropship-v0.2.3-review.zip`): UI_UX_SPEC §1 (entry points, availability behaviour, "the mobile Profile dashboard's Dropship section opens the responsive web pages in an in-app browser"), §2.1 (purchase panel), OPEN_DECISIONS N1 (hide WhatsApp), N13 (old builds chat-only), D14.

## Global Constraints

- Read `mobile/AGENTS.md` first (Expo SDK 57 docs, New Architecture mandatory).
- `isDropshipRowId(id)` = `typeof id === 'string' && id.toLowerCase().startsWith('dsl_')` — identical to `server/dropship/legacyGuards.ts`.
- No Buy now on mobile in this change.
- Customer-facing unavailable states: only "Out of stock" or "This item isn't available right now".
- Exact return policy text comes from the server (`returnPolicyText`); never written on the client.
- Money from the server is integer pesewas; format with the app's existing currency formatting (GH₵), no other arithmetic.
- The Dropship entry is shown only when `GET /api/dropship/status` returns `enabled: true`; a failed status call hides it silently (no error alert on app load).
- Every new user-visible failure uses `Alert.alert` (the app's existing pattern), never a silent no-op.

---

### Task 1: Dropship listing display, Profile entry, refusal message

**Files:**
- Create: `mobile/src/utils/dropship.ts` (`isDropshipRowId`, `formatDeliveryWindow(min: number, max: number): string`), `mobile/src/utils/dropship.test.ts`
- Modify: `mobile/src/screens/ProductDetailScreen.tsx` (hide every WhatsApp entry for `dsl_` ids; fetch purchase-info; render info panel), `mobile/src/screens/ProfileScreen.tsx` (a "TedBuy Dropship" row in the signed-in dashboard, next to the existing settings/store rows), `mobile/src/firebase.ts` (export a `getDropshipStatus()` and `getDropshipPurchaseInfo(productId)` using the existing `apiFetch`; make sure a 409 from `/api/products/sync` or `/api/products/delete` surfaces the server's `error` text to the caller), `mobile/package.json` (add `expo-web-browser` with `npx expo install expo-web-browser` from `mobile/`)

**Interfaces:**
- Server (already live): `GET /api/dropship/status` → `{success, enabled}`; `GET /api/dropship/purchase-info/:productId` → `{success, info: {listingId, available, unavailableReason?: 'out_of_stock'|'unavailable', unitPricePesewas, maxQuantity, deliveryFees: [{scope, regionNote, feePesewas}], shipsFromRegion, leadTimeDays: {min, max}, returnWindowDays, returnPolicyText, seller: {id, storeName}}}`, 404 when not a live listing; legacy edit/delete of a `dsl_` row → 409 `{success:false, error:'Manage this listing from Dropship'}`. Check exact shapes in `server/dropship/routes.ts` (`purchaseInfoView`).

- [ ] **Step 1: Failing tests** in `mobile/src/utils/dropship.test.ts`: `isDropshipRowId('dsl_abc') === true`, `('DSL_X') === true`, `('dslx') === false`, `(undefined) === false`; `formatDeliveryWindow(2, 5) === '2–5 days'`, `(3, 3) === '3 days'`, `(1, 1) === '1 day'`.
- [ ] **Step 2: Run** `cd mobile && node --test src/utils/dropship.test.ts` (match how `src/regions.test.ts` is run) → FAIL.
- [ ] **Step 3: Implement** the helpers, the API functions, the product page panel ("Ships from {region}", "Delivery in {window} after confirmation", each delivery fee row, return policy text, stock state; TedBuy chat stays; no WhatsApp; no Buy now; a 404 from purchase-info shows "This item isn't available right now" in the panel), the Profile row (label "TedBuy Dropship", subtitle "Supply products or sell without stock", opens `https://www.tedbuy.store/dropship` with `WebBrowser.openBrowserAsync`), and the 409 message surfacing (an Alert titled "Manage from Dropship" with the server text when editing or deleting a `dsl_` listing from the app).
- [ ] **Step 4: Verify** `cd mobile && node --test src/utils/dropship.test.ts src/regions.test.ts && npx tsc --noEmit -p .` → pass, 0 errors.
- [ ] **Step 5: Commit** on `dropship-mobile-catchup`.

### Task 2: Build and release (owner + controller)

- [ ] Owner builds a new Android APK with the existing EAS profile `production-apk` (`cd mobile && npx eas build -p android --profile production-apk`), installs it, and checks: a Dropship listing shows the info panel and no WhatsApp; an ordinary listing still shows WhatsApp; Profile → TedBuy Dropship opens the hub in a Chrome tab and Google sign-in works there; editing a Dropship listing from the app shows "Manage from Dropship".
- [ ] Merge to `main` and push (no server change; Render redeploy is harmless).
