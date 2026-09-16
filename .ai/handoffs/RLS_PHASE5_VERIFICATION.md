# RLS Phase 5 — Live Verification

**Read-only against the database in effect.** No RLS, policy, grant, schema, or application code was changed while producing this. All writes attempted below were denied by RLS before commit — nothing was persisted.

Run 2026-09-16, immediately after Phase 4 (`00367cd`, all 10 tables confirmed `rls_enabled = true`, zero policies).

**Anon key used**: the real, live production anon key, extracted from the public browser bundle (`https://www.tedbuy.store/assets/index-BjvkhuND.js`) — not a secret, designed to be public/embedded client-side. Decoded JWT payload confirmed `role: anon`, `ref: hnfqymkdgadwzrjenaqf` (matches the production project).

---

## 1. Direct anonymous access — all 10 tables

`GET https://hnfqymkdgadwzrjenaqf.supabase.co/rest/v1/<table>?select=*&limit=3` with the anon key, for `users`, `products`, `chats`, `messages`, `reviews`, `reports`, `notifications`, `store_names`, `boost_purchases`, `account_deletion_audits`.

**Result: all 10 → `HTTP 200`, body `[]`.** RLS is filtering every row for `anon`, exactly as designed.

## 2. Anon-key writes — `users`, `products`, `reviews`, `reports`, `store_names`

`POST` (insert) against each with the anon key, minimal test payloads.

**Result: all 5 → `HTTP 401`, `{"code":"42501", "message":"new row violates row-level security policy for table \"<table>\""}`.** Specific RLS-denial error, not a generic auth/schema error. Nothing written.

## 3. Normal authenticated server flows

**No real Firebase ID token available in this sandbox — authenticated-write flows not tested, not claimed as tested.**

Public-read paths verified live and working post-RLS: `GET /api/auth/check-store-name/:username` (real `store_names` query, correct response), `GET /api/products/:productId` for a nonexistent id (real `products` query, correct `404`), `GET /api/reviews` (real `reviews` query, returned genuine production rows).

## 4. Cross-user authorization

**Not testable.** Requires two distinct real authenticated sessions; none exist here. Not attempted. Note: enforced by `server.ts`'s explicit ownership checks, independent of RLS — unaffected by this migration either way, since the server always runs as `service_role`.

## 5. Authorized admin operations

**Not testable** for the real PASS case — no admin session available. Spot-check only: `POST /api/admin/users/suspend` with no auth header still correctly returns `403`. Confirms the gate is intact; not a substitute for a real admin action succeeding.

## 6. Server → Supabase service_role connectivity

**PASS**, verified live via four independent endpoints, all functioning correctly against the RLS-enabled database:
- `GET /api/health` → `{"status":"ok","supabaseActive":true}`
- `GET /api/auth/check-store-name/:username` → real query, correct result
- `GET /api/products/:productId` (bogus id) → real query, correct `404`
- `GET /api/reviews` → real query, returned actual production review data

---

## Summary

| Category | Status |
|---|---|
| RLS mechanism (anon reads, all 10 tables) | **Verified — DENIED, as designed** |
| RLS mechanism (anon writes, 5 representative tables) | **Verified — DENIED, as designed** |
| Application flow — public-read paths | **Verified — PASS** |
| Application flow — authenticated write paths | **Not testable** (no real Firebase token) |
| Cross-user authorization | **Not testable** (no two real sessions) |
| Admin operations (real success case) | **Not testable** (no real admin session); reject-path spot-check only, passed |
| Server → service_role connectivity | **Verified — PASS** |

**Phase 5 status: PARTIAL — credentials unavailable.** RLS itself and service_role connectivity are fully verified with zero anomalies or defects found. The rows requiring real Firebase credentials remain genuinely untested — an environment limitation, not a defect. No RLS/policy/grant/schema/code change was made during this phase; rollback was not needed.

**If/when real credentials become available** (shared into this sandbox, or run by Vincent directly), the remaining rows to close out: a full authenticated round-trip (login → create listing → send message → leave a review), one deliberate cross-user attempt, and one real admin action (suspend/security-hold/impersonate) through the actual app/admin panel.

---

## Manual verification results (Vincent, 2026-09-16)

Per `RLS_PHASE5_MANUAL_PROCEDURE.md`.

### Test 1 — Authenticated write/read flow
**PASS.** Vincent confirmed via the live app.

### Test 2 — Cross-user authorization
**PASS.** Executed via Firefox DevTools: authenticated as User A ("Richie"), sent a real `POST /api/products/sync` request (with User A's own valid Authorization token) targeting a listing owned by a different seller ("ISBON STORE", `prod_1786488773748`), attempting to change its title.

Result:
```
POST https://www.tedbuy.store/api/products/sync → HTTP 403
{"success":false,"error":"Forbidden: You do not have permission to modify this listing"}
```
Confirmed via code read (`server.ts:3178-3189`) that this rejection happens *before* any database write — the ownership check is a hard `return` ahead of the save logic, so there is no path by which the target listing could have been altered despite the request being sent. Server-side ownership enforcement (`sellerId` cross-checked against the real DB row, never trusted from the client) is confirmed intact and independent of RLS.

### Test 3 — Authorized admin action
**BLOCKED — defect found, root cause not yet confirmed.** Vincent attempted to reverse/deactivate a boost via the admin panel; the action reported no visible effect ("nothing happened, the expected action was not performed").

Code read of `POST /api/admin/boost-control` (`server.ts:5343`) found a pre-existing pattern where Supabase write failures are swallowed (`console.warn`, never re-thrown) and the endpoint still returns `{ success: true }` regardless of whether the underlying row actually changed — this bug predates this session's RLS work, not introduced by it. Whether *this specific* failure was RLS-caused or this pre-existing bug remains unconfirmed — pending from Vincent: Render logs for `[Admin Boost Control API]` around the time of the attempt (specifically any `Supabase upsert error` warning and its exact message), and the product row's actual `boostStatus`/`isBoosted`/`updatedAt` state checked directly in the Supabase Table Editor.

**No RLS, policy, grant, schema, or application code has been changed in response to this finding.** No rollback performed.

---

## Overall Phase 5 status

**BLOCKED — actual defect found (Test 3).** Tests 1 and 2 pass cleanly with no anomalies. Test 3 surfaced a real defect in `/api/admin/boost-control` whose relationship to RLS is not yet confirmed — Phase 5 cannot be marked PASS until this is resolved one way or the other.
