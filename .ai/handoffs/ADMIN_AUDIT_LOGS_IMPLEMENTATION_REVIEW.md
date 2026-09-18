# admin_audit_logs — Implementation Review

**STATUS: IMPLEMENTATION REVIEW ONLY — NO DATABASE OR CODE CHANGES MADE.** Builds on the shape already approved in `ADMIN_AUDIT_LOGS_SCHEMA_PROPOSAL.md` (commit `6ba4733`). No `CREATE TABLE`, no `ALTER TABLE`, no RLS/policy/grant change, no application code change, no deployment. This document is the exact-SQL and exact-code-diff review Vincent asked for as the next step after shape approval — still nothing to sign off on except the shapes below.

Every code-facing claim in this document was re-verified against the current `server.ts` moments before writing it (line numbers current as of this review, not carried over stale from the shape proposal).

---

## 1. Exact `CREATE TABLE` SQL

```sql
CREATE TABLE public.admin_audit_logs (
  id                 TEXT PRIMARY KEY,
  action             TEXT NOT NULL,
  result             TEXT NOT NULL DEFAULT 'success',
  actor_user_id      TEXT NOT NULL,
  actor_email        TEXT,
  target_user_id     TEXT,
  target_email       TEXT,
  target_product_id  TEXT,
  session_id         TEXT,
  error_message      TEXT,
  ip_address         TEXT,
  user_agent         TEXT,
  metadata           JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

COMMENT ON TABLE public.admin_audit_logs IS
  'Append-only security audit trail for 8 defined admin action types
   (see ADMIN_AUDIT_LOGS_SCHEMA_PROPOSAL.md). Application code must never
   UPDATE or DELETE a row here. Not a general-purpose logging table --
   do not add a 9th action type without a deliberate, separate decision.';
```

**Every column, NULL/NOT NULL, and why:**

| Column | Type | Null? | Reasoning |
|---|---|---|---|
| `id` | `TEXT` | `PRIMARY KEY` (implies `NOT NULL`) | Matches this app's existing ID convention (`notif_...`, `report_...`) rather than a native `UUID` type — every other table in this schema uses `TEXT` ids, no reason for this one to be the exception. |
| `action` | `TEXT` | `NOT NULL` | Every row is *about* an action; there's no valid row without one. Constrained by the CHECK above. |
| `result` | `TEXT` | `NOT NULL DEFAULT 'success'` | Every action attempt has an outcome, success or failure — this is the field the "record failures too" fix (§7) hinges on. Default `'success'` only matters for the 3 impersonation actions (§4), which never have a failure branch today. |
| `actor_user_id` | `TEXT` | `NOT NULL` | The one column this entire table exists to get right — see §6. No row is meaningful without knowing who acted. |
| `actor_email` | `TEXT` | nullable | Supplemental/readability only, per Vincent's explicit decision — never the identity source. |
| `target_user_id` | `TEXT` | nullable | Null for `retention_purge_run` (no single target) and for boost-control (target is a product, not a user). |
| `target_email` | `TEXT` | nullable | Same reasoning as `actor_email` — readability, not identity. |
| `target_product_id` | `TEXT` | nullable | Only populated for `boost_admin_activate`/`boost_admin_deactivate`; null for every user-targeted or targetless action. |
| `session_id` | `TEXT` | nullable | Only meaningful for the 3 impersonation actions (ties `impersonate_start`/`impersonate_exit`/`impersonate_expired` rows for the same session together). Null elsewhere. |
| `error_message` | `TEXT` | nullable | Populated only when `result = 'failure'`. No DB-level CHECK tying the two together — see the shape proposal's §2 reasoning (an app-level invariant, not worth a CHECK's complexity here). |
| `ip_address` | `TEXT` | nullable | Best-effort capture (§8) — never blocks the action or the audit row if absent. |
| `user_agent` | `TEXT` | nullable | Same as above; descriptive only, never authoritative (a client can freely lie about this string). |
| `metadata` | `JSONB` | nullable | Action-specific detail only — see §9's representative examples per action type. |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Server-generated, never client-supplied — see §1 of the original proposal. |

**Foreign keys: deliberately none.** Three reasons, all specific to this table's purpose:

1. **Referential integrity would work against the audit trail's own purpose.** If `target_user_id` had a `REFERENCES public.users(id)` foreign key, deleting a user (a real, existing admin action — `user_delete`) would either fail the delete (if `ON DELETE RESTRICT`, blocking the very action being logged) or silently null out/cascade-delete the historical record of that deletion (`ON DELETE SET NULL`/`CASCADE`) — either behavior actively fights the goal of keeping a permanent record of what happened to an account that no longer exists.
2. **`actor_user_id` has the identical problem** — an admin's own account should never be deletable in practice (the super-admin account is explicitly protected elsewhere in this codebase), but a hypothetical future admin-account deletion shouldn't be able to touch or block historical audit rows attributing past actions to that admin.
3. **This matches the precedent already set for `reports`/`reviews`/`notifications`** in this same schema — none of those tables use foreign keys to `users`/`products` either; ownership/target relationships are enforced by application code (here: `server.ts`'s own `verifyUser()`/`verifyAdmin()` checks before a row is ever constructed), not by the database schema. No new pattern is being introduced.

---

## 2. Exact indexes

```sql
CREATE INDEX admin_audit_logs_actor_idx   ON public.admin_audit_logs (actor_user_id, created_at DESC);
CREATE INDEX admin_audit_logs_target_idx  ON public.admin_audit_logs (target_user_id, created_at DESC) WHERE target_user_id IS NOT NULL;
CREATE INDEX admin_audit_logs_created_idx ON public.admin_audit_logs (created_at DESC);
```

Three indexes, each matched to one real query the §10 read endpoint needs — no speculative indexing:

- **`admin_audit_logs_actor_idx`** — supports `?actorUserId=<uid>` ("show me everything this admin did"), pre-sorted by recency so no separate sort step is needed after the index scan.
- **`admin_audit_logs_target_idx`** — supports `?targetUserId=<uid>` ("show me everything that happened to this account"). Partial (`WHERE target_user_id IS NOT NULL`) so the `retention_purge_run` rows (which never have a target) don't bloat an index that will never be used to find them by target.
- **`admin_audit_logs_created_idx`** — supports the default, no-filter view (most recent activity first) and backs the `?action=`/`?result=` filters too, which at this table's realistic row volume (admin actions, not user activity — low thousands of rows a year at most) don't need their own dedicated index; a sequential scan over an already-small, already-`created_at`-sorted result set is cheap enough that indexing every filterable column would be over-engineering for the actual traffic this table will see.

No index on `session_id` — it's only ever looked up as "the 2-3 rows for one impersonation session," a query volume too low to justify an index, and not one of the filters §10 exposes.

---

## 3. RLS

```sql
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
-- Zero CREATE POLICY statements.
```

**Why `service_role`/`server.ts` remains the only application writer/reader**: this project has no Supabase Auth session anywhere (confirmed exhaustively during the original RLS migration design — the browser only ever authenticates to Firebase, never to Supabase). `auth.uid()` is always `NULL` for any browser-originated request, so no RLS policy could express "an admin can read their own audit rows" even if that were desired — there is no Supabase-level identity to write such a policy against. The only real identity system this app has is Firebase, verified exclusively inside `server.ts` via `verifyUser()`/`verifyAdmin()` (§6) — which is precisely why every other table in this schema already funnels all real authorization through the server rather than through RLS policies, and why zero policies plus `service_role`-only access is correct here too, not merely convenient.

**This is the exact same pattern already live and verified on the 10 existing tables** (`ADMIN_AUDIT_LOGS_SCHEMA_PROPOSAL.md`'s own reasoning, and confirmed via this session's own live verification pass: `anon`/`authenticated` writes against RLS-enabled, zero-policy tables return either a `42501` RLS-violation error for `INSERT` or an empty, zero-rows-matched result for `UPDATE` — same mechanism, same guarantee, no new RLS behavior being introduced for this table).

Grants: none added or changed. The project's existing blanket `GRANT ALL` (inherited from `supabase_schema.sql`) would apply to this table too if granted the same way as the others, but becomes inert for `anon`/`authenticated` the moment RLS is enabled with zero policies — `service_role` alone remains capable of anything, by Postgres's own `BYPASSRLS` semantics, independent of grants or policies.

---

## 4. Audit actions — final concrete values, confirmed

Exactly the 8 action types, 11 concrete `action` values, from the approved shape — re-confirmed here, unchanged:

| Action type | `action` value |
|---|---|
| Impersonate — start | `impersonate_start` |
| Impersonate — exit | `impersonate_exit` |
| Impersonate — expired | `impersonate_expired` |
| Security hold — apply | `security_hold_apply` |
| Security hold — release | `security_hold_release` |
| User suspend | `user_suspend` |
| User unsuspend | `user_unsuspend` |
| User delete | `user_delete` |
| Boost admin activate | `boost_admin_activate` |
| Boost admin deactivate | `boost_admin_deactivate` |
| Retention purge run | `retention_purge_run` |

**Scope boundary preserved, restated from the approved proposal**: these 11 values are the entire universe of what this table will ever record. The `action` CHECK constraint in §1 enforces this at the database level — a 12th value fails the insert outright rather than silently expanding the table's purpose. This table is not, and must not become, a general-purpose application event log.

---

## 5. Exact code call sites — current behavior, proposed behavior, what's recorded

### 5.1 `server.ts:7708` — `logImpersonationEvent()` (shared helper behind #1-3)

**Current behavior**: builds a `payload` with snake_case keys (`session_id`, `admin_user_id`, `admin_email`, `target_user_id`, `target_user_email`, `action`, `status`, `start_time`, `end_time`, `details`, `created_at`) and inserts it. `status` currently carries lifecycle values (`'active'`/`'completed'`/`'expired'`/`'revoked'`), not success/failure. Identity (`adminUserId`) is passed in by each of the 3 call sites below, always sourced from a real `verifyUser()`/`verifyAdmin()` result at each of them (verified — see §6).

**Proposed behavior**: rename the payload's field mapping to match §1's column names (`admin_user_id`→`actor_user_id`, `admin_email`→`actor_email`, `target_user_id` unchanged, `target_user_email`→`target_email`, `details`→`metadata`). Fold `start_time`/`end_time`/the lifecycle `status` value into `metadata` (e.g. `metadata: { lifecycle: 'active' }`) rather than dedicated columns — a session's start and end are two separate rows (one `impersonate_start`, one `impersonate_exit`/`impersonate_expired`) rather than two timestamps on one row, consistent with this table's append-only design. `result` is `'success'` for all three impersonation actions — none of them have a meaningful failure branch today (starting/ending an impersonation session is in-memory bookkeeping, not a database write that can meaningfully fail the way suspend/delete can). Add `ip_address`/`user_agent` parameters, threaded from each of the 3 call sites.

**What gets recorded**: `actor_user_id` (real admin uid), `target_user_id` (the impersonated account), `session_id`, `action`, `result: 'success'`, `metadata.lifecycle`, `ip_address`/`user_agent`, `created_at`.

### 5.2 `server.ts:7928` — call site for `impersonate_start`, inside `POST /api/admin/impersonate/start`

**Current**: calls `logImpersonationEvent({ adminUserId: verifiedUser.uid, ... })` — `verifiedUser` here already comes from a real `verifyUser()` call earlier in this same handler (confirmed, §6). **Proposed**: add `ipAddress`/`userAgent` from `req` to the call. **Success path**: row written after the impersonation session is created. **Failure path**: this endpoint's only realistic failure modes (target not found, self-impersonation blocked, super-admin-impersonation blocked) all `return` *before* reaching this call today — meaning a failed impersonation attempt currently logs nothing. Recommend adding a `result: 'failure'` row on the "target is protected/not found" rejection paths too, so a real security-relevant event (someone trying to impersonate the super-admin, or a nonexistent user) leaves a trace — flagged here as a scope question for Vincent, since it wasn't explicitly listed as one of the 8 action types' failure requirements in the approved shape (only suspend/delete/security-hold were named as needing failure-path logging) — recommend including it since the reasoning is identical, but not assuming the decision.

### 5.3 `server.ts:7979` — call site for `impersonate_expired`, inside `POST /api/admin/impersonate/verify`

**Current**: `logImpersonationEvent(...)` called (not even `await`ed) only on the branch where an existing session is found to have expired. **Proposed**: add `ipAddress`/`userAgent`. No failure path relevant here — session expiry is a fact being recorded, not an action that can fail.

### 5.4 `server.ts:8012` — call site for `impersonate_exit`, inside `POST /api/admin/impersonate/exit`

**Current**: `await logImpersonationEvent({ adminUserId: verified.uid, ... })`, `verified` from a real `verifyUser()` call in this handler. **Proposed**: add `ipAddress`/`userAgent`.

### 5.5 `server.ts:8587` — `POST /api/admin/accounts/security-hold`, insert at `~8659`

**Current**: already calls `verifyUser()` (not `verifyAdmin()`), so `verified.uid` (real UID) is available — confirmed by direct code read (§6). The bug: the existing `auditEntry.admin_user_id` is set to `String(adminEmail)`, not `verified.uid`. The insert is also only ever reached *after* the real Supabase/Firestore writes have already succeeded.

**Proposed**: (1) fix `admin_user_id: String(adminEmail)` → `actor_user_id: verified.uid`, with `actor_email: String(adminEmail)` alongside; (2) wrap the real write in try/catch, construct and insert the audit row in *both* the success and catch paths (§7 has the exact pattern), `result`/`error_message` reflecting which branch executed; (3) add `ip_address`/`user_agent` from `req`.

**What gets recorded**: `actor_user_id` (real uid, fixed), `actor_email`, `target_user_id`, `action: security_hold_apply | security_hold_release`, `result`, `error_message` (on failure), `metadata: { reason }`.

### 5.6 `server.ts:8686` — `POST /api/admin/users/suspend`, insert at `~8743`

**Current**: already calls `verifyUser()`, `admin_user_id: verified.uid` is already correct here (confirmed — this endpoint does not have the security-hold identity bug). Insert only reached after success, same as security-hold.

**Proposed**: (1) add the same try/catch-both-paths pattern as §5.5; (2) add `ip_address`/`user_agent`. No identity fix needed here — only the failure-path addition.

**What gets recorded**: `actor_user_id`, `actor_email`, `target_user_id`, `action: user_suspend | user_unsuspend`, `result`, `error_message` (on failure), `metadata: { targetUsername }`.

### 5.7 `server.ts:8768` — `POST /api/admin/users/delete`, insert at `~8878`

**Current**: already calls `verifyUser()`, `admin_user_id: verified.uid` already correct. This endpoint has a real, already-existing early-failure branch (`server.ts:8873`-ish, "Deletion partially completed but the user record itself could not be removed") that today logs nothing to this table at all.

**Proposed**: (1) same try/catch-both-paths pattern, explicitly including that existing partial-failure branch — it should produce a `result: 'failure'` row too, not just the general catch; (2) add `ip_address`/`user_agent`.

**What gets recorded**: `actor_user_id`, `actor_email`, `target_user_id`, `action: user_delete`, `result`, `error_message`, `metadata: { targetUsername, deletedProductCount }` (the count is already computed by this endpoint today, just never persisted to an audit table).

### 5.8 `server.ts:6158` — `POST /api/admin/boost-control` (`activate`/`deactivate` branches)

**Current**: calls `verifyAdmin()` (boolean only) — **no identity is available at all today**, this is a real, additional code change beyond "add an insert," not just a new insert statement. No audit write attempted at all currently, for either branch. Branching is `if (action === 'activate') { ... } else { /* implicit deactivate */ }` (confirmed — there's no explicit `action === 'deactivate'` check, "not activate" is treated as deactivate).

**Proposed**: (1) switch the auth call from `verifyAdmin(req.headers.authorization)` to `verifyUser(req.headers.authorization)`, checking `verified?.isAdmin || verified?.originalAdmin` for the same authorization decision as before (matches the pattern already used at security-hold/suspend/delete) — this is the one call site needing an auth-mechanism change, not just an audit-insert addition; (2) after the real Supabase/Firestore write's outcome is known, insert a row with `target_product_id: productId`, `action: boost_admin_activate | boost_admin_deactivate`, `metadata: { planId, durationDays, boostEndDate }` for activate, `metadata: {}` for deactivate.

**What gets recorded**: `actor_user_id`, `actor_email`, `target_product_id`, `action`, `result`, `error_message` (on failure), `metadata`.

### 5.9 `server.ts:8945` — `POST /api/admin/retention/run-purge`

**Current**: also calls `verifyAdmin()` (boolean only) — same identity gap as boost-control. No audit write attempted today.

**Proposed**: (1) same `verifyAdmin()` → `verifyUser()` switch as §5.8; (2) one insert per run (not per purged record) after the purge completes, with `target_user_id: null`, `target_product_id: null`, `metadata: { purgedCount, skippedHoldCount, releasedQuarantineCount, soldListingsPurged }` — these four counts are already computed and returned in this endpoint's own response today, just never persisted.

**What gets recorded**: `actor_user_id`, `actor_email`, `action: retention_purge_run`, `result`, `metadata` (the four counts).

### 5.10 `server.ts:8030` — `GET /api/admin/impersonate/logs`

Not a write call site — this is the read endpoint §10 proposes generalizing. Listed here for completeness of "every call site," not because it needs a write-path change.

**All of the above is proposed, not written.** No diff exists yet.

---

## 6. Identity correctness — `actor_user_id` sourcing, verified

**Claim to verify**: `admin_user_id`/`actor_user_id` always comes from the cryptographically verified Firebase UID, never from a client-supplied email/header/body value.

**Verified from `server.ts:276-326` (`verifyUser()`)**: the only path to a non-null return is `getAdminAuth().verifyIdToken(token)` succeeding — Firebase Admin SDK's own cryptographic signature verification of a real ID token. `uid` in the returned object is `decoded.uid`, taken directly from that verified token, never from any request header or body field. Any failure (forged, unsigned, malformed, expired, wrong signature) returns `null`, which every one of the 8 call sites already correctly treats as "reject the request" (confirmed at each of §5.1-5.9).

**One real nuance, checked specifically for this table**: `verifyUser()` supports an *impersonation* swap — when a second argument (`impersonationSessionId`) is passed and the caller is an admin with an active impersonation session, it returns the **impersonated target's** `uid`, not the real admin's, plus a separate `originalAdmin: { uid, email }` field carrying the real admin's identity. If any of the 8 relevant call sites passed this argument, `verified.uid` could silently become the *target's* uid instead of the real actor's — which would misattribute an audit row to the wrong person.

**Checked directly, all 8 call sites**: none of them pass a second argument to `verifyUser()`/`verifyAdmin()` — confirmed by reading each call (`server.ts:8596`, `8686`-area, `8768`-area all call `verifyUser(req.headers.authorization)` with exactly one argument; the three impersonation call sites at `7843`/`7954`/`7994` likewise). The impersonation-swap branch inside `verifyUser()` only activates when `sessId` is truthy — it never is, at any of these 8 sites. **`verified.uid` is therefore always the real, actual admin's own UID at every one of the 8 call sites, with no impersonation-attribution risk** — this was checked, not assumed.

**The one place identity sourcing needs an actual code change, not just verification**: `server.ts:6159` (boost-control) and `server.ts:8945` (retention-purge) currently call `verifyAdmin()`, which returns only a `boolean` — no `uid` is available at either call site today. Implementing audit logging there requires switching to `verifyUser()` first (§5.8, §5.9), which is a real, if small, functional change to how those two endpoints authenticate — not just an additive insert statement.

**`actor_email` is explicitly supplemental**, exactly as decided: sourced from the same verified `decoded.email` (still real, still Firebase-verified, just the email field rather than the uid field) — never from a client-supplied header (the security-hold code comment at `server.ts:8589-8595` documents that this exact pattern — a client-controllable `x-admin-email` header — was already found and removed as a real bug in an earlier pass, which is direct, existing evidence for why this table must not repeat that mistake).

---

## 7. Failure logging — try/catch ordering and error-handling behavior

**Design, applied identically at security-hold, suspend, delete, and boost-control** (the four action types with a real write that can fail):

```ts
let result: 'success' | 'failure' = 'success';
let errorMessage: string | null = null;

try {
  // ... the real Supabase/Firestore write(s), exactly as they exist today ...
} catch (err: any) {
  result = 'failure';
  errorMessage = err?.message || 'Unknown error';
  // Deliberately does NOT re-throw here or return early -- falls through to
  // the audit insert below first, THEN to whatever error response the
  // endpoint already sends today. The audit write must happen regardless
  // of which branch the real action took.
}

// Always attempts this insert, success or failure branch alike:
await backendSupabase.from('admin_audit_logs').insert({
  id: crypto.randomUUID(),
  action: '...',
  result,
  actor_user_id: verified.uid,
  actor_email: verified.email || null,
  target_user_id: targetUserId,
  error_message: errorMessage,
  ip_address: ipAddress,
  user_agent: userAgent,
  metadata: { /* action-specific */ },
}).catch((auditErr) => {
  // Never throws. An audit-log write failure must never change or mask
  // the real action's own success/failure outcome -- matches the
  // .catch(() => {}) discipline already used at every existing call site.
  console.warn('[Admin Audit Log] Insert failed:', auditErr?.message);
});

// Only NOW does the endpoint return its real response to the caller --
// unchanged from today's behavior in the success case; in the failure
// case, whatever error response already exists today is preserved exactly,
// the audit insert is purely an addition alongside it, never a replacement.
```

**The two invariants this design protects, explicitly**:

1. **A failed admin operation produces a failure audit record where possible.** "Where possible" is doing real work here: if the failure happens *before* `verified`/`targetUserId` are even known (e.g. a malformed request body, a missing auth header — both already `return` before reaching any of this code today), there is nothing meaningful to attribute a row to, and no row is attempted — this matches how every rejection in this codebase already works (a `401`/`400` before identity is established never had anything to log in the first place, audit table or not). Once the code is past `verifyUser()`'s check, a failure *always* attempts a row.
2. **An audit-write failure must never falsely change the result of the underlying administrative operation.** The `.catch(() => {})` (or the `console.warn`-and-swallow shown above) on the audit insert itself guarantees this — if `admin_audit_logs` is briefly unreachable, unavailable, or the insert fails for any reason, the real suspend/delete/security-hold/boost action's own success or failure is decided entirely by its own try/catch, computed and returned *before or independent of* whether the audit row landed. This is the same discipline already present in all 6 existing (currently no-op) call sites today (`.catch(() => {})` at each), just now also covering the failure branch, not only the success branch.

---

## 8. IP and user agent

```ts
const ipAddress = (req.headers['cf-connecting-ip'] as string) || req.socket.remoteAddress || 'unknown';
const userAgent = (req.headers['user-agent'] as string) || null;
```

Identical primary source to the already-approved, already-live rate-limiter fix (`server.ts:709`, commit `55dd825`): `cf-connecting-ip`, Cloudflare's own TCP-verified header, confirmed live to front 100% of this Render service's traffic unconditionally. **No `X-Forwarded-For` fallback** — reintroducing it here would recreate the exact spoofability problem that fix closed, just in a new table instead of the rate limiter. Fallback is `req.socket.remoteAddress` (same as the rate-limiter fix, for the same reason: a sane, non-throwing default for local/dev environments where Cloudflare is never in the path, never trusted as authoritative). `user_agent` is plain, descriptive, and explicitly never used for any access-control or identity decision — a client can freely misrepresent it, unlike `cf-connecting-ip`.

---

## 9. Representative `metadata` JSON per action category

Kept narrow and action-specific, per the approved scope boundary — no unrelated or sensitive data:

```jsonc
// impersonate_start / impersonate_exit / impersonate_expired
{ "lifecycle": "active" }  // or "completed" / "expired"

// security_hold_apply / security_hold_release
{ "reason": "Suspicious payment pattern reported by user X" }

// user_suspend / user_unsuspend
{ "targetUsername": "Richie" }

// user_delete
{ "targetUsername": "Richie", "deletedProductCount": 4 }

// boost_admin_activate
{ "planId": "7days", "durationDays": 7, "boostEndDate": "2026-09-25T00:00:00.000Z" }

// boost_admin_deactivate
{}

// retention_purge_run
{ "purgedCount": 3, "skippedHoldCount": 1, "releasedQuarantineCount": 2, "soldListingsPurged": 5 }
```

**What's deliberately excluded**: no password/token/session-secret material of any kind (none of the 8 actions ever touch one); no full request/response bodies (only the specific named fields above); no raw error stack traces in `metadata` (those belong in `error_message` as a plain string, or server logs — not structured, potentially-sensitive data sitting in an audit table's JSON column).

---

## 10. `GET /api/admin/audit-logs` — design only, not implemented

```ts
app.get('/api/admin/audit-logs', serverRateLimiter(60 * 1000, 30, "admin-audit-logs"), async (req, res) => {
  const verified = await verifyUser(req.headers.authorization);
  const isAdmin = verified?.isAdmin || verified?.originalAdmin;
  if (!verified || !isAdmin) {
    return res.status(403).json({ success: false, error: "Unauthorized: Administrator privileges required." });
  }

  const { action, result, actorUserId, targetUserId, before, after, limit, cursor } = req.query;
  const pageSize = Math.min(parseInt(limit as string, 10) || 50, 100); // hard cap, see below

  let query = backendSupabase.from('admin_audit_logs').select('*').order('created_at', { ascending: false }).limit(pageSize);
  if (action) query = query.eq('action', action);
  if (result) query = query.eq('result', result);
  if (actorUserId) query = query.eq('actor_user_id', actorUserId);
  if (targetUserId) query = query.eq('target_user_id', targetUserId);
  if (before) query = query.lt('created_at', before as string);
  if (after) query = query.gt('created_at', after as string);
  if (cursor) query = query.lt('created_at', cursor as string);

  const { data, error } = await query;
  if (error) return res.status(500).json({ success: false, error: error.message });

  const nextCursor = data && data.length === pageSize ? data[data.length - 1].created_at : null;
  return res.json({ success: true, logs: data || [], nextCursor });
});
```

- **Authentication**: `verifyUser()`, the same real cryptographic check as every other admin endpoint — not `verifyAdmin()`'s boolean-only form, since nothing here needs impersonation-swap semantics and using the fuller check is the established pattern at every call site checked in §6.
- **`verifyAdmin()` behavior**: not used here directly — `verified?.isAdmin || verified?.originalAdmin` inline, matching the exact check already used at security-hold/suspend/delete (§5.5-5.7), for consistency rather than introducing a third variant.
- **Pagination**: cursor-based on `created_at` (descending), not offset-based — correct for a table that only grows and is read in "most recent first" order; offset pagination would skip/duplicate rows as new entries are inserted between page loads.
- **Filtering**: `action`, `result`, `actorUserId`, `targetUserId`, plus a `before`/`after` date-range pair — covers every real query pattern named in the approved shape (§10 of the original proposal) without adding filters nothing asks for.
- **Maximum page size**: hard-capped at 100 regardless of what `?limit=` requests, preventing one request from ever pulling the entire table regardless of how large it eventually grows.
- **Ordering**: always `created_at DESC` — no ascending option, since "oldest first" has no real use case for an audit trail someone is actively investigating (they want the most recent activity, or a specific date range, not the beginning of time forward).
- **Response shape**: `{ success: true, logs: AuditLogRow[], nextCursor: string | null }` — `nextCursor` is `null` once a page comes back smaller than the requested size, the standard "no more pages" signal.
- **Protection against exposing logs to ordinary users**: the `verifyUser()` + `isAdmin` check is the only gate, and it's sufficient — this table has zero RLS policies (§3), so `anon`/`authenticated` Supabase access is already blocked at the database layer regardless of what this endpoint does; the endpoint's own admin check is the sole path to this data existing for anyone, admin or not.

**Not implemented. This is the design only**, per the task's explicit instruction.

---

## 11. Retention

**Confirmed, unchanged from the approved shape**: indefinite retention, no purge mechanism proposed or implied anywhere in this document. `POST /api/admin/retention/run-purge` (`server.ts:8945`) is explicitly never modified to include this table — its existing 90-day logic (soft-deleted users, expired username quarantines) operates on entirely different tables and stays exactly as it is today; this table is simply never referenced by it. No new purge job of any kind is proposed here.

---

## 12. Tamper protection — how append-only is maintained

**Confirmed: no application code anywhere in §5's proposed changes ever calls `.update()` or `.delete()` against `admin_audit_logs`.** Every one of the 8 action types' write is a plain `.insert()` (§7's pattern). This is a fact about the proposed diff, not an aspiration — there is no proposed code path that could mutate or remove a row once written.

**Two enforcement layers, restated from the approved shape**: (1) the `COMMENT ON TABLE` in §1 documents this rule durably, directly in the schema, for any future reader (including a future session with no memory of this document); (2) as a matter of code, no update/delete call exists. `service_role` retains the Postgres-level *capability* to update or delete rows here regardless (RLS's `BYPASSRLS` applies to `service_role` no matter how many or few policies exist — same as all 10 existing tables), so this is an applied-discipline guarantee enforced by what the code actually does, not an absolute database-level prohibition — consistent with how every other table in this schema is already governed.

---

## 13. Testing plan

| # | Test | How |
|---|---|---|
| 1 | Successful admin action produces a `result: 'success'` row with correct fields | Trigger a real security-hold/suspend/etc. against a disposable test account; confirm via Table Editor |
| 2 | Failed admin action produces a `result: 'failure'` row | Deliberately trigger a real failure (e.g. a nonexistent `targetUserId`) at suspend/delete/security-hold; confirm the row exists with `error_message` populated |
| 3 | Non-admin rejection | Call each of the 8 write-triggering endpoints and `GET /api/admin/audit-logs` with a real, valid but non-admin token; expect `403`, confirm zero audit rows result from the rejected attempt |
| 4 | Spoofed admin identity is rejected | Attempt each endpoint with a forged/malformed/expired Authorization header; expect `401`/`403` (this is `verifyUser()`'s existing, already-verified behavior — §6 — this test re-confirms it specifically in the context of the new insert code, not re-testing `verifyUser()` itself from scratch) |
| 5 | Correct Firebase UID recorded | For a real triggered action, confirm `actor_user_id` in the resulting row exactly matches the calling admin's real Firebase UID, not their email or any client-supplied value |
| 6 | IP capture | Confirm `ip_address` on a real triggered row is a plausible IP (not literally the string `"unknown"` under normal production traffic, where Cloudflare is always present per the confirmed topology) |
| 7 | Audit-write failure doesn't change the real action's outcome | Simulate the audit insert failing (e.g. temporarily target a wrong table name in a local/test branch) and confirm the real suspend/delete/etc. action still returns its normal success response to the caller |
| 8 | Pagination/filtering | Create several rows across different `action`/`result`/`actorUserId` values (test data); confirm each filter narrows results correctly, confirm `limit`/`nextCursor` behavior, confirm the 100-row hard cap can't be exceeded by requesting a larger `?limit=` |
| 9 | Ordinary-user access rejection | A real, valid, non-admin authenticated user hitting `GET /api/admin/audit-logs` gets `403`, not a filtered/empty-but-200 response — the distinction matters for confirming this is a real authorization check, not just an empty result |
| 10 | Direct anon/authenticated Supabase modification rejected via RLS | Same live methodology already used and proven this session (a real, public anon key against the REST API): attempt a direct `INSERT`/`UPDATE` against `admin_audit_logs` with the anon key; expect the same `42501`/zero-rows-matched signature already confirmed for the 10 existing tables. This is the most important test to actually execute live once the table exists, since it's the one closing the loop between "RLS is configured" and "RLS actually works for this specific new table," not assumed by analogy alone. |

All of this requires real Firebase admin credentials this sandbox does not have (same limitation already stated plainly in the approved shape proposal and in the recent RLS confirmation report) — tests 1, 2, 5, 6, 8 specifically need a real admin session to trigger genuine actions; test 10 can be run from this sandbox using the same public-anon-key methodology already proven this session, the moment the table exists.

---

## 14. Migration / rollback plan

Unchanged from the approved shape, restated for completeness:

**If the table itself needs to be rolled back**: `DROP TABLE IF EXISTS public.admin_audit_logs;` — every one of the 8 write call sites already tolerates this table's absence today (that's the current, live, safe state of the app), so dropping it returns to exactly today's behavior with zero functional impact on anything else. No other table or code path reads from or depends on this table's contents (confirmed: zero references anywhere in `src/`/`mobile/src/`, only in `server.ts`'s own proposed write/read paths).

**If specific code changes need reverting but the table should stay**: each of the §5 call-site changes ships as its own small, isolated, individually-revertable commit — reverting any one via `git revert` returns that specific action type to whatever it did before (or to no audit attempt at all, for boost-control/retention-purge, which have none today), without touching the table or any other action type's logging.

**Nothing here has been executed.** This entire document is the exact-SQL/exact-code review requested — awaiting Vincent's approval of these specifics before anything is written as a real diff or run against production.
