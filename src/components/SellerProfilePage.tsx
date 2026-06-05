import React from 'react';
import { useApp } from '../context/AppContext';
import { ProductCard } from './ProductCard';
import { ArrowLeft, UserPlus, UserCheck, ShoppingBag, Users, Calendar, MapPin } from 'lucide-react';

export const SellerProfilePage: React.FC = () => {
  const {
    users,
    products,
    selectedSellerId,
    setCurrentView,
    currentUser,
    followSeller,
    unfollowSeller
  } = useApp();

  const seller = users.find(u => u.id === selectedSellerId);

  // If no seller ID or seller not found, render fallback
  if (!seller) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12 text-center text-slate-500">
        <p>Seller profile not found.</p>
        <button
          onClick={() => setCurrentView('browse')}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl mt-4"
        >
          Back to Marketplace
        </button>
      </div>
    );
  }

  // Filter listings belonging strictly to this seller
  const sellerProducts = products.filter(p => p.sellerId === seller.id);

  const isOwner = currentUser?.id === seller.id;
  const isFollowing = currentUser?.followingSellers?.includes(seller.id) || false;

  const handleToggleFollow = () => {
    if (!currentUser) {
      alert("Please Log In or switch to an active Dev Profile to follow this seller.");
      return;
    }
    if (isFollowing) {
      unfollowSeller(seller.id);
    } else {
      followSeller(seller.id);
    }
  };

  // Generate an approximate follow count based on seed/active metrics
  const totalFollowersCount = seller.id === 'user_john' ? 15 : seller.id === 'user_kelvin' ? 8 : isFollowing ? 1 : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Return link */}
      <button
        onClick={() => setCurrentView('browse')}
        className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-950 font-semibold mb-6 transition text-left"
      >
        <ArrowLeft className="w-4.5 h-4.5" />
        <span>Return to Marketplace</span>
      </button>

      {/* Profile Bio Showcase Header (Bento layout) */}
      <div className="bg-slate-900 border border-slate-800 text-white rounded-3xl p-6 sm:p-8 shadow-md text-left mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex items-center gap-5">
          <img
            src={seller.photoUrl || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=160&q=80"}
            alt={seller.username}
            className="w-18 h-18 sm:w-20 sm:h-20 rounded-full border-2 border-slate-700/85 object-cover shrink-0"
          />
          <div className="space-y-1.5">
            <h1 id="seller-profile-title" className="text-xl sm:text-2xl font-bold font-sans tracking-tight text-white leading-none">
              {seller.username}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-350 font-sans">
              <span className="flex items-center gap-1">
                <Calendar className="w-4 h-4 text-slate-400" />
                Member: since {seller.joinDate}
              </span>
              <span className="flex items-center gap-1">
                <ShoppingBag className="w-4 h-4 text-slate-400" />
                <b>{sellerProducts.length}</b> live listings
              </span>
              <span className="flex items-center gap-1">
                <Users className="w-4 h-4 text-slate-400" />
                <b>{totalFollowersCount}</b> followers
              </span>
            </div>
            
            {seller.id === 'user_john' && (
              <span className="inline-block bg-slate-800 text-slate-200 text-[9px] font-bold px-2 py-0.5 rounded-md border border-slate-700 uppercase tracking-widest">
                VERIFIED DEALER
              </span>
            )}
          </div>
        </div>

        {/* Action button */}
        {!isOwner && (
          <button
            id="seller-profile-follow-btn"
            onClick={handleToggleFollow}
            className={`w-full md:w-auto px-5 py-2.5 rounded-xl font-bold transition duration-200 text-sm flex items-center justify-center gap-1.5 shrink-0 ${
              isFollowing
                ? 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-750'
                : 'bg-white hover:bg-slate-100 text-slate-900 shadow-xs'
            }`}
          >
            {isFollowing ? (
              <>
                <UserCheck className="w-4 h-4" />
                <span>Following Store</span>
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                <span>Follow Store</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Seller products grid */}
      <div className="space-y-6 text-left">
        <div>
          <h2 className="text-lg font-bold text-slate-900 font-sans tracking-tight">
            Active Catalog ({sellerProducts.length} items)
          </h2>
          <p className="text-xs text-slate-500">Contact the retailer directly to bargain prices or agree delivery options.</p>
        </div>

        {sellerProducts.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center text-slate-400 max-w-lg mx-auto">
            <ShoppingBag className="w-12 h-12 mx-auto stroke-[1.2] text-slate-300 mb-2" />
            <p className="font-semibold text-sm">No items posted yet</p>
            <p className="text-xs text-slate-400 mt-1">This seller has no commercial listings published in the directory for now.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {sellerProducts.map(prod => (
              <ProductCard key={prod.id} product={prod} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
