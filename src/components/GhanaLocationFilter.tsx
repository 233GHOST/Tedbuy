import React, { useState } from 'react';
import { GHANA_REGIONS, getRegionForLocation } from '../regions';
import { Product } from '../types';
import { MapPin, X, Navigation, Locate, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { useApp } from '../context/AppContext';

interface GhanaLocationFilterProps {
  selectedRegion: string;
  setSelectedRegion: (region: string) => void;
  selectedCity: string;
  setSelectedCity: (city: string) => void;
  products: Product[];
}

export const GhanaLocationFilter: React.FC<GhanaLocationFilterProps> = ({
  selectedRegion,
  setSelectedRegion,
  selectedCity,
  setSelectedCity,
  products
}) => {
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);
  const { currentUser } = useApp();
  const isAdmin = currentUser?.isAdmin;

  // Count products per region
  const regionCounts = React.useMemo(() => {
    const counts: { [key: string]: number } = { All: products.length };
    products.forEach(p => {
      const reg = getRegionForLocation(p.location);
      counts[reg] = (counts[reg] || 0) + 1;
    });
    return counts;
  }, [products]);

  // Count products for the popular cities of the selected region
  const cityCounts = React.useMemo(() => {
    const counts: { [key: string]: number } = {};
    if (selectedRegion === 'All' || !products || products.length === 0) return counts;
    
    const activeReg = GHANA_REGIONS.find(r => r.name === selectedRegion);
    if (!activeReg) return counts;

    products.forEach(p => {
      if (!p.location) return;
      const locLower = p.location.toLowerCase();
      activeReg.cities.forEach(city => {
        if (locLower.includes(city.toLowerCase())) {
          counts[city] = (counts[city] || 0) + 1;
        }
      });
    });
    return counts;
  }, [products, selectedRegion]);

  const activeRegionObj = GHANA_REGIONS.find(r => r.name === selectedRegion);

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 shadow-sm space-y-4 text-left font-sans transition-all duration-300">
      {/* Active Selection Summary & Toggle Bar */}
      <div 
        className="flex items-center justify-between cursor-pointer lg:cursor-default select-none"
        onClick={() => setIsMobileExpanded(!isMobileExpanded)}
      >
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-slate-900 shrink-0" />
          <h4 className="text-sm font-black text-slate-900 tracking-tight">
            Ghana Location Filters
          </h4>
          <span className="text-[10px] font-extrabold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md lg:hidden max-w-[120px] truncate">
            {selectedRegion === 'All' ? 'All' : selectedRegion}
          </span>
        </div>

        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {(selectedRegion !== 'All' || selectedCity !== 'All') && (
            <button
              id="btn-clear-location-filters"
              onClick={() => {
                setSelectedRegion('All');
                setSelectedCity('All');
              }}
              className="text-[10px] bg-red-50 hover:bg-red-100 text-red-650 font-bold px-2 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}

          <button
            onClick={() => setIsMobileExpanded(!isMobileExpanded)}
            className="lg:hidden p-1.5 hover:bg-slate-50 border border-slate-150 rounded-lg text-slate-500 hover:text-slate-800 transition cursor-pointer flex items-center justify-center"
            title={isMobileExpanded ? "Collapse Filters" : "Expand Filters"}
          >
            {isMobileExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main filter container: Collapsed on mobile unless toggled open; always open on desktop (lg:space-y-4 lg:block) */}
      <div className={`space-y-4 ${isMobileExpanded ? 'block animate-fade-in' : 'hidden lg:block'}`}>
        {/* Region Selector dropdown/pills */}
        <div className="space-y-2">
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Filter by Region
          </label>
          <div className="relative">
            <select
              id="region-filter-dropdown"
              value={selectedRegion}
              onChange={(e) => {
                setSelectedRegion(e.target.value);
                setSelectedCity('All'); // Reset city on region change State
              }}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 hover:border-slate-350 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 cursor-pointer transition appearance-none"
            >
              <option value="All">🇬🇭 All Regions{isAdmin ? ` (${regionCounts['All'] || 0})` : ''}</option>
              {GHANA_REGIONS.map(reg => {
                const count = regionCounts[reg.name] || 0;
                return (
                  <option key={reg.name} value={reg.name}>
                    {reg.name} Region ({count})
                  </option>
                );
              })}
            </select>
            <div className="absolute inset-y-0 right-3.5 flex items-center pointer-events-none text-slate-500">
              <Navigation className="w-3.5 h-3.5 rotate-45 animate-pulse" />
            </div>
          </div>
        </div>

        {/* City Selector dropdown - visible if region is set */}
        {selectedRegion !== 'All' && activeRegionObj && (
          <div className="space-y-2 animate-fade-in">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Filter by City in {selectedRegion}
            </label>
            <div className="relative">
              <select
                id="city-filter-dropdown"
                value={selectedCity}
                onChange={(e) => {
                  setSelectedCity(e.target.value);
                }}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 hover:border-slate-350 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 cursor-pointer transition appearance-none"
              >
                <option value="All font-bold">📍 All Cities ({regionCounts[selectedRegion] || 0})</option>
                {activeRegionObj.cities.map(city => {
                  const count = cityCounts[city] || 0;
                  return (
                    <option key={city} value={city}>
                      {city} ({count})
                    </option>
                  );
                })}
              </select>
              <div className="absolute inset-y-0 right-3.5 flex items-center pointer-events-none text-slate-500">
                <Navigation className="w-3.5 h-3.5 rotate-45" />
              </div>
            </div>
          </div>
        )}

        {/* Selected Target summary card */}
        <div className="bg-slate-55 border border-slate-150 rounded-2xl p-3 flex items-center gap-3">
          <div className="p-2 bg-slate-200 text-slate-800 rounded-lg shrink-0">
            <Locate className="w-4 h-4" />
          </div>
          <div className="text-left font-sans min-w-0">
            <span className="block text-[9px] text-slate-400 uppercase font-black tracking-wide">Selected Target</span>
            <span className="text-xs font-black text-slate-800 block truncate">
              {selectedRegion === 'All' 
                ? 'All of Ghana' 
                : `${selectedRegion}${selectedCity !== 'All' ? ' - ' + selectedCity : ' Region'}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
