// Administrator identity for the TedBuy server. One place for every "is this request an
// admin?" decision, so the rule can't drift between routes.
//
// Admin authority comes only from a verified Firebase ID token:
//   * a truthy `admin` custom claim (set with the Firebase Admin SDK), or
//   * the owner's email address WITH `email_verified === true`.
// A request body, a stored users-row `isAdmin` flag or a stored email never grants it.

export const OWNER_EMAIL = 'asumaduvincent7@gmail.com';

export const normalizeEmail = (email: unknown): string => (typeof email === 'string' ? email.trim().toLowerCase() : '');

// The subset of a verified Firebase ID token (DecodedIdToken) that decides admin status.
export interface AdminTokenClaims {
  uid: string;
  email?: unknown;
  email_verified?: unknown;
  admin?: unknown;
}

export interface ServerIdentity {
  uid: string;
  email: string;
  isAdmin?: boolean;
  isImpersonating?: boolean;
  originalAdmin?: { uid: string; email: string };
  emailVerified?: boolean;
}

export function isVerifiedOwner(claims: Pick<AdminTokenClaims, 'email' | 'email_verified'>): boolean {
  return claims.email_verified === true && normalizeEmail(claims.email) === OWNER_EMAIL;
}

// Admin status of a verified token. `!!claims.admin` keeps the existing truthiness rule for
// custom claims so that any claim already in use keeps working.
export function isAdminToken(claims: AdminTokenClaims): boolean {
  return !!claims.admin || isVerifiedOwner(claims);
}

export function identityFromToken(claims: AdminTokenClaims): ServerIdentity {
  return {
    uid: claims.uid,
    email: normalizeEmail(claims.email),
    isAdmin: isAdminToken(claims),
    emailVerified: claims.email_verified === true,
  };
}

export interface ImpersonationSession {
  targetUserId: string;
  targetUserEmail: string;
  expiresAt: string;
}

// Unchanged rule: only an admin may act through an unexpired impersonation session; the
// request then runs as the target, keeps admin authority, and records the real admin.
export function applyImpersonation(base: ServerIdentity, session: ImpersonationSession | undefined, now = Date.now()): ServerIdentity {
  if (!base.isAdmin || !session || new Date(session.expiresAt).getTime() <= now) return base;
  return {
    uid: session.targetUserId,
    email: session.targetUserEmail || '',
    isAdmin: true,
    isImpersonating: true,
    originalAdmin: { uid: base.uid, email: base.email },
  };
}

// The only admin check routes should use. Replaces `x.isAdmin || x.email === OWNER`, whose
// email half would have re-admitted an unverified owner-email token.
export function hasAdminAuthority(identity: { isAdmin?: boolean } | null | undefined): boolean {
  return identity?.isAdmin === true;
}

// Pre-deployment check of the owner's Firebase Auth record (scripts/check-owner-admin-identity.ts).
// After this change the owner keeps admin access only with a verified email or an admin claim.
export function assessOwnerAccount(record: { emailVerified?: boolean; customClaims?: Record<string, unknown> | null; providers: string[] } | null):
  { ok: boolean; message: string } {
  if (!record) return { ok: false, message: `No Firebase Auth account uses ${OWNER_EMAIL}. Nobody would have owner admin access.` };
  if (record.emailVerified === true) return { ok: true, message: 'Owner email is verified: owner admin access continues after this change.' };
  if (record.customClaims?.admin) return { ok: true, message: 'Owner email is NOT verified, but the account has the admin custom claim: admin access continues. Verifying the email is still recommended.' };
  return {
    ok: false,
    message: `Owner email is NOT verified (sign-in providers: ${record.providers.join(', ') || 'none'}). Deploying this change would remove the owner's admin access. `
      + 'Verify the address first (use a verification link, or sign in once with Google, which marks it verified), then run this check again.',
  };
}

// Identity fields that /api/users/sync may write. Everything comes from verified sources:
// the Firebase Auth record of the target account, or the caller's own verified token.
// The request body is ignored for both fields.
export function syncedIdentityFields(input: {
  caller: ServerIdentity;
  isOwner: boolean;                 // the target row is the caller's own account
  firebaseEmail: string | null | undefined;   // email on the target's Firebase Auth record, if readable
  existingIsAdmin: boolean;         // flag already stored on the row (kept, never raised by the body)
}): { email?: string; isAdmin: boolean } {
  const { caller, isOwner, firebaseEmail, existingIsAdmin } = input;
  const actingAsSelf = isOwner && !caller.isImpersonating && !caller.originalAdmin;

  let email: string | undefined;
  if (firebaseEmail) email = firebaseEmail.trim();
  else if (actingAsSelf && caller.email) email = caller.email;
  // Otherwise undefined: the column is left out of the upsert and the stored value stays.

  // The stored flag is display-only; it is raised only for the verified owner acting as
  // themselves (the previous behaviour, minus trusting a body-supplied email).
  const isAdmin = existingIsAdmin || (actingAsSelf && hasAdminAuthority(caller) && normalizeEmail(caller.email) === OWNER_EMAIL);
  return email === undefined ? { isAdmin } : { email, isAdmin };
}
