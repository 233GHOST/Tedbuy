import React from 'react';
import { Product } from '../types';
import { useApp } from '../context/AppContext';
import { MapPin, Eye, Calendar, Tag, Bookmark } from 'lucide-react';

interface ProductCardProps {
  product: Product;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const { currentUser, toggleSaveProduct, setSelectedProductId, setCurrentView, incrementProductViews } = useApp();

  const isSaved = currentUser?.savedProductIds?.includes(product.id) || false;

  const handleDetailsClick = () => {
    incrementProductViews(product.id);
    setSelectedProductId(product.id);
    setCurrentView('product-detail');
  };

  const handleSaveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser) {
      alert('Please select or log in to a profile first using the simulation bar at the top!');
      return;
    }
    toggleSaveProduct(product.id);
  };

  const formattedPrice = new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS',
    maximumFractionDigits: 0
  }).format(product.price);

  // Format the relative/absolute date
  const dateFormatted = new Date(product.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });

  return (
    <article
      id={`product-card-${product.id}`}
      onClick={handleDetailsClick}
      className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs hover:shadow-lg hover:-translate-y-1 hover:border-slate-300 transition-all duration-200 cursor-pointer flex flex-col h-full group"
    >
      {/* Listing image section */}
      <div className="relative aspect-4/3 w-full bg-slate-100 overflow-hidden shrink-0">
        <img
          src={product.images[0] || 'https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&w=600&q=80'}
          alt={product.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          referrerPolicy="no-referrer"
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
          <span className="text-[10px] flex items-center gap-1 font-sans">
            <Eye className="w-3 h-3 text-slate-100" />
            {product.viewsCount} views
          </span>
          <span className="text-[10px] text-slate-300 flex items-center gap-1 font-sans font-medium">
            <Calendar className="w-3 h-3" />
            {dateFormatted}
          </span>
        </div>
      </div>

      {/* Detail info section */}
      <div className="p-4 flex flex-col flex-1 justify-between gap-2.5 text-left bg-linear-to-b from-white to-slate-50">
        <div className="space-y-1">
          <span className="text-xl font-bold text-slate-900 block leading-tight font-sans tracking-tight">
            {formattedPrice}
          </span>
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
          <div className="flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">{product.location}</span>
          </div>
          <div className="flex items-center justify-between mt-0.5 text-[10px]">
            <span className="text-slate-400">Seller: <b className="text-slate-600 font-medium">{product.sellerName}</b></span>
            {!product.images[0] && <span className="bg-slate-200 text-slate-600 px-1 py-0.5 rounded text-[8px]">No Image</span>}
          </div>
        </div>
      </div>
    </article>
  );
};
