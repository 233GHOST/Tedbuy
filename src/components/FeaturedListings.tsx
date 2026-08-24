import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Product, Category, normalizeCategory } from '../types';
import { ProductCard } from './ProductCard';
import { useApp } from '../context/AppContext';
import { isBoostActive, parseDate } from '../utils/dateParser';
import { ChevronLeft, ChevronRight, Flame } from 'lucide-react';

interface FeaturedListingsProps {
  /** Optional override if parent passes filtered list directly */
  overrideProducts?: Product[];
  selectedCategory?: Category | string | null;
}

export const FeaturedListings: React.FC<FeaturedListingsProps> = ({ overrideProducts, selectedCategory: propCategory }) => {
  const { products, selectedCategory: contextCategory, setSelectedProductId, setCurrentView, registerProduct } = useApp();
  const activeCategory = propCategory !== undefined ? propCategory : contextCategory;

  const [serverFeatured, setServerFeatured] = useState<Product[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeIndexRef = useRef<number>(activeIndex);
  activeIndexRef.current = activeIndex;
  const pauseTimerRef = useRef<any>(null);

  // 1. Fetch or filter active non-expired boosted products with category sensitivity
  const filterAndSortFeatured = useCallback((allProducts: Product[], catFilter?: Category | string | null): Product[] => {
    if (!allProducts || allProducts.length === 0) return [];
    return allProducts
      .filter((p) => {
        if (!p) return false;
        // Must not be hidden or sold
        if (p.status === 'hidden' || p.isSold) return false;
        
        // Filter by category if selected and not 'All'
        if (catFilter && catFilter !== 'All') {
          const prodNormCat = normalizeCategory(p.category);
          const filterNormCat = normalizeCategory(catFilter);
          if (prodNormCat !== filterNormCat) {
            return false;
          }
        }

        // Must be active boost and not expired
        return isBoostActive(p);
      })
      .sort((a, b) => {
        // Order newest boosted first or highest remaining boost time first
        const aBoostDate = parseDate(a.boostStartDate || a.lastBoostedAt || a.createdAt)?.getTime() || 0;
        const bBoostDate = parseDate(b.boostStartDate || b.lastBoostedAt || b.createdAt)?.getTime() || 0;
        return bBoostDate - aBoostDate;
      });
  }, []);

  // Compute featured products synchronously from context products or overrideProducts
  const featuredProducts = useMemo(() => {
    if (overrideProducts && overrideProducts.length > 0) {
      return filterAndSortFeatured(overrideProducts, activeCategory);
    }
    if (products && products.length > 0) {
      return filterAndSortFeatured(products, activeCategory);
    }
    return serverFeatured;
  }, [overrideProducts, products, activeCategory, filterAndSortFeatured, serverFeatured]);

  // Load featured products from server API cache only for cold start when products is empty
  useEffect(() => {
    if (overrideProducts || (products && products.length > 0)) {
      return;
    }
    let isCancelled = false;
    const fetchFeatured = async () => {
      try {
        const catQuery = activeCategory && activeCategory !== 'All' ? `?category=${encodeURIComponent(activeCategory)}` : '';
        const res = await fetch(`/api/featured${catQuery}`);
        if (res.ok && !isCancelled) {
          const data = await res.json();
          if (data.success && Array.isArray(data.products)) {
            data.products.forEach((p: Product) => registerProduct(p));
            setServerFeatured(filterAndSortFeatured(data.products, activeCategory));
          }
        }
      } catch (err) {
        console.warn('[FeaturedListings] /api/featured fetch error:', err);
      }
    };
    fetchFeatured();
    return () => { isCancelled = true; };
  }, [activeCategory, products, overrideProducts, filterAndSortFeatured, registerProduct]);

  useEffect(() => {
    setActiveIndex(0);
    if (containerRef.current) {
      containerRef.current.scrollLeft = 0;
    }
  }, [activeCategory]);

  // Track active scroll index for pagination dots
  const handleScroll = () => {
    if (!containerRef.current) return;
    const cardWidth = containerRef.current.firstElementChild?.getBoundingClientRect().width || 160;
    const scrollLeft = containerRef.current.scrollLeft;
    const index = Math.round(scrollLeft / (cardWidth + 16));
    setActiveIndex(Math.min(Math.max(0, index), featuredProducts.length - 1));
  };

  // Scroll to explicit index
  const scrollToIndex = useCallback((index: number) => {
    if (!containerRef.current) return;
    const cardWidth = containerRef.current.firstElementChild?.getBoundingClientRect().width || 160;
    containerRef.current.scrollTo({
      left: index * (cardWidth + 16),
      behavior: 'smooth'
    });
    setActiveIndex(index);
  }, []);

  // Auto-swipe carousel every 1.5 seconds
  useEffect(() => {
    if (featuredProducts.length <= 1 || isPaused) return;

    const interval = setInterval(() => {
      const nextIndex = (activeIndexRef.current + 1) % featuredProducts.length;
      scrollToIndex(nextIndex);
    }, 1500);

    return () => clearInterval(interval);
  }, [featuredProducts.length, isPaused, scrollToIndex]);

  const handlePauseInteraction = () => {
    setIsPaused(true);
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
  };

  const handleResumeInteraction = (delayMs = 2500) => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => {
      setIsPaused(false);
    }, delayMs);
  };

  // Navigation handlers
  const handleScrollLeft = () => {
    handlePauseInteraction();
    const nextIndex = (activeIndex - 1 + featuredProducts.length) % featuredProducts.length;
    scrollToIndex(nextIndex);
    handleResumeInteraction();
  };

  const handleScrollRight = () => {
    handlePauseInteraction();
    const nextIndex = (activeIndex + 1) % featuredProducts.length;
    scrollToIndex(nextIndex);
    handleResumeInteraction();
  };

  // View All click handler
  const handleViewAllClick = () => {
    setCurrentView('featured-listings');
  };

  // If loading and no products yet
  if (!overrideProducts && (!products || products.length === 0) && featuredProducts.length === 0) {
    return (
      <div className="w-full mb-8 bg-white rounded-3xl p-4 sm:p-6 shadow-xs animate-pulse">
        <div className="flex items-center justify-between mb-4">
          <div className="h-7 w-48 bg-slate-200 rounded-lg"></div>
          <div className="h-6 w-24 bg-slate-100 rounded-full"></div>
        </div>
        <div className="flex gap-4 overflow-hidden">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="w-[calc(50%-8px)] sm:w-[calc(33.333%-11px)] lg:w-[calc(25%-12px)] min-w-[140px] shrink-0 h-64 bg-slate-100 rounded-2xl"></div>
          ))}
        </div>
      </div>
    );
  }

  // Clean hide if no active boosted listings exist
  if (featuredProducts.length === 0) {
    return null;
  }

  return (
    <section 
      id="featured-listings-section"
      className="w-full mb-8 relative transition-all duration-300 animate-fade-in"
    >
        {/* Header Bar */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 font-sans">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 text-white flex items-center justify-center shadow-xs">
              <Flame className="w-4 h-4 fill-white" />
            </div>
            <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
              Featured Listings
            </h3>
          </div>

          {/* Right side navigation: Controls & View All */}
          <div className="flex items-center gap-2.5">
            <div className="hidden sm:flex items-center gap-1.5">
              <button
                onClick={handleScrollLeft}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 active:scale-95 transition-all flex items-center justify-center shadow-2xs cursor-pointer"
                aria-label="Previous Featured Listing"
              >
                <ChevronLeft className="w-4 h-4 stroke-[2.5]" />
              </button>
              <button
                onClick={handleScrollRight}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 active:scale-95 transition-all flex items-center justify-center shadow-2xs cursor-pointer"
                aria-label="Next Featured Listing"
              >
                <ChevronRight className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>

            <button
              onClick={handleViewAllClick}
              className="text-orange-500 font-bold text-sm sm:text-base flex items-center gap-0.5 hover:underline cursor-pointer ml-1"
            >
              View all
              <ChevronRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Native Touch Momentum Horizontal Grid Container with full vertical scroll and horizontal swipe support */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          onMouseEnter={handlePauseInteraction}
          onMouseLeave={() => handleResumeInteraction(1500)}
          onTouchStart={handlePauseInteraction}
          onTouchEnd={() => handleResumeInteraction(2500)}
          className="flex gap-4 overflow-x-auto scrollbar-none snap-x snap-proximity py-1 px-0.5 touch-auto overscroll-x-contain"
          style={{ 
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none'
          }}
        >
          {featuredProducts.map((product) => (
            <div
              key={`featured-${product.id}`}
              className="w-[calc(50%-8px)] sm:w-[calc(33.333%-11px)] lg:w-[calc(25%-12px)] min-w-[140px] shrink-0 snap-start"
            >
              <ProductCard product={product} isFeaturedVariant={true} />
            </div>
          ))}
        </div>

        {/* Centered Pagination Dots */}
        {featuredProducts.length > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-4">
            {featuredProducts.map((_, i) => (
              <button
                key={`dot-${i}`}
                onClick={() => {
                  handlePauseInteraction();
                  scrollToIndex(i);
                  handleResumeInteraction();
                }}
                className={`transition-all duration-300 rounded-full cursor-pointer ${
                  activeIndex === i
                    ? 'w-7 h-2.5 bg-orange-500'
                    : 'w-2.5 h-2.5 bg-slate-200 hover:bg-slate-300'
                }`}
                aria-label={`Go to featured slide ${i + 1}`}
              />
            ))}
          </div>
        )}
      </section>
  );
};
