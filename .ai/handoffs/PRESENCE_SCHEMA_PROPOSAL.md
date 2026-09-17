# Online Presence — Schema Proposal

**STATUS: AWAITING APPROVAL. NOTHING BELOW HAS BEEN EXECUTED.** This sandbox has no Supabase credentials — execution is Vincent's alone, same as every other schema change this session (`reports_table_creation.sql`, RLS Phase 4, the push-notifications proposal).

Built while implementing WhatsApp-style online presence (green dot on a seller's avatar when they're actively using the app) — server endpoints (`POST /api/users/heartbeat`, `computeIsOnline()`, wired into `/api/users/list`, `/api/users/get`, `getSellersSummaryData()`) and both mobile UI (`SellerCard.tsx`, `SellerProfileScreen.tsx`) already committed to `main`. All currently no-ops in production until this migration runs — the heartbeat write fails gracefully (caught, logged, 500 returned but the client swallows it silently, same tolerance as push-token registration), and every read path already has a fallback that omits `lastSeen` from its query and just returns `isOnline: false` for everyone if the column doesn't exist yet.

---

## Exact SQL

```sql
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "lastSeen" TIMESTAMP WITH TIME ZONE;
```

One nullable column on the existing `users` table. No new table, no constraints, no default, no index (looked up only by the row's own primary key via `.eq('id', ...)`, never searched/filtered on across rows).

**Deliberately not adding a stored `isOnline` boolean column.** "Online" is always computed at read time from how recent `lastSeen` is (`computeIsOnline()` in `server.ts`, currently a 3-minute threshold) rather than trusted as its own stored flag — a stored boolean would get stuck `true` forever the moment a client stops sending heartbeats (app killed, backgrounded, connection lost), since there's no reliable moment where the app can guarantee writing `isOnline: false` on the way out. Deriving it from a timestamp is the same approach WhatsApp's own "last seen" model uses, just without needing a second column.

## Expected impact

None on any existing data or behavior. `ADD COLUMN IF NOT EXISTS` on a nullable column with no default is a fast, non-locking metadata-only change in Postgres — every existing row simply gets `NULL`, which `computeIsOnline(null)` already correctly treats as offline.

No grant changes needed: `anon`/`authenticated`/`service_role` already hold `GRANT ALL` on `public.users` at the table level (from the original `supabase_schema.sql`) — new columns on an already-granted table are automatically covered. No RLS implications either — RLS governs row visibility, not column structure; `users` already has RLS enabled with zero policies (Phase 4), and the server's client bypasses that regardless of what columns exist.

## Rollback SQL

```sql
ALTER TABLE public.users DROP COLUMN IF EXISTS "lastSeen";
```

Safe to run at any time. `POST /api/users/heartbeat`'s write would start failing again (already handled — caught, logged, client swallows it), and the three read endpoints already fall back to their pre-migration column set and `isOnline: false` for everyone. Dropping the column just returns presence to its current (already-shipped) no-op state; nothing else is affected.

## What still needs to happen after this runs

1. **A fresh EAS build / app reload.** The mobile changes (heartbeat effect, `SellerCard`/`SellerProfileScreen` online dots) are already live via the running Expo dev session for testing, but a production build needs to include this same code — same "still needs an EAS build" queue as the earlier push-notifications and performance work this session.
2. **A server redeploy.** `server.ts`'s heartbeat endpoint and the three wired read endpoints need Render to pick up the latest `main` before any of this takes effect in production, independent of the SQL running.
3. **No real-device verification blocker** — unlike push notifications, this feature works fine in Expo Go (no native module involved), so it can be tested live as soon as both the SQL and the server deploy are in.

None of this blocks approving the SQL above — the column migration is the one production-side database action needed to make the already-shipped code paths actually take effect.
