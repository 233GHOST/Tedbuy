# Order Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Order updates reach people: branded HTML emails (confirm / new order / on its way), a website bell, and Android phone notifications that open the order.

**Architecture:** Emails are rendered by one pure server module and sent through the existing Brevo sender. Order notices keep flowing through `createNotification()` (which already pushes via Expo); notices gain an audience so the website and the app can open the right order screen. The website bell reads the existing `notifications` state in `AppContext`; a small context call opens an order on the right screen, and the same thing is reachable by URL so the app's WebView can deep-link.

**Tech Stack:** Express + TypeScript server, React + Tailwind web, Expo SDK 57 app (`expo-notifications`), Brevo API, node:test via tsx, PGlite for SQL tests.

**Spec:** `docs/superpowers/specs/2026-10-31-order-notifications-design.md`

## Global Constraints

- The delivery code never appears in a push, a notification row, or the bell. It appears only in the "on its way" email and on the buyer's order page.
- Sender name "TedBuy" (code default `process.env.BREVO_SENDER_NAME || 'TedBuy'`); owner sets/deletes Render `BREVO_SENDER_NAME`.
- Emails: inline CSS, table layout, readable without images, plain-text alternative always sent.
- No database migration (live and staging schemas stay as they are). Audience travels in the notification `type` string.
- Notification types: `dropship_order_buyer`, `dropship_order_reseller`, `dropship_order_supplier`. Old rows typed `dropship_order` must still render (treated as buyer-unknown: open the Dropship hub).
- Bell hidden when signed out and in the app's embedded WebView (`isEmbedded`).
- Each part (A emails, B bell, C phone) is pushed separately after the owner checks it; Part C ships as app 1.5.0.

## Review Focus

- Reseller has no email on their user row → the "new order" email is skipped silently, the order step still succeeds (test in Task 2).
- An order step retried (`changed: false`) → no second email and no second notice (test in Task 2).
- A notification whose order the viewer can no longer open (e.g. supplier with no hold) → tapping shows the orders list, not a blank screen or error loop (test in Task 4).
- Item title containing `<`, `&`, quotes → escaped in the HTML email (test in Task 1).
- Signed-in user with 0 notifications → bell shows no badge and "No notifications yet." (test in Task 5).

---

## Part A — Professional emails

### Task 1: Email template module

**Files:**
- Create: `server/dropship/orderEmail.ts`
- Create: `server/dropship/orderEmail.test.ts`
- Modify: `package.json` (`test:dropship` script: add `server/dropship/orderEmail.test.ts`)

**Interfaces:**
- Produces:
  ```ts
  export type OrderEmailKind = 'confirm' | 'new_order' | 'on_its_way';
  export interface OrderEmailInput {
    kind: OrderEmailKind; orderNumber: string; title: string; quantity: number;
    totalPesewas: number; link: string; area?: string; code?: string;
  }
  export function renderOrderEmail(i: OrderEmailInput): { subject: string; text: string; html: string };
  ```

- [ ] **Step 1: Write failing tests** in `orderEmail.test.ts`:
  - `confirm`: subject `Please confirm your TedBuy order ${orderNumber}`; text and html contain `Pay only when you receive your order` and the total `GH₵200.00` for 20000 pesewas; html contains an `<a` whose `href` is `link` and button text `View your order`.
  - `new_order`: subject `New order ${orderNumber}: ${title}`; contains `Call the buyer, then accept the order` and `area`; button text `Open your orders`.
  - `on_its_way`: subject `Your TedBuy order ${orderNumber} is on its way`; text and html contain the `code`, `It is not a payment`, and `Give this code to the seller only when the item is in your hands`.
  - escaping: title `Mac <b>&"x"` → html contains `Mac &lt;b&gt;&amp;&quot;x&quot;` and not `<b>`.
  - html contains the wordmark text `TedBuy` and `support@tedbuy.store`; no `<img`.
- [ ] **Step 2:** Run `npx tsx --test server/dropship/orderEmail.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `renderOrderEmail`. One shared layout function (header bar navy `#0f172a` with "Ted" white + "Buy" orange `#ea580c`, white card, heading, paragraph, summary table: Order / Item / Quantity / Total to pay on delivery, primary button navy, green safety line "Pay only when you receive your order. Never send money before delivery.", footer "TedBuy · support@tedbuy.store"). Code shown in a large monospace box for `on_its_way`. Money via the same format as `formatPesewas` (`GH₵` + 2 decimals). Escape every interpolated value.
- [ ] **Step 4:** Run the test → PASS.
- [ ] **Step 5:** Commit `feat(dropship): branded order email templates`.

### Task 2: Send the three emails

**Files:**
- Modify: `server/dropship/orderRoutes.ts` (`OrderMail`, `OrderDeps`, place route, buyer action route, `codeMail`)
- Modify: `server.ts` (`sendDropshipOrderEmail`: add `htmlContent`, default sender `'TedBuy'`; pass `lookupEmail`)
- Modify: `server/dropship/index.ts` (thread `lookupEmail` through like `sendMail`)
- Test: `server/dropship/orderRoutes.test.ts`

**Interfaces:**
- Consumes: `renderOrderEmail` (Task 1).
- Produces: `OrderMail = { to: string; subject: string; text: string; html?: string }`; `OrderDeps.lookupEmail?: (uid: string) => Promise<string | null>`. In `server.ts`, `lookupEmail` reads `users.email` by id via `backendSupabase` and returns null on any error.

- [ ] **Step 1: Failing tests** (extend the existing full-flow test and add one):
  - after `buyer confirm`, `mails` has one with `to === 'res@example.com'`, subject matching `/^New order /`, `html` defined (fake `lookupEmail` maps `o-res` → `res@example.com`).
  - after `out_for_delivery`, the code mail subject matches `/is on its way/`, `text` and `html` contain the code.
  - placing: the confirm mail has `html` defined.
  - retry of `buyer confirm` (same order, already confirmed) adds no mail.
  - with `lookupEmail` returning null, `buyer confirm` still returns 200 and sends no reseller mail.
- [ ] **Step 2:** Run `npm run test:dropship` → the new assertions FAIL.
- [ ] **Step 3:** Implement: build mails with `renderOrderEmail`; links `${SITE}/#/orders` (buyer) and `${SITE}/#/dropship` (reseller). New-order mail only when `action === 'confirm' && result.changed`; `area` = the order's delivery area from the result order. `sendDropshipOrderEmail` sends `htmlContent` when present.
- [ ] **Step 4:** Run `npm run test:dropship` and `npx tsc --noEmit -p .` → all pass.
- [ ] **Step 5:** Commit `feat(dropship): HTML order emails, new order and on its way`.
- [ ] **Step 6 (owner check, then push):** owner sets Render `BREVO_SENDER_NAME=TedBuy` (or deletes it); place a test order on live; owner confirms the three emails look right in Gmail; push.

## Part B — Website bell

### Task 3: Order notices carry their audience

**Files:**
- Modify: `server/dropship/orderRoutes.ts` (`OrderNotice` gains `audience: 'buyer' | 'reseller' | 'supplier'`; `noticesFor`, `runOrderExpiry` fill it; `'dropshipper'` maps to `'reseller'`)
- Modify: `server.ts` (order `notify`: `type: \`dropship_order_${n.audience}\``; `createNotification` push data adds `relatedId: notif.relatedId`)
- Modify: `src/types.ts` (`AppNotification.type` union adds the three order types and `'dropship_order'`; add `relatedId?: string`)
- Test: `server/dropship/orderRoutes.test.ts`

**Interfaces:**
- Produces: notification rows `{ type: 'dropship_order_buyer' | 'dropship_order_reseller' | 'dropship_order_supplier', relatedId: orderId }`; push data `{ notificationId, type, relatedId }`.

- [ ] **Step 1: Failing test:** in the full flow, `notices.find(n => n.userId === 'o-sup')?.audience === 'supplier'` and a buyer notice has `audience === 'buyer'`, a reseller notice `'reseller'`; expiry test notices carry an audience.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npm run test:dropship`, `npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5:** Commit `feat(dropship): order notices carry audience`.

### Task 4: Open an order on the right screen (context + URL)

**Files:**
- Modify: `src/context/AppContext.tsx` (add `openOrder`, `orderToOpen`, `clearOrderToOpen`; read `?order=&as=` once at startup)
- Modify: `src/components/ProfileSettings.tsx` (when `orderToOpen.as === 'buyer'`: switch to `orders` tab / mobile `orders` sub-setting)
- Modify: `src/components/dropship/MyOrdersView.tsx` (accept `initialOpenId?: string`)
- Modify: `src/components/dropship/DropshipHub.tsx`, `DropshipperPanel.tsx`, `SupplierPanel.tsx` (select the role tab and `sub === 'orders'`, pass `initialOpenId` to `ResellerOrders` / `SupplierOrders`)
- Modify: `src/components/dropship/ResellerOrders.tsx`, `SupplierOrders.tsx` (accept `initialOpenId?: string`)

**Interfaces:**
- Produces (AppContext):
  ```ts
  openOrder: (as: 'buyer' | 'reseller' | 'supplier' | null, orderId: string) => void;
  orderToOpen: { as: 'buyer' | 'reseller' | 'supplier' | null; orderId: string } | null;
  clearOrderToOpen: () => void;
  ```
  `openOrder('buyer', id)` → `setCurrentView('profile-settings')` + orders tab; `'reseller' | 'supplier' | null` → `setCurrentView('dropship')` with that role tab (null keeps the hub's default). Startup reads `order` (uuid) and `as` from `location.search` (kept with `?embed=app`).
- Behaviour: the detail opens via `initialOpenId`; if that order can't be loaded (NOT_FOUND), the list is shown (Review Focus).

- [ ] **Step 1:** `npx tsc --noEmit -p .` baseline clean.
- [ ] **Step 2:** Implement; consumers call `clearOrderToOpen()` after taking it.
- [ ] **Step 3:** Manual check on localhost: `http://localhost:3000/?order=<id>&as=buyer#/orders` opens that order inside the profile; `as=reseller` opens Dropship → Orders → that order; a bad id shows the list.
- [ ] **Step 4:** Run `npx tsc --noEmit -p .`, `npm run build` → clean.
- [ ] **Step 5:** Commit `feat(web): open a specific order from a link or notification`.

### Task 5: The bell

**Files:**
- Create: `src/components/NotificationBell.tsx`
- Modify: `src/components/Navbar.tsx` (desktop: between Saved and Inbox; phone-width header: beside the Saved icon)

**Interfaces:**
- Consumes: `notifications`, `markNotificationAsRead`, `markAllNotificationsAsRead`, `clearAllNotifications`, `openOrder`, `isEmbedded`, `currentUser` from `useApp()`; existing product/chat/seller navigation for other types (`setSelectedProductId` + `'product-detail'`, `'chats'`, `setSelectedSellerId` + `'seller-profile'`).
- Produces: `export function NotificationBell(): JSX.Element | null`.

- [ ] **Step 1:** Implement: returns null when `!currentUser || isEmbedded`. Badge = unread count, `9+` above 9, hidden at 0. Panel: newest 30 by `createdAt`, title + message + relative time + unread dot; empty state `No notifications yet.`; footer `Mark all read` and `Clear all` (`window.confirm('Clear all notifications?')`). Row tap: mark read, close, then route: `dropship_order_*` → `openOrder(<suffix>, relatedId)`; `dropship_order` → `openOrder(null, relatedId)`; `new_message` → chats; `new_follower` → trigger user's store; listing types → product. Closes on outside click and Escape.
- [ ] **Step 2:** Run `npx tsc --noEmit -p .`, `npm run build` → clean.
- [ ] **Step 3:** Manual check on localhost (staging): place an order as buyer; within ~20 s the reseller's bell shows 1; tapping opens that order in Dropship → Orders; badge clears; signed-out shows no bell; phone-width layout shows it in the header.
- [ ] **Step 4:** Commit `feat(web): notification bell`.
- [ ] **Step 5 (owner check, then push).**

## Part C — Phone notifications (app 1.5.0)

### Task 6: Push that opens the order

**Files:**
- Modify: `mobile/src/utils/pushNotifications.ts` (Android channel `orders`, importance HIGH, name "Orders"; drop the `Device.isDevice` early return so emulators with Google Play can register — keep the permission flow)
- Modify: `server.ts` (`sendPushNotification`: `channelId: 'orders'` when `type` starts with `dropship_order`, else `'default'`)
- Modify: `mobile/src/utils/webHandoff.ts` (`ordersEmbedUrl(orderId?: string, as?: string)` / `dropshipEmbedUrl(...)` adding `&order=…&as=…`; keep the existing constants)
- Modify: `mobile/src/screens/DropshipWebScreen.tsx` (props `orderId?: string; as?: string`, used to build the start URL)
- Modify: `mobile/src/navigation/index.tsx` (create `navigationRef` with `createNavigationContainerRef`; `OrdersWeb` / `DropshipWeb` read `route.params?.orderId/as`)
- Modify: `mobile/App.tsx` (response listener + `getLastNotificationResponseAsync()` for cold start: `type` `dropship_order_buyer` → `navigate('OrdersWeb', { orderId, as: 'buyer' })`; reseller/supplier/legacy → `navigate('DropshipWeb', { orderId, as })`)
- Modify: `mobile/app.json` (`version` `1.5.0`)

**Interfaces:**
- Consumes: push data `{ type, relatedId }` (Task 3); web `?order=&as=` (Task 4).

- [ ] **Step 1:** `cd mobile && npx tsc --noEmit` baseline clean.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** `cd mobile && npx tsc --noEmit`; root `npx tsc --noEmit -p .` → clean.
- [ ] **Step 4:** Commit `feat(app): order push notifications open the order (1.5.0)`.
- [ ] **Step 5 (owner + verify on live):** check EAS has the Android FCM v1 key (`npx eas-cli@latest credentials -p android`, read-only view); if missing, owner uploads it. EAS preview build → emulator (Google Play image) signed in as a live test reseller → place an order as a live test buyer on the website → push arrives with sound; tap opens that order; app closed (cold start) also works. Then release build + `gh release` (owner) + Render version vars, as for 1.4.0.
