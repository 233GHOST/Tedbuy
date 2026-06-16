import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import net from "net";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const logLine = `${new Date().toISOString()} [Express Log] ${req.method} ${req.url} | Body keys: ${Object.keys(req.body || {})}\n`;
  try {
    fs.appendFileSync(path.resolve(process.cwd(), "express_requests.log"), logLine);
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
    const url = req.path || '/';
    
    const isHomepage = url === '/' || url === '/index.html' || url === '/index' || !url;
    const isWebRoute = isHomepage || (!url.startsWith('/api') && !url.includes('.') && req.method === 'GET');

    // Always set the Link headers for agent discovery on all web routes
    if (isWebRoute) {
      res.setHeader('Link', '</.well-known/api-catalog>; rel="api-catalog", </auth.md>; rel="service-doc"');
    }

    // Return HTML responses as markdown when agents request it
    if (isWebRoute && req.headers.accept?.includes('text/markdown')) {
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

  app.post('/api/send-welcome-email', async (req, res) => {
    const { email, username } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email parameter is required.' });
    }

    const cleanName = username || email.split('@')[0] || 'there';

    try {
      const transporter = getMailTransporter();

      // Run pre-flight network connection, handshake, and authentication diagnostic check
      if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        console.log(`[Email Engine] Running pre-flight SMTP diagnostics for recipient: ${email}...`);
        const diagResult = await diagnoseSMTPAndVerify(transporter);
        if (!diagResult.success) {
          console.error(`[Email Engine] Pre-flight SMTP block: Diagnostics failed prior to dispatch to ${email}. Logging to console.`);
          return res.status(500).json({
            error: "SMTP pre-flight diagnostic failed.",
            details: "Authentication or network handshake failure on 'mail.privateemail.com'. Please check container logs/console for details.",
            diagnostic: diagResult.details
          });
        }
      }
      
      const mailOptions = {
        from: '"Tedbuy" <info@tedbuy.store>',
        to: email,
        replyTo: 'info@tedbuy.store',
        subject: 'Welcome to Tedbuy Ghana',
        text: `Welcome to Tedbuy!\n\nHi ${cleanName},\n\nWe are excited to have you join our classifieds community. Tedbuy is built to help you buy and sell securely with peer reviews and direct connection.\n\nIf you have any feedback, recommendations, or questions about using the platform, feel free to reply directly to this email. We check every reply and are always eager to assist you.\n\nThank you for choosing Tedbuy.\n\nBest regards,\n\nVincent Asumadu\nTedbuy Team`,
        html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; color: #1e293b; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 20px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05); }
    .header { background-color: #0f172a; padding: 40px 32px; text-align: center; color: #ffffff; border-bottom: 4px solid #f97316; }
    .logo-text { font-size: 32px; font-weight: 800; letter-spacing: -0.04em; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .header h2 { margin: 12px 0 0 0; font-size: 24px; font-weight: 800; letter-spacing: -0.02em; color: #f8fafc; }
    .content { padding: 40px; line-height: 1.7; font-size: 15px; color: #334155; }
    .content p { margin-top: 0; margin-bottom: 20px; }
    .footer { background-color: #f8fafc; padding: 32px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
    .footer a { color: #f97316; text-decoration: underline; font-weight: 600; }
    .divider { height: 1px; background-color: #e2e8f0; margin: 32px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo-text">tedbuy</div>
      <h2>Welcome to Tedbuy</h2>
    </div>
    <div class="content">
      <p style="font-size: 17px; font-weight: 700; color: #0f172a; margin-bottom: 24px;">Hi ${cleanName},</p>
      
      <p>We are excited to have you join our classifieds community. Tedbuy is built to help you buy and sell securely with peer reviews and direct messaging.</p>
      
      <p>If you have any feedback, suggestions, or questions about using the platform, feel free to reply directly to this email. We read every message and are always here to support you.</p>
      
      <div class="divider"></div>
      
      <p>Thank you for choosing Tedbuy. We look forward to helping you connect with buyers and sellers across Ghana.</p>
      
      <p style="margin-top: 36px; line-height: 1.5; font-size: 14px;">
        Best regards,<br/>
        <strong style="font-size: 16px; color: #0f172a;">Vincent Asumadu</strong><br/>
        <span style="color: #64748b; font-weight: 550;">Tedbuy Team</span>
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
      console.error(`[Email Engine] Dispatch failed for ${email}:`, err);
      return res.status(500).json({ error: 'Failed to send welcome email.', details: err?.message || String(err) });
    }
  });

  // Dynamic robots.txt declaring active domain's sitemap.xml to speed up indexing on custom domains
  app.get('/robots.txt', (req, res) => {
    const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy.store';
    const host = cleanHostHeader(rawHost);
    const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
    res.type('text/plain');
    res.send(`User-agent: *\nAllow: /\nDisallow: /settings\nDisallow: /dashboard\n\nContent-Signal: ai-train=no, search=yes, ai-input=no\n\nSitemap: ${protocol}://${host}/sitemap.xml`);
  });

  // Dynamic Google XML Sitemap Endpoint
  app.get('/sitemap.xml', async (req, res) => {
    try {
      const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy.store';
      const host = cleanHostHeader(rawHost);
      const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
      const baseUrl = `${protocol}://${host}`;

      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

      // 1. Homepage
      const todayString = new Date().toISOString().split('T')[0];
      xml += `  <url>\n`;
      xml += `    <loc>${baseUrl}/</loc>\n`;
      xml += `    <lastmod>${todayString}</lastmod>\n`;
      xml += `    <changefreq>daily</changefreq>\n`;
      xml += `    <priority>1.0</priority>\n`;
      xml += `  </url>\n`;

      // 2. Main interactive views
      const staticViews = ['chats', 'dashboard', 'settings'];
      for (const view of staticViews) {
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/${view}</loc>\n`;
        xml += `    <lastmod>${todayString}</lastmod>\n`;
        xml += `    <changefreq>weekly</changefreq>\n`;
        xml += `    <priority>0.6</priority>\n`;
        xml += `  </url>\n`;
      }

      // 2b. Real Category pathways for Google Search Console indexing
      for (const cat of categorySlugs) {
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/${cat}</loc>\n`;
        xml += `    <lastmod>${todayString}</lastmod>\n`;
        xml += `    <changefreq>daily</changefreq>\n`;
        xml += `    <priority>0.9</priority>\n`;
        xml += `  </url>\n`;
      }

      // 3. Dynamic Products from Firestore REST API
      try {
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/products?pageSize=300${apiKey ? `&key=${apiKey}` : ""}`;
        const response = await fetch(firestoreUrl);
        if (response.ok) {
          const data = await response.json();
          const documents = data.documents || [];
          for (const doc of documents) {
            const nameParts = doc.name.split('/');
            const id = nameParts[nameParts.length - 1];
            
            const fields = doc.fields || {};
            const title = fields.title?.stringValue || '';
            const createdAt = fields.createdAt?.stringValue || todayString;
            const updatedTime = doc.updateTime ? doc.updateTime.split('T')[0] : (createdAt ? createdAt.split('T')[0] : todayString);

            if (id && title) {
              const slug = slugify(title);
              const productUrl = `${baseUrl}/product/${id}-${slug}`;
              xml += `  <url>\n`;
              xml += `    <loc>${productUrl}</loc>\n`;
              xml += `    <lastmod>${updatedTime}</lastmod>\n`;
              xml += `    <changefreq>daily</changefreq>\n`;
              xml += `    <priority>0.8</priority>\n`;
              xml += `  </url>\n`;
            }
          }
        }
      } catch (err) {
        console.error('[Sitemap] Failed to fetch active products for sitemap:', err);
      }

      xml += `</urlset>\n`;

      res.header('Content-Type', 'application/xml');
      res.send(xml);
    } catch (error) {
      console.error('[Sitemap] Failed to generate sitemap:', error);
      res.status(500).send('Error generating sitemap');
    }
  });

  // Dynamic image delivery endpoint to decode and serve base64 uploads as binary image files
  app.get(['/api/products/:productId/image', '/api/products/:productId/image.jpg', '/api/products/:productId/image.png', '/api/products/:productId/image.jpeg'], async (req, res) => {
    const { productId } = req.params;
    const queryImageUrl = req.query.image as string;
    const fallbackUrl = 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&fit=crop&w=1200&h=630&q=80';
    
    if (!productId && !queryImageUrl) {
      return res.redirect(fallbackUrl);
    }
    
    let imageUrl = queryImageUrl;
    if (!imageUrl && productId) {
      const product = await getProductData(productId);
      if (product && product.image) {
        imageUrl = product.image;
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
        const imageRes = await fetch(imageUrl);
        if (imageRes.ok) {
          const contentType = imageRes.headers.get('content-type') || 'image/jpeg';
          const buffer = Buffer.from(await imageRes.arrayBuffer());
          res.set('Content-Type', contentType);
          res.set('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
          return res.send(buffer);
        }
      } catch (error) {
        console.error('Error proxying external product image for crawler:', error);
      }
      return res.redirect(imageUrl);
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
