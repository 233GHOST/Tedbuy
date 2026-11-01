// "Verify your email first" for chats, messages and reviews, enforced by the server (the app
// and website already ask; a modified client could skip that). Kept out of server.ts so it
// can be unit-tested.
//
// adminFlag is Firebase Admin's emailVerified (authoritative), or null when Admin can't be
// asked (staging has no Admin credentials; or a brief outage). Then the signed ID token's
// email_verified claim decides, so an outage never blocks every chat on TedBuy.

export type VerifiedAction = 'chat' | 'message' | 'review';

const WHAT: Record<VerifiedAction, string> = {
  chat: 'starting a chat',
  message: 'sending messages',
  review: 'writing a review',
};

// A plain object (not a union): server.ts compiles without strictNullChecks, which doesn't
// narrow discriminated unions.
export interface VerifiedActionDecision {
  ok: boolean; status?: 403; code?: 'EMAIL_NOT_VERIFIED'; errorCode?: 'EMAIL_NOT_VERIFIED'; error?: string;
}

export function decideVerifiedAction(input: {
  action: VerifiedAction; adminFlag: boolean | null; tokenClaim: boolean | undefined; isAdmin?: boolean;
  /** The chat is with TedBuy Support: always allowed, so someone stuck verifying can ask for help. */
  withSupport?: boolean;
}): VerifiedActionDecision {
  if (input.isAdmin || input.withSupport) return { ok: true };
  const verified = input.adminFlag ?? input.tokenClaim === true;
  if (verified) return { ok: true };
  // `code` like the listing check (the app maps it); `errorCode` for the website.
  return { ok: false, status: 403, code: 'EMAIL_NOT_VERIFIED', errorCode: 'EMAIL_NOT_VERIFIED',
    error: `Please verify your email address before ${WHAT[input.action]}.` };
}
