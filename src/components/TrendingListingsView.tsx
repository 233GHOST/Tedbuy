import React, { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { ProductCard } from './ProductCard';
import { TrendingUp, ArrowLeft } from 'lucide-react';

export const TrendingListingsView: React.FC = () => {
  const { products, setCurrentView } = useApp();

  const trendingProducts = useMemo(() => {
    return [...products]
      .filter((p) => p && p.status !== 'hidden' && !p.isSold)
      .sort((a, b) => (b.views || 0) - (a.views || 0));
  }, [products]);

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
      {trendingProducts.length === 0 ? (
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
