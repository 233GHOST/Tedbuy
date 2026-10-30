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
  /** Unset until the merge has run. `gone`: the old account no longer
   * exists (404). `refused`: the server will not join it (403). */
  merge?: 'ok' | 'gone' | 'refused' | 'error';
};
export type ProfileStep = 'lookup-email' | 'merge' | 'use-existing' | 'merged' | 'create-fresh' | 'refused' | 'fail';

// Shown when an older same-email account exists but the server refuses to
// join it; retrying would never help, so the user is sent to support.
export const MERGE_REFUSED_MESSAGE =
  "We found an older TedBuy account with this email but couldn't join it automatically. Please contact TedBuy Support at info.tedbuy@gmail.com.";

/** Decides the next step when signing in a user whose profile may live under
 * their uid, under an older same-email id, or nowhere yet. Only a clear "not
 * found" (or an old account that has since gone) leads to a fresh profile;
 * a failed lookup or merge is `fail` (retry) or `refused` (contact support),
 * so a flaky connection can never overwrite or duplicate a profile. */
export function nextProfileStep(s: ProfileLookups): ProfileStep {
  if (s.byId === 'error') return 'fail';
  if (s.byId === 'found') return 'use-existing';
  if (s.byEmail === undefined) return 'lookup-email';
  if (s.byEmail === 'error') return 'fail';
  if (s.byEmail === 'not-found') return 'create-fresh';
  if (s.emailMatch === 'same-uid') return 'use-existing';
  if (s.emailMatch !== 'mergeable') return 'create-fresh';
  if (s.merge === undefined) return 'merge';
  if (s.merge === 'ok') return 'merged';
  if (s.merge === 'gone') return 'create-fresh';
  if (s.merge === 'refused') return 'refused';
  return 'fail';
}

/** Classifies a profile found by email against the signed-in uid. */
export function classifyEmailMatch(found: { id?: string; isDeleted?: boolean; status?: string } | null | undefined, uid: string): 'same-uid' | 'mergeable' | 'unmergeable' {
  if (found?.id === uid) return 'same-uid';
  return isMergeableProfile(found, uid) ? 'mergeable' : 'unmergeable';
}
