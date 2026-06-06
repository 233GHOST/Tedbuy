import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { ArrowLeft, MessageSquare, MapPin, Eye, Calendar, UserPlus, UserCheck, ChevronRight, Share2, ShieldAlert, Bookmark } from 'lucide-react';
import { ProductCard } from './ProductCard';

export const ProductDetail: React.FC = () => {
  const {
    products,
    selectedProductId,
    setCurrentView,
    currentUser,
    followSeller,
    unfollowSeller,
    startChat,
    setSelectedSellerId,
    toggleSaveProduct,
    setShowAuthModal,
    setAuthMode
  } = useApp();

  const product = products.find(p => p.id === selectedProductId);
  const [activeImageIdx, setActiveImageIdx] = useState(0);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    setActiveImageIdx(0);
  }, [selectedProductId]);

  if (!product) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12 text-center text-slate-500">
        <p className="mb-4">No product selected or item does not exist anymore.</p>
        <button
          onClick={() => setCurrentView('browse')}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl"
        >
          Return to Marketplace
        </button>
      </div>
    );
  }

  const isOwner = currentUser?.id === product.sellerId;
  const isFollowing = currentUser?.followingSellers?.includes(product.sellerId) || false;
  const isSaved = currentUser?.savedProductIds?.includes(product.id) || false;

  const handleToggleSave = () => {
    if (!currentUser) {
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    toggleSaveProduct(product.id);
  };

  const handleSellerClick = () => {
    setSelectedSellerId(product.sellerId);
    setCurrentView('seller-profile');
  };

  const handleMessageSeller = () => {
    if (!currentUser) {
      alert("Please Log In or switch to an active Dev Profile to message the seller.");
      return;
    }
    const chatId = startChat(product.id, "Hi, is this still available?");
    setCurrentView('chats');
  };

  const handleToggleFollow = () => {
    if (!currentUser) {
      alert("Please Log In or switch to an active Dev Profile to follow this seller.");
      return;
    }
    if (isFollowing) {
      unfollowSeller(product.sellerId);
    } else {
      followSeller(product.sellerId);
    }
  };

  const formattedPrice = new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS',
    maximumFractionDigits: 0
  }).format(product.price);

  const rawDate = new Date(product.createdAt);
  const dateFormatted = rawDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const similarProducts = products
    .filter(p => p.category === product.category && p.id !== product.id)
    .slice(0, 4);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Navigation bar and back button */}
      <button
        id="btn-back-to-browse"
        onClick={() => setCurrentView('browse')}
        className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 font-semibold mb-6 transition"
      >
        <ArrowLeft className="w-4.5 h-4.5" />
        <span>Back to Classifieds</span>
      </button>

      {/* Main product view grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 text-left">
        {/* Left column: Visual display images (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="relative aspect-4/3 w-full bg-slate-950 rounded-3xl overflow-hidden border border-slate-100 flex items-center justify-center shadow-md">
            <img
              src={product.images[activeImageIdx] || 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=800&q=80'}
              alt={product.title}
              className="max-w-full max-h-full object-contain"
            />
            
            {/* Overlay indicators */}
            <span className="absolute top-4 left-4 bg-slate-900/80 backdrop-blur-xs text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
              {product.category}
            </span>
            <span className="absolute bottom-4 right-4 bg-slate-900/80 backdrop-blur-xs text-slate-100 text-xs px-3 py-1 rounded-full font-mono">
              Image {activeImageIdx + 1} of {product.images.length}
            </span>
          </div>

          {/* Thumbnails list */}
          {product.images.length > 1 && (
            <div className="grid grid-cols-5 gap-3">
              {product.images.map((imgUrl, i) => (
                <button
                  key={i}
                  id={`image-thumb-${i}`}
                   onClick={() => setActiveImageIdx(i)}
                   className={`aspect-square rounded-xl overflow-hidden bg-slate-100 border-2 transition-all ${
                     i === activeImageIdx
                       ? 'border-slate-800 scale-95 shadow-sm'
                       : 'border-transparent hover:border-slate-350 hover:scale-98'
                   }`}
                >
                  <img src={imgUrl} alt="Thumbnail preview" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right column: Purchase callouts and details (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-xs space-y-5">
            <div className="space-y-2">
              <span className="text-3xl font-black text-slate-950 font-sans tracking-tight">
                {formattedPrice}
              </span>
              <h1 id="detail-product-title" className="text-xl font-bold font-sans text-slate-900 leading-snug">
                {product.title}
              </h1>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500 font-sans border-y border-slate-100 py-3">
              <span className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-slate-400" />
                {product.location}
              </span>
              <span className="flex items-center gap-1.5">
                <Eye className="w-4 h-4 text-slate-400" />
                {product.viewsCount} total visitors
              </span>
              <span className="flex items-center gap-1.5 flex-1 min-w-[120px]">
                <Calendar className="w-4 h-4 text-slate-400" />
                {dateFormatted}
              </span>
            </div>

            {/* Brand and Condition specifications module */}
            <div className="grid grid-cols-2 gap-3 bg-slate-50 border border-slate-150 rounded-2xl p-3.5 font-sans">
              <div>
                <span className="block text-[10px] text-slate-400 uppercase font-bold tracking-wider">Brand / Make</span>
                <span id="detail-brand-badge" className="text-sm font-extrabold text-slate-800 truncate block mt-0.5">
                  {product.brand || 'Generic / Other'}
                </span>
              </div>
              <div className="border-l border-slate-200 pl-3">
                <span className="block text-[10px] text-slate-400 uppercase font-bold tracking-wider">Condition</span>
                <span id="detail-condition-badge" className="text-sm font-extrabold text-slate-905 block mt-0.5">
                  {product.condition || 'Used (Good)'}
                </span>
              </div>
            </div>

            {/* Messaging / Call buttons */}
            <div className="space-y-3">
              {isOwner ? (
                <div className="bg-slate-50 text-slate-800 p-3.5 rounded-2xl border border-slate-200 text-xs">
                  👋 **You posted this product listing!** You can manage, edit details, or remove it from your personal store dashboard dashboard.
                </div>
              ) : (
                <div className="flex gap-3">
                  <button
                    id="btn-message-seller"
                    onClick={handleMessageSeller}
                    className="flex-1 py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl flex items-center justify-center gap-2 text-sm shadow-xs hover:shadow-md transition duration-200"
                  >
                    <MessageSquare className="w-5 h-5 fill-white/20 stroke-[2.2]" />
                    <span>Message Seller</span>
                  </button>
                  
                  <button
                    id="btn-save-detail"
                    onClick={handleToggleSave}
                    className={`px-4 py-3.5 rounded-2xl border transition duration-200 text-sm flex items-center justify-center gap-2 shrink-0 ${
                      isSaved
                        ? 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                    }`}
                    title={isSaved ? "Remove from Watchlist" : "Save to Watchlist"}
                  >
                    <Bookmark className="w-5 h-5" fill={isSaved ? "currentColor" : "none"} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Seller Bio Module */}
          <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">Seller Public Profile</h3>
              <button
                id="btn-view-profile"
                onClick={handleSellerClick}
                className="text-xs text-slate-900 hover:text-slate-750 font-bold hover:underline flex items-center"
              >
                <span>Visit Store</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <img
                src={product.sellerPhoto || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80"}
                alt={product.sellerName}
                className="w-12 h-12 rounded-full border border-slate-100 object-cover"
              />
              <div className="flex-1 text-left min-w-0">
                <h4 id="detail-seller-name" className="text-sm font-bold text-slate-900 truncate">
                  {product.sellerName}
                </h4>
                <p className="text-[11px] text-slate-450">
                  Joined Tedbuy: {product.sellerJoinDate}
                </p>
              </div>
              
              {!isOwner && (
                <button
                  id="btn-toggle-follow"
                  onClick={handleToggleFollow}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 ${
                    isFollowing
                      ? 'bg-slate-100 text-slate-700 border border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-100'
                      : 'bg-slate-900 text-white hover:bg-slate-800'
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
            
            {/* Trust disclaimer */}
            <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100 flex items-start gap-2.5 text-[10px] text-slate-500">
              <ShieldAlert className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-slate-700">🔒 Tedbuy Classifieds Safety Tips:</p>
                <p className="mt-0.5">Meet in public, check item status carefully, and DO NOT send cash deposits in advance of collecting your items!</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Full Description Segment */}
      <div className="mt-8 bg-white border border-slate-200 p-6 sm:p-8 rounded-3xl text-left shadow-xs">
        <h2 className="text-base font-bold text-slate-900 font-sans tracking-tight mb-4">
          Detailed Item Specifications
        </h2>
        <div className="prose prose-slate max-w-none text-sm text-slate-750 font-sans leading-relaxed whitespace-pre-line">
          {product.description}
        </div>
      </div>

      {/* Similar Listings Section */}
      <div className="mt-12 text-left">
        <h2 className="text-lg font-bold text-slate-900 font-sans tracking-tight mb-5">
          Similar Listings
        </h2>
        {similarProducts.length === 0 ? (
          <div className="bg-slate-50 border border-slate-200 p-8 rounded-3xl text-center text-slate-500 text-sm">
            No similar items found in <span className="font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-lg text-xs uppercase tracking-wider">{product.category}</span> yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {similarProducts.map(p => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
