import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkServerEnvironment, findSecretsInFrontendVars, resolveTedbuyEnvironment, validateStagingEnvironment,
} from './environmentGuard.js';

const REF = 'stagingabcdefghijklm';
const jwt = (claims: object) => `hdr.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.SIGNATURE-CANARY`;
const noAdc = (_p: string) => false;

const staging = (): Record<string, string | undefined> => ({
  TEDBUY_ENV: 'staging',
  VITE_SUPABASE_URL: `https://${REF}.supabase.co`,
  SUPABASE_URL: `https://${REF}.supabase.co`,
  VITE_SUPABASE_ANON_KEY: jwt({ role: 'anon', ref: REF }),
  SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: REF }),
  PAYSTACK_SECRET_KEY: 'sk_test_abc',
});
const problems = (env: Record<string, string | undefined>, adc: (p: string) => boolean = noAdc) => validateStagingEnvironment(env, adc).join('\n');

test('TEDBUY_ENV: unset keeps current behaviour; unknown values are rejected', () => {
  assert.equal(resolveTedbuyEnvironment({}).environment, 'unspecified');
  assert.equal(resolveTedbuyEnvironment({ TEDBUY_ENV: 'staging' }).environment, 'staging');
  assert.ok(resolveTedbuyEnvironment({ TEDBUY_ENV: 'stagin' }).error);
  assert.throws(() => checkServerEnvironment({ TEDBUY_ENV: 'prod' }, noAdc), /TEDBUY_ENV must be/);
});

test('production / unspecified: nothing is enforced, so existing deployments start exactly as before', () => {
  // No Supabase variables at all (today the server then uses its hard-coded fallback): still starts.
  assert.equal(checkServerEnvironment({}, noAdc), 'unspecified');
  assert.equal(checkServerEnvironment({ TEDBUY_ENV: 'production', GOOGLE_SERVICE_ACCOUNT_JSON: '{}' }, noAdc), 'production');
});

test('a fully isolated staging environment starts', () => {
  assert.equal(problems(staging()), '');
  assert.equal(checkServerEnvironment(staging(), noAdc), 'staging');
});

test('staging refuses missing configuration (each legacy fallback)', () => {
  assert.match(problems({ TEDBUY_ENV: 'staging' }), /VITE_SUPABASE_URL is required[\s\S]*SUPABASE_URL is required[\s\S]*VITE_SUPABASE_ANON_KEY is required[\s\S]*SUPABASE_SERVICE_ROLE_KEY is required/);
  assert.match(problems({ ...staging(), VITE_SUPABASE_URL: undefined }), /frontend writes to Firestore/);
  assert.match(problems({ ...staging(), SUPABASE_URL: undefined }), /hard-coded project/);
  assert.match(problems({ ...staging(), SUPABASE_SERVICE_ROLE_KEY: undefined }), /falls back to the anon key/);
  assert.match(problems({ ...staging(), SUPABASE_URL: 'not a url' }), /SUPABASE_URL is not a valid URL/);
  assert.match(problems({ ...staging(), SUPABASE_URL: `http://${REF}.supabase.co` }), /must use https/);
  assert.throws(() => checkServerEnvironment({ TEDBUY_ENV: 'staging' }, noAdc), /Refusing to start in staging/);
});

test('staging refuses mismatched or production Supabase projects and wrong keys', () => {
  assert.match(problems({ ...staging(), SUPABASE_URL: 'https://otherprojectabcdefghi.supabase.co' }), /point at different projects/);
  const prod = 'https://hnfqymkdgadwzrjenaqf.supabase.co';
  assert.match(problems({ ...staging(), SUPABASE_URL: prod, VITE_SUPABASE_URL: prod }), /production project/);
  assert.match(problems({ ...staging(), SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'service_role', ref: 'otherprojectabcdefghi' }) }), /SUPABASE_SERVICE_ROLE_KEY belongs to project/);
  assert.match(problems({ ...staging(), SUPABASE_SERVICE_ROLE_KEY: jwt({ role: 'anon', ref: REF }) }), /expected "service_role"/);
  assert.match(problems({ ...staging(), VITE_SUPABASE_ANON_KEY: jwt({ role: 'service_role', ref: REF }) }), /expected "anon"/);
  const same = jwt({ role: 'anon', ref: REF });
  assert.match(problems({ ...staging(), VITE_SUPABASE_ANON_KEY: same, SUPABASE_SERVICE_ROLE_KEY: same }), /same value/);
});

test('staging refuses server secrets in VITE_ variables (they would be embedded in the bundle)', () => {
  const env = staging();
  assert.deepEqual(findSecretsInFrontendVars({ ...env, VITE_SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY }), ['VITE_SUPABASE_SERVICE_ROLE_KEY']);
  assert.deepEqual(findSecretsInFrontendVars({ ...env, VITE_ANYTHING: env.SUPABASE_SERVICE_ROLE_KEY }), ['VITE_ANYTHING']);
  assert.deepEqual(findSecretsInFrontendVars({ ...env, VITE_PAYSTACK_KEY: 'sk_test_123' }), ['VITE_PAYSTACK_KEY']);
  assert.deepEqual(findSecretsInFrontendVars({ ...env, VITE_CLOUDINARY_API_SECRET: 'abc' }), ['VITE_CLOUDINARY_API_SECRET']);
  assert.deepEqual(findSecretsInFrontendVars(env), [], 'the anon key and public URLs are allowed');
  assert.match(problems({ ...env, VITE_X: env.SUPABASE_SERVICE_ROLE_KEY }), /VITE_X contains a server secret/);
});

test('staging refuses Google credentials (Firebase Admin is bound to the production project)', () => {
  assert.match(problems({ ...staging(), GOOGLE_SERVICE_ACCOUNT_JSON: '{"project_id":"tedbuy-fb79a"}' }), /GOOGLE_SERVICE_ACCOUNT_JSON must not be set/);
  assert.match(problems({ ...staging(), FIREBASE_SERVICE_ACCOUNT_KEY: '{}' }), /FIREBASE_SERVICE_ACCOUNT_KEY must not be set/);
  assert.match(problems({ ...staging(), GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json' }), /GOOGLE_APPLICATION_CREDENTIALS must not be set/);
  assert.match(problems(staging(), p => p.endsWith('application_default_credentials.json')), /application-default credentials exist/);
  assert.match(problems({ ...staging(), VITE_FIREBASE_PROJECT_ID: 'tedbuy-staging' }), /every sign-in would be rejected/);
});

test('staging refuses live payment keys', () => {
  assert.match(problems({ ...staging(), PAYSTACK_SECRET_KEY: 'sk_live_x' }), /live key/);
  assert.match(problems({ ...staging(), VITE_PAYSTACK_PUBLIC_KEY: 'pk_live_x' }), /live key/);
});

test('error messages never contain secret values', () => {
  const env = {
    ...staging(), SUPABASE_URL: 'https://hnfqymkdgadwzrjenaqf.supabase.co',
    VITE_LEAK: jwt({ role: 'service_role', ref: REF }), PAYSTACK_SECRET_KEY: 'sk_live_TOPSECRET',
    GOOGLE_SERVICE_ACCOUNT_JSON: '{"private_key":"TOPSECRET"}', VITE_FIREBASE_PROJECT_ID: 'tedbuy-staging',
  };
  let message = '';
  try { checkServerEnvironment(env, noAdc); } catch (e) { message = (e as Error).message; }
  assert.ok(message.includes('Refusing to start'), 'it refused');
  assert.ok(!/TOPSECRET|SIGNATURE-CANARY|sk_live_|hdr\./.test(message), message);
});
