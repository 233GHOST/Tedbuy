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

// serverRateLimiter() (the real code this mirrors) starts a plain
// setInterval with no .unref() -- pre-existing behavior in server.ts,
// unrelated to this fix and out of scope to change here. This file never
// calls that real function, so it has no interval of its own; this is just
// a defensive, no-op-in-practice guard in case that changes later.
after(() => {
  process.exitCode = process.exitCode ?? 0;
});
