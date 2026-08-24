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
  const [isExpanded, setIsExpanded] = useState(false);
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

  const displayBadgeText = selectedRegion === 'All' 
    ? 'All' 
    : `${selectedRegion}${selectedCity !== 'All' ? ' - ' + selectedCity : ''}`;

  return (
    <div className="bg-white border border-slate-200/90 rounded-[28px] sm:rounded-full px-4 sm:px-6 py-3 shadow-xs font-sans transition-all duration-300">
      {/* Primary Location Filter Pill Header (Matches screenshot design) */}
      <div 
        className="flex items-center justify-between cursor-pointer select-none gap-2 sm:gap-3"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 flex-1 overflow-hidden">
          <MapPin className="w-5 h-5 text-slate-900 shrink-0 stroke-[2.2]" />
          <h4 className="text-xs sm:text-base font-extrabold text-slate-900 tracking-tight truncate shrink-0">
            Ghana Location Filters
          </h4>
          <span className="bg-slate-100 text-slate-600 text-[10px] sm:text-xs font-bold px-2 sm:px-3 py-1 rounded-full border border-slate-150 max-w-[85px] sm:max-w-[160px] truncate shrink">
            {displayBadgeText}
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-1" onClick={(e) => e.stopPropagation()}>
          {(selectedRegion !== 'All' || selectedCity !== 'All') && (
            <button
              id="btn-clear-location-filters"
              onClick={() => {
                setSelectedRegion('All');
                setSelectedCity('All');
              }}
              className="text-[10px] sm:text-xs bg-red-50 hover:bg-red-100 text-red-600 font-bold px-2.5 py-1.5 rounded-xl transition flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-10 h-10 border border-slate-300 hover:border-slate-400 rounded-2xl flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-all cursor-pointer"
            title={isExpanded ? "Hide location options" : "Show location options"}
          >
            <ChevronDown className={`w-5 h-5 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Expandable Region & City Selectors */}
      {isExpanded && (
        <div className="pt-3.5 mt-3 border-t border-slate-100 space-y-3 animate-fade-in text-left">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            {/* Region Selector dropdown */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Filter by Region
              </label>
              <div className="relative">
                <select
                  id="region-filter-dropdown"
                  value={selectedRegion}
                  onChange={(e) => {
                    setSelectedRegion(e.target.value);
                    setSelectedCity('All');
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
            {selectedRegion !== 'All' && activeRegionObj ? (
              <div className="space-y-1.5 animate-fade-in">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">
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
                    <option value="All">📍 All Cities ({regionCounts[selectedRegion] || 0})</option>
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
            ) : (
              /* Selected Target summary card */
              <div className="bg-slate-50 border border-slate-150 rounded-xl p-2.5 flex items-center gap-2.5 h-[42px]">
                <div className="p-1.5 bg-slate-200 text-slate-800 rounded-lg shrink-0">
                  <Locate className="w-3.5 h-3.5" />
                </div>
                <div className="text-left font-sans min-w-0">
                  <span className="block text-[8px] text-slate-400 uppercase font-black tracking-wide leading-none">Target</span>
                  <span className="text-xs font-black text-slate-800 block truncate leading-tight">
                    {selectedRegion === 'All' 
                      ? 'All of Ghana' 
                      : `${selectedRegion}${selectedCity !== 'All' ? ' - ' + selectedCity : ' Region'}`}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
