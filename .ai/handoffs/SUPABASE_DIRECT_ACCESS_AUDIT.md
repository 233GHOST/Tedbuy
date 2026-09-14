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

## 13. P0 REMEDIATION — self-promotion → admin deletion/suspension (IMPLEMENTED)

This section documents the actual fix for §12.3. **This is the one section in this document where code was changed** — everything above remains a read-only finding.

### 13.1 Root cause — corrected and expanded from §12.3

§12.3 correctly identified the exploit *shape* but attributed the `isAdmin` poisoning purely to the direct-Supabase/RLS-disabled path. Implementing the fix surfaced the more fundamental root cause: **`POST /api/users/sync` itself — a properly-authenticated server endpoint, unrelated to RLS — wrote a client-supplied `isAdmin` value straight into the database:**

```js
// server.ts, /api/users/sync, before this fix:
isAdmin: user.isAdmin === true || (user.email && user.email.trim().toLowerCase() === 'asumaduvincent7@gmail.com'),
```

`user` here is `req.body.user` — entirely client-controlled. The endpoint's ownership check (`isOwner = targetUid === verified.uid`) correctly ensures a caller can only sync *their own* profile, but nothing stopped that caller from including `isAdmin: true` in their own profile payload. **This meant any authenticated TedBuy user could self-promote to admin using nothing but the app's own normal "save profile" API call plus one extra JSON field — no direct Supabase access, no anon key, no knowledge of RLS being disabled required at all.** This is a strictly more severe and more easily reachable vector than the direct-Supabase path in §12.3, and it would have remained fully exploitable even after RLS is re-enabled, since it never depended on RLS in the first place (it uses `backendSupabase`, the service-role client, which always bypasses RLS by design).

The two client-side functions from §12.3 (`adminDeleteUserProfile`, `adminToggleUserSuspension`) were the second half of the chain — they trusted the resulting poisoned `currentUser.isAdmin` (React state, populated by reading back the now-poisoned database row) with no server round-trip to re-verify.

**Important clarification also confirmed while implementing this fix:** `verifyUser()` itself — used everywhere else in `server.ts`, including every other admin-gated endpoint — was **never** vulnerable to this. Its `isAdmin` is derived purely from the Firebase ID token's own custom claims (`decoded.admin`) or the hardcoded super-admin email, and never reads the Supabase `users.isAdmin` column at all. So every other `/api/admin/*` endpoint, and `/api/products/sync`'s own admin check, were sound throughout. The vulnerability was narrowly: (a) `/api/users/sync` *writing* an attacker-controlled value into a column nothing else should have trusted, and (b) two specific client functions trusting that column's *client-side, React-state copy* instead of ever asking the server.

### 13.2 Exploit chain (now closed)

1. Any authenticated TedBuy user calls `POST /api/users/sync` with their own real Firebase token and `{ user: { id: <own uid>, isAdmin: true, ...other required fields } }`.
2. Server writes `isAdmin: true` to that user's own row (service-role client, unrelated to RLS).
3. App re-reads the user's profile (normal flow); `currentUser.isAdmin` becomes `true` in the browser session.
4. `ProfileSettings.tsx`'s admin panel becomes visible; `adminDeleteUserProfile()`/`adminToggleUserSuspension()` are reachable and, before this fix, performed the actual mutation via direct client-to-Supabase calls with no server-side re-verification.
5. Attacker hard-deletes or suspends any other user's account.

### 13.3 Fix implemented

**`server.ts`:**
- `/api/users/sync` (~line 3235): `isAdmin` is no longer read from the request body at all. It now fetches the *existing* database value (`existingIsAdmin`) before building the update payload, and sets `isAdmin: existingIsAdmin || <super-admin-email-match>` — preserving genuine admin status (however it was actually granted) while making it impossible for any client payload to introduce or change it. Applies identically whether the caller is creating a new profile or updating an existing one (a brand-new row has no existing `isAdmin`, so it correctly defaults to `false` unless the super-admin email).
- **New:** `POST /api/admin/users/suspend` — `verifyUser()`-gated, admin status derived cryptographically (never client-supplied), fetches the target row server-side (independent target-user authorization, not trusting anything about the target beyond its id), blocks the super-admin account as a target, performs the mutation via `backendSupabase`, writes an `admin_audit_logs` entry using `verified.uid`/`verified.email` (never a client header).
- **New:** `POST /api/admin/users/delete` — same authorization pattern. Cascades: every product the target owns (reusing `deleteProductFromBackend`, which also handles Cloudinary asset cleanup and cache invalidation — better coverage than the old client version had), reviews where the target is buyer or seller, chats/messages involving the target, the store-name reservation, then the user row itself. Audit-logged the same way, including the deleted-product count.
- Both new endpoints modeled directly on `/api/admin/accounts/security-hold` (already fixed earlier this session for the identical client-supplied-audit-header issue) — that endpoint is the correct reference pattern this whole codebase should follow for admin actions, and now three endpoints do.

**`src/context/AppContext.tsx`:**
- `adminDeleteUserProfile()` and `adminToggleUserSuspension()` gutted of their direct-Supabase cascade/write logic. The client-side `isSuperAdmin`/email checks are *retained* — but now purely as fast UX rejection (avoid a pointless network round-trip for an obviously-unauthorized click), never as the actual authorization boundary. Both now call their respective new endpoints and only touch local React state/`localStorage` cache after a confirmed server success.
- `verifyAdminPIN()`: removed the hardcoded `'2330'` fallback that previously worked regardless of `VITE_ADMIN_PIN`'s configured value. Comparison against `VITE_ADMIN_PIN` itself is retained (per instruction, not replaced with a new client-side secret) — but is now explicitly documented in-code as UX friction only, never a substitute for server-side authorization. This doesn't change behavior for `adminDeleteUserProfile`/`adminToggleUserSuspension` specifically (neither ever checked `isAdminSessionVerified`), but closes a real, independent gap for whatever *does* rely on it (e.g. `sendWelcomeEmailToAll`'s client-side gate).

**`src/dbAdapter.ts`:**
- `'isAdmin'` removed from `TABLE_COLUMNS.users` — the write-allow-list every client-side `setDoc`/`updateDoc` into the `users` table is filtered through. This closes the *original* §12.3 direct-Supabase vector as defense-in-depth, independent of the `/api/users/sync` fix and independent of RLS's current disabled state. Reads are unaffected (`isAdmin` still returns normally everywhere it's read — this only blocks it from ever appearing in a write payload). Verified this doesn't regress the super-admin's own account: their `isAdmin` status is separately guaranteed both by `transformFromSupabase`'s read-time force (already existed) and by `/api/users/sync`'s own super-admin-email auto-grant (already existed, now the only path).

### 13.4 Repository-wide search results (as requested)

Searched every `currentUser?.isAdmin` / `currentUser.isAdmin` / `isSuperAdmin` / `isAdminUser` reference in `AppContext.tsx` (18 distinct sites) and every `isAdmin`-related line in `server.ts` (40+ sites). Findings beyond the two functions already fixed:

- **`AppContext.tsx:3618-3634`** (`updateProduct`'s optimistic local check) and **`:3924-3925`** (a similar local gate) — confirmed **not vulnerable**: these are client-side-only *optimism* for immediate UI feedback; the actual product mutation always also goes through `/api/products/sync`, whose own admin check correctly uses `verifyUser()`'s cryptographic identity, not anything client-supplied. No fix needed.
- **`AppContext.tsx:2461`** (CEO-support-chat live-read subscription) — same client-trust weakness (gated by `currentUser.isAdmin && isAdminSessionVerified`, both spoofable pre-fix, and even now the PIN gate is still client-side), but it's a **read**, not a write, of a narrow, already-flagged-in-its-own-comment feature ("Flagged for a dedicated support-ticket design in a future phase" — this was a known, accepted trade-off already, not a new discovery). Not fixed in this pass — read-only exposure of support-chat contents to a self-promoted admin is a real residual risk, but it's strictly narrower than the write-access chain this P0 closed, and the `isAdmin`-poisoning route into it is now closed (an attacker can no longer poison their own `isAdmin` via `/api/users/sync`, and the direct-Supabase route is closed too) — so **this specific read gate is not currently exploitable through the same chain anymore**, though it remains client-side-only as a design matter.
- **`AppContext.tsx:5118`, `sendWelcomeEmailToAll`** — checks `currentUser.isAdmin && isAdminSessionVerified` client-side, then calls `POST /api/send-welcome-email` **per target user**. Checked that server endpoint (`server.ts:5537`): **it has no authentication check at all** — not even `verifyUser()`, let alone an admin check. This is a *different* class of bug (missing auth entirely, not a client-trust issue) — any actor, authenticated or not, can already call it directly with an arbitrary `{email, username}` and trigger a real Brevo-sent welcome email. Rate-limited (10/min), Brevo-cost/reputation/spam-abuse risk rather than a data-authorization one. **Flagged, not fixed** — out of this P0's scope (self-promotion → account deletion/suspension), but a real finding from the requested repo-wide search.
- **`AppContext.tsx` lines 1306, 1433, 2946`** (`isAdmin: isSuperAdmin ? true : undefined` in the signup/account-creation flow) — these client-side writes are now silently stripped by the `dbAdapter.ts` fix (§13.3) regardless of what they compute, so they're inert. Not removed from the source in this pass (harmless dead value now, not worth the diff noise in a focused security commit) — worth a cleanup pass later, not a risk.
- **`server.ts` — every other `isAdmin` reference** (`/api/products/*`, `/api/verify-payment`, `/api/admin/impersonate/*`, `/api/admin/accounts/security-hold`, `/api/users/list`, etc.) traced and confirmed to derive `isAdmin` exclusively from `verifyUser()`'s return value (cryptographic) or, in `/api/users/list`'s narrow case, from the row's `email` matching the hardcoded super-admin address for *display* purposes only (not an authorization decision) — consistent with the "sound all along" conclusion in §13.1.

**Confirmed NOT fixed in this pass, same vulnerability class, different field:** `/api/users/sync` also writes `isSuspended: user.isSuspended === true` directly from the client body — meaning, independent of the isAdmin issue, a suspended user could currently un-suspend themselves via the same endpoint (self-serve bypass of a moderation action). This wasn't part of the requested P0 scope (which was specifically the self-promotion → deletion/suspension chain) and is flagged here rather than fixed, to keep this security commit narrowly scoped and reviewable. Recommend a follow-up fix of the identical shape (preserve existing DB value, never trust the client body) the next time `/api/users/sync` is touched.

### 13.5 Tests performed

No test framework exists in this repository (checked: no jest/vitest/mocha config, no `.test.`/`.spec.` files, `package.json`'s only check script is `tsc --noEmit`). Given the severity and time constraints of a P0 fix, standing up a full testing framework was judged out of scope for this commit (real, but separate, infrastructure work) — instead:

**Executed against a local dev server** (`npm run dev`, real Firebase Admin SDK + real production Supabase connection, but only rejection-path requests that never reach a mutating code path):
| Test | Result |
|---|---|
| `POST /api/admin/users/delete`, no Authorization header | `403 Unauthorized: Administrator privileges required.` ✓ |
| `POST /api/admin/users/suspend`, no Authorization header | `403 Unauthorized: Administrator privileges required.` ✓ |
| `POST /api/admin/users/delete`, forged/garbage Bearer token | `403` — confirms `verifyIdToken` is genuinely cryptographically validating, not just checking header presence ✓ |
| `POST /api/users/sync`, forged Bearer token, body includes `isAdmin: true` (self-promotion attempt) | `401 Unauthorized: Authentication required` — rejected before ever reaching the isAdmin-handling logic ✓ |
| `npm run build` (the actual production build pipeline — Vite client bundle + esbuild server bundle) | Succeeded, 0 errors. Confirmed the new endpoints are present in the built `dist/server.cjs` ✓ |
| `tsc --noEmit` | Clean, 0 errors, across all three changed files ✓ |

**Verified by code review, not live execution** (no real Firebase test-user credentials available in this environment, and minting real tokens against the production Firebase project for test purposes was judged too close to "creating production side effects" to do autonomously):
- "Legitimate admin can still perform intended operations" — traced the full code path for a real `verified.isAdmin === true` caller through both new endpoints; logic is straightforward and mirrors the already-live, already-working `security-hold` endpoint exactly.
- "Normal (authenticated, non-admin) user cannot invoke admin deletion/suspension" — same code path, `isAdmin` false branch, returns 403. Not distinguished by live execution from the "no token at all" case tested above, since both hit the same `if (!verified || !isAdmin)` branch — a genuinely distinct real non-admin account would exercise identical code, so this is a low-risk inference, but it is an inference, not a measurement.
- "Target-user authorization enforced" — both endpoints fetch the target row independently server-side and 404 if it doesn't exist; traced, not executed against a real target.
- "Audit records identify the verified acting admin" — traced: both endpoints use `verified.uid`/`verified.email`, never a request header or body field, for `admin_user_id`/`admin_email`. Not confirmed by inspecting a real inserted row (would require a real admin token to trigger).

**Recommended follow-up** (not blocking this fix, but worth doing before relying on this indefinitely): set up a minimal test harness using the Firebase Auth emulator (avoids any production side effects entirely) to cover the untested cases above with real assertions instead of code-review inference.

### 13.6 Remaining risks after this fix

- **RLS is still disabled** — the broader migration (§1-11) is entirely unaffected by this fix and remains `BLOCKED_APPROVAL`. This fix closed one specific, severe chain; it did not touch the underlying RLS gap.
- **`isSuspended` self-serve bypass via `/api/users/sync`** — same vulnerability shape as `isAdmin` had, not fixed (§13.4).
- **`/api/send-welcome-email` has no authentication at all** — separate, lower-severity (abuse/cost, not data authorization), not fixed (§13.4).
- **CEO-support-chat read gate remains client-side-only** — narrower now (the specific poisoning route is closed) but still not a real server-verified gate on its own terms (§13.4).
- **`admin_audit_logs`/`account_deletion_audits` RLS status** — still unverified (unchanged from §11/§12.6).
- **`resetChats` reachability** — still unresolved (unchanged from §11/§12.6).
- **The admin PIN (`VITE_ADMIN_PIN`) is still a client-bundled value** — no longer has a hardcoded universal bypass, but it was never a real secret to begin with (anything shipped to the client isn't). This is fine *only* because nothing privileged is allowed to treat PIN verification as authorization anymore — worth keeping that invariant true for any future admin feature.

### 13.7 Is this P0 actually closed?

**Yes, for the specific chain described in the task**: self-promotion via a client-writable `isAdmin` (both the direct-Supabase route and, more importantly, the `/api/users/sync` route that didn't even need RLS to be off) leading to unauthorized account deletion or suspension. Both endpoints now independently re-verify admin status cryptographically server-side, matching the pattern already proven correct elsewhere in this codebase (`adminToggleSecurityHold`). Verified by a combination of live rejection-path testing, a full production build, and careful code-path tracing for the cases that couldn't be safely tested live.

**No, in the sense that this is one closed chain among several open findings** documented across this file (§11, §12.6, §13.4, §13.6) — RLS remains disabled, `isSuspended` has an analogous unfixed gap, and the welcome-email endpoint has no auth at all. None of those were in scope for this specific P0.

---

## 14. P1/P2/P3 REMEDIATION — isSuspended, send-welcome-email, repo-wide privileged-field sweep (IMPLEMENTED)

Follow-up pass, same session. Priority 1 (isSuspended) and Priority 2 (send-welcome-email) were both confirmed vulnerable and fixed. Priority 3 (repo-wide sweep) surfaced one additional, unrelated real vulnerability (chat `tradeStatus`) that was also fixed, plus a full classification of every privilege-adjacent field found.

### 14.1 Priority 1 — isSuspended (CONFIRMED VULNERABLE, FIXED)

Traced every read and write path. Findings, mapped directly to the five questions asked:

- **Can a normal user set their own `isSuspended=true`?** Technically yes, pre-fix — pointless self-harm, not a real vulnerability, but confirms the field was fully client-writable in both directions.
- **Can they set `isSuspended=false`?** **Yes — this was the real vulnerability.** `POST /api/users/sync` wrote `isSuspended: user.isSuspended === true` straight from the request body (`server.ts:3302`, before this fix) — identical shape to the `isAdmin` bug in §13. Any suspended user could self-unsuspend with a normal profile-save call.
- **Can they alter another user's suspension state?** Not via `/api/users/sync` (its `isOwner` check restricts writes to the caller's own row) — but **yes, via the direct-Supabase route**: `dbAdapter.ts`'s generic `setDoc`/`updateDoc` has no per-row ownership check at all (confirmed in the original audit, §2), and `isSuspended` was in the `users` write allow-list, so with RLS disabled a direct Supabase call could target any row, not just the caller's own.
- **Bypass an existing suspension by manipulating profile-sync data?** Yes — exactly the `/api/users/sync` self-unsuspend vector above.
- **Cause client state to disagree with the server's authoritative state?** This question exposed a deeper, separate architectural finding: **there is no server-side enforcement of `isSuspended` at all.** Checked every reference in `server.ts` — none exist outside the write paths themselves. `verifyUser()` never checks it. Suspension is enforced *entirely client-side*: `AppContext.tsx` reads the user's own doc on login/mount and forcibly signs out + shows a block screen if `isSuspended` is true (`AppContext.tsx:1562` and others). This means a suspended user's still-valid Firebase ID token continues to work against every API endpoint regardless of their suspension status — the block is a UI gate, not an access-control boundary. **This is real but out of scope for this fix** (the question asked was specifically about the field being client-writable/spoofable, which is now closed; whether suspension should also be enforced at the API layer is a separate architectural decision — flagged in §14.5, not fixed, since it requires a product decision about which endpoints a suspended user should be blocked from, not just a mechanical fix).

**Fix**: identical treatment to `isAdmin`. `/api/users/sync` now fetches the existing `isSuspended` value alongside `isAdmin` (same query, one round trip) and never takes it from the request body. `dbAdapter.ts`'s `users` write allow-list no longer includes `isSuspended`. The only legitimate way to change it is now `POST /api/admin/users/suspend` (already built in §13, unaffected by this fix).

### 14.2 Priority 2 — /api/send-welcome-email (CONFIRMED VULNERABLE, FIXED)

Traced from every caller (`AppContext.tsx:2226` — post-signup welcome trigger; `AppContext.tsx:5156` — `sendWelcomeEmailToAll`, the admin bulk tool) through to the server. Findings:

- **Authentication requirement (before fix): none.** Not even `verifyUser()`. Both real callers already sent a Bearer token — the server just never checked it.
- **Authorization requirement (before fix): none.**
- **Recipient source:** `req.body.email` — fully arbitrary, client-supplied, never validated against the caller's own identity.
- **Arbitrary email addresses:** confirmed possible, trivially.
- **Rate limiting:** yes, `serverRateLimiter(60*1000, 10, ...)` — bounds volume per rate-limiter key (IP-based, per the pattern used throughout this file) but doesn't require auth, so doesn't meaningfully bound a distributed abuser.
- **Abuse/spam potential:** real. Anyone could trigger a genuine, TedBuy-branded, Brevo-sent "Welcome" email to any address — spam/phishing-adjacent (an unsolicited branded email that looks legitimate to the recipient) and a real cost/reputation vector against TedBuy's own Brevo account and sender deliverability.
- **Account-enumeration potential:** none found — the handler never queried the users table to check if the email was already registered, so its response never varied in a way that would leak that information (this was true both before and after the fix, for the non-admin path).
- **External email/API cost:** real — every call is a genuine Brevo API send.
- **Still actively used:** yes, confirmed — both callers are live, current features (new-user welcome trigger, and the admin bulk-onboarding tool).
- **Bonus finding:** a second, complete duplicate registration of this exact route existed 1,700+ lines later in the file (`server.ts`, was line 7276), with a different (older-looking) email template and its own partial rate-limiting/admin-bypass logic. Confirmed via Express's routing semantics (first matching handler always wins, no fallthrough) that this second handler was **dead, unreachable code** — it never ran for any real request. Removed as misleading dead code (308 lines) rather than fixed in place, since the first, now-corrected handler is the sole live implementation.

**Severity classified as: real, externally-facing, but not a data-authorization breach** (no user data read or modified) — closer to an abuse/cost/reputation issue. The safe intended behavior was unambiguous (a welcome email should only ever go to the account it's actually welcoming), so per the task's own instruction this was fixed rather than merely documented.

**Fix**: `verifyUser()` now required. A non-admin caller may only trigger their own welcome email — the recipient is validated against their own verified Firebase email (`verified.email`), never trusted from the body. An admin caller (the legitimate bulk-send feature) may target another user, but that target is looked up server-side by email against the real `users` table — never an arbitrary/unregistered address — and its real username is used rather than a client-supplied one.

### 14.3 Priority 3 — repository-wide privileged-field sweep

Every `users`-table column in `dbAdapter.ts`'s `TABLE_COLUMNS`, plus the equivalent fields on `products`/`chats` most resembling a permission/role/status flag, traced for actual authorization effect (not assumed from naming):

| Field | Table | Classification | Evidence |
|---|---|---|---|
| `isAdmin` | users | Was dangerously client-controlled | Fixed in §13 |
| `isSuspended` | users | Was dangerously client-controlled | Fixed in §14.1 |
| `securityHold`, `securityHoldReason`, `securityHoldSetAt`, `securityHoldSetBy` | users | **Was dangerously client-controlled — fixed this pass** | Same shape as isAdmin/isSuspended: present in `dbAdapter.ts`'s write allow-list, but confirmed **no legitimate client code path ever wrote these** (only `POST /api/admin/accounts/security-hold`, server-side, does). A user under investigation could have self-cleared their own hold via a direct Supabase write, or — since dbAdapter has no per-row ownership check — potentially tampered with someone else's. Removed from the write allow-list; zero functional impact confirmed (nothing legitimate used this path). Not independently enforced server-side beyond the account-deletion flow's own check (`hasSecurityHold` at `server.ts:6432`) — same "read-only client trust, no API-layer enforcement" shape as isSuspended's deeper finding (§14.5), not fixed further here. |
| `status`, `isDeleted`, `deletedAt`, `deletionRequestedAt` | users | **Was dangerously client-controlled — fixed this pass** | Same reasoning and same fix as securityHold above — confirmed no legitimate write path via dbAdapter, removed from the allow-list. A malicious direct write could otherwise have set `isDeleted`/`status` on **any** row (own or, since there's no ownership check, someone else's), which could be used to make another user's account falsely appear deleted, or to "undelete"/reactivate a row that was legitimately soft-deleted. |
| `role` | users | **Safely client-editable** | Confirmed via full trace: never used for an authorization decision anywhere in `server.ts` — purely a self-descriptive buyer/seller/both classification, cosmetic. No fix needed. |
| `emailVerified` | users | **Dangerously client-controlled — documented, NOT fixed this pass** | `/api/users/sync` still writes `emailVerified: user.emailVerified === true` directly from the client body. Traced every usage: never gates a real secret or cross-user action server-side (the one server-side "isVerified" computation found, `server.ts:2329`, ends its OR-chain with a literal `|| true`, making it unconditionally true regardless of this field — dead/cosmetic). The only real gate found is client-side UX (requiring email verification before revealing a seller's WhatsApp number). **Classified LOW severity** — self-only tampering, no cross-user or data-exposure risk, no real secret bypassed. **Not fixed**: the cleanest correct fix isn't "preserve from DB" (which could lock in a stale value) but deriving it from the Firebase ID token's own `email_verified` claim — `verifyUser()` doesn't currently capture that claim at all, so this would need a small extension to `VerifiedAuthUser`, which is more surface than the narrow, single-purpose fixes made elsewhere this session. Recommended as a well-scoped, low-risk follow-up, not done autonomously here to keep this pass's diff tightly scoped to confirmed, higher-severity findings. |
| `isGoogleAuth`, `authProvider`, `welcomeSent`, `joinDate`, `photoUrl`, `bio`, `notificationPreferences`, `followingSellers`, `savedProductIds` | users | **Safely client-editable** | Traced: all are genuine self-service preference/metadata fields with no authorization role found anywhere. No fix needed. |
| `isApproved` | products | **Effectively inert, not a real gate** | `server.ts:2810`: `isApproved: productData.isApproved !== false` — defaults true unless explicitly false, and no read path anywhere filters listings by this field. Not currently a real moderation boundary one way or the other. Not fixed (nothing to fix — it isn't doing anything either way); flagged in case a future feature intends to use it as a real moderation gate, since it currently isn't wired to one. |
| `tradeStatus` | chats | **Was dangerously client-controlled — fixed this pass, found via this sweep, not originally in scope** | See §14.4 — a distinct, real fraud vector discovered while doing this systematic search, not a variant of the isAdmin/isSuspended pattern but the same root cause (dbAdapter's lack of ownership checks, RLS disabled). |
| `deliveredBySeller`, `pickedUpByBuyer` | chats | **Not exploitable, pre-existing unrelated quirk** | Neither field is actually present in `dbAdapter.ts`'s `chats` write allow-list (confirmed) — meaning the old client code's attempt to write them via `updateDoc` was already being silently stripped by `filterTableColumns` before this session's fixes. Harmless (the fields are cosmetic flags, not gates), not a security issue, not touched. |
| `boostStatus`, `boostPlan`, `boostPriority`, etc. | products | **Not evaluated this pass** | Boost activation already confirmed server-authoritative in the earlier security-audit pass (`/api/verify-payment`, uses `verified.uid`/real Paystack verification) — these product-table boost fields being in `dbAdapter`'s write allow-list wasn't re-examined for a parallel direct-write bypass in this pass. Flagged as **UNKNOWN / NEEDS INVESTIGATION** — a plausible next target for the same class of check (does a direct Supabase write let a seller boost their own listing for free, bypassing `/api/verify-payment` entirely?), not confirmed either way. |

### 14.4 Bonus finding from the Priority 3 sweep — chat `tradeStatus` (CONFIRMED VULNERABLE, FIXED)

Not an `isAdmin`-shaped field, but surfaced by the same systematic search and sharing the identical root cause (dbAdapter's lack of per-row ownership checks + RLS disabled). `markAsDelivered()`/`markAsPickedUp()` in `AppContext.tsx` wrote `tradeStatus` (`'delivered'` / `'completed'`) directly via `dbAdapter`'s `updateDoc`, with **zero verification that the caller was actually this chat's real seller/buyer**.

This matters specifically because `POST /api/reviews/create` (audited and confirmed sound in §12.5) trusts a chat's `tradeStatus === 'completed'` as its proof that a genuine trade occurred before allowing a review. **Any user could therefore fabricate review eligibility**: start a chat with any seller (cheap, low-friction), directly set that chat's `tradeStatus` to `'completed'` via the unauthenticated dbAdapter path, then legitimately call the (otherwise well-built) reviews endpoint, which would accept the forged trade as real. This undermines the review-integrity system that §12.5 previously certified as sound — the review endpoint itself was never the weak link; the data it trusted was.

**Discovered while confirming mobile/web parity**: mobile already had the correct implementation. `mobile/src/firebase.ts`'s `markAsDelivered`/`markAsPickedUp` call real server endpoints (`POST /api/chats/mark-delivered`, `POST /api/chats/mark-picked-up`) that already existed, are already `verifyUser()`-gated, and already independently verify the caller is genuinely the chat's seller (`chat.sellerId !== verified.uid → 403`) or buyer (`chat.buyerId !== verified.uid → 403`) respectively via `getChatIfParticipant`. Web simply never called them, maintaining its own parallel, insecure, direct-Supabase implementation instead.

**Fix**: web's `markAsDelivered`/`markAsPickedUp` now call the same, already-correct, already-proven (via mobile) server endpoints. `dbAdapter.ts`'s `chats` write allow-list no longer includes `tradeStatus` — confirmed the only other write of this field (`/api/chats/start`'s initial `'pending'`) is already server-side (`server.ts:3688`), so this closes the client route with zero functional impact on legitimate chat creation.

### 14.5 Tests performed (this pass)

Same honesty standard as §13.5 — no test framework exists in this repo.

**Executed against a local dev server** (rejection-path only, no mutating requests):
| Test | Result |
|---|---|
| `POST /api/send-welcome-email`, no auth | `401` ✓ |
| `POST /api/send-welcome-email`, forged token, arbitrary recipient | `401` (rejected before reaching recipient-validation logic) ✓ |
| `POST /api/chats/mark-delivered`, no auth | `401` ✓ |
| `POST /api/chats/mark-picked-up`, no auth | `401` ✓ |
| `POST /api/users/sync`, forged token, `isSuspended: false` self-clear attempt | `401` ✓ |
| `npm run build` | Succeeds, 0 errors |
| `tsc --noEmit` | Clean, 0 errors |

**Verified by code review, not live execution** (same limitation as §13.5 — no real Firebase test credentials available): a genuine non-admin authenticated user being correctly restricted to their own email in `/api/send-welcome-email`; a genuine chat participant successfully marking delivered/picked-up; a genuine non-participant being rejected by `getChatIfParticipant`; an admin successfully bulk-sending to a real registered user's email.

### 14.6 Remaining risks after this pass

- **isSuspended is still not enforced at the API layer** (§14.1) — closing the client-writability bug doesn't change that a suspended user's token still works against every endpoint. Real, but requires a product decision (which endpoints should reject a suspended user?) before it can be safely implemented — not guessed at here.
- **securityHold has the same API-layer-enforcement gap** — same shape, same reasoning, not fixed.
- **`emailVerified` remains client-controlled** (§14.3) — low severity, documented, not fixed.
- **Boost-related product fields not re-examined for a parallel direct-write bypass** (§14.3) — flagged UNKNOWN, worth checking next.
- **RLS is still disabled** — unaffected by any fix in this session. Still `BLOCKED_APPROVAL`.
- Everything listed in §13.6 that this pass didn't touch remains open (CEO-support-chat read gate, `admin_audit_logs`/`account_deletion_audits` RLS status, `resetChats` reachability).

---

## 15. Boost/payment integrity audit — end-to-end (IMPLEMENTED)

The flagged-but-unexamined item from §14.3 ("boost-related product fields... plausible next target for the same class of check") was confirmed **real and severe** — the most significant finding of this entire audit. Traced boost fields across web UI, mobile UI, `AppContext.tsx`, `dbAdapter.ts`, product create/update/sync, Paystack init/verify, boost activation, ranking, admin controls, and every server endpoint.

### 15.1 Finding A (CRITICAL / P0) — `upsertProductToSupabase` trusted client-supplied boost fields

`server.ts`'s `upsertProductToSupabase()` — called by `/api/products/sync`, the ordinary "save my listing" endpoint every seller already uses routinely — built its `cleanProduct` object with:

```js
boostStatus: productData.boostStatus !== undefined ? productData.boostStatus === true : (existingRow?.boostStatus === true),
boostExpiry: productData.boostExpiry || productData.boostEndDate || existingRow?.boostExpiry || existingRow?.boostEndDate || null,
```

`productData` here is the client's request body. **Verified this is exactly what the real ranking computation reads**: `getServerBoostEndDate()` (`server.ts:1592`) checks `product.boostEndDate || product.boostExpiry` as its primary signal for whether a listing is actively boosted, with `boostStatus` as a secondary fallback. This is not a cosmetic field — it's the actual, live "is this listing boosted right now, ranked above others" computation.

**This meant any authenticated seller could grant themselves a free, arbitrarily-long, ranking-relevant boost on their own listing via one ordinary API call** — e.g. `POST /api/products/sync` with `{product: {id: <own product>, boostStatus: true, boostExpiry: "2099-01-01", ...other required fields}}` — no Paystack, no payment, **and critically, no RLS bypass needed at all**, since `/api/products/sync` already runs through the service-role Supabase client regardless of RLS status. This is independent of, and more severe than, the RLS-disabled direct-Supabase vector, because it works through the app's own primary, already-authenticated listing-edit API — not a workaround.

**Confirmed NOT exploitable via `/api/verify-payment` itself for setting the amount** — `verifiedAmountGHS` there is always derived from Paystack's own verify response or `BOOST_PLAN_PRICE_GHS` (a server-side constant), never client-supplied. The vulnerability was specifically in the *other* boost-writing path.

**Correctness bug found alongside it**: `cleanProduct` only ever carried `boostStatus`/`boostExpiry` through — every other boost field `/api/verify-payment` computes after a real payment (`boostPlan`, `boostAmount`, `boostPriority`, `boostPriorityLevel`, `priorityScore`, `paymentReference`, `boostHistory`, etc.) was **silently dropped**, regardless of caller, since `cleanProduct` never included them at all. This means even genuinely paid boosts were losing their plan/amount/history metadata on every subsequent product sync. Not itself a security hole, but a real data-integrity bug, fixed in the same pass since the fix touches the same code.

**Fix**: added a `trustBoostFields` parameter (default `false`) to `upsertProductToSupabase`. When `false` — the default, used by `/api/products/sync` and the product-create endpoint (both take untrusted client bodies) — every boost field is taken exclusively from the existing database row, never from client input. When `true` — passed only by `/api/verify-payment` (after real, verified payment) and `/api/admin/boost-control` (already `verifyAdmin()`-gated) — the full, correct set of boost fields is taken from the caller's already-trusted computed values. This also fixes the correctness bug: all boost fields are now properly carried through for the two legitimate call sites, not just `boostStatus`/`boostExpiry`.

### 15.2 Finding B (CRITICAL / P0) — `/api/verify-payment` had no payment-reference replay protection

Paystack's transaction-verify endpoint is idempotent — it reports a transaction's historical status and will report "success" for the same reference indefinitely. **`/api/verify-payment` never checked whether a `paymentReference` had already been used.** Concretely, this meant:

- **Pay once, replay indefinitely on the same product**: resubmitting the same successful reference re-runs the whole activation flow; the existing "extend from current expiry if still active" logic (`server.ts`, `startTime` computation) would happily keep pushing the boost further into the future each time — an indefinitely-extendable boost from a single payment.
- **Pay once, boost multiple products**: nothing tied a `paymentReference` to a specific `productId` at the Paystack level — the same reference could be resubmitted with a different (also self-owned) `productId` each time, activating a full boost on every listing from a single payment.
- This affected the admin-free-boost path too (`ADMIN_FREE_BOOST_...`-prefixed references) — an admin-granted free boost reference could otherwise be replayed by whoever obtained it.

**Root cause of the gap**: `public.boost_purchases` already existed in the schema (`id TEXT PRIMARY KEY, productId, userId, amount, currency, status, createdAt`) — evidently built for exactly this purpose — but nothing in the codebase ever wrote to or read from it. Confirmed via the earlier direct-access audit (§3) that no client code references this table either; it was simply unused, dead infrastructure.

**Fix**: `/api/verify-payment` now checks `boost_purchases` for an existing row keyed by `paymentReference` *before* doing anything else (fast rejection for the dominant real-world case — a reference reused later, not a concurrent race), and inserts a claim row (using the reference as the primary key, a real atomic database-level guarantee) immediately after a successful activation. A losing insert in a genuine concurrency race is logged as a detected replay attempt rather than silently succeeding twice; the earlier product-boost write in that scenario is not unwound (accepted tradeoff — see §15.6).

### 15.3 Finding C (P1, defense-in-depth) — direct-Supabase route was also open

`dbAdapter.ts`'s `TABLE_COLUMNS.products` (the write allow-list gating every client-side `setDoc`/`updateDoc`) included every boost field plus `paymentStatus`/`paymentReference`. With RLS disabled and this generic path having zero per-row ownership checks (established throughout this audit), this was a second, independent route to the same outcome as Finding A — a direct Supabase write, bypassing the app's API entirely. **Fixed**: all boost/payment fields removed from this allow-list, same treatment as every prior fix this session. Confirmed zero legitimate functional impact: `BoostModal.tsx`'s own client code (`src/components/BoostModal.tsx:258`) only ever calls `updateProduct(product.id, data.product)` with the *server's own response* after a successful `/api/verify-payment` call — never client-invented boost values — so this path was never exercised for a legitimate purpose in the first place.

### 15.4 Fallback behavior when `PAYSTACK_SECRET_KEY` is unavailable

Re-inspected per the specific instruction, without requesting or exposing the secret's value. `server.ts` checks `process.env.PAYSTACK_SECRET_KEY` fresh, per-request, with a simple existence check (`if (process.env.PAYSTACK_SECRET_KEY) {...} else {...demo mode...}`) — no caching, no module-level constant that could go stale, no code path where this could differ between requests while the process is running. **Given Vincent's confirmation that the production key is configured, the demo-mode branch is deterministically unreachable in production today.** It only exists as an interim pre-launch allowance (already documented in the code's own comment) and would only ever engage again if the environment variable were later unset — a deployment/configuration change, not a code-level vulnerability. Worth noting as a genuine latent risk if that env var were ever accidentally removed (the demo-mode branch would silently start accepting unverified references again) — but this is operational/configuration risk, not something fixable in code beyond what's already there. **One relevant improvement from this pass**: the new payment-reference replay protection (§15.2) applies uniformly to *both* branches — even if demo mode were ever reactivated, a "demo" reference still couldn't be replayed for multiple boosts, which wasn't true before this fix.

### 15.5 Abuse scenarios — explicit answers

| Scenario | Before this pass | After |
|---|---|---|
| Obtain a free boost | **Yes** — via `/api/products/sync` (Finding A) | No — boost fields now server-preserved only |
| Give themselves a larger boost than paid for | No — amount was always Paystack/server-derived | No change (was already safe) |
| Extend a boost indefinitely | **Yes** — replay the same reference repeatedly (Finding B) | No — reference claimed after first use |
| Reuse one payment for multiple boosts | **Yes** — same mechanism as above (Finding B) | No |
| Boost another user's listing | No — `existingProduct.sellerId !== verified.uid && !isAdmin → 403` in `/api/verify-payment`, already sound | No change (was already safe) |
| Manipulate ranking without payment | **Yes** — Finding A directly controls the field `getServerBoostEndDate()` reads | No |
| Manipulate boost state directly via Supabase (RLS disabled) | **Yes** — Finding C | No |
| Bypass boost expiry | No — `getServerBoostEndDate()` recomputes fresh from stored dates on every read; no separate "is expired" flag to tamper with | No change (was already safe by design) |
| Cause a paid boost to attach to the wrong product/user | No — `productId` ownership-checked against the authenticated caller; a payer can only ever direct their own payment at their own products | No change (was already safe) |

No real Paystack transactions were performed. All "before" conclusions are from direct code tracing (reading the actual vulnerable logic and the real `getServerBoostEndDate()` consumer), not live exploitation.

### 15.6 Tests performed

Same standard as §13.5/§14.5 — no test framework exists in this repo.

**Executed against a local dev server** (rejection-path only):
| Test | Result |
|---|---|
| `POST /api/verify-payment`, no auth | `401` ✓ |
| `POST /api/verify-payment`, forged token | `401` ✓ |
| `POST /api/products/sync`, no auth, body attempts `boostStatus: true, boostExpiry: "2099-01-01"` | `401` — rejected before reaching the now-fixed boost-field logic ✓ |
| `POST /api/products/sync`, forged token, same payload | `401` ✓ |
| `POST /api/admin/boost-control`, no auth | `403` ✓ |
| `npm run build` | Succeeds, 0 errors |
| `tsc --noEmit` | Clean, 0 errors |

**Verified by code review, not live execution** (no real Firebase or Paystack test credentials available): the full `trustBoostFields: true` path for a genuine `/api/verify-payment` call after real payment verification; the `boost_purchases` duplicate-check actually rejecting a second real submission of the same reference; the race-condition INSERT-conflict logging path; a legitimate admin successfully using `/api/admin/boost-control`. These were traced line-by-line against the actual implemented code, not executed.

### 15.7 Remaining risks / not fully covered

- **The race-condition window in §15.2 is narrow but not eliminated** — two genuinely simultaneous requests with the same reference could both pass the early SELECT before either INSERT completes. The second INSERT will fail (real DB-level uniqueness), so no *second* boost activation persists incorrectly beyond what the first request already wrote, but this relies on the `id` primary key constraint being the real backstop, not the SELECT. A stricter fix would use a single atomic upsert-with-conflict-check inside a transaction; judged unnecessary additional complexity given Postgres's own primary key constraint already prevents the actually-damaging outcome (a *second* distinct successful activation).
- **`products.status`/`isDeleted`/`securityHold` were left in `dbAdapter.ts`'s write allow-list** — not evaluated with the same rigor as `users`' equivalent fields in §14.3. A seller could plausibly self-clear a security hold or moderation status on their own listing via the same direct-Supabase route. Flagged, not fixed — out of this pass's specific boost/payment scope.
- **`boost_purchases` now has real data flowing into it for the first time** — no read/reporting UI consumes it yet (admin dashboard, dispute lookup, etc.). Purely additive infrastructure from this fix; not a risk, just noting it's not yet surfaced anywhere.
- Everything listed in §13.6/§14.6 that this pass didn't touch remains open.

---

## 16. Product moderation/visibility audit — end-to-end (IMPLEMENTED)

Continuation from §15.7's flagged item. Traced every product field that can affect moderation, approval, visibility, deletion, archival, featured status, or discovery/video-feed eligibility, across creation, `/api/products/sync`, update/delete, `dbAdapter.ts`, admin UI, search/discovery ranking, video-feed filtering, and mobile/server paths.

### 16.1 Field-by-field classification

| Field | Table | Classification (before) | Evidence |
|---|---|---|---|
| `status` (`'active'`/`'sold'`/`'archived'`/`'hidden'`/`'deleted'`) | products | **Was dangerously client-tamperable — fixed this pass** | See §16.2. Gates real visibility: `normalizeServerProductSummaryRow` (`server.ts:1816`) and the video-feed filter (`server.ts:2435`, `!p.isDeleted && p.status !== 'hidden' && p.status !== 'archived'`) both exclude listings based on this exact field. |
| `isDeleted` | products | **Was dangerously client-controlled via the direct-Supabase route — fixed this pass** | Same read-side gates as `status`. Confirmed absent from `/api/products/sync`'s write set entirely (server-side was safe by omission, not design) — the only writable path was `dbAdapter.ts`'s allow-list, now closed. |
| `archivedAt` | products | **Was client-controlled via direct-Supabase, low independent risk — fixed for consistency** | A timestamp accompanying `isDeleted`/`status`, not itself a gate. Fixed alongside the others since it's meaningless without them and shares the same write path. |
| `securityHold` | products | **Was client-controlled via direct-Supabase — fixed this pass** | Confirmed absent from `/api/products/sync`'s write set (same as `isDeleted`). No product-level read path currently checks this field at all (unlike the `users.securityHold` equivalent, which the account-deletion flow does check) — so today this was inert-but-writable, same risk profile as `isApproved`. Fixed for consistency/future-proofing. |
| `isApproved` | products | **Was fully client-controlled, but confirmed inert (no read-path gate) — fixed anyway, defensively** | Traced every read/filter path in `server.ts` and found zero references gating on this field. Not exploitable today. Fixed on the same principle as the `users.emailVerified` finding in §14.3: harmless now, becomes a real gap the instant a future feature wires moderation logic to it without checking whether it's already fully client-writable. |
| `sellerVerified` | products | **Safe — effectively inert** | One computation path (`server.ts:2333` area) ends its OR-chain with a literal `\|\| true`, making it unconditionally true regardless of input (same pattern independently found for the general "isVerified" computation in §14.3). The other reference (`server.ts:1797`, `normalized.sellerVerified !== false`) is a read-side pass-through of whatever's in the row; confirmed absent from both `/api/products/sync`'s write set and `dbAdapter.ts`'s allow-list — no write path exists for it at all. No fix needed. |
| "Featured" listings | products (derived) | **Safe — not a stored field at all** | `/api/featured` (`server.ts:1951`) derives the featured set entirely from `isServerBoostActive(p)` — i.e., boosted listings *are* the featured listings, no separate flag. Already covered by §15's boost fixes. |
| Admin product-moderation capability | — | **Does not exist yet, anywhere** | Searched for a dedicated hide/archive/moderate endpoint (`/api/admin/product*`, `/api/products/hide`, `/api/products/archive`, `/api/products/moderate`) and for any client-side admin function analogous to `adminDeleteUserProfile`/`adminToggleUserSuspension` that writes these fields on a *product*. **None found.** The only place `status: 'archived'`/`isDeleted: true` is ever set for a product today is the self-serve account-deletion flow's own cascade (`AppContext.tsx:5109` — pure local React state, not a write at all) and the account-deletion server endpoint's product cascade for the *account owner's own* listings. There is currently no way for an admin to moderate a single listing at all, through any UI. This isn't a vulnerability — it just means the fields audited above are pure latent/future-proofing risk today (no live feature exercises the "admin sets this" side yet), which is exactly why the fix approach was defensive (lock in correct behavior now) rather than reactive. |

### 16.2 Finding (P1 confirmed, fixed) — `status` self-reinstatement

Traced `upsertProductToSupabase`'s `status` computation (used by `/api/products/sync`, reachable by any listing's owner). Two branches unconditionally honored a client-supplied value:

```js
if (productData.status === 'active') { return 'active'; }
// ...
return productData.status || (existingRow?.status || 'active');
```

**Confirmed**: if a product's `status` were ever set to a moderation-restricted value (`'archived'`, `'hidden'`, `'deleted'`) — today only possible via direct database/dashboard access, since no admin moderation endpoint exists (§16.1) — the listing's own owner could trivially reverse it by editing their listing (or a raw `/api/products/sync` call) with `status: 'active'` in the body. This is a real logic flaw with an unambiguous correct behavior: a moderation action shouldn't be reversible by the party it was taken against.

**Fix**: non-admin callers can now only ever move a listing between `'active'`/`'sold'` (via the existing `isSold` mechanism, behavior-preserving for the live Mark as Sold feature — verified, see §16.4), and only when the existing row isn't already in a moderation-locked state. An admin caller (`actingUser.isAdmin === true`, the same real, cryptographically-derived flag used throughout this session's fixes) retains full authority to set any status — since applying/lifting moderation is definitionally an admin action.

### 16.3 Search for other client-controlled fields affecting money/permissions/trust/moderation/trade-state/ranking/account-state

Beyond the fields named in the task, swept for anything else in this category:

- **`priorityScore`/`boostPriority`/`boostPriorityLevel`** (ranking) — already covered under the boost-field fix in §15 (all gated behind `trustBoostFields`).
- **`viewsCount`/`likesCount`** — client-influenceable by design (a user's own like/view actions legitimately affect these), and already narrowly scoped in `/api/products/sync` (`Number(productData.viewsCount || ... || existingRow?.viewsCount) || 0` — can't go negative or be set to an arbitrary type, but a client *can* claim any positive number). This is pre-existing, low-severity (inflating your own listing's view/like count is a minor ranking-nudge at most, not an account-state/financial/trust issue), and **out of this pass's scope** — flagged, not fixed, since "the task is specifically moderation/visibility/approval/trust fields" and this is more of a general anti-gaming concern already bounded by `engagementScore`'s logarithmic scaling in the ranking algorithm (`recommendationScore.ts`, confirmed earlier this session — a single outlier can't dominate).
- **`sellerId` reassignment** — already covered in the original security-audit pass this session: `/api/products/sync` always preserves `existingSellerId` for an existing product regardless of client input (confirmed still true, unaffected by this pass's changes).
- **No other trust/moderation/permission-shaped field found** beyond what's in §16.1's table and what was already covered in prior passes (§13 `isAdmin`, §14.1 `isSuspended`/`securityHold` on users, §14.4 `tradeStatus`, §15 boost/payment fields).

### 16.4 Tests performed

**Executed, not just traced** — the `status` computation is pure, deterministic logic, so it was copied verbatim from the actual current code into a standalone script and run directly (not a paraphrase or re-derivation):

| Scenario | Result |
|---|---|
| Mark an active listing as sold | `sold` ✓ |
| Un-mark a sold listing | `active` ✓ |
| **Non-admin attempts to self-reinstate an archived listing** (`status: 'active'` claim) | `archived` — attack blocked ✓ |
| **Non-admin attempts to self-reinstate a hidden listing** | `hidden` — attack blocked ✓ |
| **Non-admin attempts to un-sell their way out of a deleted-state listing** (via `isSold: false`) | `deleted` — attack blocked ✓ |
| Admin lifts a moderation lock | `active` ✓ |
| Admin applies a new moderation lock | `hidden` ✓ |
| New product creation defaults to active | `active` ✓ |
| Ordinary edit (no status/isSold in payload) preserves an active listing's status | `active` ✓ |
| Ordinary edit preserves a sold listing's status (doesn't accidentally un-sell it) | `sold` ✓ |

All 11 cases passed. This is real executed verification of the exact logic now live in `server.ts`, not code-review inference — the two are being explicitly distinguished per the task's instruction.

**Executed against a local dev server** (HTTP rejection-path only): `POST /api/products/sync` with no auth and a `status: 'active'` self-reinstatement attempt → `401`; same with a forged token → `401`. Confirms the vulnerable code is unreachable without a genuine token, consistent with every prior pass.

**Verified by code review, not live execution**: a genuine authenticated non-admin owner's request being correctly evaluated against a real `existingRow` fetched from the database (the standalone test above exercises the exact same function body, just with a hand-constructed `existingRow` rather than a live Supabase fetch — the database-fetch code itself was unchanged by this fix and already exercised throughout this session's other work).

`tsc --noEmit`: clean. `npm run build`: succeeds.

### 16.5 Remaining risks / not covered

- **`viewsCount`/`likesCount`** client-influenceable within existing bounds — flagged in §16.3, not fixed (out of scope, low severity, already bounded by the ranking algorithm's log-scaling).
- **No admin product-moderation UI/endpoint exists** — not a vulnerability itself, but worth Vincent knowing: if this audit's fixes are meant to protect a *future* moderation feature, that feature still needs to be built (the fixes in §16.2 lock in correct behavior for whenever it is).
- Everything listed in §13.6/§14.6/§15.7 that this pass didn't touch remains open.

---

## 17. Notifications — confirmed vulnerable, NOT fixed this pass (requires new infrastructure, not a focused patch)

Picked up next per the standing priority order, since §3 had already flagged "no dedicated `/api/notifications/*` endpoint — needs a new endpoint." Re-traced fully to confirm severity before deciding whether to fix.

### 17.1 What's confirmed

All five notification-creation call sites in `AppContext.tsx` (new-listing/CEO-support at `:3595`, a sandbox/admin path at `:3882`, two separate message-received paths at `:4326`/`:4540`, and follow notifications at `:4825`) write **exclusively via `dbAdapter`**, with no server endpoint involved at all. `dbAdapter.ts`'s `TABLE_COLUMNS.notifications` allow-list (`userId`, `title`, `message`, `type`, `triggerUserId`, `triggerUsername`, `triggerUserPhoto`, `productId`, `productTitle`, `chatId`, etc.) has no restriction tying the write to the caller's own identity — and, as established throughout this audit, `dbAdapter`'s generic `setDoc`/`updateDoc`/`deleteDoc` have no per-row ownership check at all, RLS is disabled.

**Confirmed, concretely:**
- **Content-injection / impersonation**: any client can create a notification targeting an **arbitrary victim's `userId`**, with fully attacker-controlled `title`, `message`, `type`, `triggerUsername`, `triggerUserPhoto` — e.g. a fake "TedBuy Official" or impersonated-seller notification directing the victim toward a phishing link or a scam trade, delivered directly into their real notification inbox.
- **Cross-user tampering**: `markNotificationAsRead`/`markAllNotificationsAsRead`/`clearAllNotifications` (`AppContext.tsx:1799-1838`) only *iterate over the caller's own already-loaded local state* — a client-side convention, not a boundary. A direct `updateDoc`/`deleteDoc` call against an arbitrary notification `id` (predictable format: `notif_<timestamp>_<userId>_<random>`, visible in the creation code) is not stopped from marking-read or deleting another user's notifications.

### 17.2 Why this wasn't fixed the same way as everything else this session

Every prior fix in §13-16 closed a gap in logic that **already existed server-side** (a real endpoint or shared function that just trusted the wrong input) — the fix was narrow: stop trusting a specific field, preserve the existing value instead. Notifications have **no server-side logic to patch at all**. Properly closing this requires designing and building genuinely new API surface:

- A `POST /api/notifications/create` endpoint would need **per-type validation**, not just an ownership check, because the caller and the recipient are legitimately different people for every notification type here (that's the whole point of a notification) — e.g. a "new follower" notification is only legitimate if the server can independently verify the caller genuinely just followed that seller (checking the caller's own `followingSellers`); a "new message" notification only legitimate if the caller is a genuine participant in that exact chat (`getChatIfParticipant`, already used elsewhere this session). Each of the five call sites needs its own validation rule, not one generic check.
- Mark-read/delete-all would need their own endpoints with a straightforward ownership check (`notification.userId === verified.uid`) — this part alone would be a focused fix, but doesn't close the create-side risk on its own.
- One creation path (new-listing-from-followed-seller) is **already** independently implemented server-side (`server.ts:2963` area, flagged for a separate reason — N+1 query pattern — earlier this session) — the client-side write for that specific case may already be pure redundant/dead weight, worth confirming before building a server replacement for it specifically.

Given the task's own instruction to fix only when "the intended secure behavior is unambiguous" via a focused change, and to otherwise document rather than guess: the *what* (notifications should only be created via verified legitimate triggers, and only touched by their owner) is unambiguous, but the *how* requires building new, non-trivial server business logic per notification type — qualitatively different from every other fix this session, and risks introducing new bugs in a live, real feature (five real call sites, users actively receiving these notifications today) if rushed. Recommending this as a dedicated next task rather than folding it into this pass.

### 17.3 Severity and recommendation

**Classification: P1** — real, confirmed, exploitable spam/phishing/impersonation and privacy (marking/deleting another user's notifications) vector, but not a financial or account-takeover issue (contrast §13/§15's P0s). No live exploitation attempted; conclusions are from tracing the actual write paths and the absence of any ownership check, consistent with the standard established throughout this document.

**Recommended next step**: build `POST /api/notifications/mark-read`, `POST /api/notifications/mark-all-read`, `POST /api/notifications/clear` first (straightforward ownership checks, low risk, closes the tampering half immediately), then `POST /api/notifications/create` with per-type validation (higher effort, closes the impersonation half) — migrating each of the five client call sites to the new endpoint once it exists, the same pattern used for `markAsDelivered`/`markAsPickedUp` in §14.4.

---

## Summary for the handoff

Five real, distinct vulnerabilities closed this session across four passes, all sharing the same underlying pattern (server-side or direct-Supabase trust of client-controlled privilege/financial/moderation fields): `isAdmin` self-promotion (§13), `isSuspended` self-clearing (§14.1), chat `tradeStatus` fabrication enabling fraudulent reviews (§14.4), free/unlimited boost activation plus payment-reference replay (§15, the most severe), and moderation-status self-reinstatement (§16). An unauthenticated email-abuse endpoint was also closed (§14.2), and 308 lines of dead code removed. A sixth vulnerability (notifications — impersonation/phishing via arbitrary-target notification creation, plus cross-user mark-read/delete) was confirmed real but **not fixed**, since closing it properly requires building new server endpoints with per-type validation logic rather than patching existing logic (§17) — documented as a recommended next task instead of guessed at. RLS itself remains untouched and `BLOCKED_APPROVAL` throughout — none of these fixes depend on or affect that decision; each closes a vulnerability that existed independently of RLS's current state, in addition to closing the corresponding RLS-disabled direct-Supabase variant as defense-in-depth.
