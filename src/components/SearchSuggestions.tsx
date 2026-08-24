import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Search, History, ArrowRight, Tag, MapPin, X, Flame, Sparkles, Building2 } from 'lucide-react';
import { Product, Category, CATEGORY_ICONS } from '../types';
import { getPrefixAutocompleteSuggestions, AutocompleteSuggestion } from '../utils/searchAutocomplete';

interface SearchSuggestionsProps {
  query: string;
  onSelectQuery: (query: string) => void;
  onSelectCategory?: (category: Category | null) => void;
  onSelectProduct?: (product: Product) => void;
  onSelectLocation?: (city: string) => void;
  products: Product[];
  recentSearches: string[];
  onRemoveRecentSearch: (term: string, e: React.MouseEvent) => void;
  onClearRecentSearches: () => void;
  onClose: () => void;
  className?: string;
  theme?: 'dark' | 'light';
}

const GHANA_CITIES = [
  'Accra',
  'Kumasi',
  'Takoradi',
  'Tamale',
  'Tema',
  'Cape Coast',
  'Sunyani',
  'Koforidua',
  'East Legon',
  'Spintex',
  'Madina',
  'Osu',
  'Airport Residential',
  'Dansoman'
];

export const SearchSuggestions: React.FC<SearchSuggestionsProps> = ({
  query,
  onSelectQuery,
  onSelectCategory,
  onSelectLocation,
  products = [],
  recentSearches = [],
  onRemoveRecentSearch,
  onClearRecentSearches,
  onClose,
  className = ''
}) => {
  const trimmedQuery = query.trim().toLowerCase();
  const [serverSuggestions, setServerSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  // 1. Fetch server suggestions in the background with a 150ms debounce
  useEffect(() => {
    if (!trimmedQuery) {
      setServerSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggestions?q=${encodeURIComponent(query)}&limit=8`);
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.items)) {
            setServerSuggestions(data.items);
          } else if (data && Array.isArray(data.suggestions)) {
            setServerSuggestions(data.suggestions.map((s: string) => ({ text: s, type: 'title' })));
          }
        }
      } catch {
        // Silently fallback to client-side prefix matching
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [trimmedQuery, query]);

  // 2. Filter matching categories (prefix first, then contains)
  const matchingCategories = useMemo(() => {
    const allCategories = Object.keys(CATEGORY_ICONS) as Category[];
    if (!trimmedQuery) return [];
    return allCategories
      .filter((cat) => cat.toLowerCase().startsWith(trimmedQuery) || cat.toLowerCase().includes(trimmedQuery))
      .sort((a, b) => {
        const aPrefix = a.toLowerCase().startsWith(trimmedQuery) ? 1 : 0;
        const bPrefix = b.toLowerCase().startsWith(trimmedQuery) ? 1 : 0;
        return bPrefix - aPrefix;
      })
      .slice(0, 2);
  }, [trimmedQuery]);

  // 3. Filter matching locations
  const matchingLocations = useMemo(() => {
    if (!trimmedQuery || trimmedQuery.length < 2) return [];
    return GHANA_CITIES
      .filter((city) => city.toLowerCase().startsWith(trimmedQuery) || city.toLowerCase().includes(trimmedQuery))
      .slice(0, 2);
  }, [trimmedQuery]);

  // 4. Client-side instant Prefix Autocomplete combined with Server-side fallback
  const suggestions = useMemo(() => {
    const local = getPrefixAutocompleteSuggestions(query, products, { limit: 8 });
    
    // Merge local suggestions and server suggestions smoothly
    const seen = new Set<string>();
    const merged: AutocompleteSuggestion[] = [];

    // Prioritize local instant matching
    for (const s of local) {
      const key = s.text.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(s);
      }
    }

    // Add any server items that weren't in client memory
    for (const s of serverSuggestions) {
      const key = s.text.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(s);
      }
    }

    return merged.slice(0, 8);
  }, [query, products, serverSuggestions]);

  // 5. Filter recent searches
  const filteredRecent = useMemo(() => {
    if (!trimmedQuery) return recentSearches.slice(0, 5);
    return recentSearches
      .filter((term) => term.toLowerCase().startsWith(trimmedQuery) || term.toLowerCase().includes(trimmedQuery))
      .slice(0, 4);
  }, [recentSearches, trimmedQuery]);

  // Reset selectedIndex on query change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [query]);

  // Keyboard navigation handler (ArrowUp, ArrowDown, Enter)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!containerRef.current) return;
      if (suggestions.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === 'Enter' && selectedIndex >= 0 && selectedIndex < suggestions.length) {
        e.preventDefault();
        onSelectQuery(suggestions[selectedIndex].text);
        onClose();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [suggestions, selectedIndex, onSelectQuery, onClose]);

  // Highlight matched prefix inside text with 100% solid high-contrast black text
  const highlightPrefixMatch = (text: string, match: string) => {
    if (!match) {
      return <span className="text-black font-semibold">{text}</span>;
    }
    const idx = text.toLowerCase().indexOf(match.toLowerCase());
    if (idx === -1) {
      return <span className="text-black font-semibold">{text}</span>;
    }
    const before = text.substring(0, idx);
    const matched = text.substring(idx, idx + match.length);
    const after = text.substring(idx + match.length);

    return (
      <span className="text-black font-semibold">
        {before && <span className="text-black font-semibold">{before}</span>}
        <span className="font-extrabold text-orange-600 underline decoration-orange-400 underline-offset-2">
          {matched}
        </span>
        {after && <span className="text-black font-semibold">{after}</span>}
      </span>
    );
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={(e) => e.preventDefault()}
      className={`absolute left-0 right-0 mt-2 rounded-2xl shadow-2xl z-50 overflow-hidden text-left font-sans border bg-white border-slate-200 divide-y divide-slate-100 text-black shadow-slate-900/20 ring-1 ring-slate-950/5 ${className}`}
      style={{ maxHeight: '460px', overflowY: 'auto' }}
    >
      {/* 1. Direct Search Action Row (When query is typed) */}
      {trimmedQuery.length > 0 && (
        <div className="p-2 bg-orange-50/80">
          <button
            type="button"
            onClick={() => {
              onSelectQuery(query.trim());
              onClose();
            }}
            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-bold border shadow-3xs cursor-pointer group transition-all bg-white text-black hover:bg-orange-500 hover:text-white border-orange-200/80"
          >
            <div className="flex items-center gap-2.5 truncate">
              <Search className="w-4 h-4 text-orange-600 group-hover:text-white transition-colors shrink-0" />
              <span className="truncate text-black group-hover:text-white font-medium">
                Search for "<strong className="text-black group-hover:text-white font-bold">{query.trim()}</strong>"
              </span>
            </div>
            <ArrowRight className="w-4 h-4 text-orange-500 group-hover:text-white group-hover:translate-x-1 transition-all shrink-0 ml-2" />
          </button>
        </div>
      )}

      {/* 2. Category & Location Quick Filter Chips */}
      {(matchingCategories.length > 0 || matchingLocations.length > 0) && (
        <div className="p-3 bg-slate-50">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider mb-2 px-1 text-slate-700">
            <Tag className="w-3.5 h-3.5 text-orange-500" />
            <span>Filter By Category or Location</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {matchingCategories.map((cat) => {
              const icon = CATEGORY_ICONS[cat] || '📦';
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    if (onSelectCategory) onSelectCategory(cat);
                    onClose();
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition shadow-3xs cursor-pointer group border bg-white text-black border-slate-300 hover:bg-orange-500 hover:border-orange-500 hover:text-white"
                >
                  <span className="text-sm">{icon}</span>
                  <span className="text-black group-hover:text-white">in Category: <strong className="text-black group-hover:text-white">{cat}</strong></span>
                  <ArrowRight className="w-3 h-3 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-transform text-black group-hover:text-white" />
                </button>
              );
            })}
            {matchingLocations.map((city) => (
              <button
                key={city}
                type="button"
                onClick={() => {
                  if (onSelectLocation) onSelectLocation(city);
                  else onSelectQuery(city);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition shadow-3xs cursor-pointer group border bg-white text-black border-slate-300 hover:bg-emerald-600 hover:border-emerald-600 hover:text-white"
              >
                <MapPin className="w-3.5 h-3.5 text-emerald-600 group-hover:text-white" />
                <span className="text-black group-hover:text-white">in Location: <strong className="text-black group-hover:text-white">{city}</strong></span>
                <ArrowRight className="w-3 h-3 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-transform text-black group-hover:text-white" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 3. Prefix Autocomplete Suggestions (Header and prefix label removed as requested) */}
      {suggestions.length > 0 && (
        <div className="p-2 space-y-0.5" role="listbox">
          {suggestions.map((item, idx) => {
            const isSelected = selectedIndex === idx;
            return (
              <button
                key={`${item.text}-${idx}`}
                type="button"
                onClick={() => {
                  onSelectQuery(item.text);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition cursor-pointer text-left group ${
                  isSelected
                    ? 'bg-orange-50 text-black border border-orange-200'
                    : 'text-black hover:bg-slate-100 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  {item.type === 'brand' ? (
                    <Building2 className={`w-4 h-4 shrink-0 ${isSelected ? 'text-orange-600' : 'text-slate-600'}`} />
                  ) : item.type === 'trending' ? (
                    <Sparkles className={`w-4 h-4 shrink-0 ${isSelected ? 'text-amber-600' : 'text-amber-500'}`} />
                  ) : (
                    <Search className={`w-4 h-4 shrink-0 ${isSelected ? 'text-orange-600' : 'text-slate-600'}`} />
                  )}
                  <span className="truncate text-sm font-bold text-black">
                    {highlightPrefixMatch(item.text, trimmedQuery)}
                  </span>
                  {item.type === 'brand' && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-slate-200 text-black ml-1">
                      Brand
                    </span>
                  )}
                </div>
                <ArrowRight className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                  isSelected ? 'opacity-100 translate-x-0.5 text-orange-600' : 'opacity-0 text-slate-500 group-hover:opacity-100'
                }`} />
              </button>
            );
          })}
        </div>
      )}

      {/* 4. Recent Searches Section */}
      {filteredRecent.length > 0 && (
        <div className="p-3 bg-slate-50 border-t border-slate-150">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider mb-2 px-1 text-slate-700">
            <span className="flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-slate-600" />
              <span>Recent Searches</span>
            </span>
            <button
              type="button"
              onClick={onClearRecentSearches}
              className="text-[11px] text-rose-600 hover:text-rose-700 font-bold hover:underline cursor-pointer transition"
            >
              Clear All
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 px-1">
            {filteredRecent.map((term, idx) => (
              <div
                key={idx}
                onClick={() => {
                  onSelectQuery(term);
                  onClose();
                }}
                className="group inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-xl cursor-pointer text-xs font-bold transition-all shadow-3xs border bg-white text-black border-slate-300 hover:bg-slate-900 hover:text-white"
              >
                <History className="w-3 h-3 text-slate-600 group-hover:text-slate-300" />
                <span className="truncate max-w-[140px] text-black group-hover:text-white">{term}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveRecentSearch(term, e);
                  }}
                  className="p-1 rounded-md text-slate-500 hover:text-rose-500 hover:bg-slate-200 transition"
                  title="Remove"
                >
                  <X className="w-3 h-3 stroke-[2.5]" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
