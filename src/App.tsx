import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Navbar } from './components/Navbar';
import { ProductCard } from './components/ProductCard';
import { ProductDetail } from './components/ProductDetail';
import { ChatInterface } from './components/ChatInterface';
import { SellerDashboard } from './components/SellerDashboard';
import { SellerProfilePage } from './components/SellerProfilePage';
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
    setCurrentView
  } = useApp();

  const [isPostAdOpen, setIsPostAdOpen] = useState(false);

  // Ghana Region & City filter states
  const [selectedRegion, setSelectedRegion] = useState<string>('All');
  const [selectedCity, setSelectedCity] = useState<string>('All');

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

  const handlePostAdBtn = () => {
    if (!currentUser) {
      alert("Please Log In or select a pre-loaded account at the top to list your products!");
      return;
    }
    setIsPostAdOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <Navbar />

      <main className="flex-1">
        {currentView === 'browse' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            
            {/* Promotional Marketplace Hero Badge */}
            <div className="relative mb-8 bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border border-slate-800 text-white rounded-3xl p-6 sm:p-8 overflow-hidden shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div className="relative z-10 max-w-xl text-left space-y-3">

                <h1 className="text-2xl sm:text-3xl font-black font-sans tracking-tight text-white leading-tight">
                  Find Verified Tech, Wearables, and Appliances on Tedbuy
                </h1>
                <p className="text-slate-400 text-xs sm:text-sm font-sans leading-relaxed">
                  Post active classified advertisements free, search specific local categories, and bargain prices securely using our real-time inbox chats!
                </p>
              </div>

              {/* Action trigger */}
              <button
                id="hero-post-ad-btn"
                onClick={handlePostAdBtn}
                className="relative z-10 w-full md:w-auto px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm rounded-xl shadow-md shadow-emerald-600/10 hover:shadow-lg transition duration-200 shrink-0"
              >
                Post an Ad Free
              </button>

              {/* Decorative radial glows */}
              <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
              <div className="absolute -right-24 -top-24 w-60 h-60 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none"></div>
            </div>

            {/* Category selection ribbon */}
            <section className="space-y-4 mb-8">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-extrabold text-slate-900 font-sans tracking-tight flex items-center gap-1.5">
                  <TrendingUp className="w-4.5 h-4.5 text-emerald-500" />
                  <span>Explore Classified Categories</span>
                </h2>
                {selectedCategory && (
                  <button
                    id="clear-category-filter"
                    onClick={() => setSelectedCategory(null)}
                    className="text-xs text-slate-500 hover:text-emerald-500 font-semibold"
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
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-4 text-left">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 font-sans tracking-tight">
                        {searchQuery.trim()
                          ? `Search Results for &ldquo;${searchQuery}&rdquo;`
                          : selectedCategory
                          ? `${selectedCategory} listings`
                          : (selectedRegion !== 'All' || selectedCity !== 'All')
                          ? `${selectedRegion} Region ${selectedCity !== 'All' ? '- ' + selectedCity : ''} Deals`
                          : 'Latest Classified Deals'}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">Found {filteredProducts.length} listings in the platform database.</p>
                    </div>

                    {/* Filters details */}
                    <span className="text-xs text-slate-400 font-mono">GHANA NATIONAL BARGAINS</span>
                  </div>

                  {filteredProducts.length === 0 ? (
                    <div id="no-products-found" className="bg-white border border-slate-200 rounded-3xl p-16 text-center max-w-lg mx-auto shadow-sm">
                      <Package className="w-14 h-14 mx-auto stroke-[1.2] text-slate-300 mb-2" />
                      <h4 className="text-sm font-bold text-slate-800">No postings matching your parameters</h4>
                      <p className="text-xs text-slate-450 mt-1 mb-5">
                        No publications were loaded for your search, category, or selected Ghana location filter.
                      </p>
                      <button
                        onClick={() => {
                          setSearchQuery('');
                          setSelectedCategory(null);
                          setSelectedRegion('All');
                          setSelectedCity('All');
                        }}
                        className="px-4.5 py-2 bg-slate-900 hover:bg-emerald-600 hover:text-white font-bold text-xs text-white rounded-xl transition shadow-3xs"
                      >
                        Reset All Filters
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-4 sm:gap-6">
                      {filteredProducts.map(product => (
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
      </main>

      {/* Persistent platform footer */}
      <footer className="bg-white border-t border-slate-200 text-slate-500 text-xs py-8">
        <div className="max-w-7xl mx-auto px-4 text-center space-y-2">
          <p className="font-sans font-bold text-slate-800">Tedbuy Peer Classifieds Marketplace &copy; 2026</p>
          <p className="font-mono text-[10px] text-slate-400">GHANA WEB SERVICES &bull; INSPIRED BY THE REVOLUTIONARY JIJI CLASSIFIEDS APP</p>
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
