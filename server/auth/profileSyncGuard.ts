// Decides whether POST /api/users/sync may write over an existing `users`
// row, and which saved fields it must keep. Kept out of server.ts so it can
// be unit-tested.
//
// Why: app 1.1.0 creates a brand-new profile whenever its profile lookup
// returns null, which also happens on a timeout or a 5xx. The sync upsert
// then replaced an existing seller's whole row (username, phone, photo,
// saved items, store name). Every legitimate update starts from the loaded
// profile (GET /api/users/get returns the full row to its owner), so it
// carries the saved joinDate; a profile built from scratch carries a new one.

export const PROFILE_EXISTS_ERROR = 'Your profile already exists. Please reopen the app to load it.';

export type ExistingProfileRow = {
  joinDate?: string | null;
  createdAt?: string | null;
  welcomeSent?: boolean | null;
  [key: string]: unknown;
};

export type ProfileSyncDecision =
  | { ok: true }
  | { ok: false; status: 409; code: 'PROFILE_EXISTS'; error: string }
  | { ok: false; status: 500; error: string };

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

export function decideProfileSync(input: {
  existingReadFailed: boolean;
  existing: ExistingProfileRow | null;
  request: { joinDate?: unknown };
}): ProfileSyncDecision {
  const { existingReadFailed, existing, request } = input;
  // Without the existing row we cannot tell an update from an overwrite;
  // treating the row as missing would let a from-scratch profile through.
  if (existingReadFailed) {
    return { ok: false, status: 500, error: 'Could not load your profile. Please try again.' };
  }
  if (!existing) return { ok: true };
  if (nonEmpty(existing.joinDate) && nonEmpty(request.joinDate) && request.joinDate !== existing.joinDate) {
    return { ok: false, status: 409, code: 'PROFILE_EXISTS', error: PROFILE_EXISTS_ERROR };
  }
  return { ok: true };
}

// Applied to every sync that writes over an existing row. phoneNumber,
// whatsAppNumber, photoUrl and savedProductIds are deliberately NOT kept:
// every client clears phone/WhatsApp/photo by omitting the key (`|| undefined`
// dropped by JSON), and the website prunes saved items through this sync, so
// an absent or empty value there is a legitimate edit. bio is already left
// untouched when absent (server.ts only sets it when the request sends a string).
export function preserveExistingProfileFields<T extends Record<string, any>>(
  cleanUser: T,
  existing: ExistingProfileRow | null,
): T {
  if (!existing) return cleanUser;
  const out: Record<string, any> = { ...cleanUser };
  if (nonEmpty(existing.joinDate)) out.joinDate = existing.joinDate;
  if (nonEmpty(existing.createdAt)) out.createdAt = existing.createdAt;
  if (existing.welcomeSent === true) out.welcomeSent = true;
  return out as T;
}
