import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

const app = express();
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

  console.log(`[Meta Crawler] Injecting Open Graph tags. URL: ${shareUrl}, Image URL: ${image}`);

  const tags = `
    <!-- Dynamic Social Share Meta Tags -->
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <!-- Open Graph / Facebook / WhatsApp -->
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(image)}" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:url" content="${escapeHtml(shareUrl)}" />
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
  `;

  // Strip existing tags that we are replacing to avoid redundant elements
  let cleanHtml = html
    .replace(/<title>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta[^>]*?name="description"[^>]*?>/gi, '');

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

async function startServer() {
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', projectId });
  });

  // Dynamic image delivery endpoint to decode and serve base64 uploads as binary image files
  app.get(['/api/products/:productId/image', '/api/products/:productId/image.jpg', '/api/products/:productId/image.png', '/api/products/:productId/image.jpeg'], async (req, res) => {
    const { productId } = req.params;
    const queryImageUrl = req.query.image as string;
    const fallbackUrl = 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=400&q=80';
    
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
      const isHtmlRequest = !url.startsWith('/api/') && 
                            !url.includes('.') && 
                            (req.headers.accept?.includes('text/html') || 
                             url === '/' || 
                             url.startsWith('/?') || 
                             url.includes('productId='));
                             
      if (req.method === 'GET' && isHtmlRequest) {
        const queryProductId = req.query.productId as string;
        let productId = queryProductId;
        let queryTitle = req.query.title as string;
        let queryPrice = req.query.price as string;
        let queryImage = req.query.image as string;
        let queryDescription = req.query.description as string;

        if (!productId) {
          try {
            const parsedUrl = new URL(url, `http://${req.headers.host || 'localhost:3000'}`);
            productId = parsedUrl.searchParams.get('productId') || '';
            queryTitle = parsedUrl.searchParams.get('title') || queryTitle || '';
            queryPrice = parsedUrl.searchParams.get('price') || queryPrice || '';
            queryImage = parsedUrl.searchParams.get('image') || queryImage || '';
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
            if (product) {
              const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy-fb79a.web.app';
              const host = cleanHostHeader(rawHost);
              const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
              const fullUrl = `${protocol}://${host}${url}`;
              template = injectMetaTags(template, product, fullUrl, host, protocol, productId);
            }
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
    app.use(express.static(distPath, { index: false })); // Do not auto-serve index.html to allow dynamic intercept

    app.get('*', async (req, res) => {
      const url = req.originalUrl || req.url || '/';
      const queryProductId = req.query.productId as string;
      let productId = queryProductId;
      let queryTitle = req.query.title as string;
      let queryPrice = req.query.price as string;
      let queryImage = req.query.image as string;
      let queryDescription = req.query.description as string;

      if (!productId) {
        try {
          const parsedUrl = new URL(url, `http://${req.headers.host || 'localhost:3000'}`);
          productId = parsedUrl.searchParams.get('productId') || '';
          queryTitle = parsedUrl.searchParams.get('title') || queryTitle || '';
          queryPrice = parsedUrl.searchParams.get('price') || queryPrice || '';
          queryImage = parsedUrl.searchParams.get('image') || queryImage || '';
          queryDescription = parsedUrl.searchParams.get('description') || queryDescription || '';
        } catch (e) {
          // Ignored
        }
      }
      
      try {
        let template = fs.readFileSync(path.join(distPath, 'index.html'), 'utf-8');
        
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
          if (product) {
            const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'tedbuy-fb79a.web.app';
            const host = cleanHostHeader(rawHost);
            const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
            const fullUrl = `${protocol}://${host}${url}`;
            template = injectMetaTags(template, product, fullUrl, host, protocol, productId);
          }
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
  });
}

startServer();
