import React, { useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';

export const WebMCPInitializer: React.FC = () => {
  const { products } = useApp();
  const productsRef = useRef(products);

  // Keep ref updated with freshest products state
  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    const nav = window.navigator as any;
    if (!nav || !nav.modelContext || typeof nav.modelContext.registerTool !== 'function') {
      return;
    }

    // AbortController lets us cleanly unregister these tools if this component
    // ever unmounts (e.g. route changes that remount the app shell), per the
    // WebMCP spec's recommended cleanup pattern.
    const controller = new AbortController();

    try {
      nav.modelContext.registerTool(
        {
          name: 'search_listings',
          description: 'Search active buy and sell classified listings in Ghana',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search term (e.g. "iPhone 15", "Toyota", "MacBook")',
              },
              category: {
                type: 'string',
                description: 'Filter by category (e.g. "Phones", "Laptops", "Vehicles")',
              },
            },
            required: ['query'],
          },
          execute: async (args: { query: string; category?: string }) => {
            // `productsRef.current` is only whatever page(s) of /api/products
            // have been paginated into the app's client-side state so far
            // (the first load is limit=24) -- filtering just that in-memory
            // slice meant this tool silently searched a small, arbitrary
            // subset of recent listings rather than the catalog its
            // description promises ("Search active buy and sell classified
            // listings in Ghana"), so most real queries returned nothing.
            // /api/products already supports server-side q/category search
            // over the full catalog, so use that first.
            try {
              const params = new URLSearchParams();
              params.set('q', args.query);
              if (args.category) params.set('category', args.category);
              params.set('limit', '20');
              const res = await fetch(`/api/products?${params.toString()}`);
              if (res.ok) {
                const data = await res.json();
                if (data && Array.isArray(data.products)) {
                  return {
                    success: true,
                    listings: data.products.map((m: any) => ({
                      id: m.id,
                      title: m.title,
                      price: m.price,
                      location: m.location,
                      category: m.category,
                      description: m.description || '',
                    })),
                  };
                }
              }
            } catch (_) {
              // Network error -- fall through to the client-side cache below
              // so the tool still returns something useful offline.
            }

            const term = args.query.toLowerCase();
            const matched = productsRef.current.filter(p => {
              const mTitle = p.title.toLowerCase().includes(term);
              const mDesc = p.description.toLowerCase().includes(term);
              const mCat = args.category ? p.category === args.category : true;
              return (mTitle || mDesc) && mCat;
            });
            return {
              success: true,
              listings: matched.map(m => ({
                id: m.id,
                title: m.title,
                price: m.price,
                location: m.location,
                category: m.category,
                description: m.description,
              })),
            };
          },
        },
        { signal: controller.signal }
      );

      nav.modelContext.registerTool(
        {
          name: 'get_listing_details',
          description: 'Retrieve full details of a specific classified ad listing',
          inputSchema: {
            type: 'object',
            properties: {
              productId: {
                type: 'string',
                description: 'Unique product ID starting with prod_',
              },
            },
            required: ['productId'],
          },
          execute: async (args: { productId: string }) => {
            const product = productsRef.current.find(p => p.id === args.productId);
            if (product) {
              return {
                success: true,
                listing: {
                  id: product.id,
                  title: product.title,
                  price: product.price,
                  location: product.location,
                  category: product.category,
                  description: product.description,
                  sellerId: product.sellerId,
                  createdAt: product.createdAt,
                },
              };
            }

            // Not in the currently-loaded client cache (e.g. pagination
            // hasn't reached it, or it was linked to directly) -- fall back
            // to the server's single-product endpoint before reporting
            // "not found", since that previously misreported valid product
            // IDs as missing whenever they weren't already in local state.
            // This endpoint already applies the app's own archived/deleted
            // visibility rules, so it's no less restrictive than the local
            // lookup it replaces.
            try {
              const res = await fetch(`/api/products/${encodeURIComponent(args.productId)}`);
              if (res.ok) {
                const data = await res.json();
                if (data && data.success && data.product) {
                  const p = data.product;
                  return {
                    success: true,
                    listing: {
                      id: p.id,
                      title: p.title,
                      price: p.price,
                      location: p.location,
                      category: p.category,
                      description: p.description,
                      sellerId: p.sellerId,
                      createdAt: p.createdAt,
                    },
                  };
                }
              }
            } catch (_) {
              // Network error -- fall through to not-found below.
            }

            return { success: false, error: 'Product listing not found.' };
          },
        },
        { signal: controller.signal }
      );

      console.log('WebMCP API initialized successfully with active tools.');
    } catch (err) {
      console.error('WebMCP registration error:', err);
    }

    return () => {
      controller.abort();
    };
  }, []); // Run exactly once on mount to guarantee tools are present immediately on page load

  return null;
};
