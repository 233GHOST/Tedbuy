import React from 'react';
import { Product, isUserVerified, User, normalizeCategory } from '../types';
import { useApp } from '../context/AppContext';
import { MapPin, Bookmark, Flame, Star, Heart, TrendingUp, Check, Play, Pause } from 'lucide-react';
import { useIntersectionObserver } from '../utils/useIntersectionObserver';
import { isBoostActive } from '../utils/dateParser';
import { getOptimizedImageUrl } from '../utils/imageOptimizer';
import { resolveProductImage, getCategoryPlaceholder } from '../utils/productUtils';
import { MediaRenderer, isVideoAsset } from './MediaRenderer';

interface ProductCardProps {
  product: Product;
  isFeaturedVariant?: boolean;
  isTrendingVariant?: boolean;
  priority?: boolean;
}

// 1. Context Consumer / Wrapper (keeps re-renders local, only re-evaluating lightweight mapping)
export const ProductCard: React.FC<ProductCardProps> = ({ product, isFeaturedVariant, isTrendingVariant, priority }) => {
  const {
    currentUser,
    users,
    usersMap,
    toggleSaveProduct,
    setSelectedProductId,
    setSelectedSellerId,
    setCurrentView,
    setShowAuthModal,
    setAuthMode,
    updateProduct,
    registerProduct
  } = useApp();

  const isSaved = currentUser?.savedProductIds?.includes(product.id) || false;
  
  // O(1) user profile resolution utilizing pre-mapped dictionary or array fallback
  const seller = usersMap ? usersMap.get(product.sellerId) : users?.find(u => u.id === product.sellerId);
  const isSellerVerified = isUserVerified(seller) || Boolean((seller as any)?.isVerified || (seller as any)?.verified || (seller as any)?.idVerified);
  const isPrioSeller = isBoostActive(product) && !isFeaturedVariant && !isTrendingVariant;

  const handleDetailsClick = () => {
    if (product) {
      registerProduct(product);
    }
    setSelectedProductId(product.id);
    setCurrentView('product-detail');
  };

  const handleSellerClick = (sellerId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (sellerId) {
      setSelectedSellerId(sellerId);
      setCurrentView('seller-profile');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSaveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser) {
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    toggleSaveProduct(product.id);
  };

  const isAdminOrSeller = !!(currentUser?.isAdmin || currentUser?.id === product.sellerId);

  return (
    <ProductCardMemo
      key={product.id}
      product={product}
      isSaved={isSaved}
      seller={seller}
      isSellerVerified={isSellerVerified}
      isPrioSeller={isPrioSeller}
      isTrendingVariant={isTrendingVariant}
      isAdminOrSeller={isAdminOrSeller}
      priority={priority}
      onDetailsClick={handleDetailsClick}
      onSellerClick={handleSellerClick}
      onSaveClick={handleSaveClick}
      onUpdateProduct={updateProduct}
    />
  );
};

// 2. Pure Presentation Component
interface ProductCardInnerProps {
  product: Product;
  isSaved: boolean;
  seller: User | undefined;
  isSellerVerified: boolean;
  isPrioSeller: boolean;
  isTrendingVariant?: boolean;
  isAdminOrSeller: boolean;
  priority?: boolean;
  onDetailsClick: () => void;
  onSellerClick: (sellerId: string, e: React.MouseEvent) => void;
  onSaveClick: (e: React.MouseEvent) => void;
  onUpdateProduct: (productId: string, data: Partial<Product>) => Promise<any>;
}

const ProductCardInner: React.FC<ProductCardInnerProps> = ({
  product,
  isSaved,
  seller,
  isSellerVerified,
  isPrioSeller,
  isTrendingVariant,
  isAdminOrSeller,
  priority,
  onDetailsClick,
  onSellerClick,
  onSaveClick,
  onUpdateProduct
}) => {
  const [cardRef, isVisible] = useIntersectionObserver({ rootMargin: '400px', initialIsVisible: priority });

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

  const firstVideo = product.videos?.[0];
  const hasVideoAd = Boolean(firstVideo && isVideoAsset(firstVideo));
  const initialSrc = resolveProductImage(product, 400);

  const [imgSrc, setImgSrc] = React.useState<string>(initialSrc);
  const [processedVideoUrl, setProcessedVideoUrl] = React.useState<string>('');
  const [videoError, setVideoError] = React.useState<boolean>(false);
  const [isPlaying, setIsPlaying] = React.useState<boolean>(false);
  const imgRef = React.useRef<HTMLImageElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    const nextSrc = resolveProductImage(product, 400);
    setImgSrc(nextSrc);
  }, [product.id, product.displayImage, product.thumbnailUrl, product.primaryImage, product.images?.[0], (product as any).updatedAt]);

  React.useEffect(() => {
    if (!isVisible && videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  }, [isVisible]);

  React.useEffect(() => {
    setVideoError(false);
    setIsPlaying(false);
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
    if (!isVisible) {
      setProcessedVideoUrl('');
      return;
    }
    const videoUrl = product.videos?.[0];
    if (!videoUrl) {
      setProcessedVideoUrl('');
      return;
    }

    if (!videoUrl.startsWith('data:')) {
      setProcessedVideoUrl(videoUrl);
      return;
    }

    let activeUrl = '';
    try {
      const parts = videoUrl.split(',');
      if (parts.length >= 2) {
        const header = parts[0];
        const base64Part = parts.slice(1).join(',');
        const mimeMatch = header.match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'video/mp4';

        let normalized = base64Part.trim().replace(/-/g, '+').replace(/_/g, '/');
        normalized = normalized.replace(/[^A-Za-z0-9+/=]/g, '');

        const pad = normalized.length % 4;
        if (pad === 2) normalized += '==';
        else if (pad === 3) normalized += '=';

        const binary = atob(normalized);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: mime });
        activeUrl = URL.createObjectURL(blob);
        setProcessedVideoUrl(activeUrl);
      } else {
        setProcessedVideoUrl(videoUrl);
      }
    } catch (err) {
      console.warn("ProductCard video decode error:", err);
      setProcessedVideoUrl(videoUrl);
    }

    return () => {
      if (activeUrl && activeUrl.startsWith('blob:')) {
        URL.revokeObjectURL(activeUrl);
      }
    };
  }, [product.videos, isVisible]);

  const togglePlayVideo = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch((err) => {
        console.warn("Video preview play error:", err);
      });
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const formattedPrice = formatProductPrice(product.price);
  const isServiceCategory = normalizeCategory(product.category) === 'Services';
  const sellerName = seller?.username || (seller as any)?.displayName || product.sellerName || 'TedBuy Merchant';
  const sellerPhoto = seller?.photoUrl && !String(seller?.photoUrl).includes('1549399542-7e3f8b79c341') ? seller.photoUrl : null;
  const sellerId = seller?.id || product.sellerId;

  return (
    <article
      ref={cardRef as any}
      id={`product-card-${product.id}`}
      onClick={onDetailsClick}
      className="relative bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs hover:shadow-md hover:scale-[1.015] hover:border-slate-300 transition-all duration-300 cursor-pointer flex flex-col h-full group animate-fade-in"
    >
      {/* Listing image / video section */}
      <div className="relative w-full bg-slate-100 overflow-hidden shrink-0 aspect-square flex items-center justify-center" style={{ aspectRatio: '1/1' }}>
        {isVisible ? (
          <>
            {(processedVideoUrl && !videoError) ? (
              <video
                ref={videoRef}
                src={processedVideoUrl}
                poster={imgSrc}
                preload="metadata"
                muted
                loop
                playsInline
                webkit-playsinline="true"
                disablePictureInPicture
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-all duration-500"
                onError={(e) => {
                  const err = e.currentTarget.error;
                  let errMsg = 'Unknown video loading or decoding error';
                  if (err) {
                    switch (err.code) {
                      case 1: errMsg = 'Video loading aborted'; break;
                      case 2: errMsg = 'Network error: Video download failed'; break;
                      case 3: errMsg = 'Decoding error: Corrupted video file or unsupported codec'; break;
                      case 4: errMsg = 'Format error: Video URL not found or format unsupported'; break;
                    }
                    if (err.message) errMsg += ` (${err.message})`;
                  }
                  console.error(`[ProductCard Error] Video failed to load for Product ID: ${product.id}. Title: "${product.title}". Video URL: "${product.videos?.[0]}". Processed URL: "${processedVideoUrl}". Error: ${errMsg}`, err);
                  setVideoError(true);
                  setIsPlaying(false);
                }}
              />
            ) : (
              <img
                ref={imgRef}
                src={imgSrc}
                alt={product.title}
                decoding="async"
                loading="lazy"
                className="w-full h-full object-cover p-0 group-hover:scale-105 transition-all duration-300"
                onError={() => {
                  const fallback = getCategoryPlaceholder(product.category);
                  if (imgSrc !== fallback) {
                    setImgSrc(fallback);
                  }
                }}
              />
            )}

            {/* Non-autoplay Play/Pause trigger button */}
            {(processedVideoUrl && !videoError) && (
              <button
                type="button"
                aria-label={isPlaying ? "Pause video preview" : "Play video preview"}
                onClick={togglePlayVideo}
                className={`absolute inset-0 m-auto w-11 h-11 rounded-full bg-slate-950/75 hover:bg-slate-950/90 text-white flex items-center justify-center backdrop-blur-xs border border-white/20 shadow-lg transition-all duration-200 z-20 cursor-pointer ${
                  isPlaying ? 'opacity-0 group-hover:opacity-100 scale-95 hover:scale-105' : 'opacity-90 hover:opacity-100 hover:scale-110'
                }`}
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5 fill-white text-white" />
                ) : (
                  <Play className="w-5 h-5 fill-white text-white translate-x-0.5" />
                )}
              </button>
            )}
          </>
        ) : (
          <div className="absolute inset-0 bg-slate-50 flex items-center justify-center">
            <div className="w-5 h-5 rounded-full border border-slate-200 border-t-slate-400 animate-spin" />
          </div>
        )}

        {/* Top-Left Badges: Active Seller / Sold */}
        {((isPrioSeller && !isTrendingVariant) || product.isSold) && (
          <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1.5 z-20">
            {isPrioSeller && !isTrendingVariant && (
              <span className="px-2.5 py-0.5 bg-amber-500 text-slate-950 text-[10px] font-black uppercase tracking-wider rounded-full flex items-center gap-1 shadow-xs">
                <Flame className="w-3 h-3 fill-slate-950 text-slate-950" />
                Active Seller
              </span>
            )}
            {product.isSold && (
              <span className="px-2 py-0.5 bg-rose-600 border border-rose-500 text-white text-[10px] font-extrabold rounded-md uppercase tracking-widest shadow-md animate-pulse">
                SOLD
              </span>
            )}
          </div>
        )}

        {/* Top Condition Tag */}
        {product.condition && !isTrendingVariant && (
          <div id={`product-card-condition-${product.id}`} className="absolute top-2.5 left-2.5 z-20">
            {!(isPrioSeller && !isTrendingVariant) && !product.isSold && (
              <span className="px-2.5 py-0.5 bg-slate-900/80 backdrop-blur-xs text-white text-[10px] font-medium rounded-full shadow-2xs">
                {product.condition}
              </span>
            )}
          </div>
        )}

        {/* Bookmark / Watchlist floating button */}
        <button
          id={`btn-save-product-${product.id}`}
          onClick={onSaveClick}
          className={`absolute top-2.5 right-2.5 z-25 w-8 h-8 sm:w-8.5 sm:h-8.5 rounded-full shadow-md flex items-center justify-center transition-all duration-200 outline-none cursor-pointer ${
            isSaved
              ? 'bg-rose-500 text-white hover:bg-rose-600 scale-105'
              : 'bg-white/95 backdrop-blur-xs text-slate-400 hover:text-slate-800 hover:bg-white'
          }`}
          title={isSaved ? "Remove from saved items" : "Save to wishlist"}
        >
          <Heart className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill={isSaved ? "currentColor" : "none"} />
        </button>
      </div>

      {/* Detail info section */}
      <div className="p-2.5 sm:p-3 flex flex-col flex-1 justify-between gap-1.5 text-left bg-white">
        <div className="space-y-1">
          {/* Title */}
          <h3 className="text-xs sm:text-sm font-bold line-clamp-2 leading-snug transition truncate-hover text-slate-800 group-hover:text-slate-950">
            {product.title}
          </h3>

          {/* Price and negotiable tag */}
          {!isServiceCategory && (
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              <span className="text-sm sm:text-base font-black text-slate-950 block leading-none font-sans tracking-tight">
                {formattedPrice}
              </span>
              {product.negotiable !== false && !isTrendingVariant && (
                <span id={`product-card-negotiable-${product.id}`} className="inline-flex items-center text-[8.5px] bg-emerald-50 text-emerald-700 border border-emerald-200/60 font-extrabold px-1.5 py-0.5 rounded-md uppercase tracking-wider font-sans shrink-0">
                  Negotiable
                </span>
              )}
            </div>
          )}

          {product.brand && !isTrendingVariant && (
            <span id={`product-card-brand-${product.id}`} className="inline-block text-[9px] bg-slate-100 text-slate-600 font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider font-sans">
              {product.brand}
            </span>
          )}
        </div>

        {/* Social Touchpoint: Seller Profile Strip & Location */}
        {!isTrendingVariant && (
          <div
            onClick={(e) => onSellerClick(sellerId, e)}
            className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1 text-slate-600 hover:text-slate-900 group/seller transition-colors cursor-pointer"
            title={`Visit ${sellerName}'s storefront`}
          >
            {/* Seller Avatar & Name */}
            <div className="flex items-center gap-1.5 min-w-0">
              {sellerPhoto ? (
                <img
                  src={sellerPhoto}
                  alt={sellerName}
                  className="w-5 h-5 rounded-full object-cover border border-slate-200 shrink-0"
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-slate-900 text-white text-[9.5px] font-black flex items-center justify-center shrink-0">
                  {sellerName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[11px] font-bold text-slate-800 truncate group-hover/seller:text-emerald-700 transition-colors">
                  {sellerName}
                </span>
                {isSellerVerified && (
                  <span
                    className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-slate-900 text-white text-[8px] font-black shrink-0"
                    title="Verified Seller"
                  >
                    ✓
                  </span>
                )}
              </div>
            </div>

            {/* Location */}
            {product.location && (
              <span className="text-[10.5px] text-slate-400 font-medium truncate shrink-0 max-w-[85px] sm:max-w-[110px] flex items-center gap-0.5">
                <MapPin className="w-2.5 h-2.5 shrink-0 text-slate-400" />
                <span className="truncate">{product.location}</span>
              </span>
            )}
          </div>
        )}

        {/* Engagement Signals & Social micro-row */}
        {!isTrendingVariant && Boolean(product.likesCount && product.likesCount > 0) && (
          <div className="flex items-center gap-2 text-[10px] text-slate-400 pt-0.5">
            <span className="inline-flex items-center gap-1 font-semibold text-slate-500">
              <Heart className="w-2.5 h-2.5 text-rose-500 fill-rose-500" />
              <span>{product.likesCount} {product.likesCount === 1 ? 'save' : 'saves'}</span>
            </span>
          </div>
        )}

        {isAdminOrSeller && !isTrendingVariant && (
          <div className="pt-2 border-t border-dashed border-slate-200 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Status</span>
            <button
              type="button"
              onClick={async () => {
                try {
                  await onUpdateProduct(product.id, { isSold: !product.isSold });
                } catch (err) {
                  console.error("Failed to update product isSold state", err);
                }
              }}
              className="flex items-center gap-1.5 cursor-pointer select-none text-xs font-bold text-rose-600 hover:text-rose-700"
            >
              {/* Custom checkbox — a native <input type="checkbox"> here has no
                  appearance override, so some mobile browsers/OS themes (e.g.
                  Samsung Internet's forced dark theme) reskin it into an
                  oversized switch instead of a small checkbox. */}
              <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                product.isSold ? 'bg-rose-600 border-rose-600' : 'bg-white border-slate-350'
              }`}>
                {product.isSold && <Check className="w-2.5 h-2.5 text-white stroke-[3.5]" />}
              </span>
              <span>Mark Sold</span>
            </button>
          </div>
        )}
      </div>
    </article>
  );
};

// 3. React.memo wrapped presentation component to prevent parent/unrelated re-renders
const ProductCardMemo = React.memo(ProductCardInner, (prevProps, nextProps) => {
  return (
    prevProps.product.id === nextProps.product.id &&
    prevProps.product.title === nextProps.product.title &&
    prevProps.product.price === nextProps.product.price &&
    prevProps.product.isSold === nextProps.product.isSold &&
    prevProps.product.likesCount === nextProps.product.likesCount &&
    prevProps.product.viewsCount === nextProps.product.viewsCount &&
    prevProps.product.category === nextProps.product.category &&
    prevProps.product.location === nextProps.product.location &&
    prevProps.product.brand === nextProps.product.brand &&
    prevProps.product.condition === nextProps.product.condition &&
    prevProps.product.images?.[0] === nextProps.product.images?.[0] &&
    prevProps.product.displayImage === nextProps.product.displayImage &&
    prevProps.product.thumbnailUrl === nextProps.product.thumbnailUrl &&
    (prevProps.product as any).image === (nextProps.product as any).image &&
    prevProps.product.videos?.[0] === nextProps.product.videos?.[0] &&
    (prevProps.product as any).updatedAt === (nextProps.product as any).updatedAt &&
    prevProps.priority === nextProps.priority &&
    prevProps.isSaved === nextProps.isSaved &&
    prevProps.isSellerVerified === nextProps.isSellerVerified &&
    prevProps.isPrioSeller === nextProps.isPrioSeller &&
    prevProps.isAdminOrSeller === nextProps.isAdminOrSeller &&
    prevProps.seller?.id === nextProps.seller?.id &&
    prevProps.seller?.username === nextProps.seller?.username &&
    prevProps.seller?.photoUrl === nextProps.seller?.photoUrl &&
    prevProps.seller?.isOnline === nextProps.seller?.isOnline &&
    prevProps.seller?.visitCount === nextProps.seller?.visitCount
  );
});
