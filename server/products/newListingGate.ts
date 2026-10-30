// Decision logic for "verify your email before posting a new ad" on
// POST /api/products/sync. Kept out of server.ts so it can be unit-tested.
// Edits to an existing listing are never blocked here.

export const EMAIL_NOT_VERIFIED_CODE = 'EMAIL_NOT_VERIFIED';
export const EMAIL_NOT_VERIFIED_MESSAGE = 'Please verify your email address before posting a new ad.';

export type NewListingDecision =
  | { ok: true }
  | { ok: false; status: 403; code: typeof EMAIL_NOT_VERIFIED_CODE; error: string };

export function decideNewListing(input: { isNewListing: boolean; emailVerified: boolean }): NewListingDecision {
  if (!input.isNewListing || input.emailVerified) return { ok: true };
  return { ok: false, status: 403, code: EMAIL_NOT_VERIFIED_CODE, error: EMAIL_NOT_VERIFIED_MESSAGE };
}
