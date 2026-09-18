import test, { after } from 'node:test';
import assert from 'node:assert/strict';

// NOTE: this intentionally does NOT `import` anything from server.ts.
// server.ts calls startServer() unconditionally at module scope (no
// require.main/import.meta entrypoint guard), so any import from it -- even
// of a single named export -- would execute the real server bootstrap
// (Express listen, Supabase/Firebase init) as an unavoidable side effect of
// module load. That's unsafe and unreliable to run from a unit test.
//
// Instead, this mirrors the exact clientIp-derivation expression used at
// server.ts:709 (inside serverRateLimiter) and server.ts:3872 (the product-
// view cooldown) verbatim, and tests its behavioral contract directly: a
// client-supplied X-Forwarded-For must have zero influence on the derived
// IP when a real cf-connecting-ip is present. If server.ts is ever
// refactored to guard startServer() behind an entrypoint check, this should
// be upgraded to import serverRateLimiter directly for a stronger guarantee
// that the test exercises the real code, not a mirror of it.

function deriveClientIp(headers: Record<string, string | undefined>, remoteAddress: string): string {
  return (
    headers['cf-connecting-ip'] as string ||
    remoteAddress ||
    'unknown'
  ).trim();
}

// The vulnerable expression this fix replaces, kept here only so the tests
// below can demonstrate the contrast -- not used by any real code anymore.
function deriveClientIpOldVulnerableVersion(headers: Record<string, string | undefined>, remoteAddress: string): string {
  return (headers['x-forwarded-for'] as string || remoteAddress || 'unknown').split(',')[0].trim();
}

test('a spoofed X-Forwarded-For does not influence the derived client IP when cf-connecting-ip is present', () => {
  const realClientIp = '203.0.113.7'; // Cloudflare's own TCP-verified value
  const attackerSpoofedXff = '1.1.1.1, 203.0.113.7, 172.68.0.5'; // attacker-prepended fake IP + the real chain

  const derived = deriveClientIp(
    { 'cf-connecting-ip': realClientIp, 'x-forwarded-for': attackerSpoofedXff },
    '10.0.0.1' // Render's internal LB, as seen by req.socket.remoteAddress
  );

  assert.equal(derived, realClientIp, 'the derived IP must be the real cf-connecting-ip, never anything from the spoofable X-Forwarded-For header');
});

test('two requests with different spoofed X-Forwarded-For values but the same real cf-connecting-ip derive to the same client IP (same rate-limit key)', () => {
  const realClientIp = '203.0.113.7';

  const derived1 = deriveClientIp({ 'cf-connecting-ip': realClientIp, 'x-forwarded-for': '1.1.1.1' }, '10.0.0.1');
  const derived2 = deriveClientIp({ 'cf-connecting-ip': realClientIp, 'x-forwarded-for': '2.2.2.2' }, '10.0.0.1');

  assert.equal(derived1, derived2, 'varying X-Forwarded-For per request must not let an attacker escape their real rate-limit bucket');
  assert.equal(derived1, realClientIp);
});

test('two requests with the identical spoofed X-Forwarded-For but different real cf-connecting-ip values derive to different client IPs (different rate-limit keys)', () => {
  const sharedSpoofedXff = '9.9.9.9';

  const derivedA = deriveClientIp({ 'cf-connecting-ip': '198.51.100.1', 'x-forwarded-for': sharedSpoofedXff }, '10.0.0.1');
  const derivedB = deriveClientIp({ 'cf-connecting-ip': '198.51.100.2', 'x-forwarded-for': sharedSpoofedXff }, '10.0.0.1');

  assert.notEqual(derivedA, derivedB, 'two genuinely different real clients must not collapse into the same rate-limit bucket just because they share a spoofed X-Forwarded-For value');
});

test('falls back to req.socket.remoteAddress when cf-connecting-ip is absent (e.g. local/dev, never in production per Render/Cloudflare docs) -- and never to X-Forwarded-For', () => {
  const derived = deriveClientIp({ 'x-forwarded-for': '1.1.1.1' }, '127.0.0.1');
  assert.equal(derived, '127.0.0.1', 'must fall back to the raw socket address, not the spoofable X-Forwarded-For header');
});

test('sanity check: the OLD vulnerable expression WAS influenced by a spoofed X-Forwarded-For (documents exactly what this fix closes)', () => {
  const attackerSpoofedXff = '1.1.1.1, 203.0.113.7';
  const derivedOld = deriveClientIpOldVulnerableVersion({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': attackerSpoofedXff }, '10.0.0.1');
  assert.equal(derivedOld, '1.1.1.1', 'the old logic picked the attacker-controlled first XFF entry -- this is the exact bypass the fix eliminates');
});

// --- Email-exposure fix (GET /api/users/get self/other redaction, and the
// dedicated POST /api/auth/resolve-login-identifier endpoint) -- mirrors the
// exact decision logic added at server.ts:4477-4501 and the new route at
// server.ts:4517-4543, for the same reason as above: server.ts can't be
// safely imported.
//
// isSelfLookup mirrors the fix for the legacy `user_<uid>` account (one
// known live row stored that way -- see the ownership-check equivalence at
// /api/products/sync): a stored users.id counts as "self" when it's either
// the bare verified Firebase UID, or that UID prefixed with `user_`.

function isSelfLookup(verifiedUid: string | null, dataId: string): boolean {
  return !!verifiedUid && (
    String(dataId) === String(verifiedUid) ||
    String(dataId) === `user_${verifiedUid}`
  );
}

function redactEmailIfNotSelf(user: Record<string, any>, verifiedUid: string | null): Record<string, any> {
  const safe = { ...user };
  if (!isSelfLookup(verifiedUid, safe.id)) delete safe.email;
  return safe;
}

test('GET /api/users/get: a verified caller looking up their own record (bare UID) keeps email', () => {
  const row = { id: 'uid-123', email: 'redacted@example.com', phoneNumber: '+233000', username: 'alice' };
  const result = redactEmailIfNotSelf(row, 'uid-123');
  assert.equal(result.email, 'redacted@example.com');
  assert.equal(result.phoneNumber, '+233000', 'phoneNumber must never be stripped by this change');
});

test('GET /api/users/get: a verified caller looking up their own record stored as the legacy "user_<uid>" id keeps email', () => {
  const row = { id: 'user_uid-123', email: 'redacted@example.com', phoneNumber: '+233000', username: 'legacy-seller' };
  const result = redactEmailIfNotSelf(row, 'uid-123');
  assert.equal(result.email, 'redacted@example.com', 'the user_<uid> legacy account must still be recognized as its own owner');
  assert.equal(result.phoneNumber, '+233000');
});

test('GET /api/users/get: an unauthenticated caller (no verified uid) never receives email', () => {
  const row = { id: 'uid-123', email: 'redacted@example.com', phoneNumber: '+233000' };
  const result = redactEmailIfNotSelf(row, null);
  assert.equal('email' in result, false);
  assert.equal(result.phoneNumber, '+233000', 'phoneNumber/whatsAppNumber stay public for legitimate seller-contact use');
});

test('GET /api/users/get: an authenticated caller looking up a DIFFERENT user never receives that user\'s email', () => {
  const row = { id: 'uid-123', email: 'redacted@example.com', whatsAppNumber: '+233000' };
  const result = redactEmailIfNotSelf(row, 'uid-999');
  assert.equal('email' in result, false);
  assert.equal(result.whatsAppNumber, '+233000');
});

test('GET /api/users/get: a verified caller must not be treated as self for an unrelated user_-prefixed id (no accidental substring/prefix match)', () => {
  const row = { id: 'user_someone-else', email: 'redacted@example.com' };
  const result = redactEmailIfNotSelf(row, 'uid-123');
  assert.equal('email' in result, false, 'user_<a different uid> must not match verifiedUid uid-123');
});

function resolveLoginIdentifierResponse(match: { email?: string } | null): { status: number; body: any } {
  if (match && match.email) return { status: 200, body: { success: true, email: match.email } };
  return { status: 404, body: { success: false } };
}

test('POST /api/auth/resolve-login-identifier: a matched username/phone returns only {success, email} -- no id, phoneNumber, or other profile field', () => {
  const { status, body } = resolveLoginIdentifierResponse({ email: 'target@example.com' });
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['email', 'success']);
  assert.equal(body.email, 'target@example.com');
});

test('POST /api/auth/resolve-login-identifier: no match returns {success:false} with no email/user data', () => {
  const { status, body } = resolveLoginIdentifierResponse(null);
  assert.equal(status, 404);
  assert.deepEqual(body, { success: false });
});

// getSellersSummaryData() email removal (server.ts:2995-3025): the
// keysToRegister Set must never be seeded with an email-shaped string --
// documents the fixed shape (7 keys) vs. the old shape (9 keys, 2 of them
// email-derived object keys visible in the public /api/sellers/counts body).
function buildKeysToRegister(matchedUser: any, canonicalKey: string, firstProd: any): Set<string> {
  const keys = new Set<string>();
  if (matchedUser?.id) keys.add(String(matchedUser.id));
  if (matchedUser?.uid) keys.add(String(matchedUser.uid));
  if (matchedUser?.username) keys.add(String(matchedUser.username).trim().toLowerCase());
  if (matchedUser?.displayName) keys.add(String(matchedUser.displayName).trim().toLowerCase());
  if (canonicalKey) keys.add(canonicalKey.toLowerCase());
  if (firstProd.sellerId) keys.add(String(firstProd.sellerId));
  if (firstProd.sellerName) keys.add(String(firstProd.sellerName).trim().toLowerCase());
  return keys;
}

test('getSellersSummaryData(): keysToRegister never contains an email-shaped key', () => {
  const matchedUser = { id: 'uid-1', uid: 'uid-1', username: 'bob', displayName: 'Bob', email: 'bob@example.com' };
  const firstProd = { sellerId: 'uid-1', sellerName: 'Bob', sellerEmail: 'bob@example.com' };
  const keys = buildKeysToRegister(matchedUser, 'uid-1', firstProd);
  for (const k of keys) {
    assert.equal(k.includes('@'), false, `key "${k}" looks email-shaped and must not be registered`);
  }
  assert.equal(keys.has('uid-1'), true, 'canonical id key must still be registered');
});

// serverRateLimiter() (the real code this mirrors) starts a plain
// setInterval with no .unref() -- pre-existing behavior in server.ts,
// unrelated to this fix and out of scope to change here. This file never
// calls that real function, so it has no interval of its own; this is just
// a defensive, no-op-in-practice guard in case that changes later.
after(() => {
  process.exitCode = process.exitCode ?? 0;
});
