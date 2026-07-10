# Supabase Row Level Security (RLS) Policies

> [!WARNING]
> **CRITICAL ARCHITECTURAL CONSTRAINT: FIREBASE AUTH & SUPABASE HYBRID SETUP**
>
> This application uses **Firebase Auth** for user sessions and authenticates client-side operations using the shared public **Supabase Anonymous Key** (`VITE_SUPABASE_ANON_KEY`).
>
> Because authentication is handled by Firebase and not Supabase Auth:
> 1. All client-side requests to Supabase are made with the `anon` role.
> 2. The PostgreSQL helper `auth.uid()` always returns `NULL` inside Supabase.
> 3. **Enabling RLS with policies checking `auth.uid()` will cause all insert and update operations on `users`, `products`, and `chats` to FAIL** with `[Supabase setDoc] Error setting row` errors.
>
> ### 🛑 How to Fix "Error setting row in table..." Errors Immediately
>
> If you applied the strict RLS policies below and are experiencing database write errors, you **MUST** disable Row Level Security (RLS) in your Supabase database. Paste the following SQL script into your **Supabase SQL Editor** and click **Run**:
>
> ```sql
> -- Disable RLS on all tables to allow seamless client-side writes in this hybrid Firebase-Supabase app
> ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
> ALTER TABLE public.products DISABLE ROW LEVEL SECURITY;
> ALTER TABLE public.chats DISABLE ROW LEVEL SECURITY;
> ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY;
> ALTER TABLE public.reviews DISABLE ROW LEVEL SECURITY;
> ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;
> ALTER TABLE public.store_names DISABLE ROW LEVEL SECURITY;
> ALTER TABLE public.boost_purchases DISABLE ROW LEVEL SECURITY;
>
> -- Re-grant permissions to anon and authenticated roles
> GRANT ALL ON TABLE public.users TO anon, authenticated, service_role;
> GRANT ALL ON TABLE public.products TO anon, authenticated, service_role;
> GRANT ALL ON TABLE public.chats TO anon, authenticated, service_role;
> GRANT ALL ON TABLE public.messages TO anon, authenticated, service_role;
> GRANT ALL ON TABLE public.reviews TO anon, authenticated, service_role;
> GRANT ALL ON TABLE public.notifications TO anon, authenticated, service_role;
> GRANT ALL ON TABLE public.store_names TO anon, authenticated, service_role;
> GRANT ALL ON TABLE public.boost_purchases TO anon, authenticated, service_role;
> ```
>
> ---

## 1. Profiles Table (`users`)

The `users` table holds user account information and profiles. The policy ensures:
- Anyone can read user profiles (to display seller details on product pages).
- Users can only insert or update their own profile data.
- Deletions are restricted or reserved for administrators.

```sql
-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 1. Public Read Access: Allow anyone to view profile details
CREATE POLICY "Allow public read access to profiles" 
ON public.users 
FOR SELECT 
USING (true);

-- 2. Restrictive Write Access: Users can only insert their own profile record
CREATE POLICY "Allow users to insert their own profile" 
ON public.users 
FOR INSERT 
WITH CHECK (auth.uid()::text = id);

-- 3. Restrictive Update Access: Users can only update their own profile record
CREATE POLICY "Allow users to update their own profile" 
ON public.users 
FOR UPDATE 
USING (auth.uid()::text = id)
WITH CHECK (auth.uid()::text = id);

-- 4. Admin-only Delete Access (Optional / Recommended)
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
```

---

## 2. Products Table (`products`)

The `products` table holds classified listings. The policy ensures:
- Anyone can view listings (to browse the marketplace).
- Registered users can insert listings, but the `sellerId` must match their own authenticated UID.
- Users can only update or delete listings they own.

```sql
-- Enable Row Level Security
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- 1. Public Read Access: Allow anyone to browse products
CREATE POLICY "Allow public read access to products" 
ON public.products 
FOR SELECT 
USING (true);

-- 2. Authenticated Insert: Authenticated users can post products under their own seller ID
CREATE POLICY "Allow authenticated users to insert products" 
ON public.products 
FOR INSERT 
TO authenticated
WITH CHECK (auth.uid()::text = "sellerId");

-- 3. Owner Update: Users can only edit their own listings
CREATE POLICY "Allow owners to update their own products" 
ON public.products 
FOR UPDATE 
TO authenticated
USING (auth.uid()::text = "sellerId")
WITH CHECK (auth.uid()::text = "sellerId");

-- 4. Owner Delete: Users can only delete their own listings
CREATE POLICY "Allow owners to delete their own products" 
ON public.products 
FOR DELETE 
TO authenticated
USING (auth.uid()::text = "sellerId");
```

---

## How to Apply Policies in Supabase

1. Navigate to your **Supabase Dashboard**.
2. Go to the **SQL Editor** in the left sidebar.
3. Click **New query**, paste the SQL blocks above, and click **Run**.
4. Verify RLS is enabled and active under **Database** -> **Tables** or **Authentication** -> **Policies**.
