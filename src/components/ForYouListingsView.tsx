import React, { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { ProductCard } from './ProductCard';
import { getForYouProducts } from '../utils/recommendationScore';
import { Sparkles, ArrowLeft } from 'lucide-react';

export const ForYouListingsView: React.FC = () => {
  const { products, users, reviews, chats, currentUser, recentlyViewedIds, setCurrentView } = useApp();

  const result = useMemo(() => {
    return getForYouProducts({
      products,
      users,
      reviews,
      chats,
      currentUser,
      recentlyViewedIds,
      limit: 60
    });
  }, [products, users, reviews, chats, currentUser, recentlyViewedIds]);

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
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 via-orange-500 to-amber-600 text-white flex items-center justify-center shadow-xs">
              <Sparkles className="w-5 h-5 fill-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight font-sans">
                {result.headline}
              </h1>
              {result.subtitle && (
                <p className="text-xs font-medium text-slate-500 mt-0.5">
                  {result.subtitle}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Grid Content */}
      {result.items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-500 flex items-center justify-center mx-auto">
            <Sparkles className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-800">No Recommended Listings Found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Browse products and interact with listings to get personalized recommendations.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {result.items.map((product) => (
            <ProductCard key={`all-foryou-${product.id}`} product={product} />
          ))}
        </div>
      )}
    </div>
  );
};
