import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { Product } from '../types';
import { ProductCard } from './ProductCard';
import { TrendingUp, ArrowLeft } from 'lucide-react';

export const TrendingListingsView: React.FC = () => {
  const { setCurrentView, registerProduct } = useApp();
  const [trendingProducts, setTrendingProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Same fix as FeaturedListingsView.tsx: source from the dedicated
  // /api/trending endpoint (full catalog, ranked server-side by real
  // viewsCount) rather than the paginated `products` context array, which
  // this page previously used directly -- and whose "sort by popularity"
  // was comparing a `.views` field that doesn't exist on Product (only
  // `viewsCount` does), making every comparison `0 - 0 = 0` and the sort a
  // complete no-op that just left the array in recency order. This page
  // never filtered by category before (matches the original scope --
  // Trending Ads is a global ranking, not a per-category one).
  const fetchTrendingProducts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/trending');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.products)) {
          data.products.forEach((p: Product) => registerProduct(p));
          setTrendingProducts(data.products);
          setIsLoading(false);
          return;
        }
      }
    } catch (err) {
      console.warn('[TrendingListingsView] /api/trending fetch error:', err);
    }
    setIsLoading(false);
  }, [registerProduct]);

  useEffect(() => {
    fetchTrendingProducts();
  }, [fetchTrendingProducts]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-fade-in min-h-[70vh] font-sans">
      {/* Top Header & Back Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="space-y-1">
          <button
            onClick={() => setCurrentView('browse')}
            className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors mb-2 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Marketplace</span>
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-xs">
              <TrendingUp className="w-5 h-5 fill-none stroke-[2.5]" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight font-sans">
                Trending Ads
              </h1>
              <p className="text-xs font-medium text-slate-500 mt-0.5">
                The most viewed and popular listings across Ghana right now
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Grid Content */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-72 bg-slate-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : trendingProducts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center mx-auto">
            <TrendingUp className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-800">No Trending Ads Found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Check back later as new products gain views and engagement.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {trendingProducts.map((product) => (
            <ProductCard key={`all-trending-${product.id}`} product={product} isTrendingVariant={true} />
          ))}
        </div>
      )}
    </div>
  );
};
