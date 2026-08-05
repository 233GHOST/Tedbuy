-- ====================================================================
-- ⚠️ ARCHITECTURAL WARNING: FIREBASE AUTH & SUPABASE HYBRID SETUP
--
-- This application uses Firebase Auth for user accounts, but performs
-- client-side queries to Supabase using the shared "anon" key.
--
-- Consequently, Supabase evaluates auth.uid() as NULL on all requests.
-- If you enabled Row Level Security (RLS) on these tables, all client
-- insert/update queries will FAIL with "Error setting row" errors.
--
-- 🛑 TO FIX DATABASE ERRORS IMMEDIATELY, RUN THE FOLLOWING SQL BLOCK:
-- ====================================================================

-- ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.products DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.chats DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.reviews DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.store_names DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.boost_purchases DISABLE ROW LEVEL SECURITY;

-- GRANT ALL ON TABLE public.users TO anon, authenticated, service_role;
-- GRANT ALL ON TABLE public.products TO anon, authenticated, service_role;
-- GRANT ALL ON TABLE public.chats TO anon, authenticated, service_role;
-- GRANT ALL ON TABLE public.messages TO anon, authenticated, service_role;
-- GRANT ALL ON TABLE public.reviews TO anon, authenticated, service_role;
-- GRANT ALL ON TABLE public.notifications TO anon, authenticated, service_role;
-- GRANT ALL ON TABLE public.store_names TO anon, authenticated, service_role;
-- GRANT ALL ON TABLE public.boost_purchases TO anon, authenticated, service_role;

-- ====================================================================
-- STRICT ROW LEVEL SECURITY (RLS) POLICIES REFERENCE LIST
-- (Only use if you are using Supabase Auth JWTs on the client)
-- ====================================================================

-- 1. Profiles Table (users) Row Level Security (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to prevent conflicts
DROP POLICY IF EXISTS "Allow public read access to profiles" ON public.users;
DROP POLICY IF EXISTS "Allow users to insert their own profile" ON public.users;
DROP POLICY IF EXISTS "Allow users to update their own profile" ON public.users;
DROP POLICY IF EXISTS "Allow admins or owners to delete profiles" ON public.users;

-- 1.1 Public Read Access: Allow anyone to view profile details
CREATE POLICY "Allow public read access to profiles" 
ON public.users 
FOR SELECT 
USING (true);

-- 1.2 Restrictive Write Access: Users can only insert their own profile record
CREATE POLICY "Allow users to insert their own profile" 
ON public.users 
FOR INSERT 
WITH CHECK (auth.uid()::text = id);

-- 1.3 Restrictive Update Access: Users can only update their own profile record
CREATE POLICY "Allow users to update their own profile" 
ON public.users 
FOR UPDATE 
USING (auth.uid()::text = id)
WITH CHECK (auth.uid()::text = id);

-- 1.4 Admin-only Delete Access
CREATE POLICY "Allow admins or owners to delete profiles"
ON public.users
FOR DELETE
USING (
  auth.uid()::text = id 
  OR EXISTS (
    SELECT 1 FROM public.users 
    WHERE id = auth.uid()::text AND "isAdmin" = true
  )
);


-- 2. Products Table Row Level Security (RLS)
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to prevent conflicts
DROP POLICY IF EXISTS "Allow public read access to products" ON public.products;
DROP POLICY IF EXISTS "Allow authenticated users to insert products" ON public.products;
DROP POLICY IF EXISTS "Allow owners to update their own products" ON public.products;
DROP POLICY IF EXISTS "Allow owners to delete their own products" ON public.products;

-- 2.1 Public Read Access: Allow anyone to browse products
CREATE POLICY "Allow public read access to products" 
ON public.products 
FOR SELECT 
USING (true);

-- 2.2 Authenticated Insert: Authenticated users can post products under their own seller ID
CREATE POLICY "Allow authenticated users to insert products" 
ON public.products 
FOR INSERT 
WITH CHECK (auth.uid()::text = "sellerId");

-- 2.3 Owner Update: Users can only edit their own listings
CREATE POLICY "Allow owners to update their own products" 
ON public.products 
FOR UPDATE 
USING (auth.uid()::text = "sellerId")
WITH CHECK (auth.uid()::text = "sellerId");

-- 2.4 Owner Delete: Users can only delete their own listings
CREATE POLICY "Allow owners to delete their own products" 
ON public.products 
FOR DELETE 
USING (auth.uid()::text = "sellerId");
