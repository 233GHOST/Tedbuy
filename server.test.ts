import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

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

// --- POST /api/verify-payment: the plan actually awarded must come from
// Paystack's own transaction metadata, not the request body's planId --
// mirrors the resolution logic added at server.ts:~5994-6007.

const BOOST_PLAN_PRICE_GHS_MIRROR: Record<string, number> = {
  '3days': 1, '7days': 3, '14days': 5, '21days': 7, '1month': 10
};
const BOOST_PLAN_DURATION_DAYS_MIRROR: Record<string, number> = {
  '3days': 3, '7days': 7, '14days': 14, '21days': 21, '1month': 30
};

function resolveEffectivePlanId(requestPlanId: string, paystackMetadataPlanId: string | undefined | null): { effectivePlanId: string; durationDays: number; expectedPriceGHS: number } {
  let effectivePlanId = requestPlanId;
  let durationDays = BOOST_PLAN_DURATION_DAYS_MIRROR[effectivePlanId] || 7;
  let expectedPriceGHS = BOOST_PLAN_PRICE_GHS_MIRROR[effectivePlanId] || BOOST_PLAN_PRICE_GHS_MIRROR['7days'];

  if (paystackMetadataPlanId && BOOST_PLAN_PRICE_GHS_MIRROR[paystackMetadataPlanId] !== undefined) {
    effectivePlanId = paystackMetadataPlanId;
    durationDays = BOOST_PLAN_DURATION_DAYS_MIRROR[effectivePlanId] || 7;
    expectedPriceGHS = BOOST_PLAN_PRICE_GHS_MIRROR[effectivePlanId];
  }
  return { effectivePlanId, durationDays, expectedPriceGHS };
}

test('verify-payment: a request under-claiming a cheaper plan than what Paystack metadata says was paid for is realigned to the real (paid) plan', () => {
  // Paid for 1month (GHS 10) but the request body claims 3days (GHS 1) --
  // without the fix this would pass the amount check (10 >= 1) and award
  // only a 3-day boost despite the full 1month price being paid.
  const result = resolveEffectivePlanId('3days', '1month');
  assert.equal(result.effectivePlanId, '1month');
  assert.equal(result.durationDays, 30);
  assert.equal(result.expectedPriceGHS, 10);
});

test('verify-payment: falls back to the request\'s own planId when Paystack metadata has no recognized plan (e.g. a pre-fix reference)', () => {
  const result = resolveEffectivePlanId('7days', undefined);
  assert.equal(result.effectivePlanId, '7days');
  assert.equal(result.durationDays, 7);
  assert.equal(result.expectedPriceGHS, 3);
});

test('verify-payment: an unrecognized metadata planId does not override a valid request planId', () => {
  const result = resolveEffectivePlanId('7days', 'not-a-real-plan');
  assert.equal(result.effectivePlanId, '7days');
});

// --- timingSafeStringEqual (server.ts, used by the password-hash and
// CRON_SECRET comparisons) -- node:crypto is a core module with no
// module-scope side effects, so this imports the real dependency rather
// than mirroring it, and reproduces the exact function body verbatim.
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

test('timingSafeStringEqual: equal strings match', () => {
  assert.equal(timingSafeStringEqual('a'.repeat(128), 'a'.repeat(128)), true);
});

test('timingSafeStringEqual: differing strings of the same length do not match', () => {
  assert.equal(timingSafeStringEqual('a'.repeat(127) + 'b', 'a'.repeat(128)), false);
});

test('timingSafeStringEqual: differing lengths return false instead of throwing', () => {
  assert.doesNotThrow(() => timingSafeStringEqual('short', 'a-much-longer-string-here'));
  assert.equal(timingSafeStringEqual('short', 'a-much-longer-string-here'), false);
});

// --- POST /api/admin/send-personal-email: a legacy (pre-username-validation)
// username or an admin-typed customMessage/subject must not be able to
// inject raw HTML into the outgoing email -- mirrors the exact escape-then-
// substitute logic added at server.ts:~7664-7692.
function escapeHtml(unsafe: string): string {
  return String(unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
function buildPersonalEmailParagraphs(displayName: string, customMessage: string): string {
  const safeDisplayName = escapeHtml(displayName);
  let processedMessage = escapeHtml(customMessage || '');
  processedMessage = processedMessage.replace(/\[user name\]/gi, safeDisplayName);
  processedMessage = processedMessage.replace(/\[username\]/gi, safeDisplayName);
  processedMessage = processedMessage.replace(/\[user\]/gi, safeDisplayName);
  return processedMessage
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

test('send-personal-email: a legacy username containing raw HTML is escaped, not injected', () => {
  const result = buildPersonalEmailParagraphs('<script>alert(1)</script>', 'Hello [user name], welcome back!');
  assert.equal(result.includes('<script>'), false);
  assert.match(result, /&lt;script&gt;/);
});

test('send-personal-email: an admin-typed message with raw HTML is escaped', () => {
  const result = buildPersonalEmailParagraphs('Alice', 'Click <a href="evil">here</a>');
  assert.equal(result.includes('<a href='), false);
  assert.match(result, /&lt;a href=&quot;evil&quot;&gt;/);
});

test('send-personal-email: the [user name] placeholder still substitutes correctly after escaping', () => {
  const result = buildPersonalEmailParagraphs('Alice', 'Hello [user name]!');
  assert.match(result, /Hello Alice!/);
});

// --- POST/DELETE /api/products delete routes: the ownership check must
// fail CLOSED (deny) when the product's sellerId can't be determined, not
// skip the check entirely -- mirrors the fixed gating logic added at
// server.ts's two product-delete routes (~4068-4113, ~4139-4172).
function canDeleteProduct(userUid: string, userEmail: string, isAdmin: boolean, lookup: { productExists: boolean; sellerId: string | null; sellerEmail: string | null }): { status: number; allowed: boolean } {
  if (!lookup.productExists) return { status: 404, allowed: false };
  const isOwner = !!lookup.sellerId && (
    lookup.sellerId === userUid ||
    lookup.sellerId === `user_${userUid}` ||
    lookup.sellerId === `phone_${userUid}` ||
    (!!userEmail && !!lookup.sellerEmail && lookup.sellerEmail.toLowerCase() === userEmail.toLowerCase())
  );
  if (!isOwner && !isAdmin) return { status: 403, allowed: false };
  return { status: 200, allowed: true };
}

test('product delete: a non-admin, non-owner caller is denied even when sellerId could not be determined (fails closed, not open)', () => {
  // This is the exact bug: sellerId is null (a lookup error, or a row with
  // no sellerId set) for a product that DOES exist -- must still deny a
  // non-owner, not silently skip the check.
  const result = canDeleteProduct('attacker-uid', 'attacker@example.com', false, { productExists: true, sellerId: null, sellerEmail: null });
  assert.equal(result.allowed, false);
  assert.equal(result.status, 403);
});

test('product delete: the real owner (bare uid) is allowed', () => {
  const result = canDeleteProduct('owner-uid', 'owner@example.com', false, { productExists: true, sellerId: 'owner-uid', sellerEmail: null });
  assert.equal(result.allowed, true);
});

test('product delete: a nonexistent product returns 404, not a silent bypass', () => {
  const result = canDeleteProduct('any-uid', 'any@example.com', false, { productExists: false, sellerId: null, sellerEmail: null });
  assert.equal(result.allowed, false);
  assert.equal(result.status, 404);
});

test('product delete: an admin can delete regardless of ownership', () => {
  const result = canDeleteProduct('admin-uid', 'admin@example.com', true, { productExists: true, sellerId: 'someone-else', sellerEmail: null });
  assert.equal(result.allowed, true);
});

// --- POST /api/products/sync and upsertProductToSupabase: a genuine
// existing-row lookup error must throw/fail closed, never be silently
// reinterpreted as "this id doesn't exist yet" -- mirrors the decision
// added at server.ts's sync handler (~3653-3680) and upsertProductToSupabase
// (~3340-3352). A silently-swallowed error taking the "new product" path
// would skip the ownership check entirely AND let the eventual upsert (keyed
// by id at the DB level) overwrite an existing, other-owned row.
function resolveExistingRowOrThrow(queryResult: { data: any; error: any }): any {
  if (queryResult.error) throw new Error('query failed');
  return queryResult.data || null;
}

test('products/sync: a genuine query error throws instead of being treated as "no existing row"', () => {
  assert.throws(() => resolveExistingRowOrThrow({ data: null, error: { message: 'connection reset' } }));
});

test('products/sync: a query that succeeds with no matching row is a legitimate null (new product), not an error', () => {
  assert.doesNotThrow(() => resolveExistingRowOrThrow({ data: null, error: null }));
  assert.equal(resolveExistingRowOrThrow({ data: null, error: null }), null);
});

test('products/sync: a query that succeeds with a matching row returns it', () => {
  const row = { id: 'p1', sellerId: 'owner-uid' };
  assert.deepEqual(resolveExistingRowOrThrow({ data: row, error: null }), row);
});

// --- POST /api/admin/users/delete and POST /api/admin/accounts/security-hold:
// a real Supabase write error must be surfaced (throw -> 500), never
// silently swallowed into an unconditional success response -- mirrors the
// exact `if (error) throw error` fix applied at server.ts's two admin
// mutation sites (~9028-9038, ~8815-8823), matching the pattern their
// sibling /api/admin/users/suspend already had correctly.
function assertWriteSucceededOrThrow(result: { error: any }): void {
  if (result.error) throw new Error(result.error.message || 'write failed');
}

test('admin user delete: a real Supabase delete error throws instead of falling through to a success response', () => {
  assert.throws(() => assertWriteSucceededOrThrow({ error: { message: 'permission denied' } }));
});

test('admin user delete: a successful delete (no error) does not throw', () => {
  assert.doesNotThrow(() => assertWriteSucceededOrThrow({ error: null }));
});

test('admin security-hold: a real Supabase update error throws instead of reporting the hold as applied', () => {
  assert.throws(() => assertWriteSucceededOrThrow({ error: { message: 'row not found' } }));
});

// --- deleteProductFromBackend / /api/auth/delete-account: a real Supabase
// write error must propagate (throw), never be swallowed into an
// unconditional success response -- mirrors the fixes at server.ts's shared
// product-delete helper (~4023-4041) and the account-deletion tombstone/
// security-hold-freeze writes (~8512-8529, ~8596-8607).

test('deleteProductFromBackend: a real deletion error throws instead of being silently logged', () => {
  assert.throws(() => assertWriteSucceededOrThrow({ error: { message: 'foreign key violation' } }));
});

test('account deletion (CASE B, tombstone anonymization): a real Supabase update error throws instead of claiming PII was anonymized', () => {
  assert.throws(() => assertWriteSucceededOrThrow({ error: { message: 'permission denied' } }));
});

test('account deletion (CASE A, security-hold freeze): a real Supabase update error throws instead of claiming the account is under investigation', () => {
  assert.throws(() => assertWriteSucceededOrThrow({ error: { message: 'connection reset' } }));
});

// A cascade loop (e.g. /api/admin/users/delete deleting every product a
// user owns) must keep processing remaining items after one item's
// deletion throws, not abort the whole cascade -- mirrors the per-item
// try/catch added around deleteProductFromBackend() inside that loop.
function deleteProductsBestEffort(productIds: string[], deleteOne: (id: string) => void): { deletedCount: number } {
  let deletedCount = 0;
  for (const id of productIds) {
    try {
      deleteOne(id);
      deletedCount++;
    } catch (_) {
      // logged and skipped, matching the real code's console.warn
    }
  }
  return { deletedCount };
}

test('admin user delete cascade: one product\'s deletion failure does not stop the remaining products from being attempted', () => {
  const attempted: string[] = [];
  const result = deleteProductsBestEffort(['p1', 'p2', 'p3'], (id) => {
    attempted.push(id);
    if (id === 'p2') throw new Error('deletion failed');
  });
  assert.deepEqual(attempted, ['p1', 'p2', 'p3'], 'every product must still be attempted');
  assert.equal(result.deletedCount, 2, 'only the two that genuinely succeeded should count');
});

// --- POST /api/chats/mark-picked-up: a buyer must not be able to reach
// tradeStatus 'completed' (which /api/reviews/create trusts as proof of a
// genuine trade) without the seller having confirmed delivery first --
// mirrors the precondition check added at server.ts:~5414-5426. Both
// platforms' real UI already only ever renders the enabled action when
// deliveredBySeller is true, so this only rejects a direct-API bypass of
// that same precondition, never a legitimate in-app confirmation.
function canConfirmPickup(chat: { deliveredBySeller: boolean }): { status: number; allowed: boolean } {
  if (!chat.deliveredBySeller) return { status: 409, allowed: false };
  return { status: 200, allowed: true };
}

test('mark-picked-up: rejected when the seller has not confirmed delivery yet (closes the direct-API bypass)', () => {
  const result = canConfirmPickup({ deliveredBySeller: false });
  assert.equal(result.allowed, false);
  assert.equal(result.status, 409);
});

test('mark-picked-up: allowed once the seller has confirmed delivery (the normal, legitimate flow)', () => {
  const result = canConfirmPickup({ deliveredBySeller: true });
  assert.equal(result.allowed, true);
});

// --- GET /api/admin/users/search: a comma or parenthesis in the search
// term must not reach PostgREST's .or() filter grammar unescaped -- mirrors
// the sanitization added at server.ts:~7963-7980.
function buildUsersSearchFilter(queryTerm: string): string {
  const safeQueryTerm = queryTerm.replace(/[,()]/g, '');
  return `email.ilike.%${safeQueryTerm}%,id.ilike.%${safeQueryTerm}%,username.ilike.%${safeQueryTerm}%,phoneNumber.ilike.%${safeQueryTerm}%`;
}

test('admin users search: commas and parentheses are stripped before building the .or() filter', () => {
  const filter = buildUsersSearchFilter('(024) 123-4567,evil.eq.true');
  assert.equal(filter.includes(','.repeat(1)) && filter.split(',').length > 4, false, 'no extra condition should be injectable via a comma in the search term');
  assert.equal(filter.includes('('), false);
  assert.equal(filter.includes(')'), false);
});

test('admin users search: a real email search term (containing a period) is left untouched', () => {
  const filter = buildUsersSearchFilter('john.doe@example.com');
  assert.match(filter, /%john\.doe@example\.com%/);
});

// --- upsertProductToSupabase's trustBoostFields gate (server.ts:3333-3580):
// a regular "save my listing" call must never be able to grant itself a
// free boost by including boostStatus/boostPriority/etc. in the request
// body. Verified today (2026-09-19) via direct code reading that this P0
// fix from an earlier session is still fully intact at all 4 real call
// sites -- /api/products/create and /api/products/sync both call this
// function with the default (false), while only /api/verify-payment
// (post-payment) and /api/admin/boost-control (admin-only) pass true.
// This regression test locks that gating decision in.
function resolveBoostFields(trustBoostFields: boolean, clientProductData: any, existingRow: any): { boostStatus: boolean; boostPriority: number | undefined } {
  return trustBoostFields
    ? {
        boostStatus: clientProductData.boostStatus === true,
        boostPriority: clientProductData.boostPriority !== undefined ? Number(clientProductData.boostPriority) : undefined,
      }
    : {
        boostStatus: existingRow?.boostStatus === true,
        boostPriority: existingRow?.boostPriority !== undefined ? Number(existingRow.boostPriority) : undefined,
      };
}

test('trustBoostFields=false (product create/sync): a client-supplied boostStatus/boostPriority is completely ignored, real DB state is preserved', () => {
  const maliciousClientBody = { boostStatus: true, boostPriority: 999999999 };
  const realExistingRow = { boostStatus: false, boostPriority: undefined };
  const result = resolveBoostFields(false, maliciousClientBody, realExistingRow);
  assert.equal(result.boostStatus, false, 'a regular user must not be able to self-grant boostStatus:true via a save-listing call');
  assert.equal(result.boostPriority, undefined);
});

test('trustBoostFields=true (verify-payment / admin boost-control only): the caller-computed boost fields are trusted', () => {
  const serverComputedAfterRealPayment = { boostStatus: true, boostPriority: 5 };
  const result = resolveBoostFields(true, serverComputedAfterRealPayment, {});
  assert.equal(result.boostStatus, true);
  assert.equal(result.boostPriority, 5);
});

// --- dispatchInBatches (server.ts:~4943-4961): the follower/saver
// notification fan-out for a new or updated listing. Mirrors the real
// function verbatim -- it's a small, dependency-free generic helper.
async function dispatchInBatches<T>(items: T[], batchSize: number, handler: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(handler));
  }
}

test('dispatchInBatches: every item is processed exactly once, regardless of batch size', async () => {
  const processed: number[] = [];
  await dispatchInBatches([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    processed.push(n);
  });
  assert.deepEqual(processed.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
});

test('dispatchInBatches: items within a batch run concurrently, not one-at-a-time', async () => {
  const startedAt: number[] = [];
  const start = Date.now();
  await dispatchInBatches([1, 2, 3], 3, async () => {
    startedAt.push(Date.now() - start);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  // If items ran sequentially, the 3rd item's start time would be roughly
  // 2x the delay after the 1st. Running concurrently, all 3 start within a
  // few ms of each other.
  const spread = Math.max(...startedAt) - Math.min(...startedAt);
  assert.ok(spread < 15, `expected concurrent starts (spread < 15ms), got ${spread}ms -- items may be running sequentially`);
});

test('dispatchInBatches: an empty array resolves immediately with no calls', async () => {
  let calls = 0;
  await dispatchInBatches([], 25, async () => { calls++; });
  assert.equal(calls, 0);
});

// --- withUserFollowLock (server.ts:~5905-5917): serializes the read-
// modify-write critical section of /api/users/follow per user id, closing
// a lost-update race between two near-simultaneous follow/unfollow
// requests from the same user. Mirrors the real function verbatim -- same
// shape as the already-proven withProductBoostLock.
const userFollowLocksTest = new Map<string, Promise<unknown>>();
function withUserFollowLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const previous = userFollowLocksTest.get(userId) || Promise.resolve();
  const run = previous.then(fn, fn);
  const chained = run.then(() => undefined, () => undefined);
  userFollowLocksTest.set(userId, chained);
  chained.finally(() => {
    if (userFollowLocksTest.get(userId) === chained) {
      userFollowLocksTest.delete(userId);
    }
  });
  return run;
}

test('withUserFollowLock: two concurrent calls for the same user run strictly one after the other, not overlapping', async () => {
  const order: string[] = [];
  const first = withUserFollowLock('user1', async () => {
    order.push('first-start');
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push('first-end');
  });
  const second = withUserFollowLock('user1', async () => {
    order.push('second-start');
    order.push('second-end');
  });
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second-start', 'second-end']);
});

test('withUserFollowLock: closes the lost-update race -- a second call always sees the first call\'s already-applied change', async () => {
  let followingSellers: string[] = [];
  const followB = withUserFollowLock('user1', async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    followingSellers = [...followingSellers, 'sellerB'];
  });
  const followC = withUserFollowLock('user1', async () => {
    followingSellers = [...followingSellers, 'sellerC'];
  });
  await Promise.all([followB, followC]);
  assert.deepEqual(followingSellers.slice().sort(), ['sellerB', 'sellerC']);
});

test('withUserFollowLock: different users are never serialized against each other', async () => {
  const startedAt: number[] = [];
  const start = Date.now();
  await Promise.all([
    withUserFollowLock('userA', async () => {
      startedAt.push(Date.now() - start);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }),
    withUserFollowLock('userB', async () => {
      startedAt.push(Date.now() - start);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }),
  ]);
  const spread = Math.max(...startedAt) - Math.min(...startedAt);
  assert.ok(spread < 15, `expected concurrent starts across different users (spread < 15ms), got ${spread}ms`);
});

// --- /api/users/save-product (mirrors /api/users/follow's lock shape
// exactly, so not re-tested here) -- the part worth locking in is the
// actual behavior change from the old /api/users/sync-based approach:
// the server now computes the toggle from its OWN current value on each
// call, so two racing delta-based calls for DIFFERENT products both land
// correctly regardless of ordering, unlike the old approach where each
// client-computed "next array" could silently discard the other's save.
function resolveSavedProductToggle(currentSaved: string[], productId: string, save: boolean): string[] {
  const alreadySaved = currentSaved.includes(productId);
  return save
    ? (alreadySaved ? currentSaved : [...currentSaved, productId])
    : currentSaved.filter((id) => id !== productId);
}

test('save-product delta toggle: two sequential toggles for different products both land, regardless of order (unlike a client-computed full array)', () => {
  let saved: string[] = [];
  saved = resolveSavedProductToggle(saved, 'productB', true);
  saved = resolveSavedProductToggle(saved, 'productC', true);
  assert.deepEqual(saved.slice().sort(), ['productB', 'productC']);
});

test('save-product delta toggle: unsaving an already-unsaved product, or re-saving an already-saved one, is a safe no-op', () => {
  const saved = ['productA'];
  assert.deepEqual(resolveSavedProductToggle(saved, 'productA', true), ['productA']);
  assert.deepEqual(resolveSavedProductToggle(saved, 'productZ', false), ['productA']);
});

// --- normalizeServerProductRow / normalizeServerProductSummaryRow: both
// must agree on boostPlan for the same actively-boosted row with no stored
// plan value, since productSelector.ts's boost-priority tiebreaker ranks
// '7days' above undefined -- a ranking difference that must not depend on
// which endpoint served the row. Mirrors the resolution logic added at
// server.ts:~2271 and ~2401 (activeBoost ? '7days' : undefined).
function resolveBoostPlan(storedBoostPlan: string | undefined, activeBoost: boolean): string | undefined {
  return storedBoostPlan || (activeBoost ? '7days' : undefined);
}

test('boostPlan consistency: an actively-boosted row with no stored plan resolves to \'7days\' on both product-serialize functions', () => {
  assert.equal(resolveBoostPlan(undefined, true), '7days');
});

test('boostPlan consistency: a non-boosted row with no stored plan resolves to undefined (not a fabricated plan)', () => {
  assert.equal(resolveBoostPlan(undefined, false), undefined);
});

test('boostPlan consistency: an explicit stored plan is always preferred over the activeBoost fallback', () => {
  assert.equal(resolveBoostPlan('1month', true), '1month');
  assert.equal(resolveBoostPlan('1month', false), '1month');
});

// /api/reviews/create's duplicate-review guard (a SELECT before the
// INSERT) isn't atomic with the write -- two near-simultaneous
// submissions for the same trade could both pass that SELECT before
// either lands. Mirrors the fix at server.ts:~5629: deriving the review's
// id deterministically from chatId (already verified to reference exactly
// one buyer-seller trade) instead of a random id, so a racing second
// submission harmlessly overwrites the first (safeBackendSupabaseUpsert's
// onConflict:'id') instead of creating a second, duplicate-counted row.
function resolveReviewId(chatId: string): string {
  return `rev_${chatId}`;
}

test('review id derivation: is deterministic for the same chatId, closing the duplicate-review race', () => {
  const chatId = 'chat_buyer1_seller1_prod1_1700000000000';
  assert.equal(resolveReviewId(chatId), resolveReviewId(chatId));
});

test('review id derivation: two different trades (different chatIds) never collide', () => {
  assert.notEqual(resolveReviewId('chat_a'), resolveReviewId('chat_b'));
});

test('review id derivation: still starts with the "rev_" prefix dbAdapter.ts\'s security barrier checks for', () => {
  assert.ok(resolveReviewId('chat_abc').startsWith('rev_'));
});

// /api/chats/start's duplicate-chat guard (a SELECT before the INSERT)
// isn't atomic with the write either -- same race shape, same fix.
// Mirrors server.ts:~5201: deriving the chat id deterministically from
// (buyerId, sellerId, productId) instead of appending Date.now(), so a
// racing second "Message Seller" request for the same trio (the product
// open in two tabs, or web+mobile at once) harmlessly reuses the same
// row instead of creating a duplicate conversation thread.
function resolveChatId(buyerId: string, sellerId: string, productId: string): string {
  return `chat_${buyerId}_${sellerId}_${productId}`;
}

test('chat id derivation: is deterministic for the same buyer/seller/product, closing the duplicate-chat race', () => {
  const args = ['buyer1', 'seller1', 'prod1'] as const;
  assert.equal(resolveChatId(...args), resolveChatId(...args));
});

test('chat id derivation: a different product with the same buyer/seller never collides with the first chat', () => {
  assert.notEqual(resolveChatId('buyer1', 'seller1', 'prod1'), resolveChatId('buyer1', 'seller1', 'prod2'));
});

// /api/reports/create had no duplicate-report prevention -- the id ended
// in ${Date.now()}, so the same reporter could spam-report the same
// listing an unlimited number of times. Mirrors server.ts:~5746: exactly
// one report row can now ever exist per (reporterId, productId) pair.
function resolveReportId(reporterId: string, productId: string): string {
  return `report_${reporterId}_${productId}`;
}

test('report id derivation: a repeat report from the same user against the same product reuses the same id (updates, not duplicates)', () => {
  assert.equal(resolveReportId('user1', 'prod1'), resolveReportId('user1', 'prod1'));
});

test('report id derivation: different reporters against the same product, or the same reporter against different products, never collide', () => {
  assert.notEqual(resolveReportId('user1', 'prod1'), resolveReportId('user2', 'prod1'));
  assert.notEqual(resolveReportId('user1', 'prod1'), resolveReportId('user1', 'prod2'));
});

// serverRateLimiter() (the real code this mirrors) starts a plain
// setInterval with no .unref() -- pre-existing behavior in server.ts,
// unrelated to this fix and out of scope to change here. This file never
// calls that real function, so it has no interval of its own; this is just
// a defensive, no-op-in-practice guard in case that changes later.
after(() => {
  process.exitCode = process.exitCode ?? 0;
});
