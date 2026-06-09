import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Navbar } from './components/Navbar';
import { ProductCard } from './components/ProductCard';
import { ProductDetail } from './components/ProductDetail';
import { ChatInterface } from './components/ChatInterface';
import { SellerDashboard } from './components/SellerDashboard';
import { SellerProfilePage } from './components/SellerProfilePage';
import { ProfileSettings } from './components/ProfileSettings';
import { ListingModal } from './components/ListingModal';
import { Category } from './types';
import { Sparkles, ShoppingBag, X, Check, Search, TrendingUp, HelpCircle, Package, MapPin } from 'lucide-react';
import { GhanaLocationFilter } from './components/GhanaLocationFilter';
import { getRegionForLocation } from './regions';

const CATEGORY_ICONS: { [key in Category]: string } = {
  Phones: '📱',
  Laptops: '💻',
  Fashion: '👟',
  'Home Appliances': '🔌',
  Vehicles: '🚗',
  Trending: '🔥',
  Property: '🏢',
  Food: '🍲',
  Home: '🏠',
  Furniture: '🪑',
  'Repair and Construction': '🛠️',
  'Beauty and Care': '💄',
  Electronics: '⚡',
  'Jobs & Services': '💼',
  'Animals & Pets': '🐕',
  'Books & Education': '📚',
  'Sports & Outdoors': '⚽',
  'Toys & Games': '🧸',
  'Agriculture & Foodstuff': '🌾',
  'Health & Fitness': '💪',
  'Commercial Equipment': '⚙️',
  'Art & Crafts': '🎨',
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
    setUnauthorizedDomainDetected
  } = useApp();

  const [isPostAdOpen, setIsPostAdOpen] = useState(false);

  // Ghana Region & City filter states
  const [selectedRegion, setSelectedRegion] = useState<string>('All');
  const [selectedCity, setSelectedCity] = useState<string>('All');
  const [sortBy, setSortBy] = useState<'default' | 'price-asc' | 'price-desc'>('default');

  // Filter listings based on category, search query, region, and city
  const filteredProducts = products.filter(product => {
    const matchesCategory = !selectedCategory || product.category === selectedCategory;
    const matchesSearch = !searchQuery.trim() ||
      product.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
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

  const sortedProducts = [...filteredProducts].sort((a, b) => {
    if (sortBy === 'price-asc') {
      return a.price - b.price;
    }
    if (sortBy === 'price-desc') {
      return b.price - a.price;
    }
    return 0; // default (chrono/initial order)
  });

  const handlePostAdBtn = () => {
    if (!currentUser) {
      setShowAuthModal(true);
      return;
    }
    setIsPostAdOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
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
            <section className="space-y-4 mb-8">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-extrabold text-slate-900 font-sans tracking-tight flex items-center gap-1.5">
                  <TrendingUp className="w-4.5 h-4.5 text-slate-900" />
                  <span>Explore Classified Categories</span>
                </h2>
                {selectedCategory && (
                  <button
                    id="clear-category-filter"
                    onClick={() => setSelectedCategory(null)}
                    className="text-xs text-slate-550 hover:text-slate-950 font-semibold"
                  >
                    Clear Filter
                  </button>
                )}
              </div>

              {/* Dynamic scroll categories */}
              <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-none">
                <button
                  id="category-tag-all"
                  onClick={() => setSelectedCategory(null)}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap border ${
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
                      id={`category-tag-${cat.toLowerCase().replace(' ', '-')}`}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap border ${
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

                    {/* Price Sort Dropdown replacing Ghana's verified listings */}
                    <div className="flex items-center gap-2 self-start sm:self-center">
                      <label htmlFor="sort-dropdown" className="text-xs font-bold text-slate-500 whitespace-nowrap">Sort by:</label>
                      <select
                        id="sort-dropdown"
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as 'default' | 'price-asc' | 'price-desc')}
                        className="bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-350 cursor-pointer shadow-3xs transition hover:border-slate-300"
                      >
                        <option value="default">Latest Ads</option>
                        <option value="price-asc">Price: Low to High</option>
                        <option value="price-desc">Price: High to Low</option>
                      </select>
                    </div>
                  </div>

                  {filteredProducts.length === 0 ? (
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
            </div>           </section>
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
      <footer className="bg-white border-t border-slate-205 text-slate-500 text-xs py-8 mt-12">
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
