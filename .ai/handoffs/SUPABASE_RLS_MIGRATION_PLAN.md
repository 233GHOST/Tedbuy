# Supabase RLS Migration Plan

**STATUS: BLOCKED_APPROVAL — RLS itself (Phase 4) still requires explicit approval.** All four original Phase 0 items are implemented, each as its own isolated checkpoint (`94c3cc6`, `33441f1`, `409d2f4`, `aeba056`) — items 1 and 2 pending live/manual verification, items 3 and 4 fully verified (neither involves a server endpoint). One adjacent finding surfaced at checkpoint 3 remains open as a documented future item. **Phase 1's `users`-table write migration is essentially complete**: `7702c75` (checkpoint 5, `savedProductIds`), `1cf8e3e` (checkpoint 6, dead-code removal), `ab4afba` (checkpoint 7, `updateUserProfile`), `95cd5e6` (checkpoint 8, `messages` table), and `87f647f` (checkpoint 9, registration/Google-signup/login/auth-sync — the highest-stakes slice) — five checkpoints, all fully verified, `store_names` write coverage resolved as a side effect. **One genuinely high-risk item remains deliberately deferred**: `findAndMigrateExistingUser`'s account-migration merge (creates a document under a new id and deletes one under an old id in the same operation) — needs real server-side verification design, not a rushed migration; see §4's Phase 1 breakdown. Three other adjacent findings are also deliberately deferred, each documented at its own checkpoint: `updateProduct()`'s social-only `dbAdapter` branch (Phase 0 checkpoint 3), `setupWelcomePackage`'s multi-table writes (checkpoint 8), and `sendWelcomeEmailToAll`'s per-target `welcomeSent` write (checkpoint 9). Phases 2 through 5 remain design-only or not yet started. RLS, policies, grants, schema, and production config remain completely untouched throughout.

This document started as a design artifact and is being kept current as implementation proceeds in small, individually-reviewed checkpoints rather than as a static one-time snapshot. It builds on the completed read-only inventory in `.ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md` (§1-22) and the field-level fixes already shipped this session, and answers the question: **what would it take to safely turn RLS back on, and in what order.**

The finding in [§0](#0-one-new-finding-surfaced-by-this-design-pass-fixed-pending-live-verification-commit-94c3cc6-checkpoint-1) — surfaced during the original design pass and initially flagged rather than fixed — has since been implemented as its own isolated checkpoint (`94c3cc6`), pending live verification. Phase 0's item 4 (§1.8/§4, unmapping three server-only tables) is also implemented, as a separate checkpoint (`aeba056`), and fully verified. Everything else in this document remains design, not yet implemented.

---

## Foundational facts (read this before the tables below)

1. **The public anon key is, in practice, public.** `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are bundled into the shipped browser JS (`src/dbAdapter.ts:27-28`) — anyone can extract them from the network tab or the bundle itself. There is no meaningful sense in which "only the app" can use them.
2. **App-level query filters are not access control.** Every `dbAdapter` read/write ultimately becomes a generic `supabase.from(table).<op>()` call with no server-side enforcement of *which* row or *which* filter a caller uses. A component calling `.eq('sellerId', 'user_ted_ceo_support')` only shapes what *that component* asks for — with RLS off, the exact same anon key can issue `.select('*')` with no filter at all and retrieve every row in the table, for **any** table currently mapped in `VALID_TABLE_MAP`, regardless of what the app's own bundled code happens to query. This applies equally to every table in §1 below; it is not re-derived per table, only its distinct *consequences* are (e.g. a bulk PII leak is a worse consequence than a write-integrity issue, even though both share this one root cause).
3. **TedBuy has no Supabase Auth session, anywhere, ever.** Confirmed by exhaustive grep: zero calls to `supabase.auth.signIn*`, `supabase.auth.getSession`, or any Supabase Auth API in `dbAdapter.ts`, `server.ts`, or any client file. `createClient(supabaseUrl, supabaseAnonKey)` (`dbAdapter.ts:62`) is the *only* way the browser ever talks to Supabase, and it is never upgraded to an authenticated Supabase session. This means **`auth.uid()` inside any RLS policy will always evaluate to `NULL` for every browser request, forever, under the current architecture** — there is no bridge from "the user is signed into Firebase" to "Postgres knows who this Supabase request is from." Per instruction, this document does not propose inventing one (see §5).
4. **The server's Supabase client bypasses RLS entirely, by design, always.** `server.ts`'s `backendSupabase` uses `SUPABASE_SERVICE_ROLE_KEY`. Supabase's `service_role` Postgres role bypasses RLS unconditionally — turning RLS on or off has **zero effect** on anything `server.ts` does. The server's own authorization (`verifyUser()`/`verifyAdmin()`, real Firebase ID token verification) is already the actual enforcement mechanism for every server endpoint; RLS is irrelevant to that path and always will be.
5. **Consequence of 3 + 4:** RLS in this architecture can only ever do one useful thing — **constrain what the anon key (i.e., the browser, i.e., anyone) can do directly**, independent of Firebase identity, independent of the server. It cannot express "this row belongs to this Firebase user" as a policy, because Postgres never receives that identity. The only two honest RLS postures available are: **(a) deny the anon key everything** for a given table, forcing all access through the authenticated, Firebase-verified server API; or **(b) allow the anon key a narrow, row-and-column-scoped `SELECT` for data that is genuinely meant to be public to literally anyone, logged in or not.** There is no third option that expresses "only the owner" via RLS alone under this architecture.

---

## 0. One new finding surfaced by this design pass — FIXED, pending live verification (commit `94c3cc6`, checkpoint 1)

**Building the inventory below surfaced a live PII exposure not covered by the completed sweep.** `AppContext.tsx`'s `fetchUsersOnce` (~line 1893) ran `getDocs(collection(null, 'users'))` — an unauthenticated, unfiltered, `select('*')` bulk read of the **entire `users` table**, polled periodically (explicitly *not* a realtime listener, by design, to avoid an O(n²) egress blowup — see the comment at `AppContext.tsx:1885-1890`). Because `getTableSelectColumns()` only restricts columns for `products`, this read returned every column for every user: `email`, `phoneNumber`, `whatsAppNumber`, plus `isAdmin`/`isSuspended`/`securityHold`/`status` and anything else on the row — to any anonymous browser, no login required.

A safe, purpose-built replacement **already existed and was already correct**: `GET /api/users/list` (`server.ts:3674`) was built specifically to solve this exact problem for mobile (its own comment explains it replaces a direct Firestore read for the same reason) and deliberately selects only `id, username, photoUrl, role, joinDate, followingSellers, savedProductIds, emailVerified, isAdmin` — no contact info. Web had simply never been switched to it, the same "mobile/server already had it right" pattern found repeatedly throughout the completed audit.

This was scoped as **P0/P1 by the completed sweep's own severity bar** (bulk PII exposure, no auth required, live in production).

**FIXED, as its own isolated, individually-reviewed checkpoint (commit `94c3cc6`)** — not bundled with the rest of Phase 0, per an explicit request for clean, individually bisectable/revertable security checkpoints rather than one large batch. `fetchUsersOnce` now calls `GET /api/users/list` instead. This turned out to require more than "zero new server work, a pure client-side swap" (the original estimate on Phase 0's item 1 below — corrected there too): two real features depended on the old bulk read's contact-info fields, and one previously-undocumented gap was found along the way —
- `SellerProfilePage.tsx`'s "Contact seller via WhatsApp" feature now does a targeted lookup via `GET /api/users/get`, extended in the same commit to accept a `username` key (not just `id`/`email`).
- `sendWelcomeEmailToAll` (admin-only bulk campaign) now calls a genuinely new endpoint, `GET /api/admin/users/list-full` (real `verifyAdmin()`-gated, not in this document's original endpoint map — added to §3 below).
- `POST /api/admin/accounts/security-hold` had **no independent server-side check** protecting the super-admin account — the client-side check being removed by this fix was the *only* thing preventing a security hold from being placed on it. Found and fixed in the same commit (this also corrects §1.1's row 4 below, which had called this class of protection "already fully closed" — true for the write-blocking path, not true for this one endpoint's own logic).

**Not yet live-verified.** Only rejection/validation-path behavior has been confirmed against a running server — the actual success path (real data returned, the three affected features working end-to-end in a browser) is still pending a manual check, blocked on the reviewer's own device access rather than anything in the code.

---

## 1. Complete direct-Supabase inventory

One subsection per table. Columns match the request: operation, web caller, `dbAdapter` method, current authorization, data sensitivity, public-read / authenticated / private / admin-only, existing server replacement, new-endpoint-required, RLS-enabled-today consequence, migration priority.

### 1.1 `users`

| Operation | Web caller | `dbAdapter` method | Current auth | Sensitivity | Public-read / Auth'd / Private / Admin-only | Existing endpoint | New endpoint needed? | If RLS enabled today | Priority |
|---|---|---|---|---|---|---|---|---|---|
| ~~Bulk read, all columns, polled~~ — **FIXED, commit `94c3cc6`** | `AppContext.tsx` `fetchUsersOnce` (~1893) now calls `GET /api/users/list` | *(none — server-mediated)* | Server-side, `verifyAdmin()` not required (public-safe by design — column-restricted) | LOW now (only `id, username, photoUrl, role, joinDate, followingSellers, savedProductIds, emailVerified, isAdmin` returned) | **A** now (was HIGH-sensitivity direct access) | `GET /api/users/list` | No — done | **No effect.** This no longer touches Supabase from the browser at all — it's server-mediated via `service_role`, which bypasses RLS unconditionally (foundational fact #4). Enabling RLS today would not change this row's behavior either way. | — (done) |
| Single-doc realtime self-profile sync | `AppContext.tsx` `onSnapshot(doc('users', ownUid))` (~1340) | `onSnapshot` | None — reads by hardcoded own uid in normal use, but nothing stops reading any uid | HIGH (own data, but no enforcement) | Intended B (self); enforced only by convention | None realtime; `GET /api/users/get?id=` exists for one-shot pull | Yes — no realtime server API exists | Subscription returns nothing / errors; live profile sync breaks (e.g. suspension/role changes made elsewhere wouldn't reflect until next poll) | P1 |
| Profile write: username, bio, phone, whatsApp, photoUrl, followingSellers, savedProductIds, ~~notificationPreferences~~, role, createdAt, welcomeSent, authProvider, isGoogleAuth, originalUsername | `AppContext.tsx` — registration, profile save, save/unsave listing, migration flow (~15 call sites: `setDoc`/`updateDoc`/`writeBatch.set` on `doc('users', id)`) | `setDoc`, `updateDoc`, `writeBatch` | `TABLE_COLUMNS` field allow-list only — **zero row-ownership check**, any caller can write any other user's allowed fields. **`notificationPreferences` removed from this allow-list, checkpoint 4 (commit `409d2f4`)** — see the new row below; every other field in this list is still open, unchanged, still Phase 1 work. | MEDIUM (PII fields present: phone/whatsApp/bio; no privilege fields — those are already excluded) | Intended B; currently enforced at field level only, not row level | `POST /api/users/sync` exists and already correctly handles the privilege-sensitive subset (`isAdmin`/`isSuspended`/`emailVerified`/username-quarantine, and now `notificationPreferences` too) — but most of the *other* "safe" fields still bypass it entirely via direct writes | Partially — extend `/api/users/sync` (it already has the ownership check shape) or add a lighter self-profile endpoint for the remainder | **Every one of these writes breaks**: registration, profile save, save/unsave a listing, visit tracking | **P1** (core app functionality depends on this path) |
| ~~`notificationPreferences` write~~ — **FIXED, commit `409d2f4`, checkpoint 4** | `AppContext.tsx` `updateUserProfile` — direct write removed from the allow-list; `syncUserToServer` → `POST /api/users/sync` (already existed, already ownership-checked) continues to persist it correctly, unchanged | *(none — direct route closed)* | `POST /api/users/sync`, `targetUid === verified.uid` | LOW (muting/griefing, not privilege/money/identity) | **B, closed** | `POST /api/users/sync` (already existed and already handled this field correctly — confirmed by reading the endpoint before removing the direct route, not assumed) | No | No effect — this field no longer reaches Supabase via the anon key at all | — (done) |
| `isAdmin`/`isSuspended`/`securityHold`/`isDeleted`/`deletedAt`/`deletionRequestedAt`/`status` writes | — | Blocked — not in `TABLE_COLUMNS` | Already fully closed *for the direct-write path* (§13/§14.1/prior passes) — **correction**: "fully closed" originally described the `TABLE_COLUMNS` write-block only; it did not account for `/api/admin/accounts/security-hold` lacking its own independent server-side re-check, a gap invisible until checkpoint 1 removed the client-side data (`targetUser.email`) that check was silently depending on. Fixed in the same commit — see §0. | HIGH | C — already fully server-mediated | `/api/users/sync` (preserves from DB), `/api/admin/users/{suspend,delete}`, `/api/admin/accounts/security-hold` (now with its own re-check too) | No | No change — already blocked at the app layer; RLS would be pure defense-in-depth here | P3 |

### 1.2 `products`

| Operation | Web caller | `dbAdapter` method | Current auth | Sensitivity | Category | Existing endpoint | New endpoint needed? | If RLS enabled today | Priority |
|---|---|---|---|---|---|---|---|---|---|
| List (paginated feed) | `AppContext.tsx` `fetch('/api/products?...')` | *(none — already server-mediated)* | Server-side, public | LOW (genuinely public marketplace data) | **A** | `GET /api/products` / `/api/feed` | No | N/A — doesn't use dbAdapter | — (already done) |
| Single detail | `AppContext.tsx` `fetch(\`/api/products/${id}\`)` | *(none)* | Server-side, public | LOW | **A** | `GET /api/products/:productId` | No | N/A | — (already done) |
| Single-row read for like-toggle check | `AppContext.tsx` `toggleLikeProduct` — `getDoc(doc('products', id))` | `getDoc` | None — anon key, but column-restricted (`getTableSelectColumns` limits to a safe subset, no PII) | LOW-MEDIUM (no PII, but includes unpublished-adjacent fields like `boostStatus`) | A-ish | `GET /api/products/:productId` returns equivalent data already | No — could reuse existing endpoint | Read returns 0 rows; like feature breaks (can't determine current like state) | P3 |
| Create | `AppContext.tsx` → `/api/products/create` | *(none)* | Server, `verifyUser()`-gated | — | B (owner-created) | `POST /api/products/create` | No | N/A | — (already done) |
| Edit (title/price/images/etc.) | `AppContext.tsx` `updateProduct` → `/api/products/sync` | *(none for this path)* | Server, ownership-checked | — | B | `POST /api/products/sync` | No | N/A | — (already done) |
| ~~Edit — direct-Supabase parallel path (views/likes only)~~ — **FIXED, commit `33441f1`, checkpoint 3** | `AppContext.tsx` `toggleLikeProduct` now calls `POST /api/products/sync` (self-toggle path); `incrementProductViews` now calls the new `POST /api/products/:id/view` | *(none — both server-mediated)* | `toggleLikeProduct`: `verifyUser()`-gated, self-toggle-only server-side. `incrementProductViews`: deliberately anonymous-allowed (real product need — anonymous visitors generate real views), but the increment itself is server-computed and a per-product/per-IP cooldown replaces what was only ever a client-side convention | LOW now (ranking signal, but both paths are now server-validated) | **C, closed** | `POST /api/products/sync` (likes, already existed, already fixed server-side this session — just never adopted by this call site); `POST /api/products/:id/view` (views, genuinely new) | Views: done (new endpoint built). Likes: no — reused existing, already-correct endpoint. | **No effect on either feature** — neither touches the anon key anymore | — (done) |
| **Not yet fully closed**: `updateProduct()`'s generic "social-only" branch (`AppContext.tsx` ~3763) also writes `likesCount`/`likedUserIds`/`viewsCount` directly via `dbAdapter`, for any caller passing only those (or boost) keys | — | `updateDoc` | Same `TABLE_COLUMNS` allow-list gap as before — confirmed via grep that neither migrated function exercised this specific branch, so checkpoint 3 didn't break anything, but the direct-write route for these three fields isn't fully closed | LOW-MEDIUM | C | Would need the same fields removed from `dbAdapter.ts`'s `TABLE_COLUMNS.products` | Not yet — this branch also legitimately handles boost-field syncing, sharing the same code path; closing it means distinguishing social-only from boost-sync, not a drop-in | A raw Supabase caller (not this app's own JS) could still set these fields directly, bypassing both new endpoints | P2 — noted at checkpoint 3, deferred to its own future checkpoint |
| Delete | `AppContext.tsx` → `/api/products/delete`, `DELETE /api/products/:id` | *(none)* | Server, ownership-checked | — | B | Both exist | No | N/A | — (already done) |

### 1.3 `chats`

| Operation | Web caller | `dbAdapter` method | Current auth | Sensitivity | Category | Existing endpoint | New endpoint needed? | If RLS enabled today | Priority |
|---|---|---|---|---|---|---|---|---|---|
| List (own chats) | `AppContext.tsx` `fetchChatsFromApi()` | *(none)* | Server, `verifyUser()`, buyer/seller-scoped | — | B | `GET /api/chats` | No | N/A | — (already done) |
| Single detail | — | *(none)* | Server | — | B | `GET /api/chats/:chatId` | No | N/A | — (already done) |
| Start | `AppContext.tsx` `startChatViaApi` | *(none)* | Server | — | B | `POST /api/chats/start` | No | N/A | — (already done) |
| Mark delivered / picked up | `AppContext.tsx` | *(none)* | Server, seller-only / buyer-only | — | B/C (trade state) | `/api/chats/mark-delivered`, `/api/chats/mark-picked-up` | No | N/A | — (already done) |
| Support-desk realtime inbox (`sellerId === 'user_ted_ceo_support'`) | `AppContext.tsx` (~2504-2520) — `onSnapshot(query(collection(null,'chats'), where('sellerId','==','user_ted_ceo_support')))` | `onSnapshot`/`query` | **Client-side `isAdminUser` gate only** — no server check, no RLS; the filter is app-chosen, not enforced. Per foundational fact #2, the same anon key can query *any* filter, not just this one — meaning today the entire `chats` table (buyer/seller pairs, last-message text, product/price) is readable by anyone, admin-gate or not | **HIGH** (conversational metadata across the whole platform) | Intended D (admin-only); currently enforced by nothing at the data layer | None (already flagged in the code's own comments as a known gap deferred to "a future phase") | Yes — an admin-scoped support-inbox endpoint (polling is fine; this doesn't need to be realtime) | Subscription returns nothing; admin support inbox breaks | **P1** (confidentiality, not just the admin feature — see cell to the left) |

### 1.4 `messages`

| Operation | Web caller | `dbAdapter` method | Current auth | Sensitivity | Category | Existing endpoint | New endpoint needed? | If RLS enabled today | Priority |
|---|---|---|---|---|---|---|---|---|---|
| List (per chat) | `AppContext.tsx` `fetchMessagesFromApi()` | *(none)* | Server, participant-checked | — | B | `GET /api/messages/:chatId` | No | N/A | — (already done) |
| Send | `AppContext.tsx` `sendMessageViaApi` | *(none)* | Server, participant + admin-support-desk-checked | — | B | `POST /api/messages/send` | No | N/A | — (already done, incl. §18's admin fallback) |
| Mark read | `AppContext.tsx` (~4519, 4551) — `updateDoc(doc('messages', id), {read:true})` | `updateDoc` | `TABLE_COLUMNS` allow-list only, no ownership check | LOW-MEDIUM (message metadata, not content) | B | `POST /api/messages/mark-read` **already exists** — web partially migrated, partially still direct | No — finish the migration | Write fails silently (unread badges stop updating) | P2 |
| Delete (single message) | `AppContext.tsx` (~4692) — `deleteDoc(doc('messages', id))` | `deleteDoc` | `TABLE_COLUMNS`/table mapping only, no ownership check | LOW-MEDIUM | B | **None** — the only server-side message delete is inside the account-deletion cascade, not a per-message delete | **Yes — genuinely new** | Delete fails silently (message can't be removed) | P2 |
| Support-desk realtime read | `ChatInterface.tsx` (~2549) — `onSnapshot(query(collection(null,'messages'), where('chatId','==',activeChatId)))` | `onSnapshot`/`query` | Same client-side-only admin gate as §1.3's chats entry, same consequence (anyone can query any `chatId`'s messages directly) | **HIGH** (message content itself) | Intended D; currently unenforced | None | Yes — same admin-inbox endpoint as §1.3 could serve this | Subscription breaks | **P1** (same reasoning as chats) |

### 1.5 `reviews`

| Operation | Web caller | `dbAdapter` method | Current auth | Sensitivity | Category | Existing endpoint | New endpoint needed? | If RLS enabled today | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Bulk read (all reviews, for seller ratings) | `AppContext.tsx` (~2412) — `getDocs(collection(null,'reviews'))` | `getDocs` | None — anon key, `select('*')`, but no PII in this table's schema (`id, buyerId, buyerName, sellerId, rating, comment, productTitle, createdAt`) | LOW (genuinely public review content) | **A** | `GET /api/reviews` **already exists**, unused by web | No — migrate to existing endpoint (hygiene, not urgency — content is genuinely public) | Read returns 0 rows; ratings/reviews stop displaying anywhere | P2 |
| Create | `AppContext.tsx` `addReview` → `/api/reviews/create` | *(none — migrated this session)* | Server, trade-completion-verified | — | C | `POST /api/reviews/create` | No | N/A | — (already done) |
| Direct write (any) | — | Blocked (this session's fix) | Fully closed | — | — | — | No | N/A | — (already done) |

### 1.6 `reports`

| Operation | Web caller | `dbAdapter` method | Current auth | Sensitivity | Category | Existing endpoint | New endpoint needed? | If RLS enabled today | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Create | `AppContext.tsx` `reportProduct` → `/api/reports/create` | *(none — migrated this session)* | Server, `verifyUser()`-gated | — | D-adjacent (feeds moderation) | `POST /api/reports/create` | No | N/A | — (already done) |
| Read/list | *(no client caller exists)* | — | — | MEDIUM (report content, reporter identity) | **D** | **None** — admins currently only see report content via the support-chat message text created alongside submission, not a dedicated read | **Yes, if a real moderation queue is ever built** | N/A — nothing to break, since nothing reads this today | P3 (not urgent — no current feature depends on it) |
| Direct write (any) | — | Blocked (this session's fix) | Fully closed | — | — | — | No | N/A | — (already done) |

### 1.7 `store_names`

| Operation | Web caller | `dbAdapter` method | Current auth | Sensitivity | Category | Existing endpoint | New endpoint needed? | If RLS enabled today | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Availability check (one, during account-migration detection) | `AppContext.tsx` `findAndMigrateExistingUser` (~1043) — `getDoc(doc('storeNames', candidate))` | `getDoc` | None — anon key | LOW (a username reservation record: `id`, `userId`, `username` only) | A-ish | `GET /api/auth/check-store-name/:username` exists, serves a similar purpose | Possibly — confirm response shape matches this internal use before reusing | Read returns nothing; the specific account-migration-detection edge case breaks (not the primary signup flow) | P3 |
| Write (`id`/`userId`/`username` only — quarantine fields already blocked this session) | `AppContext.tsx` — 4 call sites (registration, Google signup, account-migration, profile update) | `setDoc`/`writeBatch.set` | `TABLE_COLUMNS` allow-list (3 fields only) — no row-ownership check | LOW-MEDIUM (a reservation row can be pointed at the wrong `userId` by a caller who isn't its owner, since nothing checks) | B | None dedicated — `/api/users/sync` already writes the same rows server-side for the profile-save case; the other 3 (registration, Google signup, migration) don't yet | Partial — extend `/api/users/sync`'s existing write, or add equivalents for the other 3 flows | Registration, Google signup, and the migration flow's username reservation step all break | P1 (registration is a critical path) |
| Quarantine fields (`status`/`availableAfter`/`quarantinedAt`) | — | Blocked (this session's fix, §20) | Fully closed | — | C | `/api/users/sync`'s quarantine check | No | N/A | — (already done) |

### 1.8 `boost_purchases`, `admin_audit_logs`, `account_deletion_audits` — ✅ DONE (commit `aeba056`, checkpoint 2)

| Table | Client usage found | Category | Notes |
|---|---|---|---|
| `boost_purchases` | None (one incidental mention in a legacy migration tool's table-name list, `ProfileSettings.tsx:870` — not an active read/write call; re-confirmed dead at checkpoint 2, traced into that whole code branch and found it a disabled stub) | **C** (payment records) | Server-only in practice today (11 `backendSupabase` call sites in `server.ts`, zero client `dbAdapter` calls). **Removed from `VALID_TABLE_MAP` and `TABLE_COLUMNS` entirely, checkpoint 2** — matches the `notifications` precedent (§18 of the audit doc): a table mapping that has no legitimate client caller is a live liability, not a convenience. |
| `admin_audit_logs` | None | **D** | Same reasoning — server-only, **unmapped, checkpoint 2**. |
| `account_deletion_audits` | None | **D** | Same reasoning — server-only, **unmapped, checkpoint 2**. |

### 1.9 `notifications` — reference case, already fully migrated (§18)

No longer in `VALID_TABLE_MAP` at all — the table mapping itself was removed, not just emptied, after §18's migration confirmed zero remaining client callers. This is the template for what "done" looks like for `boost_purchases`/`admin_audit_logs`/`account_deletion_audits` above, and eventually for every table in this document once its migration is complete.

### 1.10 The legacy migration tool (`ProfileSettings.tsx`, `src/utils/migration.ts`)

A one-time Firestore→Supabase data-migration utility, gated by an admin-only UI path, that reads/writes several tables directly (`users`, `products`, `chats`, `messages`, `reviews`, `notifications`, `store_names`, `boost_purchases`) as part of its own historical purpose. Out of scope for the main migration priority ranking — it's an admin tool, not a live user-facing feature — but worth an explicit decision at implementation time: either retire it outright (the migration it performs is presumably long since complete) or leave it as a documented, admin-only exception that will need its own review once RLS is enabled, since it would stop working exactly like everything else in this document.

---

## 2. The four categories, applied

**A — Public data.** Product catalog (list/detail), reviews. Both are **already server-mediated today**, not direct-Supabase — the direct-Supabase reads that touch this content (single-product like-check, bulk reviews read) are redundant parallel paths to endpoints that already exist, not evidence that direct public access is architecturally necessary. **Recommendation: treat "public" as "served by a thin, cacheable server endpoint," not "open Supabase table." No table in this repo needs the anon key to remain publicly readable once Phase 3 is complete** (see §4.3) — the existing endpoints already do this better (they apply moderation filtering the raw tables don't — see §7).

**B — User-owned data.** Most of `users` (profile fields), `store_names` (reservation fields), `messages` (read-state, deletion), and the write-side of `chats`/`products` that isn't already migrated. The defining trait: legitimately writable by *some* authenticated user, but never anyone, and — per §5 — Postgres RLS cannot express "the owner" here, so this category's real answer is **server-mediated writes**, not an RLS policy.

**C — Server-authoritative/private data.** `isAdmin`/`isSuspended`/security-hold/deletion state, boost/payment fields, `tradeStatus`, moderation `status`, `viewsCount`/`likesCount`/`likedUserIds` (ranking-relevant). Already mostly closed at the app layer by the completed sweep; the remaining gaps (§1.2's views/likes, §1.1's bulk PII read) are the explicit residuals carried into this plan.

**D — Admin/private operations.** `admin_audit_logs`, `account_deletion_audits`, the `chats`/`messages` support-desk inbox, `reports` (once a real read path exists). All either already server-only, or need to become so.

**What determined each classification: actual usage, not the field's name.** For example, `boost_purchases` sounds financial (and is), but its *client* usage is zero — its correct target state is "no client access exists," not "carefully scoped user-owned policy." `reviews`, despite going through a table named after user-generated content, contains no PII and is meant to be seen by literally anyone — its correct target state is closer to A than the instinctive "user data → lock it down."

---

## 3. Existing secure replacements — the map

| Vulnerable/direct operation | Existing secure endpoint | Status |
|---|---|---|
| `users` bulk read | `GET /api/users/list` | **Fixed — now used** (commit `94c3cc6`, checkpoint 1) |
| `users` single read | `GET /api/users/get` | Exists, used in places already — extended in checkpoint 1 to also accept a `username` lookup key (was `id`/`email` only), now also backs `SellerProfilePage.tsx`'s seller-contact lookup |
| `users` admin bulk read WITH contact info | `GET /api/admin/users/list-full` | **New, added in checkpoint 1** — not in this document's original endpoint inventory; `verifyAdmin()`-gated, backs `sendWelcomeEmailToAll`, deliberately kept separate from the public `/api/users/list` above rather than adding a conditional "include email" flag to it |
| `users` profile write (most fields) | `POST /api/users/sync` | **Exists, partially used** — privilege-sensitive fields already routed correctly; ordinary profile fields still bypass it via direct writes. **Unchanged by checkpoint 1** — that checkpoint fixed the bulk *read* only; every direct *write* to `users` (registration, profile save, save/unsave a listing — §1.1 row 3) is exactly as exposed as before. Still Phase 1 work. |
| `products` list/detail read | `GET /api/products`, `/api/products/:id` | Exists, fully used |
| `products` create/edit/delete | `/api/products/create`, `/api/products/sync`, `/api/products/delete` | Exists, fully used (except the views/likes direct-write residual) |
| `chats` read/write | `/api/chats*` | Exists, fully used (except the admin support-desk realtime exception) |
| `messages` read/send/mark-read | `/api/messages/:chatId`, `/api/messages/send`, `/api/messages/mark-read` | Exists — mark-read partially used; delete has no equivalent at all |
| `reviews` read | `GET /api/reviews` | **Exists, unused by web** |
| `reviews`/`reports` write | `/api/reviews/create`, `/api/reports/create` | Exists, fully used (migrated this session) |
| `store_names` availability | `GET /api/auth/check-store-name/:username` | Exists, used for the primary signup-form case; the account-migration-detection edge case still reads directly |

**Genuinely new endpoints required** (no existing equivalent to map to):
1. ~~A **views/likes endpoint**~~ — **✅ DONE, checkpoint 3 (commit `33441f1`)**. Turned out to be one new endpoint, not two: `POST /api/products/:id/view` (new, anonymous-allowed, server-computed increment + per-IP cooldown) for views; likes reused the *already-existing*, already-fixed `POST /api/products/sync` social-only path instead of needing anything new.
2. An **admin-only chats/messages support-desk read** (polling is sufficient — this doesn't need to be realtime) to replace the two direct Realtime subscriptions (§1.3/§1.4).
3. A **message delete** endpoint (§1.4).
4. **`store_names` write coverage** for the 3 flows (registration, Google signup, account-migration) that don't yet go through `/api/users/sync`'s equivalent write (§1.7) — likely an extension of an existing flow rather than a wholly new endpoint.
5. (Optional, not urgent) A **reports read/list** endpoint, only if a real admin moderation queue is ever built (§1.6).
6. **New, found at checkpoint 3**: closing `updateProduct()`'s generic social-only `dbAdapter` write branch fully will need either a small extension to `/api/products/sync` or a decision to route that branch through the same new view/like endpoints instead — see §1.2's new row.

---

## 4. Phased migration plan

### Phase 0 — Prerequisite: eliminate remaining dangerous direct access

Not a full migration — just closing what's independently dangerous *before* anything else, so later phases aren't racing a live exposure:

1. **✅ FIXED — commit `94c3cc6`, checkpoint 1, pending live verification.** Migrate `fetchUsersOnce` to `GET /api/users/list`. **Correction to the original estimate**: this was *not* "zero new server work, a pure client-side call-site swap" — two features depended on the old read's contact-info fields and needed real server-side additions (`GET /api/users/get`'s new `username` param, the new `GET /api/admin/users/list-full`), and closing it surfaced a genuine, previously-unknown gap (`/api/admin/accounts/security-hold` had no independent super-admin check of its own) that had to be fixed in the same commit rather than deferred. Full detail in §0.
2. **✅ DONE — commit `33441f1`, checkpoint 3, live verification incomplete.** Closed the `products` views/likes direct-write residual (§1.2). Views: genuinely new endpoint (`POST /api/products/:id/view`, deliberately anonymous-allowed, server-computed increment, per-IP cooldown). Likes: no new endpoint needed — `toggleLikeProduct` was migrated onto the already-existing, already-fixed `POST /api/products/sync` self-toggle path, simply never adopted before. **Found along the way, deliberately not fixed in this checkpoint**: `updateProduct()`'s generic social-only branch also writes these fields directly via `dbAdapter`, sharing its code path with legitimate boost-field syncing — closing it fully needs its own checkpoint (see §1.2's new row and endpoint list item 6 in §3).
3. **✅ DONE — commit `409d2f4`, checkpoint 4.** Closed the `notificationPreferences` cross-user write flagged in the completed sweep (§22 of the audit doc). Confirmed before touching anything: `updateUserProfile`'s parallel `syncUserToServer` → `POST /api/users/sync` call already persisted this field correctly, with a real ownership check — so the fix was removing the field from `dbAdapter.ts`'s allow-list, not building anything new. Kept as its own isolated checkpoint, separate from checkpoint 3 — different field, different table concern.
4. **✅ DONE — commit `aeba056`, checkpoint 2.** Unmapped `boost_purchases`/`admin_audit_logs`/`account_deletion_audits` from `VALID_TABLE_MAP` and `TABLE_COLUMNS` entirely (§1.8) — zero functional impact confirmed (re-verified via fresh grep before touching anything, not assumed from the original inventory), matches the `notifications` precedent, removes three tables' worth of attack surface. Kept as its own isolated checkpoint, separate from item 1 — genuinely unrelated tables, no shared risk surface. `git diff` for this commit touches exactly one file (`src/dbAdapter.ts`).

**All four original Phase 0 items are now implemented**, each as its own isolated, individually-reviewed checkpoint. One adjacent finding surfaced at checkpoint 3 (`updateProduct()`'s social-only `dbAdapter` branch) remains open, documented as its own future item rather than folded into any of the four above.

*Verification performed for item 1:* `tsc --noEmit` clean, production build clean, rejection-path/validation tests executed live against every new/changed endpoint. **Not yet performed:** live success-path verification (real data returned, the three affected features working end-to-end) — blocked on the reviewer's device access, not on anything outstanding in the code.

*Verification performed for item 2:* `tsc --noEmit` clean, production build clean, rejection/validation tests executed live (the like-toggle path correctly rejects no-auth/forged tokens; the view endpoint correctly rejects a missing productId and returns a clean, non-crashing 404 for a genuinely nonexistent product). **Not yet performed:** the actual increment-and-write happy path — no real product id was available to test against in this sandbox, and this session's persistent Supabase DNS issues make a clean result ambiguous rather than conclusive. Recommend a real-browser check (browsing listings logged-out, confirming view counts move; liking/unliking as a real user, confirming state persists across a refresh).

*Verification performed for item 3:* `tsc --noEmit` clean, production build clean. Same shape as item 4 — `dbAdapter.ts` is browser-only and never imported by `server.ts`, so there's no server endpoint to rejection-path test; `tsc` + the Vite build is the complete verification. No live/manual check needed.

*Verification performed for item 4:* `tsc --noEmit` clean, production build clean. `dbAdapter.ts` is browser-only and never imported by `server.ts`, so there's no server endpoint to rejection-path test here — `tsc` + the Vite build (which compiles/bundles this file) is the complete verification for this specific change.

### Phase 1 — Protected writes

Move every remaining direct `dbAdapter` **write** behind an authenticated server endpoint, table by table. Started (commit `7702c75`, checkpoint 5) — like Phase 0, being worked as a sequence of small, isolated, individually-reviewed checkpoints rather than one large batch.

- `products`: ✅ done — the views/likes endpoint from Phase 0, checkpoint 3, covers this (one adjacent `updateProduct()` branch still open, tracked separately — see §1.2).
- `reviews`/`reports`: ✅ already done (earlier this session).
- `users`: re-inventoried at the start of Phase 1 (16 direct write call sites confirmed via fresh grep, close to the original "~15" estimate) and broken into sub-checkpoints by feature, smallest/lowest-risk first:
  - ✅ **`savedProductIds` (checkpoint 5, commit `7702c75`)** — 3 call sites (`deleteProduct`'s own-bookmark cleanup, an auto-prune-stale-ids effect, `toggleSaveProduct`), all migrated onto the existing `POST /api/users/sync`. Found and worked around a real landmine while implementing this: that endpoint is not a patch endpoint — it rebuilds the row from whatever's in the request body, so every migrated call has to send the full current user object, not a field-only payload, or it silently wipes the rest of the caller's profile.
  - ✅ **Presence/analytics fields (checkpoint 6, commit `1cf8e3e`)** — `fcmTokens`, `visitCount`, `lastLogin`, `lastSeen`, `isOnline`, `rapidPostScore`, 6 call sites. Confirmed (by reading `updateDoc`'s own code, not assumed) that none of these fields has ever been in `dbAdapter.ts`'s `TABLE_COLUMNS.users` allow-list — `filterTableColumns` has always stripped every one of these writes to an empty payload, and `updateDoc` returns early rather than ever calling Supabase, so these have been pure no-ops the entire time. **Not a security fix** — no client-trust vulnerability existed here (the client-side allow-list already excluded these fields); this was a pre-existing *functional* bug, unrelated to and not introduced by this migration. Resolved per explicit direction: removed the 6 dead write calls, did not revive the underlying features (push-token registration, real presence/visit tracking, rapid-post scoring) — that's a product decision, out of scope. Local optimistic state updates that still produce a real, if session-scoped-only, display value (`SellerDashboard`'s "visits"/"recent posts" counters) were deliberately left in place; only the dead persists were removed.
  - ✅ **`updateUserProfile` (checkpoint 7, commit `ab4afba`)** — the main profile-save action (username/bio/phone/whatsApp/photoUrl/role), 1 call site. Migrated to call `POST /api/users/sync` directly rather than through `syncUserToServer` (which swallows its own errors) — same reasoning as `toggleSaveProduct` in checkpoint 5, so a real persist failure still reaches this function's own error handling instead of silently reporting success. **Two adjacent direct-write blocks in the same function deliberately left untouched, confirmed as separately-tracked concerns**: a "best-effort store name index" block that still writes `store_names` directly on username rename (checked first — `/api/users/sync` already reserves the *new* username server-side but doesn't delete the *old* one, so removing this block now would orphan stale reservations; still the §1.7 "profile update" flow item below), and a "best-effort products sellerName" block (different table, separately tracked).
  - ✅ **Registration / Google sign-up / login / auth-sync (checkpoint 9, commit `87f647f`)** — the highest-stakes slice, handled with extra care (every change preserves the exact original error-propagation/fallback behavior; full diff reviewed line by line before committing). Discovered mid-inventory that the original ~16-call-site count (checkpoint 5) was incomplete — it only matched the literal string `doc('users', currentUser.id)`, missing sites using differently-named ref variables (`userRef`, etc.); a broader, pattern-independent search found the true remaining set. Five sites migrated to `POST /api/users/sync` (all real-Firebase-identity, all self-only): the self-profile realtime handler's `emailVerified`/`isGoogleAuth` upgrade; Google Sign-In's new-user creation; `registerUser`'s *real* branch only; `loginUser`'s minimal-fallback-profile creation (incidentally also fixes a pre-existing gap — this path never reserved the username in `store_names` before, `/api/users/sync` does so as a normal side effect); `reloadUserVerificationStatus` (already doubly-safe, since that endpoint never trusted the client's `emailVerified` claim anyway).

    **Deliberately not migrated, each for a specific reason, not time pressure:**
    - `registerUser`'s **sandbox-fallback branch** (engaged only when the Firebase project's email/password provider is disabled) — there is no real Firebase identity in this branch at all, so `verifyUser()` has nothing to verify; migrating would break the fallback outright, not secure it. Restructured behind an explicit `isLocalSandboxFallback` flag rather than silently intermixed with the real branch, but its direct-write behavior is unchanged.
    - `switchUserSimulated` — confirmed explicitly disabled in production builds (`if (import.meta.env.PROD) { return }` at the top), a dev-only testing utility, unreachable in the deployed app.
    - `findAndMigrateExistingUser`'s account-migration merge (`batch.set` to a new uid + `batch.delete` of an old uid + a `store_names` repoint) — **still the genuinely highest-risk remaining item**. `/api/users/sync` has no concept of "also delete this OTHER id's row"; building that support naively (trusting a client-asserted "this was my old account") would let an attacker delete arbitrary other users' accounts by lying about which id was theirs. Needs its own dedicated checkpoint with real server-side verification (e.g. matching email between the old and new records), not a rushed migration.
    - `setupWelcomePackage`'s `welcomeSent` flag write — already covered by that function's broader multi-table finding from checkpoint 8, not duplicated here.
    - `sendWelcomeEmailToAll`'s per-target `welcomeSent` flag write (admin bulk operation, writes to *other* users' rows by design) — confirmed `/api/users/sync` **does** support admin-writes-to-other-users (an `isAdmin` override on its ownership check), but the admin bulk-send loop only has a trimmed `{id, email, username, welcomeSent}` shape per target (from `GET /api/admin/users/list-full`), and sending that minimal object to `/api/users/sync`'s full-object-replace semantics would silently wipe every *other* real profile field for every user in the bulk send. Needs either a real PATCH-style admin endpoint or an N+1 fetch-then-sync approach — a genuine design decision.
- `messages`: ✅ **done (checkpoint 8, commit `95cd5e6`)**. Three findings resolved: (1) `markChatAsRead`'s admin-support-desk carve-out — added the same admin-as-support-desk fallback already used by `/api/messages/send` to `/api/messages/mark-read` itself, so the client no longer needs a special case. (2) `toggleMessageReadStatus` — confirmed zero callers anywhere via grep, removed entirely rather than migrated (same resolution as checkpoint 6's dead-code pattern). (3) `resetChats` — a destructive, ownership-check-free bulk-delete of all chats/messages; also confirmed dead (destructured in `Navbar.tsx`, never called), removed entirely. This also resolves the plan's originally-flagged "message delete, needs a new endpoint" item — the only `deleteDoc` call against `messages` in the whole codebase turned out to be inside this dead function, so no new delete endpoint was actually needed. **New finding, deliberately deferred to its own future checkpoint**: `setupWelcomePackage` (`AppContext.tsx` ~2162) also writes directly to `users`/`chats`/`messages` via `dbAdapter` (creating the support pseudo-account profile plus a welcome chat+message) — traced and confirmed every sensitive-looking field is a hardcoded constant, never attacker-influenced, at all 3 call sites, so this is lower urgency than the findings already fixed, but still shares the same architectural root cause.
- `store_names`: ✅ **effectively done, as a side effect of checkpoint 9**. The 3 flows this item originally referred to (registration, Google sign-up, profile update) all route through `POST /api/users/sync` now (profile update already did, since checkpoint 7), and that endpoint already reserves the username in `store_names` server-side. The one remaining direct `store_names` write is `findAndMigrateExistingUser`'s repoint during the account-migration merge — tracked as part of that same still-deferred, higher-risk finding, not a separate `store_names`-specific gap.

**Exit criterion for Phase 1:** grep-confirm zero remaining `setDoc`/`updateDoc`/`deleteDoc`/`writeBatch` calls against any real (non-ephemeral) table anywhere in `src/` — the same style of "confirmed via a final repository-wide grep returning zero results" already used to close out the notifications migration (§18.4 of the audit doc).

*Verification performed for the `savedProductIds` checkpoint:* `tsc --noEmit` clean, production build clean. No server-side change (the existing `POST /api/users/sync` was reused as-is) — only a regression check was run, confirming no-auth/forged-token requests still correctly return 401.

*Verification performed for the presence/analytics checkpoint:* `tsc --noEmit` clean, production build clean. Pure removal of client-side dead code with no prior effect (behavior is provably identical — an empty `updateDoc` payload that always early-returned before, now simply not called at all), so no rejection-path test applies.

*Verification performed for the `updateUserProfile` checkpoint:* `tsc --noEmit` clean, production build clean. No server-side change (the existing `POST /api/users/sync` was reused as-is) — regression check run live, confirming no-auth/forged-token requests still correctly return 401. Confirmed `syncUserToServer` remains referenced by other legitimate call sites (the account-migration merge flow, checkpoint 5's two `savedProductIds` sites) so nothing went dead as a side effect.

*Verification performed for the `messages` checkpoint:* `tsc --noEmit` clean, production build clean. Rejection-path tests executed live against the new admin-fallback logic in `POST /api/messages/mark-read` (no-auth, forged-token, and no-auth-with-missing-chatId all correctly return 401 before the fallback branch is reachable).

*Verification performed for the registration/login/auth-sync checkpoint:* `tsc --noEmit` clean, production build clean. No server-side change (the existing `POST /api/users/sync` was reused as-is throughout) — regression check run live, confirming no-auth/forged-token requests still correctly return 401. Full diff reviewed line by line given the stakes of this specific area (registration and login breaking would be catastrophic).

### Phase 2 — Protected reads

Move private/user-owned reads where direct anonymous access exposes data that shouldn't be public:

- `users` bulk poll → `/api/users/list` (Phase 0 already covers the urgent part; this phase is about making sure nothing regresses back to direct access).
- `users` self-profile realtime → replace with a poll of `/api/users/get?id=<own uid>` (matches the notifications migration's own precedent of trading realtime push for a poll — §18.5 of the audit doc — or, if instant reactivity to admin-side changes like suspension truly matters, a dedicated lightweight polling endpoint).
- `chats`/`messages` admin support-desk realtime → the new admin-only polling endpoint from §3.
- `store_names` account-migration-detection read → consolidate onto `/api/auth/check-store-name/:username` (confirm/extend its response shape first).

**Exit criterion:** grep-confirm zero remaining `getDoc`/`getDocs`/`onSnapshot` calls against any real table in `src/`.

### Phase 3 — Public reads: what can safely remain

**Recommendation: nothing.** Every table's genuinely-public content (`products`, `reviews`) is already served by existing server endpoints that do strictly more than the raw table would — most importantly, they apply moderation filtering the raw tables don't (`normalizeServerProductSummaryRow` excludes `isDeleted`/`archived`/`deleted` listings — a raw anon `select('*')` on `products` has no equivalent filter and would leak moderated-away listings). There is no case in this inventory where moving a read *back* to direct Supabase access is a net improvement over the endpoint that already exists.

If a future performance need ever justifies a direct-to-Postgres public read path (e.g. an extremely high-traffic product feed outgrowing the Node server), the correct mechanism is a **narrow, purpose-built Postgres `VIEW`** (not the base table) with only the safe, already-moderation-filtered columns exposed, with its own RLS policy — not opening the base tables to the anon key. Not recommended as part of this migration; noted only so it isn't reinvented ad hoc later.

### Phase 4 — RLS

Once Phases 0-3 are complete (the anon key is no longer used for any meaningful read or write), RLS policy design is deliberately simple — see §6 for the full per-table target model. In one sentence: **enable RLS on every table, add zero permissive policies to any of them** (true default-deny), because by this point nothing legitimate should be reaching Supabase via the anon key at all — the server's `service_role` key is unaffected by RLS either way (foundational fact #4) and continues working exactly as it does today.

### Phase 5 — Verification

Test matrix, per table, per operation, four identities:

| Identity | What to verify |
|---|---|
| **Anonymous** (no Firebase token, using only the public anon key against Supabase directly) | Every table returns zero rows / rejects every write. This is the actual RLS test — bypassing the app's own JS entirely and hand-crafting a PostgREST request is the only way to test what RLS *actually* enforces, not what the app's UI happens to call. |
| **Normal authenticated user** (real Firebase token, hitting the *server* endpoints, not Supabase directly) | Every endpoint from §3 still works exactly as before — this validates Phases 1-2 didn't regress functionality, independent of RLS. |
| **Cross-user** (real Firebase token for user A, attempting to affect user B's data via every migrated endpoint) | Every endpoint rejects with 403/404 as appropriate — re-run the same rejection-path methodology already used throughout the completed sweep. |
| **Admin** (real, cryptographically-verified admin token) | Every admin-gated operation (§1.3/§1.4's support inbox, `/api/admin/*`) still works; every non-admin-gated operation an admin shouldn't get special treatment on behaves the same as a normal user. |

---

## 5. The Firebase/Supabase identity question — explicit answer

**TedBuy's application identity is Firebase Auth. TedBuy has no Supabase Auth session, and this document does not propose building one** (per instruction — no repository evidence of an existing Firebase-to-Supabase JWT bridge was found, and inventing one is out of scope here).

Consequence, stated plainly for every table in this document: **no RLS policy in the target design can reference `auth.uid()` meaningfully**, because it is always `NULL` for the only kind of request that ever reaches Postgres directly from a browser (the anon key). Every operation that needs to know "which user is this" — which is nearly everything in categories B, C, and D — **must be completely server-mediated**, using Firebase's real, cryptographic `verifyIdToken()` (already the established, working, heavily-tested pattern from the entire completed audit) as the actual identity check, with the server's `service_role` Supabase client (which RLS cannot restrict) doing the actual database work afterward.

This is not a limitation introduced by this plan — it's a description of the architecture that already exists and has existed this whole session. It's stated explicitly here because it's the single fact that most determines the shape of §6: RLS's job shrinks from "express per-user ownership" (impossible without a JWT bridge) to "cap what the anon key can touch at all" (fully sufficient given Phases 0-3 remove nearly everything from its reach).

---

## 6. Target RLS model, per table

| Table | RLS enabled | Anon `SELECT` | "Authenticated browser" `SELECT` | Browser `INSERT` | Browser `UPDATE` | Browser `DELETE` | Server (`service_role`) | Policy required |
|---|---|---|---|---|---|---|---|---|
| `users` | Yes | No | N/A¹ | No | No | No | Unaffected (bypasses RLS) | None (default-deny) |
| `products` | Yes | No² | N/A¹ | No | No | No | Unaffected | None |
| `chats` | Yes | No | N/A¹ | No | No | No | Unaffected | None |
| `messages` | Yes | No | N/A¹ | No | No | No | Unaffected | None |
| `reviews` | Yes | No² | N/A¹ | No | No | No | Unaffected | None |
| `reports` | Yes | No | N/A¹ | No | No | No | Unaffected | None |
| `store_names` | Yes | No | N/A¹ | No | No | No | Unaffected | None |
| `boost_purchases` | Yes | No | N/A¹ | No | No | No | Unaffected | None |
| `admin_audit_logs` | Yes | No | N/A¹ | No | No | No | Unaffected | None |
| `account_deletion_audits` | Yes | No | N/A¹ | No | No | No | Unaffected | None |

¹ "Authenticated browser" (Postgres's `authenticated` role, tied to a Supabase Auth session) is never reached by any TedBuy request — there is no Supabase Auth session, ever (§5). This column is N/A for every table, not a per-table judgment call.

² `products` and `reviews` are the two tables where a case for `anon SELECT` could be made (genuinely public content) — the explicit recommendation in §4.3 is still **No**, because the existing server endpoints already do this better (moderation filtering, caching, rate limiting) and there's no compelling reason to open a second, worse path to the same data. If that recommendation is ever revisited, do it via a purpose-built `VIEW` with its own policy, not a `SELECT` grant on the base table.

**Every row in this table reduces to the same shape**, which is the point: once Phases 0-3 are done, RLS's design is not a 10-table bespoke policy-writing exercise — it's "flip `ENABLE ROW LEVEL SECURITY` on, write zero policies, confirm the app still works because it was never relying on the anon key for anything by then." The complexity in this migration is entirely in Phases 0-2 (moving real, live functionality off direct Supabase access); Phase 4 itself is close to mechanical once they're done.

---

## 7. Breaking changes if RLS were enabled today

Every row in §1 marked with a concrete "if RLS enabled today" consequence would break simultaneously, immediately, in production, with no gradual degradation. Consolidated list, ranked by user-facing severity:

| Break | Cause | Required fix before RLS |
|---|---|---|
| **Registration and Google sign-up fail outright** | `users` + `store_names` direct writes | Phase 1 |
| **Every profile save fails** (username, bio, phone, avatar, preferences) | `users` direct writes | Phase 1 |
| **Save/unsave a listing fails** | `users.savedProductIds` direct write | Phase 1 |
| **Like/unlike a listing fails; view counts stop incrementing** | `products` direct writes | Phase 0/1 |
| ~~The user directory / online-presence feature returns empty~~ — **no longer a break** | `users` bulk read | **Done (commit `94c3cc6`)** — this read is now server-mediated (`GET /api/users/list`, `service_role`), immune to RLS regardless of Phase 2's status; removed from this list |
| **A user's own profile no longer live-updates** (e.g. after an admin action elsewhere) | `users` self-profile realtime | Phase 2 |
| **Admin support-desk inbox shows nothing** | `chats`/`messages` support realtime | Phase 2 |
| **Message read-state stops updating; messages can't be deleted** | `messages` direct writes | Phase 1 |
| **Reviews and ratings stop displaying anywhere** | `reviews` bulk read | Phase 2 |
| **The account-migration-detection edge case breaks** | `store_names` direct read | Phase 2 |
| **The legacy admin migration tool stops working** | multiple tables | Explicit decision needed (§1.10) — likely fine to let this break, it's a historical one-time tool |

No break in this list is silent — every one is a hard failure (empty result / thrown error), not subtle data corruption, which is the correct failure mode for "we turned on access control" but still means **this cannot be done in one step**; Phases 0-3 must land first, verified, before Phase 4 touches production.

---

## 8. Deliverables

This document (`SUPABASE_RLS_MIGRATION_PLAN.md`) and `CURRENT_HANDOFF.md` (updated separately, status unchanged: `BLOCKED_APPROVAL`).

---

## 9. Final recommendation

**Recommended target architecture:** `Web → Firebase Auth → authenticated TedBuy server API → server-side Supabase (service_role)`, for every operation in categories B, C, and D — which, per §2, is nearly everything. Category A (genuinely public data) stays server-mediated too, not because RLS couldn't theoretically allow it, but because the existing endpoints already do more (moderation filtering, caching) than a raw table grant ever would. **The browser should end this migration talking to Supabase for nothing at all** — `dbAdapter.ts`'s Supabase branch becomes dead code, not a smaller allow-list.

**Tables requiring migration work:** `users` (highest priority — bulk-read directory exposure fixed in checkpoint 1; registration/profile writes and the self-profile realtime subscription remain outstanding, still Phase 1/2), `products` (views/likes direct-write residual fixed in checkpoint 3, commit `33441f1`; `updateProduct()`'s adjacent social-only `dbAdapter` branch found but not yet closed, needs its own checkpoint), `chats`/`messages` (admin support-desk realtime), `store_names` (remaining write flows). `reviews`/`reports` are functionally done (just need the read-side hygiene migration for `reviews`). `boost_purchases`/`admin_audit_logs`/`account_deletion_audits` — ✅ done, unmapped entirely in checkpoint 2 (commit `aeba056`).

**Endpoints that need to be created:** ~~(1) products views/likes (anonymous-view + authenticated-self-toggle-like)~~ — ✅ done, checkpoint 3 (`33441f1`); (2) admin-only chats/messages support-desk read (polling), (3) message delete, (4) `store_names` write coverage for registration/Google-signup/migration flows, (5) closing `updateProduct()`'s adjacent social-only `dbAdapter` branch (found at checkpoint 3). Everything else already exists.

**Operations that can safely remain public:** none, in the sense of "direct anon-key Supabase access." Two tables' *content* (`products`, `reviews`) is genuinely public, but the recommendation is that content stays server-mediated regardless, for reasons unrelated to security (moderation filtering, caching) — see §4.3.

**Proposed RLS policy strategy:** default-deny on every table, zero policies, once Phases 0-3 are verified complete. No policy ever references `auth.uid()` — there is no Supabase Auth session to populate it (§5). RLS's entire job in this architecture is capping the anon key, not expressing per-user ownership; per-user ownership is and remains the server's job via `verifyUser()`.

**Rollout order:** Phase 0 (urgent, small, no functionality moves) → Phase 1 (writes) → Phase 2 (reads) → Phase 3 (confirm nothing needs to move backward) → Phase 5's test matrix run against a staging environment with RLS already flipped on there → Phase 4 (enable in production) → Phase 5 re-run against production. Verification comes both before and after the production flip, not just after.

**Rollback strategy:** because `service_role` always bypasses RLS, the server is never at risk — a rollback only ever means "the anon key can do more than intended again," which is exactly today's state. The safe rollback path is therefore: `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` per table (instant, reversible, no data risk — RLS is purely a read/write gate, not a schema or data change) if Phase 4 surfaces an unexpected regression Phases 0-3's verification missed, followed by fixing forward and re-enabling rather than staying disabled. Because Phases 0-3 already move all legitimate traffic off the anon key *before* Phase 4, a rollback at that point should only ever be needed for something Phase 5's test matrix failed to catch — the risk is front-loaded into the earlier, safer, easily-reversible phases, not into flipping the switch itself.

**Verification checklist** (expanded from §4's Phase 5 table): for each of the 10 tables — anon SELECT returns nothing; anon INSERT/UPDATE/DELETE rejected; every existing server endpoint still functions end-to-end for a real authenticated user; cross-user attempts via every migrated endpoint are rejected (403/404); admin-gated operations still work for a real admin and are still rejected for a real non-admin; `tsc --noEmit` and production build clean at every phase boundary, matching the discipline already established throughout the completed audit.

---

**Current state: Phase 0 is complete and Phase 1's `users`-table write migration is essentially complete**, both worked as a sequence of small, isolated, individually-reviewed checkpoints rather than large batches.

**Phase 0**: `94c3cc6` (item 1, users bulk PII leak), `33441f1` (item 2, products views/likes residual), `409d2f4` (item 3, notificationPreferences cross-user write), `aeba056` (item 4, three-table unmapping) — items 1 and 2 pending the reviewer's own live/manual verification, items 3 and 4 fully verified.

**Phase 1**: `7702c75` (checkpoint 5, `savedProductIds`), `1cf8e3e` (checkpoint 6, dead-code removal), `ab4afba` (checkpoint 7, `updateUserProfile`), `95cd5e6` (checkpoint 8, `messages` table), `87f647f` (checkpoint 9, registration/Google-signup/login/auth-sync) — all five fully verified, `store_names` write coverage resolved as a side effect of checkpoint 9.

**Deliberately deferred findings**, each documented at its own checkpoint rather than rushed or silently dropped: `updateProduct()`'s social-only `dbAdapter` branch (Phase 0 checkpoint 3); the store-name-index/`sellerName`-sync blocks inside `updateUserProfile` (checkpoint 7); `setupWelcomePackage`'s multi-table direct writes (checkpoint 8); `sendWelcomeEmailToAll`'s per-target `welcomeSent` write, which would need a new PATCH-style admin endpoint (checkpoint 9); and the genuinely highest-risk item in the whole document, `findAndMigrateExistingUser`'s account-migration merge (creates a document under a new id and deletes one under an old id in one operation — needs real server-side verification design before it can be safely migrated, not a quick fix).

No RLS, policy, grant, or schema change has been made at any point. Phases 2-5 remain not yet started. `messages`/`chats` admin support-desk realtime subscriptions (Phase 2) and the account-migration merge above are the next highest-value items.
