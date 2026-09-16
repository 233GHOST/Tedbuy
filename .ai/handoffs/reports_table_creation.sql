-- ====================================================================
-- FINALIZED (pending your run) — reports table creation.
-- NOT applied by Claude. NOT run against any database. Not yet folded
-- into supabase_schema.sql. Still requires you to run it yourself
-- (this sandbox has no Supabase connectivity or credentials at all).
--
-- CONFIRMED by Vincent directly against the Supabase dashboard
-- (2026-09-16): public.reports does not exist in production. Every
-- other table this session's audits and migration work assumed exists
-- was checked and does. Root-cause investigation (repo archaeology,
-- since this sandbox can't reach the live database) is in
-- .ai/handoffs/CURRENT_HANDOFF.md: reports has real origins in the
-- app's original Firestore-based design (a full entity in
-- firebase-blueprint.json, a complete security-rules block in
-- firestore.rules), but scripts/migrate-firestore-to-supabase.ts never
-- migrated it, and supabase_schema.sql -- the only file in this repo
-- documenting what the schema should contain -- has been an untouched,
-- frozen day-one snapshot since the repo's very first commit while the
-- rest of the app kept evolving. Most likely story: the Supabase-backed
-- version of this feature was written assuming a table that was never
-- actually created, rather than one created by hand and later
-- undocumented.
--
-- Column set matches exactly what both the client-side allow-list
-- (dbAdapter.ts TABLE_COLUMNS.reports) and the server's actual insert
-- (server.ts, POST /api/reports/create's `reportData` object) use --
-- nothing added, nothing assumed beyond what the running code already
-- constructs.
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.reports (id TEXT PRIMARY KEY);
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS "productId" TEXT;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS "productTitle" TEXT;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS "reporterId" TEXT;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS "reporterName" TEXT;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS comment TEXT;
-- TEXT (ISO string), matching the convention used by chats/messages/
-- reviews/notifications/boost_purchases in supabase_schema.sql -- the
-- server always writes new Date().toISOString(), a string, here.
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS "createdAt" TEXT;

-- No read/list endpoint exists yet for reports (the plan doc notes this
-- as "optional, not urgent -- only if a real admin moderation queue is
-- ever built"), so this index is speculative, not driven by an actual
-- query in the code today. Cheap to add now, harmless if never used;
-- drop this line if you'd rather add it only when that feature exists.
CREATE INDEX IF NOT EXISTS idx_reports_product ON public.reports("productId");

-- ====================================================================
-- NOT OPTIONAL: service_role must be granted on this table.
--
-- A newly created table has no privileges for any role except its
-- owner until explicitly granted -- this is a plain Postgres GRANT, a
-- prerequisite gate that exists *before* RLS is ever evaluated, not a
-- consequence of RLS being on or off. Unlike the RLS question below,
-- there's no legitimate reason to withhold this one: server.ts's
-- backendSupabase client (service_role) is how POST /api/reports/create
-- writes to this table at all, and without this grant the feature
-- would still be broken after creating the table, just with a
-- different, more confusing error (Postgres permission denied instead
-- of relation does not exist). Matches the identical grant every other
-- table in supabase_schema.sql already has for service_role.
GRANT ALL ON TABLE public.reports TO service_role;

-- ====================================================================
-- The one real decision this script does NOT make for you: whether
-- `anon`/`authenticated` get the same grant too.
--
-- Every other table in supabase_schema.sql grants all three roles
-- together (`GRANT ALL ... TO anon, authenticated, service_role`) and
-- explicitly disables RLS -- almost certainly the actual origin of RLS
-- being disabled project-wide today (see
-- .ai/handoffs/RLS_ENABLEMENT_READINESS_REPORT.md). This script
-- deliberately does NOT extend that same anon/authenticated grant to
-- reports, for a specific reason: the whole multi-session effort this
-- repo has been through exists to get OFF anon-key reliance, and
-- reports already has zero legitimate anon-key call site (its one
-- write path is POST /api/reports/create, service_role only; there is
-- no read path at all yet). Granting anon/authenticated here would
-- reintroduce, on a brand-new table, the exact same class of exposure
-- 25 checkpoints of this session's work closed everywhere else.
--
-- With just the service_role grant above (and RLS left off, matching
-- every other table's current state, since RLS enablement is Postgres's
-- default off-state until explicitly turned on): this table works for
-- the app exactly like every other table already does today, and the
-- anon key gets no more access to it than it currently has to
-- notifications/boost_purchases/account_deletion_audits/admin_audit_logs
-- (server-only tables that were also never granted to anon).
--
-- If you'd rather this table be the first one enabled with RLS's real
-- target design (default-deny, since it's brand new and has no
-- existing anon traffic of its own to break by doing so early), the
-- one extra line is:
--
-- ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
-- -- (zero policies added -- true default-deny, matching §6 of the
-- -- migration plan's target design for every table)
--
-- Left out of the default statements above deliberately -- your call,
-- not assumed either way, and either choice is defensible.
