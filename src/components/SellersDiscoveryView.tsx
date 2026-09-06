import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { Store, ArrowLeft, CheckCircle2, ShieldCheck, MapPin, Search, X, UserPlus, UserCheck } from 'lucide-react';

export const SellersDiscoveryView: React.FC = () => {
  const { users, products, currentUser, setCurrentView, setSelectedSellerId, followSeller, unfollowSeller, setShowAuthModal, showToast } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const activeSellers = useMemo(() => {
    const sellerProductCounts = new Map<string, number>();
    const sellerCategories = new Map<string, Set<string>>();

    products.forEach((p) => {
      if (p && p.sellerId && p.status !== 'hidden' && !p.isSold) {
        sellerProductCounts.set(p.sellerId, (sellerProductCounts.get(p.sellerId) || 0) + 1);
        if (p.category) {
          if (!sellerCategories.has(p.sellerId)) {
            sellerCategories.set(p.sellerId, new Set());
          }
          sellerCategories.get(p.sellerId)!.add(p.category);
        }
      }
    });

    const sellersWithProducts = users.filter((u) => {
      const count = sellerProductCounts.get(u.id) || 0;
      return count > 0;
    });

    return sellersWithProducts.sort((a, b) => {
      const countA = sellerProductCounts.get(a.id) || 0;
      const countB = sellerProductCounts.get(b.id) || 0;
      return countB - countA;
    }).map((seller) => ({
      ...seller,
      listingCount: sellerProductCounts.get(seller.id) || 0,
      categories: Array.from(sellerCategories.get(seller.id) || [])
    }));
  }, [users, products]);

  const filteredSellers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeSellers;
    return activeSellers.filter((s) => {
      const name = (s.username || (s as any).displayName || '').toLowerCase();
      return name.includes(q);
    });
  }, [activeSellers, searchQuery]);

  const handleOpenSeller = (sellerId: string) => {
    setSelectedSellerId(sellerId);
    setCurrentView('seller-profile');
  };

  const handleToggleFollow = async (e: React.MouseEvent, sellerId: string, sellerName: string) => {
    e.stopPropagation();
    if (!currentUser) {
      setShowAuthModal(true);
      return;
    }
    const isFollowing = currentUser.followingSellers?.includes(sellerId);
    setTogglingId(sellerId);
    try {
      if (isFollowing) {
        await unfollowSeller(sellerId);
        showToast(`Unfollowed ${sellerName}`, 'info');
      } else {
        await followSeller(sellerId);
        showToast(`Now following ${sellerName}`, 'success');
      }
    } catch (err: any) {
      showToast(err?.message || 'Could not update follow status.', 'error');
    } finally {
      setTogglingId(null);
    }
  };

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
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-xs">
              <Store className="w-5 h-5 fill-none stroke-[2.5]" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight font-sans">
                Discover on TedBuy
              </h1>
              <p className="text-xs font-medium text-slate-500 mt-0.5">
                Explore active Ghanaian merchants, browse their full catalogs, and connect directly
              </p>
            </div>
          </div>
        </div>

        {/* Store Search Input (Parity with Mobile DiscoverSellersScreen) */}
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search stores..."
            className="w-full pl-10 pr-9 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Grid Content */}
      {filteredSellers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
            <Store className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-800">
            {searchQuery ? 'No stores matching your search' : 'No Active Sellers Found'}
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {searchQuery ? `We couldn't find any stores matching "${searchQuery}". Try a different name.` : 'Check back later as new merchants set up their storefronts.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
          {filteredSellers.map((seller) => {
            const sellerName = seller.username || (seller as any).displayName || 'TedBuy Merchant';
            const avatarUrl = seller.photoUrl && !String(seller.photoUrl).includes('1549399542-7e3f8b79c341')
              ? seller.photoUrl
              : null;
            const primaryCategory = seller.categories?.[0] || 'Marketplace';
            const isVerified = Boolean((seller as any).isVerified || (seller as any).verified);
            const location = (seller as any).location || (seller as any).region || 'Ghana';
            const isFollowing = currentUser?.followingSellers?.includes(seller.id);
            const isSelf = currentUser?.id === seller.id;

            return (
              <div
                key={`seller-${seller.id}`}
                onClick={() => handleOpenSeller(seller.id)}
                className="bg-white rounded-2xl p-5 border border-slate-200/80 hover:border-blue-400 hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-center gap-3.5 mb-3.5">
                    <div className="relative w-14 h-14 rounded-2xl overflow-hidden bg-gradient-to-tr from-slate-100 to-slate-200 border border-slate-200 shrink-0 flex items-center justify-center">
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt={sellerName}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="text-lg font-black text-slate-700">
                          {sellerName.charAt(0).toUpperCase()}
                        </span>
                      )}
                      {isVerified && (
                        <div className="absolute bottom-0 right-0 w-4 h-4 bg-blue-500 rounded-full border-2 border-white flex items-center justify-center">
                          <CheckCircle2 className="w-2.5 h-2.5 text-white" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h4 className="text-sm font-bold text-slate-900 truncate group-hover:text-blue-600 transition">
                          {sellerName}
                        </h4>
                        {isVerified && (
                          <ShieldCheck className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
                        <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="truncate">{location}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-4">
                    <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 text-xs font-bold">
                      {seller.listingCount} {seller.listingCount === 1 ? 'Ad' : 'Ads'}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold truncate max-w-[140px]">
                      {primaryCategory}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    className="flex-1 py-2 bg-slate-50 group-hover:bg-blue-600 group-hover:text-white text-slate-700 font-bold text-xs rounded-xl transition duration-200 text-center"
                  >
                    Visit Store ›
                  </button>
                  {!isSelf && (
                    <button
                      type="button"
                      disabled={togglingId === seller.id}
                      onClick={(e) => handleToggleFollow(e, seller.id, sellerName)}
                      className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer shrink-0 ${
                        isFollowing
                          ? 'bg-slate-100 text-slate-700 hover:bg-rose-50 hover:text-rose-600'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {isFollowing ? (
                        <>
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>Following</span>
                        </>
                      ) : (
                        <>
                          <UserPlus className="w-3.5 h-3.5" />
                          <span>Follow</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
