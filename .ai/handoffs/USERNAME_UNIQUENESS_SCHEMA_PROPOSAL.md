# Username/Store-Name Uniqueness — Schema Proposal

**STATUS: AWAITING APPROVAL. NOTHING BELOW HAS BEEN EXECUTED.** This sandbox has no Supabase credentials — execution is Vincent's alone, same as every other schema change this session.

## What's already fixed, and what isn't

Found while auditing `/api/users/sync` (`server.ts`) — the single endpoint behind every profile save AND registration itself, on both platforms.

**Already fixed and shipped (no DB change needed for this part):** the `users` table upsert's failure was silently swallowed — `if (error) { console.warn(...); }` with no early return, so the endpoint fell through to an unconditional `res.json({ success: true, ... })` regardless of whether the actual database write succeeded. This is the exact "write failure reported as success" pattern already fixed several times this session elsewhere (`deleteAccount`, `adminToggleSecurityHold`, `updateProduct`'s rollback) — just one layer deeper than the earlier `registerUser` fix (`AppContext.tsx`, which correctly rethrows on `!data.success`, but that fix was useless against THIS specific failure mode since the server never told it anything had gone wrong). Now returns a proper `500` with a clean message, and specifically translates a Postgres unique-violation (`23505`) into "That username is already taken. Please choose another." if one ever fires.

**Still open, needs this migration:** there is no uniqueness enforcement on `users.username` at all today — no application-level check, and (as far as this sandbox can tell without DB access) no database constraint either. `store_names` (a separate reservation-index table, keyed by the lowercased username) doesn't prevent this either: its own write is a plain `upsert(..., { onConflict: 'id' })`, which on a matching id *overwrites* the existing row's `userId` rather than rejecting the write — so if two different users both save `username: "TechDeals"`, the second one to write simply reassigns that reservation row to themselves, while both users' own `users.username` field can independently say "TechDeals" with nothing to stop it. Concretely: two sellers can end up with the identical public store name/URL, or a bad actor can deliberately claim the exact same name as an established, trusted seller. This is a real gap, not a race-condition edge case — it's simply unenforced today for any two normal, non-simultaneous requests.

The application-level fix just shipped (properly surfacing an upsert failure) is what makes a database constraint actually *useful* here — without it, even adding the constraint below would still show the user a generic "profile save failed" with no indication *why*, since the failure would have been silently swallowed the same way. With it, the constraint below becomes the real enforcement, and the error message is already wired to explain it clearly.

## Exact SQL

**Step 1 — check for existing duplicates first.** Postgres will refuse to create a unique index over data that already violates it, and this table has never had this enforced, so this needs to run and be reviewed before step 2:

```sql
SELECT LOWER(username) AS normalized_username, COUNT(*) AS count, array_agg(id) AS user_ids
FROM public.users
WHERE username IS NOT NULL
GROUP BY LOWER(username)
HAVING COUNT(*) > 1
ORDER BY count DESC;
```

If this returns any rows, those accounts need a manual decision (rename one, merge, or leave as-is and defer step 2) before the constraint can be added — this script has no way to know which of two same-named accounts is the "real" one, so it isn't something to auto-resolve.

**Step 2 — once step 1 comes back empty (or after resolving what it finds), add the constraint:**

```sql
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique_idx
ON public.users (LOWER(username));
```

A case-insensitive unique index (not a plain `UNIQUE` constraint on `username` directly) — a plain constraint is case-*sensitive* by default, so "TechDeals" and "techdeals" would still count as different values and both be allowed, which doesn't match how `store_names.id` already normalizes (always lowercased) or how the reserved-name/quarantine checks already compare.

## Expected impact

Once step 1 is clean, step 2 is a fast, standard index build — brief write-lock on `users` while it builds (table size here is small; not expected to be noticeable). After it's live, any `/api/users/sync` call attempting to set a username already in use (case-insensitively) by a *different* user gets a clean `23505` from Postgres, which the code fix already shipped this session now turns into "That username is already taken. Please choose another." instead of a silent success or a generic failure.

No RLS/grant implications — this is a plain B-tree index on an existing, already-granted table, not a new table or a policy change.

## Rollback SQL

```sql
DROP INDEX IF EXISTS public.users_username_lower_unique_idx;
```

Safe to run at any time — returns username saves to today's already-shipped behavior (no active-uniqueness enforcement, but a genuine database error would no longer be silently swallowed regardless, since that part of the fix doesn't depend on this index existing).
