import React, { useState, useMemo } from 'react';
import { Category } from '../types';
import { CATEGORY_FILTERS, getModelsForBrand, FilterField } from '../utils/filterConfig';
import { SlidersHorizontal, RefreshCw, X, ChevronDown, Check, Search, Sparkles } from 'lucide-react';

interface DynamicCategoryFiltersProps {
  selectedCategory: Category | null;
  extraFilters: Record<string, string>;
  setExtraFilters: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export const DynamicCategoryFilters: React.FC<DynamicCategoryFiltersProps> = ({
  selectedCategory,
  extraFilters,
  setExtraFilters
}) => {
  // Simple state to track which searchable select is currently open
  const [activeSelectId, setActiveSelectId] = useState<string | null>(null);
  const [selectSearchQuery, setSelectSearchQuery] = useState('');

  // Handle setting a field value
  const handleFieldChange = (fieldId: string, value: string) => {
    setExtraFilters(prev => {
      const updated = { ...prev };
      if (!value || value === 'All') {
        const dependentFields = Object.values(CATEGORY_FILTERS[selectedCategory || 'Other'] || [])
          .filter(f => f.dependsOn === fieldId)
          .map(f => f.id);
        
        delete updated[fieldId];
        // Reset dependent fields as well (e.g. if brand cleared, reset model)
        dependentFields.forEach(id => {
          delete updated[id];
        });
      } else {
        updated[fieldId] = value;
      }
      return updated;
    });
    setActiveSelectId(null);
    setSelectSearchQuery('');
  };

  // Reset all dynamic filters
  const handleResetFilters = () => {
    setExtraFilters({});
    setActiveSelectId(null);
    setSelectSearchQuery('');
  };

  // If no category is selected, render a supportive helper card
  if (!selectedCategory) {
    return (
      <div className="bg-slate-50 border border-dashed border-slate-200 rounded-3xl p-5 text-left font-sans">
        <div className="flex gap-3">
          <span className="text-xl shrink-0">💡</span>
          <div>
            <h4 className="text-sm font-extrabold text-slate-800 mb-1">Custom Filters</h4>
            <p className="text-xs font-semibold text-slate-500 leading-relaxed">
              Select a classified category above to reveal specialized options (e.g. Brands, Models, Conditions, and Specific Specs).
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Fetch relevant filter fields for the active category
  const activeFields = CATEGORY_FILTERS[selectedCategory] || [];

  return (
    <div className="bg-white border-2 border-slate-900 rounded-3xl p-5 shadow-[0_12px_24px_rgba(15,23,42,0.06)] space-y-4 text-left font-sans transition-all">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{selectedCategory === 'Phones' ? '📱' : selectedCategory === 'Vehicles' ? '🚗' : selectedCategory === 'Property' ? '🏠' : '⚡'}</span>
          <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight">
            {selectedCategory} Specs
          </h4>
        </div>
        {Object.keys(extraFilters).length > 0 && (
          <button
            onClick={handleResetFilters}
            className="text-[10px] bg-red-50 hover:bg-slate-900 border border-red-200 hover:border-slate-900 text-red-600 hover:text-white font-black px-2 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
          >
            <X className="w-3 h-3 stroke-[2.5]" />
            <span>Clear Specs</span>
          </button>
        )}
      </div>

      {/* Active Filter Chips */}
      {Object.keys(extraFilters).length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-2 border-b border-slate-105">
          {Object.entries(extraFilters).map(([key, val]) => {
            const field = activeFields.find(f => f.id === key);
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-900 text-white rounded-lg text-[10px] font-black uppercase tracking-wider"
              >
                <span>{field?.label || key}: {val}</span>
                <button
                  onClick={() => handleFieldChange(key, '')}
                  className="hover:text-red-300 transition shrink-0 p-0.5"
                >
                  <X className="w-2.5 h-2.5 stroke-[2.5]" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Progressive Fields Wrapper */}
      <div className="space-y-3.5">
        {activeFields.map((field) => {
          // If this field depends on another parameter (e.g., model depends on brand)
          if (field.dependsOn) {
            const parentValue = extraFilters[field.dependsOn];
            // If the parent field hasn't been selected yet, do not render this filter to keep list clean
            if (!parentValue) return null;
          }

          // Fetch options (static lists or dynamically from model mapping)
          let options: string[] = [];
          if (field.id === 'model' && field.dependsOn) {
            const parentValue = extraFilters[field.dependsOn];
            options = getModelsForBrand(parentValue, selectedCategory);
          } else {
            options = field.options || [];
          }

          const currentValue = extraFilters[field.id] || '';
          const isOpen = activeSelectId === field.id;

          // Filter option results based on popover search input
          const filteredOptions = options.filter(opt =>
            opt.toLowerCase().includes(selectSearchQuery.toLowerCase())
          );

          return (
            <div key={field.id} className="space-y-1.5 relative">
              <label className="block text-[11px] font-black text-slate-700 uppercase tracking-wider px-0.5">
                {field.label}
              </label>

              {/* Custom Searchable / High-contrast dropdown trigger */}
              <button
                type="button"
                onClick={() => {
                  if (isOpen) {
                    setActiveSelectId(null);
                  } else {
                    setActiveSelectId(field.id);
                    setSelectSearchQuery('');
                  }
                }}
                className={`w-full px-3.5 py-2.5 bg-slate-50 border rounded-2xl text-xs font-bold text-left transition-all duration-150 flex items-center justify-between cursor-pointer ${
                  currentValue 
                    ? 'border-slate-900 bg-slate-50 text-slate-900 font-extrabold ring-2 ring-slate-950/5' 
                    : 'border-slate-200 text-slate-500 hover:border-slate-400'
                }`}
              >
                <span className="truncate">{currentValue || field.placeholder || `Select ${field.label}...`}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180 text-slate-900' : ''}`} />
              </button>

              {/* Enhanced Popover Dropdown Panel */}
              {isOpen && (
                <div className="absolute left-0 right-0 mt-1.5 bg-white border-2 border-slate-900 rounded-2xl shadow-xl z-20 overflow-hidden divide-y divide-slate-100 flex flex-col max-h-[220px] animate-in fade-in duration-100">
                  {/* Internal Search bar if there are lots of choices (> 5) */}
                  {options.length > 5 && (
                    <div className="p-2 bg-slate-50 flex items-center gap-1.5 border-b border-slate-100 shrink-0">
                      <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <input
                        type="text"
                        placeholder={`Search ${field.label}...`}
                        value={selectSearchQuery}
                        onChange={(e) => setSelectSearchQuery(e.target.value)}
                        className="w-full bg-transparent border-none text-[11px] font-bold text-slate-800 placeholder-slate-450 focus:outline-none p-0.5"
                        autoFocus
                      />
                      {selectSearchQuery && (
                        <button onClick={() => setSelectSearchQuery('')} className="text-slate-400 hover:text-slate-700">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Options List */}
                  <div className="overflow-y-auto py-1 scrollbar-thin">
                    <button
                      type="button"
                      onClick={() => handleFieldChange(field.id, '')}
                      className="w-full text-left px-3.5 py-1.5 text-[11px] font-black uppercase text-slate-500 hover:bg-slate-50 hover:text-slate-800 flex items-center justify-between"
                    >
                      <span>Any {field.label}</span>
                      {!currentValue && <Check className="w-3 h-3 text-slate-900 stroke-[3]" />}
                    </button>
                    
                    {filteredOptions.length === 0 ? (
                      <div className="p-3 text-center text-[11px] font-bold text-slate-450">
                        No matches found
                      </div>
                    ) : (
                      filteredOptions.map((opt) => {
                        const isSelected = currentValue === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => handleFieldChange(field.id, opt)}
                            className={`w-full text-left px-3.5 py-2 text-xs font-bold transition-colors flex items-center justify-between ${
                              isSelected 
                                ? 'bg-slate-900 text-white font-extrabold' 
                                : 'text-slate-755 hover:bg-slate-50 hover:text-slate-950'
                            }`}
                          >
                            <span>{opt}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-white stroke-[2.5]" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
