// Vercel Routing Middleware.
//
// This exists specifically to solve "Markdown for Agents" content negotiation
// for page routes (the homepage and other client-rendered pages). A plain
// vercel.json rewrite conditioned on the Accept header cannot reliably do this,
// because those page paths resolve to a real static file (dist/index.html),
// and once that response is cached at the edge, subsequent requests are served
// straight from cache without re-evaluating rewrites - regardless of Accept
// header. Routing Middleware runs before the edge cache is checked, so it can
// intercept the request and return the markdown version even on a cache hit
// for the normal HTML response.
//
// This mirrors the exact markdown content server.ts's own negotiation
// middleware returns for parity between the Express app (used when a request
// does reach it, e.g. in local dev) and this edge-level interception (used in
// production on Vercel for the statically-served pages).

const SYSTEM_MARKDOWN = `# TedBuy Ghana Classifieds - Verified Peer Commerce

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

export const config = {
  // Run on every page-like route, but skip API routes, .well-known (reserved
  // by Vercel and cannot be touched by middleware rewrites/routing anyway),
  // and static assets (anything with a file extension, plus common asset dirs).
  matcher: [
    '/((?!api/|\\.well-known/|assets/|favicon|manifest\\.json|robots\\.txt|sitemap).*)',
  ],
};

export default function middleware(request: Request): Response | undefined {
  const accept = request.headers.get('accept')?.toLowerCase() || '';
  const url = new URL(request.url);

  const looksLikeAsset = /\.[a-zA-Z0-9]+$/.test(url.pathname) && !url.pathname.endsWith('.html');

  if (!looksLikeAsset && (accept.includes('text/markdown') || accept.includes('text/x-markdown'))) {
    return new Response(SYSTEM_MARKDOWN, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'x-markdown-tokens': '1200',
        'Link': '</sitemap.xml>; rel="sitemap", </.well-known/api-catalog>; rel="api-catalog", </auth.md>; rel="service-doc"',
      },
    });
  }

  // Not a markdown request - return nothing so normal routing (static file, cache, etc.) proceeds.
  return undefined;
}
