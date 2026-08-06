import React from 'react';
import { Product, isUserVerified, User, normalizeCategory } from '../types';
import { useApp } from '../context/AppContext';
import { MapPin, Eye, Calendar, Bookmark, Video, Flame, Star, Heart } from 'lucide-react';
import { useIntersectionObserver } from '../utils/useIntersectionObserver';
import { isBoostActive } from '../utils/dateParser';
import { getOptimizedImageUrl } from '../utils/imageOptimizer';
import { resolveProductImage, getCategoryPlaceholder } from '../utils/productUtils';
import { MediaRenderer, isVideoAsset } from './MediaRenderer';

interface ProductCardProps {
  product: Product;
  isFeaturedVariant?: boolean;
}

// 1. Context Consumer / Wrapper (keeps re-renders local, only re-evaluating lightweight mapping)
export const ProductCard: React.FC<ProductCardProps> = ({ product, isFeaturedVariant }) => {
  const {
    currentUser,
    users,
    usersMap,
    toggleSaveProduct,
    setSelectedProductId,
    setCurrentView,
    setShowAuthModal,
    setAuthMode,
    updateProduct
  } = useApp();

  const isSaved = currentUser?.savedProductIds?.includes(product.id) || false;
  
  // O(1) user profile resolution utilizing pre-mapped dictionary or array fallback
  const seller = usersMap ? usersMap.get(product.sellerId) : users?.find(u => u.id === product.sellerId);
  const isSellerVerified = isUserVerified(seller);
  const isPrioSeller = isBoostActive(product) || !!isFeaturedVariant;

  const handleDetailsClick = () => {
    setSelectedProductId(product.id);
    setCurrentView('product-detail');
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
      isAdminOrSeller={isAdminOrSeller}
      onDetailsClick={handleDetailsClick}
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
  isAdminOrSeller: boolean;
  onDetailsClick: () => void;
  onSaveClick: (e: React.MouseEvent) => void;
  onUpdateProduct: (productId: string, data: Partial<Product>) => Promise<any>;
}

const ProductCardInner: React.FC<ProductCardInnerProps> = ({
  product,
  isSaved,
  seller,
  isSellerVerified,
  isPrioSeller,
  isAdminOrSeller,
  onDetailsClick,
  onSaveClick,
  onUpdateProduct
}) => {
  const [cardRef, isVisible] = useIntersectionObserver({ rootMargin: '300px' }); // Increased rootMargin for pre-loading images

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
  const imgRef = React.useRef<HTMLImageElement>(null);

  React.useEffect(() => {
    const nextSrc = resolveProductImage(product, 400);
    setImgSrc(nextSrc);
  }, [product.id, product.displayImage, product.primaryImage, product.images?.[0], (product as any).updatedAt]);

  React.useEffect(() => {
    setVideoError(false);
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

  const getLowResUrl = (url: string): string => {
    if (!url) return '';
    if (url.includes('images.unsplash.com')) {
      let lowRes = url;
      if (lowRes.includes('w=')) {
        lowRes = lowRes.replace(/([?&])w=\d+/g, '$1w=32');
      } else {
        lowRes += (lowRes.includes('?') ? '&' : '?') + 'w=32';
      }
      if (lowRes.includes('q=')) {
        lowRes = lowRes.replace(/([?&])q=\d+/g, '$1q=10');
      } else {
        lowRes += '&q=10';
      }
      return lowRes;
    }
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" fill="%23f1f5f9"/></svg>';
  };

  const formattedPrice = formatProductPrice(product.price);
  const isServiceCategory = normalizeCategory(product.category) === 'Services';
  const dateFormatted = new Date(product.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const [loaded, setLoaded] = React.useState(false);

  console.log(`[ProductCard] product.id: ${product.id} | computed displayImage (imgSrc): ${imgSrc} | product.displayImage: ${product.displayImage}`);

  return (
    <article
      ref={cardRef as any}
      id={`product-card-${product.id}`}
      onClick={onDetailsClick}
      className="relative bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs hover:shadow-md hover:scale-[1.02] hover:border-slate-300 transition-all duration-300 cursor-pointer flex flex-col h-full group animate-fade-in"
    >
      {/* Listing image section */}
      <div className="relative w-full bg-slate-100 overflow-hidden shrink-0 aspect-square flex items-center justify-center" style={{ aspectRatio: '1/1' }}>
        {isVisible ? (
          <>
            {(processedVideoUrl && !videoError) ? (
              <video
                src={processedVideoUrl}
                muted
                loop
                playsInline
                webkit-playsinline="true"
                disablePictureInPicture
                autoPlay
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
                }}
              />
            ) : (
              <img
                ref={imgRef}
                src={imgSrc}
                alt={product.title}
                decoding="async"
                loading="lazy"
                className="w-full h-full object-contain p-0 group-hover:scale-105 transition-all duration-300"
                onError={() => {
                  const fallback = getCategoryPlaceholder(product.category);
                  if (imgSrc !== fallback) {
                    setImgSrc(fallback);
                  }
                }}
              />
            )}
          </>
        ) : (
          <div className="absolute inset-0 bg-slate-50 flex items-center justify-center">
            <div className="w-5 h-5 rounded-full border border-slate-200 border-t-slate-400 animate-spin" />
          </div>
        )}

        <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1.5 z-20">
          {isPrioSeller ? (
            <span className="px-2.5 py-0.5 bg-amber-500 text-slate-950 text-[10px] font-black uppercase tracking-wider rounded-full flex items-center gap-1 shadow-xs">
              <Flame className="w-3 h-3 fill-slate-950 text-slate-950" />
              Active Seller
            </span>
          ) : null}
          {product.isSold && (
            <span className="px-2 py-0.5 bg-rose-600 border border-rose-500 text-white text-[10px] font-extrabold rounded-md uppercase tracking-widest shadow-md animate-pulse">
              SOLD
            </span>
          )}
        </div>

        {product.condition && (
          <div id={`product-card-condition-${product.id}`} className="absolute bottom-2.5 left-2.5 z-20">
            <span className="px-2.5 py-0.5 bg-emerald-500 text-white text-[11px] font-medium rounded-full shadow-2xs">
              {product.condition}
            </span>
          </div>
        )}

        {/* Bookmark/Watchlist floating button */}
        <button
          id={`btn-save-product-${product.id}`}
          onClick={onSaveClick}
          className={`absolute top-2.5 right-2.5 z-25 w-8 h-8 sm:w-9 sm:h-9 rounded-full shadow-md flex items-center justify-center transition-all duration-200 outline-none cursor-pointer ${
            isSaved
              ? 'bg-rose-500 text-white hover:bg-rose-600 scale-105'
              : 'bg-white text-slate-400 hover:text-slate-800 hover:bg-slate-50'
          }`}
          title={isSaved ? "Remove from saved ads" : "Save to saved ads"}
        >
          <Heart className="w-4 h-4" fill={isSaved ? "currentColor" : "none"} />
        </button>
        
        {/* Dynamic bottom status bar on image hover */}
        {isAdminOrSeller && (
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-slate-950/80 to-transparent p-2 text-white flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="text-[10px] flex items-center gap-1 font-sans">
              <Eye className="w-3 h-3 text-slate-100" />
              {product.viewsCount} views
            </span>
            <span className="text-[10px] text-slate-300 flex items-center gap-1 font-sans font-medium">
              <Calendar className="w-3 h-3" />
              {dateFormatted}
            </span>
          </div>
        )}
      </div>

      {/* Detail info section */}
      <div className="p-2.5 sm:p-3 flex flex-col flex-1 justify-between gap-1 sm:gap-1.5 text-left bg-white">
        <div className="space-y-0.5">
          <h3 className="text-xs sm:text-sm font-bold line-clamp-2 leading-snug transition truncate-hover text-slate-800 group-hover:text-slate-950">
            {product.title}
          </h3>

          {!isServiceCategory && (
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              <span className="text-sm sm:text-base font-extrabold text-slate-950 block leading-none font-sans tracking-tight">
                {formattedPrice}
              </span>
              {product.negotiable !== false && (
                <span id={`product-card-negotiable-${product.id}`} className="inline-flex items-center text-[8px] bg-emerald-50 text-emerald-700 border border-emerald-200/60 font-extrabold px-1.5 py-0.5 rounded-md uppercase tracking-wider font-sans shrink-0">
                  Negotiable
                </span>
              )}
            </div>
          )}
          {product.brand && (
            <span id={`product-card-brand-${product.id}`} className="inline-block text-[9px] bg-slate-100 text-slate-600 font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider font-sans mb-1">
              {product.brand}
            </span>
          )}
        </div>

        {product.location && (
          <div className="flex flex-col gap-1 text-[11px] text-slate-400 font-sans mt-1">
            <div className="flex items-center gap-1 text-slate-400 max-w-full truncate">
              <MapPin className="w-3 h-3 text-slate-300 shrink-0" />
              <span className="truncate">{product.location}</span>
            </div>
          </div>
        )}

        {isAdminOrSeller && (
          <div className="pt-2.5 border-t border-dashed border-slate-200 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Status Toggle</span>
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs font-bold text-rose-600 hover:text-rose-700">
              <input
                type="checkbox"
                checked={!!product.isSold}
                onChange={async (e) => {
                  try {
                    await onUpdateProduct(product.id, { isSold: e.target.checked });
                  } catch (err) {
                    console.error("Failed to update product isSold state", err);
                  }
                }}
                className="w-3.5 h-3.5 rounded text-rose-600 focus:ring-rose-500 border-slate-350 cursor-pointer"
              />
              <span>Mark as Sold</span>
            </label>
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
    (prevProps.product as any).image === (nextProps.product as any).image &&
    prevProps.product.videos?.[0] === nextProps.product.videos?.[0] &&
    (prevProps.product as any).updatedAt === (nextProps.product as any).updatedAt &&
    prevProps.isSaved === nextProps.isSaved &&
    prevProps.isSellerVerified === nextProps.isSellerVerified &&
    prevProps.isPrioSeller === nextProps.isPrioSeller &&
    prevProps.isAdminOrSeller === nextProps.isAdminOrSeller &&
    prevProps.seller?.id === nextProps.seller?.id &&
    prevProps.seller?.isOnline === nextProps.seller?.isOnline &&
    prevProps.seller?.visitCount === nextProps.seller?.visitCount
  );
});
