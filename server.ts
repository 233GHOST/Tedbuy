import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import net from "net";
import dns from "dns";
import { promisify } from "util";
import { getSitemapDataset, generateUrlSetXml, generateSitemapIndexXml } from "./src/utils/sitemap.js";

const lookupAsync = promisify(dns.lookup);

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- SERVER-SIDE IP RATE LIMITER IMPLEMENTATION ---
const rateLimitStore: Record<string, { count: number; resetTime: number }> = {};

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

const PORT = 3000;

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

// REST API helper to fetch product info directly from Firestore
async function getProductData(productId: string) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/products/${productId}${apiKey ? `?key=${apiKey}` : ""}`;
    console.log(`[Meta Crawler] Fetching product from Firestore REST URL: ${url}`);
    
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[Meta Crawler] Firestore product fetch failed for ${productId} with status: ${res.status}`);
      const errText = await res.text();
      console.warn(`[Meta Crawler] Response error payload:`, errText);
      return null;
    }
    const data = await res.json();
    
    // Parse response
    const fields = data.fields || {};
    const title = fields.title?.stringValue || '';
    const description = fields.description?.stringValue || '';
    const priceValue = fields.price?.stringValue || fields.price?.integerValue || fields.price?.doubleValue || 'Negotiable';
    const imagesVal = fields.images?.arrayValue?.values || [];
    const images = imagesVal.map((v: any) => v.stringValue).filter(Boolean);
    const primaryImage = images[0] || 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=400&q=80';

    console.log(`[Meta Crawler] Successfully fetched product data for ${productId}: "${title}", Price: "${priceValue}", Image starting with: ${primaryImage.slice(0, 50)}...`);

    return {
      title,
      description,
      price: priceValue,
      image: primaryImage
    };
  } catch (err) {
    console.error('[Meta Crawler] Error fetching product data from Firestore REST:', err);
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
function injectMetaTags(html: string, product: { title: string; description: string; price: string; image: string }, shareUrl: string, host: string, protocol: string, productId: string): string {
  const pricePrefix = product.price ? `GHS ${product.price}` : 'Negotiable';
  const title = `${product.title} - ${pricePrefix} | TedBuy Ghana`;
  const description = `${product.description.slice(0, 160)}${product.description.length > 160 ? '...' : ''} | Buy/Sell on TedBuy`;
  
  // ALWAYS use our dynamic image wrapper endpoint to deliver first-party, absolute, redirect-free, fully-qualified web-optimized JPG images.
  // This solves base64 size limits, external redirects and domain/port mismatch crawler bugs perfectly.
  const image = `${protocol}://${host}/api/products/${productId}/image.jpg`;

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

  console.log(`[Meta Crawler] Injecting Open Graph and JSON-LD tags. URL: ${shareUrl}, Canonical URL: ${canonicalUrl}, Image URL: ${image}`);

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
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:type" content="product" />
    <meta property="og:site_name" content="TedBuy Ghana" />
    <meta property="og:locale" content="en_GH" />
    <!-- Twitter / X -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />
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
    imageSearch: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=600&q=80'
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
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${sellerId}${apiKey ? `?key=${apiKey}` : ""}`;
    console.log(`[Meta Crawler] Fetching seller from Firestore REST URL: ${url}`);
    
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[Meta Crawler] Firestore seller fetch failed for ${sellerId} with status: ${res.status}`);
      return null;
    }
    const data = await res.json();
    
    // Parse response
    const fields = data.fields || {};
    const username = fields.username?.stringValue || '';
    const role = fields.role?.stringValue || 'seller';
    const photoUrl = fields.photoUrl?.stringValue || '';
    const isVerified = fields.emailVerified?.booleanValue || false;

    console.log(`[Meta Crawler] Successfully fetched seller data for ${sellerId}: "${username}"`);

    return {
      username,
      role,
      photoUrl,
      isVerified
    };
  } catch (err) {
    console.error('[Meta Crawler] Error fetching seller data from Firestore REST:', err);
    return null;
  }
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
          rejectUnauthorized: false
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
      res.setHeader('Link', '</.well-known/api-catalog>; rel="api-catalog", </auth.md>; rel="service-doc"');
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

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', projectId });
  });

  app.get('/api/products', serverRateLimiter(60 * 1000, 120, "products-list"), async (req, res) => {
    try {
      const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery${apiKey ? `?key=${apiKey}` : ""}`;
      const response = await fetch(firestoreUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          structuredQuery: {
            from: [
              {
                collectionId: "products",
                allDescendants: false
              }
            ],
            orderBy: [
              {
                field: {
                  fieldPath: "createdAt"
                },
                direction: "DESCENDING"
              }
            ],
            limit: 300
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Firestore REST API returned ${response.status}`);
      }

      const data = await response.json();
      const results = Array.isArray(data) ? data : [];
      
      const productsList = results
        .filter((item: any) => item && item.document)
        .map((item: any) => {
          try {
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
            result.id = nameParts[nameParts.length - 1] || '';
            return result;
          } catch (err) {
            console.error('[Products API] Error parsing document:', err);
            return null;
          }
        }).filter(Boolean);

      res.setHeader('Cache-Control', 'public, max-age=5, stale-while-revalidate=15');
      res.json({ success: true, products: productsList });
    } catch (error: any) {
      console.error('[Products API] Failed to fetch layout products:', error);
      res.status(500).json({ success: false, error: error.message });
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

  app.post('/api/send-welcome-email', serverRateLimiter(5 * 60 * 1000, 3, "welcome-email"), async (req, res) => {
    const { email, username } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email parameter is required.' });
    }

    const cleanName = username || email.split('@')[0] || 'there';
    const escapedName = escapeHtml(cleanName);

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
        from: '"Tedbuy" <info@tedbuy.store>',
        to: email,
        replyTo: 'info@tedbuy.store',
        subject: 'Welcome to Tedbuy Ghana',
        text: `Welcome to Tedbuy!\n\nHi ${cleanName},\n\nI wanted to check in with you to ensure that you have everything you need. I hope that your experience with Tedbuy so far has been a pleasant one. Customer experience is at the heart of everything we do. It's why we come to work each day. All replies to this email inbox are monitored by myself, so if you'd like to get in touch directly and provide any feedback which could help us help you, please hit reply (or type here in this chat!) and I'll ensure that we get onto that right away. No issue is too small. If it matters to you, it matters to us, so please do get in touch if you need to. Also, don't forget that our customer support team are here for all your day-to-day and technical questions 24/7. Thanks once again. I'm delighted to have you on board and look forward to helping you drive your business to awesome new heights.\n\nGratefully yours,\n\nVincent Asumadu,\nCEO, Tedbuy Inc`,
        html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; color: #1e293b; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 20px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05); }
    .header { background-color: #0f172a; padding: 40px 32px; text-align: center; color: #ffffff; border-bottom: 4px solid #f97316; }
    .header h2 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.02em; color: #f8fafc; }
    .content { padding: 40px; line-height: 1.7; font-size: 15px; color: #334155; }
    .content p { margin-top: 0; margin-bottom: 20px; }
    .footer { background-color: #f8fafc; padding: 32px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
    .footer a { color: #f97316; text-decoration: underline; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>Welcome to Tedbuy</h2>
    </div>
    <div class="content">
      <p style="font-size: 17px; font-weight: 700; color: #0f172a; margin-bottom: 24px;">Hi ${escapedName},</p>
      
      <p>I wanted to check in with you to ensure that you have everything you need. I hope that your experience with Tedbuy so far has been a pleasant one. Customer experience is at the heart of everything we do. It's why we come to work each day. All replies to this email inbox are monitored by myself, so if you'd like to get in touch directly and provide any feedback which could help us help you, please hit reply (or type here in this chat!) and I'll ensure that we get onto that right away. No issue is too small. If it matters to you, it matters to us, so please do get in touch if you need to. Also, don't forget that our customer support team are here for all your day-to-day and technical questions 24/7. Thanks once again. I'm delighted to have you on board and look forward to helping you drive your business to awesome new heights.</p>
      
      <p style="margin-top: 36px; line-height: 1.5; font-size: 14px;">
        Gratefully yours,<br/><br/>
        <strong style="font-size: 16px; color: #0f172a;">Vincent Asumadu,</strong><br/>
        <span style="color: #64748b; font-weight: 550;">CEO, Tedbuy Inc</span>
      </p>
    </div>
    <div class="footer">
      <p>This message was sent from <a href="mailto:info@tedbuy.store">info@tedbuy.store</a>. You can reply directly to this email to reach our support team.</p>
      <p>&copy; 2026 Tedbuy Inc. Accra, Ghana.</p>
    </div>
  </div>
</body>
</html>`
      };

      const info = await transporter.sendMail(mailOptions);
      console.log(`[Email Engine] Welcome email dispatched successfully for ${email}. MessageId: ${info.messageId || 'virtual'}`);
      
      if ((info as any).message) {
        console.log(`[Email Engine] Virtual Dispatch Preview (First 400 chars):\n`, (info as any).message.toString().slice(0, 400));
      }

      return res.json({ success: true, messageId: info.messageId || 'virtual' });
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

  // Dynamic image delivery endpoint to decode and serve base64 uploads as binary image files
  app.get(['/api/products/:productId/image', '/api/products/:productId/image.jpg', '/api/products/:productId/image.png', '/api/products/:productId/image.jpeg'], serverRateLimiter(60 * 1000, 100, "image-proxy"), async (req, res) => {
    const { productId } = req.params;
    const queryImageUrl = req.query.image as string;
    const fallbackUrl = 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&fit=crop&w=1200&h=630&q=80';
    
    if (!productId && !queryImageUrl) {
      return res.redirect(fallbackUrl);
    }
    
    let imageUrl = queryImageUrl;
    if (!imageUrl && productId) {
      try {
        const product = await getProductData(productId);
        if (product && product.image) {
          imageUrl = product.image;
        }
      } catch (err) {
        console.error('Error in secure image endpoint fetching product data:', err);
      }
    }
    
    if (!imageUrl) {
      return res.redirect(fallbackUrl);
    }
    
    if (imageUrl.startsWith('data:')) {
      try {
        const parts = imageUrl.split(';base64,');
        if (parts.length === 2) {
          const mimeType = parts[0].replace('data:', ''); // e.g., image/jpeg or image/png
          
          // Strict mime validation for proxy output
          const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
          if (!allowedMimes.includes(mimeType.toLowerCase())) {
            return res.redirect(fallbackUrl);
          }
          
          const base64Data = parts[1];
          const buffer = Buffer.from(base64Data, 'base64');
          
          res.set('Content-Type', mimeType);
          res.set('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
          return res.send(buffer);
        }
      } catch (err) {
        console.error('Error parsing base64 image in endpoint:', err);
      }
    } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      // Direct stream proxy for external URLs to ensure social media crawlers fetch the image reliably without blocking redirects
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
          const contentType = imageRes.headers.get('content-type') || 'image/jpeg';
          
          const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
          if (!allowedMimes.includes(contentType.toLowerCase())) {
            return res.redirect(fallbackUrl);
          }

          const buffer = Buffer.from(await imageRes.arrayBuffer());
          res.set('Content-Type', contentType);
          res.set('Cache-Control', 'public, max-age=86400'); // Cache for day
          return res.send(buffer);
        }
      } catch (error) {
        console.error('Error proxying external product image securely:', error);
      }
      return res.redirect(fallbackUrl);
    }
    
    return res.redirect(fallbackUrl);
  });

  if (process.env.NODE_ENV !== "production") {
    // Development middleware integration with Vite
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
        res.setHeader('Link', '</.well-known/api-catalog>; rel="api-catalog", </auth.md>; rel="service-doc"');
        if (req.headers.accept?.includes('text/markdown')) {
          res.setHeader('x-markdown-tokens', '1200');
          res.status(200).set({ "Content-Type": "text/markdown; charset=utf-8" }).end(systemMarkdown);
          return;
        }
        const queryProductId = req.query.productId as string;
        let productId = queryProductId;
        let queryTitle = req.query.title as string;
        let queryPrice = req.query.price as string;
        let queryImage = (req.query.image || req.query.img) as string;
        let queryDescription = req.query.description as string;

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
            productId = parsedUrl.searchParams.get('productId') || '';
            queryTitle = parsedUrl.searchParams.get('title') || queryTitle || '';
            queryPrice = parsedUrl.searchParams.get('price') || queryPrice || '';
            queryImage = parsedUrl.searchParams.get('image') || parsedUrl.searchParams.get('img') || queryImage || '';
            queryDescription = parsedUrl.searchParams.get('description') || queryDescription || '';
          } catch (e) {
            // Ignored
          }
        }
        
        try {
          let template = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf-8");
          template = await vite.transformIndexHtml(url, template);
          
          if (queryTitle && queryImage) {
            const product = {
              title: queryTitle,
              description: queryDescription || `Check out "${queryTitle}" on Tedbuy Ghana classifieds! Price: ${queryPrice || 'Negotiable'}. View photos, reviews and full details directly.`,
              price: queryPrice || '',
              image: queryImage
            };
            const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy-fb79a.web.app';
            const host = cleanHostHeader(rawHost);
            const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
            const fullUrl = `${protocol}://${host}${url}`;
            template = injectMetaTags(template, product, fullUrl, host, protocol, productId || 'temp');
          } else if (productId) {
            const product = await getProductData(productId);
            const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy-fb79a.web.app';
            const host = cleanHostHeader(rawHost);
            const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
            const fullUrl = `${protocol}://${host}${url}`;
            if (product) {
              template = injectMetaTags(template, product, fullUrl, host, protocol, productId);
            } else {
              template = injectHomepageMetaTags(template, fullUrl, host, protocol);
            }
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
          res.setHeader('Link', '</.well-known/api-catalog>; rel="api-catalog", </auth.md>; rel="service-doc"');
        }
      }
    })); // Do not auto-serve index.html to allow dynamic intercept

    app.get('*', async (req, res) => {
      res.setHeader('Link', '</.well-known/api-catalog>; rel="api-catalog", </auth.md>; rel="service-doc"');
      if (req.headers.accept?.includes('text/markdown')) {
        res.setHeader('x-markdown-tokens', '1200');
        res.status(200).set({ "Content-Type": "text/markdown; charset=utf-8" }).end(systemMarkdown);
        return;
      }
      const url = req.originalUrl || req.url || '/';
      const queryProductId = req.query.productId as string;
      let productId = queryProductId;
      let queryTitle = req.query.title as string;
      let queryPrice = req.query.price as string;
      let queryImage = (req.query.image || req.query.img) as string;
      let queryDescription = req.query.description as string;

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
          productId = parsedUrl.searchParams.get('productId') || '';
          queryTitle = parsedUrl.searchParams.get('title') || queryTitle || '';
          queryPrice = parsedUrl.searchParams.get('price') || queryPrice || '';
          queryImage = parsedUrl.searchParams.get('image') || parsedUrl.searchParams.get('img') || queryImage || '';
          queryDescription = parsedUrl.searchParams.get('description') || queryDescription || '';
        } catch (e) {
          // Ignored
        }
      }
      
      try {
        let template = fs.readFileSync(path.join(distPath, 'index.html'), 'utf-8');
        const cleanPathname = url.split('?')[0].replace(/^\/+|\/+$/g, '').toLowerCase();
        const isCategorySlug = categorySlugs.includes(cleanPathname);
        
        if (queryTitle && queryImage) {
          const product = {
            title: queryTitle,
            description: queryDescription || `Check out "${queryTitle}" on Tedbuy Ghana classifieds! Price: ${queryPrice || 'Negotiable'}. View photos, reviews and full details directly.`,
            price: queryPrice || '',
            image: queryImage
          };
          const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy-fb79a.web.app';
          const host = cleanHostHeader(rawHost);
          const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
          const fullUrl = `${protocol}://${host}${url}`;
          template = injectMetaTags(template, product, fullUrl, host, protocol, productId || 'temp');
        } else if (productId) {
          const product = await getProductData(productId);
          const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy-fb79a.web.app';
          const host = cleanHostHeader(rawHost);
          const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
          const fullUrl = `${protocol}://${host}${url}`;
          if (product) {
            template = injectMetaTags(template, product, fullUrl, host, protocol, productId);
          } else {
            template = injectHomepageMetaTags(template, fullUrl, host, protocol);
          }
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
      } catch (err) {
        console.error('Error serving index.html in production:', err);
        res.sendFile(path.join(distPath, 'index.html'));
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
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

startServer();
