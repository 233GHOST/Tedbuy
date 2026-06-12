import React from 'react';
import { Product, isUserVerified } from '../types';
import { useApp } from '../context/AppContext';
import { MapPin, Eye, Calendar, Tag, Bookmark } from 'lucide-react';

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
    setAuthMode
  } = useApp();

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

  React.useEffect(() => {
    setImgSrc(product.images?.[0] || getCategoryPlaceholder(product.category));
  }, [product.images, product.category]);

  const formattedPrice = formatProductPrice(product.price);

  // Format the relative/absolute date
  const dateFormatted = new Date(product.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });

  return (
    <article
      id={`product-card-${product.id}`}
      onClick={handleDetailsClick}
      className="relative bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs hover:shadow-md hover:scale-[1.02] hover:border-slate-300 transition-all duration-300 cursor-pointer flex flex-col h-full group"
    >
      {/* Listing image section */}
      <div className="relative w-full bg-slate-100 overflow-hidden shrink-0 aspect-[4/3]" style={{ aspectRatio: '4/3' }}>
        <img
          src={imgSrc}
          alt={product.title}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          referrerPolicy="no-referrer"
          onError={() => {
            const fallback = getCategoryPlaceholder(product.category);
            if (imgSrc !== fallback) {
              setImgSrc(fallback);
            }
          }}
        />
        <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1">
          <span className="px-2 py-0.5 bg-slate-900/80 backdrop-blur-xs text-white text-[10px] font-bold rounded-md flex items-center gap-1 uppercase tracking-wider">
            <Tag className="w-2.5 h-2.5" />
            {product.category}
          </span>
        </div>

        {product.condition && (
          <div id={`product-card-condition-${product.id}`} className="absolute top-2.5 right-11">
            <span className="px-2 py-0.5 bg-slate-900/90 text-white border border-slate-700 text-[9px] font-extrabold rounded-md uppercase tracking-wider shadow-xs">
              {product.condition}
            </span>
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
          title={isSaved ? "Remove from watchlist" : "Save to watchlist"}
        >
          <Bookmark className="w-3.5 h-3.5" fill={isSaved ? "currentColor" : "none"} />
        </button>
        
        {/* Dynamic bottom status bar on image hover */}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-slate-950/80 to-transparent p-2 text-white flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
          {(currentUser?.isAdmin || currentUser?.role === 'admin' || currentUser?.id === product.sellerId) ? (
            <>
              <span className="text-[10px] flex items-center gap-1 font-sans">
                <Eye className="w-3 h-3 text-slate-100" />
                {product.viewsCount} views
              </span>
              <span className="text-[10px] text-slate-300 flex items-center gap-1 font-sans font-medium">
                <Calendar className="w-3 h-3" />
                {dateFormatted}
              </span>
            </>
          ) : (
            <span className="text-[10px] text-slate-300 flex items-center gap-1 font-sans font-medium ml-auto">
              <Calendar className="w-3 h-3" />
              {dateFormatted}
            </span>
          )}
        </div>
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
            {!product.images[0] && <span className="bg-slate-200 text-slate-600 px-1 py-0.5 rounded text-[8px]">No Image</span>}
          </div>
        </div>
      </div>
    </article>
  );
};
