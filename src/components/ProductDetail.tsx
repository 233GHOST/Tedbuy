import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { ArrowLeft, MessageSquare, MapPin, Eye, Calendar, UserPlus, UserCheck, ChevronRight, ShieldAlert, Bookmark, X, Camera, ChevronLeft, Maximize2, Edit2, Trash2, Share2, Check, Package, RefreshCw, Plus } from 'lucide-react';
import { ProductCard } from './ProductCard';
import { ListingModal } from './ListingModal';
import { isUserVerified, calculateTrustScore } from '../types';
import { slugify } from '../utils/slugify';

export const ProductDetail: React.FC = () => {
  const {
    products,
    users,
    reviews,
    selectedProductId,
    setCurrentView,
    currentUser,
    followSeller,
    unfollowSeller,
    startChat,
    setSelectedSellerId,
    toggleSaveProduct,
    setShowAuthModal,
    setAuthMode,
    incrementProductViews,
    deleteProduct,
    updateProduct,
    setIsVerificationBlockOpen,
    setBlockedActionType
  } = useApp();

  const product = products.find(p => p.id === selectedProductId);
  const sellerUser = users?.find(u => u.id === product?.sellerId);
  const isSellerVerified = isUserVerified(sellerUser);
  const sellerReviews = reviews.filter(r => r.sellerId === product?.sellerId);
  const trustResult = calculateTrustScore(sellerUser, sellerReviews);
  const [viewedPhoto, setViewedPhoto] = useState<{ url: string; name: string } | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [activeMediaIdx, setActiveMediaIdx] = useState(0);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteCheckboxConfirmed, setDeleteCheckboxConfirmed] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const mediaGallery = product ? [
    ...product.images.map(url => ({ type: 'image' as const, url })),
    ...(product.videos || []).map(url => ({ type: 'video' as const, url }))
  ] : [];

  // Keyboard navigation support for Media Lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (lightboxIndex !== null && mediaGallery.length > 0) {
        if (e.key === 'Escape') {
          setLightboxIndex(null);
        } else if (e.key === 'ArrowRight') {
          setLightboxIndex((prev) => (prev !== null && prev < mediaGallery.length - 1 ? prev + 1 : 0));
        } else if (e.key === 'ArrowLeft') {
          setLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : mediaGallery.length - 1));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [lightboxIndex, mediaGallery.length]);

  useEffect(() => {
    try {
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch {
      // standard fallback
    }
    setActiveMediaIdx(0);
    if (selectedProductId) {
      incrementProductViews(selectedProductId);
    }
  }, [selectedProductId, incrementProductViews]);

  // Dynamic OpenGraph, Google and Twitter Metadata inject/update (Requirement 3)
  useEffect(() => {
    if (!product) return;

    const updateMetaTag = (selector: string, attrName: string, attrVal: string, contentStr: string) => {
      let el = document.querySelector(selector);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attrName, attrVal);
        document.head.appendChild(el);
      }
      el.setAttribute('content', contentStr);
    };

    try {
      const parentTitle = `${product.title} - GHS ${product.price} | Tedbuy Ghana`;
      document.title = parentTitle;

      updateMetaTag('meta[property="og:title"]', 'property', 'og:title', parentTitle);
      updateMetaTag('meta[property="og:description"]', 'property', 'og:description', product.description || `Check out this classified deal under ${product.category}.`);
      updateMetaTag('meta[property="og:url"]', 'property', 'og:url', window.location.href);

      const mainImg = product.images?.[0] || 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=400&q=80';
      updateMetaTag('meta[property="og:image"]', 'property', 'og:image', mainImg);
      updateMetaTag('meta[property="og:image:secure_url"]', 'property', 'og:image:secure_url', mainImg);
      updateMetaTag('meta[property="og:type"]', 'property', 'og:type', 'product');

      updateMetaTag('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image');
      updateMetaTag('meta[name="twitter:title"]', 'name', 'twitter:title', parentTitle);
      updateMetaTag('meta[name="twitter:description"]', 'name', 'twitter:description', product.description || `Check out this classified deal.`);
      updateMetaTag('meta[name="twitter:image"]', 'name', 'twitter:image', mainImg);
    } catch (err) {
      console.warn('Meta updater warning', err);
    }

    return () => {
      document.title = 'Tedbuy Classifieds Marketplace';
    };
  }, [product]);

  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const pId = params?.get('productId');
  const pTitle = params?.get('title');
  const pImg = params?.get('image') || params?.get('img');
  const pPrice = params?.get('price');
  const pLoc = params?.get('location');

  if (!product) {
    if (pId || pTitle) {
      return (
        <div className="max-w-xl mx-auto px-4 py-8 animate-fade-in font-sans">
          {/* Back to main classifieds */}
          <button
            onClick={() => setCurrentView('browse')}
            className="flex items-center gap-2 text-xs font-black text-slate-500 hover:text-slate-900 mb-6 transition uppercase tracking-wider cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Go to Marketplace</span>
          </button>

          {/* Gorgeous Welcome Card */}
          <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-xl space-y-6 text-left relative overflow-hidden">
            {/* Ambient Background decoration */}
            <div className="absolute top-0 right-0 w-24 h-24 bg-teal-500/10 rounded-full blur-2xl -z-10 animate-pulse"></div>
            <div className="absolute bottom-0 left-0 w-28 h-28 bg-blue-500/10 rounded-full blur-2xl -z-10"></div>

            <div className="flex items-center gap-2.5">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono">
                TedBuy Live Deal Preview
              </p>
            </div>

            {/* Product Image preview */}
            {pImg ? (
              <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden border border-slate-100 bg-slate-50 shadow-sm flex items-center justify-center">
                <img 
                  src={pImg} 
                  alt={pTitle || "Shared deal preview"} 
                  loading="lazy"
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            ) : (
              <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden border border-slate-100 bg-slate-50 flex flex-col items-center justify-center text-slate-300">
                <Package className="w-16 h-16 stroke-[1.2] text-slate-300 animate-pulse" />
                <span className="text-[10px] text-slate-400 uppercase tracking-wider mt-2 font-bold font-mono">Photo Loading...</span>
              </div>
            )}

            {/* Details */}
            <div className="space-y-3">
              <h3 className="text-xl font-black text-slate-900 leading-tight tracking-tight">
                {pTitle || "Loading listing title..."}
              </h3>

              <div className="flex flex-wrap gap-2.5 pt-1">
                {pPrice && (
                  <span className="bg-slate-900 text-white font-mono text-xs font-black px-3.5 py-1.5 rounded-xl shadow-xs">
                    {pPrice}
                  </span>
                )}
                {pLoc && (
                  <span className="bg-slate-50 border border-slate-200 text-slate-650 font-bold text-[10px] px-3 py-1.5 rounded-xl flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span>{pLoc}</span>
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={() => setCurrentView('browse')}
              className="w-full py-4 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-[11px] uppercase tracking-wider rounded-2xl transition cursor-pointer active:scale-98 text-center block shadow-md"
            >
              Browse All Listings on TedBuy
            </button>
          </div>
        </div>
      );
    }

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
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    if (!currentUser.emailVerified) {
      setBlockedActionType('chat');
      setIsVerificationBlockOpen(true);
      return;
    }
    const chatId = startChat(product.id, "Hi, is this still available?");
    setCurrentView('chats');
  };

  const handleMessageWhatsApp = () => {
    if (!currentUser) {
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    if (!currentUser.emailVerified) {
      setBlockedActionType('whatsApp');
      setIsVerificationBlockOpen(true);
      return;
    }
    if (!sellerUser?.whatsAppNumber) return;

    let cleanNumber = sellerUser.whatsAppNumber.replace(/\D/g, '');
    if (cleanNumber.startsWith('0') && cleanNumber.length === 10) {
      cleanNumber = '233' + cleanNumber.substring(1);
    } else if (!cleanNumber.startsWith('233') && cleanNumber.length === 9) {
      cleanNumber = '233' + cleanNumber;
    }

    const prefilledText = `Hello! I'm interested in your listed item "${product.title}" on Tedbuy marketplace. Let's chat!`;
    const finalUrl = `https://wa.me/${cleanNumber}?text=${encodeURIComponent(prefilledText)}`;
    window.open(finalUrl, '_blank', 'noopener,noreferrer');
  };

  const handleToggleFollow = () => {
    if (!currentUser) {
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    if (isFollowing) {
      unfollowSeller(product.sellerId);
    } else {
      followSeller(product.sellerId);
    }
  };

  const handleDeleteAd = async () => {
    if (!product) return;
    try {
      setIsDeleting(true);
      setDeleteError(null);
      await deleteProduct(product.id);
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      setCurrentView('browse');
    } catch (err: any) {
      setIsDeleting(false);
      console.error("Could not delete product:", err);
      let msg = "Failed to delete listing. Please check your admin privileges.";
      if (err instanceof Error) {
        try {
          const parsed = JSON.parse(err.message);
          if (parsed.error) {
            msg = `Error: ${parsed.error}`;
          }
        } catch {
          msg = err.message;
        }
      }
      setDeleteError(msg);
    }
  };

  const extractNumericPrice = (priceVal: string | number): number | null => {
    if (typeof priceVal === 'number') return priceVal;
    const cleanStr = priceVal.replace(/GHS/gi, '').replace(/,/g, '').trim();
    const num = Number(cleanStr);
    if (!isNaN(num) && cleanStr !== '') return num;
    const matches = priceVal.replace(/,/g, '').match(/\d+(\.\d+)?/);
    if (matches) {
      return Number(matches[0]);
    }
    return null;
  };

  const formatProductPrice = (priceVal: string | number) => {
    if (typeof priceVal === 'string') {
      const lower = priceVal.trim().toLowerCase();
      if (lower === 'contact for price' || lower === 'contact for price.' || lower.includes('contact for price')) {
        return 'Inquire';
      }
    }
    if (typeof priceVal === 'number') {
      return new Intl.NumberFormat('en-GH', {
        style: 'currency',
        currency: 'GHS',
        maximumFractionDigits: 0
      }).format(priceVal);
    }
    const cleanStr = priceVal.replace(/GHS/gi, '').replace(/,/g, '').trim();
    const num = Number(cleanStr);
    if (!isNaN(num) && cleanStr !== '') {
      return new Intl.NumberFormat('en-GH', {
        style: 'currency',
        currency: 'GHS',
        maximumFractionDigits: 0
      }).format(num);
    }
    return priceVal;
  };

  const formattedPrice = formatProductPrice(product.price);

  const rawDate = new Date(product.createdAt);
  const dateFormatted = rawDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const similarProducts = products
    .filter(p => p.id !== product.id && p.category && product.category && p.category.toLowerCase() === product.category.toLowerCase())
    .slice(0, 4);

  const cleanPrice = typeof product.price === 'number'
    ? product.price
    : parseFloat(String(product.price).replace(/[^\d.]/g, '')) || 0;

  const jsonLdData = {
    "@context": "https://schema.org/",
    "@type": "Product",
    "id": `https://tedbuy.store/product/${product.id}`,
    "name": product.title,
    "image": product.images || [],
    "description": product.description || `Buy ${product.title} on Tedbuy Ghana classifieds.`,
    "brand": {
      "@type": "Brand",
      "name": product.brand || "Unspecified"
    },
    "offers": {
      "@type": "Offer",
      "url": typeof window !== 'undefined' ? window.location.href : `https://tedbuy.store/product/${product.id}`,
      "priceCurrency": "GHS",
      "price": cleanPrice,
      "itemCondition": product.condition === 'New' ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition",
      "availability": "https://schema.org/InStock",
      "priceValidUntil": "2027-12-31",
      "seller": {
        "@type": "Person",
        "name": sellerUser?.username || product.sellerName || "Verified Seller",
        "url": typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}/seller/${product.sellerId}` : `https://tedbuy.store/seller/${product.sellerId}`
      }
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* JSON-LD Structured Data for Google Rich Snippets */}
      <script type="application/ld+json">
        {JSON.stringify(jsonLdData)}
      </script>

      {/* Navigation bar and back button/share utility */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <button
          id="btn-back-to-browse"
          onClick={() => setCurrentView('browse')}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 font-semibold transition"
        >
          <ArrowLeft className="w-4.5 h-4.5" />
          <span>Back to Classifieds</span>
        </button>
      </div>

      {/* Main product view grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 text-left">
        {/* Left column: Visual display images & videos (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div 
            onClick={() => setLightboxIndex(activeMediaIdx)}
            className="group/media relative aspect-[4/3] w-full bg-slate-950 rounded-3xl overflow-hidden border border-slate-100 flex items-center justify-center shadow-md cursor-zoom-in"
            style={{ aspectRatio: '4/3' }}
          >
            {mediaGallery[activeMediaIdx]?.type === 'video' ? (
              <video
                src={mediaGallery[activeMediaIdx].url}
                className="max-w-full max-h-full object-contain w-full h-full"
                controls
                autoPlay
                muted
              />
            ) : (
              <img
                src={mediaGallery[activeMediaIdx]?.url || 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=800&q=80'}
                alt={product.title}
                referrerPolicy="no-referrer"
                loading="lazy"
                className="max-w-full max-h-full object-contain transition duration-500 group-hover/media:scale-[1.03]"
                onError={(e) => {
                  e.currentTarget.src = 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=800&q=80';
                }}
              />
            )}
            
            {/* Hover overlay prompts */}
            <div className="absolute inset-0 bg-black/25 opacity-0 group-hover/media:opacity-100 transition duration-300 flex items-center justify-center z-10 pointer-events-none">
              <span className="bg-slate-900/85 backdrop-blur-xs text-white text-[11px] font-black tracking-wider px-3.5 py-2 rounded-xl flex items-center gap-1.5 border border-slate-800">
                <Maximize2 className="w-4 h-4 text-slate-350" />
                <span>EXPAND VIEW</span>
              </span>
            </div>

            {/* Top-right zoom trigger button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(activeMediaIdx);
              }}
              className="absolute top-4 right-4 bg-slate-900/80 hover:bg-slate-900 backdrop-blur-xs text-white p-2 rounded-full border border-slate-800 transition z-20 cursor-pointer flex items-center justify-center"
              title="Expand with image lightbox"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            
            {/* Overlay indicators */}
            <span className="absolute top-4 left-4 bg-slate-900/80 backdrop-blur-xs text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider z-10">
              {product.category}
            </span>
            <span className="absolute bottom-4 right-4 bg-slate-900/80 backdrop-blur-xs text-slate-100 text-xs px-3 py-1 rounded-full font-mono z-10">
              {mediaGallery[activeMediaIdx]?.type === 'video' ? 'Video' : 'Image'} {activeMediaIdx + 1} of {mediaGallery.length}
            </span>
          </div>

          {/* Thumbnails list */}
          {mediaGallery.length > 1 && (
            <div className="grid grid-cols-5 gap-3">
              {mediaGallery.map((med, i) => (
                <button
                  key={i}
                  id={`media-thumb-${i}`}
                  onClick={() => setActiveMediaIdx(i)}
                  className={`aspect-square rounded-xl overflow-hidden bg-slate-100 border-2 transition-all relative ${
                    i === activeMediaIdx
                      ? 'border-slate-800 scale-95 shadow-sm'
                      : 'border-transparent hover:border-slate-350 hover:scale-98'
                  }`}
                >
                  {med.type === 'video' ? (
                    <>
                      <video src={med.url} className="w-full h-full object-cover pointer-events-none" />
                      <div className="absolute inset-0 bg-slate-950/40 flex items-center justify-center">
                        <div className="w-6 h-6 rounded-full bg-white/80 flex items-center justify-center text-slate-900 shadow-xs">
                          <svg className="w-3.5 h-3.5 fill-current ml-0.5" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                          </svg>
                        </div>
                      </div>
                    </>
                  ) : (
                    <img src={med.url} alt="Thumbnail preview" referrerPolicy="no-referrer" loading="lazy" className="w-full h-full object-cover" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right column: Purchase callouts and details (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-xs space-y-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-3xl font-black text-slate-950 font-sans tracking-tight">
                  {formattedPrice}
                </span>
                {product.isSold && (
                  <span className="bg-rose-600 border border-rose-500 text-white font-black text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-lg shadow-sm animate-pulse flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping"></span>
                    <span>Sold Product</span>
                  </span>
                )}
                <span id="detail-price-negotiable-label" className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                  product.negotiable !== false
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-250/50'
                    : 'bg-slate-100 text-slate-650 border border-slate-200'
                }`}>
                  {product.negotiable !== false ? 'Negotiable' : 'Fixed Price'}
                </span>
              </div>
              <h1 id="detail-product-title" className="text-xl font-bold font-sans text-slate-900 leading-snug">
                {product.title}
              </h1>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500 font-sans border-y border-slate-100 py-3">
              <span className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-slate-400" />
                {product.location}
              </span>
              {(currentUser?.isAdmin || currentUser?.id === product.sellerId) && (
                <>
                  <span className="flex items-center gap-1.5">
                    <Eye className="w-4 h-4 text-slate-400" />
                    {product.viewsCount} total visitors
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-slate-400" />
                    {dateFormatted}
                  </span>
                </>
              )}
            </div>

            {/* Brand, Condition, and Negotiability specifications module */}
            <div className="grid grid-cols-3 gap-2 bg-slate-50 border border-slate-150 rounded-2xl p-3 font-sans">
              <div>
                <span className="block text-[10px] text-slate-400 uppercase font-bold tracking-wider">Brand / Make</span>
                <span id="detail-brand-badge" className="text-xs font-extrabold text-slate-800 truncate block mt-0.5">
                  {product.brand || 'Generic / Other'}
                </span>
              </div>
              <div className="border-l border-slate-200 pl-2.5">
                <span className="block text-[10px] text-slate-400 uppercase font-bold tracking-wider">Condition</span>
                <span id="detail-condition-badge" className="text-xs font-extrabold text-slate-905 block mt-0.5">
                  {product.condition || 'Not Specified'}
                </span>
              </div>
              <div className="border-l border-slate-200 pl-2.5">
                <span className="block text-[10px] text-slate-400 uppercase font-bold tracking-wider">Negotiable</span>
                <span id="detail-negotiable-badge" className={`text-xs font-extrabold block mt-0.5 ${
                  product.negotiable !== false ? 'text-emerald-600' : 'text-slate-600'
                }`}>
                  {product.negotiable !== false ? 'Yes' : 'No'}
                </span>
              </div>
            </div>

            {/* Messaging / Call buttons */}
            <div className="space-y-3">
              {currentUser?.isAdmin && (
                <div className="bg-rose-50 border-2 border-rose-200/80 p-5 rounded-3xl text-xs space-y-3 text-left">
                  <div className="flex items-center gap-1.5 text-rose-800 font-extrabold uppercase tracking-wider">
                    <ShieldAlert className="w-4.5 h-4.5" />
                    <span>Admin Moderator Controls</span>
                  </div>
                  <p className="text-slate-600 font-sans leading-relaxed">
                    You have administrative access to this post as <strong className="text-slate-900 font-bold">{currentUser.email}</strong>. You can edit the parameters of this listing, permanently delete it, or toggle its sold status below.
                  </p>
                  
                  <div className="flex items-center justify-between py-2 px-3 bg-white rounded-2xl border border-rose-200/60 shadow-3xs">
                    <span className="font-bold text-slate-700">Item Status:</span>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none font-bold text-xs text-rose-600 hover:text-rose-700">
                      <input
                        type="checkbox"
                        checked={!!product.isSold}
                        onChange={async (e) => {
                          try {
                            await updateProduct(product.id, { isSold: e.target.checked });
                          } catch (err) {
                            console.error("Failed to update product isSold flag", err);
                          }
                        }}
                        className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 border-slate-350 cursor-pointer"
                      />
                      <span>Mark as Sold</span>
                    </label>
                  </div>

                  <div className="flex gap-2.5">
                    <button
                      onClick={() => setShowEditModal(true)}
                      className="flex-1 py-2.5 bg-slate-905 hover:bg-slate-800 text-white font-black rounded-xl flex items-center justify-center gap-1.5 transition select-none cursor-pointer text-[11px]"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Edit Ad Details</span>
                    </button>
                    <button
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteCheckboxConfirmed(false);
                        setShowDeleteConfirm(true);
                      }}
                      className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-xl flex items-center justify-center gap-1.5 transition select-none cursor-pointer text-[11px]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Listing</span>
                    </button>
                  </div>
                </div>
              )}

              {isOwner ? (
                <div className="bg-slate-50 text-slate-800 p-4 rounded-3xl border border-slate-200 text-xs text-left space-y-3.5">
                  <div className="space-y-1">
                    <p className="font-semibold text-slate-800">👋 You posted this product listing!</p>
                    <p className="text-[11px] text-slate-500">You can customize details, delete the ad, or toggle its availability status status below.</p>
                  </div>
                  
                  <div className="flex items-center justify-between py-2 px-3 bg-white rounded-2xl border border-slate-200/60 shadow-3xs">
                    <span className="font-bold text-slate-700">Item Status:</span>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none font-bold text-xs text-rose-600 hover:text-rose-700">
                      <input
                        type="checkbox"
                        checked={!!product.isSold}
                        onChange={async (e) => {
                          try {
                            await updateProduct(product.id, { isSold: e.target.checked });
                          } catch (err) {
                            console.error("Failed to update product isSold flag", err);
                          }
                        }}
                        className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 border-slate-350 cursor-pointer"
                      />
                      <span>Mark as Sold</span>
                    </label>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowEditModal(true)}
                      className="flex-1 py-2.5 bg-slate-905 hover:bg-slate-800 text-white font-extrabold rounded-xl flex items-center justify-center gap-1.5 transition select-none cursor-pointer text-[11px]"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Edit Ad Details</span>
                    </button>
                    <button
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteCheckboxConfirmed(false);
                        setShowDeleteConfirm(true);
                      }}
                      className="flex-1 py-2.5 bg-rose-50 hover:bg-rose-100/80 text-rose-600 border border-rose-200/65 font-extrabold rounded-xl flex items-center justify-center gap-1.5 transition select-none cursor-pointer text-[11px]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Listing</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
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
                      title={isSaved ? "Remove from Saved" : "Save to Saved"}
                    >
                      <Bookmark className="w-5 h-5" fill={isSaved ? "currentColor" : "none"} />
                    </button>
                  </div>

                  {sellerUser?.whatsAppNumber && (
                    <button
                      id="btn-message-whatsapp"
                      onClick={handleMessageWhatsApp}
                      className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl flex items-center justify-center gap-2 text-sm shadow-xs hover:shadow-md transition duration-200 cursor-pointer"
                    >
                      <MessageSquare className="w-5 h-5 fill-white/20 stroke-[2.2]" />
                      <span>Message seller on whatsapp</span>
                    </button>
                  )}
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
              {product.sellerPhoto && !product.sellerPhoto.includes('1549399542-7e3f8b79c341') ? (
                <img
                  src={product.sellerPhoto}
                  alt={product.sellerName}
                  loading="lazy"
                  className="w-12 h-12 rounded-full border border-slate-100 object-cover shrink-0 cursor-pointer hover:ring-2 hover:ring-slate-350 transition-all"
                  title="Click to view profile picture"
                  onClick={() => setViewedPhoto({ url: product.sellerPhoto!, name: `${product.sellerName}'s Profile Picture` })}
                />
              ) : (
                <img
                  src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='%23f1f5f9'/><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%2394a3b8'/></svg>"
                  alt={product.sellerName}
                  loading="lazy"
                  className="w-12 h-12 rounded-full border border-slate-200/80 object-cover shrink-0"
                />
              )}
              <div className="flex-1 text-left min-w-0">
                <h4 id="detail-seller-name" className="text-sm font-bold text-slate-900 flex items-center gap-1.5 min-w-0 flex-wrap">
                  <span className="truncate">{product.sellerName}</span>
                  {isSellerVerified && (
                    <span className="inline-flex items-center gap-0.5 text-[9px] text-indigo-700 font-extrabold bg-indigo-50 border border-indigo-150/40 px-1.5 py-0.5 rounded-md shrink-0" title="Verified Tedbuy Seller">
                      🛡️ Verified Seller
                    </span>
                  )}
                </h4>
                <p className="text-[11px] text-slate-450">
                  Joined Tedbuy: {product.sellerJoinDate}
                </p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${trustResult.color.includes('emerald') ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' : trustResult.color.includes('indigo') ? 'bg-indigo-50/80 text-indigo-750 border-indigo-200/50' : trustResult.color.includes('amber') ? 'bg-amber-50 text-amber-700 border-amber-200/30' : 'bg-slate-100 text-slate-600 border-slate-200'}`} title={trustResult.feedback}>
                    🛡️ Trust Score: <b>{trustResult.score}%</b>
                  </span>
                </div>
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

      {/* Profile Picture Full-screen Lightbox Modal */}
      {viewedPhoto && (
        <div 
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[9999] flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setViewedPhoto(null)}
        >
          <div 
            className="relative max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden p-6 shadow-2xl flex flex-col items-center gap-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header info */}
            <div className="flex items-center justify-between w-full border-b border-slate-800 pb-3">
              <span className="text-sm font-bold text-slate-200 tracking-tight">{viewedPhoto.name}</span>
              <button 
                onClick={() => setViewedPhoto(null)}
                className="p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Photo frame */}
            <div className="w-64 h-64 sm:w-80 sm:h-80 rounded-2xl bg-slate-950 border border-slate-800/80 overflow-hidden flex items-center justify-center shadow-inner">
              <img 
                src={viewedPhoto.url} 
                alt={viewedPhoto.name} 
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>

            {/* Footer action buttons */}
            <div className="flex gap-3 w-full mt-2">
              <button
                onClick={() => setViewedPhoto(null)}
                className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition border border-slate-750"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product Images & Media Full-screen Lightbox Modal */}
      {lightboxIndex !== null && (
        <div 
          className="fixed inset-0 bg-slate-950/95 backdrop-blur-md z-[9999] flex flex-col items-center justify-between p-4 md:p-6 font-sans select-none animate-fade-in"
          onClick={() => setLightboxIndex(null)}
        >
          {/* Header strip */}
          <div className="w-full max-w-5xl flex items-center justify-between pb-3 border-b border-white/10 z-10 shrink-0">
            <div className="flex flex-col text-left">
              <span className="text-xs font-black text-white tracking-wider uppercase">
                {product.title}
              </span>
              <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                {mediaGallery[lightboxIndex]?.type === 'video' ? 'VIDEO PREVIEW' : 'IMAGE SPECIFICATION'} — {lightboxIndex + 1} of {mediaGallery.length}
              </span>
            </div>
            <button
              onClick={() => setLightboxIndex(null)}
              className="p-2 rounded-full bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white transition duration-200 cursor-pointer flex items-center justify-center border border-white/5"
              title="Close Fullscreen View"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Primary View Area */}
          <div className="flex-1 w-full max-w-5xl flex items-center justify-between relative my-4 min-h-0">
            {/* Left navigation arrow button */}
            {mediaGallery.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : mediaGallery.length - 1));
                }}
                className="absolute left-2 md:left-4 bg-slate-900/80 hover:bg-slate-900 border border-white/10 text-white p-3 rounded-full hover:scale-105 active:scale-95 transition cursor-pointer z-35 flex items-center justify-center shadow-2xl backdrop-blur-xs"
                title="Previous Media"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}

            {/* Central Media container */}
            <div 
              className="w-full h-full flex items-center justify-center bg-transparent max-h-[75vh]"
              onClick={(e) => e.stopPropagation()}
            >
              {mediaGallery[lightboxIndex]?.type === 'video' ? (
                <video
                  src={mediaGallery[lightboxIndex].url}
                  className="max-w-full max-h-[70vh] object-contain rounded-2xl border border-white/5 shadow-2xl"
                  controls
                  autoPlay
                  muted
                />
              ) : (
                <img
                  src={mediaGallery[lightboxIndex]?.url}
                  alt={product.title}
                  referrerPolicy="no-referrer"
                  className="max-w-full max-h-[70vh] object-contain rounded-2xl border border-white/10 shadow-2xl animate-scale-up"
                />
              )}
            </div>

            {/* Right navigation arrow button */}
            {mediaGallery.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((prev) => (prev !== null && prev < mediaGallery.length - 1 ? prev + 1 : 0));
                }}
                className="absolute right-2 md:right-4 bg-slate-900/80 hover:bg-slate-900 border border-white/10 text-white p-3 rounded-full hover:scale-105 active:scale-95 transition cursor-pointer z-35 flex items-center justify-center shadow-2xl backdrop-blur-xs"
                title="Next Media"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Quick-jump Thumbnail dots/strip */}
          {mediaGallery.length > 1 && (
            <div 
              className="w-full max-w-3xl flex items-center justify-center gap-1.5 px-4 py-2 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xs overflow-x-auto select-none mt-2 shrink-0 z-10 scrollbar-none"
              onClick={(e) => e.stopPropagation()}
            >
              {mediaGallery.map((med, i) => (
                <button
                  key={i}
                  onClick={() => setLightboxIndex(i)}
                  className={`relative w-10 h-10 rounded-lg overflow-hidden border transition duration-200 shrink-0 ${
                    i === lightboxIndex
                      ? 'border-white scale-105 ring-2 ring-white/10 shadow-lg'
                      : 'border-white/10 opacity-60 hover:opacity-100 hover:border-white/30'
                  }`}
                >
                  {med.type === 'video' ? (
                    <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center text-white text-[8px] font-black tracking-tighter">
                      VIDEO
                    </div>
                  ) : (
                    <img 
                      src={med.url} 
                      alt="" 
                      referrerPolicy="no-referrer" 
                      className="w-full h-full object-cover" 
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Admin Edit Listing Modal */}
      {showEditModal && (
        <ListingModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          productToEdit={product}
        />
      )}

      {/* Admin Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" onClick={() => !isDeleting && setShowDeleteConfirm(false)}>
          <div className="bg-white rounded-3xl p-6 shadow-2xl max-w-sm w-full border border-slate-150 relative animate-scale-up text-left" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight flex items-center gap-1.5 text-rose-750">
              <ShieldAlert className="w-4.5 h-4.5 text-rose-600 animate-pulse" />
              <span>Confirm Deletion</span>
            </h3>
            <p className="text-xs text-slate-500 font-sans leading-relaxed mt-3">
              Are you sure you want to permanently delete <strong className="text-slate-800">"{product.title}"</strong> from the Tedbuy classifieds marketplace? This action is irreversible.
            </p>

            <div className="bg-rose-50/50 rounded-2xl border border-rose-100 p-3 mt-4">
              <label className="flex items-start gap-2.5 cursor-pointer text-slate-700 select-none">
                <input
                  type="checkbox"
                  checked={deleteCheckboxConfirmed}
                  onChange={(e) => setDeleteCheckboxConfirmed(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded text-rose-600 focus:ring-rose-500 border-slate-350 cursor-pointer shrink-0"
                />
                <span className="text-[11px] leading-snug font-medium">
                  Yes, I want to permanently delete this listing. I understand this action cannot be undone.
                </span>
              </label>
            </div>

            {deleteError && (
              <div className="mt-3.5 p-3 bg-rose-50 border border-rose-200/50 text-rose-600 rounded-2xl text-[11px] font-mono leading-normal select-text break-all">
                {deleteError}
              </div>
            )}

            <div className="flex gap-2.5 mt-5">
              <button
                disabled={isDeleting}
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                disabled={isDeleting || !deleteCheckboxConfirmed}
                onClick={async () => {
                  if (!deleteCheckboxConfirmed) return;
                  await handleDeleteAd();
                }}
                className={`flex-1 py-2.5 font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5 disabled:opacity-50 ${
                  deleteCheckboxConfirmed 
                    ? 'bg-rose-600 hover:bg-rose-700 text-white cursor-pointer shadow-xs' 
                    : 'bg-rose-50 text-rose-400 cursor-not-allowed border border-rose-105/50'
                }`}
              >
                {isDeleting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <span>Yes, Delete Ad</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
