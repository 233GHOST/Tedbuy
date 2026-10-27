import { resolveDropshipConfig } from './db.js';
import { findSecretsInFrontendVars } from '../environmentGuard.js';

// Read-only safety check for a staging/test instance of TedBuy. It inspects environment
// variable NAMES and non-secret identifiers (hosts, project refs, key prefixes, JWT
// role/ref claims) and never returns or prints a secret value.
//
// It mirrors how the app actually resolves configuration (server.ts, src/dbAdapter.ts,
// src/firebase.ts, server/dropship/db.ts) so that a misconfigured staging instance is
// caught before it can reach production data.

export type Severity = 'error' | 'warn' | 'ok';
export interface Finding { severity: Severity; check: string; message: string }

// Identifiers that a staging instance must never use.
export const PRODUCTION_SUPABASE_REFS = ['hnfqymkdgadwzrjenaqf', 'kxfykyxagkbrjymjmtal'];
export const PRODUCTION_FIREBASE_PROJECT = 'tedbuy-fb79a';
// server.ts: hard-coded fallbacks used when no Supabase URL is configured.
const SERVER_FALLBACK_SUPABASE_HOST = 'kxfykyxagkbrjymjmtal.supabase.co';
// server.ts initialises Firebase Admin with this project id regardless of environment.
export const SERVER_ADMIN_FIREBASE_PROJECT = 'tedbuy-fb79a';
const PRODUCTION_CLOUDINARY_CLOUD = 'dfm3g2qvg';

type Env = Record<string, string | undefined>;

function host(url: string | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).host.toLowerCase(); } catch { return 'invalid-url'; }
}
const refOf = (h: string | null) => (h && h.endsWith('.supabase.co') ? h.slice(0, -'.supabase.co'.length) : null);

function jwtClaims(key: string | undefined): Record<string, unknown> | null {
  if (!key) return null;
  try { return JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString('utf8')); } catch { return null; }
}

export function runStagingPreflight(env: Env, appletFirebaseProjectId: string): Finding[] {
  const out: Finding[] = [];
  const add = (severity: Severity, check: string, message: string) => out.push({ severity, check, message });

  // --- Supabase -------------------------------------------------------------------------
  const viteHost = host(env.VITE_SUPABASE_URL);
  const serverHost = host(env.SUPABASE_URL);
  // server.ts: VITE_SUPABASE_URL || SUPABASE_URL || hard-coded fallback.
  const legacyServerHost = viteHost ?? serverHost ?? SERVER_FALLBACK_SUPABASE_HOST;

  if (!viteHost && !serverHost) {
    add('error', 'supabase.server', `No Supabase URL set: the legacy server would silently use its hard-coded project (${SERVER_FALLBACK_SUPABASE_HOST}). Set SUPABASE_URL and VITE_SUPABASE_URL to the staging project.`);
  }
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    add('error', 'supabase.frontend', 'VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing at build time: src/dbAdapter.ts would fall back to writing to Firestore in the configured Firebase project.');
  }
  if (viteHost && serverHost && viteHost !== serverHost) {
    add('error', 'supabase.agreement', `VITE_SUPABASE_URL (${viteHost}) and SUPABASE_URL (${serverHost}) differ: the server, sitemap and frontend would use different projects, and Dropship refuses to start.`);
  }
  for (const h of new Set([viteHost, serverHost, legacyServerHost].filter(Boolean) as string[])) {
    const ref = refOf(h);
    if (ref && PRODUCTION_SUPABASE_REFS.includes(ref)) {
      add('error', 'supabase.production', `Supabase host ${h} is a known production (or production-candidate) project. A staging instance must use its own project.`);
    }
  }
  const legacyRef = refOf(legacyServerHost);
  const anon = jwtClaims(env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY);
  if (anon && typeof anon.ref === 'string' && legacyRef && anon.ref !== legacyRef) {
    add('error', 'supabase.anon_key', `The anon key belongs to project "${anon.ref}", not ${legacyRef}.`);
  }
  const service = jwtClaims(env.SUPABASE_SERVICE_ROLE_KEY);
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    if (service && service.role !== 'service_role') add('error', 'supabase.service_key', `SUPABASE_SERVICE_ROLE_KEY has role "${String(service.role)}", not service_role.`);
    if (service && typeof service.ref === 'string' && legacyRef && service.ref !== legacyRef) {
      add('error', 'supabase.service_key', `SUPABASE_SERVICE_ROLE_KEY belongs to project "${service.ref}", not ${legacyRef}.`);
    }
  } else {
    add('warn', 'supabase.service_key', 'SUPABASE_SERVICE_ROLE_KEY is not set: the legacy server falls back to the anon key and Dropship stays off.');
  }
  if (!out.some(f => f.severity === 'error' && f.check.startsWith('supabase'))) {
    add('ok', 'supabase', `Frontend, legacy server and Dropship would all use ${legacyServerHost}.`);
  }

  // --- Firebase -------------------------------------------------------------------------
  const frontendProject = env.VITE_FIREBASE_PROJECT_ID || appletFirebaseProjectId;
  if (frontendProject !== SERVER_ADMIN_FIREBASE_PROJECT) {
    add('error', 'firebase.project', `The frontend signs in to Firebase project "${frontendProject}", but server.ts verifies ID tokens for the hard-coded project "${SERVER_ADMIN_FIREBASE_PROJECT}": every sign-in would be rejected (401). A separate staging Firebase project needs the server's Admin project id to become configurable.`);
  } else if (frontendProject === PRODUCTION_FIREBASE_PROJECT) {
    add('warn', 'firebase.project', `Firebase Auth is the production project "${frontendProject}" (the only one server.ts accepts today). Use dedicated test accounts only; they are created in the production user list.`);
  }
  const saJson = env.GOOGLE_SERVICE_ACCOUNT_JSON || env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (saJson) {
    let saProject = 'unreadable';
    try { saProject = String(JSON.parse(saJson).project_id ?? 'missing'); } catch { /* reported below */ }
    if (saProject === PRODUCTION_FIREBASE_PROJECT || saProject === 'unreadable') {
      add('error', 'firebase.service_account', `A Firebase service account is configured (project "${saProject}"): the server's Firestore fallbacks and product sync would write to that project's Firestore. Leave GOOGLE_SERVICE_ACCOUNT_JSON / FIREBASE_SERVICE_ACCOUNT_KEY unset for staging.`);
    }
  }

  // --- Payments, email, media ---------------------------------------------------------------
  if ((env.PAYSTACK_SECRET_KEY || '').startsWith('sk_live_')) add('error', 'paystack', 'PAYSTACK_SECRET_KEY is a LIVE key. Staging must use an sk_test_ key or none.');
  if ((env.VITE_PAYSTACK_PUBLIC_KEY || '').startsWith('pk_live_')) add('error', 'paystack', 'VITE_PAYSTACK_PUBLIC_KEY is a LIVE key. Staging must use a pk_test_ key or none.');
  if (env.BREVO_API_KEY) add('warn', 'email', 'BREVO_API_KEY is set: staging would send real emails.');
  const cloud = env.VITE_CLOUDINARY_CLOUD_NAME || env.CLOUDINARY_CLOUD_NAME || PRODUCTION_CLOUDINARY_CLOUD;
  if (cloud === PRODUCTION_CLOUDINARY_CLOUD) {
    add('warn', 'cloudinary', env.CLOUDINARY_API_SECRET || env.VITE_CLOUDINARY_API_SECRET
      ? 'Photo uploads would go to the production Cloudinary account (tedbuy_products folder).'
      : 'Cloudinary is not configured: photo uploads return 503, so supplier products (which need a photo) cannot be created.');
  }

  // --- Explicit environment and isolation (server/environmentGuard.ts) ----------------------
  if (env.TEDBUY_ENV !== 'staging') {
    add('error', 'environment', 'TEDBUY_ENV is not "staging": the server and the frontend build would not enforce staging isolation.');
  }
  for (const name of findSecretsInFrontendVars(env)) {
    add('error', 'frontend.secrets', `${name} holds a server secret and would be embedded in the public bundle.`);
  }
  for (const name of ['GOOGLE_APPLICATION_CREDENTIALS']) {
    if (env[name]) add('error', 'firebase.service_account', `${name} is set: Firebase Admin would use it against the production project.`);
  }

  // --- Dropship ------------------------------------------------------------------------------
  const ds = resolveDropshipConfig(env);
  if (ds.enabled) add('ok', 'dropship', 'Dropship would start enabled (feature switch and identity checks pass).');
  else add(ds.cause === 'disabled' ? 'warn' : 'error', 'dropship', `Dropship would be off (${ds.cause}).`);

  return out;
}

export function formatFindings(findings: Finding[]): string {
  const tag = { error: 'ERROR', warn: 'WARN ', ok: 'OK   ' } as const;
  return findings.map(f => `${tag[f.severity]} [${f.check}] ${f.message}`).join('\n');
}
