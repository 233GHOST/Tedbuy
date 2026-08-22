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

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Touch & Swipe gesture ref state
  const touchStartXRef = useRef<number>(0);
  const touchStartYRef = useRef<number>(0);
  const scrollStartLeftRef = useRef<number>(0);
  const isSwipingRef = useRef<boolean>(false);
  const isTouchActiveRef = useRef<boolean>(false);

  const autoSwipeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isHoveredOrTouched, setIsHoveredOrTouched] = useState<boolean>(false);

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
  const scrollToIndex = (index: number) => {
    if (!containerRef.current) return;
    const cardWidth = containerRef.current.firstElementChild?.getBoundingClientRect().width || 160;
    containerRef.current.scrollTo({
      left: index * (cardWidth + 16),
      behavior: 'smooth'
    });
    setActiveIndex(index);
  };

  // Navigation handlers
  const handleScrollLeft = () => {
    const nextIndex = Math.max(0, activeIndex - 1);
    scrollToIndex(nextIndex);
  };

  const handleScrollRight = () => {
    if (activeIndex >= featuredProducts.length - 1) {
      scrollToIndex(0);
    } else {
      scrollToIndex(activeIndex + 1);
    }
  };

  // Auto-swipe timer (scrolls every 5 seconds unless hovered/touched)
  useEffect(() => {
    if (featuredProducts.length <= 1 || isHoveredOrTouched) {
      if (autoSwipeTimerRef.current) clearInterval(autoSwipeTimerRef.current);
      return;
    }

    autoSwipeTimerRef.current = setInterval(() => {
      handleScrollRight();
    }, 5000);

    return () => {
      if (autoSwipeTimerRef.current) clearInterval(autoSwipeTimerRef.current);
    };
  }, [featuredProducts.length, isHoveredOrTouched, activeIndex]);

  // Touch Swipe Gesture Handlers (Left/Right)
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

    // Detect horizontal swipe vs vertical page scroll
    if (!isSwipingRef.current) {
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 8) {
        isSwipingRef.current = true;
      }
    }

    if (isSwipingRef.current) {
      // Direct 1:1 manual drag scrolling feedback
      containerRef.current.scrollLeft = scrollStartLeftRef.current + deltaX;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isTouchActiveRef.current) return;
    isTouchActiveRef.current = false;

    if (isSwipingRef.current && containerRef.current) {
      const endX = e.changedTouches[0]?.clientX || touchStartXRef.current;
      const deltaX = touchStartXRef.current - endX;

      // Threshold for manual swipe step completion
      if (Math.abs(deltaX) > 35) {
        if (deltaX > 0) {
          // Swiped Left -> scroll right
          handleScrollRight();
        } else {
          // Swiped Right -> scroll left
          handleScrollLeft();
        }
      }
    }

    // Resume auto-swipe after 3 seconds of touch release
    setTimeout(() => {
      setIsHoveredOrTouched(false);
    }, 3000);
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
      onMouseEnter={() => setIsHoveredOrTouched(true)}
      onMouseLeave={() => setIsHoveredOrTouched(false)}
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

        {/* Touch Swipeable Horizontal Grid Container */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="flex gap-4 overflow-x-auto scrollbar-none snap-x snap-mandatory py-1 px-0.5 touch-pan-x cursor-grab active:cursor-grabbing select-none"
          style={{ scrollBehavior: isTouchActiveRef.current ? 'auto' : 'smooth' }}
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
                onClick={() => scrollToIndex(i)}
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
