// Decision logic for "verify your email before posting a new ad" on
// POST /api/products/sync. Kept out of server.ts so it can be unit-tested.
// Edits to an existing listing are never blocked here.

export const EMAIL_NOT_VERIFIED_CODE = 'EMAIL_NOT_VERIFIED';
export const EMAIL_NOT_VERIFIED_MESSAGE = 'Please verify your email address before posting a new ad.';
export const ACCOUNT_CHECK_FAILED_MESSAGE = 'Could not confirm your account right now. Please try again.';

export type NewListingDecision =
  | { ok: true }
  | { ok: false; status: 403; code: typeof EMAIL_NOT_VERIFIED_CODE; error: string }
  | { ok: false; status: 503; code?: undefined; error: string };

/** `emailVerified: null` means the lookup itself failed: refuse the write
 * (fail closed) but say "try again", not "verify your email", so an already
 * verified user isn't sent into a verify loop. */
export function decideNewListing(input: { isNewListing: boolean; emailVerified: boolean | null }): NewListingDecision {
  if (!input.isNewListing || input.emailVerified === true) return { ok: true };
  if (input.emailVerified === null) return { ok: false, status: 503, error: ACCOUNT_CHECK_FAILED_MESSAGE };
  return { ok: false, status: 403, code: EMAIL_NOT_VERIFIED_CODE, error: EMAIL_NOT_VERIFIED_MESSAGE };
}
