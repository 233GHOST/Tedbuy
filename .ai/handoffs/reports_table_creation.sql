-- ====================================================================
-- RESOLVED — reports table creation. Applied by Vincent in production
-- on 2026-09-16, confirmed working end-to-end (a real report submission
-- now succeeds). Kept here as a record, not something to re-run.
--
-- CONFIRMED by Vincent directly against the Supabase dashboard
-- (2026-09-16): public.reports did not exist in production. Root-cause
-- investigation (repo archaeology, since this sandbox has no Supabase
-- connectivity to have checked this directly itself) is in
-- .ai/handoffs/CURRENT_HANDOFF.md: reports has real origins in the
-- app's original Firestore-based design (a full entity in
-- firebase-blueprint.json, a complete security-rules block in
-- firestore.rules), but scripts/migrate-firestore-to-supabase.ts never
-- migrated it, and supabase_schema.sql -- the only file in this repo
-- documenting what the schema should contain -- has been an untouched,
-- frozen day-one snapshot since the repo's very first commit while the
-- rest of the app kept evolving.
--
-- Column set matches exactly what both the client-side allow-list
-- (dbAdapter.ts TABLE_COLUMNS.reports) and the server's actual insert
-- (server.ts, POST /api/reports/create's `reportData` object) use.
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
-- query in the code today. Cheap to add now, harmless if never used.
CREATE INDEX IF NOT EXISTS idx_reports_product ON public.reports("productId");

-- ====================================================================
-- CORRECTION, 2026-09-16 -- this section was wrong in the version
-- originally applied, and is corrected here for the record. See the
-- correction notices at the top of SUPABASE_RLS_MIGRATION_PLAN.md and
-- RLS_ENABLEMENT_READINESS_REPORT.md for the full story.
--
-- The version first given to Vincent granted ONLY service_role, on the
-- stated assumption that server.ts's backendSupabase client used that
-- role and therefore didn't need anon/authenticated access. That
-- assumption was false: backendSupabase has always been built from
-- VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY -- the anon key -- not a
-- service_role key (SUPABASE_SERVICE_ROLE_KEY is referenced nowhere in
-- this codebase). Granting only service_role left the live feature
-- broken with `permission denied for table reports`, because the
-- server was never authenticating as that role at all. The actual fix,
-- confirmed working in production:
GRANT ALL ON TABLE public.reports TO anon, authenticated, service_role;
-- ^ Matches the identical grant every other table in supabase_schema.sql
-- already has. Once the server is migrated to a real service_role key
-- (a new, separate, not-yet-done prerequisite for enabling RLS at all --
-- see RLS_ENABLEMENT_READINESS_REPORT.md §8 step 0), this table's grant
-- should be revisited alongside every other table's, not before.
--
-- RLS itself was left off for this table, matching every other table's
-- current state (RLS is Postgres's default off-state until explicitly
-- enabled) -- consistent with the rest of this session's discipline of
-- treating RLS as one single, controlled, later phase, not something to
-- flip table-by-table ahead of the rest.
-- ====================================================================
