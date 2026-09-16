# Push Notifications — Schema Proposal

**STATUS: AWAITING APPROVAL. NOTHING BELOW HAS BEEN EXECUTED.** This sandbox has no Supabase credentials — execution is Vincent's alone, same as every other schema change this session (`reports_table_creation.sql`, RLS Phase 4).

Built while implementing mobile push notification infrastructure (client-side registration flow, `/api/users/push-token`, and real push delivery wired into `createNotification()` — all already committed to `main`, all currently no-ops in production until this migration runs, since the code paths that touch these columns fail gracefully rather than crash).

---

## Exact SQL

```sql
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "pushToken" TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "pushTokenPlatform" TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "pushTokenUpdatedAt" TIMESTAMP WITH TIME ZONE;
```

Three nullable columns on the existing `users` table. No new table, no constraints, no defaults, no index (not needed — this is only ever looked up by the row's own primary key, `id`, never searched/filtered on).

- `"pushToken"` — the device's Expo push token (`ExponentPushToken[...]`), written by `POST /api/users/push-token` and read by `sendPushNotification()` (server.ts) whenever a notification is created.
- `"pushTokenPlatform"` — `'ios'` or `'android'`, diagnostic only, not currently read by any code path.
- `"pushTokenUpdatedAt"` — when the token was last (re-)registered, diagnostic only for now — useful later for identifying stale/abandoned tokens (e.g. a token untouched for 6+ months likely belongs to an uninstalled app) without needing to add this column again.

## Expected impact

None on any existing data or behavior. `ADD COLUMN IF NOT EXISTS` on a nullable column with no default is a fast, non-locking metadata-only change in Postgres — every existing row simply gets `NULL` for all three new columns, which is exactly the "no token registered yet" state the code already expects and handles.

No grant changes needed: `anon`/`authenticated`/`service_role` already hold `GRANT ALL` on `public.users` at the table level (from the original `supabase_schema.sql`) — new columns on an already-granted table are automatically covered, no separate grant statement required. No RLS implications either — RLS governs row visibility, not column structure; `users` already has RLS enabled with zero policies (confirmed in Phase 4), and the server's `service_role` client bypasses that regardless of what columns exist.

## Rollback SQL

```sql
ALTER TABLE public.users DROP COLUMN IF EXISTS "pushToken";
ALTER TABLE public.users DROP COLUMN IF EXISTS "pushTokenPlatform";
ALTER TABLE public.users DROP COLUMN IF EXISTS "pushTokenUpdatedAt";
```

Safe to run at any time — every code path that reads or writes these columns already fails gracefully (caught, logged, no-op) if they don't exist, matching the exact same defensive pattern already proven in production for the `products.updatedAt` gap. Dropping them just returns push notifications to their current (already-shipped) no-op state; nothing else is affected.

## What still needs to happen after this runs

1. **A new EAS build.** `expo-notifications` is a native module (like `@react-native-google-signin/google-signin`) — it doesn't work in Expo Go, so real device testing needs a fresh build: `cd mobile && npx eas-cli build --profile production-apk --platform android` (same command already used for the earlier stale-build issue).
2. **A notification icon asset.** Android push notifications render best with a dedicated small monochrome icon; none exists yet, so Android will fall back to a generated default for now — cosmetic, not functional, safe to add later.
3. **Real-device verification** — this sandbox cannot test whether a push actually arrives; that needs Vincent's own device once the build above exists.

None of this blocks approving the SQL above — the column migration is the one production-side action needed to make the already-shipped code paths actually take effect.
