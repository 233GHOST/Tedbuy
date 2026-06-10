import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { ArrowLeft, MessageSquare, MapPin, Eye, Calendar, UserPlus, UserCheck, ChevronRight, Share2, ShieldAlert, Bookmark, TrendingUp, TrendingDown, Copy, Check, X, Camera } from 'lucide-react';
import { ProductCard } from './ProductCard';
import { isUserVerified, calculateTrustScore } from '../types';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';

// Helper hash function to generate consistent stable seeds based on productId
const getSeedFromString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
};

// Seeded random number generator
const seededRandom = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
};

// Generates a deterministic price history for last 30 days
const generatePriceHistory = (productId: string, currentPrice: number) => {
  const seed = getSeedFromString(productId);
  const rand = seededRandom(seed);
  
  const history: { date: string; price: number }[] = [];
  let priceTracker = currentPrice;
  const today = new Date();
  
  for (let i = 0; i < 30; i++) {
    const historicalDate = new Date(today);
    historicalDate.setDate(today.getDate() - i);
    
    const formattedDate = historicalDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
    
    if (i === 0) {
      history.push({ date: formattedDate, price: currentPrice });
    } else {
      // Small random walk backwards in time
      const change = (rand() - 0.49) * 0.025; // Slight bias to simulate general drop/rise
      priceTracker = priceTracker * (1 - change);
      priceTracker = Math.max(1, Math.round(priceTracker));
      history.unshift({ date: formattedDate, price: priceTracker });
    }
  }
  return history;
};

interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const formattedVal = new Intl.NumberFormat('en-GH', {
      style: 'currency',
      currency: 'GHS',
      maximumFractionDigits: 0
    }).format(payload[0].value);
    
    return (
      <div className="bg-slate-900 border border-slate-700 p-2 rounded-xl text-xs font-sans text-white shadow-lg">
        <p className="font-semibold">{label}</p>
        <p className="font-mono text-emerald-400 mt-0.5">{formattedVal}</p>
      </div>
    );
  }
  return null;
};

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
    setAuthMode
  } = useApp();

  const product = products.find(p => p.id === selectedProductId);
  const sellerUser = users?.find(u => u.id === product?.sellerId);
  const isSellerVerified = isUserVerified(sellerUser);
  const sellerReviews = reviews.filter(r => r.sellerId === product?.sellerId);
  const trustResult = calculateTrustScore(sellerUser, sellerReviews);
  const [viewedPhoto, setViewedPhoto] = useState<{ url: string; name: string } | null>(null);
  const [activeMediaIdx, setActiveMediaIdx] = useState(0);
  const mediaGallery = product ? [
    ...product.images.map(url => ({ type: 'image' as const, url })),
    ...(product.videos || []).map(url => ({ type: 'video' as const, url }))
  ] : [];
  const [isCopied, setIsCopied] = useState(false);
  const [showTikTokToast, setShowTikTokToast] = useState(false);

  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}?productId=${product?.id || ''}`
    : `https://ghanamarketplace.com/?productId=${product?.id || ''}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: product?.title || 'Check out this product',
          text: `${product?.title || 'Check out this item'} - Price: ${product?.price ? 'GHS ' + product?.price : 'Negotiable'}. Inspect product image: ${product?.images?.[0] || ''}`,
          url: shareUrl,
        });
      } catch (err) {
        console.warn('Native share failed or cancelled:', err);
      }
    } else {
      handleCopyLink();
    }
  };

  const handleTikTokShareAlert = async () => {
    await handleCopyLink();
    setShowTikTokToast(true);
    setTimeout(() => setShowTikTokToast(false), 5000);
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    setActiveMediaIdx(0);
  }, [selectedProductId]);

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
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    const chatId = startChat(product.id, "Hi, is this still available?");
    setCurrentView('chats');
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

  const numericPrice = extractNumericPrice(product.price);
  const hasPriceTrend = numericPrice !== null;
  const priceHistory = generatePriceHistory(product.id, numericPrice || 1000);
  const startPrice = priceHistory[0].price;
  const currentPrice = numericPrice || 1000;
  const lowestPrice = Math.min(...priceHistory.map(h => h.price));
  const highestPrice = Math.max(...priceHistory.map(h => h.price));

  const priceDiff = currentPrice - startPrice;
  const pctDiff = ((currentPrice - startPrice) / startPrice) * 100;
  const formattedPct = `${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(1)}%`;

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
        {/* Left column: Visual display images & videos (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="relative aspect-4/3 w-full bg-slate-950 rounded-3xl overflow-hidden border border-slate-100 flex items-center justify-center shadow-md">
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
                className="max-w-full max-h-full object-contain"
              />
            )}
            
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
                    <img src={med.url} alt="Thumbnail preview" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
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
              <span className="flex items-center gap-1.5">
                <Eye className="w-4 h-4 text-slate-400" />
                {product.viewsCount} total visitors
              </span>
              <span className="flex items-center gap-1.5 flex-1 min-w-[120px]">
                <Calendar className="w-4 h-4 text-slate-400" />
                {dateFormatted}
              </span>
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

            {/* Share listing section */}
            <div className="border-t border-slate-100 pt-5 mt-2 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 font-sans tracking-tight uppercase flex items-center gap-1.5">
                  <Share2 className="w-4 h-4 text-indigo-500 stroke-[2.2]" />
                  <span>Share Listing</span>
                </span>
                {typeof navigator !== 'undefined' && navigator.share && (
                  <button
                    onClick={handleNativeShare}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition flex items-center gap-1"
                  >
                    🚀 Native Share
                  </button>
                )}
              </div>

              {/* Direct share URL visual widget */}
              <div className="flex gap-2">
                <div className="flex-1 bg-slate-50 border border-slate-200 text-slate-600 px-3 py-2 rounded-xl text-xs font-mono select-all truncate flex items-center justify-between">
                  <span className="truncate mr-2">{shareUrl}</span>
                </div>
                <button
                  onClick={handleCopyLink}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold transition duration-200 flex items-center gap-1.5 shrink-0 ${
                    isCopied
                      ? 'bg-emerald-50 border-emerald-250 text-emerald-600 border-emerald-300'
                      : 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800'
                  }`}
                  title="Copy Listing Link"
                >
                  {isCopied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  <span>{isCopied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>

              {/* Social platform share badges */}
              <div className="flex flex-wrap gap-2 pt-1">
                {/* WhatsApp */}
                <a
                  href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`Check out "${product.title}" on Tedbuy Ghana classifieds! Price: ${product.price ? 'GHS ' + product.price : 'Negotiable'}. Deal picture: ${product.images?.[0] || ''} - View full details directly inside the app: ` + shareUrl)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 px-3 rounded-xl bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 transition flex items-center justify-center gap-1.5 text-xs font-semibold flex-1 min-w-[100px]"
                >
                  <span className="text-emerald-600 font-black">WA</span>
                  <span>WhatsApp</span>
                </a>

                {/* Facebook */}
                <a
                  href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 px-3 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition flex items-center justify-center gap-1.5 text-xs font-semibold flex-1 min-w-[100px]"
                >
                  <span className="text-blue-600 font-black">FB</span>
                  <span>Facebook</span>
                </a>

                {/* Telegram */}
                <a
                  href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(`Check out "${product.title}" on Tedbuy Ghana! Price: ${product.price ? 'GHS ' + product.price : 'Negotiable'}. Deal photo: ` + (product.images?.[0] || ''))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 px-3 rounded-xl bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200 transition flex items-center justify-center gap-1.5 text-xs font-semibold flex-1 min-w-[100px]"
                >
                  <span className="text-sky-500 font-black">TG</span>
                  <span>Telegram</span>
                </a>

                {/* Twitter / X */}
                <a
                  href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(`Check out "${product.title}" on Tedbuy Ghana! Price: ${product.price ? 'GHS ' + product.price : 'Negotiable'}. Deal photo: ` + (product.images?.[0] || ''))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 px-3 rounded-xl bg-slate-50 text-slate-800 hover:bg-slate-100 border border-slate-200 transition flex items-center justify-center gap-1.5 text-xs font-semibold flex-1 min-w-[100px]"
                >
                  <span className="font-black">X</span>
                  <span>Twitter / X</span>
                </a>

                {/* TikTok info button */}
                <button
                  onClick={handleTikTokShareAlert}
                  className="p-2 px-3 rounded-xl bg-pink-50 text-pink-700 hover:bg-pink-100 border border-pink-200 transition flex items-center justify-center gap-1.5 text-xs font-semibold flex-1 min-w-[100px]"
                >
                  <span className="text-pink-600 font-black">TT</span>
                  <span>TikTok</span>
                </button>
              </div>

              {/* TikTok informative tooltip/toast if triggered */}
              {showTikTokToast && (
                <div className="bg-slate-900 text-white p-3 rounded-xl text-xs flex flex-col gap-1">
                  <div className="font-semibold flex items-center gap-1 text-[11px] text-pink-400">
                    <span>🎵 TikTok Bio & Caption Link</span>
                  </div>
                  <p className="text-slate-300 leading-relaxed text-[11px]">
                    Listing URL copied successfully! Paste this link into your TikTok profile bio or video captions to capture buyer interest instantly!
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* 30-Day Price Trend Analysis */}
          {hasPriceTrend && (
            <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-xs space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 font-sans tracking-tight">30-Day Price Trend</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">Price fluctuation trajectory over the past 30 days</p>
                </div>
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 font-mono border ${
                  pctDiff >= 0 
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-150' 
                    : 'bg-rose-50 text-rose-750 border-rose-150'
                }`}>
                  {pctDiff >= 0 ? <TrendingUp className="w-3.5 h-3.5 text-emerald-600" /> : <TrendingDown className="w-3.5 h-3.5 text-rose-600" />}
                  <span>{formattedPct}</span>
                </span>
              </div>

              <div className="h-36 w-full font-sans">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={priceHistory}
                    margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={pctDiff >= 0 ? "#10b981" : "#f43f5e"} stopOpacity={0.15}/>
                        <stop offset="95%" stopColor={pctDiff >= 0 ? "#10b981" : "#f43f5e"} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="date" 
                      tickLine={false} 
                      axisLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 9 }}
                      ticks={[priceHistory[0].date, priceHistory[14].date, priceHistory[29].date]}
                    />
                    <YAxis 
                      tickLine={false} 
                      axisLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 9 }}
                      domain={['auto', 'auto']}
                      tickFormatter={(v) => `GH₵${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v}`}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area 
                      type="monotone" 
                      dataKey="price" 
                      stroke={pctDiff >= 0 ? "#10b981" : "#f43f5e"} 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorPrice)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-center font-sans">
                <div>
                  <span className="block text-[10px] text-slate-400 font-medium">30d Ago</span>
                  <span className="text-xs font-bold text-slate-700 font-mono mt-0.5 select-none block">
                    {new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 0 }).format(startPrice)}
                  </span>
                </div>
                <div className="border-x border-slate-100 font-sans">
                  <span className="block text-[10px] text-slate-400 font-medium">30d Lowest</span>
                  <span className="text-xs font-bold text-slate-750 font-mono mt-0.5 select-none block">
                    {new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 0 }).format(lowestPrice)}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] text-slate-400 font-medium font-sans">30d Highest</span>
                  <span className="text-xs font-bold text-slate-750 font-mono mt-0.5 select-none block">
                    {new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 0 }).format(highestPrice)}
                  </span>
                </div>
              </div>
            </div>
          )}

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
              {product.sellerPhoto ? (
                <img
                  src={product.sellerPhoto}
                  alt={product.sellerName}
                  className="w-12 h-12 rounded-full border border-slate-100 object-cover shrink-0 cursor-pointer hover:ring-2 hover:ring-slate-350 transition-all"
                  title="Click to view profile picture"
                  onClick={() => setViewedPhoto({ url: product.sellerPhoto!, name: `${product.sellerName}'s Profile Picture` })}
                />
              ) : (
                <img
                  src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='%23f1f5f9'/><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%2394a3b8'/></svg>"
                  alt={product.sellerName}
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
    </div>
  );
};
