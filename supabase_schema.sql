-- ====================================================================
-- TEDBUY SUPABASE (POSTGRESQL) SCHEMA BOOTSTRAP SCRIPT
-- Copy and paste this code into your Supabase SQL Editor to set up
-- your 100% free, durable cloud database.
-- ====================================================================

-- Enable UUID or other extensions if needed (optional)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY, -- Firebase Auth UID
    username TEXT NOT NULL,
    email TEXT,
    "phoneNumber" TEXT,
    "whatsAppNumber" TEXT,
    role TEXT DEFAULT 'both',
    "joinDate" TEXT,
    "photoUrl" TEXT,
    "followingSellers" JSONB DEFAULT '[]'::jsonb, -- Array of user IDs
    "savedProductIds" JSONB DEFAULT '[]'::jsonb, -- Array of product IDs
    "emailVerified" BOOLEAN DEFAULT false,
    "isGoogleAuth" BOOLEAN DEFAULT false,
    "authProvider" TEXT,
    "isAdmin" BOOLEAN DEFAULT false,
    "welcomeSent" BOOLEAN DEFAULT false,
    "isSuspended" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. PRODUCTS TABLE
CREATE TABLE IF NOT EXISTS public.products (
    id TEXT PRIMARY KEY, -- e.g. prod_1780927804590
    title TEXT NOT NULL,
    description TEXT,
    price TEXT, -- Stored as string to handle "Negotiable" or "GH₵100" or raw values
    category TEXT,
    location TEXT,
    images JSONB DEFAULT '[]'::jsonb, -- Array of image URLs/base64
    videos JSONB DEFAULT '[]'::jsonb, -- Array of video URLs
    brand TEXT,
    condition TEXT,
    negotiable BOOLEAN DEFAULT false,
    "sellerId" TEXT,
    "sellerName" TEXT,
    "createdAt" TEXT, -- ISO string to match frontend expectations
    "viewsCount" INTEGER DEFAULT 0,
    "likesCount" INTEGER DEFAULT 0,
    "likedUserIds" JSONB DEFAULT '[]'::jsonb, -- Array of user IDs who liked it
    "boostStatus" BOOLEAN DEFAULT false,
    "boostPlan" TEXT,
    "boostStartDate" TEXT,
    "boostEndDate" TEXT,
    "boostPriority" NUMERIC DEFAULT 0,
    "priorityScore" NUMERIC DEFAULT 0,
    "boostPriorityLevel" INTEGER DEFAULT 0,
    "boostPackagePrice" NUMERIC DEFAULT 0,
    "remainingBoostTime" NUMERIC DEFAULT 0,
    "boostAmount" NUMERIC DEFAULT 0,
    "lastBoostedAt" TEXT,
    "lastBoostPurchase" TEXT,
    "paymentStatus" TEXT,
    "paymentReference" TEXT,
    "boostHistory" JSONB DEFAULT '[]'::jsonb,
    "visitCount" INTEGER DEFAULT 0,
    "isApproved" BOOLEAN DEFAULT true
);

-- Create index on products category and location for fast filtering
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category);
CREATE INDEX IF NOT EXISTS idx_products_seller ON public.products("sellerId");
CREATE INDEX IF NOT EXISTS idx_products_created_at ON public.products("createdAt" DESC);

-- 3. CHATS TABLE
CREATE TABLE IF NOT EXISTS public.chats (
    id TEXT PRIMARY KEY, -- e.g. chat_support_xxx
    "productId" TEXT,
    "productTitle" TEXT,
    "productPrice" TEXT,
    "productImage" TEXT,
    "buyerId" TEXT,
    "buyerName" TEXT,
    "sellerId" TEXT,
    "sellerName" TEXT,
    "lastMessageText" TEXT,
    "lastMessageTime" TEXT, -- ISO string
    "tradeStatus" TEXT DEFAULT 'pending',
    "adId" TEXT,
    "adTitle" TEXT,
    "adImage" TEXT,
    "adThumbnail" TEXT,
    "adType" TEXT
);

CREATE INDEX IF NOT EXISTS idx_chats_buyer ON public.chats("buyerId");
CREATE INDEX IF NOT EXISTS idx_chats_seller ON public.chats("sellerId");

-- 4. MESSAGES TABLE
CREATE TABLE IF NOT EXISTS public.messages (
    id TEXT PRIMARY KEY,
    "chatId" TEXT REFERENCES public.chats(id) ON DELETE CASCADE,
    "senderId" TEXT,
    "recipientId" TEXT,
    text TEXT,
    "createdAt" TEXT, -- ISO string
    read BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON public.messages("chatId");
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages("senderId");
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON public.messages("recipientId");

-- 5. REVIEWS TABLE
CREATE TABLE IF NOT EXISTS public.reviews (
    id TEXT PRIMARY KEY,
    "buyerId" TEXT,
    "buyerName" TEXT,
    "sellerId" TEXT,
    rating NUMERIC DEFAULT 5,
    comment TEXT,
    "productTitle" TEXT,
    "createdAt" TEXT -- ISO string
);

CREATE INDEX IF NOT EXISTS idx_reviews_seller ON public.reviews("sellerId");

-- 6. NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS public.notifications (
    id TEXT PRIMARY KEY,
    "userId" TEXT,
    title TEXT,
    message TEXT,
    type TEXT,
    read BOOLEAN DEFAULT false,
    "createdAt" TEXT, -- ISO string
    "relatedId" TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications("userId");

-- 7. STORE NAMES TABLE (to enforce username uniqueness)
CREATE TABLE IF NOT EXISTS public.store_names (
    id TEXT PRIMARY KEY, -- lowercase username
    "userId" TEXT NOT NULL,
    username TEXT NOT NULL
);

-- 8. BOOST PURCHASES TABLE
CREATE TABLE IF NOT EXISTS public.boost_purchases (
    id TEXT PRIMARY KEY,
    "productId" TEXT,
    "userId" TEXT,
    amount NUMERIC,
    currency TEXT DEFAULT 'GHS',
    status TEXT,
    "createdAt" TEXT
);

-- ====================================================================
-- ENABLE ROW LEVEL SECURITY (RLS) FOR RAPID HYBRID INTEGRATION
-- This ensures client-side operations and backend operations can 
-- write/read seamlessly without complex RLS policy setups.
-- ====================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_names ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boost_purchases ENABLE ROW LEVEL SECURITY;

-- Grant SELECT to anon for public reads (products, reviews, store_names)
GRANT SELECT ON TABLE public.products TO anon;
GRANT SELECT ON TABLE public.reviews TO anon;
GRANT SELECT ON TABLE public.store_names TO anon;

-- Grant full access to authenticated users via RLS policies
GRANT ALL ON TABLE public.users TO authenticated, service_role;
GRANT ALL ON TABLE public.products TO authenticated, service_role;
GRANT ALL ON TABLE public.chats TO authenticated, service_role;
GRANT ALL ON TABLE public.messages TO authenticated, service_role;
GRANT ALL ON TABLE public.reviews TO authenticated, service_role;
GRANT ALL ON TABLE public.notifications TO authenticated, service_role;
GRANT ALL ON TABLE public.store_names TO authenticated, service_role;
GRANT ALL ON TABLE public.boost_purchases TO authenticated, service_role;

-- ====================================================================
-- ROW LEVEL SECURITY POLICIES
-- ====================================================================

-- USERS: Users can read all profiles (public marketplace), update own, admin sees all
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_select_public" ON public.users FOR SELECT USING (true);
CREATE POLICY "users_insert_own" ON public.users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "users_update_own" ON public.users FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "users_admin_all" ON public.users FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND "isAdmin" = true)
);

-- PRODUCTS: Public read, sellers manage own, admin manages all
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_select_public" ON public.products FOR SELECT USING (true);
CREATE POLICY "products_insert_own" ON public.products FOR INSERT WITH CHECK (auth.uid() = "sellerId");
CREATE POLICY "products_update_own" ON public.products FOR UPDATE USING (auth.uid() = "sellerId")
  WITH CHECK (
    auth.uid() = "sellerId"
    AND NOT ("boostStatus" IS DISTINCT FROM (SELECT "boostStatus" FROM public.products WHERE id = public.products.id))
    AND NOT ("boostPriority" IS DISTINCT FROM (SELECT "boostPriority" FROM public.products WHERE id = public.products.id))
    AND NOT ("priorityScore" IS DISTINCT FROM (SELECT "priorityScore" FROM public.products WHERE id = public.products.id))
  );
CREATE POLICY "products_admin_all" ON public.products FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND "isAdmin" = true)
);

-- CHATS: Participants can read their chats, create as buyer, update as participant
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chats_select_own" ON public.chats FOR SELECT USING (
  auth.uid() = "buyerId" OR auth.uid() = "sellerId" OR
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND "isAdmin" = true)
);
CREATE POLICY "chats_insert_buyer" ON public.chats FOR INSERT WITH CHECK (auth.uid() = "buyerId");
CREATE POLICY "chats_update_participant" ON public.chats FOR UPDATE USING (
  auth.uid() = "buyerId" OR auth.uid() = "sellerId" OR
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND "isAdmin" = true)
);
CREATE POLICY "chats_admin_all" ON public.chats FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND "isAdmin" = true)
);

-- MESSAGES: Participants can read, send as participant, mark own as read
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages_select_participant" ON public.messages FOR SELECT USING (
  auth.uid() = "senderId" OR auth.uid() = "recipientId" OR
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND "isAdmin" = true)
);
CREATE POLICY "messages_insert_participant" ON public.messages FOR INSERT WITH CHECK (auth.uid() = "senderId");
CREATE POLICY "messages_update_recipient" ON public.messages FOR UPDATE USING (auth.uid() = "recipientId")
  WITH CHECK (auth.uid() = "recipientId");
CREATE POLICY "messages_admin_all" ON public.messages FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND "isAdmin" = true)
);

-- REVIEWS: Public read, create as buyer, admin manages
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reviews_select_public" ON public.reviews FOR SELECT USING (true);
CREATE POLICY "reviews_insert_buyer" ON public.reviews FOR INSERT WITH CHECK (
  auth.uid() = "buyerId" AND auth.uid() != "sellerId"
);
CREATE POLICY "reviews_admin_all" ON public.reviews FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND "isAdmin" = true)
);

-- NOTIFICATIONS: Users read own, system creates, users update own
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT USING (
  auth.uid() = "userId" OR
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND "isAdmin" = true)
);
CREATE POLICY "notifications_insert_system" ON public.notifications FOR INSERT WITH CHECK (
  auth.uid() = "userId" OR
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND "isAdmin" = true)
);
CREATE POLICY "notifications_update_own" ON public.notifications FOR UPDATE USING (auth.uid() = "userId");
CREATE POLICY "notifications_admin_all" ON public.notifications FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND "isAdmin" = true)
);

-- STORE_NAMES: Public read, own create/update
ALTER TABLE public.store_names ENABLE ROW LEVEL SECURITY;
CREATE POLICY "store_names_select_public" ON public.store_names FOR SELECT USING (true);
CREATE POLICY "store_names_insert_own" ON public.store_names FOR INSERT WITH CHECK (auth.uid() = "userId");
CREATE POLICY "store_names_update_own" ON public.store_names FOR UPDATE USING (auth.uid() = "userId") WITH CHECK (auth.uid() = "userId");
CREATE POLICY "store_names_admin_all" ON public.store_names FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND "isAdmin" = true)
);

-- BOOST_PURCHASES: Users read own, system creates, admin manages
ALTER TABLE public.boost_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "boost_purchases_select_own" ON public.boost_purchases FOR SELECT USING (
  auth.uid() = "userId" OR
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND "isAdmin" = true)
);
CREATE POLICY "boost_purchases_insert_own" ON public.boost_purchases FOR INSERT WITH CHECK (auth.uid() = "userId");
CREATE POLICY "boost_purchases_admin_all" ON public.boost_purchases FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND "isAdmin" = true)
);

-- Done! You're ready to go. Run this in your Supabase SQL editor.
--
-- UPGRADE SCRIPTS FOR EXISTING DEPLOYMENTS:
-- If your users table already exists, run this query in your Supabase SQL Editor:
-- ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "isSuspended" BOOLEAN DEFAULT false;

