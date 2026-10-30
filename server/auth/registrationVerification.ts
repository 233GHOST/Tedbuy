// Tracks emails whose 6-digit sign-up code was checked, and decides whether
// POST /api/auth/complete-registration may mark the Firebase email verified.
// Kept out of server.ts so it can be unit-tested.

export const CHECKED_EMAIL_TTL_MS = 30 * 60 * 1000;

export function normalizeRegistrationEmail(email: string): string {
  return String(email).trim().toLowerCase();
}

export function createCheckedEmailStore(now: () => number = Date.now) {
  const entries = new Map<string, number>(); // email -> expiresAt
  const live = (key: string): boolean => {
    const exp = entries.get(key);
    if (exp === undefined) return false;
    if (now() > exp) {
      entries.delete(key);
      return false;
    }
    return true;
  };
  return {
    markChecked(email: string): void {
      entries.set(normalizeRegistrationEmail(email), now() + CHECKED_EMAIL_TTL_MS);
    },
    consume(email: string): boolean {
      const key = normalizeRegistrationEmail(email);
      if (!live(key)) return false;
      entries.delete(key);
      return true;
    },
    has(email: string): boolean {
      return live(normalizeRegistrationEmail(email));
    },
  };
}

export type CompleteRegistrationDecision =
  | { ok: true; action: 'already-verified' | 'mark-verified' }
  | { ok: false; status: 400 | 401 | 403; error: string };

export function decideCompleteRegistration(input: {
  verified: { uid: string; email?: string | null; isImpersonating?: boolean; originalAdmin?: unknown } | null;
  impersonationHeaderPresent?: boolean;
  alreadyVerified: boolean;
  checked: boolean;
}): CompleteRegistrationDecision {
  const { verified, impersonationHeaderPresent, alreadyVerified, checked } = input;
  if (!verified || !verified.uid) return { ok: false, status: 401, error: 'Unauthorized' };
  if (impersonationHeaderPresent || verified.isImpersonating || verified.originalAdmin) {
    return { ok: false, status: 403, error: 'Not available while impersonating' };
  }
  if (!verified.email) return { ok: false, status: 400, error: 'No email on this account' };
  if (alreadyVerified) return { ok: true, action: 'already-verified' };
  if (!checked) return { ok: false, status: 403, error: 'No checked sign-up code for this email. Request a new code.' };
  return { ok: true, action: 'mark-verified' };
}
