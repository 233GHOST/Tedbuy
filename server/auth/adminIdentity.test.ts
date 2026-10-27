import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OWNER_EMAIL, applyImpersonation, assessOwnerAccount, hasAdminAuthority, identityFromToken, isAdminToken, syncedIdentityFields,
} from './adminIdentity.js';

// Token objects below stand in for what Firebase's verifyIdToken() returns; signature
// verification itself is Firebase's and is not exercised here.
const ownerUid = 'owner-uid';
const future = new Date(Date.now() + 60_000).toISOString();

test('a verified owner identity is an admin', () => {
  const id = identityFromToken({ uid: ownerUid, email: OWNER_EMAIL, email_verified: true });
  assert.equal(id.isAdmin, true);
  assert.equal(hasAdminAuthority(id), true);
  assert.equal(isAdminToken({ uid: ownerUid, email: '  Asumaduvincent7@Gmail.com ', email_verified: true }), true, 'case and spaces normalised');
});

test('an owner email without email_verified is NOT an admin', () => {
  for (const email_verified of [false, undefined, 'true', 1]) {
    const id = identityFromToken({ uid: 'someone-else', email: OWNER_EMAIL, email_verified });
    assert.equal(id.isAdmin, false, `email_verified=${String(email_verified)}`);
    assert.equal(hasAdminAuthority(id), false);
  }
});

test('existing legitimate administrators keep access through the admin custom claim', () => {
  assert.equal(isAdminToken({ uid: 'staff', email: 'staff@example.com', email_verified: true, admin: true }), true);
  assert.equal(isAdminToken({ uid: 'staff', email: 'staff@example.com', email_verified: false, admin: true }), true, 'claim does not depend on the email');
  assert.equal(isAdminToken({ uid: 'u', email: 'u@example.com', email_verified: true }), false);
});

test('impersonation: only admins can impersonate; the session keeps admin authority and records the real admin', () => {
  const session = { targetUserId: 'target', targetUserEmail: 'target@example.com', expiresAt: future };
  const admin = identityFromToken({ uid: ownerUid, email: OWNER_EMAIL, email_verified: true });
  const imp = applyImpersonation(admin, session);
  assert.deepEqual(imp, { uid: 'target', email: 'target@example.com', isAdmin: true, isImpersonating: true, originalAdmin: { uid: ownerUid, email: OWNER_EMAIL } });
  assert.equal(hasAdminAuthority(imp), true);

  const unverifiedOwner = identityFromToken({ uid: 'x', email: OWNER_EMAIL, email_verified: false });
  assert.deepEqual(applyImpersonation(unverifiedOwner, session), unverifiedOwner, 'an unverified owner email cannot impersonate');
  const plain = identityFromToken({ uid: 'u', email: 'u@example.com', email_verified: true });
  assert.deepEqual(applyImpersonation(plain, session), plain, 'a regular user cannot impersonate');
  assert.deepEqual(applyImpersonation(admin, { ...session, expiresAt: new Date(Date.now() - 1).toISOString() }), admin, 'expired session ignored');
});

test('users/sync: another user submitting the owner email gets their real email and no admin flag', () => {
  const caller = identityFromToken({ uid: 'mallory', email: 'mallory@example.com', email_verified: true });
  // Firebase record readable: its email wins.
  assert.deepEqual(syncedIdentityFields({ caller, isOwner: true, firebaseEmail: 'mallory@example.com', existingIsAdmin: false }),
    { email: 'mallory@example.com', isAdmin: false });
  // Firebase record unreadable: the caller's own verified token email, never the body.
  assert.deepEqual(syncedIdentityFields({ caller, isOwner: true, firebaseEmail: null, existingIsAdmin: false }),
    { email: 'mallory@example.com', isAdmin: false });
});

test('users/sync: the verified owner keeps the stored admin display flag; an unverified owner email does not get it', () => {
  const owner = identityFromToken({ uid: ownerUid, email: OWNER_EMAIL, email_verified: true });
  assert.equal(syncedIdentityFields({ caller: owner, isOwner: true, firebaseEmail: OWNER_EMAIL, existingIsAdmin: false }).isAdmin, true);
  const fake = identityFromToken({ uid: 'x', email: OWNER_EMAIL, email_verified: false });
  assert.equal(syncedIdentityFields({ caller: fake, isOwner: true, firebaseEmail: OWNER_EMAIL, existingIsAdmin: false }).isAdmin, false);
  // An existing flag is preserved (it is display-only and never trusted for authorization).
  assert.equal(syncedIdentityFields({ caller: fake, isOwner: true, firebaseEmail: null, existingIsAdmin: true }).isAdmin, true);
});

test('users/sync during impersonation: no email from the session and no admin flag for the target', () => {
  const admin = identityFromToken({ uid: ownerUid, email: OWNER_EMAIL, email_verified: true });
  const imp = applyImpersonation(admin, { targetUserId: 'target', targetUserEmail: OWNER_EMAIL, expiresAt: future });
  assert.deepEqual(syncedIdentityFields({ caller: imp, isOwner: true, firebaseEmail: null, existingIsAdmin: false }), { isAdmin: false });
  assert.deepEqual(syncedIdentityFields({ caller: imp, isOwner: true, firebaseEmail: 'target@example.com', existingIsAdmin: false }),
    { email: 'target@example.com', isAdmin: false });
});

test('pre-deployment owner check blocks an unverified owner account without an admin claim', () => {
  assert.equal(assessOwnerAccount({ emailVerified: true, providers: ['google.com'] }).ok, true);
  assert.equal(assessOwnerAccount({ emailVerified: false, customClaims: { admin: true }, providers: ['password'] }).ok, true);
  const blocked = assessOwnerAccount({ emailVerified: false, providers: ['password'] });
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /would remove the owner's admin access/);
  assert.equal(assessOwnerAccount(null).ok, false);
});

// ---- Source-level regression guards over server.ts ------------------------------------
const serverSrc = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../server.ts'), 'utf8');

test('server.ts has no admin check that ORs in the owner email', () => {
  const bad = serverSrc.split('\n').map((l, i) => [i + 1, l] as const)
    .filter(([, l]) => /isAdmin\s*(\|\||:).*asumaduvincent7@gmail\.com/.test(l) && !/u\.isAdmin === true/.test(l));
  assert.deepEqual(bad, [], `owner-email admin checks remain at lines ${bad.map(b => b[0]).join(', ')}`);
  assert.match(serverSrc, /baseUser = identityFromToken\(decoded\)/, 'verifyUser uses the shared helper');
});

test('server.ts /api/users/sync never takes email or isAdmin from the request body', () => {
  const start = serverSrc.indexOf("app.post('/api/users/sync'");
  const end = serverSrc.indexOf('\napp.', start + 10);
  const handler = serverSrc.slice(start, end);
  assert.ok(start > 0 && handler.length > 1000, 'handler found');
  assert.doesNotMatch(handler, /email:\s*user\.email/, 'stored email must not come from the body');
  assert.doesNotMatch(handler, /isAdmin:[^\n]*user\.(email|isAdmin)/, 'isAdmin must not depend on the body');
  assert.match(handler, /syncedIdentityFields\(/);
});
