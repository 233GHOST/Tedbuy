import React from 'react';
import { Product, isUserVerified } from '../types';
import { useApp } from '../context/AppContext';
import { MapPin, Eye, Calendar, Tag, Bookmark, Video } from 'lucide-react';
import { useIntersectionObserver } from '../utils/useIntersectionObserver';

interface ProductCardProps {
  product: Product;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const {
    currentUser,
    users,
    toggleSaveProduct,
    setSelectedProductId,
    setCurrentView,
    setShowAuthModal,
    setAuthMode,
    updateProduct
  } = useApp();

  const [cardRef, isVisible] = useIntersectionObserver({ rootMargin: '200px' });

  const isSaved = currentUser?.savedProductIds?.includes(product.id) || false;
  const seller = users?.find(u => u.id === product.sellerId);
  const isSellerVerified = isUserVerified(seller);

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

  const getCategoryPlaceholder = (categoryName: string) => {
    const cat = categoryName ? categoryName.toLowerCase() : '';
    if (cat.includes('phone')) return 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=600&q=80';
    if (cat.includes('laptop') || cat.includes('computer')) return 'https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&w=600&q=80';
    if (cat.includes('fashion') || cat.includes('wear') || cat.includes('clothes')) return 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=600&q=80';
    if (cat.includes('vehicle') || cat.includes('car')) return 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=600&q=80';
    if (cat.includes('beauty')) return 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=600&q=80';
    if (cat.includes('game') || cat.includes('toy')) return 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=600&q=80';
    if (cat.includes('appliance') || cat.includes('home')) return 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=600&q=80';
    return 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=600&q=80';
  };

  const initialSrc = product.images?.[0] || getCategoryPlaceholder(product.category);
  const [imgSrc, setImgSrc] = React.useState<string>(initialSrc);
  const [processedVideoUrl, setProcessedVideoUrl] = React.useState<string>('');

  React.useEffect(() => {
    setImgSrc(product.images?.[0] || getCategoryPlaceholder(product.category));
  }, [product.images, product.category]);

  React.useEffect(() => {
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

  const [loaded, setLoaded] = React.useState(false);

  // Format the relative/absolute date
  const dateFormatted = new Date(product.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });

  return (
    <article
      ref={cardRef as any}
      id={`product-card-${product.id}`}
      onClick={handleDetailsClick}
      className="relative bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs hover:shadow-md hover:scale-[1.02] hover:border-slate-300 transition-all duration-300 cursor-pointer flex flex-col h-full group animate-fade-in"
    >
      {/* Listing image section */}
      <div className="relative w-full bg-slate-100 overflow-hidden shrink-0 aspect-[4/3] flex items-center justify-center" style={{ aspectRatio: '4/3' }}>
        {isVisible ? (
          <>
            {processedVideoUrl ? (
              <video
                src={processedVideoUrl}
                muted
                loop
                playsInline
                autoPlay
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-all duration-500"
              />
            ) : (
              <>
                {!loaded && (
                  <img
                    src={getLowResUrl(imgSrc)}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
                    style={{ filter: 'blur(10px)', transform: 'scale(1.1)' }}
                  />
                )}
                {!loaded && (
                  <div className="absolute inset-0 bg-slate-100/10 backdrop-blur-[1px] flex items-center justify-center z-10 animate-fade-in">
                    <div className="w-5 h-5 rounded-full border border-slate-300/40 border-t-slate-600 animate-spin" />
                  </div>
                )}
                <img
                  src={imgSrc}
                  alt={product.title}
                  decoding="async"
                  loading="lazy"
                  onLoad={() => setLoaded(true)}
                  className={`absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-all duration-500 ${
                    loaded ? 'opacity-100 scale-100 blur-none' : 'opacity-0 scale-95'
                  }`}
                  referrerPolicy="no-referrer"
                  onError={() => {
                    const fallback = getCategoryPlaceholder(product.category);
                    if (imgSrc !== fallback) {
                      setImgSrc(fallback);
                    }
                  }}
                />
              </>
            )}
          </>
        ) : (
          <div className="absolute inset-0 bg-slate-50 flex items-center justify-center">
            <div className="w-5 h-5 rounded-full border border-slate-200 border-t-slate-400 animate-spin" />
          </div>
        )}

        <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1.5 z-20">
          <span className="px-2 py-0.5 bg-slate-900/80 backdrop-blur-xs text-white text-[10px] font-bold rounded-md flex items-center gap-1 uppercase tracking-wider">
            <Tag className="w-2.5 h-2.5" />
            {product.category}
          </span>
          {product.isSold && (
            <span className="px-2 py-0.5 bg-rose-600 border border-rose-500 text-white text-[10px] font-extrabold rounded-md uppercase tracking-widest shadow-md animate-pulse">
              SOLD
            </span>
          )}
        </div>

        {product.condition && (
          <div id={`product-card-condition-${product.id}`} className="absolute top-2.5 right-11">
            <span className="px-2 py-0.5 bg-slate-900/90 text-white border border-slate-700 text-[9px] font-extrabold rounded-md uppercase tracking-wider shadow-xs">
              {product.condition}
            </span>
          </div>
        )}

        {product.videos && product.videos.length > 0 && (
          <div className="absolute bottom-2.5 right-2.5 bg-emerald-600/90 backdrop-blur-xs border border-emerald-500 shadow-sm text-white py-1 px-2 rounded-lg z-15 flex items-center gap-1 leading-none text-[9px] font-extrabold tracking-wide uppercase select-none">
            <Video className="w-3.5 h-3.5 text-white animate-pulse" />
            <span>Video Ad</span>
          </div>
        )}

        {/* Bookmark/Watchlist floating button */}
        <button
          id={`btn-save-product-${product.id}`}
          onClick={handleSaveClick}
          className={`absolute top-2.5 right-2.5 z-25 p-1.5 rounded-full border shadow-3xs flex items-center justify-center transition-all duration-200 outline-none ${
            isSaved
              ? 'bg-rose-500 border-rose-500 text-white hover:bg-rose-600 scale-105'
              : 'bg-white/90 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-white'
          }`}
          title={isSaved ? "Remove from saved ads" : "Save to saved ads"}
        >
          <Bookmark className="w-3.5 h-3.5" fill={isSaved ? "currentColor" : "none"} />
        </button>
        
        {/* Dynamic bottom status bar on image hover */}
        {(currentUser?.isAdmin || currentUser?.role === 'admin' || currentUser?.id === product.sellerId) && (
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
      <div className="p-4 flex flex-col flex-1 justify-between gap-2.5 text-left bg-gradient-to-b from-white to-slate-50">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xl font-bold text-slate-900 block leading-tight font-sans tracking-tight">
              {formattedPrice}
            </span>
            {product.negotiable !== false && (
              <span id={`product-card-negotiable-${product.id}`} className="inline-flex items-center text-[8px] bg-emerald-50 text-emerald-700 border border-emerald-200/60 font-extrabold px-1.5 py-0.5 rounded-md uppercase tracking-wider font-sans shrink-0">
                Neg.
              </span>
            )}
          </div>
          {product.brand && (
            <span id={`product-card-brand-${product.id}`} className="inline-block text-[9px] bg-slate-100 text-slate-600 font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider font-sans mb-1">
              💼 {product.brand}
            </span>
          )}
          <h3 className="text-sm font-semibold text-slate-800 line-clamp-2 leading-snug group-hover:text-slate-950 transition truncate-hover">
            {product.title}
          </h3>
        </div>

        <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-150 text-[11px] text-slate-500 font-sans">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 min-w-0 flex-1">
              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{product.location}</span>
            </div>
          </div>
          <div className="flex items-center justify-between mt-0.5 text-[10px]">
            <span className="text-slate-400 flex items-center gap-1 flex-wrap">
              Seller: <b className="text-slate-700 font-semibold">{product.sellerName}</b>
              {isSellerVerified && (
                <span className="inline-flex items-center gap-0.5 text-[9px] text-indigo-700 font-extrabold bg-indigo-50 border border-indigo-150/40 px-1 py-0.2 rounded-md" title="Verified Tedbuy Seller">
                  🛡️ Verified
                </span>
              )}
            </span>
            {(!product.images[0] && !product.videos?.[0]) && <span className="bg-slate-200 text-slate-600 px-1 py-0.5 rounded text-[8px]">No Image</span>}
          </div>
        </div>

        {(currentUser?.isAdmin || currentUser?.role === 'admin' || currentUser?.id === product.sellerId) && (
          <div className="pt-2.5 border-t border-dashed border-slate-200 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Status Toggle</span>
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs font-bold text-rose-600 hover:text-rose-700">
              <input
                type="checkbox"
                checked={!!product.isSold}
                onChange={async (e) => {
                  try {
                    await updateProduct(product.id, { isSold: e.target.checked });
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
