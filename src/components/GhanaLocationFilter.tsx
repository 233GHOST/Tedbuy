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

  // Count products for the popular cities of the selected region
  const cityCounts = React.useMemo(() => {
    const counts: { [key: string]: number } = {};
    products.forEach(p => {
      const locLower = p.location.toLowerCase();
      // Test if any city matches
      GHANA_REGIONS.forEach(reg => {
        reg.cities.forEach(city => {
          if (locLower.includes(city.toLowerCase())) {
            counts[city] = (counts[city] || 0) + 1;
          }
        });
      });
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
            <option value="All">🇬🇭 All Regions ({products.length})</option>
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

      {/* Dynamic City recommendations */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            City / Neighborhood
          </label>
          {selectedCity !== 'All' && (
            <span className="text-[10px] text-slate-800 font-extrabold bg-slate-100 px-2 py-0.5 rounded">
              Active: {selectedCity}
            </span>
          )}
        </div>

        {selectedRegion === 'All' ? (
          <div>
            {/* Show popular cities nationwide */}
            <p className="text-[11px] text-slate-450 mb-2">Select a region first key or pick a popular city:</p>
            <div className="flex flex-wrap gap-1.5">
              {['Accra', 'Kumasi', 'Tema', 'East Legon', 'Cape Coast', 'Tamale'].map(popCity => {
                const count = cityCounts[popCity] || 0;
                const isSelected = selectedCity === popCity;
                return (
                  <button
                    key={popCity}
                    id={`popular-city-btn-${popCity.toLowerCase().replace(' ', '-')}`}
                    onClick={() => {
                      // Guess region
                      if (popCity === 'Kumasi') {
                        setSelectedRegion('Ashanti');
                      } else if (popCity === 'Cape Coast') {
                        setSelectedRegion('Central');
                      } else if (popCity === 'Tamale') {
                        setSelectedRegion('Northern');
                      } else {
                        setSelectedRegion('Greater Accra');
                      }
                      setSelectedCity(popCity);
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-950'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-350 hover:bg-slate-100'
                    }`}
                  >
                    📍 {popCity} {count > 0 && <span className="opacity-80 text-[10px]">({count})</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            <p className="text-[11px] text-slate-500">
              Showing active locations within <b className="text-slate-800">{selectedRegion} Region</b>:
            </p>
            
            <div className="flex flex-col gap-1.5 max-h-[160px] overflow-y-auto pr-1 scrollbar-thin">
              {/* "All Cities" button */}
              <button
                id="city-filter-option-all"
                onClick={() => setSelectedCity('All')}
                className={`flex items-center justify-between px-3 py-1.5 rounded-xl text-xs font-semibold text-left transition ${
                  selectedCity === 'All'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700'
                }`}
              >
                <span>🌍 All Cities in {selectedRegion}</span>
                {selectedCity === 'All' && <Check className="w-3.5 h-3.5 text-slate-500" />}
              </button>

              {activeRegionObj?.cities.map(city => {
                const count = cityCounts[city] || 0;
                const isSelected = selectedCity === city;
                return (
                  <button
                    key={city}
                    id={`city-filter-option-${city.toLowerCase().replace(' ', '-')}`}
                    onClick={() => setSelectedCity(city)}
                    className={`flex items-center justify-between px-3 py-1.5 rounded-xl text-xs font-semibold text-left transition ${
                      isSelected
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <span>📍 {city}</span>
                    <span className="flex items-center gap-1.5">
                      {count > 0 && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${isSelected ? 'bg-slate-850 text-slate-100' : 'bg-slate-200 text-slate-600'}`}>
                          {count}
                        </span>
                      )}
                      {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Regional Quick Info Map graphic layout placeholder styling */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 flex items-center gap-3">
        <div className="p-2.5 bg-slate-200 text-slate-800 rounded-xl">
          <Locate className="w-4 h-4" />
        </div>
        <div className="text-left font-sans">
          <span className="block text-[10px] text-slate-400 uppercase font-black tracking-wide">Selected Target</span>
          <span className="text-[11px] font-extrabold text-slate-700 block line-clamp-1">
            {selectedRegion === 'All' ? 'All regions in Ghana' : `${selectedRegion} (${selectedCity === 'All' ? 'All Cities' : selectedCity})`}
          </span>
        </div>
      </div>
    </div>
  );
};
