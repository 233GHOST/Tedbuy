# Current Handoff Status

**Three P0/P1 vulnerabilities closed this session, all fixed, tested to the extent safely possible, and committed.** Full detail: `.ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md` §13-14.

1. **Self-promotion → admin account deletion/suspension** (§13): `POST /api/users/sync` let any authenticated user set their own `isAdmin` to `true` via a normal profile-save request — independent of RLS. Combined with two `AppContext.tsx` functions that never re-verified admin status server-side, this allowed full account deletion/suspension of any user. Fixed with two new server endpoints (`/api/admin/users/suspend`, `/api/admin/users/delete`), a server-side fix so `/api/users/sync` never trusts client-supplied `isAdmin`, and a `dbAdapter.ts` write-allowlist fix closing the direct-Supabase route too.
2. **isSuspended self-unsuspend** (§14.1): identical shape and fix to #1 — `/api/users/sync` also wrote `isSuspended` straight from the client body, letting a suspended user clear their own suspension. Fixed the same way. Also found (not fixed — needs a product decision, not a mechanical one): suspension is enforced **entirely client-side** — no server endpoint checks `isSuspended` before processing a request, so a suspended user's token still works everywhere regardless.
3. **Chat tradeStatus fraud** (§14.4, found via the Priority 3 sweep, not originally in scope): web's `markAsDelivered`/`markAsPickedUp` wrote `tradeStatus` directly via the unauthenticated dbAdapter path, and `/api/reviews/create` trusts `tradeStatus === 'completed'` as proof of a real trade — meaning anyone could fabricate review eligibility without ever transacting. Mobile already had the correct fix (calls real, already-authorized server endpoints); web just never used them. Fixed by switching web to the same endpoints.

Also fixed: **`/api/send-welcome-email` had no authentication at all** (§14.2) — real callers already sent tokens the server never checked; anyone could email arbitrary addresses a TedBuy-branded "welcome" email. Fixed: real auth required, non-admin callers restricted to their own verified email, admin bulk-send restricted to real registered users looked up server-side. A dead, unreachable 308-line duplicate registration of the same route was also removed.

**Full Priority 3 field-by-field classification also done** (§14.3) — `securityHold`/`status`/`isDeleted`/etc. had the identical unfixed vulnerability shape as isAdmin/isSuspended (no legitimate client write path existed at all, so fixed with zero functional risk). `role`, `isGoogleAuth`, `welcomeSent`, and other preference fields confirmed genuinely safe to leave client-editable. Two items flagged but intentionally not fixed this pass: `emailVerified` (low severity, self-only, no real secret protected) and boost-related product fields (not yet re-examined for a parallel bypass — UNKNOWN).

**Everything else remains open and BLOCKED_APPROVAL — none of this session's fixes touch RLS.**

---

**STATUS: BLOCKED_APPROVAL** (for the broader Supabase RLS migration — §1-11 of the audit doc)

**Reason:** Production Supabase RLS is confirmed disabled (verified by Vincent directly in the Supabase dashboard). Direct client access must be fully mapped before any security architecture change (re-enabling RLS, changing grants/policies, migrating write paths) is made. No production database, RLS, grants, policies, or `dbAdapter.ts`/`server.ts` code has been touched.

**Reference documents:**
- `.ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md` — complete read-only inventory of every direct client-to-Supabase code path, classified by risk, mapped against existing authenticated server APIs, with a proposed 3-phase migration plan. This is the document to work from before implementing anything.
- `.ai/handoffs/vercel-audit.md` — separate, unrelated, also read-only/BLOCKED_APPROVAL-adjacent (legacy Vercel file cleanup pending Vincent's go-ahead).

**UPDATE — second pass found something more severe than the original RLS gap.** Tracing the account-deletion cascade (as requested) surfaced a real privilege-escalation chain, not just an authorization gap dependent on RLS alone:

- `adminDeleteUserProfile()` and `adminToggleUserSuspension()` (`AppContext.tsx`) are gated **only** by a client-side `currentUser.isAdmin` check — no server round-trip re-verifies admin status before they run (contrast `adminToggleSecurityHold` in the same file, which correctly does call a real server endpoint).
- `users.isAdmin` is a plain, client-writable column with no code-level protection — with RLS off, any actor can set their own row's `isAdmin` to `true` via a direct Supabase REST call (no TedBuy app code needed, just the public anon key + table/column names, both effectively public).
- Chaining these: anyone can self-promote to admin client-side, then use `adminDeleteUserProfile`'s real, reachable UI button (`ProfileSettings.tsx:3277`) to hard-delete (or suspend) **any other user's entire account** — products, reviews, chats, messages, store name, profile.
- Bonus, separate finding: the admin PIN second-factor (`verifyAdminPIN`) is pure client-side JS with a hardcoded `'2330'` fallback that always works — not a real gate either, though it doesn't even come into play for the two vulnerable functions above since neither checks it.
- Reviews audited end-to-end: creation is already properly server-verified (real trade/chat validation, no direct-write path) — no issue there. No update path exists. Delete only happens via the same vulnerable admin cascade.

Full detail, code references, and the exact exploit chain: `.ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md` §12.

**What happens next:** waiting on Vincent to decide relative priority between (a) the §12.3 privilege-escalation fix (arguably more urgent than the broader RLS migration, since it doesn't require RLS to be re-enabled to matter — it needs `adminDeleteUserProfile`/`adminToggleUserSuspension` migrated to real server endpoints, and `users.isAdmin` writes blocked from ever reaching a client-controlled payload), (b) starting Phase 1 of the Supabase RLS migration plan (§9), or (c) commissioning the remaining open unknowns (admin_audit_logs/account_deletion_audits RLS status, `resetChats` reachability — still unresolved, full onSnapshot read-path inventory).

**Do not enable RLS, run `supabase_policies.sql`, change grants, modify `dbAdapter.ts`, `server.ts` authorization, or touch the admin-gated functions in `AppContext.tsx` until Vincent explicitly authorizes the implementation phase.**

Autonomous audit of unrelated, safe areas continues in parallel — see session commits on `main` (security fixes `7e1d89c`, video-feed perf `9bfebe7`, Vercel audit `03101bb`) for work already shipped this session.
