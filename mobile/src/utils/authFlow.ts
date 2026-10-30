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

export type LookupOutcome = 'found' | 'not-found' | 'error';
export type ProfileLookups = {
  byId: LookupOutcome;
  /** Unset until the email lookup has run. */
  byEmail?: LookupOutcome;
  /** What the email lookup found, when it found something. */
  emailMatch?: 'same-uid' | 'mergeable' | 'unmergeable';
  /** Unset until the merge has run. */
  merge?: 'ok' | 'error';
};
export type ProfileStep = 'lookup-email' | 'merge' | 'use-existing' | 'merged' | 'create-fresh' | 'fail';

/** Decides the next step when signing in a user whose profile may live under
 * their uid, under an older same-email id, or nowhere yet. Only a clear "not
 * found" leads to a fresh profile; any failed lookup or merge is `fail`, so a
 * flaky connection can never overwrite or duplicate a profile. */
export function nextProfileStep(s: ProfileLookups): ProfileStep {
  if (s.byId === 'error') return 'fail';
  if (s.byId === 'found') return 'use-existing';
  if (s.byEmail === undefined) return 'lookup-email';
  if (s.byEmail === 'error') return 'fail';
  if (s.byEmail === 'not-found') return 'create-fresh';
  if (s.emailMatch === 'same-uid') return 'use-existing';
  if (s.emailMatch !== 'mergeable') return 'create-fresh';
  if (s.merge === undefined) return 'merge';
  return s.merge === 'ok' ? 'merged' : 'fail';
}

/** Classifies a profile found by email against the signed-in uid. */
export function classifyEmailMatch(found: { id?: string; isDeleted?: boolean; status?: string } | null | undefined, uid: string): 'same-uid' | 'mergeable' | 'unmergeable' {
  if (found?.id === uid) return 'same-uid';
  return isMergeableProfile(found, uid) ? 'mergeable' : 'unmergeable';
}
