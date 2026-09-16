-- ====================================================================
-- DRAFT — reports table creation, for Vincent's review only.
-- NOT applied by Claude. NOT run against any database. Not yet folded
-- into supabase_schema.sql.
--
-- Context: server.ts's POST /api/reports/create and dbAdapter.ts's
-- TABLE_COLUMNS both expect a `public.reports` table that is absent
-- from every section of supabase_schema.sql (table creation, indexes,
-- RLS-disable, grants) -- the only file in this repo that documents
-- what the schema should contain. Full root-cause investigation in
-- .ai/handoffs/CURRENT_HANDOFF.md (dated 2026-09-16): reports has real
-- origins in the app's original Firestore-based design (a full entity
-- in firebase-blueprint.json, a complete security-rules block in
-- firestore.rules), but scripts/migrate-firestore-to-supabase.ts never
-- migrated it, and supabase_schema.sql has been an untouched, frozen
-- day-one snapshot since the repo's very first commit while the rest
-- of the app kept evolving. Whether public.reports genuinely doesn't
-- exist in production, or exists but was created by hand and never
-- folded back into this repo's copy of the schema, has NOT been
-- confirmed -- check the Supabase dashboard directly before running
-- anything below.
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
-- The one real decision this draft does NOT make for you: RLS posture.
--
-- Every other table in supabase_schema.sql ends with an explicit
-- `DISABLE ROW LEVEL SECURITY` + `GRANT ALL ... TO anon` pair -- almost
-- certainly the actual origin of RLS being disabled project-wide today
-- (see .ai/handoffs/RLS_ENABLEMENT_READINESS_REPORT.md). This draft
-- deliberately does NOT include that pair, for a specific reason: the
-- whole multi-session effort this repo has been through exists to get
-- OFF anon-key reliance, and reports already has zero legitimate
-- anon-key call site (its one write path is POST /api/reports/create,
-- service_role, unaffected by RLS either way; there is no read path at
-- all yet). Explicitly enabling RLS on just this one new table right
-- now, ahead of the rest, would itself be a small, one-off Phase-4-style
-- action taken outside the single controlled RLS rollout this whole
-- plan insists on -- not this draft's call to make.
--
-- So: by default, if you run only the CREATE TABLE/ALTER TABLE/INDEX
-- statements above, this table lands in the exact same state every
-- other table is in today (RLS off, no explicit grant given here since
-- the default Postgres role privileges already used by the other
-- tables' pre-existing GRANT ALL statements apply). If you'd rather
-- this table be the first one enabled with RLS's real target design
-- (default-deny, since it's brand new and has no existing anon traffic
-- to break), that's a defensible alternative -- the two lines are:
--
-- ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
-- -- (zero policies added -- true default-deny, matching §6 of the
-- -- migration plan's target design for every table)
--
-- Left commented out deliberately. Your call, not assumed either way.
