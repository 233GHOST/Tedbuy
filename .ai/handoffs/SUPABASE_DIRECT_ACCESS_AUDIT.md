# Supabase Direct-Access / RLS Migration Audit

**Status:** Read-only. No Supabase config, RLS, grants, `dbAdapter.ts`, `server.ts`, or client code changed.
**Trigger:** Vincent confirmed in the Supabase dashboard that RLS is currently **disabled** on the tables covered by `supabase_policies.sql`'s "quick fix" block. This document maps every direct client-to-Supabase code path so that re-enabling RLS can be planned without breaking the app.
**Scope covered:** entire repo (`src/`, `mobile/src/`, `server.ts`, `scripts/`, root-level admin scripts).

---

## 1. Direct Supabase clients found

| Client location | Key used | Classification | Notes |
|---|---|---|---|
| `src/dbAdapter.ts` | `VITE_SUPABASE_ANON_KEY` (browser) | **CLIENT** | The only production client-side Supabase client. Exports a Firestore-shaped API (`doc`, `collection`, `getDoc`, `getDocs`, `setDoc`, `updateDoc`, `deleteDoc`, `onSnapshot`, `writeBatch`) that transparently routes to either real Firestore or Supabase depending on `isSupabaseActive`. This is the entire subject of this audit. |
| `server.ts` (`backendSupabase`) | `SUPABASE_SERVICE_ROLE_KEY` (server env) | **SERVER** | Out of scope for this audit — already authorized via `verifyUser()`/`verifyAdmin()` in application code, as verified in the prior security-audit pass. Not affected by RLS in the same way (service-role bypasses RLS entirely by design). |
| `src/utils/sitemap.ts` | `SUPABASE_SERVICE_ROLE_KEY` (fallback: anon) | **SERVER** | Confirmed earlier this session: only ever runs server-side (sitemap generation), never bundled to the browser. |
| `scripts/migrate-firestore-to-supabase.ts` | Uses `createClient` directly — key source not re-verified this pass, but it's a **root-level, one-off CLI script**, not part of the built app | **SCRIPT/ADMIN** | Historical one-time Firestore→Supabase data migration tool. Not imported by `src/` or `server.ts`. Not part of the shipped web bundle. |
| `check_databases.ts` | `createClient` directly | **SCRIPT/ADMIN** | Root-level diagnostic script, run manually via `tsx`/`node`, not part of the build. |
| `mobile/src/*` | — | **N/A** | Confirmed: mobile has **no** `@supabase/supabase-js` dependency at all (checked `mobile/package.json` and grepped `mobile/src/` — zero hits). Every mobile data operation goes through `server.ts`'s authenticated `/api/*` endpoints. **Mobile is not part of this exposure.** |

**Bottom line: the exposure is web-only, entirely through `src/dbAdapter.ts`, consumed by exactly three files:** `src/context/AppContext.tsx`, `src/components/ChatInterface.tsx`, `src/components/ProfileSettings.tsx` — plus one unreferenced file, `src/utils/migration.ts` (see §6).

---

## 2. How `dbAdapter.ts` actually authorizes writes (it doesn't)

Read in full (1282 lines). The generic CRUD functions (`getDoc`, `getDocs`, `setDoc`, `updateDoc`, `deleteDoc`, `onSnapshot`) all resolve a Firestore-shaped path (e.g. `doc('products', someId)`) to a `{table, id}` pair via a static map (`VALID_TABLE_MAP`), then execute a generic `supabase.from(table).<op>().eq('id', id)`. Payloads are shaped/normalized (`transformForSupabaseClient`) and column-filtered against a hardcoded allow-list (`TABLE_COLUMNS`), but **column-filtering is not authorization** — it stops a request from writing an unknown column, not from writing to a row it shouldn't touch.

The **only** ownership-adjacent check anywhere in this file is a data-integrity guard (not an authorization guard): `setDoc`/`updateDoc` refuse to write an ID that looks like a `chat_`/`prod_`/`msg_`/`notif_`/`report_`/`rev_`-prefixed value into the `users` table (lines ~889-901, ~961-964). Nothing anywhere checks "does the currently-signed-in Firebase user actually own this row." That check exists **only** as Postgres RLS — which is confirmed off. So today, the sole thing preventing `updateDoc(doc('products', 'someone_elses_product_id'), {...})` — or a raw PostgREST request bypassing the app's UI entirely — from succeeding for **any** row in **any** mapped table is: nothing. `VALID_TABLE_MAP` covers `users`, `products`, `chats`, `messages`, `notifications`, `reviews`, `reports` (blocked — see below), `store_names`, `boost_purchases`, `admin_audit_logs`, `account_deletion_audits`.

- `reports` is in `VALID_TABLE_MAP` but **not** in `TABLE_COLUMNS` → `getDocPathInfo` nulls out the table for it → every `reports` operation via `dbAdapter` silently no-ops. Effectively unreachable through this path today (worth confirming there's no other write path to `reports`, out of scope here).
- `admin_audit_logs` and `account_deletion_audits` are reachable through the *exact same generic, unauthorized path* as everything else, but were **not** in the "disable RLS" list in `supabase_policies.sql`/`.md` (that list only named `users, products, chats, messages, reviews, notifications, store_names, boost_purchases`). **Their current RLS status is unverified — flagged under §11 UNKNOWN.** If they were never explicitly disabled, they may still be RLS-protected (or may never have had RLS enabled at all — Postgres tables default to RLS off unless someone ran `ENABLE ROW LEVEL SECURITY` on them). This needs a direct dashboard check, same as everything else — I have no way to confirm from the repo.
- Realtime: `onSnapshot` also opens a Supabase Realtime `postgres_changes` subscription (`event: '*'`, i.e. INSERT/UPDATE/DELETE) filtered by `id=eq.<id>` directly against the raw table. With RLS disabled, this broadcasts row-level changes to any subscriber, independent of the REST path above.

---

## 3. Complete operation inventory

Grouped by table, then by distinct purpose (the same table+operation shape recurs many times across different features — the goal here is complete *coverage*, not 88 near-identical rows for `users` alone). Every file that touches `dbAdapter` directly is covered; nothing found is omitted.

### `users`

| File | Purpose | Op | Auth context | Class | Existing API? | Status |
|---|---|---|---|---|---|---|
| `AppContext.tsx` (signup/login flow, ~932-3368) | Create/merge user doc on signup, Google sign-in, phone auth, admin impersonation seed, CEO-support-account bootstrap | SET/UPDATE/GET | Firebase-authenticated in-app, but **not** checked against the row being written | B | `/api/users/sync` exists | ACTIVE |
| `AppContext.tsx` (profile edit, ~1682-1799, 3528, 4762-4849, 5003) | Update own username, bio, notification prefs, `followingSellers`, `savedProductIds` | UPDATE | Same as above | B | `/api/users/sync` exists | ACTIVE |
| `AppContext.tsx` (account deletion, ~5159-5419) | Soft-delete cascade: null out/anonymize a user row, delete their store-name reservation, cascade-delete their products/reviews/chats/messages | UPDATE/DELETE (cross-table cascade) | Same | **C** (touches other rows the current user doesn't own by relation, though intent is self-deletion) | Partial — server has its own account-deletion endpoint (`/api/admin/accounts/...` is admin-only; a self-serve deletion endpoint's existence wasn't re-verified this pass) | ACTIVE — **highest-priority item to trace before touching RLS**, see §7 |
| `AppContext.tsx` (email-uniqueness lookup, ~1001-1067) | `query(collection('users'), where('email','==',...))`, and one full unfiltered `getDocs(collection('users'))` (~1067) | SELECT (bulk, unfiltered) | Public read intended (username/email dedupe check) | A (read) but **the unfiltered `getDocs(collection('users'))` at line 1067 selects `*`** — same over-fetch concern flagged for `/api/users/list` in the earlier security pass, just via the direct path instead | No — this is a client-side full-table scan | ACTIVE |
| `ProfileSettings.tsx` (~280) | **Self-diagnostic tool**: reads then writes `lastDiagnosticCheck` to the caller's own row, reports "SECURITY RULES PASS/REJECTED" based on whether the write succeeds | GET+SET (own row only) | Self-scoped by construction | B (but low risk — a caller can only ever target their own uid here) | N/A — it's a diagnostic, not a feature | ACTIVE. **Note:** this tool's "PASS" result is currently meaningless as a security signal, since it will "pass" for anyone regardless of real authorization, precisely because RLS is off. |

### `products`

| File | Purpose | Op | Class | Existing API? | Status |
|---|---|---|---|---|---|
| `AppContext.tsx` (~3510) | Create product locally after a local-first save | SET | B | `/api/products/sync` exists | ACTIVE |
| `AppContext.tsx` (~3977, updateProduct's optimistic path) | Update product fields (edits, boost fields, `isSold`) | UPDATE | B | `/api/products/sync` exists — **and `updateProduct()` in `AppContext.tsx` already calls both this direct path AND `/api/products/sync` for non-social-only edits** (confirmed earlier this session while fixing Mark as Sold) | ACTIVE, dual-write |
| `AppContext.tsx` (~3977 area) | Delete own product | DELETE | B | `/api/products/delete` exists | ACTIVE |
| `AppContext.tsx` (~1138-1139, account-merge cascade) | Bulk-reassign `sellerId` on every product belonging to a merged/duplicate account | UPDATE (bulk, `where` query) | C (cross-account) | No direct equivalent found | ACTIVE — rare path (account merge), still real |
| `AppContext.tsx` (~5031, username change) | Update `sellerName` on every product the current user owns, after a username change | UPDATE (bulk) | B | No direct equivalent found (server has no "cascade-rename seller across their own listings" endpoint) | ACTIVE |
| `AppContext.tsx` (~5247, account deletion cascade) | Delete every product owned by the deleted account | DELETE (bulk) | C | Partial | ACTIVE |

### `chats` / `messages`

| File | Purpose | Op | Class | Existing API? | Status |
|---|---|---|---|---|---|
| `AppContext.tsx` (~2146-2213, support chat bootstrap) | Create/read the CEO-support chat and its messages | GET/SET | B | `/api/chats/start` exists | ACTIVE |
| `AppContext.tsx` (~4182-4315, `startChat`) | Create a new chat + first message + notification | SET (3 tables in sequence, not transactional) | B/C | `/api/chats/start` exists | ACTIVE, dual-write |
| `AppContext.tsx` (~4529-4538, `sendMessage`) | Send a message, update chat's `lastMessageText`/`lastMessageTime` | SET+UPDATE | **C** (message content is private) | `/api/messages/send` exists | ACTIVE, dual-write |
| `AppContext.tsx` (~4594-4626, mark-read) | Mark messages as read | UPDATE (bulk `where`) | B | `/api/messages/mark-read` exists | ACTIVE |
| `AppContext.tsx` (~4690-4735, trade-status system messages) | Update chat trade status, insert a system message | UPDATE+SET | B | `/api/chats/mark-delivered` / `/api/chats/mark-picked-up` exist | ACTIVE, dual-write |
| `AppContext.tsx` (~4745-4750, account-deletion cascade) | Delete a user's chats and messages | DELETE (bulk) | C | Partial | ACTIVE |
| `AppContext.tsx` (~4757-4760, `resetChats`) | **Deletes every chat and message the current session has loaded, in a loop** — reads as a sandbox/dev-reset utility, not a normal user action | DELETE (bulk) | **C — needs verification of whether this is reachable from any real UI button or is dev-only** | N/A | **UNKNOWN — see §11, needs UI-trace before RLS work** |
| `ChatInterface.tsx` (~359) | Typing-indicator presence | GET (Realtime) | Ephemeral — routes to `chat_typing`, which `dbAdapter` special-cases as **in-memory + Realtime broadcast only, never touches a real Postgres table** | N/A — not a real table | ACTIVE, but **not part of the RLS exposure at all** (confirmed: `isEphemeralPath('chat_typing')` short-circuits before any `supabase.from()` call) |

### `notifications`

| File | Purpose | Op | Class | Existing API? | Status |
|---|---|---|---|---|---|
| `AppContext.tsx` (multiple: ~1799-1835, 3584-3871, 4315, 4529, 4795) | Create a notification (new follower, new message, new listing from followed seller, etc.); mark read; mark all read; delete all | SET/UPDATE/DELETE | **C** (a notification belongs to one specific `userId` — this is private-ish, and there's no per-row check that the caller IS that `userId`) | No dedicated `/api/notifications/*` endpoint found this pass | ACTIVE — **no server equivalent exists yet; needs a new endpoint before migrating (Phase 2 item)** |

### `reviews`

| File | Purpose | Op | Class | Existing API? | Status |
|---|---|---|---|---|---|
| `AppContext.tsx` (~5266, account-deletion cascade) | Delete reviews written by/about a deleted account | DELETE (bulk) | C | Not re-verified this pass whether `server.ts` has a reviews endpoint at all | ACTIVE — **needs a dedicated look; reviews weren't covered in the earlier server.ts security pass** |

*(No other `AppContext.tsx`/`ChatInterface.tsx`/`ProfileSettings.tsx` call site touches `reviews` directly — review creation itself wasn't found going through `dbAdapter` in this trace; it may go exclusively through a server endpoint already, or may not exist as a client-writable flow at all. **Flagged UNKNOWN — needs its own trace**, out of the time budget for this pass.)*

### `store_names` (mapped from the legacy path name `storeNames`)

| File | Purpose | Op | Class | Existing API? | Status |
|---|---|---|---|---|---|
| `AppContext.tsx` (~1043-1463, 2630, 5013-5361) | Reserve/release a username's store-name slot on signup, username change, and account deletion | GET/SET/DELETE | B | No dedicated endpoint found | ACTIVE |

### `boost_purchases`

**Not found referenced anywhere in `AppContext.tsx`, `ChatInterface.tsx`, or `ProfileSettings.tsx`.** It's in `dbAdapter.ts`'s `VALID_TABLE_MAP`/`TABLE_COLUMNS`, so the *pipe* exists and would accept a write if something called it — but no current client code appears to call it. Boost activation, per the earlier security-audit pass, goes entirely through `/api/verify-payment` server-side. **Classified UNKNOWN/DEAD from the client side** — the table is reachable in principle through `dbAdapter`'s generic path (nothing blocks a hand-crafted `setDoc(doc('boost_purchases', ...), ...)` call or a raw PostgREST request), but no in-app trigger for it was found.

### `admin_audit_logs`, `account_deletion_audits`

Present in `dbAdapter.ts`'s table map with full column allow-lists, but **no call site found** in any of the three consumer files. These appear to be written exclusively from `server.ts` (using `backendSupabase`, the service-role client) in the flows already reviewed in the earlier security audit (impersonation logging, security-hold audit trail). **The client-side pipe exists but appears unused** — still worth confirming their live RLS status independently (see §2) since "unused by our own UI" doesn't mean "unreachable by a direct PostgREST request with the anon key."

---

## 4. `scripts/migrate-firestore-to-supabase.ts` and `check_databases.ts`

Both are root-level, `tsx`/`node`-run CLI scripts, not imported by `src/` or bundled into the Vite build, not reachable from the running app. **SCRIPT/ADMIN** classification confirmed. Not part of the live client-exposure surface — they matter only if someone runs them manually against production, which is a human/process control, not a code-level one. No action needed as part of an RLS migration; flagging only for completeness.

---

## 5. `src/utils/migration.ts` — dead code

Exports `migrateProductToSupabase` and `isProductMigrated`. **Zero importers found anywhere in `src/`** (checked both relative-path imports and direct function-name references). This is very likely a leftover one-time Firestore→Supabase product-migration helper from before the current architecture, never wired to any UI action. Given no reachable call site, it should not affect RLS planning either way — but it does directly call `supabase.from('products').upsert(...)` / `.select(...)`, so **if it were ever wired up again, it would need the same migration treatment as everything else below.** Not recommending deletion in this pass (out of scope — read-only), just flagging as dead weight, same spirit as the Vercel audit.

---

## 6. What would break if RLS were enabled tomorrow, exactly as written in `supabase_policies.sql`

**Everything that writes.** The "strict" policies in that file gate `INSERT`/`UPDATE` on `auth.uid()::text = id` (or `= "sellerId"`). Since these connections authenticate as Firebase users but talk to Supabase with the shared `anon` key, `auth.uid()` is **always `NULL`** for every single request from `dbAdapter.ts` — there is no Supabase Auth session backing any of these calls. So:

- Every `setDoc`/`updateDoc`/`deleteDoc` call cataloged in §3 as Class B or C would start failing with a Postgres/PostgREST permission-denied error, **the instant RLS is turned on with those exact policies** — not a hypothetical, this is exactly the failure mode `supabase_policies.md`'s own warning describes, and exactly why the "disable RLS" runbook exists in the first place.
- The `SELECT ... USING (true)` public-read policies (on `users`, `products`) would keep working, since anonymous reads were designed to be public.
- `chats`, `messages`, `notifications`, `store_names`, `boost_purchases`, `admin_audit_logs`, `account_deletion_audits` have **no policies written at all** in `supabase_policies.sql` beyond the disable-block — turning RLS on for these with zero policies defined makes Postgres deny **all** access by default (RLS's fail-closed default), including reads, which would break e.g. the chat-typing Realtime path and anything else touching them, not just writes.

**Conclusion: RLS cannot simply be "turned back on" — every currently-ACTIVE write path in §3 needs either (a) migration to an authenticated server endpoint first, or (b) a real RLS policy design that doesn't depend on `auth.uid()` (since Supabase Auth isn't in use at all).**

---

## 7. Security priority: can the client currently modify another user's data?

**Yes, with no code-level check preventing it — nothing in `dbAdapter.ts` verifies the caller owns the row being written.** The only thing standing between "any signed-in user" (or, since this is a public anon key, technically anyone with devtools open and zero authentication) and writing to **any other user's** `users`/`products`/`chats`/`messages`/`notifications`/`store_names` row is Postgres RLS — confirmed disabled. This is a source-code-only conclusion; I have not attempted to verify it by actually issuing a cross-user request against production, per the instruction not to test this live.

The single most concerning concrete example found: **account deletion's cascade delete** (`AppContext.tsx` ~5247-5419) deletes products/reviews/chats/messages by iterating rows fetched for a `userId` — this code path is *supposed* to only ever run for the currently-authenticated user deleting their own account, but nothing in `dbAdapter` enforces that the `userId` passed in is actually `currentUser.id`. If that value were ever attacker-controlled (e.g., a bug elsewhere passed the wrong id, or a malicious actor called the underlying function directly via devtools with an arbitrary uid), it would delete a different real user's entire account data with the app's own blessing, no RLS needed to stop it because none currently exists. This needs its own careful trace of every caller of the deletion function before RLS work begins, not just at the `dbAdapter` layer.

---

## 8. Comparison against existing server APIs

| Direct operation | Existing authenticated API | Migration path |
|---|---|---|
| User profile create/update | `/api/users/sync` | Use existing API |
| Product create/update/delete | `/api/products/sync`, `/api/products/delete` | Use existing API (already dual-written in most places) |
| Chat start | `/api/chats/start` | Use existing API |
| Message send | `/api/messages/send` | Use existing API |
| Message mark-read | `/api/messages/mark-read` | Use existing API |
| Chat mark-delivered/picked-up | `/api/chats/mark-delivered`, `/api/chats/mark-picked-up` | Use existing API |
| Notifications (create/read/delete) | **None found** | New endpoint needed |
| Store-name reservation | **None found** | New endpoint needed |
| Bulk seller-name rename across own products | **None found** | New endpoint needed (or fold into `/api/users/sync`) |
| Account-deletion cascade (products/reviews/chats/messages/store-name) | Partial — admin-side deletion endpoints exist; a *self-serve* full cascade wasn't reverified this pass | Needs confirmation + likely a dedicated endpoint |
| Bulk `sellerId` reassignment on account merge | **None found** | New endpoint needed (rare path, lower priority) |
| Email-uniqueness / full `users` table scan | `/api/users/list` exists but returns a different (safer, narrower) shape | Migrate to a purpose-built "check email availability" endpoint rather than reusing `/api/users/list`'s bulk shape |
| Reviews delete (cascade) | **Unverified — reviews weren't covered in the earlier server-side audit at all** | Needs its own investigation before Phase 1 |
| `boost_purchases` | No client call site found; server owns this via `/api/verify-payment` | No migration needed — already server-only in practice |

---

## 9. Minimum safe migration plan

### Phase 1 — already has a server API, migrate immediately, no new endpoints needed
- Product create/update/delete (`updateProduct`/create/delete paths in `AppContext.tsx`) — already dual-writing to `/api/products/sync`/`delete`; the fix here is *removing the direct-Supabase half* of the dual-write, not adding anything.
- Chat start, message send, message mark-read, chat mark-delivered/picked-up — same dual-write pattern, same fix.
- User profile update (non-admin fields) — via `/api/users/sync`.

### Phase 2 — needs a small new authenticated endpoint before migrating
- Notifications (create own-triggered, mark read, mark all read, delete all) — needs `/api/notifications/*`, scoped to `verified.uid`.
- Store-name reservation/release — needs `/api/store-names/*` or folding into `/api/users/sync`.
- Seller-name cascade rename across a user's own products on username change — small addition, likely folds into `/api/users/sync`'s existing product-touching logic.
- Email-availability check — a narrow, purpose-built endpoint (not a full user-table dump).

### Phase 3 — needs an architectural decision, not just an endpoint
- **Account-deletion cascade** — this touches five tables across a whole account's history; needs a single, careful, transactional (or explicitly-ordered-and-idempotent) server-side deletion flow, not a client loop issuing five kinds of direct deletes. Given it's also flagged in §7 as the highest-risk finding, this should be designed and reviewed before anything else in this migration, even though it's technically "Phase 3" scope.
- Bulk `sellerId` reassignment on account merge — rare, admin-adjacent; can likely move behind an admin endpoint.
- `AppContext.tsx`'s `resetChats` — needs a UI-trace to confirm whether it's reachable at all before deciding if it needs migrating or can simply be deleted as dev-only debt.

### Public reads (Class A) — may legitimately remain public once real policies are designed
- `products` and `users` `SELECT ... USING (true)` — matches the marketplace's actual intent (anyone can browse listings and view seller profiles). These can stay public **once RLS is re-enabled with exactly these read policies and nothing else** — the danger today isn't the reads, it's that writes are equally unrestricted.

### Dangerous operations — must be migrated (or explicitly, narrowly policy-gated) before RLS can safely go back on
- Everything in Phase 1 and 2 above, plus the account-deletion cascade in Phase 3. Until each of these either goes exclusively through a server endpoint, or Supabase Auth is properly wired up so `auth.uid()` isn't always `NULL`, turning RLS on will either (a) break real functionality (if policies are correct-and-strict) or (b) accomplish nothing (if policies are written permissively enough to keep working, which just re-creates today's problem under a different name).

---

## 10. Realtime subscriptions — a separate but related concern

`onSnapshot` on both a single doc and a query/collection opens a Supabase Realtime channel subscribed to raw `postgres_changes` on the underlying table. This means: even after every *write* path above is migrated to authenticated server endpoints, if any `onSnapshot`-based **read/subscribe** call sites remain pointed at `dbAdapter` (I did not fully catalog every `onSnapshot` call site with the same table-by-table rigor as the write paths, given the time budget for this pass — see §11), RLS's read policies need to be correct for Realtime too, not just for one-off `SELECT`s, since Realtime enforces the same RLS as REST reads.

---

## 11. UNKNOWN / NEEDS INVESTIGATION (explicit, not glossed over)

1. **`admin_audit_logs` and `account_deletion_audits` current live RLS status** — never appeared in the "disable RLS" list, so their status is not implied by anything in this repo. Needs a direct dashboard/SQL check, same method Vincent already used for the other 8 tables.
2. **`AppContext.tsx`'s `resetChats` (~4745-4750)** — deletes all loaded chats/messages in a loop. Not traced to a UI trigger in this pass. Needs a search for what calls this function and whether it's reachable outside a dev/admin-only surface.
3. **Reviews — creation path** — no client-side review-creation call site was found going through `dbAdapter`, only the account-deletion cascade's *delete*. Either review creation goes through a server endpoint not yet identified, or this needs a dedicated trace. Also: `server.ts`'s reviews authorization (does `/api/reviews/*` exist, and is it authorized correctly?) was **not** covered in the earlier security-audit pass at all — flagging as a gap in that audit too.
4. **Self-serve account deletion's actual server-side equivalent** — the earlier security pass only reviewed *admin*-triggered account actions (`security-hold`, `accounts/deleted`). Whether a normal user's own "delete my account" button already has a proper authenticated single endpoint, or relies partly/wholly on the direct-Supabase cascade in `AppContext.tsx`, needs its own trace before Phase 3 design work starts.
5. **Full `onSnapshot` read-path inventory** — this document rigorously covers every *write* (`setDoc`/`updateDoc`/`deleteDoc`) call site, but did not exhaustively re-verify every `onSnapshot`/`getDocs` *read* call site against the same table-by-table depth (several are covered incidentally in §3, but a few large `AppContext.tsx` sections with real-time listeners for `chats`/`notifications` lists were referenced in this session's broader context and deserve a dedicated re-check before finalizing which read policies Phase design needs).
6. **`reports` table** — confirmed unreachable via `dbAdapter` (nulled out before any Supabase call), but not verified whether `server.ts` has its own `/api/reports` write path that this was originally meant to parallel.

---

## 12. UPDATE — Account-deletion cascade trace + reviews audit (second pass)

This section resolves the §11 items on `resetChats`, the self-serve account-deletion path, and reviews — and surfaces a **new, more severe finding than the original RLS gap**: a real client-side privilege-escalation path that doesn't even require RLS to stay off to matter for two specific admin functions, though RLS being off is what makes the first stage of the chain possible.

### 12.1 `deleteAccount()` (self-serve) — CLEARED, not vulnerable

Traced in full (`AppContext.tsx:5041-5109`). This function does **not** use `dbAdapter`'s direct-Supabase cascade at all. It calls `POST /api/auth/delete-account` with a real Firebase ID token; everything else it does is local React-state/`localStorage` cleanup (marking the user's own products archived *in the browser's own copy of state*, not a database write). The server endpoint (`server.ts:6298`) is properly built: `verifyUser()`-gated, and — critically — it uses `verified.uid` (cryptographically derived from the Firebase token) throughout, **never a client-supplied user id**. A user cannot use this path to affect any account but their own. **No issue found here.**

### 12.2 `adminDeleteUserProfile(userId, forceDeleteActive)` — CONFIRMED VULNERABLE

Traced in full (`AppContext.tsx:5181-5378`). Concretely, for the target `userId` (an arbitrary string, caller-supplied — no cryptographic binding to anything):

| Step | What it deletes | How |
|---|---|---|
| 1 | Every `products` row where `sellerId === userId` (both from local `products` state AND a live `where('sellerId','==',userId)` query, so it's not limited to what happens to already be loaded) | `deleteDoc` per row, direct to Supabase |
| 2 | Every `reviews` row where `buyerId === userId` OR `sellerId === userId` | Same pattern |
| 3 | Every `chats` row where `buyerId === userId` OR `sellerId === userId` | Same pattern |
| 4 | Every `messages` row where `senderId === userId`, `recipientId === userId`, or belonging to one of the just-deleted chats | Same pattern |
| 5 | A `deletedEmails` blocklist row (silently no-ops — `deletedEmails` isn't in `VALID_TABLE_MAP`, so this line has never actually done anything; not a security issue, just dead code noted in passing) | — |
| 6 | The `users` row itself **and** the matching `store_names` reservation, via `writeBatch` | Direct to Supabase |

**Authorization for all of this: exactly one client-side check**, at the top of the function:
```js
const isSuperAdmin = (currentUser?.email === 'asumaduvincent7@gmail.com') || ... || currentUser?.isAdmin || originalAdminUser?.isAdmin;
if (!currentUser || !isSuperAdmin) { throw new Error("Unauthorized: ..."); }
```
`currentUser` is a plain React state object, populated from a Supabase row fetch. **No server call verifies admin status before this cascade runs.** Compare this to `adminToggleSecurityHold` (`AppContext.tsx:5465`, traced in the same pass), which has the *identical* client-side gate but then calls the real `POST /api/admin/accounts/security-hold` endpoint — which independently re-verifies admin status server-side via `verifyUser()`. That's the correct pattern, proving it was known and done properly elsewhere in the same file; `adminDeleteUserProfile` and `adminToggleUserSuspension` (`AppContext.tsx:5393`, same issue — direct `updateDoc`/raw `supabase.from('users').update()` calls, no server round-trip) simply never got the same treatment.

**Real UI exposure confirmed** — this isn't dead code behind an unreachable gate: `ProfileSettings.tsx:3277` calls `adminDeleteUserProfile(targetId, true)` from what is a real button in the live admin panel of the Settings screen.

### 12.3 The privilege-escalation chain that makes this exploitable by *anyone*, not just a compromised admin

This is the part that elevates the finding beyond "an admin function isn't defense-in-depth." Two things compound:

1. **`isAdmin` is a plain, client-writable column.** `dbAdapter.ts`'s `TABLE_COLUMNS.users` allow-list includes `isAdmin`. Nothing in `dbAdapter` (or anywhere else client-side) stops a request from setting it. `transformFromSupabase` only *forces* `isAdmin: true` for the hardcoded super-admin email — for every other email, whatever value is already sitting in the row (including one the row's own owner wrote there themselves) passes through untouched.
2. **Verifying this requires no app code at all.** With RLS off, a direct `PATCH` to Supabase's own REST endpoint — `https://<project>.supabase.co/rest/v1/users?id=eq.<own-uid>` with header `apikey: <the public anon key, sitting in the shipped JS bundle>` and body `{"isAdmin": true}` — succeeds. This bypasses `dbAdapter.ts`, `AppContext.tsx`, and TedBuy's own frontend entirely; it only needs the public anon key and the (equally public, inferrable from `TABLE_COLUMNS`/`supabase_policies.sql` if someone reads the open-source-shaped client bundle) table/column names.

**Concrete attack scenario:**
1. Create a normal, free TedBuy account (or use an existing one). No special privilege needed.
2. Issue one authenticated-to-Supabase-only (not TedBuy) REST call setting that account's own `users.isAdmin` to `true`.
3. Reload the TedBuy web app. `AppContext`'s normal profile-fetch (`getDoc(doc('users', uid))`) reads the row back, `currentUser.isAdmin` is now `true` in the browser session. This requires **no PIN, no second factor** — `adminDeleteUserProfile` and `adminToggleUserSuspension` don't check `isAdminSessionVerified` at all (only `sendWelcomeEmailToAll` does, and even that gate is separately broken — see 12.4).
4. The admin panel in `ProfileSettings.tsx` becomes reachable in the UI (gated on the same `currentUser.isAdmin`). The attacker can now: hard-delete any other user's entire account (products, reviews, chats, messages, store name, profile — §12.2), or suspend/unsuspend any user (`adminToggleUserSuspension`, same pattern, same missing server round-trip).

**Impact:** full account-deletion / suspension capability against any user, for the cost of one unauthenticated-to-TedBuy REST call. This is strictly worse than "RLS is off" alone — it's a complete authorization-bypass chain, and it would remain partially exploitable even after RLS is re-enabled on the *other* tables, unless `users.isAdmin` writes are specifically locked down (self-service profile updates should never be able to touch that column) and `adminDeleteUserProfile`/`adminToggleUserSuspension` are migrated to call real server endpoints the way `adminToggleSecurityHold` already correctly does.

### 12.4 Bonus finding, same investigation: the admin PIN gate is also not real

`verifyAdminPIN` (`AppContext.tsx:3278`) — the second-factor gate meant to set `isAdminSessionVerified` — is entirely client-side JavaScript:
```js
const customPin = (import.meta as any).env.VITE_ADMIN_PIN || '2330';
const isValid = trimmed === customPin.trim() || trimmed === '2330';
```
Two problems, independent of the RLS/isAdmin issue above: (a) `VITE_ADMIN_PIN` is Vite's client-bundling prefix — if set, it ships in the JS bundle, readable by anyone; (b) **`'2330'` always works as a hardcoded fallback, regardless of what the real PIN is configured to.** There is no server call anywhere in this function — it cannot be, since it's pure string comparison against client-visible values. This means even a hypothetical world where `isAdmin` couldn't be spoofed, the PIN "second factor" adds no real security today. (As noted in 12.3, this doesn't even matter for `adminDeleteUserProfile`/`adminToggleUserSuspension` specifically, since neither checks `isAdminSessionVerified` at all — but it's a real, separate gap for whatever *does* rely on it, e.g. `sendWelcomeEmailToAll`.)

### 12.5 Reviews — audited end-to-end, CREATE is clean, no UPDATE exists, DELETE shares the admin-cascade issue

- **Create**: `addReview()` (`AppContext.tsx:5521`) — already fully server-mediated via `POST /api/reviews/create`, no direct-Supabase path. The server endpoint (`server.ts:3898`) is well-built: real `verifyUser()` auth, rejects self-review, requires a `chatId` that must resolve to a chat where the caller is a genuine participant (`getChatIfParticipant`) with `tradeStatus === 'completed'`, derives `productTitle` from the chat rather than trusting the client, and enforces one review per buyer/seller/trade server-side (not just hidden in the UI). The code's own comment documents that this used to be a direct, unauthenticated write and was already fixed in an earlier round — consistent with what this audit found elsewhere (the codebase generally *does* fix these when found; this specific class just hasn't been swept end-to-end until now). **No issue found.**
- **Update**: no code path exists anywhere — client or server — for editing an existing review. Nothing to secure because the feature doesn't exist.
- **Delete**: the only review-delete path is inside `adminDeleteUserProfile`'s cascade (§12.2) — same vulnerability, same root cause, no separate issue.
- **Ownership**: `server.ts`'s `/api/reviews` GET is a public read (`sellerId` query param, `SELECT ... WHERE sellerId = ?`) — appropriate for a public reviews-on-a-store-page feature, matches Class A (public read) from §3's framework.

### 12.6 §11 items resolved by this pass

- **`resetChats` reachability**: not fully resolved — searched for callers within the time budget of this pass and did not find one wired to a visible UI button (unlike `adminDeleteUserProfile`, which has a confirmed real caller). Likely dev/sandbox-only, but I'm not marking this CLEARED without a caller-search as rigorous as §12.2 got. Still UNKNOWN, lower priority than 12.2/12.3 given no confirmed UI trigger.
- **Self-serve account deletion's server equivalent**: RESOLVED — see §12.1, confirmed safe.
- **Reviews creation/authorization**: RESOLVED — see §12.5, confirmed safe.
- **`admin_audit_logs`/`account_deletion_audits` RLS status**: still UNKNOWN — unchanged from the first pass, still needs a direct dashboard check.
- **Full `onSnapshot` read-path inventory**: still not exhaustively re-covered — unchanged from the first pass.

---

## Summary for the handoff

Nothing was changed. This document is the complete map requested, now including a second pass that found a more severe, distinct issue: a real privilege-escalation chain (§12.3) allowing any authenticated-to-Supabase actor to grant themselves admin rights and then hard-delete or suspend any other user's account, via two specific `AppContext.tsx` functions that skip the server-round-trip pattern used correctly elsewhere in the same file. This is fixable independently of the broader RLS re-enablement work (§9's phased plan), and arguably should be prioritized ahead of it given the severity — that's Vincent's call. The next decision is Vincent's: approve Phase 1 of the RLS migration (lowest-risk, already has APIs), commission the still-open §11/§12.6 unknowns, and/or prioritize the §12.3 privilege-escalation fix specifically.
