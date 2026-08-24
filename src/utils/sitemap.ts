import fs from 'fs';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
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
  'fashion',
  'home-appliances',
  'vehicles',
  'property',
  'furniture-home',
  'beauty-and-care',
  'games',
  'electronics',
  'services',
  'jobs-employment',
  'agriculture-food',
  'pets-animals',
  'sports-fitness',
  'kids-baby',
  'commercial-tools',
  'books-hobbies',
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
function getSupabaseClient(): SupabaseClient | null {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  if (!supabaseUrl || !supabaseKey) {
    console.error('[Sitemap Service] Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY.');
    return null;
  }
  return createClient(supabaseUrl, supabaseKey);
}

/**
 * Fetches all products and store profiles from Supabase in an optimized way
 */
async function fetchSitemapDataset(): Promise<CachedSitemapData> {
  const client = getSupabaseClient();
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

  // 3. Fetch Products from Supabase
  if (!client) {
    return {
      staticUrls,
      categoryUrls,
      productUrls,
      storeUrls,
      loadedAt: Date.now()
    };
  }

  try {
    const { data, error } = await client
      .from('products')
      .select('*')
      .limit(100000);

    if (error) {
      throw error;
    }

    const products = Array.isArray(data) ? data : [];
    for (const item of products) {
      const id = (item as any).id;
      const title = (item as any).title || '';
      const createdAt = (item as any).createdAt || today;
      const status = (item as any).status;
      const isSold = status === 'sold' || (item as any).isSold === true;

      if (id && title && !isSold) {
        const slug = slugify(title);
        const updateDate = new Date(createdAt).toISOString().split('T')[0] || today;
        productUrls.push({
          loc: `/product/${id}-${slug}`,
          lastmod: updateDate,
          changefreq: 'weekly',
          priority: '0.8'
        });
      }
    }
    console.log(`[Sitemap Service] Successfully indexed ${productUrls.length} active products from Supabase.`);
  } catch (err) {
    console.error('[Sitemap Service] Error fetching products from Supabase:', err);
  }

  // 4. Fetch Users/Sellers from Supabase
  try {
    const { data, error } = await client
      .from('users')
      .select('*')
      .limit(100000);

    if (error) {
      throw error;
    }

    const users = Array.isArray(data) ? data : [];
    for (const item of users) {
      const id = (item as any).id;
      const username = (item as any).username || '';
      const role = (item as any).role || 'seller';
      const updatedAt = (item as any).createdAt || (item as any).joinDate || today;

      if (id && username && (role === 'seller' || role === 'both')) {
        const updateDate = new Date(updatedAt).toISOString().split('T')[0] || today;
        storeUrls.push({
          loc: `/seller/${id}`,
          lastmod: updateDate,
          changefreq: 'weekly',
          priority: '0.7'
        });
      }
    }
    console.log(`[Sitemap Service] Successfully indexed ${storeUrls.length} seller profiles from Supabase.`);
  } catch (err) {
    console.error('[Sitemap Service] Error fetching sellers from Supabase:', err);
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
