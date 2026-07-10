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
-- DISABLE ROW LEVEL SECURITY (RLS) FOR RAPID HYBRID INTEGRATION
-- This ensures client-side operations and backend operations can 
-- write/read seamlessly without complex RLS policy setups.
-- ====================================================================
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.products DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_names DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.boost_purchases DISABLE ROW LEVEL SECURITY;

-- Grant all privileges to the anon and authenticated roles
GRANT ALL ON TABLE public.users TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.products TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.chats TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.messages TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.reviews TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.notifications TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.store_names TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.boost_purchases TO anon, authenticated, service_role;

-- Done! You're ready to go. Run this in your Supabase SQL editor.
