# Dropship supplier catalogue: staging setup and browser checklist

Status: **not yet performed.** Nothing below has been run against real Firebase, Supabase or a browser.
"Automated" means covered by `npm run test:dropship` (PGlite database, mocked Firebase identity), not by
these manual steps.

## A. Staging setup (never production)

0. **Before deploying the admin-identity fix** (`server/auth/adminIdentity.ts`): owner runs
   `npx tsx scripts/check-owner-admin-identity.ts` with their own Firebase credentials (read-only). It must
   print `OK`; otherwise the owner would lose admin access. Run the SQL it prints to find profiles that
   stored the owner's email or an admin flag through the old `/api/users/sync` bug.
1. **Legacy schema baseline (owner, read-only, schema only).** The repository cannot reproduce production's
   schema (`npx tsx scripts/check-schema-baseline.ts supabase_schema.sql` fails). The owner:
   1. `supabase login`, then `supabase link --project-ref <production ref>` (asks for the DB password; nothing is changed).
   2. `supabase db dump --linked --schema public -f baseline_public.sql` (schema only: do **not** pass `--data-only`).
   3. In the production SQL editor, read-only, and save the results with the dump:
      `select version();`
      `select pubname, schemaname, tablename from pg_publication_tables where schemaname = 'public';`
      `select tablename, rowsecurity from pg_tables where schemaname = 'public';`
      `select * from pg_policies where schemaname = 'public';`
      `select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated');`
   4. `npx tsx scripts/check-schema-baseline.ts baseline_public.sql` must report no ERROR. Decide each WARN
      (blanket `anon` grants, RLS, Realtime publication) and add the publication lines from 3.
   5. Commit it as `supabase/migrations/20261001000000_legacy_baseline.sql` (before the Dropship migration).
2. **Supabase staging project:** create a new, empty project. Apply, in order, the baseline and
   `supabase/migrations/20261026120000_dropship_supplier_catalogue.sql` (`supabase db push` against the
   staging project only, or `psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -1 -f <file>` for each).
3. **Firebase:** `server.ts` verifies tokens only for project `tedbuy-fb79a`, so staging signs in to that
   project with **dedicated test accounts** and gets **no** Firebase or Google credentials. A separate Firebase
   project needs `server.ts`'s Admin `projectId` to become configurable (owner approval; see §D).
4. **Cloudinary:** a separate account (recommended) or the production cloud's `tedbuy_products/` folder.
   Without credentials, photo uploads return 503 and products (which need a photo) can't be created.
5. **Environment** (`.env.staging` or a separate Render service; never the production service):
   `TEDBUY_ENV=staging`; `VITE_SUPABASE_URL` and `SUPABASE_URL` (same staging project);
   `VITE_SUPABASE_ANON_KEY`; `SUPABASE_SERVICE_ROLE_KEY`; `DROPSHIP_ENABLED=true`;
   `DROPSHIP_EXPECTED_SUPABASE_REF`; `VITE_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
   `CLOUDINARY_API_SECRET`; `CRON_SECRET`. Not set: `GOOGLE_SERVICE_ACCOUNT_JSON`, `FIREBASE_SERVICE_ACCOUNT_KEY`,
   `GOOGLE_APPLICATION_CREDENTIALS`, `BREVO_API_KEY`, `GEMINI_API_KEY`; Paystack test keys only (or none).
6. **Checks before starting:** `npm run check:staging -- .env.staging` (exit 0), `npm run test:dropship`,
   `npm run test:config`, `npm run test:auth`, then `set -a; . ./.env.staging; set +a; npm run build && npm start`.
   The build and the server refuse unsafe staging settings. In the log: `[Supabase Server] Initialized … <staging host>`
   and `[Dropship] Enabled`.
7. **Test accounts** (synthetic, in Firebase project `tedbuy-fb79a`): admin = the owner's own account with a
   verified email (no `admin` claims on test accounts: a claim there is also a production admin); supplier A and
   supplier B (verified emails); one unverified account; one buyer. Each signs in once so its staging `users` row exists.

## B. Browser checks

| # | Scenario | Steps (staging) | Expected | Automated already |
|---|---|---|---|---|
| 1 | Feature disabled | Start with `DROPSHIP_ENABLED` unset; open Settings; open `/dropship` directly | No Dropship menu item (mobile) or tab (desktop); `/dropship` shows "isn't available right now"; rest of TedBuy works | API: disabled → 503, status false |
| 2 | Signed out | Sign out; open `/dropship` | "Sign in to supply products" with a Sign in button opening the auth modal | API: 401 without token |
| 3 | Unverified email | Sign in as the unverified account; Settings → TedBuy Dropship; submit the form | Amber notice before submitting; submit shows "Verify your email address…"; no application created | API: 403 for unverified |
| 4 | Application | Supplier A applies | Card shows "Pending review"; reload keeps it; double-click submit creates one application | API + DB: create, replay, validation |
| 5 | Admin decisions | Admin → Admin review → Supplier applications: approve A; have B apply, reject B with a reason; try reject with empty reason | A approved; B sees "not approved: <reason>" and can resubmit; empty reason refused | DB: state machine, reasons, stale expected status |
| 6 | Supplier products | As A: New product with 1–3 photos (submit for review); save another as draft; edit title and price; submit draft; after step 7 approval: pause, reactivate, archive (confirm dialog) | Statuses follow; archived product has no actions; photo upload works | DB + API: all transitions |
| 7 | Admin moderation and stock | Admin → Supplier catalogue (In review): reject one with reason, approve one; set stock with a reason; try without reason | Rejected shows moderator note to supplier; approved becomes Active; stock change needs a reason | DB + API |
| 8 | Ownership | As B (approved), call `PATCH /api/dropship/supplier/products/<A's id>` from devtools with B's token | 404 NOT_FOUND; B's list never shows A's products | DB + API |
| 9 | Suspended / revoked | Admin suspends A (reason) → A reloads; then revoke A | Suspended: amber banner, list visible, no edit/stock/status buttons. Revoked: "account was closed"; A's products archived | DB + API (HTTP) |
| 10 | Buyer / anonymous | As buyer and signed out: open `/dropship`, watch devtools Network; call the supplier and admin product endpoints | No wholesale price, stock or supplier ids in any response; admin endpoints 403/401 | API: no-leak test |
| 11 | Stale edits | Open the same product in two tabs as A; save in tab 1, then tab 2; same for stock | Tab 2: "changed by someone else; reload it", nothing overwritten | API + DB |
| 12 | Failures | With the app open, stop the server or go offline, then save; restart with `DROPSHIP_ENABLED` unset | Clear error toast, no false success; entry points disappear after reload and direct link shows "isn't available" | Partly (error mapping); UI not covered |

Record for each row: date, tester, pass/fail, and anything unexpected. Delete the staging test accounts from
Firebase Auth afterwards.

## C. Not covered by any check yet

- The React screens have no automated rendering test; the repo has no browser or component-test tooling.
- Concurrency under real multi-connection PostgreSQL (PGlite is single-connection).
- Native PostgreSQL and Supabase behaviour of the migration and rollback.

## D. Proposed code change for a fully separate Firebase project (not applied)

`server.ts` initialises Firebase Admin with `projectId: "tedbuy-fb79a"` in both branches. Reading it from an
environment variable with the same default (`process.env.FIREBASE_PROJECT_ID || "tedbuy-fb79a"`) would leave
production unchanged and let a staging instance verify tokens from its own Firebase project. It touches
authentication for all of TedBuy, so it needs the owner's approval.
