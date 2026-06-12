import React, { useState, useMemo } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Navbar } from './components/Navbar';
import { ProductCard } from './components/ProductCard';
import { ProductDetail } from './components/ProductDetail';
import { ChatInterface } from './components/ChatInterface';
import { SellerDashboard } from './components/SellerDashboard';
import { SellerProfilePage } from './components/SellerProfilePage';
import { ProfileSettings } from './components/ProfileSettings';
import { ListingModal } from './components/ListingModal';
import { Category, Product } from './types';
import { Sparkles, ShoppingBag, X, Check, Search, TrendingUp, HelpCircle, Package, MapPin, ChevronLeft, ChevronRight, Grid, LayoutGrid, Home, User, MessageSquare, History } from 'lucide-react';
import { GhanaLocationFilter } from './components/GhanaLocationFilter';
import { getRegionForLocation } from './regions';

const CATEGORY_ICONS: { [key in Category]: string } = {
  Phones: '📱',
  Laptops: '💻',
  Fashion: '👟',
  'Home Appliances': '🔌',
  Vehicles: '🚗',
  'Beauty and Care': '💄',
  Games: '🎮',
  Electronics: '⚡',
  Other: '📦'
};

const MarketplaceContent: React.FC = () => {
  const {
    products,
    currentView,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    currentUser,
    setCurrentView,
    setShowAuthModal,
    unauthorizedDomainDetected,
    setUnauthorizedDomainDetected,
    isAuthLoading,
    isProductsLoading,
    messages,
    setAuthMode,
    recentlyViewedIds,
    clearRecentlyViewed,
    setSelectedProductId
  } = useApp();

  const recentlyViewedProducts = useMemo(() => {
    if (!recentlyViewedIds || recentlyViewedIds.length === 0) return [];
    return recentlyViewedIds
      .map(id => products.find(p => p.id === id))
      .filter((p): p is Product => !!p);
  }, [recentlyViewedIds, products]);

  const [isPostAdOpen, setIsPostAdOpen] = useState(false);

  // Categories rendering layout toggle & scroll ref
  const [showAllCategories, setShowAllCategories] = useState(false);
  const categoriesScrollRef = React.useRef<HTMLDivElement>(null);

  const handleScrollCategories = (direction: 'left' | 'right') => {
    if (categoriesScrollRef.current) {
      const { scrollLeft } = categoriesScrollRef.current;
      const scrollAmount = 240;
      categoriesScrollRef.current.scrollTo({
        left: direction === 'left' ? scrollLeft - scrollAmount : scrollLeft + scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  // Ghana Region & City filter states
  const [selectedRegion, setSelectedRegion] = useState<string>('All');
  const [selectedCity, setSelectedCity] = useState<string>('All');
  const [sortByAds, setSortByAds] = useState<'newest' | 'oldest'>('newest');
  const [sortByPrice, setSortByPrice] = useState<'default' | 'asc' | 'desc'>('default');



  // Filter listings based on category, search query, region, and city
  const filteredProducts = useMemo(() => {
    return products.filter(product => {
      const matchesCategory = !selectedCategory || 
        product.category === selectedCategory || 
        (product.category && selectedCategory && product.category.toLowerCase() === selectedCategory.toLowerCase());
      const matchesSearch = !searchQuery.trim() ||
        product.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (product.category && product.category.toLowerCase().includes(searchQuery.toLowerCase())) ||
        product.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.location.toLowerCase().includes(searchQuery.toLowerCase());

      // Region verification
      let matchesRegion = true;
      if (selectedRegion !== 'All') {
        const prodRegion = getRegionForLocation(product.location);
        matchesRegion = (prodRegion === selectedRegion);
      }

      // City verification
      let matchesCity = true;
      if (selectedCity !== 'All') {
        matchesCity = product.location.toLowerCase().includes(selectedCity.toLowerCase());
      }

      return matchesCategory && matchesSearch && matchesRegion && matchesCity;
    });
  }, [products, selectedCategory, searchQuery, selectedRegion, selectedCity]);

  const parseNumericPrice = (p: string | number): number => {
    if (typeof p === 'number') return p;
    if (!p) return 0;
    // Extract numbers and dot, get rid of commas, spaces, letters
    const cleaned = p.replace(/[^0-9.]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  };

  const sortedProducts = useMemo(() => {
    return [...filteredProducts].sort((a, b) => {
      // 1. Sort by Price if actively configured
      if (sortByPrice === 'asc') {
        const diff = parseNumericPrice(a.price) - parseNumericPrice(b.price);
        if (diff !== 0) return diff;
      } else if (sortByPrice === 'desc') {
        const diff = parseNumericPrice(b.price) - parseNumericPrice(a.price);
        if (diff !== 0) return diff;
      }

      // 2. Sort by Ads (Chronological based on createdAt timestamp)
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (sortByAds === 'newest') {
        return dateB - dateA;
      } else if (sortByAds === 'oldest') {
        return dateA - dateB;
      }

      return 0; // secondary stable order
    });
  }, [filteredProducts, sortByPrice, sortByAds]);

  const handlePostAdBtn = () => {
    if (!currentUser) {
      setShowAuthModal(true);
      return;
    }
    setIsPostAdOpen(true);
  };

  const unreadCount = useMemo(() => {
    if (!currentUser || !messages) return 0;
    return messages.filter(m => m.recipientId === currentUser.id && !m.read).length;
  }, [messages, currentUser]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans pb-16 md:pb-0">
      <Navbar />

      {unauthorizedDomainDetected && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 py-3.5 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-left">
            <div className="flex gap-2.5 items-start">
              <span className="text-lg mt-0.5" role="img" aria-label="warning">⚠️</span>
              <div>
                <p className="font-bold text-sm text-amber-950">Firebase Unauthorized Domain Notice</p>
                <p className="text-xs text-amber-800 mt-1 max-w-4xl leading-relaxed">
                  Google Sign-In was automatically completed via a <strong>resilient sandbox fallback profile</strong> because the current domain is not yet added to your Firebase authorized domains list. To enable real Google authentication, visit your <strong>Firebase Console &rarr; Authentication &rarr; Settings &rarr; Authorized domains</strong>, click <strong>Add domain</strong>, and add:
                </p>
                <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[11px] bg-amber-100 border border-amber-200/65 px-2 py-1 rounded text-amber-950 font-medium select-all">
                    {typeof window !== 'undefined' ? window.location.hostname : 'development-domain'}
                  </span>
                  <button
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        navigator.clipboard.writeText(window.location.hostname);
                      }
                    }}
                    className="text-[11px] font-bold bg-amber-600/10 hover:bg-amber-600/15 border border-amber-300 text-amber-950 px-2 py-1 rounded transition cursor-pointer active:scale-95"
                  >
                    Copy
                  </button>
                  
                  {typeof window !== 'undefined' && window.location.hostname.includes('-dev-') && (
                    <>
                      <span className="font-mono text-[11px] bg-amber-100 border border-amber-200/65 px-2 py-1 rounded text-amber-950 font-medium select-all">
                        {window.location.hostname.replace('-dev-', '-pre-')}
                      </span>
                      <button
                        onClick={() => {
                          if (typeof window !== 'undefined') {
                            navigator.clipboard.writeText(window.location.hostname.replace('-dev-', '-pre-'));
                          }
                        }}
                        className="text-[11px] font-bold bg-amber-600/10 hover:bg-amber-600/15 border border-amber-300 text-amber-950 px-2 py-1 rounded transition cursor-pointer active:scale-95"
                      >
                        Copy
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
            
            <button
              onClick={() => setUnauthorizedDomainDetected(false)}
              className="p-1 px-2.5 text-xs font-bold hover:bg-amber-100 border border-amber-200 text-amber-900 rounded-lg hover:text-amber-950 transition shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <main className="flex-1">
        {currentView === 'browse' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            
            {/* Promotional Marketplace Hero Badge */}
            <div className="relative mb-8 bg-slate-100 border border-slate-200 text-slate-900 rounded-3xl p-6 sm:p-8 overflow-hidden shadow-xs flex flex-col gap-6">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative z-10 w-full">
                <div className="text-left">
                  <span className="text-slate-400 font-extrabold text-[10px] tracking-wider uppercase block mb-1">Tedbuy Ghana</span>
                  <h1 className="text-2xl sm:text-3xl font-black text-slate-950 font-sans tracking-tight">Direct Local Market</h1>
                </div>

                {/* Action trigger */}
                <button
                  id="hero-post-ad-btn"
                  onClick={handlePostAdBtn}
                  className="w-full md:w-auto px-5 py-3 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-sm rounded-xl shadow-xs hover:shadow-md transition duration-200 shrink-0 cursor-pointer text-center"
                >
                  Post an Ad Free
                </button>
              </div>

              {/* Prominent Search bar integrated under the Title as requested */}
              <div className="relative z-10 max-w-xl text-left w-full">
                <label className="block text-xs font-black text-slate-500 mb-2 tracking-wider uppercase">
                  looking for something?
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Search className="h-5 w-5 text-slate-400 stroke-[2.2]" />
                  </div>
                  <input
                    type="text"
                    id="hero-search-input"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      if (currentView !== 'browse') setCurrentView('browse');
                    }}
                    placeholder="Search phones, laptops, sneakers, furniture, beauty care..."
                    className="block w-full pl-11 pr-10 py-3.5 border-2 border-slate-250 focus:border-slate-800 rounded-2xl bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-slate-100 text-sm font-semibold transition"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-slate-600 transition"
                      title="Clear Search"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Decorative radial glows */}
              <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-48 h-48 bg-slate-400/15 rounded-full blur-3xl pointer-events-none"></div>
              <div className="absolute -right-24 -top-24 w-60 h-60 bg-slate-400/10 rounded-full blur-3xl pointer-events-none"></div>
            </div>

            {/* Category selection ribbon */}
            <section className="space-y-4 mb-8 text-left">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-base font-extrabold text-slate-900 font-sans tracking-tight flex items-center gap-1.5">
                    <TrendingUp className="w-4.5 h-4.5 text-slate-900" />
                    <span>Explore Classified Categories</span>
                  </h2>
                  <button
                    onClick={() => setShowAllCategories(!showAllCategories)}
                    className="text-[11px] bg-slate-100 font-black px-2.5 py-1 text-slate-700 hover:bg-slate-200 hover:text-slate-950 rounded-lg flex items-center gap-1 transition cursor-pointer"
                  >
                    <LayoutGrid className="w-3 h-3" />
                    <span>{showAllCategories ? 'Show Scroll' : 'View All Grid'}</span>
                  </button>
                </div>
                {selectedCategory && (
                  <button
                    id="clear-category-filter"
                    onClick={() => setSelectedCategory(null)}
                    className="text-xs text-slate-550 hover:text-slate-950 font-semibold cursor-pointer"
                  >
                    Clear Filter
                  </button>
                )}
              </div>

              {showAllCategories ? (
                /* All categories presented cleanly in an elegant wrapping grid */
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-3xl grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2.5 shadow-xs">
                  <button
                    id="category-tag-all-grid"
                    onClick={() => {
                      setSelectedCategory(null);
                    }}
                    className={`px-3 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition border text-left truncate cursor-pointer ${
                      selectedCategory === null
                        ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-slate-350 hover:bg-slate-100/50'
                    }`}
                  >
                    <span>🌐</span>
                    <span className="truncate">All Categories</span>
                  </button>

                  {(Object.keys(CATEGORY_ICONS) as Category[]).map(cat => {
                    const active = selectedCategory === cat;
                    return (
                      <button
                        key={cat}
                        id={`category-tag-grid-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                        onClick={() => {
                          setSelectedCategory(cat);
                        }}
                        className={`px-3 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition border text-left truncate cursor-pointer ${
                          active
                            ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-slate-350 hover:bg-slate-100/50'
                        }`}
                      >
                        <span className="text-sm leading-none flex-shrink-0">{CATEGORY_ICONS[cat]}</span>
                        <span className="truncate">{cat}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                /* Beautiful smooth sliding custom horizontal list with navigation helpers */
                <div className="relative group/scroll flex items-center">
                  {/* Left Scroll Trigger */}
                  <button
                    onClick={() => handleScrollCategories('left')}
                    className="absolute -left-2 z-10 w-8 h-8 items-center justify-center rounded-full bg-white border border-slate-200 shadow-md text-slate-700 hover:bg-slate-50 hover:text-slate-950 active:scale-95 transition-all flex cursor-pointer"
                    aria-label="Scroll left"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <div 
                    ref={categoriesScrollRef}
                    className="flex gap-2 pb-2 overflow-x-auto w-full px-7 scroll-smooth scrollbar-none"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  >
                    <button
                      id="category-tag-all"
                      onClick={() => setSelectedCategory(null)}
                      className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap border cursor-pointer ${
                        selectedCategory === null
                          ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-350 hover:bg-slate-50/50'
                      }`}
                    >
                      <span>🌐</span>
                      <span>All Categories</span>
                    </button>

                    {(Object.keys(CATEGORY_ICONS) as Category[]).map(cat => {
                      const active = selectedCategory === cat;
                      return (
                        <button
                          key={cat}
                          id={`category-tag-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                          onClick={() => setSelectedCategory(cat)}
                          className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap border cursor-pointer ${
                            active
                              ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-slate-350 hover:bg-slate-50/50'
                          }`}
                        >
                          <span className="text-sm leading-none">{CATEGORY_ICONS[cat]}</span>
                          <span>{cat}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Right Scroll Trigger */}
                  <button
                    onClick={() => handleScrollCategories('right')}
                    className="absolute -right-2 z-10 w-8 h-8 items-center justify-center rounded-full bg-white border border-slate-200 shadow-md text-slate-700 hover:bg-slate-50 hover:text-slate-950 active:scale-95 transition-all flex cursor-pointer"
                    aria-label="Scroll right"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </section>
               {/* Dual columns grid for classified location Navigator sidebar + products */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
              {/* Left sidebar Location Navigator - span 1 */}
              <div className="lg:col-span-1 space-y-4">
                <GhanaLocationFilter
                  selectedRegion={selectedRegion}
                  setSelectedRegion={setSelectedRegion}
                  selectedCity={selectedCity}
                  setSelectedCity={setSelectedCity}
                  products={products}
                />

                {recentlyViewedProducts.length > 0 && (
                  <div
                    id="recently-viewed-panel"
                    className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3.5 text-left font-sans animate-fade-in"
                  >
                    <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
                      <div className="flex items-center gap-1.5 text-slate-800">
                        <History className="w-4 h-4 text-slate-600 shrink-0" />
                        <h4 className="text-xs font-black tracking-tight uppercase text-slate-900">Recently Viewed</h4>
                      </div>
                      <button
                        onClick={clearRecentlyViewed}
                        className="text-[10px] text-slate-400 hover:text-red-500 font-extrabold hover:bg-red-50 px-1.5 py-0.5 rounded-md transition duration-250 cursor-pointer"
                        title="Clear history list"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="space-y-2.5">
                      {recentlyViewedProducts.map(product => {
                        const formattedPrice = Number(product.price) > 0
                          ? `GH₵${Number(product.price).toLocaleString()}`
                          : 'Contact Seller';
                        return (
                          <div
                            key={product.id}
                            id={`recently-viewed-item-${product.id}`}
                            onClick={() => {
                              setSelectedProductId(product.id);
                              setCurrentView('product-detail');
                            }}
                            className="flex items-center gap-3 p-1 rounded-xl hover:bg-slate-50 transition cursor-pointer group select-none"
                          >
                            <div className="relative w-11 h-11 rounded-lg overflow-hidden bg-slate-100 border border-slate-150 shrink-0">
                              <img
                                src={product.images?.[0] || 'https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&w=120&q=80'}
                                alt=""
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover transition duration-300 group-hover:scale-110"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-bold text-slate-800 truncate group-hover:text-slate-950 transition duration-200 leading-tight">
                                {product.title}
                              </p>
                              <p className="text-[10px] font-black text-slate-900 mt-0.5">
                                {formattedPrice}
                              </p>
                              <p className="text-[9px] text-slate-400 truncate mt-0.5">
                                {product.location}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Right main items layout - span 3 */}
              <div className="lg:col-span-3 space-y-6">
                <section className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4 text-left">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 font-sans tracking-tight">
                        {searchQuery.trim()
                          ? `Results for ${searchQuery}`
                          : selectedCategory
                          ? `${selectedCategory} listings`
                          : (selectedRegion !== 'All' || selectedCity !== 'All')
                          ? `${selectedRegion} Region ${selectedCity !== 'All' ? '- ' + selectedCity : ''} Deals`
                          : 'Latest Classified Deals'}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">{filteredProducts.length} active listings found</p>
                    </div>

                    {/* Multi-Dimensional Dual Selection Controls (Ads and Price side-by-side) */}
                    <div className="flex flex-wrap items-center gap-3.5 self-start sm:self-center">
                      {/* Sort by Date/Ads */}
                      <div className="flex items-center gap-1.5">
                        <label htmlFor="sort-ads" className="text-xs font-bold text-slate-500 whitespace-nowrap">Sort Ads:</label>
                        <select
                          id="sort-ads"
                          value={sortByAds}
                          onChange={(e) => setSortByAds(e.target.value as 'newest' | 'oldest')}
                          className="bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-350 cursor-pointer shadow-3xs transition hover:border-slate-300 animate-fade-in"
                        >
                          <option value="newest">Newest First</option>
                          <option value="oldest">Oldest First</option>
                        </select>
                      </div>

                      {/* Sort by Price */}
                      <div className="flex items-center gap-1.5">
                        <label htmlFor="sort-price" className="text-xs font-bold text-slate-500 whitespace-nowrap">Sort Price:</label>
                        <select
                          id="sort-price"
                          value={sortByPrice}
                          onChange={(e) => setSortByPrice(e.target.value as 'default' | 'asc' | 'desc')}
                          className="bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-350 cursor-pointer shadow-3xs transition hover:border-slate-300 animate-fade-in"
                        >
                          <option value="default">All Prices</option>
                          <option value="asc">Low to High</option>
                          <option value="desc">High to Low</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {isProductsLoading ? (
                    <div id="listings-shimmer-grid" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-4 sm:gap-6">
                      {[1, 2, 3, 4, 5, 6].map((i) => (
                        <div key={i} className="bg-white border border-slate-100 rounded-3xl p-3 space-y-4 animate-pulse shadow-sm min-h-[300px] flex flex-col justify-between">
                          <div className="bg-slate-100 rounded-2xl w-full h-40"></div>
                          <div className="space-y-2 flex-1 pt-1">
                            <div className="bg-slate-100 h-4 rounded-md w-3/4"></div>
                            <div className="bg-slate-100 h-3 rounded-md w-1/2"></div>
                          </div>
                          <div className="bg-slate-100 h-5 rounded-md w-1/3 mt-2"></div>
                        </div>
                      ))}
                    </div>
                  ) : filteredProducts.length === 0 ? (
                    <div id="no-products-found" className="bg-white border border-slate-200 rounded-3xl p-16 text-center max-w-lg mx-auto shadow-sm">
                      <Package className="w-14 h-14 mx-auto stroke-[1.2] text-slate-300 mb-2" />
                      <h4 className="text-sm font-bold text-slate-800">No postings matching your parameters</h4>
                      <p className="text-xs text-slate-450 mt-1 mb-5">
                        We couldn't find any listings matching your search or location settings. Try broadening your keywords or selecting "All Regions" to see more options.
                      </p>
                      <button
                        onClick={() => {
                          setSearchQuery('');
                          setSelectedCategory(null);
                          setSelectedRegion('All');
                          setSelectedCity('All');
                        }}
                        className="px-4.5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition shadow-3xs"
                      >
                        Reset All Filters
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-4 sm:gap-6">
                      {sortedProducts.map(product => (
                        <ProductCard key={product.id} product={product} />
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>
        )}

        {/* Dynamic sub screens */}
        {currentView === 'product-detail' && <ProductDetail />}
        {currentView === 'chats' && <ChatInterface />}
        {currentView === 'my-dashboard' && <SellerDashboard />}
        {currentView === 'seller-profile' && <SellerProfilePage />}
        {currentView === 'profile-settings' && <ProfileSettings />}
      </main>

      {/* Persistent platform footer */}
      <footer className="bg-white border-t border-slate-205 text-slate-500 text-xs py-8 mt-12 mb-16 md:mb-0">
        <div className="max-w-7xl mx-auto px-4 text-center space-y-2">
          <p className="font-sans font-bold text-slate-800">Tedbuy Classifieds Marketplace &copy; 2026</p>
          <p className="text-[11px] text-slate-400 max-w-md mx-auto leading-relaxed">
            Connecting local buyers and sellers across Ghana directly. Browse tech, appliances, and fashion safely in your region.
          </p>
        </div>
      </footer>

      {/* Floating Create Listings form */}
      <ListingModal
        isOpen={isPostAdOpen}
        onClose={() => setIsPostAdOpen(false)}
      />

      {/* Responsive Bottom Navigation Bar for Mobile Devices */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/80 shadow-[0_-4px_12px_rgba(0,0,0,0.05)] md:hidden py-1.5 px-4 flex items-center justify-around">
        {/* Home Tab */}
        <button
          onClick={() => {
            setCurrentView('browse');
            setSearchQuery('');
          }}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-2.5 transition gap-1 ${
            currentView === 'browse'
              ? 'text-slate-950 font-black'
              : 'text-slate-400 hover:text-slate-600 font-medium'
          }`}
        >
          <Home className={`w-5.5 h-5.5 stroke-[2.2] transition-transform ${
            currentView === 'browse' ? 'scale-110 text-slate-900' : 'text-slate-400'
          }`} />
          <span className="text-[10px] tracking-tight">Home</span>
        </button>

        {/* Search Tab */}
        <button
          onClick={() => {
            if (currentView !== 'browse') {
              setCurrentView('browse');
            }
            setTimeout(() => {
              const inputEl = document.getElementById('hero-search-input');
              if (inputEl) {
                inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                inputEl.focus();
              }
            }, 100);
          }}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-2.5 transition gap-1 ${
            currentView === 'browse' && searchQuery
              ? 'text-slate-950 font-black'
              : 'text-slate-400 hover:text-slate-600 font-medium'
          }`}
        >
          <Search className={`w-5.5 h-5.5 stroke-[2.2] transition-transform ${
            currentView === 'browse' && searchQuery ? 'scale-110 text-slate-900' : 'text-slate-400'
          }`} />
          <span className="text-[10px] tracking-tight">Search</span>
        </button>

        {/* Messages Tab */}
        <button
          onClick={() => {
            if (!currentUser) {
              setAuthMode('login');
              setShowAuthModal(true);
            } else {
              setCurrentView('chats');
            }
          }}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-2.5 transition gap-1 relative ${
            currentView === 'chats'
              ? 'text-slate-950 font-black'
              : 'text-slate-400 hover:text-slate-600 font-medium'
          }`}
        >
          <div className="relative">
            <MessageSquare className={`w-5.5 h-5.5 stroke-[2.2] transition-transform ${
              currentView === 'chats' ? 'scale-110 text-slate-900' : 'text-slate-400'
            }`} />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white font-extrabold text-[8px] min-w-[14px] h-[14px] px-1 rounded-full flex items-center justify-center shadow-xs border border-white animate-pulse">
                {unreadCount}
              </span>
            )}
          </div>
          <span className="text-[10px] tracking-tight">Messages</span>
        </button>

        {/* Profile Tab */}
        <button
          onClick={() => {
            if (!currentUser) {
              setAuthMode('login');
              setShowAuthModal(true);
            } else {
              setCurrentView('profile-settings');
            }
          }}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-2.5 transition gap-1 ${
            currentView === 'profile-settings' || currentView === 'my-dashboard'
              ? 'text-slate-950 font-black'
              : 'text-slate-400 hover:text-slate-600 font-medium'
          }`}
        >
          {currentUser && currentUser.photoUrl ? (
            <img
              src={currentUser.photoUrl}
              alt="Account Avatar"
              referrerPolicy="no-referrer"
              className={`w-6 h-6 rounded-full object-cover border-2 transition-all ${
                currentView === 'profile-settings' || currentView === 'my-dashboard'
                  ? 'border-slate-950 scale-110'
                  : 'border-transparent'
              }`}
            />
          ) : (
            <User className={`w-5.5 h-5.5 stroke-[2.2] transition-transform ${
              currentView === 'profile-settings' || currentView === 'my-dashboard' ? 'scale-110 text-slate-900' : 'text-slate-400'
            }`} />
          )}
          <span className="text-[10px] tracking-tight">Profile</span>
        </button>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MarketplaceContent />
    </AppProvider>
  );
}
