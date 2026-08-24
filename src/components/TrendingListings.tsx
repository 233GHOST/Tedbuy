import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Product, Category, normalizeCategory } from '../types';
import { ProductCard } from './ProductCard';
import { useApp } from '../context/AppContext';
import { ChevronLeft, ChevronRight, TrendingUp } from 'lucide-react';

interface TrendingListingsProps {
  overrideProducts?: Product[];
  selectedCategory?: Category | string | null;
}

export const TrendingListings: React.FC<TrendingListingsProps> = ({ overrideProducts, selectedCategory: propCategory }) => {
  const { products, selectedCategory: contextCategory, registerProduct } = useApp();
  const activeCategory = propCategory !== undefined ? propCategory : contextCategory;

  const [serverTrending, setServerTrending] = useState<Product[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Touch & Swipe gesture refs
  const touchStartXRef = useRef<number>(0);
  const touchStartYRef = useRef<number>(0);
  const scrollStartLeftRef = useRef<number>(0);
  const isSwipingRef = useRef<boolean>(false);
  const isTouchActiveRef = useRef<boolean>(false);

  const autoSwipeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isHoveredOrTouched, setIsHoveredOrTouched] = useState<boolean>(false);

  // Filter and sort top 10 most viewed items (excluding sold & hidden)
  const filterAndSortTrending = useCallback((allProducts: Product[], catFilter?: Category | string | null): Product[] => {
    if (!allProducts || allProducts.length === 0) return [];
    return allProducts
      .filter((p) => {
        if (!p) return false;
        // Must automatically remove sold or hidden items
        if (p.status === 'hidden' || p.isSold || p.status === 'sold') return false;

        // Filter by category if selected and not 'All'
        if (catFilter && catFilter !== 'All') {
          const prodNormCat = normalizeCategory(p.category);
          const filterNormCat = normalizeCategory(catFilter);
          if (prodNormCat !== filterNormCat) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        const aViews = Number(a.viewsCount || a.views) || 0;
        const bViews = Number(b.viewsCount || b.views) || 0;
        if (bViews !== aViews) return bViews - aViews;
        // Secondary sort: newest first
        const aTime = new Date(a.createdAt || 0).getTime();
        const bTime = new Date(b.createdAt || 0).getTime();
        return bTime - aTime;
      })
      .slice(0, 10); // Display top 10 most viewed items
  }, []);

  // Compute trending products synchronously from context products or overrideProducts
  const trendingProducts = useMemo(() => {
    if (overrideProducts && overrideProducts.length > 0) {
      return filterAndSortTrending(overrideProducts, activeCategory);
    }
    if (products && products.length > 0) {
      return filterAndSortTrending(products, activeCategory);
    }
    return serverTrending;
  }, [overrideProducts, products, activeCategory, filterAndSortTrending, serverTrending]);

  // Fetch from server /api/trending only for cold start when products is not yet loaded in context
  useEffect(() => {
    if (overrideProducts || (products && products.length > 0)) {
      return;
    }
    let isCancelled = false;
    const fetchTrending = async () => {
      try {
        const catQuery = activeCategory && activeCategory !== 'All' ? `?category=${encodeURIComponent(activeCategory)}` : '';
        const res = await fetch(`/api/trending${catQuery}`);
        if (res.ok && !isCancelled) {
          const data = await res.json();
          if (data.success && Array.isArray(data.products)) {
            data.products.forEach((p: Product) => registerProduct(p));
            setServerTrending(filterAndSortTrending(data.products, activeCategory));
          }
        }
      } catch (err) {
        console.warn('[TrendingListings] /api/trending fetch error:', err);
      }
    };
    fetchTrending();
    return () => { isCancelled = true; };
  }, [activeCategory, products, overrideProducts, filterAndSortTrending, registerProduct]);

  useEffect(() => {
    setActiveIndex(0);
    if (containerRef.current) {
      containerRef.current.scrollLeft = 0;
    }
  }, [activeCategory]);

  // Track active scroll index
  const handleScroll = () => {
    if (!containerRef.current) return;
    const cardWidth = containerRef.current.firstElementChild?.getBoundingClientRect().width || 140;
    const scrollLeft = containerRef.current.scrollLeft;
    const index = Math.round(scrollLeft / (cardWidth + 12));
    setActiveIndex(Math.min(Math.max(0, index), trendingProducts.length - 1));
  };

  // Scroll to explicit index
  const scrollToIndex = (index: number) => {
    if (!containerRef.current) return;
    const cardWidth = containerRef.current.firstElementChild?.getBoundingClientRect().width || 140;
    containerRef.current.scrollTo({
      left: index * (cardWidth + 12),
      behavior: 'smooth'
    });
    setActiveIndex(index);
  };

  const handleScrollLeft = () => {
    const nextIndex = Math.max(0, activeIndex - 1);
    scrollToIndex(nextIndex);
  };

  const handleScrollRight = () => {
    if (activeIndex >= trendingProducts.length - 1) {
      scrollToIndex(0);
    } else {
      scrollToIndex(activeIndex + 1);
    }
  };

  // Auto-swipe timer removed per user request
  useEffect(() => {
    if (autoSwipeTimerRef.current) clearInterval(autoSwipeTimerRef.current);
  }, []);

  // Touch Swipe Gesture Handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!containerRef.current || e.touches.length !== 1) return;
    
    isTouchActiveRef.current = true;
    setIsHoveredOrTouched(true);

    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
    scrollStartLeftRef.current = containerRef.current.scrollLeft;
    isSwipingRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!containerRef.current || !isTouchActiveRef.current || e.touches.length !== 1) return;

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = touchStartXRef.current - currentX;
    const deltaY = touchStartYRef.current - currentY;

    if (!isSwipingRef.current) {
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 8) {
        isSwipingRef.current = true;
      }
    }

    if (isSwipingRef.current) {
      containerRef.current.scrollLeft = scrollStartLeftRef.current + deltaX;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isTouchActiveRef.current) return;
    isTouchActiveRef.current = false;

    if (isSwipingRef.current && containerRef.current) {
      const endX = e.changedTouches[0]?.clientX || touchStartXRef.current;
      const deltaX = touchStartXRef.current - endX;

      if (Math.abs(deltaX) > 35) {
        if (deltaX > 0) {
          handleScrollRight();
        } else {
          handleScrollLeft();
        }
      }
    }

    setTimeout(() => {
      setIsHoveredOrTouched(false);
    }, 3000);
  };

  if (!overrideProducts && (!products || products.length === 0) && trendingProducts.length === 0) {
    return (
      <div className="w-full mb-8 bg-white rounded-3xl p-4 sm:p-5 shadow-xs animate-pulse">
        <div className="flex items-center justify-between mb-3">
          <div className="h-6 w-40 bg-slate-200 rounded-lg"></div>
          <div className="h-5 w-20 bg-slate-100 rounded-full"></div>
        </div>
        <div className="flex gap-3 overflow-hidden">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="w-[calc(44%-8px)] sm:w-[calc(28%-10px)] lg:w-[calc(20%-10px)] min-w-[130px] shrink-0 h-56 bg-slate-100 rounded-2xl"></div>
          ))}
        </div>
      </div>
    );
  }

  // Clean hide if no active trending products exist
  if (trendingProducts.length === 0) {
    return null;
  }

  return (
    <section 
      id="trending-listings-section"
      className="w-full mb-8 relative transition-all duration-300 animate-fade-in"
      onMouseEnter={() => setIsHoveredOrTouched(true)}
      onMouseLeave={() => setIsHoveredOrTouched(false)}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-3 mb-3.5">
        <div className="flex items-center gap-2 font-sans">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-gradient-to-tr from-rose-500 via-red-500 to-amber-500 text-white flex items-center justify-center shadow-xs">
            <TrendingUp className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                Trending Ads
              </h3>
            </div>
          </div>
        </div>

        {/* Navigation Controls */}
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5">
            <button
              onClick={handleScrollLeft}
              className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 active:scale-95 transition-all flex items-center justify-center shadow-2xs cursor-pointer"
              aria-label="Previous Trending Listing"
            >
              <ChevronLeft className="w-4 h-4 stroke-[2.5]" />
            </button>
            <button
              onClick={handleScrollRight}
              className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 active:scale-95 transition-all flex items-center justify-center shadow-2xs cursor-pointer"
              aria-label="Next Trending Listing"
            >
              <ChevronRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>
      </div>

      {/* Horizontal Scroll Grid (Product cards same size as featured listings) */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="flex gap-4 overflow-x-auto scrollbar-none snap-x snap-mandatory py-1 px-0.5 touch-pan-x cursor-grab active:cursor-grabbing select-none"
        style={{ scrollBehavior: isTouchActiveRef.current ? 'auto' : 'smooth' }}
      >
        {trendingProducts.map((product) => (
          <div
            key={`trending-${product.id}`}
            className="w-[calc(30%-8px)] sm:w-[calc(20%-10px)] lg:w-[calc(14%-10px)] min-w-[115px] sm:min-w-[130px] shrink-0 snap-start"
          >
            <ProductCard product={product} isTrendingVariant={true} />
          </div>
        ))}
      </div>
    </section>
  );
};
