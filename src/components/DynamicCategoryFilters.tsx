import React, { useState, useMemo } from 'react';
import { Category } from '../types';
import { CATEGORY_FILTERS, getModelsForBrand, FilterField } from '../utils/filterConfig';
import { 
  X, 
  ChevronDown, 
  Check, 
  Search, 
  Sparkles, 
  Coins, 
  Battery, 
  Zap, 
  Compass, 
  Cpu, 
  Tag, 
  Maximize2,
  Bookmark,
  ChevronRight,
  Calculator,
  SlidersHorizontal,
  WashingMachine,
  Building2,
  Home,
  Store,
  Briefcase,
  Trees,
  Laptop,
  Camera,
  Scissors,
  Wrench,
  GraduationCap,
  Utensils,
  Package,
  Gamepad2
} from 'lucide-react';
import { useApp } from '../context/AppContext';

interface DynamicCategoryFiltersProps {
  selectedCategory: Category | null;
  extraFilters: Record<string, string>;
  setExtraFilters: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  minPrice?: string;
  maxPrice?: string;
  setMinPrice?: (val: string) => void;
  setMaxPrice?: (val: string) => void;
}

export const DynamicCategoryFilters: React.FC<DynamicCategoryFiltersProps> = ({
  selectedCategory,
  extraFilters,
  setExtraFilters,
  minPrice = '',
  maxPrice = '',
  setMinPrice,
  setMaxPrice
}) => {
  const { showToast } = useApp();
  const [activeSelectId, setActiveSelectId] = useState<string | null>(null);
  const [selectSearchQuery, setSelectSearchQuery] = useState('');

  // Fetch relevant filter fields for the active category
  const activeFields = selectedCategory ? (CATEGORY_FILTERS[selectedCategory] || []) : [];

  // Determine price ranges based on the selected category
  const priceRanges = useMemo(() => {
    switch (selectedCategory) {
      case 'Phones':
        return [
          { label: '< GH₵ 1.2 K', min: '', max: '1200' },
          { label: 'GH₵ 1.2 - 2 K', min: '1200', max: '2000' },
          { label: 'GH₵ 2 - 3.3 K', min: '2000', max: '3300' },
          { label: '> GH₵ 3.3 K', min: '3300', max: '' },
        ];
      case 'Laptops':
        return [
          { label: '< GH₵ 2.5 K', min: '', max: '2500' },
          { label: 'GH₵ 2.5 - 4.5 K', min: '2500', max: '4500' },
          { label: 'GH₵ 4.5 - 8 K', min: '4500', max: '8000' },
          { label: '> GH₵ 8 K', min: '8000', max: '' },
        ];
      case 'Vehicles':
        return [
          { label: '< GH₵ 40 K', min: '', max: '40000' },
          { label: 'GH₵ 40 - 80 K', min: '40000', max: '80000' },
          { label: 'GH₵ 80 - 150 K', min: '80000', max: '150000' },
          { label: '> GH₵ 150 K', min: '150000', max: '' },
        ];
      case 'Property':
        return [
          { label: '< GH₵ 1.5 K', min: '', max: '1500' },
          { label: 'GH₵ 1.5 - 4 K', min: '1500', max: '4000' },
          { label: 'GH₵ 4 - 10 K', min: '4000', max: '10000' },
          { label: '> GH₵ 10 K', min: '10000', max: '' },
        ];
      default:
        return [
          { label: '< GH₵ 500', min: '', max: '500' },
          { label: 'GH₵ 500 - 1.5 K', min: '500', max: '1500' },
          { label: 'GH₵ 1.5 - 4 K', min: '1500', max: '4000' },
          { label: '> GH₵ 4 K', min: '4000', max: '' },
        ];
    }
  }, [selectedCategory]);

  // Determine top brands/types for the Jiji-style visual grid
  const brandGridOptions = useMemo(() => {
    if (
      selectedCategory === 'Beauty and Care' ||
      selectedCategory === 'Services' ||
      selectedCategory === 'Property' ||
      selectedCategory === 'Home Appliances'
    ) {
      return null;
    }
    // Find the primary brand-like field (usually the first one, or 'brand', or 'propertyType')
    const primaryField = activeFields.find(f => f.id === 'brand' || f.id === 'propertyType' || f.id === 'serviceType' || f.id === 'applianceType' || f.id === 'platform');
    if (!primaryField || !primaryField.options) return null;

    // Get the first 7 options, and we'll add an 'Other' item
    const options = primaryField.options.slice(0, 7);
    return {
      fieldId: primaryField.id,
      label: primaryField.label,
      items: options,
      fullList: primaryField.options
    };
  }, [selectedCategory, activeFields]);

  // Jiji-style promotional banners
  const promoBanners = useMemo(() => {
    switch (selectedCategory) {
      case 'Phones':
        return [
          { 
            title: 'Value my phone', 
            icon: '📊', 
            bgColor: 'bg-indigo-50 border-indigo-150 text-indigo-800',
            action: () => showToast("📱 Phone valuation tool: Our algorithms estimate market value based on current live specs!", "info")
          },
          { 
            title: 'Budget-friendly', 
            icon: '💰', 
            bgColor: 'bg-emerald-50 border-emerald-150 text-emerald-800',
            action: () => {
              if (setMinPrice && setMaxPrice) {
                setMinPrice('');
                setMaxPrice('2000');
                showToast("Set price limit to under GH₵ 2,000!", "success");
              }
            }
          },
          { 
            title: 'Big Battery phones', 
            icon: '🔋', 
            bgColor: 'bg-amber-50 border-amber-150 text-amber-800',
            action: () => {
              handleFieldChange('network', '5G Network');
              showToast("Filtered for 5G High-Performance phones!", "success");
            }
          }
        ];
      case 'Laptops':
        return [
          { 
            title: 'Value my laptop', 
            icon: '📊', 
            bgColor: 'bg-indigo-50 border-indigo-150 text-indigo-800',
            action: () => showToast("💻 Laptop valuation active. Optimal trade pricing suggested!", "info")
          },
          { 
            title: 'Budget-friendly', 
            icon: '💰', 
            bgColor: 'bg-emerald-50 border-emerald-150 text-emerald-800',
            action: () => {
              if (setMinPrice && setMaxPrice) {
                setMinPrice('');
                setMaxPrice('4500');
                showToast("Set laptop price limit to under GH₵ 4,500!", "success");
              }
            }
          },
          { 
            title: 'Core i7 Power', 
            icon: '⚡', 
            bgColor: 'bg-sky-50 border-sky-150 text-sky-800',
            action: () => {
              handleFieldChange('processor', 'Intel Core i7');
              showToast("Filtered for powerful Intel Core i7 laptops!", "success");
            }
          }
        ];
      case 'Vehicles':
        return [
          { 
            title: 'Car Value Guide', 
            icon: '📊', 
            bgColor: 'bg-indigo-50 border-indigo-150 text-indigo-800',
            action: () => showToast("🚗 Assessing market resale value guides for vehicles in Ghana...", "info")
          },
          { 
            title: 'Smart Budgets', 
            icon: '💰', 
            bgColor: 'bg-emerald-50 border-emerald-150 text-emerald-800',
            action: () => {
              if (setMinPrice && setMaxPrice) {
                setMinPrice('');
                setMaxPrice('80000');
                showToast("Set car price limit to under GH₵ 80,000!", "success");
              }
            }
          },
          { 
            title: 'Automatic Drive', 
            icon: '⚙️', 
            bgColor: 'bg-amber-50 border-amber-150 text-amber-800',
            action: () => {
              handleFieldChange('transmission', 'Automatic');
              showToast("Filtered for Automatic transmission vehicles!", "success");
            }
          }
        ];
      case 'Property':
        return [
          { 
            title: 'Rent Estimator', 
            icon: '📈', 
            bgColor: 'bg-indigo-50 border-indigo-150 text-indigo-800',
            action: () => showToast("🏠 Property value indexer: Check average local rental indices!", "info")
          },
          { 
            title: 'Cozy Rooms', 
            icon: '💰', 
            bgColor: 'bg-emerald-50 border-emerald-150 text-emerald-800',
            action: () => {
              if (setMinPrice && setMaxPrice) {
                setMinPrice('');
                setMaxPrice('3000');
                showToast("Set rent limit to under GH₵ 3,000 / month!", "success");
              }
            }
          },
          { 
            title: 'Fully Furnished', 
            icon: '🛋️', 
            bgColor: 'bg-purple-50 border-purple-150 text-purple-800',
            action: () => {
              handleFieldChange('furnishedStatus', 'Fully Furnished');
              showToast("Filtered for Fully Furnished properties!", "success");
            }
          }
        ];
      default:
        return [
          { 
            title: 'Value Estimator', 
            icon: '🏷️', 
            bgColor: 'bg-indigo-50 border-indigo-150 text-indigo-800',
            action: () => showToast("📊 Estimating best market rates for listings!", "info")
          },
          { 
            title: 'Budget Options', 
            icon: '💰', 
            bgColor: 'bg-emerald-50 border-emerald-150 text-emerald-800',
            action: () => {
              if (setMinPrice && setMaxPrice) {
                setMinPrice('');
                setMaxPrice('1500');
                showToast("Set price limit to under GH₵ 1,500!", "success");
              }
            }
          },
          { 
            title: 'Brand New Deals', 
            icon: '✨', 
            bgColor: 'bg-amber-50 border-amber-150 text-amber-800',
            action: () => {
              handleFieldChange('condition', 'Brand New');
              showToast("Filtered for Brand New condition!", "success");
            }
          }
        ];
    }
  }, [selectedCategory, setMinPrice, setMaxPrice]);

  // Handle setting a field value
  const handleFieldChange = (fieldId: string, value: string) => {
    setExtraFilters(prev => {
      const updated = { ...prev };
      if (!value || value === 'All' || value === 'Other') {
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
    if (setMinPrice) setMinPrice('');
    if (setMaxPrice) setMaxPrice('');
    setActiveSelectId(null);
    setSelectSearchQuery('');
  };

  // Render a customized miniature logo/icon for major brands
  const renderBrandLogo = (brand: string) => {
    const cleanBrand = brand.trim().toLowerCase();
    switch (cleanBrand) {
      // Phones & Laptops & Electronics
      case 'apple':
        return <span className="text-lg font-semibold text-slate-800"></span>;
      case 'samsung':
        return <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 bg-blue-50 px-1 rounded-sm">SAMSUNG</span>;
      case 'google':
        return (
          <span className="flex items-center justify-center font-bold text-xs">
            <span className="text-blue-500">G</span>
            <span className="text-red-500">o</span>
            <span className="text-yellow-500">o</span>
            <span className="text-blue-500">g</span>
          </span>
        );
      case 'huawei':
        return <span className="text-xs font-bold text-red-600">HUAWEI</span>;
      case 'xiaomi':
        return <span className="text-[9px] font-black text-white bg-orange-500 px-1 rounded-xs">mi</span>;
      case 'tecno':
        return <span className="text-[10px] font-black italic tracking-tight text-blue-700">TECNO</span>;
      case 'infinix':
        return <span className="text-[10px] font-bold text-emerald-600">Infinix</span>;
      case 'nokia':
        return <span className="text-[10px] font-black tracking-widest text-blue-800 bg-blue-50 px-1 rounded-xs">NOKIA</span>;
      case 'dell':
        return <span className="text-[10px] font-extrabold border-2 border-blue-500 text-blue-500 px-1 rounded-full leading-none">DELL</span>;
      case 'hp':
        return <span className="text-xs font-black italic text-slate-700">hp</span>;
      case 'lenovo':
        return <span className="text-[9px] font-bold text-white bg-[#e2231a] px-1.5 py-0.5 rounded-sm tracking-tighter uppercase">lenovo</span>;
      case 'asus':
        return <span className="text-[10px] font-black text-slate-800 tracking-tighter">ASUS</span>;
      case 'acer':
        return <span className="text-[10px] font-black text-emerald-500">acer</span>;
      case 'microsoft':
        return (
          <span className="grid grid-cols-2 gap-[1.5px] w-3 h-3">
            <span className="bg-[#f25022] w-1.5 h-1.5 rounded-2xs"></span>
            <span className="bg-[#7fba00] w-1.5 h-1.5 rounded-2xs"></span>
            <span className="bg-[#00a4ef] w-1.5 h-1.5 rounded-2xs"></span>
            <span className="bg-[#ffb900] w-1.5 h-1.5 rounded-2xs"></span>
          </span>
        );
      case 'oneplus':
        return <span className="text-[10px] font-extrabold text-red-600 border border-red-650 px-1 rounded-sm bg-red-50">1+</span>;
      case 'oppo':
        return <span className="text-[10px] font-black tracking-tight text-emerald-600">OPPO</span>;
      case 'vivo':
        return <span className="text-[10px] font-black italic tracking-tighter text-blue-600">vivo</span>;

      // Electronics Specific
      case 'sony':
        return <span className="text-[10px] font-black tracking-widest text-slate-800 uppercase">SONY</span>;
      case 'lg':
        return <span className="text-[10px] font-black text-red-600 bg-red-50 px-1 rounded-sm">L-G</span>;
      case 'hisense':
        return <span className="text-[10px] font-black text-teal-600 uppercase">HISENSE</span>;
      case 'tcl':
        return <span className="text-[10px] font-extrabold text-red-600 tracking-wider">TCL</span>;
      case 'panasonic':
        return <span className="text-[9px] font-black text-blue-900 tracking-wide">PANASONIC</span>;
      case 'philips':
        return <span className="text-[9px] font-bold text-blue-600">PHILIPS</span>;
      case 'canon':
        return <span className="text-[10px] font-extrabold text-red-600 tracking-tight">Canon</span>;
      case 'nikon':
        return <span className="text-[10px] font-black bg-yellow-400 text-black px-1">Nikon</span>;

      // Vehicles
      case 'toyota':
        return <span className="text-[10px] font-black tracking-widest text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-sm">TOYOTA</span>;
      case 'honda':
        return <span className="text-xs font-black border border-slate-700 px-1.5 py-0.5 rounded-sm bg-slate-50 text-slate-800">H</span>;
      case 'mercedes-benz':
        return <span className="text-[9px] font-bold tracking-widest text-slate-800 uppercase border border-slate-300 bg-slate-50 px-1.5 py-0.5 rounded-sm">MERCEDES</span>;
      case 'bmw':
        return <span className="text-[9px] font-black border-2 border-slate-900 text-slate-900 px-1 py-0.5 rounded-full bg-slate-50 leading-none">BMW</span>;
      case 'nissan':
        return <span className="text-[9px] font-black border-2 border-slate-700 text-slate-700 px-1.5 py-0.5 rounded-md uppercase tracking-tight">NISSAN</span>;
      case 'kia':
        return <span className="text-[10px] font-black tracking-widest text-slate-900 uppercase italic">KИ</span>;
      case 'hyundai':
        return <span className="text-[10px] font-black italic text-white bg-blue-900 px-1.5 py-0.5 rounded-sm leading-none">H</span>;
      case 'ford':
        return <span className="text-[10px] font-black italic text-blue-900 bg-blue-50 px-1.5 py-0.5 rounded-full border border-blue-900">Ford</span>;
      case 'lexus':
        return <span className="text-[10px] font-black border border-slate-800 w-5 h-5 flex items-center justify-center rounded-full text-slate-800 bg-slate-50">L</span>;
      case 'mazda':
        return <span className="text-[10px] font-black italic text-slate-800 tracking-wider">MAZDA</span>;

      // Property Types
      case 'apartment & flat':
        return <Building2 className="w-5 h-5 text-blue-500 stroke-[2]" />;
      case 'self-contain room':
        return <Home className="w-5 h-5 text-amber-500 stroke-[2]" />;
      case 'chamber and hall':
        return <Home className="w-5 h-5 text-emerald-500 stroke-[2]" />;
      case 'detached house':
        return <Home className="w-5 h-5 text-indigo-500 stroke-[2]" />;
      case 'commercial property':
        return <Store className="w-5 h-5 text-violet-500 stroke-[2]" />;
      case 'office space':
        return <Briefcase className="w-5 h-5 text-slate-700 stroke-[2]" />;
      case 'land / plot':
        return <Trees className="w-5 h-5 text-green-600 stroke-[2]" />;

      // Fashion & Gender
      case 'men':
        return <span className="flex items-center justify-center font-black text-[10px] text-blue-600 bg-blue-50 px-2 py-1 rounded-full border border-blue-200 tracking-wider">GENTS</span>;
      case 'women':
        return <span className="flex items-center justify-center font-black text-[10px] text-pink-600 bg-pink-50 px-2 py-1 rounded-full border border-pink-200 tracking-wider">LADIES</span>;

      // Home Appliances
      case 'refrigerator & freezer':
        return (
          <img 
            src="https://images.unsplash.com/photo-1571175482282-46759b5d4964?auto=format&fit=crop&w=120&h=120&q=80" 
            alt="Refrigerator" 
            className="w-10 h-10 object-contain rounded-md" 
            referrerPolicy="no-referrer"
          />
        );
      case 'microwave & oven':
        return (
          <img 
            src="https://images.unsplash.com/photo-1626806787461-102c1bfaaea1?auto=format&fit=crop&w=120&h=120&q=80" 
            alt="Microwave" 
            className="w-10 h-10 object-contain rounded-md" 
            referrerPolicy="no-referrer"
          />
        );
      case 'washing machine':
        return (
          <img 
            src="https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=120&h=120&q=80" 
            alt="Washing Machine" 
            className="w-10 h-10 object-contain rounded-md" 
            referrerPolicy="no-referrer"
          />
        );
      case 'air conditioner':
        return (
          <img 
            src="https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=120&h=120&q=80" 
            alt="Air Conditioner" 
            className="w-10 h-10 object-contain rounded-md" 
            referrerPolicy="no-referrer"
          />
        );
      case 'blender & mixer':
        return (
          <img 
            src="https://images.unsplash.com/photo-1578643463396-0997cb5328c1?auto=format&fit=crop&w=120&h=120&q=80" 
            alt="Blender & Mixer" 
            className="w-10 h-10 object-contain rounded-md" 
            referrerPolicy="no-referrer"
          />
        );
      case 'television':
        return (
          <img 
            src="https://images.unsplash.com/photo-1593784991095-a205069470b6?auto=format&fit=crop&w=120&h=120&q=80" 
            alt="Television" 
            className="w-10 h-10 object-contain rounded-md" 
            referrerPolicy="no-referrer"
          />
        );
      case 'gas cooker':
        return (
          <img 
            src="https://images.unsplash.com/photo-1522836924445-4478bdeb860c?auto=format&fit=crop&w=120&h=120&q=80" 
            alt="Gas Cooker" 
            className="w-10 h-10 object-contain rounded-md" 
            referrerPolicy="no-referrer"
          />
        );
      case 'water dispenser':
        return (
          <img 
            src="https://images.unsplash.com/photo-1585250004612-409dd755c327?auto=format&fit=crop&w=120&h=120&q=80" 
            alt="Water Dispenser" 
            className="w-10 h-10 object-contain rounded-md" 
            referrerPolicy="no-referrer"
          />
        );

      // Beauty & Care Brands
      case 'fenty beauty':
        return <span className="text-[9px] font-bold tracking-widest uppercase text-slate-800">FENTY</span>;
      case 'the ordinary':
        return <span className="text-[9px] font-light tracking-wide text-slate-500 border-b border-slate-300">Ordinary.</span>;
      case 'nivea':
        return <span className="text-[9px] font-extrabold text-white bg-blue-800 px-1.5 py-0.5 rounded-sm">NIVEA</span>;
      case 'cetaphil':
        return <span className="text-[9px] font-extrabold text-blue-700">Cetaphil</span>;
      case 'l\'oreal':
      case 'l\'oréal':
        return <span className="text-[8px] font-bold tracking-widest uppercase text-slate-700">L'OREAL</span>;
      case 'maybelline':
        return <span className="text-[8px] font-bold uppercase text-slate-800">MAYBELLINE</span>;
      case 'chanel':
        return <span className="text-[9px] font-bold tracking-widest uppercase text-slate-900">CHANEL</span>;

      // Games Platforms
      case 'sony playstation 5':
        return <span className="text-[10px] font-black text-slate-800 bg-slate-50 px-1.5 py-0.5 rounded-md border border-slate-200">PS5</span>;
      case 'sony playstation 4':
        return <span className="text-[10px] font-black text-slate-600 bg-slate-50 px-1.5 py-0.5 rounded-md border border-slate-200">PS4</span>;
      case 'xbox series x/s':
        return <span className="text-[10px] font-extrabold text-emerald-600 bg-emerald-50 px-1 rounded-sm">XBOX X/S</span>;
      case 'xbox one':
        return <span className="text-[10px] font-extrabold text-slate-700 bg-slate-50 px-1 rounded-sm">XBOX ONE</span>;
      case 'nintendo switch':
        return <span className="text-[9px] font-black bg-red-500 text-white px-1.5 py-0.5 rounded-sm uppercase tracking-tighter">SWITCH</span>;
      case 'gaming pc':
        return <Gamepad2 className="w-5 h-5 text-indigo-650 stroke-[2]" />;

      // Services Specializations (Fixes the IT, PHO, FAS issues)
      case 'it, computer & software':
        return <Laptop className="w-5 h-5 text-blue-500 stroke-[2]" />;
      case 'photography & video services':
        return <Camera className="w-5 h-5 text-amber-500 stroke-[2]" />;
      case 'fashion & tailoring services':
        return <Scissors className="w-5 h-5 text-pink-500 stroke-[2]" />;
      case 'home repair & plumbing':
        return <Wrench className="w-5 h-5 text-slate-600 stroke-[2]" />;
      case 'cleaning & laundry services':
        return <WashingMachine className="w-5 h-5 text-teal-500 stroke-[2]" />;
      case 'tutoring & training':
        return <GraduationCap className="w-5 h-5 text-indigo-600 stroke-[2]" />;
      case 'catering & event planning':
        return <Utensils className="w-5 h-5 text-amber-500 stroke-[2]" />;
      case 'beauty & hair styling':
        return <Sparkles className="w-5 h-5 text-rose-450 stroke-[2]" />;
      case 'courier & logistics services':
        return <Package className="w-5 h-5 text-orange-500 stroke-[2]" />;

      default:
        return <span className="text-xs font-bold text-slate-400 uppercase">{brand.slice(0, 3)}</span>;
    }
  };

  const isAnyFilterActive = Object.keys(extraFilters).length > 0 || minPrice || maxPrice;

  if (!selectedCategory) {
    return null;
  }

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 shadow-xs space-y-4 text-left font-sans transition-all">
      {/* Header with Jiji Feel */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-emerald-500" />
          <h4 className="text-xs font-black text-slate-900 uppercase tracking-tight flex items-center gap-1.5">
            <span>Filter {selectedCategory}</span>
          </h4>
        </div>
        {isAnyFilterActive && (
          <button
            onClick={handleResetFilters}
            className="text-[10px] bg-emerald-50 hover:bg-emerald-600 border border-emerald-200 hover:border-emerald-600 text-emerald-600 hover:text-white font-black px-2 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
          >
            <X className="w-3 h-3 stroke-[2.5]" />
            <span>Reset All</span>
          </button>
        )}
      </div>



      {/* Quick Price Range Chips (Jiji-style) */}
      <div className="space-y-1.5">
        <span className="block text-[9px] font-black text-slate-400 uppercase tracking-wider px-0.5">
          Quick Price Range
        </span>
        <div className="grid grid-cols-2 gap-2">
          {priceRanges.map((range) => {
            const isSelected = minPrice === range.min && maxPrice === range.max;
            return (
              <button
                key={range.label}
                onClick={() => {
                  if (isSelected) {
                    if (setMinPrice) setMinPrice('');
                    if (setMaxPrice) setMaxPrice('');
                  } else {
                    if (setMinPrice) setMinPrice(range.min);
                    if (setMaxPrice) setMaxPrice(range.max);
                  }
                }}
                className={`px-2 py-2 rounded-xl border text-[10px] font-bold text-center transition-all cursor-pointer select-none ${
                  isSelected
                    ? 'bg-emerald-500 border-emerald-500 text-white shadow-xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300 hover:bg-emerald-50/20'
                }`}
              >
                {range.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Quick Brands Grid (Jiji-style logo tiles) */}
      {brandGridOptions && (
        <div className="space-y-2 pt-1 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <span className="block text-[9px] font-black text-slate-400 uppercase tracking-wider px-0.5">
              Popular {brandGridOptions.label}s
            </span>
            {extraFilters[brandGridOptions.fieldId] && (
              <button
                onClick={() => handleFieldChange(brandGridOptions.fieldId, '')}
                className="text-[9px] text-emerald-600 hover:underline font-bold"
              >
                Clear Selection
              </button>
            )}
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {brandGridOptions.items.map((brand) => {
              const isSelected = extraFilters[brandGridOptions.fieldId] === brand;
              return (
                <button
                  key={brand}
                  onClick={() => handleFieldChange(brandGridOptions.fieldId, isSelected ? '' : brand)}
                  className={`p-2 rounded-xl border flex flex-col items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer select-none ${
                    isSelected
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-500/30'
                      : 'border-slate-150 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="h-10 flex items-center justify-center">
                    {renderBrandLogo(brand)}
                  </div>
                  <span className="text-[9px] font-bold text-center leading-tight truncate w-full">
                    {brand}
                  </span>
                </button>
              );
            })}

            {/* Other option trigger */}
            <button
              onClick={() => {
                // Open the standard dropdown for brand selector
                if (activeSelectId === brandGridOptions.fieldId) {
                  setActiveSelectId(null);
                } else {
                  setActiveSelectId(brandGridOptions.fieldId);
                  setSelectSearchQuery('');
                }
              }}
              className={`p-2 rounded-xl border flex flex-col items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer select-none ${
                activeSelectId === brandGridOptions.fieldId
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                  : 'border-slate-150 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className="h-6 flex items-center justify-center text-xs font-black text-slate-400">
                •••
              </div>
              <span className="text-[9px] font-bold text-center leading-tight">
                Other
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Dropdown Spec Pills Row (Jiji style) */}
      <div className="space-y-2 pt-2 border-t border-slate-100">
        <span className="block text-[9px] font-black text-slate-400 uppercase tracking-wider px-0.5">
          Specification Filters
        </span>

        <div className="flex flex-wrap gap-2">
          {activeFields.map((field) => {
            // Skip the primary brand/type since we have the beautiful grid, unless we are currently searching it
            const isPrimaryGridField = brandGridOptions && field.id === brandGridOptions.fieldId;
            
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
              <div key={field.id} className="relative">
                {/* Custom Pill Dropdown Trigger */}
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
                  className={`px-3 py-1.5 border rounded-full text-[11px] font-bold transition-all duration-150 flex items-center gap-1.5 cursor-pointer ${
                    currentValue 
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800 font-extrabold shadow-3xs' 
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-350 hover:bg-slate-50'
                  }`}
                >
                  <span className="max-w-[120px] truncate">
                    {currentValue ? `${field.label}: ${currentValue}` : field.label}
                  </span>
                  <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform duration-250 ${isOpen ? 'rotate-180 text-emerald-600' : ''}`} />
                </button>

                {/* Popover Dropdown Panel */}
                {isOpen && (
                  <div className="absolute left-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl z-30 overflow-hidden divide-y divide-slate-100 flex flex-col w-[200px] max-h-[220px] animate-in fade-in duration-100">
                    {/* Internal Search bar if there are lots of choices (> 5) */}
                    {options.length > 5 && (
                      <div className="p-2 bg-slate-50 flex items-center gap-1.5 border-b border-slate-100 shrink-0">
                        <Search className="w-3 h-3 text-slate-400 shrink-0" />
                        <input
                          type="text"
                          placeholder={`Search ${field.label}...`}
                          value={selectSearchQuery}
                          onChange={(e) => setSelectSearchQuery(e.target.value)}
                          className="w-full bg-transparent border-none text-[10px] font-bold text-slate-800 placeholder-slate-400 focus:outline-none p-0.5"
                          autoFocus
                        />
                        {selectSearchQuery && (
                          <button onClick={() => setSelectSearchQuery('')} className="text-slate-400 hover:text-slate-700">
                            <X className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Options List */}
                    <div className="overflow-y-auto py-1 scrollbar-thin">
                      <button
                        type="button"
                        onClick={() => handleFieldChange(field.id, '')}
                        className="w-full text-left px-3.5 py-1.5 text-[10px] font-black uppercase text-slate-400 hover:bg-slate-50 hover:text-slate-700 flex items-center justify-between"
                      >
                        <span>Any {field.label}</span>
                        {!currentValue && <Check className="w-3 h-3 text-emerald-500 stroke-[3]" />}
                      </button>
                      
                      {filteredOptions.length === 0 ? (
                        <div className="p-3 text-center text-[10px] font-bold text-slate-400">
                          No matches
                        </div>
                      ) : (
                        filteredOptions.map((opt) => {
                          const isSelected = currentValue === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => handleFieldChange(field.id, opt)}
                              className={`w-full text-left px-3.5 py-1.5 text-xs font-bold transition-colors flex items-center justify-between ${
                                isSelected 
                                  ? 'bg-emerald-500 text-white font-extrabold' 
                                  : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                              }`}
                            >
                              <span>{opt}</span>
                              {isSelected && <Check className="w-3 h-3 text-white stroke-[2.5]" />}
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
    </div>
  );
};
