// Case-insensitive exact email matching for /api/users/get?email=. Kept out
// of server.ts so it can be unit-tested.

/** An ilike pattern that matches `value` exactly (ignoring case): LIKE's
 * `\`, `%` and `_` are escaped. Null when the value holds `*`, which
 * PostgREST turns into a wildcard and which can't be escaped there; callers
 * fall back to an exact `eq` match for those. */
export function exactIlikePattern(value: string): string | null {
  if (value.includes('*')) return null;
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** True when a stored email is the looked-up one, ignoring case and spaces. */
export function sameEmail(stored: unknown, wanted: string): boolean {
  return typeof stored === 'string' && stored.trim().toLowerCase() === wanted.trim().toLowerCase();
}

// Several rows can share an address in different capitals (older accounts). Pick one rather
// than failing: a live account first (exact spelling preferred), then a deleted one, never a
// different address. A deleted row must not hide the live account, or the app treats the
// address as new and never merges the old account's listings and reviews.
export function pickEmailMatch<T extends { email?: unknown; isDeleted?: unknown; status?: unknown }>(rows: T[], wanted: string): T | null {
  const same = (rows ?? []).filter(r => sameEmail(r.email, wanted));
  const active = same.filter(r => r.isDeleted !== true && r.status !== 'deleted');
  const exact = (r: T) => r.email === wanted.trim();
  return active.find(exact) ?? active[0] ?? same.find(exact) ?? same[0] ?? null;
}
