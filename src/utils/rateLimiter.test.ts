import test from 'node:test';
import assert from 'node:assert/strict';
import { checkClientRateLimit } from './rateLimiter.ts';

// Zero imports, but reads localStorage (a browser global not present under
// plain Node). This is a client-side, best-effort UX throttle only -- the
// real enforcement is serverRateLimiter in server.ts, applied to every
// auth-sensitive route (login, registration OTP, password reset, etc).
// A minimal in-memory localStorage stub is installed so the real module
// code runs unmodified.

function installFakeLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
  return store;
}

test('checkClientRateLimit: an unrecognized action is always allowed (no config = no limit)', () => {
  installFakeLocalStorage();
  const result = checkClientRateLimit('some_unknown_action', 'user1');
  assert.equal(result.allowed, true);
});

test('checkClientRateLimit: allows requests under the configured max, then blocks once the max is hit', () => {
  installFakeLocalStorage();
  for (let i = 0; i < 5; i++) {
    const result = checkClientRateLimit('login', 'user1');
    assert.equal(result.allowed, true, `attempt ${i + 1} should be allowed (limit is 5)`);
  }
  const sixth = checkClientRateLimit('login', 'user1');
  assert.equal(sixth.allowed, false);
  assert.ok(typeof sixth.remainingSecs === 'number' && sixth.remainingSecs! > 0);
});

test('checkClientRateLimit: different identifiers are tracked independently', () => {
  installFakeLocalStorage();
  for (let i = 0; i < 5; i++) checkClientRateLimit('login', 'user1');
  const blocked = checkClientRateLimit('login', 'user1');
  const otherUser = checkClientRateLimit('login', 'user2');
  assert.equal(blocked.allowed, false);
  assert.equal(otherUser.allowed, true);
});

test('checkClientRateLimit: different actions for the same identifier are tracked independently', () => {
  installFakeLocalStorage();
  for (let i = 0; i < 5; i++) checkClientRateLimit('login', 'user1');
  const loginBlocked = checkClientRateLimit('login', 'user1');
  const registerStillOk = checkClientRateLimit('register', 'user1');
  assert.equal(loginBlocked.allowed, false);
  assert.equal(registerStillOk.allowed, true);
});

test('checkClientRateLimit: expired timestamps outside the window are pruned, freeing up new attempts', () => {
  installFakeLocalStorage();
  const key = 'tedbuy_rate_limit_login_user1';
  const past = Date.now() - 2 * 60 * 1000; // 2 minutes ago, outside login's 1-minute window
  localStorage.setItem(key, JSON.stringify({ timestamps: [past, past, past, past, past] }));
  const result = checkClientRateLimit('login', 'user1');
  assert.equal(result.allowed, true);
});

test('checkClientRateLimit: corrupted JSON in localStorage is tolerated, treated as a fresh state', () => {
  installFakeLocalStorage();
  const key = 'tedbuy_rate_limit_login_user1';
  localStorage.setItem(key, '{not valid json');
  const result = checkClientRateLimit('login', 'user1');
  assert.equal(result.allowed, true);
});

test('checkClientRateLimit: a localStorage that throws (private mode / quota) fails open (never blocks the user)', () => {
  (globalThis as any).localStorage = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('SecurityError'); },
  };
  const result = checkClientRateLimit('login', 'user1');
  assert.equal(result.allowed, true);
});

test('checkClientRateLimit: the default identifier is used when none is passed', () => {
  installFakeLocalStorage();
  const withDefault = checkClientRateLimit('search_query');
  const explicitDefault = checkClientRateLimit('search_query', 'default');
  assert.equal(withDefault.allowed, true);
  assert.equal(explicitDefault.allowed, true);
});
