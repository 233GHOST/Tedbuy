# RLS Phase 4 — Enablement Proposal

**STATUS: AWAITING APPROVAL. NOTHING BELOW HAS BEEN EXECUTED.** No SQL in this document has been run against production. No tool call in this session has touched the database, schema, RLS state, policies, or grants. This sandbox has no Supabase credentials for the production project in any case — execution is Vincent's alone, matching the established pattern (`reports_table_creation.sql`).

Produced per Vincent's explicit Phase 4 instruction (2026-09-16), built from `RLS_PREFLIGHT_AUDIT.md` (`c78beee`, verdict: READY FOR RLS) and `RLS_ENABLEMENT_READINESS_REPORT.md`. No application code was touched to produce this. No unrelated schema (e.g. `products.updatedAt`) is referenced. `admin_audit_logs` is deliberately excluded — see §1.

---

## 1. Exact tables that will have RLS enabled

All **10** tables confirmed to currently exist in production:

`users`, `products`, `chats`, `messages`, `reviews`, `reports`, `notifications`, `store_names`, `boost_purchases`, `account_deletion_audits`

**Excluded on purpose: `admin_audit_logs`.** Confirmed absent from production (`information_schema.columns` returned zero rows, 2026-09-16). Per instruction #6, this proposal does not create it and does not reference it further — enabling RLS on a table that doesn't exist isn't a meaningful operation anyway.

---

## 2. Exact SQL

```sql
-- RLS Phase 4 — enable RLS, zero policies (true default-deny).
-- No CREATE POLICY statements anywhere in this script — see §2a for why
-- that's correct even for the tables with legitimate public-facing data.
-- Grants are untouched (see §2b) — the server's service_role client has
-- BYPASSRLS and is completely unaffected by any of this.

ALTER TABLE public.users                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_names              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boost_purchases          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_audits  ENABLE ROW LEVEL SECURITY;
```

That's the entire change set. Ten statements, no policy creation, no grant changes, no schema changes.

### 2a. Why zero policies, even for `users`/`products`/`reviews`/`store_names` (which have real public-access needs)

Per instruction #3, a public-access policy exception is only warranted if the migration plan *explicitly* identifies one as legitimate. It doesn't — the opposite: `SUPABASE_RLS_MIGRATION_PLAN.md`'s own Phase 3 recommendation, restated in the readiness report and preflight audit, is that genuinely public data (`products` feed/detail, `reviews` list, `store_names` availability-check, `users/get`/`users/list`) stays **server-mediated** rather than getting a raw RLS-policy public-read grant — because the existing server endpoints already do more than a table-level policy could (moderation filtering on products, PII-stripping on user directory reads, scoped-vs-unscoped review queries). A `CREATE POLICY ... FOR SELECT USING (true)` would functionally re-open direct anon-key table access — exactly what this migration exists to close. So: no table in this change set gets a policy. Every public read continues to go through its existing server endpoint, which already works today and is completely unaffected by RLS (`service_role` bypasses it).

### 2b. Grants — untouched, per instruction #8

`anon`/`authenticated`/`service_role` currently hold `GRANT ALL` on 9 of these tables (from `supabase_schema.sql`) plus `reports` (from `reports_table_creation.sql`). This script does not revoke anything. Once RLS is enabled with zero policies, those grants become **inert** for `anon`/`authenticated` — Postgres evaluates RLS as an additional gate on top of grants, and zero policies means zero visible/writable rows for any role without the `BYPASSRLS` attribute. `service_role` has that attribute and keeps working regardless of RLS state. Leaving the grants in place costs nothing and matches the instruction not to touch them "unless the approved migration plan explicitly requires it" — it doesn't.

---

## 3. Expected impact

**Summary: no impact on any legitimate operation, on any of the 10 tables.** Confirmed via `RLS_PREFLIGHT_AUDIT.md`'s cross-cutting confirmations (restated per instruction #5):

- **The server is the only legitimate writer/reader left**, and it authenticates exclusively as `service_role` — one `createClient()` call in `server.ts` (`backendSupabase`), 211 references throughout the file, all sharing that one client. Confirmed live in production (`role: service_role`, no warning, Render deploy log). `service_role` has Postgres's `BYPASSRLS` attribute — RLS policy state (including zero policies) has zero effect on it, by Postgres design, not by anything this app does.
- **The browser client (`src/dbAdapter.ts`) has no remaining direct-Supabase call sites** on any of the 10 tables — confirmed structurally (`VALID_TABLE_MAP`/`TABLE_COLUMNS` bound what the client can even construct a request for) and behaviorally (every real call site across 25 individually-verified checkpoints was migrated to a `verifyUser()`/`verifyAdmin()`-gated server endpoint). A repo-wide grep today returns only dev/sandbox-only exceptions with no real Firebase identity to exploit.
- **Mobile has zero Supabase dependency** (confirmed: no SDK import anywhere in `mobile/src/`; its only direct-database access is Firestore, a separate system).

Per-table, the only thing that actually changes is **what a caller with just the anon key, bypassing the app entirely, can do directly against Supabase's PostgREST API** — today that's `GRANT ALL`-level access (full read/write) on every one of these tables; after this change it's nothing (empty reads, rejected writes), on all 10, uniformly. That's the intended effect. No legitimate feature depends on that path — it was the entire finding of the RLS migration effort.

Two non-blocking residuals already documented and unaffected by this change either way (not touched here, not required for RLS to be safe): `products`'s client column allow-list is broader than strictly needed (`viewsCount`/`likesCount`/`likedUserIds`, no live write path); the `admin_audit_logs` gap (six admin endpoints already degrade gracefully with it missing, per §"admin_audit_logs finding" in the preflight audit).

---

## 4. Rollback SQL

Instant, per-table, and safe — RLS is purely an access-control gate, not a schema or data change. Disabling it returns exactly to today's (already-audited) state; nothing is lost or altered.

```sql
ALTER TABLE public.users                    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.products                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats                    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_names              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.boost_purchases          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_audits  DISABLE ROW LEVEL SECURITY;
```

Can be run as a full block or selectively — e.g. if something unexpected surfaces on just one table, disabling RLS on that single table alone is a valid, safe partial rollback while leaving RLS enabled on the other nine.

---

## 5. Production verification matrix

The migration plan's Phase 5 matrix has four identity rows. Restated here with an honest status for each — what's already been verified, what can only be verified by Vincent (this sandbox has no real Supabase anon key or real Firebase ID tokens for the production project):

| Row | What to check | Who can run it | Status |
|---|---|---|---|
| **Anonymous vs. Supabase directly** | Hand-craft a request with just the anon key against each table's REST endpoint, e.g. `GET https://hnfqymkdgadwzrjenaqf.supabase.co/rest/v1/users` with header `apikey: <anon key>` — expect `200` with `[]` (or a permission-denied response, depending on PostgREST's RLS-vs-grant interaction) on every table, both before enabling (sanity-check the test itself works and currently returns real rows) and after (confirm it returns nothing). This is the single most direct confirmation that RLS is doing what it's supposed to. | **Vincent only.** This sandbox has no anon key for the real project (the DNS/hostname confusion earlier this session is resolved — the host resolves — but no valid `apikey` header can be sent from here). | Not yet run. |
| **Normal authenticated user — full app flow** | Through the real app/website: log in, view the feed, open a product, send a message, leave a review after a real trade, edit profile. Confirm everything still works exactly as before. | Vincent (or shared with this session if he wants a second pass). | Not yet run. The no-auth/forged-token *rejection* half was already verified live across all 64 endpoints earlier this session — that's unaffected by RLS either way, since it's server-side auth, not RLS. |
| **Cross-user** | Attempt (via the app, or a direct API call with a real token) to read or modify another user's data — e.g. edit someone else's product, mark someone else's chat delivered. Confirm still rejected. | Vincent. | Not yet run. Expected unaffected by this change specifically — cross-user protection is enforced by `server.ts`'s explicit ownership checks, which run whether or not RLS is on, since the server uses `service_role` either way. Still worth a real confirmation pass after enabling. |
| **Admin** | Through the admin panel: security-hold a test account, suspend/unsuspend, impersonate, run a boost control action. Confirm all still work. | Vincent. | Not yet run. Same reasoning as cross-user — these depend on `service_role`, expected fully unaffected. |

**Recommended order:** enable RLS first (§2's SQL), then immediately run the anonymous-vs-Supabase-directly check (the one row that actually tests RLS itself) before doing anything else, since it's the only row with a plausible chance of surfacing something unexpected. If it looks wrong, disable RLS on the affected table immediately (§4) and report back before continuing. If it looks right, the other three rows are a normal smoke-test pass through the live app/admin panel — they're testing that authenticated flows are unaffected, not testing RLS itself, since `service_role` was never going to be touched by this change.

---

## 6. Explicit stop

**This proposal has not been executed.** No SQL from §2 has been run. This document is the deliverable requested by instruction #9 — tables, SQL, impact, rollback, verification matrix — for Vincent's review.

Per instruction #10: stopping here. Awaiting explicit approval before any of the §2 SQL is applied. Should approval be given, Vincent runs it himself via the Supabase SQL editor (this sandbox has no execution capability against production regardless of approval), and this document can be marked applied afterward, mirroring how `reports_table_creation.sql` was finalized.
