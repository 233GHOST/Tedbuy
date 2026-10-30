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
