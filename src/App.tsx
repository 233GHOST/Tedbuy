import React, { useMemo, useRef, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Navbar } from './components/Navbar';
import { ProductCard } from './components/ProductCard';
import { ProductDetail } from './components/ProductDetail';
import { ChatInterface } from './components/ChatInterface';
import { SellerDashboard } from './components/SellerDashboard';
import { SellerProfilePage } from './components/SellerProfilePage';
import { ProfileSettings } from './components/ProfileSettings';
import { ListingModal } from './components/ListingModal';
import { PullToRefresh } from './components/PullToRefresh';
import { GhanaLocationFilter } from './components/GhanaLocationFilter';
import { Category, Product } from './types';
import { getRegionForLocation } from './regions';
import {
  ChevronLeft,
  ChevronRight,
  History,
  Home,
  LayoutGrid,
  MessageSquare,
  Package,
  Search,
  SlidersHorizontal,
  TrendingUp,
  User,
  X,
} from 'lucide-react';

const CATEGORY_ICONS: Record<Category, string> = {
  Phones: '📱',
  Laptops: '💻',
  Fashion: '👟',
  'Home Appliances': '🔌',
  Vehicles: '🚗',
  'Beauty and Care': '💄',
  Games: '🎮',
  Electronics: '⚡',
  Other: '📦',
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
    isProductsLoading,
    messages,
    chats,
    setAuthMode,
    recentlyViewedIds,
    clearRecentlyViewed,
    setSelectedProductId,
  } = useApp();

  const [isPostAdOpen, setIsPostAdOpen] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const categoriesScrollRef = useRef<HTMLDivElement>(null);

  const [selectedRegion, setSelectedRegion] = useState<string>('All');
  const [selectedCity, setSelectedCity] = useState<string>('All');
  const [sortByAds, setSortByAds] = useState<'newest' | 'oldest'>('newest');
  const [sortByPrice, setSortByPrice] = useState<'default' | 'asc' | 'desc'>('default');

  const hostname =
    typeof window !== 'undefined' ? window.location.hostname : 'development-domain';
  const preHostname = hostname.includes('-dev-')
    ? hostname.replace('-dev-', '-pre-')
    : null;

  const copyText = (value: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(value).catch(() => {});
    }
  };

  const handleScrollCategories = (direction: 'left' | 'right') => {
    if (!categoriesScrollRef.current) return;

    const { scrollLeft } = categoriesScrollRef.current;
    const scrollAmount = 240;

    categoriesScrollRef.current.scrollTo({
      left: direction === 'left' ? scrollLeft - scrollAmount : scrollLeft + scrollAmount,
      behavior: 'smooth',
    });
  };

  const parseNumericPrice = (price: string | number): number => {
    if (typeof price === 'number') return price;
    if (!price) return 0;

    const cleaned = String(price).replace(/[^0-9.]/g, '');
    const parsed = parseFloat(cleaned);

    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedCategory(null);
    setSelectedRegion('All');
    setSelectedCity('All');
    setSortByAds('newest');
    setSortByPrice('default');
  };

  const openProduct = (productId: string) => {
    setSelectedProductId(productId);
    setCurrentView('product-detail');
  };

  const recentlyViewedProducts = useMemo(() => {
    if (!recentlyViewedIds?.length) return [];

    return recentlyViewedIds
      .map((id) => products.find((p) => p.id === id))
      .filter((p): p is Product => Boolean(p));
  }, [recentlyViewedIds, products]);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const matchesCategory =
        !selectedCategory ||
        product.category === selectedCategory ||
        (product.category &&
          selectedCategory &&
          product.category.toLowerCase() === selectedCategory.toLowerCase());

      const query = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !query ||
        product.title.toLowerCase().includes(query) ||
        product.description.toLowerCase().includes(query) ||
        product.location.toLowerCase().includes(query) ||
        (product.category && product.category.toLowerCase().includes(query));

      let matchesRegion = true;
      if (selectedRegion !== 'All') {
        const productRegion = getRegionForLocation(product.location);
        matchesRegion = productRegion === selectedRegion;
      }

      let matchesCity = true;
      if (selectedCity !== 'All') {
        matchesCity = product.location.toLowerCase().includes(selectedCity.toLowerCase());
      }

      return matchesCategory && matchesSearch && matchesRegion && matchesCity;
    });
  }, [products, selectedCategory, searchQuery, selectedRegion, selectedCity]);

  const sortedProducts = useMemo(() => {
    return [...filteredProducts].sort((a, b) => {
      if (sortByPrice === 'asc') {
        const diff = parseNumericPrice(a.price) - parseNumericPrice(b.price);
        if (diff !== 0) return diff;
      }

      if (sortByPrice === 'desc') {
        const diff = parseNumericPrice(b.price) - parseNumericPrice(a.price);
        if (diff !== 0) return diff;
      }

      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;

      return sortByAds === 'oldest' ? dateA - dateB : dateB - dateA;
    });
  }, [filteredProducts, sortByAds, sortByPrice]);

  const unreadCount = useMemo(() => {
    if (!currentUser || !messages) return 0;

    return messages.filter((message) => {
      if (message.recipientId !== currentUser.id || message.read) return false;

      const chat = chats?.find((c) => c.id === message.chatId);
      if (chat?.tradeStatus === 'completed') return false;

      return true;
    }).length;
  }, [messages, chats, currentUser]);

  const resultTitle = useMemo(() => {
    if (searchQuery.trim()) return `Results for "${searchQuery}"`;
    if (selectedCategory) return `${selectedCategory} listings`;
    if (selectedRegion !== 'All' || selectedCity !== 'All') {
      return `${selectedRegion} Region${selectedCity !== 'All' ? ` - ${selectedCity}` : ''} Deals`;
    }
    return 'Latest Classified Deals';
  }, [searchQuery, selectedCategory, selectedRegion, selectedCity]);

  const handlePostAdBtn = () => {
    if (!currentUser) {
      setShowAuthModal(true);
      return;
    }

    setIsPostAdOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-[calc(72px+env(safe-area-inset-bottom))] md:pb-0">
      <Navbar />

      {unauthorizedDomainDetected && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3.5 text-amber-900 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 text-lg" role="img" aria-label="warning">
                ⚠️
              </span>

              <div>
                <p className="text-sm font-bold text-amber-950">
                  Firebase Unauthorized Domain Notice
                </p>

                <p className="mt-1 max-w-4xl text-xs leading-relaxed text-amber-800">
                  Google Sign-In was completed via a fallback sandbox profile because the current
                  domain is not yet added to your Firebase authorized domains list. To enable real
                  Google authentication, go to <strong>Firebase Console → Authentication → Settings → Authorized domains</strong> and add:
                </p>

                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <span className="select-all rounded border border-amber-200 bg-amber-100 px-2 py-1 font-mono text-[11px] font-medium text-amber-950">
                    {hostname}
                  </span>

                  <button
                    onClick={() => copyText(hostname)}
                    className="rounded border border-amber-300 bg-amber-600/10 px-2 py-1 text-[11px] font-bold text-amber-950 transition hover:bg-amber-600/15"
                  >
                    Copy
                  </button>

                  {preHostname && (
                    <>
                      <span className="select-all rounded border border-amber-200 bg-amber-100 px-2 py-1 font-mono text-[11px] font-medium text-amber-950">
                        {preHostname}
                      </span>

                      <button
                        onClick={() => copyText(preHostname)}
                        className="rounded border border-amber-300 bg-amber-600/10 px-2 py-1 text-[11px] font-bold text-amber-950 transition hover:bg-amber-600/15"
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
              className="shrink-0 rounded-lg border border-amber-200 px-2.5 py-1 text-xs font-bold text-amber-900 transition hover:bg-amber-100 hover:text-amber-950"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <main className="flex-1">
        {currentView === 'browse' && (
          <PullToRefresh>
            <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
              <div className="relative mb-6 flex flex-col gap-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 p-4 text-slate-900 shadow-sm sm:mb-8 sm:gap-6 sm:rounded-3xl sm:p-6 md:p-8">
                <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="text-left">
                    <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                      Tedbuy Ghana
                    </span>
                    <h1 className="text-xl font-black tracking-tight text-slate-950 sm:text-3xl">
                      Direct Local Market
                    </h1>
                  </div>

                  <button
                    id="hero-post-ad-btn"
                    onClick={handlePostAdBtn}
                    className="w-full rounded-xl bg-slate-900 px-5 py-3 text-center text-sm font-extrabold text-white shadow-sm transition hover:bg-slate-800 hover:shadow md:w-auto"
                  >
                    Post an Ad Free
                  </button>
                </div>

                <div className="relative z-10 w-full max-w-xl text-left">
                  <label className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-500">
                    looking for something?
                  </label>

                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                      <Search className="h-5 w-5 text-slate-400" />
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
                      className="block w-full rounded-2xl border-2 border-slate-300 bg-white py-3.5 pl-11 pr-10 text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none transition focus:border-slate-800 focus:ring-4 focus:ring-slate-100"
                    />

                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400 transition hover:text-slate-600"
                        title="Clear Search"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="pointer-events-none absolute left-1/4 top-1/2 h-48 w-48 -translate-y-1/2 rounded-full bg-slate-400/15 blur-3xl" />
                <div className="pointer-events-none absolute -right-24 -top-24 h-60 w-60 rounded-full bg-slate-400/10 blur-3xl" />
              </div>

              <section className="mb-6 space-y-4 text-left sm:mb-8">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="flex items-center gap-1.5 text-base font-extrabold tracking-tight text-slate-900">
                      <TrendingUp className="h-4 w-4 text-slate-900" />
                      <span>Explore Classified Categories</span>
                    </h2>

                    <button
                      onClick={() => setShowAllCategories((prev) => !prev)}
                      className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-700 transition hover:bg-slate-200 hover:text-slate-950"
                    >
                      <LayoutGrid className="h-3 w-3" />
                      <span>{showAllCategories ? 'Show Scroll' : 'View All Grid'}</span>
                    </button>
                  </div>

                  {selectedCategory && (
                    <button
                      id="clear-category-filter"
                      onClick={() => setSelectedCategory(null)}
                      className="text-xs font-semibold text-slate-600 transition hover:text-slate-950"
                    >
                      Clear Filter
                    </button>
                  )}
                </div>

                {showAllCategories ? (
                  <div className="grid grid-cols-2 gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 p-3 shadow-sm sm:grid-cols-3 sm:p-4 lg:grid-cols-6">
                    <button
                      id="category-tag-all-grid"
                      onClick={() => setSelectedCategory(null)}
                      className={`flex items-center gap-1.5 truncate rounded-xl border px-3 py-2.5 text-left text-xs font-bold transition ${
                        selectedCategory === null
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <span>🌐</span>
                      <span className="truncate">All Categories</span>
                    </button>

                    {(Object.keys(CATEGORY_ICONS) as Category[]).map((cat) => {
                      const active = selectedCategory === cat;

                      return (
                        <button
                          key={cat}
                          id={`category-tag-grid-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                          onClick={() => setSelectedCategory(cat)}
                          className={`flex items-center gap-1.5 truncate rounded-xl border px-3 py-2.5 text-left text-xs font-bold transition ${
                            active
                              ? 'border-slate-900 bg-slate-900 text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <span className="shrink-0 text-sm leading-none">{CATEGORY_ICONS[cat]}</span>
                          <span className="truncate">{cat}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="relative flex items-center">
                    <button
                      onClick={() => handleScrollCategories('left')}
                      className="absolute -left-2 z-10 hidden h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-md transition hover:bg-slate-50 hover:text-slate-950 md:flex"
                      aria-label="Scroll categories left"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>

                    <div
                      ref={categoriesScrollRef}
                      className="flex w-full snap-x snap-mandatory gap-2 overflow-x-auto px-0 pb-2 scroll-smooth md:px-7 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                      <button
                        id="category-tag-all"
                        onClick={() => setSelectedCategory(null)}
                        className={`shrink-0 snap-start whitespace-nowrap rounded-xl border px-4 py-2.5 text-xs font-bold transition ${
                          selectedCategory === null
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span className="mr-1.5">🌐</span>
                        <span>All Categories</span>
                      </button>

                      {(Object.keys(CATEGORY_ICONS) as Category[]).map((cat) => {
                        const active = selectedCategory === cat;

                        return (
                          <button
                            key={cat}
                            id={`category-tag-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                            onClick={() => setSelectedCategory(cat)}
                            className={`shrink-0 snap-start whitespace-nowrap rounded-xl border px-4 py-2.5 text-xs font-bold transition ${
                              active
                                ? 'border-slate-900 bg-slate-900 text-white'
                                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            <span className="mr-1.5 text-sm leading-none">{CATEGORY_ICONS[cat]}</span>
                            <span>{cat}</span>
                          </button>
                        );
                      })}
                    </div>

                    <button
                      onClick={() => handleScrollCategories('right')}
                      className="absolute -right-2 z-10 hidden h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-md transition hover:bg-slate-50 hover:text-slate-950 md:flex"
                      aria-label="Scroll categories right"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </section>

              <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-4">
                <aside className="hidden space-y-4 lg:sticky lg:top-24 lg:col-span-1 lg:block">
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
                      className="space-y-3.5 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm"
                    >
                      <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                        <div className="flex items-center gap-1.5 text-slate-800">
                          <History className="h-4 w-4 shrink-0 text-slate-600" />
                          <h4 className="text-xs font-black uppercase tracking-tight text-slate-900">
                            Recently Viewed
                          </h4>
                        </div>

                        <button
                          onClick={clearRecentlyViewed}
                          className="rounded-md px-1.5 py-0.5 text-[10px] font-extrabold text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                          title="Clear history list"
                        >
                          Clear
                        </button>
                      </div>

                      <div className="space-y-2.5">
                        {recentlyViewedProducts.map((product) => {
                          const numericPrice = parseNumericPrice(product.price);
                          const formattedPrice =
                            numericPrice > 0
                              ? `GH₵${numericPrice.toLocaleString()}`
                              : 'Contact Seller';

                          return (
                            <div
                              key={product.id}
                              id={`recently-viewed-item-${product.id}`}
                              onClick={() => openProduct(product.id)}
                              className="group flex cursor-pointer items-center gap-3 rounded-xl p-1 transition hover:bg-slate-50"
                            >
                              <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                                <img
                                  src={
                                    product.images?.[0] ||
                                    'https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&w=120&q=80'
                                  }
                                  alt={product.title}
                                  referrerPolicy="no-referrer"
                                  className="h-full w-full object-cover transition duration-300 group-hover:scale-110"
                                />
                              </div>

                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[11px] font-bold leading-tight text-slate-800 transition group-hover:text-slate-950">
                                  {product.title}
                                </p>
                                <p className="mt-0.5 text-[10px] font-black text-slate-900">
                                  {formattedPrice}
                                </p>
                                <p className="mt-0.5 truncate text-[9px] text-slate-400">
                                  {product.location}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </aside>

                <div className="space-y-6 lg:col-span-3">
                  {recentlyViewedProducts.length > 0 && (
                    <div className="lg:hidden">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-slate-800">
                          <History className="h-4 w-4 text-slate-600" />
                          <h4 className="text-xs font-black uppercase tracking-tight text-slate-900">
                            Recently Viewed
                          </h4>
                        </div>

                        <button
                          onClick={clearRecentlyViewed}
                          className="text-[10px] font-extrabold text-slate-400 transition hover:text-red-500"
                        >
                          Clear
                        </button>
                      </div>

                      <div className="flex gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {recentlyViewedProducts.map((product) => {
                          const numericPrice = parseNumericPrice(product.price);
                          const formattedPrice =
                            numericPrice > 0
                              ? `GH₵${numericPrice.toLocaleString()}`
                              : 'Contact Seller';

                          return (
                            <button
                              key={product.id}
                              onClick={() => openProduct(product.id)}
                              className="min-w-[220px] flex-shrink-0 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm"
                            >
                              <div className="mb-2 h-28 overflow-hidden rounded-xl bg-slate-100">
                                <img
                                  src={
                                    product.images?.[0] ||
                                    'https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&w=240&q=80'
                                  }
                                  alt={product.title}
                                  referrerPolicy="no-referrer"
                                  className="h-full w-full object-cover"
                                />
                              </div>

                              <p className="truncate text-xs font-bold text-slate-900">
                                {product.title}
                              </p>
                              <p className="mt-1 text-xs font-extrabold text-slate-800">
                                {formattedPrice}
                              </p>
                              <p className="mt-1 truncate text-[11px] text-slate-500">
                                {product.location}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <section className="space-y-6">
                    <div className="space-y-4 border-b border-slate-200 pb-4 text-left">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">
                            {resultTitle}
                          </h3>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {filteredProducts.length} active listings found
                          </p>
                        </div>

                        <button
                          onClick={() => setShowMobileFilters(true)}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 lg:hidden"
                        >
                          <SlidersHorizontal className="h-4 w-4" />
                          Filters
                        </button>
                      </div>

                      <div className="hidden flex-wrap items-center gap-3.5 lg:flex">
                        <div className="flex items-center gap-1.5">
                          <label
                            htmlFor="sort-ads"
                            className="whitespace-nowrap text-xs font-bold text-slate-500"
                          >
                            Sort Ads:
                          </label>
                          <select
                            id="sort-ads"
                            value={sortByAds}
                            onChange={(e) =>
                              setSortByAds(e.target.value as 'newest' | 'oldest')
                            }
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none transition hover:border-slate-300 focus:ring-2 focus:ring-slate-200"
                          >
                            <option value="newest">Newest First</option>
                            <option value="oldest">Oldest First</option>
                          </select>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <label
                            htmlFor="sort-price"
                            className="whitespace-nowrap text-xs font-bold text-slate-500"
                          >
                            Sort Price:
                          </label>
                          <select
                            id="sort-price"
                            value={sortByPrice}
                            onChange={(e) =>
                              setSortByPrice(e.target.value as 'default' | 'asc' | 'desc')
                            }
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none transition hover:border-slate-300 focus:ring-2 focus:ring-slate-200"
                          >
                            <option value="default">All Prices</option>
                            <option value="asc">Low to High</option>
                            <option value="desc">High to Low</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {isProductsLoading ? (
                      <div
                        id="listings-shimmer-grid"
                        className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:gap-5 lg:grid-cols-3 lg:gap-6"
                      >
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                          <div
                            key={i}
                            className="flex min-h-[280px] flex-col justify-between space-y-4 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm animate-pulse"
                          >
                            <div className="h-40 w-full rounded-2xl bg-slate-100" />
                            <div className="flex-1 space-y-2 pt-1">
                              <div className="h-4 w-3/4 rounded-md bg-slate-100" />
                              <div className="h-3 w-1/2 rounded-md bg-slate-100" />
                            </div>
                            <div className="mt-2 h-5 w-1/3 rounded-md bg-slate-100" />
                          </div>
                        ))}
                      </div>
                    ) : sortedProducts.length === 0 ? (
                      <div
                        id="no-products-found"
                        className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:rounded-3xl sm:p-16"
                      >
                        <Package className="mx-auto mb-2 h-14 w-14 text-slate-300" />
                        <h4 className="text-sm font-bold text-slate-800">
                          No postings matching your parameters
                        </h4>
                        <p className="mb-5 mt-1 text-xs text-slate-500">
                          We couldn&apos;t find any listings matching your search or location
                          settings. Try broader keywords or select &quot;All Regions&quot; to see
                          more options.
                        </p>
                        <button
                          onClick={handleResetFilters}
                          className="rounded-xl bg-slate-900 px-4.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800"
                        >
                          Reset All Filters
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:gap-5 lg:grid-cols-3 lg:gap-6">
                        {sortedProducts.map((product) => (
                          <ProductCard key={product.id} product={product} />
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </div>
          </PullToRefresh>
        )}

        {currentView === 'product-detail' && <ProductDetail />}
        {currentView === 'chats' && <ChatInterface />}
        {currentView === 'my-dashboard' && <SellerDashboard />}
        {currentView === 'seller-profile' && <SellerProfilePage />}
        {currentView === 'profile-settings' && <ProfileSettings />}
      </main>

      <footer className="mt-10 border-t border-slate-200 bg-white py-6 text-xs text-slate-500 sm:py-8">
        <div className="mx-auto max-w-7xl px-4 text-center space-y-2">
          <p className="font-bold text-slate-800">Tedbuy Classifieds Marketplace &copy; 2026</p>
          <p className="mx-auto max-w-md text-[11px] leading-relaxed text-slate-400">
            Connecting local buyers and sellers across Ghana directly. Browse tech, appliances,
            and fashion safely in your region.
          </p>
        </div>
      </footer>

      <ListingModal isOpen={isPostAdOpen} onClose={() => setIsPostAdOpen(false)} />

      {showMobileFilters && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowMobileFilters(false)}
            aria-label="Close filters"
          />

          <div className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-300" />

            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-sm font-black text-slate-900">Filters &amp; Sort</h4>

              <button
                onClick={() => setShowMobileFilters(false)}
                className="rounded-full p-2 transition hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <GhanaLocationFilter
                selectedRegion={selectedRegion}
                setSelectedRegion={setSelectedRegion}
                selectedCity={selectedCity}
                setSelectedCity={setSelectedCity}
                products={products}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="mobile-sort-ads" className="text-xs font-bold text-slate-500">
                    Sort Ads
                  </label>
                  <select
                    id="mobile-sort-ads"
                    value={sortByAds}
                    onChange={(e) => setSortByAds(e.target.value as 'newest' | 'oldest')}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="mobile-sort-price"
                    className="text-xs font-bold text-slate-500"
                  >
                    Sort Price
                  </label>
                  <select
                    id="mobile-sort-price"
                    value={sortByPrice}
                    onChange={(e) =>
                      setSortByPrice(e.target.value as 'default' | 'asc' | 'desc')
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="default">All Prices</option>
                    <option value="asc">Low to High</option>
                    <option value="desc">High to Low</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleResetFilters}
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-xs font-bold text-slate-700"
                >
                  Reset
                </button>

                <button
                  onClick={() => setShowMobileFilters(false)}
                  className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-xs font-bold text-white"
                >
                  Show Results
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-slate-200/80 bg-white/95 px-3 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.05)] backdrop-blur-md md:hidden">
        <button
          onClick={() => {
            setCurrentView('browse');
            setSearchQuery('');
          }}
          className={`flex flex-1 flex-col items-center justify-center gap-1 px-2.5 py-1 transition ${
            currentView === 'browse'
              ? 'font-black text-slate-950'
              : 'font-medium text-slate-400 hover:text-slate-600'
          }`}
        >
          <Home
            className={`h-5 w-5 transition-transform ${
              currentView === 'browse' ? 'scale-110 text-slate-900' : 'text-slate-400'
            }`}
          />
          <span className="text-[10px] tracking-tight">Home</span>
        </button>

        <button
          onClick={() => {
            if (currentView !== 'browse') {
              setCurrentView('browse');
            }

            setTimeout(() => {
              const inputEl = document.getElementById('hero-search-input') as
                | HTMLInputElement
                | null;

              if (inputEl) {
                inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                inputEl.focus();
              }
            }, 120);
          }}
          className={`flex flex-1 flex-col items-center justify-center gap-1 px-2.5 py-1 transition ${
            currentView === 'browse' && searchQuery
              ? 'font-black text-slate-950'
              : 'font-medium text-slate-400 hover:text-slate-600'
          }`}
        >
          <Search
            className={`h-5 w-5 transition-transform ${
              currentView === 'browse' && searchQuery
                ? 'scale-110 text-slate-900'
                : 'text-slate-400'
            }`}
          />
          <span className="text-[10px] tracking-tight">Search</span>
        </button>

        <button
          onClick={() => {
            if (!currentUser) {
              setAuthMode('login');
              setShowAuthModal(true);
            } else {
              setCurrentView('chats');
            }
          }}
          className={`relative flex flex-1 flex-col items-center justify-center gap-1 px-2.5 py-1 transition ${
            currentView === 'chats'
              ? 'font-black text-slate-950'
              : 'font-medium text-slate-400 hover:text-slate-600'
          }`}
        >
          <div className="relative">
            <MessageSquare
              className={`h-5 w-5 transition-transform ${
                currentView === 'chats' ? 'scale-110 text-slate-900' : 'text-slate-400'
              }`}
            />
            {unreadCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full border border-white bg-rose-500 px-1 text-[8px] font-extrabold text-white shadow-sm">
                {unreadCount}
              </span>
            )}
          </div>
          <span className="text-[10px] tracking-tight">Messages</span>
        </button>

        <button
          onClick={() => {
            if (!currentUser) {
              setAuthMode('login');
              setShowAuthModal(true);
            } else {
              setCurrentView('profile-settings');
            }
          }}
          className={`flex flex-1 flex-col items-center justify-center gap-1 px-2.5 py-1 transition ${
            currentView === 'profile-settings' || currentView === 'my-dashboard'
              ? 'font-black text-slate-950'
              : 'font-medium text-slate-400 hover:text-slate-600'
          }`}
        >
          {currentUser?.photoUrl ? (
            <img
              src={currentUser.photoUrl}
              alt="Account Avatar"
              referrerPolicy="no-referrer"
              className={`h-6 w-6 rounded-full border-2 object-cover transition-all ${
                currentView === 'profile-settings' || currentView === 'my-dashboard'
                  ? 'scale-110 border-slate-950'
                  : 'border-transparent'
              }`}
            />
          ) : (
            <User
              className={`h-5 w-5 transition-transform ${
                currentView === 'profile-settings' || currentView === 'my-dashboard'
                  ? 'scale-110 text-slate-900'
                  : 'text-slate-400'
              }`}
            />
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
