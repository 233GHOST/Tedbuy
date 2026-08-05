import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Product } from '../types';
import { ProductCard } from './ProductCard';
import { useApp } from '../context/AppContext';
import { isBoostActive, parseDate } from '../utils/dateParser';
import { TrendingUp, ChevronLeft, ChevronRight, Flame, X, Search } from 'lucide-react';

interface FeaturedListingsProps {
  /** Optional override if parent passes filtered list directly */
  overrideProducts?: Product[];
}

export const FeaturedListings: React.FC<FeaturedListingsProps> = ({ overrideProducts }) => {
  const { products, setSelectedProductId, setCurrentView } = useApp();
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [isViewAllOpen, setIsViewAllOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Touch & Swipe gesture ref state
  const touchStartXRef = useRef<number>(0);
  const touchStartYRef = useRef<number>(0);
  const scrollStartLeftRef = useRef<number>(0);
  const isSwipingRef = useRef<boolean>(false);
  const isTouchActiveRef = useRef<boolean>(false);

  const autoSwipeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isHoveredOrTouched, setIsHoveredOrTouched] = useState<boolean>(false);

  // 1. Fetch or filter active non-expired boosted products
  const filterAndSortFeatured = useCallback((allProducts: Product[]): Product[] => {
    return allProducts
      .filter((p) => {
        if (!p) return false;
        // Must not be hidden or sold
        if (p.status === 'hidden' || p.isSold) return false;
        
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

  // 2. Load featured products from server API cache or Context products
  const fetchFeaturedProducts = useCallback(async () => {
    try {
      const res = await fetch('/api/featured');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.products)) {
          const validFeatured = filterAndSortFeatured(data.products);
          setFeaturedProducts(validFeatured);
          setIsLoading(false);
          return;
        }
      }
    } catch (err) {
      console.warn('[FeaturedListings] /api/featured fetch fallback to context state:', err);
    }

    // Fallback to filtering local context products
    if (products && products.length > 0) {
      const filtered = filterAndSortFeatured(products);
      setFeaturedProducts(filtered);
    }
    setIsLoading(false);
  }, [products, filterAndSortFeatured]);

  useEffect(() => {
    if (overrideProducts) {
      setFeaturedProducts(filterAndSortFeatured(overrideProducts));
      setIsLoading(false);
      return;
    }

    fetchFeaturedProducts();
  }, [overrideProducts, products, fetchFeaturedProducts, filterAndSortFeatured]);

  // Periodic expiration check (every 10 seconds, client side cleanup)
  useEffect(() => {
    const interval = setInterval(() => {
      setFeaturedProducts((prev) => {
        const updated = filterAndSortFeatured(prev);
        if (updated.length !== prev.length) {
          return updated;
        }
        return prev;
      });
    }, 10000);

    return () => clearInterval(interval);
  }, [filterAndSortFeatured]);

  // Track active scroll index for pagination dots
  const handleScroll = () => {
    if (!containerRef.current) return;
    const cardWidth = containerRef.current.firstElementChild?.getBoundingClientRect().width || 280;
    const scrollLeft = containerRef.current.scrollLeft;
    const index = Math.round(scrollLeft / (cardWidth + 16));
    setActiveIndex(Math.min(Math.max(0, index), featuredProducts.length - 1));
  };

  // Scroll to explicit index
  const scrollToIndex = (index: number) => {
    if (!containerRef.current) return;
    const cardWidth = containerRef.current.firstElementChild?.getBoundingClientRect().width || 280;
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
    setIsViewAllOpen(true);
  };

  const modalProducts = searchQuery.trim()
    ? featuredProducts.filter(
        (p) =>
          p.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.category?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.location?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : featuredProducts;

  // If loading and no products yet
  if (isLoading && featuredProducts.length === 0) {
    return (
      <div className="w-full mb-8 bg-white rounded-3xl p-4 sm:p-6 shadow-xs animate-pulse">
        <div className="flex items-center justify-between mb-4">
          <div className="h-7 w-48 bg-slate-200 rounded-lg"></div>
          <div className="h-6 w-24 bg-slate-100 rounded-full"></div>
        </div>
        <div className="flex gap-4 overflow-hidden">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="w-[220px] sm:w-[260px] lg:w-[calc(25%-12px)] min-w-[200px] shrink-0 h-72 bg-slate-100 rounded-2xl"></div>
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
    <>
      <section 
        id="featured-listings-section"
        className="w-full mb-8 relative transition-all duration-300 animate-fade-in"
        onMouseEnter={() => setIsHoveredOrTouched(true)}
        onMouseLeave={() => setIsHoveredOrTouched(false)}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-end gap-3 mb-4">
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
              className="w-[220px] sm:w-[260px] lg:w-[calc(25%-12px)] min-w-[200px] shrink-0 snap-start"
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

      {/* All Featured Listings Modal */}
      {isViewAllOpen && (
        <div 
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[100] flex items-center justify-center p-3 sm:p-6 overflow-hidden animate-fade-in"
          onClick={() => {
            setIsViewAllOpen(false);
            setSearchQuery('');
          }}
        >
          <div 
            className="bg-white rounded-3xl max-w-6xl w-full h-full max-h-[90vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-scale-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 sm:p-6 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 text-white flex items-center justify-center shadow-md shadow-orange-500/20">
                  <Flame className="w-5 h-5 fill-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight font-sans">
                      Featured Listings
                    </h2>
                    <span className="bg-amber-100 text-amber-800 text-xs font-black px-2.5 py-0.5 rounded-full border border-amber-200">
                      {featuredProducts.length} Items
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium">
                    Explore all active promoted & video spotlight listings
                  </p>
                </div>
              </div>

              <button
                onClick={() => {
                  setIsViewAllOpen(false);
                  setSearchQuery('');
                }}
                className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 flex items-center justify-center transition cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Optional Quick Search Filter inside Modal */}
            {featuredProducts.length > 4 && (
              <div className="px-4 sm:px-6 pt-4 pb-3 border-b border-slate-100 bg-white">
                <div className="relative max-w-md">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search featured items..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all font-sans"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Modal Grid Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50/50">
              {modalProducts.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-sm font-bold text-slate-500">No matching featured listings found.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
                  {modalProducts.map((product) => (
                    <div
                      key={`modal-featured-${product.id}`}
                      onClick={() => {
                        setIsViewAllOpen(false);
                        setSearchQuery('');
                      }}
                    >
                      <ProductCard product={product} isFeaturedVariant={true} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
