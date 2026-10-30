/** True when the sign-in field holds an email (vs a username or phone number). */
export function isEmailIdentifier(identifier: string): boolean {
  return identifier.trim().includes('@');
}

/** Keeps only the digits of a pasted/typed verification code, max 6. */
export function normalizeOtpInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6);
}

// Same reservation and wording as the website's registration flow.
export const RESERVED_REGISTRATION_EMAIL = 'asumaduvincent7@gmail.com';
export const RESERVED_EMAIL_MESSAGE =
  'Registration Limit: The email address "asumaduvincent7@gmail.com" has been reserved for system security. Please use a different individual email address to register.';

/** True when a profile found by email may be joined into the signed-in
 * account: a different id, and not a soft-deleted tombstone. */
export function isMergeableProfile(found: { id?: string; isDeleted?: boolean; status?: string } | null | undefined, uid: string): boolean {
  return !!found && !!found.id && found.id !== uid && !found.isDeleted && found.status !== 'deleted';
}
