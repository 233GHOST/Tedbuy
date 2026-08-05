-- ====================================================================
-- TEDBUY SUPABASE (POSTGRESQL) COMPLETE SCHEMA & REPAIR SCRIPT
-- Copy and paste this code into your Supabase SQL Editor.
-- ====================================================================

-- --------------------------------------------------------------------
-- OPTION A: REPAIR EXISTING TABLES (Safe for existing database)
-- Runs ALTER TABLE to guarantee all camelCase columns exist.
-- --------------------------------------------------------------------

-- Repair users table
CREATE TABLE IF NOT EXISTS public.users (id TEXT PRIMARY KEY, username TEXT NOT NULL);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "phoneNumber" TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "whatsAppNumber" TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'both';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "joinDate" TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "followingSellers" JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "savedProductIds" JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "isGoogleAuth" BOOLEAN DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS authProvider TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "updatedAt" TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "isAdmin" BOOLEAN DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "welcomeSent" BOOLEAN DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "isSuspended" BOOLEAN DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- Repair products table
CREATE TABLE IF NOT EXISTS public.products (id TEXT PRIMARY KEY, title TEXT NOT NULL);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS price TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS videos JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS condition TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS negotiable BOOLEAN DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "sellerId" TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "sellerName" TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "createdAt" TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "viewsCount" INTEGER DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "likesCount" INTEGER DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "likedUserIds" JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "boostStatus" BOOLEAN DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "boostPlan" TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "boostStartDate" TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "boostEndDate" TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "boostPriority" NUMERIC DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "priorityScore" NUMERIC DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "boostPriorityLevel" INTEGER DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "boostPackagePrice" NUMERIC DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "remainingBoostTime" NUMERIC DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "boostAmount" NUMERIC DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "lastBoostedAt" TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "lastBoostPurchase" TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "paymentReference" TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "boostHistory" JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "visitCount" INTEGER DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "isApproved" BOOLEAN DEFAULT true;

-- Repair chats table
CREATE TABLE IF NOT EXISTS public.chats (id TEXT PRIMARY KEY);
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS "productId" TEXT;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS "productTitle" TEXT;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS "productPrice" TEXT;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS "productImage" TEXT;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS "buyerId" TEXT;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS "buyerName" TEXT;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS "sellerId" TEXT;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS "sellerName" TEXT;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS "lastMessageText" TEXT;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS "lastMessageTime" TEXT;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS "tradeStatus" TEXT DEFAULT 'pending';
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS "adId" TEXT;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS "adTitle" TEXT;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS "adImage" TEXT;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS "adThumbnail" TEXT;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS "adType" TEXT;

-- Repair messages table
CREATE TABLE IF NOT EXISTS public.messages (id TEXT PRIMARY KEY);
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS "chatId" TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS "senderId" TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS "recipientId" TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS text TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS "createdAt" TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS read BOOLEAN DEFAULT false;

-- Repair reviews table
CREATE TABLE IF NOT EXISTS public.reviews (id TEXT PRIMARY KEY);
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS "buyerId" TEXT;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS "buyerName" TEXT;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS "sellerId" TEXT;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS rating NUMERIC DEFAULT 5;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS comment TEXT;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS "productTitle" TEXT;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS "createdAt" TEXT;

-- Repair notifications table
CREATE TABLE IF NOT EXISTS public.notifications (id TEXT PRIMARY KEY);
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS read BOOLEAN DEFAULT false;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "createdAt" TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "relatedId" TEXT;

-- Repair store_names table
CREATE TABLE IF NOT EXISTS public.store_names (id TEXT PRIMARY KEY);
ALTER TABLE public.store_names ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE public.store_names ADD COLUMN IF NOT EXISTS username TEXT;

-- Repair boost_purchases table
CREATE TABLE IF NOT EXISTS public.boost_purchases (id TEXT PRIMARY KEY);
ALTER TABLE public.boost_purchases ADD COLUMN IF NOT EXISTS "productId" TEXT;
ALTER TABLE public.boost_purchases ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE public.boost_purchases ADD COLUMN IF NOT EXISTS amount NUMERIC;
ALTER TABLE public.boost_purchases ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'GHS';
ALTER TABLE public.boost_purchases ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE public.boost_purchases ADD COLUMN IF NOT EXISTS "createdAt" TEXT;

-- --------------------------------------------------------------------
-- CREATE INDEXES FOR FAST QUERYING
-- --------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category);
CREATE INDEX IF NOT EXISTS idx_products_seller ON public.products("sellerId");
CREATE INDEX IF NOT EXISTS idx_products_created_at ON public.products("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_chats_buyer ON public.chats("buyerId");
CREATE INDEX IF NOT EXISTS idx_chats_seller ON public.chats("sellerId");
CREATE INDEX IF NOT EXISTS idx_messages_chat ON public.messages("chatId");
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages("senderId");
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON public.messages("recipientId");
CREATE INDEX IF NOT EXISTS idx_reviews_seller ON public.reviews("sellerId");
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications("userId");

-- --------------------------------------------------------------------
-- PERMISSIONS & DISABLE RLS FOR HYBRID API ACCESS
-- --------------------------------------------------------------------
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.products DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_names DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.boost_purchases DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.users TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.products TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.chats TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.messages TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.reviews TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.notifications TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.store_names TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.boost_purchases TO anon, authenticated, service_role;

-- DONE! All tables and missing camelCase columns are now active.

