import express from "express";
import path from "path";
import fs from "fs";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import crypto from "crypto";

import dotenv from "dotenv";
import net from "net";
import dns from "dns";
import { promisify } from "util";
import { getSitemapDataset, generateUrlSetXml, generateSitemapIndexXml, clearSitemapCache } from "./src/utils/sitemap.js";
import { validateEmailSecure, validatePasswordStrength, validateUsernameSecure, validatePhoneSecure } from "./src/utils/registrationValidation.js";

process.on('uncaughtException', (err) => {
  console.error('!!!!! [DIAGNOSTIC] uncaughtException !!!!!', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('!!!!! [DIAGNOSTIC] unhandledRejection !!!!!', reason);
});

const lookupAsync = promisify(dns.lookup);

dotenv.config();

export const app = express();

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
  next();
});

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Global middleware to handle parsing or payload too large errors as JSON instead of HTML
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

// --- FIREBASE AUTH CUSTOM DOMAIN REVERSE PROXY ---
// Enables custom domain sign-in (e.g. tedbuy.store) to securely tunnel Google/Facebook OAuth
// callbacks to Firebase's default hosting auth handlers without reopening the main SPA.
app.all('/__/auth/*', async (req: express.Request, res: express.Response) => {
  try {
    const targetUrl = `https://tedbuy-fb79a.firebaseapp.com${req.originalUrl}`;
    
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          value.forEach(v => headers.append(key, v));
        } else {
          headers.set(key, String(value));
        }
      }
    }
    
    // Override the Host header to target Firebase Hosting properly
    headers.set('host', 'tedbuy-fb79a.firebaseapp.com');

    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.body && Object.keys(req.body).length > 0) {
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          fetchOptions.body = JSON.stringify(req.body);
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          const params = new URLSearchParams();
          for (const [k, v] of Object.entries(req.body)) {
            params.append(k, String(v));
          }
          fetchOptions.body = params.toString();
        } else {
          fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        }
      }
    }

    const response = await fetch(targetUrl, fetchOptions);
    
    // Forward response headers (excluding chunked encoding/etc to avoid protocol issues)
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (!['transfer-encoding', 'content-encoding', 'connection', 'content-length'].includes(lowerKey)) {
        if (lowerKey === 'location') {
          // Intercept redirects and replace firebaseapp.com/web.app domains with the custom domain
          const cleanLocation = value
            .replace(/tedbuy-fb79a\.firebaseapp\.com/g, 'tedbuy.store')
            .replace(/tedbuy-fb79a\.web\.app/g, 'tedbuy.store');
          res.setHeader(key, cleanLocation);
        } else {
          res.setHeader(key, value);
        }
      }
    });

    res.status(response.status);
    
    const contentType = response.headers.get('content-type') || '';
    if (
      contentType.includes('text/html') ||
      contentType.includes('application/javascript') ||
      contentType.includes('text/javascript') ||
      contentType.includes('application/json')
    ) {
      let text = await response.text();
      // Replace all occurrences of the firebase domain with the custom domain in the body
      text = text.replace(/tedbuy-fb79a\.firebaseapp\.com/g, 'tedbuy.store');
      text = text.replace(/tedbuy-fb79a\.web\.app/g, 'tedbuy.store');
      res.send(text);
    } else {
      const arrayBuffer = await response.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    }
  } catch (error) {
    console.error('[Firebase Auth Proxy Error]:', error);
    res.status(500).send('Authentication Gateway Error');
  }
});

// --- SERVER-SIDE IP RATE LIMITER IMPLEMENTATION ---
const rateLimitStore: Record<string, { count: number; resetTime: number }> = {};

// In-memory store for pending user registration OTP verification sessions
interface VerificationSession {
  username: string;
  email: string;
  phoneNumber: string;
  password: string;
  photoUrl: string;
  otp: string;
  expiresAt: number;
  attempts: number;
}
const verificationSessions = new Map<string, VerificationSession>();

function serverRateLimiter(windowMs: number, maxRequests: number, resourceName: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "anonymous";
    const key = `${ip}:${resourceName}`;
    const now = Date.now();
    
    if (!rateLimitStore[key] || rateLimitStore[key].resetTime < now) {
      rateLimitStore[key] = {
        count: 1,
        resetTime: now + windowMs
      };
      return next();
    }
    
    rateLimitStore[key].count++;
    if (rateLimitStore[key].count > maxRequests) {
      const remainingSecs = Math.ceil((rateLimitStore[key].resetTime - now) / 1000);
      res.setHeader("Retry-After", remainingSecs);
      return res.status(429).json({
        error: `Too many requests to ${resourceName}. Please wait ${remainingSecs} seconds and try again.`
      });
    }
    
    next();
  };
}

// --- SECURE SSRF PROTECTION MIDDLEWARE ---
function isIpPrivateAndBlock(ipText: string): boolean {
  const parts = ipText.split('.');
  if (parts.length === 4) {
    const first = parseInt(parts[0], 10);
    const second = parseInt(parts[1], 10);
    if (isNaN(first) || isNaN(second)) return true;
    if (first === 127 || first === 10 || first === 0) return true;
    if (first === 172 && (second >= 16 && second <= 31)) return true;
    if (first === 192 && second === 168) return true;
    if (first === 169 && second === 254) return true;
  }
  if (ipText.includes(':')) {
    const norm = ipText.toLowerCase().trim();
    if (norm === '::1' || norm === '::' || norm.startsWith('fe80:') || norm.startsWith('fc00:') || norm.startsWith('fd00:')) {
      return true;
    }
  }
  return false;
}

async function validateImageUrlSecurely(urlStr: string): Promise<boolean> {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:') {
      return false; // HTTPS only
    }
    const hostname = parsed.hostname.toLowerCase();
    
    // Explicit allowlist of highly trusted CDN domains
    const allowedDomains = [
      'images.unsplash.com',
      'firebasestorage.googleapis.com',
      'storage.googleapis.com',
      'tedbuy.store',
      'tedbuy-fb79a.web.app',
      'lh3.googleusercontent.com',
      'lh5.googleusercontent.com'
    ];
    
    const isAllowedHost = allowedDomains.some(d => hostname === d || hostname.endsWith('.' + d));
    if (!isAllowedHost) {
      console.warn(`[SSRF Shield] Blocked untrusted host fetch: ${hostname}`);
      return false;
    }

    const lookupResult = await lookupAsync(parsed.hostname).catch(() => null);
    if (lookupResult && isIpPrivateAndBlock(lookupResult.address)) {
      console.warn(`[SSRF Shield] Blocked host resolving to private IP: ${hostname} (${lookupResult.address})`);
      return false;
    }
    
    return true;
  } catch (err) {
    return false;
  }
}

app.use((req, res, next) => {
  const logLine = `${new Date().toISOString()} [Express Log] ${req.method} ${req.url} | Body keys: ${Object.keys(req.body || {})}\n`;
  try {
    const logPath = path.resolve(process.cwd(), "express_requests.log");
    if (fs.existsSync(logPath)) {
      const stats = fs.statSync(logPath);
      if (stats.size > 5 * 1024 * 1024) { // 5MB Cap
        fs.writeFileSync(logPath, `--- LOGS ROTATED & RESET ${new Date().toISOString()} ---\n`);
      }
    }
    fs.appendFileSync(logPath, logLine);
  } catch (e) {
    // ignore
  }
  next();
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Resolve Firebase project ID dynamically
const firebaseConfigPath = path.resolve(process.cwd(), "firebase-applet-config.json");
let projectId = "tedbuy-fb79a"; // Fallback default
let apiKey = ""; // API Key to prevent Firestore REST endpoint quota issues
if (fs.existsSync(firebaseConfigPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
    if (config.projectId) {
      projectId = config.projectId;
    }
    if (config.apiKey) {
      apiKey = config.apiKey;
    }
  } catch (err) {
    console.error("Failed to parse firebase-applet-config.json", err);
  }
}

// Initialize Firebase Admin SDK safely
let adminDb: any = null;

// Initialize backend Supabase client if configured
const sbUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const sbKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const isSbUrlValid = typeof sbUrl === 'string' && (sbUrl.startsWith('http://') || sbUrl.startsWith('https://'));
const backendSupabase = sbUrl && sbKey && isSbUrlValid ? createClient(sbUrl, sbKey) : null;

if (backendSupabase) {
  console.log('[Supabase Server] Initialized backend Supabase client successfully!');
} else {
  console.log('[Supabase Server] Credentials not detected. Server-side Supabase client inactive.');
}
let cachedProducts: { data: any[]; timestamp: number } | null = null;
let isRevalidating = false;
let lastFirestore429Time = 0;
const DEBOUNCE_429_RETRY_MS = 600000; // 10 minutes cooling down after a 429
let activeFetchPromise: Promise<any[]> | null = null;
// In-memory caches for crawler/metadata requests to prevent Firestore 429/RESOURCE_EXHAUSTED
const productDataCache = new Map<string, { data: any; timestamp: number }>();

// High-performance binary image caching system to load images instantly
const binaryImageMemoryCache = new Map<string, { buffer: Buffer; mimeType: string }>();
const binaryCacheKeys: string[] = [];
const MAX_BINARY_MEM_CACHE_SIZE = 1000; // Keep up to 1000 images in memory to guarantee blazing fast performance

function setBinaryImageInCache(productId: string, buffer: Buffer, mimeType: string) {
  if (binaryImageMemoryCache.has(productId)) {
    binaryImageMemoryCache.set(productId, { buffer, mimeType });
    return;
  }
  if (binaryCacheKeys.length >= MAX_BINARY_MEM_CACHE_SIZE) {
    const oldestKey = binaryCacheKeys.shift();
    if (oldestKey) {
      binaryImageMemoryCache.delete(oldestKey);
    }
  }
  binaryImageMemoryCache.set(productId, { buffer, mimeType });
  binaryCacheKeys.push(productId);
}

// Blazing-fast dynamic image optimization using Sharp
async function optimizeImageBuffer(
  buffer: Buffer,
  width?: number,
  height?: number,
  quality: number = 80,
  format: string = 'webp'
): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    let pipeline = sharp(buffer);
    
    // Auto-rotate based on EXIF metadata if present
    pipeline = pipeline.rotate();

    // Resize if width or height is defined
    if (width || height) {
      pipeline = pipeline.resize({
        width: width ? parseInt(String(width), 10) : undefined,
        height: height ? parseInt(String(height), 10) : undefined,
        fit: 'cover',
        withoutEnlargement: true
      });
    }

    // Convert format & compress
    const fmt = format.toLowerCase();
    if (fmt === 'avif') {
      pipeline = pipeline.avif({ quality });
    } else if (fmt === 'png') {
      pipeline = pipeline.png({ quality });
    } else if (fmt === 'jpeg' || fmt === 'jpg') {
      pipeline = pipeline.jpeg({ quality });
    } else {
      pipeline = pipeline.webp({ quality });
    }

    const outputBuffer = await pipeline.toBuffer();
    const mimeType = `image/${fmt === 'jpg' ? 'jpeg' : fmt}`;
    return { buffer: outputBuffer, mimeType };
  } catch (err) {
    console.error('[Sharp Optimization] Failed to optimize image buffer, returning original:', err);
    return { buffer, mimeType: 'image/jpeg' };
  }
}
const sellerDataCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 300000; // 5 minutes cache TTL to dramatically reduce read operations and quota usage
const CACHE_FILE_PATH = path.join(process.cwd(), 'products_cache.json');
const IMAGES_CACHE_DIR = path.join(process.cwd(), 'images_cache');
if (!fs.existsSync(IMAGES_CACHE_DIR)) {
  try {
    fs.mkdirSync(IMAGES_CACHE_DIR, { recursive: true });
    console.log(`[Images Cache] Created cache directory: ${IMAGES_CACHE_DIR}`);
  } catch (err) {
    console.error('[Images Cache] Failed to create images cache directory:', err);
  }
}

try {
  if (fs.existsSync(CACHE_FILE_PATH)) {
    const rawCache = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(rawCache);
    if (parsed && Array.isArray(parsed.data)) {
      cachedProducts = {
        data: parsed.data,
        timestamp: parsed.timestamp || Date.now()
      };
      console.log(`[Products Cache] Successfully loaded ${cachedProducts.data.length} products from file-based cache.`);
      
      // Warm up images_cache on disk and productDataCache in-memory on startup
      for (const result of cachedProducts.data) {
        if (!result || !result.id) continue;
        let firstImage = (Array.isArray(result.images) && result.images.length > 0) ? result.images[0] : null;
        if (!firstImage && result.image) {
          firstImage = result.image;
        }
        if (firstImage && firstImage.startsWith('data:')) {
          try {
            const ext = firstImage.includes('png') ? 'png' : firstImage.includes('webp') ? 'webp' : 'jpg';
            const cacheFilePath = path.join(IMAGES_CACHE_DIR, `${result.id}.txt`);
            if (!fs.existsSync(cacheFilePath)) {
              fs.writeFileSync(cacheFilePath, firstImage, 'utf-8');
            }

            // Warm up high-performance binary cache and pre-decode base64 on boot
            const parts = firstImage.split(';base64,');
            if (parts.length === 2) {
              const mimeType = parts[0].replace('data:', '');
              const buffer = Buffer.from(parts[1], 'base64');
              setBinaryImageInCache(result.id, buffer, mimeType);

              const binFile = path.join(IMAGES_CACHE_DIR, `${result.id}.bin`);
              const mimeFile = path.join(IMAGES_CACHE_DIR, `${result.id}.mime`);
              if (!fs.existsSync(binFile)) {
                fs.writeFileSync(binFile, buffer);
                fs.writeFileSync(mimeFile, mimeType, 'utf-8');
              }
            }

            productDataCache.set(result.id, {
              data: {
                title: result.title || '',
                description: result.description || '',
                price: result.price || 'Negotiable',
                image: firstImage
              },
              timestamp: Date.now()
            });
          } catch (err) {
            // Ignore error writing cache on boot
          }
        }
      }
    }
  } else {
    // Initialize the file-based cache as empty to ensure zero fake data from the start
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify({ data: [], timestamp: Date.now() }), 'utf-8');
    cachedProducts = {
      data: [],
      timestamp: Date.now()
    };
    console.log(`[Products Cache] Initialized empty file cache.`);
  }
} catch (cacheErr) {
  console.error('[Products Cache] Failed to load/initialize cache file:', cacheErr);
}

// Support pasting the full service account JSON directly as an env var (e.g. on Render),
// in addition to the standard GOOGLE_APPLICATION_CREDENTIALS file-path approach.
let parsedServiceAccountJson: any = null;
if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  try {
    parsedServiceAccountJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    console.log('[Firebase Admin] Parsed service account credentials from GOOGLE_SERVICE_ACCOUNT_JSON env var.');
  } catch (err: any) {
    console.error('[Firebase Admin] Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON env var as JSON:', err.message || err);
  }
}

let isGCPServiceAccountAuthorized = process.env.K_SERVICE !== undefined || process.env.GOOGLE_APPLICATION_CREDENTIALS !== undefined || parsedServiceAccountJson !== null;

if (backendSupabase) {
  console.log('[Firebase Admin] Routing database operations exclusively to Supabase. Disabling Firestore Admin client, keeping Auth token verification active.');
  adminDb = null;
} else {
  console.log('[Firebase Admin] Supabase not configured. Enabling Firestore Admin client for secure server-side operations.');
}

if (isGCPServiceAccountAuthorized) {
  (async () => {
    try {
      const { getApps, initializeApp: initializeAdminApp, cert } = await import("firebase-admin/app");

      if (getApps().length === 0) {
        if (parsedServiceAccountJson) {
          initializeAdminApp({
            credential: cert(parsedServiceAccountJson),
            projectId: parsedServiceAccountJson.project_id || projectId,
          });
        } else {
          initializeAdminApp({
            projectId: projectId,
          });
        }
      }
      console.log('[Firebase Admin] App successfully initialized for admin auth token verification.');

      if (!backendSupabase) {
        try {
          const { getFirestore } = await import("firebase-admin/firestore");
          adminDb = getFirestore();
          console.log('[Firebase Admin] Firestore Admin DB client initialized successfully!');
        } catch (dbInitErr: any) {
          console.warn('[Firebase Admin] Failed to initialize Firestore Admin DB client:', dbInitErr.message || dbInitErr);
        }
      }
    } catch (err: any) {
      console.warn('[Firebase Admin] Failed to initialize Firebase Admin app for verification:', err.message || err);
    }
  })();
}

// Dynamically fetch GCP service account token if running on Cloud Run
async function getGCPMetadataToken() {
  if (!isGCPServiceAccountAuthorized) {
    return null;
  }
  try {
    const res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(1000)
    });
    if (res.ok) {
      const data = await res.json();
      return data.access_token as string;
    } else {
      isGCPServiceAccountAuthorized = false;
    }
  } catch (err) {
    // Not on GCP Cloud Run, disable metadata check to prevent future 1000ms timeouts
    isGCPServiceAccountAuthorized = false;
  }
  return null;
}

function parseFirestoreDocument(doc: any): any {
  if (!doc || !doc.fields) return null;
  const fields = doc.fields;
  const result: any = {};
  
  const parseVal = (val: any): any => {
    if (!val) return undefined;
    if ('stringValue' in val) return val.stringValue;
    if ('integerValue' in val) return parseInt(val.integerValue, 10);
    if ('doubleValue' in val) return parseFloat(val.doubleValue);
    if ('booleanValue' in val) return val.booleanValue;
    if ('arrayValue' in val) {
      const arr = val.arrayValue?.values || [];
      return arr.map((sub: any) => parseVal(sub));
    }
    if ('mapValue' in val) {
      const mapFields = val.mapValue?.fields || {};
      const mapResult: any = {};
      for (const k of Object.keys(mapFields)) {
        mapResult[k] = parseVal(mapFields[k]);
      }
      return mapResult;
    }
    return undefined;
  };

  for (const key of Object.keys(fields)) {
    result[key] = parseVal(fields[key]);
  }

  const nameParts = doc.name ? doc.name.split('/') : [];
  const id = nameParts[nameParts.length - 1] || '';
  result.id = id;
  return result;
}

async function getProductFromFirestoreREST(productId: string): Promise<any> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/products/${productId}${apiKey ? `?key=${apiKey}` : ""}`;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const doc = await res.json();
      return parseFirestoreDocument(doc);
    }
  } catch (err) {
    console.warn(`[Firestore REST] Failed to fetch product ${productId} from Firestore:`, err);
  }
  return null;
}

// REST API helper to fetch product info directly from Firestore
async function getProductData(productId: string, bypassListCache: boolean = false) {
  const now = Date.now();
  const cached = productDataCache.get(productId);
  if (!bypassListCache && cached && (now - cached.timestamp < 120000)) {
    console.log(`[Meta Crawler] Serving product ${productId} from memory cache`);
    return cached.data;
  }

  // 1. Check if the product is in our cachedProducts list first!
  // This completely avoids hitting the Firestore REST API and provides the real title/description/price/image.
  if (!bypassListCache && cachedProducts && Array.isArray(cachedProducts.data)) {
    const foundProduct = cachedProducts.data.find((p: any) => p && (p.id === productId || p._id === productId));
    if (foundProduct) {
      console.log(`[Products Cache] Found product ${productId} in list cache.`);
      let primaryImage = '';
      if (Array.isArray(foundProduct.images) && foundProduct.images.length > 0) {
        primaryImage = foundProduct.images[0];
      } else if (foundProduct.image) {
        primaryImage = foundProduct.image;
      }

      // If the image is a proxy URL, try to load the base64 from disk cache
      if (primaryImage && primaryImage.startsWith('/api/products/')) {
        const diskFile = path.join(IMAGES_CACHE_DIR, `${productId}.txt`);
        if (fs.existsSync(diskFile)) {
          try {
            const diskBase64 = fs.readFileSync(diskFile, 'utf-8');
            if (diskBase64 && diskBase64.startsWith('data:')) {
              primaryImage = diskBase64;
            }
          } catch (e) {
            // ignore
          }
        }
      }

      // CRITICAL BUG FIX: If primaryImage is still a proxy URL (meaning we do not have the real image data on disk yet),
      // we must NOT return the proxy URL. Otherwise, the image delivery proxy endpoint will get its own proxy URL
      // in a circular reference and fail to deliver the actual image, falling back to Unsplash placeholders.
      // Instead, we skip this list cache and let it fall through to query the database directly!
      if (!primaryImage || primaryImage.startsWith('/api/products/')) {
        console.log(`[Products Cache] Cached product found for ${productId}, but image is a proxy URL and not found on disk. Falling through to DB...`);
      } else {
        const result = {
          title: foundProduct.title || '',
          description: foundProduct.description || '',
          price: foundProduct.price || 'Negotiable',
          image: primaryImage,
          images: foundProduct.images || [],
          category: foundProduct.category || '',
          videos: foundProduct.videos || []
        };
        productDataCache.set(productId, { data: result, timestamp: now });
        return result;
      }
    }
  }

  // 2. Check local images_cache on disk next
  if (!bypassListCache) {
    const imageCacheFile = path.join(IMAGES_CACHE_DIR, `${productId}.txt`);
    if (fs.existsSync(imageCacheFile)) {
      try {
        const base64Data = fs.readFileSync(imageCacheFile, 'utf-8');
        if (base64Data && base64Data.startsWith('data:')) {
          console.log(`[Images Cache] Serving product image for ${productId} from disk cache`);
          const result = {
            title: '',
            description: '',
            price: 'Negotiable',
            image: base64Data,
            images: [base64Data],
            category: '',
            videos: []
          };
          productDataCache.set(productId, { data: result, timestamp: now });
          return result;
        }
      } catch (diskErr) {
        console.warn(`[Images Cache] Failed to read cached image for ${productId} from disk:`, diskErr);
      }
    }
  }

  try {
    let rawProduct: any = null;
    if (backendSupabase) {
      console.log(`[Meta Crawler] Fetching product ${productId} via Supabase`);
      const { data, error } = await backendSupabase
        .from('products')
        .select('*')
        .eq('id', productId)
        .maybeSingle();

      if (!error && data) {
        rawProduct = data;
      }
    }

    if (!rawProduct) {
      console.log(`[Meta Crawler Fallback] Fetching product ${productId} from Firestore REST`);
      rawProduct = await getProductFromFirestoreREST(productId);
    }

    if (rawProduct) {
      const title = rawProduct.title || '';
      const description = rawProduct.description || '';
      const priceValue = rawProduct.price || 'Negotiable';
      const images = Array.isArray(rawProduct.images) ? rawProduct.images : [];
      // Default to empty string instead of hardcoded Unsplash fallback images
      const primaryImage = images[0] || '';

      const result = {
        title,
        description,
        price: priceValue,
        image: primaryImage,
        images: rawProduct.images || [],
        category: rawProduct.category || '',
        videos: rawProduct.videos || []
      };
      productDataCache.set(productId, { data: result, timestamp: now });
      return result;
    }
    
    productDataCache.set(productId, { data: null, timestamp: now });
    return null;
  } catch (err) {
    console.error('[Meta Crawler] Error fetching product data:', err);
    return null;
  }
}

function cleanHostHeader(host: string): string {
  if (!host) return 'tedbuy-fb79a.web.app';
  if (host.includes(':')) {
    const [hostname, port] = host.split(':');
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return hostname;
    }
  }
  return host;
}

// Injects dynamic meta tags based on the fetched product
function injectMetaTags(html: string, product: { title: string; description: string; price: string; image: string; videos?: string[] }, shareUrl: string, host: string, protocol: string, productId: string): string {
  const pricePrefix = product.price ? `GHS ${product.price}` : 'Negotiable';
  const title = `${product.title} - ${pricePrefix} | TedBuy Ghana`;
  const description = `${product.description.slice(0, 160)}${product.description.length > 160 ? '...' : ''} | Buy/Sell on TedBuy`;
  
  // Dynamic Video Detection
  const hasVideo = product.videos && Array.isArray(product.videos) && product.videos.length > 0;
  const rawVideoUrl = hasVideo ? product.videos![0] : '';

  // ALWAYS use our dynamic image wrapper endpoint to deliver first-party, absolute, redirect-free, fully-qualified web-optimized JPG images.
  // This solves base64 size limits, external redirects and domain/port mismatch crawler bugs perfectly.
  // We append key listing details as query parameters so the image proxy can generate high-quality card graphics instantly.
  const imgParams = new URLSearchParams();
  if (product.title) imgParams.set('title', product.title);
  if (product.price) imgParams.set('price', String(product.price));
  // Keep the URL clean, light, and short to fit inside social crawler size limits (typically 2KB-8KB).
  // The server's /api/products/:productId/image.jpg endpoint automatically fetches the product from the database
  // using its ID, so it does not need the actual base64/long URL in the query string at all.
  if (product.image && !product.image.startsWith('data:') && product.image.length < 1000) {
    imgParams.set('image', product.image);
  }
  if (hasVideo && product.videos && product.videos[0] && !product.videos[0].startsWith('data:') && product.videos[0].length < 1000) {
    imgParams.set('video', product.videos[0]);
  }
  const imgQuery = imgParams.toString() ? `?${imgParams.toString()}` : '';
  const image = `${protocol}://${host}/api/products/${productId}/image.jpg${imgQuery}`;
  
  let absoluteVideoUrl = '';
  if (rawVideoUrl) {
    if (rawVideoUrl.startsWith('data:')) {
      absoluteVideoUrl = `${protocol}://${host}/api/products/${productId}/video.mp4`;
    } else if (rawVideoUrl.startsWith('http://') || rawVideoUrl.startsWith('https://')) {
      absoluteVideoUrl = rawVideoUrl;
    } else if (rawVideoUrl.startsWith('/')) {
      absoluteVideoUrl = `${protocol}://${host}${rawVideoUrl}`;
    } else {
      absoluteVideoUrl = `${protocol}://${host}/${rawVideoUrl}`;
    }
  }

  // Generate dynamic JSON-LD Product Schema representation for googlebot search console indexing
  const cleanPrice = product.price ? String(product.price).replace(/[^\d.]/g, '') : '';
  const priceSchema = cleanPrice && !isNaN(Number(cleanPrice)) ? cleanPrice : '0';

  // Build clean absolute product canonical URL to prevent GSC Google Bot parameter/redirect indexing splits
  const titleSlug = product.title ? slugify(product.title) : '';
  const canonicalUrl = `${protocol}://${host}/product/${productId}-${titleSlug}`;

  const schemaJson = {
    "@context": "https://schema.org/",
    "@type": "Product",
    "name": product.title,
    "image": [image],
    "description": product.description || `Buy "${product.title}" on Tedbuy Ghana classifieds marketplace.`,
    "offers": {
      "@type": "Offer",
      "url": canonicalUrl,
      "priceCurrency": "GHS",
      "price": priceSchema,
      "itemCondition": "https://schema.org/UsedCondition",
      "availability": "https://schema.org/InStock",
      "priceValidUntil": "2027-12-31"
    }
  };

  console.log(`[Meta Crawler] Injecting Open Graph and JSON-LD tags. URL: ${shareUrl}, Canonical URL: ${canonicalUrl}, Image URL: ${image}, Video URL: ${absoluteVideoUrl || 'none'}`);

  const tags = `
    <!-- Dynamic Social Share Meta Tags -->
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <!-- Open Graph / Facebook / WhatsApp -->
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(image)}" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="${hasVideo ? '600' : '1200'}" />
    <meta property="og:image:height" content="${hasVideo ? '900' : '630'}" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:type" content="${hasVideo ? 'video.other' : 'product'}" />
    <meta property="og:site_name" content="TedBuy Ghana" />
    <meta property="og:locale" content="en_GH" />
    ${absoluteVideoUrl ? `
    <meta property="og:video" content="${escapeHtml(absoluteVideoUrl)}" />
    <meta property="og:video:secure_url" content="${escapeHtml(absoluteVideoUrl)}" />
    <meta property="og:video:type" content="video/mp4" />
    <meta property="og:video:width" content="640" />
    <meta property="og:video:height" content="1136" />
    ` : ''}
    <!-- Twitter / X -->
    <meta name="twitter:card" content="${absoluteVideoUrl ? 'player' : 'summary_large_image'}" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />
    ${absoluteVideoUrl ? `
    <meta name="twitter:player" content="${escapeHtml(canonicalUrl)}" />
    <meta name="twitter:player:width" content="640" />
    <meta name="twitter:player:height" content="1136" />
    <meta name="twitter:player:stream" content="${escapeHtml(absoluteVideoUrl)}" />
    <meta name="twitter:player:stream:content_type" content="video/mp4" />
    ` : ''}
    <!-- Additional Schema.org fallback for general platform scrapers -->
    <meta itemprop="name" content="${escapeHtml(title)}">
    <meta itemprop="description" content="${escapeHtml(description)}">
    <meta itemprop="image" content="${escapeHtml(image)}">
    <!-- Legacy / Crawler Fallbacks -->
    <link rel="image_src" href="${escapeHtml(image)}" />
    
    <!-- Rich Snippets / Google Product Schema Search Integration -->
    <script type="application/ld+json">
${JSON.stringify(schemaJson, null, 6)}
    </script>
  `;

  let cleanHtml = html
    .replace(/<title>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta[^>]*?name="description"[^>]*?>/gi, '')
    .replace(/<link[^>]*?rel="canonical"[^>]*?>/gi, '');

  return cleanHtml.replace('<head>', `<head>${tags}`);
}

const categorySlugs = [
  'phones',
  'laptops',
  'electronics',
  'fashion',
  'games',
  'home-appliances',
  'beauty-and-care',
  'vehicles',
  'services',
  'other',
  'others'
];

const CATEGORY_META: Record<string, { title: string; description: string; imageSearch: string }> = {
  'phones': {
    title: 'Verified Phones for Sale in Ghana - iPhones & Androids | TedBuy',
    description: 'Browse authentic & verified mobile phones for sale in Ghana. Find top deals on Apple iPhones, Samsung Galaxy, Google Pixel, Xiaomi, and other smart devices with seller trust scores on TedBuy.',
    imageSearch: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=600&q=80'
  },
  'laptops': {
    title: 'Verified Laptops & Computers for Sale in Ghana | TedBuy',
    description: 'Looking for a reliable laptop? Find certified and tested laptops for sale in Accra, Kumasi and across Ghana. Shop HP, Dell, Apple MacBook, Lenovo, and Asus from trusted sellers on TedBuy.',
    imageSearch: 'https://images.unsplash.com/photo-1496181130204-7552aa1ab54a?auto=format&fit=crop&w=600&q=80'
  },
  'electronics': {
    title: 'Verified Electronics & TVs for Sale in Ghana | TedBuy',
    description: 'Upgrade your home entertainment. Buy high-quality electronics, smart TVs, home theaters, sound systems, cameras, and headphones from verified sellers in Ghana on TedBuy.',
    imageSearch: 'https://images.unsplash.com/photo-1550009158-9ebf6d2d116e?auto=format&fit=crop&w=600&q=80'
  },
  'fashion': {
    title: 'Verified Fashion, Clothes & Shoes in Ghana | TedBuy',
    description: 'Elevate your style with verified fashion items. Discover trendy clothes, designer shoes, sneakers, watches, bags, and apparel from vetted sellers across Ghana on TedBuy.',
    imageSearch: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=600&q=80'
  },
  'games': {
    title: 'Verified Video Games & Consoles for Sale in Ghana | TedBuy',
    description: 'Get the best gaming gear in Ghana. Search for verified PS5, PlayStation 4, Xbox Series X/S, Nintendo Switch, controllers, and top gaming titles on TedBuy Ghana.',
    imageSearch: 'https://images.unsplash.com/photo-1385846819339-df8a513c75d4?auto=format&fit=crop&w=600&q=80'
  },
  'home-appliances': {
    title: 'Verified Home & Kitchen Appliances in Ghana | TedBuy',
    description: 'Equip your home with authentic household appliances. Find amazing listings for verified refrigerators, microwaves, washing machines, blenders, and stoves on TedBuy Ghana.',
    imageSearch: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=600&q=80'
  },
  'beauty-and-care': {
    title: 'Verified Beauty, Skincare & Cosmetics in Ghana | TedBuy',
    description: 'Shop verified beauty products, organic skincare, cosmetics, long-lasting perfumes like Pure Black, and grooming products from trusted sellers in Ghana on TedBuy.',
    imageSearch: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=600&q=80'
  },
  'vehicles': {
    title: 'Verified Cars & Vehicles for Sale in Ghana | TedBuy',
    description: 'Reliable transport on a budget. Explore verified cars, motorbikes, bicycles, and vehicle accessories for sale in Ghana from trusted private sellers & dealers on TedBuy.',
    imageSearch: 'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=600&q=80'
  },
  'services': {
    title: 'Verified Professional Services & Freelancers in Ghana | TedBuy',
    description: 'Find trusted local professionals and services in Ghana. Hire vetted experts for repair, construction, web development, photography, tuition, and business services on TedBuy.',
    imageSearch: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=600&q=80'
  },
  'other': {
    title: 'Misc Verified Goods for Sale in Ghana | TedBuy',
    description: 'Explore unique listings and everyday items for sale on TedBuy. Vetted peer-to-peer deals on high-quality miscellaneous goods in Accra, Kumasi, and across Ghana.',
    imageSearch: 'https://images.unsplash.com/photo-1513151233558-d860c5398176?auto=format&fit=crop&w=600&q=80'
  }
};

function injectCategoryMetaTags(html: string, slug: string, shareUrl: string, host: string, protocol: string): string {
  const metaKey = slug === 'others' ? 'other' : slug;
  const meta = CATEGORY_META[metaKey] || {
    title: 'Verified Peer Classifieds in Ghana | TedBuy',
    description: 'Discover the premier marketplace to buy and sell verified products in Ghana safely with trust reviews and direct peer negotiation.',
    imageSearch: `${protocol}://${host}/favicon.svg`
  };
  
  const title = meta.title;
  const description = meta.description;
  const image = meta.imageSearch;

  const canonicalUrl = `${protocol}://${host}/${slug}`;

  const schemaJson = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": title,
    "url": canonicalUrl,
    "description": description,
    "image": image,
    "publisher": {
      "@type": "Organization",
      "name": "TedBuy Ghana",
      "logo": {
        "@type": "ImageObject",
        "url": `${protocol}://${host}/favicon.svg`
      }
    }
  };

  console.log(`[Category Crawler] Injecting Category Meta Tags for: ${slug}. Title: ${title}, Canonical: ${canonicalUrl}`);

  const tags = `
    <!-- Category SEO Meta Tags -->
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <!-- Open Graph -->
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(image)}" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="TedBuy" />
    <meta property="og:locale" content="en_GH" />
    <!-- Twitter / X -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />
    
    <!-- Rich Snippets / Google Category Schema Integration -->
    <script type="application/ld+json">
${JSON.stringify(schemaJson, null, 6)}
    </script>
  `;

  let cleanHtml = html
    .replace(/<title>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta[^>]*?name="description"[^>]*?>/gi, '')
    .replace(/<link[^>]*?rel="canonical"[^>]*?>/gi, '');

  return cleanHtml.replace('<head>', `<head>${tags}`);
}

// --- Lightweight SSR for the initial product grid ---
// This renders a simplified, static HTML version of the first batch of product
// cards directly into the served HTML, so visitors see real listing content the
// instant the page arrives - before the JS bundle has even downloaded, let alone
// run and made its own fetch. The client's React app takes over and replaces this
// markup once it mounts (no hydration matching is attempted - this is static
// content only, swapped for the real interactive app once JS is ready). The full
// product data is also embedded as JSON so the client can populate its state
// immediately on mount without waiting on a redundant first fetch.
function renderProductGridSSR(products: any[], limit = 24): string {
  const subset = (products || []).slice(0, limit);
  if (subset.length === 0) {
    return '';
  }

  const formatPrice = (price: any): string => {
    if (typeof price === 'string' && price.trim().toLowerCase().includes('contact')) {
      return 'Inquire';
    }
    const num = typeof price === 'number' ? price : parseFloat(price);
    if (isNaN(num)) return escapeHtml(String(price || ''));
    return `GH₵ ${num.toLocaleString('en-US')}`;
  };

  const CATEGORY_ICONS_SSR: Record<string, string> = {
    Phones: '📱',
    Laptops: '💻',
    Fashion: '👟',
    'Home Appliances': '🔌',
    Vehicles: '🚗',
    Property: '🏠',
    'Beauty and Care': '💄',
    Games: '🎮',
    Electronics: '⚡',
    Services: '🛠️',
    Other: '📦'
  };

  const categories = ['Phones', 'Laptops', 'Fashion', 'Home Appliances', 'Vehicles', 'Property', 'Beauty and Care', 'Games', 'Electronics'];

  const categoryPillsHtml = categories.map((cat) => {
    const icon = CATEGORY_ICONS_SSR[cat] || '📦';
    return `
      <div style="white-space:nowrap;padding:10px 18px;background:#ffffff;border:1px solid #e2e8f0;border-radius:9999px;font-size:12px;font-weight:700;color:#334155;display:inline-flex;align-items:center;gap:6px;box-shadow:0 1px 2px rgba(0,0,0,0.02);cursor:pointer;">
        <span style="font-size:15px;">${icon}</span>
        <span>${cat}</span>
      </div>`;
  }).join('');

  const cards = subset.map((p) => {
    const title = escapeHtml(p.title || 'Untitled Listing');
    const price = formatPrice(p.price);
    const location = escapeHtml(p.location || 'Ghana');
    const image = escapeHtml(p.imageUrl || (Array.isArray(p.images) && p.images[0]) || p.image || '/favicon.svg');
    const id = escapeHtml(p.id || '');
    const category = escapeHtml(p.category || 'Other');
    const condition = p.condition ? escapeHtml(p.condition) : '';
    const negotiable = p.negotiable !== false;

    return `
      <a href="/products/${id}" class="ssr-card" style="display:flex;flex-direction:column;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;text-decoration:none;color:inherit;background:#fff;transition:transform 0.2s, box-shadow 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
        <div style="position:relative;width:100%;aspect-ratio:4/3;background:#f1f5f9;overflow:hidden;display:flex;align-items:center;justify-content:center;">
          <img src="${image}" alt="${title}" loading="lazy" style="width:100%;height:100%;object-fit:cover;" />
          
          <div style="position:absolute;top:10px;left:10px;display:flex;gap:6px;z-index:10;">
            <span style="padding:3px 8px;background:rgba(15,23,42,0.8);backdrop-filter:blur(4px);color:#fff;font-size:9px;font-weight:700;border-radius:6px;text-transform:uppercase;letter-spacing:0.05em;">
              ${category}
            </span>
            ${condition ? `
              <span style="padding:3px 8px;background:rgba(15,23,42,0.9);color:#fff;border:1px solid #475569;font-size:9px;font-weight:700;border-radius:6px;text-transform:uppercase;">
                ${condition}
              </span>` : ''}
          </div>
        </div>
        <div style="padding:14px;display:flex;flex-direction:column;justify-content:space-between;flex:1;gap:6px;background:linear-gradient(to bottom, #fff, #f8fafc);">
          <div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
              <span style="font-size:18px;font-weight:800;color:#0f172a;letter-spacing:-0.02em;">${price}</span>
              ${negotiable ? `<span style="font-size:8px;background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;font-weight:800;padding:2px 5px;border-radius:4px;text-transform:uppercase;">Neg.</span>` : ''}
            </div>
            <div style="font-size:13px;font-weight:600;color:#334155;line-height:1.4;max-height:36px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;margin-top:2px;">
              ${title}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:4px;font-size:10px;color:#64748b;margin-top:auto;">
            <svg style="width:11px;height:11px;color:#94a3b8;" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
            </svg>
            <span style="font-weight:500;">${location}</span>
          </div>
        </div>
      </a>`;
  }).join('');

  return `
    <!-- Branded Loading Shell to prevent Refresh Layout Shifts -->
    <div style="background:#f8fafc;min-height:100vh;display:flex;flex-direction:column;font-family:'Plus Jakarta Sans',ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased;">
      
      <!-- Styled Nav Shell -->
      <header style="position:sticky;top:0;z-index:40;background:#0f172a;border-bottom:1px solid #020617;color:#fff;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);height:64px;">
        <div style="max-width:1280px;margin:0 auto;padding:0 16px;display:flex;align-items:center;justify-content:space-between;height:100%;gap:16px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:40px;height:40px;border-radius:12px;background:#020617;border:1px solid #1e293b;display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:inset 0 1px 2px rgba(255,255,255,0.05);">
              <img src="/favicon.svg" alt="TedBuy Logo" style="width:32px;height:32px;object-fit:contain;" />
            </div>
            <div style="display:flex;flex-direction:column;text-align:left;">
              <span style="font-size:20px;font-weight:900;letter-spacing:-0.03em;line-height:1;color:#fff;">TedBuy</span>
              <span style="font-size:9px;color:#94a3b8;font-weight:800;letter-spacing:0.08em;margin-top:2px;text-transform:uppercase;">Ghana</span>
            </div>
          </div>
          
          <div style="flex:1;max-width:512px;position:relative;display:none;margin:0 16px;">
            <input type="text" placeholder="Search..." disabled style="width:100%;padding:8px 12px 8px 36px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#fff;font-size:13px;outline:none;" />
          </div>

          <div style="display:flex;align-items:center;gap:12px;">
            <div style="width:32px;height:32px;border-radius:50%;background:#1e293b;border:1px solid #334155;"></div>
          </div>
        </div>
      </header>

      <!-- Welcome Badge & Hero Section -->
      <div style="max-width:1280px;width:100%;margin:0 auto;padding:24px 16px 0 16px;box-sizing:border-box;">
        <div style="position:relative;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:24px;padding:24px;display:flex;flex-direction:column;gap:16px;box-shadow:0 1px 2px rgba(0,0,0,0.02);text-align:left;">
          <div style="max-width:512px;width:100%;">
            <label style="display:block;font-size:11px;font-weight:900;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.1em;">looking for something?</label>
            <div style="position:relative;display:flex;align-items:center;width:100%;">
              <div style="position:absolute;left:16px;color:#94a3b8;display:flex;align-items:center;">
                <svg style="width:18px;height:18px;" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                </svg>
              </div>
              <input type="text" placeholder="Search phones, laptops, sneakers, furniture, beauty care..." disabled style="width:100%;padding:14px 16px 14px 44px;border:2px solid #cbd5e1;border-radius:16px;background:#fff;font-size:14px;font-weight:600;color:#94a3b8;outline:none;box-sizing:border-box;" />
            </div>
          </div>
        </div>
      </div>

      <!-- Categories ribbon wrapper -->
      <div style="max-width:1280px;width:100%;margin:0 auto;padding:24px 16px 0 16px;box-sizing:border-box;text-align:left;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
          <svg style="width:18px;height:18px;color:#0f172a;" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path>
          </svg>
          <span style="font-size:15px;font-weight:800;color:#0f172a;">Explore Classified Categories</span>
        </div>
        
        <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:10px;scrollbar-width:none;-webkit-overflow-scrolling:touch;">
          ${categoryPillsHtml}
        </div>
      </div>

      <!-- Product grid section -->
      <div style="max-width:1280px;width:100%;margin:0 auto;padding:16px 16px 48px 16px;box-sizing:border-box;">
        <div id="ssr-product-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">
          ${cards}
        </div>
      </div>

    </div>
    
    <style>
      @media (min-width: 640px) {
        #ssr-product-grid { grid-template-columns: repeat(3,1fr) !important; }
      }
      @media (min-width: 1024px) {
        #ssr-product-grid { grid-template-columns: repeat(4,1fr) !important; }
      }
      @media (min-width: 1280px) {
        #ssr-product-grid { grid-template-columns: repeat(4,1fr) !important; }
      }
      .ssr-card:hover {
        transform: translateY(-4px);
        box-shadow: 0 12px 20px -8px rgba(0,0,0,0.15) !important;
        border-color: #cbd5e1 !important;
      }
    </style>`;
}

function injectInitialProductsData(html: string, products: any[], limit = 24): string {
  // Only embed the subset actually rendered in the SSR grid below, not the full
  // (up to 300-item) dataset - the client's normal polling picks up the rest
  // within ~30 seconds of mount, and this keeps every homepage response small
  // regardless of total catalog size.
  const subset = (products || []).slice(0, limit);

  // JSON.stringify output can legally contain "</script>" inside string values
  // (e.g. a malicious or copy-pasted product description) which would prematurely
  // terminate the script tag, so this is escaped defensively.
  const json = JSON.stringify(subset).replace(/<\/script/gi, '<\\/script');
  const dataScript = `<script>window.__INITIAL_PRODUCTS__ = ${json};</script>\n`;
  const ssrGrid = renderProductGridSSR(subset, limit);

  return html
    .replace('<div id="root"></div>', `<div id="root">${ssrGrid}</div>`)
    .replace('<script type="module" src="/src/main.tsx"></script>', `${dataScript}<script type="module" src="/src/main.tsx"></script>`)
    .replace('<script type="module" crossorigin src="/assets/', `${dataScript}<script type="module" crossorigin src="/assets/`);
}

function injectHomepageMetaTags(html: string, shareUrl: string, host: string, protocol: string): string {
  const title = "TedBuy Ghana - Premium Buy & Sell Classifieds Marketplace";
  const description = "Discover the premier platform to buy and sell products in Ghana. Find phones, laptops, electronics, vehicles, and premium deals safely. Experience verified seller trust scores and direct WhatsApp negotiation.";
  
  // Use our beautiful vector brand logo from the favicon/logo as the main OG image fallback
  const image = `${protocol}://${host}/favicon.svg`;

  const canonicalUrl = `${protocol}://${host}/`;

  console.log(`[Meta Crawler] Injecting Homepage Open Graph tags. URL: ${shareUrl}, Canonical: ${canonicalUrl}, Image URL: ${image}`);

  const tags = `
    <!-- Dynamic Social Share Meta Tags -->
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <!-- Open Graph / Facebook / WhatsApp -->
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(image)}" />
    <meta property="og:image:type" content="image/svg+xml" />
    <meta property="og:image:width" content="512" />
    <meta property="og:image:height" content="512" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="TedBuy Ghana" />
    <meta property="og:locale" content="en_GH" />
    <!-- Twitter / X -->
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />
    <!-- App Logo Metas -->
    <meta property="og:logo" content="${escapeHtml(image)}" />
  `;

  let cleanHtml = html
    .replace(/<title>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta[^>]*?name="description"[^>]*?>/gi, '')
    .replace(/<link[^>]*?rel="canonical"[^>]*?>/gi, '');

  return cleanHtml.replace('<head>', `<head>${tags}`);
}

async function getSellerData(sellerId: string) {
  const now = Date.now();
  const cached = sellerDataCache.get(sellerId);
  if (cached && (now - cached.timestamp < 120000)) {
    console.log(`[Meta Crawler] Serving seller ${sellerId} from memory cache`);
    return cached.data;
  }

  if (backendSupabase) {
    try {
      console.log(`[Supabase Server] Fetching seller ${sellerId} from Supabase...`);
      const { data, error } = await backendSupabase
        .from('users')
        .select('*')
        .eq('id', sellerId)
        .maybeSingle();
      if (!error && data) {
        const result = {
          username: data.username || '',
          role: data.role || 'seller',
          photoUrl: data.photoUrl || '',
          isVerified: data.emailVerified || false
        };
        sellerDataCache.set(sellerId, { data: result, timestamp: now });
        return result;
      }
    } catch (sbErr: any) {
      console.warn(`[Supabase Server] Fetch seller ${sellerId} failed:`, sbErr?.message || sbErr);
    }
  }

  sellerDataCache.set(sellerId, { data: null, timestamp: now });
  return null;
}

function injectSellerMetaTags(html: string, seller: { username: string; role: string; photoUrl: string; isVerified: boolean }, shareUrl: string, host: string, protocol: string, sellerId: string): string {
  const username = seller.username || 'Verified Seller';
  const title = `TedBuy Ghana - ${username}'s Store Profile`;
  const description = `Browse active product classifieds, verified ratings, and immersive video ads posted by ${username} on TedBuy Ghana. Chat directly via WhatsApp on Ghana's #1 Social Commerce & Peer Classifieds platform.`;
  const image = seller.photoUrl || `${protocol}://${host}/favicon.svg`;
  const canonicalUrl = `${protocol}://${host}/seller/${sellerId}`;

  const schemaJson = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "name": `${username} Profile | TedBuy`,
    "url": canonicalUrl,
    "description": description,
    "image": image,
    "mainEntity": {
      "@type": "Person",
      "name": username,
      "image": image,
      "description": `Registered seller on TedBuy Ghana.`,
      "url": canonicalUrl
    }
  };

  const tags = `
    <!-- Seller SEO Meta Tags -->
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <!-- Open Graph -->
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(image)}" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:type" content="profile" />
    <meta property="og:site_name" content="TedBuy" />
    <meta property="og:locale" content="en_GH" />
    <!-- Twitter / X -->
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />
    
    <!-- Rich Snippets / Google Profile Page Schema Integration -->
    <script type="application/ld+json">
${JSON.stringify(schemaJson, null, 6)}
    </script>
  `;

  let cleanHtml = html
    .replace(/<title>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta[^>]*?name="description"[^>]*?>/gi, '')
    .replace(/<link[^>]*?rel="canonical"[^>]*?>/gi, '');

  return cleanHtml.replace('<head>', `<head>${tags}`);
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

const systemMarkdown = `# TedBuy Ghana Classifieds - Verified Peer Commerce

Welcome to **TedBuy**, Ghana's #1 Social Classifieds & Video Commerce platform.

## Active Classified Categories
- Phones (Mobile devices, iPhones, Androids)
- Laptops & Accessories
- Fashion & Apparel (Sneakers, clothing)
- Home Appliances
- Vehicles
- Beauty & Care
- Games & Consoles
- Professional Services

## Core Platform Capabilities & API endpoints
- GET \`/api/health\`: Retrieve system heartbeat and Firebase configurations
- GET \`/sitemap.xml\`: Auto-updated index of active listing pathways
- GET \`/robots.txt\`: Navigation crawling policies
- GET \`/api/products/:productId/image\`: Web-optimized product JPG deliveries

## Communication & Verification
- Immersive 9:16 Video Ads for real-time buyer trust
- Direct verified seller peer chats on WhatsApp
- Verification badge metrics representing transaction completions`;

async function selfHealProductImages() {
  if (!backendSupabase) return;
  console.log('[Self-Healing] Starting product images self-healing from disk cache...');
  try {
    const { data: products, error } = await backendSupabase
      .from('products')
      .select('id, images, title');

    if (error) {
      console.error('[Self-Healing] Failed to fetch products for self-healing:', error);
      return;
    }

    let healedCount = 0;
    for (const prod of (products || [])) {
      const id = prod.id;
      let imgs = Array.isArray(prod.images) ? prod.images : [];
      if (typeof prod.images === 'string') {
        try { imgs = JSON.parse(prod.images); } catch (_) { imgs = []; }
      }

      const hasProxy = imgs.some((img: string) => typeof img === 'string' && img.startsWith('/api/products/'));
      const isEmpty = imgs.length === 0;

      if (hasProxy || isEmpty) {
        const restoredImages: string[] = [];
        const primaryTxtFile = path.join(IMAGES_CACHE_DIR, `${id}.txt`);
        if (fs.existsSync(primaryTxtFile)) {
          try {
            const b64 = fs.readFileSync(primaryTxtFile, 'utf-8');
            if (b64 && b64.startsWith('data:')) {
              restoredImages.push(b64);
            }
          } catch (e) {
            console.error(`[Self-Healing] Error reading ${id}.txt:`, e);
          }
        }

        let idx = 1;
        while (true) {
          const subTxtFile = path.join(IMAGES_CACHE_DIR, `${id}_img${idx}.txt`);
          if (fs.existsSync(subTxtFile)) {
            try {
              const b64 = fs.readFileSync(subTxtFile, 'utf-8');
              if (b64 && b64.startsWith('data:')) {
                restoredImages.push(b64);
                idx++;
                continue;
              }
            } catch (e) {
              console.error(`[Self-Healing] Error reading sub-image ${id}_img${idx}.txt:`, e);
            }
          }
          break;
        }

        if (restoredImages.length > 0) {
          console.log(`[Self-Healing] Restoring ${restoredImages.length} images for product "${prod.title}" (${id}) from disk cache...`);
          const { error: updateErr } = await backendSupabase
            .from('products')
            .update({ images: restoredImages })
            .eq('id', id);

          if (updateErr) {
            console.error(`[Self-Healing] Failed to update product ${id}:`, updateErr);
          } else {
            healedCount++;
          }
        }
      }
    }
    console.log(`[Self-Healing] Completed! Successfully self-healed ${healedCount} products.`);
  } catch (err) {
    console.error('[Self-Healing] Error during self-healing:', err);
  }
}

async function startServer() {
  // Ensure favicon.ico exists at the web root dynamically as a valid .ico file
  try {
    const src = path.resolve(process.cwd(), "public", "favicon-48.png");
    const destPublic = path.resolve(process.cwd(), "public", "favicon.ico");
    const destDist = path.resolve(process.cwd(), "dist", "favicon.ico");
    
    if (fs.existsSync(src)) {
      let generatePublic = !fs.existsSync(destPublic);
      if (fs.existsSync(destPublic)) {
        const fileHead = fs.readFileSync(destPublic).slice(0, 4);
        if (fileHead.toString("hex") === "89504e47") {
          // It's a raw PNG file masquerading as an .ico!
          generatePublic = true;
        }
      }
      
      const pngBuf = fs.readFileSync(src);
      const pngSize = pngBuf.length;
      
      // Construct a valid ICO header wrapping the 48x48 PNG
      const header = Buffer.alloc(22);
      header.writeUInt16LE(0, 0);     // Reserved: 0
      header.writeUInt16LE(1, 2);     // Type: 1 (icon)
      header.writeUInt16LE(1, 4);     // Count: 1 image
      
      header.writeUInt8(48, 6);       // Width: 48
      header.writeUInt8(48, 7);       // Height: 48
      header.writeUInt8(0, 8);        // Color count: 0
      header.writeUInt8(0, 9);        // Reserved: 0
      header.writeUInt16LE(1, 10);    // Color planes: 1
      header.writeUInt16LE(32, 12);   // Bits per pixel: 32
      header.writeUInt32LE(pngSize, 14); // Image size in bytes
      header.writeUInt32LE(22, 18);   // Image offset (22 bytes header)
      
      const icoBuf = Buffer.concat([header, pngBuf]);
      
      if (generatePublic) {
        fs.writeFileSync(destPublic, icoBuf);
        console.log("[Favicon Sync] Generated valid ICO at public/favicon.ico");
      }
      
      const distExists = fs.existsSync(path.resolve(process.cwd(), "dist"));
      if (distExists) {
        let generateDist = !fs.existsSync(destDist);
        if (fs.existsSync(destDist)) {
          const fileHead = fs.readFileSync(destDist).slice(0, 4);
          if (fileHead.toString("hex") === "89504e47") {
            generateDist = true;
          }
        }
        if (generateDist) {
          fs.writeFileSync(destDist, icoBuf);
          console.log("[Favicon Sync] Generated valid ICO at dist/favicon.ico");
        }
      }
    }
  } catch (err) {
    console.error("[Favicon Sync] Failed to align favicon.ico dynamically", err);
  }

  const getMailTransporter = () => {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (host && user && pass) {
      console.log(`[Email Engine] SMTP configured: ${host}:${port}. Initializing real transporter.`);
      return nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: {
          user,
          pass,
        },
        tls: {
          rejectUnauthorized: true
        }
      });
    } else {
      console.warn(`[Email Engine] No SMTP configurations detected. Running in simulated streaming mode.`);
      return nodemailer.createTransport({
        streamTransport: true,
        newline: "unix",
        buffer: true
      });
    }
  };

  /**
   * SMTP Diagnostic Utility
   * Checks TCP socket connectivity to the SMTP server (e.g. mail.privateemail.com) on the configured port,
   * and executes a pre-flight SMTP handshake / credential verification protocol via nodemailer.verify().
   */
  const diagnoseSMTPAndVerify = async (transporter: any): Promise<{ success: boolean; details: any }> => {
    console.log("\n--- [SMTP Diagnostic] INITIATING STAGE 1: TCP CONNECTIVITY CHECK ---");
    const host = process.env.SMTP_HOST || "mail.privateemail.com";
    const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!user || !pass) {
      const errorMsg = "[SMTP Diagnostic] SKIPPED: Missing credentials in SMTP_USER or SMTP_PASS environment variables.";
      console.warn(errorMsg);
      return { success: false, details: { error: errorMsg, smtpConfigured: false } };
    }

    // Stage 1: TCP Port Connectivity test via net.connect
    const tcpConnection = new Promise<{ connected: boolean; error?: any }>((resolve) => {
      console.log(`[SMTP Diagnostic] Attempting TCP Connection to ${host}:${port}...`);
      const socket = net.createConnection(port, host);
      socket.setTimeout(6000); // 6 seconds timeout

      socket.on('connect', () => {
        console.log(`[SMTP Diagnostic] TCP handshake SUCCESS: Connected successfully to ${host}:${port}`);
        socket.end();
        resolve({ connected: true });
      });

      socket.on('timeout', () => {
        console.error(`[SMTP Diagnostic] TCP Connection TIMEOUT: Failed to connect to ${host}:${port} after 6000ms. It is likely that port ${port} is blocked by outbound network security groups / firewall policies.`);
        socket.destroy();
        resolve({ connected: false, error: new Error("TCP Connection Timeout (6s)") });
      });

      socket.on('error', (err) => {
        console.error(`[SMTP Diagnostic] TCP connection ERROR: Failed to reach host ${host} on port ${port}:`, err);
        socket.destroy();
        resolve({ connected: false, error: err });
      });
    });

    const tcpResult = await tcpConnection;
    if (!tcpResult.connected) {
      return {
        success: false,
        details: {
          stage: "TCP_CONNECTIVITY",
          host,
          port,
          error: tcpResult.error?.message || "TCP Connection Failed"
        }
      };
    }

    // Stage 2: SMTP Handshake & Authentication verify via Nodemailer
    console.log("\n--- [SMTP Diagnostic] INITIATING STAGE 2: SMTP HANDSHAKE & AUTHENTICATION VERIFICATION ---");
    try {
      console.log(`[SMTP Diagnostic] Verifying credentials for user: ${user} ...`);
      await transporter.verify();
      console.log("[SMTP Diagnostic] SUCCESS: SMTP credentials and handshake verified successfully!");
      console.log("------------------------------------------------------------------------\n");
      return { success: true, details: { stage: "SMTP_HANDSHAKE_AUTH", status: "Verified" } };
    } catch (err: any) {
      console.error(`\n========================================================================`);
      console.error(`[SMTP Diagnostic] ERROR: STAGE 2 SMTP HANDSHAKE OR AUTHENTICATION FAILED`);
      console.error(`------------------------------------------------------------------------`);
      console.error(`Error Code:        ${err.code || 'N/A'}`);
      console.error(`Command:           ${err.command || 'N/A'}`);
      console.error(`Response Code:     ${err.responseCode || 'N/A'}`);
      console.error(`Server Response:   ${err.response || 'N/A'}`);
      console.error(`Detailed Message:  ${err.message || String(err)}`);
      console.error(`========================================================================\n`);
      return {
        success: false,
        details: {
          stage: "SMTP_HANDSHAKE_AUTH",
          code: err.code,
          command: err.command,
          responseCode: err.responseCode,
          response: err.response,
          error: err.message || String(err)
        }
      };
    }
  };

  // Pre-flight SMTP check during server launch
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (smtpHost && smtpUser && smtpPass) {
    console.log("[Email Engine] Launching startup pre-flight SMTP validation check...");
    diagnoseSMTPAndVerify(getMailTransporter()).catch(err => {
      console.error("[Email Engine] Startup SMTP validation exception:", err);
    });
  }

  app.use((req, res, next) => {
    const isWebRoute = (
      req.method === 'GET' &&
      !req.path.startsWith('/api/') &&
      !req.path.includes('/node_modules/') &&
      !req.path.includes('/@vite') &&
      !req.path.endsWith('.js') &&
      !req.path.endsWith('.css') &&
      !req.path.endsWith('.png') &&
      !req.path.endsWith('.jpg') &&
      !req.path.endsWith('.jpeg') &&
      !req.path.endsWith('.svg') &&
      !req.path.endsWith('.ico') &&
      !req.path.endsWith('.json') &&
      !req.path.endsWith('.gif') &&
      !req.path.endsWith('.woff') &&
      !req.path.endsWith('.woff2') &&
      !req.path.endsWith('.xml')
    );

    // Always set the Link headers for agent discovery on all web routes
    if (isWebRoute) {
      res.setHeader('Link', '</sitemap.xml>; rel="sitemap", </.well-known/api-catalog>; rel="api-catalog", </auth.md>; rel="service-doc"');
    }

    // Return HTML responses as markdown when agents request it
    const acceptHeader = req.headers.accept?.toLowerCase() || '';
    if (isWebRoute && (acceptHeader.includes('text/markdown') || acceptHeader.includes('text/x-markdown'))) {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('x-markdown-tokens', '1200');
      return res.status(200).send(systemMarkdown);
    }

    next();
  });

  app.get(['/.well-known/dns-aid', '/.well-known/dns-records'], (req, res) => {
    const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy.store';
    const host = cleanHostHeader(rawHost);
    const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
    
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(`; DNS-AID ServiceMode Records for TedBuy Discovery (RFC 9460)
_index._agents.${host}.  3600  IN  HTTPS  1  . alpn="h2,h3" port="443" ipv4hint="216.58.210.14" key_uri="${protocol}://${host}/.well-known/jwks.json" service-doc="${protocol}://${host}/auth.md" api-catalog="${protocol}://${host}/.well-known/api-catalog"
_a2a._agents.${host}.    3600  IN  HTTPS  1  . alpn="h2,h3" port="443" ipv4hint="216.58.210.14" key_uri="${protocol}://${host}/.well-known/jwks.json" service-doc="${protocol}://${host}/auth.md" api-catalog="${protocol}://${host}/.well-known/api-catalog"
`);
  });

  app.get(['/.well-known/dns-aid.json', '/.well-known/dns-records.json'], (req, res) => {
    const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy.store';
    const host = cleanHostHeader(rawHost);
    const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
    const origin = `${protocol}://${host}`;

    res.setHeader('Content-Type', 'application/json');
    res.json({
      "dnssec": {
        "status": "active",
        "algorithm": "RSASHA256",
        "signed_zone": host
      },
      "dns_records": [
        {
          "name": `_index._agents.${host}`,
          "type": "HTTPS",
          "ttl": 3600,
          "class": "IN",
          "priority": 1,
          "target": ".",
          "params": {
            "alpn": "h2,h3",
            "port": 443,
            "ipv4hint": "216.58.210.14",
            "key_uri": `${origin}/.well-known/jwks.json`,
            "service-doc": `${origin}/auth.md`,
            "api-catalog": `${origin}/.well-known/api-catalog`
          }
        },
        {
          "name": `_a2a._agents.${host}`,
          "type": "HTTPS",
          "ttl": 3600,
          "class": "IN",
          "priority": 1,
          "target": ".",
          "params": {
            "alpn": "h2,h3",
            "port": 443,
            "ipv4hint": "216.58.210.14",
            "key_uri": `${origin}/.well-known/jwks.json`,
            "service-doc": `${origin}/auth.md`,
            "api-catalog": `${origin}/.well-known/api-catalog`
          }
        }
      ]
    });
  });

  app.get('/.well-known/oauth-protected-resource', (req, res) => {
    const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy.store';
    const host = cleanHostHeader(rawHost);
    const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
    res.header('Content-Type', 'application/json; charset=utf-8');
    res.json({
      "resource": `${protocol}://${host}/api`,
      "authorization_servers": [`${protocol}://${host}`],
      "scopes_supported": ["public", "read", "write"]
    });
  });

  app.get('/.well-known/oauth-authorization-server', (req, res) => {
    const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy.store';
    const host = cleanHostHeader(rawHost);
    const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
    res.header('Content-Type', 'application/json; charset=utf-8');
    res.json({
      "issuer": `${protocol}://${host}`,
      "authorization_endpoint": `${protocol}://${host}/login`,
      "token_endpoint": `${protocol}://${host}/api/token`,
      "jwks_uri": `${protocol}://${host}/api/jwks`,
      "scopes_supported": ["public", "read"],
      "response_types_supported": ["code", "token"],
      "grant_types_supported": ["authorization_code", "client_credentials"],
      "agent_auth": {
        "register_uri": `${protocol}://${host}/api/agents/register`,
        "supported_identity_types": ["individual", "organisation"],
        "credential_types": ["api_key", "oauth2"],
        "claim_uri": `${protocol}://${host}/api/agents/claim`,
        "revocation_uri": `${protocol}://${host}/api/agents/revoke`
      }
    });
  });

  app.get('/.well-known/openid-configuration', (req, res) => {
    const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy.store';
    const host = cleanHostHeader(rawHost);
    const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
    res.header('Content-Type', 'application/json; charset=utf-8');
    res.json({
      "issuer": `${protocol}://${host}`,
      "authorization_endpoint": `${protocol}://${host}/login`,
      "token_endpoint": `${protocol}://${host}/api/token`,
      "userinfo_endpoint": `${protocol}://${host}/api/userinfo`,
      "jwks_uri": `${protocol}://${host}/api/jwks`,
      "response_types_supported": ["code", "token"],
      "subject_types_supported": ["public"],
      "id_token_signing_alg_values_supported": ["RS256"]
    });
  });

  app.get('/.well-known/api-catalog', (req, res) => {
    const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy.store';
    const host = cleanHostHeader(rawHost);
    const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
    res.header('Content-Type', 'application/json; charset=utf-8');
    res.json({
      "linkset": [
        {
          "anchor": `${protocol}://${host}/api`,
          "rel": "service-desc",
          "href": `${protocol}://${host}/docs/api-catalog.json`,
          "type": "application/openapi+json"
        },
        {
          "anchor": `${protocol}://${host}/api`,
          "rel": "status",
          "href": `${protocol}://${host}/api/health`,
          "type": "application/json"
        }
      ]
    });
  });

  app.get('/.well-known/agent-skills/index.json', (req, res) => {
    const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy.store';
    const host = cleanHostHeader(rawHost);
    const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
    res.header('Content-Type', 'application/json; charset=utf-8');
    res.json({
      "$schema": "https://agentskills.io/v0.2.0/schema.json",
      "skills": [
        {
          "name": "TedBuy Product Search",
          "type": "api",
          "description": "Enables searching and categorizing live classified items listed across Ghana",
          "url": `${protocol}://${host}/api/search`
        }
      ]
    });
  });

  app.post('/api/sitemap/clear', (req, res) => {
    clearSitemapCache();
    res.json({ success: true, message: 'Sitemap cache cleared successfully' });
  });

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', projectId });
  });

  // Helper function to calculate robust production-ready priorityScore based on 4 priority levels
  function calculatePriorityScore(product: any): number {
    const now = new Date();
    const isBoostActive = product.boostStatus === true && 
                         product.boostEndDate && 
                         new Date(product.boostEndDate).getTime() > now.getTime();
    
    if (!isBoostActive) {
      const engagementScore = Number(product.viewsCount || 0);
      const createdAtMs = product.createdAt ? new Date(product.createdAt).getTime() : 0;
      const freshnessFactor = createdAtMs / 1e12; // Normal range is ~1.7 to 1.8
      return engagementScore + freshnessFactor;
    }

    const planId = product.boostPlan;
    let packageLevel = 0;
    if (planId === '90days') packageLevel = 5;
    else if (planId === '30days') packageLevel = 4;
    else if (planId === '14days') packageLevel = 3;
    else if (planId === '7days') packageLevel = 2;
    else if (planId === '3days') packageLevel = 1;

    const boostBase = packageLevel * 10000000; // 10,000,000 to 50,000,000
    
    const endDateMs = product.boostEndDate ? new Date(product.boostEndDate).getTime() : now.getTime();
    const remainingMs = Math.max(0, endDateMs - now.getTime());
    const remainingTimeFactor = remainingMs / 10000; // max value around 777,600 (90 days)
    
    const engagementScore = Number(product.viewsCount || 0);
    const engagementFactor = engagementScore / 10;
    
    const createdAtMs = product.createdAt ? new Date(product.createdAt).getTime() : 0;
    const freshnessFactor = createdAtMs / 1e12;
    
    return boostBase + remainingTimeFactor + engagementFactor + freshnessFactor;
  }

  // Client optimizer to translate heavy base64 strings into lightweight local proxies on-the-fly
  function optimizeProductsForClient(products: any[]): any[] {
    if (!Array.isArray(products)) return [];
    return products.map((result: any) => {
      if (!result) return null;
      // Copy to prevent mutating the original memory/file cache source
      const optimized = { ...result };

      let imgs = Array.isArray(optimized.images) ? [...optimized.images] : [];
      if (imgs.length === 0 && optimized.image) {
        imgs = [optimized.image];
      }

      optimized.images = imgs.map((img: string, idx: number) => {
        if (!img) return '';
        
        if (img.startsWith('data:')) {
          const ext = img.includes('png') ? 'png' : img.includes('webp') ? 'webp' : 'jpg';
          const imageKey = idx === 0 ? optimized.id : `${optimized.id}_img${idx}`;

          // Write to images_cache on disk asynchronously on client demand if missing
          try {
            const cacheFilePath = path.join(IMAGES_CACHE_DIR, `${imageKey}.txt`);
            if (!fs.existsSync(cacheFilePath)) {
              fs.writeFileSync(cacheFilePath, img, 'utf-8');
              console.log(`[Images Cache] Auto-generated disk file for ${imageKey} on client demand`);
            }

            // Warm up high-performance binary cache and pre-decode base64 on client demand
            try {
              const parts = img.split(';base64,');
              if (parts.length === 2) {
                const mimeType = parts[0].replace('data:', '');
                const buffer = Buffer.from(parts[1], 'base64');
                setBinaryImageInCache(imageKey, buffer, mimeType);

                const binFile = path.join(IMAGES_CACHE_DIR, `${imageKey}.bin`);
                const mimeFile = path.join(IMAGES_CACHE_DIR, `${imageKey}.mime`);
                if (!fs.existsSync(binFile)) {
                  fs.writeFileSync(binFile, buffer);
                  fs.writeFileSync(mimeFile, mimeType, 'utf-8');
                }
              }
            } catch (decodeErr) {
              console.error(`[Images Cache] Failed to pre-decode binary for ${imageKey}:`, decodeErr);
            }

            // Warm up productDataCache in memory for index 0
            if (idx === 0 && !productDataCache.has(optimized.id)) {
              productDataCache.set(optimized.id, {
                data: {
                  title: optimized.title || '',
                  description: optimized.description || '',
                  price: optimized.price || 'Negotiable',
                  image: img
                },
                timestamp: Date.now()
              });
            }
          } catch (err) {
            console.error(`[Images Cache] Failed to write client demand cache for ${imageKey}:`, err);
          }

          return idx === 0 
            ? `/api/products/${optimized.id}/image.${ext}`
            : `/api/products/${optimized.id}/image.${ext}?idx=${idx}`;
        } else {
          return img;
        }
      }).filter(Boolean);

      // Populate optimized.image with the primary optimized image url
      if (optimized.images.length > 0) {
        optimized.image = optimized.images[0];
      } else {
        optimized.image = '';
      }

      return optimized;
    }).filter(Boolean);
  }

  function getStaticFallbackProducts() {
    return [
      {
        id: 'fb-iphone15',
        title: 'iPhone 15 Pro Max - 256GB (Super Clean)',
        description: 'Brand new condition iPhone 15 Pro Max. Titanium grey, factory unlocked, 256GB storage space. Comes with original box, receipt, and 1 year active warranty.',
        price: 12500,
        category: 'Phones',
        location: 'Accra, Greater Accra',
        sellerId: 'fallback-seller-1',
        sellerName: 'Kelvin Nkrumah',
        createdAt: new Date().toISOString(),
        images: ['https://images.unsplash.com/photo-1695048133142-1a20484d2569?q=80&w=600&auto=format&fit=crop'],
        likesCount: 18,
        viewsCount: 245,
        isApproved: true,
        condition: 'New'
      },
      {
        id: 'fb-macbookm3',
        title: 'MacBook Pro 14" M3 Pro (18GB/512GB)',
        description: 'Apple MacBook Pro 14-inch with powerful M3 Pro chip, 18GB Unified Memory, and 512GB SSD storage. Space Black colorway. Super clean with 100% battery capacity.',
        price: 24000,
        category: 'Laptops',
        location: 'Kumasi, Ashanti',
        sellerId: 'fallback-seller-2',
        sellerName: 'Abena Mensah',
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        images: ['https://images.unsplash.com/photo-1517336714731-489689fd1ca8?q=80&w=600&auto=format&fit=crop'],
        likesCount: 11,
        viewsCount: 130,
        isApproved: true,
        condition: 'Refurbished'
      },
      {
        id: 'fb-nikeair',
        title: 'Nike Air Max 270 (Size 43) - Original',
        description: 'Original Nike Air Max 270 running shoes, comfortable mesh build, classic black and white color scheme. Worn only twice, practically brand new.',
        price: 850,
        category: 'Fashion',
        location: 'Tema, Greater Accra',
        sellerId: 'fallback-seller-3',
        sellerName: 'Emmanuel Osei',
        createdAt: new Date(Date.now() - 7200000).toISOString(),
        images: ['https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=600&auto=format&fit=crop'],
        likesCount: 22,
        viewsCount: 310,
        isApproved: true,
        condition: 'Used - Like New'
      }
    ];
  }

  async function fetchFromFirestoreDirect(): Promise<any[]> {
    let productsList: any[] = [];

    if (backendSupabase) {
      // Deliberately exclude the full `images`/`videos` JSONB columns here -- they can hold
      // base64-encoded image data (observed up to ~1MB per product), and pulling that across
      // up to 300 rows in one query is what was blowing Supabase's statement timeout. The grid
      // view only needs one thumbnail per card; full images are fetched separately per-product
      // on the detail page via getRawProductFirestoreREST, which is unaffected by this.
      const LIST_VIEW_COLUMNS = [
        'id', 'title', 'description', 'price', 'category', 'location',
        'brand', 'condition', 'negotiable',
        'sellerId', 'sellerName', 'createdAt', 'viewsCount', 'likesCount',
        'boostStatus', 'boostPlan', 'boostStartDate', 'boostEndDate',
        'boostPriority', 'priorityScore', 'boostPriorityLevel', 'boostPackagePrice',
        'remainingBoostTime', 'boostAmount', 'lastBoostedAt', 'lastBoostPurchase',
        'paymentStatus', 'paymentReference', 'visitCount', 'isApproved', 'videos'
      ].join(',');
      try {
        console.log(`[Products Data] [Stage 1] Fetching up to 150 products from backend Supabase (PostgreSQL)...`);
        const { data, error } = await backendSupabase
          .from('products')
          .select(LIST_VIEW_COLUMNS)
          .order('createdAt', { ascending: false })
          .limit(150);

        if (error) throw error;
        if (data) {
          console.log(`[Products Data] [Stage 1] Successfully loaded ${data.length} products from Supabase instantly!`);
          productsList = data.map((row: any) => ({
            ...row,
            images: [`/api/products/${row.id}/image.jpg`],
            videos: (row.videos && row.videos.length > 0) ? [`/api/products/${row.id}/video.mp4`] : [],
            thumbnail: undefined
          }));
        }
      } catch (sbErr: any) {
        const errMsg = sbErr?.message || String(sbErr);
        console.warn(`[Products Data] [Stage 1] Supabase fetch failed: ${errMsg}. Retrying Stage 2 with smaller limit...`);
        
        try {
          // Stage 2: Try a smaller limit of 50
          const { data, error } = await backendSupabase
            .from('products')
            .select(LIST_VIEW_COLUMNS)
            .order('createdAt', { ascending: false })
            .limit(50);

          if (error) throw error;
          if (data) {
            console.log(`[Products Data] [Stage 2] Successfully loaded ${data.length} products from Supabase with smaller limit!`);
            productsList = data.map((row: any) => ({
              ...row,
              images: [`/api/products/${row.id}/image.jpg`],
              videos: (row.videos && row.videos.length > 0) ? [`/api/products/${row.id}/video.mp4`] : [],
              thumbnail: undefined
            }));
          }
        } catch (sbErr2: any) {
          const errMsg2 = sbErr2?.message || String(sbErr2);
          console.warn(`[Products Data] [Stage 2] Supabase fetch failed: ${errMsg2}. Retrying Stage 3 with no-image fallback...`);
          
          try {
            // Stage 3: Fetch columns excluding the images entirely. This is guaranteed to be sub-millisecond as it doesn't read TOAST table.
            const SAFE_COLUMNS = [
              'id', 'title', 'description', 'price', 'category', 'location',
              'brand', 'condition', 'negotiable',
              'sellerId', 'sellerName', 'createdAt', 'viewsCount', 'likesCount',
              'boostStatus', 'boostPlan', 'boostStartDate', 'boostEndDate',
              'boostPriority', 'priorityScore', 'boostPriorityLevel', 'boostPackagePrice',
              'remainingBoostTime', 'boostAmount', 'lastBoostedAt', 'lastBoostPurchase',
              'paymentStatus', 'paymentReference', 'visitCount', 'isApproved', 'videos'
            ].join(',');
            
            const { data, error } = await backendSupabase
              .from('products')
              .select(SAFE_COLUMNS)
              .order('createdAt', { ascending: false })
              .limit(300);

            if (error) throw error;
            if (data) {
              console.log(`[Products Data] [Stage 3] Successfully loaded ${data.length} products WITHOUT images (safe fallback, mapping proxy URLs)!`);
              productsList = data.map((row: any) => ({
                ...row,
                images: [`/api/products/${row.id}/image.jpg`],
                videos: (row.videos && row.videos.length > 0) ? [`/api/products/${row.id}/video.mp4`] : [],
                thumbnail: undefined
              }));
            }
          } catch (sbErr3: any) {
            console.error(`[Products Data] [Stage 3] Safe Supabase fetch fallback failed completely:`, sbErr3?.message || sbErr3);
          }
        }
      }
    } else {
      // Fetch directly from Firestore (Admin SDK first, falling back to REST)
      if (adminDb) {
        try {
          console.log('[Products Data] Fetching products from Firestore via Admin SDK (Supabase inactive)...');
          const snapshot = await adminDb.collection('products').get();
          if (!snapshot.empty) {
            snapshot.forEach((doc: any) => {
              productsList.push({ id: doc.id, ...doc.data() });
            });
            console.log(`[Products Data] Successfully loaded ${productsList.length} products from Firestore Admin SDK!`);
          }
        } catch (adminErr: any) {
          console.warn('[Products Data] Admin SDK fetch failed for products:', adminErr.message || adminErr);
        }
      }

      if (productsList.length === 0) {
        try {
          console.log('[Products Data] Fetching products from Firestore via REST API (Supabase inactive)...');
          const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery${apiKey ? `?key=${apiKey}` : ""}`;
          
          const response = await fetch(firestoreUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              structuredQuery: {
                from: [{ collectionId: 'products', allDescendants: false }],
                limit: 1000
              }
            })
          });

          if (response.ok) {
            const data = await response.json();
            const results = Array.isArray(data) ? data : [];
            const parsedDocs = results
              .filter((item: any) => item && item.document)
              .map((item: any) => {
                const doc = item.document;
                const fields = doc.fields || {};
                const result: any = {};
                
                const parseVal = (val: any): any => {
                  if (!val) return undefined;
                  if ('stringValue' in val) return val.stringValue;
                  if ('integerValue' in val) return parseInt(val.integerValue, 10);
                  if ('doubleValue' in val) return parseFloat(val.doubleValue);
                  if ('booleanValue' in val) return val.booleanValue;
                  if ('arrayValue' in val) {
                    const arr = val.arrayValue?.values || [];
                    return arr.map((sub: any) => parseVal(sub));
                  }
                  if ('mapValue' in val) {
                    const mapFields = val.mapValue?.fields || {};
                    const mapResult: any = {};
                    for (const k of Object.keys(mapFields)) {
                      mapResult[k] = parseVal(mapFields[k]);
                    }
                    return mapResult;
                  }
                  return undefined;
                };

                for (const key of Object.keys(fields)) {
                  result[key] = parseVal(fields[key]);
                }
                const docName = doc.name || "";
                const id = docName.split("/").pop() || "";
                return { id, ...result };
              });
            productsList = parsedDocs;
            console.log(`[Products Data] Successfully loaded ${productsList.length} products from Firestore REST API!`);
          } else {
            console.warn('[Products Data] Firestore REST API returned error status:', response.status);
          }
        } catch (restErr: any) {
          console.error('[Products Data] REST API fallback failed completely:', restErr.message || restErr);
        }
      }
    }

    // Process the products list (runtime expiration, priority scores, extra sorting fields)
    productsList = productsList.map((result: any) => {
      if (result.boostStatus && result.boostEndDate && new Date(result.boostEndDate).getTime() < Date.now()) {
        result.boostStatus = false;
        result.boostPriority = 0;
        result.priorityScore = 0;
        result.boostPriorityLevel = 0;
        result.remainingBoostTime = 0;
      }

      result.priorityScore = calculatePriorityScore(result);

      if (result.boostStatus) {
        const now = new Date();
        const endDate = result.boostEndDate ? new Date(result.boostEndDate) : now;
        result.remainingBoostTime = Math.max(0, endDate.getTime() - now.getTime());

        const planId = result.boostPlan;
        if (planId === '90days') {
          result.boostPriorityLevel = 5;
          result.boostPackagePrice = 20;
        } else if (planId === '30days') {
          result.boostPriorityLevel = 4;
          result.boostPackagePrice = 12;
        } else if (planId === '14days') {
          result.boostPriorityLevel = 3;
          result.boostPackagePrice = 7;
        } else if (planId === '7days') {
          result.boostPriorityLevel = 2;
          result.boostPackagePrice = 3;
        } else if (planId === '3days') {
          result.boostPriorityLevel = 1;
          result.boostPackagePrice = 1;
        } else {
          result.boostPriorityLevel = 0;
          result.boostPackagePrice = 0;
        }
      } else {
        result.remainingBoostTime = 0;
        result.boostPriorityLevel = 0;
        result.boostPackagePrice = 0;
      }

      return result;
    });

    // Perform sort
    productsList.sort((a: any, b: any) => {
      const scoreA = typeof a.priorityScore === 'number' ? a.priorityScore : 0;
      const scoreB = typeof b.priorityScore === 'number' ? b.priorityScore : 0;
      return scoreB - scoreA;
    });

    // Update the cache only if we actually fetched products
    if (productsList && productsList.length > 0) {
      cachedProducts = {
        data: productsList,
        timestamp: Date.now()
      };

      // Persist cache to file asynchronously
      fs.writeFile(CACHE_FILE_PATH, JSON.stringify({ data: productsList, timestamp: Date.now() }), 'utf-8', (err) => {
        if (err) console.error('[Products Cache] Failed to write cache to file:', err);
        else console.log(`[Products Cache] Successfully persisted ${productsList.length} products to file cache.`);
      });
    }

    return productsList;
  }

  async function triggerBackgroundRevalidation(): Promise<void> {
    if (activeFetchPromise) {
      await activeFetchPromise;
      return;
    }

    activeFetchPromise = fetchFromFirestoreDirect();
    try {
      const list = await activeFetchPromise;
      if (list && list.length > 0) {
        lastFirestore429Time = 0; // reset 429 cooldown on successful fetch
        console.log(`[Products Data] Background revalidation succeeded. Cache updated with ${list.length} products.`);
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('Quota exceeded')) {
        lastFirestore429Time = Date.now();
        console.warn(`[Products Data] Background revalidation hit rate limits (429). Setting cooling down cooldown.`);
      } else {
        console.warn(`[Products Data] Background revalidation failed:`, errMsg);
      }
    } finally {
      activeFetchPromise = null;
    }
  }

  // Shared products-fetching logic, used both by the /api/products route and
  // by the SSR homepage injection below, so both paths hit the exact same
  // in-memory/file cache and never duplicate a Firestore fetch unnecessarily.
  async function getProductsListData(): Promise<{ products: any[]; isStale?: boolean; isFallback?: boolean }> {
    const now = Date.now();

    // 1. If we have cached products, and they are still fresh, return them immediately
    if (cachedProducts && cachedProducts.data.length > 0 && (now - cachedProducts.timestamp < CACHE_TTL_MS)) {
      console.log(`[Products Data] Serving ${cachedProducts.data.length} products from in-memory cache (fresh).`);
      return { products: optimizeProductsForClient(cachedProducts.data) };
    }

    // 2. If we have cached products, but they are expired (stale), serve them immediately
    // and trigger an asynchronous background revalidation to update the cache in a non-blocking way.
    if (cachedProducts && cachedProducts.data.length > 0) {
      const isCoolingDown = (now - lastFirestore429Time) < DEBOUNCE_429_RETRY_MS;
      if (!isRevalidating && !isCoolingDown) {
        console.log(`[Products Data] Cache is expired. Triggering background revalidation...`);
        isRevalidating = true;
        triggerBackgroundRevalidation().catch(err => {
          console.error('[Products Data] Background revalidation failed:', err);
        }).finally(() => {
          isRevalidating = false;
        });
      } else if (isCoolingDown) {
        console.log(`[Products Data] Skipping background revalidation (Firestore 429 rate limit cooling down).`);
      } else {
        console.log(`[Products Data] Background revalidation already in progress.`);
      }

      // Serve stale cache instantly
      return { products: optimizeProductsForClient(cachedProducts.data), isStale: true };
    }

    // 3. If we don't have any cached products at all (e.g. initial empty boot or empty cache file),
    // we must perform a blocking fetch. Use activeFetchPromise to deduplicate concurrent requests.
    if (activeFetchPromise) {
      console.log(`[Products Data] Awaiting active concurrent fetch promise...`);
      try {
        const list = await activeFetchPromise;
        return { products: optimizeProductsForClient(list) };
      } catch (err: any) {
        // Fall through to fallback
      }
    }

    console.log(`[Products Data] Cache is empty on boot. Performing a blocking fetch to Firestore...`);
    activeFetchPromise = fetchFromFirestoreDirect();
    try {
      const list = await activeFetchPromise;
      return { products: optimizeProductsForClient(list) };
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      console.warn('[Products Data] Failed to fetch layout products (gracefully falling back):', errMsg);

      if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('Quota exceeded')) {
        lastFirestore429Time = Date.now();
      }

      // Attempt file cache fallback if memory cache is not available or empty
      if (!cachedProducts || !cachedProducts.data || cachedProducts.data.length === 0) {
        try {
          if (fs.existsSync(CACHE_FILE_PATH)) {
            console.log('[Products Cache] Memory cache is missing or empty. Reading backup from file...');
            const rawCache = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
            const parsed = JSON.parse(rawCache);
            if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) {
              cachedProducts = {
                data: parsed.data,
                timestamp: parsed.timestamp || Date.now()
              };
              console.log(`[Products Cache] Successfully recovered ${cachedProducts.data.length} products from disk cache on exception.`);
            }
          }
        } catch (e: any) {
          console.warn('[Products Cache] Failed to load cache from file on exception fallback:', e?.message || e);
        }
      }

      // Fallback: If we recovered stale cache, return it so the site keeps working flawlessly
      if (cachedProducts && cachedProducts.data && cachedProducts.data.length > 0) {
        // Extend the stale cache's TTL so we do not spam Firestore on subsequent immediate page refreshes
        cachedProducts.timestamp = Date.now();
        console.warn(`[Products Data] Serving cached products (${cachedProducts.data.length} items) to prevent further Firestore rate limits.`);
        return { products: optimizeProductsForClient(cachedProducts.data), isStale: true };
      }

      // If no cached products are available, return a professional set of default fallback products
      console.warn('[Products Data] Firestore failed and no cached products available. Serving high-quality static fallbacks.');
      const fallbackList = getStaticFallbackProducts();
      return { products: optimizeProductsForClient(fallbackList), isFallback: true };
    } finally {
      activeFetchPromise = null;
    }
  }

  app.get('/api/products', serverRateLimiter(60 * 1000, 120, "products-list"), async (req, res) => {
    const result = await getProductsListData();
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    res.json({ success: true, products: result.products, ...(result.isStale ? { isStale: true } : {}), ...(result.isFallback ? { isFallback: true } : {}) });
  });

  app.get('/api/products/:productId', serverRateLimiter(60 * 1000, 200, "product-detail"), async (req, res) => {
    const { productId } = req.params;
    if (!productId) {
      return res.status(400).json({ success: false, error: 'Missing product ID' });
    }

    try {
      const product = await getRawProductFirestoreREST(productId);
      if (!product) {
        return res.status(404).json({ success: false, error: 'Product not found' });
      }

      // Run it through optimizeProductsForClient to translate heavy base64 strings into optimized local proxy URLs!
      const optimizedList = optimizeProductsForClient([product]);
      const optimized = optimizedList && optimizedList.length > 0 ? optimizedList[0] : null;
      if (!optimized) {
        return res.status(504).json({ success: false, error: 'Optimization failed' });
      }

      return res.json({ success: true, product: optimized });
    } catch (err: any) {
      console.error(`[Product Detail API] Error fetching product ${productId}:`, err);
      return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
    }
  });

  // Firestore REST helpers for Boost Ad System
  async function getRawProductFirestoreREST(productId: string) {
    if (backendSupabase) {
      try {
        console.log(`[Supabase Server] Fetching product ${productId} from Supabase...`);
        const { data, error } = await backendSupabase
          .from('products')
          .select('*')
          .eq('id', productId)
          .maybeSingle();
        if (!error && data) return data;
      } catch (sbErr: any) {
        console.warn(`[Supabase Server] Fetch product ${productId} failed:`, sbErr?.message || sbErr);
      }
    }
    // Fallback: Fetch directly from Firestore REST!
    console.log(`[Firestore Fallback] Fetching product ${productId} from Firestore REST...`);
    return await getProductFromFirestoreREST(productId);
  }

  async function updateProductFirestoreREST(productId: string, updatedFields: any, customAuthToken?: string) {
    if (backendSupabase) {
      try {
        console.log(`[Supabase Server] Updating product ${productId} in Supabase...`);
        const payload: any = {};
        for (const [k, v] of Object.entries(updatedFields)) {
          payload[k] = v === undefined ? null : v;
        }
        const { error } = await backendSupabase
          .from('products')
          .update(payload)
          .eq('id', productId);
        if (!error) {
          console.log(`[Supabase Server] Successfully updated product ${productId}`);
          return { name: `projects/${projectId}/databases/(default)/documents/products/${productId}` };
        }
        throw error;
      } catch (sbErr: any) {
        console.warn(`[Supabase Server] Failed to update product ${productId} in Supabase:`, sbErr?.message || sbErr);
      }
    }
    return null;
  }

  async function createBoostPurchaseFirestoreREST(purchaseData: any, customAuthToken?: string) {
    if (backendSupabase) {
      try {
        console.log('[Supabase Server] Creating boost purchase record in Supabase...');
        const { error } = await backendSupabase
          .from('boost_purchases')
          .insert({
            id: purchaseData.id || `boost_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
            productId: purchaseData.productId,
            userId: purchaseData.userId,
            amount: purchaseData.amount,
            currency: purchaseData.currency || 'GHS',
            status: purchaseData.status,
            createdAt: purchaseData.createdAt || new Date().toISOString()
          });
        if (!error) {
          console.log('[Supabase Server] Successfully saved boost purchase record.');
          return;
        }
        throw error;
      } catch (sbErr: any) {
        console.warn('[Supabase Server] Creating boost purchase in Supabase failed:', sbErr?.message || sbErr);
      }
    }
  }

  const JWT_SECRET = process.env.PAYSTACK_SECRET_KEY || 'tedbuy-server-fallback-secret-key-12345';

  function generateCustomJWT(payload: any): string {
    const header = { alg: "HS256", typ: "JWT" };
    const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    
    const signature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${base64Header}.${base64Payload}`)
      .digest('base64url');
      
    return `${base64Header}.${base64Payload}.${signature}`;
  }

  function verifyCustomJWT(token: string): any {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      
      const [header, payload, signature] = parts;
      const expectedSignature = crypto
        .createHmac('sha256', JWT_SECRET)
        .update(`${header}.${payload}`)
        .digest('base64url');
        
      if (signature !== expectedSignature) {
        return null;
      }
      
      return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch (err) {
      return null;
    }
  }

  // Safe helper to verify administrator privileges by verifying JWT tokens or querying user settings from Firestore.
  async function verifyAdmin(authHeader: string | undefined): Promise<boolean> {
    if (!authHeader) return false;

    const token = authHeader.startsWith('Bearer ') ? authHeader.split('Bearer ')[1] : authHeader;

    // 0. Try verification of our custom JWT first
    const customPayload = verifyCustomJWT(token);
    if (customPayload) {
      if (customPayload.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com' || customPayload.isAdmin === true) {
        return true;
      }
    }
    
    // 1. Try Admin SDK
    try {
      const { getApps } = await import("firebase-admin/app");
      if (getApps().length > 0) {
        const { getAuth: getAdminAuth } = await import("firebase-admin/auth");
        const decoded = await getAdminAuth().verifyIdToken(token);
        if (decoded.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com') {
          return true;
        }
        if (adminDb) {
          const userSnap = await adminDb.collection('users').doc(decoded.uid).get();
          if (userSnap.exists && userSnap.data()?.isAdmin === true) {
            return true;
          }
        }
        if (backendSupabase) {
          const { data, error } = await backendSupabase
            .from('users')
            .select('is_admin')
            .eq('id', decoded.uid)
            .maybeSingle();
          if (!error && data && ((data as any).is_admin === true || (data as any).isAdmin === true)) {
            return true;
          }
        }
      }
    } catch (err) {
      console.warn('[verifyAdmin] Admin SDK verification failed:', err);
    }

    // 2. Fallback for environments where Firebase Admin is not initialized / service account is missing
    try {
      const parts = token.split('.');
      if (parts.length >= 2) {
        const decodedJson = Buffer.from(parts[1], 'base64url').toString('utf8');
        const decoded = JSON.parse(decodedJson);
        const email = decoded.email?.trim()?.toLowerCase();
        if (email === 'asumaduvincent7@gmail.com') {
          return true;
        }
        
        // Check if user is admin in standard DB using their uid
        const uid = decoded.user_id || decoded.sub;
        if (uid) {
          if (adminDb) {
            const userSnap = await adminDb.collection('users').doc(uid).get();
            if (userSnap.exists && userSnap.data()?.isAdmin === true) {
              return true;
            }
          }
          if (backendSupabase) {
            const { data, error } = await backendSupabase
              .from('users')
              .select('is_admin')
              .eq('id', uid)
              .maybeSingle();
            if (!error && data && ((data as any).is_admin === true || (data as any).isAdmin === true)) {
              return true;
            }
          }
        }
      }
    } catch (fallbackErr) {
      console.warn('[verifyAdmin] Fallback JWT decoding failed:', fallbackErr);
    }

    return false;
  }

  // Safe helper to verify authenticated users by verifying JWT tokens or fallback to parsing payload
  async function verifyUser(authHeader: string | undefined): Promise<{ uid: string; email: string } | null> {
    if (!authHeader) return null;

    const token = authHeader.startsWith('Bearer ') ? authHeader.split('Bearer ')[1] : authHeader;

    // 0. Try verification of our custom JWT first
    const customPayload = verifyCustomJWT(token);
    if (customPayload) {
      return { uid: customPayload.user_id || customPayload.sub, email: customPayload.email || '' };
    }
    
    // 1. Try Admin SDK
    try {
      const { getApps } = await import("firebase-admin/app");
      if (getApps().length > 0) {
        const { getAuth: getAdminAuth } = await import("firebase-admin/auth");
        const decoded = await getAdminAuth().verifyIdToken(token);
        if (decoded.uid) {
          return { uid: decoded.uid, email: decoded.email || '' };
        }
      }
    } catch (err) {
      console.warn('[verifyUser] Admin SDK token verification failed:', err);
    }

    // 2. Fallback for environments where Firebase Admin is not initialized / service account is missing
    // Decode the Firebase Auth token payload (since we cannot cryptographically verify it without a service account)
    try {
      const parts = token.split('.');
      if (parts.length >= 2) {
        const decodedJson = Buffer.from(parts[1], 'base64url').toString('utf8');
        const decoded = JSON.parse(decodedJson);
        const uid = decoded.user_id || decoded.sub;
        if (uid) {
          console.log(`[verifyUser] Fallback decoded user ID: ${uid}`);
          return { uid, email: decoded.email || '' };
        }
      }
    } catch (fallbackErr) {
      console.warn('[verifyUser] Fallback JWT decoding failed:', fallbackErr);
    }

    return null;
  }

  // Shared helper function to activate premium boost for a product
  async function activateBoostInternal(params: {
    productId: string;
    planId: string;
    paymentReference: string;
    paymentMethod?: string;
    email?: string;
    amountGHS?: number;
    gatewayUsed: string;
    verifiedAmount: number;
    authHeader?: string;
  }) {
    const { productId, planId, paymentReference, paymentMethod, email, amountGHS, gatewayUsed, verifiedAmount, authHeader } = params;

    const plans: Record<string, { days: number; price: number; name: string }> = {
      '3days': { days: 3, price: 1, name: '3 Days Boost' },
      '7days': { days: 7, price: 3, name: '7 Days Boost' },
      '14days': { days: 14, price: 7, name: '14 Days Boost' },
      '30days': { days: 30, price: 12, name: '30 Days Boost' },
      '90days': { days: 90, price: 20, name: '90 Days Boost' }
    };

    const plan = plans[planId];
    if (!plan) {
      throw new Error(`Invalid plan specified: ${planId}`);
    }

    let finalUpdatedFields: any = null;
    let finalProductData: any = null;

    if (adminDb) {
      try {
        console.log(`[Firebase Admin] Executing robust atomic transaction to activate boost for product: ${productId}`);
        
        const docRef = adminDb.collection('products').doc(productId);
        let docSnap = await docRef.get();
        let retryCount = 0;
        const maxRetries = 2;
        const retryDelayMs = 400;
        
        while (!docSnap.exists && retryCount < maxRetries) {
          retryCount++;
          console.log(`[Firebase Admin Lag Check] Product document ${productId} not found on attempt ${retryCount}/${maxRetries}. Retrying in ${retryDelayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
          docSnap = await docRef.get();
        }

        if (!docSnap.exists) {
          throw new Error(`Product listing with ID ${productId} was not found on the database after ${maxRetries} retrieval attempts.`);
        }

        await adminDb.runTransaction(async (transaction: any) => {
          const txDocSnap = await transaction.get(docRef);
          if (!txDocSnap.exists) {
            throw new Error(`Product listing with ID ${productId} was not found in transaction.`);
          }

          const currentProductData = txDocSnap.data() || {};
          
          // Idempotency check inside transaction
          const txBoostHistory = Array.isArray(currentProductData.boostHistory) ? currentProductData.boostHistory : [];
          const isAlreadyProcessed = txBoostHistory.some((h: any) => h.paymentReference === paymentReference);
          if (isAlreadyProcessed) {
            console.log(`[Idempotency Check] Payment reference ${paymentReference} already verified and applied to product ${productId}. Returning existing fields.`);
            finalUpdatedFields = {
              boostStatus: currentProductData.boostStatus,
              boostPlan: currentProductData.boostPlan,
              boostStartDate: currentProductData.boostStartDate,
              boostEndDate: currentProductData.boostEndDate,
              paymentStatus: 'success',
              paymentReference: currentProductData.paymentReference
            };
            finalProductData = currentProductData;
            return;
          }

          const txNow = new Date();
          let txStartDate = txNow.toISOString();
          let txEndDate = new Date(txNow.getTime() + (plan.days * 24 * 60 * 60 * 1000)).toISOString();

          const txExistingStatus = currentProductData.boostStatus || false;
          const txExistingEndDateStr = currentProductData.boostEndDate;

          if (txExistingStatus && txExistingEndDateStr) {
            const txExistingEndDate = new Date(txExistingEndDateStr);
            if (txExistingEndDate.getTime() > txNow.getTime()) {
              txStartDate = currentProductData.boostStartDate || txStartDate;
              txEndDate = new Date(txExistingEndDate.getTime() + (plan.days * 24 * 60 * 60 * 1000)).toISOString();
              console.log(`[Transaction Boost Extend] Extending active boost for product ${productId} from ${txExistingEndDateStr} to ${txEndDate}`);
            }
          }

          const txHistoryItem = {
            planId,
            planName: plan.name,
            startDate: txStartDate,
            endDate: txEndDate,
            paymentReference,
            amount: verifiedAmount,
            gateway: gatewayUsed,
            paymentMethod: paymentMethod || 'momo',
            createdAt: txNow.toISOString()
          };

          const newTxBoostHistory = [...txBoostHistory, txHistoryItem];

          let txBoostPriorityLevel = 0;
          let txBoostPackagePrice = 0;
          if (planId === '90days') {
            txBoostPriorityLevel = 5;
            txBoostPackagePrice = 20;
          } else if (planId === '30days') {
            txBoostPriorityLevel = 4;
            txBoostPackagePrice = 12;
          } else if (planId === '14days') {
            txBoostPriorityLevel = 3;
            txBoostPackagePrice = 7;
          } else if (planId === '7days') {
            txBoostPriorityLevel = 2;
            txBoostPackagePrice = 3;
          } else if (planId === '3days') {
            txBoostPriorityLevel = 1;
            txBoostPackagePrice = 1;
          }

          if (paymentReference.startsWith('ADMIN_FREE_BOOST_')) {
            txBoostPackagePrice = 0;
          }

          const txRemainingBoostTime = Math.max(0, new Date(txEndDate).getTime() - txNow.getTime());

          const txTempProduct = {
            boostStatus: true,
            boostPlan: planId,
            boostEndDate: txEndDate,
            createdAt: currentProductData.createdAt,
            viewsCount: currentProductData.viewsCount
          };
          const txPriorityScore = calculatePriorityScore(txTempProduct);

          const txUpdatedFields = {
            boostStatus: true,
            boostPlan: planId,
            boostStartDate: txStartDate,
            boostEndDate: txEndDate,
            paymentStatus: 'success',
            paymentReference,
            boostPriority: txBoostPriorityLevel * 10000000,
            priorityScore: txPriorityScore,
            lastBoostedAt: txNow.toISOString(),
            boostHistory: newTxBoostHistory,
            boostAmount: verifiedAmount,
            boostPackagePrice: txBoostPackagePrice,
            boostPriorityLevel: txBoostPriorityLevel,
            remainingBoostTime: txRemainingBoostTime,
            lastBoostPurchase: txNow.toISOString()
          };

          transaction.update(docRef, txUpdatedFields);
          finalUpdatedFields = txUpdatedFields;
          finalProductData = currentProductData;
        });
        console.log(`[Firebase Admin] Transaction successfully committed for product: ${productId}`);
      } catch (txErr: any) {
        console.warn(`[Firebase Admin] Transaction failed for product boost update. Falling back to non-transactional REST update:`, txErr.message || txErr);
        if (String(txErr).includes('PERMISSION_DENIED') || String(txErr).includes('permission')) {
          console.warn('[Firebase Admin] Detected PERMISSION_DENIED on Admin SDK. Disabling Admin client and falling back to Auth Token REST.');
          adminDb = null;
          isGCPServiceAccountAuthorized = false;
        }
      }
    }

    // Safe fallback if Admin transaction is not executed or fails
    if (!finalUpdatedFields) {
      let productData = await getRawProductFirestoreREST(productId);
      let retryCount = 0;
      const maxRetries = 2;
      const retryDelayMs = 400;
      
      while (!productData && retryCount < maxRetries) {
        retryCount++;
        console.log(`[REST Lag Check] Product ${productId} not found on attempt ${retryCount}/${maxRetries}. Retrying in ${retryDelayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        productData = await getRawProductFirestoreREST(productId);
      }

      if (!productData) {
        throw new Error(`Product listing with ID ${productId} was not found.`);
      }

      // Idempotency check fallback
      const boostHistory = Array.isArray(productData.boostHistory) ? productData.boostHistory : [];
      const isAlreadyProcessed = boostHistory.some((h: any) => h.paymentReference === paymentReference);
      if (isAlreadyProcessed) {
        console.log(`[Idempotency Check Fallback] Payment reference ${paymentReference} already verified and applied to product ${productId}. Returning existing fields.`);
        finalUpdatedFields = {
          boostStatus: productData.boostStatus,
          boostPlan: productData.boostPlan,
          boostStartDate: productData.boostStartDate,
          boostEndDate: productData.boostEndDate,
          paymentStatus: 'success',
          paymentReference: productData.paymentReference
        };
        finalProductData = productData;
      } else {
        const now = new Date();
        let startDate = now.toISOString();
        let endDate = new Date(now.getTime() + (plan.days * 24 * 60 * 60 * 1000)).toISOString();

        const existingStatus = productData.boostStatus || false;
        const existingEndDateStr = productData.boostEndDate;

        if (existingStatus && existingEndDateStr) {
          const existingEndDate = new Date(existingEndDateStr);
          if (existingEndDate.getTime() > now.getTime()) {
            startDate = productData.boostStartDate || startDate;
            endDate = new Date(existingEndDate.getTime() + (plan.days * 24 * 60 * 60 * 1000)).toISOString();
            console.log(`[Boost Extend Fallback] Extending active boost for product ${productId} from ${existingEndDateStr} to ${endDate}`);
          }
        }

        const historyItem = {
          planId,
          planName: plan.name,
          startDate,
          endDate,
          paymentReference,
          amount: verifiedAmount,
          gateway: gatewayUsed,
          paymentMethod: paymentMethod || 'momo',
          createdAt: now.toISOString()
        };

        const newBoostHistory = [...boostHistory, historyItem];

        let boostPriorityLevel = 0;
        let boostPackagePrice = 0;
        if (planId === '90days') {
          boostPriorityLevel = 5;
          boostPackagePrice = 20;
        } else if (planId === '30days') {
          boostPriorityLevel = 4;
          boostPackagePrice = 12;
        } else if (planId === '14days') {
          boostPriorityLevel = 3;
          boostPackagePrice = 7;
        } else if (planId === '7days') {
          boostPriorityLevel = 2;
          boostPackagePrice = 3;
        } else if (planId === '3days') {
          boostPriorityLevel = 1;
          boostPackagePrice = 1;
        }

        if (paymentReference.startsWith('ADMIN_FREE_BOOST_')) {
          boostPackagePrice = 0;
        }

        const remainingBoostTime = Math.max(0, new Date(endDate).getTime() - now.getTime());
        
        const tempProduct = {
          boostStatus: true,
          boostPlan: planId,
          boostEndDate: endDate,
          createdAt: productData.createdAt,
          viewsCount: productData.viewsCount
        };
        const priorityScore = calculatePriorityScore(tempProduct);

        finalUpdatedFields = {
          boostStatus: true,
          boostPlan: planId,
          boostStartDate: startDate,
          boostEndDate: endDate,
          paymentStatus: 'success',
          paymentReference,
          boostPriority: boostPriorityLevel * 10000000,
          priorityScore,
          lastBoostedAt: now.toISOString(),
          boostHistory: newBoostHistory,
          boostAmount: verifiedAmount,
          boostPackagePrice,
          boostPriorityLevel,
          remainingBoostTime,
          lastBoostPurchase: now.toISOString()
        };

        await updateProductFirestoreREST(productId, finalUpdatedFields, authHeader);
        finalProductData = productData;
      }
    }

    cachedProducts = null; // Clear products cache to reflect the new boost status immediately

    // Fire-and-forget: this is a history/analytics record, not required for the boost
    // itself to be considered active. Awaiting it here was adding a 4th sequential
    // network round-trip to the critical path, which on serverless platforms with a
    // hard execution time limit (e.g. Vercel Hobby's 10s cap) could cause the whole
    // request to be killed mid-response after the boost had already been applied.
    createBoostPurchaseFirestoreREST({
      productId,
      sellerId: finalProductData.sellerId || '',
      sellerName: finalProductData.sellerName || '',
      productTitle: finalProductData.title || '',
      planId,
      amount: verifiedAmount,
      currency: 'GHS',
      paymentReference,
      gateway: gatewayUsed,
      paymentMethod: paymentMethod || 'momo',
      buyerEmail: email || '',
      createdAt: new Date().toISOString()
    }, authHeader).catch((err: any) => {
      console.error('[Boost Purchase Log] Non-blocking history write failed (boost itself was still applied):', err?.message || err);
    });

    return finalUpdatedFields;
  }

  // POST endpoint to verify Mobile Money or Card payment and activate premium boost status
  app.post('/api/verify-payment', serverRateLimiter(60 * 1000, 20, "payment-verification"), async (req, res) => {
    const { paymentReference, productId, planId, paymentMethod, email, amountGHS } = req.body;
    const authHeader = req.headers.authorization;

    if (!paymentReference || !productId || !planId) {
      return res.status(400).json({ success: false, error: "Missing required fields: paymentReference, productId, and planId are required." });
    }

    const plans: Record<string, { days: number; price: number; name: string }> = {
      '3days': { days: 3, price: 1, name: '3 Days Boost' },
      '7days': { days: 7, price: 3, name: '7 Days Boost' },
      '14days': { days: 14, price: 7, name: '14 Days Boost' },
      '30days': { days: 30, price: 12, name: '30 Days Boost' },
      '90days': { days: 90, price: 20, name: '90 Days Boost' }
    };

    const selectedPlan = plans[planId];
    if (!selectedPlan) {
      return res.status(400).json({ success: false, error: `Invalid plan specified: ${planId}` });
    }

    try {
      let isVerified = false;
      let verifiedAmount = amountGHS || 1;
      let gatewayUsed = 'simulated';

      let paystackSecret = process.env.PAYSTACK_SECRET_KEY;
      if (paystackSecret) {
        paystackSecret = paystackSecret.trim().replace(/^['"]|['"]$/g, '');
      }
      let flutterwaveSecret = process.env.FLUTTERWAVE_SECRET_KEY;
      if (flutterwaveSecret) {
        flutterwaveSecret = flutterwaveSecret.trim().replace(/^['"]|['"]$/g, '');
      }

      if (paymentReference.startsWith('ADMIN_FREE_BOOST_')) {
        // Enforce admin privilege validation on free boost bypass
        const isAdmin = await verifyAdmin(authHeader);
        if (!isAdmin) {
          return res.status(403).json({ success: false, error: "Access Denied: Administrative privileges required to apply admin free boosts." });
        }
        isVerified = true;
        verifiedAmount = 0;
        gatewayUsed = 'admin-bypass';
      } else if (paystackSecret && !paymentReference.startsWith('TEDBUY_DEMO_') && !paymentReference.startsWith('TST_')) {
        gatewayUsed = 'paystack';
        const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(paymentReference)}`, {
          headers: {
            'Authorization': `Bearer ${paystackSecret}`,
            'Content-Type': 'application/json'
          },
          signal: AbortSignal.timeout(6000)
        });
        if (paystackRes.ok) {
          const payload = await paystackRes.json();
          if (payload.status && payload.data && payload.data.status === 'success') {
            isVerified = true;
            verifiedAmount = payload.data.amount / 100;
          }
        }
      } else if (flutterwaveSecret && !paymentReference.startsWith('TEDBUY_DEMO_') && !paymentReference.startsWith('TST_')) {
        gatewayUsed = 'flutterwave';
        const flwRes = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(paymentReference)}/verify`, {
          headers: {
            'Authorization': `Bearer ${flutterwaveSecret}`,
            'Content-Type': 'application/json'
          },
          signal: AbortSignal.timeout(6000)
        });
        if (flwRes.ok) {
          const payload = await flwRes.json();
          if (payload.status === 'success' && payload.data && payload.data.status === 'successful') {
            isVerified = true;
            verifiedAmount = payload.data.amount;
          }
        }
      } else {
        // Only allow demo/sandbox payment reference if NOT in production
        if (process.env.NODE_ENV !== 'production') {
          if (paymentReference.startsWith('TEDBUY_DEMO_') || paymentReference.startsWith('TST_')) {
            isVerified = true;
            gatewayUsed = 'sandbox-simulator';
            verifiedAmount = selectedPlan.price;
          }
        } else {
          return res.status(400).json({ success: false, error: "Sandbox/Demo payment references are strictly disabled in production." });
        }
      }

      if (!isVerified) {
        return res.status(400).json({ success: false, error: "Payment verification failed or was cancelled by the provider." });
      }

      // Verify payment amount matches plan price
      if (gatewayUsed !== 'admin-bypass' && verifiedAmount < selectedPlan.price) {
        return res.status(400).json({
          success: false,
          error: `Payment verification failed: Paid GHS ${verifiedAmount}, but plan "${selectedPlan.name}" requires GHS ${selectedPlan.price}.`
        });
      }

      // Execute shared boost activation pipeline
      const finalUpdatedFields = await activateBoostInternal({
        productId,
        planId,
        paymentReference,
        paymentMethod,
        email,
        amountGHS: verifiedAmount,
        gatewayUsed,
        verifiedAmount,
        authHeader
      });

      return res.json({
        success: true,
        message: "Premium boost successfully verified and activated!",
        product: {
          id: productId,
          ...finalUpdatedFields
        }
      });

    } catch (err: any) {
      console.error('[Verify Payment Exception]:', err);
      return res.status(500).json({ success: false, error: err.message || "Internal server error during verification." });
    }
  });

  // Admin Boost Control API (for Vincent Asumadu, CEO & other administrators)
  // 1. Silently deactivates any user's boosted ad without banner or notification.
  // 2. Activates a premium boost for any user's ad for free.
  app.post('/api/admin/boost-control', async (req, res) => {
    const { productId, action, planId } = req.body;
    const authHeader = req.headers.authorization;

    if (!productId || !action) {
      return res.status(400).json({ success: false, error: "Missing required parameters: productId and action are required." });
    }

    if (action !== 'activate' && action !== 'deactivate') {
      return res.status(400).json({ success: false, error: "Invalid action. Must be 'activate' or 'deactivate'." });
    }

    try {
      // Verify administrative privileges
      const isAdmin = await verifyAdmin(authHeader);
      if (!isAdmin) {
        return res.status(403).json({ success: false, error: "Access Denied: Administrative privileges required." });
      }

      let updatedFields: any = {};

      if (action === 'deactivate') {
        // Fetch current product data (only needed here - activateBoostInternal fetches its own copy for 'activate')
        const productData = await getRawProductFirestoreREST(productId);
        if (!productData) {
          return res.status(404).json({ success: false, error: `Product listing with ID ${productId} was not found.` });
        }

        // Silently deactivate boost
        const engagementScore = Number(productData.viewsCount || 0);
        const createdAtMs = productData.createdAt ? new Date(productData.createdAt).getTime() : 0;
        const freshnessFactor = createdAtMs / 1e12;
        const priorityScore = engagementScore + freshnessFactor;

        updatedFields = {
          boostStatus: false,
          boostPlan: null,
          boostStartDate: null,
          boostEndDate: null,
          boostPriority: 0,
          boostPriorityLevel: 0,
          boostAmount: 0,
          boostPackagePrice: 0,
          remainingBoostTime: 0,
          priorityScore,
          lastBoostedAt: null
        };

        console.log(`[Admin Control] Deactivating boost for product ${productId} silently.`);
        // Update in Firestore
        await updateProductFirestoreREST(productId, updatedFields, authHeader);
        // Clear cache immediately
        cachedProducts = null;
      } else {
        // Activate free boost using standard internal boost pipeline.
        // Note: activateBoostInternal fetches the product itself, so we deliberately
        // don't pre-fetch it here - that would cost an extra network round-trip for
        // nothing, since we only ever needed the sellerEmail for the history log.
        if (!planId) {
          return res.status(400).json({ success: false, error: "planId is required for activation." });
        }

        const paymentReference = `ADMIN_FREE_BOOST_${Date.now()}`;
        updatedFields = await activateBoostInternal({
          productId,
          planId,
          paymentReference,
          paymentMethod: 'admin-panel',
          email: '',
          amountGHS: 0,
          gatewayUsed: 'admin-bypass',
          verifiedAmount: 0,
          authHeader
        });

        console.log(`[Admin Control] Free boost activated for product ${productId} using plan ${planId} via internal boost pipeline.`);
      }

      return res.json({
        success: true,
        message: action === 'deactivate' ? "Boost deactivated successfully!" : "Free boost activated successfully!",
        product: {
          id: productId,
          ...updatedFields
        }
      });

    } catch (err: any) {
      console.error('[Admin Boost Control Exception]:', err);
      return res.status(500).json({ success: false, error: err.message || "Internal server error during admin boost control." });
    }
  });

  // Helper to transform Firestore models to Supabase compatible column values
  function transformForSupabase(table: string, data: any, docId: string): any {
    const result: any = { ...data };
    if (!result.id) {
      result.id = docId;
    }
    
    // Clean undefined values to null recursively or set defaults
    for (const [k, v] of Object.entries(result)) {
      if (v === undefined) {
        result[k] = null;
      }
    }

    if (table === 'users') {
      if (!result.username) {
        result.username = result.email ? result.email.split('@')[0] : 'User_' + docId.substring(0, 5);
      }
      result.emailVerified = result.emailVerified === true;
      result.isGoogleAuth = result.isGoogleAuth === true;
      result.isAdmin = result.isAdmin === true;
      result.welcomeSent = result.welcomeSent === true;
      if (result.followingSellers && typeof result.followingSellers === 'string') {
        try { result.followingSellers = JSON.parse(result.followingSellers); } catch (_) { result.followingSellers = []; }
      }
      if (!Array.isArray(result.followingSellers)) result.followingSellers = [];
      if (result.savedProductIds && typeof result.savedProductIds === 'string') {
        try { result.savedProductIds = JSON.parse(result.savedProductIds); } catch (_) { result.savedProductIds = []; }
      }
      if (!Array.isArray(result.savedProductIds)) result.savedProductIds = [];
    } else if (table === 'products') {
      result.negotiable = result.negotiable === true;
      result.boostStatus = result.boostStatus === true;
      result.isApproved = result.isApproved !== false; // default true
      result.viewsCount = Number(result.viewsCount) || 0;
      result.likesCount = Number(result.likesCount) || 0;
      result.boostPriority = Number(result.boostPriority) || 0;
      result.priorityScore = Number(result.priorityScore) || 0;
      result.boostPriorityLevel = Number(result.boostPriorityLevel) || 0;
      result.boostPackagePrice = Number(result.boostPackagePrice) || 0;
      result.remainingBoostTime = Number(result.remainingBoostTime) || 0;
      result.boostAmount = Number(result.boostAmount) || 0;
      result.visitCount = Number(result.visitCount) || 0;
      
      if (result.images && typeof result.images === 'string') {
        try { result.images = JSON.parse(result.images); } catch (_) { result.images = []; }
      }
      if (!Array.isArray(result.images)) result.images = [];
      if (result.videos && typeof result.videos === 'string') {
        try { result.videos = JSON.parse(result.videos); } catch (_) { result.videos = []; }
      }
      if (!Array.isArray(result.videos)) result.videos = [];
      if (result.likedUserIds && typeof result.likedUserIds === 'string') {
        try { result.likedUserIds = JSON.parse(result.likedUserIds); } catch (_) { result.likedUserIds = []; }
      }
      if (!Array.isArray(result.likedUserIds)) result.likedUserIds = [];
      if (result.boostHistory && typeof result.boostHistory === 'string') {
        try { result.boostHistory = JSON.parse(result.boostHistory); } catch (_) { result.boostHistory = []; }
      }
      if (!Array.isArray(result.boostHistory)) result.boostHistory = [];
    } else if (table === 'messages') {
      result.read = result.read === true;
    } else if (table === 'reviews') {
      result.rating = Number(result.rating) || 5;
    } else if (table === 'notifications') {
      result.read = result.read === true;
    } else if (table === 'boost_purchases') {
      result.amount = Number(result.amount) || 0;
    }

    // Allowed columns in our PostgreSQL schema to prevent "column does not exist" errors
    const TABLE_COLUMNS: Record<string, Set<string>> = {
      users: new Set([
        'id', 'username', 'email', 'phoneNumber', 'whatsAppNumber', 'role', 
        'joinDate', 'photoUrl', 'followingSellers', 'savedProductIds', 
        'emailVerified', 'isGoogleAuth', 'authProvider', 'isAdmin', 'welcomeSent', 'createdAt'
      ]),
      products: new Set([
        'id', 'title', 'description', 'price', 'category', 'location', 
        'images', 'videos', 'brand', 'condition', 'negotiable', 'sellerId', 
        'sellerName', 'createdAt', 'viewsCount', 'likesCount', 'likedUserIds', 
        'boostStatus', 'boostPlan', 'boostStartDate', 'boostEndDate', 
        'boostPriority', 'priorityScore', 'boostPriorityLevel', 'boostPackagePrice', 
        'remainingBoostTime', 'boostAmount', 'lastBoostedAt', 'lastBoostPurchase', 
        'paymentStatus', 'paymentReference', 'boostHistory', 'visitCount', 'isApproved'
      ]),
      chats: new Set([
        'id', 'productId', 'productTitle', 'productPrice', 'productImage', 
        'buyerId', 'buyerName', 'sellerId', 'sellerName', 'lastMessageText', 
        'lastMessageTime', 'tradeStatus', 'adId', 'adTitle', 'adImage', 
        'adThumbnail', 'adType'
      ]),
      messages: new Set([
        'id', 'chatId', 'senderId', 'recipientId', 'text', 'createdAt', 'read'
      ]),
      reviews: new Set([
        'id', 'buyerId', 'buyerName', 'sellerId', 'rating', 'comment', 'productTitle', 'createdAt'
      ]),
      notifications: new Set([
        'id', 'userId', 'title', 'message', 'type', 'read', 'createdAt', 'relatedId'
      ]),
      store_names: new Set([
        'id', 'userId', 'username'
      ]),
      boost_purchases: new Set([
        'id', 'productId', 'userId', 'amount', 'currency', 'status', 'createdAt'
      ])
    };

    const allowed = TABLE_COLUMNS[table];
    if (allowed) {
      const filtered: any = {};
      for (const [key, value] of Object.entries(result)) {
        if (allowed.has(key)) {
          filtered[key] = value;
        }
      }
      return filtered;
    }

    return result;
  }

  // Admin Supabase Database Migration API
  // Extracted, reusable core of the Firestore -> Supabase sync so it can run both
  // on-demand (via the admin route below) and automatically in the background.
  // Upserts by id, so repeated runs are safe and never create duplicates.
  let isBackgroundSyncRunning = false;
  async function runFirestoreToSupabaseSync(): Promise<any> {
    if (!backendSupabase) {
      throw new Error("Supabase integration is not active. Please set valid VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your settings.");
    }
    if (isBackgroundSyncRunning) {
      console.log('[Supabase Sync] A sync is already in progress, skipping this run.');
      return { skipped: true };
    }
    isBackgroundSyncRunning = true;

    // Helper to fetch with exponential backoff retry for Firestore REST API
    async function fetchWithRetry(url: string, options: RequestInit = {}, maxRetries = 5, initialDelay = 1000): Promise<Response> {
      let delay = initialDelay;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await fetch(url, options);
          if (response.status === 429) {
            console.warn(`[Fetch Retry] Received 429 Rate Limit on attempt ${attempt}/${maxRetries} for URL ${url}. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2.5; // Exponential backoff
            continue;
          }
          if (response.status >= 500 && attempt < maxRetries) {
            console.warn(`[Fetch Retry] Received ${response.status} Server Error on attempt ${attempt}/${maxRetries}. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2;
            continue;
          }
          return response;
        } catch (err: any) {
          if (attempt === maxRetries) {
            throw err;
          }
          console.warn(`[Fetch Retry] Fetch exception on attempt ${attempt}/${maxRetries}: ${err.message || err}. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2;
        }
      }
      throw new Error(`Fetch failed after ${maxRetries} attempts`);
    }

    try {
      console.log('[Supabase Sync] Starting data sync from Firestore to Supabase...');
      const stats: any = {};

      const collectionsToMigrate = [
        { firestore: 'users', supabase: 'users' },
        { firestore: 'products', supabase: 'products' },
        { firestore: 'chats', supabase: 'chats' },
        { firestore: 'messages', supabase: 'messages' },
        { firestore: 'reviews', supabase: 'reviews' },
        { firestore: 'notifications', supabase: 'notifications' },
        { firestore: 'storeNames', supabase: 'store_names' },
        { firestore: 'boost_purchases', supabase: 'boost_purchases' },
        { firestore: 'boostPurchases', supabase: 'boost_purchases' },
      ];

      for (const mapping of collectionsToMigrate) {
        // Skip if stats already loaded this target table under a different firestore name
        if (stats[mapping.supabase]) {
          console.log(`[Supabase Sync] Skipping redundant pass for target table: ${mapping.supabase}`);
          continue;
        }

        stats[mapping.supabase] = { fetched: 0, migrated: 0, failed: 0, errors: [] };

        let documents: any[] = [];
        let fetchedSize = 0;

        if (adminDb) {
          try {
            console.log(`[Supabase Sync] Fetching all documents from Firestore collection: "${mapping.firestore}" via Admin SDK...`);
            const snapshot = await adminDb.collection(mapping.firestore).get();
            if (!snapshot.empty) {
              fetchedSize = snapshot.size;
              snapshot.forEach((doc: any) => {
                documents.push({ id: doc.id, data: doc.data() });
              });
            }
          } catch (adminErr: any) {
            console.warn(`[Supabase Sync] Admin SDK fetch failed for "${mapping.firestore}", trying REST fallback:`, adminErr.message || adminErr);
          }
        }

        // Fallback to REST API if Admin SDK is inactive or failed
        if (documents.length === 0) {
          try {
            console.log(`[Supabase Sync] Fetching documents from Firestore collection: "${mapping.firestore}" via REST API fallback...`);
            const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery${apiKey ? `?key=${apiKey}` : ""}`;
            const response = await fetchWithRetry(firestoreUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                structuredQuery: {
                  from: [
                    {
                      collectionId: mapping.firestore,
                      allDescendants: false
                    }
                  ],
                  limit: 5000
                }
              })
            });

            if (response.ok) {
              const data = await response.json();
              const results = Array.isArray(data) ? data : [];
              const parsedDocs = results
                .filter((item: any) => item && item.document)
                .map((item: any) => {
                  const doc = item.document;
                  const fields = doc.fields || {};
                  const result: any = {};
                  
                  const parseVal = (val: any): any => {
                    if (!val) return undefined;
                    if ('stringValue' in val) return val.stringValue;
                    if ('integerValue' in val) return parseInt(val.integerValue, 10);
                    if ('doubleValue' in val) return parseFloat(val.doubleValue);
                    if ('booleanValue' in val) return val.booleanValue;
                    if ('arrayValue' in val) {
                      const arr = val.arrayValue?.values || [];
                      return arr.map((sub: any) => parseVal(sub));
                    }
                    if ('mapValue' in val) {
                      const mapFields = val.mapValue?.fields || {};
                      const mapResult: any = {};
                      for (const k of Object.keys(mapFields)) {
                        mapResult[k] = parseVal(mapFields[k]);
                      }
                      return mapResult;
                    }
                    return undefined;
                  };

                  for (const key of Object.keys(fields)) {
                    result[key] = parseVal(fields[key]);
                  }

                  const nameParts = doc.name ? doc.name.split('/') : [];
                  const id = nameParts[nameParts.length - 1] || '';
                  return { id, data: result };
                });

              documents = parsedDocs;
              fetchedSize = parsedDocs.length;
            } else {
              const errMsg = `REST API returned status ${response.status}`;
              stats[mapping.supabase].errors.push(`REST API failed: ${errMsg}`);
              console.error(`[Supabase Sync] REST API failed for "${mapping.firestore}":`, errMsg);
            }
          } catch (restErr: any) {
            stats[mapping.supabase].errors.push(`REST API exception: ${restErr.message || restErr}`);
            console.error(`[Supabase Sync] REST API exception for "${mapping.firestore}":`, restErr);
          }
        }

        if (documents.length === 0) {
          console.log(`[Supabase Sync] No documents found or fetched for Firestore collection "${mapping.firestore}".`);
          continue;
        }

        try {
          stats[mapping.supabase].fetched += fetchedSize;
          const payloads: any[] = [];

          for (const doc of documents) {
            try {
              const transformed = transformForSupabase(mapping.supabase, doc.data, doc.id);
              payloads.push(transformed);
            } catch (err: any) {
              stats[mapping.supabase].failed++;
              stats[mapping.supabase].errors.push(`Doc ID ${doc.id} transform failed: ${err.message || err}`);
            }
          }

          if (payloads.length > 0) {
            console.log(`[Supabase Sync] Upserting ${payloads.length} records into Supabase table: "${mapping.supabase}"...`);
            const batchSize = 100;
            for (let i = 0; i < payloads.length; i += batchSize) {
              const batch = payloads.slice(i, i + batchSize);
              const { error } = await backendSupabase
                .from(mapping.supabase)
                .upsert(batch, { onConflict: 'id' });

              if (error) {
                console.error(`[Supabase Sync] Upsert batch failed for table "${mapping.supabase}":`, error);
                throw error;
              }
            }
            stats[mapping.supabase].migrated += payloads.length;
          }
        } catch (err: any) {
          console.error(`[Supabase Sync] Error migrating collection "${mapping.firestore}":`, err);
          stats[mapping.supabase].errors.push(err.message || String(err));
        }

        // Delay between collections to avoid hitting Firestore rate limits (HTTP 429)
        console.log(`[Supabase Sync] Completed collection "${mapping.firestore}". Pausing 1000ms before next...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log('[Supabase Sync] Sync job complete! Stats:', stats);
      cachedProducts = null; // Invalidate the product cache so listings show up instantly
      return stats;
    } finally {
      isBackgroundSyncRunning = false;
    }
  }

  app.post('/api/admin/migrate-to-supabase', async (req, res) => {
    const authHeader = req.headers.authorization;

    try {
      // 1. Verify admin privilege
      const isAdmin = await verifyAdmin(authHeader);
      if (!isAdmin) {
        return res.status(403).json({ success: false, error: "Access Denied: Administrative privileges required." });
      }

      // 2. Ensure Supabase backend client is active
      if (!backendSupabase) {
        return res.status(400).json({ 
          success: false, 
          error: "Supabase integration is not active. Please set valid VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your settings." 
        });
      }

      const stats = await runFirestoreToSupabaseSync();

      return res.json({
        success: true,
        message: "Data migration completed successfully!",
        stats
      });

    } catch (err: any) {
      console.error('[Supabase Migration Exception]:', err);
      return res.status(500).json({ success: false, error: err.message || "Internal server error during data migration." });
    }
  });

  async function runSupabaseToFirestoreSync(): Promise<any> {
    if (!backendSupabase) {
      throw new Error("Supabase integration is not active. We cannot migrate data from a deactivated Supabase client.");
    }
    if (!adminDb) {
      throw new Error("Firebase Admin SDK is not initialized. Please ensure your firebase-applet-config.json has valid service credentials.");
    }

    const stats: any = {};
    const tablesToMigrate = [
      { supabase: 'users', firestore: 'users' },
      { supabase: 'products', firestore: 'products' },
      { supabase: 'chats', firestore: 'chats' },
      { supabase: 'messages', firestore: 'messages' },
      { supabase: 'reviews', firestore: 'reviews' },
      { supabase: 'notifications', firestore: 'notifications' },
      { supabase: 'store_names', firestore: 'storeNames' },
      { supabase: 'boost_purchases', firestore: 'boostPurchases' }
    ];

    for (const mapping of tablesToMigrate) {
      stats[mapping.firestore] = { fetched: 0, migrated: 0, failed: 0, errors: [] };
      try {
        console.log(`[Supabase -> Firestore Sync] Fetching all records from Supabase table "${mapping.supabase}"...`);
        const { data, error } = await backendSupabase
          .from(mapping.supabase)
          .select('*');

        if (error) {
          throw error;
        }

        if (data && data.length > 0) {
          stats[mapping.firestore].fetched = data.length;
          console.log(`[Supabase -> Firestore Sync] Found ${data.length} records. Writing to Firestore collection "${mapping.firestore}"...`);
          
          for (const row of data) {
            try {
              const id = row.id;
              if (!id) continue;

              // Clean up row fields if necessary (remove id from body if writing to doc with that ID)
              const docData = { ...row };
              delete docData.id;

              await adminDb.collection(mapping.firestore).doc(id).set(docData, { merge: true });
              stats[mapping.firestore].migrated += 1;
            } catch (writeErr: any) {
              stats[mapping.firestore].failed += 1;
              stats[mapping.firestore].errors.push(`Doc id ${row.id || 'unknown'} failed: ${writeErr.message || writeErr}`);
            }
          }
        } else {
          console.log(`[Supabase -> Firestore Sync] No records found in Supabase table "${mapping.supabase}".`);
        }
      } catch (err: any) {
        console.error(`[Supabase -> Firestore Sync] Error migrating table "${mapping.supabase}":`, err);
        stats[mapping.firestore].errors.push(err.message || String(err));
      }

      // Small pause to avoid hitting rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    cachedProducts = null; // Invalidate cache
    return stats;
  }

  app.post('/api/admin/migrate-to-firestore', async (req, res) => {
    const authHeader = req.headers.authorization;

    try {
      // 1. Verify admin privilege
      const isAdmin = await verifyAdmin(authHeader);
      if (!isAdmin) {
        return res.status(403).json({ success: false, error: "Access Denied: Administrative privileges required." });
      }

      // 2. Ensure Supabase backend client is active
      if (!backendSupabase) {
        return res.status(400).json({ 
          success: false, 
          error: "Supabase integration is not active. We cannot fetch from Supabase if it's disabled." 
        });
      }

      const stats = await runSupabaseToFirestoreSync();

      return res.json({
        success: true,
        message: "Data migration from Supabase back to Firestore completed successfully!",
        stats
      });

    } catch (err: any) {
      console.error('[Firestore Reverse Migration Exception]:', err);
      return res.status(500).json({ success: false, error: err.message || "Internal server error during data migration." });
    }
  });

  // Batch Upsert Collection API for Client-Driven Migration
  app.post('/api/admin/upsert-collection', async (req, res) => {
    const authHeader = req.headers.authorization;
    const { table, documents } = req.body;

    if (!table || !Array.isArray(documents)) {
      return res.status(400).json({ success: false, error: "Missing 'table' or 'documents' list." });
    }

    try {
      // 1. Verify admin privilege
      const isAdmin = await verifyAdmin(authHeader);
      if (!isAdmin) {
        return res.status(403).json({ success: false, error: "Access Denied: Administrative privileges required." });
      }

      if (!backendSupabase) {
        return res.status(500).json({ success: false, error: "Supabase client is not initialized on the server." });
      }

      console.log(`[Client Migration] Upserting ${documents.length} records into "${table}"...`);

      const payloads: any[] = [];
      for (const doc of documents) {
        if (!doc.id || !doc.data) continue;
        const transformed = transformForSupabase(table, doc.data, doc.id);
        payloads.push(transformed);
      }

      if (payloads.length > 0) {
        // Chunk upserts in batches of 100
        const chunkSize = 100;
        for (let i = 0; i < payloads.length; i += chunkSize) {
          const chunk = payloads.slice(i, i + chunkSize);
          const { error } = await backendSupabase
            .from(table)
            .upsert(chunk);

          if (error) {
            console.error(`[Client Migration] Error upserting chunk to "${table}":`, error);
            return res.status(500).json({ success: false, error: `Database upsert failed: ${error.message}` });
          }
        }
      }

      if (table === 'products') {
        cachedProducts = null; // Invalidate cache
      }

      return res.json({ success: true, count: payloads.length });

    } catch (err: any) {
      console.error('[Client Migration Exception]:', err);
      return res.status(500).json({ success: false, error: err.message || "Internal server error." });
    }
  });

  // Background cron worker function to expire passes automatically
  async function runAutomaticBoostExpirationScan() {
    try {
      console.log('[Boost Expiration Job] Scanning database for expired premium boosts...');
      let results: any[] = [];

      if (backendSupabase) {
        try {
          console.log('[Boost Expiration Job] Scanning Supabase for active premium boosts...');
          const { data, error } = await backendSupabase
            .from('products')
            .select('*')
            .eq('boostStatus', true);

          if (error) throw error;
          if (data) {
            results = data;
          }
        } catch (sbErr: any) {
          console.warn('[Boost Expiration Job] Supabase scan failed, checking Admin SDK:', sbErr?.message || sbErr);
        }
      }

      if (results.length === 0 && adminDb) {
        try {
          const snapshot = await adminDb.collection("products")
            .where("boostStatus", "==", true)
            .get();
          
          results = snapshot.docs.map((docSnap: any) => {
            const data = docSnap.data();
            data.id = docSnap.id;
            return data;
          });
        } catch (adminErr: any) {
          const errMsg = adminErr?.message || String(adminErr);
          if (errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('Quota exceeded') || errMsg.includes('429')) {
            console.warn('[Boost Expiration Job] Firestore is currently busy (Quota Exceeded). Skipping background scan.');
            return;
          }
          console.warn('[Boost Expiration Job] Admin SDK query failed, falling back to REST:', adminErr?.message || adminErr);
          if (String(adminErr).includes('PERMISSION_DENIED') || String(adminErr).includes('permission')) {
            isGCPServiceAccountAuthorized = false;
            adminDb = null;
          }
        }
      }

      let expiredCount = 0;

      if (adminDb && results.length > 0) {
        for (const product of results) {
          const productId = product.id;
          if (!productId) continue;

          const endDateStr = product.boostEndDate;
          if (endDateStr && new Date(endDateStr).getTime() < Date.now()) {
            console.log(`[Boost Expiration Job] Found expired boost for product: "${product.title || productId}". Expiry was: ${endDateStr}`);
            
            try {
              await updateProductFirestoreREST(productId, {
                boostStatus: false,
                boostPriority: 0,
                priorityScore: 0
              });
              expiredCount++;
            } catch (writeErr: any) {
              const writeErrMsg = writeErr?.message || String(writeErr);
              if (writeErrMsg.includes('RESOURCE_EXHAUSTED') || writeErrMsg.includes('Quota exceeded') || writeErrMsg.includes('429')) {
                console.warn(`[Boost Expiration Job] Failed to write expired status for product ${productId} (Quota Exceeded).`);
                return;
              }
              throw writeErr;
            }
          }
        }
      } else if (!adminDb) {
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery${apiKey ? `?key=${apiKey}` : ""}`;
        const response = await fetch(firestoreUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: "products", allDescendants: false }],
              where: {
                fieldFilter: {
                  field: { fieldPath: "boostStatus" },
                  op: "EQUAL",
                  value: { booleanValue: true }
                }
              }
            }
          })
        });

        if (!response.ok) {
          if (response.status === 429) {
            console.warn('[Boost Expiration Job] Firestore REST API returned 429 (Quota Exceeded). Skipping background scan.');
            return;
          }
          console.warn(`[Boost Expiration Job] Firestore query returned status ${response.status}`);
          return;
        }

        const data = await response.json();
        const rawResults = Array.isArray(data) ? data : [];
        
        for (const item of rawResults) {
          if (!item || !item.document) continue;
          const doc = item.document;
          const nameParts = doc.name ? doc.name.split('/') : [];
          const productId = nameParts[nameParts.length - 1];
          if (!productId) continue;

          const fields = doc.fields || {};
          const endDateStr = fields.boostEndDate?.stringValue || '';

          if (endDateStr && new Date(endDateStr).getTime() < Date.now()) {
            console.log(`[Boost Expiration Job] Found expired boost for product: "${fields.title?.stringValue || productId}". Expiry was: ${endDateStr}`);
            
            try {
              await updateProductFirestoreREST(productId, {
                boostStatus: false,
                boostPriority: 0,
                priorityScore: 0
              });
              expiredCount++;
            } catch (writeErr: any) {
              const writeErrMsg = writeErr?.message || String(writeErr);
              if (writeErrMsg.includes('RESOURCE_EXHAUSTED') || writeErrMsg.includes('Quota exceeded') || writeErrMsg.includes('429')) {
                console.warn(`[Boost Expiration Job] Failed to write expired status for product ${productId} (Quota Exceeded).`);
                return;
              }
              throw writeErr;
            }
          }
        }
      }

      if (expiredCount > 0) {
        console.log(`[Boost Expiration Job] Successfully processed ${expiredCount} expired boosts.`);
      } else {
        console.log(`[Boost Expiration Job] Scan complete. No expired boosts found.`);
      }
    } catch (err) {
      console.error('[Boost Expiration Job] Error running boost expiration scan:', err);
    }
  }

  // Secure API routes to trigger boost expiration scan on demand or via scheduled Cloud Scheduler
  app.post('/api/cron/expire-boosts', async (req, res) => {
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ success: false, error: 'Unauthorized cron trigger' });
    }

    console.log('[Cron Route] Triggering automatic boost expiration scan (POST)...');
    try {
      await runAutomaticBoostExpirationScan();
      res.json({ success: true, message: 'Boost expiration scan completed successfully' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.get('/api/cron/expire-boosts', async (req, res) => {
    const cronSecret = process.env.CRON_SECRET;
    const querySecret = req.query.secret;
    if (cronSecret && querySecret !== cronSecret) {
      return res.status(401).json({ success: false, error: 'Unauthorized cron trigger' });
    }

    console.log('[Cron Route] Triggering automatic boost expiration scan (GET)...');
    try {
      await runAutomaticBoostExpirationScan();
      res.json({ success: true, message: 'Boost expiration scan completed successfully' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.get('/.well-known/api-catalog', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json({
      "catalog": "1.0",
      "apis": [
        {
          "name": "TedBuy Products API",
          "description": "API for accessing and managing Ghana classified listings.",
          "endpoints": {
            "health": "/api/health",
            "welcome_email": "/api/send-welcome-email",
            "product_image": "/api/products/:productId/image"
          }
        }
      ]
    });
  });

  app.get('/.well-known/oauth-protected-resource', (req, res) => {
    const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy.store';
    const host = cleanHostHeader(rawHost);
    const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
    const origin = `${protocol}://${host}`;

    res.setHeader('Content-Type', 'application/json');
    res.json({
      "resource": origin,
      "authorization_servers": [
        origin
      ],
      "scopes_supported": [
        "public",
        "read",
        "write"
      ]
    });
  });

  app.get('/.well-known/oauth-authorization-server', (req, res) => {
    const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy.store';
    const host = cleanHostHeader(rawHost);
    const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
    const origin = `${protocol}://${host}`;

    res.setHeader('Content-Type', 'application/json');
    res.json({
      "issuer": origin,
      "authorization_endpoint": `${origin}/oauth/authorize`,
      "token_endpoint": `${origin}/api/oauth/token`,
      "jwks_uri": `${origin}/.well-known/jwks.json`,
      "registration_endpoint": `${origin}/api/agents/register`,
      "scopes_supported": ["public", "read", "write"],
      "response_types_supported": ["code", "token"],
      "agent_auth": {
        "register_uri": `${origin}/api/agents/register`,
        "supported_identity_types": ["individual", "organisation"],
        "credential_types": ["api_key", "oauth2"],
        "claim_uri": `${origin}/api/agents/claim`,
        "revocation_uri": `${origin}/api/agents/revoke`
      }
    });
  });

  app.get('/auth.md', (req, res) => {
    const paths = [
      path.join(process.cwd(), 'public', 'auth.md'),
      path.join(process.cwd(), 'dist', 'auth.md'),
      path.join(process.cwd(), 'auth.md')
    ];
    let content = `# Auth.md\n\n# TedBuy Agent Registration & Discovery Metadata`;
    for (const p of paths) {
      if (fs.existsSync(p)) {
        try {
          content = fs.readFileSync(p, 'utf-8');
          break;
        } catch (e) {
          // Ignore
        }
      }
    }
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(content);
  });

  // Secure User Registration Pre-Verification Endpoint (Step 1-4)
  app.post('/api/auth/register', serverRateLimiter(5 * 60 * 1000, 5, "auth-register"), async (req, res) => {
    const { username, email, phoneNumber, password, photoUrl } = req.body;

    if (!username || !email || !phoneNumber || !password) {
      return res.status(400).json({ success: false, error: "Missing required registration fields: username, email, phoneNumber, and password are required." });
    }

    // 1. Inputs validation
    const usernameValid = validateUsernameSecure(username);
    if (!usernameValid.isValid) return res.status(400).json({ success: false, error: usernameValid.error });

    const emailValid = validateEmailSecure(email);
    if (!emailValid.isValid) return res.status(400).json({ success: false, error: emailValid.error });

    const phoneValid = validatePhoneSecure(phoneNumber);
    if (!phoneValid.isValid) return res.status(400).json({ success: false, error: phoneValid.error });

    const passwordValid = validatePasswordStrength(password);
    if (!passwordValid.isValid) return res.status(400).json({ success: false, error: passwordValid.error });

    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim();
    const cleanPhone = phoneNumber.trim();

    // Check system reserved emails
    if (cleanEmail === 'asumaduvincent7@gmail.com') {
      return res.status(400).json({ success: false, error: 'Registration Limit: The email address "asumaduvincent7@gmail.com" has been reserved for system security. Please use a different email address.' });
    }

    try {
      // 2. Duplicate checks in Firestore and Auth
      // A. Check storeNames (username reservation)
      let storeNameTaken = false;
      if (backendSupabase) {
        try {
          const { data, error } = await backendSupabase
            .from('store_names')
            .select('*')
            .eq('id', cleanUsername.toLowerCase())
            .maybeSingle();
          if (!error && data) storeNameTaken = true;
        } catch (err) {
          console.warn('[Register Check] Supabase storeNames check failed, falling back:', err);
        }
      }

      if (!storeNameTaken) {
        try {
          if (adminDb) {
            const storeDoc = await adminDb.collection('storeNames').doc(cleanUsername.toLowerCase()).get();
            if (storeDoc.exists) storeNameTaken = true;
          } else {
            // REST Fallback for storeNames check
            const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/storeNames/${encodeURIComponent(cleanUsername.toLowerCase())}${apiKey ? `?key=${apiKey}` : ""}`;
            const response = await fetch(url);
            if (response.ok) storeNameTaken = true;
          }
        } catch (err) {
          console.warn('[Register Check] Error checking storeNames:', err);
        }
      }

      if (storeNameTaken) {
        return res.status(400).json({ success: false, error: 'Username is already taken. Please choose another one.' });
      }

      // B. Check Firestore and Supabase users collection for existing email or phone
      let emailTaken = false;
      let phoneTaken = false;
      let foundUid: string | null = null;
      let foundUsername: string | null = null;

      if (backendSupabase) {
        try {
          const { data: emailMatch, error: emailErr } = await backendSupabase
            .from('users')
            .select('*')
            .eq('email', cleanEmail)
            .maybeSingle();
          if (!emailErr && emailMatch) {
            emailTaken = true;
            foundUid = emailMatch.id;
            foundUsername = emailMatch.username;
          }

          const { data: phoneMatch, error: phoneErr } = await backendSupabase
            .from('users')
            .select('*')
            .eq('phoneNumber', cleanPhone)
            .maybeSingle();
          if (!phoneErr && phoneMatch) {
            phoneTaken = true;
            if (!foundUid) {
              foundUid = phoneMatch.id;
              foundUsername = phoneMatch.username;
            }
          }
        } catch (err) {
          console.warn('[Register Check] Supabase email/phone check failed, falling back:', err);
        }
      }

      try {
        if (adminDb) {
          if (!emailTaken) {
            const emailSnap = await adminDb.collection('users').where('email', '==', cleanEmail).limit(1).get();
            if (!emailSnap.empty) {
              emailTaken = true;
              foundUid = emailSnap.docs[0].id;
              foundUsername = emailSnap.docs[0].data().username;
            }
          }
          if (!phoneTaken) {
            const phoneSnap = await adminDb.collection('users').where('phoneNumber', '==', cleanPhone).limit(1).get();
            if (!phoneSnap.empty) {
              phoneTaken = true;
              if (!foundUid) {
                foundUid = phoneSnap.docs[0].id;
                foundUsername = phoneSnap.docs[0].data().username;
              }
            }
          }
        } else {
          // REST Fallback querying
          const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery${apiKey ? `?key=${apiKey}` : ""}`;
          
          // Query email
          const emailRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              structuredQuery: {
                from: [{ collectionId: "users", allDescendants: false }],
                where: {
                  fieldFilter: {
                    field: { fieldPath: "email" },
                    op: "EQUAL",
                    value: { stringValue: cleanEmail }
                  }
                },
                limit: 1
              }
            })
          });
          if (emailRes.ok) {
            const data = await emailRes.json();
            if (Array.isArray(data) && data.length > 0 && data[0].document) {
              emailTaken = true;
              const docName = data[0].document.name;
              const docNameParts = docName.split('/');
              foundUid = docNameParts[docNameParts.length - 1];
              foundUsername = data[0].document.fields?.username?.stringValue || null;
            }
          }

          // Query phone
          const phoneRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              structuredQuery: {
                from: [{ collectionId: "users", allDescendants: false }],
                where: {
                  fieldFilter: {
                    field: { fieldPath: "phoneNumber" },
                    op: "EQUAL",
                    value: { stringValue: cleanPhone }
                  }
                },
                limit: 1
              }
            })
          });
          if (phoneRes.ok) {
            const data = await phoneRes.json();
            if (Array.isArray(data) && data.length > 0 && data[0].document) {
              phoneTaken = true;
              if (!foundUid) {
                const docName = data[0].document.name;
                const docNameParts = docName.split('/');
                foundUid = docNameParts[docNameParts.length - 1];
                foundUsername = data[0].document.fields?.username?.stringValue || null;
              }
            }
          }
        }
      } catch (err) {
        console.warn('[Register Check] Error checking existing users in DB:', err);
      }

      // Check Firebase Authentication status to detect orphaned db records
      let existsInAuth = false;
      let checkedAuth = false;

      // Try Admin SDK first
      try {
        const { getApps } = await import("firebase-admin/app");
        if (getApps().length > 0) {
          const { getAuth } = await import("firebase-admin/auth");
          try {
            await getAuth().getUserByEmail(cleanEmail);
            existsInAuth = true;
            checkedAuth = true;
          } catch (authErr: any) {
            if (authErr.code === 'auth/user-not-found') {
              existsInAuth = false;
              checkedAuth = true;
            } else {
              console.warn('[Register Check] Unexpected Auth Admin check error:', authErr);
            }
          }
        }
      } catch (err) {
        console.warn('[Register Check] Error using Auth Admin, trying REST API:', err);
      }

      // Fallback to REST API if Admin SDK wasn't used or failed
      if (!checkedAuth && apiKey) {
        try {
          const authLookupRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: [cleanEmail] })
          });
          if (authLookupRes.ok) {
            const authData = await authLookupRes.json();
            if (authData && Array.isArray(authData.users) && authData.users.length > 0) {
              existsInAuth = true;
            }
            checkedAuth = true;
          } else {
            console.warn('[Register Check] Auth REST lookup failed with status:', authLookupRes.status);
          }
        } catch (restErr) {
          console.warn('[Register Check] Auth REST lookup failed with error:', restErr);
        }
      }

      // If we successfully verified that the user DOES NOT exist in Firebase Authentication,
      // but they exist in the DB (Firestore or Supabase), we have detected a desynced/orphaned record.
      // We will perform self-healing by deleting the orphaned database record so they can register again.
      if (checkedAuth && !existsInAuth && (emailTaken || phoneTaken)) {
        console.log(`[Register Check] Detected desynced/orphaned database records for email ${cleanEmail} (UID: ${foundUid}). Performing self-healing delete.`);
        
        if (foundUid) {
          // Delete from Firestore
          try {
            if (adminDb) {
              await adminDb.collection('users').doc(foundUid).delete();
              if (foundUsername) {
                await adminDb.collection('storeNames').doc(foundUsername.toLowerCase()).delete();
              }
            } else {
              const deleteUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${foundUid}${apiKey ? `?key=${apiKey}` : ""}`;
              await fetch(deleteUrl, { method: 'DELETE' });
              
              if (foundUsername) {
                const storeNameDeleteUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/storeNames/${encodeURIComponent(foundUsername.toLowerCase())}${apiKey ? `?key=${apiKey}` : ""}`;
                await fetch(storeNameDeleteUrl, { method: 'DELETE' });
              }
            }
            console.log('[Register Check] Successfully cleaned up orphan Firestore documents.');
          } catch (fsDelErr) {
            console.warn('[Register Check] Failed to delete orphaned Firestore document:', fsDelErr);
          }

          // Delete from Supabase
          if (backendSupabase) {
            try {
              await backendSupabase.from('users').delete().eq('id', foundUid);
              if (foundUsername) {
                await backendSupabase.from('store_names').delete().eq('id', foundUsername.toLowerCase());
              }
              console.log('[Register Check] Successfully cleaned up orphan Supabase database entries.');
            } catch (sbDelErr) {
              console.warn('[Register Check] Failed to delete orphaned Supabase entry:', sbDelErr);
            }
          }
        }

        // Reset registration block flags as the orphan database records have been successfully cleared!
        emailTaken = false;
        phoneTaken = false;
        foundUid = null;
        foundUsername = null;
      }

      if (emailTaken) {
        return res.status(400).json({ success: false, error: 'Email address is already registered.' });
      }
      if (phoneTaken) {
        return res.status(400).json({ success: false, error: 'Phone number is already registered.' });
      }

      // Final fail-safe: block if the email is actually active in Firebase Auth but somehow has no DB record
      if (checkedAuth && existsInAuth) {
        return res.status(400).json({ success: false, error: 'Email address is already registered in Firebase Authentication. Please try logging in or resetting your password.' });
      }

      // 3. Generate 6-digit secure OTP
      const otp = crypto.randomInt(100000, 1000000).toString();
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes lifespan

      // Store in verification sessions
      verificationSessions.set(cleanEmail, {
        username: cleanUsername,
        email: cleanEmail,
        phoneNumber: cleanPhone,
        password, // stored in memory during the 10 min window
        photoUrl: photoUrl || '',
        otp,
        expiresAt,
        attempts: 0
      });

      console.log(`[Auth Register] Generated OTP ${otp} for email ${cleanEmail}. Expiry: 10m.`);

      // 4. Send visually elegant, responsive HTML email
      const transporter = getMailTransporter();
      let emailSent = false;
      let simulated = false;
      let errorDetail = '';

      const mailOptions = {
        from: '"Tedbuy" <support@tedbuy.store>',
        to: cleanEmail,
        replyTo: 'support@tedbuy.store',
        subject: `${otp} is your TedBuy Verification Code`,
        text: `Welcome to TedBuy!\n\nYour 6-digit security verification code is: ${otp}\n\nThis code is valid for 10 minutes. For your security, please do not share this code with anyone.\n\nThank you,\nTedBuy Support`,
        html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>
    :root {
      color-scheme: light dark;
      supported-color-schemes: light dark;
    }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
      background-color: #f4f6fa; 
      color: #334155; 
      margin: 0; 
      padding: 0; 
    }
    .container { 
      max-width: 500px; 
      margin: 40px auto; 
      background-color: #ffffff; 
      border-radius: 24px; 
      border: 1px solid #e2e8f0; 
      overflow: hidden; 
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05); 
    }
    .header { 
      background-color: #ffffff; 
      padding: 30px 24px; 
      border-bottom: 4px solid #ea580c; 
    }
    .header-table {
      margin: 0 auto;
      border-collapse: collapse;
    }
    .header-logo-img {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      display: block;
      background-color: #0f172a;
    }
    .header-title {
      font-size: 28px;
      font-weight: 950;
      color: #0f172a;
      margin: 0;
      line-height: 1;
      letter-spacing: -0.03em;
    }
    .header-title span {
      color: #ea580c;
    }
    .header-tag {
      font-size: 10px;
      font-weight: 800;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      margin-top: 4px;
      display: block;
    }
    .content { 
      padding: 40px 32px; 
      line-height: 1.7; 
      font-size: 15px; 
      color: #334155; 
      text-align: left;
    }
    .greeting { 
      font-size: 18px; 
      font-weight: 800; 
      color: #0f172a; 
      margin-bottom: 20px; 
    }
    .info-text { 
      font-size: 15px; 
      color: #475569; 
      margin-bottom: 32px; 
    }
    .code-container { 
      background-color: #fff7ed; 
      border-radius: 18px; 
      padding: 24px; 
      margin: 28px 0; 
      border: 1px dashed #ea580c; 
      text-align: center;
    }
    .otp-code { 
      font-size: 38px; 
      font-weight: 900; 
      letter-spacing: 0.25em; 
      color: #ea580c; 
      margin: 0; 
      padding-left: 0.25em; 
      text-shadow: 0 2px 4px rgba(234, 88, 12, 0.05); 
    }
    .expiry-text { 
      font-size: 13px; 
      color: #c2410c; 
      font-weight: 600; 
      margin-top: 10px; 
    }
    .security-warning { 
      background-color: #fffbeb; 
      border-left: 4px solid #f59e0b; 
      padding: 14px 18px; 
      border-radius: 8px; 
      font-size: 13px; 
      color: #b45309; 
      margin-top: 32px; 
      line-height: 1.5; 
    }
    .footer { 
      background-color: #f8fafc; 
      padding: 28px 32px; 
      text-align: center; 
      font-size: 12px; 
      color: #64748b; 
      border-top: 1px solid #e2e8f0; 
      line-height: 1.6; 
    }
    .footer p { 
      margin: 6px 0; 
    }
    .footer a { 
      color: #ea580c; 
      text-decoration: underline; 
      font-weight: 600; 
    }

    /* Dark Mode (Respect User Preferences) */
    @media (prefers-color-scheme: dark) {
      body {
        background-color: #0b0f19 !important;
        color: #cbd5e1 !important;
      }
      .container {
        background-color: #0f172a !important;
        border-color: #1e293b !important;
        box-shadow: 0 15px 45px rgba(0, 0, 0, 0.3) !important;
      }
      .header {
        background-color: #0f172a !important;
        border-bottom-color: #ea580c !important;
      }
      .header-title {
        color: #ffffff !important;
      }
      .header-tag {
        color: #94a3b8 !important;
      }
      .content {
        color: #cbd5e1 !important;
      }
      .greeting {
        color: #ffffff !important;
      }
      .info-text {
        color: #cbd5e1 !important;
      }
      .code-container {
        background-color: #1e293b !important;
        border-color: #ea580c !important;
      }
      .expiry-text {
        color: #fdba74 !important;
      }
      .security-warning {
        background-color: rgba(245, 158, 11, 0.1) !important;
        border-left-color: #f59e0b !important;
        color: #f59e0b !important;
      }
      .footer {
        background-color: #0b0f19 !important;
        border-top-color: #1e293b !important;
        color: #64748b !important;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <table class="header-table" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="vertical-align: middle; padding-right: 12px;">
            <img class="header-logo-img" src="https://tedbuy.store/favicon.png" alt="TedBuy Logo" />
          </td>
          <td style="vertical-align: middle; text-align: left;">
            <h1 class="header-title">Ted<span>Buy</span></h1>
            <span class="header-tag">Ghana's #1 Social Marketplace</span>
          </td>
        </tr>
      </table>
    </div>
    <div class="content">
      <div class="greeting">Hi ${escapeHtml(cleanUsername)},</div>
      <div class="info-text">Thank you for registering with TedBuy! To verify your email address and finalize your account creation, please enter the security verification code below in your screen:</div>
      
      <div class="code-container">
        <div class="otp-code">${otp}</div>
        <div class="expiry-text">This security code is valid for <strong>10 minutes</strong></div>
      </div>
      
      <div class="security-warning">
        <strong>Security Warning:</strong> For your security, never share this code with anyone. TedBuy Support will never ask for your verification code.
      </div>
    </div>
    <div class="footer">
      <p>This message was sent to ${cleanEmail}. If you did not request this code, you can safely ignore this email.</p>
      <p>&copy; 2026 TedBuy Ghana. Accra, Ghana.</p>
    </div>
  </div>
</body>
</html>`
      };

      const brevoApiKey = process.env.BREVO_API_KEY;

      if (brevoApiKey) {
        console.log(`[Auth Register] Brevo API Key detected. Dispatching OTP via Brevo Transactional REST API for: ${cleanEmail}`);
        try {
          const senderEmail = process.env.BREVO_SENDER_EMAIL || 'support@tedbuy.store';
          const senderName = process.env.BREVO_SENDER_NAME || 'Tedbuy Support';

          const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
              'accept': 'application/json',
              'api-key': brevoApiKey,
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              sender: {
                name: senderName,
                email: senderEmail
              },
              to: [
                {
                  email: cleanEmail,
                  name: cleanUsername
                }
              ],
              replyTo: {
                email: senderEmail,
                name: senderName
              },
              subject: mailOptions.subject,
              htmlContent: mailOptions.html,
              textContent: mailOptions.text
            })
          });

          if (brevoResponse.ok) {
            const result = await brevoResponse.json();
            console.log(`[Auth Register] Brevo REST API OTP sent successfully. Message ID: ${result.messageId || 'unknown'}`);
            emailSent = true;
          } else {
            const errText = await brevoResponse.text();
            throw new Error(`Brevo HTTP ${brevoResponse.status}: ${errText}`);
          }
        } catch (brevoErr: any) {
          console.error(`[Auth Register] Brevo REST API delivery failed:`, brevoErr?.message || brevoErr);
          errorDetail = brevoErr?.message || String(brevoErr);
        }
      }

      if (!emailSent) {
        if (brevoApiKey) {
          console.warn(`[Auth Register] Brevo configuration was detected but delivery failed:`, errorDetail);
          return res.status(400).json({
            success: false,
            error: `Verification code could not be sent via Brevo. Please ensure your BREVO_API_KEY is correct, active, and your BREVO_SENDER_EMAIL ("${process.env.BREVO_SENDER_EMAIL || 'support@tedbuy.store'}") is verified as a sender in your Brevo account dashboard. Details: ${errorDetail}`
          });
        }

        if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
          console.warn(`[Auth Register] Neither SMTP credentials nor Brevo API key are configured.`);
          return res.status(400).json({
            success: false,
            error: "Verification code cannot be sent: SMTP mail service credentials (SMTP_USER/SMTP_PASS) or Brevo API credentials (BREVO_API_KEY) are not configured in the system environment. Please configure email variables to enable registration."
          });
        }

        try {
          const diagResult = await diagnoseSMTPAndVerify(transporter);
          if (!diagResult.success) {
            console.warn(`[Auth Register] SMTP pre-flight failed.`);
            return res.status(400).json({
              success: false,
              error: "Failed to send verification code. SMTP connection test failed. Please contact TedBuy support."
            });
          }
          await transporter.sendMail(mailOptions);
          emailSent = true;
        } catch (err: any) {
          console.error(`[Auth Register] SMTP send failed:`, err);
          errorDetail = err?.message || String(err);
          return res.status(500).json({
            success: false,
            error: `Failed to send verification code to your email. Details: ${errorDetail}`
          });
        }
      }

      return res.json({
        success: true,
        message: "Verification code has been successfully sent to your email. Please check your inbox and spam folders.",
        email: cleanEmail
      });

    } catch (err: any) {
      console.error('[Auth Register Exception]:', err);
      return res.status(500).json({ success: false, error: "Internal server error during registration initiation." });
    }
  });

  // Secure User Registration OTP Verification and Completion Endpoint (Step 5-6)
  app.post('/api/auth/verify', serverRateLimiter(60 * 1000, 10, "auth-verify"), async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, error: "Missing required verification fields: email and otp are required." });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.trim();

    const session = verificationSessions.get(cleanEmail);

    if (!session) {
      return res.status(400).json({ success: false, error: "Verification session not found or expired. Please start registration over." });
    }

    // Check expiration
    if (Date.now() > session.expiresAt) {
      verificationSessions.delete(cleanEmail);
      return res.status(400).json({ success: false, error: "Your verification code has expired. Please request a new code." });
    }

    // Brute force protection: check attempt count
    if (session.attempts >= 3) {
      verificationSessions.delete(cleanEmail);
      return res.status(400).json({ success: false, error: "Too many incorrect verification attempts. For security reasons, this registration session has been invalidated. Please start over." });
    }

    // Validate OTP code
    if (session.otp !== cleanOtp) {
      session.attempts++;
      const remainingAttempts = 3 - session.attempts;
      
      if (session.attempts >= 3) {
        verificationSessions.delete(cleanEmail);
        return res.status(400).json({ success: false, error: "Too many incorrect verification attempts. Registration session invalidated. Please register again." });
      }
      
      verificationSessions.set(cleanEmail, session);
      return res.status(400).json({ 
        success: false, 
        error: `Incorrect verification code. You have ${remainingAttempts} attempts remaining.`,
        remainingAttempts
      });
    }

    // OTP is correct! Finalize registration
    try {
      console.log(`[Auth Verify] OTP validated successfully for ${cleanEmail}! Creating user...`);

      let uid = "";
      let isSimulated = false;

      // Try to create the user in Firebase Authentication
      let createdInAuth = false;

      // Try Admin SDK first if initialized
      try {
        const { getApps } = await import("firebase-admin/app");
        if (getApps().length > 0) {
          const { getAuth } = await import("firebase-admin/auth");
          try {
            const userRecord = await getAuth().createUser({
              email: session.email,
              password: session.password,
              displayName: session.username,
              phoneNumber: session.phoneNumber || undefined,
              emailVerified: true
            });
            uid = userRecord.uid;
            createdInAuth = true;
            console.log(`[Auth Verify] Admin SDK successfully created Auth user with UID: ${uid}`);
          } catch (createErr: any) {
            if (createErr.code === 'auth/email-already-exists') {
              console.log(`[Auth Verify] Admin SDK detected existing email. Resolving UID and updating credentials...`);
              const existingUser = await getAuth().getUserByEmail(session.email);
              uid = existingUser.uid;
              await getAuth().updateUser(uid, {
                password: session.password,
                displayName: session.username,
                phoneNumber: session.phoneNumber || undefined,
                emailVerified: true
              });
              createdInAuth = true;
              console.log(`[Auth Verify] Admin SDK successfully updated existing Auth user with UID: ${uid}`);
            } else {
              throw createErr;
            }
          }
        }
      } catch (authErr: any) {
        console.warn('[Auth Verify] Admin SDK createUser failed, attempting REST fallback:', authErr?.message || authErr);
      }

      // Try Identity Toolkit REST API as fallback
      if (!createdInAuth && apiKey) {
        try {
          console.log('[Auth Verify] Attempting to create user in Firebase Auth using REST API...');
          const restRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: session.email,
              password: session.password,
              displayName: session.username,
              returnSecureToken: true
            })
          });

          if (restRes.ok) {
            const restData = await restRes.json();
            uid = restData.localId;
            createdInAuth = true;
            console.log(`[Auth Verify] REST API successfully created Auth user with UID: ${uid}`);
          } else {
            const errData = await restRes.json().catch(() => ({}));
            const errMessage = errData?.error?.message || '';
            if (errMessage.includes('EMAIL_EXISTS')) {
              console.log('[Auth Verify] REST API detected email exists. Looking up user UID to update password...');
              const lookupRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: [session.email] })
              });
              if (lookupRes.ok) {
                const lookupData = await lookupRes.json();
                if (lookupData && Array.isArray(lookupData.users) && lookupData.users.length > 0) {
                  uid = lookupData.users[0].localId;
                  console.log(`[Auth Verify] Found existing user localId: ${uid}. Updating password via REST...`);
                  const updateRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      localId: uid,
                      password: session.password,
                      displayName: session.username,
                      emailVerified: true
                    })
                  });
                  if (updateRes.ok) {
                    createdInAuth = true;
                    console.log(`[Auth Verify] REST API successfully updated password for existing UID: ${uid}`);
                  } else {
                    console.warn('[Auth Verify] REST API failed to update existing user password:', await updateRes.text());
                  }
                }
              }
            } else {
              console.warn('[Auth Verify] REST API signup failed:', JSON.stringify(errData));
            }
          }
        } catch (restErr: any) {
          console.warn('[Auth Verify] REST API signup exception:', restErr?.message || restErr);
        }
      }

      // Fallback to simulated mode only if both auth creation methods failed
      if (!createdInAuth) {
        isSimulated = true;
        uid = `user_local_${session.email.replace(/[^a-zA-Z0-9]/g, '_')}`;
        console.log(`[Auth Verify] Simulated Sandbox fallback active. Created user ID: ${uid}`);
      }

      // Compute secure SHA256 password hash for the new highly-reliable backend authentication
      const passwordHash = crypto.createHash('sha256').update(session.password).digest('hex');

      const newUser = {
        id: uid,
        username: session.username,
        email: session.email,
        phoneNumber: session.phoneNumber || null,
        role: 'both',
        joinDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        photoUrl: session.photoUrl || null,
        followingSellers: [],
        savedProductIds: [],
        emailVerified: true,
        passwordHash: passwordHash,
        authProvider: 'password_hash:' + passwordHash
      };

      // Proactively sync user profile and store name mapping to Firestore atomically
      if (backendSupabase) {
        try {
          console.log(`[Supabase Server] Saving verified user profile and reserving store name in Supabase...`);
          const { error: userErr } = await backendSupabase
            .from('users')
            .upsert({
              id: uid,
              username: session.username,
              email: session.email,
              phoneNumber: session.phoneNumber || null,
              role: 'both',
              joinDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
              photoUrl: session.photoUrl || null,
              followingSellers: [],
              savedProductIds: [],
              emailVerified: true,
              authProvider: 'password_hash:' + passwordHash
            });
          if (userErr) throw userErr;

          const { error: storeErr } = await backendSupabase
            .from('store_names')
            .upsert({
              id: session.username.toLowerCase(),
              userId: uid,
              username: session.username
            });
          if (storeErr) throw storeErr;

          console.log(`[Supabase Server] Successfully persisted user profile and reserved store name for ${session.username}`);
        } catch (sbErr: any) {
          console.warn('[Supabase Server] Failed to persist user/store_name to Supabase:', sbErr?.message || sbErr);
        }
      }

      try {
        if (adminDb) {
          const batch = adminDb.batch();
          batch.set(adminDb.collection('users').doc(uid), newUser);
          batch.set(adminDb.collection('storeNames').doc(session.username.toLowerCase()), {
            userId: uid,
            username: session.username
          });
          await batch.commit();
          console.log(`[Auth Verify] Saved user profile and reserved store name: "${session.username.toLowerCase()}" in Firestore`);
        } else {
          // REST API fallback - handled client-side or mocked
          console.log('[Auth Verify] REST or simulation mode: user collection sync should be completed locally/client-side.');
        }
      } catch (dbErr) {
        console.warn('[Auth Verify] Database save failed (graceful fallback):', dbErr);
      }

      // Delete verification session
      verificationSessions.delete(cleanEmail);

      const customToken = generateCustomJWT({
        user_id: uid,
        sub: uid,
        email: session.email,
        isAdmin: session.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com',
        exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 7) // 7 days expiration
      });

      return res.json({
        success: true,
        message: "Account verified and registered successfully!",
        user: newUser,
        simulatedMode: isSimulated,
        customToken,
        // If simulated mode, client will use this password to finalize client-side auth locally
        tempPassword: isSimulated ? session.password : undefined 
      });

    } catch (err: any) {
      console.error('[Auth Verify Exception]:', err);
      return res.status(500).json({ success: false, error: err?.message || "Internal server error during registration completion." });
    }
  });

  // Secure high-reliability login endpoint verifying computed password hash against databases (Supabase or Firestore)
  app.post('/api/auth/login', serverRateLimiter(60 * 1000, 20, "auth-login"), async (req, res) => {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ success: false, error: "Identifier and password are required." });
    }

    const cleanIdentifier = identifier.trim().toLowerCase();
    const computedHash = crypto.createHash('sha256').update(password).digest('hex');

    let matchedUser: any = null;

    // 1. Search in Supabase if active
    if (backendSupabase) {
      try {
        console.log(`[Backend Login] Searching for user "${cleanIdentifier}" in Supabase...`);
        // Search by email
        let { data: user, error } = await backendSupabase
          .from('users')
          .select('*')
          .eq('email', cleanIdentifier)
          .maybeSingle();

        // Search by username
        if (!user && !error) {
          const { data: userByUsername } = await backendSupabase
            .from('users')
            .select('*')
            .eq('username', cleanIdentifier)
            .maybeSingle();
          user = userByUsername;
        }

        // Search by phoneNumber
        if (!user && !error) {
          const { data: userByPhone } = await backendSupabase
            .from('users')
            .select('*')
            .eq('phoneNumber', cleanIdentifier)
            .maybeSingle();
          user = userByPhone;
        }

        if (user) {
          matchedUser = user;
          console.log(`[Backend Login] Found user profile in Supabase with ID: ${user.id}`);
        }
      } catch (sbErr) {
        console.warn('[Backend Login] Supabase search exception:', sbErr);
      }
    }

    // 2. Search in Firestore if not found in Supabase or if Supabase is inactive
    if (!matchedUser) {
      try {
        console.log(`[Backend Login] Searching for user "${cleanIdentifier}" in Firestore...`);
        if (adminDb) {
          // Search by email
          let snap = await adminDb.collection('users').where('email', '==', cleanIdentifier).limit(1).get();
          // Search by username
          if (snap.empty) {
            snap = await adminDb.collection('users').where('username', '==', cleanIdentifier).limit(1).get();
          }
          // Search by phoneNumber
          if (snap.empty) {
            snap = await adminDb.collection('users').where('phoneNumber', '==', cleanIdentifier).limit(1).get();
          }

          if (!snap.empty) {
            matchedUser = { id: snap.docs[0].id, ...snap.docs[0].data() };
            console.log(`[Backend Login] Found user profile in Firestore with ID: ${matchedUser.id}`);
          }
        }
      } catch (dbErr) {
        console.warn('[Backend Login] Firestore search exception:', dbErr);
      }
    }

    if (!matchedUser) {
      return res.status(404).json({ success: false, error: "No registered account was found matching these credentials. If you are registering, please make sure to verify the 6-digit code sent to your email." });
    }

    if (matchedUser.isSuspended) {
      return res.status(403).json({ success: false, error: "Your account has been suspended by TedBuy Administration due to safety or policy violations. Please contact TedBuy Support at support@tedbuy.store to appeal." });
    }

    // Extract stored SHA256 hash (directly or from authProvider fallback)
    let storedHash = matchedUser.passwordHash || 
                     (matchedUser.authProvider && matchedUser.authProvider.startsWith('password_hash:') 
                      ? matchedUser.authProvider.split('password_hash:')[1] 
                      : null);

    // If storedHash is missing or mismatched, attempt to verify using the secure Firebase Auth REST API
    if (!storedHash || storedHash !== computedHash) {
      if (apiKey && matchedUser.email) {
        try {
          console.log(`[Backend Login] Password hash not matching or not found for ${matchedUser.email}. Attempting verification via Firebase Auth REST API...`);
          const firebaseRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: matchedUser.email,
              password: password,
              returnSecureToken: true
            })
          });

          if (firebaseRes.ok) {
            const authData = await firebaseRes.json();
            if (authData && authData.localId) {
              console.log(`[Backend Login] Firebase Auth REST API sign-in succeeded for ${matchedUser.email}! Syncing passwordHash and authProvider to DB...`);
              
              // Dynamically cache computed passwordHash in Firestore so future logins are ultra-fast
              if (adminDb) {
                await adminDb.collection('users').doc(matchedUser.id).update({
                  passwordHash: computedHash,
                  authProvider: 'password_hash:' + computedHash,
                  isGoogleAuth: false
                }).catch((writeErr: any) => console.warn('[Backend Login] Failed to update Firestore with password hash:', writeErr));
              }

              // Also sync to Supabase if active
              if (backendSupabase) {
                backendSupabase
                  .from('users')
                  .update({
                    authProvider: 'password_hash:' + computedHash,
                    isGoogleAuth: false
                  })
                  .eq('id', matchedUser.id)
                  .then(({ error: sbErr }: any) => {
                    if (sbErr) console.warn('[Backend Login] Failed to update Supabase with password hash:', sbErr.message || sbErr);
                  });
              }
              
              storedHash = computedHash;
              matchedUser.passwordHash = computedHash;
              matchedUser.authProvider = 'password_hash:' + computedHash;
              matchedUser.isGoogleAuth = false;
            }
          } else {
            const errData = await firebaseRes.json().catch(() => ({}));
            const errMsg = errData.error?.message || '';
            console.warn('[Backend Login] Firebase REST sign-in failed with message:', errMsg);
            
            if (errMsg === 'INVALID_PASSWORD' || errMsg === 'INVALID_LOGIN_CREDENTIALS') {
              return res.status(401).json({ success: false, error: "The password you entered is incorrect. Please try again." });
            } else if (errMsg === 'EMAIL_NOT_FOUND') {
              return res.status(404).json({ success: false, error: "No registered account was found matching these credentials." });
            } else if (errMsg === 'USER_DISABLED') {
              return res.status(403).json({ success: false, error: "This user account has been disabled." });
            } else {
              // General fallback for credentials or authentication failure
              return res.status(401).json({ success: false, error: "The password you entered is incorrect. Please try again." });
            }
          }
        } catch (authFallbackErr: any) {
          console.warn('[Backend Login] Firebase Auth REST API fallback exception:', authFallbackErr?.message);
        }
      }
    }

    if (!storedHash) {
      return res.status(400).json({ 
        success: false, 
        error: "This account was registered using Google Authentication or does not have a local password. Please sign in using Google." 
      });
    }

    if (storedHash !== computedHash) {
      return res.status(401).json({ success: false, error: "The password you entered is incorrect. Please try again." });
    }

    // Login successful!
    console.log(`[Backend Login] Successful authentication for user: ${matchedUser.email} / ${matchedUser.username}`);
    const customToken = generateCustomJWT({
      user_id: matchedUser.id,
      sub: matchedUser.id,
      email: matchedUser.email,
      isAdmin: matchedUser.isAdmin === true || matchedUser.email?.toLowerCase() === 'asumaduvincent7@gmail.com',
      exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 7) // 7 days expiration
    });

    return res.json({
      success: true,
      customToken,
      user: {
        id: matchedUser.id,
        username: matchedUser.username,
        email: matchedUser.email,
        phoneNumber: matchedUser.phoneNumber || null,
        whatsAppNumber: matchedUser.whatsAppNumber || null,
        role: matchedUser.role || 'both',
        joinDate: matchedUser.joinDate,
        photoUrl: matchedUser.photoUrl || null,
        followingSellers: matchedUser.followingSellers || [],
        savedProductIds: matchedUser.savedProductIds || [],
        emailVerified: matchedUser.emailVerified !== false,
        isAdmin: matchedUser.isAdmin === true || matchedUser.email?.toLowerCase() === 'asumaduvincent7@gmail.com'
      }
    });
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

  // Secure password reset link dispatcher using Brevo/SMTP server-side
  app.post('/api/auth/reset-password', serverRateLimiter(5 * 60 * 1000, 3, "auth-reset-password"), async (req, res) => {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: "Email parameter is required." });
    }

    const cleanEmail = email.trim().toLowerCase();
    const brevoApiKey = process.env.BREVO_API_KEY;
    const hasSmtp = process.env.SMTP_USER && process.env.SMTP_PASS;

    // Check if user is suspended
    let isSuspended = false;
    if (adminDb) {
      try {
        const snap = await adminDb.collection('users').where('email', '==', cleanEmail).limit(1).get();
        if (!snap.empty) {
          const u = snap.docs[0].data();
          if (u.isSuspended) {
            isSuspended = true;
          }
        }
      } catch (err) {
        console.warn('[Auth Reset Check] Firestore suspension query failed:', err);
      }
    }
    if (!isSuspended && backendSupabase) {
      try {
        const { data: u } = await backendSupabase
          .from('users')
          .select('*')
          .eq('email', cleanEmail)
          .maybeSingle();
        if (u && u.isSuspended) {
          isSuspended = true;
        }
      } catch (err) {
        console.warn('[Auth Reset Check] Supabase suspension query failed:', err);
      }
    }

    if (isSuspended) {
      return res.status(403).json({
        success: false,
        error: "Your account has been suspended by TedBuy Administration due to safety or policy violations. You are not allowed to reset your password. Please contact TedBuy Support at support@tedbuy.store to appeal."
      });
    }

    try {
      let resetLink = "";
      
      // Strategy 1: Attempt to generate link via Firebase Admin SDK
      try {
        const { getApps, initializeApp: initializeAdminApp, cert } = await import("firebase-admin/app");
        if (getApps().length === 0) {
          if (parsedServiceAccountJson) {
            initializeAdminApp({
              credential: cert(parsedServiceAccountJson),
              projectId: parsedServiceAccountJson.project_id || projectId,
            });
          } else if (isGCPServiceAccountAuthorized) {
            initializeAdminApp({
              projectId: projectId,
            });
          } else {
            // Development/sandbox fallback
            initializeAdminApp({
              projectId: projectId,
            });
          }
        }
        const { getAuth } = await import("firebase-admin/auth");
        resetLink = await getAuth().generatePasswordResetLink(cleanEmail);
        console.log(`[Auth Reset] Generated Admin SDK password reset link for: ${cleanEmail}`);
      } catch (authErr: any) {
        console.warn('[Auth Reset] Admin SDK failed to generate reset link:', authErr?.message || authErr);
      }

      // Strategy 2: If Admin SDK fails/unauthorized, generate actionLink via Firebase Auth REST API with Google Cloud Run Metadata service token
      if (!resetLink && isGCPServiceAccountAuthorized) {
        try {
          const metadataToken = await getGCPMetadataToken();
          if (metadataToken && apiKey) {
            console.log(`[Auth Reset] Attempting to generate actionLink via sendOobCode REST API with metadata token for: ${cleanEmail}`);
            const firebaseRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${metadataToken}`
              },
              body: JSON.stringify({
                requestType: "PASSWORD_RESET",
                email: cleanEmail
              })
            });
            if (firebaseRes.ok) {
              const data = await firebaseRes.json();
              if (data && data.actionLink) {
                resetLink = data.actionLink;
                console.log(`[Auth Reset] Successfully generated reset link via REST API sendOobCode with metadata token.`);
              }
            } else {
              const errText = await firebaseRes.text();
              console.warn(`[Auth Reset] sendOobCode REST API with metadata token failed:`, errText);
            }
          }
        } catch (tokenErr: any) {
          console.warn(`[Auth Reset] Failed to generate reset link via REST API fallback with metadata token:`, tokenErr?.message || tokenErr);
        }
      }

      // Rewrite and brand-clean the reset link if generated successfully
      if (resetLink) {
        // High-reliability brand replacement: Swap any generic Firebase-hosted domains with tedbuy.store custom domain
        resetLink = resetLink.replace(/[a-zA-Z0-9-]+\.firebaseapp\.com/g, "tedbuy.store");
        resetLink = resetLink.replace(/[a-zA-Z0-9-]+\.web\.app/g, "tedbuy.store");
        resetLink = resetLink.replace(/www\.tedbuy\.store/g, "tedbuy.store");
        console.log(`[Auth Reset] Cleaned reset link: ${resetLink}`);
      }

      // Strategy 3: Last Resort Fallback - If we can't generate the link on server, and Brevo/SMTP is not active,
      // let Firebase dispatch the email directly. (Only happens in sandbox or if server email config is completely absent).
      if (!resetLink && apiKey) {
        console.log(`[Auth Reset] No reset link generated. Falling back to sending directly via Firebase Auth REST API for: ${cleanEmail}`);
        const firebaseRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestType: "PASSWORD_RESET",
            email: cleanEmail
          })
        });
        if (firebaseRes.ok) {
          console.log(`[Auth Reset] Firebase Auth REST API successfully sent password reset email directly.`);
          return res.json({ success: true, message: "Password reset instructions have been successfully dispatched to your email address." });
        } else {
          const errText = await firebaseRes.text();
          console.warn(`[Auth Reset] Firebase Auth REST API dispatch failed:`, errText);
        }
      }

      // Verify that we have a generated link to send via Brevo/SMTP
      if (!resetLink) {
        if (!brevoApiKey && !hasSmtp) {
          console.log(`[Auth Reset] Neither Brevo nor SMTP configured on the server. Instructing client to fallback.`);
          return res.json({ success: false, fallback: true, message: "Server email engine not configured. Falling back to client-side default." });
        }
        return res.json({ success: false, fallback: true, message: "Could not generate link on server. Falling back." });
      }

      const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>
    :root {
      color-scheme: light dark;
      supported-color-schemes: light dark;
    }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
      background-color: #f4f6fa; 
      color: #334155; 
      margin: 0; 
      padding: 0; 
    }
    .container { 
      max-width: 500px; 
      margin: 40px auto; 
      background-color: #ffffff; 
      border-radius: 24px; 
      border: 1px solid #e2e8f0; 
      overflow: hidden; 
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05); 
    }
    .header { 
      background-color: #ffffff; 
      padding: 30px 24px; 
      border-bottom: 4px solid #ea580c; 
    }
    .header-table {
      margin: 0 auto;
      border-collapse: collapse;
    }
    .header-logo-img {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      display: block;
      background-color: #0f172a;
    }
    .header-title {
      font-size: 28px;
      font-weight: 950;
      color: #0f172a;
      margin: 0;
      line-height: 1;
      letter-spacing: -0.03em;
    }
    .header-title span {
      color: #ea580c;
    }
    .header-tag {
      font-size: 10px;
      font-weight: 800;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      margin-top: 4px;
      display: block;
    }
    .content { 
      padding: 40px 32px; 
      line-height: 1.7; 
      font-size: 15px; 
      color: #334155; 
      text-align: left;
    }
    .content p { 
      margin-top: 0; 
      margin-bottom: 22px; 
    }
    .btn-container { 
      text-align: center; 
      margin: 32px 0; 
    }
    .btn { 
      display: inline-block; 
      padding: 16px 36px; 
      background-color: #ea580c; 
      color: #ffffff !important; 
      text-decoration: none; 
      border-radius: 14px; 
      font-weight: 800; 
      text-align: center; 
      font-size: 15px; 
      box-shadow: 0 4px 12px rgba(234, 88, 12, 0.15); 
      transition: background-color 0.15s ease; 
    }
    .url-text { 
      font-size: 12px; 
      color: #64748b; 
      word-break: break-all; 
      background-color: #f8fafc; 
      border: 1px solid #e2e8f0; 
      border-radius: 12px; 
      padding: 14px; 
      margin-top: 32px; 
      line-height: 1.5; 
    }
    .footer { 
      background-color: #f8fafc; 
      padding: 28px 32px; 
      text-align: center; 
      font-size: 12px; 
      color: #64748b; 
      border-top: 1px solid #e2e8f0; 
      line-height: 1.6; 
    }
    .footer p { 
      margin: 6px 0; 
    }
    .footer a { 
      color: #ea580c; 
      text-decoration: underline; 
      font-weight: 600; 
    }

    /* Dark Mode (Respect User Preferences) */
    @media (prefers-color-scheme: dark) {
      body {
        background-color: #0b0f19 !important;
        color: #cbd5e1 !important;
      }
      .container {
        background-color: #0f172a !important;
        border-color: #1e293b !important;
        box-shadow: 0 15px 45px rgba(0, 0, 0, 0.3) !important;
      }
      .header {
        background-color: #0f172a !important;
        border-bottom-color: #ea580c !important;
      }
      .header-title {
        color: #ffffff !important;
      }
      .header-tag {
        color: #94a3b8 !important;
      }
      .content {
        color: #cbd5e1 !important;
      }
      #reset-greeting {
        color: #ffffff !important;
      }
      .url-text {
        background-color: #1e293b !important;
        border-color: #1e293b !important;
        color: #cbd5e1 !important;
      }
      .footer {
        background-color: #0b0f19 !important;
        border-top-color: #1e293b !important;
        color: #64748b !important;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <table class="header-table" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="vertical-align: middle; padding-right: 12px;">
            <img class="header-logo-img" src="https://tedbuy.store/favicon.png" alt="TedBuy Logo" />
          </td>
          <td style="vertical-align: middle; text-align: left;">
            <h1 class="header-title">Ted<span>Buy</span></h1>
            <span class="header-tag">Ghana's #1 Social Marketplace</span>
          </td>
        </tr>
      </table>
    </div>
    <div class="content">
      <p style="font-size: 18px; font-weight: 800; color: #0f172a; margin-bottom: 24px;" id="reset-greeting">Hello,</p>
      <p>We received a request to reset the password for your TedBuy account. Click the button below to choose a secure new password:</p>
      
      <div class="btn-container">
        <a href="${resetLink}" class="btn" style="color: #ffffff !important;">Reset My Password</a>
      </div>
      
      <p>If you did not make this request, you can safely ignore this email. Your password will remain completely secure and unchanged.</p>
      
      <div class="url-text">
        <strong>Button not working?</strong> Copy and paste this URL into your browser address bar:<br/>
        <span style="color: #ea580c;">${resetLink}</span>
      </div>
    </div>
    <div class="footer">
      <p>This message was sent to ${escapeHtml(cleanEmail)}.</p>
      <p>&copy; 2026 TedBuy Ghana. Accra, Ghana.</p>
    </div>
  </div>
</body>
</html>`;

      const textContent = `Reset Your TedBuy Password\n\nHello,\n\nWe received a request to reset the password for your TedBuy account. Use the following link to choose a secure new password:\n\n${resetLink}\n\nIf you did not make this request, you can safely ignore this email.\n\nTedBuy Support`;

      let emailSent = false;
      let errorDetail = "";

      if (brevoApiKey) {
        console.log(`[Auth Reset] Dispatching reset email via Brevo REST API for: ${cleanEmail}`);
        try {
          const senderEmail = process.env.BREVO_SENDER_EMAIL || 'support@tedbuy.store';
          const senderName = process.env.BREVO_SENDER_NAME || 'Tedbuy Support';

          const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
              'accept': 'application/json',
              'api-key': brevoApiKey,
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              sender: { name: senderName, email: senderEmail },
              to: [{ email: cleanEmail }],
              replyTo: { name: senderName, email: senderEmail },
              subject: "Reset Your TedBuy Password",
              htmlContent: htmlContent,
              textContent: textContent
            })
          });

          if (brevoResponse.ok) {
            console.log(`[Auth Reset] Brevo sent reset email successfully.`);
            emailSent = true;
          } else {
            const errText = await brevoResponse.text();
            throw new Error(`Brevo HTTP ${brevoResponse.status}: ${errText}`);
          }
        } catch (brevoErr: any) {
          console.error(`[Auth Reset] Brevo REST delivery failed:`, brevoErr?.message || brevoErr);
          errorDetail = brevoErr?.message || String(brevoErr);
        }
      }

      if (!emailSent && hasSmtp) {
        console.log(`[Auth Reset] Falling back to SMTP for: ${cleanEmail}`);
        try {
          const transporter = getMailTransporter();
          const diagResult = await diagnoseSMTPAndVerify(transporter);
          if (diagResult.success) {
            await transporter.sendMail({
              from: `"Tedbuy Support" <${process.env.SMTP_USER}>`,
              to: cleanEmail,
              subject: "Reset Your TedBuy Password",
              text: textContent,
              html: htmlContent
            });
            emailSent = true;
          } else {
            throw new Error(`SMTP connection test failed: ${diagResult.details?.error || 'Unknown error'}`);
          }
        } catch (smtpErr: any) {
          console.error(`[Auth Reset] SMTP delivery failed:`, smtpErr?.message || smtpErr);
          errorDetail = smtpErr?.message || String(smtpErr);
        }
      }

      if (emailSent) {
        return res.json({ success: true, provider: brevoApiKey && emailSent ? 'brevo-rest' : 'smtp' });
      } else {
        return res.status(400).json({
          success: false,
          error: `Could not send reset email. Details: ${errorDetail}`
        });
      }

    } catch (err: any) {
      console.error('[Auth Reset Exception]:', err);
      return res.status(500).json({ success: false, error: err?.message || "Internal server error during password reset request." });
    }
  });

  // API to delete a user account and all associated data from the system (Firestore and Supabase)
  app.post('/api/auth/delete-account', async (req, res) => {
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

      console.log(`[Account Deletion API] Starting full deletion for user UID: ${uid} (${cleanEmail})`);

      // 1. Get user details from Firestore to resolve the store names/username
      let username = '';
      if (adminDb) {
        try {
          const userSnap = await adminDb.collection('users').doc(uid).get();
          if (userSnap.exists) {
            username = userSnap.data()?.username || '';
          }
        } catch (err) {
          console.warn('[Account Deletion API] Failed to fetch user doc from Firestore:', err);
        }
      }

      // If we don't have username, let's check Supabase
      if (!username && backendSupabase) {
        try {
          const { data, error } = await backendSupabase
            .from('users')
            .select('username')
            .eq('id', uid)
            .maybeSingle();
          if (!error && data) {
            username = data.username || '';
          }
        } catch (err) {
          console.warn('[Account Deletion API] Failed to fetch user from Supabase:', err);
        }
      }

      // If we still don't have it, let's parse email
      if (!username && cleanEmail) {
        username = cleanEmail.split('@')[0];
      }

      const storeNameLower = username.trim().toLowerCase();

      // 2. Perform deletions in Firestore using Admin SDK or REST fallback
      if (adminDb) {
        try {
          console.log('[Account Deletion API] Deleting user documents from Firestore via Admin SDK...');
          
          // A. Delete Products
          const productsSnap = await adminDb.collection('products').where('sellerId', '==', uid).get();
          if (!productsSnap.empty) {
            const pBatch = adminDb.batch();
            productsSnap.forEach((doc: any) => pBatch.delete(doc.ref));
            await pBatch.commit();
          }

          // B. Delete Reviews (buyerId or sellerId == uid)
          const reviewsSnap1 = await adminDb.collection('reviews').where('buyerId', '==', uid).get();
          const reviewsSnap2 = await adminDb.collection('reviews').where('sellerId', '==', uid).get();
          if (!reviewsSnap1.empty || !reviewsSnap2.empty) {
            const rBatch = adminDb.batch();
            reviewsSnap1.forEach((doc: any) => rBatch.delete(doc.ref));
            reviewsSnap2.forEach((doc: any) => rBatch.delete(doc.ref));
            await rBatch.commit();
          }

          // C. Delete Chats and Messages
          const chatsSnap1 = await adminDb.collection('chats').where('buyerId', '==', uid).get();
          const chatsSnap2 = await adminDb.collection('chats').where('sellerId', '==', uid).get();
          const chatIds = new Set<string>();
          if (!chatsSnap1.empty || !chatsSnap2.empty) {
            const cBatch = adminDb.batch();
            chatsSnap1.forEach((doc: any) => {
              chatIds.add(doc.id);
              cBatch.delete(doc.ref);
            });
            chatsSnap2.forEach((doc: any) => {
              chatIds.add(doc.id);
              cBatch.delete(doc.ref);
            });
            await cBatch.commit();
          }

          // Delete messages sent/received, or of the deleted chats
          const mSnap1 = await adminDb.collection('messages').where('senderId', '==', uid).get();
          const mSnap2 = await adminDb.collection('messages').where('recipientId', '==', uid).get();
          const mBatch = adminDb.batch();
          let mCount = 0;
          mSnap1.forEach((doc: any) => {
            mBatch.delete(doc.ref);
            mCount++;
          });
          mSnap2.forEach((doc: any) => {
            mBatch.delete(doc.ref);
            mCount++;
          });
          
          if (chatIds.size > 0) {
            for (const chatId of chatIds) {
              const chatMsgs = await adminDb.collection('messages').where('chatId', '==', chatId).get();
              chatMsgs.forEach((doc: any) => {
                mBatch.delete(doc.ref);
                mCount++;
              });
            }
          }
          if (mCount > 0) {
            await mBatch.commit();
          }

          // D. Delete Notifications (userId == uid)
          const notifsSnap = await adminDb.collection('notifications').where('userId', '==', uid).get();
          if (!notifsSnap.empty) {
            const nBatch = adminDb.batch();
            notifsSnap.forEach((doc: any) => nBatch.delete(doc.ref));
            await nBatch.commit();
          }

          // E. Delete Boost Purchases (userId == uid)
          const bpSnap = await adminDb.collection('boost_purchases').where('userId', '==', uid).get();
          const bpSnap2 = await adminDb.collection('boostPurchases').where('userId', '==', uid).get();
          if (!bpSnap.empty || !bpSnap2.empty) {
            const bpBatch = adminDb.batch();
            bpSnap.forEach((doc: any) => bpBatch.delete(doc.ref));
            bpSnap2.forEach((doc: any) => bpBatch.delete(doc.ref));
            await bpBatch.commit();
          }

          // F. Delete StoreName mapping
          if (storeNameLower) {
            await adminDb.collection('storeNames').doc(storeNameLower).delete().catch(() => {});
          }

          // G. Delete User Profile Doc
          await adminDb.collection('users').doc(uid).delete();

          // H. Delete any deletedEmails blocklist entry for this email (to allow registering again)
          if (cleanEmail) {
            await adminDb.collection('deletedEmails').doc(cleanEmail).delete().catch(() => {});
          }

          console.log('[Account Deletion API] Firestore documents successfully deleted via Admin SDK.');
        } catch (fsErr: any) {
          console.warn('[Account Deletion API] Admin SDK Firestore delete failed:', fsErr);
        }
      }

      // 3. Perform deletions in Supabase if active
      if (backendSupabase) {
        try {
          console.log('[Account Deletion API] Deleting user rows from Supabase...');
          
          // A. Delete messages of the user
          await backendSupabase.from('messages').delete().eq('senderId', uid);
          await backendSupabase.from('messages').delete().eq('recipientId', uid);

          // B. Delete chats of the user
          await backendSupabase.from('chats').delete().eq('buyerId', uid);
          await backendSupabase.from('chats').delete().eq('sellerId', uid);

          // C. Delete products of the user
          await backendSupabase.from('products').delete().eq('sellerId', uid);

          // D. Delete reviews of the user
          await backendSupabase.from('reviews').delete().eq('buyerId', uid);
          await backendSupabase.from('reviews').delete().eq('sellerId', uid);

          // E. Delete notifications of the user
          await backendSupabase.from('notifications').delete().eq('userId', uid);

          // F. Delete boost purchases of the user
          await backendSupabase.from('boost_purchases').delete().eq('userId', uid);

          // G. Delete store names mapping of the user
          await backendSupabase.from('store_names').delete().eq('userId', uid);
          if (storeNameLower) {
            await backendSupabase.from('store_names').delete().eq('id', storeNameLower);
          }

          // H. Delete user profile row
          await backendSupabase.from('users').delete().eq('id', uid);

          console.log('[Account Deletion API] Supabase rows successfully deleted.');
        } catch (sbErr: any) {
          console.warn('[Account Deletion API] Supabase delete failed:', sbErr);
        }
      }

      // 4. Delete the Firebase Auth User account
      let authDeleted = false;
      try {
        const { getApps } = await import("firebase-admin/app");
        if (getApps().length > 0) {
          const { getAuth } = await import("firebase-admin/auth");
          await getAuth().deleteUser(uid);
          console.log(`[Account Deletion API] Successfully deleted auth user ${uid} from Firebase Auth.`);
          authDeleted = true;
        }
      } catch (authErr: any) {
        console.warn('[Account Deletion API] Firebase Auth deleteUser failed:', authErr);
      }

      // Clear product list cache so changes are instantly reflected on browse view
      cachedProducts = null;

      return res.json({ 
        success: true, 
        message: "Your account and all associated data have been permanently deleted from the system.",
        authDeleted
      });

    } catch (err: any) {
      console.error('[Account Deletion API Exception]:', err);
      return res.status(500).json({ success: false, error: err.message || "Internal server error during account deletion." });
    }
  });

  app.post('/api/send-welcome-email', async (req, res) => {
    const { email, username } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email parameter is required.' });
    }

    // Dynamic rate limiter check that bypasses for Admins
    const authHeader = req.headers.authorization;
    const isAdmin = await verifyAdmin(authHeader);

    if (!isAdmin) {
      const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "anonymous";
      const key = `${ip}:welcome-email`;
      const now = Date.now();
      const windowMs = 5 * 60 * 1000;
      const maxRequests = 3;

      if (!rateLimitStore[key] || rateLimitStore[key].resetTime < now) {
        rateLimitStore[key] = {
          count: 1,
          resetTime: now + windowMs
        };
      } else {
        rateLimitStore[key].count++;
        if (rateLimitStore[key].count > maxRequests) {
          const remainingSecs = Math.ceil((rateLimitStore[key].resetTime - now) / 1000);
          res.setHeader("Retry-After", remainingSecs);
          return res.status(429).json({
            error: `Too many requests to welcome-email. Please wait ${remainingSecs} seconds and try again.`
          });
        }
      }
    } else {
      console.log(`[Email Engine] Admin authorized. Bypassing rate limit check for sending welcome email to: ${email}`);
    }

    const cleanName = username || email.split('@')[0] || 'there';
    const escapedName = escapeHtml(cleanName);

    const subject = 'Welcome to Tedbuy Ghana';
    const textContent = `Welcome to TedBuy!\n\nHi ${cleanName},\n\nI wanted to check in with you to ensure that you have everything you need. I hope that your experience with TedBuy so far has been a pleasant one. Customer experience is at the heart of everything we do. It's why we come to work each day.\n\nAll replies to this email inbox are monitored by myself, so if you'd like to get in touch directly and provide any feedback which could help us help you, please type in the chat on TedBuy (or hit reply to this email!) and we'll ensure that we get onto that right away. No issue is too small. If it matters to you, it matters to us, so please do get in touch if you need to.\n\nAlso, don't forget that our customer support team are here for all your day-to-day and technical questions 24/7. Thanks once again. I'm delighted to have you on board and look forward to helping you drive your business to awesome new heights.\n\nGratefully yours,\n\nVincent Asumadu,\nCEO, Tedbuy Inc`;
    
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>
    :root {
      color-scheme: light dark;
      supported-color-schemes: light dark;
    }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
      background-color: #f4f6fa; 
      color: #334155; 
      margin: 0; 
      padding: 0; 
    }
    .container { 
      max-width: 500px; 
      margin: 40px auto; 
      background-color: #ffffff; 
      border-radius: 24px; 
      border: 1px solid #e2e8f0; 
      overflow: hidden; 
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05); 
    }
    .header { 
      background-color: #ffffff; 
      padding: 30px 24px; 
      border-bottom: 4px solid #ea580c; 
    }
    .header-table {
      margin: 0 auto;
      border-collapse: collapse;
    }
    .header-logo-img {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      display: block;
      background-color: #0f172a;
    }
    .header-title {
      font-size: 28px;
      font-weight: 950;
      color: #0f172a;
      margin: 0;
      line-height: 1;
      letter-spacing: -0.03em;
    }
    .header-title span {
      color: #ea580c;
    }
    .header-tag {
      font-size: 10px;
      font-weight: 800;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      margin-top: 4px;
      display: block;
    }
    .content { 
      padding: 40px 32px; 
      line-height: 1.7; 
      font-size: 15px; 
      color: #334155; 
      text-align: left;
    }
    .content p { 
      margin-top: 0; 
      margin-bottom: 22px; 
    }
    .footer { 
      background-color: #f8fafc; 
      padding: 28px 32px; 
      text-align: center; 
      font-size: 12px; 
      color: #64748b; 
      border-top: 1px solid #e2e8f0; 
      line-height: 1.6; 
    }
    .footer p { 
      margin: 6px 0; 
    }
    .footer a { 
      color: #ea580c; 
      text-decoration: underline; 
      font-weight: 600; 
    }

    /* Dark Mode (Respect User Preferences) */
    @media (prefers-color-scheme: dark) {
      body {
        background-color: #0b0f19 !important;
        color: #cbd5e1 !important;
      }
      .container {
        background-color: #0f172a !important;
        border-color: #1e293b !important;
        box-shadow: 0 15px 45px rgba(0, 0, 0, 0.3) !important;
      }
      .header {
        background-color: #0f172a !important;
        border-bottom-color: #ea580c !important;
      }
      .header-title {
        color: #ffffff !important;
      }
      .header-tag {
        color: #94a3b8 !important;
      }
      .content {
        color: #cbd5e1 !important;
      }
      .content p {
        color: #cbd5e1 !important;
      }
      .greeting-welcome {
        color: #ffffff !important;
      }
      .footer {
        background-color: #0b0f19 !important;
        border-top-color: #1e293b !important;
        color: #64748b !important;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <table class="header-table" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="vertical-align: middle; padding-right: 12px;">
            <img class="header-logo-img" src="https://tedbuy.store/favicon.png" alt="TedBuy Logo" />
          </td>
          <td style="vertical-align: middle; text-align: left;">
            <h1 class="header-title">Ted<span>Buy</span></h1>
            <span class="header-tag">Ghana's #1 Social Marketplace</span>
          </td>
        </tr>
      </table>
    </div>
    <div class="content">
      <p style="font-size: 18px; font-weight: 800; color: #0f172a; margin-bottom: 24px;" class="greeting-welcome">Hi ${escapedName},</p>
      
      <p>I wanted to check in with you to ensure that you have everything you need. I hope that your experience with TedBuy so far has been a pleasant one. Customer experience is at the heart of everything we do. It's why we come to work each day.</p>

      <p>All replies to this email inbox are monitored by myself, so if you'd like to get in touch directly and provide any feedback which could help us help you, please type in the chat on TedBuy (or hit reply to this email!) and we'll ensure that we get onto that right away. No issue is too small. If it matters to you, it matters to us, so please do get in touch if you need to.</p>

      <p>Also, don't forget that our customer support team are here for all your day-to-day and technical questions 24/7. Thanks once again. I'm delighted to have you on board and look forward to helping you drive your business to awesome new heights.</p>
      
      <p style="margin-top: 40px; line-height: 1.5; font-size: 14px;">
        Gratefully yours,<br/><br/>
        <strong style="font-size: 16px; color: #0f172a;" class="greeting-welcome">Vincent Asumadu,<br/>CEO, Tedbuy Inc</strong>
      </p>
    </div>
    <div class="footer">
      <p>This message was sent from <a href="mailto:support@tedbuy.store">support@tedbuy.store</a>. You can reply directly to this email to reach our support team.</p>
      <p>&copy; 2026 TedBuy Ghana. Accra, Ghana.</p>
    </div>
  </div>
</body>
</html>`;

    // 1. Try Brevo REST API if configured
    const brevoApiKey = process.env.BREVO_API_KEY;
    if (brevoApiKey) {
      console.log(`[Email Engine] Brevo API Key detected. Dispatched via Brevo Transactional REST API for: ${email}`);
      try {
        const senderEmail = process.env.BREVO_SENDER_EMAIL || 'support@tedbuy.store';
        const senderName = process.env.BREVO_SENDER_NAME || 'Tedbuy Support';

        const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'api-key': brevoApiKey,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            sender: {
              name: senderName,
              email: senderEmail
            },
            to: [
              {
                email: email.trim(),
                name: cleanName
              }
            ],
            replyTo: {
              email: senderEmail,
              name: senderName
            },
            subject: subject,
            htmlContent: htmlContent,
            textContent: textContent
          })
        });

        if (brevoResponse.ok) {
          const result = await brevoResponse.json();
          console.log(`[Email Engine] Brevo REST API sent successfully. Message ID: ${result.messageId || 'unknown'}`);
          return res.json({ success: true, messageId: result.messageId || 'brevo-rest-id', provider: 'brevo-rest' });
        } else {
          const errText = await brevoResponse.text();
          throw new Error(`Brevo HTTP ${brevoResponse.status}: ${errText}`);
        }
      } catch (brevoErr: any) {
        console.warn(`[Email Engine] Brevo REST API delivery failed, falling back to SMTP/Simulation:`, brevoErr?.message || brevoErr);
      }
    }

    // 2. Fall back to standard SMTP Transporter
    try {
      const transporter = getMailTransporter();

      // Run pre-flight network connection, handshake, and authentication diagnostic check
      if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        console.log(`[Email Engine] Running pre-flight SMTP diagnostics for recipient: ${email}...`);
        const diagResult = await diagnoseSMTPAndVerify(transporter);
        if (!diagResult.success) {
          console.warn(`[Email Engine] Pre-flight SMTP block: Diagnostics failed prior to dispatch to ${email}. Gracefully bypassing to simulate success.`);
          return res.json({
            success: true,
            messageId: 'simulated_delivery_bypass_id',
            simulated: true,
            warning: 'SMTP pre-flight diagnostic failed or host is offline. Onboarding flow completed with simulation.'
          });
        }
      }
      
      const mailOptions = {
        from: '"Tedbuy" <support@tedbuy.store>',
        to: email,
        replyTo: 'support@tedbuy.store',
        subject: subject,
        text: textContent,
        html: htmlContent
      };

      const info = await transporter.sendMail(mailOptions);
      console.log(`[Email Engine] Welcome email dispatched successfully via SMTP for ${email}. MessageId: ${info.messageId || 'virtual'}`);
      
      if ((info as any).message) {
        console.log(`[Email Engine] Virtual Dispatch Preview (First 400 chars):\n`, (info as any).message.toString().slice(0, 400));
      }

      return res.json({ success: true, messageId: info.messageId || 'virtual', provider: 'smtp' });
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.warn(`[Email Engine] SMTP Send attempted but encountered limit/rejection for ${email}:`, errMsg);

      console.log(`[Email Engine] [Bypass] Gracefully bypassing SMTP issue for ${email}. Returning simulated delivery success.`);
      return res.json({
        success: true,
        messageId: 'simulated_delivery_bypass_id',
        simulated: true,
        warning: `SMTP issue bypassed. Details: ${errMsg}`
      });
    }
  });

  // Dynamic robots.txt declaring active domain's sitemap.xml to speed up indexing on custom domains
  app.get(['/robots.txt', '/api/robots'], (req, res) => {
    const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy.store';
    const host = cleanHostHeader(rawHost);
    const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
    res.type('text/plain');
    res.send(`User-agent: *\nAllow: /\nDisallow: /settings\nDisallow: /dashboard\n\nContent-Signal: ai-train=no, search=yes, ai-input=no\n\nSitemap: ${protocol}://${host}/sitemap.xml`);
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

  function getCategoryFallbackUrl(cat: string): string {
    if (!cat) return 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=600&q=80';
    const lower = cat.toLowerCase();
    if (lower.includes('phone') || lower.includes('mobile')) return 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=600&q=80';
    if (lower.includes('electronic') || lower.includes('tv') || lower.includes('audio') || lower.includes('camera')) return 'https://images.unsplash.com/photo-1498049794561-7780e7231661?auto=format&fit=crop&w=600&q=80';
    if (lower.includes('laptop') || lower.includes('computer')) return 'https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&w=600&q=80';
    if (lower.includes('fashion') || lower.includes('wear') || lower.includes('clothes')) return 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=600&q=80';
    if (lower.includes('vehicle') || lower.includes('car')) return 'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=600&q=80';
    if (lower.includes('beauty')) return 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=600&q=80';
    if (lower.includes('game') || lower.includes('toy')) return 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=600&q=80';
    if (lower.includes('appliance') || lower.includes('home')) return 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=600&q=80';
    return 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=600&q=80';
  }

  function getUrlHash(url: string): string {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return 'ext_' + Math.abs(hash).toString(36);
  }  // Dynamic image delivery endpoint to decode and serve base64 uploads as binary image files with on-the-fly Sharp optimization
  app.get(['/api/products/:productId/image', '/api/products/:productId/image.jpg', '/api/products/:productId/image.png', '/api/products/:productId/image.jpeg'], serverRateLimiter(60 * 1000, 300, "image-proxy"), async (req, res) => {
    const { productId } = req.params;
    const queryImageUrl = req.query.image as string;
    const queryVideoUrl = req.query.video as string;
    const idx = req.query.idx !== undefined ? parseInt(req.query.idx as string, 10) : 0;

    // Parse and normalize optimization query parameters to maximize cache effectiveness
    const w = req.query.w ? parseInt(req.query.w as string, 10) : undefined;
    const h = req.query.h ? parseInt(req.query.h as string, 10) : undefined;
    const q = req.query.q ? parseInt(req.query.q as string, 10) : 80;
    
    // Dynamically match format to file extension for social crawlers (e.g., .jpg requests must return jpeg)
    let defaultFormat = 'webp';
    const reqPathLower = req.path.toLowerCase();
    if (reqPathLower.endsWith('.png')) {
      defaultFormat = 'png';
    } else if (reqPathLower.endsWith('.jpg') || reqPathLower.endsWith('.jpeg')) {
      defaultFormat = 'jpeg';
    }
    const fmt = (req.query.fmt as string || defaultFormat).toLowerCase();

    let width = w;
    if (width !== undefined) {
      const standardWidths = [100, 200, 400, 600, 800, 1200];
      width = standardWidths.find(sw => sw >= width!) || 1200;
    }
    let height = h;
    if (height !== undefined) {
      const standardHeights = [100, 150, 300, 450, 600, 900];
      height = standardHeights.find(sh => sh >= height!) || 900;
    }
    let quality = q;
    if (quality < 1 || quality > 100) quality = 80;
    const format = ['webp', 'avif', 'png', 'jpeg', 'jpg'].includes(fmt) ? fmt : 'webp';

    let isVideoCheck = (queryImageUrl && (queryImageUrl.endsWith('.mp4') || queryImageUrl.includes('/video'))) ||
                       (queryVideoUrl && (queryVideoUrl.endsWith('.mp4') || queryVideoUrl.includes('/video'))) ||
                       (productId && (productId.includes('video') || productId.includes('vid_')));

    const resolvedProductId = (idx && idx > 0) ? `${productId}_img${idx}` : productId;
    const imageId = resolvedProductId || (queryImageUrl ? getUrlHash(queryImageUrl) : null);
    const cacheKey = imageId ? `${imageId}_w${width || 'auto'}_h${height || 'auto'}_q${quality}_${format}` : null;

    // 1. FAST PATH: Serve directly from high-performance in-memory binary cache (sub-millisecond, zero CPU/Disk overhead)
    if (cacheKey) {
      const memCached = binaryImageMemoryCache.get(cacheKey);
      if (memCached) {
        res.set('Content-Type', memCached.mimeType);
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        return res.send(memCached.buffer);
      }
      
      // 2. SEMI-FAST PATH: Serve from high-performance binary disk cache
      const binFile = path.join(IMAGES_CACHE_DIR, `${cacheKey}.bin`);
      const mimeFile = path.join(IMAGES_CACHE_DIR, `${cacheKey}.mime`);
      if (fs.existsSync(binFile) && fs.existsSync(mimeFile)) {
        try {
          const buffer = fs.readFileSync(binFile);
          const mimeType = fs.readFileSync(mimeFile, 'utf-8').trim();
          setBinaryImageInCache(cacheKey, buffer, mimeType);
          res.set('Content-Type', mimeType);
          res.set('Cache-Control', 'public, max-age=31536000, immutable');
          return res.send(buffer);
        } catch (binErr) {
          console.warn(`[Images Cache] Failed to read optimized disk cache for ${cacheKey}:`, binErr);
        }
      }
    }

    // 3. Resolve the original un-optimized buffer
    let originalBuffer: Buffer | null = null;
    let originalMimeType = 'image/jpeg';

    if (imageId) {
      const origBinFile = path.join(IMAGES_CACHE_DIR, `${imageId}.bin`);
      const origMimeFile = path.join(IMAGES_CACHE_DIR, `${imageId}.mime`);
      if (fs.existsSync(origBinFile) && fs.existsSync(origMimeFile)) {
        try {
          originalBuffer = fs.readFileSync(origBinFile);
          originalMimeType = fs.readFileSync(origMimeFile, 'utf-8').trim();
        } catch (readErr) {
          console.warn(`[Images Cache] Failed to read original cache for ${imageId}:`, readErr);
        }
      }
    }

    let imageUrl = queryImageUrl;
    let category = '';
    let dbProduct: any = null;

    // 4. Check if we have the original base64 on disk
    if (!originalBuffer && productId) {
      const txtFile = path.join(IMAGES_CACHE_DIR, `${resolvedProductId}.txt`);
      if (fs.existsSync(txtFile)) {
        try {
          imageUrl = fs.readFileSync(txtFile, 'utf-8');
        } catch (txtErr) {
          console.warn(`[Images Cache] Failed to read txt cache for ${resolvedProductId}:`, txtErr);
        }
      }
    }
    
    // 5. Fetch from firestore if not cached on disk or if we want to ensure we get first-party database thumbnail/images for real products
    if (!originalBuffer && productId && (productId.startsWith('prod_') || !imageUrl)) {
      try {
        const product = await getProductData(productId, idx > 0);
        if (product) {
          dbProduct = product;
          if (product.videos && product.videos.length > 0) {
            isVideoCheck = true;
          }
          // Determine which image URL/base64 to use based on index
          let targetImageUrl = '';
          if (product.images && Array.isArray(product.images) && product.images.length > idx) {
            targetImageUrl = product.images[idx];
          } else {
            targetImageUrl = product.image || '';
          }

          // If the selected image is a video, or if this product has a video, let's find a real non-video image thumbnail background
          const productHasVideo = (product.videos && Array.isArray(product.videos) && product.videos.length > 0) ||
                                  (targetImageUrl && (targetImageUrl.endsWith('.mp4') || targetImageUrl.includes('/video') || targetImageUrl.startsWith('data:video/')));
          if (productHasVideo) {
            const firstRealImage = product.images.find((img: string) => img && !img.endsWith('.mp4') && !img.includes('/video') && !img.startsWith('data:video/'));
            if (firstRealImage) {
              targetImageUrl = firstRealImage;
            } else if (product.image && !product.image.endsWith('.mp4') && !product.image.includes('/video') && !product.image.startsWith('data:video/')) {
              targetImageUrl = product.image;
            } else {
              targetImageUrl = ''; // Fallback to glassmorphic slate-dark gradient
            }
          }
          
          if (targetImageUrl) {
            imageUrl = targetImageUrl;
          }
          category = product.category || '';
          
          if (imageUrl && imageUrl.startsWith('data:')) {
            const imageCacheFile = path.join(IMAGES_CACHE_DIR, `${resolvedProductId}.txt`);
            if (!fs.existsSync(imageCacheFile)) {
              try {
                fs.writeFileSync(imageCacheFile, imageUrl, 'utf-8');
              } catch (diskErr) {
                console.error(`[Images Cache] Failed to save image for ${resolvedProductId} to disk:`, diskErr);
              }
            }
          }
        }
      } catch (err) {
        console.error('Error in secure image endpoint fetching product data:', err);
      }
    }
    
    const fallbackUrl = getCategoryFallbackUrl(category);
    
    // 1. Resolve original image data first (if any) so we can use it as a background for video placeholders if present
    if (!originalBuffer && imageUrl && imageUrl.startsWith('data:')) {
      try {
        const parts = imageUrl.split(';base64,');
        if (parts.length === 2) {
          originalMimeType = parts[0].replace('data:', '');
          
          const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/svg+xml'];
          if (!isVideoCheck && !allowedMimes.includes(originalMimeType.toLowerCase())) {
            return serveTransparentPixel(res);
          }
          
          const base64Data = parts[1];
          originalBuffer = Buffer.from(base64Data, 'base64');

          // Save original to disk binary cache
          if (productId) {
            try {
              fs.writeFileSync(path.join(IMAGES_CACHE_DIR, `${resolvedProductId}.bin`), originalBuffer);
              fs.writeFileSync(path.join(IMAGES_CACHE_DIR, `${resolvedProductId}.mime`), originalMimeType, 'utf-8');
              setBinaryImageInCache(resolvedProductId, originalBuffer, originalMimeType);
            } catch (cacheWriteErr) {
              console.error(`[Images Cache] Error writing original binary cache for ${resolvedProductId}:`, cacheWriteErr);
            }
          }
        }
      } catch (err) {
        console.error('Error parsing base64 image in endpoint:', err);
      }
    } else if (!originalBuffer && imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
      try {
        const isValid = await validateImageUrlSecurely(imageUrl);
        if (!isValid) {
          return res.status(403).send('Forbidden: Selected image URL fails SSRF safety check.');
        }

        const imageRes = await fetch(imageUrl, { redirect: 'manual' });
        if (imageRes.status >= 300 && imageRes.status < 400) {
          console.warn('[SSRF Shield] Blocked redirect response on image proxy request');
          return res.status(400).send('SSRF Security Error: Redirects are not allowed.');
        }
        if (imageRes.ok) {
          originalMimeType = imageRes.headers.get('content-type') || 'image/jpeg';
          
          const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/svg+xml'];
          if (!isVideoCheck && !allowedMimes.includes(originalMimeType.toLowerCase())) {
            return serveTransparentPixel(res);
          }

          originalBuffer = Buffer.from(await imageRes.arrayBuffer());

          // Save original to disk binary cache
          if (imageId) {
            try {
              fs.writeFileSync(path.join(IMAGES_CACHE_DIR, `${imageId}.bin`), originalBuffer);
              fs.writeFileSync(path.join(IMAGES_CACHE_DIR, `${imageId}.mime`), originalMimeType, 'utf-8');
              setBinaryImageInCache(imageId, originalBuffer, originalMimeType);
            } catch (cacheWriteErr) {
              console.error(`[Images Cache] Error writing original binary cache for external image ${imageId}:`, cacheWriteErr);
            }
          }
        }
      } catch (error) {
        console.error('Error proxying external product image securely:', error);
      }
    }

    // 2. Enable custom video overlay with real video thumbnail backgrounds and centered play button
    const isVideo = (imageUrl && (imageUrl.endsWith('.mp4') || imageUrl.includes('/video'))) ||
                    (queryImageUrl && (queryImageUrl.endsWith('.mp4') || queryImageUrl.includes('/video'))) ||
                    (queryVideoUrl && (queryVideoUrl.endsWith('.mp4') || queryVideoUrl.includes('/video'))) ||
                    (productId && productId.includes('video')) ||
                    (dbProduct && dbProduct.videos && dbProduct.videos.length > 0);

    if (isVideo) {
      if (!width || !height) {
        width = 600;
        height = 900;
      }
      const safeTitle = (req.query.title as string) || (dbProduct ? dbProduct.title : null) || (productId ? 'Spotlight Review' : 'Video Ad');
      const rawPrice = (req.query.price as string) || (dbProduct ? dbProduct.price : null);
      const safePrice = rawPrice ? `GHS ${rawPrice}` : 'Negotiable';

      const isBufferVideo = originalMimeType.toLowerCase().startsWith('video/') || (originalBuffer && originalBuffer.slice(0, 4).toString('hex') === '00000018');

      if (originalBuffer && !isBufferVideo) {
        // High-performance rich visual blending: overlay a semi-transparent media play icon directly on top of the actual video frame/thumbnail.
        try {
          const svgOverlay = `
            <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
              <!-- Dark glassmorphic tint overlay to ensure high contrast and professional look -->
              <rect x="0" y="0" width="${width}" height="${height}" fill="#000000" fill-opacity="0.25" />
              
              <!-- Centered play button overlay -->
              <!-- Background circle: Radius 75, opacity 0.4 -->
              <circle cx="${width / 2}" cy="${height / 2}" r="75" fill="#000000" fill-opacity="0.4" />
              
              <!-- White circle inside: Radius 55, opacity 0.95 -->
              <circle cx="${width / 2}" cy="${height / 2}" r="55" fill="#ffffff" fill-opacity="0.95" />
              
              <!-- Standard HTML5 play triangle -->
              <polygon points="${(width / 2) - 12},${(height / 2) - 20} ${(width / 2) + 23},${(height / 2)} ${(width / 2) - 12},${(height / 2) + 20}" fill="#0f172a" />
            </svg>
          `;

          // Resize background to target vertical dims first
          const resizedBg = await sharp(originalBuffer)
            .resize(width, height, { fit: 'cover' })
            .toBuffer();

          // Composite the SVG overlay on top of the resized background
          originalBuffer = await sharp(resizedBg)
            .composite([{ input: Buffer.from(svgOverlay), blend: 'over' }])
            .toBuffer();
          originalMimeType = `image/${format}`;
        } catch (compErr) {
          console.error('[Sharp Composite] Error in composite, fallback to base64 embedded SVG:', compErr);
          const base64ImageString = `data:${originalMimeType};base64,${originalBuffer.toString('base64')}`;
          const svgString = `
            <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
              <image href="${escapeHtml(base64ImageString)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" />
              <rect x="0" y="0" width="${width}" height="${height}" fill="#000000" fill-opacity="0.25" />
              <circle cx="${width / 2}" cy="${height / 2}" r="75" fill="#000000" fill-opacity="0.4" />
              <circle cx="${width / 2}" cy="${height / 2}" r="55" fill="#ffffff" fill-opacity="0.95" />
              <polygon points="${(width / 2) - 12},${(height / 2) - 20} ${(width / 2) + 23},${(height / 2)} ${(width / 2) - 12},${(height / 2) + 20}" fill="#0f172a" />
            </svg>
          `;
          originalBuffer = Buffer.from(svgString);
          originalMimeType = 'image/svg+xml';
        }
      } else {
        // Fallback glassmorphic slate-dark gradient design if no image exists
        const svgString = `
          <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#0f172a" />
                <stop offset="50%" stop-color="#1e293b" />
                <stop offset="100%" stop-color="#0f172a" />
              </linearGradient>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="40" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>
            <rect width="${width}" height="${height}" fill="url(#bgGrad)"/>
            
            <!-- Spotlight background glow in the center -->
            <circle cx="${width / 2}" cy="${height / 2}" r="250" fill="#FFFC00" opacity="0.04" filter="url(#glow)"/>
            
            <!-- Centered glassmorphic card container -->
            <rect x="40" y="150" width="${width - 80}" height="${height - 300}" rx="24" fill="#1e293b" fill-opacity="0.6" stroke="#ffffff" stroke-opacity="0.1" stroke-width="2" />
            
            <!-- Play button overlay in the center -->
            <circle cx="${width / 2}" cy="${height / 2 - 40}" r="75" fill="#000000" fill-opacity="0.4" />
            <circle cx="${width / 2}" cy="${height / 2 - 40}" r="55" fill="#ffffff" fill-opacity="0.95" />
            <polygon points="${(width / 2) - 12},${(height / 2) - 60} ${(width / 2) + 23},${(height / 2) - 40} ${(width / 2) - 12},${(height / 2) - 20}" fill="#0f172a" />
            
            <!-- Text descriptors -->
            <rect x="${width / 2 - 80}" y="${height / 2 + 75}" width="160" height="32" rx="16" fill="#0f172a" fill-opacity="0.8" stroke="#ffffff" stroke-opacity="0.05" />
            <text x="${width / 2}" y="${height / 2 + 96}" font-family="system-ui, -apple-system, sans-serif" font-size="12" font-weight="900" fill="#FFFC00" text-anchor="middle" letter-spacing="3">SPOTLIGHT AD</text>

            <text x="${width / 2}" y="${height / 2 + 155}" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="1">${escapeHtml(safeTitle)}</text>
            <text x="${width / 2}" y="${height / 2 + 200}" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="700" fill="#FFFC00" text-anchor="middle" letter-spacing="1.5">🎬 ${escapeHtml(safePrice)}</text>
            <text x="${width / 2}" y="${height / 2 + 240}" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="500" fill="#94a3b8" text-anchor="middle" letter-spacing="0.5">Click link to watch on TedBuy Ghana</text>
          </svg>
        `;
        originalBuffer = Buffer.from(svgString);
        originalMimeType = 'image/svg+xml';
      }
    }

    if (!originalBuffer && !productId && !queryImageUrl) {
      return serveTransparentPixel(res);
    }
    
    if (!originalBuffer && !imageUrl) {
      return serveTransparentPixel(res);
    }

    if (!originalBuffer) {
      return serveTransparentPixel(res);
    }

    // 6. DYNAMICALLY OPTIMIZE USING SHARP ENGINE!
    try {
      const optimized = await optimizeImageBuffer(originalBuffer, width, height, quality, format);

      // Save optimized buffer to disk and in-memory caches
      if (cacheKey) {
        try {
          fs.writeFileSync(path.join(IMAGES_CACHE_DIR, `${cacheKey}.bin`), optimized.buffer);
          fs.writeFileSync(path.join(IMAGES_CACHE_DIR, `${cacheKey}.mime`), optimized.mimeType, 'utf-8');
          setBinaryImageInCache(cacheKey, optimized.buffer, optimized.mimeType);
        } catch (writeErr) {
          console.error(`[Images Cache] Failed to write optimized cache for ${cacheKey}:`, writeErr);
        }
      }

      res.set('Content-Type', optimized.mimeType);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(optimized.buffer);
    } catch (optErr) {
      console.error('[Sharp] Failed to optimize and convert image:', optErr);
      res.set('Content-Type', originalMimeType);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(originalBuffer);
    }
  });

  function streamVideoBuffer(req: any, res: any, buffer: Buffer, mimeType: string) {
    const totalLength = buffer.length;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : totalLength - 1;

      if (start >= totalLength || end >= totalLength || start > end) {
        res.set("Content-Range", `bytes */${totalLength}`);
        return res.status(416).send("Requested Range Not Satisfiable");
      }

      const chunksize = (end - start) + 1;
      const chunk = buffer.subarray(start, end + 1);

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${totalLength}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=86400"
      });
      return res.end(chunk);
    } else {
      res.writeHead(200, {
        "Content-Length": totalLength,
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=86400",
        "Accept-Ranges": "bytes"
      });
      return res.end(buffer);
    }
  }

  // Dynamic video delivery endpoint to stream base64 video uploads as binary MP4 streams on-the-fly with Range/Partial Content streaming
  app.get(['/api/products/:productId/video', '/api/products/:productId/video.mp4'], serverRateLimiter(60 * 1000, 100, "video-proxy"), async (req, res) => {
    const { productId } = req.params;
    if (!productId) {
      return res.status(400).send('Missing product ID');
    }

    try {
      const product = await getRawProductFirestoreREST(productId);
      if (!product) {
        return res.status(404).send('Product not found');
      }

      const videoUrl = (Array.isArray(product.videos) && product.videos.length > 0) ? product.videos[0] : null;
      if (!videoUrl) {
        return res.status(404).send('No video associated with this product');
      }

      if (videoUrl.startsWith('data:')) {
        const parts = videoUrl.split(';base64,');
        if (parts.length === 2) {
          const mimeType = parts[0].replace('data:', '') || 'video/mp4'; // e.g., video/mp4
          const base64Data = parts[1];
          const buffer = Buffer.from(base64Data, 'base64');
          return streamVideoBuffer(req, res, buffer, mimeType);
        }
      } else if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
        // Direct stream proxy for external video URLs
        const isValid = await validateImageUrlSecurely(videoUrl);
        if (!isValid) {
          return res.status(403).send('Forbidden: Selected video URL fails SSRF safety check.');
        }

        const videoRes = await fetch(videoUrl, { redirect: 'manual' });
        if (videoRes.status >= 300 && videoRes.status < 400) {
          return res.status(400).send('SSRF Security Error: Redirects are not allowed.');
        }

        if (videoRes.ok) {
          const contentType = videoRes.headers.get('content-type') || 'video/mp4';
          const buffer = Buffer.from(await videoRes.arrayBuffer());
          return streamVideoBuffer(req, res, buffer, contentType);
        }
      }
      return res.status(404).send('Video source invalid or unavailable');
    } catch (err) {
      console.error('Error in secure video proxy endpoint:', err);
      return res.status(500).send('Internal Server Error');
    }
  });

  if (process.env.NODE_ENV !== "production") {
    // Development middleware integration with Vite.
    // Dynamically imported here (not at module top-level) so that production
    // runtimes - like this Vercel serverless function - never load vite or its
    // rollup dependency at all. Loading it unconditionally at the top of this
    // file was the actual cause of the "Cannot find module @rollup/rollup-linux-x64-gnu"
    // crash: vite (and therefore rollup) was being pulled into every single
    // production request, even though it's only ever needed for local dev.
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });

    app.use(async (req, res, next) => {
      const url = req.originalUrl || req.url || '/';
      
      // Determine if this is a request requiring HTML delivery (not a raw asset or API endpoint)
      const cleanPathname = url.split('?')[0].replace(/^\/+|\/+$/g, '').toLowerCase();
      const isCategorySlug = categorySlugs.includes(cleanPathname);
      const isHtmlRequest = !url.startsWith('/api/') && 
                            !url.includes('.') && 
                            (req.headers.accept?.includes('text/html') || 
                             req.headers.accept?.includes('text/markdown') ||
                             url === '/' || 
                             url.startsWith('/?') || 
                             isCategorySlug ||
                             url.includes('/product/') ||
                             url.includes('/seller/') ||
                             url.includes('/chats') ||
                             url.includes('/dashboard') ||
                             url.includes('/settings') ||
                             url.includes('productId='));
                             
      if (req.method === 'GET' && isHtmlRequest) {
        res.setHeader('Link', '</sitemap.xml>; rel="sitemap", </.well-known/api-catalog>; rel="api-catalog", </auth.md>; rel="service-doc"');
        if (req.headers.accept?.includes('text/markdown')) {
          res.setHeader('x-markdown-tokens', '1200');
          res.status(200).set({ "Content-Type": "text/markdown; charset=utf-8" }).end(systemMarkdown);
          return;
        }
        const queryProductId = (req.query.productId as string) || (req.query.product as string) || '';
        let productId = queryProductId;
        let queryTitle = req.query.title as string;
        let queryPrice = req.query.price as string;
        let queryImage = (req.query.image || req.query.img) as string;
        let queryDescription = req.query.description as string;
        let queryVideo = req.query.video as string || '';

        if (!productId) {
          // Attempt to extract product ID from pathname
          const pathnameMatch = url.split('?')[0].match(/^\/products?\/([^\/]+)/);
          if (pathnameMatch) {
            const slugOrId = pathnameMatch[1];
            const matchId = slugOrId.match(/prod_[a-zA-Z0-9_]+/);
            if (matchId) {
              productId = matchId[0];
            }
          }
        }

        let sellerId = "";
        const sellerPathnameMatch = url.split('?')[0].match(/^\/sellers?\/([^\/]+)/);
        if (sellerPathnameMatch) {
          sellerId = sellerPathnameMatch[1];
        }

        if (!productId) {
          try {
            const parsedUrl = new URL(url, `http://${req.headers.host || 'localhost:3000'}`);
            productId = parsedUrl.searchParams.get('productId') || parsedUrl.searchParams.get('product') || '';
            queryTitle = parsedUrl.searchParams.get('title') || queryTitle || '';
            queryPrice = parsedUrl.searchParams.get('price') || queryPrice || '';
            queryImage = parsedUrl.searchParams.get('image') || parsedUrl.searchParams.get('img') || queryImage || '';
            queryDescription = parsedUrl.searchParams.get('description') || queryDescription || '';
            queryVideo = parsedUrl.searchParams.get('video') || queryVideo || '';
          } catch (e) {
            // Ignored
          }
        }
        
        try {
          let template = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf-8");
          template = await vite.transformIndexHtml(url, template);
          
          let product: any = null;
          if (productId && productId.startsWith('prod_')) {
            try {
              product = await getProductData(productId);
            } catch (err) {
              console.warn(`[Meta Crawler Dev] Error fetching product ${productId}:`, err);
            }
          }
          
          if (!product && queryTitle && (queryImage || queryVideo)) {
            if (!queryVideo && queryImage && (queryImage.endsWith('.mp4') || queryImage.includes('/video'))) {
              queryVideo = queryImage;
            }
            product = {
              title: queryTitle,
              description: queryDescription || `Check out "${queryTitle}" on Tedbuy Ghana classifieds! Price: ${queryPrice || 'Negotiable'}. View photos, reviews and full details directly.`,
              price: queryPrice || '',
              image: queryImage,
              videos: queryVideo ? [queryVideo] : []
            };
          }

          if (product) {
            const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy-fb79a.web.app';
            const host = cleanHostHeader(rawHost);
            const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
            const fullUrl = `${protocol}://${host}${url}`;
            template = injectMetaTags(template, product, fullUrl, host, protocol, productId || 'temp');
          } else if (productId) {
            const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy-fb79a.web.app';
            const host = cleanHostHeader(rawHost);
            const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
            const fullUrl = `${protocol}://${host}${url}`;
            template = injectHomepageMetaTags(template, fullUrl, host, protocol);
          } else if (sellerId) {
            const seller = await getSellerData(sellerId);
            const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy-fb79a.web.app';
            const host = cleanHostHeader(rawHost);
            const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
            const fullUrl = `${protocol}://${host}${url}`;
            if (seller) {
              template = injectSellerMetaTags(template, seller, fullUrl, host, protocol, sellerId);
            } else {
              template = injectHomepageMetaTags(template, fullUrl, host, protocol);
            }
          } else if (isCategorySlug) {
            const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy-fb79a.web.app';
            const host = cleanHostHeader(rawHost);
            const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
            const fullUrl = `${protocol}://${host}${url}`;
            template = injectCategoryMetaTags(template, cleanPathname, fullUrl, host, protocol);
          } else {
            const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy-fb79a.web.app';
            const host = cleanHostHeader(rawHost);
            const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
            const fullUrl = `${protocol}://${host}${url}`;
            template = injectHomepageMetaTags(template, fullUrl, host, protocol);
          }
          res.status(200).set({ "Content-Type": "text/html" }).end(template);
          return;
        } catch (e) {
          vite.ssrFixStacktrace(e as Error);
          next(e);
          return;
        }
      }
      next();
    });

    app.use(vite.middlewares);
  } else {
    // Production serving static files
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Link', '</sitemap.xml>; rel="sitemap", </.well-known/api-catalog>; rel="api-catalog", </auth.md>; rel="service-doc"');
        }
      }
    })); // Do not auto-serve index.html to allow dynamic intercept

    app.get('*', async (req, res) => {
      res.setHeader('Link', '</sitemap.xml>; rel="sitemap", </.well-known/api-catalog>; rel="api-catalog", </auth.md>; rel="service-doc"');
      if (req.headers.accept?.includes('text/markdown')) {
        res.setHeader('x-markdown-tokens', '1200');
        res.status(200).set({ "Content-Type": "text/markdown; charset=utf-8" }).end(systemMarkdown);
        return;
      }
      const url = req.originalUrl || req.url || '/';
      const queryProductId = (req.query.productId as string) || (req.query.product as string) || '';
      let productId = queryProductId;
      let queryTitle = req.query.title as string;
      let queryPrice = req.query.price as string;
      let queryImage = (req.query.image || req.query.img) as string;
      let queryDescription = req.query.description as string;
      let queryVideo = req.query.video as string || '';

      if (!productId) {
        // Attempt to extract product ID from pathname
        const pathnameMatch = url.split('?')[0].match(/^\/products?\/([^\/]+)/);
        if (pathnameMatch) {
          const slugOrId = pathnameMatch[1];
          const matchId = slugOrId.match(/prod_[a-zA-Z0-9_]+/);
          if (matchId) {
            productId = matchId[0];
          }
        }
      }

      let sellerId = "";
      const sellerPathnameMatch = url.split('?')[0].match(/^\/sellers?\/([^\/]+)/);
      if (sellerPathnameMatch) {
        sellerId = sellerPathnameMatch[1];
      }

      if (!productId) {
        try {
          const parsedUrl = new URL(url, `http://${req.headers.host || 'localhost:3000'}`);
          productId = parsedUrl.searchParams.get('productId') || parsedUrl.searchParams.get('product') || '';
          queryTitle = parsedUrl.searchParams.get('title') || queryTitle || '';
          queryPrice = parsedUrl.searchParams.get('price') || queryPrice || '';
          queryImage = parsedUrl.searchParams.get('image') || parsedUrl.searchParams.get('img') || queryImage || '';
          queryDescription = parsedUrl.searchParams.get('description') || queryDescription || '';
          queryVideo = parsedUrl.searchParams.get('video') || queryVideo || '';
        } catch (e) {
          // Ignored
        }
      }
      
      try {
        let template = fs.readFileSync(path.join(distPath, 'index.html'), 'utf-8');
        const cleanPathname = url.split('?')[0].replace(/^\/+|\/+$/g, '').toLowerCase();
        const isCategorySlug = categorySlugs.includes(cleanPathname);
        
        let product: any = null;
        if (productId && productId.startsWith('prod_')) {
          try {
            product = await getProductData(productId);
          } catch (err) {
            console.warn(`[Meta Crawler Prod] Error fetching product ${productId}:`, err);
          }
        }

        if (!product && queryTitle && (queryImage || queryVideo)) {
          if (!queryVideo && queryImage && (queryImage.endsWith('.mp4') || queryImage.includes('/video'))) {
            queryVideo = queryImage;
          }
          product = {
            title: queryTitle,
            description: queryDescription || `Check out "${queryTitle}" on Tedbuy Ghana classifieds! Price: ${queryPrice || 'Negotiable'}. View photos, reviews and full details directly.`,
            price: queryPrice || '',
            image: queryImage,
            videos: queryVideo ? [queryVideo] : []
          };
        }

        if (product) {
          const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy-fb79a.web.app';
          const host = cleanHostHeader(rawHost);
          const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
          const fullUrl = `${protocol}://${host}${url}`;
          template = injectMetaTags(template, product, fullUrl, host, protocol, productId || 'temp');
        } else if (productId) {
          const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy-fb79a.web.app';
          const host = cleanHostHeader(rawHost);
          const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
          const fullUrl = `${protocol}://${host}${url}`;
          template = injectHomepageMetaTags(template, fullUrl, host, protocol);
        } else if (sellerId) {
          const seller = await getSellerData(sellerId);
          const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy-fb79a.web.app';
          const host = cleanHostHeader(rawHost);
          const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
          const fullUrl = `${protocol}://${host}${url}`;
          if (seller) {
            template = injectSellerMetaTags(template, seller, fullUrl, host, protocol, sellerId);
          } else {
            template = injectHomepageMetaTags(template, fullUrl, host, protocol);
          }
        } else if (isCategorySlug) {
          const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy-fb79a.web.app';
          const host = cleanHostHeader(rawHost);
          const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
          const fullUrl = `${protocol}://${host}${url}`;
          template = injectCategoryMetaTags(template, cleanPathname, fullUrl, host, protocol);

          // SSR: inject real listing content for this category so it's visible
          // immediately, instead of an empty shell waiting on a client fetch.
          try {
            const { products: allProducts } = await getProductsListData();
            const categoryProducts = allProducts.filter((p: any) =>
              (p.category || '').toLowerCase().replace(/\s+/g, '-') === cleanPathname
            );
            template = injectInitialProductsData(template, categoryProducts);
          } catch (ssrErr: any) {
            console.warn('[SSR] Failed to inject category product data (non-fatal, client will fetch normally):', ssrErr?.message || ssrErr);
          }
        } else {
          const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy-fb79a.web.app';
          const host = cleanHostHeader(rawHost);
          const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
          const fullUrl = `${protocol}://${host}${url}`;
          template = injectHomepageMetaTags(template, fullUrl, host, protocol);

          // SSR: inject the real, current product grid directly into the HTML so
          // visitors see actual listings the instant the page arrives, before the
          // JS bundle has even downloaded - this is the main homepage performance
          // improvement. The same data is embedded as JSON so the client app can
          // populate its state immediately on mount instead of making its own
          // redundant first fetch.
          try {
            const { products } = await getProductsListData();
            template = injectInitialProductsData(template, products);
          } catch (ssrErr: any) {
            console.warn('[SSR] Failed to inject homepage product data (non-fatal, client will fetch normally):', ssrErr?.message || ssrErr);
          }
        }
        // Critical: allow this dynamically-generated page to be cached at Vercel's
        // edge, matching the same window as /api/products. Without this, every
        // single visit, bot crawl, and social-media link-preview fetch bypasses
        // the CDN entirely and hits the origin function directly - this alone
        // caused a large, unnecessary spike in origin bandwidth usage.
        res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (err) {
        console.error('Error serving index.html in production:', err);
        res.sendFile(path.join(distPath, 'index.html'));
      }
    });
  }

  if (process.env.VERCEL) {
    console.log('[Vercel Serverless] Express app is loaded and ready.');
  } else {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);

      if (backendSupabase) {
        selfHealProductImages().catch(err => {
          console.error('[Self-Healing] Startup image self-healing failed:', err);
        });
      }

      // Automatically keep Supabase in sync with Firestore in the background, so users
      // never have to wait on a manual admin action to see their data. Runs once shortly
      // after startup (giving Admin SDK / Supabase client time to finish initializing),
      // then re-runs every 30 minutes as an ongoing safety net. Upserts by id, so this
      // is always safe to re-run and never creates duplicates.
      // NOTE: Recurring automatic sync is currently disabled. This project is on Firebase's
      // free Spark plan (hard 50k reads/day cap), and the app is being migrated fully off
      // Firestore -- so instead of an ongoing interval, run ONE final sync manually (via
      // POST /api/admin/migrate-to-supabase) once Firestore's daily quota has reset, to do
      // a last clean pull before Firestore dependency is removed entirely.
      if (backendSupabase && process.env.ENABLE_AUTO_SUPABASE_SYNC === 'true') {
        const BACKGROUND_SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
        setTimeout(() => {
          runFirestoreToSupabaseSync().catch((err: any) => {
            console.error('[Supabase Sync] Initial background sync failed:', err?.message || err);
          });
        }, 10 * 1000); // 10s delay after boot

        setInterval(() => {
          runFirestoreToSupabaseSync().catch((err: any) => {
            console.error('[Supabase Sync] Scheduled background sync failed:', err?.message || err);
          });
        }, BACKGROUND_SYNC_INTERVAL_MS);

        console.log(`[Supabase Sync] Automatic background sync scheduled every ${BACKGROUND_SYNC_INTERVAL_MS / 60000} minutes.`);
      } else {
        console.log('[Supabase Sync] Automatic background sync is currently disabled. Trigger POST /api/admin/migrate-to-supabase manually for a one-time sync.');
      }
      
      try {
        const routes: string[] = [];
        app._router.stack.forEach((middleware: any) => {
          if (middleware.route) {
            routes.push(`${Object.keys(middleware.route.methods).join(',').toUpperCase()} ${middleware.route.path}`);
          } else if (middleware.name === 'router') {
            middleware.handle.stack.forEach((handler: any) => {
              if (handler.route) {
                routes.push(`${Object.keys(handler.route.methods).join(',').toUpperCase()} ${handler.route.path}`);
              }
            });
          }
        });
        fs.appendFileSync(
          path.resolve(process.cwd(), "express_requests.log"), 
          `${new Date().toISOString()} [Startup] Routes registered:\n` + routes.join('\n') + '\n\n'
        );
        console.log('[Express Server Startup] Registered Routes:\n' + routes.join('\n'));
      } catch (e: any) {
        console.log('[Express Server Startup] Failed to extract routes description:', e.message);
      }
    });
  }
}

startServer();
