import React, { useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Store, CheckCircle2, ChevronRight, ChevronLeft, MapPin, Package, ArrowUpRight } from 'lucide-react';

interface SellersToDiscoverProps {
  selectedCategory?: string | null;
}

export function SellersToDiscover({ selectedCategory }: SellersToDiscoverProps) {
  const { users, products, setSelectedSellerId, setCurrentView, sellerListingCounts } = useApp();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Derive top active sellers in-memory with zero extra database egress
  const activeSellers = useMemo(() => {
    // Count active products per seller from in-memory products
    const sellerLocalListingCount: Record<string, number> = {};
    const sellerTopCategories: Record<string, Set<string>> = {};
    const sellerLocations: Record<string, string> = {};

    (products || []).forEach((p) => {
      if (!p || (p as any).status === 'hidden' || (p as any).isSold || (p as any).status === 'sold') return;
      const uid = p.sellerId || (p as any).user_id;
      if (!uid) return;

      sellerLocalListingCount[uid] = (sellerLocalListingCount[uid] || 0) + 1;
      if (!sellerTopCategories[uid]) {
        sellerTopCategories[uid] = new Set();
      }
      if (p.category) {
        sellerTopCategories[uid].add(p.category);
      }
      if (p.location && !sellerLocations[uid]) {
        sellerLocations[uid] = p.location;
      }
    });

    const getRealCountForUser = (u: any): number => {
      if (!u) return 0;
      if (sellerListingCounts) {
        if (u.id && sellerListingCounts[u.id] !== undefined) return sellerListingCounts[u.id];
        if (u.uid && sellerListingCounts[u.uid] !== undefined) return sellerListingCounts[u.uid];
        if (u.username && sellerListingCounts[u.username.trim().toLowerCase()] !== undefined) {
          return sellerListingCounts[u.username.trim().toLowerCase()];
        }
        if (u.displayName && sellerListingCounts[u.displayName.trim().toLowerCase()] !== undefined) {
          return sellerListingCounts[u.displayName.trim().toLowerCase()];
        }
        if (u.email && sellerListingCounts[u.email.trim().toLowerCase()] !== undefined) {
          return sellerListingCounts[u.email.trim().toLowerCase()];
        }
      }
      return sellerLocalListingCount[u.id] || 0;
    };

    // Map sellers from loaded users
    const list = (users || [])
      .filter((u) => {
        if (!u || !u.id) return false;
        const realCount = getRealCountForUser(u);
        return realCount > 0;
      })
      .map((u) => {
        const count = getRealCountForUser(u);
        const categoriesSet = sellerTopCategories[u.id] || new Set();
        const primaryCategory = Array.from(categoriesSet)[0] || 'Marketplace';
        const location = (u as any).region || (u as any).location || sellerLocations[u.id] || 'Ghana';
        
        return {
          ...u,
          listingCount: count,
          primaryCategory,
          displayLocation: location,
        };
      });

    // Merge pre-cached top sellers from server SSR injection if any
    const initialSellers: any[] = typeof window !== 'undefined' && Array.isArray((window as any).__INITIAL_DISCOVER_SELLERS__)
      ? (window as any).__INITIAL_DISCOVER_SELLERS__
      : [];

    const existingIds = new Set(list.map(s => s.id));
    initialSellers.forEach(s => {
      if (s && s.id && !existingIds.has(s.id)) {
        const count = getRealCountForUser(s) || s.listingCount || 0;
        if (count > 0) {
          list.push({
            id: s.id,
            username: s.username || s.name,
            displayName: s.displayName || s.name,
            emailVerified: s.isVerified,
            photoUrl: s.photoUrl,
            listingCount: count,
            primaryCategory: s.primaryCategory || 'Marketplace',
            displayLocation: s.location || 'Ghana',
          } as any);
          existingIds.add(s.id);
        }
      }
    });

    list.sort((a, b) => {
      if (a.emailVerified && !b.emailVerified) return -1;
      if (!a.emailVerified && b.emailVerified) return 1;
      return b.listingCount - a.listingCount;
    });

    return list.slice(0, 12); // Display top 12 active sellers
  }, [users, products, sellerListingCounts]);

  if (activeSellers.length === 0) return null;

  const handleScroll = (direction: 'left' | 'right') => {
    if (!scrollContainerRef.current) return;
    const offset = direction === 'left' ? -280 : 280;
    scrollContainerRef.current.scrollBy({ left: offset, behavior: 'smooth' });
  };

  return (
    <section className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-4 text-left font-sans animate-fade-in relative mb-6">
      {/* Section Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-white shadow-xs">
              <Store className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 tracking-tight flex items-center gap-1.5">
                <span>Discover on TedBuy</span>
              </h3>
            </div>
          </div>
          <p className="text-xs text-slate-550 mt-1 hidden sm:block">
            Explore active Ghanaian storefronts, browse their full catalogs, and connect directly.
          </p>
        </div>

        {/* Scroll navigation arrows for desktop & View All */}
        <div className="flex items-center gap-2.5">
          <div className="hidden sm:flex items-center gap-1.5">
            <button
              onClick={() => handleScroll('left')}
              className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100 hover:border-slate-300 text-slate-700 flex items-center justify-center transition cursor-pointer active:scale-95"
              aria-label="Previous sellers"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleScroll('right')}
              className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100 hover:border-slate-300 text-slate-700 flex items-center justify-center transition cursor-pointer active:scale-95"
              aria-label="Next sellers"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => setCurrentView('sellers-discovery')}
            className="text-orange-500 font-bold text-sm sm:text-base flex items-center gap-0.5 hover:underline cursor-pointer ml-1 whitespace-nowrap"
          >
            View all
            <ChevronRight className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>
      </div>

      {/* Horizontal Carousel */}
      <div
        ref={scrollContainerRef}
        className="flex items-stretch gap-3.5 overflow-x-auto pb-2 pt-1 scrollbar-none snap-x snap-mandatory"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {activeSellers.map((seller) => {
          const sellerName = seller.username || (seller as any).displayName || 'TedBuy Merchant';
          const avatarUrl = seller.photoUrl && !String(seller.photoUrl).includes('1549399542-7e3f8b79c341')
            ? seller.photoUrl
            : null;

          return (
            <div
              key={seller.id}
              onClick={() => {
                setSelectedSellerId(seller.id);
                setCurrentView('seller-profile');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="w-[220px] sm:w-[240px] shrink-0 bg-slate-50 hover:bg-slate-100/80 border border-slate-200 hover:border-slate-300/80 rounded-2xl p-4 transition-all duration-200 flex flex-col justify-between cursor-pointer group snap-start shadow-3xs hover:shadow-xs"
            >
              <div>
                {/* Avatar & Verification row */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="relative">
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt={sellerName}
                        loading="lazy"
                        className="w-12 h-12 rounded-2xl object-cover border border-slate-200 group-hover:scale-105 transition-transform duration-200"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-2xl bg-slate-200 border border-slate-300/80 flex items-center justify-center text-slate-700 font-extrabold text-base group-hover:scale-105 transition-transform duration-200">
                        {sellerName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    {seller.emailVerified && (
                      <div
                        className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5 shadow-2xs"
                        title="Verified Seller"
                      >
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 fill-emerald-100" />
                      </div>
                    )}
                  </div>

                  <span className="text-[10px] font-extrabold px-2 py-0.5 bg-white border border-slate-200 text-slate-600 rounded-lg shrink-0">
                    {seller.primaryCategory}
                  </span>
                </div>

                {/* Seller Info */}
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-slate-900 truncate group-hover:text-[#c2410c] transition-colors">
                    {sellerName}
                  </h4>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className="truncate">{seller.displayLocation}</span>
                  </div>
                </div>
              </div>

              {/* Bottom stats & action */}
              <div className="mt-4 pt-3 border-t border-slate-200/70 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1 font-bold text-slate-700">
                  <Package className="w-3.5 h-3.5 text-slate-400" />
                  <span>{seller.listingCount} {seller.listingCount === 1 ? 'item' : 'items'}</span>
                </div>

                <div className="flex items-center gap-0.5 text-[#ea580c] font-bold text-[11px] group-hover:translate-x-0.5 transition-transform">
                  <span>Visit Store</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
