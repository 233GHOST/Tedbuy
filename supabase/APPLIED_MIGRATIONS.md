# Applied migrations

Migrations in `supabase/migrations/` are applied by hand, by pasting the file
into the Supabase SQL Editor. Supabase's own migration history
(`supabase_migrations.schema_migrations`) has NOT been kept up to date.

**Never run `supabase db push` against live.** It would try to re-run files
that are already applied. Before using the Supabase CLI against a database,
mark every file below as applied with `supabase migration repair`.

| Migration | Staging | Live |
|---|---|---|
| 20261001000000_legacy_baseline | not applied (staging built from `staging/staging_setup.sql`) | not applied (describes the existing live schema; kept out of the public repo) |
| 20261026120000_dropship_supplier_catalogue | applied | applied 2026-10-27 |
| 20261027120000_legacy_missing_columns | applied 2026-10-27 | applied 2026-10-27 |
| 20261027130000_admin_audit_logs | applied 2026-10-27 | applied 2026-10-27 |
| 20261028120000_dropship_listings | applied 2026-10-28 | applied 2026-10-28 |

Staging = djlvwjkrcsfpxfjovelc, live = hnfqymkdgadwzrjenaqf.

When you apply a new migration, add a row here in the same commit.
