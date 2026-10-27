// PRE-DEPLOYMENT CHECK for the admin-identity change (server/auth/adminIdentity.ts).
//
// From this change on, the owner email grants admin access only when Firebase marks it
// verified (email_verified === true). Run this BEFORE deploying, as the owner, on your own
// machine, with credentials you already hold for the Firebase project:
//   GOOGLE_SERVICE_ACCOUNT_JSON (or FIREBASE_SERVICE_ACCOUNT_KEY) set, or
//   `gcloud auth application-default login` done for the owner account.
//
//   npx tsx scripts/check-owner-admin-identity.ts
//
// Read-only: one getUserByEmail() call. It prints the verdict, never a key or token.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { OWNER_EMAIL, assessOwnerAccount } from '../server/auth/adminIdentity.js';

const PROJECT_ID = 'tedbuy-fb79a'; // same project server.ts verifies tokens for

const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!getApps().length) {
  initializeApp(saJson ? { credential: cert(JSON.parse(saJson)), projectId: PROJECT_ID } : { projectId: PROJECT_ID });
}

let record: Parameters<typeof assessOwnerAccount>[0] = null;
try {
  const u = await getAuth().getUserByEmail(OWNER_EMAIL);
  record = { emailVerified: u.emailVerified, customClaims: u.customClaims ?? null, providers: u.providerData.map(p => p.providerId) };
} catch (err: any) {
  if (err?.code !== 'auth/user-not-found') {
    console.error(`Could not read the owner account (${err?.code || 'error'}). Check your Firebase credentials.`);
    process.exit(2);
  }
}

const verdict = assessOwnerAccount(record);
console.log(`${verdict.ok ? 'OK' : 'BLOCK DEPLOYMENT'}: ${verdict.message}`);
console.log(`
Also run this read-only query in the Supabase SQL editor. Before this fix, any signed-in user
could store the owner's email and an admin flag on their own profile:

  select id, email, "isAdmin" from public.users
   where "isAdmin" = true or lower(trim(email)) = '${OWNER_EMAIL}';

Expected: only the owner's own account (uid ${record ? '= the owner account above' : 'of the owner'}).
Any other row was set through the old bug: review it before relying on admin protections,
which still compare stored emails.`);
process.exit(verdict.ok ? 0 : 1);
