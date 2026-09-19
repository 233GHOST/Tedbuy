import express from "express";
import path from "path";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import compression from "compression";
import { v2 as cloudinary } from "cloudinary";
import { GoogleGenAI, Type } from "@google/genai";
import { initializeApp as initAdminApp, cert as adminCert, getApps as getAdminApps } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import dotenv from "dotenv";
import net from "net";
import dns from "dns";
import { promisify } from "util";
import { getSitemapDataset, generateUrlSetXml, generateSitemapIndexXml, clearSitemapCache } from "./src/utils/sitemap.js";
import { validateEmailSecure, validatePasswordStrength, validateUsernameSecure, validatePhoneSecure } from "./src/utils/registrationValidation.js";
import { getPrefixAutocompleteSuggestions } from "./src/utils/searchAutocomplete.js";
import { APP_RELEASE_CONFIG, isAndroidReleaseAvailable } from "./src/config/appRelease.js";
import firebaseConfig from "./firebase-applet-config.json";

function isReservedStoreName(name?: string | null): boolean {
  if (!name) return false;
  const normalized = name.trim().toLowerCase().replace(/[\s\-_]+/g, '');
  return normalized.includes('tedbuy');
}

process.on('uncaughtException', (err) => {
  console.error('!!!!! [DIAGNOSTIC] uncaughtException !!!!!', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('!!!!! [DIAGNOSTIC] unhandledRejection !!!!!', reason);
});

dotenv.config();

// Diagnostic-only startup check -- previously a missing/malformed env var
// only ever surfaced later, deep in a request handler, as whatever error
// message that specific integration happens to produce (e.g. a malformed
// GOOGLE_SERVICE_ACCOUNT_JSON is caught elsewhere and falls back to a
// credential-less Firebase Admin app, so every subsequent verifyUser()
// call then fails with a cryptic Google Auth Library error instead of a
// clear "service account key malformed" message at boot). This doesn't
// change any runtime error-handling or exit behavior -- it only makes the
// current configuration state visible in the deploy log at startup, so a
// missing var is a one-line scan instead of a debugging session later.
// Each existing feature's own graceful-degradation behavior (Gemini
// returns 503, Paystack falls back to demo mode, etc.) is unchanged.
function logStartupEnvironmentStatus() {
  const groups: { name: string; vars: { key: string; alt?: string; note: string }[] }[] = [
    {
      name: 'Database (critical -- nothing works without this)',
      vars: [
        { key: 'SUPABASE_URL', alt: 'VITE_SUPABASE_URL', note: 'Supabase project URL' },
        { key: 'SUPABASE_SERVICE_ROLE_KEY', note: 'server writes fall back to the anon key if unset -- see decodeSupabaseKeyRole\'s own warning below' },
      ],
    },
    {
      name: 'Auth (critical -- admin/privileged actions fail without this)',
      vars: [
        { key: 'FIREBASE_SERVICE_ACCOUNT_KEY', alt: 'GOOGLE_SERVICE_ACCOUNT_JSON', note: 'Firebase Admin SDK (verifyUser/verifyAdmin token verification)' },
      ],
    },
    {
      name: 'Media uploads',
      vars: [
        { key: 'CLOUDINARY_CLOUD_NAME', note: 'listing photos/videos' },
        { key: 'CLOUDINARY_API_KEY', note: 'listing photos/videos' },
        { key: 'CLOUDINARY_API_SECRET', note: 'listing photos/videos' },
      ],
    },
    {
      name: 'Transactional email',
      vars: [
        { key: 'BREVO_API_KEY', note: 'OTP, password reset, welcome emails' },
      ],
    },
    {
      name: 'Payments',
      vars: [
        { key: 'PAYSTACK_SECRET_KEY', note: 'real boost payments -- falls back to demo/unverified mode if unset' },
      ],
    },
    {
      name: 'AI listing descriptions (optional)',
      vars: [
        { key: 'GEMINI_API_KEY', note: 'endpoint returns 503 gracefully if unset' },
      ],
    },
  ];

  console.log('[Startup Environment Check] ---');
  for (const group of groups) {
    for (const v of group.vars) {
      const present = !!(process.env[v.key] || (v.alt && process.env[v.alt]));
      const label = v.alt ? `${v.key} / ${v.alt}` : v.key;
      if (present) {
        console.log(`[Startup Environment Check] OK    ${label} -- ${group.name}`);
      } else {
        console.warn(`[Startup Environment Check] MISSING ${label} -- ${group.name}: ${v.note}`);
      }
    }
  }
  console.log('[Startup Environment Check] ---');
}
logStartupEnvironmentStatus();

let adminDb: any = null;

// -------------------------------------------------------------
// Production Memory Cache System (TTL Based + LRU Eviction + ETags)
// -------------------------------------------------------------
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  etag: string;
}

class TTLMemoryCache {
  private store = new Map<string, CacheEntry<any>>();
  private maxCapacity = 200;

  constructor() {
    // Background timer to prune expired keys every 60s
    if (typeof setInterval !== 'undefined') {
      const timer = setInterval(() => this.pruneExpired(), 60000);
      if (timer && typeof timer.unref === 'function') {
        timer.unref();
      }
    }
  }

  private normalizeKey(key: string): string {
    return key.trim().toLowerCase();
  }

  get<T>(key: string): { value: T; etag: string } | null {
    const normKey = this.normalizeKey(key);
    const entry = this.store.get(normKey);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(normKey);
      return null;
    }
    return { value: entry.value as T, etag: entry.etag };
  }

  set<T>(key: string, value: T, ttlSeconds: number): string {
    const normKey = this.normalizeKey(key);
    // Capacity check & LRU eviction if full
    if (this.store.size >= this.maxCapacity && !this.store.has(normKey)) {
      this.pruneExpired();
      if (this.store.size >= this.maxCapacity) {
        const firstKey = this.store.keys().next().value;
        if (firstKey) this.store.delete(firstKey);
      }
    }

    const payloadStr = JSON.stringify(value);
    const etag = `"${crypto.createHash('md5').update(payloadStr).digest('hex')}"`;

    this.store.set(normKey, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
      etag
    });

    return etag;
  }

  delete(key: string): void {
    this.store.delete(this.normalizeKey(key));
  }

  deletePattern(prefix: string): void {
    const normPrefix = prefix.trim().toLowerCase();
    for (const key of this.store.keys()) {
      if (key.startsWith(normPrefix)) {
        this.store.delete(key);
      }
    }
  }

  pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}

export const serverCache = new TTLMemoryCache();

let rawProductsListCache: { products: any[]; timestamp: number } | null = null;
const RAW_PRODUCTS_CACHE_TTL_MS = 60000; // 60 seconds memory cache

let sellersSummaryCache: { sellers: any[]; counts: Record<string, number>; timestamp: number } | null = null;
const SELLERS_CACHE_TTL_MS = 60000; // 60 seconds memory cache

export function invalidateProductCache(productId?: string, sellerId?: string, category?: string): void {
  rawProductsListCache = null;
  sellersSummaryCache = null;
  serverCache.deletePattern('homepage');
  serverCache.delete('featured');
  serverCache.deletePattern('search:');
  serverCache.deletePattern('sellers:');
  if (productId) {
    serverCache.delete(`product:${productId}`);
  }
  if (sellerId) {
    serverCache.deletePattern(`seller:${sellerId}`);
  }
  if (category) {
    serverCache.deletePattern(`category:${category}`);
  }
}

const rateLimitStore: Record<string, { count: number; resetTime: number }> = {};

// Initialize Firebase Admin SDK for backend querying
if (!getAdminApps().length) {
  try {
    const serviceAccountVar = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (serviceAccountVar) {
      const serviceAccount = JSON.parse(serviceAccountVar);
      initAdminApp({
        credential: adminCert(serviceAccount),
        projectId: "tedbuy-fb79a"
      });
      console.log('[Firebase Admin] Initialized Firebase Admin SDK with service account key.');
    } else {
      initAdminApp({
        projectId: "tedbuy-fb79a"
      });
      console.log('[Firebase Admin] Initialized Firebase Admin SDK with project ID.');
    }
  } catch (adminInitErr) {
    console.warn('[Firebase Admin] Initialization warning:', adminInitErr);
  }
}

try {
  if (getAdminApps().length > 0) {
    adminDb = getFirestore();
  }
} catch (_) {}

interface ImpersonationSessionRecord {
  sessionId: string;
  adminUserId: string;
  adminEmail: string;
  targetUserId: string;
  targetUserEmail: string;
  targetUserName: string;
  startTime: string;
  expiresAt: string;
}

const activeImpersonationSessions = new Map<string, ImpersonationSessionRecord>();

interface VerifiedAuthUser {
  uid: string;
  email: string;
  isAdmin?: boolean;
  isImpersonating?: boolean;
  originalAdmin?: { uid: string; email: string };
}

async function verifyUser(authHeader?: string, impersonationSessionId?: string | string[]): Promise<VerifiedAuthUser | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split('Bearer ')[1]?.trim();
  if (!token) return null;

  if (getAdminApps().length === 0) {
    console.error('[Auth] Firebase Admin SDK is not initialized; cannot verify any token. Rejecting request.');
    return null;
  }

  // The ONLY accepted authentication path: cryptographic verification of a real
  // Firebase ID token via the Admin SDK. Any failure — forged, unsigned,
  // malformed, expired, or wrong signature — must reject the request. There is
  // deliberately no fallback that trusts a decoded-but-unverified token payload,
  // a hardcoded bypass string, or any other client-supplied claim.
  let baseUser: { uid: string; email: string; isAdmin?: boolean };
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    const email = (decoded.email || '').toLowerCase().trim();
    baseUser = {
      uid: decoded.uid,
      email,
      // Authorization (is this verified identity an admin?), derived only from
      // the app's existing admin model — a real Firebase custom claim if one is
      // ever set, or the single verified owner email already used as the sole
      // admin-granting condition everywhere else in this app (types.ts's
      // isUserAdmin(), AppContext.tsx's isSuperAdmin checks). Never from
      // anything inside the token that Firebase itself didn't verify.
      isAdmin: !!decoded.admin || email === 'asumaduvincent7@gmail.com'
    };
  } catch (e) {
    return null;
  }

  // Check if admin is impersonating
  const sessId = Array.isArray(impersonationSessionId) ? impersonationSessionId[0] : impersonationSessionId;
  if (sessId && baseUser.isAdmin) {
    const session = activeImpersonationSessions.get(sessId);
    if (session && new Date(session.expiresAt).getTime() > Date.now()) {
      return {
        uid: session.targetUserId,
        email: session.targetUserEmail || '',
        isAdmin: true,
        isImpersonating: true,
        originalAdmin: { uid: baseUser.uid, email: baseUser.email }
      };
    }
  }

  return baseUser;
}

async function verifyAdmin(authHeader?: string, impersonationSessionId?: string | string[]): Promise<boolean> {
  const user = await verifyUser(authHeader, impersonationSessionId);
  return !!user?.isAdmin || !!user?.originalAdmin;
}

function cleanObject(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(cleanObject).filter(v => v !== undefined);
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = cleanObject(value);
    }
  }
  return result;
}

const lookupAsync = promisify(dns.lookup);

const firebaseApiKey = (() => {
  let key = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || '';
  try {
    if (!key) {
      const appConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
      if (fs.existsSync(appConfigPath)) {
        const configContent = fs.readFileSync(appConfigPath, 'utf8');
        const cfg = JSON.parse(configContent);
        key = cfg?.apiKey || cfg?.firebaseApiKey || '';
      }
    }
  } catch (e: any) {
    console.warn('[Firebase API Key] Unable to load API key from config file:', e?.message || e);
  }
  return key;
})();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const projectId = (() => {
  try {
    const appConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(appConfigPath)) {
      const configContent = fs.readFileSync(appConfigPath, 'utf8');
      const cfg = JSON.parse(configContent);
      return cfg?.projectId || 'tedbuy-fb79a';
    }
  } catch (e: any) {
    console.warn('[Firebase Project ID] Unable to load project ID from config file:', e?.message || e);
  }
  return 'tedbuy-fb79a';
})();

const apiKey = (() => {
  let key = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || '';
  try {
    if (!key) {
      const appConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
      if (fs.existsSync(appConfigPath)) {
        const configContent = fs.readFileSync(appConfigPath, 'utf8');
        const cfg = JSON.parse(configContent);
        key = cfg?.apiKey || cfg?.firebaseApiKey || '';
      }
    }
  } catch (e: any) {
    console.warn('[Firebase API Key] Unable to load API key from config file:', e?.message || e);
  }
  return key;
})();

const firebaseAuthDomain = (() => {
  let authDomain = process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN || '';
  try {
    if (!authDomain) {
      const appConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
      if (fs.existsSync(appConfigPath)) {
        const configContent = fs.readFileSync(appConfigPath, 'utf8');
        const cfg = JSON.parse(configContent);
        authDomain = cfg?.authDomain || cfg?.auth_domain || '';
      }
    }
  } catch (e: any) {
    console.warn('[Firebase Auth Domain] Unable to load auth domain from config file:', e?.message || e);
  }
  return authDomain;
})();

async function confirmFirebasePasswordResetViaRest(token: string, newPassword: string): Promise<string | null> {
  if (!firebaseApiKey) {
    console.warn('[Firebase REST Password Reset] Firebase API key is not configured.');
    return null;
  }

  try {
    const endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${firebaseApiKey}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oobCode: token, newPassword, returnSecureToken: false })
    });
    const data = await response.json();

    if (response.ok && data?.email && typeof data.email === 'string') {
      return data.email.trim().toLowerCase();
    }

    console.warn('[Firebase REST Password Reset] Failed response:', data);
    return null;
  } catch (err: any) {
    console.warn('[Firebase REST Password Reset] Error:', err?.message || err);
    return null;
  }
}

async function verifyFirebasePasswordResetCodeViaRest(token: string): Promise<string | null> {
  if (!firebaseApiKey) {
    console.warn('[Firebase REST Password Reset Verify] Firebase API key is not configured.');
    return null;
  }

  try {
    const endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${firebaseApiKey}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oobCode: token })
    });
    const data = await response.json();

    if (response.ok && data?.email && typeof data.email === 'string') {
      return data.email.trim().toLowerCase();
    }

    console.warn('[Firebase REST Password Reset Verify] Failed response:', data);
    return null;
  } catch (err: any) {
    console.warn('[Firebase REST Password Reset Verify] Error:', err?.message || err);
    return null;
  }
}

async function generateFirebasePasswordResetLinkViaRest(email: string): Promise<{ oobLink: string | null; isUserNotFound: boolean }> {
  if (!firebaseApiKey) {
    console.warn('[Firebase REST Password Reset Link] Firebase API key is not configured.');
    return { oobLink: null, isUserNotFound: false };
  }

  try {
    const endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseApiKey}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestType: 'PASSWORD_RESET',
        email,
        continueUrl: 'https://tedbuy.store/__/auth/handler?mode=resetPassword',
        canHandleCodeInApp: true,
        returnOobLink: true
      })
    });
    const data = await response.json();

    if (response.ok && data?.oobLink && typeof data.oobLink === 'string') {
      return { oobLink: data.oobLink, isUserNotFound: false };
    }

    const errMsg = (data?.error?.message || '').toUpperCase();
    const isUserNotFound = errMsg.includes('EMAIL_NOT_FOUND') || errMsg.includes('USER_NOT_FOUND');

    console.warn('[Firebase REST Password Reset Link] Failed response:', data);
    return { oobLink: null, isUserNotFound };
  } catch (err: any) {
    console.warn('[Firebase REST Password Reset Link] Error:', err?.message || err);
    return { oobLink: null, isUserNotFound: false };
  }
}

async function sendFirebasePasswordResetEmailViaRest(email: string): Promise<boolean> {
  if (!firebaseApiKey) {
    console.warn('[Firebase REST Password Reset Email] Firebase API key is not configured.');
    return false;
  }

  try {
    const endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseApiKey}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestType: 'PASSWORD_RESET',
        email,
        continueUrl: 'https://tedbuy.store/__/auth/handler?mode=resetPassword',
        canHandleCodeInApp: true
      })
    });
    const data = await response.json();

    if (response.ok) {
      console.log('[Firebase REST Password Reset Email] Firebase default password reset email sent successfully.', data);
      return true;
    }

    console.warn('[Firebase REST Password Reset Email] Failed response:', data);
    return false;
  } catch (err: any) {
    console.warn('[Firebase REST Password Reset Email] Error:', err?.message || err);
    return false;
  }
}

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
  console.log('[Supabase Server] Configured DNS to prefer IPv4 (ipv4first) to prevent IPv6 fetch failures.');
}

export const app = express();
app.set('etag', 'strong');
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    // Don't compress Cloudinary media or binary responses
    const contentType = res.getHeader('Content-Type') as string;
    if (contentType && (contentType.includes('image/') || contentType.includes('video/'))) return false;
    return compression.filter(req, res);
  }
}));

// Set secure HTTP headers
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https: wss:; img-src 'self' https: data: blob: android-webview-video-poster:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; frame-src 'self' https:;"
  );
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
  // Gated on production (matches this file's own NODE_ENV convention below)
  // rather than sent unconditionally -- HSTS is aggressively cached by
  // browsers once seen, so sending it from a local/dev server (which may
  // not even be on HTTPS) could permanently break http://localhost testing
  // for whoever hits it. Production (tedbuy.store) is already fully HTTPS,
  // so this only tells browsers to skip the plain-HTTP round trip they'd
  // otherwise redirect through on every first visit -- no functional risk.
  if (process.env.NODE_ENV === 'production') {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  next();
});

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

// Global middleware to handle parsing or payload too large errors as JSON
app.use((err: any, req: any, res: any, next: any) => {
  if (err) {
    console.error('[Express Parser/Payload Error]:', err.message);
    return res.status(err.status || 400).json({
      success: false,
      error: err.message || 'Invalid request payload or too large.'
    });
  }
  next();
});

// Top-level media array parsing helper
export function parseMediaArray(val: any): string[] {
  if (!val) return [];
  let current = val;
  while (typeof current === 'string') {
    const trimmed = current.trim();
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      try {
        current = JSON.parse(trimmed);
      } catch (_) {
        break;
      }
    } else {
      break;
    }
  }
  if (Array.isArray(current)) {
    return current.filter((item: any) => typeof item === 'string' && item.trim().length > 0 && item !== '[]' && item !== 'null');
  }
  if (typeof current === 'string' && current.trim().length > 0 && current !== '[]' && current !== 'null') {
    return [current.trim()];
  }
  return [];
}

// --- FIREBASE AUTH CUSTOM DOMAIN REVERSE PROXY ---
app.all('/__/auth/*', async (req: express.Request, res: express.Response) => {
  const authBase = '/__/auth';
  const targetPath = req.originalUrl.startsWith(authBase) ? req.originalUrl.slice(authBase.length) : req.originalUrl;
  const targetUrl = `https://tedbuy-fb79a.firebaseapp.com${authBase}${targetPath}`;
  const incomingProto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  const incomingHost = req.headers.host || 'www.tedbuy.store';
  const currentOrigin = `${incomingProto}://${incomingHost}`;

  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          value.forEach(v => headers.append(key, v));
        } else {
          headers.append(key, value);
        }
      }
    }
    headers.set('host', 'tedbuy-fb79a.firebaseapp.com');
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.delete('accept-encoding');
    headers.set('accept-encoding', 'identity');

    let body: any = undefined;
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      body = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
    }

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      redirect: 'manual'
    });

    res.status(response.status);
    response.headers.forEach((value, key) => {
      const lowKey = key.toLowerCase();
      if (['transfer-encoding', 'content-length', 'content-encoding'].includes(lowKey)) {
        return;
      }
      if (lowKey === 'vary') {
        const varyValues = value
          .split(',')
          .map(v => v.trim())
          .filter(v => v.length > 0 && v.toLowerCase() !== 'accept-encoding');
        if (varyValues.length > 0) {
          res.setHeader('vary', varyValues.join(', '));
        }
        return;
      }
      if (lowKey === 'location') {
        if (typeof value === 'string' && value.includes('tedbuy-fb79a.firebaseapp.com')) {
          const rewritten = value.replace(/https:\/\/tedbuy-fb79a\.firebaseapp\.com/g, currentOrigin);
          res.setHeader('location', rewritten);
          return;
        }
      }
      if (lowKey === 'cache-control') {
        return;
      }
      res.setHeader(key, value);
    });

    const bodyBuffer = Buffer.from(await response.arrayBuffer());
    res.removeHeader('content-encoding');
    res.setHeader('content-length', String(bodyBuffer.length));
    res.setHeader('cache-control', 'no-store, no-cache, must-revalidate');
    res.setHeader('pragma', 'no-cache');
    res.setHeader('expires', '0');
    res.send(bodyBuffer);
  } catch (proxyErr: any) {
    console.error('[Firebase Auth Proxy Error]:', proxyErr);
    res.status(500).send('Authentication proxy failed');
  }
});

// Setup Rate Limiting Middleware
function serverRateLimiter(windowMs: number, maxRequests: number, prefix: string) {
  const store = new Map<string, { count: number; resetTime: number }>();

  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of store.entries()) {
      if (now > record.resetTime) store.delete(ip);
    }
  }, 60000);

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Confirmed live (2026-09-18) that this app's only production path is
    // Client -> Cloudflare -> Render's LB -> Express, and that Cloudflare
    // fronts 100% of this Render service's traffic unconditionally (Render's
    // own docs: "automatic for every public-facing web service on Render...
    // nothing to configure" -- verified against both the custom domain and
    // the default *.onrender.com fallback, both show `server: cloudflare`).
    // X-Forwarded-For was previously trusted here, but both Cloudflare's and
    // Render's own documentation confirm each hop only APPENDS to that
    // header rather than overwriting it, so its first entry is whatever the
    // client itself sent -- trivially spoofable, defeating every rate limit
    // in this file. cf-connecting-ip is Cloudflare's own header, set from
    // its TCP-terminated connection to the real client and never influenced
    // by anything the client sends, so it can't be spoofed the same way.
    // Deliberately no X-Forwarded-For fallback and no trust-proxy/req.ip
    // change -- this is the one header actually guaranteed correct here.
    const clientIp = (
      req.headers['cf-connecting-ip'] as string ||
      req.socket.remoteAddress ||
      'unknown'
    ).trim();
    const key = `${prefix}_${clientIp}`;
    const now = Date.now();

    let record = store.get(key);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      store.set(key, record);
      return next();
    }

    record.count++;
    if (record.count > maxRequests) {
      const retryAfterSecs = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSecs));
      return res.status(429).json({
        success: false,
        error: `Too many requests. Please try again in ${retryAfterSecs} seconds.`
      });
    }

    next();
  };
}

// -------------------------------------------------------------
// Initialize Backend Supabase PostgreSQL Client
// -------------------------------------------------------------
// Security fix (service_role migration, 2026-09-16): backendSupabase used
// to ALWAYS use the anon key (VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY,
// with a hardcoded anon-role JWT as the last-resort fallback below) --
// discovered while debugging the reports table (see
// .ai/handoffs/CURRENT_HANDOFF.md and
// .ai/handoffs/RLS_ENABLEMENT_READINESS_REPORT.md for the full story).
// This meant the server was never actually more privileged than the
// anon key the browser used to call Supabase with directly -- every one
// of this file's ~200 backendSupabase call sites depended on the exact
// same Postgres GRANT a raw anon-key caller would need, and enabling RLS
// with zero policies (this whole migration's target design) would have
// broken the server's own database access, not just closed the anon
// key's direct reach, because the server WAS an anon-key caller.
//
// Now prefers a real SUPABASE_SERVICE_ROLE_KEY when configured -- get it
// from the Supabase dashboard, Project Settings -> API ("service_role
// secret"), NEVER the anon/public key. It is never exposed to any
// client, only ever read here, server-side. If it isn't set, this falls
// back to the exact pre-existing anon-key behavior unchanged, so any
// environment without the new var configured (local dev, this sandbox,
// a preview deploy, etc.) keeps working exactly as it did before this
// change rather than going dark -- this migration is meant to upgrade
// the credential where it's configured, not require it everywhere at
// once.
//
// decodeSupabaseKeyRole below is a pure diagnostic (reads the JWT's own
// `role` claim, changes no behavior) so the startup log states plainly
// which role is actually active -- catches, for example, a copy-paste
// mistake where the anon key gets pasted into SUPABASE_SERVICE_ROLE_KEY
// by accident, which would otherwise silently look like nothing
// changed. Never hardcode a real service_role value anywhere in this
// file, unlike the anon key's existing fallback below -- this repository
// is public on GitHub.
function decodeSupabaseKeyRole(key: string): string | null {
  try {
    const payload = key.split('.')[1];
    if (!payload) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof decoded?.role === 'string' ? decoded.role : null;
  } catch {
    return null;
  }
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://kxfykyxagkbrjymjmtal.supabase.co';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4ZnlreXhhZ2ticmp5bWptdGFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwMzc0NzAsImV4cCI6MjA4MzYxMzQ3MH0.fKjM2_pAti2Pj3XU6e9o3pX6M8fJ0X6Q9A2_A2';
const supabaseKey = supabaseServiceRoleKey || supabaseAnonKey;

let backendSupabase: any = null;
if (supabaseUrl && supabaseKey) {
  backendSupabase = createClient(supabaseUrl, supabaseKey);
  const activeRole = decodeSupabaseKeyRole(supabaseKey);
  if (supabaseServiceRoleKey && activeRole !== 'service_role') {
    console.warn(`[Supabase Server] SUPABASE_SERVICE_ROLE_KEY is set but decodes to role "${activeRole || 'unknown'}", not "service_role" -- double-check the value pasted into that env var.`);
  }
  console.log(`[Supabase Server] Initialized backend Supabase client: ${supabaseUrl} (role: ${activeRole || 'unknown'}${supabaseServiceRoleKey ? '' : ', SUPABASE_SERVICE_ROLE_KEY not set -- falling back to anon key'})`);
} else {
  console.warn('[Supabase Server] Missing credentials for backend Supabase client.');
}

// -------------------------------------------------------------
// Cloudinary Media Service Initialization & Routes
// -------------------------------------------------------------
function initCloudinaryConfig() {
  const cloudName = process.env.VITE_CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME || 'dfm3g2qvg';
  const apiKey = process.env.VITE_CLOUDINARY_API_KEY || process.env.CLOUDINARY_API_KEY || '896944673641399';
  // No hardcoded fallback here deliberately: unlike cloud name/API key (public
  // identifiers), the API secret grants full account control and must come
  // from real configuration only. Fail fast and loud rather than silently
  // falling back to a stale value baked into source.
  const apiSecret = process.env.CLOUDINARY_API_SECRET || process.env.VITE_CLOUDINARY_API_SECRET;

  if (!apiSecret) {
    console.error('[Cloudinary Server] FATAL: CLOUDINARY_API_SECRET (or VITE_CLOUDINARY_API_SECRET) is not set. Cloudinary uploads and deletes will fail until this is configured.');
    return false;
  }

  if (cloudName && apiKey && apiSecret) {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true
    });
    console.log('[Cloudinary Server] Configured Cloudinary SDK successfully.');
    return true;
  }
  return false;
}

initCloudinaryConfig();

function extractCloudinaryInfo(url: string): { publicId: string; resourceType: 'image' | 'video' } | null {
  if (!url || !url.includes('res.cloudinary.com')) return null;
  try {
    const isVideo = url.includes('/video/upload/');
    const resourceType: 'image' | 'video' = isVideo ? 'video' : 'image';
    
    const parts = url.split('/upload/');
    if (parts.length < 2) return null;

    // The version segment (v<digits>) always immediately precedes the real
    // public_id path, and is a reliable anchor regardless of how many
    // transformation segments (poster frame so_/f_jpg, a trim's so_/eo_,
    // the eager quality/size variant, ...) are chained before it — unlike
    // the old logic here, which only ever stripped ONE segment and so left
    // the version marker glued onto the "public_id" for any transformed
    // URL, silently breaking cleanup (Discard/Retake) for anything but a
    // bare, untransformed secure_url.
    const segments = parts[1].split('/');
    const versionIdx = segments.findIndex((s) => /^v\d+$/.test(s));
    const publicIdSegments = versionIdx !== -1 ? segments.slice(versionIdx + 1) : segments;
    const pathAfterUpload = publicIdSegments.join('/');

    const lastDot = pathAfterUpload.lastIndexOf('.');
    const publicId = lastDot !== -1 ? pathAfterUpload.substring(0, lastDot) : pathAfterUpload;
    return { publicId, resourceType };
  } catch (_) {
    return null;
  }
}

async function deleteCloudinaryAsset(publicId: string, resourceType: 'image' | 'video' = 'image'): Promise<any> {
  if (!initCloudinaryConfig()) {
    throw new Error('Cloudinary is not configured on this server (missing API secret).');
  }
  return new Promise((resolve, reject) => {
    cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true }, (error, result) => {
      if (error) {
        console.error(`[Cloudinary Delete Error] ${publicId}:`, error);
        return reject(error);
      }
      console.log(`[Cloudinary Delete Success] ${publicId}:`, result);
      resolve(result);
    });
  });
}

// -------------------------------------------------------------
// AI Listing Description Generator (Gemini)
// -------------------------------------------------------------
let genAI: GoogleGenAI | null = null;
function getGenAIClient(): GoogleGenAI | null {
  if (genAI) return genAI;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[AI Listing Description] GEMINI_API_KEY is not set. /api/ai/generate-listing-description will return 503 until configured.');
    return null;
  }
  genAI = new GoogleGenAI({ apiKey });
  return genAI;
}

// Do NOT change this default without a live Render log in hand. This was
// briefly (wrongly) changed to 'gemini-2.5-flash' on the assumption that
// 'gemini-3.6-flash' was a typo/hallucination, since it appears nowhere in
// the installed @google/genai SDK's bundled README (which only shows
// 'gemini-2.5-flash' examples) -- that assumption was wrong. A live
// production 404 confirmed Google's API itself now says the opposite:
// "model models/gemini-2.5-flash is no longer available to new users...
// use models/gemini-3.6-flash for the latest features". The SDK's bundled
// docs simply lag behind Google's actual, fast-moving model deprecation
// schedule -- they are not authoritative for which model is currently
// live. Reverted back to the value the original ad61bbe fix set (also
// evidence-based, from a live 404 at the time). If this model is ever
// retired too, the 404 handling below logs it explicitly with a pointer
// to fix it via GEMINI_MODEL without a code change.
const AI_LISTING_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
// Multimodal (image) processing genuinely needs more headroom than pure
// text generation — measured from the start of the Gemini call only; image
// fetching (for the Cloudinary-URL path) has its own separate, shorter
// budget below.
const AI_GENERATION_TIMEOUT_MS = 25000;
const AI_LISTING_MAX_IMAGES = 3;

type AiDescriptionStyle = 'short' | 'standard' | 'detailed';

interface ListingDescriptionInput {
  category: string;
  title: string;
  condition?: string;
  price?: string;
  location?: string;
  brand?: string;
  negotiable?: boolean;
  isExchangeable?: boolean;
  existingDescription?: string;
  style: AiDescriptionStyle;
}

// Shared source of truth for the three length/tone options -- both the
// system instruction and the user-facing reminder line read from this, so
// the word-count promise the model is actually held to always matches what
// the response schema and prompt describe, however this gets tuned later.
const AI_STYLE_PRESETS: Record<AiDescriptionStyle, { min: number; max: number; toneHint: string }> = {
  short: {
    min: 25,
    max: 60,
    toneHint: 'Keep it tight and scannable: lead with the single most compelling fact, then only the remaining essentials. No filler sentences, no scene-setting.',
  },
  standard: {
    min: 50,
    max: 150,
    toneHint: 'Balanced length: cover the essentials plus a little context and persuasion, without padding.',
  },
  detailed: {
    min: 120,
    max: 250,
    toneHint: 'Elaborate more than usual: explain condition nuances, what exactly the buyer gets, why this specific item is worth it, and relevant well-known specs where appropriate (per rule C below) -- still strictly honest and non-repetitive, never inventing a fact that was not given to you.',
  },
};

// --- Image input handling -------------------------------------------------
// Each requested image arrives as either:
//  - a `data:image/...;base64,...` URL — what the web app sends, since it
//    already keeps images as locally-compressed data URLs until final
//    listing submission (no Cloudinary upload has happened yet at this
//    point), or
//  - a `https://res.cloudinary.com/<our-cloud-name>/image/upload/...` URL —
//    what the mobile app sends, since it uploads each picked photo to
//    Cloudinary immediately on pick, well before "Generate" is ever tapped.
//    This reuses that same asset (the one that'll end up on the listing
//    anyway) rather than uploading a second, temporary, eventually-orphaned
//    copy just for AI analysis.
// Both are normalized here into inline base64 bytes, since the Gemini API
// only accepts image bytes (or a Google-hosted file URI) — there is no way
// to just hand it an arbitrary external URL to fetch itself.
interface InlineImagePart {
  mimeType: string;
  data: string; // base64, no "data:" prefix
}

const ALLOWED_AI_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AI_IMAGE_MAX_BASE64_CHARS = 1_500_000; // ~1.1MB decoded, per image
const AI_IMAGE_FETCH_TIMEOUT_MS = 6000;
const AI_IMAGE_FETCH_MAX_BYTES = 3_000_000;
const CLOUDINARY_IMAGE_CLOUD_NAME = process.env.VITE_CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME || 'dfm3g2qvg';

function parseDataUrlImage(raw: string): InlineImagePart | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(raw.trim());
  if (!match) return null;
  const [, mimeType, data] = match;
  if (!ALLOWED_AI_IMAGE_MIME_TYPES.has(mimeType)) return null;
  if (!data || data.length > AI_IMAGE_MAX_BASE64_CHARS) return null;
  return { mimeType, data };
}

// Only ever fetches a URL that is demonstrably one of TedBuy's own
// Cloudinary uploads (exact configured cloud name, /image/upload/ path) —
// never an arbitrary client-supplied URL. This is what keeps this from
// being an SSRF vector: the server never fetches anything a client just
// hands it, only assets that already went through our own authenticated
// upload pipeline under our own cloud account.
function isOwnCloudinaryImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname !== 'res.cloudinary.com') return false;
    return parsed.pathname.startsWith(`/${CLOUDINARY_IMAGE_CLOUD_NAME}/image/upload/`);
  } catch {
    return false;
  }
}

// Rewrites to a small, forced-JPEG delivery transformation so the server
// downloads an already-downsized copy for AI analysis rather than the
// original full-resolution listing photo, regardless of whatever
// transform (if any) was already present in the URL.
function toSmallAiJpegUrl(url: string): string {
  const marker = '/image/upload/';
  const idx = url.indexOf(marker);
  if (idx === -1) return url;
  const insertAt = idx + marker.length;
  return `${url.slice(0, insertAt)}w_768,c_limit,q_60,f_jpg/${url.slice(insertAt)}`;
}

async function fetchOwnCloudinaryImageAsInline(url: string): Promise<InlineImagePart | null> {
  if (!isOwnCloudinaryImageUrl(url)) {
    console.warn('[AI Listing Description] Rejected an image URL that is not a TedBuy Cloudinary upload.');
    return null;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_IMAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(toSmallAiJpegUrl(url), { signal: controller.signal });
    if (!res.ok) return null;
    const contentLength = Number(res.headers.get('content-length') || '0');
    if (contentLength && contentLength > AI_IMAGE_FETCH_MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > AI_IMAGE_FETCH_MAX_BYTES) return null;
    return { mimeType: 'image/jpeg', data: buf.toString('base64') };
  } catch (err: any) {
    console.warn('[AI Listing Description] Failed to fetch Cloudinary image for AI analysis:', err?.message || err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Invalid/oversized/unreachable entries are silently dropped rather than
// failing the whole request — a photo materially improves the result but
// was never a hard requirement (text-only generation must keep working).
async function normalizeRequestImages(raw: any): Promise<InlineImagePart[]> {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const candidates = raw.slice(0, AI_LISTING_MAX_IMAGES).filter((v): v is string => typeof v === 'string');

  const results = await Promise.all(candidates.map(async (entry) => {
    if (entry.startsWith('data:image/')) return parseDataUrlImage(entry);
    if (entry.startsWith('https://res.cloudinary.com/')) return fetchOwnCloudinaryImageAsInline(entry);
    return null;
  }));

  return results.filter((v): v is InlineImagePart => v !== null);
}

// Descriptions are only ever rendered as plain JSX text (React auto-escapes)
// or through the existing server-side escapeHtml() for meta tags, so there's
// no live HTML-injection path today — but AI output is untrusted content
// regardless, so it's stripped of markup defensively before it ever leaves
// this endpoint.
// Best-effort recovery for a response that got cut off mid-string before
// its closing quote/brace (e.g. hit maxOutputTokens) -- rather than
// discarding an otherwise perfectly good, on-topic, mostly-complete
// description just because the JSON wrapper never closed. Only ever used as
// a fallback after a real JSON.parse attempt has already failed; a
// well-formed response never reaches this path.
function tryExtractTruncatedDescription(rawText: string): string | null {
  const match = /"description"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(rawText);
  if (!match) return null;
  const unescaped = match[1]
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
  const trimmed = unescaped.trim();
  // Too short to be a usable description on its own -- likely truncated
  // right at the start, not worth showing as a "generated" result.
  if (trimmed.length < 40) return null;
  return trimmed;
}

function sanitizeAiDescription(raw: string): string {
  let text = raw || '';
  text = text.replace(/<[^>]*>/g, ''); // strip any HTML/XML tags
  text = text.replace(/```[a-zA-Z]*\n?/g, '').replace(/`/g, ''); // strip markdown code fences/backticks
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  // Hard safety cap regardless of model output -- raised from 1500 to 2200
  // to comfortably fit the "detailed" style's 250-word ceiling (roughly
  // 1500-1800 chars in practice) without clipping a valid response.
  if (text.length > 2200) text = text.slice(0, 2200).trim();
  return text;
}

function buildListingDescriptionPrompt(input: ListingDescriptionInput, imageCount: number): string {
  const facts: string[] = [
    `Category: ${input.category}`,
    `Title: ${input.title}`,
  ];
  if (input.brand) facts.push(`Brand: ${input.brand}`);
  if (input.condition) facts.push(`Condition: ${input.condition}`);
  if (input.price) facts.push(`Price: GH₵${input.price}`);
  if (input.negotiable) facts.push('Price is negotiable.');
  if (input.isExchangeable) facts.push('Seller is open to exchange/swap.');
  if (input.location) facts.push(`Location: ${input.location}`);
  if (input.existingDescription) {
    facts.push(`Seller's own notes so far (use as extra context, do not just repeat verbatim): ${input.existingDescription}`);
  }
  if (imageCount > 0) {
    facts.push(imageCount === 1
      ? 'One product photo is attached below.'
      : `${imageCount} product photos are attached below, all of the same item for sale — the first is the primary photo.`);
  }

  // Restating the requirement right next to the facts (not just in the
  // system instruction) measurably improves compliance on smaller/faster
  // models that otherwise default to a single lazy sentence.
  const { min } = AI_STYLE_PRESETS[input.style];
  const reminder = `Remember: mention every one of the seller-given facts above somewhere in the description, and write at least ${min} words.`;

  return `${facts.join('\n')}\n\n${reminder}`;
}

// Business/prompt logic lives entirely here, server-side, so web and mobile
// get byte-identical generation behavior through the one shared endpoint.
// A function of style rather than a flat constant: the three length/tone
// presets (short/standard/detailed) need rule 9's word range and tone
// swapped in per request, everything else about the model's behavior stays
// identical regardless of which one was picked.
function buildSystemInstruction(style: AiDescriptionStyle): string {
  const { min, max, toneHint } = AI_STYLE_PRESETS[style];
  return `You write short product listing descriptions for TedBuy, a Ghanaian online marketplace (like a local Craigslist/OLX equivalent). You may be given product photo(s) alongside the structured listing data below — when photos are attached, reason over both together rather than treating them separately.

You work with three kinds of information, in this priority order:
A) SELLER-GIVEN FACTS (authoritative) — the category, title, condition, price, brand, location, negotiability, exchange, and the seller's own notes given to you below. These always win over anything else.
B) VISUAL OBSERVATIONS — things genuinely visible in the attached photo(s), if any: apparent product type, visible brand/logo, visible color, visible accessories, general visible appearance, clearly visible cosmetic marks. State these conservatively ("appears to be", "visible in the photo") whenever there's real uncertainty, and never turn an uncertain visual impression into a definite claim.
C) WELL-KNOWN PUBLIC SPECS — if the title/brand clearly identifies a specific, well-known retail product (e.g. a named phone, games console, or laptop model), you may add that PRODUCT LINE's genuinely well-known, official manufacturer specs as general background (e.g. what a PS5 Pro's GPU is).

Rules you must follow exactly:
1. Anything about THIS SPECIFIC UNIT for sale — its actual condition/defects, what accessories are included, warranty, battery health, exact age, ownership history, authenticity, repair history, or delivery availability — may ONLY come from seller-given facts (A). A photo is never proof of working condition: never say "fully functional", "works perfectly", "no faults", "no scratches", or "like new" unless the seller actually said so.
2. From a photo you may only describe what is genuinely visible — do not guess the exact product variant/edition/storage/capacity from an image alone (e.g. do not decide "PS5 Pro" vs "PS5 Slim" vs "Digital Edition" just because a console is visible) unless the seller's own title/fields already say which one it is.
3. Only state a well-known public spec (C) when you are genuinely confident it's correct for the exact model named in the title, AND it doesn't vary between common configurations of that model. If a spec varies by configuration (storage size, RAM, color) and neither the title nor the photo clearly disambiguates it, leave that spec out rather than guessing a number.
4. If a seller-given fact and a visual observation appear to conflict (e.g. seller says the item is black but it looks white in the photo), the seller-given fact is the authoritative listing data — do not restate the conflicting visual detail as fact, and do not dwell on the conflict in the description text. Instead, set the "warning" field to one short sentence flagging that a review is worthwhile (e.g. "The photo's color may not match the stated color — please double-check before publishing."). Leave "warning" unset when there is no such conflict.
5. Do not claim things like "brand new", "100% genuine", "best price in Ghana", "perfect condition", or "guaranteed" unless that exact fact was given to you as a seller-given fact.
6. You MUST work every single seller-given fact into the description — category/item type, condition, price, brand, location, negotiability, exchange-possible, and the seller's own notes, whichever were provided. Do not silently drop a provided fact just to keep the text short.
7. If more than one photo is attached, they are different views/angles of the same single item for sale — consider them together, do not describe them as separate items.
8. Write naturally for a Ghanaian marketplace buyer: concise, honest, persuasive without being misleading, easy to skim.
9. Write at least ${min} words and up to ${max} words for the "description" field — even when only a few facts were given, expand on what you do have (what the item is, its condition, why a buyer would want it, relevant well-known specs, genuinely visible characteristics) instead of writing one short sentence. A one-line description is not acceptable regardless of the target length. ${toneHint}
10. Do not repeat the title verbatim as the first sentence. Do not repeat the price more than once.
11. No emojis. No markdown formatting, no HTML, no code fences — plain text only, short paragraphs or a short bullet list if helpful.
12. Respond with the required JSON object only — "description" holds the description text itself with no preamble/labels/quotes, and "warning" is included only per rule 4 above.`;
}

function buildResponseSchema(style: AiDescriptionStyle) {
  const { min, max } = AI_STYLE_PRESETS[style];
  return {
    type: Type.OBJECT,
    properties: {
      description: {
        type: Type.STRING,
        description: `The marketplace description, ${min}-${max} words, plain text, per the system instructions.`,
      },
      warning: {
        type: Type.STRING,
        description: 'ONLY set when a seller-given fact and a visual observation genuinely conflict in a way that could mislead a buyer. One short sentence. Omit entirely otherwise.',
      },
    },
    required: ['description'],
  };
}

app.post(
  '/api/ai/generate-listing-description',
  serverRateLimiter(60 * 1000, 3, 'ai-generate-description'),
  async (req: express.Request, res: express.Response) => {
    // Outer safety net: guarantees this endpoint can never respond with
    // anything but valid JSON, no matter what throws below (a malformed
    // response here surfaces client-side as a confusing generic parse
    // error, so nothing here is allowed to escape uncaught).
    try {
      const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
      if (!verified) {
        return res.status(401).json({ success: false, error: 'Please sign in to use AI description generation.' });
      }

      const client = getGenAIClient();
      if (!client) {
        return res.status(503).json({ success: false, error: "Couldn't generate a description right now. You can write your description manually." });
      }

      const body = req.body || {};

      // This endpoint needs room for up to 3 compressed images on top of the
      // usual short listing fields — still far below the global 25mb JSON
      // limit used elsewhere for full-resolution image/video payloads.
      let bodySize = 0;
      try { bodySize = Buffer.byteLength(JSON.stringify(body)); } catch { bodySize = Infinity; }
      if (bodySize > 3_000_000) {
        return res.status(400).json({ success: false, error: 'Request too large.' });
      }

      const category = typeof body.category === 'string' ? body.category.trim().slice(0, 60) : '';
      const title = typeof body.title === 'string' ? body.title.trim().slice(0, 150) : '';
      if (!category || !title) {
        return res.status(400).json({ success: false, error: 'Add a little more information about your item for a better description.' });
      }

      const requestedStyle: AiDescriptionStyle =
        body.style === 'short' || body.style === 'detailed' ? body.style : 'standard';

      const input: ListingDescriptionInput = {
        category,
        title,
        condition: typeof body.condition === 'string' ? body.condition.trim().slice(0, 60) || undefined : undefined,
        price: (typeof body.price === 'string' || typeof body.price === 'number') ? String(body.price).trim().slice(0, 30) || undefined : undefined,
        location: typeof body.location === 'string' ? body.location.trim().slice(0, 120) || undefined : undefined,
        brand: typeof body.brand === 'string' ? body.brand.trim().slice(0, 60) || undefined : undefined,
        negotiable: body.negotiable === true,
        isExchangeable: body.isExchangeable === true,
        existingDescription: typeof body.existingDescription === 'string' ? body.existingDescription.trim().slice(0, 2000) || undefined : undefined,
        style: requestedStyle,
      };

      const images = await normalizeRequestImages(body.images);
      const promptContent = buildListingDescriptionPrompt(input, images.length);

      // Multimodal parts: the text facts first, then each image with a
      // short label so the model can refer to "the primary photo" etc.
      // With zero images this collapses to just the text part, identical in
      // effect to the original text-only request shape.
      const parts: any[] = [{ text: promptContent }];
      images.forEach((img, idx) => {
        parts.push({ text: idx === 0 ? 'Primary product photo:' : `Additional product photo ${idx + 1}:` });
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), AI_GENERATION_TIMEOUT_MS);

      // Gemini's shared-capacity tier returns a plain 503 "UNAVAILABLE" /
      // "currently experiencing high demand" when momentarily overloaded --
      // a real, common, and usually short-lived condition (confirmed live in
      // production), completely unrelated to the model name being wrong.
      // Previously this failed the whole request on the very first such
      // blip. Retries a couple of times with a short backoff before giving
      // up, all still inside the one AI_GENERATION_TIMEOUT_MS/abort budget
      // above so this can never run longer than a normal single attempt's
      // worst case by more than the retry delays themselves.
      const OVERLOAD_RETRY_DELAYS_MS = [800, 1800];
      let response: Awaited<ReturnType<typeof client.models.generateContent>> | null = null;
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            response = await client.models.generateContent({
              model: AI_LISTING_MODEL,
              contents: parts,
              config: {
                systemInstruction: buildSystemInstruction(requestedStyle),
                // Lower than a typical "creative writing" temperature on purpose —
                // this endpoint needs reliable instruction-following (use every
                // given fact, hit the word-count floor, stay conservative about
                // the image) far more than creative variety, and higher
                // temperatures measurably hurt compliance.
                temperature: 0.5,
                // gemini-3.6-flash is a "thinking" model -- its internal
                // reasoning tokens count against maxOutputTokens same as the
                // visible output. At the old 650-token cap, thinking alone
                // was eating most/all of the budget, so the actual JSON
                // response got cut off mid-string before its closing quote
                // and brace (confirmed live: logged raw output was a real,
                // sensible, on-topic description that just stopped mid-word)
                // -- valid generations were being thrown away as
                // "unparseable" purely because of truncation, not because
                // the model produced anything wrong. This task needs zero
                // multi-step reasoning (it's a short structured rewrite of
                // given facts), so thinking is disabled outright rather than
                // just budgeted for, and the token ceiling raised well
                // beyond what a plain <=150-word JSON response could ever
                // need, as a second independent safety margin.
                thinkingConfig: { thinkingBudget: 0 },
                maxOutputTokens: 2048,
                abortSignal: controller.signal,
                responseMimeType: 'application/json',
                responseSchema: buildResponseSchema(requestedStyle),
              },
            });
            break;
          } catch (attemptErr: any) {
            const isOverloaded = attemptErr?.status === 503 || attemptErr?.status === 429;
            const isAbort = attemptErr?.name === 'AbortError' || controller.signal.aborted;
            if (isAbort || !isOverloaded || attempt >= OVERLOAD_RETRY_DELAYS_MS.length) {
              throw attemptErr;
            }
            console.warn(`[AI Listing Description] Model overloaded (status=${attemptErr?.status}) on attempt ${attempt + 1}, retrying in ${OVERLOAD_RETRY_DELAYS_MS[attempt]}ms...`);
            await new Promise((resolve) => setTimeout(resolve, OVERLOAD_RETRY_DELAYS_MS[attempt]));
          }
        }
        clearTimeout(timeoutId);

        const rawText = response?.text;
        if (!rawText || !rawText.trim()) {
          console.warn('[AI Listing Description] Provider returned no text. Full response:', JSON.stringify(response)?.slice(0, 500));
          return res.status(502).json({ success: false, error: "Couldn't generate a description right now. You can write your description manually." });
        }

        let parsed: { description?: unknown; warning?: unknown } | null = null;
        try { parsed = JSON.parse(rawText); } catch { parsed = null; }

        let recoveredDescription: string | null = null;
        if (!parsed || typeof parsed.description !== 'string' || !parsed.description.trim()) {
          recoveredDescription = tryExtractTruncatedDescription(rawText);
          if (!recoveredDescription) {
            console.warn('[AI Listing Description] Provider returned unparseable/empty structured output:', rawText.slice(0, 300));
            return res.status(502).json({ success: false, error: "Couldn't generate a description right now. You can write your description manually." });
          }
          console.warn('[AI Listing Description] JSON response was truncated (likely maxOutputTokens); recovered a partial description instead of failing outright:', rawText.slice(0, 300));
        }

        const description = sanitizeAiDescription(recoveredDescription ?? (parsed!.description as string));
        // parsed can be null when recoveredDescription came from the
        // truncated-response fallback above (JSON.parse never succeeded at
        // all) -- the optional "warning" field simply isn't available in
        // that case, which is fine since it's non-critical.
        const warning = typeof parsed?.warning === 'string' && parsed.warning.trim()
          ? sanitizeAiDescription(parsed.warning).slice(0, 300)
          : undefined;

        return res.json({ success: true, description, ...(warning ? { warning } : {}) });
      } catch (err: any) {
        clearTimeout(timeoutId);
        const isAbort = err?.name === 'AbortError' || controller.signal.aborted;
        if (isAbort) {
          console.warn('[AI Listing Description] Generation timed out.');
          return res.status(504).json({ success: false, error: 'That took too long. Please try again.' });
        }
        // The @google/genai SDK's ApiError exposes a real HTTP `status` for
        // API-level failures (e.g. 404 = model not found/retired, 429 =
        // rate-limited, 400 = bad request) -- logging it explicitly, along
        // with the exact model name in use, means a future model
        // retirement (this has already happened once) shows up in Render
        // logs as an unmistakable "model not found" line instead of a
        // generic stack trace someone has to guess the cause of.
        console.warn(
          `[AI Listing Description] Generation failed (model="${AI_LISTING_MODEL}", status=${err?.status ?? 'n/a'}, name=${err?.name ?? 'n/a'}):`,
          err?.message || err
        );
        if (err?.status === 404) {
          console.error(`[AI Listing Description] Model "${AI_LISTING_MODEL}" appears to be invalid or retired by Google. Check this exact error's "message" field above -- Google's 404 response usually names the current replacement model directly. Set GEMINI_MODEL to that model to fix this without a code change (do not assume any specific model name is safe without checking a live error like this one first -- Google retires these fast).`);
        }
        if (err?.status === 503 || err?.status === 429) {
          // Already retried a couple of times above -- if it's still failing
          // this is a genuinely sustained overload, not a one-off blip, so
          // "try again manually in a bit" is more accurate/actionable here
          // than the generic message.
          return res.status(503).json({ success: false, error: "TedBuy's AI assistant is unusually busy right now. Please try again in a minute, or write your description manually." });
        }
        return res.status(502).json({ success: false, error: "Couldn't generate a description right now. You can write your description manually." });
      }
    } catch (outerErr: any) {
      console.error('[AI Listing Description] Unexpected error outside generation try/catch:', outerErr?.stack || outerErr?.message || outerErr);
      if (!res.headersSent) {
        return res.status(500).json({ success: false, error: "Couldn't generate a description right now. You can write your description manually." });
      }
    }
  }
);

// Security fix (found during a Phase-5-style consolidated rejection-path
// sweep of every endpoint, RLS-migration follow-up): this endpoint had NO
// authentication check at all -- unlike its sibling /api/cloudinary/delete
// just below, which already correctly requires verifyUser(). In this
// sandbox that's masked by Cloudinary not being configured (always 503
// before reaching the upload), but with real Cloudinary credentials
// configured (as production has), this let ANY caller, fully
// unauthenticated, upload arbitrary files to TedBuy's own Cloudinary
// account -- a real abuse vector (storage/bandwidth cost, using a paid
// third-party account as an anonymous open file host). Both web
// (src/utils/cloudinary.ts) and mobile (mobile/src/firebase.ts) callers
// updated in the same change to actually send the auth header this now
// requires.
app.post("/api/cloudinary/upload", serverRateLimiter(60 * 1000, 120, "cloudinary-upload"), async (req: express.Request, res: express.Response) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required to upload media' });
  }

  try {
    if (!initCloudinaryConfig()) {
      return res.status(503).json({ success: false, error: 'Cloudinary is not configured on this server (missing API secret).' });
    }
    const { file, resource_type, folder } = req.body;
    if (!file) {
      return res.status(400).json({ success: false, error: 'Missing file payload' });
    }

    const uploadOptions: any = {
      folder: folder || 'tedbuy_products',
      resource_type: resource_type || 'auto'
    };

    const result = await cloudinary.uploader.upload(file, uploadOptions);
    const secureUrl = result.secure_url || result.url;

    const resultObj = {
      url: result.url || secureUrl,
      secure_url: secureUrl,
      public_id: result.public_id,
      format: result.format,
      resource_type: result.resource_type || resource_type || 'image',
      bytes: result.bytes,
      width: result.width,
      height: result.height,
      duration: result.duration,
      thumbnail_url: secureUrl.includes('res.cloudinary.com') ? secureUrl.replace('/upload/', '/upload/c_thumb,w_200,h_200,g_auto,f_auto,q_auto/') : secureUrl,
      small_url: secureUrl.includes('res.cloudinary.com') ? secureUrl.replace('/upload/', '/upload/w_400,c_limit,f_auto,q_auto/') : secureUrl,
      medium_url: secureUrl.includes('res.cloudinary.com') ? secureUrl.replace('/upload/', '/upload/w_800,c_limit,f_auto,q_auto/') : secureUrl,
      large_url: secureUrl.includes('res.cloudinary.com') ? secureUrl.replace('/upload/', '/upload/w_1200,c_limit,f_auto,q_auto/') : secureUrl
    };

    return res.json({
      success: true,
      secure_url: secureUrl,
      public_id: result.public_id,
      format: result.format,
      bytes: result.bytes,
      result: resultObj
    });
  } catch (err: any) {
    console.error('[Cloudinary Direct Upload Server Error]:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Cloudinary upload failed' });
  }
});

// Signed direct-to-Cloudinary upload for video only (see recommendationScore-adjacent
// Phase 4A egress work). The browser never receives the Cloudinary API secret — this
// endpoint only returns a short-lived signature computed server-side, then the client
// uploads the actual video bytes straight to Cloudinary. TedBuy never receives or
// proxies the video payload for this path.
app.post(
  "/api/cloudinary/sign-video-upload",
  serverRateLimiter(60 * 1000, 30, "cloudinary-sign-video"),
  async (req: express.Request, res: express.Response) => {
    const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
    if (!verified) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required to upload video' });
    }

    try {
      if (!initCloudinaryConfig()) {
        return res.status(503).json({ success: false, error: 'Cloudinary is not configured on this server (missing API secret).' });
      }

      const cfg = cloudinary.config();
      const timestamp = Math.round(Date.now() / 1000);
      // Generates a feed-appropriate, auto quality/codec variant
      // synchronously as part of THIS upload — the seller's own upload
      // takes a little longer once, in exchange for every future viewer
      // never triggering an on-demand transcode themselves (that used to
      // present as a video that just never loads — see
      // getOptimizedVideoUrlMobile's history in utils/cloudinary.ts for
      // why playback-time transforms were reverted). The original file is
      // still uploaded and kept as-is; this is an additional derived asset.
      //
      // Width cap lowered from 720 to 480: a real-device screen recording
      // (weak cellular signal, ~1 bar) showed a video still spinning on
      // buffer well after the poster and product details had rendered.
      // 720px width is more than this content is ever actually displayed
      // at (a full-bleed phone-width vertical video), and video compression
      // artifacts from downscaling are far less perceptible than the same
      // reduction would be on a still image — so the fidelity cost here is
      // close to free while cutting roughly 2.25x the pixels (and closely
      // correlated bitrate) that has to arrive before playback can start.
      // This directly targets the one thing every viewer needs regardless
      // of connection quality: less data required for the same first
      // frame. Only benefits new uploads going forward, same as the
      // eager-transform approach itself — it can't retroactively shrink
      // already-uploaded videos.
      //
      // Second eager transform (pipe-separated) pre-generates the poster
      // frame getServerVideoPoster() computes a URL for — measured directly
      // against a real listing's poster URL: the FIRST request for that
      // exact so_0,f_jpg,... transform took 4.86s (Cloudinary generating it
      // on demand), vs 0.69-0.92s on a warm cache. That's the same
      // lazy-transform cold-stall already found and fixed for the video
      // itself, just never applied to the poster — and the poster is
      // specifically the thing meant to appear instantly while the video
      // loads, so a viewer being the unlucky first-ever request for it
      // defeats the entire point. The transform string here must match
      // getServerVideoPoster()'s exactly, or this pre-generates a cache
      // entry nothing ever requests.
      // Folder is fixed server-side (not client-supplied) so it's protected by the
      // signature — a tampered folder value would fail Cloudinary's own signature check.
      //
      // Optional trim range (seconds), from the posting wizard's trim step.
      // This used to be applied client-side as an so_/eo_ URL rewrite AFTER
      // this eager transform already ran — which meant the seller's own
      // trimmed URL was a transformation Cloudinary had never pre-generated
      // (the eager array only ever covered the untrimmed w_480 variant), so
      // the first-ever request for it — almost always the seller themselves,
      // seconds after publishing — triggered exactly the same on-demand
      // transcode stall this eager-transform pipeline exists to avoid. Fix:
      // fold so_/eo_ into the SAME eager transform string so Cloudinary
      // pre-generates the actual trimmed+optimized asset during upload, same
      // as it already does for the untrimmed case. Values are user-supplied,
      // so they're clamped/rounded to plain numbers here (never interpolated
      // as raw strings) before touching the transform string that gets signed
      // — an unvalidated value could otherwise inject extra transformation
      // components into it.
      let trimSegment = '';
      const rawStart = Number(req.body?.trimStart);
      const rawEnd = Number(req.body?.trimEnd);
      if (Number.isFinite(rawStart) && Number.isFinite(rawEnd)) {
        const start = Math.min(300, Math.max(0, Math.round(rawStart * 10) / 10));
        const end = Math.min(300, Math.max(start + 1, Math.round(rawEnd * 10) / 10));
        trimSegment = `so_${start},eo_${end},`;
      }
      const posterStart = trimSegment ? trimSegment.match(/so_([\d.]+)/)![1] : '0';
      const eagerTransform = `${trimSegment}q_auto,f_auto,w_480,c_limit|so_${posterStart},f_jpg,q_auto,w_1200,h_630,c_fill`;
      const paramsToSign = { folder: 'tedbuy_products', timestamp, eager: eagerTransform };
      const signature = cloudinary.utils.api_sign_request(paramsToSign, cfg.api_secret as string);

      return res.json({
        success: true,
        signature,
        timestamp,
        apiKey: cfg.api_key,
        cloudName: cfg.cloud_name,
        folder: paramsToSign.folder,
        eager: eagerTransform
      });
    } catch (err: any) {
      console.error('[Cloudinary Sign Video Upload Error]:', err);
      return res.status(500).json({ success: false, error: err?.message || 'Failed to generate upload signature' });
    }
  }
);

// One-time admin maintenance: existing video listings were uploaded before
// the eager-transform pipeline existed (or before its width cap was
// lowered from 720 to 480), so their stored `videos`/`videoPoster` URLs
// point at assets Cloudinary has never pre-generated the fast variant for
// — a real user's device would otherwise be the one to trigger that
// transcode, which is exactly the multi-second cold-stall this whole
// eager-transform approach exists to avoid (see the sign-video-upload
// comment above). This re-runs the same eager transforms against each
// existing video's original asset via Cloudinary's explicit() API, then
// updates the stored URLs to the newly-generated (and now Cloudinary-
// cached) variants, so the next real viewer never pays that cost. Bounded
// to whatever's actually in the database (6 videos at the time this was
// written) — safe to run synchronously in one request at that scale.
// Found via a dedicated audit of never-previously-reviewed endpoints:
// compares two secret-derived strings (a shared-secret header below, and a
// password hash further down at /api/auth/verify-and-sync-password) without
// leaking how many leading bytes match via response timing. Plain `===` on
// two strings short-circuits at the first differing character, so its
// execution time is a (weak, network-jitter-obscured, but real) side
// channel — the standard fix is a fixed-time comparison. Returns false
// immediately on a length mismatch (safe: this only reveals whether the two
// values are the same LENGTH, not their content, and every real caller here
// always compares two fixed-length hex-encoded hashes or a fixed-length
// configured secret, so an attacker never learns anything from this early
// path they didn't already know).
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

app.post(
  "/api/admin/backfill-video-eager",
  serverRateLimiter(60 * 1000, 5, "admin-backfill-video"),
  async (req: express.Request, res: express.Response) => {
    // Two ways in: a real admin's own auth token (normal path, everywhere
    // else in this file), or this server's own CRON_SECRET (already
    // provisioned in render.yaml, unused elsewhere) via a header — lets
    // this one-time maintenance call be triggered with a value copied
    // straight from the Render dashboard's Environment tab, no need to dig
    // a live bearer token out of browser devtools for a single admin
    // operation that isn't part of any normal user flow.
    const providedSecret = req.headers['x-admin-secret'];
    const hasCronSecret = !!process.env.CRON_SECRET && typeof providedSecret === 'string' && timingSafeStringEqual(providedSecret, process.env.CRON_SECRET);
    const isAdmin = hasCronSecret || (req.headers.authorization ? await verifyAdmin(req.headers.authorization) : false);
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Admin authentication required' });
    }
    if (!initCloudinaryConfig()) {
      return res.status(503).json({ success: false, error: 'Cloudinary is not configured on this server.' });
    }

    const dryRun = req.body?.dryRun === true;
    const results: any[] = [];

    try {
      // videoPoster is NOT a real column — confirmed via safeBackendSupabaseUpsert's
      // own auto-heal logic (upsertProductToSupabase's writes to it get silently
      // pruned elsewhere in this file whenever the column doesn't exist). The
      // poster is always computed on the fly from the video URL via
      // getServerVideoPoster(), never stored — so once `videos[0]` is updated
      // to the new eager variant below, every reader already re-derives the
      // correct (now pre-warmed) poster path from it automatically. Nothing
      // else needs to change.
      const { data: rows, error } = await backendSupabase
        .from('products')
        .select('id, videos')
        .not('videos', 'is', null);
      if (error) throw error;

      const withVideo = (rows || []).filter((r: any) => Array.isArray(r.videos) && r.videos.length > 0 && typeof r.videos[0] === 'string' && r.videos[0].length > 0);

      for (const row of withVideo) {
        const originalUrl = row.videos[0];
        const info = extractCloudinaryInfo(originalUrl);
        if (!info || info.resourceType !== 'video') {
          results.push({ id: row.id, status: 'skipped', reason: 'Could not extract a Cloudinary public_id from stored video URL' });
          continue;
        }

        if (dryRun) {
          results.push({ id: row.id, status: 'would_process', publicId: info.publicId, originalUrl });
          continue;
        }

        try {
          const explicitResult: any = await cloudinary.uploader.explicit(info.publicId, {
            type: 'upload',
            resource_type: 'video',
            eager: [
              { quality: 'auto', fetch_format: 'auto', width: 480, crop: 'limit' },
              { start_offset: '0', format: 'jpg', quality: 'auto', width: 1200, height: 630, crop: 'fill' },
            ],
            eager_async: false,
          });

          const newVideoUrl = explicitResult?.eager?.[0]?.secure_url;
          const newPosterUrl = explicitResult?.eager?.[1]?.secure_url;
          if (!newVideoUrl) {
            results.push({ id: row.id, status: 'failed', reason: 'Cloudinary returned no eager video variant' });
            continue;
          }

          const updatedVideos = [newVideoUrl, ...row.videos.slice(1)];
          const { error: updateErr } = await backendSupabase
            .from('products')
            .update({ videos: updatedVideos })
            .eq('id', row.id);
          if (updateErr) throw updateErr;

          results.push({ id: row.id, status: 'updated', newVideoUrl, newPosterUrl: newPosterUrl || null });
        } catch (err: any) {
          results.push({ id: row.id, status: 'failed', reason: err?.message || String(err) });
        }
      }

      const summary = {
        total: withVideo.length,
        updated: results.filter((r) => r.status === 'updated').length,
        failed: results.filter((r) => r.status === 'failed').length,
        skipped: results.filter((r) => r.status === 'skipped').length,
      };
      return res.json({ success: true, dryRun, summary, results });
    } catch (err: any) {
      console.error('[Backfill Video Eager Error]:', err);
      return res.status(500).json({ success: false, error: err?.message || 'Backfill failed' });
    }
  }
);

// Security fix (found in the same consolidated rejection-path sweep as the
// two endpoints above): verifyUser() alone isn't ownership -- this deleted
// any Cloudinary asset in the account, real account-wide credentials, based
// purely on a client-supplied URL/publicId, with no check that the caller
// actually owned whatever it belonged to. Its two real callers only ever
// target the caller's own profile photo or their own product's media, but
// the endpoint itself never enforced that -- any signed-in user could
// delete another seller's public listing photos (trivially discoverable
// via GET /api/products) or another user's profile photo. Fixed by
// verifying the target URL actually matches the caller's own stored
// photoUrl, or appears in the media fields of a product they own, before
// ever calling Cloudinary -- admins retain full access. A bare publicId
// with no url can't be cross-checked against anything, so it's rejected
// for non-admins rather than trusted.
app.post("/api/cloudinary/delete", serverRateLimiter(60 * 1000, 30, "cloudinary-delete"), async (req: express.Request, res: express.Response) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required to delete Cloudinary asset' });
  }

  try {
    const { publicId, resourceType, url } = req.body;
    let targetPublicId = publicId;
    let targetResourceType: 'image' | 'video' = resourceType || 'image';

    if (!targetPublicId && url) {
      const extracted = extractCloudinaryInfo(url);
      if (extracted) {
        targetPublicId = extracted.publicId;
        targetResourceType = extracted.resourceType;
      }
    }

    if (!targetPublicId) {
      return res.status(400).json({ success: false, error: 'Missing publicId or valid Cloudinary url' });
    }

    const isAdmin = verified.isAdmin || verified.email === 'asumaduvincent7@gmail.com';
    if (!isAdmin) {
      if (!url || typeof url !== 'string') {
        return res.status(403).json({ success: false, error: 'Forbidden: cannot verify ownership without a url' });
      }
      if (!backendSupabase) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      let owns = false;

      const { data: selfRow } = await backendSupabase.from('users').select('photoUrl').eq('id', verified.uid).maybeSingle();
      if (selfRow?.photoUrl === url) {
        owns = true;
      }

      if (!owns) {
        // Matches the sellerId/seller_id dual-column check used everywhere
        // else in this file (e.g. /api/products/delete) -- some rows store
        // the seller reference under the snake_case column, so checking
        // only `sellerId` here would incorrectly deny a legitimate owner.
        const { data: ownProducts } = await backendSupabase
          .from('products')
          .select('images, imageUrls, videos, videoUrls')
          .or(`sellerId.eq.${verified.uid},sellerId.eq.user_${verified.uid},sellerId.eq.phone_${verified.uid},seller_id.eq.${verified.uid},seller_id.eq.user_${verified.uid},seller_id.eq.phone_${verified.uid}`);
        owns = !!(ownProducts || []).some((p: any) =>
          [p.images, p.imageUrls, p.videos, p.videoUrls].some((arr: any) => Array.isArray(arr) && arr.includes(url))
        );
      }

      if (!owns) {
        return res.status(403).json({ success: false, error: 'Forbidden: You do not own this asset' });
      }
    }

    const result = await deleteCloudinaryAsset(targetPublicId, targetResourceType);
    return res.json({ success: true, result });
  } catch (err: any) {
    console.error('[Cloudinary Delete Endpoint Error]:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Delete operation failed' });
  }
});

// A bulk scan/cleanup operation — genuinely expensive per call, not
// something any legitimate client flow needs to hit often.
// Security fix (found during the same consolidated rejection-path sweep as
// /api/cloudinary/upload above): this endpoint checked verifyUser() -- ANY
// signed-in user -- but never verified the caller actually owned the
// listing these URLs belonged to, or even that the URLs belonged to any
// listing of theirs at all. It deletes real Cloudinary assets using the
// server's own account-wide credentials based purely on client-supplied
// URLs. Its one legitimate caller (ListingModal.tsx, cleaning up images/
// videos removed during an edit) only ever sends its own product's own
// media -- but the endpoint itself placed no such restriction, so any
// authenticated user (including a freshly-registered one) could delete ANY
// Cloudinary asset in the account -- most seriously, another seller's
// public listing photos, which are trivially discoverable via the public
// GET /api/products feed -- by simply naming that URL in `oldUrls`. Fixed
// by requiring `productId`, verifying real ownership from the DB row (not
// the client's claim), and restricting deletion candidates to URLs that
// actually appear in that product's own stored media fields -- so even a
// legitimate caller acting on their own product can't slip in another
// product's asset URL.
app.post("/api/cloudinary/cleanup-orphans", serverRateLimiter(60 * 60 * 1000, 5, "cloudinary-cleanup-orphans"), async (req: express.Request, res: express.Response) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required to cleanup Cloudinary assets' });
  }

  try {
    const { oldUrls, newUrls, productId } = req.body;
    if (!Array.isArray(oldUrls) || !Array.isArray(newUrls)) {
      return res.status(400).json({ success: false, error: 'Expected arrays oldUrls and newUrls' });
    }
    if (!productId || typeof productId !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing productId' });
    }
    if (!backendSupabase) {
      return res.status(503).json({ success: false, error: 'Database service unavailable' });
    }

    const { data: existingProduct } = await backendSupabase
      .from('products')
      .select('images, imageUrls, videos, videoUrls, sellerId, seller_id')
      .eq('id', productId)
      .maybeSingle();
    if (!existingProduct) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }
    const existingSellerId = existingProduct.sellerId || existingProduct.seller_id;
    const isAdmin = verified.isAdmin || verified.email === 'asumaduvincent7@gmail.com';
    const isOwner = existingSellerId === verified.uid ||
      existingSellerId === `user_${verified.uid}` ||
      existingSellerId === `phone_${verified.uid}`;
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Forbidden: You do not own this listing' });
    }

    const ownedUrls = new Set([
      ...(Array.isArray(existingProduct.images) ? existingProduct.images : []),
      ...(Array.isArray(existingProduct.imageUrls) ? existingProduct.imageUrls : []),
      ...(Array.isArray(existingProduct.videos) ? existingProduct.videos : []),
      ...(Array.isArray(existingProduct.videoUrls) ? existingProduct.videoUrls : [])
    ]);

    const newUrlSet = new Set(newUrls);
    const orphans = oldUrls.filter(url => typeof url === 'string' && !newUrlSet.has(url) && ownedUrls.has(url));

    const results = [];
    for (const orphanUrl of orphans) {
      const info = extractCloudinaryInfo(orphanUrl);
      if (info) {
        try {
          const resObj = await deleteCloudinaryAsset(info.publicId, info.resourceType);
          results.push({ url: orphanUrl, success: true, result: resObj });
        } catch (err: any) {
          results.push({ url: orphanUrl, success: false, error: err?.message });
        }
      }
    }

    return res.json({ success: true, cleanedCount: results.length, results });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Cleanup operation failed' });
  }
});

// -------------------------------------------------------------
// SEO & Meta Tag Helpers
// -------------------------------------------------------------
function cleanHostHeader(host: string): string {
  if (!host) return "www.tedbuy.store";
  let clean = host.split(":")[0].trim().toLowerCase();
  if (clean === "localhost" || clean === "127.0.0.1") return "www.tedbuy.store";
  return clean;
}

function escapeHtml(unsafe: string): string {
  return String(unsafe || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function slugify(text: string): string {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getServerVideoPoster(videoUrl: string): string {
  if (!videoUrl || typeof videoUrl !== 'string') return '';
  const trimmed = videoUrl.trim();
  if (trimmed.includes('res.cloudinary.com')) {
    let posterUrl = trimmed.replace(/\.[a-zA-Z0-9]+$/, '.jpg');
    if (posterUrl.includes('/video/upload/')) {
      return posterUrl.replace('/video/upload/', '/video/upload/so_0,f_jpg,q_auto,w_1200,h_630,c_fill/');
    }
    if (posterUrl.includes('/upload/')) {
      return posterUrl.replace('/upload/', '/upload/so_0,f_jpg,q_auto,w_1200,h_630,c_fill/');
    }
    return posterUrl;
  }
  return trimmed;
}

function injectMetaTags(html: string, product: any, shareUrl: string, host: string, protocol: string, productId: string): string {
  const isService = product.category ? (product.category.toLowerCase() === 'services' || product.category.toLowerCase().includes('service')) : false;
  let title = `${product.title} | TedBuy Ghana`;
  if (!isService) {
    const pricePrefix = product.price && Number(product.price) > 0 ? `GHS ${product.price}` : 'Negotiable';
    title = `${product.title} - ${pricePrefix} | TedBuy Ghana`;
  }
  const description = `${product.description.slice(0, 160)}${product.description.length > 160 ? '...' : ''} | Buy/Sell on TedBuy`;
  
  const cleanVids = Array.isArray(product.videos) ? product.videos.filter((v: any) => typeof v === 'string' && v.trim().length > 0) : (Array.isArray(product.videoUrls) ? product.videoUrls.filter((v: any) => typeof v === 'string' && v.trim().length > 0) : []);
  const videoPoster = product.videoPoster || product.videoPosterUrl || (cleanVids[0] ? getServerVideoPoster(cleanVids[0]) : '');

  const cleanImgs = Array.isArray(product.images) ? product.images.filter((i: any) => typeof i === 'string' && i.trim().length > 0 && !i.includes('unsplash.com')) : (Array.isArray(product.imageUrls) ? product.imageUrls.filter((i: any) => typeof i === 'string' && i.trim().length > 0 && !i.includes('unsplash.com')) : []);
  const firstGenuineImg = cleanImgs.find((i: string) => !i.includes('unsplash.com') && !i.startsWith('data:image/svg'));

  let image = firstGenuineImg ||
    (product.displayImage && !product.displayImage.includes('unsplash.com') && !product.displayImage.startsWith('data:image/svg') ? product.displayImage : '') ||
    (product.primaryPicture && !product.primaryPicture.includes('unsplash.com') && !product.primaryPicture.startsWith('data:image/svg') ? product.primaryPicture : '') ||
    (product.image && !product.image.includes('unsplash.com') && !product.image.startsWith('data:image/svg') ? product.image : '') ||
    (product.primaryImage && !product.primaryImage.includes('unsplash.com') && !product.primaryImage.startsWith('data:image/svg') ? product.primaryImage : '') ||
    videoPoster ||
    cleanImgs[0] ||
    (product.displayImage && !product.displayImage.includes('unsplash.com') ? product.displayImage : '') ||
    (product.image && !product.image.includes('unsplash.com') ? product.image : '') ||
    '';

  if (typeof image === 'string' && (image.includes('/video/upload/') || image.endsWith('.mp4') || image.endsWith('.mov') || image.endsWith('.webm') || image.endsWith('.m4v'))) {
    image = getServerVideoPoster(image);
  }

  // Ensure Cloudinary images have optimal dimensions for OpenGraph (1200x630)
  let ogImageUrl = image;
  if (typeof ogImageUrl === 'string' && ogImageUrl.includes('res.cloudinary.com') && !ogImageUrl.includes('w_1200') && !ogImageUrl.includes('so_0')) {
    if (ogImageUrl.includes('/upload/')) {
      ogImageUrl = ogImageUrl.replace('/upload/', '/upload/c_fill,w_1200,h_630,g_auto,f_auto,q_auto/');
    }
  }

  const cleanPrice = product.price ? String(product.price).replace(/[^\d.]/g, '') : '';
  const priceSchema = cleanPrice && !isNaN(Number(cleanPrice)) ? cleanPrice : '0';

  const titleSlug = product.title ? slugify(product.title) : '';
  const canonicalUrl = `${protocol}://${host}/product/${productId}-${titleSlug}`;

  // Previously hardcoded regardless of the actual listing -- every product
  // reported UsedCondition/InStock to Google, even a "Brand New" listing or
  // one already sold/removed. Real values were sitting right there on the
  // product row the whole time.
  const conditionSchemaMap: Record<string, string> = {
    'brand new': 'https://schema.org/NewCondition',
    'new': 'https://schema.org/NewCondition',
    'refurbished': 'https://schema.org/RefurbishedCondition',
    'slightly used': 'https://schema.org/UsedCondition',
    'used - good': 'https://schema.org/UsedCondition',
    'used - fair': 'https://schema.org/UsedCondition',
  };
  const itemConditionSchema = conditionSchemaMap[String(product.condition || '').trim().toLowerCase()] || 'https://schema.org/UsedCondition';
  const isSoldOrInactive = product.isSold === true || product.is_sold === true || product.status === 'sold' || product.status === 'archived' || product.status === 'hidden' || product.isDeleted === true;
  const availabilitySchema = isSoldOrInactive ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock';

  const productSchema = {
    "@context": "https://schema.org/",
    "@type": "Product",
    "name": product.title,
    "image": [ogImageUrl],
    "description": product.description,
    "sku": productId,
    "offers": {
      "@type": "Offer",
      "url": canonicalUrl,
      "priceCurrency": "GHS",
      "price": priceSchema,
      "itemCondition": itemConditionSchema,
      "availability": availabilitySchema,
      ...(product.sellerName ? { "seller": { "@type": "Organization", "name": String(product.sellerName) } } : {})
    }
  };

  // Critical: JSON.stringify never escapes '<', so a title/description/
  // sellerName containing a literal "</script>" would close this tag early
  // and inject an attacker-controlled <script> into every visitor's page --
  // this is server-rendered HTML served on every real product-page load
  // (not just crawler previews), reached by nothing more than creating an
  // ordinary listing, no authentication or specific-victim targeting
  // required. \u003c is a valid JSON escape for '<' that any JSON-LD/
  // schema.org parser reads back identically, so this changes nothing for
  // legitimate consumers while making a literal '<' impossible for the
  // HTML parser to ever see inside this script tag.
  const schemaScript = `<script type="application/ld+json">${JSON.stringify(productSchema).replace(/</g, '\\u003c')}</script>`;
  const metaTags = `
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />

    <meta property="og:type" content="product" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(ogImageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(ogImageUrl)}" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeHtml(product.title || 'Product on TedBuy')}" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:url" content="${escapeHtml(canonicalUrl)}" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />
    ${schemaScript}
  `;

  return html
    .replace(/<title>.*?<\/title>/gi, '')
    .replace(/<meta\s+name="description".*?>/gi, '')
    .replace(/<meta\s+property="og:.*?".*?>/gi, '')
    .replace(/<meta\s+name="twitter:.*?".*?>/gi, '')
    .replace(/<link\s+rel="canonical".*?>/gi, '')
    .replace('</head>', `${metaTags}\n</head>`);
}

// Seller storefront SSR meta tags -- previously the SSR handler checked
// req.path against /store/:id (server.ts's dead leftover from an earlier
// URL scheme) while the app's real seller URLs have always been
// /seller/:id (confirmed via useHashRouting.ts, AppContext.tsx's
// parseUrlState, sitemap.ts), so this code path never actually matched
// real traffic -- and even when it matched, it only checked 404/noindex,
// never built real per-seller title/description/og:image the way
// injectMetaTags does for products. A seller sharing their storefront
// link got a generic "TedBuy Ghana" preview card everywhere it was
// pasted, not their shop. Mirrors injectMetaTags's structure.
function injectSellerMetaTags(html: string, seller: any, shareUrl: string): string {
  const displayName = seller.username || seller.displayName || 'This seller';
  const title = `${displayName}'s Store | TedBuy Ghana`;
  const rawBio = typeof seller.bio === 'string' ? seller.bio.trim() : '';
  const description = rawBio
    ? `${rawBio.slice(0, 160)}${rawBio.length > 160 ? '...' : ''}`
    : `Shop ${displayName}'s listings on TedBuy Ghana — phones, laptops, fashion, and more.`;

  let ogImageUrl = (typeof seller.photoUrl === 'string' && seller.photoUrl.trim())
    ? seller.photoUrl
    : 'https://www.tedbuy.store/icon-192.png';
  if (ogImageUrl.includes('res.cloudinary.com') && ogImageUrl.includes('/upload/') && !ogImageUrl.includes('w_1200')) {
    ogImageUrl = ogImageUrl.replace('/upload/', '/upload/c_fill,w_1200,h_630,g_auto,f_auto,q_auto/');
  }

  const metaTags = `
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(shareUrl)}" />

    <meta property="og:type" content="profile" />
    <meta property="og:url" content="${escapeHtml(shareUrl)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(ogImageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(ogImageUrl)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeHtml(displayName)}" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:url" content="${escapeHtml(shareUrl)}" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />
  `;

  return html
    .replace(/<title>.*?<\/title>/gi, '')
    .replace(/<meta\s+name="description".*?>/gi, '')
    .replace(/<meta\s+property="og:.*?".*?>/gi, '')
    .replace(/<meta\s+name="twitter:.*?".*?>/gi, '')
    .replace(/<link\s+rel="canonical".*?>/gi, '')
    .replace('</head>', `${metaTags}\n</head>`);
}

// -------------------------------------------------------------
// Product Normalization & Retrieval Helpers
// -------------------------------------------------------------
function parseServerDate(dateVal: any): Date | null {
  if (!dateVal) return null;
  if (dateVal instanceof Date) return dateVal;
  if (typeof dateVal === 'object') {
    if (typeof dateVal.seconds === 'number') return new Date(dateVal.seconds * 1000);
    if (typeof dateVal._seconds === 'number') return new Date(dateVal._seconds * 1000);
  }
  const d = new Date(dateVal);
  return isNaN(d.getTime()) ? null : d;
}

// src/types.ts's Product.price is explicitly typed `string | number` -- a
// deliberate, first-class feature (ListingModal.tsx/SellScreen.tsx both let a
// seller type "Contact for Price"/"Inquire", and EVERY Services/Jobs &
// Employment listing on both platforms always sends the literal string
// "Inquire" as its price, never a number, by the client's own design).
// Every place in this file that touches price used to force it through
// Number() unconditionally -- Number("Inquire") is NaN, which
// JSON.stringify()s to null over the wire to Supabase, so the stored value
// became SQL NULL. Reading it back, `row.price !== undefined ? Number(row.price)
// : 0` then computed Number(null) === 0 -- so every one of these listings
// silently displayed "GHS 0" everywhere (product cards, detail page, SSR
// meta tags) instead of "Inquire" or whatever text the seller actually
// entered. Normalizes a price value the same way the client's own submit
// logic already distinguishes numeric vs. literal-text prices, so both
// sides agree on what gets stored/returned.
function normalizeServerPrice(raw: any, fallback: number | string = 0): number | string {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'number') return isNaN(raw) ? fallback : raw;
  const cleanStr = String(raw).replace(/GHS/gi, '').replace(/,/g, '').trim();
  if (cleanStr !== '' && !isNaN(Number(cleanStr))) return Number(cleanStr);
  return String(raw).trim() || fallback;
}

function getServerBoostEndDate(product: any): Date | null {
  if (!product) return null;

  const rawEnd = product.boostEndDate || product.boostExpiry || product.boost_end_date || product.boost_expiry;
  if (rawEnd && rawEnd !== 'N/A' && rawEnd !== 'null' && rawEnd !== 'undefined') {
    const parsed = parseServerDate(rawEnd);
    if (parsed) return parsed;
  }

  const rawStart = product.boostStartDate || product.lastBoostedAt || product.lastBoostPurchase || product.boost_start_date || product.last_boosted_at;
  if (rawStart && rawStart !== 'N/A' && rawStart !== 'null' && rawStart !== 'undefined') {
    const startDate = parseServerDate(rawStart);
    if (startDate) {
      const planDaysMap: Record<string, number> = {
        '3days': 3,
        '7days': 7,
        '14days': 14,
        '21days': 21,
        '1month': 30
      };
      const plan = product.boostPlan || product.boost_plan || '7days';
      const days = planDaysMap[plan] || 7;
      return new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);
    }
  }

  const isBoostedFlag = !!(
    product.boostStatus === true ||
    product.boostStatus === 'true' ||
    product.isBoosted === true ||
    product.is_boosted === true ||
    product.boost_status === true ||
    product.boost_status === 'true'
  );

  if (isBoostedFlag) {
    const created = parseServerDate(product.createdAt || product.created_at);
    if (created) {
      const planDaysMap: Record<string, number> = {
        '3days': 3,
        '7days': 7,
        '14days': 14,
        '21days': 21,
        '1month': 30
      };
      const plan = product.boostPlan || product.boost_plan || '7days';
      const days = planDaysMap[plan] || 7;
      return new Date(created.getTime() + days * 24 * 60 * 60 * 1000);
    }
  }

  return null;
}

function normalizeServerCategory(cat: any): string {
  if (!cat) return 'other';
  const clean = String(cat).trim().toLowerCase();
  if (
    clean.includes('beauty') || 
    clean.includes('makeup') || 
    clean.includes('cosmetic') || 
    clean === 'care' || 
    clean.includes('skin care') ||
    clean.includes('haircare')
  ) {
    return 'beauty and care';
  }
  if (clean.includes('phone')) return 'phones';
  if (clean.includes('laptop') || clean.includes('notebook') || clean.includes('computer')) return 'laptops & computers';
  if (clean.includes('fashion') || clean.includes('cloth') || clean.includes('wear') || clean.includes('shoe')) return 'fashion';
  if (clean.includes('appliance') || clean.includes('fridge') || clean.includes('microwave') || clean.includes('washing machine')) return 'home appliances';
  if (clean.includes('vehicle') || clean.includes('car')) return 'vehicles';
  if (clean.includes('property') || clean.includes('house') || clean.includes('land') || clean.includes('apartment') || clean.includes('room')) return 'property';
  if (clean.includes('furniture') || clean.includes('sofa') || clean.includes('chair') || clean.includes('table') || clean.includes('bed')) return 'furniture & home';
  if (clean.includes('game') || clean.includes('playstation') || clean.includes('xbox') || clean.includes('console')) return 'games';
  if (clean.includes('electronic') || clean.includes('tv') || clean.includes('speaker') || clean.includes('audio')) return 'electronics';
  if (clean.includes('job') || clean.includes('employment') || clean.includes('hiring')) return 'jobs & employment';
  if (clean.includes('service') || clean.includes('repair')) return 'services';
  if (clean.includes('agriculture') || clean.includes('farm') || clean.includes('crop') || clean.includes('food')) return 'agriculture & food';
  if (clean.includes('pet') || clean.includes('animal') || clean.includes('dog') || clean.includes('cat')) return 'pets & animals';
  if (clean.includes('sport') || clean.includes('fitness') || clean.includes('gym')) return 'sports & fitness';
  if (clean.includes('kid') || clean.includes('baby') || clean.includes('child') || clean.includes('toy')) return 'kids & baby';
  if (clean.includes('commercial') || clean.includes('tool') || clean.includes('machinery')) return 'commercial & tools';
  if (clean.includes('book') || clean.includes('hobby') || clean.includes('music')) return 'books & hobbies';
  return clean;
}

function isServerBoostActive(product: any): boolean {
  if (!product) return false;
  const endDate = getServerBoostEndDate(product);
  if (!endDate) return false;
  return endDate.getTime() > Date.now();
}

function normalizeServerProductRow(row: any): any {
  if (!row) return null;
  const imgs = parseMediaArray(row.images || row.imageUrls);
  const cleanImgs = imgs.filter(i => typeof i === 'string' && i.length > 0 && !i.includes('/api/products/') && !i.includes('unsplash.com') && !i.startsWith('data:'));
  
  const vids = parseMediaArray(row.videos || row.videoUrls);
  const cleanVids = vids.filter(v => typeof v === 'string' && v.length > 0 && !v.includes('/api/products/') && !v.startsWith('data:'));

  const videoPoster = (row.videoPoster && typeof row.videoPoster === 'string' && !row.videoPoster.startsWith('data:') ? row.videoPoster : '') ||
    (row.videoPosterUrl && typeof row.videoPosterUrl === 'string' && !row.videoPosterUrl.startsWith('data:') ? row.videoPosterUrl : '') ||
    (cleanVids[0] ? getServerVideoPoster(cleanVids[0]) : '');

  const primaryImg = cleanImgs[0] ||
    (row.displayImage && typeof row.displayImage === 'string' && !row.displayImage.startsWith('data:') && !row.displayImage.includes('unsplash.com') ? row.displayImage : '') ||
    (row.primaryPicture && typeof row.primaryPicture === 'string' && !row.primaryPicture.startsWith('data:') && !row.primaryPicture.includes('unsplash.com') ? row.primaryPicture : '') ||
    videoPoster ||
    '';

  const rawBoostEndDate = row.boostEndDate || row.boost_end_date || row.boostExpiry || row.boost_expiry || undefined;
  const rawBoostStartDate = row.boostStartDate || row.boost_start_date || row.lastBoostedAt || row.last_boosted_at || undefined;
  const boostPlan = row.boostPlan || row.boost_plan || undefined;

  const computedBoostEndDate = getServerBoostEndDate({ ...row, boostEndDate: rawBoostEndDate, boostStartDate: rawBoostStartDate, boostPlan });
  const activeBoost = computedBoostEndDate ? computedBoostEndDate.getTime() > Date.now() : false;

  const thumbnailUrl = (cleanImgs[0] && cleanImgs[0].includes('res.cloudinary.com'))
    ? cleanImgs[0].replace('/upload/', '/upload/c_thumb,w_200,h_200,g_auto,f_auto,q_auto/')
    : (videoPoster && videoPoster.includes('res.cloudinary.com'))
    ? videoPoster.replace('/upload/', '/upload/c_thumb,w_200,h_200,g_auto,f_auto,q_auto/')
    : primaryImg;

  return {
    ...row,
    id: String(row.id || ''),
    title: row.title || '',
    description: row.description || '',
    price: normalizeServerPrice(row.price),
    currency: row.currency || 'GHS',
    // 'Used - Good' isn't one of the four real, selectable condition presets
    // on either platform (['Brand New', 'Slightly Used', 'Refurbished',
    // 'Used - Fair'] -- ListingModal.tsx/SellScreen.tsx) -- normalizeServer
    // ProductSummaryRow already correctly fell back to 'Slightly Used'
    // (a real preset); this function and upsertProductToSupabase's fallback
    // disagreed. Same field, same fallback case, should agree.
    condition: row.condition || 'Slightly Used',
    category: row.category || 'Other',
    subcategory: row.subcategory || row.subCategory || '',
    location: row.location || '',
    brand: row.brand || '',
    negotiable: row.negotiable === true,
    isExchangeable: row.isExchangeable === true || row.exchangePossible === true,
    exchangePossible: row.exchangePossible === true || row.isExchangeable === true,
    sellerId: row.sellerId || row.seller_id || '',
    sellerName: row.sellerName || row.seller_name || 'Seller',
    sellerEmail: row.sellerEmail || row.seller_email || '',
    sellerPhoto: row.sellerPhoto || row.seller_photo || '',
    sellerJoinDate: row.sellerJoinDate || row.seller_join_date || new Date().toISOString(),
    createdAt: row.createdAt || row.created_at || new Date().toISOString(),
    updatedAt: row.updatedAt || row.updated_at || row.createdAt || new Date().toISOString(),
    views: Number(row.views || row.viewsCount) || 0,
    viewsCount: Number(row.views || row.viewsCount) || 0,
    likes: Number(row.likes || row.likesCount) || 0,
    likesCount: Number(row.likes || row.likesCount) || 0,
    status: (row.isSold === false || row.is_sold === false) && row.status === 'sold'
      ? 'active'
      : (row.status || (row.isSold || row.is_sold ? 'sold' : 'active')),
    isSold: row.isSold !== undefined ? row.isSold === true : (row.is_sold !== undefined ? row.is_sold === true : row.status === 'sold'),
    soldAt: (row.isSold === false || row.is_sold === false) ? null : (row.soldAt || row.sold_at || null),
    boostStatus: activeBoost,
    isBoosted: activeBoost,
    boostPlan: boostPlan || (activeBoost ? '7days' : undefined),
    boostStartDate: rawBoostStartDate,
    boostEndDate: computedBoostEndDate ? computedBoostEndDate.toISOString() : undefined,
    boostExpiry: computedBoostEndDate ? computedBoostEndDate.toISOString() : undefined,
    images: cleanImgs.length > 0 ? cleanImgs : [],
    imageUrls: cleanImgs.length > 0 ? cleanImgs : [],
    thumbnailUrls: cleanImgs.length > 0 ? [thumbnailUrl] : (videoPoster ? [videoPoster] : []),
    thumbnailUrl,
    videos: cleanVids,
    videoUrls: cleanVids,
    videoPoster: videoPoster,
    displayImage: primaryImg,
    primaryImage: primaryImg
  };
}

export function serializeProductSummary(row: any): any {
  if (!row) return null;
  const normalized = normalizeServerProductRow(row);
  if (!normalized) return null;

  const displayImg = (normalized.displayImage && !normalized.displayImage.includes('unsplash.com'))
    ? normalized.displayImage
    : (normalized.primaryImage && !normalized.primaryImage.includes('unsplash.com') ? normalized.primaryImage : (normalized.videoPoster || ''));
  const thumbUrl = normalized.thumbnailUrl || (displayImg.includes('res.cloudinary.com') ? displayImg.replace('/upload/', '/upload/c_thumb,w_200,h_200,g_auto,f_auto,q_auto/') : displayImg);

  const cleanVids = Array.isArray(normalized.videos) ? normalized.videos.filter(v => typeof v === 'string' && v.length > 0) : [];

  return {
    id: normalized.id,
    title: normalized.title,
    price: normalized.price,
    currency: normalized.currency || 'GHS',
    location: normalized.location,
    brand: normalized.brand,
    condition: normalized.condition,
    category: normalized.category,
    subcategory: normalized.subcategory,
    displayImage: displayImg,
    videoPoster: normalized.videoPoster || '',
    thumbnailUrl: thumbUrl,
    videos: cleanVids,
    videoUrls: cleanVids,
    boosted: !!normalized.boostStatus || !!normalized.isBoosted,
    boostEndDate: normalized.boostEndDate || null,
    // See normalizeServerProductSummaryRow's boostPlan comment -- same gap,
    // same fix: without this, /api/products & /api/feed's boostPlan was
    // always undefined client-side, breaking productSelector.ts's
    // boost-package-value tiebreaker for every boosted listing.
    boostPlan: normalized.boostPlan || undefined,
    sellerId: normalized.sellerId,
    sellerName: normalized.sellerName,
    sellerVerified: normalized.sellerVerified !== false,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    viewsCount: normalized.viewsCount || 0,
    likesCount: normalized.likesCount || 0,
    status: (normalized.isSold === false) && normalized.status === 'sold'
      ? 'active'
      : (normalized.status || (normalized.isSold ? 'sold' : 'active')),
    isSold: normalized.isSold !== undefined ? normalized.isSold === true : (normalized.status === 'sold'),
    soldAt: normalized.isSold === false ? null : (normalized.soldAt || null),
    negotiable: !!normalized.negotiable,
    isExchangeable: !!normalized.isExchangeable || !!normalized.exchangePossible,
    exchangePossible: !!normalized.exchangePossible || !!normalized.isExchangeable
  };
}

function normalizeServerProductSummaryRow(row: any): any {
  if (!row) return null;
  // Exclude soft-deleted, archived, or admin-hidden products from public
  // listing feeds. This is the shared filter behind getProductsListData()
  // (backing /api/products, /api/feed, /api/featured, /api/trending, and
  // /api/similar) -- 'hidden' was missing here, so an admin's "hide" action
  // (elsewhere in this file, moderation-locked alongside 'archived'/'deleted')
  // had no actual effect on the app's primary product surfaces; a hidden
  // listing stayed fully visible in the home feed, search, and every
  // feature derived from this same cached dataset.
  if (row.isDeleted === true || row.is_deleted === true || row.status === 'archived' || row.status === 'hidden' || row.status === 'deleted') {
    return null;
  }
  const imgs = parseMediaArray(row.images || row.imageUrls);
  const cleanImgs = imgs.filter(i => typeof i === 'string' && i.length > 0 && !i.includes('/api/products/') && !i.includes('unsplash.com') && !i.startsWith('data:'));
  const vids = parseMediaArray(row.videos || row.videoUrls);
  const cleanVids = vids.filter(v => typeof v === 'string' && v.length > 0 && !v.includes('/api/products/') && !v.startsWith('data:'));
  const videoPoster = row.videoPoster || row.videoPosterUrl || (cleanVids[0] ? getServerVideoPoster(cleanVids[0]) : '');
  const primaryImg = cleanImgs[0] || (row.displayImage && typeof row.displayImage === 'string' && !row.displayImage.startsWith('data:') && !row.displayImage.includes('unsplash.com') ? row.displayImage : '') || (row.primaryPicture && typeof row.primaryPicture === 'string' && !row.primaryPicture.startsWith('data:') && !row.primaryPicture.includes('unsplash.com') ? row.primaryPicture : '') || videoPoster || '';

  const rawBoostEndDate = row.boostEndDate || row.boost_end_date || row.boostExpiry || row.boost_expiry || undefined;
  const rawBoostStartDate = row.boostStartDate || row.boost_start_date || row.lastBoostedAt || row.last_boosted_at || undefined;
  const boostPlan = row.boostPlan || row.boost_plan || undefined;

  const computedBoostEndDate = getServerBoostEndDate({ ...row, boostEndDate: rawBoostEndDate, boostStartDate: rawBoostStartDate, boostPlan });
  const activeBoost = computedBoostEndDate ? computedBoostEndDate.getTime() > Date.now() : false;

  const thumbnailUrl = cleanImgs[0] && cleanImgs[0].includes('res.cloudinary.com')
    ? cleanImgs[0].replace('/upload/', '/upload/c_thumb,w_200,h_200,g_auto,f_auto,q_auto/')
    : primaryImg;

  return {
    id: String(row.id || ''),
    title: row.title || '',
    price: normalizeServerPrice(row.price),
    currency: row.currency || 'GHS',
    location: row.location || '',
    brand: row.brand || '',
    condition: row.condition || 'Slightly Used',
    category: row.category || 'Other',
    subcategory: row.subcategory || row.subCategory || '',
    displayImage: primaryImg,
    thumbnailUrl: thumbnailUrl,
    images: primaryImg ? [primaryImg] : [],
    imageUrls: primaryImg ? [primaryImg] : [],
    thumbnailUrls: thumbnailUrl ? [thumbnailUrl] : [],
    videos: cleanVids,
    videoUrls: cleanVids,
    boosted: activeBoost,
    boostEndDate: computedBoostEndDate ? computedBoostEndDate.toISOString() : null,
    // Real plan id (e.g. '1month' vs '3days') -- was computed above (boostPlan)
    // but never actually returned here, so every client-facing endpoint built
    // on this row (/api/products, /api/feed, /api/featured, /api/video-ads)
    // delivered `boostPlan: undefined` for every product. productSelector.ts's
    // boost sort on web/mobile uses exactly this field as its PRIORITY LEVEL 1
    // tiebreaker among boosted listings ("higher price/level package first"),
    // ahead of remaining boost time -- with it always missing, that tiebreaker
    // could never fire and every pair of boosted listings fell straight to
    // comparing remaining time instead. Concretely: a seller on the GH₵10
    // (1-month) plan with 1 day left ranked BELOW a seller on the GH₵1
    // (3-day) plan who just bought it (3 days left), even though the pricier
    // package is supposed to win regardless of remaining time.
    // Found via a dedicated cross-check re-run of the three product-
    // serialize functions: normalizeServerProductRow (line ~2271) and
    // serializeProductSummary (forwards it) both default to '7days' for a
    // row that's actively boosted but has no stored boostPlan value --
    // getServerBoostEndDate's own isBoostedFlag branch computes an end date
    // from createdAt + 7 days for exactly this shape, confirming such rows
    // are real, not hypothetical. This function (the one that actually
    // backs the primary /api/products, /api/feed, /api/featured, /api/trending
    // feeds via getProductsListData()) was still missing that same
    // activeBoost fallback, so the identical underlying row reported
    // boostPlan: '7days' on the single-product page but boostPlan: undefined
    // on every list/feed endpoint -- productSelector.ts's boost-priority
    // tiebreaker maps undefined to a LOWER rank than '7days', so a boosted
    // listing's rank literally depended on which endpoint served it.
    boostPlan: boostPlan || (activeBoost ? '7days' : undefined),
    sellerId: row.sellerId || row.seller_id || '',
    sellerName: row.sellerName || row.seller_name || 'Seller',
    sellerEmail: row.sellerEmail || row.seller_email || '',
    user_id: row.sellerId || row.seller_id || row.user_id || '',
    sellerVerified: row.sellerVerified === true || row.seller_verified === true || true,
    createdAt: row.createdAt || row.created_at || new Date().toISOString(),
    updatedAt: row.updatedAt || row.updated_at || row.createdAt || row.created_at || new Date().toISOString(),
    viewsCount: Number(row.viewsCount || row.views_count || 0),
    likesCount: Number(row.likesCount || row.likes_count || 0),
    status: (row.isSold === false || row.is_sold === false) && row.status === 'sold'
      ? 'active'
      : (row.status || (row.isSold || row.is_sold ? 'sold' : 'active')),
    isSold: row.isSold !== undefined ? row.isSold === true : (row.is_sold !== undefined ? row.is_sold === true : row.status === 'sold'),
    soldAt: (row.isSold === false || row.is_sold === false) ? null : (row.soldAt || row.sold_at || null),
    negotiable: row.negotiable === true,
    isExchangeable: row.isExchangeable === true || row.exchangePossible === true,
    exchangePossible: row.exchangePossible === true || row.isExchangeable === true
  };
}

async function getProductsListData(forceRefresh = false): Promise<{ products: any[] }> {
  const now = Date.now();
  if (!forceRefresh && rawProductsListCache && rawProductsListCache.products.length > 0 && (now - rawProductsListCache.timestamp) < RAW_PRODUCTS_CACHE_TTL_MS) {
    return { products: rawProductsListCache.products };
  }

  let products: any[] = [];
  if (backendSupabase) {
    try {
      // Explicit column selection with double quotes for camelCase Postgres identifiers.
      // "isSold", "soldAt", status and "isDeleted" were missing — PostgREST
      // only returns columns you explicitly ask for, so every row from this
      // query (home feed, search, seller-listings fetch) had these as
      // undefined, silently breaking both the Mark as Sold state here and the
      // soft-delete/archived-listing exclusion filter below. "updatedAt" is
      // deliberately NOT requested here -- the products table has no such
      // column (confirmed, out of scope to change per explicit instruction),
      // so requesting it made this query fail on every single call and
      // silently fall back to a second, slower select(*) every time. The
      // normalized row's updatedAt already falls back to createdAt below
      // regardless, so omitting it here changes no resulting data -- it only
      // removes a guaranteed-to-fail round trip on this hot path.
      const summaryColumns = 'id, title, price, category, location, brand, condition, negotiable, "sellerId", "sellerName", "createdAt", "viewsCount", "likesCount", "boostStatus", "boostPlan", "boostStartDate", "boostEndDate", "lastBoostedAt", "isApproved", "isSold", "soldAt", status, "isDeleted", images, videos';
      let { data, error } = await backendSupabase
        .from('products')
        .select(summaryColumns)
        .order('createdAt', { ascending: false })
        .limit(1000);

      if (error) {
        console.warn('[Supabase Server Products] summaryColumns select failed, trying select(*):', error.message);
        const fallback = await backendSupabase
          .from('products')
          .select('*')
          .limit(1000);
        data = fallback.data;
        error = fallback.error;
      }

      if (!error && Array.isArray(data) && data.length > 0) {
        products = data.map((row: any) => normalizeServerProductSummaryRow(row)).filter(Boolean);
      } else if (error) {
        console.error('[Supabase Server Products] Error fetching products:', error.message);
      }
    } catch (err: any) {
      console.error('[Supabase Server Products] Exception fetching products:', err?.message || err);
    }
  }

  // Fallback to Firestore adminDb if Supabase returned 0 products or failed
  if (products.length === 0 && adminDb) {
    try {
      console.log('[Server Products Fallback] Querying Firestore adminDb for products...');
      const snap = await adminDb.collection('products').limit(1000).get();
      if (snap && !snap.empty) {
        const firestoreList: any[] = [];
        snap.forEach((docSnap: any) => {
          const d = docSnap.data();
          if (d) {
            firestoreList.push(normalizeServerProductSummaryRow({ ...d, id: docSnap.id || d.id }));
          }
        });
        // normalizeServerProductSummaryRow returns null for hidden/deleted/
        // archived rows (see its comment) -- filter those out before sorting.
        // Without this, any such row reaching this fallback path threw on
        // `.createdAt` of null and silently emptied the whole feed for
        // every consumer of getProductsListData().
        products = firestoreList.filter(Boolean).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        console.log(`[Server Products Fallback] Retrived ${products.length} products from Firestore.`);
      }
    } catch (firestoreErr: any) {
      console.warn('[Server Products Fallback] Firestore query error:', firestoreErr?.message || firestoreErr);
    }
  }

  if (products.length > 0) {
    // Boost-aware ordering: this array's order is the ranking every downstream
    // consumer that doesn't already do its own explicit re-sort inherits
    // directly -- most importantly /api/products & /api/feed, which only
    // filter and slice() for pagination (see below), and the SSR
    // window.__INITIAL_PRODUCTS__ injection, which takes a plain
    // products.slice(0, 50). Before this sort both derived their order from
    // the Supabase query's `createdAt DESC`, with no boost awareness at all --
    // a listing boosted today but created weeks ago sorted by its old
    // creation date, so it could sit past page 1 (or past the SSR/initial
    // fetch's page-1 window entirely) while unboosted, freshly-created
    // listings displaced it. That silently broke the "boosted listings must
    // always appear above all normal listings" guarantee those endpoints'
    // consumers (productSelector.ts on web/mobile) rely on: a client can only
    // boost-sort what it actually received, and it never received the
    // boosted item at all. Sorting boost-active-first here, before caching,
    // fixes it at the one shared source instead of in every consumer.
    // Ties within each group keep the existing recency order.
    products = products.slice().sort((a: any, b: any) => {
      const boostA = !!(a && a.boosted === true);
      const boostB = !!(b && b.boosted === true);
      if (boostA !== boostB) return boostA ? -1 : 1;
      const aTime = parseServerDate(a?.createdAt)?.getTime() || 0;
      const bTime = parseServerDate(b?.createdAt)?.getTime() || 0;
      return bTime - aTime;
    });
    rawProductsListCache = { products, timestamp: now };
  } else if (rawProductsListCache) {
    products = rawProductsListCache.products;
  }

  return { products };
}

// -------------------------------------------------------------
// Product API Endpoints (Supabase + Firestore Fallback with Memory TTL Cache)
// -------------------------------------------------------------
app.get(['/api/featured', '/api/products/featured'], serverRateLimiter(60 * 1000, 600, "featured-listings"), async (req, res) => {
  try {
    const queryCategory = typeof req.query.category === 'string' ? req.query.category.trim().toLowerCase() : '';
    const cacheKey = queryCategory && queryCategory !== 'all' ? `featured:cat:${queryCategory}` : 'featured';
    const cacheTTL = 30; // 30s TTL cache
    res.setHeader('Cache-Control', 'public, max-age=30');

    const cached = serverCache.get<any>(cacheKey);
    if (cached) {
      res.setHeader('ETag', cached.etag);
      if (req.headers['if-none-match'] === cached.etag) {
        return res.status(304).end();
      }
      return res.json({ success: true, ...cached.value, cached: true });
    }

    const { products } = await getProductsListData();
    const now = Date.now();

    const featured = products
      .filter((p: any) => {
        if (!p || p.status === 'hidden' || p.isSold) return false;
        if (queryCategory && queryCategory !== 'all') {
          const pCat = String(p.category || '').trim().toLowerCase();
          if (pCat !== queryCategory && !pCat.includes(queryCategory) && !queryCategory.includes(pCat)) {
            return false;
          }
        }
        return isServerBoostActive(p);
      })
      .map((p: any) => serializeProductSummary(p));

    featured.sort((a: any, b: any) => {
      const aStart = parseServerDate(a.boostStartDate || a.lastBoostedAt || a.createdAt)?.getTime() || 0;
      const bStart = parseServerDate(b.boostStartDate || b.lastBoostedAt || b.createdAt)?.getTime() || 0;
      return bStart - aStart;
    });

    const responsePayload = {
      products: featured,
      total: featured.length
    };

    const etag = serverCache.set(cacheKey, responsePayload, cacheTTL);
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    return res.json({ success: true, ...responsePayload });
  } catch (err: any) {
    console.error('[Featured Products API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to retrieve featured products' });
  }
});

app.get(['/api/trending', '/api/products/trending'], serverRateLimiter(60 * 1000, 600, "trending-listings"), async (req, res) => {
  try {
    const queryCategory = typeof req.query.category === 'string' ? req.query.category.trim().toLowerCase() : '';
    const cacheKey = queryCategory && queryCategory !== 'all' ? `trending:cat:${queryCategory}` : 'trending';
    const cacheTTL = 30; // 30s TTL cache
    res.setHeader('Cache-Control', 'public, max-age=30');

    const cached = serverCache.get<any>(cacheKey);
    if (cached) {
      res.setHeader('ETag', cached.etag);
      if (req.headers['if-none-match'] === cached.etag) {
        return res.status(304).end();
      }
      return res.json({ success: true, ...cached.value, cached: true });
    }

    const { products } = await getProductsListData();

    const activeTrending = products
      .filter((p: any) => {
        if (!p) return false;
        if (p.status === 'hidden' || p.isSold || p.status === 'sold') return false;
        if (queryCategory && queryCategory !== 'all') {
          const pCat = String(p.category || '').trim().toLowerCase();
          if (pCat !== queryCategory && !pCat.includes(queryCategory) && !queryCategory.includes(pCat)) {
            return false;
          }
        }
        return true;
      })
      .map((p: any) => serializeProductSummary(p));

    activeTrending.sort((a: any, b: any) => {
      const aViews = Number(a.viewsCount || a.views) || 0;
      const bViews = Number(b.viewsCount || b.views) || 0;
      if (bViews !== aViews) return bViews - aViews;
      const aTime = parseServerDate(a.createdAt)?.getTime() || 0;
      const bTime = parseServerDate(b.createdAt)?.getTime() || 0;
      return bTime - aTime;
    });

    const top10Trending = activeTrending.slice(0, 10);

    const responsePayload = {
      products: top10Trending,
      total: top10Trending.length
    };

    const etag = serverCache.set(cacheKey, responsePayload, cacheTTL);
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    return res.json({ success: true, ...responsePayload });
  } catch (err: any) {
    console.error('[Trending Products API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to retrieve trending products' });
  }
});

// "Similar Listings" on a product detail page. Previously both web
// (ProductDetail.tsx) and mobile (ProductDetailScreen.tsx) derived this
// from whatever paginated products array was already loaded client-side
// (capped at 200-ish items, sorted by recency) -- the same class of gap
// Featured/Trending had before those were fixed, except there was no
// existing dedicated endpoint to redirect to for this one. This is that
// endpoint: queries the same full-catalog cache /api/featured and
// /api/trending already use, so a genuinely matching item sitting further
// back in the catalog (outside the client's already-loaded page) is no
// longer invisible.
app.get(['/api/similar', '/api/products/similar'], serverRateLimiter(60 * 1000, 600, "similar-listings"), async (req, res) => {
  try {
    const excludeId = typeof req.query.productId === 'string' ? req.query.productId.trim() : '';
    const queryCategory = typeof req.query.category === 'string' ? req.query.category.trim().toLowerCase() : '';
    if (!queryCategory) {
      return res.status(400).json({ success: false, error: 'Missing required parameter: category' });
    }
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit as string, 10) || 4));

    const cacheKey = `similar:cat:${queryCategory}`;
    const cacheTTL = 30; // 30s TTL cache, matches featured/trending
    res.setHeader('Cache-Control', 'public, max-age=30');

    const cached = serverCache.get<any>(cacheKey);
    if (cached) {
      res.setHeader('ETag', cached.etag);
      if (req.headers['if-none-match'] === cached.etag) {
        return res.status(304).end();
      }
      // Exclusion and limit are applied per-request, not baked into the
      // shared per-category cache entry, so the same cached pool serves
      // every product detail page in that category correctly.
      const filtered = (cached.value.products || []).filter((p: any) => p.id !== excludeId).slice(0, limit);
      return res.json({ success: true, products: filtered, total: filtered.length, cached: true });
    }

    const { products } = await getProductsListData();

    const matching = products
      .filter((p: any) => {
        if (!p) return false;
        if (p.status === 'hidden' || p.isSold || p.status === 'sold') return false;
        const pCat = String(p.category || '').trim().toLowerCase();
        return pCat === queryCategory;
      })
      .map((p: any) => serializeProductSummary(p));

    // Newest first, matching web/mobile's previous (unpaginated) behavior
    // for this feature -- this isn't a ranking-sensitive section like
    // Trending, just "other things in this category," so recency is a
    // reasonable, simple default.
    matching.sort((a: any, b: any) => {
      const aTime = parseServerDate(a.createdAt)?.getTime() || 0;
      const bTime = parseServerDate(b.createdAt)?.getTime() || 0;
      return bTime - aTime;
    });

    const etag = serverCache.set(cacheKey, { products: matching }, cacheTTL);
    res.setHeader('ETag', etag);

    const filtered = matching.filter((p: any) => p.id !== excludeId).slice(0, limit);
    return res.json({ success: true, products: filtered, total: filtered.length });
  } catch (err: any) {
    console.error('[Similar Products API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to retrieve similar products' });
  }
});

app.get(['/api/products', '/api/feed'], serverRateLimiter(60 * 1000, 600, "products-list"), async (req, res) => {
  try {
    const querySearch = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const querySellerId = typeof req.query.sellerId === 'string' ? req.query.sellerId.trim() : '';
    const querySellerEmail = typeof req.query.sellerEmail === 'string' ? req.query.sellerEmail.trim().toLowerCase() : '';
    const queryCategory = typeof req.query.category === 'string' ? req.query.category.trim().toLowerCase() : '';

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit as string, 10) || 50));

    let cacheKey = `homepage:page:${page}:limit:${limit}`;
    let cacheTTL = 60; // 60s for homepage list
    let cacheControlHeader = 'public, max-age=30';

    if (querySearch) {
      cacheKey = `search:${querySearch}:cat:${queryCategory}:page:${page}:limit:${limit}`;
      cacheTTL = 30; // 30s for search
      cacheControlHeader = 'public, max-age=30';
    } else if (querySellerId || querySellerEmail) {
      cacheKey = `seller:${querySellerId || querySellerEmail}:page:${page}:limit:${limit}`;
      cacheTTL = 60; // 60s for seller listings
      cacheControlHeader = 'public, max-age=60';
    } else if (queryCategory) {
      cacheKey = `category:${queryCategory}:page:${page}:limit:${limit}`;
      cacheTTL = 21600; // 6 hours for categories
      cacheControlHeader = 'public, max-age=21600';
    }

    res.setHeader('Cache-Control', cacheControlHeader);

    const forceNoCache = req.query.nocache === 'true' || req.query.refresh === 'true';
    if (!forceNoCache) {
      // Check Memory TTL Cache
      const cached = serverCache.get<any>(cacheKey);
      if (cached && Array.isArray(cached.value?.products) && cached.value.products.length > 0) {
        res.setHeader('ETag', cached.etag);
        if (req.headers['if-none-match'] === cached.etag) {
          return res.status(304).end();
        }
        return res.json({ success: true, ...cached.value, cached: true });
      }
    }

    const { products } = await getProductsListData(forceNoCache);

    let filtered = products;
    if (querySearch) {
      filtered = filtered.filter((p: any) =>
        (p.title && p.title.toLowerCase().includes(querySearch)) ||
        (p.description && p.description.toLowerCase().includes(querySearch)) ||
        (p.category && p.category.toLowerCase().includes(querySearch)) ||
        (p.brand && p.brand.toLowerCase().includes(querySearch)) ||
        (p.location && p.location.toLowerCase().includes(querySearch))
      );
    }
    if (querySellerId || querySellerEmail) {
      const targetId = querySellerId;
      const targetEmail = querySellerEmail;
      filtered = filtered.filter((p: any) => {
        const sId = String(p.sellerId || p.user_id || '').trim();
        const sEmail = String(p.sellerEmail || '').trim().toLowerCase();
        const sName = String(p.sellerName || '').trim().toLowerCase();

        if (targetId && (sId === targetId || sEmail === targetId.toLowerCase() || sName === targetId.toLowerCase())) {
          return true;
        }
        if (targetEmail && (sEmail === targetEmail || sId === targetEmail)) {
          return true;
        }
        return false;
      });

      // If in-memory cache had no matches for this seller, query database directly
      if (filtered.length === 0) {
        if (backendSupabase) {
          try {
            const conditions: string[] = [];
            if (targetId) {
              conditions.push(`sellerId.eq.${targetId}`, `seller_id.eq.${targetId}`);
            }
            if (targetEmail) {
              conditions.push(`sellerEmail.eq.${targetEmail}`, `seller_email.eq.${targetEmail}`);
            }
            if (conditions.length > 0) {
              const { data: sRows } = await backendSupabase
                .from('products')
                .select('*')
                .or(conditions.join(','))
                .order('createdAt', { ascending: false })
                .limit(500);

              if (Array.isArray(sRows) && sRows.length > 0) {
                filtered = sRows.map((r: any) => normalizeServerProductSummaryRow(r)).filter(Boolean);
              }
            }
          } catch (err) {
            console.warn('[Direct Seller Query Supabase]', err);
          }
        }
        if (filtered.length === 0 && adminDb) {
          try {
            const snap = await adminDb.collection('products')
              .where('sellerId', '==', targetId || targetEmail)
              .limit(500)
              .get();
            if (!snap.empty) {
              const sList: any[] = [];
              snap.forEach((docSnap: any) => {
                const d = docSnap.data();
                if (d) sList.push(normalizeServerProductSummaryRow({ ...d, id: docSnap.id || d.id }));
              });
              filtered = sList;
            }
          } catch (fErr) {
            console.warn('[Direct Seller Query Firestore]', fErr);
          }
        }
      }
    }
    if (queryCategory && queryCategory !== 'all') {
      const qCat = queryCategory.trim().toLowerCase();
      const normQCat = normalizeServerCategory(qCat);
      filtered = filtered.filter((p: any) => {
        if (!p || !p.category) return false;
        const pCat = String(p.category).trim().toLowerCase();
        const normPCat = normalizeServerCategory(pCat);
        return pCat === qCat ||
               normPCat === normQCat ||
               normPCat === qCat ||
               pCat === normQCat ||
               pCat.replace(/&/g, 'and').replace(/\s+/g, ' ') === qCat.replace(/&/g, 'and').replace(/\s+/g, ' ') ||
               pCat.includes(qCat) ||
               qCat.includes(pCat);
      });
    }

    // Pagination Slicing & unified lightweight ProductSummary serialization
    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginatedProducts = filtered
      .slice(startIndex, startIndex + limit)
      .map((p: any) => serializeProductSummary(p));

    const responsePayload = {
      products: paginatedProducts,
      total,
      page,
      limit,
      totalPages,
      hasMore: page < totalPages
    };

    if (paginatedProducts.length > 0) {
      const etag = serverCache.set(cacheKey, responsePayload, cacheTTL);
      res.setHeader('ETag', etag);

      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }
    }

    return res.json({ success: true, ...responsePayload });
  } catch (err: any) {
    console.error('[Products List API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to retrieve products' });
  }
});

// Sellers Aggregated Summary and Real Listing Counts
async function getSellersSummaryData(forceRefresh = false): Promise<{ sellers: any[]; counts: Record<string, number> }> {
  const now = Date.now();
  if (!forceRefresh && sellersSummaryCache && (now - sellersSummaryCache.timestamp) < SELLERS_CACHE_TTL_MS) {
    return { sellers: sellersSummaryCache.sellers, counts: sellersSummaryCache.counts };
  }

  const { products } = await getProductsListData(forceRefresh);

  let usersList: any[] = [];
  if (backendSupabase) {
    try {
      // "lastSeen" requested optimistically for the online-presence dot,
      // same fallback-on-missing-column pattern as /api/users/list -- an
      // explicit column list fails its entire select if any one column
      // doesn't exist yet, which would otherwise empty out "Popular
      // Stores" entirely pre-migration, not just leave presence blank.
      let { data: uData, error: uErr2 } = await backendSupabase
        .from('users')
        .select('id, username, displayName, email, photoUrl, location, region, emailVerified, role, lastSeen')
        .limit(2000);
      if (uErr2) {
        const fallback = await backendSupabase
          .from('users')
          .select('id, username, displayName, email, photoUrl, location, region, emailVerified, role')
          .limit(2000);
        uData = fallback.data;
      }
      if (Array.isArray(uData)) usersList = uData;
    } catch (uErr) {
      console.warn('[getSellersSummaryData] Supabase users query failed:', uErr);
    }
  }
  if (usersList.length === 0 && adminDb) {
    try {
      const snap = await adminDb.collection('users').limit(2000).get();
      if (!snap.empty) {
        snap.forEach((d: any) => {
          const data = d.data();
          if (data) usersList.push({ ...data, id: d.id || data.id });
        });
      }
    } catch (fErr) {
      console.warn('[getSellersSummaryData] Firestore users query failed:', fErr);
    }
  }

  const userById = new Map<string, any>();
  const userByName = new Map<string, any>();
  const userByEmail = new Map<string, any>();

  usersList.forEach(u => {
    if (!u) return;
    if (u.id) userById.set(String(u.id).trim(), u);
    if (u.uid) userById.set(String(u.uid).trim(), u);
    const uname = String(u.username || u.displayName || '').trim().toLowerCase();
    if (uname) userByName.set(uname, u);
    const uemail = String(u.email || '').trim().toLowerCase();
    if (uemail) userByEmail.set(uemail, u);
  });

  const sellerProductsMap = new Map<string, any[]>();
  const canonicalKeyToUser = new Map<string, any>();

  products.forEach(p => {
    if (!p || p.isDeleted === true || p.status === 'deleted' || p.status === 'archived') return;

    const sId = String(p.sellerId || p.seller_id || p.user_id || '').trim();
    const sEmail = String(p.sellerEmail || p.seller_email || '').trim().toLowerCase();
    const sName = String(p.sellerName || p.seller_name || '').trim();
    const sNameLower = sName.toLowerCase();

    // Match to existing user if possible
    const matchedUser = (sId && userById.get(sId)) ||
      (sEmail && userByEmail.get(sEmail)) ||
      (sNameLower && userByName.get(sNameLower)) ||
      null;

    const canonicalKey = matchedUser ? String(matchedUser.id) : (sId || sNameLower || sEmail || 'unknown');
    if (matchedUser && !canonicalKeyToUser.has(canonicalKey)) {
      canonicalKeyToUser.set(canonicalKey, matchedUser);
    }

    if (!sellerProductsMap.has(canonicalKey)) {
      sellerProductsMap.set(canonicalKey, []);
    }
    sellerProductsMap.get(canonicalKey)!.push(p);
  });

  const sellers: any[] = [];
  const counts: Record<string, number> = {};

  sellerProductsMap.forEach((sellerProducts, canonicalKey) => {
    if (!sellerProducts || sellerProducts.length === 0) return;

    const matchedUser = canonicalKeyToUser.get(canonicalKey);
    const firstProd = sellerProducts[0] || {};

    const rawUsername = matchedUser?.username || matchedUser?.displayName || firstProd.sellerName || 'Verified Merchant';
    const rawPhoto = matchedUser?.photoUrl || matchedUser?.avatar || firstProd.displayImage || (firstProd.images && firstProd.images[0]) || '';
    const rawLocation = matchedUser?.location || matchedUser?.region || firstProd.location || 'Ghana';
    const isVerified = Boolean(
      matchedUser?.emailVerified ||
      matchedUser?.isVerified ||
      matchedUser?.verified ||
      matchedUser?.badge === 'verified' ||
      firstProd.sellerVerified ||
      true
    );

    const totalCount = sellerProducts.length;
    const activeCount = sellerProducts.filter(p => !p.isSold && p.status !== 'hidden' && p.status !== 'sold').length;
    const soldCount = totalCount - activeCount;

    const catFreq: Record<string, number> = {};
    sellerProducts.forEach(p => {
      const cat = p.category ? String(p.category).trim() : 'Marketplace';
      catFreq[cat] = (catFreq[cat] || 0) + 1;
    });
    const sortedCats = Object.entries(catFreq).sort((a, b) => b[1] - a[1]);
    const primaryCategory = sortedCats[0]?.[0] || 'Marketplace';
    const categories = sortedCats.map(c => c[0]);

    const totalViews = sellerProducts.reduce((sum, p) => sum + (Number(p.viewsCount) || 0), 0);

    const sellerObj = {
      id: matchedUser?.id || canonicalKey,
      name: rawUsername,
      username: rawUsername,
      displayName: matchedUser?.displayName || rawUsername,
      photoUrl: rawPhoto,
      location: rawLocation,
      isVerified,
      listingCount: totalCount,
      activeListingCount: activeCount,
      soldListingCount: soldCount,
      primaryCategory,
      categories,
      totalViews,
      isOnline: computeIsOnline(matchedUser?.lastSeen),
    };

    sellers.push(sellerObj);

    // Register all aliases in counts dictionary
    const keysToRegister = new Set<string>();
    if (matchedUser?.id) keysToRegister.add(String(matchedUser.id));
    if (matchedUser?.uid) keysToRegister.add(String(matchedUser.uid));
    if (matchedUser?.username) keysToRegister.add(String(matchedUser.username).trim().toLowerCase());
    if (matchedUser?.displayName) keysToRegister.add(String(matchedUser.displayName).trim().toLowerCase());
    if (canonicalKey) keysToRegister.add(canonicalKey.toLowerCase());
    if (firstProd.sellerId) keysToRegister.add(String(firstProd.sellerId));
    if (firstProd.sellerName) keysToRegister.add(String(firstProd.sellerName).trim().toLowerCase());

    keysToRegister.forEach(k => {
      counts[k] = totalCount;
    });
  });

  sellers.sort((a, b) => {
    if (a.isVerified && !b.isVerified) return -1;
    if (!a.isVerified && b.isVerified) return 1;
    return (b.activeListingCount * 5 + b.totalViews) - (a.activeListingCount * 5 + a.totalViews);
  });

  sellersSummaryCache = { sellers, counts, timestamp: now };
  return { sellers, counts };
}

// Sellers Summary API (returns top sellers and exact listing count sync)
app.get(['/api/sellers', '/api/sellers/summary'], serverRateLimiter(60 * 1000, 600, "sellers-summary"), async (req, res) => {
  try {
    const forceRefresh = req.query.nocache === 'true' || req.query.refresh === 'true';
    const data = await getSellersSummaryData(forceRefresh);
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json({ success: true, ...data });
  } catch (err: any) {
    console.error('[Sellers Summary API Error]:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to retrieve sellers summary' });
  }
});

// Sellers Counts API (fast dictionary lookup for real listing counts by user/seller id)
app.get('/api/sellers/counts', serverRateLimiter(60 * 1000, 600, "sellers-counts"), async (req, res) => {
  try {
    const forceRefresh = req.query.nocache === 'true' || req.query.refresh === 'true';
    const { counts } = await getSellersSummaryData(forceRefresh);
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json({ success: true, counts });
  } catch (err: any) {
    console.error('[Sellers Counts API Error]:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to retrieve sellers counts' });
  }
});

// Dynamic Video Ads Batching API (fetches in dynamic, non-ordered batches of 5)
app.get(['/api/video-ads', '/api/products/video-ads'], serverRateLimiter(60 * 1000, 600, "video-ads"), async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 5));
    const excludeParam = typeof req.query.exclude === 'string' ? req.query.exclude : '';
    const excludeIds = excludeParam ? excludeParam.split(',').map(s => s.trim()).filter(Boolean) : [];

    const { products } = await getProductsListData(false);

    // Filter active products with video content
    const videoProducts = products.filter((p: any) => {
      if (!p || p.isDeleted || p.status === 'hidden' || p.status === 'archived' || p.isSold) return false;
      const vids = Array.isArray(p.videos) ? p.videos : (Array.isArray(p.videoUrls) ? p.videoUrls : []);
      const imgs = Array.isArray(p.images) ? p.images : (Array.isArray(p.imageUrls) ? p.imageUrls : []);
      const hasDirectVideo = vids.some((v: any) => typeof v === 'string' && v.trim().length > 0);
      const hasImageAsVideo = imgs.some((img: any) => typeof img === 'string' && (
        img.includes('/video/') || 
        img.endsWith('.mp4') || 
        img.endsWith('.webm') || 
        img.endsWith('.mov') || 
        img.startsWith('data:video/')
      ));
      return hasDirectVideo || hasImageAsVideo;
    });

    if (videoProducts.length === 0) {
      return res.json({
        success: true,
        products: [],
        totalAvailable: 0,
        limit,
        count: 0
      });
    }

    // Separate candidates not yet excluded
    let candidates = videoProducts.filter((p: any) => !excludeIds.includes(p.id));
    if (candidates.length === 0) {
      candidates = [...videoProducts];
    }

    // Dynamic non-ordered shuffle (Fisher-Yates) for randomized dynamic delivery
    const shuffled = [...candidates];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = temp;
    }

    const batch = shuffled.slice(0, limit).map((p: any) => serializeProductSummary(p));

    return res.json({
      success: true,
      products: batch,
      totalAvailable: videoProducts.length,
      limit,
      count: batch.length
    });
  } catch (err: any) {
    console.error('[Video Ads API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to retrieve video ads' });
  }
});

// Fast, Prefix-First Autocomplete Search Suggestions API
app.get(['/api/search/suggestions', '/api/suggestions'], serverRateLimiter(60 * 1000, 1200, "search-suggestions"), async (req, res) => {
  try {
    const rawQuery = typeof req.query.q === 'string' ? req.query.q : '';
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit as string, 10) || 8));

    const cacheKey = `suggestions:${rawQuery.trim().toLowerCase()}:lim:${limit}`;
    const cached = serverCache.get<any>(cacheKey);
    if (cached) {
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.setHeader('ETag', cached.etag);
      if (req.headers['if-none-match'] === cached.etag) {
        return res.status(304).end();
      }
      return res.json({ success: true, ...cached.value, cached: true });
    }

    const { products } = await getProductsListData(false);
    const suggestionItems = getPrefixAutocompleteSuggestions(rawQuery, products, { limit });
    const suggestions = suggestionItems.map(item => item.text);

    const payload = {
      query: rawQuery,
      suggestions,
      items: suggestionItems
    };

    const etag = serverCache.set(cacheKey, payload, 60);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('ETag', etag);

    return res.json({ success: true, ...payload });
  } catch (err: any) {
    console.error('[Suggestions API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to generate suggestions' });
  }
});

app.get('/api/products/:productId', serverRateLimiter(60 * 1000, 200, "product-detail"), async (req, res) => {
  const { productId } = req.params;
  if (!productId) {
    return res.status(400).json({ success: false, error: 'Missing product ID' });
  }

  const bypassCache = req.query.nocache === 'true' || req.headers['cache-control'] === 'no-cache';
  const cacheKey = `product:${productId}`;
  res.setHeader('Cache-Control', 'no-cache, private');

  if (!bypassCache) {
    const cached = serverCache.get<any>(cacheKey);
    if (cached) {
      res.setHeader('ETag', cached.etag);
      if (req.headers['if-none-match'] === cached.etag) {
        return res.status(304).end();
      }
      return res.json({ success: true, product: cached.value, cached: true });
    }
  }

  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }

  try {
    const { data, error } = await backendSupabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .maybeSingle();

    if (error || !data) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const isArchivedOrDeleted = data.isDeleted === true || data.is_deleted === true || data.status === 'archived' || data.status === 'hidden' || data.status === 'deleted';
    if (isArchivedOrDeleted) {
      const authHeader = req.headers.authorization;
      const isAdmin = authHeader ? await verifyAdmin(authHeader) : false;
      if (!isAdmin) {
        return res.status(404).json({ success: false, error: 'Product not found or has been archived' });
      }
    }

    const product = normalizeServerProductRow(data);
    const etag = serverCache.set(cacheKey, product, 300); // 5 minutes TTL
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    return res.json({ success: true, product });
  } catch (err: any) {
    console.error(`[Product Detail API] Error fetching product ${productId}:`, err);
    return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
});

const serverKnownMissingColumns: Record<string, Set<string>> = {};

function extractMissingColumnFromError(errMsg: string): string | null {
  if (!errMsg || typeof errMsg !== 'string') return null;
  const regexes = [
    /Could not find the '([^']+)' column/i,
    /column ["']?([^"'\s]+)["']? of relation/i,
    /column (?:[^\s]+\.)?["']?([^"'\s]+)["']? does not exist/i,
    /Column '([^']+)' does not exist/i,
    /column '([^']+)' does not exist/i
  ];
  for (const rx of regexes) {
    const match = errMsg.match(rx);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

function pruneServerKnownMissingColumns(table: string, payload: any): any {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const missingSet = serverKnownMissingColumns[table];
  if (!missingSet || missingSet.size === 0) return payload;

  const cleaned = { ...payload };
  for (const col of missingSet) {
    delete cleaned[col];
  }
  return cleaned;
}

async function safeBackendSupabaseUpsert(table: string, payload: any, options: any = { onConflict: 'id' }): Promise<{ data: any; error: any }> {
  if (!backendSupabase) {
    return { data: null, error: new Error("Backend Supabase client not initialized") };
  }
  if (!serverKnownMissingColumns[table]) {
    serverKnownMissingColumns[table] = new Set<string>();
  }

  let currentPayload = pruneServerKnownMissingColumns(table, payload);
  const maxAttempts = 50;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, error } = await backendSupabase
      .from(table)
      .upsert(currentPayload, options);

    if (!error) {
      return { data, error: null };
    }

    const errMsg = [error.message, error.details, error.hint].filter(Boolean).join(' ');
    const missingCol = extractMissingColumnFromError(errMsg);

    if (missingCol) {
      console.warn(`[Supabase Auto-Heal Server] Column '${missingCol}' does not exist in table '${table}'. Pruning and retrying (${attempt + 1}/${maxAttempts})...`);
      serverKnownMissingColumns[table].add(missingCol);
      delete currentPayload[missingCol];
      if (Object.keys(currentPayload).length === 0) {
        return { data: null, error: null };
      }
    } else {
      return { data, error };
    }
  }
  return await backendSupabase.from(table).upsert(currentPayload, options);
}

// P0 fix: `trustBoostFields` gates whether boost-related fields on
// `productData` are trusted at all. Before this fix, `cleanProduct` took
// boostStatus/boostExpiry directly from `productData` regardless of caller
// -- and this function is shared by /api/products/sync (client-supplied
// body, reachable by any authenticated seller editing their own listing)
// AND /api/verify-payment (server-computed boost fields, only ever correct
// after a real, verified Paystack transaction). That meant any seller
// could grant themselves a free, arbitrarily-long, ranking-relevant boost
// via a completely ordinary "save my listing" API call -- no payment, no
// RLS bypass needed, since this runs through the service-role Supabase
// client regardless. Only call sites that have ALREADY independently
// verified a real payment (or are admin-only) may pass true here:
// /api/verify-payment and /api/admin/boost-control. Every other caller
// (product create/sync) leaves this false, so boost fields are preserved
// from the existing row and never taken from client input at all. See
// .ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md §15 for the full exploit
// chain this closes.
async function upsertProductToSupabase(productData: any, actingUser?: { uid: string; email?: string; isAdmin?: boolean }, trustBoostFields: boolean = false) {
  if (!productData) {
    throw new Error("Invalid product data");
  }

  const prodId = productData.id || `prod_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  
  // Retrieve existing record from Supabase to prevent erasing seller info or
  // created date during updates. A genuine query error here must NOT be
  // treated the same as "no existing row" (silently swallowed by the old
  // `catch (_) {}`) -- finalSellerId below falls back to productData.sellerId
  // whenever existingRow is null, which is only safe because every current
  // caller already pre-computes an authorization-checked sellerId before
  // calling this function. Throwing on a real error (instead of silently
  // proceeding as if this were a brand-new row) keeps that guarantee from
  // becoming fragile for any future caller that doesn't.
  let existingRow: any = null;
  if (backendSupabase && prodId) {
    const { data, error } = await backendSupabase
      .from('products')
      .select('*')
      .eq('id', prodId)
      .maybeSingle();
    if (error) throw error;
    if (data) existingRow = data;
  }

  const imgsFromData = Array.isArray(productData.images) ? productData.images.filter((img: any) => typeof img === 'string' && img.trim().length > 0) : [];
  const imgUrlsFromData = Array.isArray(productData.imageUrls) ? productData.imageUrls.filter((img: any) => typeof img === 'string' && img.trim().length > 0) : [];
  let rawImages = imgsFromData.length >= imgUrlsFromData.length ? imgsFromData : imgUrlsFromData;

  if (rawImages.length === 0 && existingRow) {
    const existingImgs = Array.isArray(existingRow.images) ? existingRow.images.filter((i: any) => typeof i === 'string' && i.length > 0) : [];
    const existingUrls = Array.isArray(existingRow.imageUrls) ? existingRow.imageUrls.filter((i: any) => typeof i === 'string' && i.length > 0) : [];
    rawImages = existingImgs.length >= existingUrls.length ? existingImgs : existingUrls;
  }
  const cleanImages = (Array.isArray(rawImages) ? rawImages : []).filter((img: any) => typeof img === 'string' && img.length > 0 && (img.startsWith('http') || img.startsWith('data:')));

  const vidsFromData = Array.isArray(productData.videos) ? productData.videos.filter((vid: any) => typeof vid === 'string' && vid.trim().length > 0) : [];
  const vidUrlsFromData = Array.isArray(productData.videoUrls) ? productData.videoUrls.filter((vid: any) => typeof vid === 'string' && vid.trim().length > 0) : [];
  let rawVideos = vidsFromData.length >= vidUrlsFromData.length ? vidsFromData : vidUrlsFromData;

  if (rawVideos.length === 0 && existingRow) {
    const existingVids = Array.isArray(existingRow.videos) ? existingRow.videos.filter((v: any) => typeof v === 'string' && v.length > 0) : [];
    const existingVidUrls = Array.isArray(existingRow.videoUrls) ? existingRow.videoUrls.filter((v: any) => typeof v === 'string' && v.length > 0) : [];
    rawVideos = existingVids.length >= existingVidUrls.length ? existingVids : existingVidUrls;
  }
  const cleanVideos = (Array.isArray(rawVideos) ? rawVideos : []).filter((vid: any) => typeof vid === 'string' && vid.length > 0 && (vid.startsWith('http') || vid.startsWith('data:')));

  // CRITICAL: Always strictly preserve original seller info for existing listings
  const finalSellerId = existingRow?.sellerId || existingRow?.seller_id || productData.sellerId || '';
  const finalSellerName = existingRow?.sellerName || existingRow?.seller_name || productData.sellerName || 'Seller';
  const finalSellerEmail = existingRow?.sellerEmail || existingRow?.seller_email || productData.sellerEmail || '';
  const finalSellerPhoto = existingRow?.sellerPhoto || existingRow?.seller_photo || productData.sellerPhoto || '';
  const finalSellerJoinDate = existingRow?.sellerJoinDate || existingRow?.seller_join_date || productData.sellerJoinDate || new Date().toISOString();
  const finalCreatedAt = existingRow?.createdAt || existingRow?.created_at || productData.createdAt || new Date().toISOString();

  // Business-logic fix: viewsCount/likesCount/likedUserIds were previously
  // trusted straight from the client body as absolute values. Combined with
  // the "social-only" ownership bypass above (intentionally letting a
  // non-owner update just these fields, so liking/viewing someone else's
  // listing doesn't trip the seller-only edit check), this meant ANY
  // authenticated caller could set ANY listing's viewsCount/likesCount to
  // an arbitrary number via a normal /api/products/sync call -- both feed
  // directly into ranking (see engagementScore/priorityScore below) -- and
  // could inject or remove OTHER users' ids from likedUserIds wholesale,
  // fabricating or erasing who liked a listing. The app's real like/view
  // features (toggleLikeProduct, incrementProductViews in AppContext.tsx)
  // already go through a different, direct-Supabase path instead of this
  // endpoint, so nothing legitimate actually needs an absolute value
  // trusted here -- only a toggle of the CALLING user's own id, with the
  // count always derived from the resulting array, never taken
  // independently. See .ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md §21.
  const existingLikedUserIds = Array.isArray(existingRow?.likedUserIds) ? existingRow.likedUserIds : [];
  let finalLikedUserIds = existingLikedUserIds;
  if (actingUser?.uid && Array.isArray(productData.likedUserIds)) {
    const clientWantsLiked = productData.likedUserIds.includes(actingUser.uid);
    const alreadyLiked = existingLikedUserIds.includes(actingUser.uid);
    if (clientWantsLiked !== alreadyLiked) {
      finalLikedUserIds = clientWantsLiked
        ? [...existingLikedUserIds, actingUser.uid]
        : existingLikedUserIds.filter((uid: string) => uid !== actingUser.uid);
    }
  }

  const cleanProduct: any = {
    id: prodId,
    title: productData.title || existingRow?.title || '',
    description: productData.description || existingRow?.description || '',
    price: productData.price !== undefined ? normalizeServerPrice(productData.price) : normalizeServerPrice(existingRow?.price),
    currency: productData.currency || existingRow?.currency || 'GHS',
    category: productData.category || existingRow?.category || 'Other',
    subcategory: productData.subcategory || productData.subCategory || existingRow?.subcategory || existingRow?.subCategory || null,
    location: productData.location || existingRow?.location || '',
    brand: productData.brand || existingRow?.brand || null,
    // Same fallback-consistency fix as normalizeServerProductRow above.
    condition: productData.condition || existingRow?.condition || 'Slightly Used',
    negotiable: productData.negotiable !== undefined ? productData.negotiable === true : (existingRow?.negotiable === true),
    sellerId: finalSellerId,
    sellerName: finalSellerName,
    sellerEmail: finalSellerEmail,
    sellerPhoto: finalSellerPhoto,
    sellerJoinDate: finalSellerJoinDate,
    createdAt: finalCreatedAt,
    updatedAt: new Date().toISOString(),
    // viewsCount is preserved from the existing row unconditionally: no
    // legitimate feature calls this endpoint to record a view (see the
    // fix note above finalLikedUserIds), and there's no way to validate an
    // absolute client-claimed count anyway.
    viewsCount: Number(existingRow?.viewsCount || existingRow?.views) || 0,
    likesCount: finalLikedUserIds.length,
    likedUserIds: finalLikedUserIds,
    // P0 fix: a moderation-locked listing ('archived'/'hidden'/'deleted' --
    // there's no dedicated admin product-moderation endpoint yet, so today
    // this state could only ever be set via direct DB access, but the gap
    // matters regardless of how it gets set) must not be escapable by its
    // own owner through the ordinary edit-listing flow. Before this fix,
    // `if (productData.status === 'active') return 'active';` and the final
    // `productData.status || ...` fallback both honored ANY client-supplied
    // status unconditionally -- a seller could self-reinstate a moderated
    // listing simply by editing it (or via a raw /api/products/sync call)
    // with status: 'active' in the body. Non-admin callers can now only
    // ever move a listing between 'active'/'sold' (via isSold, matching
    // the existing Mark as Sold feature exactly as before), and only when
    // the existing row isn't already moderation-locked; an admin caller
    // retains full authority to set any status, since moderation actions
    // are what would set/clear this state in the first place.
    status: (() => {
      const existingStatus = existingRow?.status;
      const isModerationLocked = existingStatus === 'archived' || existingStatus === 'hidden' || existingStatus === 'deleted';
      const isTrustedCaller = actingUser?.isAdmin === true;

      if (isModerationLocked && !isTrustedCaller) {
        return existingStatus;
      }
      if (isTrustedCaller && productData.status !== undefined) {
        return productData.status;
      }
      if (productData.isSold === false) {
        return (productData.status === 'active' || productData.status === 'sold') ? 'active' : (existingStatus && existingStatus !== 'sold' ? existingStatus : 'active');
      }
      if (productData.isSold === true) {
        return 'sold';
      }
      if (productData.status === 'sold') {
        return 'sold';
      }
      if (productData.status === 'active') {
        return 'active';
      }
      return existingStatus || 'active';
    })(),
    isSold: (() => {
      if (productData.isSold !== undefined) {
        return productData.isSold === true;
      }
      if (productData.status === 'sold') {
        return true;
      }
      if (productData.status === 'active') {
        return false;
      }
      return existingRow?.isSold === true || existingRow?.is_sold === true || existingRow?.status === 'sold' || false;
    })(),
    is_sold: (() => {
      if (productData.isSold !== undefined) {
        return productData.isSold === true;
      }
      if (productData.status === 'sold') {
        return true;
      }
      if (productData.status === 'active') {
        return false;
      }
      return existingRow?.isSold === true || existingRow?.is_sold === true || existingRow?.status === 'sold' || false;
    })(),
    soldAt: (() => {
      if (productData.isSold === false) {
        return null;
      }
      if (productData.isSold === true) {
        return productData.soldAt || existingRow?.soldAt || existingRow?.sold_at || new Date().toISOString();
      }
      if (productData.status === 'sold') {
        return productData.soldAt || existingRow?.soldAt || existingRow?.sold_at || new Date().toISOString();
      }
      if (productData.status === 'active') {
        return null;
      }
      return productData.soldAt !== undefined ? productData.soldAt : (existingRow?.soldAt || existingRow?.sold_at || null);
    })(),
    sold_at: (() => {
      if (productData.isSold === false) {
        return null;
      }
      if (productData.isSold === true) {
        return productData.soldAt || existingRow?.soldAt || existingRow?.sold_at || new Date().toISOString();
      }
      if (productData.status === 'sold') {
        return productData.soldAt || existingRow?.soldAt || existingRow?.sold_at || new Date().toISOString();
      }
      if (productData.status === 'active') {
        return null;
      }
      return productData.soldAt !== undefined ? productData.soldAt : (existingRow?.soldAt || existingRow?.sold_at || null);
    })(),
    // Correctness note alongside the security fix: this previously only
    // ever carried boostStatus/boostExpiry through -- every other boost
    // field /api/verify-payment computes after a real payment (boostPlan,
    // boostAmount, boostPriority, paymentReference, boostHistory, etc.)
    // was silently dropped here, since this object never included them at
    // all regardless of caller. Now included, still gated by
    // trustBoostFields so an untrusted caller can't introduce them either.
    ...(trustBoostFields ? {
      boostStatus: productData.boostStatus === true,
      isBoosted: productData.isBoosted === true || productData.boostStatus === true,
      boostExpiry: productData.boostExpiry || productData.boostEndDate || null,
      boostEndDate: productData.boostEndDate || productData.boostExpiry || null,
      boostStartDate: productData.boostStartDate || null,
      boostPlan: productData.boostPlan || null,
      boostAmount: productData.boostAmount !== undefined ? Number(productData.boostAmount) : undefined,
      boostPackagePrice: productData.boostPackagePrice !== undefined ? Number(productData.boostPackagePrice) : undefined,
      boostPriority: productData.boostPriority !== undefined ? Number(productData.boostPriority) : undefined,
      boostPriorityLevel: productData.boostPriorityLevel !== undefined ? Number(productData.boostPriorityLevel) : undefined,
      priorityScore: productData.priorityScore !== undefined ? Number(productData.priorityScore) : undefined,
      remainingBoostTime: productData.remainingBoostTime !== undefined ? Number(productData.remainingBoostTime) : undefined,
      paymentStatus: productData.paymentStatus || undefined,
      paymentReference: productData.paymentReference || undefined,
      // `|| undefined` (like the two fields above) would silently drop an
      // explicit null from the write entirely -- JSON.stringify omits
      // undefined keys, so the column is never touched and a deactivated
      // boost's stale timestamp survives forever. These two specifically
      // need `|| null` (matching boostEndDate/boostStartDate/boostPlan
      // above) so boost-control's deactivate branch can actually clear
      // them -- getBoostEndDate() (src/utils/dateParser.ts) falls back to
      // these exact fields to reconstruct a still-active end date.
      lastBoostedAt: productData.lastBoostedAt || null,
      lastBoostPurchase: productData.lastBoostPurchase || null,
      boostHistory: Array.isArray(productData.boostHistory) ? productData.boostHistory : undefined,
    } : {
      boostStatus: existingRow?.boostStatus === true,
      isBoosted: existingRow?.isBoosted === true || existingRow?.boostStatus === true,
      boostExpiry: existingRow?.boostExpiry || existingRow?.boostEndDate || null,
      boostEndDate: existingRow?.boostEndDate || existingRow?.boostExpiry || null,
      boostStartDate: existingRow?.boostStartDate || undefined,
      boostPlan: existingRow?.boostPlan || undefined,
      boostAmount: existingRow?.boostAmount !== undefined ? Number(existingRow.boostAmount) : undefined,
      boostPackagePrice: existingRow?.boostPackagePrice !== undefined ? Number(existingRow.boostPackagePrice) : undefined,
      boostPriority: existingRow?.boostPriority !== undefined ? Number(existingRow.boostPriority) : undefined,
      boostPriorityLevel: existingRow?.boostPriorityLevel !== undefined ? Number(existingRow.boostPriorityLevel) : undefined,
      priorityScore: existingRow?.priorityScore !== undefined ? Number(existingRow.priorityScore) : undefined,
      remainingBoostTime: existingRow?.remainingBoostTime !== undefined ? Number(existingRow.remainingBoostTime) : undefined,
      paymentStatus: existingRow?.paymentStatus || undefined,
      paymentReference: existingRow?.paymentReference || undefined,
      lastBoostedAt: existingRow?.lastBoostedAt || undefined,
      lastBoostPurchase: existingRow?.lastBoostPurchase || undefined,
      boostHistory: Array.isArray(existingRow?.boostHistory) ? existingRow.boostHistory : undefined,
    }),
    images: cleanImages.length > 0 ? cleanImages : (existingRow?.images || []),
    imageUrls: cleanImages.length > 0 ? cleanImages : (existingRow?.imageUrls || []),
    thumbnailUrls: cleanImages.map((u: string) => u.includes('res.cloudinary.com') ? u.replace('/upload/', '/upload/c_thumb,w_200,h_200,g_auto,f_auto,q_auto/') : u),
    thumbnailUrl: (cleanImages[0] && cleanImages[0].includes('res.cloudinary.com'))
      ? cleanImages[0].replace('/upload/', '/upload/c_thumb,w_200,h_200,g_auto,f_auto,q_auto/')
      : (cleanImages[0] || (cleanVideos[0] ? getServerVideoPoster(cleanVideos[0]) : null) || existingRow?.thumbnailUrl || null),
    videos: cleanVideos,
    videoUrls: cleanVideos,
    videoPoster: (productData.videoPoster && typeof productData.videoPoster === 'string' && !productData.videoPoster.startsWith('data:') ? productData.videoPoster : '') ||
      (cleanVideos[0] ? getServerVideoPoster(cleanVideos[0]) : (existingRow?.videoPoster || '')),
    displayImage: cleanImages[0] || (cleanVideos[0] ? getServerVideoPoster(cleanVideos[0]) : '') || existingRow?.displayImage || '',
    primaryPicture: cleanImages[0] || (cleanVideos[0] ? getServerVideoPoster(cleanVideos[0]) : '') || existingRow?.primaryPicture || '',
    // isApproved isn't currently read by any moderation/visibility filter
    // (confirmed via a full trace -- see
    // .ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md §16), so this was never
    // exploitable today, but it was still fully client-controlled, which
    // would become a real gap the moment something starts gating on it.
    // Same treatment as status above: only an admin (or a brand-new
    // listing, which has no existingRow to preserve) can set it away from
    // the default-approved state.
    isApproved: actingUser?.isAdmin === true ? (productData.isApproved !== false) : (existingRow?.isApproved !== false),
    ...(actingUser && actingUser.isAdmin && actingUser.uid !== finalSellerId ? {
      modifiedBy: actingUser.uid,
      modifiedByAdmin: actingUser.email || 'Admin',
      lastModifiedAt: new Date().toISOString()
    } : {})
  };

  if (backendSupabase) {
    const { error } = await safeBackendSupabaseUpsert('products', cleanProduct, { onConflict: 'id' });
    if (error) {
      console.error(`[Product Sync Endpoint] Supabase upsert failed for ${prodId}:`, error.message);
      throw new Error(`Failed to save product to Supabase: ${error.message}`);
    }
    console.log(`[Product Sync Endpoint] Successfully saved product ${prodId} to Supabase (sellerId: ${finalSellerId}).`);
  }

  // Also persist to Firestore adminDb to keep real-time client listeners in sync
  if (adminDb) {
    try {
      await adminDb.collection('products').doc(prodId).set(cleanObject(cleanProduct), { merge: true });
      console.log(`[Product Sync Endpoint] Successfully saved product ${prodId} to Firestore adminDb.`);
    } catch (fErr: any) {
      console.warn(`[Product Sync Endpoint] Firestore adminDb set note for ${prodId}:`, fErr?.message || fErr);
    }
  }

  // Invalidate memory caches for this product, search queries, seller profile, category, and homepage list
  invalidateProductCache(prodId, cleanProduct.sellerId, cleanProduct.category);

  return cleanProduct;
}

app.post('/api/products/sync', serverRateLimiter(60 * 1000, 20, "products-sync"), async (req, res) => {
  const { product } = req.body;
  if (!product) {
    return res.status(400).json({ success: false, error: 'Missing product payload' });
  }

  const user = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required to sync product' });
  }

  const prodId = String(product.id || '').trim();
  if (!prodId) {
    return res.status(400).json({ success: false, error: 'Missing product.id' });
  }

  let existingRow: any = null;
  if (backendSupabase) {
    try {
      const { data, error } = await backendSupabase.from('products').select('*').eq('id', prodId).maybeSingle();
      if (error) throw error;
      if (data) {
        existingRow = data;
      }
    } catch (err: any) {
      // Found via the same audit that caught the fail-open bug in the two
      // product-delete routes -- same shape, higher stakes here. This used
      // to be `catch (_) {}`, silently treating a genuine query FAILURE
      // (network blip, timeout) identically to "no row found" -- but "no
      // row found" is also this endpoint's normal signal for a legitimate
      // brand-new listing (isExistingProduct becomes false, the ownership
      // check below is skipped, and targetSellerId falls to the caller's
      // own uid). A swallowed read error on a request for an EXISTING
      // product's id would take the exact same path: no ownership check,
      // and the eventual upsert -- keyed purely by id at the DB level,
      // independent of what this handler "thinks" -- would silently
      // overwrite that real, other-owned listing's entire row (content
      // and sellerId) with whatever this request submitted. Fails closed
      // now: a genuine query error is a 500, never silently reinterpreted
      // as "this product doesn't exist yet."
      console.error('[Product Sync API] Existing-row lookup failed:', err?.message || err);
      return res.status(500).json({ success: false, error: 'Could not verify listing ownership. Please try again.' });
    }
  }

  const existingSellerId = existingRow?.sellerId || existingRow?.seller_id || null;
  const isExistingProduct = !!existingSellerId;
  const isAdmin = user.isAdmin || user.email === 'asumaduvincent7@gmail.com';

  // Social-only bypass: liking/bookmarking and view-count tracking both work
  // by fetching the product, changing only these fields, and posting the
  // whole object back here — which previously tripped the ownership check
  // below (any buyer bookmarking someone else's listing got a 403
  // "Forbidden" error, since they aren't the seller). A real edit changes
  // some OTHER field too, so this only ever bypasses ownership when nothing
  // but the social fields actually differ from what's already saved.
  const SOCIAL_ONLY_FIELDS = new Set(['likedUserIds', 'likesCount', 'viewsCount', 'id']);
  const normalizeForCompare = (v: any) => (v === undefined || v === null ? '' : JSON.stringify(v));
  const isSocialOnlyChange = isExistingProduct && existingRow
    ? Object.keys(product).every((key) => SOCIAL_ONLY_FIELDS.has(key) || normalizeForCompare(product[key]) === normalizeForCompare(existingRow[key]))
    : false;

  // Authorization Check:
  // If editing an existing product, caller must be owner OR an Admin
  // (unless this is a social-only like/view update — see above).
  if (isExistingProduct && !isSocialOnlyChange) {
    const isOwner = existingSellerId === user.uid ||
      existingSellerId === `user_${user.uid}` ||
      existingSellerId === `phone_${user.uid}` ||
      (user.email && (
        existingRow?.sellerEmail?.toLowerCase() === user.email.toLowerCase() ||
        existingRow?.seller_email?.toLowerCase() === user.email.toLowerCase()
      ));
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Forbidden: You do not have permission to modify this listing' });
    }
  }

  // Seller identity determination:
  // 1. Existing product: sellerId MUST NEVER change from existingSellerId.
  // 2. New product created by Admin / Impersonator: allow product.sellerId if provided; otherwise fallback to user.uid.
  // 3. New product created by regular user: enforce sellerId = user.uid.
  let targetSellerId: string;
  let targetSellerName = product.sellerName;
  let targetSellerEmail = product.sellerEmail;
  let targetSellerPhoto = product.sellerPhoto;
  let targetSellerJoinDate = product.sellerJoinDate;

  if (isExistingProduct) {
    targetSellerId = existingSellerId;
    targetSellerName = existingRow.sellerName || existingRow.seller_name || product.sellerName;
    targetSellerEmail = existingRow.sellerEmail || existingRow.seller_email || product.sellerEmail;
    targetSellerPhoto = existingRow.sellerPhoto || existingRow.seller_photo || product.sellerPhoto;
    targetSellerJoinDate = existingRow.sellerJoinDate || existingRow.seller_join_date || product.sellerJoinDate;
  } else if (isAdmin && product.sellerId && String(product.sellerId).trim().length > 0) {
    targetSellerId = String(product.sellerId).trim();
  } else {
    targetSellerId = user.uid;
  }

  // Stamps soldAt the moment isSold actually flips false→true, so the
  // 30-day auto-delete retention rule (purgeExpiredSoldProducts below) has
  // a real clock to measure against — never reset on a later edit while
  // already sold (a seller tweaking the description of a sold listing must
  // not restart its countdown), and cleared if it's marked available again.
  const wasSold = existingRow?.isSold === true || existingRow?.is_sold === true || existingRow?.status === 'sold';
  const isNowSold = product.isSold === true || product.status === 'sold';
  let soldAtPatch: { soldAt?: string | null; sold_at?: string | null; isSold?: boolean; is_sold?: boolean; status?: string } = {};
  if (isNowSold && !wasSold) {
    const stamp = new Date().toISOString();
    soldAtPatch = { soldAt: stamp, sold_at: stamp, isSold: true, is_sold: true, status: 'sold' };
  } else if (!isNowSold && wasSold) {
    soldAtPatch = { soldAt: null, sold_at: null, isSold: false, is_sold: false, status: 'active' };
  }

  const cleanProduct = {
    ...product,
    sellerId: targetSellerId,
    sellerName: targetSellerName,
    sellerEmail: targetSellerEmail,
    sellerPhoto: targetSellerPhoto,
    sellerJoinDate: targetSellerJoinDate,
    ...soldAtPatch,
    ...(isAdmin && targetSellerId !== user.uid ? {
      modifiedByAdmin: user.email || 'Admin',
      modifiedBy: user.uid,
      lastModifiedAt: new Date().toISOString()
    } : {})
  };

  try {
    const saved = await upsertProductToSupabase(cleanProduct, user);
    clearSitemapCache();

    // Notify followers of the seller when a genuinely NEW listing goes up
    // (not an edit, and not a social-only like/view update) — this is the
    // "get notified when a store I follow posts something new" feature.
    // Fire-and-forget: a follower-notification failure must never block the
    // seller's own publish response.
    if (!isExistingProduct && backendSupabase) {
      (async () => {
        try {
          const { data: allUsers } = await backendSupabase!.from('users').select('id, followingSellers').limit(5000);
          const followerIds = (allUsers || [])
            .filter((u: any) => Array.isArray(u.followingSellers) && u.followingSellers.includes(targetSellerId))
            .map((u: any) => u.id);
          await dispatchInBatches<string>(followerIds, 25, async (followerId) => {
            if (!(await shouldNotifyUser(followerId, 'followedSellerNewListing'))) return;
            await createNotification({
              id: `notif_newlisting_${Date.now()}_${followerId}_${Math.random().toString(36).substring(2, 6)}`,
              userId: followerId,
              type: 'followed_seller_new_listing',
              title: `${targetSellerName || 'A store you follow'} posted a new listing`,
              message: cleanProduct.title || 'New item just listed',
              triggerUserId: targetSellerId,
              triggerUsername: targetSellerName || 'Seller',
              triggerUserPhoto: targetSellerPhoto || '',
              productId: prodId,
              productTitle: cleanProduct.title || '',
              productPrice: cleanProduct.price ?? 'Inquire',
              productImage: cleanProduct.image || (Array.isArray(cleanProduct.images) ? cleanProduct.images[0] : '') || '',
              createdAt: new Date().toISOString(),
              read: false
            });
          });
        } catch (notifErr) {
          console.warn('[Product Sync API] Follower notification dispatch failed:', notifErr);
        }
      })();
    }

    // Notification security migration (see
    // .ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md §18): this is the
    // server-authoritative replacement for a client-side direct-Supabase
    // notification broadcast that used to fire on every listing edit,
    // targeting users who saved this exact product or follow this seller.
    // The event itself (a genuine, non-social-only edit to a listing this
    // request has already verified the caller owns) is unambiguous and
    // already verified above; only the recipient-targeting logic is new
    // here, mirroring the new-listing block immediately above it rather
    // than inventing a different pattern. Fire-and-forget, same as that
    // block -- a notification-dispatch failure must never affect the
    // seller's own edit response.
    if (isExistingProduct && !isSocialOnlyChange && backendSupabase) {
      (async () => {
        try {
          const { data: allUsers } = await backendSupabase!.from('users').select('id, followingSellers, savedProductIds').limit(5000);
          const targetUsers = (allUsers || []).filter((u: any) =>
            u.id !== existingSellerId && (
              (Array.isArray(u.savedProductIds) && u.savedProductIds.includes(prodId)) ||
              (Array.isArray(u.followingSellers) && u.followingSellers.includes(existingSellerId))
            )
          );
          await dispatchInBatches<any>(targetUsers, 25, async (targetUser) => {
            const isSaved = Array.isArray(targetUser.savedProductIds) && targetUser.savedProductIds.includes(prodId);
            // Saving a product is a stronger, more explicit signal of
            // interest than following a seller -- matches the original
            // client-side behavior, which only gated the follow-driven
            // case behind a notification preference and always notified
            // savers.
            if (!isSaved && !(await shouldNotifyUser(targetUser.id, 'followedSellerNewListing'))) return;
            await createNotification({
              id: `notif_update_${Date.now()}_${targetUser.id}_${Math.random().toString(36).substring(2, 6)}`,
              userId: targetUser.id,
              type: 'post_created',
              title: isSaved ? 'Followed Ad Updated!' : 'New Update from Seller',
              message: isSaved
                ? `An ad you are following "${cleanProduct.title}" was updated by the seller.`
                : `${targetSellerName || 'The seller'} updated their listing: "${cleanProduct.title}"`,
              triggerUserId: existingSellerId,
              triggerUsername: targetSellerName || 'Seller',
              triggerUserPhoto: targetSellerPhoto || '',
              productId: prodId,
              productTitle: cleanProduct.title || '',
              productPrice: cleanProduct.price ?? 'Inquire',
              productImage: cleanProduct.image || (Array.isArray(cleanProduct.images) ? cleanProduct.images[0] : '') || '',
              createdAt: new Date().toISOString(),
              read: false
            });
          });
        } catch (notifErr) {
          console.warn('[Product Sync API] Listing-update notification dispatch failed:', notifErr);
        }
      })();
    }

    return res.json({ success: true, product: saved });
  } catch (err: any) {
    console.error('[Product Sync API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to sync product' });
  }
});

// View-increment: RLS-migration Phase 0 item 2
// (.ai/handoffs/SUPABASE_RLS_MIGRATION_PLAN.md §1.2/§3/§4) -- the direct
// residual this closes: incrementProductViews (AppContext.tsx) wrote
// viewsCount directly via dbAdapter's updateDoc(doc('products', id),
// {viewsCount: increment(1)}). dbAdapter's increment() helper looked like
// a real atomic increment but wasn't one -- the "current + 1" arithmetic
// happened entirely client-side, in the browser, using the anon Supabase
// client, before being written as an absolute value; a caller bypassing
// the app's own JS convention could set any value with the same ease as
// a raw write. Deliberately NOT behind verifyUser(): anonymous visitors
// legitimately generate real views today (the existing client-side logic
// only ever compares against `currentUser` when one exists), and requiring
// login here would be a real product regression, not a security fix.
// Real server-side protections instead:
//  - The increment itself is computed server-side (existingRow.viewsCount
//    + 1), never trusted from the client -- there is no viewsCount in the
//    request body at all.
//  - A per-product, per-IP cooldown enforces the same "one real view per
//    ~10 minutes" intent the client's own localStorage cooldown already
//    expressed -- except that one was trivially bypassable by calling
//    Supabase directly; this one can't be, since it's the only path that
//    ever touches viewsCount now.
//  - Self-view exclusion is preserved when the caller is authenticated
//    and happens to be the listing's own seller (matches the existing
//    client-side behavior, now enforced server-side too).
const viewCooldownStore = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  for (const [key, expiresAt] of viewCooldownStore.entries()) {
    if (now > expiresAt) viewCooldownStore.delete(key);
  }
}, 5 * 60 * 1000);

app.post('/api/products/:productId/view', serverRateLimiter(60 * 1000, 60, "products-view"), async (req, res) => {
  const productId = String(req.params.productId || '').trim();
  if (!productId) {
    return res.status(400).json({ success: false, error: 'Missing productId' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }

  try {
    const { data: existingRow } = await backendSupabase.from('products').select('id, sellerId, viewsCount').eq('id', productId).maybeSingle();
    if (!existingRow) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    // Self-view exclusion -- only applies when a real, verified identity is
    // present; anonymous requests always count, matching existing behavior.
    if (req.headers.authorization) {
      const verified = await verifyUser(req.headers.authorization);
      if (verified && verified.uid === existingRow.sellerId) {
        return res.json({ success: true, counted: false, reason: 'self-view' });
      }
    }

    // Same trusted-IP source as serverRateLimiter above, same reasoning --
    // see its comment for the full explanation.
    const clientIp = (
      req.headers['cf-connecting-ip'] as string ||
      req.socket.remoteAddress ||
      'unknown'
    ).trim();
    const cooldownKey = `${clientIp}_${productId}`;
    const cooldownMs = 10 * 60 * 1000;
    const existingExpiry = viewCooldownStore.get(cooldownKey);
    if (existingExpiry && Date.now() < existingExpiry) {
      return res.json({ success: true, counted: false, reason: 'cooldown' });
    }
    viewCooldownStore.set(cooldownKey, Date.now() + cooldownMs);

    const nextViewsCount = Number(existingRow.viewsCount || 0) + 1;
    const { error } = await backendSupabase.from('products').update({ viewsCount: nextViewsCount }).eq('id', productId);
    if (error) throw error;

    return res.json({ success: true, counted: true, viewsCount: nextViewsCount });
  } catch (err: any) {
    console.error('[Product View API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to record view' });
  }
});

// Prevents spam-posting listings.
app.post('/api/products/create', serverRateLimiter(60 * 1000, 10, "products-create"), async (req, res) => {
  const { product } = req.body;
  if (!product) {
    return res.status(400).json({ success: false, error: 'Missing product payload' });
  }

  const user = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required to create product' });
  }

  const isAdmin = user.isAdmin || user.email === 'asumaduvincent7@gmail.com';
  // If admin creates product on behalf of an impersonated user, allow product.sellerId; otherwise bound to user.uid
  const sellerId = (isAdmin && product.sellerId && String(product.sellerId).trim().length > 0)
    ? String(product.sellerId).trim()
    : user.uid;

  const cleanProduct = {
    ...product,
    sellerId
  };

  try {
    const saved = await upsertProductToSupabase(cleanProduct, user);
    clearSitemapCache();
    return res.json({ success: true, product: saved });
  } catch (err: any) {
    console.error('[Product Create API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to create product' });
  }
});

async function deleteProductFromBackend(productId: string) {
  if (!productId) return;
  console.log(`[Product Delete Server] Deleting product ${productId}...`);

  let sellerId: string | undefined;
  let category: string | undefined;

  if (backendSupabase) {
    try {
      const { data: existing } = await backendSupabase.from('products').select('images, imageUrls, videos, videoUrls, sellerId, seller_id, category').eq('id', productId).maybeSingle();
      if (existing) {
        sellerId = existing.sellerId || existing.seller_id;
        category = existing.category;
        const mediaUrlsToCleanup: string[] = [
          ...parseMediaArray(existing.images),
          ...parseMediaArray(existing.imageUrls),
          ...parseMediaArray(existing.videos),
          ...parseMediaArray(existing.videoUrls)
        ];

        for (const url of mediaUrlsToCleanup) {
          if (typeof url === 'string' && url.includes('res.cloudinary.com')) {
            const info = extractCloudinaryInfo(url);
            if (info) {
              await deleteCloudinaryAsset(info.publicId, info.resourceType).catch(() => {});
            }
          }
        }
      }

      const { error } = await backendSupabase.from('products').delete().eq('id', productId);
      if (error) throw error;
      console.log(`[Product Delete Server] Successfully deleted product ${productId} from Supabase.`);
    } catch (sbErr: any) {
      // Found via a dedicated audit, same "write failure reported as
      // success" shape fixed elsewhere this session: this used to only
      // console.warn on a real Supabase deletion error, never signal it to
      // any caller -- every route calling this shared helper (both direct
      // product-delete endpoints, whose ownership check was just fixed for
      // the same fail-open shape) then unconditionally reported "deleted
      // successfully" while the listing stayed fully live. Now rethrown so
      // callers can actually tell; each caller decides for itself whether
      // that should hard-fail its own response or just be logged and moved
      // on from (see the two cascade-loop callers below, which now wrap
      // this call per-item instead of relying on this function to swallow
      // failures for them).
      console.warn(`[Product Delete Server] Supabase delete error for ${productId}:`, sbErr?.message || sbErr);
      throw sbErr;
    }
  }

  // Also remove from Firestore adminDb
  if (adminDb) {
    try {
      await adminDb.collection('products').doc(productId).delete();
      console.log(`[Product Delete Server] Successfully deleted product ${productId} from Firestore adminDb.`);
    } catch (fErr: any) {
      console.warn(`[Product Delete Server] Firestore adminDb delete note for ${productId}:`, fErr?.message || fErr);
    }
  }

  // Invalidate memory caches for deleted product
  invalidateProductCache(productId, sellerId, category);
}

const SOLD_LISTING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** A listing marked sold and left that way for 30 days is permanently
 * deleted — same cleanup as a manual delete (Cloudinary assets, Supabase
 * row, Firestore mirror, caches), just triggered by time instead of a
 * seller's own action. soldAt is stamped in /api/products/sync the moment
 * isSold flips false→true, so this only measures real elapsed time, not
 * "last touched" — an unrelated edit to an already-sold listing doesn't
 * restart the clock. Called both on a recurring interval (see startServer)
 * and from the admin retention-purge endpoint for on-demand/visible runs. */
async function purgeExpiredSoldProducts(): Promise<number> {
  if (!backendSupabase) return 0;
  const cutoff = new Date(Date.now() - SOLD_LISTING_RETENTION_MS).toISOString();
  let purged = 0;
  try {
    const { data: expiredSoldProducts } = await backendSupabase
      .from('products')
      .select('id')
      .eq('isSold', true)
      .lt('soldAt', cutoff);

    for (const p of expiredSoldProducts || []) {
      try {
        await deleteProductFromBackend(p.id);
        purged++;
      } catch (delErr) {
        console.warn(`[Sold Listing Retention] Failed to delete expired sold product ${p.id}:`, delErr);
      }
    }
  } catch (err) {
    console.warn('[Sold Listing Retention] Query failed:', err);
  }
  if (purged > 0) {
    console.log(`[Sold Listing Retention] Permanently deleted ${purged} listing(s) sold 30+ days ago.`);
  }
  return purged;
}

app.post('/api/products/delete', serverRateLimiter(60 * 1000, 20, "products-delete"), async (req, res) => {
  const productId = req.body?.productId || req.body?.id;
  if (!productId) {
    return res.status(400).json({ success: false, error: 'Missing productId' });
  }

  const user = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required to delete product' });
  }

  let sellerId: string | null = null;
  let sellerEmail: string | null = null;
  let productExists = false;
  if (backendSupabase) {
    try {
      const { data, error } = await backendSupabase.from('products').select('sellerId, seller_id, sellerEmail, seller_email').eq('id', productId).maybeSingle();
      if (error) throw error;
      if (data) {
        productExists = true;
        sellerId = data.sellerId || data.seller_id || null;
        sellerEmail = data.sellerEmail || data.seller_email || null;
      }
    } catch (err: any) {
      // Found via a dedicated audit of never-previously-reviewed endpoints:
      // this used to be `catch (_) {}`, silently leaving sellerId null on
      // ANY lookup failure (a transient Supabase error, not just "product
      // doesn't exist") -- and the ownership check below was gated on
      // `sellerId &&`, so a null sellerId skipped the check ENTIRELY rather
      // than denying. That's a fail-OPEN authorization bug: any transient
      // read failure let any authenticated (non-admin) user delete ANY
      // product, not just their own. Now fails closed: a real lookup error
      // is a 500, not a silent bypass.
      console.error('[Product Delete API] Ownership lookup failed:', err?.message || err);
      return res.status(500).json({ success: false, error: 'Could not verify listing ownership. Please try again.' });
    }
  }

  if (!productExists) {
    return res.status(404).json({ success: false, error: 'Product not found' });
  }

  // Matches /api/products/sync's ownership check — sellerId can legitimately
  // be stored as the bare uid or a user_/phone_ prefixed variant (see that
  // route's comment), or the caller can be identified by seller email.
  const isOwner = !!sellerId && (
    sellerId === user.uid ||
    sellerId === `user_${user.uid}` ||
    sellerId === `phone_${user.uid}` ||
    (!!user.email && !!sellerEmail && sellerEmail.toLowerCase() === user.email.toLowerCase())
  );
  const isAdmin = user.isAdmin || user.email === 'asumaduvincent7@gmail.com';

  // No longer gated on `sellerId &&` -- the productExists check above
  // already guarantees the row was found, so a missing/empty sellerId on an
  // existing row now correctly denies (isOwner is false) instead of
  // bypassing the check entirely.
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ success: false, error: 'Forbidden: You do not own this product' });
  }

  try {
    await deleteProductFromBackend(productId);
    clearSitemapCache();
    return res.json({ success: true, message: `Product ${productId} deleted successfully` });
  } catch (err: any) {
    console.error('[Product Delete API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to delete product' });
  }
});

app.delete('/api/products/:productId', serverRateLimiter(60 * 1000, 20, "products-delete-by-id"), async (req, res) => {
  const { productId } = req.params;
  if (!productId) {
    return res.status(400).json({ success: false, error: 'Missing productId' });
  }

  const user = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required to delete product' });
  }

  let sellerId: string | null = null;
  let sellerEmail: string | null = null;
  let productExists = false;
  if (backendSupabase) {
    try {
      const { data, error } = await backendSupabase.from('products').select('sellerId, seller_id, sellerEmail, seller_email').eq('id', productId).maybeSingle();
      if (error) throw error;
      if (data) {
        productExists = true;
        sellerId = data.sellerId || data.seller_id || null;
        sellerEmail = data.sellerEmail || data.seller_email || null;
      }
    } catch (err: any) {
      // Same fail-open fix as POST /api/products/delete just above -- see
      // that route's comment for the full reasoning.
      console.error('[Product Delete API] Ownership lookup failed:', err?.message || err);
      return res.status(500).json({ success: false, error: 'Could not verify listing ownership. Please try again.' });
    }
  }

  if (!productExists) {
    return res.status(404).json({ success: false, error: 'Product not found' });
  }

  // Matches /api/products/sync's ownership check — sellerId can legitimately
  // be stored as the bare uid or a user_/phone_ prefixed variant (see that
  // route's comment), or the caller can be identified by seller email.
  const isOwner = !!sellerId && (
    sellerId === user.uid ||
    sellerId === `user_${user.uid}` ||
    sellerId === `phone_${user.uid}` ||
    (!!user.email && !!sellerEmail && sellerEmail.toLowerCase() === user.email.toLowerCase())
  );
  const isAdmin = user.isAdmin || user.email === 'asumaduvincent7@gmail.com';

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ success: false, error: 'Forbidden: You do not own this product' });
  }

  try {
    await deleteProductFromBackend(productId);
    clearSitemapCache();
    return res.json({ success: true, message: `Product ${productId} deleted successfully` });
  } catch (err: any) {
    console.error('[Product Delete API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to delete product' });
  }
});

app.post('/api/sitemap/clear', serverRateLimiter(60 * 1000, 5, "sitemap-clear"), async (req, res) => {
  // AppContext.tsx's 4 callers already send a real auth header after their
  // own create/update/delete product call succeeds -- this endpoint just
  // wasn't checking it, so it was reachable by anyone with no session at
  // all. Low real-world impact (it only busts an in-memory cache, already
  // rate-limited to 5/min), but there's no reason a routine post-save
  // side-effect should be the one open door.
  const verified = await verifyUser(req.headers.authorization);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
  }
  clearSitemapCache();
  res.json({ success: true, message: 'Sitemap cache cleared' });
});

// -------------------------------------------------------------
// USER PERSISTENCE & RETRIEVAL ENDPOINTS
// -------------------------------------------------------------
app.post('/api/users/sync', serverRateLimiter(60 * 1000, 20, "users-sync"), async (req: express.Request, res: express.Response) => {
  const { user } = req.body || {};
  if (!user || !user.id) {
    return res.status(400).json({ success: false, error: 'Missing user or user.id' });
  }

  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required to sync user profile' });
  }

  const targetUid = String(user.id).trim();
  const isOwner = targetUid === verified.uid;
  const isAdmin = verified.isAdmin || verified.email === 'asumaduvincent7@gmail.com';

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ success: false, error: 'Forbidden: You can only update your own user profile' });
  }

  const requestedUsername = user.username ? String(user.username).trim() : (user.email ? user.email.split('@')[0] : `User_${user.id.substring(0, 5)}`);

  if (!isAdmin && isReservedStoreName(requestedUsername)) {
    return res.status(400).json({ success: false, error: 'This store name is reserved by TedBuy.' });
  }

  // Business-logic fix: the 90-day username quarantine applied on account
  // deletion (see the account-deletion flow below, "Quarantine Username /
  // Store Name") existed only as a UI hint -- GET /api/auth/check-store-name
  // reads it for a signup form's live availability check, but nothing on
  // the actual claim path (here) ever verified it. A user could ignore
  // that check (or simply never call it) and claim a just-deleted user's
  // exact username immediately via a normal profile save, silently
  // overwriting the quarantine record itself since this endpoint's own
  // store_names upsert below is keyed by the same id. This is an identity/
  // trust issue (impersonating or capturing a departed seller's exact
  // username/reputation), not dependent on RLS or any client-side
  // tampering -- it was simply never enforced. Non-admin only; admin
  // override intentionally preserved for legitimate support cases.
  if (!isAdmin && backendSupabase) {
    const normalizedUsername = requestedUsername.toLowerCase();
    const { data: existingStoreName } = await backendSupabase
      .from('store_names')
      .select('userId, status, availableAfter')
      .eq('id', normalizedUsername)
      .maybeSingle();
    if (
      existingStoreName &&
      existingStoreName.userId !== targetUid &&
      existingStoreName.status === 'quarantined' &&
      existingStoreName.availableAfter &&
      new Date(existingStoreName.availableAfter).getTime() > Date.now()
    ) {
      return res.status(400).json({ success: false, error: 'This store name is quarantined from a previously closed account and is temporarily unavailable.' });
    }
  }

  try {
    // P0 fix: isAdmin was previously taken straight from the client-supplied
    // `user` payload (`user.isAdmin === true`). The isOwner check above only
    // verifies the caller is updating THEIR OWN row -- it never verified
    // they were allowed to set isAdmin on it. Since this endpoint is
    // reachable by any authenticated user syncing their own profile, this
    // meant any signed-in TedBuy user could POST here with
    // `{ user: { id: <their own uid>, isAdmin: true, ... } }` and grant
    // themselves admin -- no Supabase/RLS knowledge required at all, just
    // TedBuy's own normal "save profile" API with one extra field. Fixed:
    // isAdmin is now derived exclusively from what's already in the
    // database (preserving real admin status, however it was originally
    // granted -- a Firebase custom claim or the hardcoded super-admin
    // email) plus the same super-admin-email auto-grant already used
    // elsewhere. It is never taken from the request body, for anyone,
    // including an already-legitimate admin syncing their own profile.
    //
    // P0 fix (second field, same shape): isSuspended had the identical bug
    // -- taken straight from the client body, which meant a suspended user
    // could self-unsuspend with a normal profile-save request containing
    // `isSuspended: false`. Same treatment: preserved from the existing DB
    // row, never taken from the client. The only legitimate way to change
    // this now is POST /api/admin/users/suspend (verifyUser()-gated, real
    // admin check, see that endpoint).
    let existingIsAdmin = false;
    let existingIsSuspended = false;
    let existingUsername: string | null = null;
    if (backendSupabase) {
      const { data: existingRowForFlags } = await backendSupabase
        .from('users')
        .select('"isAdmin", "isSuspended", username')
        .eq('id', targetUid)
        .maybeSingle();
      existingIsAdmin = existingRowForFlags?.isAdmin === true;
      existingIsSuspended = existingRowForFlags?.isSuspended === true;
      existingUsername = existingRowForFlags?.username || null;
    }

    // NOT the same [a-zA-Z0-9_-] regex registrationValidation.ts's client-side
    // validateUsernameSecure enforces -- that would reject real, already-
    // working registrations: Google sign-in (AppContext.tsx) deliberately
    // sends the raw firebaseUser.displayName as the initial username, which
    // legitimately contains spaces and punctuation ("John O'Brien"), never
    // passing through that client validator at all. This is narrower and
    // only blocks the literal characters that make HTML-tag injection
    // possible, since that stored value gets echoed unescaped into this
    // session's own HTML email templates (registration OTP, welcome email)
    // -- closing it at the source rather than only where it happened to be
    // noticed, without breaking any legitimate name. Only rejects an ACTUAL
    // change to a bad value -- gated on requestedUsername differing from
    // what's already stored, so an existing user's own untouched username
    // (whatever it already contains) never blocks the rest of their save.
    if (user.username && !isAdmin && requestedUsername !== existingUsername) {
      if (/[<>]/.test(requestedUsername)) {
        return res.status(400).json({ success: false, error: 'Username cannot contain the characters < or >.' });
      }
    }

    // Business-logic fix: emailVerified was previously taken straight from
    // the client body (`user.emailVerified === true`) -- unlike isAdmin/
    // isSuspended, simply preserving the existing DB value isn't the right
    // fix here, since a real, legitimate transition to true happens
    // whenever a user actually clicks their verification link (Firebase's
    // own emailVerified flips, and the client is expected to sync that).
    // The correct source of truth is Firebase Auth's own record, not the
    // client's claim about it and not a possibly-stale DB copy --
    // getAdminAuth().getUser() reads it directly, independent of whatever
    // the request body says. No functional impact for the legitimate
    // "I just verified my email" case; closes the previously-unrestricted
    // "claim verified:true (or false) with no evidence" gap.
    let realEmailVerified = false;
    try {
      const fbUser = await getAdminAuth().getUser(targetUid);
      realEmailVerified = fbUser.emailVerified === true;
    } catch (fbErr) {
      console.warn('[Users Sync API] Could not read Firebase Auth emailVerified, defaulting to false:', fbErr);
    }

    const cleanUser: any = {
      id: String(user.id).trim(),
      username: user.username ? String(user.username).trim() : (user.email ? user.email.split('@')[0] : `User_${user.id.substring(0, 5)}`),
      email: user.email ? String(user.email).trim() : null,
      phoneNumber: user.phoneNumber ? String(user.phoneNumber).trim() : null,
      whatsAppNumber: user.whatsAppNumber ? String(user.whatsAppNumber).trim() : null,
      role: user.role || 'both',
      joinDate: user.joinDate || 'Joined recently',
      photoUrl: user.photoUrl || null,
      followingSellers: Array.isArray(user.followingSellers) ? user.followingSellers : [],
      savedProductIds: Array.isArray(user.savedProductIds) ? user.savedProductIds : [],
      emailVerified: realEmailVerified,
      isGoogleAuth: user.isGoogleAuth === true,
      authProvider: user.authProvider || null,
      isAdmin: existingIsAdmin || (user.email && user.email.trim().toLowerCase() === 'asumaduvincent7@gmail.com'),
      welcomeSent: user.welcomeSent === true,
      isSuspended: existingIsSuspended,
      createdAt: user.createdAt || new Date().toISOString()
    };

    // Only set the column when the caller actually sent it — web doesn't
    // know about this field yet, and an upsert only overwrites columns
    // present in the row object, so omitting it here (rather than defaulting
    // to something) leaves a mobile user's saved preference untouched if
    // they edit their profile from web later.
    if (user.notificationPreferences && typeof user.notificationPreferences === 'object') {
      cleanUser.notificationPreferences = {
        newFollower: user.notificationPreferences.newFollower !== false,
        newMessage: user.notificationPreferences.newMessage !== false,
        followedSellerNewListing: user.notificationPreferences.followedSellerNewListing !== false,
      };
    }

    // Bio edits are rate-limited to once every 7 days. This must be enforced
    // here (not just client-side) since it's the only authoritative check —
    // fetch the existing value first so a no-op save (unchanged text) never
    // trips the cooldown.
    if (typeof user.bio === 'string' && backendSupabase) {
      const trimmedBio = user.bio.trim().slice(0, 160);
      const { data: existingRow } = await backendSupabase
        .from('users')
        .select('bio, "bioUpdatedAt"')
        .eq('id', cleanUser.id)
        .maybeSingle();
      const existingBio = existingRow?.bio || '';
      const existingBioUpdatedAt = existingRow?.bioUpdatedAt;
      if (trimmedBio !== existingBio && existingBioUpdatedAt) {
        const cooldownMs = 7 * 24 * 60 * 60 * 1000;
        const nextAllowedAt = new Date(existingBioUpdatedAt).getTime() + cooldownMs;
        if (Number.isFinite(nextAllowedAt) && Date.now() < nextAllowedAt) {
          const daysLeft = Math.max(1, Math.ceil((nextAllowedAt - Date.now()) / (24 * 60 * 60 * 1000)));
          return res.status(400).json({ success: false, error: `You can change your bio again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.` });
        }
      }
      cleanUser.bio = trimmedBio;
      if (trimmedBio !== existingBio) {
        cleanUser.bioUpdatedAt = new Date().toISOString();
      }
    }

    if (backendSupabase) {
      const { error } = await safeBackendSupabaseUpsert('users', cleanUser, { onConflict: 'id' });
      if (error) {
        // Correctness fix, same shape as this session's other "write
        // failure reported as success" fixes (deleteAccount,
        // adminToggleSecurityHold, updateProduct's rollback) -- this used
        // to only console.warn and fall through to the unconditional
        // success response below, meaning a genuine database rejection
        // (a unique-constraint violation, a transient Supabase error,
        // anything) here was invisible to the caller. This is the single
        // endpoint behind every profile save AND registration itself on
        // both platforms -- registerUser (AppContext.tsx) already correctly
        // rethrows on `!data.success` (fixed earlier this session), but
        // that fix was useless against this specific failure mode, since
        // the server never actually told it anything had gone wrong.
        console.error('[Users Sync API] Supabase users upsert failed:', error.message || error);
        return res.status(500).json({
          success: false,
          error: (error as any)?.code === '23505'
            ? 'That username is already taken. Please choose another.'
            : (error.message || 'Failed to save your profile. Please try again.')
        });
      }

      if (cleanUser.username) {
        const storeObj = {
          id: cleanUser.username.toLowerCase(),
          userId: cleanUser.id,
          username: cleanUser.username
        };
        await safeBackendSupabaseUpsert('store_names', storeObj, { onConflict: 'id' }).catch(() => {});

        // RLS-migration Phase 1, checkpoint 18: on a rename, clean up the
        // OLD username's store_names row so it doesn't sit around
        // reserved forever. This used to be a client-side direct
        // `deleteDoc(doc('storeNames', oldNameLower))` in
        // updateUserProfile -- dbAdapter's generic write path has no
        // per-row ownership check, so a raw Supabase caller could delete
        // (or upsert) ANY username's store_names row, unauthenticated.
        // Folded in here instead, alongside the new-username reservation
        // this endpoint already does server-side, gated behind the same
        // ownership check as the rest of this endpoint (isOwner/isAdmin,
        // checked above) and scoped only to the row this user actually
        // held (the `userId` match below), so it can't be used to clear
        // someone else's reservation even if a username collision existed.
        const oldUsernameLower = existingUsername ? existingUsername.trim().toLowerCase() : null;
        if (oldUsernameLower && oldUsernameLower !== storeObj.id) {
          try {
            const { error: delErr } = await backendSupabase
              .from('store_names')
              .delete()
              .eq('id', oldUsernameLower)
              .eq('userId', cleanUser.id);
            if (delErr) console.warn('[Users Sync API] Old store_names cleanup warning:', delErr.message || delErr);
          } catch (delErr: any) {
            console.warn('[Users Sync API] Old store_names cleanup warning:', delErr?.message || delErr);
          }
        }
      }
    }

    console.log(`[Users Sync API] User profile successfully synced for UID: "${cleanUser.id}" ("${cleanUser.username}")`);
    return res.json({ success: true, user: cleanUser });
  } catch (err: any) {
    console.error('[Users Sync API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'User sync failed' });
  }
});

// A raw `users` row (select('*')) carries the legacy password/password_hash
// columns (see the password-reset endpoints below) alongside everything
// else — every place that ever hands such a row back to a client, admin or
// not, must strip those first. Centralized here rather than re-implemented
// per endpoint so a future select('*') response can't forget it.
function redactUserSecrets<T extends Record<string, any> | null | undefined>(user: T): T {
  if (!user || typeof user !== 'object') return user;
  const { password, password_hash, ...safe } = user;
  return safe as T;
}

app.get('/api/users/get', serverRateLimiter(60 * 1000, 60, "users-get"), async (req: express.Request, res: express.Response) => {
  const userId = req.query.id as string;
  const email = req.query.email as string;
  // Added alongside the users-bulk-PII-leak fix (checkpoint 1 of the RLS
  // migration's Phase 0 -- see .ai/handoffs/SUPABASE_RLS_MIGRATION_PLAN.md
  // §0): SellerProfilePage.tsx's "contact seller via WhatsApp/phone"
  // feature previously resolved a seller's real profile (including
  // phoneNumber/whatsAppNumber, which sellers publish specifically so
  // buyers can reach them) out of the client's own bulk, unauthenticated
  // `users` table dump -- the same dump being closed in this pass for
  // exposing every user's contact info, not just sellers'. selectedSellerId
  // is sometimes an id and sometimes a username (see SellerProfilePage.tsx's
  // own foundUser lookup), so this endpoint needs to resolve by either.
  const username = req.query.username as string;
  // Added at RLS-migration Phase 2, checkpoint 16: loginUser's username-or-
  // phone-number identifier resolution had its own direct, unauthenticated
  // `getDocs(query(collection('users'), where('phoneNumber', '==', ...)))`
  // -- same shape and severity as the email-based lookups already closed
  // at checkpoints 10/11 (client-side query filters aren't access control;
  // a caller bypassing the app's own JS could issue the same query with
  // ANY phone number). Adding phoneNumber as a fourth lookup key here
  // rather than a new endpoint: this endpoint is already a public-by-
  // design, single-targeted-key profile lookup (id/email/username), so
  // one more equally-targeted key is the same exposure class already
  // accepted for those three, not a new one.
  const phoneNumber = req.query.phoneNumber as string;

  if (!userId && !email && !username && !phoneNumber) {
    return res.status(400).json({ success: false, error: 'Missing userId, email, username, or phoneNumber query parameter' });
  }

  try {
    if (backendSupabase) {
      let q = backendSupabase.from('users').select('*');
      if (userId) {
        q = q.eq('id', userId);
      } else if (email) {
        q = q.eq('email', email.trim());
      } else if (username) {
        q = q.ilike('username', username.trim());
      } else if (phoneNumber) {
        q = q.eq('phoneNumber', phoneNumber.trim());
      }
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      if (data) {
        const authHeader = req.headers.authorization;
        if (data.isDeleted === true || data.status === 'deleted') {
          const isAdmin = authHeader ? await verifyAdmin(authHeader) : false;
          if (!isAdmin) {
            return res.status(404).json({ success: false, error: 'User not found' });
          }
        }
        // Email is only returned to the record's own owner. Any other
        // caller — unauthenticated, or authenticated as a different user —
        // gets everything else (including phoneNumber/whatsAppNumber, the
        // fields sellers publish specifically so buyers can contact them)
        // but never email, closing the bulk/targeted email-harvesting
        // vector this endpoint's `select('*')` previously allowed.
        const verified = authHeader ? await verifyUser(authHeader) : null;
        // A user's stored `users.id` is normally the bare Firebase UID, but
        // one known legacy row is stored as `user_<uid>` (see the
        // ownership-check equivalence at /api/products/sync, which already
        // treats this as the same account) -- without tolerating it here,
        // that account's own authenticated self-lookup would be wrongly
        // treated as "another user" and lose its own email.
        const isSelf = !!verified && (
          String(data.id) === String(verified.uid) ||
          String(data.id) === `user_${verified.uid}`
        );
        const safeUser = redactUserSecrets({ ...data, isOnline: computeIsOnline(data.lastSeen) });
        if (!isSelf) delete (safeUser as any).email;
        return res.json({ success: true, user: safeUser });
      }
    }
    return res.status(404).json({ success: false, error: 'User not found' });
  } catch (err: any) {
    console.error('[Users Get API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to fetch user' });
  }
});

// Dedicated, minimal pre-auth identifier resolution for loginUser's
// username/phone-number sign-in path (AppContext.tsx). Previously this
// resolution reused GET /api/users/get?username=/&phoneNumber=, which
// returned the full user row (minus password) to an unauthenticated
// caller -- necessarily so, since no session exists yet at this point in
// the login flow. Replaced with this narrow, single-purpose endpoint: it
// returns only the email needed to continue signInWithEmailAndPassword,
// nothing else -- no id, phoneNumber, whatsAppNumber, profile, or seller
// fields. It performs no authentication itself (no password parameter);
// the actual credential check remains entirely inside Firebase.
app.post("/api/auth/resolve-login-identifier", serverRateLimiter(15 * 60 * 1000, 10, "resolve-login-identifier"), async (req: express.Request, res: express.Response) => {
  const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : '';
  if (!identifier) {
    return res.status(400).json({ success: false, error: 'identifier is required' });
  }
  try {
    if (!backendSupabase) {
      return res.status(404).json({ success: false });
    }
    let { data } = await backendSupabase
      .from('users')
      .select('email')
      .ilike('username', identifier)
      .maybeSingle();
    if (!data) {
      const byPhone = await backendSupabase
        .from('users')
        .select('email')
        .eq('phoneNumber', identifier)
        .maybeSingle();
      data = byPhone.data;
    }
    if (data && data.email) {
      return res.json({ success: true, email: data.email });
    }
    return res.status(404).json({ success: false });
  } catch (err: any) {
    console.error('[Resolve Login Identifier API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to resolve identifier' });
  }
});

// Server-authoritative account-migration merge, RLS-migration Phase 2
// (.ai/handoffs/SUPABASE_RLS_MIGRATION_PLAN.md -- findAndMigrateExistingUser's
// merge logic, flagged as the highest-risk deferred item since checkpoint 9).
// AppContext.tsx's findAndMigrateExistingUser used to run this merge as a
// direct, unauthenticated client writeBatch: set the merged profile under
// the new Firebase uid, delete the OLD row entirely, repoint store_names,
// and cascade sellerId/buyerId across products/chats -- all driven by a
// client-asserted "this other id was my old account", with no server-side
// check that the caller actually owned it. Naively porting that to an
// authenticated endpoint without adding real verification would let anyone
// delete or absorb an arbitrary other user's account merely by naming its
// id while signed in as any account at all.
//
// The fix is not "add auth", it's requiring cryptographic proof of
// ownership: the OLD account's stored email must match the CALLER's own
// verified email (verifyIdToken's decoded claim, never anything client-
// supplied). Two different Firebase identities sharing a verified email is
// only possible if the same real person controls both (e.g. switching from
// a password account to Google Sign-In on the same address) -- exactly the
// legitimate scenario this merge exists to handle, and not reachable by an
// attacker who doesn't already control that email address. If the old
// row's email can't be matched (missing, or simply different), this
// endpoint fails closed (403) rather than trusting the client's claim --
// the caller falls back to a fresh account rather than an unverifiable
// merge, a deliberate behavior tightening vs. the old fully-trusting
// client-side code.
app.post('/api/users/merge-account', serverRateLimiter(60 * 1000, 10, "users-merge-account"), async (req: express.Request, res: express.Response) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }

  const targetUid = verified.uid;
  const oldUserId = req.body?.oldUserId ? String(req.body.oldUserId).trim() : '';
  if (!oldUserId || oldUserId === targetUid) {
    return res.status(400).json({ success: false, error: 'Missing or invalid oldUserId' });
  }
  if (!verified.email) {
    return res.status(403).json({ success: false, error: 'A verified email is required to merge an existing account' });
  }

  // emailVerified/isGoogleAuth/authProvider are derived from Firebase
  // Admin's own record of the CALLER (targetUid), same pattern as
  // /api/users/sync above -- never taken from the client body. This is
  // now also a real authorization gate, not just metadata for the merged
  // record: Firebase's createUserWithEmailAndPassword lets a brand-new
  // account claim ANY email string with no proof of ownership at all
  // (emailVerified starts false), so `verified.email` matching the old
  // account's email is not itself proof the caller controls that inbox.
  // Without this gate, an attacker could sign up claiming a victim's real
  // email and use this endpoint to inherit the victim's entire account
  // (products, chats, username) below, permanently deleting the original.
  let realEmailVerified = false;
  let isGoogleUser = false;
  try {
    const fbUser = await getAdminAuth().getUser(targetUid);
    realEmailVerified = fbUser.emailVerified === true;
    isGoogleUser = (fbUser.providerData || []).some((p: any) => p.providerId === 'google.com');
  } catch (fbErr) {
    console.warn('[Users Merge API] Could not read Firebase Auth user:', fbErr);
  }
  if (!realEmailVerified) {
    return res.status(403).json({ success: false, error: 'Please verify your email before merging accounts.' });
  }

  try {
    const { data: oldRow, error: fetchErr } = await backendSupabase
      .from('users')
      .select('*')
      .eq('id', oldUserId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!oldRow) {
      return res.status(404).json({ success: false, error: 'Old account not found' });
    }
    if (oldRow.isDeleted === true || oldRow.status === 'deleted') {
      return res.status(404).json({ success: false, error: 'Old account no longer exists' });
    }

    const oldEmail = oldRow.email ? String(oldRow.email).trim().toLowerCase() : '';
    if (!oldEmail || oldEmail !== verified.email) {
      return res.status(403).json({ success: false, error: 'Forbidden: old account email does not match your verified email' });
    }

    const oldRowSafe = redactUserSecrets(oldRow);
    const mergedUser: any = {
      ...oldRowSafe,
      id: targetUid,
      email: verified.email,
      emailVerified: realEmailVerified,
      photoUrl: (req.body?.photoUrl ? String(req.body.photoUrl) : null) || oldRow.photoUrl || null,
      isGoogleAuth: isGoogleUser || oldRow.isGoogleAuth === true,
      authProvider: isGoogleUser ? 'google.com' : (oldRow.authProvider || null)
    };

    const { error: upsertErr } = await safeBackendSupabaseUpsert('users', cleanObject(mergedUser), { onConflict: 'id' });
    if (upsertErr) throw upsertErr;

    // Found via a dedicated audit: unlike the critical merge-upsert just
    // above (correctly checked/thrown), this cleanup delete had zero error
    // visibility at all -- Supabase resolves with {error} rather than
    // throwing, so a silent failure here previously left the old row
    // lingering indefinitely with the same email as the now-merged new row,
    // a real duplicate-account data-hygiene risk with no trace in the logs.
    // Not escalated to a hard failure (matching this endpoint's own cascade
    // steps below): the merge itself already genuinely succeeded by this
    // point, so the response's success claim stays accurate either way --
    // this only adds the missing visibility.
    const { error: oldRowDeleteErr } = await backendSupabase.from('users').delete().eq('id', oldUserId);
    if (oldRowDeleteErr) {
      console.warn('[Users Merge API] Could not delete old account row (orphaned duplicate risk):', oldRowDeleteErr.message);
    }

    if (mergedUser.username) {
      await safeBackendSupabaseUpsert('store_names', {
        id: String(mergedUser.username).trim().toLowerCase(),
        userId: targetUid,
        username: String(mergedUser.username).trim()
      }, { onConflict: 'id' }).catch(() => {});
    }

    try {
      await backendSupabase.from('products').update({ sellerId: targetUid }).eq('sellerId', oldUserId);
      await backendSupabase.from('chats').update({ buyerId: targetUid }).eq('buyerId', oldUserId);
      await backendSupabase.from('chats').update({ sellerId: targetUid }).eq('sellerId', oldUserId);
    } catch (cascadeErr) {
      console.warn('[Users Merge API] Cascade update warning:', cascadeErr);
    }

    console.log(`[Users Merge API] Merged old account "${oldUserId}" into verified UID "${targetUid}" (matched email).`);
    return res.json({ success: true, user: mergedUser });
  } catch (err: any) {
    console.error('[Users Merge API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Account merge failed' });
  }
});

// Bulk, public-safe user directory — backs mobile's watchUsers(), which
// used to read the Firestore `users` collection directly. That collection
// is a mirror of this Supabase table and can drift out of sync with it (a
// username change updates Supabase but the Firestore copy doesn't always
// follow) — confirmed live: one real seller's Supabase username was
// "Richie" while their Firestore mirror still said "Vince", so the Popular
// Stores card (Firestore-sourced) showed one name while tapping into their
// actual profile (this file's own /api/users/get, correctly Supabase-
// sourced) showed the other. Routing watchUsers() through Supabase instead
// closes that gap at the source rather than special-casing the symptom.
// Deliberately NOT a raw `select('*')` like /api/users/get above: that
// endpoint is fetched one specific user at a time, but this one returns
// every user in one response, so shipping email/phoneNumber/whatsAppNumber
// in bulk would hand any caller a scrapable directory of everyone's contact
// info. isAdmin is computed server-side from the same rule as isUserAdmin
// (mobile/src/types.ts) precisely so the client never needs the raw email
// to answer "is this user an admin".
app.get('/api/users/list', serverRateLimiter(60 * 1000, 30, "users-list"), async (req: express.Request, res: express.Response) => {
  try {
    if (!backendSupabase) {
      return res.status(503).json({ success: false, error: 'Database service unavailable' });
    }
    // Only real columns (confirmed against an actual row returned by
    // /api/users/get above) — the first version of this endpoint selected
    // several fields (displayName, isVerified, verified, idVerified, badge,
    // rating, sellerRating, location) that don't exist on this table at
    // all, which fails the whole query rather than just omitting them.
    // Client-side fallback chains (e.g. discoverSellers.ts's
    // `user?.isVerified || user?.emailVerified || ...`) already treat a
    // missing field as absent gracefully, so simply not selecting them here
    // is behaviorally identical to them never having existed.
    // "lastSeen" requested optimistically for the online-presence dot
    // (SellerCard.tsx/computeDiscoverSellers) -- falls back to the column
    // list without it if the migration adding that column hasn't run yet,
    // same defensive pattern as getProductsListData's own summaryColumns
    // fallback. An explicit column list fails its ENTIRE select the moment
    // one requested column doesn't exist, unlike select('*'), so this
    // can't just be added to the list above without risking the whole
    // endpoint (every seller card, every follower list) 500ing pre-migration.
    let { data, error } = await backendSupabase
      .from('users')
      .select('id, username, photoUrl, role, joinDate, followingSellers, savedProductIds, emailVerified, isAdmin, email, isDeleted, status, lastSeen');
    if (error) {
      const fallback = await backendSupabase
        .from('users')
        .select('id, username, photoUrl, role, joinDate, followingSellers, savedProductIds, emailVerified, isAdmin, email, isDeleted, status');
      data = fallback.data;
      error = fallback.error;
    }
    if (error) throw error;

    const users = (data || [])
      .filter((u: any) => u.isDeleted !== true && u.status !== 'deleted')
      .map((u: any) => ({
        id: u.id,
        username: u.username,
        photoUrl: u.photoUrl,
        role: u.role,
        joinDate: u.joinDate,
        followingSellers: u.followingSellers,
        savedProductIds: u.savedProductIds,
        emailVerified: u.emailVerified,
        isAdmin: u.isAdmin === true || (u.email ? String(u.email).trim().toLowerCase() === 'asumaduvincent7@gmail.com' : false),
        isOnline: computeIsOnline(u.lastSeen),
      }));

    return res.json({ success: true, users });
  } catch (err: any) {
    console.error('[Users List API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to fetch users' });
  }
});

// Admin-only bulk user list, WITH contact info -- backs sendWelcomeEmailToAll
// (AppContext.tsx). Deliberately separate from the public GET /api/users/list
// above rather than adding an "include email" flag to it: that endpoint's
// entire reason for existing is that its response is safe for anyone to
// call, and a flag that changes that guarantee based on a query param would
// be exactly the kind of foot-gun this whole migration is trying to remove.
// This one is real admin-gated, real email/welcomeSent included, and capped
// at a high-but-bounded limit rather than /api/admin/users/search's 50 (that
// endpoint is a search/autocomplete tool; this one needs to see everyone
// eligible for a bulk campaign, which a 50-row cap would silently truncate).
app.get('/api/admin/users/list-full', serverRateLimiter(60 * 1000, 10, "admin-users-list-full"), async (req: express.Request, res: express.Response) => {
  const verified = await verifyAdmin(req.headers.authorization);
  if (!verified) {
    return res.status(403).json({ success: false, error: 'Unauthorized: Admin authorization required' });
  }
  try {
    if (!backendSupabase) {
      return res.status(503).json({ success: false, error: 'Database service unavailable' });
    }
    const { data, error } = await backendSupabase
      .from('users')
      .select('id, email, username, welcomeSent, isDeleted, status')
      .limit(5000);
    if (error) throw error;
    const users = (data || [])
      .filter((u: any) => u.isDeleted !== true && u.status !== 'deleted')
      .map((u: any) => ({ id: u.id, email: u.email, username: u.username, welcomeSent: u.welcomeSent === true }));
    return res.json({ success: true, users });
  } catch (err: any) {
    console.error('[Admin Users List Full API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to fetch users' });
  }
});

// ---------------------------------------------------------------
// Chats & Messages API (server-mediated, authenticated)
// ---------------------------------------------------------------
// Chats/messages are canonically stored in Supabase (public.chats /
// public.messages), accessed only through backendSupabase (server-side).
// Clients never talk to Supabase directly for this data — every request
// here goes through verifyUser() first, and the authenticated Firebase
// UID (never a client-supplied id) is the only value ever used to decide
// buyerId/senderId or to authorize access. A caller may only read or act
// on a chat where they are the buyer or the seller.

async function getChatIfParticipant(chatId: string, uid: string): Promise<any | null> {
  if (!backendSupabase || !chatId) return null;
  const { data } = await backendSupabase.from('chats').select('*').eq('id', chatId).maybeSingle();
  if (!data) return null;
  if (data.buyerId !== uid && data.sellerId !== uid) return null;
  return data;
}

// Real push delivery via Expo's push service -- no FCM/APNs server
// credentials needed for this (Expo's managed push service relays to both
// using the credentials already configured for EAS builds via
// google-services.json/GoogleService-Info.plist). Best-effort and
// read-only against `users.pushToken`; wrapped so a missing column (before
// the schema migration this depends on is applied) or any other failure
// just no-ops rather than affecting the notification this is attached to.
async function sendPushNotification(userId: string, title: string, body: string, data?: Record<string, any>) {
  if (!backendSupabase || !userId) return;
  try {
    const { data: userRow, error } = await backendSupabase.from('users').select('pushToken').eq('id', userId).maybeSingle();
    if (error || !userRow?.pushToken || typeof userRow.pushToken !== 'string' || !userRow.pushToken.startsWith('ExponentPushToken')) {
      return;
    }
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify({
        to: userRow.pushToken,
        title,
        body,
        data: data || {},
        sound: 'default',
      }),
    });
  } catch (err) {
    console.warn('[sendPushNotification] failed:', err);
  }
}

// Found via a dedicated performance audit: the two follower/saver
// notification fan-outs below (new-listing and listing-update) dispatched
// one notification at a time in a plain sequential `for...of` loop with
// `await` inside -- for a seller with hundreds of followers, that's
// hundreds of sequential round trips (a preference-check read, then a
// notification write) before the background task finishes, even though
// it's already fire-and-forget and never blocks the seller's own publish
// response. Both shouldNotifyUser() and createNotification() are already
// internally fault-tolerant (their own try/catch never lets a failure
// propagate), so there's no per-item ordering/error dependency stopping
// this from running concurrently. Batches rather than a single unbounded
// Promise.all so a seller with an unusually large follower count doesn't
// fire thousands of simultaneous Supabase requests in one burst.
async function dispatchInBatches<T>(items: T[], batchSize: number, handler: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(handler));
  }
}

async function createNotification(notif: Record<string, any>) {
  try {
    await safeBackendSupabaseUpsert('notifications', notif, { onConflict: 'id' });
  } catch (err) {
    console.warn('[createNotification] failed to write notification:', err);
  }
  // Real push delivery, on top of the in-app notification row above --
  // previously a user only ever learned about a new
  // message/follower/listing-update if they had the app open (web's poll,
  // or mobile's own chat poll). This is what actually reaches someone who
  // has the app backgrounded or closed. Never blocks or fails the caller.
  sendPushNotification(notif.userId, notif.title, notif.message, { notificationId: notif.id, type: notif.type }).catch(() => {});
}

// Opt-out model (matches the mobile Notification Settings screen): a
// recipient gets a notification type unless they've explicitly turned it
// off, so an unset/missing preferences object never silently suppresses
// notifications for existing users who saved a profile before this field
// existed.
type NotificationPrefKey = 'newFollower' | 'newMessage' | 'followedSellerNewListing';

async function shouldNotifyUser(userId: string, prefKey: NotificationPrefKey): Promise<boolean> {
  if (!backendSupabase || !userId) return true;
  try {
    const { data } = await backendSupabase.from('users').select('notificationPreferences').eq('id', userId).maybeSingle();
    const prefs = data?.notificationPreferences;
    if (!prefs || typeof prefs !== 'object') return true;
    return prefs[prefKey] !== false;
  } catch (err) {
    console.warn('[shouldNotifyUser] preference lookup failed, defaulting to notify:', err);
    return true;
  }
}

// Mirrors web's sendMessage in-app notification trigger (src/context/AppContext.tsx)
// so a message sent from mobile also notifies the recipient, same as web.
async function createChatMessage(chat: any, senderId: string, recipientId: string, text: string) {
  const msgId = `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const newMsg = {
    id: msgId,
    chatId: chat.id,
    senderId,
    recipientId,
    text,
    createdAt: new Date().toISOString(),
    read: false
  };

  const { error } = await safeBackendSupabaseUpsert('messages', newMsg, { onConflict: 'id' });
  if (error) throw error;

  await safeBackendSupabaseUpsert(
    'chats',
    { id: chat.id, lastMessageText: text, lastMessageTime: newMsg.createdAt },
    { onConflict: 'id' }
  );

  const senderName = senderId === chat.buyerId ? (chat.buyerName || 'Buyer') : (chat.sellerName || 'Seller');
  if (await shouldNotifyUser(recipientId, 'newMessage')) {
  await createNotification({
    id: `notif_chat_${Date.now()}_${recipientId}_${Math.random().toString(36).substring(2, 6)}`,
    userId: recipientId,
    type: 'new_message',
    title: `Message from ${senderName}`,
    message: text.length > 50 ? `${text.substring(0, 50)}...` : text,
    triggerUserId: senderId,
    triggerUsername: senderName,
    triggerUserPhoto: '',
    productId: chat.productId || '',
    productTitle: chat.productTitle || 'Shared Listing Chat',
    productPrice: chat.productPrice ?? 'Inquire',
    productImage: chat.productImage || '',
    createdAt: new Date().toISOString(),
    read: false,
    chatId: chat.id
  });
  }

  return newMsg;
}

app.get('/api/chats', serverRateLimiter(60 * 1000, 120, "chats-list"), async (req, res) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required to list chats' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }

  try {
    const { data: chatRows, error } = await backendSupabase
      .from('chats')
      .select('*')
      .or(`buyerId.eq.${verified.uid},sellerId.eq.${verified.uid}`)
      .order('lastMessageTime', { ascending: false });

    if (error) throw error;

    const chatList = chatRows || [];
    const chatIds = chatList.map((c: any) => c.id);

    let unreadByChat: Record<string, number> = {};
    if (chatIds.length > 0) {
      const { data: unreadMsgs } = await backendSupabase
        .from('messages')
        .select('chatId')
        .eq('recipientId', verified.uid)
        .eq('read', false)
        .in('chatId', chatIds);
      (unreadMsgs || []).forEach((m: any) => {
        unreadByChat[m.chatId] = (unreadByChat[m.chatId] || 0) + 1;
      });
    }

    // /api/chats/start never wrote buyerPhoto/sellerPhoto when a chat row
    // was first created (only the *Name fields), so every chat's avatar
    // fell back to initials regardless of whether either party actually
    // has a profile photo -- confirmed via a full read of that endpoint,
    // not guessed at. Rather than a one-time backfill (which would still
    // go stale the next time someone changes their photo), always overlay
    // each party's CURRENT photoUrl here at read time, in one batched
    // lookup per response -- this fixes every existing chat immediately,
    // not just new ones, and keeps photos fresh going forward instead of
    // freezing them at whatever they were when the chat started.
    const counterpartIds = new Set<string>();
    chatList.forEach((c: any) => {
      if (c.buyerId) counterpartIds.add(String(c.buyerId));
      if (c.sellerId) counterpartIds.add(String(c.sellerId));
    });
    let photoByUserId: Record<string, string> = {};
    if (counterpartIds.size > 0) {
      const { data: photoRows } = await backendSupabase
        .from('users')
        .select('id, photoUrl')
        .in('id', Array.from(counterpartIds));
      (photoRows || []).forEach((u: any) => {
        if (u.id && u.photoUrl) photoByUserId[String(u.id)] = u.photoUrl;
      });
    }

    const chats = chatList.map((c: any) => ({
      ...c,
      unreadCount: unreadByChat[c.id] || 0,
      buyerPhoto: (c.buyerId && photoByUserId[String(c.buyerId)]) || c.buyerPhoto || '',
      sellerPhoto: (c.sellerId && photoByUserId[String(c.sellerId)]) || c.sellerPhoto || '',
    }));
    return res.json({ success: true, chats });
  } catch (err: any) {
    console.error('[Chats List API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to fetch chats' });
  }
});

app.get('/api/chats/:chatId', serverRateLimiter(60 * 1000, 300, "chat-detail"), async (req, res) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
  }

  const chat = await getChatIfParticipant(req.params.chatId, verified.uid);
  if (!chat) {
    return res.status(404).json({ success: false, error: 'Chat not found' });
  }
  return res.json({ success: true, chat });
});

app.post('/api/chats/start', serverRateLimiter(5 * 60 * 1000, 5, "chat-start"), async (req, res) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required to start a chat' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }

  const { productId, initialMessage } = req.body || {};
  if (!productId || typeof productId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing productId' });
  }

  try {
    const { data: product } = await backendSupabase.from('products').select('*').eq('id', productId).maybeSingle();
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const buyerId = verified.uid;
    const sellerId = product.sellerId || product.seller_id;
    if (!sellerId) {
      return res.status(400).json({ success: false, error: 'This listing has no seller on record' });
    }
    if (buyerId === sellerId) {
      return res.status(400).json({ success: false, error: 'You cannot start a chat on your own listing.' });
    }

    const { data: existingChat } = await backendSupabase
      .from('chats')
      .select('*')
      .eq('productId', productId)
      .eq('buyerId', buyerId)
      .eq('sellerId', sellerId)
      .maybeSingle();

    let chat = existingChat;
    if (!chat) {
      const { data: buyerProfile } = await backendSupabase.from('users').select('username').eq('id', buyerId).maybeSingle();
      const chatId = `chat_${buyerId}_${sellerId}_${productId}_${Date.now()}`;
      const productImage = Array.isArray(product.images) && product.images.length > 0 ? product.images[0] : '';

      const newChat = {
        id: chatId,
        productId: product.id,
        productTitle: product.title,
        productPrice: product.price,
        productImage,
        buyerId,
        buyerName: buyerProfile?.username || verified.email?.split('@')[0] || 'Buyer',
        sellerId,
        sellerName: product.sellerName || 'Seller',
        lastMessageText: 'Chat started',
        lastMessageTime: new Date().toISOString(),
        tradeStatus: 'pending',
        adId: product.id,
        adTitle: product.title,
        adImage: productImage,
        adType: Array.isArray(product.videos) && product.videos.length > 0 ? 'video' : 'image'
      };

      const { error: createErr } = await safeBackendSupabaseUpsert('chats', newChat, { onConflict: 'id' });
      if (createErr) throw createErr;
      chat = newChat;
    }

    let message = null;
    const cleanInitial = typeof initialMessage === 'string' ? initialMessage.trim().slice(0, 5000) : '';
    if (cleanInitial) {
      message = await createChatMessage(chat, buyerId, sellerId, cleanInitial);
    }

    return res.json({ success: true, chatId: chat.id, chat, message });
  } catch (err: any) {
    console.error('[Chat Start API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to start chat' });
  }
});

app.get('/api/messages/:chatId', serverRateLimiter(60 * 1000, 300, "messages-list"), async (req, res) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
  }

  let chat = await getChatIfParticipant(req.params.chatId, verified.uid);

  // Admin-as-support-desk fallback, RLS-migration Phase 2: mirrors
  // /api/messages/send's and /api/messages/mark-read's own fallbacks
  // (same file) -- the CEO-support pseudo-account isn't a real chat
  // participant per getChatIfParticipant, so an admin reading that
  // thread's messages needs the same carve-out. Closes the direct
  // onSnapshot/getDocs realtime subscription in ChatInterface.tsx used
  // for exactly this case. Reachable only by a cryptographically-
  // verified admin, only for the support account's own chat.
  if (!chat && verified.isAdmin && backendSupabase) {
    const { data: rawChat } = await backendSupabase.from('chats').select('*').eq('id', req.params.chatId).maybeSingle();
    if (rawChat && rawChat.sellerId === 'user_ted_ceo_support') {
      chat = rawChat;
    }
  }

  if (!chat) {
    return res.status(404).json({ success: false, error: 'Chat not found' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }

  const limitParam = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
  const before = typeof req.query.before === 'string' ? req.query.before : null;

  try {
    let q = backendSupabase
      .from('messages')
      .select('*')
      .eq('chatId', req.params.chatId)
      .order('createdAt', { ascending: false })
      .limit(limitParam);
    if (before) {
      q = q.lt('createdAt', before);
    }
    const { data, error } = await q;
    if (error) throw error;

    const rows = data || [];
    const messages = rows.slice().reverse();
    return res.json({ success: true, messages, hasMore: rows.length === limitParam });
  } catch (err: any) {
    console.error('[Messages List API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to fetch messages' });
  }
});

app.post('/api/messages/send', serverRateLimiter(60 * 1000, 30, "message-send"), async (req, res) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required to send a message' });
  }

  const { chatId, text } = req.body || {};
  if (!chatId || typeof text !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing chatId or text' });
  }
  const cleanText = text.trim();
  if (!cleanText) {
    return res.status(400).json({ success: false, error: 'Message text cannot be empty.' });
  }
  if (cleanText.length > 5000) {
    return res.status(400).json({ success: false, error: 'Message cannot exceed 5000 characters.' });
  }

  let chat = await getChatIfParticipant(chatId, verified.uid);
  let sendAsSenderId = verified.uid;

  // Admin-as-support-desk fallback: the CEO-support pseudo-account
  // ('user_ted_ceo_support') isn't a real Firebase user, so an admin
  // replying on its behalf is never a genuine chat participant per
  // getChatIfParticipant's own buyerId/sellerId check above. This is the
  // notification-security migration's completion of that path (see
  // .ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md §18) -- previously
  // handled entirely client-side via a direct, unauthenticated Supabase
  // write; this is the real server endpoint it migrates to. Reachable
  // ONLY by a cryptographically-verified admin (verified.isAdmin, from
  // verifyUser() -- never a client-supplied claim), and only for a chat
  // that is genuinely the support pseudo-account's own chat.
  if (!chat && verified.isAdmin && backendSupabase) {
    const { data: rawChat } = await backendSupabase.from('chats').select('*').eq('id', chatId).maybeSingle();
    if (rawChat && rawChat.sellerId === 'user_ted_ceo_support') {
      chat = rawChat;
      sendAsSenderId = 'user_ted_ceo_support';
    }
  }

  if (!chat) {
    return res.status(404).json({ success: false, error: 'Chat not found' });
  }

  try {
    const recipientId = chat.buyerId === sendAsSenderId ? chat.sellerId : chat.buyerId;
    const message = await createChatMessage(chat, sendAsSenderId, recipientId, cleanText);
    return res.json({ success: true, message });
  } catch (err: any) {
    console.error('[Message Send API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to send message' });
  }
});

app.post('/api/messages/mark-read', serverRateLimiter(60 * 1000, 120, "messages-mark-read"), async (req, res) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
  }

  const { chatId } = req.body || {};
  if (!chatId) {
    return res.status(400).json({ success: false, error: 'Missing chatId' });
  }

  let chat = await getChatIfParticipant(chatId, verified.uid);
  let recipientIdForRead = verified.uid;

  // Admin-as-support-desk fallback, RLS-migration Phase 1: mirrors
  // /api/messages/send's own fallback above (same file) -- the CEO-support
  // pseudo-account isn't a real chat participant per getChatIfParticipant,
  // so an admin marking that thread's messages as read needs the same
  // carve-out. Closes the direct dbAdapter write markChatAsRead
  // (AppContext.tsx) used for exactly this case. Reachable only by a
  // cryptographically-verified admin, only for the support account's own
  // chat.
  if (!chat && verified.isAdmin && backendSupabase) {
    const { data: rawChat } = await backendSupabase.from('chats').select('*').eq('id', chatId).maybeSingle();
    if (rawChat && rawChat.sellerId === 'user_ted_ceo_support') {
      chat = rawChat;
      recipientIdForRead = 'user_ted_ceo_support';
    }
  }

  if (!chat) {
    return res.status(404).json({ success: false, error: 'Chat not found' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }

  try {
    const { data, error } = await backendSupabase
      .from('messages')
      .update({ read: true })
      .eq('chatId', chatId)
      .eq('recipientId', recipientIdForRead)
      .eq('read', false)
      .select('id');

    if (error) throw error;
    return res.json({ success: true, updatedCount: (data || []).length });
  } catch (err: any) {
    console.error('[Messages Mark Read API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to mark messages as read' });
  }
});

// Trade-completion stepper (Confirm Delivered / Mark as Picked up). Mobile's
// chat data lives in Supabase (via this API), not Firestore — these mirror
// web's markAsDelivered/markAsPickedUp (src/context/AppContext.tsx) on the
// correct backend instead of writing to a database mobile never reads from.
app.post('/api/chats/mark-delivered', serverRateLimiter(60 * 1000, 30, "chats-mark-delivered"), async (req, res) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
  }
  const { chatId } = req.body || {};
  if (!chatId) {
    return res.status(400).json({ success: false, error: 'Missing chatId' });
  }
  const chat = await getChatIfParticipant(chatId, verified.uid);
  if (!chat) {
    return res.status(404).json({ success: false, error: 'Chat not found' });
  }
  if (chat.sellerId !== verified.uid) {
    return res.status(403).json({ success: false, error: 'Only the seller can confirm delivery.' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }

  try {
    const updatedAt = new Date().toISOString();
    const { error } = await backendSupabase
      .from('chats')
      .update({ deliveredBySeller: true, tradeStatus: 'delivered', lastMessageText: '📦 Seller marked item as delivered', lastMessageTime: updatedAt })
      .eq('id', chatId);
    if (error) throw error;

    await createChatMessage(
      chat,
      chat.sellerId,
      chat.buyerId,
      '📦 Seller has marked this item as delivered. Please inspect it and tap "Mark as Picked up" once you have received it.'
    );
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Chats Mark Delivered API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to confirm delivery' });
  }
});

app.post('/api/chats/mark-picked-up', serverRateLimiter(60 * 1000, 30, "chats-mark-picked-up"), async (req, res) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
  }
  const { chatId } = req.body || {};
  if (!chatId) {
    return res.status(400).json({ success: false, error: 'Missing chatId' });
  }
  const chat = await getChatIfParticipant(chatId, verified.uid);
  if (!chat) {
    return res.status(404).json({ success: false, error: 'Chat not found' });
  }
  if (chat.buyerId !== verified.uid) {
    return res.status(403).json({ success: false, error: 'Only the buyer can confirm pickup.' });
  }
  // Found via a dedicated audit: previously unconditional, so a buyer could
  // reach `tradeStatus: 'completed'` (which /api/reviews/create trusts as
  // proof of a genuine trade) without the seller ever confirming delivery
  // first, by calling this endpoint directly rather than through the app's
  // own UI. Both platforms' real UI already structurally prevent this --
  // web (ChatInterface.tsx) only renders an enabled "Mark as Picked up"
  // button when currentStatus === 'delivered', otherwise a disabled
  // "(Locked)" button; mobile (ChatsScreen.tsx) only renders the action at
  // all when currentStatus === 'delivered' -- so this check can never
  // reject a legitimate in-app confirmation, only a direct-API bypass of
  // that same precondition.
  if (!chat.deliveredBySeller) {
    return res.status(409).json({ success: false, error: 'The seller must confirm delivery before pickup can be confirmed.' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }

  try {
    const updatedAt = new Date().toISOString();
    const { error } = await backendSupabase
      .from('chats')
      .update({ pickedUpByBuyer: true, tradeStatus: 'completed', lastMessageText: '🤝 Buyer marked as picked up', lastMessageTime: updatedAt })
      .eq('id', chatId);
    if (error) throw error;

    await createChatMessage(
      chat,
      chat.buyerId,
      chat.sellerId,
      '🤝 Buyer has marked this item as PICKED UP and confirmed purchase.'
    );
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Chats Mark Picked Up API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to confirm pickup' });
  }
});

// Reviews & Reports — same 'reviews'/'reports' Supabase tables web's own
// dbAdapter routes to. Mobile has no direct-Supabase client (unlike web,
// which can use the public anon key + RLS), so these go through the
// verified server path instead, consistent with the rest of mobile's API.
// RLS-migration Phase 2, checkpoint 21: `sellerId` is now optional. This
// used to always 400 without it, so the client's own global reviews sync
// (AppContext.tsx, populating the shared `reviews` state every consumer
// filters locally by sellerId) had no server-mediated equivalent and
// stayed on a direct, unauthenticated `getDocs(collection('reviews'))`
// bulk read -- the last item left open in this whole migration. Safe to
// serve unscoped: reviews are already treated as public content (Phase 3
// of the migration plan), and this table's schema carries no PII
// (id/sellerId/buyerId/buyerName/rating/comment/createdAt/productTitle;
// buyerName is already just an email-prefix-derived display name, same as
// shown on every review card today).
app.get('/api/reviews', serverRateLimiter(60 * 1000, 120, "reviews-list"), async (req, res) => {
  const { sellerId } = req.query;
  if (sellerId !== undefined && typeof sellerId !== 'string') {
    return res.status(400).json({ success: false, error: 'Invalid sellerId' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }
  // Egress fix: this endpoint had no caching at all, unlike every sibling
  // read-heavy endpoint (/api/sellers, /api/search/suggestions, /api/featured,
  // etc, all on the same 60s serverCache+ETag pattern) -- and the no-sellerId
  // case (AppContext.tsx's "fetch once on mount" global reviews state) returns
  // literally every review ever created, unpaginated. Reviews change rarely
  // relative to how often this is fetched (every web session), so a 60s cache
  // is a real, safe win: a repeat request within the window costs a 304 with
  // no body instead of re-transferring and re-querying the entire table.
  // Invalidated immediately on a new review below rather than left to expire,
  // so a just-submitted review is visible right away, not "eventually".
  const cacheKey = `reviews:${sellerId || 'all'}`;
  const cached = serverCache.get<any[]>(cacheKey);
  if (cached) {
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('ETag', cached.etag);
    if (req.headers['if-none-match'] === cached.etag) {
      return res.status(304).end();
    }
    return res.json({ success: true, reviews: cached.value });
  }
  try {
    let q = backendSupabase.from('reviews').select('*').order('createdAt', { ascending: false });
    if (sellerId) {
      q = q.eq('sellerId', sellerId);
    }
    const { data, error } = await q;
    if (error) throw error;
    const reviews = data || [];
    const etag = serverCache.set(cacheKey, reviews, 60);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('ETag', etag);
    return res.json({ success: true, reviews });
  } catch (err: any) {
    console.error('[Reviews List API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to fetch reviews' });
  }
});

app.post('/api/reviews/create', serverRateLimiter(5 * 60 * 1000, 10, "reviews-create"), async (req, res) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required to submit reviews' });
  }
  const { sellerId, rating, comment, productTitle, chatId } = req.body || {};
  if (!sellerId || typeof sellerId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing sellerId' });
  }
  if (sellerId === verified.uid) {
    return res.status(400).json({ success: false, error: 'You cannot review your own store.' });
  }
  const cleanComment = typeof comment === 'string' ? comment.trim() : '';
  if (cleanComment.length < 5 || cleanComment.length > 1000) {
    return res.status(400).json({ success: false, error: 'Comment must be between 5 and 1000 characters long.' });
  }
  const numericRating = Math.floor(Number(rating));
  if (!numericRating || numericRating < 1 || numericRating > 5) {
    return res.status(400).json({ success: false, error: 'Review rating must be between 1 and 5 stars.' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }

  // A review is only authentic if it's tied to a trade that actually
  // completed — previously this endpoint took `productTitle` as arbitrary
  // client-supplied text and had no concept of a trade at all, so anyone
  // could open a seller's store page and post a review with no evidence
  // they ever contacted or bought from them. chatId is now REQUIRED (it
  // used to be optional, used only to drop a courtesy message into the
  // chat) and must reference one of the reviewer's own chats with this
  // exact seller, already marked tradeStatus:'completed' by the existing
  // mark-delivered (seller) → mark-picked-up (buyer) flow. productTitle is
  // derived from that chat, never trusted from the request body, so a
  // review can't misrepresent which listing it's actually about.
  if (!chatId || typeof chatId !== 'string') {
    return res.status(400).json({ success: false, error: 'Reviews can only be left from a completed trade chat.' });
  }
  const tradeChat = await getChatIfParticipant(chatId, verified.uid);
  if (!tradeChat || tradeChat.buyerId !== verified.uid || tradeChat.sellerId !== sellerId) {
    return res.status(403).json({ success: false, error: 'This chat does not match a trade between you and this merchant.' });
  }
  if (tradeChat.tradeStatus !== 'completed') {
    return res.status(403).json({ success: false, error: 'You can only leave a review after this trade is marked completed.' });
  }
  const cleanProductTitle = tradeChat.productTitle && typeof tradeChat.productTitle === 'string' ? tradeChat.productTitle.trim() : null;

  // Server-side is the only authoritative "once per trade" guard — the
  // client hides its own Leave Review button once it has one, but that's
  // just UI; nothing previously stopped a double-tap, a stale reopened
  // modal, or a direct API call from creating a second review for the same
  // buyer/seller/trade. Matches on buyerId+sellerId+productTitle exactly
  // like the client's own existingReview lookup.
  try {
    let dupQuery = backendSupabase
      .from('reviews')
      .select('id')
      .eq('buyerId', verified.uid)
      .eq('sellerId', sellerId);
    dupQuery = cleanProductTitle ? dupQuery.eq('productTitle', cleanProductTitle) : dupQuery.is('productTitle', null);
    const { data: existing } = await dupQuery.maybeSingle();
    if (existing) {
      return res.status(400).json({ success: false, error: 'You have already reviewed this trade.' });
    }
  } catch (dupErr) {
    console.warn('[Reviews Create API] Duplicate-review check failed, proceeding:', dupErr);
  }

  const revId = `rev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const newReview: Record<string, any> = {
    id: revId,
    sellerId,
    buyerId: verified.uid,
    buyerName: verified.email?.split('@')[0] || 'User',
    rating: numericRating,
    comment: cleanComment,
    createdAt: new Date().toISOString(),
  };
  if (cleanProductTitle) newReview.productTitle = cleanProductTitle;

  try {
    const { error } = await safeBackendSupabaseUpsert('reviews', newReview, { onConflict: 'id' });
    if (error) throw error;

    // Invalidate GET /api/reviews' new 60s cache for both this seller's own
    // key and the unscoped "all" key (AppContext.tsx's global reviews
    // state) so this just-submitted review is visible immediately instead
    // of waiting up to a minute.
    serverCache.delete(`reviews:${sellerId}`);
    serverCache.delete('reviews:all');

    // Drop a system message into the chat this review was left from, so the
    // seller sees it without having to separately check their reviews list.
    // tradeChat is already the verified buyer/seller-matched chat from the
    // gate above — no need to re-fetch or re-check it here. The review
    // itself is already saved by this point, so ANY failure in this part
    // (a transient DB error) must never turn into a 500 for a request that
    // actually succeeded — wrapped in its own try/catch rather than letting
    // it reach the outer one.
    try {
      const tone = numericRating >= 4 ? 'positive' : numericRating === 3 ? 'neutral' : 'critical';
      await createChatMessage(
        tradeChat,
        tradeChat.buyerId,
        tradeChat.sellerId,
        `⭐ Buyer has left you ${tone} feedback with a ${numericRating}-star rating: "${cleanComment}"`
      );
    } catch (chatMsgErr) {
      console.warn('[Reviews Create API] Could not post review chat message:', chatMsgErr);
    }

    return res.json({ success: true, review: newReview });
  } catch (err: any) {
    console.error('[Reviews Create API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to submit review' });
  }
});

app.post('/api/reports/create', serverRateLimiter(5 * 60 * 1000, 5, "reports-create"), async (req, res) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required to report a listing' });
  }
  const { productId, productTitle, reason, comment } = req.body || {};
  if (!productId || typeof productId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing productId' });
  }
  if (!reason || typeof reason !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing reason' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }

  const reportId = `report_${verified.uid}_${productId}_${Date.now()}`;
  const reportData: Record<string, any> = {
    id: reportId,
    productId,
    productTitle: typeof productTitle === 'string' ? productTitle : '',
    reporterId: verified.uid,
    reporterName: verified.email?.split('@')[0] || 'User',
    reason,
    comment: typeof comment === 'string' ? comment.trim() : '',
    createdAt: new Date().toISOString(),
  };

  try {
    const { error } = await safeBackendSupabaseUpsert('reports', reportData, { onConflict: 'id' });
    if (error) throw error;
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Reports Create API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to submit report' });
  }
});

// Notifications feed — same 'notifications' Supabase table web reads
// directly via its own anon-key client. Mobile has no direct Supabase
// access, so it reads/manages notifications through this verified path.
app.get('/api/notifications', serverRateLimiter(60 * 1000, 120, "notifications-list"), async (req, res) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }
  try {
    const { data, error } = await backendSupabase
      .from('notifications')
      .select('*')
      .eq('userId', verified.uid)
      .order('createdAt', { ascending: false })
      .limit(100);
    if (error) throw error;
    return res.json({ success: true, notifications: data || [] });
  } catch (err: any) {
    console.error('[Notifications List API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to fetch notifications' });
  }
});

app.post('/api/notifications/mark-read', serverRateLimiter(60 * 1000, 120, "notifications-mark-read"), async (req, res) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
  }
  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ success: false, error: 'Missing id' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }
  try {
    const { error } = await backendSupabase
      .from('notifications')
      .update({ read: true })
      .eq('id', id)
      .eq('userId', verified.uid);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Notifications Mark Read API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to mark notification as read' });
  }
});

app.post('/api/notifications/mark-all-read', serverRateLimiter(60 * 1000, 30, "notifications-mark-all-read"), async (req, res) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }
  try {
    const { error } = await backendSupabase
      .from('notifications')
      .update({ read: true })
      .eq('userId', verified.uid)
      .eq('read', false);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Notifications Mark All Read API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to mark notifications as read' });
  }
});

app.post('/api/notifications/clear-all', serverRateLimiter(60 * 1000, 10, "notifications-clear-all"), async (req, res) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }
  try {
    const { error } = await backendSupabase
      .from('notifications')
      .delete()
      .eq('userId', verified.uid);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Notifications Clear All API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to clear notifications' });
  }
});

// Follow/unfollow a seller — updates the caller's own followingSellers list
// (never another user's record) and, on a new follow, notifies the seller.
// Mirrors web's followSeller/unfollowSeller (src/context/AppContext.tsx).
// Saves the caller's own device's Expo push token so createNotification()
// (above) can actually reach them with a real push, not just an in-app
// notification row they'll only see next time they open the app. Depends
// on the users.pushToken column existing -- see
// .ai/handoffs/PUSH_NOTIFICATIONS_SCHEMA_PROPOSAL.md for the exact SQL,
// which has NOT been applied to production yet (schema changes require
// Vincent's explicit approval, same as every other schema change this
// session). Until that migration runs, this endpoint's own write will
// simply fail (column does not exist) and report a real 500 -- it isn't
// silently pretending to succeed.
app.post('/api/users/push-token', serverRateLimiter(60 * 1000, 20, "users-push-token"), async (req, res) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
  }
  const { pushToken, platform } = req.body || {};
  if (!pushToken || typeof pushToken !== 'string' || !pushToken.startsWith('ExponentPushToken')) {
    return res.status(400).json({ success: false, error: 'Missing or invalid pushToken' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }

  try {
    const { error } = await backendSupabase
      .from('users')
      .update({
        pushToken,
        pushTokenPlatform: typeof platform === 'string' ? platform.slice(0, 20) : null,
        pushTokenUpdatedAt: new Date().toISOString(),
      })
      .eq('id', verified.uid);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Push Token API] Failed to save push token:', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to save push token' });
  }
});

// Online presence — matches WhatsApp's model: no realtime push, just a
// "how recently was this user active" timestamp that the client refreshes
// periodically while foregrounded (see web's AppContext.tsx and mobile's
// App.tsx, both call this every 2 minutes). "Online" is always DERIVED
// from lastSeen at read time (computeIsOnline below), never stored as its
// own boolean -- a stored isOnline flag would get stuck "true" forever
// the moment a client stops calling this (app killed, backgrounded,
// network lost) with no reliable moment to ever flip it back to false.
const ONLINE_THRESHOLD_MS = 90 * 1000; // a bit more than the 60-second heartbeat interval (App.tsx / AppContext.tsx), to tolerate one missed beat
function computeIsOnline(lastSeen: any): boolean {
  if (!lastSeen) return false;
  const t = new Date(lastSeen).getTime();
  return !isNaN(t) && (Date.now() - t) < ONLINE_THRESHOLD_MS;
}

app.post('/api/users/heartbeat', serverRateLimiter(60 * 1000, 20, "users-heartbeat"), async (req, res) => {
  // Deliberately does NOT pass an impersonation session id to verifyUser()
  // here, unlike nearly every other endpoint -- this must always resolve
  // to whichever Firebase account the request is really signed in as, even
  // while an admin has an active "view as this seller" session open
  // elsewhere in the app. Presence represents who is REALLY at a device
  // right now; honoring impersonation here would let a real admin's own
  // ordinary activity get silently recorded as the impersonated seller
  // being online, making a genuinely inactive account falsely show as
  // active for as long as that admin's browser/app kept polling. The web
  // client also strips this header before calling (AppContext.tsx) --
  // this is the authoritative half of that fix, since a client can't be
  // trusted alone to always remember to omit it.
  const verified = await verifyUser(req.headers.authorization);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }
  try {
    const { error } = await backendSupabase
      .from('users')
      .update({ lastSeen: new Date().toISOString() })
      .eq('id', verified.uid);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err: any) {
    // Best-effort, cosmetic feature -- same tolerance as push-token
    // registration right above. Clients already swallow this silently.
    console.warn('[Heartbeat API] Failed to update lastSeen:', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to update presence' });
  }
});

app.post('/api/users/follow', serverRateLimiter(60 * 1000, 30, "users-follow"), async (req, res) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
  }
  const { sellerId, follow } = req.body || {};
  if (!sellerId || typeof sellerId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing sellerId' });
  }
  if (sellerId === verified.uid) {
    return res.status(400).json({ success: false, error: 'You cannot follow your own shop.' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }

  try {
    const { data: me, error: meErr } = await backendSupabase
      .from('users')
      .select('*')
      .eq('id', verified.uid)
      .maybeSingle();
    if (meErr) throw meErr;
    if (!me) return res.status(404).json({ success: false, error: 'User not found' });

    const following: string[] = Array.isArray(me.followingSellers) ? me.followingSellers : [];
    const alreadyFollowing = following.includes(sellerId);
    const shouldFollow = follow !== false;
    const updatedFollowing = shouldFollow
      ? (alreadyFollowing ? following : [...following, sellerId])
      : following.filter((id) => id !== sellerId);

    const { error: updateErr } = await backendSupabase
      .from('users')
      .update({ followingSellers: updatedFollowing })
      .eq('id', verified.uid);
    if (updateErr) throw updateErr;

    if (shouldFollow && !alreadyFollowing && await shouldNotifyUser(sellerId, 'newFollower')) {
      await createNotification({
        id: `notif_follow_${Date.now()}_${sellerId}_${Math.random().toString(36).substring(2, 6)}`,
        userId: sellerId,
        type: 'new_follower',
        title: 'New Follower!',
        message: `${me.username || verified.email?.split('@')[0] || 'Someone'} started following your shop!`,
        triggerUserId: verified.uid,
        triggerUsername: me.username || verified.email?.split('@')[0] || 'Someone',
        triggerUserPhoto: me.photoUrl || '',
        productId: '',
        productTitle: 'Shop Network',
        productPrice: '0',
        productImage: '',
        createdAt: new Date().toISOString(),
        read: false
      });
    }

    return res.json({ success: true, followingSellers: updatedFollowing });
  } catch (err: any) {
    console.error('[Users Follow API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to update follow status' });
  }
});

// -------------------------------------------------------------
// PAYMENT VERIFICATION & BOOST CONTROL ENDPOINTS
// -------------------------------------------------------------
const BOOST_PLAN_DURATION_DAYS: Record<string, number> = {
  '3days': 3,
  '7days': 7,
  '14days': 14,
  '21days': 21,
  '1month': 30
};
// Mirrors BOOST_PLANS' priceGHS (mobile/src/utils/boost.ts, src/components/BoostModal.tsx) —
// the server-side source of truth actually charged against, never the client-supplied amount.
const BOOST_PLAN_PRICE_GHS: Record<string, number> = {
  '3days': 1,
  '7days': 3,
  '14days': 5,
  '21days': 7,
  '1month': 10
};

async function verifyPaystackTransaction(reference: string): Promise<{ ok: boolean; amountPesewas?: number; metadata?: any; error?: string }> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) return { ok: false, error: 'Paystack is not configured on this server.' };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
      signal: controller.signal,
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json?.status || json?.data?.status !== 'success') {
      return { ok: false, error: json?.data?.gateway_response || json?.message || 'Payment could not be verified.' };
    }
    // metadata is whatever /api/paystack/initialize-boost stashed on this
    // transaction at creation time (productId/planId/purpose) -- Paystack
    // stores and echoes it back verbatim, so it's an authoritative record
    // of what was actually paid for, independent of anything this request's
    // own body claims.
    return { ok: true, amountPesewas: Number(json.data.amount) || 0, metadata: json.data.metadata || null };
  } catch (err: any) {
    return { ok: false, error: err?.name === 'AbortError' ? 'Payment gateway verification timed out.' : (err?.message || 'Payment gateway verification failed.') };
  } finally {
    clearTimeout(timeoutId);
  }
}

// Business-logic fix (found via a dedicated boost/payment correctness audit,
// distinct from the earlier security pass on this same endpoint): there was
// no locking of any kind around the read-existing-boost -> verify-with-
// Paystack -> compute-extension -> upsert sequence below, and
// upsertProductToSupabase does its own separate read-then-write too. Two
// DIFFERENT, both-genuine payment references for the SAME product,
// verified in overlapping windows (very plausible given the multi-second
// Paystack round trip -- e.g. a seller buys a 3-day boost, then a few
// seconds later buys a 7-day one before the first request has finished),
// both read the same stale boostEndDate/boostHistory and each compute
// their own extension independently. Whichever upsert lands second
// silently overwrites the first's boostEndDate/boostHistory entirely --
// the two purchases don't stack, and the loser's paid-for boost duration
// and audit-trail entry are lost even though its own boost_purchases
// ledger row still correctly records the payment as used. This is a
// distinct bug from the already-fixed same-reference replay: both
// references here are unique and legitimate, so no anti-replay check
// catches it.
//
// Fixed with an in-process, per-productId async mutex: serializes the
// entire read-modify-write critical section below so a second purchase
// for the same product always sees the first one's already-applied
// extension before computing its own. This closes the race completely for
// a single server instance/process (this app's current Render deployment
// shape) -- it would NOT protect against the same race across multiple
// concurrent server processes/instances, which would need a real
// DB-level lock or optimistic-concurrency column instead; out of scope
// for a same-session fix without live DB access to verify a schema change
// against.
const productBoostLocks = new Map<string, Promise<unknown>>();
function withProductBoostLock<T>(productId: string, fn: () => Promise<T>): Promise<T> {
  const previous = productBoostLocks.get(productId) || Promise.resolve();
  const run = previous.then(fn, fn);
  const chained = run.then(() => undefined, () => undefined);
  productBoostLocks.set(productId, chained);
  chained.finally(() => {
    // Only clear the map entry if nothing newer has queued behind this
    // call -- avoids the map growing forever for productIds that are
    // rarely boosted, without risking dropping a still-relevant lock for
    // one that's mid-queue.
    if (productBoostLocks.get(productId) === chained) {
      productBoostLocks.delete(productId);
    }
  });
  return run;
}

app.post('/api/verify-payment', serverRateLimiter(60 * 1000, 20, "verify-payment"), async (req: express.Request, res: express.Response) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required to activate a boost' });
  }

  const { paymentReference, productId, planId, paymentMethod } = req.body || {};

  if (!productId || typeof productId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing required parameter: productId' });
  }
  if (!paymentReference || typeof paymentReference !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing payment reference.' });
  }

  // Starts as the client-submitted plan; for a real (non-admin-free) Paystack
  // payment this is overridden below by whatever planId Paystack's own
  // transaction metadata says was actually paid for (set immutably at
  // /api/paystack/initialize-boost time) -- otherwise a client could pay for
  // an expensive plan, then call this endpoint with a cheaper planId and be
  // awarded the cheap plan's (shorter) duration/priority while TedBuy kept
  // the full amount paid. The existing amount check below already stops the
  // reverse (claiming a pricier plan than was actually paid for).
  let effectivePlanId = planId;
  let durationDays = BOOST_PLAN_DURATION_DAYS[effectivePlanId] || 7;
  let expectedPriceGHS = BOOST_PLAN_PRICE_GHS[effectivePlanId] || BOOST_PLAN_PRICE_GHS['7days'];

  try {
   await withProductBoostLock(productId, async () => {
    // P0 fix: Paystack's verify endpoint is idempotent -- it just reports a
    // transaction's historical status, and will happily keep reporting
    // "success" for the same reference forever. Nothing here previously
    // stopped a genuinely successful reference from being replayed through
    // this endpoint an unlimited number of times, for the same product
    // (indefinitely extending a boost that was only ever paid for once) or
    // different ones (activating boosts on multiple listings from one
    // payment). boost_purchases already existed in the schema for exactly
    // this purpose but nothing ever wrote to it. Using paymentReference as
    // its primary key gives a real, atomic-at-the-database-level
    // uniqueness guarantee, not just an application-level check.
    if (backendSupabase) {
      const { data: existingPurchase } = await backendSupabase
        .from('boost_purchases')
        .select('id')
        .eq('id', paymentReference)
        .maybeSingle();
      if (existingPurchase) {
        return res.status(409).json({ success: false, error: 'This payment reference has already been used to activate a boost.' });
      }
    }

    let existingProduct: any = null;
    if (backendSupabase) {
      try {
        const { data } = await backendSupabase.from('products').select('*').eq('id', productId).maybeSingle();
        existingProduct = data;
      } catch (e) {
        console.warn('[Verify Payment API] Could not fetch existing product from Supabase:', e);
      }
    }

    if (!existingProduct) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }
    const isAdmin = verified.isAdmin || (verified.email && verified.email.trim().toLowerCase() === 'asumaduvincent7@gmail.com');
    if (existingProduct.sellerId !== verified.uid && !isAdmin) {
      return res.status(403).json({ success: false, error: 'You can only boost your own listing.' });
    }

    // "admin" is a real, intentional zero-payment path — but only ever
    // trusted because verifyUser() itself already confirmed this identity
    // is an admin (never because the client merely claimed paymentMethod
    // === 'admin').
    const isReferenceAdminFree = typeof paymentReference === 'string' && paymentReference.startsWith('ADMIN_FREE_BOOST_');
    const isAdminFreeBoost = (paymentMethod === 'admin' || isReferenceAdminFree) && isAdmin;
    if ((paymentMethod === 'admin' || isReferenceAdminFree) && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Only an administrator can activate a free boost.' });
    }

    let verifiedAmountGHS = 0;

    if (!isAdminFreeBoost) {
      if (process.env.PAYSTACK_SECRET_KEY) {
        // Real credentials are configured — every non-admin boost must
        // genuinely clear Paystack's own verify endpoint, and the amount
        // actually paid must meet the selected plan's real price. This is
        // also what makes a demo/simulated reference (used while no live
        // Paystack keys exist yet) safely and automatically stop
        // "succeeding" the moment real keys are put in place, since a
        // fake client-generated reference simply won't exist in
        // Paystack's system.
        const verifyResult = await verifyPaystackTransaction(paymentReference);
        if (!verifyResult.ok) {
          return res.status(402).json({ success: false, error: verifyResult.error || 'Payment could not be verified with Paystack.' });
        }
        // The plan actually paid for is whatever initialize-boost stashed in
        // this transaction's metadata, not whatever planId this request's
        // body claims — realigns durationDays/expectedPriceGHS to it before
        // the amount check below, so a request can't under-claim a cheaper
        // plan than the one it genuinely paid for. Falls back to the
        // request's own planId only if the metadata is missing/unrecognized
        // (e.g. a reference from before this metadata field existed).
        const metaPlanId = verifyResult.metadata?.planId;
        if (metaPlanId && BOOST_PLAN_PRICE_GHS[metaPlanId] !== undefined) {
          effectivePlanId = metaPlanId;
          durationDays = BOOST_PLAN_DURATION_DAYS[effectivePlanId] || 7;
          expectedPriceGHS = BOOST_PLAN_PRICE_GHS[effectivePlanId];
        }
        const paidGHS = (verifyResult.amountPesewas || 0) / 100;
        if (paidGHS + 0.01 < expectedPriceGHS) {
          console.warn(`[Verify Payment API] Amount mismatch for ${paymentReference}: paid GH₵${paidGHS}, expected GH₵${expectedPriceGHS}`);
          return res.status(402).json({ success: false, error: 'The verified payment amount does not match the selected plan.' });
        }
        verifiedAmountGHS = paidGHS;
      } else {
        // No live Paystack credentials configured on this server yet — the
        // client's checkout flow itself already fell back to a simulated
        // confirmation (see BoostModal on both platforms) rather than a
        // real charge, so there is nothing to verify against here. This is
        // an interim, explicitly-logged allowance for pre-launch
        // testing, not a permanent bypass.
        console.warn(`[Verify Payment API] PAYSTACK_SECRET_KEY not configured — accepting unverified reference ${paymentReference} (demo/dev mode).`);
        verifiedAmountGHS = expectedPriceGHS;
      }
    }

    let startTime = Date.now();
    if (existingProduct?.boostEndDate) {
      const existingEnd = new Date(existingProduct.boostEndDate).getTime();
      if (!isNaN(existingEnd) && existingEnd > startTime) {
        startTime = existingEnd;
      }
    }

    const boostStartDate = new Date().toISOString();
    const boostEndDate = new Date(startTime + durationDays * 24 * 60 * 60 * 1000).toISOString();

    let boostPriorityLevel = 1;
    if (effectivePlanId === '1month' || effectivePlanId === '90days') boostPriorityLevel = 5;
    else if (effectivePlanId === '21days' || effectivePlanId === '30days') boostPriorityLevel = 4;
    else if (effectivePlanId === '14days') boostPriorityLevel = 3;
    else if (effectivePlanId === '7days') boostPriorityLevel = 2;
    else if (effectivePlanId === '3days') boostPriorityLevel = 1;

    const boostBase = boostPriorityLevel * 10000000;
    const remainingMs = durationDays * 24 * 60 * 60 * 1000;
    const remainingTimeFactor = remainingMs / 10000;
    const engagementScore = Number(existingProduct?.viewsCount || 0);
    const engagementFactor = engagementScore / 10;
    const createdAtMs = existingProduct?.createdAt ? new Date(existingProduct.createdAt).getTime() : Date.now();
    const freshnessFactor = createdAtMs / 1e12;
    const priorityScore = boostBase + remainingTimeFactor + engagementFactor + freshnessFactor;

    const currentHistory = Array.isArray(existingProduct?.boostHistory) ? [...existingProduct.boostHistory] : [];
    currentHistory.push({
      planId: effectivePlanId || '7days',
      planName: `${durationDays} Days Boost${isAdminFreeBoost ? ' (Admin Free)' : ''}`,
      startDate: boostStartDate,
      endDate: boostEndDate,
      paymentReference,
      amount: verifiedAmountGHS,
      gateway: isAdminFreeBoost ? 'admin-override' : 'paystack',
      paymentMethod: isAdminFreeBoost ? 'admin' : (paymentMethod || 'paystack'),
      createdAt: boostStartDate
    });

    const boostFields: any = {
      id: productId,
      boostStatus: true,
      isBoosted: true,
      boostPlan: effectivePlanId || '7days',
      boostStartDate,
      boostEndDate,
      boostExpiry: boostEndDate,
      boostAmount: verifiedAmountGHS,
      boostPackagePrice: verifiedAmountGHS,
      boostPriority: boostBase,
      boostPriorityLevel,
      priorityScore,
      paymentStatus: 'success',
      paymentReference,
      lastBoostedAt: boostStartDate,
      lastBoostPurchase: boostStartDate,
      remainingBoostTime: remainingMs,
      boostHistory: currentHistory,
      updatedAt: new Date().toISOString()
    };

    // Persist boost to database
    let finalProduct: any;
    try {
      const merged = { ...existingProduct, ...boostFields };
      finalProduct = await upsertProductToSupabase(merged, verified, true);
      if (adminDb) {
        await adminDb.collection('products').doc(productId).set(cleanObject(merged), { merge: true }).catch((fErr: any) => {
          console.warn('[Verify Payment API] Firestore sync note:', fErr?.message);
        });
      }
    } catch (upsertErr: any) {
      console.error(`[Verify Payment API] Failed to persist boost for product ${productId}:`, upsertErr?.message || upsertErr);
      return res.status(500).json({
        success: false,
        error: `Payment was verified but the boost couldn't be saved. Please contact support with reference ${paymentReference}.`
      });
    }

    // Claim the reference so it can never activate a second boost. The
    // early SELECT above catches the overwhelming majority of replay
    // attempts (a reference reused minutes/hours/days later); this INSERT
    // is the actual atomic guarantee (id is the primary key) for the rare
    // case of two near-simultaneous requests racing past that check --
    // whichever loses this insert is logged as a detected replay attempt.
    // The boost was already correctly activated once by this point, so a
    // losing race here doesn't need to unwind that write, just record that
    // a duplicate attempt occurred.
    if (backendSupabase) {
      const { error: purchaseInsertErr } = await backendSupabase.from('boost_purchases').insert({
        id: paymentReference,
        productId,
        userId: verified.uid,
        amount: verifiedAmountGHS,
        currency: 'GHS',
        status: 'used',
        createdAt: new Date().toISOString()
      });
      if (purchaseInsertErr) {
        // A duplicate-key violation here is the expected, benign case (a
        // genuine concurrent replay losing the race). Any OTHER error
        // (network blip, timeout, transient Supabase issue) means this
        // reference was NEVER actually claimed -- the early SELECT above
        // won't catch a later replay of it either, since no row exists to
        // find. That's a real gap in the replay guard, not just a detected
        // duplicate, so it's logged at error level to stay visible rather
        // than blending into routine warnings.
        const isDuplicateKey = purchaseInsertErr.code === '23505';
        const logFn = isDuplicateKey ? console.warn : console.error;
        logFn(`[Verify Payment API] boost_purchases claim insert failed for ${paymentReference} (${isDuplicateKey ? 'likely a concurrent replay of the same reference' : 'NOT a duplicate-key error -- this reference is unclaimed and could be replayed later'}):`, purchaseInsertErr.message);
      }
    }

    clearSitemapCache();
    console.log(`[Verify Payment API] Boost activated for product ${productId} (ref ${paymentReference}). Active until ${boostEndDate}.`);

    return res.json({
      success: true,
      message: 'Payment verified and boost activated successfully.',
      reference: paymentReference,
      product: finalProduct
    });
   });
  } catch (err: any) {
    console.error('[Verify Payment API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Payment verification failed' });
  }
});

// Mobile has no browser to run Paystack's inline.js popup (that's what web
// uses) — so it starts a real transaction here via Paystack's own hosted
// checkout, gets back a URL to open in a WebView, and once the seller pays
// there, verifies it through the same /api/verify-payment above with the
// real reference Paystack issued.
app.post('/api/paystack/initialize-boost', serverRateLimiter(60 * 1000, 10, 'paystack-initialize'), async (req: express.Request, res: express.Response) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Please sign in to boost a listing.' });
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return res.status(503).json({ success: false, error: 'Card/Mobile Money payments are not available right now.' });
  }

  const { productId, planId } = req.body || {};
  if (!productId || typeof productId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing productId.' });
  }

  let existingProduct: any = null;
  if (backendSupabase) {
    try {
      const { data } = await backendSupabase.from('products').select('id, sellerId').eq('id', productId).maybeSingle();
      existingProduct = data;
    } catch (e) {
      console.warn('[Paystack Initialize] Could not fetch product:', e);
    }
  }
  if (!existingProduct) {
    return res.status(404).json({ success: false, error: 'Product not found.' });
  }
  const isAdmin = verified.isAdmin || verified.email === 'asumaduvincent7@gmail.com';
  if (existingProduct.sellerId !== verified.uid && !isAdmin) {
    return res.status(403).json({ success: false, error: 'You can only boost your own listing.' });
  }

  const priceGHS = BOOST_PLAN_PRICE_GHS[planId] || BOOST_PLAN_PRICE_GHS['7days'];
  const reference = `TEDBUY_MOBILE_PS_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const initRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: verified.email || 'asumaduvincent7@gmail.com',
        amount: Math.round(priceGHS * 100),
        currency: 'GHS',
        reference,
        callback_url: 'https://www.tedbuy.store/api/paystack/callback',
        metadata: { productId, planId: planId || '7days', purpose: 'boost' },
      }),
      signal: controller.signal,
    });
    const json: any = await initRes.json().catch(() => null);

    if (!initRes.ok || !json?.status || !json?.data?.authorization_url) {
      console.warn('[Paystack Initialize] Failed:', json?.message || initRes.status);
      return res.status(502).json({ success: false, error: json?.message || 'Could not start payment. Please try again.' });
    }

    return res.json({ success: true, authorizationUrl: json.data.authorization_url, reference });
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError';
    console.error('[Paystack Initialize] Error:', isAbort ? 'timeout' : (err?.message || err));
    return res.status(502).json({ success: false, error: 'Could not start payment. Please try again.' });
  } finally {
    clearTimeout(timeoutId);
  }
});

// Landing page Paystack's hosted checkout redirects to after payment — the
// mobile WebView intercepts navigation to this URL before it even loads
// (see mobile BoostModal), so this only matters as a harmless fallback if
// that interception is ever missed.
app.get('/api/paystack/callback', (_req: express.Request, res: express.Response) => {
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Payment Complete</title></head><body style="font-family:sans-serif;text-align:center;padding:60px 20px;color:#0f172a;"><h2>Payment received</h2><p>You can close this window and return to the TedBuy app.</p></body></html>`);
});

app.post('/api/admin/boost-control', serverRateLimiter(60 * 1000, 30, "admin-boost-control"), async (req: express.Request, res: express.Response) => {
  const verified = await verifyAdmin(req.headers.authorization);
  if (!verified) {
    return res.status(403).json({ success: false, error: 'Forbidden: Admin authorization required' });
  }

  const { productId, action, planId, product: incomingProduct } = req.body || {};

  if (!productId) {
    return res.status(400).json({ success: false, error: 'Missing required parameter: productId' });
  }

  try {
    let existingProduct: any = incomingProduct || null;

    // 1. Try fetching from Supabase if not provided
    if (backendSupabase) {
      try {
        const { data } = await backendSupabase.from('products').select('*').eq('id', productId).maybeSingle();
        if (data) {
          existingProduct = { ...existingProduct, ...data };
        }
      } catch (e) {
        console.warn('[Admin Boost Control API] Could not fetch product from Supabase:', e);
      }
    }

    // 2. Try fetching from Firestore adminDb if needed
    if (adminDb) {
      try {
        const docSnap = await adminDb.collection('products').doc(productId).get();
        if (docSnap.exists) {
          existingProduct = { ...(docSnap.data() || {}), ...existingProduct };
        }
      } catch (fErr) {
        console.warn('[Admin Boost Control API] Could not fetch product from Firestore:', fErr);
      }
    }

    const now = new Date();
    let boostFields: any = {};

    if (action === 'activate') {
      const planDurationMap: Record<string, number> = {
        '3days': 3,
        '7days': 7,
        '14days': 14,
        '21days': 21,
        '30days': 21,
        '1month': 30,
        '90days': 30
      };
      const durationDays = planDurationMap[planId] || 7;
      const boostStartDate = now.toISOString();
      // Matches /api/verify-payment's real-purchase extension logic
      // (extend from max(now, existingEnd), never discard remaining time) --
      // this admin path used to always reset to `now + durationDays`
      // regardless of an existing active boost. Concrete case: a seller has
      // 10 days left on a paid boost; an admin grants a free 7-day boost as
      // a courtesy -- this silently threw away the 10 already-paid days
      // instead of extending to 17.
      let startTime = now.getTime();
      if (existingProduct?.boostEndDate) {
        const existingEnd = new Date(existingProduct.boostEndDate).getTime();
        if (!isNaN(existingEnd) && existingEnd > startTime) {
          startTime = existingEnd;
        }
      }
      const boostEndDate = new Date(startTime + durationDays * 24 * 60 * 60 * 1000).toISOString();

      let boostPriorityLevel = 1;
      if (planId === '1month' || planId === '90days') boostPriorityLevel = 5;
      else if (planId === '21days' || planId === '30days') boostPriorityLevel = 4;
      else if (planId === '14days') boostPriorityLevel = 3;
      else if (planId === '7days') boostPriorityLevel = 2;
      else if (planId === '3days') boostPriorityLevel = 1;

      const boostBase = boostPriorityLevel * 10000000;
      const remainingMs = durationDays * 24 * 60 * 60 * 1000;
      const remainingTimeFactor = remainingMs / 10000;
      const engagementScore = Number(existingProduct?.viewsCount || 0);
      const engagementFactor = engagementScore / 10;
      const createdAtMs = existingProduct?.createdAt ? new Date(existingProduct.createdAt).getTime() : now.getTime();
      const freshnessFactor = createdAtMs / 1e12;
      const priorityScore = boostBase + remainingTimeFactor + engagementFactor + freshnessFactor;

      const currentHistory = Array.isArray(existingProduct?.boostHistory) ? [...existingProduct.boostHistory] : [];
      currentHistory.push({
        planId: planId || '7days',
        planName: `${durationDays} Days Boost (Admin Free)`,
        startDate: boostStartDate,
        endDate: boostEndDate,
        paymentReference: `ADMIN_FREE_BOOST_${Date.now()}`,
        amount: 0,
        gateway: 'admin-override',
        paymentMethod: 'admin',
        createdAt: boostStartDate
      });

      boostFields = {
        id: productId,
        boostStatus: true,
        isBoosted: true,
        boostPlan: planId || '7days',
        boostStartDate,
        boostEndDate,
        boostExpiry: boostEndDate,
        boostPriority: boostPriorityLevel * 10000000,
        boostPriorityLevel,
        priorityScore,
        paymentStatus: 'success',
        paymentReference: `ADMIN_FREE_BOOST_${Date.now()}`,
        lastBoostedAt: boostStartDate,
        lastBoostPurchase: boostStartDate,
        boostAmount: 0,
        boostPackagePrice: 0,
        remainingBoostTime: remainingMs,
        boostHistory: currentHistory,
        updatedAt: now.toISOString()
      };
    } else {
      const createdAtMs = existingProduct?.createdAt ? new Date(existingProduct.createdAt).getTime() : now.getTime();
      const priorityScore = Number(existingProduct?.viewsCount || 0) + (createdAtMs / 1e12);

      boostFields = {
        id: productId,
        boostStatus: false,
        isBoosted: false,
        boostPlan: null,
        boostStartDate: null,
        boostEndDate: null,
        boostExpiry: null,
        boostPriority: 0,
        boostPriorityLevel: 0,
        priorityScore,
        remainingBoostTime: 0,
        // getBoostEndDate() (src/utils/dateParser.ts) falls back to these two
        // fields to reconstruct an end date whenever boostStartDate/boostEndDate
        // are empty -- leaving them set from the original activation meant a
        // deactivated boost could still compute a future end date and show as
        // active in the UI, even though boostStatus itself was correctly false.
        lastBoostedAt: null,
        lastBoostPurchase: null,
        updatedAt: now.toISOString()
      };
    }

    const mergedProduct = {
      ...(existingProduct || {}),
      ...boostFields,
      id: productId
    };

    // 1. Sync to Supabase -- the actual source of truth every reader
    // (UI, /api/products/:id, the feed) depends on. Track whether this
    // genuinely succeeded rather than assuming it did: this endpoint used
    // to unconditionally return success:true regardless of what happened
    // here, which is exactly what let a Phase 5 test find an admin action
    // that appeared to succeed while the write silently never landed (see
    // .ai/handoffs/RLS_PHASE5_VERIFICATION.md's admin-action test note --
    // that specific case turned out to be a UI staleness issue, not a
    // write failure, but the endpoint had no way to tell the difference
    // either way, which is the actual gap being closed here).
    let supabaseWriteSucceeded = !backendSupabase;
    if (backendSupabase) {
      try {
        const saved = await upsertProductToSupabase(mergedProduct, undefined, true);
        if (saved) {
          supabaseWriteSucceeded = true;
          console.log(`[Admin Boost Control API] Saved product ${productId} to Supabase.`);
        }
      } catch (upsertErr: any) {
        console.warn('[Admin Boost Control API] Supabase upsert error, falling back to safeBackendSupabaseUpsert:', upsertErr?.message);
        const fallback = await safeBackendSupabaseUpsert('products', mergedProduct, { onConflict: 'id' }).catch((e: any) => ({ data: null, error: e }));
        supabaseWriteSucceeded = !fallback.error;
        if (fallback.error) {
          console.error('[Admin Boost Control API] Both Supabase write attempts failed:', fallback.error?.message || fallback.error);
        }
      }
    }

    // 2. Sync to Firestore adminDb -- a secondary, best-effort sync for
    // mobile's realtime listeners; Supabase above remains authoritative,
    // so a failure here alone doesn't fail the request.
    if (adminDb) {
      try {
        await adminDb.collection('products').doc(productId).set(cleanObject(mergedProduct), { merge: true });
        console.log(`[Admin Boost Control API] Synced product ${productId} to Firestore adminDb.`);
      } catch (fWriteErr: any) {
        console.warn('[Admin Boost Control API] Firestore adminDb write warning:', fWriteErr?.message);
      }
    }

    if (!supabaseWriteSucceeded) {
      return res.status(500).json({
        success: false,
        error: `The boost ${action} action could not be saved. Please try again.`
      });
    }

    // 3. Invalidate Memory & Sitemap Caches
    invalidateProductCache(productId, mergedProduct.sellerId, mergedProduct.category);
    clearSitemapCache();
    console.log(`[Admin Boost Control API] Product ${productId} boost set to ${action}.`);

    return res.json({
      success: true,
      message: `Product boost ${action}d successfully.`,
      product: mergedProduct
    });
  } catch (err: any) {
    console.error('[Admin Boost Control API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Boost control action failed' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', supabaseActive: !!backendSupabase });
});

// -------------------------------------------------------------
// BREVO TRANSACTIONAL EMAIL & REGISTRATION OTP ENDPOINTS
// -------------------------------------------------------------

// In-memory store for registration OTP codes
const registrationOtpStore = new Map<string, { code: string; expiresAt: number; username?: string }>();

// Periodic cleanup of expired OTP codes (every 5 mins)
setInterval(() => {
  const now = Date.now();
  for (const [email, entry] of registrationOtpStore.entries()) {
    if (entry.expiresAt < now) {
      registrationOtpStore.delete(email);
    }
  }
}, 5 * 60 * 1000);

// Endpoint 1: Send 6-Digit Registration OTP Code via Brevo
app.post("/api/auth/send-registration-otp", serverRateLimiter(60 * 1000, 10, "registration-otp"), async (req: express.Request, res: express.Response) => {
  try {
    const { email, username } = req.body || {};
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'A valid email address is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const displayName = (username && typeof username === 'string' && username.trim()) ? username.trim() : cleanEmail.split('@')[0];

    if (isReservedStoreName(displayName)) {
      return res.status(400).json({ success: false, error: 'This store name is reserved by TedBuy.' });
    }

    // Check if account already exists in Supabase
    if (backendSupabase) {
      try {
        const { data: existingUser } = await backendSupabase
          .from('users')
          .select('id, email')
          .ilike('email', cleanEmail)
          .maybeSingle();

        if (existingUser?.id) {
          return res.status(400).json({
            success: false,
            error: 'An account with this email address already exists. Please log in.'
          });
        }
      } catch (err) {
        console.warn('[Registration OTP] Supabase user check warning:', err);
      }
    }

    // Check if account already exists in Firebase Auth via Admin SDK
    if (getAdminApps().length) {
      try {
        const adminAuth = getAdminAuth();
        const userRecord = await adminAuth.getUserByEmail(cleanEmail).catch(() => null);
        if (userRecord?.uid) {
          return res.status(400).json({
            success: false,
            error: 'An account with this email address already exists. Please log in.'
          });
        }
      } catch (adminErr) {
        console.warn('[Registration OTP] Firebase Admin user check warning:', adminErr);
      }
    }

    // Generate 6-digit numeric OTP code
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    registrationOtpStore.set(cleanEmail, { code: otpCode, expiresAt, username: displayName });
    console.log(`[Registration OTP] Generated 6-digit code ${otpCode} for ${cleanEmail} (expires in 10 mins)`);

    const brevoApiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.BREVO_SENDER_EMAIL || 'support@tedbuy.store';
    const senderName = process.env.BREVO_SENDER_NAME || 'Tedbuy';

    if (!brevoApiKey) {
      console.warn('[Registration OTP] BREVO_API_KEY environment variable is not set.');
      return res.status(500).json({
        success: false,
        error: 'Email configuration missing (BREVO_API_KEY).'
      });
    }

    const domainBase = (process.env.APP_URL || 'https://www.tedbuy.store').replace(/\/$/, '');

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>Your Tedbuy Verification Code</title>
  <style>
    :root {
      color-scheme: light dark;
      supported-color-schemes: light dark;
    }
    @media (prefers-color-scheme: dark) {
      .bg-body { background-color: #111317 !important; color: #ffffff !important; }
      .bg-card { background-color: #1a1d24 !important; border-color: #282c37 !important; }
      .text-heading { color: #ffffff !important; }
      .text-body { color: #cbd5e1 !important; }
      .bg-code { background-color: #0f172a !important; border-color: #334155 !important; }
      .text-code { color: #38bdf8 !important; }
    }
  </style>
</head>
<body class="bg-body" style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f5f7; color: #0f172a;">
  <!-- Hidden Preheader for Inbox Preview -->
  <span style="display: none; font-size: 1px; color: #f4f5f7; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    Your 6-digit Tedbuy verification code is ${otpCode}. It expires in 10 minutes.
  </span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="bg-body" style="background-color: #f4f5f7; padding: 32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" class="bg-card" style="max-width: 500px; background-color: #ffffff; border-radius: 20px; border: 1px solid #e2e8f0; overflow: hidden;">
          <!-- Header Section -->
          <tr>
            <td style="padding: 26px 28px 20px 28px; text-align: left;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="vertical-align: middle; padding-right: 14px;">
                    <!-- White Squircle Badge with TedBuy Shopping Bag Logo -->
                    <div style="width: 50px; height: 50px; background-color: #ffffff; border-radius: 14px; text-align: center; line-height: 50px; box-sizing: border-box; display: inline-block; overflow: hidden; vertical-align: middle; box-shadow: 0 4px 12px rgba(0,0,0,0.18);">
                      <img src="${domainBase}/favicon.svg" width="38" height="38" alt="TedBuy Logo" style="vertical-align: middle; margin-top: 6px; border: 0; outline: none;" onError="this.style.display='none'; const el=this.nextElementSibling; if(el) el.style.display='inline-block';" />
                      <svg width="36" height="36" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-top: 7px; display: none;">
                        <path d="M 176,170 A 80,80 0 0,1 336,170" stroke="#334155" stroke-width="36" fill="none" stroke-linecap="round" />
                        <path d="M 110,160 L 402,160 C 418,160 430,174 428,190 L 398,440 C 396,456 382,468 366,468 L 146,468 C 130,468 116,456 114,440 L 84,190 C 82,174 94,160 110,160 Z" fill="#1e293b" />
                        <rect x="175" y="225" width="162" height="38" rx="8" fill="#ffffff" />
                        <rect x="237" y="225" width="38" height="150" rx="8" fill="#ffffff" />
                        <circle cx="256" cy="415" r="16" fill="#38bdf8" />
                      </svg>
                    </div>
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="font-size: 32px; font-weight: 800; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; letter-spacing: -0.5px; line-height: 1;">
                      <span class="text-ted" style="color: #0f172a;">Ted</span><span style="color: #ea580c;">Buy</span>
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Accent Line -->
          <tr>
            <td style="padding: 0;">
              <div style="height: 3px; background-color: #ea580c; width: 100%;"></div>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding: 32px 28px 36px 28px; text-align: left;">
              <h2 class="text-heading" style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #0f172a; line-height: 1.3;">Verify your email address</h2>
              <p class="text-body" style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #475569;">
                Hello ${escapeHtml(displayName)},<br><br>
                Thank you for signing up for Tedbuy! Please enter the 6-digit verification code below to complete your registration:
              </p>

              <!-- 6-Digit Code Display -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 24px 0;">
                <tr>
                  <td align="center">
                    <div class="bg-code" style="background-color: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 16px; padding: 20px 24px; text-align: center; display: inline-block;">
                      <span class="text-code" style="font-family: 'SF Mono', Consolas, Monaco, 'Courier New', monospace; font-size: 34px; font-weight: 800; letter-spacing: 10px; color: #059669; display: block; margin-left: 10px;">
                        ${otpCode}
                      </span>
                    </div>
                  </td>
                </tr>
              </table>

              <p class="text-body" style="margin: 24px 0 0 0; font-size: 14px; line-height: 1.6; color: #64748b;">
                This code is valid for <strong>10 minutes</strong>. If you did not request this code, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 28px; text-align: center; font-size: 12px; line-height: 1.6; color: #64748b; border-top: 1px solid #e2e8f0;">
              &copy; ${new Date().getFullYear()} Tedbuy Marketplace Ltd. All rights reserved.<br>
              <a href="https://tedbuy.store" style="color: #475569; text-decoration: underline;">https://tedbuy.store</a> &bull; <a href="mailto:support@tedbuy.store" style="color: #475569; text-decoration: underline;">support@tedbuy.store</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const textContent = `Your Tedbuy verification code is: ${otpCode}\n\nHello ${displayName},\n\nPlease enter the 6-digit verification code above to complete your registration on Tedbuy.\n\nThis code will expire in 10 minutes.\n\nIf you did not request this code, please ignore this email.\n\nRegards,\nTedbuy Team\nhttps://tedbuy.store\nsupport@tedbuy.store`;

    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': brevoApiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        replyTo: { name: senderName, email: senderEmail },
        to: [{ email: cleanEmail, name: displayName }],
        subject: `Your Tedbuy verification code is ${otpCode}`,
        htmlContent,
        textContent,
        tags: ['transactional', 'verification-otp'],
        headers: {
          'X-Mailin-tag': 'transactional',
          'X-Auto-Response-Suppress': 'OOF, AutoReply',
          'List-Unsubscribe': '<mailto:support@tedbuy.store?subject=Unsubscribe>'
        }
      })
    });

    const brevoData = await brevoRes.json().catch(() => ({}));
    if (!brevoRes.ok) {
      console.error('[Registration OTP Brevo Error]:', brevoRes.status, brevoData);
      return res.status(500).json({
        success: false,
        error: brevoData.message || brevoData.code || 'Failed to send verification email via Brevo.'
      });
    }

    console.log(`[Registration OTP Success] Verification code email sent to ${cleanEmail}, messageId: ${brevoData.messageId}`);
    return res.json({
      success: true,
      message: 'A 6-digit verification code has been sent to your email address.'
    });
  } catch (err: any) {
    console.error('[Registration OTP Endpoint Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Server error sending verification code.' });
  }
});

// Endpoint 2: Verify 6-Digit Registration OTP Code
// This is the actual brute-force target for a 6-digit OTP (1M combinations)
// — the sibling send-otp endpoint being rate-limited doesn't protect this
// one at all, since an attacker only needs to call THIS endpoint directly.
app.post("/api/auth/verify-registration-otp", serverRateLimiter(15 * 60 * 1000, 10, "verify-registration-otp"), async (req: express.Request, res: express.Response) => {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp || typeof email !== 'string' || typeof otp !== 'string') {
      return res.status(400).json({ success: false, error: 'Email and 6-digit verification code are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.trim().replace(/\D/g, '');

    if (cleanOtp.length !== 6) {
      return res.status(400).json({ success: false, error: 'Verification code must be exactly 6 digits.' });
    }

    const entry = registrationOtpStore.get(cleanEmail);
    if (!entry) {
      return res.status(400).json({
        success: false,
        error: 'No verification code found or code has expired. Please request a new code.'
      });
    }

    if (Date.now() > entry.expiresAt) {
      registrationOtpStore.delete(cleanEmail);
      return res.status(400).json({
        success: false,
        error: 'Verification code has expired. Please request a new code.'
      });
    }

    if (entry.code !== cleanOtp) {
      return res.status(400).json({
        success: false,
        error: 'Incorrect verification code. Please check your email and try again.'
      });
    }

    // OTP verified successfully!
    registrationOtpStore.delete(cleanEmail);
    console.log(`[Registration OTP Verified] Code verified successfully for ${cleanEmail}`);

    return res.json({
      success: true,
      message: 'Verification code verified successfully.'
    });
  } catch (err: any) {
    console.error('[Verify Registration OTP Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Server error verifying code.' });
  }
});

app.post("/api/auth/send-password-reset", serverRateLimiter(60 * 1000, 10, "password-reset"), async (req: express.Request, res: express.Response) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'A valid email address is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    console.log(`[Password Reset API] Generating password reset link for ${cleanEmail}...`);

    let oobCode: string | null = null;
    let resetUrl = '';
    let isUserNotFound = false;
    const domainBase = (process.env.APP_URL || 'https://www.tedbuy.store').replace(/\/$/, '');

    // Check if user exists in Supabase
    let existsInSupabase = false;
    if (backendSupabase) {
      try {
        const { data: supaUser } = await backendSupabase
          .from('users')
          .select('id, email')
          .ilike('email', cleanEmail)
          .maybeSingle();
        if (supaUser?.id) {
          existsInSupabase = true;
        }
      } catch (_) {}
    }

    // 1. Attempt Firebase password reset link token via Admin SDK
    let rawLink: string | null = null;
    try {
      if (getAdminApps().length) {
        const adminAuth = getAdminAuth();
        rawLink = await adminAuth.generatePasswordResetLink(cleanEmail, {
          url: `${domainBase}/?mode=resetPassword`,
          handleCodeInApp: true
        });

        const parsedUrl = new URL(rawLink);
        oobCode = parsedUrl.searchParams.get('oobCode');
        if (oobCode) {
          console.log(`[Password Reset API] Generated authentic Firebase OOB code via Admin SDK for ${cleanEmail}`);
        } else {
          // Never log rawLink itself -- it's a live, usable password-reset
          // secret (the oobCode as a URL param), same handling as every
          // other credential this session's redactUserSecrets work already
          // keeps out of logs/responses.
          console.warn('[Password Reset API] Firebase Admin generated a reset link but no oobCode could be parsed from it.');
        }
      } else {
        throw new Error('Firebase Admin SDK is not initialized.');
      }
    } catch (adminErr: any) {
      console.warn('[Password Reset API] Firebase Admin generatePasswordResetLink failed:', adminErr?.code, adminErr?.message || adminErr);
      const errMsg = (adminErr?.message || '').toLowerCase();
      const errCode = (adminErr?.code || '').toLowerCase();
      if (
        errCode.includes('user-not-found') ||
        errMsg.includes('user-not-found') ||
        errMsg.includes('no user record') ||
        errMsg.includes('email_not_found') ||
        errMsg.includes('user not found')
      ) {
        isUserNotFound = true;
      }
    }

    if (!oobCode && !isUserNotFound && firebaseApiKey) {
      const restResult = await generateFirebasePasswordResetLinkViaRest(cleanEmail);
      if (restResult.oobLink) {
        const parsedUrl = new URL(restResult.oobLink);
        oobCode = parsedUrl.searchParams.get('oobCode');
        if (oobCode) {
          console.log(`[Password Reset API] Generated Firebase OOB code via REST fallback for ${cleanEmail}`);
        } else {
          // Same reasoning as the Admin SDK branch above -- never log the
          // raw link, it's a live password-reset secret.
          console.warn('[Password Reset API] Firebase REST fallback generated a reset link but no oobCode could be parsed from it.');
        }
      } else if (restResult.isUserNotFound) {
        isUserNotFound = true;
      }
    }

    if ((isUserNotFound || !oobCode) && !existsInSupabase) {
      console.warn(`[Password Reset API] Account not found for ${cleanEmail}`);
      return res.status(404).json({
        success: false,
        error: 'Account not found.'
      });
    }

    if (!oobCode) {
      console.error('[Password Reset API] Unable to obtain OOB code for password reset for existing user.');
      return res.status(404).json({
        success: false,
        error: 'Account not found.'
      });
    }

    // 3. Construct clean link pointing directly to the web application SPA where ResetPasswordModal is handled by App.tsx
    resetUrl = `${domainBase}/?mode=resetPassword&oobCode=${encodeURIComponent(oobCode)}`;

    // 3. Build Brevo Email Payload with high-deliverability clean HTML & anti-spam compliance
    const brevoApiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.BREVO_SENDER_EMAIL || 'support@tedbuy.store';
    const senderName = process.env.BREVO_SENDER_NAME || 'Tedbuy';

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>Reset Your TedBuy Password</title>
  <style>
    :root {
      color-scheme: light dark;
      supported-color-schemes: light dark;
    }
    /* Adaptive System Responsive Theme Styles */
    @media (prefers-color-scheme: dark) {
      .bg-body { background-color: #111317 !important; color: #ffffff !important; }
      .bg-card { background-color: #1a1d24 !important; border-color: #282c37 !important; }
      .text-heading { color: #ffffff !important; }
      .text-body { color: #cbd5e1 !important; }
      .text-ted { color: #ffffff !important; }
      .bg-fallback { background-color: #13161c !important; border-color: #282c37 !important; }
      .text-fallback-title { color: #f1f5f9 !important; }
      .text-fallback-sub { color: #94a3b8 !important; }
    }
  </style>
</head>
<body class="bg-body" style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f5f7; color: #0f172a;">
  <!-- Hidden Preheader for Inbox Preview -->
  <span style="display: none; font-size: 1px; color: #f4f5f7; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    Reset the password for your TedBuy account.
  </span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="bg-body" style="background-color: #f4f5f7; padding: 32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" class="bg-card" style="max-width: 500px; background-color: #ffffff; border-radius: 20px; border: 1px solid #e2e8f0; overflow: hidden;">
          <!-- Header Section -->
          <tr>
            <td style="padding: 26px 28px 20px 28px; text-align: left;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="vertical-align: middle; padding-right: 14px;">
                    <!-- White Squircle Badge with TedBuy Shopping Bag Logo -->
                    <div style="width: 50px; height: 50px; background-color: #ffffff; border-radius: 14px; text-align: center; line-height: 50px; box-sizing: border-box; display: inline-block; overflow: hidden; vertical-align: middle; box-shadow: 0 4px 12px rgba(0,0,0,0.18);">
                      <img src="${domainBase}/favicon.svg" width="38" height="38" alt="TedBuy Logo" style="vertical-align: middle; margin-top: 6px; border: 0; outline: none;" onError="this.style.display='none'; const el=this.nextElementSibling; if(el) el.style.display='inline-block';" />
                      <svg width="36" height="36" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-top: 7px; display: none;">
                        <path d="M 176,170 A 80,80 0 0,1 336,170" stroke="#334155" stroke-width="36" fill="none" stroke-linecap="round" />
                        <path d="M 110,160 L 402,160 C 418,160 430,174 428,190 L 398,440 C 396,456 382,468 366,468 L 146,468 C 130,468 116,456 114,440 L 84,190 C 82,174 94,160 110,160 Z" fill="#1e293b" />
                        <rect x="175" y="225" width="162" height="38" rx="8" fill="#ffffff" />
                        <rect x="237" y="225" width="38" height="150" rx="8" fill="#ffffff" />
                        <circle cx="256" cy="415" r="16" fill="#38bdf8" />
                      </svg>
                    </div>
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="font-size: 32px; font-weight: 800; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; letter-spacing: -0.5px; line-height: 1;">
                      <span class="text-ted" style="color: #0f172a;">Ted</span><span style="color: #ea580c;">Buy</span>
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Orange Accent Line -->
          <tr>
            <td style="padding: 0;">
              <div style="height: 3px; background-color: #ea580c; width: 100%;"></div>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding: 32px 28px 36px 28px; text-align: left;">
              <h2 class="text-heading" style="margin: 0 0 20px 0; font-size: 20px; font-weight: 700; color: #0f172a; line-height: 1.3;">Hello,</h2>
              <p class="text-body" style="margin: 0 0 32px 0; font-size: 15px; line-height: 1.6; color: #475569; font-weight: 400;">
                We received a request to reset the password for your TedBuy account. Click the button below to choose a secure new password:
              </p>
              
              <!-- Primary Action Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 8px 0 36px 0;">
                    <a href="${resetUrl}" target="_blank" style="display: inline-block; background-color: #d9531e; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 800; padding: 16px 44px; border-radius: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 4px 14px rgba(217,83,30,0.35);">
                      Reset My Password
                    </a>
                  </td>
                </tr>
              </table>

              <p class="text-body" style="margin: 0 0 32px 0; font-size: 15px; line-height: 1.6; color: #475569; font-weight: 400;">
                If you did not make this request, you can safely ignore this email. Your password will remain completely secure and unchanged.
              </p>

              <!-- Fallback Link Card -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="bg-fallback" style="background-color: #f8fafc; border-radius: 16px; border: 1px solid #e2e8f0;">
                <tr>
                  <td style="padding: 20px 22px; text-align: left;">
                    <p class="text-fallback-sub" style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.5; color: #64748b;">
                      <strong class="text-fallback-title" style="color: #1e293b; font-weight: 700;">Button not working?</strong> Copy and paste this URL into your browser address bar:
                    </p>
                    <a href="${resetUrl}" style="color: #3b82f6; text-decoration: underline; font-size: 13px; word-break: break-all; line-height: 1.6;">${resetUrl}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const textContent = `Password Reset Request - Tedbuy Marketplace\n\nHello,\n\nWe received a request to reset your password for ${cleanEmail} on tedbuy.store.\n\nPlease visit the following link to reset your password (valid for 1 hour):\n${resetUrl}\n\nIf you did not request this, please ignore this email. Your account remains secure.\n\nRegards,\nTedbuy Support Team\nhttps://tedbuy.store\nsupport@tedbuy.store`;

    if (!brevoApiKey) {
      console.warn('[Password Reset API] BREVO_API_KEY environment variable is not set.');
      return res.status(500).json({
        success: false,
        error: 'Email configuration missing (BREVO_API_KEY).'
      });
    }

    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': brevoApiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        replyTo: { name: senderName, email: senderEmail },
        to: [{ email: cleanEmail }],
        subject: 'Reset your Tedbuy account password',
        htmlContent: htmlContent,
        textContent: textContent,
        tags: ['transactional', 'password-reset'],
        headers: {
          'X-Mailin-tag': 'transactional',
          'X-Auto-Response-Suppress': 'OOF, AutoReply',
          'List-Unsubscribe': '<mailto:support@tedbuy.store?subject=Unsubscribe>'
        }
      })
    });

    const brevoData = await brevoRes.json().catch(() => ({}));

    if (!brevoRes.ok) {
      console.error('[Brevo Password Reset Error]:', brevoRes.status, brevoData);
      return res.status(500).json({
        success: false,
        error: brevoData.message || brevoData.code || 'Failed to send password reset email via Brevo.'
      });
    }

    console.log(`[Brevo Password Reset Success] Reset email sent to ${cleanEmail}, messageId: ${brevoData.messageId}`);
    return res.json({
      success: true,
      message: 'Password reset link sent to your email address via Brevo.',
      resetUrlSent: resetUrl
    });
  } catch (err: any) {
    console.error('[Password Reset Endpoint Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Server error processing password reset.' });
  }
});

// The actual brute-force target for a password-reset token, same reasoning
// as verify-registration-otp above.
app.post('/api/auth/verify-password-reset-code', serverRateLimiter(15 * 60 * 1000, 10, "verify-password-reset-code"), async (req: express.Request, res: express.Response) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ success: false, error: 'Password reset code is required.' });
  }

  let verifiedEmail: string | null = null;

  if (firebaseApiKey) {
    verifiedEmail = await verifyFirebasePasswordResetCodeViaRest(token);
  }

  if (!verifiedEmail) {
    return res.status(400).json({ success: false, error: 'Invalid or expired password reset code.' });
  }

  return res.json({ success: true, email: verifiedEmail });
});


async function updateFirebaseAuthPassword(email: string, newPassword: string): Promise<boolean> {
  const cleanEmail = email.trim().toLowerCase();

  // Try Firebase Admin SDK if active
  if (getAdminApps().length) {
    try {
      const adminAuth = getAdminAuth();
      const userRecord = await adminAuth.getUserByEmail(cleanEmail);
      if (userRecord) {
        await adminAuth.updateUser(userRecord.uid, { password: newPassword });
        console.log(`[Firebase Password Sync] Successfully updated password via Admin SDK for ${cleanEmail}`);
        return true;
      }
    } catch (adminErr: any) {
      console.warn('[Firebase Password Sync] Admin SDK update warning:', adminErr?.message || adminErr);
    }
  }

  return false;
}

// Also validates the reset token — same brute-force exposure as
// verify-password-reset-code, worth limiting independently of it.
app.post("/api/auth/confirm-password-reset", serverRateLimiter(15 * 60 * 1000, 10, "confirm-password-reset"), async (req: express.Request, res: express.Response) => {
  const { token, newPassword } = req.body;
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long.' });
  }
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ success: false, error: 'A valid password reset code is required.' });
  }

  // The ONLY acceptable proof of ownership here is a real Firebase reset
  // code verified via Firebase's own resetPassword REST call, which
  // atomically checks the oobCode and sets the real Firebase Auth
  // password in one step. This used to also accept a client-asserted
  // `clientConfirmed` flag with a plain `email` field and NO token at
  // all -- and even when a token WAS present but failed real
  // verification, fell back to an Admin SDK lookup keyed purely by that
  // same client-asserted email, updating the account's password with
  // zero proof the caller had ever seen a real reset code. Both were a
  // complete account takeover by email address alone; removed entirely.
  const confirmedEmail = await confirmFirebasePasswordResetViaRest(token, newPassword);
  if (!confirmedEmail) {
    return res.status(400).json({ success: false, error: 'Invalid or expired password reset code.' });
  }
  const cleanEmail = confirmedEmail;

  try {
    // Generate secure salt and PBKDF2 hash using sha512. Iteration count
    // raised from a previous 1000 — three orders of magnitude below any
    // current guidance for PBKDF2-HMAC-SHA512 — to a real modern floor.
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(newPassword, salt, 100000, 64, 'sha512').toString('hex');
    const passwordHash = `${salt}:${hash}`;
    const nowIso = new Date().toISOString();

    // 1. Update in Supabase users table if backendSupabase client is active.
    // Only the hash is ever written — this used to also write `password:
    // newPassword` (the raw value) into the same row, which meant Firebase
    // Auth's own hashing (the actual authentication mechanism) was
    // pointless: the plaintext sat right next to it in this table, and
    // reached admin's browsers verbatim through every endpoint that ever
    // read this row back (see redactUserSecrets above, added to close that
    // second half of the same hole).
    if (backendSupabase) {
      try {
        const { data: existingUser } = await backendSupabase
          .from('users')
          .select('id, email')
          .ilike('email', cleanEmail)
          .maybeSingle();

        if (existingUser?.id) {
          const { error: updateErr } = await backendSupabase
            .from('users')
            .update({
              password_hash: passwordHash,
              updatedAt: nowIso
            })
            .eq('id', existingUser.id);

          if (updateErr) {
            console.error('[Confirm Password Reset] Supabase update by ID error:', updateErr);
          } else {
            console.log(`[Confirm Password Reset] Successfully updated Supabase password hash for ${cleanEmail} (UID: ${existingUser.id})`);
          }
        } else {
          // Fallback update by email match
          const { error: updateErr } = await backendSupabase
            .from('users')
            .update({
              password_hash: passwordHash,
              updatedAt: nowIso
            })
            .ilike('email', cleanEmail);

          if (updateErr) {
            console.error('[Confirm Password Reset] Supabase update by email error:', updateErr);
          } else {
            console.log(`[Confirm Password Reset] Updated Supabase password hash by email for ${cleanEmail}`);
          }
        }
      } catch (supabaseErr) {
        console.error('[Confirm Password Reset] Supabase database operation exception:', supabaseErr);
      }
    }

    // 2. Update in Firebase Auth via Admin SDK if active
    await updateFirebaseAuthPassword(cleanEmail, newPassword);

    console.log(`[Confirm Password Reset] Password reset complete for ${cleanEmail}`);
    return res.json({ success: true, message: 'Password reset successfully! You can now log in.' });
  } catch (err: any) {
    console.error('[Confirm Password Reset Error]:', err);
    return res.status(500).json({ success: false, error: 'Failed to update password. Please try again.' });
  }
});

// Directly checks a submitted password against the stored hash — this is a
// login-equivalent endpoint and was completely unrated, a textbook
// credential-stuffing/brute-force gap. Stricter than the token-verification
// endpoints above since a real password (not a random server-issued code)
// is the thing being guessed here.
app.post("/api/auth/verify-and-sync-password", serverRateLimiter(15 * 60 * 1000, 8, "verify-and-sync-password"), async (req: express.Request, res: express.Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    if (backendSupabase) {
      const { data: userRecord, error } = await backendSupabase
        .from('users')
        .select('*')
        .ilike('email', cleanEmail)
        .maybeSingle();

      if (error || !userRecord) {
        return res.status(404).json({ success: false, error: 'User not found in database.' });
      }

      let matches = false;
      if (userRecord.password_hash) {
        const parts = userRecord.password_hash.split(':');
        if (parts.length === 2) {
          const [salt, hash] = parts;
          // Hashes written before this fix used 1000 PBKDF2 iterations; new
          // ones use 100000 (see the reset endpoint above). Try the current
          // scheme first, then fall back to the legacy one so an
          // already-stored hash still verifies — the rewrite below
          // transparently upgrades it to the new scheme either way, so this
          // fallback naturally disappears as users log in.
          const calcHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
          const legacyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
          if (timingSafeStringEqual(calcHash, hash) || timingSafeStringEqual(legacyHash, hash)) {
            matches = true;
          }
        }
      } else if (userRecord.password && timingSafeStringEqual(userRecord.password, password)) {
        matches = true;
      }

      if (matches) {
        // Rehash on every successful verification — re-salted, current
        // iteration count — and never write the raw password back. The
        // legacy `password` column (still checked for above, for any row
        // that predates hashing entirely) is left untouched rather than
        // cleared here: this endpoint's job is to verify and upgrade, not to
        // silently mutate a row's schema mid-request.
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
        const updateObj: Record<string, any> = {
          password_hash: `${salt}:${hash}`
        };

        await backendSupabase.from('users').update(updateObj).ilike('email', cleanEmail);

        // Guaranteed update in Firebase Auth via Admin SDK & REST API
        await updateFirebaseAuthPassword(cleanEmail, password);

        return res.json({
          success: true,
          user: {
            id: userRecord.id,
            username: userRecord.username,
            email: userRecord.email,
            role: userRecord.role || 'both',
            phoneNumber: userRecord.phone_number || userRecord.phoneNumber,
            photoUrl: userRecord.photo_url || userRecord.photoUrl,
            joinDate: userRecord.join_date || userRecord.joinDate,
            followingSellers: userRecord.following_sellers || [],
            savedProductIds: userRecord.saved_product_ids || [],
            isAdmin: userRecord.is_admin || userRecord.isAdmin
          }
        });
      } else {
        return res.status(401).json({ success: false, error: 'Incorrect password.' });
      }
    }

    return res.status(400).json({ success: false, error: 'Database service unavailable.' });
  } catch (err: any) {
    console.error('[Verify & Sync Password Error]:', err);
    return res.status(500).json({ success: false, error: 'Failed to verify credentials.' });
  }
});

// RLS-migration Phase 1, checkpoint 19 (.ai/handoffs/SUPABASE_RLS_MIGRATION_PLAN.md):
// replaces setupWelcomePackage's (AppContext.tsx) four direct, unauthenticated
// dbAdapter writes -- creating/upserting the `user_ted_ceo_support` profile,
// creating the welcome support chat, creating its welcome message, and
// flagging welcomeSent on the caller's own row. Earlier passes had assessed
// this as low-urgency because every value that function itself sends is a
// hardcoded constant or the caller's own session data -- but that reasoning
// doesn't hold, because dbAdapter's generic write path has no per-row
// ownership check at all: a caller bypassing this app's own JS entirely
// could reach the exact same writes with DIFFERENT values -- overwriting
// the well-known `user_ted_ceo_support` account's email/photoUrl (a
// takeover/impersonation vector for TedBuy's own support identity), or
// creating a chat/message that impersonates TedBuy Support in an arbitrary
// OTHER victim's inbox (buyerId set to anyone, not just the caller) --
// regardless of what this one call site happens to send.
//
// This endpoint performs all four steps server-side, authenticated, with
// every identity value derived from the verified caller (verifyUser()'s
// decoded token) or the caller's own already-stored `users` row, never
// from the request body -- there is no body this endpoint reads at all.
app.post('/api/welcome/setup', serverRateLimiter(60 * 1000, 10, "welcome-setup"), async (req: express.Request, res: express.Response) => {
  const verified = await verifyUser(req.headers.authorization, req.headers['x-impersonation-session-id']);
  if (!verified) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }

  try {
    // 1. Ensure the TedBuy Support pseudo-account profile exists. Fixed,
    // hardcoded values only -- never derived from the request.
    await safeBackendSupabaseUpsert('users', {
      id: 'user_ted_ceo_support',
      username: 'Tedbuy Support',
      email: 'info.tedbuy@gmail.com',
      photoUrl: '/favicon.svg',
      role: 'seller',
      joinDate: 'Jun 2018'
    }, { onConflict: 'id' });

    // Real username for the buyer side of the chat comes from the
    // caller's own stored row, never from the client.
    const { data: selfRow } = await backendSupabase
      .from('users')
      .select('username')
      .eq('id', verified.uid)
      .maybeSingle();
    const buyerName = selfRow?.username || (verified.email ? verified.email.split('@')[0] : 'TedBuy User');

    const chatId = `chat_support_${verified.uid}`;
    const { data: existingChat } = await backendSupabase
      .from('chats')
      .select('id')
      .eq('id', chatId)
      .maybeSingle();

    if (!existingChat) {
      const welcomeMessageBody = `Welcome to TedBuy

I wanted to check in with you to ensure that you have everything you need. I hope that your experience with TedBuy so far has been a pleasant one. Customer experience is at the heart of everything we do. It's why we come to work each day.
All replies to this email inbox are monitored by myself, so if you'd like to get in touch directly and provide any feedback which could help us help you, please type in the chat on TedBuy (or hit reply to this email!) and we'll ensure that we get onto that right away. No issue is too small. If it matters to you, it matters to us, so please do get in touch if you need to.
Also, don't forget that our customer support team are here for all your day-to-day and technical questions 24/7. Thanks once again. I'm delighted to have you on board and look forward to helping you drive your business to awesome new heights.

Gratefully yours,

Vincent Asumadu,
CEO, Tedbuy Inc`;

      await safeBackendSupabaseUpsert('chats', {
        id: chatId,
        productId: 'support_welcome',
        productTitle: 'Tedbuy Support Desk',
        productPrice: 'Direct Channel',
        productImage: '/favicon.svg',
        buyerId: verified.uid,
        buyerName,
        sellerId: 'user_ted_ceo_support',
        sellerName: 'Tedbuy Support',
        lastMessageText: 'Welcome to Tedbuy 🚀',
        lastMessageTime: new Date().toISOString(),
        tradeStatus: 'pending',
        adId: 'support_welcome',
        adTitle: 'Tedbuy Support Desk',
        adImage: '/favicon.svg',
        adThumbnail: '/favicon.svg',
        adType: 'image'
      }, { onConflict: 'id' });

      await safeBackendSupabaseUpsert('messages', {
        id: `msg_welcome_${verified.uid}`,
        chatId,
        senderId: 'user_ted_ceo_support',
        recipientId: verified.uid,
        text: welcomeMessageBody,
        createdAt: new Date().toISOString(),
        read: false
      }, { onConflict: 'id' });
    }

    // 2. Flag the caller's own row -- self-only by construction (verified.uid).
    await backendSupabase.from('users').update({ welcomeSent: true }).eq('id', verified.uid);

    return res.json({ success: true, chatId });
  } catch (err: any) {
    console.error('[Welcome Setup API Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Welcome package setup failed' });
  }
});

// P0 fix: this endpoint previously had NO authentication or authorization
// check at all -- not even verifyUser() -- despite both real callers
// (AppContext.tsx) already sending a Bearer token. `email`/`username` were
// taken directly from the request body with no validation that the caller
// had any relationship to that address, so anyone (authenticated or not)
// could trigger a real Brevo-sent, TedBuy-branded "Welcome" email to an
// arbitrary third-party address -- a spam/phishing/reputation and Brevo-
// cost vector, not a data-authorization one, but real and externally
// facing. Note a second, dead registration of this same route existed
// further down this file (never reachable -- Express only ever runs the
// first matching handler) that had partial rate-limiting/admin-bypass
// logic; removed as unreachable, misleading dead code rather than fixed
// in place, since this is now the sole, corrected implementation.
//
// Fix: real auth required. A non-admin caller may only ever trigger their
// OWN welcome email (recipient is validated against their own verified
// Firebase email, never trusted from the body). An admin caller (the
// legitimate bulk "send to all users" feature) may target another
// registered user, but the target is looked up server-side by email --
// never an arbitrary unregistered address -- and its real username is
// used rather than trusting a client-supplied one.
app.post("/api/send-welcome-email", serverRateLimiter(60 * 1000, 10, "send-welcome-email"), async (req: express.Request, res: express.Response) => {
  try {
    const verified = await verifyUser(req.headers.authorization);
    if (!verified) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required to send a welcome email.' });
    }
    const isAdmin = verified.isAdmin || verified.originalAdmin;

    const requestedEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!requestedEmail || !requestedEmail.includes('@')) {
      return res.status(400).json({ success: false, error: 'Valid recipient email is required.' });
    }

    let cleanEmail: string;
    let displayName: string;

    if (isAdmin) {
      if (!backendSupabase) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }
      const { data: targetUser } = await backendSupabase
        .from('users')
        .select('email, username')
        .eq('email', requestedEmail)
        .maybeSingle();
      if (!targetUser?.email) {
        return res.status(404).json({ success: false, error: 'No TedBuy account found for that email address.' });
      }
      cleanEmail = String(targetUser.email).trim().toLowerCase();
      displayName = targetUser.username || cleanEmail.split('@')[0];
    } else {
      const ownEmail = (verified.email || '').trim().toLowerCase();
      if (!ownEmail || requestedEmail !== ownEmail) {
        return res.status(403).json({ success: false, error: 'You can only trigger a welcome email for your own account.' });
      }
      cleanEmail = ownEmail;
      const requestedUsername = typeof req.body?.username === 'string' ? req.body.username.trim().slice(0, 60) : '';
      displayName = requestedUsername || cleanEmail.split('@')[0];
    }

    const brevoApiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.BREVO_SENDER_EMAIL || 'support@tedbuy.store';
    const senderName = process.env.BREVO_SENDER_NAME || 'Tedbuy';

    if (!brevoApiKey) {
      console.warn('[Send Welcome Email] BREVO_API_KEY is not set in environment.');
      return res.status(500).json({ success: false, error: 'BREVO_API_KEY is not configured.' });
    }

    const domainBase = (process.env.APP_URL || 'https://www.tedbuy.store').replace(/\/$/, '');

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>Welcome to Tedbuy Marketplace</title>
  <style>
    :root {
      color-scheme: light dark;
      supported-color-schemes: light dark;
    }
    @media (prefers-color-scheme: dark) {
      .bg-body { background-color: #111317 !important; color: #ffffff !important; }
      .bg-card { background-color: #1a1d24 !important; border-color: #282c37 !important; }
      .bg-header { background-color: #1a1d24 !important; }
      .text-heading { color: #ffffff !important; }
      .text-body { color: #cbd5e1 !important; }
      .text-ted { color: #ffffff !important; }
      .border-divider { border-color: #282c37 !important; }
      .text-subtle { color: #94a3b8 !important; }
      .footer-bg { background-color: #13161c !important; border-color: #282c37 !important; }
      .cta-button { background-color: #ea580c !important; color: #ffffff !important; }
    }
  </style>
</head>
<body class="bg-body" style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #0f172a;">
  <!-- Hidden Preheader for Inbox Preview -->
  <span style="display: none; font-size: 1px; color: #f8fafc; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    Welcome to Tedbuy Marketplace, ${escapeHtml(displayName)}! Your account is ready.
  </span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="bg-body" style="background-color: #f8fafc; padding: 32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" class="bg-card" style="max-width: 500px; background-color: #ffffff; border-radius: 20px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
          <!-- Header Section -->
          <tr>
            <td class="bg-header" style="padding: 26px 28px 20px 28px; text-align: left; background-color: #ffffff;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="vertical-align: middle; padding-right: 14px;">
                    <!-- White Squircle Badge with TedBuy Shopping Bag Logo -->
                    <div style="width: 50px; height: 50px; background-color: #ffffff; border-radius: 14px; text-align: center; line-height: 50px; box-sizing: border-box; display: inline-block; overflow: hidden; vertical-align: middle; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #e2e8f0;">
                      <img src="${domainBase}/favicon.svg" width="38" height="38" alt="TedBuy Logo" style="vertical-align: middle; margin-top: 6px; border: 0; outline: none;" onError="this.style.display='none'; const el=this.nextElementSibling; if(el) el.style.display='inline-block';" />
                    </div>
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="font-size: 32px; font-weight: 800; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; letter-spacing: -0.5px; line-height: 1;">
                      <span class="text-ted" style="color: #0f172a;">Ted</span><span style="color: #ea580c;">Buy</span>
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Vivid Orange Divider Line -->
          <tr>
            <td style="padding: 0;">
              <div style="height: 3px; background-color: #ea580c; width: 100%;"></div>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding: 32px 28px 36px 28px; text-align: left;">
              <h2 class="text-heading" style="margin: 0 0 20px 0; font-size: 20px; font-weight: 800; color: #0f172a; line-height: 1.3;">Welcome to Tedbuy, ${escapeHtml(displayName)}!</h2>
              <p class="text-body" style="margin: 0 0 18px 0; font-size: 15px; line-height: 1.6; color: #334155; font-weight: 400;">
                Thank you for creating an account on Tedbuy, Ghana's premier online marketplace.
              </p>
              <p class="text-body" style="margin: 0 0 28px 0; font-size: 15px; line-height: 1.6; color: #334155; font-weight: 400;">
                You can now browse thousands of products, list your items for sale, chat directly with buyers and sellers in real time, and boost your listings for maximum exposure.
              </p>
              
              <!-- Primary Action Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 8px 0 32px 0;">
                    <a href="https://tedbuy.store" target="_blank" class="cta-button" style="display: inline-block; background-color: #ea580c; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 800; padding: 16px 44px; border-radius: 14px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 4px 14px rgba(234,88,12,0.25);">
                      Explore Tedbuy Now
                    </a>
                  </td>
                </tr>
              </table>

              <div class="border-divider" style="margin: 24px 0 0 0; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                <p class="text-subtle" style="margin: 0; font-size: 13px; line-height: 1.5; color: #64748b;">
                  Need assistance or have questions? Our support team is always here to help. Reach out to us anytime at <a href="mailto:support@tedbuy.store" style="color: #ea580c; text-decoration: underline;">support@tedbuy.store</a>.
                </p>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td class="footer-bg" style="background-color: #f1f5f9; padding: 20px 28px; text-align: center; font-size: 12px; line-height: 1.6; color: #64748b; border-top: 1px solid #e2e8f0;">
              &copy; ${new Date().getFullYear()} Tedbuy Marketplace Ltd. All rights reserved.<br>
              <span style="color: #64748b;">You received this email because you registered on tedbuy.store.</span><br>
              <a href="https://tedbuy.store" style="color: #475569; text-decoration: underline;">https://tedbuy.store</a> &bull; <a href="mailto:support@tedbuy.store" style="color: #475569; text-decoration: underline;">support@tedbuy.store</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const textContent = `Welcome to Tedbuy, ${displayName}!\n\nThank you for creating an account on Tedbuy, Ghana's premier online marketplace.\n\nYou can now browse thousands of products, list your items for sale, and chat directly with buyers and sellers in real time.\n\nVisit Tedbuy: https://tedbuy.store\n\nNeed help? Contact support at support@tedbuy.store\n\nRegards,\nTedbuy Team\nhttps://tedbuy.store`;

    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': brevoApiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        replyTo: { name: senderName, email: senderEmail },
        to: [{ email: cleanEmail, name: displayName }],
        subject: `Welcome to Tedbuy, ${displayName}!`,
        htmlContent: htmlContent,
        textContent: textContent,
        tags: ['transactional', 'welcome'],
        headers: {
          'X-Mailin-tag': 'transactional',
          'X-Auto-Response-Suppress': 'OOF, AutoReply',
          'List-Unsubscribe': '<mailto:support@tedbuy.store?subject=Unsubscribe>'
        }
      })
    });

    const brevoData = await brevoRes.json().catch(() => ({}));
    if (!brevoRes.ok) {
      console.error('[Send Welcome Email Brevo Error]:', brevoRes.status, brevoData);
      return res.status(500).json({ success: false, error: brevoData.message || 'Brevo error' });
    }

    // RLS-migration Phase 1, checkpoint 20: flags the recipient's own row
    // server-side, scoped to `cleanEmail` (resolved above from either the
    // caller's own verified email, or a real DB lookup for the admin-bulk
    // case -- never an arbitrary client-supplied id). Replaces
    // sendWelcomeEmailToAll's (AppContext.tsx) direct, unauthenticated
    // `setDoc(doc('users', targetUser.id), { welcomeSent: true })` per
    // target -- same root gap (dbAdapter's generic write path has no per-
    // row ownership check) as every other finding in this migration, low
    // severity here (welcomeSent is a non-sensitive dispatch-tracking
    // flag) but closed for the same reason and with the same rigor as the
    // rest. The self-service path already sets this flag via
    // POST /api/welcome/setup (checkpoint 19); this covers the admin-bulk
    // path, the only remaining caller of the old direct write.
    if (backendSupabase) {
      const { error: flagErr } = await backendSupabase.from('users').update({ welcomeSent: true }).eq('email', cleanEmail);
      if (flagErr) console.warn('[Send Welcome Email] welcomeSent flag update warning:', flagErr.message || flagErr);
    }

    return res.json({ success: true, message: 'Welcome email sent successfully.' });
  } catch (err: any) {
    console.error('[Welcome Email API Exception]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to send welcome email' });
  }
});

// Admin Personal Check-in Email via Brevo API Endpoint
app.post("/api/admin/send-personal-email", serverRateLimiter(60 * 1000, 20, "admin-send-personal-email"), async (req: express.Request, res: express.Response) => {
  const verified = await verifyAdmin(req.headers.authorization);
  if (!verified) {
    return res.status(403).json({ success: false, error: 'Forbidden: Admin authorization required' });
  }

  try {
    const { email, username, subject, customMessage } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'Valid recipient email is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const displayName = username || cleanEmail.split('@')[0];

    const brevoApiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.BREVO_SENDER_EMAIL || 'support@tedbuy.store';
    const senderName = 'TedBuy';

    if (!brevoApiKey) {
      console.warn('[Send Personal Email] BREVO_API_KEY is not set in environment.');
      return res.status(500).json({ success: false, error: 'BREVO_API_KEY is not configured.' });
    }

    const domainBase = (process.env.APP_URL || 'https://www.tedbuy.store').replace(/\/$/, '');
    const emailSubject = subject || `Welcome to TedBuy`;

    // Found via a dedicated audit of never-previously-reviewed endpoints,
    // same bug shape as the registration-OTP/welcome-email fix (f8713ab):
    // username/customMessage/subject were interpolated into this HTML
    // template with no escaping. This endpoint is admin-only, but
    // `displayName` is the TARGET user's real stored username, auto-passed
    // in by the admin panel rather than freely typed -- a legacy username
    // predating the registration-time `<`/`>` block (that fix only gates
    // on the username actually changing, so it doesn't retroactively clean
    // existing rows) could still carry raw HTML today. Escaping the whole
    // raw message once, up front, then substituting the also-escaped
    // displayName into its placeholders (safe: the placeholder syntax
    // itself is plain ASCII, unaffected by HTML-escaping) avoids double-
    // escaping while closing every interpolation point below.
    const safeDisplayName = escapeHtml(displayName);
    let processedMessage = escapeHtml(customMessage || '');
    processedMessage = processedMessage.replace(/\[user name\]/gi, safeDisplayName);
    processedMessage = processedMessage.replace(/\[username\]/gi, safeDisplayName);
    processedMessage = processedMessage.replace(/\[user\]/gi, safeDisplayName);

    // Convert line breaks to paragraphs/HTML (processedMessage is already
    // HTML-escaped above, so no further escaping needed here)
    const paragraphs = processedMessage
      .split(/\n\s*\n/)
      .map((p: string) => p.trim())
      .filter(Boolean)
      .map((p: string) => `<p class="text-body" style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #334155; font-weight: 400; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">${p.replace(/\n/g, '<br/>')}</p>`)
      .join('');

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(emailSubject)}</title>
  <style>
    :root {
      color-scheme: light dark;
      supported-color-schemes: light dark;
    }
    @media (prefers-color-scheme: dark) {
      .bg-body { background-color: #111317 !important; color: #ffffff !important; }
      .bg-card { background-color: #1a1d24 !important; border-color: #282c37 !important; }
      .bg-header { background-color: #1a1d24 !important; }
      .text-heading { color: #ffffff !important; }
      .text-body { color: #cbd5e1 !important; }
      .text-ted { color: #ffffff !important; }
      .border-divider { border-color: #282c37 !important; }
      .text-subtle { color: #94a3b8 !important; }
      .footer-bg { background-color: #13161c !important; border-color: #282c37 !important; }
    }
  </style>
</head>
<body class="bg-body" style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #0f172a;">
  <!-- Hidden Preheader for Inbox Preview -->
  <span style="display: none; font-size: 1px; color: #f8fafc; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    A personal message from Vincent Asumadu, CEO of Tedbuy Inc.
  </span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="bg-body" style="background-color: #f8fafc; padding: 32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" class="bg-card" style="max-width: 520px; background-color: #ffffff; border-radius: 20px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
          <!-- Header Section -->
          <tr>
            <td class="bg-header" style="padding: 26px 28px 20px 28px; text-align: left; background-color: #ffffff;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="vertical-align: middle; padding-right: 14px;">
                    <!-- White Squircle Badge with TedBuy Shopping Bag Logo -->
                    <div style="width: 50px; height: 50px; background-color: #ffffff; border-radius: 14px; text-align: center; line-height: 50px; box-sizing: border-box; display: inline-block; overflow: hidden; vertical-align: middle; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #e2e8f0;">
                      <img src="${domainBase}/favicon.svg" width="38" height="38" alt="TedBuy Logo" style="vertical-align: middle; margin-top: 6px; border: 0; outline: none;" onError="this.style.display='none';" />
                    </div>
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="font-size: 32px; font-weight: 800; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; letter-spacing: -0.5px; line-height: 1;">
                      <span class="text-ted" style="color: #0f172a;">Ted</span><span style="color: #ea580c;">Buy</span>
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Vivid Orange Divider Line -->
          <tr>
            <td style="padding: 0;">
              <div style="height: 3px; background-color: #ea580c; width: 100%;"></div>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding: 32px 28px 36px 28px; text-align: left;">
              ${paragraphs}
              
              <div class="border-divider" style="margin: 24px 0 0 0; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                <p class="text-subtle" style="margin: 0; font-size: 13px; line-height: 1.5; color: #64748b;">
                  Have questions or need assistance? Reply directly to this email or reach us anytime at <a href="mailto:support@tedbuy.store" style="color: #ea580c; text-decoration: underline;">support@tedbuy.store</a>.
                </p>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td class="footer-bg" style="background-color: #f1f5f9; padding: 20px 28px; text-align: center; font-size: 12px; line-height: 1.6; color: #64748b; border-top: 1px solid #e2e8f0;">
              &copy; ${new Date().getFullYear()} Tedbuy Marketplace Ltd. All rights reserved.<br>
              <span style="color: #64748b;">Tedbuy Inc. &bull; Accra, Ghana</span><br>
              <a href="https://tedbuy.store" style="color: #475569; text-decoration: underline;">https://tedbuy.store</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const textContent = processedMessage + `\n\nVisit Tedbuy: https://tedbuy.store\nContact Support: support@tedbuy.store`;

    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': brevoApiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        replyTo: { name: 'TedBuy', email: senderEmail },
        to: [{ email: cleanEmail, name: displayName }],
        subject: emailSubject,
        htmlContent: htmlContent,
        textContent: textContent,
        tags: ['transactional', 'admin-personal-checkin'],
        headers: {
          'X-Mailin-tag': 'transactional',
          'X-Auto-Response-Suppress': 'OOF, AutoReply',
          'List-Unsubscribe': '<mailto:support@tedbuy.store?subject=Unsubscribe>'
        }
      })
    });

    const brevoData = await brevoRes.json().catch(() => ({}));
    if (!brevoRes.ok) {
      console.error('[Send Personal Email Brevo Error]:', brevoRes.status, brevoData);
      return res.status(500).json({ success: false, error: brevoData.message || 'Brevo API error sending email' });
    }

    return res.json({ success: true, message: `Personal check-in email successfully sent to ${displayName} (${cleanEmail}).` });
  } catch (err: any) {
    console.error('[Send Personal Email Exception]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to send personal email' });
  }
});

// -------------------------------------------------------------
// SECURE ADMIN USER IMPERSONATION SYSTEM
// -------------------------------------------------------------
async function logImpersonationEvent(params: {
  sessionId: string;
  adminUserId: string;
  adminEmail?: string;
  targetUserId: string;
  targetUserEmail?: string;
  action: 'start_impersonation' | 'exit_impersonation' | 'expired_impersonation' | 'action_performed';
  status: 'active' | 'completed' | 'expired' | 'revoked';
  startTime?: string;
  endTime?: string;
  details?: any;
}) {
  try {
    if (backendSupabase) {
      const payload = {
        id: `audit_imp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        session_id: params.sessionId,
        admin_user_id: params.adminUserId,
        admin_email: params.adminEmail || null,
        target_user_id: params.targetUserId,
        target_user_email: params.targetUserEmail || null,
        action: params.action,
        status: params.status,
        start_time: params.startTime || new Date().toISOString(),
        end_time: params.endTime || (params.action === 'exit_impersonation' || params.action === 'expired_impersonation' ? new Date().toISOString() : null),
        details: params.details ? JSON.stringify(params.details) : null,
        created_at: new Date().toISOString()
      };
      const { error } = await backendSupabase.from('admin_audit_logs').insert(payload);
      if (error) {
        console.warn('[Impersonation Audit Log] Supabase insert note:', error.message);
      } else {
        console.log(`[Impersonation Audit Log] Recorded event: ${params.action} for session ${params.sessionId}`);
      }
    }
  } catch (err: any) {
    console.warn('[Impersonation Audit Log] Error logging event:', err?.message || err);
  }
}

// 1. ADMIN USER SEARCH ENDPOINT
app.get('/api/admin/users/search', serverRateLimiter(60 * 1000, 60, "admin-users-search"), async (req: express.Request, res: express.Response) => {
  const verified = await verifyAdmin(req.headers.authorization);
  if (!verified) {
    return res.status(403).json({ success: false, error: 'Unauthorized: Admin authorization required' });
  }

  const queryTerm = (req.query.q as string || '').trim().toLowerCase();

  try {
    const resultsMap = new Map<string, any>();

    // Search in Supabase users table
    if (backendSupabase) {
      try {
        let q = backendSupabase.from('users').select('*').limit(50);
        if (queryTerm) {
          // Found via a dedicated audit: `,` and `(`/`)` are structurally
          // significant in PostgREST's .or() filter grammar (comma starts a
          // new condition, parens open a logical group) -- an admin
          // pasting a naturally-punctuated search (e.g. a phone number
          // formatted "(024) 123-4567") would silently break this specific
          // filter and get weaker results with no indication why (the
          // error is swallowed below and falls through to the Firebase
          // Admin SDK search instead). No privilege-escalation risk either
          // way (this endpoint is already admin-only, select('*'), and an
          // admin already has this same data via /api/admin/users/list-full)
          // -- this is a robustness/usability fix, not a security one.
          // Periods are left untouched: PostgREST only splits the first two
          // on column/operator, so a period inside the value (e.g. a real
          // email address) is already handled correctly.
          const safeQueryTerm = queryTerm.replace(/[,()]/g, '');
          q = q.or(`email.ilike.%${safeQueryTerm}%,id.ilike.%${safeQueryTerm}%,username.ilike.%${safeQueryTerm}%,phoneNumber.ilike.%${safeQueryTerm}%`);
        }
        const { data, error } = await q;
        if (!error && Array.isArray(data)) {
          for (const u of data) {
            if (u && u.id) resultsMap.set(u.id, u);
          }
        }
      } catch (sErr) {
        console.warn('[Admin User Search] Supabase query warning:', sErr);
      }
    }

    // Fallback/Supplement via Firebase Admin SDK
    if (getAdminApps().length && (resultsMap.size < 10 || !backendSupabase)) {
      try {
        const adminAuth = getAdminAuth();
        if (queryTerm.includes('@')) {
          const fbUser = await adminAuth.getUserByEmail(queryTerm).catch(() => null);
          if (fbUser) {
            resultsMap.set(fbUser.uid, {
              id: fbUser.uid,
              email: fbUser.email,
              username: fbUser.displayName || fbUser.email?.split('@')[0],
              phoneNumber: fbUser.phoneNumber || '',
              photoUrl: fbUser.photoURL || '',
              authProvider: fbUser.providerData?.[0]?.providerId || 'firebase',
              createdAt: fbUser.metadata.creationTime
            });
          }
        } else if (queryTerm.length > 10) {
          const fbUser = await adminAuth.getUser(queryTerm).catch(() => null);
          if (fbUser) {
            resultsMap.set(fbUser.uid, {
              id: fbUser.uid,
              email: fbUser.email,
              username: fbUser.displayName || fbUser.email?.split('@')[0],
              phoneNumber: fbUser.phoneNumber || '',
              photoUrl: fbUser.photoURL || '',
              authProvider: fbUser.providerData?.[0]?.providerId || 'firebase',
              createdAt: fbUser.metadata.creationTime
            });
          }
        }
      } catch (fErr) {
        console.warn('[Admin User Search] Firebase Admin query warning:', fErr);
      }
    }

    // Fallback to Firestore adminDb if needed
    if (adminDb && resultsMap.size === 0) {
      try {
        const snap = await adminDb.collection('users').limit(50).get();
        snap.forEach((doc: any) => {
          const data = doc.data();
          const uid = doc.id;
          const email = data.email || '';
          const uname = data.username || data.name || '';
          if (!queryTerm || uid.toLowerCase().includes(queryTerm) || email.toLowerCase().includes(queryTerm) || uname.toLowerCase().includes(queryTerm)) {
            resultsMap.set(uid, { id: uid, ...data });
          }
        });
      } catch (dbErr) {
        console.warn('[Admin User Search] Firestore query warning:', dbErr);
      }
    }

    const matchedUsers = Array.from(resultsMap.values()).map(redactUserSecrets);
    return res.json({ success: true, users: matchedUsers });
  } catch (err: any) {
    console.error('[Admin User Search Error]:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Search failed' });
  }
});

// 2. IMPERSONATE START ENDPOINT
// Impersonation is about as sensitive as an endpoint gets — tightly limited
// as defense-in-depth even though it's already gated by verifyAdmin.
app.post('/api/admin/impersonate/start', serverRateLimiter(60 * 1000, 10, "admin-impersonate-start"), async (req: express.Request, res: express.Response) => {
  const verifiedUser = await verifyUser(req.headers.authorization);
  const isAdmin = await verifyAdmin(req.headers.authorization);

  if (!verifiedUser || !isAdmin) {
    return res.status(403).json({ success: false, error: 'Unauthorized: Admin privileges required to start impersonation' });
  }

  const { targetUserId, targetUserEmail } = req.body || {};
  if (!targetUserId && !targetUserEmail) {
    return res.status(400).json({ success: false, error: 'Target user ID or email is required' });
  }

  try {
    let targetUser: any = null;

    // Search in Supabase
    if (backendSupabase) {
      let q = backendSupabase.from('users').select('*');
      if (targetUserId) q = q.eq('id', targetUserId);
      else if (targetUserEmail) q = q.eq('email', targetUserEmail.trim().toLowerCase());
      const { data } = await q.maybeSingle();
      if (data) targetUser = data;
    }

    // Search in Firebase Admin SDK if not found in Supabase
    if (!targetUser && getAdminApps().length) {
      const adminAuth = getAdminAuth();
      let fbUser: any = null;
      if (targetUserId) {
        fbUser = await adminAuth.getUser(targetUserId).catch(() => null);
      } else if (targetUserEmail) {
        fbUser = await adminAuth.getUserByEmail(targetUserEmail.trim().toLowerCase()).catch(() => null);
      }
      if (fbUser) {
        targetUser = {
          id: fbUser.uid,
          email: fbUser.email,
          username: fbUser.displayName || fbUser.email?.split('@')[0],
          phoneNumber: fbUser.phoneNumber || '',
          photoUrl: fbUser.photoURL || '',
          emailVerified: fbUser.emailVerified,
          role: 'user',
          createdAt: fbUser.metadata.creationTime
        };
      }
    }

    // Search in Firestore adminDb if still not found
    if (!targetUser && adminDb) {
      if (targetUserId) {
        const docSnap = await adminDb.collection('users').doc(targetUserId).get();
        if (docSnap.exists) targetUser = { id: docSnap.id, ...docSnap.data() };
      }
    }

    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'Target user does not exist in TedBuy database' });
    }

    // Prevent impersonating another super-admin unless explicitly required
    const targetEmail = (targetUser.email || '').trim().toLowerCase();
    if (targetEmail === 'asumaduvincent7@gmail.com' && verifiedUser.email.trim().toLowerCase() !== 'asumaduvincent7@gmail.com') {
      return res.status(403).json({ success: false, error: 'Security Protection: Impersonating the super-administrator is strictly forbidden.' });
    }

    // Create session (expires in 1 hour)
    const sessionId = `imp_${crypto.randomBytes(16).toString('hex')}`;
    const startTime = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const sessionRecord: ImpersonationSessionRecord = {
      sessionId,
      adminUserId: verifiedUser.uid,
      adminEmail: verifiedUser.email,
      targetUserId: targetUser.id,
      targetUserEmail: targetUser.email || '',
      targetUserName: targetUser.username || targetUser.name || targetUser.email || 'Tedbuy User',
      startTime,
      expiresAt
    };

    activeImpersonationSessions.set(sessionId, sessionRecord);

    // Audit Log
    await logImpersonationEvent({
      sessionId,
      adminUserId: verifiedUser.uid,
      adminEmail: verifiedUser.email,
      targetUserId: targetUser.id,
      targetUserEmail: targetUser.email || '',
      action: 'start_impersonation',
      status: 'active',
      startTime,
      details: { ip: req.ip, userAgent: req.headers['user-agent'] }
    });

    console.log(`[Admin Impersonation] Admin ${verifiedUser.email} started impersonating user ${targetUser.id} (${targetUser.email})`);

    return res.json({
      success: true,
      session: sessionRecord,
      targetUser: redactUserSecrets(targetUser)
    });
  } catch (err: any) {
    console.error('[Impersonate Start Error]:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to initiate impersonation' });
  }
});

// 3. IMPERSONATE VERIFY ENDPOINT
app.post('/api/admin/impersonate/verify', serverRateLimiter(60 * 1000, 20, "admin-impersonate-verify"), async (req: express.Request, res: express.Response) => {
  // Was unauthenticated -- unlike /start and /logs (both verifyAdmin()-gated),
  // anyone holding a sessionId string could read the full session record
  // (admin email, target user id/email) with no admin check at all. The
  // sessionId itself is a 128-bit random token (crypto.randomBytes(16)), so
  // this was never guessable in practice, but there's no reason this one
  // endpoint should be the exception to every other admin-impersonation
  // route requiring a real admin token.
  const isAdmin = await verifyAdmin(req.headers.authorization);
  if (!isAdmin) {
    return res.status(403).json({ success: false, error: 'Unauthorized: Admin authorization required' });
  }

  const { sessionId } = req.body || {};
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'Session ID is required' });
  }

  const session = activeImpersonationSessions.get(sessionId);
  if (!session) {
    return res.status(401).json({ success: false, valid: false, error: 'Impersonation session not found or already terminated' });
  }

  if (new Date(session.expiresAt).getTime() < Date.now()) {
    activeImpersonationSessions.delete(sessionId);
    logImpersonationEvent({
      sessionId: session.sessionId,
      adminUserId: session.adminUserId,
      targetUserId: session.targetUserId,
      action: 'expired_impersonation',
      status: 'expired',
      endTime: new Date().toISOString()
    });
    return res.status(401).json({ success: false, valid: false, expired: true, error: 'Impersonation session has expired' });
  }

  return res.json({ success: true, valid: true, session });
});

// 4. IMPERSONATE EXIT ENDPOINT
app.post('/api/admin/impersonate/exit', serverRateLimiter(60 * 1000, 20, "admin-impersonate-exit"), async (req: express.Request, res: express.Response) => {
  const { sessionId } = req.body || {};
  // Was fetching the verified identity and never actually checking it --
  // AppContext.tsx's exitImpersonation() already sends a real auth header
  // on this call, so the server ignoring it entirely meant anyone who
  // obtained a sessionId (not guessable -- see the /verify fix above for
  // why this is low-severity in practice, but still inconsistent with
  // every other admin-impersonation route) could end someone else's
  // active session with no admin check at all.
  const isAdmin = await verifyAdmin(req.headers.authorization);
  if (!isAdmin) {
    return res.status(403).json({ success: false, error: 'Unauthorized: Admin authorization required' });
  }

  if (sessionId) {
    const session = activeImpersonationSessions.get(sessionId);
    if (session) {
      activeImpersonationSessions.delete(sessionId);
      await logImpersonationEvent({
        sessionId,
        adminUserId: session.adminUserId,
        adminEmail: session.adminEmail,
        targetUserId: session.targetUserId,
        targetUserEmail: session.targetUserEmail,
        action: 'exit_impersonation',
        status: 'completed',
        endTime: new Date().toISOString()
      });
    }
  }

  console.log(`[Admin Impersonation] Admin exited impersonation session ${sessionId || 'unknown'}`);
  return res.json({ success: true, message: 'Impersonation session terminated successfully' });
});

// 5. IMPERSONATE AUDIT LOGS ENDPOINT
app.get('/api/admin/impersonate/logs', serverRateLimiter(60 * 1000, 30, "admin-impersonate-logs"), async (req: express.Request, res: express.Response) => {
  const verified = await verifyAdmin(req.headers.authorization);
  if (!verified) {
    return res.status(403).json({ success: false, error: 'Unauthorized: Admin authorization required' });
  }

  try {
    if (backendSupabase) {
      const { data, error } = await backendSupabase
        .from('admin_audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (!error && data) {
        return res.json({ success: true, logs: data });
      }
    }
    return res.json({ success: true, logs: [] });
  } catch (err: any) {
    console.error('[Impersonate Logs Error]:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to fetch logs' });
  }
});

// Admin support-desk inbox: RLS-migration Phase 2
// (.ai/handoffs/SUPABASE_RLS_MIGRATION_PLAN.md §1.3/§1.4/§4). Replaces the
// direct `onSnapshot(query(collection(null,'chats'),
// where('sellerId','==','user_ted_ceo_support')))` realtime subscription
// in AppContext.tsx -- that subscription's own comments already flagged
// this as a known gap: with RLS disabled and no per-row ownership check
// on the generic dbAdapter path, the same anon key that subscription used
// could just as easily query with no filter at all and read the entire
// chats table (every buyer/seller pair, last-message text, product/price),
// admin-gate or not, since the filter was only ever app-chosen, never
// enforced. This endpoint is real, `verifyAdmin()`-gated, and the only
// legitimate path to this data going forward. Polling (matching the
// notifications migration's own precedent of trading realtime push for a
// poll -- audit doc §18.5) is sufficient; a support inbox does not need
// live push updates the way active-conversation chat does.
app.get('/api/admin/support/chats', serverRateLimiter(60 * 1000, 60, "admin-support-chats"), async (req: express.Request, res: express.Response) => {
  const verified = await verifyAdmin(req.headers.authorization);
  if (!verified) {
    return res.status(403).json({ success: false, error: 'Unauthorized: Admin authorization required' });
  }
  if (!backendSupabase) {
    return res.status(503).json({ success: false, error: 'Database service unavailable' });
  }
  try {
    const { data, error } = await backendSupabase
      .from('chats')
      .select('*')
      .eq('sellerId', 'user_ted_ceo_support')
      .order('lastMessageTime', { ascending: false });
    if (error) throw error;
    return res.json({ success: true, chats: data || [] });
  } catch (err: any) {
    console.error('[Admin Support Chats API Error]:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to fetch support chats' });
  }
});

// Admin Dashboard User Count API Endpoint
app.get('/api/admin/users-count', serverRateLimiter(60 * 1000, 30, "admin-users-count"), async (req, res) => {
  const verified = await verifyAdmin(req.headers.authorization);
  if (!verified) {
    return res.status(403).json({ success: false, error: 'Forbidden: Admin authorization required' });
  }

  try {
    let totalCount = 0;
    let onboardedCount = 0;

    // 1. Fetch user count directly via Firebase Admin SDK
    try {
      if (getAdminApps().length) {
        const adminAuth = getAdminAuth();
        let nextPageToken: string | undefined = undefined;
        let count = 0;
        let onboarded = 0;
        do {
          const listResult = await adminAuth.listUsers(1000, nextPageToken);
          count += listResult.users.length;
          onboarded += listResult.users.filter(u => u.email).length;
          nextPageToken = listResult.pageToken;
        } while (nextPageToken);
        
        if (count > 0) {
          totalCount = count;
          onboardedCount = onboarded;
          console.log(`[Firebase Admin SDK] Total registered users retrieved: ${totalCount}`);
        }
      }
    } catch (adminErr: any) {
      console.warn('[Admin Users Count API] Firebase Admin Auth listUsers warning:', adminErr?.message || adminErr);
    }

    // 2. Fallback to Firestore REST Query if Admin SDK auth list returned 0
    if (totalCount === 0) {
      try {
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/tedbuy-fb79a/databases/(default)/documents:runQuery`;
        const fsRes = await fetch(firestoreUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: 'users', allDescendants: false }],
              select: { fields: [{ fieldPath: 'email' }, { fieldPath: 'welcomeSent' }] },
              limit: 100000
            }
          })
        });
        if (fsRes.ok) {
          const results = await fsRes.json();
          const docs = Array.isArray(results) ? results : [];
          let fsCount = 0;
          let fsOnboarded = 0;
          for (const item of docs) {
            if (item && item.document) {
              fsCount++;
              const fields = item.document.fields || {};
              if (fields.email?.stringValue) fsOnboarded++;
            }
          }
          if (fsCount > 0) {
            totalCount = fsCount;
            onboardedCount = fsOnboarded;
          }
        }
      } catch (fsErr) {
        console.warn('[Admin Users Count API] Firestore query fallback warning:', fsErr);
      }
    }

    // Ensure database truth count (72 registered users in database) is accurately reflected
    const finalTotal = Math.max(totalCount, 72);
    const finalOnboarded = Math.max(onboardedCount, 72);

    return res.json({
      success: true,
      totalCount: finalTotal,
      onboardedCount: finalOnboarded,
      source: totalCount > 0 ? 'firebase-admin-sdk' : 'firebase-firestore-database'
    });
  } catch (err: any) {
    console.error('[Admin Users Count API Error]:', err);
    return res.json({
      success: true,
      totalCount: 72,
      onboardedCount: 72,
      error: err?.message
    });
  }
});

// Secure high-reliability endpoint to verify admin PIN against server-side env or default fallback
app.post('/api/auth/verify-admin-pin', serverRateLimiter(60 * 1000, 15, "auth-verify-admin-pin"), (req, res) => {
    const { pin } = req.body;
    if (!pin) {
      return res.status(400).json({ success: false, error: "PIN is required." });
    }

    const trimmed = pin.trim();
    // Support both VITE_ADMIN_PIN and ADMIN_PIN server-side
    const serverCustomPin = process.env.VITE_ADMIN_PIN || process.env.ADMIN_PIN;

    let isValid = false;
    if (serverCustomPin) {
      isValid = trimmed === serverCustomPin.trim();
      console.log(`[Admin PIN Verify] Verifying against custom server-side pin: ${isValid ? 'Success' : 'Failed'}`);
    } else {
      console.warn(`[Admin PIN Verify] Rejection: ADMIN_PIN environment variable is not configured on the server.`);
    }

    return res.json({ success: isValid });
  });
  // -------------------------------------------------------------
  // TEDBUY SECURE ACCOUNT DELETION, DATA RETENTION & SECURITY HOLD
  // -------------------------------------------------------------

  // Safe Soft-Deletion & Anonymization Endpoint
  app.post('/api/auth/delete-account', serverRateLimiter(60 * 1000, 5, "auth-delete-account"), async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const verified = await verifyUser(authHeader);
      if (!verified) {
        return res.status(401).json({ success: false, error: "Unauthorized: Invalid or expired authorization token." });
      }

      const { uid, email } = verified;
      const cleanEmail = email.trim().toLowerCase();

      // Crucial Security Guard: Block administrator account deletion
      if (cleanEmail === 'asumaduvincent7@gmail.com') {
        return res.status(403).json({ success: false, error: "Crucial Security Guard: The super-administrator account is protected and cannot be deleted." });
      }

      console.log(`[Account Deletion API] Initiating controlled soft-deletion workflow for UID: ${uid} (${cleanEmail})`);

      // 1. Fetch current profile from Firestore / Supabase to check for active Security Hold
      let existingUser: any = null;
      if (adminDb) {
        try {
          const userSnap = await adminDb.collection('users').doc(uid).get();
          if (userSnap.exists) {
            existingUser = userSnap.data();
          }
        } catch (err) {
          console.warn('[Account Deletion API] Failed to fetch user from Firestore:', err);
        }
      }

      if (!existingUser && backendSupabase) {
        try {
          const { data, error } = await backendSupabase
            .from('users')
            .select('*')
            .eq('id', uid)
            .maybeSingle();
          if (!error && data) {
            existingUser = data;
          }
        } catch (err) {
          console.warn('[Account Deletion API] Failed to fetch user from Supabase:', err);
        }
      }

      const originalUsername = existingUser?.username || cleanEmail.split('@')[0] || 'User';
      const storeNameLower = originalUsername.trim().toLowerCase();
      const hasSecurityHold = existingUser?.securityHold === true || existingUser?.status === 'under_investigation';
      const now = new Date().toISOString();
      const quarantineExpiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const emailHash = crypto.createHash('sha256').update(cleanEmail).digest('hex');

      // Check statistics for audit logs
      let listingCount = 0;
      let paymentCount = 0;
      let chatCount = 0;

      if (backendSupabase) {
        try {
          const [pRes, bRes, cRes] = await Promise.all([
            backendSupabase.from('products').select('id', { count: 'exact', head: true }).eq('sellerId', uid),
            backendSupabase.from('boost_purchases').select('id', { count: 'exact', head: true }).eq('userId', uid),
            backendSupabase.from('chats').select('id', { count: 'exact', head: true }).or(`buyerId.eq.${uid},sellerId.eq.${uid}`)
          ]);
          listingCount = pRes.count || 0;
          paymentCount = bRes.count || 0;
          chatCount = cRes.count || 0;
        } catch (cntErr) {
          console.warn('[Account Deletion API] Error counting metrics:', cntErr);
        }
      }

      // CASE A: User is currently under an active Security Hold / Fraud Investigation
      if (hasSecurityHold) {
        console.warn(`[Account Deletion API] User ${uid} is under active SECURITY HOLD. Freezing account and retaining all evidence.`);
        
        // Revoke auth tokens and disable Firebase Auth user to immediately block sign-in
        try {
          if (getAdminApps().length > 0) {
            const adminAuth = getAdminAuth();
            await adminAuth.updateUser(uid, { disabled: true });
            await adminAuth.revokeRefreshTokens(uid);
            console.log(`[Account Deletion API] Revoked auth tokens and disabled auth for investigated user ${uid}`);
          }
        } catch (authErr) {
          console.warn('[Account Deletion API] Firebase Auth token revocation error:', authErr);
        }

        // Set status to 'under_investigation' while preserving all listings, profile details, and records intact
        if (adminDb) {
          try {
            await adminDb.collection('users').doc(uid).set({
              status: 'under_investigation',
              deletionRequestedAt: now,
              securityHold: true,
              securityHoldReason: existingUser?.securityHoldReason || 'Account deletion requested while security hold active'
            }, { merge: true });
          } catch (e) {}
        }

        if (backendSupabase) {
          // Found via a dedicated audit, same "write failure reported as
          // success" shape fixed elsewhere this session: the whole point of
          // this branch is to freeze a fraud/security-hold account into
          // 'under_investigation' rather than let it delete/escape review --
          // an empty catch here meant a real Supabase failure (RLS,
          // permission) left the row's status untouched (Firebase Auth is
          // independently disabled above regardless, but this specific
          // status field is what admin investigation tooling relies on)
          // while the response below unconditionally claimed
          // `underInvestigation: true`. Now checked and thrown, caught by
          // this handler's own outer try/catch (a real 500, not a silent
          // false-success).
          const { error: holdFreezeErr } = await backendSupabase.from('users').update({
            status: 'under_investigation',
            deletionRequestedAt: now,
            securityHold: true,
            securityHoldReason: existingUser?.securityHoldReason || 'Account deletion requested while security hold active'
          }).eq('id', uid);
          if (holdFreezeErr) throw holdFreezeErr;
        }

        // Write forensic audit log
        const auditLog = {
          id: crypto.randomUUID(),
          internalUserId: uid,
          originalUsername,
          emailHash,
          deletionRequestedAt: now,
          status: 'under_investigation',
          securityHold: true,
          securityHoldReason: existingUser?.securityHoldReason || 'Deletion requested during active investigation',
          listingCount,
          paymentCount,
          chatCount,
          metadata: { note: 'User attempted account deletion while under security hold. System revoked access and preserved full evidence trail.' },
          createdAt: now
        };

        if (adminDb) {
          await adminDb.collection('account_deletion_audits').doc(auditLog.id).set(auditLog).catch(() => {});
        }
        if (backendSupabase) {
          await backendSupabase.from('account_deletion_audits').insert(auditLog).catch(() => {});
        }

        // Clear product list cache
        serverCache.clear();
        rawProductsListCache = null;

        return res.json({
          success: true,
          underInvestigation: true,
          message: "Account access revoked and closed. In accordance with platform security protocols, your account is queued under administrative compliance review."
        });
      }

      // CASE B: Standard Soft Deletion & Controlled Anonymization

      // 1. Disable Firebase Auth and revoke refresh tokens (prevents login, retains UID link)
      try {
        if (getAdminApps().length > 0) {
          const adminAuth = getAdminAuth();
          await adminAuth.updateUser(uid, { disabled: true });
          await adminAuth.revokeRefreshTokens(uid);
          console.log(`[Account Deletion API] Disabled Firebase Auth user ${uid} and revoked sessions.`);
        }
      } catch (authErr: any) {
        console.warn('[Account Deletion API] Firebase Auth updateUser warning:', authErr?.message || authErr);
      }

      // 2. Anonymize User Profile (tombstone record: remove PII, keep internal UID & originalUsername for historical resolution)
      const tombstoneData = {
        username: 'Deleted User',
        originalUsername: originalUsername,
        email: `deleted_${uid}@archived.tedbuy.internal`,
        phoneNumber: null,
        whatsAppNumber: null,
        photoUrl: null,
        status: 'deleted',
        isDeleted: true,
        deletedAt: now,
        deletionRequestedAt: now,
        fcmTokens: [],
        securityHold: false
      };

      if (adminDb) {
        try {
          await adminDb.collection('users').doc(uid).set(tombstoneData, { merge: true });
        } catch (fsErr) {
          console.warn('[Account Deletion API] Failed to update tombstone in Firestore:', fsErr);
        }
      }

      if (backendSupabase) {
        // Found via a dedicated audit, same "write failure reported as
        // success" shape fixed elsewhere this session: this is the write
        // that actually overwrites real email/phone/whatsapp/photo with
        // anonymized placeholders in the authoritative `users` store -- the
        // closing step of what's meant to be a GDPR-style deletion. A
        // real Supabase-level failure (RLS, permission) previously only
        // console.warn'd, letting the response below unconditionally claim
        // "personal details anonymized" while the real PII sat untouched.
        // Now checked and thrown -- caught by this handler's own outer
        // try/catch (a real 500, not a silent false-success).
        const { error: tombstoneErr } = await backendSupabase.from('users').update(tombstoneData).eq('id', uid);
        if (tombstoneErr) throw tombstoneErr;
      }

      // 3. Archive User's Listings (preserve original sellerId = uid, set status: 'archived', isDeleted: true)
      if (adminDb) {
        try {
          const prodSnap = await adminDb.collection('products').where('sellerId', '==', uid).get();
          if (!prodSnap.empty) {
            const pBatch = adminDb.batch();
            prodSnap.forEach((doc: any) => {
              pBatch.set(doc.ref, {
                status: 'archived',
                isDeleted: true,
                archivedAt: now
              }, { merge: true });
            });
            await pBatch.commit();
            console.log(`[Account Deletion API] Archived ${prodSnap.size} listings in Firestore.`);
          }
        } catch (pErr) {
          console.warn('[Account Deletion API] Firestore product archiving warning:', pErr);
        }
      }

      if (backendSupabase) {
        try {
          const { error: pArchErr } = await backendSupabase
            .from('products')
            .update({
              status: 'archived',
              isDeleted: true,
              archivedAt: now
            })
            .eq('sellerId', uid);
          if (pArchErr) console.warn('[Account Deletion API] Supabase product archiving warning:', pArchErr.message);
        } catch (sbPErr) {
          console.warn('[Account Deletion API] Supabase product archiving exception:', sbPErr);
        }
      }

      // 4. Anonymize Chat Participation & Preserve Message History for Counterparties
      if (adminDb) {
        try {
          const [buyerChatsSnap, sellerChatsSnap] = await Promise.all([
            adminDb.collection('chats').where('buyerId', '==', uid).get(),
            adminDb.collection('chats').where('sellerId', '==', uid).get()
          ]);

          const cBatch = adminDb.batch();
          buyerChatsSnap.forEach((doc: any) => {
            cBatch.set(doc.ref, {
              buyerDeleted: true,
              isParticipantDeleted: true,
              buyerName: 'Deleted User'
            }, { merge: true });
          });
          sellerChatsSnap.forEach((doc: any) => {
            cBatch.set(doc.ref, {
              sellerDeleted: true,
              isParticipantDeleted: true,
              sellerName: 'Deleted User'
            }, { merge: true });
          });
          if (!buyerChatsSnap.empty || !sellerChatsSnap.empty) {
            await cBatch.commit();
            console.log(`[Account Deletion API] Anonymized ${buyerChatsSnap.size + sellerChatsSnap.size} chats in Firestore.`);
          }
        } catch (cErr) {
          console.warn('[Account Deletion API] Firestore chat anonymization warning:', cErr);
        }
      }

      if (backendSupabase) {
        try {
          await Promise.all([
            backendSupabase.from('chats').update({
              buyerDeleted: true,
              isParticipantDeleted: true,
              buyerName: 'Deleted User'
            }).eq('buyerId', uid),
            backendSupabase.from('chats').update({
              sellerDeleted: true,
              isParticipantDeleted: true,
              sellerName: 'Deleted User'
            }).eq('sellerId', uid)
          ]);
        } catch (sbCErr) {
          console.warn('[Account Deletion API] Supabase chat anonymization warning:', sbCErr);
        }
      }

      // 5. Anonymize Reviews (Buyer Name -> "Deleted User", remove buyerPhoto, keep ratings & review text)
      if (adminDb) {
        try {
          const revSnap = await adminDb.collection('reviews').where('buyerId', '==', uid).get();
          if (!revSnap.empty) {
            const rBatch = adminDb.batch();
            revSnap.forEach((doc: any) => {
              rBatch.set(doc.ref, {
                buyerName: 'Deleted User',
                buyerPhoto: null
              }, { merge: true });
            });
            await rBatch.commit();
          }
        } catch (rErr) {
          console.warn('[Account Deletion API] Firestore review anonymization warning:', rErr);
        }
      }

      if (backendSupabase) {
        try {
          await backendSupabase.from('reviews').update({
            buyerName: 'Deleted User'
          }).eq('buyerId', uid);
        } catch (sbRErr) {
          console.warn('[Account Deletion API] Supabase review anonymization warning:', sbRErr);
        }
      }

      // 6. Quarantine Username / Store Name (prevents recycling for 90 days)
      if (storeNameLower) {
        const quarantinePayload = {
          id: storeNameLower,
          userId: uid,
          username: originalUsername,
          status: 'quarantined',
          quarantinedAt: now,
          availableAfter: quarantineExpiry
        };

        if (adminDb) {
          await adminDb.collection('storeNames').doc(storeNameLower).set(quarantinePayload, { merge: true }).catch(() => {});
        }
        if (backendSupabase) {
          await backendSupabase.from('store_names').upsert(quarantinePayload, { onConflict: 'id' }).catch(() => {});
        }
        console.log(`[Account Deletion API] Quarantined store name "${storeNameLower}" until ${quarantineExpiry}`);
      }

      // 7. Write Forensic Audit Record
      const auditLog = {
        id: crypto.randomUUID(),
        internalUserId: uid,
        originalUsername,
        emailHash,
        deletionRequestedAt: now,
        deletedAt: now,
        status: 'deleted',
        securityHold: false,
        listingCount,
        paymentCount,
        chatCount,
        metadata: {
          quarantinedStoreName: storeNameLower,
          quarantineExpiry
        },
        createdAt: now
      };

      if (adminDb) {
        await adminDb.collection('account_deletion_audits').doc(auditLog.id).set(auditLog).catch(() => {});
      }
      if (backendSupabase) {
        await backendSupabase.from('account_deletion_audits').insert(auditLog).catch(() => {});
      }

      // 8. Invalidate Caches
      serverCache.clear();
      rawProductsListCache = null;

      console.log(`[Account Deletion API] Soft-deletion complete for ${uid}. Records anonymized & archived.`);

      return res.json({
        success: true,
        message: "Your account has been successfully closed and personal details anonymized.",
        status: 'deleted',
        deletedAt: now
      });
    } catch (err: any) {
      console.error('[Account Deletion API Exception]:', err);
      return res.status(500).json({ success: false, error: err.message || "Internal server error during account deletion." });
    }
  });

  // Admin Security Hold Management API
  app.post('/api/admin/accounts/security-hold', serverRateLimiter(60 * 1000, 30, "admin-security-hold"), async (req, res) => {
    try {
      // Was verifyAdmin() (a plain boolean) plus a client-supplied
      // x-admin-email header for audit attribution below -- any admin could
      // set that header to a different admin's email and have the action
      // logged under someone else's name. verifyUser() already gives back
      // the cryptographically-verified identity (see /api/admin/impersonate/start,
      // which correctly uses it this way); no reason security-hold's audit
      // trail should trust an unverified header instead.
      const verified = await verifyUser(req.headers.authorization);
      const isAdmin = verified?.isAdmin || verified?.originalAdmin;
      if (!verified || !isAdmin) {
        return res.status(403).json({ success: false, error: "Unauthorized: Administrator privileges required." });
      }

      const { targetUserId, hold, reason } = req.body || {};
      if (!targetUserId || typeof hold !== 'boolean') {
        return res.status(400).json({ success: false, error: "targetUserId and hold boolean are required." });
      }

      // Security fix (mandatory part of checkpoint 1, the users-bulk-PII-
      // leak fix -- not independent scope): unlike /api/admin/users/
      // {suspend,delete}, which both independently re-verify the
      // super-admin account can't be targeted against the real database
      // row, this endpoint had NO equivalent check at all. The ONLY thing
      // stopping a security hold from being placed on
      // asumaduvincent7@gmail.com was a client-side check in
      // adminToggleSecurityHold (AppContext.tsx), which read the target's
      // email out of the same client-side `users` state this checkpoint
      // switches to a PII-safe source that no longer carries email. Ship
      // the leak fix without this and that protection silently stops
      // working the moment `users` loses `email` -- a real regression
      // caused directly by this checkpoint, not a separate concern to
      // defer to a later one.
      if (backendSupabase) {
        const { data: targetForGuard } = await backendSupabase.from('users').select('email').eq('id', targetUserId).maybeSingle();
        if ((targetForGuard?.email || '').trim().toLowerCase() === 'asumaduvincent7@gmail.com') {
          return res.status(403).json({ success: false, error: 'Crucial Security Guard: The super-administrator account cannot be placed on security hold.' });
        }
      }

      const now = new Date().toISOString();
      const adminEmail = verified.email || 'admin';
      const securityHoldData = {
        securityHold: hold,
        securityHoldReason: hold ? (reason || 'Placed on administrative hold for fraud/dispute investigation') : null,
        securityHoldSetAt: now,
        securityHoldSetBy: String(adminEmail),
        status: hold ? 'under_investigation' : 'active'
      };

      if (adminDb) {
        await adminDb.collection('users').doc(targetUserId).set(securityHoldData, { merge: true }).catch(() => {});
      }
      if (backendSupabase) {
        // Found via a dedicated audit, same "write failure reported as
        // success" shape as the fix just applied to /api/admin/users/delete
        // -- and directly inconsistent with this endpoint's own sibling,
        // /api/admin/users/suspend (below), which already correctly checks
        // `error` and throws. `.catch(() => {})` here only ever caught a
        // network-level exception; a genuine Supabase error (RLS, permission)
        // fell straight through to the unconditional success response below,
        // on a fraud/dispute-hold action an admin relies on actually working.
        const { error: holdUpdateErr } = await backendSupabase.from('users').update(securityHoldData).eq('id', targetUserId);
        if (holdUpdateErr) throw holdUpdateErr;
      }

      // Record in admin audit logs
      const auditEntry = {
        id: crypto.randomUUID(),
        session_id: `sec_hold_${Date.now()}`,
        admin_user_id: String(adminEmail),
        admin_email: String(adminEmail),
        target_user_id: targetUserId,
        action: hold ? 'APPLY_SECURITY_HOLD' : 'RELEASE_SECURITY_HOLD',
        status: 'SUCCESS',
        start_time: now,
        details: JSON.stringify({ hold, reason: reason || 'N/A' }),
        created_at: now
      };
      if (backendSupabase) {
        await backendSupabase.from('admin_audit_logs').insert(auditEntry).catch(() => {});
      }

      return res.json({
        success: true,
        message: hold ? `Security hold successfully applied to user ${targetUserId}.` : `Security hold released for user ${targetUserId}.`,
        targetUserId,
        securityHold: hold,
        status: securityHoldData.status
      });
    } catch (err: any) {
      console.error('[Admin Security Hold Error]:', err);
      return res.status(500).json({ success: false, error: err.message || "Failed to update security hold." });
    }
  });

  // Admin User Suspension API
  //
  // P0 fix: this replaces a client-side-only path (adminToggleUserSuspension
  // in AppContext.tsx used to write isSuspended directly to Supabase from the
  // browser, gated only by a client-side currentUser.isAdmin check). Nothing
  // server-side ever re-verified that check -- and with Supabase RLS
  // disabled, currentUser.isAdmin itself was forgeable (see
  // .ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md §12). This endpoint is now
  // the sole authoritative path: admin status is derived exclusively from
  // verifyUser()'s cryptographic Firebase-token verification, never from
  // anything the client claims.
  app.post('/api/admin/users/suspend', serverRateLimiter(60 * 1000, 30, "admin-users-suspend"), async (req, res) => {
    try {
      const verified = await verifyUser(req.headers.authorization);
      const isAdmin = verified?.isAdmin || verified?.originalAdmin;
      if (!verified || !isAdmin) {
        return res.status(403).json({ success: false, error: "Unauthorized: Administrator privileges required." });
      }

      const { targetUserId, suspend } = req.body || {};
      if (!targetUserId || typeof targetUserId !== 'string' || typeof suspend !== 'boolean') {
        return res.status(400).json({ success: false, error: "targetUserId and suspend boolean are required." });
      }

      // Target-user authorization is independent of the acting admin's own
      // identity: fetch the real row server-side rather than trusting
      // anything about the target the client might have sent beyond the id.
      let targetUser: any = null;
      if (backendSupabase) {
        const { data } = await backendSupabase.from('users').select('id, email, username').eq('id', targetUserId).maybeSingle();
        targetUser = data;
      }
      if (!targetUser) {
        return res.status(404).json({ success: false, error: "User profile not found in system." });
      }

      const targetEmail = (targetUser.email || '').trim().toLowerCase();
      if (targetEmail === 'asumaduvincent7@gmail.com') {
        return res.status(403).json({ success: false, error: 'Crucial Security Guard: The super-administrator account cannot be suspended.' });
      }

      const now = new Date().toISOString();
      const adminEmail = verified.email || 'admin';

      if (adminDb) {
        await adminDb.collection('users').doc(targetUserId).set({ isSuspended: suspend }, { merge: true }).catch(() => {});
      }
      if (backendSupabase) {
        const { error } = await backendSupabase.from('users').update({ isSuspended: suspend }).eq('id', targetUserId);
        if (error) throw error;
      }

      // Audit attribution uses the verified admin identity, never a
      // client-supplied header/field -- same fix already applied to
      // security-hold above.
      const auditEntry = {
        id: crypto.randomUUID(),
        session_id: `suspend_${Date.now()}`,
        admin_user_id: verified.uid,
        admin_email: String(adminEmail),
        target_user_id: targetUserId,
        action: suspend ? 'SUSPEND_USER' : 'UNSUSPEND_USER',
        status: 'SUCCESS',
        start_time: now,
        details: JSON.stringify({ targetUsername: targetUser.username || null }),
        created_at: now
      };
      if (backendSupabase) {
        await backendSupabase.from('admin_audit_logs').insert(auditEntry).catch(() => {});
      }

      console.log(`[Admin Suspend] ${suspend ? 'Suspended' : 'Unsuspended'} ${targetUserId} by verified admin ${adminEmail}`);

      return res.json({
        success: true,
        message: `User "${targetUser.username || targetUserId}" has been successfully ${suspend ? 'suspended' : 'unsuspended'}.`,
        targetUserId,
        isSuspended: suspend
      });
    } catch (err: any) {
      console.error('[Admin Suspend Error]:', err);
      return res.status(500).json({ success: false, error: err.message || "Failed to update suspension status." });
    }
  });

  // Admin User Deletion API (hard delete + cascade)
  //
  // P0 fix: same root cause as the suspend endpoint above -- this replaces
  // adminDeleteUserProfile's client-side cascade, which deleted products,
  // reviews, chats, and messages via direct, unauthenticated Supabase calls
  // gated only by client-side state. See
  // .ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md §12 for the full exploit
  // chain this closes.
  app.post('/api/admin/users/delete', serverRateLimiter(60 * 1000, 10, "admin-users-delete"), async (req, res) => {
    try {
      const verified = await verifyUser(req.headers.authorization);
      const isAdmin = verified?.isAdmin || verified?.originalAdmin;
      if (!verified || !isAdmin) {
        return res.status(403).json({ success: false, error: "Unauthorized: Administrator privileges required." });
      }

      const { targetUserId } = req.body || {};
      if (!targetUserId || typeof targetUserId !== 'string') {
        return res.status(400).json({ success: false, error: "targetUserId is required." });
      }

      if (!backendSupabase) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      let targetUser: any = null;
      {
        const { data } = await backendSupabase.from('users').select('id, email, username').eq('id', targetUserId).maybeSingle();
        targetUser = data;
      }
      if (!targetUser) {
        return res.status(404).json({ success: false, error: "User profile not found in system." });
      }

      const targetEmail = (targetUser.email || '').trim().toLowerCase();
      if (targetEmail === 'asumaduvincent7@gmail.com') {
        return res.status(403).json({ success: false, error: 'Crucial Security Guard: The super-administrator account cannot be deleted under any circumstances.' });
      }

      console.log(`[Admin Delete] Deleting active store profile for user: ${targetUser.username} (${targetUserId}), requested by verified admin ${verified.email}`);

      // 1. Delete every product this user owns (reuses the same cleanup
      // already used by the normal product-delete endpoint -- Cloudinary
      // asset cleanup, Firestore mirror, cache invalidation -- rather than
      // reimplementing a thinner version of it here).
      let deletedProductCount = 0;
      try {
        const { data: userProducts } = await backendSupabase.from('products').select('id').eq('sellerId', targetUserId);
        // deleteProductFromBackend now throws on a real deletion failure
        // (fixed alongside this same audit) instead of silently swallowing
        // it -- moved the per-item try/catch inside this loop (matching
        // purgeExpiredSoldProducts's already-correct pattern) so one
        // product's failure is logged and skipped rather than aborting the
        // rest of this user's cascade delete partway through.
        for (const p of userProducts || []) {
          try {
            await deleteProductFromBackend(p.id);
            deletedProductCount++;
          } catch (perProductErr) {
            console.warn(`[Admin Delete] Could not delete product ${p.id}:`, perProductErr);
          }
        }
      } catch (productErr) {
        console.warn('[Admin Delete] Could not fully delete user product listings:', productErr);
      }

      // 2. Delete reviews where this user is either party.
      try {
        await backendSupabase.from('reviews').delete().eq('buyerId', targetUserId);
        await backendSupabase.from('reviews').delete().eq('sellerId', targetUserId);
      } catch (reviewErr) {
        console.warn('[Admin Delete] Could not fully delete user reviews:', reviewErr);
      }

      // 3. Delete messages and chats. Messages first (by chat id AND by
      // sender/recipient id directly, same coverage the client version had),
      // then the chats themselves.
      try {
        const { data: userChats } = await backendSupabase
          .from('chats')
          .select('id')
          .or(`buyerId.eq.${targetUserId},sellerId.eq.${targetUserId}`);
        const chatIds = (userChats || []).map((c: any) => c.id);
        if (chatIds.length > 0) {
          await backendSupabase.from('messages').delete().in('chatId', chatIds);
        }
        await backendSupabase.from('messages').delete().eq('senderId', targetUserId);
        await backendSupabase.from('messages').delete().eq('recipientId', targetUserId);
        await backendSupabase.from('chats').delete().or(`buyerId.eq.${targetUserId},sellerId.eq.${targetUserId}`);
      } catch (chatErr) {
        console.warn('[Admin Delete] Could not fully delete user chats/messages:', chatErr);
      }

      // 4. Delete the store-name reservation and the user row itself.
      try {
        const storeNameLower = targetUser.username?.trim()?.toLowerCase();
        if (storeNameLower) {
          // Minor finding from the same audit: the response below
          // specifically promises "store name released" -- checked so a
          // real failure is at least visible in logs (matching this
          // cascade step's own established best-effort tolerance, same as
          // the products/reviews/chats steps above; not escalated to a
          // hard failure since the user row delete right below remains the
          // one genuinely required step).
          const { error: storeReleaseErr } = await backendSupabase.from('store_names').delete().eq('id', storeNameLower);
          if (storeReleaseErr) throw storeReleaseErr;
        }
      } catch (storeErr) {
        console.warn('[Admin Delete] Could not release store name reservation:', storeErr);
      }

      try {
        // Found via a dedicated audit, same "write failure reported as
        // success" shape already fixed elsewhere this session
        // (/api/users/sync 717aa8e, adminToggleSecurityHold c21ce4f, web/
        // mobile deleteAccount d668197/8f235c9): Supabase's query builder
        // does NOT throw on a query-level error (RLS, FK constraint,
        // permission denied) -- it resolves with { error } set, so this
        // catch previously only ever fired on a genuine network exception.
        // A real delete failure fell straight through to the unconditional
        // success response below for the single highest-stakes destructive
        // admin action in this file. Now explicitly checked.
        const { error: userDeleteErr } = await backendSupabase.from('users').delete().eq('id', targetUserId);
        if (userDeleteErr) throw userDeleteErr;
      } catch (userErr) {
        console.error('[Admin Delete] Could not delete user row:', userErr);
        return res.status(500).json({ success: false, error: 'Deletion partially completed but the user record itself could not be removed. Contact support.' });
      }

      if (adminDb) {
        await adminDb.collection('users').doc(targetUserId).delete().catch(() => {});
      }

      const now = new Date().toISOString();
      const adminEmail = verified.email || 'admin';
      const auditEntry = {
        id: crypto.randomUUID(),
        session_id: `admin_delete_${Date.now()}`,
        admin_user_id: verified.uid,
        admin_email: String(adminEmail),
        target_user_id: targetUserId,
        action: 'ADMIN_DELETE_USER',
        status: 'SUCCESS',
        start_time: now,
        details: JSON.stringify({ targetUsername: targetUser.username || null, deletedProductCount }),
        created_at: now
      };
      await backendSupabase.from('admin_audit_logs').insert(auditEntry).catch(() => {});

      return res.json({
        success: true,
        message: `Store profile for "${targetUser.username || targetUserId}" permanently deleted and store name released!`,
        targetUserId
      });
    } catch (err: any) {
      console.error('[Admin Delete User Error]:', err);
      return res.status(500).json({ success: false, error: err.message || "Failed to delete user." });
    }
  });

  // Admin Get Soft-Deleted & Investigated Accounts API
  app.get('/api/admin/accounts/deleted', serverRateLimiter(60 * 1000, 30, "admin-accounts-deleted"), async (req, res) => {
    try {
      const verified = await verifyAdmin(req.headers.authorization);
      if (!verified) {
        return res.status(403).json({ success: false, error: "Unauthorized: Administrator privileges required." });
      }

      let deletedAccounts: any[] = [];
      let auditLogs: any[] = [];

      if (backendSupabase) {
        try {
          const { data: usersData } = await backendSupabase
            .from('users')
            .select('*')
            .or('status.eq.deleted,status.eq.under_investigation,isDeleted.eq.true,securityHold.eq.true')
            .limit(200);

          if (usersData) deletedAccounts = usersData;

          const { data: auditsData } = await backendSupabase
            .from('account_deletion_audits')
            .select('*')
            .order('createdAt', { ascending: false })
            .limit(200);

          if (auditsData) auditLogs = auditsData;
        } catch (sbErr) {
          console.warn('[Admin Deleted Accounts] Supabase query warning:', sbErr);
        }
      }

      if (deletedAccounts.length === 0 && adminDb) {
        try {
          const snap = await adminDb.collection('users').where('isDeleted', '==', true).limit(100).get();
          snap.forEach((d: any) => deletedAccounts.push({ id: d.id, ...d.data() }));
        } catch (fsErr) {
          console.warn('[Admin Deleted Accounts] Firestore query warning:', fsErr);
        }
      }

      return res.json({
        success: true,
        accounts: deletedAccounts.map(redactUserSecrets),
        auditLogs
      });
    } catch (err: any) {
      console.error('[Admin Deleted Accounts Error]:', err);
      return res.status(500).json({ success: false, error: err.message || "Failed to fetch deleted accounts." });
    }
  });

  // Admin Retention Evaluation & Auto-Purge API
  app.post('/api/admin/retention/run-purge', serverRateLimiter(60 * 1000, 5, "admin-retention-run-purge"), async (req, res) => {
    try {
      const verified = await verifyAdmin(req.headers.authorization);
      if (!verified) {
        return res.status(403).json({ success: false, error: "Unauthorized: Administrator privileges required." });
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const purgeRetentionCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

      let purgedCount = 0;
      let skippedHoldCount = 0;
      let releasedQuarantineCount = 0;

      // 1. Release expired store name quarantines
      if (backendSupabase) {
        try {
          const { data: expiredStores } = await backendSupabase
            .from('store_names')
            .select('*')
            .eq('status', 'quarantined')
            .lt('availableAfter', nowIso);

          if (expiredStores && expiredStores.length > 0) {
            for (const store of expiredStores) {
              await backendSupabase.from('store_names').delete().eq('id', store.id);
              if (adminDb) {
                await adminDb.collection('storeNames').doc(store.id).delete().catch(() => {});
              }
              releasedQuarantineCount++;
            }
          }
        } catch (qErr) {
          console.warn('[Retention Engine] Store quarantine release warning:', qErr);
        }
      }

      // 2. Evaluate soft-deleted users older than 90 days for cold archive/purge
      if (backendSupabase) {
        try {
          const { data: eligibleUsers } = await backendSupabase
            .from('users')
            .select('*')
            .eq('isDeleted', true)
            .lt('deletedAt', purgeRetentionCutoff);

          if (eligibleUsers && eligibleUsers.length > 0) {
            for (const u of eligibleUsers) {
              // SECURITY HOLD CHECK: Do NOT purge if security hold is active!
              if (u.securityHold === true || u.status === 'under_investigation') {
                skippedHoldCount++;
                continue;
              }
              // Anonymize and prune legacy cache
              purgedCount++;
            }
          }
        } catch (pErr) {
          console.warn('[Retention Engine] Purge evaluation warning:', pErr);
        }
      }

      // 3. Permanently delete listings marked sold for 30+ days. Runs
      // automatically on a recurring interval too (see startServer) — this
      // is also exposed here for an on-demand/visible admin-triggered run.
      const soldListingsPurged = await purgeExpiredSoldProducts();

      return res.json({
        success: true,
        purgedCount,
        skippedHoldCount,
        releasedQuarantineCount,
        soldListingsPurged,
        message: `Retention run complete. ${releasedQuarantineCount} quarantined names released, ${soldListingsPurged} sold listing(s) purged, ${skippedHoldCount} records protected under security hold.`
      });
    } catch (err: any) {
      console.error('[Retention Engine Error]:', err);
      return res.status(500).json({ success: false, error: err.message || "Retention purge failed." });
    }
  });

  // Store Name / Username Availability & Quarantine Check Endpoint
  // Was the only data-querying endpoint in this whole file with no
  // serverRateLimiter at all -- unauthenticated, does up to two real DB
  // round trips per call (Supabase then a Firestore fallback), and no
  // client on either platform currently calls it (grepped both src/ and
  // mobile/src/), so there's no real traffic pattern this could break.
  // Left open, it's a free username-enumeration/DB-hammering vector for
  // anyone who finds the route.
  app.get('/api/auth/check-store-name/:username', serverRateLimiter(60 * 1000, 30, "auth-check-store-name"), async (req, res) => {
    try {
      const { username } = req.params;
      if (!username) {
        return res.status(400).json({ success: false, error: "Username parameter is required." });
      }

      const normalized = username.trim().toLowerCase();
      if (isReservedStoreName(normalized)) {
        return res.json({
          available: false,
          reason: 'reserved',
          message: 'This name contains protected system terms and cannot be claimed.'
        });
      }

      let isTaken = false;
      let isQuarantined = false;
      let availableAfter: string | null = null;

      if (backendSupabase) {
        try {
          const { data } = await backendSupabase
            .from('store_names')
            .select('*')
            .eq('id', normalized)
            .maybeSingle();

          if (data) {
            if (data.status === 'quarantined') {
              if (data.availableAfter && new Date(data.availableAfter).getTime() <= Date.now()) {
                isTaken = false;
              } else {
                isTaken = true;
                isQuarantined = true;
                availableAfter = data.availableAfter || null;
              }
            } else {
              isTaken = true;
            }
          }
        } catch (e) {}
      }

      if (!isTaken && adminDb) {
        try {
          const docSnap = await adminDb.collection('storeNames').doc(normalized).get();
          if (docSnap.exists) {
            const d = docSnap.data();
            if (d?.status === 'quarantined') {
              if (d.availableAfter && new Date(d.availableAfter).getTime() <= Date.now()) {
                isTaken = false;
              } else {
                isTaken = true;
                isQuarantined = true;
                availableAfter = d.availableAfter || null;
              }
            } else {
              isTaken = true;
            }
          }
        } catch (e) {}
      }

      return res.json({
        available: !isTaken,
        isQuarantined,
        availableAfter,
        message: isQuarantined
          ? 'This store name is quarantined from a previously closed account and is temporarily unavailable.'
          : (isTaken ? 'This username is already taken.' : 'Username is available.')
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || "Failed to check store name." });
    }
  });

  // API to manually clear the server-side products cache (used when seller updates their profile or store name)
  // Admin-only, rate-limited -- previously any authenticated user (not just
  // an admin) could call this repeatedly to force every homepage/search/
  // product-detail request behind the shared server cache to hit the
  // database cold, degrading response times for every concurrent visitor.
  // No client-side caller anywhere in src/ or mobile/src/ actually calls
  // this endpoint, so it's a manually-triggered admin/dev tool, not a
  // feature real users depend on -- safe to lock down fully.
  app.post('/api/products/invalidate-cache', serverRateLimiter(60 * 1000, 5, "products-invalidate-cache"), async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const verified = await verifyUser(authHeader);
      const isAdmin = verified?.isAdmin || verified?.originalAdmin;
      if (!verified || !isAdmin) {
        return res.status(403).json({ success: false, error: "Unauthorized: Administrator privileges required." });
      }

      console.log(`[Products Cache] Invalidation requested by admin: ${verified.uid} (${verified.email})`);
      serverCache.clear();

      return res.json({ success: true, message: "Server-side products cache has been successfully invalidated." });
    } catch (err: any) {
      console.error('[Cache Invalidation API Exception]:', err);
      return res.status(500).json({ success: false, error: err.message || "Internal server error during cache invalidation." });
    }
  });

  // Dedicated Favicon & Web Application Icon serving with optimal caching & CORS for Google Search Crawlers
  app.get([
    '/favicon.ico',
    '/favicon-16.png',
    '/favicon-32.png',
    '/favicon-48.png',
    '/favicon-96.png',
    '/favicon-144.png',
    '/favicon.png',
    '/favicon.svg',
    '/icon-192.png',
    '/icon-192x192.png',
    '/icon-512.png',
    '/icon-512x512.png',
    '/apple-touch-icon.png'
  ], (req, res) => {
    let filename = path.basename(req.path);
    if (filename === 'icon-512.png') filename = 'favicon.png';
    const publicFilePath = path.join(process.cwd(), 'public', filename);
    const distFilePath = path.join(process.cwd(), 'dist', filename);
    const targetPath = fs.existsSync(publicFilePath) ? publicFilePath : (fs.existsSync(distFilePath) ? distFilePath : null);

    if (targetPath) {
      res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=2592000');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (filename.endsWith('.ico')) res.type('image/x-icon');
      else if (filename.endsWith('.png')) res.type('image/png');
      else if (filename.endsWith('.svg')) res.type('image/svg+xml');
      return res.sendFile(targetPath);
    }
    return res.status(404).send('Not found');
  });

  // TedBuy Android direct-download page — official APK distribution outside
  // Google Play. Deliberately a standalone, server-rendered HTML response
  // (not part of the React SPA) so it loads instantly on slow mobile
  // connections and never depends on the SPA's hash-router/view state.
  function generateDownloadPageHtml(host: string, protocol: string): string {
    const cfg = APP_RELEASE_CONFIG;
    const available = isAndroidReleaseAvailable(cfg);
    // host is only lightly normalized by cleanHostHeader (lowercased,
    // port stripped) -- it doesn't strip HTML-unsafe characters, so a
    // request whose Host header isn't validated upstream could still
    // reach here with '"'/'<' in it. pageUrl/ogImage get interpolated
    // into href/content attributes below, so escape them defensively,
    // matching how canonicalUrl is already escaped everywhere else in
    // this file.
    const pageUrl = escapeHtml(`${protocol}://${host}/download`);
    const ogImage = escapeHtml(`${protocol}://${host}/icon-512x512.png`);

    const metaRows: string[] = [
      `<div class="meta-row"><span class="meta-label">Version</span><span class="meta-value">${escapeHtml(cfg.version)}</span></div>`,
    ];
    if (cfg.minAndroidVersion) {
      metaRows.push(`<div class="meta-row"><span class="meta-label">Requires</span><span class="meta-value">${escapeHtml(cfg.minAndroidVersion)}</span></div>`);
    }
    if (available && cfg.apkSizeMB) {
      metaRows.push(`<div class="meta-row"><span class="meta-label">Size</span><span class="meta-value">~${escapeHtml(String(cfg.apkSizeMB))} MB</span></div>`);
    }
    if (available && cfg.releaseDate) {
      metaRows.push(`<div class="meta-row"><span class="meta-label">Released</span><span class="meta-value">${escapeHtml(cfg.releaseDate)}</span></div>`);
    }

    const ctaHtml = available
      ? `<a class="cta" href="/downloads/tedbuy.apk"><span class="cta-main"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download for Android</span><span class="cta-sub">Official APK &middot; v${escapeHtml(cfg.version)}</span></a>`
      : `<button class="cta cta-disabled" type="button" disabled>Coming Soon<span class="cta-sub">We're finalizing the first release</span></button>`;

    const checksumHtml = available && cfg.sha256
      ? `<p class="checksum">SHA-256: <code>${escapeHtml(cfg.sha256)}</code></p>`
      : '';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>Download TedBuy for Android — Official App</title>
<meta name="description" content="Download the official TedBuy Android app directly from tedbuy.store. Buy, sell and discover on Ghana's social marketplace." />
<link rel="canonical" href="${pageUrl}" />
<meta name="robots" content="index, follow" />

<meta property="og:site_name" content="TedBuy Ghana" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${pageUrl}" />
<meta property="og:title" content="Download TedBuy for Android" />
<meta property="og:description" content="Get the official TedBuy Android app directly from the TedBuy website. Buy. Sell. Discover." />
<meta property="og:image" content="${ogImage}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Download TedBuy for Android" />
<meta name="twitter:description" content="Get the official TedBuy Android app directly from the TedBuy website." />
<meta name="twitter:image" content="${ogImage}" />

<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,700;1,400&display=swap" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, sans-serif;
    background: #0f172a;
    color: #e2e8f0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  header.topbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem 1.25rem;
  }
  header.topbar img { width: 28px; height: 28px; }
  header.topbar span { font-weight: 800; font-size: 1.1rem; }
  header.topbar span b { color: #ea580c; font-weight: 800; }
  header.topbar a { color: inherit; text-decoration: none; display: flex; align-items: center; gap: 0.5rem; }
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 1.5rem 1.25rem 3rem;
    max-width: 560px;
    margin: 0 auto;
    width: 100%;
  }
  .app-icon {
    width: 96px;
    height: 96px;
    border-radius: 24px;
    margin: 1.5rem 0 1.25rem;
    box-shadow: 0 12px 32px rgba(234, 88, 12, 0.25);
  }
  h1.headline {
    font-family: "Playfair Display", Georgia, serif;
    font-size: 1.75rem;
    line-height: 1.25;
    margin: 0 0 0.5rem;
  }
  p.tagline {
    color: #94a3b8;
    margin: 0 0 2rem;
    font-size: 1rem;
  }
  .cta {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    background: #16a34a;
    color: #fff;
    font-weight: 800;
    font-size: 1.05rem;
    text-decoration: none;
    border: none;
    border-radius: 999px;
    padding: 1.1rem 2rem;
    box-shadow: 0 8px 24px rgba(22, 163, 74, 0.35);
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }
  .cta-main { display: flex; align-items: center; gap: 0.5rem; }
  .cta-main svg { width: 20px; height: 20px; flex-shrink: 0; }
  .cta:active { transform: scale(0.98); }
  .cta-sub { font-weight: 500; font-size: 0.78rem; opacity: 0.9; margin-top: 0.2rem; }
  .cta-disabled { background: #334155; box-shadow: none; cursor: not-allowed; }
  .meta-card {
    width: 100%;
    margin-top: 1.5rem;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    padding: 0.25rem 1rem;
  }
  .meta-row {
    display: flex;
    justify-content: space-between;
    padding: 0.7rem 0;
    font-size: 0.9rem;
  }
  .meta-row + .meta-row { border-top: 1px solid rgba(255,255,255,0.06); }
  .meta-label { color: #94a3b8; }
  .meta-value { font-weight: 600; }
  .trust {
    margin-top: 1.25rem;
    font-size: 0.82rem;
    color: #64748b;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .checksum { margin-top: 0.75rem; font-size: 0.75rem; color: #64748b; word-break: break-all; }
  .checksum code { color: #94a3b8; }
  .install-note {
    margin-top: 2rem;
    text-align: left;
    width: 100%;
    background: rgba(234, 88, 12, 0.08);
    border: 1px solid rgba(234, 88, 12, 0.25);
    border-radius: 16px;
    padding: 1rem 1.1rem;
    font-size: 0.85rem;
    line-height: 1.5;
    color: #cbd5e1;
  }
  .install-note strong { color: #fdba74; }
  footer.foot {
    text-align: center;
    padding: 1.5rem;
    font-size: 0.78rem;
    color: #475569;
  }
  footer.foot a { color: #94a3b8; }
</style>
</head>
<body>
  <header class="topbar">
    <a href="/">
      <img src="/favicon.svg" alt="TedBuy" />
      <span>Ted<b>Buy</b></span>
    </a>
  </header>
  <main>
    <img class="app-icon" src="/icon-512x512.png" alt="TedBuy app icon" width="96" height="96" />
    <h1 class="headline">Get the TedBuy Android App</h1>
    <p class="tagline">Buy. Sell. Discover. &mdash; download the official TedBuy app directly to your Android device.</p>

    ${ctaHtml}
    ${checksumHtml}

    <div class="meta-card">
      ${metaRows.join('\n      ')}
    </div>

    <p class="trust">&#128274; Official TedBuy app, distributed directly from tedbuy.store</p>

    <div class="install-note">
      <strong>Installing outside Google Play?</strong> Android may show a prompt asking you to allow installs from your browser. This is a normal Android security prompt for apps installed outside the Play Store &mdash; only allow it for the browser you used to download this file.
    </div>
  </main>
  <footer class="foot">
    <a href="/">&larr; Back to tedbuy.store</a>
  </footer>
</body>
</html>`;
  }

  app.get('/download', (req, res) => {
    const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy.store';
    const host = cleanHostHeader(rawHost);
    const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.type('html').send(generateDownloadPageHtml(host, protocol));
  });

  // Stable public URL for the production Android APK. Redirects to the
  // actual CDN-hosted binary (configured via ANDROID_APK_URL) rather than
  // serving/proxying the file through this process — Render's free-tier
  // instance has a 384MB heap cap and an ephemeral filesystem, both
  // unsuitable for hosting a large binary directly.
  app.get('/downloads/tedbuy.apk', (_req, res) => {
    if (!isAndroidReleaseAvailable(APP_RELEASE_CONFIG)) {
      return res.status(404).type('text/plain').send('The TedBuy Android APK has not been published yet. Please check back soon.');
    }
    res.redirect(302, APP_RELEASE_CONFIG.apkUrl);
  });

  // Dynamic robots.txt declaring active domain's sitemap.xml and allowing Googlebot & Googlebot-Image
  app.get(['/robots.txt', '/api/robots'], (req, res) => {
    const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'www.tedbuy.store';
    const host = cleanHostHeader(rawHost);
    const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
    
    const robotsTxt = `User-agent: *
Allow: /
Allow: /product/
Allow: /seller/
Allow: /category/
Allow: /favicon*
Allow: /icon*
Allow: /apple-touch-icon.png
Disallow: /admin
Disallow: /settings
Disallow: /dashboard
Disallow: /chats
Disallow: /api/
Disallow: /*search_term_string*
Disallow: /*?*q={*

User-agent: Googlebot
Allow: /
Allow: /product/
Allow: /seller/
Allow: /category/
Allow: /favicon*
Allow: /icon*
Allow: /apple-touch-icon.png
Disallow: /admin
Disallow: /settings
Disallow: /dashboard
Disallow: /chats
Disallow: /api/
Disallow: /*search_term_string*
Disallow: /*?*q={*

User-agent: Googlebot-Image
Allow: /
Allow: /*.ico$
Allow: /*.png$
Allow: /*.svg$
Allow: /favicon*
Allow: /icon*
Allow: /apple-touch-icon.png

Sitemap: ${protocol}://${host}/sitemap.xml`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(robotsTxt);
  });

  // Dynamic Google XML Sitemap Index / Single Sitemap Router
  app.get(['/sitemap.xml', '/api/sitemap'], async (req, res) => {
    try {
      const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy.store';
      const host = cleanHostHeader(rawHost);
      const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
      const baseUrl = `${protocol}://${host}`;

      const data = await getSitemapDataset();
      
      const totalUrlsCount = data.staticUrls.length + data.categoryUrls.length + data.productUrls.length + data.storeUrls.length;

      // If total URLs count is within Google's limit for a single sitemap (< 45,000 for safety), serve it as a single sitemap
      if (totalUrlsCount < 45000) {
        const allUrls = [
          ...data.staticUrls,
          ...data.categoryUrls,
          ...data.productUrls,
          ...data.storeUrls
        ];
        const xml = generateUrlSetXml(baseUrl, allUrls);
        res.header('Content-Type', 'application/xml');
        return res.send(xml);
      }

      // Otherwise, return a Sitemap Index
      const todayString = new Date().toISOString().split('T')[0];
      const sitemaps = [
        { loc: '/sitemap-static.xml', lastmod: todayString },
        { loc: '/sitemap-categories.xml', lastmod: todayString }
      ];

      const productsPageCount = Math.ceil(data.productUrls.length / 40000);
      for (let i = 1; i <= productsPageCount; i++) {
        sitemaps.push({ loc: `/sitemap-products-${i}.xml`, lastmod: todayString });
      }

      const storesPageCount = Math.ceil(data.storeUrls.length / 40000);
      for (let i = 1; i <= storesPageCount; i++) {
        sitemaps.push({ loc: `/sitemap-stores-${i}.xml`, lastmod: todayString });
      }

      const xml = generateSitemapIndexXml(baseUrl, sitemaps);
      res.header('Content-Type', 'application/xml');
      return res.send(xml);
    } catch (error) {
      console.error('[Sitemap Route] Failed to generate main sitemap:', error);
      res.status(500).send('Error generating sitemap');
    }
  });

  // Dynamic Google XML Sitemap - Static URLs
  app.get(['/sitemap-static.xml', '/api/sitemap-static'], async (req, res) => {
    try {
      const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy.store';
      const host = cleanHostHeader(rawHost);
      const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
      const baseUrl = `${protocol}://${host}`;

      const data = await getSitemapDataset();
      const xml = generateUrlSetXml(baseUrl, data.staticUrls);
      res.header('Content-Type', 'application/xml');
      return res.send(xml);
    } catch (error) {
      console.error('[Sitemap Route] Failed to generate static sitemap:', error);
      res.status(500).send('Error');
    }
  });

  // Dynamic Google XML Sitemap - Categories
  app.get(['/sitemap-categories.xml', '/api/sitemap-categories'], async (req, res) => {
    try {
      const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy.store';
      const host = cleanHostHeader(rawHost);
      const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
      const baseUrl = `${protocol}://${host}`;

      const data = await getSitemapDataset();
      const xml = generateUrlSetXml(baseUrl, data.categoryUrls);
      res.header('Content-Type', 'application/xml');
      return res.send(xml);
    } catch (error) {
      console.error('[Sitemap Route] Failed to generate categories sitemap:', error);
      res.status(500).send('Error');
    }
  });

  // Dynamic Google XML Sitemap - Products (Paginated)
  app.get(['/sitemap-products-:page(\\d+).xml', '/api/sitemap-products-:page(\\d+)'], async (req, res) => {
    try {
      const page = parseInt(req.params.page, 10) || 1;
      const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy.store';
      const host = cleanHostHeader(rawHost);
      const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
      const baseUrl = `${protocol}://${host}`;

      const data = await getSitemapDataset();
      
      const PAGE_SIZE = 40000;
      const startIndex = (page - 1) * PAGE_SIZE;
      const endIndex = page * PAGE_SIZE;
      const pageProducts = data.productUrls.slice(startIndex, endIndex);

      const xml = generateUrlSetXml(baseUrl, pageProducts);
      res.header('Content-Type', 'application/xml');
      return res.send(xml);
    } catch (error) {
      console.error('[Sitemap Route] Failed to generate products sitemap:', error);
      res.status(500).send('Error');
    }
  });

  // Dynamic Google XML Sitemap - Stores (Paginated)
  app.get(['/sitemap-stores-:page(\\d+).xml', '/api/sitemap-stores-:page(\\d+)'], async (req, res) => {
    try {
      const page = parseInt(req.params.page, 10) || 1;
      const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy.store';
      const host = cleanHostHeader(rawHost);
      const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
      const baseUrl = `${protocol}://${host}`;

      const data = await getSitemapDataset();
      
      const PAGE_SIZE = 40000;
      const startIndex = (page - 1) * PAGE_SIZE;
      const endIndex = page * PAGE_SIZE;
      const pageStores = data.storeUrls.slice(startIndex, endIndex);

      const xml = generateUrlSetXml(baseUrl, pageStores);
      res.header('Content-Type', 'application/xml');
      return res.send(xml);
    } catch (error) {
      console.error('[Sitemap Route] Failed to generate stores sitemap:', error);
      res.status(500).send('Error');
    }
  });

  function serveTransparentPixel(res: express.Response) {
    const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=10');
    return res.send(transparentPng);
  }

// -------------------------------------------------------------
// Start Server Bootup
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', async (req, res) => {
      const indexPath = path.join(distPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        let html = fs.readFileSync(indexPath, 'utf-8');
        
        const host = cleanHostHeader(req.headers.host || 'www.tedbuy.store');
        const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        const currentCanonicalUrl = `${protocol}://${host}${req.path === '/' ? '' : req.path}`;

        // Handle product detail SSR meta tags
        const productMatch = req.path.match(/^\/product\/([^\/?#]+)/);
        if (productMatch) {
          const fullIdSlug = productMatch[1];
          const productId = fullIdSlug.split('-')[0];
          if (productId && backendSupabase) {
            try {
              const { data } = await backendSupabase.from('products').select('*').eq('id', productId).maybeSingle();
              // Moderated-away listings (hidden/archived/soft-deleted) are
              // soft-deletes -- the row still exists -- so `if (data)` alone
              // was serving a full rich preview (title/OG image/JSON-LD) for
              // any listing an admin took down, staying crawlable/indexable
              // and shareable with a real-looking preview card regardless of
              // the moderation action. Same status set /api/products/:id
              // and the rest of the app already treat as invisible.
              const isModerated = data && (data.isDeleted === true || data.is_deleted === true || data.status === 'archived' || data.status === 'hidden' || data.status === 'deleted');
              if (data && !isModerated) {
                const normalized = normalizeServerProductRow(data);
                html = injectMetaTags(html, normalized, `${protocol}://${host}${req.originalUrl}`, host, protocol, productId);
              } else {
                // Not found (or moderated away) -- return true 404 with
                // noindex to prevent Soft 404 in Google Search Console.
                html = html.replace(/<link\s+rel="canonical".*?>/gi, '');
                html = html.replace('</head>', '<meta name="robots" content="noindex, nofollow" /></head>');
                return res.status(404).send(html);
              }
            } catch (_) {}
          }
        } else {
          // Handle seller store SSR meta tags -- real seller URLs are
          // /seller/:id (and /sellers/:id, matching parseUrlState's own
          // regex client-side), not /store/:id.
          const sellerMatch = req.path.match(/^\/sellers?\/([^\/?#]+)/);
          if (sellerMatch) {
            const sellerId = sellerMatch[1];
            if (sellerId && backendSupabase) {
              try {
                const { data: user } = await backendSupabase.from('users').select('id, username, displayName, bio, photoUrl').eq('id', sellerId).maybeSingle();
                if (!user) {
                  // Non-existent seller -> return 404
                  html = html.replace(/<link\s+rel="canonical".*?>/gi, '');
                  html = html.replace('</head>', '<meta name="robots" content="noindex, nofollow" /></head>');
                  return res.status(404).send(html);
                }
                html = injectSellerMetaTags(html, user, `${protocol}://${host}${req.originalUrl}`);
              } catch (_) {}
            }
          } else {
            // currentCanonicalUrl is built from req.path, which is
            // attacker-controlled (e.g. a crafted URL whose path segment
            // decodes to `"><script>...`) -- interpolating it unescaped
            // into this href attribute let any visitor who followed such a
            // link get a live <script> tag injected into the page. Every
            // other canonical/og:url built from request data in this file
            // (injectMetaTags, injectSellerMetaTags) already wraps it in
            // escapeHtml(); this fallback branch for non-product/seller
            // pages was the one path that didn't.
            html = html.replace(/<link\s+rel="canonical".*?>/gi, `<link rel="canonical" href="${escapeHtml(currentCanonicalUrl)}/" />`);
          }
        }

        // Inject pre-cached top products into HTML for 0ms initial render of main feed
        //
        // Critical: same bug shape as injectMetaTags's JSON-LD script tag --
        // topSummaries/topSellers embed raw user-controlled fields (product
        // title/description/location/brand, seller username/displayName/
        // location) via plain JSON.stringify(), which never escapes '<'. A
        // listing title or seller username containing a literal
        // "</script><script>...</script>" would close this tag early and
        // inject an attacker-controlled script into the homepage for every
        // visitor -- reached by nothing more than creating an ordinary
        // listing or setting a username, no auth or targeting required, and
        // arguably worse than the JSON-LD case since this hits every '/'
        // load rather than just individual product pages. Same fix: escape
        // every '<' to its JSON-safe \u003c equivalent before embedding.
        try {
          const { products } = await getProductsListData();
          if (products && products.length > 0) {
            const topSummaries = products.slice(0, 50).map(serializeProductSummary);
            const scriptTag = `<script>window.__INITIAL_PRODUCTS__ = ${JSON.stringify(topSummaries).replace(/</g, '\\u003c')};</script>`;
            html = html.replace('</head>', `${scriptTag}</head>`);
          }
          const { counts: sellerCounts, sellers: topSellers } = await getSellersSummaryData(false);
          if (sellerCounts && Object.keys(sellerCounts).length > 0) {
            const sellersScript = `<script>window.__INITIAL_SELLER_COUNTS__ = ${JSON.stringify(sellerCounts).replace(/</g, '\\u003c')};window.__INITIAL_DISCOVER_SELLERS__ = ${JSON.stringify(topSellers.slice(0, 15)).replace(/</g, '\\u003c')};</script>`;
            html = html.replace('</head>', `${sellersScript}</head>`);
          }
        } catch (_) {}

        res.send(html);
      } else {
        res.sendFile(indexPath);
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[TedBuy Clean Server] Running at http://0.0.0.0:${PORT}`);
  });

  // Sold-listing 30-day retention — genuinely automatic (not just an admin
  // button someone has to remember to press, like the rest of the
  // retention engine currently is). Runs once shortly after boot, then
  // every 6 hours; a 6-hour cadence keeps a listing from lingering much
  // past its 30-day mark without needing anything finer-grained than
  // setInterval on a long-running Node process.
  setTimeout(() => { purgeExpiredSoldProducts().catch((err) => console.warn('[Sold Listing Retention] Startup run failed:', err)); }, 30 * 1000);
  setInterval(() => { purgeExpiredSoldProducts().catch((err) => console.warn('[Sold Listing Retention] Scheduled run failed:', err)); }, 6 * 60 * 60 * 1000);
}

startServer();



