# Order notifications: website bell, phone notifications, professional emails

Date: 2026-10-31. Status: draft for owner review.

## Why

Pay-on-delivery orders went live on 2026-10-31. Every order step saves a notice for the people
involved (`notifications` table, type `dropship_order`), but nothing shows them: the website
polls them every 20 s and never displays them, and the app has fetch helpers that no screen
uses. Today order updates reach people only by plain-text email. Buyers, resellers and
suppliers need to notice order steps quickly or orders time out (24 h steps).

## What the owner asked for

- **Phone app:** order updates arrive as phone notifications (lock screen, app closed too).
  Tapping one opens that order in the app.
- **Website:** a bell in the top bar with an unread count and a list. Tapping a notice opens the
  order.
- **Email (both):** order emails continue but look professional: TedBuy branding, clear
  heading, neat order details, a button to open the order.
- **Sender name:** emails come from "TedBuy", not "Tedbuy Support".
- Owner agreed: the delivery code is never in a phone notification (lock screens are visible
  to others); it stays in the email and on the order page.

## Goals

1. Website bell (desktop and phone-width layouts): red unread count, dropdown/list of the
   latest notices (all types, newest first), tap = mark read + open the related screen,
   "Mark all read" and "Clear all". Uses the existing `/api/notifications*` endpoints and the
   existing 20 s poll in `AppContext`.
2. Phone notifications for order notices, actually delivered on Android on live, opening the
   right order when tapped.
3. HTML order emails with a plain-text alternative, sent from "TedBuy".

## Non-goals

- SMS. Web push (browser notifications). iOS app (Android APK only today).
- Changing which order steps create notices (the server's `NOTICE` table stays the source).
- Payments.

## Anti-goals (a failure even if it works)

- A delivery code in a phone notification or the bell list text.
- Notifications for one person showing up for another (the API derives the user from the
  token; keep it that way).
- Notification spam: one push per notice, no duplicates from retries (order retries already
  return `changed: false` and send nothing).

## Current state (found 2026-10-31)

- Server `createNotification()` saves the row and already calls `sendPushNotification()` via
  Expo's push service using `users.pushToken`. Live has `pushToken`, `pushTokenPlatform`,
  `pushTokenUpdatedAt` (baseline dump); **staging lacks them** (testing push needs staging
  columns added, or testing on live with test accounts).
- App registers its Expo push token at start (`mobile/App.tsx` →
  `registerForPushNotificationsAsync` → `POST /api/users/push-token`). `google-services.json`
  is in the app config. **Unverified:** whether EAS has the FCM v1 key for Android (needed for
  Expo push to reach Android), and whether pushes arrive at all.
- `shouldNotifyUser(userId, prefKey)` gates notifications by user preference.
- Order emails: `sendDropshipOrderEmail({to, subject, text})` via Brevo, text only. Two are
  sent today: buyer "please confirm your order" (on placing) and buyer delivery code.
  Sender name comes from Render env `BREVO_SENDER_NAME` (currently "Tedbuy Support"); code
  default is "Tedbuy".

## Design

### 1. Website bell (web only, no app build)

- Bell icon in the Navbar (desktop) and in the phone-width header, beside Saved/Inbox. Hidden
  when signed out and in the app's embedded WebView (the app has its own notifications).
- Badge = unread count (cap display at "9+").
- Opens a panel: up to the newest 30 notices; each row shows title, message, relative time,
  unread dot. Empty state: "No notifications yet."
- Tap a row: mark it read (existing endpoint), close the panel, then:
  - `dropship_order` → open that order. Buyer → profile **My orders** tab with that order open.
    Reseller/supplier → Dropship hub **Orders** tab with that order open. (Which one is decided
    from the order: see "builder's calls".)
  - Other types keep their existing meaning (product → product page, chat → inbox, follow →
    store), using `relatedId`.
- Footer: "Mark all read", "Clear all" (confirm first).
- After an order action on the site, the next poll picks up new notices; no extra realtime.

### 2. Phone notifications (needs app 1.5.0)

- Verify end to end on live with test accounts: token saved on sign-in, Expo push accepted,
  notification shown on the emulator/phone.
- If EAS lacks the FCM v1 key: owner uploads it (Firebase console → service account →
  `eas credentials`); this is an owner step.
- Android notification channel "Orders" (high importance) so order pushes make a sound.
- Push payload carries `{ type: 'dropship_order', orderId }`. Tapping opens the order: buyer →
  My orders screen (WebView `/orders`) with that order; reseller/supplier → Dropship WebView
  on the Orders tab with that order. Cold start (app closed) and warm start both handled.
- Order notices always push (they are transactional), regardless of marketing-style prefs —
  unless the user turned off a specific "orders" preference, if one exists.
- Push text = the notice title + message (already plain words, never contains the code).

### 3. Professional emails (server only)

- One HTML template for all Dropship order emails: TedBuy logo/wordmark header, heading,
  short message, an order summary block (order number, item, quantity, total to pay on
  delivery), a primary button ("View your order"), the pay-on-delivery safety line, footer
  with support address. Inline CSS, table layout (email-client safe), works without images.
- Plain-text version kept as `textContent` alongside `htmlContent`.
- Delivery-code email shows the code large and explains it is not a payment.
- Sender: name "TedBuy". Owner changes Render `BREVO_SENDER_NAME` to `TedBuy` (or deletes it so
  the code default applies; the code default changes to "TedBuy").

## Builder's calls (Claude's, owner may override)

- Spelling "TedBuy" (matches the logo) for the sender name.
- Which emails exist stays as today (placed, delivery code). Adding more events by email is a
  separate decision.
- How the website picks buyer vs reseller/supplier screen for an order notice: store the
  audience on the notice (e.g. in its type or a small data field) when it is created, rather
  than guessing.
- Bell shows all notification types, not only orders.

## Order of work

1. Emails (server only, quickest, visible straight away) + sender name.
2. Website bell (web only).
3. Phone notifications: verify pipeline on live; fix registration/tap handling; app 1.5.0
   build and release (owner publishes as before).

Each step is pushed separately after the owner checks it.
