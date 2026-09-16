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
