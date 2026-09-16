# RLS Enablement Readiness Report

**Purpose:** answer two specific questions before Phase 4 (enabling Supabase RLS) is authorized — *what will break when RLS goes from disabled to enabled*, and *has the application actually stopped depending on direct Supabase access*. This is a synthesis of `SUPABASE_RLS_MIGRATION_PLAN.md`'s completed Phase 0-2 work (25 numbered checkpoints across both phases, commits `94c3cc6` through `c634c71`) and the current, as-committed state of `src/dbAdapter.ts` and `server.ts` — not a new vulnerability sweep. Where a claim below required confirming current code rather than recalling prior work, that confirmation is a targeted read of the relevant file, not a fresh audit.

---

## 1. Bottom line

**Enabling RLS with a default-deny policy set (zero permissive policies, per §6 of the migration plan) today should break nothing in the running application**, because the anon key — the only credential RLS can restrict, since the server's `service_role` client always bypasses RLS regardless — has no remaining legitimate call site anywhere in `src/`. Every read and write that used to go directly to Supabase from the browser now goes through an authenticated `server.ts` endpoint using `service_role`.

This is a high-confidence claim about the **application's own code**, not a fully-verified claim about **every possible request Supabase could receive**. The distinction matters and is explained in §7 — RLS's actual job is closing the anon key's reach for requests that bypass the app's JS entirely (hand-crafted PostgREST calls), which is a different thing from "the app doesn't call Supabase directly anymore." Both are true here, but they were established by different means, and §7 is explicit about which is which.

---

## 2. What enabling RLS actually changes

Confirmed facts, restated here because they determine everything below:

- **The server never depends on RLS at all.** Every `server.ts` endpoint uses a `service_role` Supabase client (`backendSupabase`), which Postgres RLS cannot restrict under any policy configuration. Enabling RLS has **zero effect on any authenticated API call** — registration, login, listing creation, chat, payments, admin actions, all of it.
- **RLS only restricts the anon key.** The anon key is embedded in the client bundle (by design — it's meant to be public) and is the credential `src/dbAdapter.ts` uses whenever the app talks to Supabase directly, and the credential a sophisticated attacker would use to bypass the app's JS and hand-craft requests against the same database.
- **Recommended target policy (already designed, not yet applied):** enable RLS on every table, add zero permissive policies. True default-deny. This is deliberately simple because `auth.uid()` is always `NULL` for anon-key requests — TedBuy has no Supabase Auth session anywhere (Firebase Auth is the only identity system), so no policy could meaningfully express per-user ownership even if one were written. RLS's job here isn't "express ownership," it's "cap what the anon key can do to zero," which is sufficient once nothing legitimate uses that key.

---

## 3. The complete table inventory, and which of them the anon key can even reach

Two different questions, both answered from current code:

**a) Which Postgres tables does `server.ts` actually use (`service_role`, i.e. exist and are live)?** Confirmed via every `.from('<table>')` and `safeBackendSupabaseUpsert('<table>', ...)` call in `server.ts`:

`users`, `products`, `chats`, `messages`, `reviews`, `reports`, `notifications`, `store_names`, `boost_purchases`, `account_deletion_audits`, `admin_audit_logs` — **11 tables**.

(`supabase_schema.sql` in the repo root is a stale setup script — missing `reports` entirely — and should not be treated as authoritative for the live schema. The list above is derived from what the running server code actually queries, which is authoritative for "this table exists and is used.")

**b) Of those 11, which does the anon key's client-side path (`dbAdapter.ts`) even structurally reach?** Confirmed via `VALID_TABLE_MAP` and `TABLE_COLUMNS` in `src/dbAdapter.ts` — the two gates every `getDoc`/`getDocs`/`setDoc`/`updateDoc`/`deleteDoc`/`onSnapshot` call passes through before touching Supabase at all:

| Reachable via anon key (7) | Never reachable via anon key (4) |
|---|---|
| `users` | `notifications` |
| `products` | `boost_purchases` |
| `chats` | `account_deletion_audits` |
| `messages` | `admin_audit_logs` |
| `reviews` | |
| `reports` | |
| `store_names` | |

The four right-column tables have **no entry in `VALID_TABLE_MAP`** — any `doc('notifications', ...)`-style call resolves to `table: null` and the whole operation becomes a structural no-op (confirmed by `getDocPathInfo`'s own `if (table && !TABLE_COLUMNS[table]) { table = null; }` check). This isn't a runtime permission check, it's the client code simply having no path to construct a request against these tables at all.

**Important caveat, stated plainly:** "no path in the app's own JS" is not the same protection as RLS. Today, with RLS disabled, a caller who bypasses the app entirely and hand-crafts a PostgREST request with the anon key **could** still reach these four tables directly — `VALID_TABLE_MAP` only constrains what *this app's own code* generates, not what the anon key is capable of at the database level. This is exactly why enabling RLS matters even for tables the app never touches on purpose: it's the only mechanism that closes that gap for real, for all eleven tables, not just the seven the client code was ever wired to reach.

---

## 4. Per-table breakage analysis — the seven anon-key-reachable tables

For each table below: what used to be reachable via the anon key, when it was closed, and why nothing should break.

### `users`
**Before:** full `select('*')` bulk reads (all PII — email, phone, WhatsApp, admin/suspension status), targeted reads, and writes with no per-row ownership check (any signed-in-to-Supabase caller could write any user's row) were all reachable. This was the single largest exposure in the whole audit.
**Closed by:** checkpoints 1 and 4 (Phase 0), 5–7, 9–11, 13–16, 18–20, 25 (every write and read call site, including the account-migration merge, self-profile reads, `loginUser`'s identifier resolution, and an admin-diagnostics tool found outside `AppContext.tsx` entirely).
**Column allow-list today:** already excludes `isAdmin`, `isSuspended`, and every moderation/security-hold field — so even an anon-key write to a permitted column set can't touch privilege or account-standing fields, independent of RLS.
**Will break:** nothing found. Every legitimate profile read/write already goes through `GET /api/users/get`, `GET /api/users/list`, or `POST /api/users/sync`.

### `products`
**Before:** boost fields, `status`/moderation fields, and (found on the final re-sweep) the entire create/update/delete path in three separate functions were reachable with no ownership check — including the most severe finding of the whole migration, a fully unauthenticated arbitrary-product-delete requiring no login at all.
**Closed by:** Phase 0 checkpoint 3 (boost/views/likes), checkpoint 17 (three gaps in `updateProduct`, including a live free-boost exploit), checkpoints 22–23 (`deleteProduct`'s direct delete, `createProduct`'s redundant write).
**Column allow-list today:** already excludes every boost field, `status`, `isDeleted`, `archivedAt`, `securityHold`, `isApproved`.
**Will break:** nothing found. Create/update/delete all route through `POST /api/products/sync`, `POST /api/products/create`, `POST /api/products/delete`.

### `chats`
**Before:** `tradeStatus` was writable with no ownership check, letting anyone fabricate review eligibility without a real trade; the admin support-desk inbox read the whole table via an unauthenticated realtime subscription; `setupWelcomePackage` and `reportListing` both created support-desk chats directly, reachable with any signed-in identity (not just the caller's own).
**Closed by:** earlier-session chat/trade-status work (pre-dating this document), checkpoint 12 (admin support-desk realtime → `GET /api/admin/support/chats`), checkpoint 19 (`setupWelcomePackage` → new `POST /api/welcome/setup`), checkpoint 24 (`reportListing` reusing the same endpoint).
**Column allow-list today:** already excludes `tradeStatus`.
**Will break:** nothing found. Chat state transitions route through `/api/chats/start`, `/api/chats/mark-delivered`, `/api/chats/mark-picked-up`; support-chat creation routes through `/api/welcome/setup`.

### `messages`
**Before:** two functions (`toggleMessageReadStatus`, `resetChats`) had direct write access; confirmed dead code (zero callers) and removed rather than migrated, at checkpoint 8. `resetChats` was also a destructive, ownership-check-free bulk delete. `setupWelcomePackage`'s welcome message creation was also direct, closed alongside its chat-creation counterpart.
**Closed by:** checkpoint 8; checkpoint 19 for the welcome-message case.
**Will break:** nothing — the removed functions had no callers to begin with, and welcome-message creation is now server-side inside `/api/welcome/setup`.

### `reviews`
**Before:** a global "fetch all reviews" sync used a direct, unauthenticated bulk read, left open longer than any other finding because `GET /api/reviews` genuinely needed a new capability (an optional, unscoped mode), not a drop-in swap.
**Closed by:** checkpoint 21.
**Will break:** nothing found. The endpoint now serves both scoped (`?sellerId=`) and unscoped reads, matching every consumer's existing usage exactly.

### `reports`
**Before:** had no column allow-list at all (a genuine oversight — every other table had one) — writes passed through completely unfiltered, and the client could self-attribute a false `reporterId`.
**Closed by:** an earlier-session pass (pre-dating this document), migrated to `POST /api/reports/create`.
**Will break:** nothing found — no remaining direct-write caller.

### `store_names`
**Before:** the account-migration merge's repoint, and `updateUserProfile`'s old-username cleanup, both wrote directly with no ownership check.
**Closed by:** checkpoint 13 (merge endpoint now owns the repoint) and checkpoint 18 (`POST /api/users/sync` now handles old-username cleanup server-side).
**Will break:** nothing found — reservation and cleanup are both now single-endpoint, server-verified operations.

### The four server-only tables (`notifications`, `boost_purchases`, `account_deletion_audits`, `admin_audit_logs`)

None of these were ever reachable via the app's own client code (confirmed in §3). Nothing in `src/` will break, because nothing in `src/` was ever calling them. The only change RLS makes here is closing the direct-PostgREST-request gap described in §3's caveat — a strict security improvement with no functional-regression risk, since there's no legitimate feature depending on the anon key reaching these tables today.

---

## 5. `chat_typing` — not a table, not governed by RLS at all

Worth stating explicitly since it's been flagged twice in the migration plan as an "out of scope" item: `chat_typing` is **not a Postgres table**. `dbAdapter.ts`'s ephemeral-path handling (`isEphemeralPath`) routes it entirely through **Supabase Realtime broadcast** (`supabase.channel(...).send({ type: 'broadcast', ... })`), a pub/sub mechanism that never touches a table row and is therefore **not subject to RLS under any policy configuration**. Enabling RLS has no effect on it either way. If its current open-broadcast behavior (any signed-in Supabase channel subscriber can see typing events for any chat id) is ever a concern, that's a separate Realtime Authorization question, unrelated to this migration.

Confirmed separately while reviewing `dbAdapter.ts`'s `onSnapshot`: the Supabase-backed branch never establishes a real Postgres Changes subscription — it always does a one-shot `select().eq('id', id).maybeSingle()` styled to look like a snapshot. There is no hidden realtime mechanism that would behave differently from an ordinary read once RLS is enabled; every operation in this app funnels through standard `select`/`insert`/`update`/`delete`, uniformly governed by whatever policy exists on that table.

---

## 6. Confirming the application has stopped depending on direct Supabase access

Two independent lines of evidence, not one:

1. **Structural**: `src/dbAdapter.ts`'s `VALID_TABLE_MAP`/`TABLE_COLUMNS` gates are the *only* way client code can construct a Supabase request at all. Seven tables are reachable through them; the other four aren't reachable through them at all. This bounds the maximum possible surface precisely.
2. **Behavioral**: across the 25 isolated, individually-committed, individually-`tsc`/build-verified checkpoints referenced above, every actual call site touching those seven tables — every `getDoc`, `getDocs`, `onSnapshot`, `setDoc`, `updateDoc`, `deleteDoc`, `writeBatch` in `src/` — was found (via two separate full-repo re-sweeps, not just the original inventory) and migrated to a `server.ts` endpoint using `verifyUser()`/`verifyAdmin()` plus a `service_role` client. A repo-wide grep for these calls today returns only: dev-only/production-disabled code (`switchUserSimulated`), a sandbox-fallback branch with no real Firebase identity to verify against (part of `registerUser`), and the `chat_typing` ephemeral path described in §5.

Both lines of evidence point to the same conclusion independently, which is why confidence in §1's bottom line is high.

**What this section does *not* claim**: that live testing against the real Supabase project has confirmed RLS itself would behave as designed once enabled. See §7.

---

## 7. What is not yet verified, and why

The migration plan's own Phase 5 test matrix has four identity rows. Two are done; two are not, for a specific, stated reason rather than being skipped silently:

| Row | Status | Why |
|---|---|---|
| Normal authenticated user (rejection half: no-auth, forged-token) | **Done.** All 64 `server.ts` endpoints tested live. | Runnable without external dependencies. |
| Normal authenticated user (success half: does a real token still work end-to-end) | **Not done.** | Requires a real Firebase ID token; none exists in this environment. |
| Cross-user (does user A get rejected touching user B's data) | **Not done.** | Same — requires two real, distinct authenticated sessions. |
| Admin | **Not done.** | Same — requires a real admin-privileged session. |
| Anonymous vs. Supabase directly (the actual RLS test — hand-crafted PostgREST requests with just the anon key) | **Not done.** | This sandbox has had no DNS resolution to the project's Supabase host (`kxfykyxagkbrjymjmtal.supabase.co`, persistent `NXDOMAIN`) for the entire session. Confirmed still true as of this report. |

The last row matters most and deserves emphasis: **the one test that most directly answers "what happens when RLS is enabled" — actually flipping it on in a non-production environment (or a scoped test) and hand-crafting anon-key requests against it — has not been run, because this sandbox cannot reach Supabase at all.** Everything in §1–§6 is a very well-supported *prediction* based on eliminating every known legitimate anon-key call site, not a live confirmation that RLS's mechanics behave as expected on this specific project. Given RLS is genuinely simple to design correctly here (default-deny, zero policies — see §2), the residual risk is low, but it is not zero, and this report should not be read as claiming otherwise.

---

## 8. Recommended rollout sequence

Unchanged from the migration plan's own §4/§9, restated here as the concrete next steps:

1. **If possible, do this in a staging/non-production Supabase project first**, or at minimum during a low-traffic window, given §7's gap.
2. Enable RLS on all 11 tables, add zero policies (true default-deny).
3. Immediately re-run the full Phase 5 matrix live: anon-key requests directly against every table (expect empty reads, rejected writes); a handful of real authenticated flows end-to-end (login, post a listing, send a message, leave a review, admin action); one deliberate cross-user attempt per migrated endpoint.
4. **Rollback is instant and safe if anything unexpected surfaces**: `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` per table. This is a pure access-control gate, not a schema or data change — disabling it returns to exactly today's (already-audited) state, nothing is lost.
5. Because `service_role` is never affected by RLS, the server-side application itself carries zero risk in this rollout — the entire risk surface is "did we miss an anon-key caller," which §3–§6 argue is very unlikely and §7 states plainly has not been *proven* impossible, only made very unlikely.

---

## 9. Sign-off checklist

For Vincent's own review before authorizing Phase 4:

- [ ] Confirm `supabase_schema.sql` in the repo is not the operative schema reference (it's missing `reports` and may be missing other drift) — pull the real, current table list from the Supabase dashboard/CLI if a second opinion on §3's 11-table list is wanted.
- [ ] Decide whether to test in staging first, or accept §7's residual risk and go straight to production during a low-traffic window.
- [ ] If a staging Supabase project is available (or connectivity to this one becomes available from wherever Phase 4 is actually executed), run the Phase 5 matrix live before or immediately after enabling RLS, per §8 step 3.
- [ ] Decide whether the `chat_typing` broadcast channel's current open-access behavior (§5) needs a separate look — explicitly out of scope for this RLS decision either way.
- [ ] Give explicit go-ahead for Phase 4 itself — nothing in this report authorizes touching RLS; it remains `BLOCKED_APPROVAL` until this checklist is actioned.
