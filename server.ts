import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;

// Resolve Firebase project ID dynamically
const firebaseConfigPath = path.resolve(process.cwd(), "firebase-applet-config.json");
let projectId = "tedbuy-fb79a"; // Fallback default
if (fs.existsSync(firebaseConfigPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
    if (config.projectId) {
      projectId = config.projectId;
    }
  } catch (err) {
    console.error("Failed to parse firebase-applet-config.json", err);
  }
}

// REST API helper to fetch product info directly from Firestore
async function getProductData(productId: string) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/products/${productId}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`Firestore product fetch failed with status: ${res.status}`);
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

    return {
      title,
      description,
      price: priceValue,
      image: primaryImage
    };
  } catch (err) {
    console.error('Error fetching product data:', err);
    return null;
  }
}

// Injects dynamic meta tags based on the fetched product
function injectMetaTags(html: string, product: { title: string; description: string; price: string; image: string }, shareUrl: string): string {
  const pricePrefix = product.price ? `GHS ${product.price}` : 'Negotiable';
  const title = `${product.title} - ${pricePrefix} | TedBuy Ghana`;
  const description = `${product.description.slice(0, 160)}${product.description.length > 160 ? '...' : ''} | Buy/Sell on TedBuy`;
  const image = product.image;

  const tags = `
    <!-- Dynamic Social Share Meta Tags -->
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(image)}" />
    <meta property="og:url" content="${escapeHtml(shareUrl)}" />
    <meta property="og:type" content="product" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />
  `;

  // Strip existing tags that we are replacing to avoid redundant elements
  let cleanHtml = html
    .replace(/<title>[^<]*<\/title>/gi, '')
    .replace(/<meta[^>]*name="description"[^>]*>/gi, '');

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

  if (process.env.NODE_ENV !== "production") {
    // Development middleware integration with Vite
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });

    app.use(async (req, res, next) => {
      if (req.method === 'GET' && (req.headers.accept?.includes('text/html') || req.url === '/')) {
        const url = req.originalUrl || req.url || '/';
        const parsedUrl = new URL(url, `http://${req.headers.host || 'localhost:3000'}`);
        const productId = parsedUrl.searchParams.get('productId');
        
        try {
          let template = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf-8");
          template = await vite.transformIndexHtml(url, template);
          
          if (productId) {
            const product = await getProductData(productId);
            if (product) {
              const fullUrl = `https://${req.headers.host || 'tedbuy-fb79a.web.app'}${url}`;
              template = injectMetaTags(template, product, fullUrl);
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
      const parsedUrl = new URL(url, `http://${req.headers.host || 'localhost:3000'}`);
      const productId = parsedUrl.searchParams.get('productId');
      
      try {
        let template = fs.readFileSync(path.join(distPath, 'index.html'), 'utf-8');
        
        if (productId) {
          const product = await getProductData(productId);
          if (product) {
            const fullUrl = `https://${req.headers.host || 'tedbuy-fb79a.web.app'}${url}`;
            template = injectMetaTags(template, product, fullUrl);
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
