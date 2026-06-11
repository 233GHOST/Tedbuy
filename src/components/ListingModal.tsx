import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Category, Product, normalizeCategory } from '../types';
import { X, Image, Upload, AlertCircle, Plus, Video } from 'lucide-react';
import { GHANA_REGIONS } from '../regions';
import { compressImage } from '../utils/imageOptimizer';

interface ListingModalProps {
  isOpen: boolean;
  onClose: () => void;
  productToEdit?: Product | null;
}

const CATEGORIES: Category[] = [
  'Phones',
  'Laptops',
  'Fashion',
  'Home Appliances',
  'Vehicles',
  'Beauty and Care',
  'Furniture & Home Decor',
  'Sports & Outdoors',
  'Books & Media',
  'Food & Beverages',
  'Pet Supplies',
  'Toys & Games',
  'Jewelry & Watches',
  'Health & Wellness',
  'Services',
  'Arts & Crafts',
  'Baby & Kids',
  'Other'
];

export const ListingModal: React.FC<ListingModalProps> = ({ isOpen, onClose, productToEdit }) => {
  const { createProduct, updateProduct, currentUser, setCurrentView } = useApp();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState<Category>('Phones');
  const [location, setLocation] = useState('');
  const [brand, setBrand] = useState('');
  const [condition, setCondition] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [videos, setVideos] = useState<string[]>([]);
  const [negotiable, setNegotiable] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Regional state helpers
  const [adRegion, setAdRegion] = useState('Greater Accra');
  const [adCity, setAdCity] = useState('Accra');
  const [adNeighborhood, setAdNeighborhood] = useState('');

  // Synchronize adCity when adRegion changes
  const activeRegionObj = GHANA_REGIONS.find(r => r.name === adRegion);
  useEffect(() => {
    if (activeRegionObj && !activeRegionObj.cities.includes(adCity)) {
      setAdCity(activeRegionObj.cities[0] || '');
    }
  }, [adRegion]);

  // Initialize form if editing
  useEffect(() => {
    if (productToEdit) {
      setTitle(productToEdit.title);
      setDescription(productToEdit.description);
      setPrice(productToEdit.price.toString());
      // Standardize category casing for UI/database uniformity
      const rawCat = productToEdit.category;
      setCategory(normalizeCategory(rawCat));
      setLocation(productToEdit.location);
      setImages(productToEdit.images);
      setVideos(productToEdit.videos || []);
      setBrand(productToEdit.brand || '');
      setCondition(productToEdit.condition || '');
      setNegotiable(productToEdit.negotiable !== false); // Default to true if undefined or true

      // Try to back-parse the product's location (e.g. "East Legon, Accra")
      const locVal = productToEdit.location;
      let foundRegion = 'Greater Accra';
      let foundCity = 'Accra';
      let foundNeighborhood = '';

      // Check which region/city matches
      for (const reg of GHANA_REGIONS) {
        let matchedReg = false;
        if (locVal.toLowerCase().includes(reg.name.toLowerCase())) {
          foundRegion = reg.name;
          matchedReg = true;
        }
        for (const city of reg.cities) {
          if (locVal.toLowerCase().includes(city.toLowerCase())) {
            foundCity = city;
            foundRegion = reg.name;
            matchedReg = true;
            break;
          }
        }
        if (matchedReg) break;
      }

      // If location is "East Legon, Accra", extract "East Legon" as neighborhood
      const parts = locVal.split(',');
      if (parts.length > 1) {
        foundNeighborhood = parts[0].trim();
      }

      setAdRegion(foundRegion);
      setAdCity(foundCity);
      setAdNeighborhood(foundNeighborhood);
    } else {
      // Clear fields
      setTitle('');
      setDescription('');
      setPrice('');
      setCategory('Phones');
      setLocation('');
      setBrand('');
      setCondition('');
      setImages([]);
      setVideos([]);
      setAdRegion('Greater Accra');
      setAdCity('Accra');
      setAdNeighborhood('');
      setNegotiable(true);
    }
    setErrorMsg('');
  }, [productToEdit, isOpen]);

  if (!isOpen) return null;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg('');
    const files = e.target.files;
    if (!files) return;

    const remainingSpots = 10 - images.length;
    if (files.length > remainingSpots) {
      setErrorMsg(`You can only upload up to 10 images. You have ${images.length} uploaded, meaning you can add ${remainingSpots} more.`);
      return;
    }

    (Array.from(files) as File[]).forEach(async file => {
      // Basic type validation
      if (!file.type.startsWith('image/')) {
        setErrorMsg('Only image files (JPEG, PNG, WEBP) are supported.');
        return;
      }
      
      // Allow up to 16MB image uploads (since we compress them client-side)
      if (file.size > 16 * 1024 * 1024) {
        setErrorMsg('Some images were skipped because they exceed 16MB in size.');
        return;
      }

      try {
        const compressed = await compressImage(file);
        setImages(prev => [...prev, compressed]);
      } catch (err) {
        console.error('Failed to compress image:', err);
        // Fallback to standard reader
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            setImages(prev => [...prev, reader.result as string]);
          }
        };
        reader.readAsDataURL(file);
      }
    });
  };

  const removeImage = (indexToRemove: number) => {
    setImages(prev => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg('');
    const files = e.target.files;
    if (!files) return;

    const remainingSpots = 2 - videos.length;
    if (files.length > remainingSpots) {
      setErrorMsg(`You can only upload up to 2 videos. You have ${videos.length} uploaded, meaning you can add ${remainingSpots} more.`);
      return;
    }

    (Array.from(files) as File[]).forEach(file => {
      // Basic type validation
      if (!file.type.startsWith('video/')) {
        setErrorMsg('Only video files (MP4, WEBM, MOV) are supported.');
        return;
      }
      
      // Limit video file sizes to 10MB
      if (file.size > 10 * 1024 * 1024) {
        setErrorMsg('Some videos were skipped because they exceed 10MB in size.');
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          setVideos(prev => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const removeVideo = (indexToRemove: number) => {
    setVideos(prev => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!title.trim()) return setErrorMsg('Product title is required.');
    
    const rawPrice = price.trim();
    if (!rawPrice) {
      return setErrorMsg('Please enter a price or price details (e.g., Contact for price).');
    }

    // Try parsing input to clean number if it is numeric (even with commas)
    let parsedPrice: string | number = rawPrice;
    const stripCommas = rawPrice.replace(/,/g, '');
    if (!isNaN(Number(stripCommas)) && stripCommas !== '') {
      parsedPrice = Number(stripCommas);
    }
    
    // Compile clean location address
    const compiledLocation = adNeighborhood.trim()
      ? `${adNeighborhood.trim()}, ${adCity}`
      : `${adCity}`;

    if (!adCity) {
      return setErrorMsg('Please select a City/Town in Ghana.');
    }
    if (!description.trim()) return setErrorMsg('Please write a detailed description of the item.');
    if (images.length === 0) {
      return setErrorMsg('Please upload at least 1 image to describe your product (Max: 10).');
    }

    setIsSubmitting(true);

    try {
      if (productToEdit) {
        // Edit flow
        await updateProduct(productToEdit.id, {
          title,
          description,
          price: parsedPrice,
          category,
          location: compiledLocation,
          brand,
          condition,
          images,
          videos,
          negotiable
        });
      } else {
        // Create flow
        await createProduct({
          title,
          description,
          price: parsedPrice,
          category,
          location: compiledLocation,
          brand,
          condition,
          images,
          videos,
          negotiable
        });
      }

      onClose();
      // Redirect to listing dashboard
      setCurrentView('my-dashboard');
    } catch (e: any) {
      let errStr = e?.message || String(e);
      let isPermissionDenied = false;
      if (errStr.trim().startsWith('{') && errStr.trim().endsWith('}')) {
        try {
          const parsed = JSON.parse(errStr);
          if (parsed.error) {
            errStr = parsed.error;
            if (errStr.includes('permission-denied') || errStr.toLowerCase().includes('permission') || errStr.toLowerCase().includes('insufficient')) {
              isPermissionDenied = true;
            }
          }
        } catch {
          // ignore
        }
      } else if (errStr.includes('permission-denied') || errStr.toLowerCase().includes('permission') || errStr.toLowerCase().includes('insufficient')) {
        isPermissionDenied = true;
      }

      if (errStr.startsWith('FirebaseError: ')) {
        errStr = errStr.replace('FirebaseError: ', '');
      }
      if (errStr.includes('[code=permission-denied]:')) {
        errStr = errStr.substring(errStr.indexOf('[code=permission-denied]:') + '[code=permission-denied]:'.length).trim();
      }

      let finalMsg = `Submission failed: ${errStr}`;
      if (isPermissionDenied) {
        finalMsg += '. (Possible causes: Your login session might have expired - try logging out and back in. Also, compile smaller compressed images if you are using high-resolution photos, or verify you are editing folders/products created by your exact account).';
      } else {
        finalMsg += ' (Hint: High-resolution photos/videos might exceed standard firestore sizes; try smaller images/compressing).';
      }
      setErrorMsg(finalMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-3xl border border-slate-100 max-w-2xl w-full shadow-2xl relative flex flex-col max-h-[92vh] text-left">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-3xl">
          <h2 className="text-lg font-bold text-slate-950 font-sans tracking-tight">
            {productToEdit ? 'Edit Live Advertisement' : 'Post Free Ad on Tedbuy'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-200 rounded-xl transition text-slate-500 hover:text-slate-900"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {errorMsg && (
            <div className="bg-red-50 text-red-700 p-4 rounded-xl text-xs flex items-start gap-2 border border-red-100">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form id="listing-creation-form" onSubmit={handleSubmit} className="space-y-4">
            {/* Title & Category */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Product Title</label>
                <input
                  type="text"
                  required
                  id="listing-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. iPhone 14 Pro 128GB"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Category</label>
                <select
                  id="listing-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Category)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none cursor-pointer"
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Brand & Condition */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Brand / Manufacturer</label>
                <input
                  type="text"
                  id="listing-brand"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder="e.g. Apple, Nike, Samsung, Toyota (optional)"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Item Condition</label>
                <input
                  type="text"
                  id="listing-condition"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  placeholder="e.g. Brand New, Good Condition (optional)"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Price & Location Selectors */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Price (GHS or Description)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    id="listing-price"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder=""
                    className="flex-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-slate-500 focus:outline-none"
                  />
                  <label className="flex items-center gap-2 px-3 border border-slate-200 rounded-xl bg-slate-50/50 cursor-pointer hover:bg-slate-50 transition shrink-0 select-none">
                    <input
                      type="checkbox"
                      id="listing-negotiable"
                      checked={negotiable}
                      onChange={(e) => setNegotiable(e.target.checked)}
                      className="w-4 h-4 text-emerald-650 focus:ring-emerald-500 border-slate-300 rounded cursor-pointer"
                    />
                    <div className="flex flex-col text-left">
                      <span className="text-[11px] font-bold text-slate-705 leading-none">Negotiable</span>
                      <span className="text-[8px] text-slate-400">Discuss price</span>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Ghana Region</label>
                <select
                  id="listing-region"
                  value={adRegion}
                  onChange={(e) => setAdRegion(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-slate-500 focus:outline-none cursor-pointer"
                >
                  {GHANA_REGIONS.map(reg => (
                    <option key={reg.name} value={reg.name}>{reg.name} Region</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">City / Town</label>
                <select
                  id="listing-city"
                  value={adCity}
                  onChange={(e) => setAdCity(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-slate-500 focus:outline-none cursor-pointer"
                >
                  {activeRegionObj?.cities.map(ct => (
                    <option key={ct} value={ct}>{ct}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Specific Neighborhood (Optional)</label>
                <input
                  type="text"
                  id="listing-neighborhood"
                  value={adNeighborhood}
                  onChange={(e) => setAdNeighborhood(e.target.value)}
                  placeholder="e.g. Asokwa, North Legon, West Legon"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-slate-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Detailed Description</label>
              <textarea
                required
                id="listing-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Write item status, usage duration, and notes for buyers..."
                rows={4}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-slate-500 focus:outline-none"
              />
            </div>

            {/* Product Images */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-slate-700">Product Images (1 to 10 images)</label>
                <span className="text-[11px] text-slate-400 font-mono">{images.length}/10 files uploaded</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {/* Thumbnail Previews */}
                {images.map((imgStr, idx) => (
                  <div key={idx} className="relative aspect-square rounded-xl bg-slate-50 border border-slate-200 group overflow-hidden">
                    <img src={imgStr} alt="Preview" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeImage(idx)}
                      className="absolute top-1 right-1 p-1 bg-red-650 hover:bg-red-700 text-white rounded-full transition-all opacity-90 hover:scale-105"
                      title="Delete Image"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                    <span className="absolute bottom-1 left-1 bg-slate-900/70 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-sm">
                      {idx === 0 ? 'Primary' : `Ad #${idx + 1}`}
                    </span>
                  </div>
                ))}

                {/* Upload Trigger Square */}
                {images.length < 10 && (
                  <label className="aspect-square border-2 border-dashed border-slate-250 hover:border-slate-400 rounded-xl flex flex-col items-center justify-center cursor-pointer bg-slate-50/50 hover:bg-slate-100 transition-all group">
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                    <Upload className="w-5 h-5 text-slate-400 group-hover:text-slate-800 group-hover:-translate-y-0.5 transition" />
                    <span className="text-[10px] text-slate-450 mt-1 font-semibold group-hover:text-slate-900">Add Photos</span>
                  </label>
                )}
              </div>
              <p className="text-[10px] text-slate-400 mt-2">
                📌 **Tip**: Click &ldquo;Add Photos&rdquo; to browse file directory (up to 10 images). High quality landscape JPEG, PNG, or WEBP photos work best to attract buyers.
              </p>
            </div>

            {/* Product Videos */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-slate-700">Product Videos (Optional, Max 2 videos)</label>
                <span className="text-[11px] text-slate-400 font-mono">{videos.length}/2 files uploaded</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {/* Video Previews */}
                {videos.map((vidStr, idx) => (
                  <div key={idx} className="relative aspect-square rounded-xl bg-slate-50 border border-slate-200 group overflow-hidden">
                    <video src={vidStr} className="w-full h-full object-cover" controls />
                    <button
                      type="button"
                      onClick={() => removeVideo(idx)}
                      className="absolute top-1 right-1 p-1 bg-red-650 hover:bg-red-700 text-white rounded-full transition-all opacity-90 hover:scale-105 z-10"
                      title="Delete Video"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                    <span className="absolute bottom-1 left-1 bg-slate-900/70 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-sm z-10">
                      Video #{idx + 1}
                    </span>
                  </div>
                ))}

                {/* Video Trigger Square */}
                {videos.length < 2 && (
                  <label className="aspect-square border-2 border-dashed border-slate-250 hover:border-slate-400 rounded-xl flex flex-col items-center justify-center cursor-pointer bg-slate-50/50 hover:bg-slate-100 transition-all group">
                    <input
                      type="file"
                      multiple
                      accept="video/*"
                      onChange={handleVideoUpload}
                      className="hidden"
                    />
                    <Video className="w-5 h-5 text-slate-400 group-hover:text-slate-800 group-hover:-translate-y-0.5 transition" />
                    <span className="text-[10px] text-slate-450 mt-1 font-semibold group-hover:text-slate-900">Add Videos</span>
                  </label>
                )}
              </div>
              <p className="text-[10px] text-slate-400 mt-2">
                📌 **Tip**: Click &ldquo;Add Videos&rdquo; to upload video guides (up to 2 videos, Max 10MB each) showing proof of functionality or live product demo.
              </p>
            </div>

            {/* Form actions */}
            <div className="border-t border-slate-100 pt-5 flex items-center justify-end gap-3 bg-slate-50 p-4 -mx-6 -mb-6 rounded-b-3xl">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                id="listing-submit-btn"
                disabled={isSubmitting}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-sm transition duration-200 flex items-center gap-1.5 disabled:opacity-50"
              >
                {isSubmitting ? 'Processing...' : productToEdit ? 'Save Changes' : 'Post Ad Now'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
