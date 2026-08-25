import React, { useMemo } from 'react';
import { ProductCard } from './ProductCard';
import { useApp } from '../context/AppContext';
import { getForYouProducts } from '../utils/recommendationScore';

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
  const { products, users, reviews, chats, currentUser, recentlyViewedIds } = useApp();

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

  if (!result.items || result.items.length === 0) {
    return null;
  }

  return (
    <section id="for-you-section" className="w-full mb-8 animate-fade-in">
      <div className="flex items-center gap-2 font-sans mb-1">
        <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
          {result.headline}
        </h3>
      </div>

      <p className={`text-xs font-semibold text-slate-500 ${result.subtitle ? 'mb-4' : 'mb-4 h-0 overflow-hidden'}`}>
        {result.subtitle}
      </p>

      <div
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
