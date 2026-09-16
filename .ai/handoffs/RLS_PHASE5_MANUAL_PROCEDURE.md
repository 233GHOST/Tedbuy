# RLS Phase 5 — Manual Verification Procedure

For Vincent to run directly against the live app. No credentials are shared with the sandbox for this — every step below stays inside Vincent's own browser session. Nothing here modifies code, RLS, policies, grants, or schema; this document only records a procedure and, once run, its result.

Closes the three rows `RLS_PHASE5_VERIFICATION.md` left as "not testable": authenticated write/read, cross-user authorization, and a real admin action.

---

## Test 1 — Authenticated user write/read flow

**Action:**
1. Log into `www.tedbuy.store` with a real (non-admin) TedBuy account.
2. Create a new listing via "Sell" — give it a clearly-marked test title, e.g. `RLS Phase 5 Verification - Ignore`, so it's easy to identify and delete afterward.
3. Submit and confirm you get a success response.
4. Open "My Listings" (your own profile) and confirm the new listing appears there.
5. Open the listing's own public URL (`https://www.tedbuy.store/product/<id>-<slug>`, shown on the listing) in a logged-out or incognito window, and confirm it's visible there too.
6. Optional cleanup: delete the test listing via the app's own delete control once done.

**Expected result:** creation succeeds; the listing appears immediately in your own listings; it's also publicly visible at its own URL to a logged-out visitor.

**What this verifies:** the server's real authenticated write path (`POST /api/products/create`) and both the authenticated and public read paths continue to function correctly against the RLS-enabled `products` table — end-to-end confirmation that Phase 4's "no impact on legitimate operations" holds for a real user, not just for the server's own smoke-test endpoints.

**Evidence to capture:** screenshot of the success confirmation after creating; screenshot of it appearing in "My Listings"; screenshot of the public product page from a logged-out/incognito window.

**Defect indicator:** creation fails with a server/database error (a 500, a timeout, or any message referencing "permission denied" or "row-level security"); or it creates but doesn't appear in your own listings; or the public URL doesn't show it to a logged-out visitor. Any of these would mean RLS broke a legitimate `service_role` path — stop, capture the exact error text, and report it. Don't touch RLS yourself.

---

## Test 2 — Cross-user authorization

**Setup:** two real, distinct TedBuy accounts you control — User A and User B. User B needs at least one active listing.

**Action:**
1. As User B, open one of your own listings and note its public URL (`https://www.tedbuy.store/product/<productId>-<slug>` — the ID is the part before the dash).
2. Log out, log in as User A (a different, unrelated account).
3. Still as User A, open DevTools → Network tab, and perform any ordinary action on your own account (e.g. open your own profile). Find that outgoing request to `www.tedbuy.store/api/...` and copy the value of its `Authorization` request header. (This stays in your own browser — do not send it to me.)
4. In DevTools → Console, run a request attempting to act on **User B's** listing while authenticated as **User A**:
   ```js
   fetch('/api/products/sync', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json', 'Authorization': '<the value you copied>' },
     body: JSON.stringify({ id: '<User B's product ID>', title: 'cross-user test - should be rejected' })
   }).then(r => r.text().then(t => console.log(r.status, t)))
   ```
   (`/api/products/sync` is the safer choice — an edit attempt, not a delete. `/api/products/delete` would work identically for this test but risks actually destroying B's listing if the check somehow doesn't hold.)
5. Log back in as User B (or reload the public URL) and confirm the listing is unchanged.

**Expected result:** the request is rejected — a `403`-class response citing an ownership/authorization failure — and User B's listing is confirmed unchanged afterward.

**What this verifies:** server-side ownership enforcement (the real `sellerId` on the row is cross-checked against the caller's own verified identity, never trusted from the request body) is intact and independent of RLS — a valid token belonging to User A cannot be used to affect User B's data, regardless of RLS's own state.

**Evidence to capture:** screenshot of the DevTools response (status code and body); a follow-up screenshot confirming B's listing is unchanged.

**Defect indicator:** the request returns `200`/success, or User B's listing is actually altered. This would be a real cross-user authorization bypass — unrelated to RLS itself, since the server always runs as `service_role` regardless of RLS state, so this specifically tests the app's own ownership logic. Stop immediately, capture the exact response, and report it. Don't attempt a fix yourself.

---

## Test 3 — Authorized admin action

**Action:**
1. Log into `www.tedbuy.store` with your real admin-privileged (PIN-verified) session.
2. Open the admin panel's account management section.
3. Pick a test/throwaway account you control (not a real customer) and apply a real, reversible admin action — recommend security-hold or suspend, whichever is easiest to reverse immediately in the UI.
4. Confirm the action succeeds and the account's status visibly updates.
5. Immediately reverse it (release the hold / unsuspend) and confirm the status reverts cleanly.

**Expected result:** both the apply and the reverse succeed with clear success confirmations, and the target account's status updates correctly both times.

**What this verifies:** real admin-gated writes (`isAdmin`-verified, `service_role`-backed) against the RLS-enabled `users` table continue to function correctly — confirms the admin control plane specifically, distinct from Test 1's ordinary-user write path.

**Evidence to capture:** screenshot of the action succeeding; screenshot of the account showing the applied status; screenshot after reversal showing it's cleared.

**Defect indicator:** the action fails with a permission or database error despite being a genuine admin session. This would specifically mean `service_role` isn't actually bypassing RLS as expected — a serious regression, not a minor issue. Stop immediately, capture the exact error, and report it. Don't disable RLS or create a policy yourself — report first.

---

## What to report back for Phase 5 to be marked PASS

For each of the three tests: pass or fail, and the exact status code/response text you observed (especially for Test 2, and for any failure in Tests 1 or 3). For Test 2 specifically, explicit confirmation that User B's data was unaffected.

If all three come back clean with no anomalies, `RLS_PHASE5_VERIFICATION.md`'s status will be updated from `PARTIAL — credentials unavailable` to `PASS`, recording that these three rows were manually confirmed by Vincent, with the date and the evidence summary — a documentation-only update, no further code/schema/RLS change required.
