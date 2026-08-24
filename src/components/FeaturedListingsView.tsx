import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { Product, Category, normalizeCategory } from '../types';
import { ProductCard } from './ProductCard';
import { isBoostActive, parseDate } from '../utils/dateParser';
import { Flame, ArrowLeft } from 'lucide-react';

export const FeaturedListingsView: React.FC = () => {
  const { products, selectedCategory, setCurrentView } = useApp();
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const filterAndSortFeatured = useCallback((allProducts: Product[], catFilter?: Category | string | null): Product[] => {
    return allProducts
      .filter((p) => {
        if (!p) return false;
        if (p.status === 'hidden' || p.isSold) return false;
        
        if (catFilter && catFilter !== 'All') {
          const prodNormCat = normalizeCategory(p.category);
          const filterNormCat = normalizeCategory(catFilter);
          if (prodNormCat !== filterNormCat) {
            return false;
          }
        }

        return isBoostActive(p);
      })
      .sort((a, b) => {
        const aBoostDate = parseDate(a.boostStartDate || a.lastBoostedAt || a.createdAt)?.getTime() || 0;
        const bBoostDate = parseDate(b.boostStartDate || b.lastBoostedAt || b.createdAt)?.getTime() || 0;
        return bBoostDate - aBoostDate;
      });
  }, []);

  const fetchFeaturedProducts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/featured');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.products)) {
          const validFeatured = filterAndSortFeatured(data.products, selectedCategory);
          setFeaturedProducts(validFeatured);
          setIsLoading(false);
          return;
        }
      }
    } catch (err) {
      console.warn('[FeaturedListingsView] /api/featured fetch fallback:', err);
    }

    if (products && products.length > 0) {
      const filtered = filterAndSortFeatured(products, selectedCategory);
      setFeaturedProducts(filtered);
    }
    setIsLoading(false);
  }, [selectedCategory, filterAndSortFeatured, products]);

  useEffect(() => {
    fetchFeaturedProducts();
  }, [fetchFeaturedProducts]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-fade-in">
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
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 text-white flex items-center justify-center shadow-xs">
              <Flame className="w-5 h-5 fill-white" />
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight font-sans">
              Featured Listings
            </h1>
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
      ) : featuredProducts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-orange-50 text-orange-500 flex items-center justify-center mx-auto">
            <Flame className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-800">No Featured Listings Found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            There are currently no active featured listings.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {featuredProducts.map((product) => (
            <ProductCard key={`all-featured-${product.id}`} product={product} isFeaturedVariant={true} />
          ))}
        </div>
      )}
    </div>
  );
};
