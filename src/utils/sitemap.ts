import fs from 'fs';
import path from 'path';
import { slugify } from './slugify.js';

export interface SitemapUrl {
  loc: string;
  lastmod: string;
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority: string;
}

export interface CachedSitemapData {
  staticUrls: SitemapUrl[];
  categoryUrls: SitemapUrl[];
  productUrls: SitemapUrl[];
  storeUrls: SitemapUrl[];
  loadedAt: number;
}

// Memory-cached sitemap data with stampede protection
let cachedData: CachedSitemapData | null = null;
let activeFetchPromise: Promise<CachedSitemapData> | null = null;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// Static category slugs used on Tedbuy
const CATEGORIES = [
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

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

/**
 * Loads firebase config to retrieve projectId and apiKey dynamically
 */
function getFirebaseConfig() {
  let projectId = 'tedbuy-production'; // Fallback
  let apiKey = '';
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.projectId) projectId = config.projectId;
      if (config.apiKey) apiKey = config.apiKey;
    }
  } catch (err) {
    console.error('[Sitemap Service] Failed to load firebase-applet-config.json:', err);
  }
  return { projectId, apiKey };
}

/**
 * Fetches all products and store profiles from Firestore REST API in an optimized way
 */
async function fetchSitemapDataset(): Promise<CachedSitemapData> {
  const { projectId, apiKey } = getFirebaseConfig();
  const today = new Date().toISOString().split('T')[0];

  console.log('[Sitemap Service] Regenerating fresh sitemap dataset in background...');

  // 1. Compile Static URLs
  const staticPaths = [
    '',
    '/about',
    '/contact',
    '/privacy',
    '/terms',
    '/help',
    '/categories'
  ];
  const staticUrls: SitemapUrl[] = staticPaths.map(p => ({
    loc: p, // relative to be mapped later with dynamic baseUrl
    lastmod: today,
    changefreq: 'monthly',
    priority: p === '' ? '1.0' : '0.6'
  }));

  // 2. Compile Categories URLs
  const categoryUrls: SitemapUrl[] = CATEGORIES.map(cat => ({
    loc: `/category/${cat}`,
    lastmod: today,
    changefreq: 'daily',
    priority: '0.9'
  }));

  const productUrls: SitemapUrl[] = [];
  const storeUrls: SitemapUrl[] = [];

  // 3. Fetch Products (Using projection for high efficiency)
  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery${apiKey ? `?key=${apiKey}` : ""}`;
    const response = await fetch(firestoreUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'products', allDescendants: false }],
          // Projection selects only title & createdAt to keep payload tiny
          select: {
            fields: [
              { fieldPath: 'title' },
              { fieldPath: 'createdAt' },
              { fieldPath: 'isSold' }
            ]
          },
          limit: 100000 // Support massive scale up to 100k
        }
      }),
      signal: AbortSignal.timeout(6000)
    });

    if (response.ok) {
      const results = await response.json();
      const docs = Array.isArray(results) ? results : [];
      
      for (const item of docs) {
        if (!item || !item.document) continue;
        const doc = item.document;
        const nameParts = doc.name ? doc.name.split('/') : [];
        const id = nameParts[nameParts.length - 1];
        
        const fields = doc.fields || {};
        const title = fields.title?.stringValue || '';
        const createdAt = fields.createdAt?.stringValue || today;
        const isSold = fields.isSold?.booleanValue || false;
        
        // Skip sold listings if we want strictly active commercial listings
        if (id && title && !isSold) {
          const slug = slugify(title);
          const updateDate = doc.updateTime ? doc.updateTime.split('T')[0] : (createdAt ? createdAt.split('T')[0] : today);
          productUrls.push({
            loc: `/product/${id}-${slug}`,
            lastmod: updateDate,
            changefreq: 'weekly',
            priority: '0.8'
          });
        }
      }
      console.log(`[Sitemap Service] Successfully indexed ${productUrls.length} active products from Firestore.`);
    } else {
      console.error('[Sitemap Service] Products fetch failed. Status:', response.status);
    }
  } catch (err) {
    console.error('[Sitemap Service] Error fetching products:', err);
  }

  // 4. Fetch Users/Sellers (Using projection)
  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery${apiKey ? `?key=${apiKey}` : ""}`;
    const response = await fetch(firestoreUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'users', allDescendants: false }],
          select: {
            fields: [
              { fieldPath: 'username' },
              { fieldPath: 'role' }
            ]
          },
          limit: 100000
        }
      }),
      signal: AbortSignal.timeout(6000)
    });

    if (response.ok) {
      const results = await response.json();
      const docs = Array.isArray(results) ? results : [];
      
      for (const item of docs) {
        if (!item || !item.document) continue;
        const doc = item.document;
        const nameParts = doc.name ? doc.name.split('/') : [];
        const id = nameParts[nameParts.length - 1];
        
        const fields = doc.fields || {};
        const username = fields.username?.stringValue || '';
        const role = fields.role?.stringValue || 'seller';
        
        // Only include active sellers or profiles with roles 'seller' or 'both'
        if (id && username && (role === 'seller' || role === 'both')) {
          const updateDate = doc.updateTime ? doc.updateTime.split('T')[0] : today;
          storeUrls.push({
            loc: `/seller/${id}`,
            lastmod: updateDate,
            changefreq: 'weekly',
            priority: '0.7'
          });
        }
      }
      console.log(`[Sitemap Service] Successfully indexed ${storeUrls.length} seller profiles from Firestore.`);
    } else {
      console.error('[Sitemap Service] Users fetch failed. Status:', response.status);
    }
  } catch (err) {
    console.error('[Sitemap Service] Error fetching sellers:', err);
  }

  return {
    staticUrls,
    categoryUrls,
    productUrls,
    storeUrls,
    loadedAt: Date.now()
  };
}

/**
 * Retrieves the cached dataset or triggers a new fetch with Stampede Prevention
 */
export async function getSitemapDataset(): Promise<CachedSitemapData> {
  const now = Date.now();
  if (cachedData && (now - cachedData.loadedAt < CACHE_TTL)) {
    return cachedData;
  }

  if (activeFetchPromise) {
    return activeFetchPromise;
  }

  activeFetchPromise = fetchSitemapDataset().then((data) => {
    cachedData = data;
    activeFetchPromise = null;
    return data;
  }).catch((err) => {
    activeFetchPromise = null;
    // Fallback: use stale cached data if database fails
    if (cachedData) {
      console.warn('[Sitemap Service] Database fetch failed. Serving stale cached dataset as fallback.', err);
      return cachedData;
    }
    // Deep fallback
    return {
      staticUrls: [
        { loc: '', lastmod: new Date().toISOString().split('T')[0], changefreq: 'monthly', priority: '1.0' },
        { loc: '/about', lastmod: new Date().toISOString().split('T')[0], changefreq: 'monthly', priority: '0.6' },
        { loc: '/contact', lastmod: new Date().toISOString().split('T')[0], changefreq: 'monthly', priority: '0.6' },
        { loc: '/privacy', lastmod: new Date().toISOString().split('T')[0], changefreq: 'monthly', priority: '0.6' },
        { loc: '/terms', lastmod: new Date().toISOString().split('T')[0], changefreq: 'monthly', priority: '0.6' }
      ],
      categoryUrls: CATEGORIES.map(cat => ({
        loc: `/category/${cat}`,
        lastmod: new Date().toISOString().split('T')[0],
        changefreq: 'daily',
        priority: '0.9'
      })),
      productUrls: [],
      storeUrls: [],
      loadedAt: Date.now()
    };
  });

  return activeFetchPromise;
}

/**
 * Builds standard XML output from URL list
 */
export function generateUrlSetXml(baseUrl: string, urls: SitemapUrl[]): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  for (const url of urls) {
    const fullLoc = url.loc.startsWith('http') ? url.loc : `${baseUrl}${url.loc}`;
    xml += `  <url>\n`;
    xml += `    <loc>${escapeXml(fullLoc)}</loc>\n`;
    xml += `    <lastmod>${url.lastmod}</lastmod>\n`;
    xml += `    <changefreq>${url.changefreq}</changefreq>\n`;
    xml += `    <priority>${url.priority}</priority>\n`;
    xml += `  </url>\n`;
  }

  xml += `</urlset>\n`;
  return xml;
}

/**
 * Builds Sitemap Index XML
 */
export function generateSitemapIndexXml(baseUrl: string, sitemaps: { loc: string; lastmod: string }[]): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  for (const sm of sitemaps) {
    const fullLoc = sm.loc.startsWith('http') ? sm.loc : `${baseUrl}${sm.loc}`;
    xml += `  <sitemap>\n`;
    xml += `    <loc>${escapeXml(fullLoc)}</loc>\n`;
    xml += `    <lastmod>${sm.lastmod}</lastmod>\n`;
    xml += `  </sitemap>\n`;
  }

  xml += `</sitemapindex>\n`;
  return xml;
}

export function clearSitemapCache(): void {
  cachedData = null;
}
