import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { ListingModal } from './ListingModal';
import { Product, Category } from '../types';
import { Edit2, Trash2, PlusCircle, Eye, ShoppingBag, MapPin, Tag, Plus, Bookmark, AlertTriangle } from 'lucide-react';

export const SellerDashboard: React.FC = () => {
  const {
    currentUser,
    products,
    deleteProduct,
    setCurrentView,
    setSelectedProductId,
    toggleSaveProduct,
    setSelectedSellerId,
    dashboardTab: activeTab,
    setDashboardTab: setActiveTab
  } = useApp();
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);

  // Auto-dismissing reminder to add their WhatsApp number if it is missing
  const [showWhatsAppReminder, setShowWhatsAppReminder] = useState(() => {
    return !currentUser?.whatsAppNumber;
  });
  const [timeLeft, setTimeLeft] = useState(15);

  useEffect(() => {
    if (!currentUser || !showWhatsAppReminder) return;
    if (timeLeft <= 0) {
      setShowWhatsAppReminder(false);
      return;
    }
    const timer = setInterval(() => {
      setTimeLeft(prev => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft, showWhatsAppReminder, currentUser]);

  if (!currentUser) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center text-slate-500">
        <p className="mb-4">You need to log in or select a profile to view your seller dashboard.</p>
        <p className="text-xs text-slate-400">Use the developer account selector bar at the top to select an active profile.</p>
      </div>
    );
  }

  // Filter products owned by the active user
  const myProducts = products.filter(p => p.sellerId === currentUser.id);
  const savedProducts = products.filter(p => currentUser.savedProductIds?.includes(p.id) || false);

  const handleEdit = (product: Product, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditProduct(product);
    setShowModal(true);
  };

  const handleDelete = (product: Product, e: React.MouseEvent) => {
    e.stopPropagation();
    setProductToDelete(product);
  };

  const handleCreateNew = () => {
    setEditProduct(null);
    setShowModal(true);
  };

  const handleCardClick = (id: string) => {
    setSelectedProductId(id);
    setCurrentView('product-detail');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-left">
      {/* WhatsApp setup auto-dismissing reminder banner */}
      {showWhatsAppReminder && currentUser && (
        <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-3xl p-5 shadow-xs relative overflow-hidden animate-fade-in text-left">
          {/* Animated shrinking progress line at the bottom */}
          <div 
            className="absolute bottom-0 left-0 h-1.5 bg-emerald-500 transition-all duration-1000 ease-linear" 
            style={{ width: `${(timeLeft / 15) * 100}%` }}
          />

          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-4">
              <div className="p-3 bg-emerald-100 text-emerald-700 rounded-2xl shrink-0 self-center">
                <svg className="w-6 h-6 fill-current animate-pulse text-emerald-600" viewBox="0 0 24 24">
                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.253 8.477 3.517 2.266 2.264 3.515 5.276 3.515 8.48-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.457L0 24zm6.59-4.846c1.6.95 3.1 1.452 4.7 1.453 5.4 0 9.8-4.4 9.8-9.8-.002-5.4-4.453-9.799-9.852-9.799-5.401 0-9.8 4.4-9.8 9.8 0 1.944.507 3.823 1.47 5.513L1.571 21.082l4.13-1.08c1.649.899 3.12 1.349 4.75 1.349z"/>
                </svg>
              </div>
              <div className="space-y-1.5">
                <h4 className="text-sm font-black text-emerald-900 uppercase tracking-tight flex items-center flex-wrap gap-2">
                  <span>Message Seller Direct on WhatsApp Option is Active!</span>
                  <span className="text-[9px] bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded-md font-extrabold normal-case">Direct Chat Info</span>
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed font-sans max-w-2xl">
                  For buyers to be able to instantly tap the <strong className="text-emerald-800 font-bold">&ldquo;Message seller on whatsapp&rdquo;</strong> button and chat with you directly on your ads, you must add your valid WhatsApp number in your store profile settings.
                </p>
                <div className="flex items-center gap-4 pt-1">
                  <button
                    onClick={() => setCurrentView('profile-settings')}
                    className="text-xs font-black text-emerald-700 hover:text-emerald-900 select-none cursor-pointer underline hover:no-underline transition"
                  >
                    Add WhatsApp Number Now &rarr;
                  </button>
                  <span className="text-[10px] text-slate-400 font-mono">
                    Auto-closing in {timeLeft} seconds
                  </span>
                </div>
              </div>
            </div>
            
            <button 
              onClick={() => setShowWhatsAppReminder(false)}
              className="p-1 px-2.5 hover:bg-emerald-100/50 rounded-lg text-emerald-800 hover:text-emerald-950 font-bold text-lg leading-none transition shrink-0 self-start cursor-pointer"
              title="Dismiss"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* Dashboard Overview Cards */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 id="dashboard-title" className="text-2xl font-bold text-slate-900 font-sans tracking-tight">My Vendor Hub</h1>
          <p className="text-sm text-slate-500">Manage your online ads, adjust pricing details, check view stats, or open your watchlist.</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            id="btn-profile-settings-dashboard"
            onClick={() => setCurrentView('profile-settings')}
            className="bg-white border border-slate-350 hover:bg-slate-50 text-slate-800 font-bold px-4 py-3 rounded-2xl text-sm flex items-center gap-1.5 shadow-3xs hover:shadow-2xs transition duration-200 cursor-pointer"
          >
            <span>Manage Store Profile</span>
          </button>
          
          <button
            id="btn-post-ad-dashboard"
            onClick={handleCreateNew}
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-5 py-3 rounded-2xl text-sm flex items-center gap-1.5 shadow-xs hover:shadow-md transition duration-200 cursor-pointer"
          >
            <PlusCircle className="w-5 h-5 stroke-[2.2]" />
            <span>Post New Ad</span>
          </button>
        </div>
      </div>

      {/* Metrics Panel */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-100 border border-slate-200 rounded-2xl p-4 shadow-3xs">
          <span className="text-xs text-slate-500 block font-semibold uppercase tracking-wider">Total Listings</span>
          <span id="dashboard-total-listings" className="text-2xl font-extrabold text-slate-900 font-sans">{myProducts.length} items</span>
        </div>
        <div className="bg-slate-100 border border-slate-200 rounded-2xl p-4 shadow-3xs">
          <span className="text-xs text-slate-500 block font-semibold uppercase tracking-wider">Total Views</span>
          <span id="dashboard-total-views" className="text-2xl font-extrabold text-slate-900 font-sans">
            {myProducts.reduce((sum, p) => sum + (p.viewsCount || 0), 0).toLocaleString()} views
          </span>
        </div>
        <div className="bg-slate-100 border border-slate-200 rounded-2xl p-4 shadow-3xs">
          <span className="text-xs text-slate-500 block font-semibold uppercase tracking-wider">Account Status</span>
          <span className="text-sm font-bold text-slate-800 flex items-center gap-1 mt-1">
            <span className="h-2 w-2 rounded-full bg-slate-800 animate-pulse"></span>
            Active Retailer
          </span>
        </div>
        <div className="bg-slate-100 border border-slate-200 rounded-2xl p-4 shadow-3xs">
          <span className="text-xs text-slate-500 block font-semibold uppercase tracking-wider">Pricing Unit</span>
          <span className="text-2xl font-extrabold text-slate-900 font-sans">GHS (₵)</span>
        </div>
      </div>

      {/* Ribbon Tab Selection */}
      <div className="flex border-b border-slate-200 mb-6 gap-6 font-sans">
        <button
          id="tab-my-listings"
          onClick={() => setActiveTab('listings')}
          className={`pb-3 font-semibold text-sm transition relative outline-none cursor-pointer ${
            activeTab === 'listings'
              ? 'text-slate-900 font-extrabold border-b-2 border-slate-900'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          My Listed Ads ({myProducts.length})
        </button>
        <button
          id="tab-watchlist"
          onClick={() => setActiveTab('saved')}
          className={`pb-3 font-semibold text-sm transition relative outline-none cursor-pointer ${
            activeTab === 'saved'
              ? 'text-slate-900 font-extrabold border-b-2 border-slate-900'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          Saved & Watchlist ({savedProducts.length})
        </button>
      </div>

      {activeTab === 'listings' ? (
        /* Products list or blank slate for owned products */
        myProducts.length === 0 ? (
          <div className="bg-slate-100 border border-slate-200 rounded-3xl p-12 text-center max-w-lg mx-auto shadow-xs">
            <ShoppingBag className="w-14 h-14 mx-auto stroke-[1.2] text-slate-350 mb-3" />
            <h2 className="text-base font-bold text-slate-900 font-sans">No products listed matching your account</h2>
            <p className="text-xs text-slate-500 mt-1 mb-5">Start listing items like phones, laptops, and more. Buyers will be able to search and message you immediately.</p>
            <button
              onClick={handleCreateNew}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition duration-200 inline-flex items-center gap-1 shadow-xs hover:shadow-md cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create First Product</span>
            </button>
          </div>
        ) : (
          <div className="bg-slate-100 border border-slate-200 rounded-3xl overflow-hidden shadow-xs">
            {/* Table headers (Desktop) */}
            <div className="hidden md:grid grid-cols-12 gap-4 bg-slate-200/80 border-b border-slate-250 px-6 py-3.5 text-xs font-bold text-slate-600 font-sans uppercase tracking-wider">
              <span className="col-span-6">Item Information</span>
              <span className="col-span-2 text-center">Category</span>
              <span className="col-span-2 text-center">Views</span>
              <span className="col-span-2 text-right">Actions</span>
            </div>

            <div className="divide-y divide-slate-200">
              {myProducts.map(prod => (
                <div
                  key={prod.id}
                  id={`dashboard-row-${prod.id}`}
                  onClick={() => handleCardClick(prod.id)}
                  className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center px-6 py-4 hover:bg-slate-200/50 cursor-pointer transition duration-150 relative group"
                >
                  {/* Info block */}
                  <div className="col-span-1 md:col-span-6 flex gap-4 text-left">
                    <img
                      src={prod.images[0] || 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=120&q=80'}
                      alt={prod.title}
                      className="w-16 h-16 rounded-xl object-cover border border-slate-200 shrink-0"
                    />
                    <div className="flex flex-col justify-center min-w-0">
                      <span className="text-base font-bold text-slate-950 font-sans">
                        GHS {prod.price.toLocaleString()}
                      </span>
                      <h3 className="text-sm font-semibold text-slate-800 line-clamp-1 group-hover:text-slate-950 transition truncate-hover mt-0.5">
                        {prod.title}
                      </h3>
                      {(prod.brand || prod.condition) && (
                        <span className="text-[10px] text-slate-550 font-sans mt-0.5 flex flex-wrap gap-x-2">
                          {prod.brand && <span>Brand: <b className="text-slate-700">{prod.brand}</b></span>}
                          {prod.brand && prod.condition && <span className="text-slate-250">|</span>}
                          {prod.condition && <span>Condition: <b className="text-slate-850">{prod.condition}</b></span>}
                        </span>
                      )}
                      <span className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                        {prod.location}
                      </span>
                    </div>
                  </div>

                  {/* Category block */}
                  <div className="col-span-1 md:col-span-2 text-left md:text-center shrink-0">
                    <span className="px-2.5 py-0.5 bg-slate-200 text-slate-700 text-[10px] font-bold rounded-lg uppercase tracking-wider inline-flex items-center gap-1">
                      <Tag className="w-3 h-3 text-slate-550" />
                      {prod.category}
                    </span>
                  </div>

                  {/* Views Counter */}
                  <div className="col-span-1 md:col-span-2 text-left md:text-center flex items-center gap-1.5 md:justify-center text-xs text-slate-400 font-sans">
                    <Eye className="w-4 h-4 text-slate-400 animate-pulse" />
                    <span><b>{prod.viewsCount || 0}</b> views</span>
                  </div>

                  {/* Management controls */}
                  <div className="col-span-1 md:col-span-2 flex items-center justify-end gap-2 text-right relative z-30">
                    <button
                      id={`btn-edit-${prod.id}`}
                      onClick={(e) => handleEdit(prod, e)}
                      className="p-2 border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-350 rounded-xl hover:bg-slate-100 transition-all shadow-3xs flex items-center justify-center cursor-pointer"
                      title="Edit Item Details"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      id={`btn-delete-${prod.id}`}
                      onClick={(e) => handleDelete(prod, e)}
                      className="p-2 border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 rounded-xl hover:bg-red-50/20 transition-all shadow-3xs flex items-center justify-center cursor-pointer"
                      title="Remove Ad"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      ) : (
        /* Watchlist list or blank slate for bookmarked products */
        savedProducts.length === 0 ? (
          <div className="bg-slate-100 border border-slate-200 rounded-3xl p-12 text-center max-w-lg mx-auto shadow-xs">
            <Bookmark className="w-14 h-14 mx-auto stroke-[1.2] text-slate-350 mb-3" />
            <h2 className="text-base font-bold text-slate-900 font-sans">Your Watchlist is Empty</h2>
            <p className="text-xs text-slate-500 mt-1 mb-5 font-sans">Click the bookmark icon on any item while browsing the marketplace to save products here for speedy access.</p>
            <button
              onClick={() => setCurrentView('browse')}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition duration-200 inline-flex items-center gap-1 shadow-xs hover:shadow-md cursor-pointer"
            >
              <span>Explore Active Ads</span>
            </button>
          </div>
        ) : (
          <div className="bg-slate-100 border border-slate-200 rounded-3xl overflow-hidden shadow-xs">
            {/* Table headers (Desktop) */}
            <div className="hidden md:grid grid-cols-12 gap-4 bg-slate-200/80 border-b border-slate-250 px-6 py-3.5 text-xs font-bold text-slate-600 font-sans uppercase tracking-wider">
              <span className="col-span-6">Bookmarked Item</span>
              <span className="col-span-2 text-center">Category</span>
              <span className="col-span-2 text-center">Seller</span>
              <span className="col-span-2 text-right">Actions</span>
            </div>

            <div className="divide-y divide-slate-200">
              {savedProducts.map(prod => (
                <div
                  key={prod.id}
                  id={`watchlist-row-${prod.id}`}
                  onClick={() => handleCardClick(prod.id)}
                  className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center px-6 py-4 hover:bg-slate-200/50 cursor-pointer transition duration-150 relative group"
                >
                  {/* Info block */}
                  <div className="col-span-1 md:col-span-6 flex gap-4 text-left">
                    <img
                      src={prod.images[0] || 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=120&q=80'}
                      alt={prod.title}
                      className="w-16 h-16 rounded-xl object-cover border border-slate-200 shrink-0"
                    />
                    <div className="flex flex-col justify-center min-w-0">
                      <span className="text-base font-bold text-slate-950 font-sans">
                        GHS {prod.price.toLocaleString()}
                      </span>
                      <h3 className="text-sm font-semibold text-slate-800 line-clamp-1 group-hover:text-slate-950 transition truncate-hover mt-0.5">
                        {prod.title}
                      </h3>
                      {(prod.brand || prod.condition) && (
                        <span className="text-[10px] text-slate-550 font-sans mt-0.5 flex flex-wrap gap-x-2">
                          {prod.brand && <span>Brand: <b className="text-slate-700">{prod.brand}</b></span>}
                          {prod.brand && prod.condition && <span className="text-slate-250">|</span>}
                          {prod.condition && <span>Condition: <b className="text-slate-850">{prod.condition}</b></span>}
                        </span>
                      )}
                      <span className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                        {prod.location}
                      </span>
                    </div>
                  </div>

                  {/* Category block */}
                  <div className="col-span-1 md:col-span-2 text-left md:text-center shrink-0">
                    <span className="px-2.5 py-0.5 bg-slate-200 text-slate-700 text-[10px] font-bold rounded-lg uppercase tracking-wider inline-flex items-center gap-1">
                      <Tag className="w-3 h-3 text-slate-550" />
                      {prod.category}
                    </span>
                  </div>

                  {/* Seller name (linked to store profile) */}
                  <div className="col-span-1 md:col-span-2 text-left md:text-center shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSellerId(prod.sellerId);
                        setCurrentView('seller-profile');
                      }}
                      className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 hover:text-slate-950 hover:bg-slate-50 inline-flex items-center gap-1 transition-all z-30 cursor-pointer"
                    >
                      @{prod.sellerName}
                    </button>
                  </div>

                  {/* Watchlist actions */}
                  <div className="col-span-1 md:col-span-2 flex items-center justify-end gap-2 text-right relative z-30">
                    <button
                      id={`btn-unsave-${prod.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSaveProduct(prod.id);
                      }}
                      className="p-2 border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 rounded-xl hover:bg-rose-50/20 transition-all shadow-3xs flex items-center justify-center cursor-pointer"
                      title="Remove Bookmark"
                    >
                      <Bookmark className="w-4 h-4 fill-rose-500 text-rose-500" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      )}

      {/* Embedded form overlays */}
      <ListingModal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          setEditProduct(null);
        }}
        productToEdit={editProduct}
      />

      {/* Custom Confirmation Dialog for Deleting listing */}
      {productToDelete && (
        <div 
          onClick={() => setProductToDelete(null)}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl w-full max-w-md p-6 border border-slate-100 shadow-2xl animate-fade-in text-left font-sans"
          >
            <div className="flex items-start gap-3.5">
              <div className="bg-red-50 p-2.5 rounded-xl border border-red-100 shrink-0 text-red-600">
                <AlertTriangle className="w-5 h-5 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">Delete Listing?</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Are you sure you want to permanently delete <strong className="text-slate-800">"{productToDelete.title}"</strong> from the Tedbuy classifieds marketplace?
                </p>
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 mt-2 flex items-center gap-3">
                  {productToDelete.images?.[0] ? (
                    <img
                      src={productToDelete.images[0]}
                      alt="Product item"
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-lg object-cover border border-slate-150 shrink-0"
                    />
                  ) : null}
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate">{productToDelete.title}</p>
                    <p className="text-[10px] text-slate-400 font-mono">Location: {productToDelete.location}</p>
                  </div>
                </div>
                <p className="text-[10px] text-rose-600 font-semibold mt-1">This action is irreversible and cannot be undone.</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 mt-5 pt-3 border-t border-slate-100">
              <button
                onClick={() => setProductToDelete(null)}
                className="px-4 py-2 hover:bg-slate-100 border border-slate-200 text-slate-650 hover:text-slate-950 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Cancel, Keep Ad
              </button>
              <button
                onClick={async () => {
                  try {
                    await deleteProduct(productToDelete.id);
                  } catch (err) {
                    console.error("Deletion error:", err);
                  } finally {
                    setProductToDelete(null);
                  }
                }}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black transition cursor-pointer shadow-3xs"
              >
                Yes, Delete Ad
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
