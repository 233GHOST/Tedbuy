-- Columns server.ts writes but production never had (found by comparing with baseline 20261001000000, 2026-10-27).
-- Definitions copied from supabase_schema.sql. Additive and nullable (status has a constant default), so
-- existing rows and running code are unaffected; PostgreSQL 17 adds them without rewriting the tables.

-- Store-name quarantine on account deletion (server.ts /api/users/delete-account): the upsert fails
-- without these, so a deleted seller's store name was never reserved in Supabase.
ALTER TABLE public.store_names ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.store_names ADD COLUMN IF NOT EXISTS "availableAfter" TEXT;
ALTER TABLE public.store_names ADD COLUMN IF NOT EXISTS "quarantinedAt" TEXT;

-- Notification details (createNotification): the upsert's auto-heal dropped these, so notifications
-- were saved without the product or the person that triggered them.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "triggerUserId" TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "triggerUsername" TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "triggerUserPhoto" TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "productId" TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "productTitle" TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "productPrice" TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "productImage" TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "chatId" TEXT;
