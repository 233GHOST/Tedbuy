import React, { useState, useMemo, useRef } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Navbar } from './components/Navbar';
import { ProductCard } from './components/ProductCard';
import { ProductDetail } from './components/ProductDetail';
import { ChatInterface } from './components/ChatInterface';
import { SellerDashboard } from './components/SellerDashboard';
import { SellerProfilePage } from './components/SellerProfilePage';
import { ProfileSettings } from './components/ProfileSettings';
import { ListingModal } from './components/ListingModal';
import { VideoAdsFeed } from './components/VideoAdsFeed';
import { Category, Product } from './types';
import { Sparkles, ShoppingBag, X, Check, Search, TrendingUp, HelpCircle, Package, MapPin, ChevronLeft, ChevronRight, Grid, LayoutGrid, Home, User, MessageSquare, History, RefreshCw, SlidersHorizontal, PlusCircle, Video, AlertCircle, Info } from 'lucide-react';
import { GhanaLocationFilter } from './components/GhanaLocationFilter';
import { getRegionForLocation } from './regions';
import { VerificationBlockModal } from './components/VerificationBlockModal';
import { WebMCPInitializer } from './components/WebMCPInitializer';
import { createProductSelector } from './utils/productSelector';

const selectProducts = createProductSelector();

const CATEGORY_ICONS: { [key in Category]: string } = {
  Phones: '📱',
  Laptops: '💻',
  Fashion: '👟',
  'Home Appliances': '🔌',
  Vehicles: '🚗',
  'Beauty and Care': '💄',
  Games: '🎮',
  Electronics: '⚡',
  Services: '🛠️',
  Other: '📦'
};

const MarketplaceContent: React.FC = () => {
  const {
    products,
    hasMoreProducts,
    loadMoreProducts,
    users,
    currentView,
    setCurrentView,
    homeViewMode,
    setHomeViewMode,
    searchQuery,
    debouncedSearchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    currentUser,
    setShowAuthModal,
    unauthorizedDomainDetected,
    setUnauthorizedDomainDetected,
    isAuthLoading,
    isProductsLoading,
    messages,
    chats,
    setAuthMode,
    recentlyViewedIds,
    clearRecentlyViewed,
    selectedProductId,
    setSelectedProductId,
    selectedSellerId,
    refreshProducts,
    toast,
    hideToast,
    isVerificationBlockOpen,
    setIsVerificationBlockOpen,
    blockedActionType,
    setBlockedActionType
  } = useApp();

  // Toast automatic dismiss timer
  React.useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        hideToast();
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [toast, hideToast]);

  // Listen to window scroll when currentView is 'browse' and persist it
  React.useEffect(() => {
    const handleScroll = () => {
      if (currentView === 'browse') {
        const posY = window.scrollY;
        if (posY > 0) {
          sessionStorage.setItem('tedbuy_browse_scroll_pos', String(posY));
        }
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [currentView]);

  // Restore scroll position when entering 'browse'
  React.useEffect(() => {
    if (currentView === 'browse') {
      const saved = sessionStorage.getItem('tedbuy_browse_scroll_pos');
      if (saved) {
        const posY = parseInt(saved, 10);
        if (posY > 0) {
          const timer1 = setTimeout(() => {
            window.scrollTo({ top: posY, behavior: 'auto' });
          }, 30);
          const timer2 = setTimeout(() => {
            window.scrollTo({ top: posY, behavior: 'auto' });
          }, 100);
          const timer3 = setTimeout(() => {
            window.scrollTo({ top: posY, behavior: 'auto' });
          }, 300);
          return () => {
            clearTimeout(timer1);
            clearTimeout(timer2);
            clearTimeout(timer3);
          };
        }
      }
    }
  }, [currentView]);

  // Dynamically lock the parent web page scrolling on mobile devices when watching video ads
  React.useEffect(() => {
    const isVideoFeed = currentView === 'browse' && homeViewMode === 'video-feed';
    if (isVideoFeed) {
      const isMobile = window.innerWidth < 768;
      if (isMobile) {
        document.body.style.overflow = 'hidden';
        document.body.style.height = '100%';
        document.documentElement.style.overflow = 'hidden';
        document.documentElement.style.height = '100%';
      }
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.height = '';
      document.documentElement.style.overflow = '';
      document.documentElement.style.height = '';
    };
  }, [currentView, homeViewMode]);

  // Dynamic Document Title and Meta Description for Client-Side SEO indexing
  React.useEffect(() => {
    let title = 'Tedbuy Ghana - Verified Classifieds Marketplace';
    let description = 'Shop safely on Tedbuy Ghana. Peer-verified electronics, phones, laptops, sneakers, fashion, and other listings with zero hidden fees and direct trade.';

    if (currentView === 'product-detail' && selectedProductId) {
      const product = products.find(p => p.id === selectedProductId);
      if (product) {
        const productPrice = typeof product.price === 'number'
          ? `GHS ${product.price.toLocaleString()}`
          : String(product.price).startsWith('GHS')
            ? product.price
            : `GHS ${product.price}`;
        title = `${product.title} - ${productPrice} | Tedbuy Ghana`;
        description = product.description
          ? (product.description.length > 155 ? product.description.substring(0, 155) + '...' : product.description)
          : `Buy ${product.title} for ${productPrice} on Tedbuy Ghana. Category: ${product.category}. Verified seller trades.`;
      }
    } else if (currentView === 'seller-profile' && selectedSellerId) {
      const seller = users?.find(u => u.id === selectedSellerId);
      if (seller) {
        title = `${seller.username || 'Verified Seller'}'s Shop & Ads | Tedbuy Ghana`;
        description = `Browse listing offers, ratings, and verified products posted by ${seller.username || 'Verified Seller'} in Ghana. Trade directly on Tedbuy.`;
      }
    } else if (currentView === 'chats') {
      title = 'My Messages & Active Chats | Tedbuy Ghana';
      description = 'Securely message buyers and sellers to negotiate and agree on deal meetups on Tedbuy Ghana.';
    } else if (currentView === 'my-dashboard') {
      title = 'Seller Dashboard & My Ads | Tedbuy Ghana';
      description = 'Manage your live classified advertisements, check incoming chats, edit pricing, or promote your listings.';
    } else if (currentView === 'profile-settings') {
      title = 'Account Settings & Verification | Tedbuy Ghana';
      description = 'Update your profile information, phone numbers, location, and verify your ID to gain trustworthiness on Tedbuy.';
    } else if (selectedCategory) {
      title = `Buy Verified ${selectedCategory} in Ghana | Tedbuy`;
      description = `Find amazing deals on checked ${selectedCategory} with reviews on Tedbuy Ghana. Direct, premium classifieds.`;
    }

    // Set Document Title
    document.title = title;

    // Set Description Meta Tag
    let metaDescription = document.querySelector('meta[name="description"]');
    if (!metaDescription) {
      metaDescription = document.createElement('meta');
      metaDescription.setAttribute('name', 'description');
      document.head.appendChild(metaDescription);
    }
    metaDescription.setAttribute('content', description);

    // Update Open Graph tags dynamically for client-side sharing indexers
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', title);

    const ogDescription = document.querySelector('meta[property="og:description"]');
    if (ogDescription) ogDescription.setAttribute('content', description);

  }, [currentView, selectedProductId, selectedSellerId, products, users, selectedCategory]);

  // Mobile pull-to-refresh touch tracking (Ref-based optimize for mobile GPU and re-render prevention)
  const [isPulling, setIsPulling] = useState(false);
  const touchStartY = useRef(0);
  const pullIndicatorRef = useRef<HTMLDivElement>(null);
  const pullIconRef = useRef<any>(null);
  const pullTextRef = useRef<HTMLSpanElement>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (homeViewMode === 'video-feed') return;
    // Only detect pull when scrolled to the top of window
    if (window.scrollY === 0) {
      touchStartY.current = e.touches[0].clientY;
      setIsPulling(true);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (homeViewMode === 'video-feed') return;
    if (!isPulling) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - touchStartY.current;
    if (diff > 0) {
      // Fluid pulling resistance
      const resistance = Math.min(diff * 0.35, 80);
      
      const indicator = pullIndicatorRef.current;
      const icon = pullIconRef.current;
      const txt = pullTextRef.current;
      
      if (indicator) {
        indicator.style.display = 'flex';
        indicator.style.height = `${resistance}px`;
        indicator.style.opacity = `${Math.min(resistance / 30, 1)}`;
      }
      if (icon) {
        if (resistance >= 55) {
          icon.style.transform = 'rotate(180deg)';
          icon.style.color = '#0f172a'; // slate-900
        } else {
          icon.style.transform = 'rotate(0deg)';
          icon.style.color = '#94a3b8'; // slate-400
        }
      }
      if (txt) {
        txt.textContent = resistance >= 55 ? 'Release to reload deals...' : 'Pull down to refresh deals';
      }

      // Suppress default refresh behaviors if we have successfully started pulling
      if (diff > 15 && e.cancelable) {
        e.preventDefault();
      }
    }
  };

  const handleTouchEnd = () => {
    setIsPulling(false);
    const indicator = pullIndicatorRef.current;
    const icon = pullIconRef.current;
    const txt = pullTextRef.current;
    
    if (indicator) {
      const currentHeight = parseFloat(indicator.style.height) || 0;
      if (currentHeight >= 55) {
        if (icon) {
          icon.classList.add('animate-spin');
        }
        if (txt) {
          txt.textContent = 'Reloading listings...';
        }
        refreshProducts().finally(() => {
          if (indicator) {
            indicator.style.height = '0px';
            indicator.style.opacity = '0';
            indicator.style.display = 'none';
          }
          if (icon) {
            icon.classList.remove('animate-spin');
            icon.style.transform = 'rotate(0deg)';
          }
        });
      } else {
        indicator.style.height = '0px';
        indicator.style.opacity = '0';
        indicator.style.display = 'none';
      }
    }
  };

  const recentlyViewedProducts = useMemo(() => {
    if (!recentlyViewedIds || recentlyViewedIds.length === 0) return [];
    return recentlyViewedIds
      .map(id => products.find(p => p.id === id))
      .filter((p): p is Product => !!p);
  }, [recentlyViewedIds, products]);

  const [isPostAdOpen, setIsPostAdOpen] = useState(false);

  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('tedbuy_recent_searches');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const saveSearchTerm = (term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    setRecentSearches(prev => {
      const filtered = prev.filter(t => t.toLowerCase() !== trimmed.toLowerCase());
      const updated = [trimmed, ...filtered].slice(0, 5);
      localStorage.setItem('tedbuy_recent_searches', JSON.stringify(updated));
      return updated;
    });
  };

  const removeRecentSearch = (termToRemove: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setRecentSearches(prev => {
      const updated = prev.filter(t => t !== termToRemove);
      localStorage.setItem('tedbuy_recent_searches', JSON.stringify(updated));
      return updated;
    });
  };

  const filteredCategories = useMemo(() => {
    const categoriesList = Object.keys(CATEGORY_ICONS) as Category[];
    if (!searchQuery.trim()) return categoriesList.slice(0, 6);
    return categoriesList.filter(cat =>
      cat.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery]);

  const filteredRecentSearches = useMemo(() => {
    if (!searchQuery.trim()) return recentSearches;
    return recentSearches.filter(term =>
      term.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [recentSearches, searchQuery]);

  const filteredPopularKeywords = useMemo(() => {
    const popularSearchedKeywords = [
      'iPhone',
      'Laptop',
      'Sneakers',
      'Toyota',
      'PS5',
      'AirPods',
      'Sofa',
      'Fridge',
      'Smart Watch'
    ];
    if (!searchQuery.trim()) return popularSearchedKeywords.slice(0, 4);
    return popularSearchedKeywords.filter(keyword =>
      keyword.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !recentSearches.some(term => term.toLowerCase() === keyword.toLowerCase())
    );
  }, [searchQuery, recentSearches]);

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
  const [minPrice, setMinPrice] = useState<string>('');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [sortByAds, setSortByAds] = useState<'newest' | 'oldest'>('newest');
  const [sortByPrice, setSortByPrice] = useState<'default' | 'asc' | 'desc'>('default');
  const [displayLimit, setDisplayLimit] = useState<number>(12);
  const scrollSentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset pagination limit when any filter parameters change to ensure fast and lightweight mobile rendering
  React.useEffect(() => {
    setDisplayLimit(12);
  }, [selectedCategory, debouncedSearchQuery, selectedRegion, selectedCity, minPrice, maxPrice, sortByPrice, sortByAds]);



  // Filter and sort listings based on category, search query, region, city, and price range using the memoized selector
  const sortedProducts = useMemo(() => {
    return selectProducts(
      products,
      selectedCategory,
      debouncedSearchQuery,
      selectedRegion,
      selectedCity,
      minPrice,
      maxPrice,
      sortByPrice,
      sortByAds
    );
  }, [products, selectedCategory, debouncedSearchQuery, selectedRegion, selectedCity, minPrice, maxPrice, sortByPrice, sortByAds]);

  React.useEffect(() => {
    const sentinel = scrollSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry.isIntersecting) {
        setDisplayLimit((prev) => {
          return prev + 12;
        });
        if (hasMoreProducts) {
          loadMoreProducts();
        }
      }
    }, {
      rootMargin: '200px', // start loading before the user completely reaches the bottom
      threshold: 0.1
    });

    observer.observe(sentinel);
    return () => {
      observer.unobserve(sentinel);
    };
  }, [scrollSentinelRef.current, sortedProducts.length, hasMoreProducts, loadMoreProducts]);

  const handlePostAdBtn = () => {
    if (!currentUser) {
      setShowAuthModal(true);
      return;
    }
    if (!currentUser.emailVerified) {
      setBlockedActionType('post-ad');
      setIsVerificationBlockOpen(true);
      return;
    }
    setIsPostAdOpen(true);
  };

  const unreadCount = useMemo(() => {
    if (!currentUser || !messages) return 0;
    return messages.filter(m => {
      if (m.recipientId !== currentUser.id || m.read) return false;
      const ch = chats.find(c => c.id === m.chatId);
      return !ch || ch.tradeStatus !== 'completed';
    }).length;
  }, [messages, chats, currentUser]);

  const isVideoFeedMobile = currentView === 'browse' && homeViewMode === 'video-feed';

  return (
    <div className={`flex flex-col font-sans relative ${
      currentView === 'browse' && homeViewMode === 'video-feed'
        ? 'bg-slate-50 max-sm:bg-slate-900 h-[100dvh] overflow-hidden pb-[76px] sm:pb-0'
        : 'bg-slate-50 min-h-screen pb-16 md:pb-0'
    }`}>
      <Navbar />

      {currentUser && !currentUser.emailVerified && (
        <div id="unverified-email-banner" className="bg-amber-500 text-amber-950 px-4 py-2.5 text-xs font-semibold flex flex-col md:flex-row items-center justify-between gap-3 shadow-inner border-b border-amber-600/35 relative z-30">
          <div className="flex items-center gap-2 text-center md:text-left">
            <span className="text-sm">📧</span>
            <span>
              Your email <strong className="font-extrabold font-mono">{currentUser.email}</strong> is not yet verified. Please verify your address to post ads, start negotiations, and unlock all features.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0 animate-pulse-slow">
            <button 
              onClick={() => {
                setBlockedActionType(null);
                setIsVerificationBlockOpen(true);
              }}
              className="bg-amber-950 hover:bg-amber-900 text-white font-extrabold border-none px-4 py-2 rounded-xl cursor-pointer transition text-[10px] uppercase tracking-wider shadow-2xs hover:scale-[1.02] duration-150 active:scale-95"
            >
              Verify Status
            </button>
          </div>
        </div>
      )}

      <main className={`flex-1 min-h-0 ${currentView === 'browse' && homeViewMode === 'video-feed' ? 'overflow-hidden flex flex-col h-full' : ''}`}>
        {currentView === 'browse' && (
          <div 
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className={`max-w-7xl mx-auto w-full flex-1 flex flex-col min-h-0 ${
              homeViewMode === 'video-feed'
                ? 'px-0 sm:px-6 lg:px-8 py-0 sm:py-6 h-full overflow-hidden'
                : 'px-4 sm:px-6 lg:px-8 py-6'
            }`}
          >
            {/* Smooth Pull to Refresh indicator */}
            {homeViewMode !== 'video-feed' && (
              <div 
                ref={pullIndicatorRef}
                className="hidden items-center justify-center gap-2 overflow-hidden transition-all duration-150 text-slate-550 font-sans font-bold text-xs bg-slate-50 border border-slate-200/50 py-2.5 rounded-2xl mb-4"
                style={{ height: '0px', opacity: 0 }}
              >
                <span ref={pullIconRef} className="transition-transform duration-200 flex items-center justify-center">
                  <RefreshCw className="w-4 h-4 text-slate-400" />
                </span>
                <span ref={pullTextRef}>Pull down to refresh deals</span>
              </div>
            )}
            
            {homeViewMode !== 'video-feed' && (
              /* Promotional Marketplace Hero Badge */
              <div className="relative mb-8 bg-slate-100 border border-slate-200 text-slate-900 rounded-3xl p-6 sm:p-8 overflow-hidden shadow-xs flex flex-col gap-6">
                {/* Hidden programmatic click trigger so video empty-state CTA remains completely functional */}
                <button id="hero-post-ad-btn" onClick={handlePostAdBtn} className="hidden" />

              {/* Prominent Search bar integrated under the Title as requested */}
              <div className="relative z-30 max-w-xl text-left w-full">
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
                    onFocus={() => setIsSearchFocused(true)}
                    onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        saveSearchTerm(searchQuery);
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
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

                  {/* Enhanced Autocomplete Suggestion Dropdown Panel */}
                  {isSearchFocused && (
                    <div className="absolute left-0 right-0 mt-2 bg-white border border-slate-200 shadow-2xl rounded-2xl z-50 overflow-hidden divide-y divide-slate-100 max-h-96 overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-150">
                      {/* Recent Search Terms */}
                      {filteredRecentSearches.length > 0 && (
                        <div className="p-3">
                          <div className="flex items-center justify-between text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2 px-2">
                            <span className="flex items-center gap-1.5">
                              <History className="w-3.5 h-3.5" /> Recent Searches
                            </span>
                            <button
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setRecentSearches([]);
                                localStorage.removeItem('tedbuy_recent_searches');
                              }}
                              className="text-[10px] text-slate-400 hover:text-slate-950 underline font-bold outline-none cursor-pointer"
                            >
                              Clear All
                            </button>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            {filteredRecentSearches.map((term, idx) => (
                              <div
                                key={idx}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  setSearchQuery(term);
                                  saveSearchTerm(term);
                                  setIsSearchFocused(false);
                                }}
                                className="group flex items-center justify-between px-2 py-1.5 hover:bg-slate-50 rounded-xl cursor-pointer transition text-left text-sm font-semibold text-slate-700 hover:text-slate-950"
                              >
                                <span className="flex items-center gap-2">
                                  <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600" />
                                  <span>{term}</span>
                                </span>
                                <button
                                  onMouseDown={(e) => removeRecentSearch(term, e)}
                                  className="text-slate-400 hover:text-rose-600 p-1 rounded-md transition hover:bg-slate-100"
                                  title="Remove keyword"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Suggested categories list */}
                      {filteredCategories.length > 0 && (
                        <div className="p-3">
                          <div className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2 px-2 flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-slate-400" />
                            Suggested Categories
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            {filteredCategories.map((cat, idx) => (
                              <button
                                key={idx}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  setSelectedCategory(cat);
                                  setSearchQuery('');
                                  setIsSearchFocused(false);
                                  if (currentView !== 'browse') setCurrentView('browse');
                                }}
                                className="flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 rounded-xl transition text-left text-xs font-bold text-slate-700 hover:text-slate-950 outline-none cursor-pointer"
                              >
                                <span className="text-base select-none">{CATEGORY_ICONS[cat] || '📦'}</span>
                                <span className="truncate">{cat}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Popular Search Suggestions */}
                      {filteredPopularKeywords.length > 0 && (
                        <div className="p-3">
                          <div className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2 px-2 flex items-center gap-1.5">
                            <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
                            Popular Searches
                          </div>
                          <div className="flex flex-wrap gap-1.5 px-1.5">
                            {filteredPopularKeywords.map((keyword, idx) => (
                              <button
                                key={idx}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  setSearchQuery(keyword);
                                  saveSearchTerm(keyword);
                                  setIsSearchFocused(false);
                                  if (currentView !== 'browse') setCurrentView('browse');
                                }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100/75 hover:bg-slate-200/75 rounded-full text-xs font-bold text-slate-650 hover:text-slate-900 transition outline-none cursor-pointer"
                              >
                                <TrendingUp className="w-3 h-3 text-slate-400" />
                                {keyword}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {filteredRecentSearches.length === 0 && filteredCategories.length === 0 && filteredPopularKeywords.length === 0 && (
                        <div className="p-6 text-center text-xs font-semibold text-slate-450">
                          Try searching for "phones", "laptops", or "fashion"!
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Decorative radial glows */}
              <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-48 h-48 bg-slate-400/15 rounded-full blur-3xl pointer-events-none"></div>
              <div className="absolute -right-24 -top-24 w-60 h-60 bg-slate-400/10 rounded-full blur-3xl pointer-events-none"></div>
            </div>
            )}

            {/* View Mode Switching Tabs (Standard Grid vs Live Video Ads Feed) */}
            <div className={`bg-slate-200/50 p-1 rounded-2xl font-sans max-w-sm border border-slate-250/60 ${
              homeViewMode === 'video-feed' ? 'hidden sm:flex mb-2 sm:mx-0 mt-2 sm:mt-0' : 'flex mb-8'
            }`}>
              <button
                id="tab-view-grid"
                onClick={() => setHomeViewMode('grid')}
                className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition duration-200 cursor-pointer outline-none ${
                  homeViewMode === 'grid'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/30'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
                <span>Standard Grid</span>
              </button>
              <button
                id="tab-view-video-feed"
                onClick={() => setHomeViewMode('video-feed')}
                className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition duration-200 cursor-pointer outline-none ${
                  homeViewMode === 'video-feed'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-650 hover:text-slate-900 hover:bg-white/30'
                }`}
              >
                <Video className="w-4 h-4 text-emerald-500 animate-pulse fill-emerald-500" />
                <span>Watch Video Ads</span>
                <span className="hidden sm:inline px-1 py-0.5 bg-emerald-600 text-[8px] text-white rounded-md tracking-wide font-black">
                  NEW
                </span>
              </button>
            </div>

            {homeViewMode === 'video-feed' ? (
              <VideoAdsFeed />
            ) : (
              <>
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

                {/* Price Budget Filter - Shown only when searching for a product */}
                {debouncedSearchQuery.trim() !== '' && (
                  <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 shadow-sm space-y-4 text-left font-sans animate-fade-in animate-duration-300">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <SlidersHorizontal className="w-4 h-4 text-slate-900 shrink-0" />
                        <h4 className="text-sm font-black text-slate-900 tracking-tight">
                          Price Range (GH₵)
                        </h4>
                      </div>
                      {(minPrice || maxPrice) && (
                        <button
                          onClick={() => {
                            setMinPrice('');
                            setMaxPrice('');
                          }}
                          className="text-[10px] bg-red-50 hover:bg-red-100 text-red-650 font-bold px-2 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                          <span>Reset</span>
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="space-y-1.5">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Min Price
                        </label>
                        <input
                          type="number"
                          placeholder="0"
                          value={minPrice}
                          onChange={(e) => setMinPrice(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-1.5 focus:ring-slate-500 transition-all font-mono"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Max Price
                        </label>
                        <input
                          type="number"
                          placeholder="No limit"
                          value={maxPrice}
                          onChange={(e) => setMaxPrice(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-1.5 focus:ring-slate-500 transition-all font-mono"
                        />
                      </div>
                    </div>

                    {/* Preset quick ranges */}
                    <div className="space-y-2 pt-1.5 border-t border-slate-100">
                      <span className="block text-[9px] font-black text-slate-400 uppercase tracking-wider">
                        Quick Budgets (GH₵)
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { label: 'Under 100', min: '', max: '100' },
                          { label: '100 - 500', min: '100', max: '500' },
                          { label: '500 - 2k', min: '500', max: '2000' },
                          { label: '2k - 10k', min: '2000', max: '10000' },
                          { label: '10k+', min: '10000', max: '' },
                        ].map((range) => {
                          const isSelected = minPrice === range.min && maxPrice === range.max;
                          return (
                            <button
                              key={range.label}
                              onClick={() => {
                                setMinPrice(range.min);
                                setMaxPrice(range.max);
                              }}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold cursor-pointer transition-all border ${
                                isSelected
                                  ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                                  : 'bg-slate-50 text-slate-650 border-slate-200 hover:border-slate-350 hover:bg-slate-100'
                              }`}
                            >
                              {range.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

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
                                loading="lazy"
                                decoding="async"
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-bold text-slate-900 font-sans tracking-tight">
                          {debouncedSearchQuery.trim()
                            ? `Results for ${debouncedSearchQuery}`
                            : selectedCategory
                            ? `${selectedCategory} listings`
                            : (selectedRegion !== 'All' || selectedCity !== 'All')
                            ? `${selectedRegion} Region ${selectedCity !== 'All' ? '- ' + selectedCity : ''} Deals`
                            : 'Latest Classified Deals'}
                        </h3>
                        <button
                          id="btn-manual-refresh"
                          onClick={() => refreshProducts()}
                          disabled={isProductsLoading}
                          className="p-1 px-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all cursor-pointer flex items-center justify-center shrink-0 active:scale-90"
                          title="Refresh listings feed"
                        >
                          <RefreshCw className={`w-4 h-4 ${isProductsLoading ? 'animate-spin text-slate-800' : ''}`} />
                        </button>
                      </div>
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
                  ) : sortedProducts.length === 0 ? (
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
                    <div className="space-y-6">
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-4 sm:gap-6 animate-fade-in">
                        {sortedProducts.slice(0, displayLimit).map(product => (
                          <ProductCard key={product.id} product={product} />
                        ))}
                      </div>
                      
                      {sortedProducts.length > displayLimit && (
                        <div ref={scrollSentinelRef} className="flex justify-center pt-8 pb-4">
                          <div className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 rounded-2xl shadow-3xs text-slate-600 animate-pulse">
                            <span className="w-4 h-4 border-2 border-slate-300 border-t-slate-800 rounded-full animate-spin" />
                            <span className="text-xs font-extrabold text-slate-700">Loading more listings...</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              </div>
            </div>
              </>
            )}
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
      {!(currentView === 'browse' && homeViewMode === 'video-feed') && (
        <footer className="bg-white border-t border-slate-205 text-slate-500 text-xs py-8 mt-12 mb-16 md:mb-0">
          <div className="max-w-7xl mx-auto px-4 text-center space-y-2">
            <p className="font-sans font-bold text-slate-800">Tedbuy Classifieds Marketplace &copy; 2026</p>
            <p className="text-[11px] text-slate-400 max-w-md mx-auto leading-relaxed">
              Connecting local buyers and sellers across Ghana directly. Browse tech, appliances, and fashion safely in your region.
            </p>
          </div>
        </footer>
      )}

      {/* Floating Create Listings form */}
      <ListingModal
        isOpen={isPostAdOpen}
        onClose={() => setIsPostAdOpen(false)}
      />

      {/* Floating Modern Toast Notification */}
      {toast && (
        <div id="welcome-success-toast" className="fixed top-6 left-1/2 -translate-x-1/2 md:left-auto md:right-6 md:translate-x-0 z-50 w-full max-w-md px-4 md:px-0 pointer-events-none animate-slide-in">
          <div className="bg-slate-900 border border-slate-800 text-white rounded-2xl p-4.5 shadow-[0_15px_45px_1px_rgba(0,0,0,0.25)] flex items-start gap-4 pointer-events-auto backdrop-blur-md">
            <div className={`rounded-full p-2.5 shrink-0 flex items-center justify-center ${
              toast.type === 'success' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 
              toast.type === 'error' ? 'bg-rose-500/15 text-rose-400 border border-rose-500/20' : 
              'bg-blue-500/15 text-blue-400 border border-blue-500/20'
            }`}>
              {toast.type === 'success' ? (
                <Check className="w-4.5 h-4.5 stroke-[3]" />
              ) : toast.type === 'error' ? (
                <AlertCircle className="w-4.5 h-4.5 stroke-[3]" />
              ) : (
                <Info className="w-4.5 h-4.5 stroke-[3]" />
              )}
            </div>
            <div className="flex-1 space-y-1.5">
              <p className="font-bold text-sm tracking-tight text-white flex items-center gap-1.5 font-sans">
                {toast.message.toLowerCase().includes('delete') ? (
                  <>Account Deleted 🔒</>
                ) : toast.message.toLowerCase().includes('welcome') || toast.message.toLowerCase().includes('sign up') ? (
                  <>Welcome to TedBuy 🚀</>
                ) : toast.message.toLowerCase().includes('store name') || toast.message.toLowerCase().includes('successfully changed') ? (
                  <>Store Named Updated 📝</>
                ) : toast.type === 'success' ? (
                  <>Success ✨</>
                ) : toast.type === 'error' ? (
                  <>Error ⚠️</>
                ) : (
                  <>Notification 🔔</>
                )}
              </p>
              <p className="text-[12px] text-slate-300 leading-relaxed font-medium">{toast.message}</p>
            </div>
            <button
              id="close-toast-btn"
              onClick={hideToast}
              className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer shrink-0"
              title="Dismiss Notification"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>
      )}

      {/* Responsive Bottom Navigation Bar for Mobile Devices */}
      <div className={`fixed bottom-0 left-0 right-0 z-40 backdrop-blur-md shadow-[0_-6px_20px_rgba(0,0,0,0.06)] md:hidden pb-4 pt-2 px-3 flex items-end justify-around transition-colors duration-200 ${
        isVideoFeedMobile
          ? 'bg-slate-900/95 border-t border-slate-950/80 text-white'
          : 'bg-white/95 border-t border-slate-200/80'
      }`}>
        {/* Home Tab */}
        <button
          onClick={() => {
            sessionStorage.setItem('tedbuy_browse_scroll_pos', '0');
            setCurrentView('browse');
            setHomeViewMode('grid');
            setSearchQuery('');
            window.scrollTo({ top: 0, behavior: 'auto' });
          }}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-1 transition duration-200 gap-1.5 cursor-pointer outline-none ${
            currentView === 'browse'
              ? isVideoFeedMobile ? 'text-white font-black' : 'text-slate-950 font-black'
              : isVideoFeedMobile ? 'text-slate-400 hover:text-white font-medium' : 'text-slate-400 hover:text-slate-600 font-medium'
          }`}
        >
          <div className="relative flex flex-col items-center">
            <Home className={`w-5.5 h-5.5 stroke-[2.2] transition-transform duration-200 ${
              currentView === 'browse' 
                ? isVideoFeedMobile ? 'scale-110 text-white' : 'scale-110 text-slate-950' 
                : 'text-slate-400'
            }`} />
            {currentView === 'browse' && (
              <span className={`absolute -bottom-1 w-1 h-1 rounded-full ${isVideoFeedMobile ? 'bg-white' : 'bg-slate-950'}`} />
            )}
          </div>
          <span className="text-[9px] tracking-tight uppercase font-extrabold">Home</span>
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
          className={`flex flex-col items-center justify-center flex-1 py-1 px-1 transition duration-200 gap-1.5 cursor-pointer outline-none ${
            currentView === 'browse' && searchQuery
              ? isVideoFeedMobile ? 'text-white font-black' : 'text-slate-950 font-black'
              : isVideoFeedMobile ? 'text-slate-400 hover:text-white font-medium' : 'text-slate-400 hover:text-slate-600 font-medium'
          }`}
        >
          <div className="relative flex flex-col items-center">
            <Search className={`w-5.5 h-5.5 stroke-[2.2] transition-transform duration-200 ${
              currentView === 'browse' && searchQuery 
                ? isVideoFeedMobile ? 'scale-110 text-white' : 'scale-110 text-slate-950' 
                : 'text-slate-400'
            }`} />
            {currentView === 'browse' && searchQuery && (
              <span className={`absolute -bottom-1 w-1 h-1 rounded-full ${isVideoFeedMobile ? 'bg-white' : 'bg-slate-950'}`} />
            )}
          </div>
          <span className="text-[9px] tracking-tight uppercase font-extrabold">Search</span>
        </button>

        {/* Enhanced Central Raised Sell Tab */}
        <button
          onClick={handlePostAdBtn}
          className="flex flex-col items-center justify-center flex-1 pb-1 relative z-50 cursor-pointer outline-none -translate-y-2.5"
        >
          <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition duration-200 active:scale-90 border-4 ${
            isVideoFeedMobile
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-slate-900 text-white border-white'
          }`}>
            <PlusCircle className="w-6 h-6 stroke-[2.5]" />
          </div>
          <span className={`text-[9px] tracking-tight uppercase font-black mt-1 ${
            isVideoFeedMobile ? 'text-slate-200' : 'text-slate-900'
          }`}>Sell</span>
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
          className={`flex flex-col items-center justify-center flex-1 py-1 px-1 transition duration-200 gap-1.5 relative cursor-pointer outline-none ${
            currentView === 'chats'
              ? isVideoFeedMobile ? 'text-white font-black' : 'text-slate-950 font-black'
              : isVideoFeedMobile ? 'text-slate-400 hover:text-white font-medium' : 'text-slate-400 hover:text-slate-600 font-medium'
          }`}
        >
          <div className="relative flex flex-col items-center">
            <MessageSquare className={`w-5.5 h-5.5 stroke-[2.2] transition-transform duration-200 ${
              currentView === 'chats' 
                ? isVideoFeedMobile ? 'scale-110 text-white' : 'scale-110 text-slate-950' 
                : 'text-slate-400'
            }`} />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white font-extrabold text-[8px] min-w-[14px] h-[14px] px-1 rounded-full flex items-center justify-center shadow-xs border border-white animate-pulse">
                {unreadCount}
              </span>
            )}
            {currentView === 'chats' && (
              <span className={`absolute -bottom-1.5 w-1 h-1 rounded-full ${isVideoFeedMobile ? 'bg-white' : 'bg-slate-950'}`} />
            )}
          </div>
          <span className="text-[9px] tracking-tight uppercase font-extrabold">Chats</span>
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
          className={`flex flex-col items-center justify-center flex-1 py-1 px-1 transition duration-200 gap-1.5 cursor-pointer outline-none ${
            currentView === 'profile-settings' || currentView === 'my-dashboard'
              ? isVideoFeedMobile ? 'text-white font-black' : 'text-slate-950 font-black'
              : isVideoFeedMobile ? 'text-slate-400 hover:text-white font-medium' : 'text-slate-400 hover:text-slate-600 font-medium'
          }`}
        >
          <div className="relative flex flex-col items-center">
            {currentUser && currentUser.photoUrl && !currentUser.photoUrl.includes('1549399542-7e3f8b79c341') ? (
              <img
                src={currentUser.photoUrl}
                alt="Account Avatar"
                referrerPolicy="no-referrer"
                className={`w-6 h-6 rounded-full object-cover border-2 transition-all duration-200 ${
                  currentView === 'profile-settings' || currentView === 'my-dashboard'
                    ? isVideoFeedMobile ? 'border-white scale-110' : 'border-slate-950 scale-110'
                    : 'border-transparent'
                }`}
              />
            ) : (
              <User className={`w-5.5 h-5.5 stroke-[2.2] transition-transform duration-200 ${
                currentView === 'profile-settings' || currentView === 'my-dashboard' 
                  ? isVideoFeedMobile ? 'scale-110 text-white' : 'scale-110 text-slate-950' 
                  : 'text-slate-400'
              }`} />
            )}
            {(currentView === 'profile-settings' || currentView === 'my-dashboard') && (
              <span className={`absolute -bottom-1.5 w-1 h-1 rounded-full ${isVideoFeedMobile ? 'bg-white' : 'bg-slate-950'}`} />
            )}
          </div>
          <span className="text-[9px] tracking-tight uppercase font-extrabold">Profile</span>
        </button>
      </div>

      <VerificationBlockModal />
      <WebMCPInitializer />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <ErrorBoundary>
        <MarketplaceContent />
      </ErrorBoundary>
    </AppProvider>
  );
}
