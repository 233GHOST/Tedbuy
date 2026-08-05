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
            if (!product) {
              return { success: false, error: 'Product listing not found.' };
            }
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
