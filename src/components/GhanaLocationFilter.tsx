import React from 'react';
import { GHANA_REGIONS, getRegionForLocation } from '../regions';
import { Product } from '../types';
import { MapPin, X, Navigation, Locate, Check } from 'lucide-react';

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
  // Count products per region
  const regionCounts = React.useMemo(() => {
    const counts: { [key: string]: number } = { All: products.length };
    products.forEach(p => {
      const reg = getRegionForLocation(p.location);
      counts[reg] = (counts[reg] || 0) + 1;
    });
    return counts;
  }, [products]);

  const activeRegionObj = GHANA_REGIONS.find(r => r.name === selectedRegion);

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-5 text-left font-sans">
      {/* Active Selection Summary */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-black text-slate-900 tracking-tight flex items-center gap-2">
          <MapPin className="w-4 h-4 text-slate-900 animate-pulse" />
          <span>Ghana Location Filters</span>
        </h4>
        {(selectedRegion !== 'All' || selectedCity !== 'All') && (
          <button
            id="btn-clear-location-filters"
            onClick={() => {
              setSelectedRegion('All');
              setSelectedCity('All');
            }}
            className="text-[10px] bg-red-50 hover:bg-red-100 text-red-650 font-bold px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
          >
            <X className="w-3 h-3" />
            <span>Reset</span>
          </button>
        )}
      </div>

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
            <option value="All">🇬🇭 All Regions</option>
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
            <Navigation className="w-3.5 h-3.5 rotate-45" />
          </div>
        </div>
      </div>

      {/* Selected Target summary card */}
      <div className="bg-slate-100 border border-slate-200 rounded-2xl p-3.5 flex items-center gap-3">
        <div className="p-2.5 bg-slate-200 text-slate-800 rounded-xl">
          <Locate className="w-4 h-4" />
        </div>
        <div className="text-left font-sans">
          <span className="block text-[10px] text-slate-400 uppercase font-black tracking-wide">Selected Target</span>
          <span className="text-xs font-black text-slate-800 block line-clamp-1">
            {selectedRegion === 'All' ? 'All regions in Ghana' : `${selectedRegion} Region`}
          </span>
        </div>
      </div>
    </div>
  );
};
