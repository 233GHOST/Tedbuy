// Decision logic for POST /api/auth/app-handoff (mobile app -> embedded web sign-in).
// Kept out of server.ts so it can be unit-tested.

export interface HandoffVerified {
  uid: string;
  isImpersonating?: boolean;
  originalAdmin?: unknown;
}

export type HandoffDecision =
  | { ok: true; uid: string }
  | { ok: false; status: 401 | 403; error: string };

export function decideAppHandoff(input: { verified: HandoffVerified | null; restricted: boolean }): HandoffDecision {
  const { verified, restricted } = input;
  if (!verified || !verified.uid) return { ok: false, status: 401, error: 'Unauthorized' };
  if (verified.isImpersonating || verified.originalAdmin) {
    return { ok: false, status: 403, error: 'App sign-in handoff is not available while impersonating' };
  }
  if (restricted) return { ok: false, status: 403, error: 'Account restricted' };
  return { ok: true, uid: verified.uid };
}

// Same users-row fields the Dropship gate uses.
export function isRestrictedUserRow(
  row: { isSuspended?: unknown; securityHold?: unknown; isDeleted?: unknown; status?: unknown } | null | undefined,
): boolean {
  if (!row) return false;
  const status = typeof row.status === 'string' ? row.status.toLowerCase() : '';
  return row.isSuspended === true || row.securityHold === true || row.isDeleted === true
    || status === 'suspended' || status === 'deleted';
}
