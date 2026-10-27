import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFindings, runStagingPreflight } from './stagingPreflight.js';

const STAGING_REF = 'stagingabcdefghijklm';
const jwt = (claims: object) => `hdr.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.SECRETSIGNATURE`;

const goodStaging = () => ({
  TEDBUY_ENV: 'staging',
  VITE_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
  SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
  VITE_SUPABASE_ANON_KEY: jwt({ role: 'anon', ref: STAGING_REF }),
  SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: STAGING_REF }),
  DROPSHIP_ENABLED: 'true',
  DROPSHIP_EXPECTED_SUPABASE_REF: STAGING_REF,
  PAYSTACK_SECRET_KEY: 'sk_test_abc',
  VITE_CLOUDINARY_CLOUD_NAME: 'tedbuy-staging',
});

const checks = (env: Record<string, string | undefined>, severity: string) =>
  runStagingPreflight(env, 'tedbuy-fb79a').filter(f => f.severity === severity).map(f => f.check);

test('an empty environment is blocked: hard-coded Supabase fallback and Firestore fallback', () => {
  const errors = checks({}, 'error');
  assert.ok(errors.includes('supabase.server'));
  assert.ok(errors.includes('supabase.frontend'));
  assert.ok(errors.includes('supabase.production'), 'the hard-coded fallback project is flagged');
});

test('a correctly isolated staging environment has no blocking problems', () => {
  const findings = runStagingPreflight(goodStaging(), 'tedbuy-fb79a');
  assert.deepEqual(findings.filter(f => f.severity === 'error'), []);
  assert.ok(findings.some(f => f.check === 'dropship' && f.severity === 'ok'));
  assert.ok(findings.some(f => f.check === 'firebase.project' && f.severity === 'warn'), 'shared production Firebase Auth is called out');
});

test('production Supabase projects, mismatched hosts and wrong keys are blocked', () => {
  assert.ok(checks({ ...goodStaging(), VITE_SUPABASE_URL: 'https://hnfqymkdgadwzrjenaqf.supabase.co', SUPABASE_URL: 'https://hnfqymkdgadwzrjenaqf.supabase.co' }, 'error').includes('supabase.production'));
  assert.ok(checks({ ...goodStaging(), SUPABASE_URL: 'https://otherprojectabcdefghi.supabase.co' }, 'error').includes('supabase.agreement'));
  assert.ok(checks({ ...goodStaging(), SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: 'hnfqymkdgadwzrjenaqf' }) }, 'error').includes('supabase.service_key'));
  assert.ok(checks({ ...goodStaging(), SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'anon', ref: STAGING_REF }) }, 'error').includes('supabase.service_key'));
  assert.ok(checks({ ...goodStaging(), VITE_SUPABASE_ANON_KEY: jwt({ role: 'anon', ref: 'hnfqymkdgadwzrjenaqf' }) }, 'error').includes('supabase.anon_key'));
});

test('Firebase: a separate project is rejected by the server today; production service accounts are blocked', () => {
  assert.ok(checks({ ...goodStaging(), VITE_FIREBASE_PROJECT_ID: 'tedbuy-staging' }, 'error').includes('firebase.project'));
  assert.ok(checks({ ...goodStaging(), GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'tedbuy-fb79a', private_key: 'PRIVATE' }) }, 'error').includes('firebase.service_account'));
});

test('live payment keys are blocked and real email is called out', () => {
  assert.ok(checks({ ...goodStaging(), PAYSTACK_SECRET_KEY: 'sk_live_xyz' }, 'error').includes('paystack'));
  assert.ok(checks({ ...goodStaging(), VITE_PAYSTACK_PUBLIC_KEY: 'pk_live_xyz' }, 'error').includes('paystack'));
  assert.ok(checks({ ...goodStaging(), BREVO_API_KEY: 'xkeysib-1' }, 'warn').includes('email'));
});

test('the report never contains secret values', () => {
  const env = {
    ...goodStaging(), PAYSTACK_SECRET_KEY: 'sk_live_TOPSECRET', BREVO_API_KEY: 'xkeysib-TOPSECRET',
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'tedbuy-fb79a', private_key: 'TOPSECRET' }),
  };
  const report = formatFindings(runStagingPreflight(env, 'tedbuy-fb79a'));
  assert.ok(!/TOPSECRET|SECRETSIGNATURE|sk_live_|xkeysib/.test(report), report);
});
