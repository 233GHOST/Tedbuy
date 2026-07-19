-- ====================================================================
-- TEDBUY SUPABASE ROW LEVEL SECURITY (RLS) MIGRATION SCRIPT
-- ====================================================================

-- 1. ENABLE ROW LEVEL SECURITY ON ALL TABLES
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_names ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boost_purchases ENABLE ROW LEVEL SECURITY;

-- 2. REVOLK DIRECT SELECTION OF SENSITIVE COLUMNS FROM ANON FOR USERS
-- First, revoke all default permissions on users for anon to start secure
REVOKE ALL ON TABLE public.users FROM anon;

-- Grant specific column-level SELECT permissions to anon so the security_invoker view can query them
GRANT SELECT (id, username, "photoUrl", role, "emailVerified", "joinDate") ON public.users TO anon;

-- Create a secure PostgreSQL View that exposes ONLY public profile information
CREATE OR REPLACE VIEW public.public_seller_profiles WITH (security_invoker = true) AS
SELECT id, username, "photoUrl", role, "emailVerified", "joinDate"
FROM public.users;

-- Explicitly grant SELECT permission on the view to anon
GRANT SELECT ON public.public_seller_profiles TO anon;

-- Create an RLS policy for users to allow SELECT of rows to anon (restricted by column grants)
DROP POLICY IF EXISTS "Allow public read of profiles" ON public.users;
CREATE POLICY "Allow public read of profiles" ON public.users
FOR SELECT
TO anon
USING (true);


-- 3. PRODUCTS TABLE POLICIES (Public read-only, writes via server/service_role)
DROP POLICY IF EXISTS "Allow public select on products" ON public.products;
CREATE POLICY "Allow public select on products" ON public.products
FOR SELECT
TO anon
USING (true);


-- 4. REVIEWS TABLE POLICIES (Public read-only, writes via server/service_role)
DROP POLICY IF EXISTS "Allow public select on reviews" ON public.reviews;
CREATE POLICY "Allow public select on reviews" ON public.reviews
FOR SELECT
TO anon
USING (true);


-- 5. STORE_NAMES TABLE POLICIES (Public read-only for availability checks, writes via server/service_role)
DROP POLICY IF EXISTS "Allow public select on store_names" ON public.store_names;
CREATE POLICY "Allow public select on store_names" ON public.store_names
FOR SELECT
TO anon
USING (true);


-- 6. PRIVATE TABLES: CHATS, MESSAGES, NOTIFICATIONS, BOOST_PURCHASES
-- Since RLS is enabled and NO policies exist for role 'anon', all direct anon client-side operations (SELECT, INSERT, UPDATE, DELETE)
-- on these tables are completely BLOCKED. They can only be accessed via backend endpoints using the service_role key.
-- (No policies are created for anon on these four tables).
