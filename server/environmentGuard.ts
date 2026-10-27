import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Explicit deployment environment for TedBuy (TEDBUY_ENV).
//
// Unset keeps today's behaviour exactly (production and existing local setups rely on it).
// TEDBUY_ENV=staging turns on strict checks: the server refuses to start, and the frontend
// build refuses to build, unless the instance is fully pointed at its own Supabase project
// and cannot reach production data through any of the legacy fallbacks:
//   * server.ts falls back to a hard-coded Supabase URL and anon key;
//   * src/dbAdapter.ts falls back to Firestore when VITE_SUPABASE_* is missing;
//   * Firebase Admin is bound to the production project, so any Google credential
//     (service-account variables or ambient application-default credentials) would let the
//     server write production Firestore and change production Firebase accounts.
// Messages name variables, hosts and project refs only, never secret values.

export type TedbuyEnvironment = 'production' | 'staging' | 'development' | 'unspecified';

export const PRODUCTION_SUPABASE_REFS = ['hnfqymkdgadwzrjenaqf', 'kxfykyxagkbrjymjmtal'];
export const SERVER_ADMIN_FIREBASE_PROJECT = 'tedbuy-fb79a';

type Env = Record<string, string | undefined>;

export function resolveTedbuyEnvironment(env: Env): { environment: TedbuyEnvironment; error?: string } {
  const raw = (env.TEDBUY_ENV ?? '').trim();
  if (!raw) return { environment: 'unspecified' };
  if (raw === 'production' || raw === 'staging' || raw === 'development') return { environment: raw };
  return { environment: 'unspecified', error: `TEDBUY_ENV must be production, staging or development (got an unrecognised value).` };
}

function jwtClaims(value: string | undefined): Record<string, unknown> | null {
  if (!value || value.split('.').length !== 3) return null;
  try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
}

function supabaseRef(url: string | undefined): { host: string | null; ref: string | null; error?: string } {
  if (!url) return { host: null, ref: null };
  let u: URL;
  try { u = new URL(url); } catch { return { host: null, ref: null, error: 'is not a valid URL' }; }
  if (u.protocol !== 'https:') return { host: u.host, ref: null, error: 'must use https' };
  const host = u.host.toLowerCase();
  return { host, ref: host.endsWith('.supabase.co') ? host.slice(0, -'.supabase.co'.length) : null };
}

// Server-only secrets that must never be in a VITE_ variable (Vite inlines every VITE_
// variable into the public JavaScript bundle).
const SERVER_SECRET_VARS = [
  'SUPABASE_SERVICE_ROLE_KEY', 'PAYSTACK_SECRET_KEY', 'CRON_SECRET', 'BREVO_API_KEY', 'CLOUDINARY_API_SECRET',
  'GEMINI_API_KEY', 'GITHUB_TOKEN', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'FIREBASE_SERVICE_ACCOUNT_KEY', 'DROPSHIP_ID_HMAC_KEY_V1',
];

// Names of VITE_ variables whose value is (or looks like) a server secret.
export function findSecretsInFrontendVars(env: Env): string[] {
  const secretValues = new Set(SERVER_SECRET_VARS.map(n => env[n]).filter((v): v is string => !!v && v.length >= 8));
  return Object.keys(env).filter(name => name.startsWith('VITE_')).filter(name => {
    const v = env[name];
    if (!v) return false;
    if (/SECRET|SERVICE_ROLE|PRIVATE_KEY|PASSWORD/.test(name)) return true; // e.g. VITE_CLOUDINARY_API_SECRET
    if (secretValues.has(v)) return true;
    if (jwtClaims(v)?.role === 'service_role') return true;
    return /^sk_(live|test)_|^sb_secret_|-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"\s*:/.test(v);
  }).sort();
}

// Application-default credentials that the Google SDKs pick up without any configuration.
export function defaultAdcFilePaths(env: Env): string[] {
  const paths = [path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json')];
  if (env.APPDATA) paths.push(path.join(env.APPDATA, 'gcloud', 'application_default_credentials.json'));
  return paths;
}

export function validateStagingEnvironment(env: Env, fileExists: (p: string) => boolean = fs.existsSync): string[] {
  const errors: string[] = [];

  // Supabase: both URLs set, valid, identical, and not a production project.
  const vite = supabaseRef(env.VITE_SUPABASE_URL);
  const server = supabaseRef(env.SUPABASE_URL);
  if (!env.VITE_SUPABASE_URL) errors.push('VITE_SUPABASE_URL is required in staging (otherwise the frontend writes to Firestore).');
  if (!env.SUPABASE_URL) errors.push('SUPABASE_URL is required in staging (otherwise the server can fall back to a hard-coded project).');
  if (vite.error) errors.push(`VITE_SUPABASE_URL ${vite.error}.`);
  if (server.error) errors.push(`SUPABASE_URL ${server.error}.`);
  if (vite.host && server.host && vite.host !== server.host) {
    errors.push(`VITE_SUPABASE_URL (${vite.host}) and SUPABASE_URL (${server.host}) point at different projects; frontend and server must use the same staging project.`);
  }
  for (const r of new Set([vite.ref, server.ref])) {
    if (r && PRODUCTION_SUPABASE_REFS.includes(r)) errors.push(`Supabase project "${r}" is a production project and must not be used by staging.`);
  }
  const ref = server.ref ?? vite.ref;

  // Keys: present, of the right kind, for the same project, and not swapped.
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!anonKey) errors.push('VITE_SUPABASE_ANON_KEY is required in staging.');
  if (!serviceKey) errors.push('SUPABASE_SERVICE_ROLE_KEY is required in staging (otherwise the server falls back to the anon key).');
  if (anonKey && serviceKey && anonKey === serviceKey) errors.push('SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_ANON_KEY are the same value.');
  if (anonKey?.startsWith('sb_secret_')) errors.push('VITE_SUPABASE_ANON_KEY holds a secret key; use the publishable/anon key.');
  if (serviceKey?.startsWith('sb_publishable_')) errors.push('SUPABASE_SERVICE_ROLE_KEY holds a publishable key, not a secret key.');
  const anon = jwtClaims(anonKey);
  const service = jwtClaims(serviceKey);
  if (anon && anon.role !== 'anon') errors.push(`VITE_SUPABASE_ANON_KEY has role "${String(anon.role)}", expected "anon".`);
  if (service && service.role !== 'service_role') errors.push(`SUPABASE_SERVICE_ROLE_KEY has role "${String(service.role)}", expected "service_role".`);
  for (const [name, claims] of [['VITE_SUPABASE_ANON_KEY', anon], ['SUPABASE_SERVICE_ROLE_KEY', service]] as const) {
    if (claims && typeof claims.ref === 'string' && ref && claims.ref !== ref) {
      errors.push(`${name} belongs to project "${claims.ref}", not "${ref}".`);
    }
  }

  // Server secrets must never be exposed through VITE_ variables.
  for (const name of findSecretsInFrontendVars(env)) {
    errors.push(`${name} contains a server secret; VITE_ variables are embedded in the public JavaScript bundle.`);
  }

  // No Google credentials: Firebase Admin is bound to the production project.
  for (const name of ['GOOGLE_SERVICE_ACCOUNT_JSON', 'FIREBASE_SERVICE_ACCOUNT_KEY', 'GOOGLE_APPLICATION_CREDENTIALS']) {
    if (env[name]) errors.push(`${name} must not be set in staging: Firebase Admin targets the production project "${SERVER_ADMIN_FIREBASE_PROJECT}".`);
  }
  for (const p of defaultAdcFilePaths(env)) {
    if (fileExists(p)) {
      errors.push(`Google application-default credentials exist at ${p}; Firebase Admin would use them against the production project. Run staging where they are absent (e.g. a separate user or container).`);
    }
  }

  // Sign-in: the server only verifies tokens for its Admin project.
  if (env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_PROJECT_ID !== SERVER_ADMIN_FIREBASE_PROJECT) {
    errors.push(`VITE_FIREBASE_PROJECT_ID ("${env.VITE_FIREBASE_PROJECT_ID}") differs from the server's Firebase Admin project; every sign-in would be rejected.`);
  }

  // Payments: never live keys outside production.
  if (env.PAYSTACK_SECRET_KEY?.startsWith('sk_live_')) errors.push('PAYSTACK_SECRET_KEY is a live key; staging may only use sk_test_ keys.');
  if (env.VITE_PAYSTACK_PUBLIC_KEY?.startsWith('pk_live_')) errors.push('VITE_PAYSTACK_PUBLIC_KEY is a live key; staging may only use pk_test_ keys.');

  return errors;
}

// Server start-up check. Returns the environment; throws (with every problem listed) when
// TEDBUY_ENV is invalid or staging is unsafe. Production/unspecified only gets warnings.
export function checkServerEnvironment(env: Env, fileExists?: (p: string) => boolean): TedbuyEnvironment {
  const { environment, error } = resolveTedbuyEnvironment(env);
  if (error) throw new Error(`[Environment] ${error}`);
  if (environment === 'staging') {
    const errors = validateStagingEnvironment(env, fileExists);
    if (errors.length) {
      throw new Error(`[Environment] Refusing to start in staging:\n  - ${errors.join('\n  - ')}`);
    }
    return environment;
  }
  const exposed = findSecretsInFrontendVars(env);
  if (exposed.length) {
    console.error(`[Environment] CRITICAL: ${exposed.join(', ')} contain(s) a server secret and would be embedded in the frontend bundle at build time.`);
  }
  return environment;
}
