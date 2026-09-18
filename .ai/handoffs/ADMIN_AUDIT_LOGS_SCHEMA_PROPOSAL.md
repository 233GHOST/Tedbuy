# admin_audit_logs — Schema Proposal

**STATUS: PROPOSAL ONLY. AWAITING APPROVAL. NOTHING BELOW HAS BEEN EXECUTED.** This sandbox has no Supabase credentials — execution is Vincent's alone, same as every other schema change this session (`reports_table_creation.sql`, RLS Phase 4, the three pending feature-schema proposals). No table, RLS, policy, grant, or application code has been created or modified producing this document.

## Context

`admin_audit_logs` is confirmed absent from production (`information_schema.columns` returned zero rows, checked directly by Vincent, 2026-09-16 — see `RLS_PREFLIGHT_AUDIT.md`). Six admin endpoints already contain working insert-attempt code targeting this exact table name; all six currently no-op silently (caught, logged, never blocks the real action) because the table doesn't exist. Reading those six call sites directly (not assumed) surfaced that they disagree with each other on what they write — two real defects, not just style drift:

1. **Security-hold's `admin_user_id` is populated with the admin's email string, not a UID** — the other three action types use the real Firebase UID. If this table were created to match today's code verbatim, that column would silently hold the wrong *kind* of value for one of four action families.
2. **A failed suspend/delete/security-hold attempt leaves zero record.** Each of those three `auditEntry` objects is only ever constructed *after* the real action has already succeeded — there is no code path today that logs an *attempted* admin action that failed.

This proposal is a corrected design, not a verbatim capture of today's inconsistent writes. Closing it fully requires a handful of small, contained code changes at the existing call sites (listed in full below) in addition to creating the table — flagged explicitly so the two pieces of work aren't conflated. The table alone is schema-only and zero-risk; the code changes are a second, separate, small implementation pass this document does not execute.

---

## 1. Exact table schema

```sql
CREATE TABLE public.admin_audit_logs (
  id              TEXT PRIMARY KEY,
  action          TEXT NOT NULL,
  result          TEXT NOT NULL DEFAULT 'success',
  actor_user_id   TEXT NOT NULL,
  actor_email     TEXT,
  target_user_id  TEXT,
  target_email    TEXT,
  target_product_id TEXT,
  session_id      TEXT,
  error_message   TEXT,
  ip_address      TEXT,
  user_agent      TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

No `updated_at` column exists anywhere in this schema, deliberately — see §7 (immutability). Every column is nullable except the five that every single action type, success or failure, always has: `id`, `action`, `result`, `actor_user_id`, `created_at`.

## 2. Constraints / enums / checks

```sql
ALTER TABLE public.admin_audit_logs
  ADD CONSTRAINT admin_audit_logs_result_check
  CHECK (result IN ('success', 'failure'));

ALTER TABLE public.admin_audit_logs
  ADD CONSTRAINT admin_audit_logs_action_check
  CHECK (action IN (
    'impersonate_start',
    'impersonate_exit',
    'impersonate_expired',
    'security_hold_apply',
    'security_hold_release',
    'user_suspend',
    'user_unsuspend',
    'user_delete',
    'boost_admin_activate',
    'boost_admin_deactivate',
    'retention_purge_run'
  ));
```

Note: this lists **11** concrete action values, covering the **8 distinct admin action *types*** this proposal audits (impersonate, security-hold, suspend, delete, boost-control, retention-purge — six existing + two new, per your original count) — several of those types have two directions (apply/release, suspend/unsuspend, activate/deactivate) that need distinct values to be useful in a log, hence 11 rows for 8 action families. If a 9th action type is ever added later, this CHECK constraint requires a follow-up migration to extend it — a deliberate tradeoff (a typo'd action string fails loudly at insert time instead of silently polluting the audit trail with an unrecognized value) rather than leaving `action` unconstrained free text.

`error_message` has no `CHECK` tying it to `result = 'failure'` — enforcing that in SQL adds complexity for a rule the application code should simply always honor (only ever populate `error_message` alongside `result = 'failure'`), consistent with how this codebase already handles similar invariants elsewhere without a DB-level CHECK.

## 3. RLS configuration

```sql
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
-- Zero CREATE POLICY statements — identical to all 10 tables from RLS Phase 4.
```

No grants beyond what already exists project-wide (`GRANT ALL` on `anon`/`authenticated`/`service_role`, inherited from `supabase_schema.sql`'s original blanket grants, same as every other table). With RLS enabled and zero policies, those grants are inert for `anon`/`authenticated` — only `service_role` (i.e., only `server.ts`) can read or write this table at all, exactly the same mechanism already live and verified for the other 10 tables. No new RLS pattern is being invented here.

## 4. Indexes

```sql
CREATE INDEX admin_audit_logs_actor_idx  ON public.admin_audit_logs (actor_user_id, created_at DESC);
CREATE INDEX admin_audit_logs_target_idx ON public.admin_audit_logs (target_user_id, created_at DESC) WHERE target_user_id IS NOT NULL;
CREATE INDEX admin_audit_logs_created_idx ON public.admin_audit_logs (created_at DESC);
```

Three indexes, matched to the three real access patterns the admin read endpoint (§10) needs: "show me everything a specific admin did," "show me everything that happened to a specific account," and the default "most recent activity" view with no filter. The partial index on `target_user_id` (`WHERE ... IS NOT NULL`) skips indexing the rows that have no target at all (retention-purge runs), keeping it smaller than a full index would be for no benefit.

## 5. Retention / exclusion rule

**No automatic purge, and explicit exclusion from the existing retention job.** `POST /api/admin/retention/run-purge` (`server.ts:8945`) already runs a 90-day cycle against unrelated tables (soft-deleted users, expired username quarantines) — this table must never be added to that job or any future one with a similarly short window, since the entire purpose of an audit trail is looking backward, and auto-deleting it on the same cadence as routine user data would defeat that.

This proposal does not set a hard retention period — that's a call I'd leave to you rather than pick a number unprompted. Two real options: **indefinite** (simplest; storage cost is negligible at this table's expected row volume — admin actions, not user activity) or **a long fixed window** (e.g. 1-2 years) if you want an explicit compliance-style policy. Either way, if a retention job is ever built for this table specifically, it should be its own deliberate, separately-approved addition — not folded into the existing 90-day job by default.

## 6. The 8 audited action types (11 concrete `action` values)

| # | Action type | `action` value(s) | Existing call site today | New code needed |
|---|---|---|---|---|
| 1 | Impersonate — start | `impersonate_start` | `server.ts:7928` (via `logImpersonationEvent()`, `server.ts:7708`) | No — already attempts to write in this shape (minor field rename only, see §7) |
| 2 | Impersonate — exit | `impersonate_exit` | `server.ts:8012` | No |
| 3 | Impersonate — expired | `impersonate_expired` | `server.ts:7979` (verify endpoint, on the expired-session branch) | No |
| 4 | Security hold — apply | `security_hold_apply` | `server.ts:8587` route, insert ~`8659` | Yes — fix `actor_user_id` (currently the admin's email, not UID), add failure-path logging, add IP/UA |
| 5 | Security hold — release | `security_hold_release` | same call site as #4 (same endpoint, `hold: false` branch) | Same as #4 |
| 6 | User suspend | `user_suspend` | `server.ts:8686` route, insert ~`8743` | Add failure-path logging, add IP/UA (actor_user_id already correct here) |
| 7 | User unsuspend | `user_unsuspend` | same call site as #6 (`suspend: false` branch) | Same as #6 |
| 8 | User delete | `user_delete` | `server.ts:8768` route, insert ~`8878` | Add failure-path logging, add IP/UA (actor_user_id already correct here) |
| — | Boost admin activate | `boost_admin_activate` | `server.ts:6158` — **no audit write attempted today** | Yes — full new insert, this action currently has zero audit trail |
| — | Boost admin deactivate | `boost_admin_deactivate` | same endpoint, deactivate branch | Same as above |
| — | Retention purge run | `retention_purge_run` | `server.ts:8945` — **no audit write attempted today** | Yes — full new insert (one row per run, `target_user_id`/`target_product_id` both null, counts in `metadata`) |

## 7. Exact code locations / call sites, and what changes at each

- **`server.ts:7708` (`logImpersonationEvent()`)** — the shared helper behind #1-3. Currently builds a `payload` with snake_case keys matching an assumed table shape (`session_id`, `admin_user_id`, `admin_email`, `target_user_id`, `target_user_email`, `action`, `status`, `start_time`, `end_time`, `details`, `created_at`). Column-name changes needed to match §1's schema: `status` → `result` (and its four impersonation-lifecycle values — `'active'`/`'completed'`/`'expired'`/`'revoked'` — need to be reconsidered: `result` in this proposal means success/failure, not lifecycle state; recommend keeping the lifecycle info in `metadata` instead, e.g. `metadata: { lifecycle: 'active' }`, with `result` simply `'success'` for all three impersonation actions since none of them currently have a failure path worth distinguishing), `start_time`/`end_time` → fold into `metadata` (this proposal's `created_at` already timestamps the event itself; a session's start/end pair is better modeled as two separate rows — one `impersonate_start` row and one `impersonate_exit`/`impersonate_expired` row — than as two timestamps on one row), `details` → `metadata`. Add `ip_address`/`user_agent` params, threaded from each of the three call sites' `req` object.
- **`server.ts:7928`** (`/api/admin/impersonate/start`) — call site for #1, needs `ipAddress`/`userAgent` added to the params passed in.
- **`server.ts:7979`** (`/api/admin/impersonate/verify`, expired-session branch) — call site for #3.
- **`server.ts:8012`** (`/api/admin/impersonate/exit`) — call site for #2.
- **`server.ts:8587`** (`/api/admin/accounts/security-hold`), insert around **`8659`** — fix `admin_user_id: String(adminEmail)` → `admin_user_id: verified.uid` (with `actor_email: String(adminEmail)` alongside, matching the pattern already correctly used by suspend/delete). Move the `auditEntry` construction so it also fires (with `result: 'failure'`, `error_message` populated) if the preceding Supabase/Firestore write throws, not only after success. Add `ip_address`/`user_agent` from `req`.
- **`server.ts:8686`** (`/api/admin/users/suspend`), insert around **`8743`** — same failure-path + IP/UA additions as security-hold; `admin_user_id` already correct here.
- **`server.ts:8768`** (`/api/admin/users/delete`), insert around **`8878`** — same failure-path + IP/UA additions; `admin_user_id` already correct here. Note this endpoint already has a real early-return failure path (`server.ts:8873`, "Deletion partially completed but the user record itself could not be removed") that currently logs nothing at all to this table — that specific branch should get a `result: 'failure'` row too.
- **`server.ts:6158`** (`/api/admin/boost-control`) — new insert needed, both the activate and deactivate branches, after the real Supabase write's outcome is known (success or failure), with `target_product_id: productId`, `action: 'boost_admin_activate' | 'boost_admin_deactivate'`, `metadata: { planId }`.
- **`server.ts:8945`** (`/api/admin/retention/run-purge`) — new insert needed, one row per run (not per purged record), after the purge completes, with `target_user_id: null`, `metadata: { purgedCount, skippedHoldCount, releasedQuarantineCount, soldListingsPurged }` (the exact counts this endpoint already computes and returns in its response today).

All of the above is **proposed**, not written — no diff exists yet. Once you approve this document's shape, the actual code changes would be a separate, small, individually-reviewable commit (or a few), verified with `tsc --noEmit`/build/live rejection-path tests the same way every other change this session has been, before the table is ever created.

## 8. Failure-path behavior

The core fix from §"Context" item 2: every one of the 8 action types must attempt an audit write **regardless of whether the real action succeeded**, wrapping the real action in a pattern like:

```ts
let result: 'success' | 'failure' = 'success';
let errorMessage: string | null = null;
try {
  // ... the real Supabase/Firestore write(s) ...
} catch (err: any) {
  result = 'failure';
  errorMessage = err?.message || 'Unknown error';
  // still fall through to the audit insert below, then return the real
  // error response to the caller -- the audit write must never be what
  // gates or delays the actual response
}
await backendSupabase.from('admin_audit_logs').insert({ ...fields, result, error_message: errorMessage }).catch((auditErr) => {
  console.warn('[Admin Audit Log] Insert failed:', auditErr?.message);
  // never throw -- an audit-log write failure must never block or mask
  // the real action's own success/failure response, matching the
  // existing .catch(() => {}) discipline already used at every one of
  // these call sites today
});
```

The audit insert itself keeps today's already-correct discipline: wrapped in its own catch, never allowed to throw, never allowed to change the real endpoint's response. An audit-log outage must degrade to "no audit trail for this one action" (same as today, for everything), never to "the admin action itself stops working."

## 9. IP / user-agent capture

`ip_address` sourced from `req.headers['cf-connecting-ip']` — the same trusted-IP source this session's rate-limiter fix (`55dd825`) established as correct for this app's confirmed Cloudflare→Render→Express production topology (never `X-Forwarded-For`, for the same spoofability reason documented there). `user_agent` sourced from `req.headers['user-agent']` directly (not security-critical, purely a forensic convenience — a client can freely lie about this, unlike `cf-connecting-ip`, so it should never be treated as authoritative, only descriptive). Both nullable — captured on a best-effort basis, absence doesn't block the action or the audit row.

## 10. Admin read endpoint design

**New requirement, not optional**: a write-only audit trail nobody inside the app can view is only reachable via raw Supabase Table Editor access — not useful day-to-day. Two options:

- **(Recommended) Generalize the existing `GET /api/admin/impersonate/logs` (`server.ts:8030`)** into `GET /api/admin/audit-logs`, keeping the old path as an alias if anything still calls it. Already `verifyAdmin()`-gated, already has a rate limiter (30/min), already returns `{ success: true, logs: [...] }` shaped for a list view — the query itself just needs to drop its current implicit impersonation-only scoping and support the real filters an admin would want:
  - `?action=<value>` — filter by action type
  - `?actorUserId=<uid>` — "everything this admin did"
  - `?targetUserId=<uid>` — "everything that happened to this account"
  - `?limit=<n>&cursor=<created_at>` — pagination, since this table only grows
  - No filter at all → most recent N rows, descending by `created_at` (uses the plain `admin_audit_logs_created_idx`)
- Response shape: `{ success: true, logs: AuditLogRow[], nextCursor: string | null }`, each row already safe to return as-is (no PII redaction needed beyond what's already in the columns — this table only ever contains admin-initiated actions, not general user data).

Building a UI to browse this (an admin-panel screen/tab) is explicitly **out of scope for this proposal** — the endpoint is the minimum needed for the data to be reachable at all; whether/when to build a dedicated viewer screen is a separate, later product decision.

## 11. Tests required

Before this ships (once approved), the same discipline as every other schema/endpoint change this session:

- **Rejection-path tests, executed live against a local dev server** (not just traced by eye) for the new/modified endpoints: `GET /api/admin/audit-logs` (or the generalized `/impersonate/logs`) returns `403` with no auth header and with a non-admin token; each of the 8 write call sites still returns its normal success/error response shape to the caller even when the audit insert itself is made to fail (simulate by temporarily pointing at a nonexistent table name, or by asserting the `.catch()` truly swallows).
- **A real failure-path test** for at least one of security-hold/suspend/delete — deliberately trigger the real action's failure (e.g. a nonexistent `targetUserId`) and confirm a `result: 'failure'` row is actually written, not just that the fix compiles.
- **Column-shape verification**: after the table is created, trigger each of the 8 action types once for real (in a safe/test context, e.g. Vincent's own admin account impersonating a disposable test account) and confirm via Table Editor that every row has the expected non-null fields for its type — this is the direct successor to `RLS_PHASE5_VERIFICATION.md`'s already-established "real credentials needed, Vincent-only" testing gap.
- `tsc --noEmit` and full production build clean, as always, before any commit.
- Confirm via the Supabase dashboard (same method already used for RLS Phase 4/5) that `rls_enabled = true` and zero rows in `pg_policies` for this table specifically, post-creation.

## 12. Rollback plan

Two independent, safe rollback layers:

**Table-level (if something is wrong with the schema itself):**
```sql
DROP TABLE IF EXISTS public.admin_audit_logs;
```
Every one of the 8 write call sites already tolerates this table not existing (that's its current, live, safe state) — dropping it returns the app to exactly today's behavior with zero functional impact, same reasoning already established for `reports_table_creation.sql`'s own rollback story.

**Code-level (if the §7 call-site changes need to be reverted but the table should stay)**: each call site's change is proposed as its own small, isolated commit — reverting any one of them via `git revert` returns that specific action type to writing whatever shape it wrote before (or to no write at all, for the two brand-new ones), without affecting the table or the other seven action types. No data migration is ever needed for a rollback in either direction, since this is a pure audit/logging feature with no other part of the application reading from or depending on this table's contents (confirmed: `admin_audit_logs` is referenced nowhere in `src/` or `mobile/src/` today, only in `server.ts`'s own write/read paths listed above).

---

## What happens after this is approved

1. You review this document and tell me what to change, if anything (action list, retention decision, endpoint filter set, etc.).
2. Once approved as-is: the §7 code changes ship first, as their own small commits, fully tested per §11 against the *current* (table-absent) production — since every call site already degrades gracefully, this is zero-risk to ship before the table exists.
3. You run the §1-4 SQL yourself in the Supabase SQL Editor (same as every other schema change this session).
4. A final live verification pass (§11's real-credentials rows) confirms all 8 action types actually populate correctly in production.
