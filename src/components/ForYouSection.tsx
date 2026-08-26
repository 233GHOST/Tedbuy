import React, { useMemo, useRef } from 'react';
import { ProductCard } from './ProductCard';
import { useApp } from '../context/AppContext';
import { getForYouProducts } from '../utils/recommendationScore';
import { Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';

interface ForYouSectionProps {
  /** Optional Ghana location filter context, passed down the same way other
   * homepage sections receive selectedCategory — kept as a prop rather than
   * lifted into AppContext to avoid touching shared state for a filter that
   * today only lives inside the homepage's local UI state. */
  selectedRegion?: string | null;
  selectedCity?: string | null;
}

/**
 * Phase 4A "For You" discovery section. Computed entirely from state already
 * loaded elsewhere in the app (products/users/reviews/chats/recently-viewed) —
 * no network requests of its own, cold-start safe (falls back to a generic
 * "Discover on TedBuy" ranking when a user has no behavioral history yet).
 */
export const ForYouSection: React.FC<ForYouSectionProps> = ({ selectedRegion, selectedCity }) => {
  const { products, users, reviews, chats, currentUser, recentlyViewedIds, setCurrentView } = useApp();
  const containerRef = useRef<HTMLDivElement>(null);

  const result = useMemo(() => {
    return getForYouProducts({
      products,
      users,
      reviews,
      chats,
      currentUser,
      recentlyViewedIds,
      selectedRegion,
      selectedCity,
      limit: 12
    });
  }, [products, users, reviews, chats, currentUser, recentlyViewedIds, selectedRegion, selectedCity]);

  const handleScrollLeft = () => {
    if (containerRef.current) {
      const cardWidth = containerRef.current.firstElementChild?.clientWidth || 280;
      containerRef.current.scrollBy({ left: -(cardWidth * 2 + 16), behavior: 'smooth' });
    }
  };

  const handleScrollRight = () => {
    if (containerRef.current) {
      const cardWidth = containerRef.current.firstElementChild?.clientWidth || 280;
      containerRef.current.scrollBy({ left: (cardWidth * 2 + 16), behavior: 'smooth' });
    }
  };

  const handleViewAll = () => {
    setCurrentView('for-you-listings');
  };

  if (!result.items || result.items.length === 0) {
    return null;
  }

  return (
    <section id="for-you-section" className="w-full mb-8 animate-fade-in">
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2.5 font-sans">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 via-orange-500 to-amber-600 text-white flex items-center justify-center shadow-xs shrink-0">
            <Sparkles className="w-4 h-4 fill-white text-white" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-slate-900 tracking-tight leading-tight">
              {result.headline}
            </h3>
            {result.subtitle && (
              <p className="text-xs font-semibold text-slate-500 mt-0.5">
                {result.subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Right side navigation: Desktop Controls & View All */}
        <div className="flex items-center gap-2.5">
          <div className="hidden sm:flex items-center gap-1.5">
            <button
              onClick={handleScrollLeft}
              className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 active:scale-95 transition-all flex items-center justify-center shadow-2xs cursor-pointer"
              aria-label="Previous Discovery Item"
            >
              <ChevronLeft className="w-4 h-4 stroke-[2.5]" />
            </button>
            <button
              onClick={handleScrollRight}
              className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 active:scale-95 transition-all flex items-center justify-center shadow-2xs cursor-pointer"
              aria-label="Next Discovery Item"
            >
              <ChevronRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>

          <button
            onClick={handleViewAll}
            className="text-orange-500 font-bold text-sm sm:text-base flex items-center gap-0.5 hover:underline cursor-pointer ml-1 whitespace-nowrap"
          >
            View all
            <ChevronRight className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex gap-4 overflow-x-auto scrollbar-none snap-x snap-proximity py-1 px-0.5 touch-auto overscroll-x-contain"
        style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {result.items.map((product) => (
          <div
            key={`for-you-${product.id}`}
            className="w-[calc(50%-8px)] sm:w-[calc(33.333%-11px)] lg:w-[calc(25%-12px)] min-w-[140px] shrink-0 snap-start"
          >
            <ProductCard product={product} />
          </div>
        ))}
      </div>
    </section>
  );
};
