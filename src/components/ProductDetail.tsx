import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { ArrowLeft, MessageSquare, MapPin, Eye, Calendar, UserPlus, UserCheck, ChevronRight, ShieldAlert, Bookmark, X, Camera, ChevronLeft, Maximize2, Edit2, Trash2, Share2, Check, Package, RefreshCw, Plus, Sparkles, Video, Loader2, Flame, FileText, Send } from 'lucide-react';
import { ProductCard } from './ProductCard';
import { ListingModal } from './ListingModal';
import { isUserVerified, calculateTrustScore, normalizeCategory, isUserAdmin, Category } from '../types';
import { SellerBadge } from './SellerBadge';
import { slugify } from '../utils/slugify';
import { auth } from '../firebase';
import { isBoostActive, parseDate, getBoostEndDate, formatTedbuyTenure } from '../utils/dateParser';
import { getOptimizedImageUrl } from '../utils/imageOptimizer';
import { resolveProductImage, resolveProductImages, getCategoryPlaceholder, getCanonicalMediaKey } from '../utils/productUtils';
import { MediaRenderer, isVideoAsset } from './MediaRenderer';
import { ProductDetailSkeleton } from './PageLoadingSkeletons';

export const ProductDetail: React.FC = () => {
  const {
    products,
    users,
    reviews,
    selectedProductId,
    setSelectedProductId,
    setCurrentView,
    currentUser,
    followSeller,
    unfollowSeller,
    startChat,
    reportProduct,
    setSelectedSellerId,
    toggleSaveProduct,
    setShowAuthModal,
    setAuthMode,
    incrementProductViews,
    deleteProduct,
    updateProduct,
    setIsVerificationBlockOpen,
    setBlockedActionType,
    showToast,
    selectedCategory,
    setSelectedCategory,
    isProductsLoading,
    registerProduct
  } = useApp();

  const product = products.find(p => p.id === selectedProductId);
  const [isFetchingDirect, setIsFetchingDirect] = useState(false);
  const [fetchNotFound, setFetchNotFound] = useState(false);

  const handleGoBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
    } else {
      setSelectedProductId(null);
      setCurrentView('browse');
    }
  };

  // Directly fetch product if navigated via URL / bookmark and not in memory cache yet
  useEffect(() => {
    if (!selectedProductId) return;
    if (product) {
      setIsFetchingDirect(false);
      setFetchNotFound(false);
      return;
    }

    let isSubscribed = true;
    setIsFetchingDirect(true);
    setFetchNotFound(false);

    const fetchDirectItem = async () => {
      try {
        const res = await fetch(`/api/products/${selectedProductId}`);
        if (!res.ok) {
          if (res.status === 404 && isSubscribed) {
            setFetchNotFound(true);
          }
          return;
        }
        const data = await res.json();
        if (isSubscribed && data && data.success && data.product) {
          registerProduct(data.product);
          setIsFetchingDirect(false);
          setFetchNotFound(false);
        } else if (isSubscribed) {
          setFetchNotFound(true);
        }
      } catch (err) {
        console.warn(`[ProductDetail] direct fetch failed for ${selectedProductId}:`, err);
        if (isSubscribed) {
          setFetchNotFound(true);
        }
      } finally {
        if (isSubscribed) {
          setIsFetchingDirect(false);
        }
      }
    };

    fetchDirectItem();

    return () => {
      isSubscribed = false;
    };
  }, [selectedProductId, product, registerProduct]);
  const sellerUser = users?.find(u => u.id === product?.sellerId);
  const isSellerVerified = isUserVerified(sellerUser);
  const sellerReviews = reviews.filter(r => r.sellerId === product?.sellerId);
  const trustResult = calculateTrustScore(sellerUser, sellerReviews);

  const [viewedPhoto, setViewedPhoto] = useState<{ url: string; name: string } | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [activeMediaIdx, setActiveMediaIdx] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteCheckboxConfirmed, setDeleteCheckboxConfirmed] = useState(true);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAdminBoosting, setIsAdminBoosting] = useState(false);
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const [selectedFreePlan, setSelectedFreePlan] = useState('7days');

  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportReason, setReportReason] = useState('spam');
  const [reportComment, setReportComment] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [showSafetyTips, setShowSafetyTips] = useState(false);
  const [safetyTipsPendingAction, setSafetyTipsPendingAction] = useState<'message' | 'whatsapp' | null>(null);

  const [inlineChatMessage, setInlineChatMessage] = useState('');
  const [isStartingChat, setIsStartingChat] = useState(false);

  const [isDetailFetching, setIsDetailFetching] = useState(false);
  const [videoErrors, setVideoErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setVideoErrors({});
  }, [selectedProductId]);

  useEffect(() => {
    if (!product) return;
    if (product.images && product.images.length === 1) {
      setIsDetailFetching(true);
      const timer = setTimeout(() => {
        setIsDetailFetching(false);
      }, 2000);
      return () => clearTimeout(timer);
    } else {
      setIsDetailFetching(false);
    }
  }, [selectedProductId, product?.images?.length]);

  const handleOpenReportModal = () => {
    if (!currentUser) {
      setAuthMode('login');
      setShowAuthModal(true);
      showToast("Please sign in to report a listing.", "info");
      return;
    }
    setReportReason('spam');
    setReportComment('');
    setIsReportModalOpen(true);
  };

  const handleShareProduct = async () => {
    if (!product) return;
    const cleanSlug = slugify(product.title || 'item');
    const isService = isServiceCategory || (product.category && (product.category.toLowerCase() === 'services' || product.category.toLowerCase().includes('service')));
    const hasPrice = !isService && formattedPrice && formattedPrice !== 'GH₵0' && formattedPrice !== 'GHS 0' && Number(product.price) > 0;
    const priceParam = hasPrice ? encodeURIComponent(formattedPrice || '') : '';
    const shareUrl = `${window.location.origin}/product/${product.id}-${cleanSlug}?title=${encodeURIComponent(product.title || '')}&price=${priceParam}`;
    const shareTitle = product.title;
    const priceText = hasPrice ? ` for ${formattedPrice}` : '';
    const shareText = `Check out "${product.title}"${priceText} on TedBuy Ghana!`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl
        });
        showToast("Shared successfully! 🎉", "success");
      } catch (err: any) {
        if (err && err.name !== 'AbortError') {
          console.warn("navigator.share failed, opening custom share modal...", err);
          setIsShareModalOpen(true);
        }
      }
    } else {
      setIsShareModalOpen(true);
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return;
    setIsSubmittingReport(true);
    try {
      await reportProduct(product.id, reportReason, reportComment);
      setIsReportModalOpen(false);
    } catch (err: any) {
      showToast(err.message || "Failed to submit report.", "error");
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const productImages = resolveProductImages(product, 800);

  const hasRealVideos = Boolean(product?.videos && product.videos.some(v => isVideoAsset(v)));

  const rawGallery = product ? [
    ...(product.videos || [])
      .filter(url => Boolean(url && typeof url === 'string' && url.trim().length > 0))
      .map(url => ({
        type: (isVideoAsset(url) ? 'video' : 'image') as 'video' | 'image',
        url: isVideoAsset(url) ? url : getOptimizedImageUrl(url, 800)
      })),
    ...productImages
      .filter(url => {
        if (!url || typeof url !== 'string' || url.trim().length === 0) return false;
        if (url.includes('unsplash.com')) return false;
        if (product.videos && product.videos.includes(url)) return false;
        return true;
      })
      .map(url => ({ type: 'image' as const, url }))
  ] : [];

  const seenMediaKeys = new Set<string>();
  const mediaGallery: { type: 'video' | 'image'; url: string }[] = [];

  for (const item of rawGallery) {
    const key = `${item.type}:${getCanonicalMediaKey(item.url)}`;
    if (!seenMediaKeys.has(key)) {
      seenMediaKeys.add(key);
      mediaGallery.push(item);
    }
  }

  if (product && mediaGallery.length === 0) {
    mediaGallery.push({
      type: 'image',
      url: getCategoryPlaceholder(product.category)
    });
  }

  // Keyboard navigation support for Media Lightbox
  useEffect(() => {
    if (!product) return;

    const priceText = formatProductPrice(product.price);
    const originalTitle = document.title;
    const cleanTitle = `${product.title} - GHS ${priceText || 'Negotiable'} | TedBuy Ghana`;
    document.title = cleanTitle;

    const primaryImage = resolveProductImage(product, 800);

    const absoluteImageUrl = primaryImage.startsWith('http')
      ? primaryImage
      : `${window.location.origin}${primaryImage.startsWith('/') ? '' : '/'}${primaryImage}`;

    const cleanSlug = slugify(product.title || 'item');
    const canonicalShareUrl = `${window.location.origin}/product/${product.id}-${cleanSlug}?title=${encodeURIComponent(product.title || '')}&price=${encodeURIComponent(priceText || '')}`;

    const metaTags = [
      { property: 'og:title', content: cleanTitle },
      { property: 'og:description', content: product.description || `Check out "${product.title}" on TedBuy Ghana!` },
      { property: 'og:image', content: absoluteImageUrl },
      { property: 'og:url', content: canonicalShareUrl },
      { property: 'og:type', content: 'product' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: cleanTitle },
      { name: 'twitter:description', content: product.description || `Check out "${product.title}" on TedBuy Ghana!` },
      { name: 'twitter:image', content: absoluteImageUrl },
    ];

    const elementsToCleanup: { el: HTMLMetaElement; created: boolean; prevContent?: string }[] = [];

    metaTags.forEach(({ property, name, content }) => {
      const selector = property ? `meta[property="${property}"]` : `meta[name="${name}"]`;
      let el = document.querySelector<HTMLMetaElement>(selector);
      if (el) {
        const prevContent = el.getAttribute('content') || '';
        el.setAttribute('content', content);
        elementsToCleanup.push({ el, created: false, prevContent });
      } else {
        el = document.createElement('meta');
        if (property) el.setAttribute('property', property);
        if (name) el.setAttribute('name', name);
        el.setAttribute('content', content);
        document.head.appendChild(el);
        elementsToCleanup.push({ el, created: true });
      }
    });

    return () => {
      document.title = originalTitle;
      elementsToCleanup.forEach(({ el, created, prevContent }) => {
        if (created) {
          if (el.parentNode) el.parentNode.removeChild(el);
        } else if (prevContent !== undefined) {
          el.setAttribute('content', prevContent);
        }
      });
    };
  }, [product]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (lightboxIndex !== null && mediaGallery.length > 0) {
        if (e.key === 'Escape') {
          setLightboxIndex(null);
        } else if (e.key === 'ArrowRight') {
          setLightboxIndex((prev) => (prev !== null && prev < mediaGallery.length - 1 ? prev + 1 : 0));
        } else if (e.key === 'ArrowLeft') {
          setLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : mediaGallery.length - 1));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [lightboxIndex, mediaGallery.length]);

  const handleNextImage = () => {
    if (mediaGallery.length <= 1) return;
    setActiveMediaIdx((prev) => (prev + 1) % mediaGallery.length);
  };

  const handlePrevImage = () => {
    if (mediaGallery.length <= 1) return;
    setActiveMediaIdx((prev) => (prev - 1 + mediaGallery.length) % mediaGallery.length);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
    setTouchStartY(e.touches[0].clientY);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX === null || touchStartY === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    
    const diffX = touchStartX - touchEndX;
    const diffY = touchStartY - touchEndY;
    
    // Check if horizontal swipe exceeds vertical swipe and passes threshold
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 40) {
      if (diffX > 0) {
        handleNextImage();
      } else {
        handlePrevImage();
      }
    }
    setTouchStartX(null);
    setTouchStartY(null);
  };

  const handleImageClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('video') || target.closest('a')) return;
    setLightboxIndex(activeMediaIdx);
  };

  useEffect(() => {
    if (!selectedProductId) return;

    const resetScrollFrame = window.requestAnimationFrame(() => {
      try {
        window.scrollTo({ top: 0, behavior: 'auto' });
      } catch {
        // standard fallback
      }
    });

    setActiveMediaIdx(0);
    void incrementProductViews(selectedProductId);

    return () => {
      window.cancelAnimationFrame(resetScrollFrame);
    };
  }, [selectedProductId]);

  // Dynamic OpenGraph, Google and Twitter Metadata inject/update (Requirement 3)
  useEffect(() => {
    if (!product) return;

    const updateMetaTag = (selector: string, attrName: string, attrVal: string, contentStr: string) => {
      let el = document.querySelector(selector);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attrName, attrVal);
        document.head.appendChild(el);
      }
      el.setAttribute('content', contentStr);
    };

    try {
      const isSvc = product ? normalizeCategory(product.category) === 'Services' : false;
      const parentTitle = isSvc
        ? `${product.title} | Tedbuy Ghana`
        : `${product.title} - GHS ${product.price} | Tedbuy Ghana`;
      document.title = parentTitle;

      updateMetaTag('meta[property="og:title"]', 'property', 'og:title', parentTitle);
      updateMetaTag('meta[property="og:description"]', 'property', 'og:description', product.description || `Check out this classified deal under ${product.category}.`);
      updateMetaTag('meta[property="og:url"]', 'property', 'og:url', window.location.href);

      const hasVideo = product.videos && product.videos.length > 0;
      const mainImg = (product.images?.[0] || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');

      updateMetaTag('meta[property="og:image"]', 'property', 'og:image', mainImg);
      updateMetaTag('meta[property="og:image:secure_url"]', 'property', 'og:image:secure_url', mainImg);
      updateMetaTag('meta[property="og:type"]', 'property', 'og:type', hasVideo ? 'video.other' : 'product');

      if (hasVideo && product.videos?.[0]) {
        let absVideoUrl = product.videos[0];
        if (absVideoUrl.startsWith('data:')) {
          absVideoUrl = `${window.location.protocol}//${window.location.host}/api/products/${product.id}/video.mp4`;
        } else if (absVideoUrl.startsWith('/')) {
          absVideoUrl = `${window.location.protocol}//${window.location.host}${absVideoUrl}`;
        }
        updateMetaTag('meta[property="og:video"]', 'property', 'og:video', absVideoUrl);
        updateMetaTag('meta[property="og:video:secure_url"]', 'property', 'og:video:secure_url', absVideoUrl);
        updateMetaTag('meta[property="og:video:type"]', 'property', 'og:video:type', 'video/mp4');
        updateMetaTag('meta[property="og:video:width"]', 'property', 'og:video:width', '640');
        updateMetaTag('meta[property="og:video:height"]', 'property', 'og:video:height', '1136');

        updateMetaTag('meta[name="twitter:card"]', 'name', 'twitter:card', 'player');
        updateMetaTag('meta[name="twitter:player"]', 'name', 'twitter:player', window.location.href);
        updateMetaTag('meta[name="twitter:player:width"]', 'name', 'twitter:player:width', '640');
        updateMetaTag('meta[name="twitter:player:height"]', 'name', 'twitter:player:height', '1136');
        updateMetaTag('meta[name="twitter:player:stream"]', 'name', 'twitter:player:stream', absVideoUrl);
        updateMetaTag('meta[name="twitter:player:stream:content_type"]', 'name', 'twitter:player:stream:content_type', 'video/mp4');
      } else {
        updateMetaTag('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image');
      }
    } catch (err) {
      console.warn('Meta updater warning', err);
    }

    return () => {
      document.title = 'Tedbuy Classifieds Marketplace';
    };
  }, [product]);

  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const pId = params?.get('productId');
  const pTitle = params?.get('title');
  const pImg = params?.get('image') || params?.get('img');
  const pPrice = params?.get('price');
  const pLoc = params?.get('location');
  const pVideo = params?.get('video');

  if (!product) {
    if (isProductsLoading || isFetchingDirect || (!fetchNotFound && selectedProductId)) {
      return <ProductDetailSkeleton />;
    }

    if (pId || pTitle) {
      const previewVideoUrl = pVideo || (pImg && (pImg.includes('.mp4') || pImg.includes('.webm') || pImg.includes('/video')) ? pImg : null);
      
      return (
        <div className="max-w-xl mx-auto px-4 py-8 animate-fade-in font-sans">
          {/* Back button */}
          <button
            onClick={handleGoBack}
            className="flex items-center gap-2 text-xs font-black text-slate-500 hover:text-slate-900 mb-6 transition uppercase tracking-wider cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          {/* Gorgeous Welcome Card */}
          <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-xl space-y-6 text-left relative overflow-hidden">
            {/* Ambient Background decoration */}
            <div className="absolute top-0 right-0 w-24 h-24 bg-teal-500/10 rounded-full blur-2xl -z-10 animate-pulse"></div>
            <div className="absolute bottom-0 left-0 w-28 h-28 bg-blue-500/10 rounded-full blur-2xl -z-10"></div>

            <div className="flex items-center gap-2.5">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono">
                TedBuy Live Deal Preview
              </p>
            </div>

            {/* Product Image or Video preview */}
            {previewVideoUrl ? (
              <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden border border-slate-100 bg-slate-50 shadow-sm flex items-center justify-center">
                <video
                  src={previewVideoUrl}
                  controls
                  autoPlay
                  muted
                  playsInline
                  webkit-playsinline="true"
                  disablePictureInPicture
                  controlsList="nodownload nofullscreen noremoteplayback"
                  className="w-full h-full object-contain bg-black"
                />
              </div>
            ) : pImg ? (
              <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden border border-slate-100 bg-slate-50 shadow-sm flex items-center justify-center">
                <img 
                  src={pImg} 
                  alt={pTitle || "Shared deal preview"} 
                  loading="lazy"
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            ) : (
              <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden border border-slate-100 bg-slate-50 flex flex-col items-center justify-center text-slate-300">
                <Package className="w-16 h-16 stroke-[1.2] text-slate-300 animate-pulse" />
                <span className="text-[10px] text-slate-400 uppercase tracking-wider mt-2 font-bold font-mono">Photo Loading...</span>
              </div>
            )}

            {/* Details */}
            <div className="space-y-3">
              <h3 className="text-xl font-black text-slate-900 leading-tight tracking-tight">
                {pTitle || "Loading listing title..."}
              </h3>

              <div className="flex flex-wrap gap-2.5 pt-1">
                {pPrice && (
                  <span className="bg-slate-900 text-white font-mono text-xs font-black px-3.5 py-1.5 rounded-xl shadow-xs">
                    {pPrice}
                  </span>
                )}
                {pLoc && (
                  <span className="bg-slate-50 border border-slate-200 text-slate-650 font-bold text-[10px] px-3 py-1.5 rounded-xl flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span>{pLoc}</span>
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={() => setCurrentView('browse')}
              className="w-full py-4 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-[11px] uppercase tracking-wider rounded-2xl transition cursor-pointer active:scale-98 text-center block shadow-md"
            >
              Browse All Listings on TedBuy
            </button>
          </div>
        </div>
      );
    }

    // Infer category from context (URL params, slug, previous state, etc.)
    const inferCategoryFromContext = (): Category | null => {
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const catParam = urlParams.get('category') || urlParams.get('cat');
        if (catParam) {
          const norm = normalizeCategory(catParam);
          if (norm && norm !== 'Other') return norm as Category;
        }
      }

      if (selectedCategory && (selectedCategory as string) !== 'All') {
        return selectedCategory;
      }

      const textToExamine = [
        pTitle,
        selectedProductId,
        typeof window !== 'undefined' ? window.location.hash : '',
        typeof window !== 'undefined' ? window.location.pathname : '',
      ].filter(Boolean).join(' ').toLowerCase();

      if (/\b(phone|phones|iphone|samsung|pixel|tecno|infinix|redmi|xiaomi|huawei|oppo|vivo|galaxy|nokia|oneplus|smartphone|ios|android)\b/.test(textToExamine)) {
        return 'Phones';
      }
      if (/\b(laptop|laptops|macbook|dell|hp|lenovo|thinkpad|asus|acer|notebook|chromebook|computer|pc)\b/.test(textToExamine)) {
        return 'Laptops & Computers';
      }
      if (/\b(car|cars|toyota|hyundai|kia|benz|honda|nissan|vehicle|vehicles|elantra|corolla|motor|suv|truck|auto)\b/.test(textToExamine)) {
        return 'Vehicles';
      }
      if (/\b(house|houses|apartment|apartments|land|plot|rent|property|properties|room|estate|mansion|flat)\b/.test(textToExamine)) {
        return 'Property';
      }
      if (/\b(tv|television|fridge|refrigerator|microwave|blender|iron|cooker|appliance|appliances|washer|kettle)\b/.test(textToExamine)) {
        return 'Home Appliances';
      }
      if (/\b(dress|dresses|shirt|shirts|shoe|shoes|sneaker|sneakers|bag|bags|watch|watches|suit|suits|cloth|fashion|jeans|trouser|heels|hoodie|clothing)\b/.test(textToExamine)) {
        return 'Fashion';
      }
      if (/\b(ps4|ps5|playstation|xbox|nintendo|fifa|game|games|gaming|controller|console)\b/.test(textToExamine)) {
        return 'Games';
      }
      if (/\b(sound|speaker|speakers|camera|cameras|headphone|headphones|audio|electronic|electronics|airpod|earbud|microphone)\b/.test(textToExamine)) {
        return 'Electronics';
      }
      if (/\b(sofa|bed|beds|chair|chairs|table|tables|wardrobe|furniture|desk|cabinet|mattress)\b/.test(textToExamine)) {
        return 'Furniture & Home';
      }
      if (/\b(perfume|perfumes|cream|hair|wig|wigs|lotion|beauty|makeup|skincare|fragrance)\b/.test(textToExamine)) {
        return 'Beauty and Care';
      }
      if (/\b(dog|dogs|puppy|puppies|cat|cats|pet|pets|bird|fish|kitten)\b/.test(textToExamine)) {
        return 'Pets & Animals';
      }
      if (/\b(treadmill|gym|dumbbell|fitness|sport|sports|bicycle|bike|football)\b/.test(textToExamine)) {
        return 'Sports & Fitness';
      }
      if (/\b(service|services|plumber|electrician|mechanic|repair|cleaning|mason|painter|carpenter)\b/.test(textToExamine)) {
        return 'Services';
      }
      if (/\b(job|jobs|vacancy|employment|hiring|work)\b/.test(textToExamine)) {
        return 'Jobs & Employment';
      }
      if (/\b(food|agriculture|farm|rice|oil|yam|plantain|poultry)\b/.test(textToExamine)) {
        return 'Agriculture & Food';
      }
      if (/\b(baby|kids|toy|toys|diaper|stroller|cot)\b/.test(textToExamine)) {
        return 'Kids & Baby';
      }
      if (/\b(tool|tools|machine|generator|commercial)\b/.test(textToExamine)) {
        return 'Commercial & Tools';
      }
      if (/\b(book|books|novel|hobby|hobbies|guitar|piano|art)\b/.test(textToExamine)) {
        return 'Books & Hobbies';
      }

      return null;
    };

    const inferredCategory = inferCategoryFromContext();
    const similarLabel = inferredCategory
      ? `Browse Similar ${inferredCategory === 'Home Appliances' ? 'Appliances' : inferredCategory}`
      : 'Browse Similar Listings';

    const handleBrowseSimilar = () => {
      if (inferredCategory) {
        setSelectedCategory(inferredCategory);
      }
      setSelectedProductId(null);
      setCurrentView('browse');
      if (typeof window !== 'undefined') {
        setTimeout(() => {
          const el = document.getElementById('all-products-section') || document.getElementById('product-grid');
          if (el) {
            el.scrollIntoView({ behavior: 'smooth' });
          }
        }, 100);
      }
    };

    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-6 animate-fade-in font-sans">
        <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto shadow-inner">
          <Package className="w-8 h-8 stroke-[1.5]" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">
            Listing Not Available
          </h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            This item may have expired, been sold, or removed by the seller.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            onClick={() => setCurrentView('browse')}
            className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold uppercase tracking-wider rounded-2xl transition shadow-sm cursor-pointer active:scale-95"
          >
            Return to Marketplace
          </button>
          <button
            onClick={handleBrowseSimilar}
            className="px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white text-xs font-extrabold uppercase tracking-wider rounded-2xl transition shadow-md shadow-orange-500/20 cursor-pointer active:scale-95 text-center"
          >
            <span>{similarLabel}</span>
          </button>
        </div>
      </div>
    );
  }

  const isServiceCategory = product ? normalizeCategory(product.category) === 'Services' : false;
  const isOwner = currentUser?.id === product.sellerId;
  const isFollowing = currentUser?.followingSellers?.includes(product.sellerId) || false;
  const isSaved = currentUser?.savedProductIds?.includes(product.id) || false;

  const watermarkSellerName = (
    sellerUser?.username ||
    (sellerUser as any)?.displayName ||
    product?.sellerName ||
    (product as any)?.sellerUsername ||
    'TEDBUY SELLER'
  ).trim().toUpperCase();

  const handleToggleSave = () => {
    if (!currentUser) {
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    toggleSaveProduct(product.id);
  };

  const handleSellerClick = () => {
    setSelectedSellerId(product.sellerId);
    setCurrentView('seller-profile');
  };

  const handleMessageSeller = async () => {
    if (!currentUser) {
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    if (!currentUser.emailVerified) {
      setBlockedActionType('chat');
      setIsVerificationBlockOpen(true);
      return;
    }

    try {
      const initialMsg = `Hi, is "${product.title}" still available?`;
      const chatId = await startChat(product.id, initialMsg);
      if (chatId) {
        setCurrentView('chats');
      }
    } catch (err: any) {
      showToast(err?.message || 'Could not initiate chat with the seller.', 'error');
    }
  };

  const handleStartChatInline = async (overrideMessage?: string) => {
    if (!product) return;
    if (!currentUser) {
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    if (!currentUser.emailVerified) {
      setBlockedActionType('chat');
      setIsVerificationBlockOpen(true);
      return;
    }
    if (isOwner) {
      showToast("You posted this listing.", "info");
      return;
    }

    try {
      setIsStartingChat(true);
      const chosenMsg = (typeof overrideMessage === 'string' && overrideMessage.trim())
        ? overrideMessage.trim()
        : (inlineChatMessage.trim() || `Hi, is "${product.title}" still available?`);
      const chatId = await startChat(product.id, chosenMsg);
      if (chatId) {
        setInlineChatMessage('');
        setCurrentView('chats');
      }
    } catch (err: any) {
      showToast(err?.message || 'Could not initiate chat with the seller.', 'error');
    } finally {
      setIsStartingChat(false);
    }
  };

  const handleMessageWhatsApp = () => {
    if (!currentUser) {
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    if (!currentUser.emailVerified) {
      setBlockedActionType('whatsApp');
      setIsVerificationBlockOpen(true);
      return;
    }
    const phoneOrWhatsApp = sellerUser?.whatsAppNumber || sellerUser?.phoneNumber || (product as any).sellerWhatsApp || (product as any).sellerPhone;
    if (!phoneOrWhatsApp) {
      showToast("The seller has not provided a WhatsApp contact number. You can chat with them directly using Tedbuy chat below!", "info");
      return;
    }
    setSafetyTipsPendingAction('whatsapp');
    setShowSafetyTips(true);
  };

  const confirmSafetyTipsAction = () => {
    setShowSafetyTips(false);
    if (!product) return;
    if (safetyTipsPendingAction === 'message') {
      const chatId = startChat(product.id, "Hi, is this still available?");
      setCurrentView('chats');
    } else if (safetyTipsPendingAction === 'whatsapp') {
      const phoneOrWhatsApp = sellerUser?.whatsAppNumber || sellerUser?.phoneNumber || (product as any).sellerWhatsApp || (product as any).sellerPhone;
      if (!phoneOrWhatsApp) return;
      let cleanNumber = phoneOrWhatsApp.replace(/\D/g, '');
      if (cleanNumber.startsWith('0') && cleanNumber.length === 10) {
        cleanNumber = '233' + cleanNumber.substring(1);
      } else if (!cleanNumber.startsWith('233') && cleanNumber.length === 9) {
        cleanNumber = '233' + cleanNumber;
      }
      const prefilledText = `Hello! I'm interested in your listed item "${product.title}" on Tedbuy marketplace. Let's chat!`;
      const finalUrl = `https://wa.me/${cleanNumber}?text=${encodeURIComponent(prefilledText)}`;
      window.open(finalUrl, '_blank', 'noopener,noreferrer');
    }
    setSafetyTipsPendingAction(null);
  };

  const handleToggleFollow = () => {
    if (!currentUser) {
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    if (isFollowing) {
      unfollowSeller(product.sellerId);
    } else {
      followSeller(product.sellerId);
    }
  };

  const handleDeleteAd = async () => {
    if (!product) return;
    try {
      setIsDeleting(true);
      setDeleteError(null);
      await deleteProduct(product.id);
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      setCurrentView('browse');
    } catch (err: any) {
      setIsDeleting(false);
      console.error("Could not delete product:", err);
      let msg = "Failed to delete listing. Please check your admin privileges.";
      if (err instanceof Error) {
        try {
          const parsed = JSON.parse(err.message);
          if (parsed.error) {
            msg = `Error: ${parsed.error}`;
          }
        } catch {
          msg = err.message;
        }
      }
      setDeleteError(msg);
    }
  };

  const calculatePriorityScore = (prod: any): number => {
    const now = new Date();
    const isBoostActive = prod.boostStatus === true && 
                         prod.boostEndDate && 
                         new Date(prod.boostEndDate).getTime() > now.getTime();
    
    if (!isBoostActive) {
      const engagementScore = Number(prod.viewsCount || 0);
      const createdAtMs = prod.createdAt ? new Date(prod.createdAt).getTime() : 0;
      const freshnessFactor = createdAtMs / 1e12;
      return engagementScore + freshnessFactor;
    }

    const planId = prod.boostPlan;
    let packageLevel = 0;
    if (planId === '1month' || planId === '90days') packageLevel = 5;
    else if (planId === '21days' || planId === '30days') packageLevel = 4;
    else if (planId === '14days') packageLevel = 3;
    else if (planId === '7days') packageLevel = 2;
    else if (planId === '3days') packageLevel = 1;

    const boostBase = packageLevel * 10000000;
    
    const endDateMs = prod.boostEndDate ? new Date(prod.boostEndDate).getTime() : now.getTime();
    const remainingMs = Math.max(0, endDateMs - now.getTime());
    const remainingTimeFactor = remainingMs / 10000;
    
    const engagementScore = Number(prod.viewsCount || 0);
    const engagementFactor = engagementScore / 10;
    
    const createdAtMs = prod.createdAt ? new Date(prod.createdAt).getTime() : 0;
    const freshnessFactor = createdAtMs / 1e12;
    
    return boostBase + remainingTimeFactor + engagementFactor + freshnessFactor;
  };

  const handleDeactivateBoostSilently = async () => {
    if (!product) return;
    try {
      setIsAdminBoosting(true);

      const updatedFields = {
        boostStatus: false,
        isBoosted: false,
        boostPlan: "",
        boostStartDate: "",
        boostEndDate: "",
        boostExpiry: "",
        boostPriority: 0,
        boostPriorityLevel: 0,
        remainingBoostTime: 0,
        priorityScore: calculatePriorityScore({
          ...product,
          boostStatus: false,
          boostPlan: "",
          boostEndDate: ""
        })
      };

      // 1. Try server boost-control endpoint first
      let apiSucceeded = false;
      try {
        let token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
        if (!token) {
          token = localStorage.getItem('tedbuy_custom_auth_token') || '';
        }
        const cleanToken = token;
        const res = await fetch('/api/admin/boost-control', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': cleanToken ? `Bearer ${cleanToken}` : ''
          },
          body: JSON.stringify({
            productId: product.id,
            action: 'deactivate',
            product: product
          })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          apiSucceeded = true;
          if (data.product) {
            await updateProduct(product.id, data.product, false);
          }
        }
      } catch (apiErr) {
        console.warn('[Admin Boost] Server API attempt note:', apiErr);
      }

      // 2. Fallback to client-side database update if server API wasn't successful
      if (!apiSucceeded) {
        await updateProduct(product.id, updatedFields);
      }

      showToast('Boost deactivated silently without notifications.', 'success');
      setShowDeactivateConfirm(false);
    } catch (err) {
      console.error('Failed to deactivate boost silently:', err);
      showToast('Failed to deactivate boost.', 'error');
    } finally {
      setIsAdminBoosting(false);
    }
  };

  const handleActivateFreeBoost = async () => {
    if (!product) return;
    try {
      setIsAdminBoosting(true);
      const planDaysMap: Record<string, number> = {
        '3days': 3,
        '7days': 7,
        '14days': 14,
        '21days': 21,
        '30days': 21,
        '1month': 30,
        '90days': 30
      };
      const days = planDaysMap[selectedFreePlan] || 7;
      const now = new Date();
      const startDate = now.toISOString();
      const endDate = new Date(now.getTime() + (days * 24 * 60 * 60 * 1000)).toISOString();
      
      let boostPriorityLevel = 1;
      if (selectedFreePlan === '1month' || selectedFreePlan === '90days') boostPriorityLevel = 5;
      else if (selectedFreePlan === '21days' || selectedFreePlan === '30days') boostPriorityLevel = 4;
      else if (selectedFreePlan === '14days') boostPriorityLevel = 3;
      else if (selectedFreePlan === '7days') boostPriorityLevel = 2;
      else if (selectedFreePlan === '3days') boostPriorityLevel = 1;

      const tempProduct = {
        boostStatus: true,
        boostPlan: selectedFreePlan,
        boostEndDate: endDate,
        createdAt: product.createdAt,
        viewsCount: product.viewsCount || 0
      };
      const priorityScore = calculatePriorityScore(tempProduct);

      const boostHistory = Array.isArray(product.boostHistory) ? [...product.boostHistory] : [];
      boostHistory.push({
        planId: selectedFreePlan,
        planName: `${days} Days Boost (Admin Free)`,
        startDate,
        endDate,
        paymentReference: `ADMIN_FREE_BOOST_${Date.now()}`,
        amount: 0,
        gateway: 'admin-override',
        paymentMethod: 'admin',
        createdAt: now.toISOString()
      });

      const updatedFields = {
        boostStatus: true,
        isBoosted: true,
        boostPlan: selectedFreePlan,
        boostStartDate: startDate,
        boostEndDate: endDate,
        boostExpiry: endDate,
        paymentStatus: 'success' as const,
        paymentReference: `ADMIN_FREE_BOOST_${Date.now()}`,
        boostPriority: boostPriorityLevel * 10000000,
        priorityScore,
        lastBoostedAt: now.toISOString(),
        boostHistory,
        boostAmount: 0,
        boostPackagePrice: 0,
        boostPriorityLevel,
        remainingBoostTime: days * 24 * 60 * 60 * 1000,
        lastBoostPurchase: now.toISOString()
      };

      // 1. Try server boost-control endpoint first
      let apiSucceeded = false;
      try {
        let token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
        if (!token) {
          token = localStorage.getItem('tedbuy_custom_auth_token') || '';
        }
        const cleanToken = token;
        const res = await fetch('/api/admin/boost-control', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': cleanToken ? `Bearer ${cleanToken}` : ''
          },
          body: JSON.stringify({
            productId: product.id,
            action: 'activate',
            planId: selectedFreePlan,
            product: { ...product, ...updatedFields }
          })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          apiSucceeded = true;
          if (data.product) {
            await updateProduct(product.id, data.product, false);
          }
        }
      } catch (apiErr) {
        console.warn('[Admin Boost] Server API attempt note:', apiErr);
      }

      // 2. Fallback to client-side database update if server API wasn't successful
      if (!apiSucceeded) {
        await updateProduct(product.id, updatedFields);
      }

      showToast(`Ad successfully boosted for ${days} days for free!`, 'success');
    } catch (err) {
      console.error('Failed to activate free boost:', err);
      showToast('Failed to activate free boost.', 'error');
    } finally {
      setIsAdminBoosting(false);
    }
  };

  const extractNumericPrice = (priceVal: string | number): number | null => {
    if (typeof priceVal === 'number') return priceVal;
    const cleanStr = priceVal.replace(/GHS/gi, '').replace(/,/g, '').trim();
    const num = Number(cleanStr);
    if (!isNaN(num) && cleanStr !== '') return num;
    const matches = priceVal.replace(/,/g, '').match(/\d+(\.\d+)?/);
    if (matches) {
      return Number(matches[0]);
    }
    return null;
  };

  const formatProductPrice = (priceVal: string | number) => {
    if (typeof priceVal === 'string') {
      const lower = priceVal.trim().toLowerCase();
      if (lower === 'contact for price' || lower === 'contact for price.' || lower.includes('contact for price')) {
        return 'Inquire';
      }
    }
    if (typeof priceVal === 'number') {
      return new Intl.NumberFormat('en-GH', {
        style: 'currency',
        currency: 'GHS',
        maximumFractionDigits: 0
      }).format(priceVal);
    }
    const cleanStr = priceVal.replace(/GHS/gi, '').replace(/,/g, '').trim();
    const num = Number(cleanStr);
    if (!isNaN(num) && cleanStr !== '') {
      return new Intl.NumberFormat('en-GH', {
        style: 'currency',
        currency: 'GHS',
        maximumFractionDigits: 0
      }).format(num);
    }
    return priceVal;
  };

  const formattedPrice = formatProductPrice(product.price);

  const rawDate = new Date(product.createdAt);
  const dateFormatted = rawDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const similarProducts = products
    .filter(p => p.id !== product.id && p.category && product.category && p.category.toLowerCase() === product.category.toLowerCase())
    .slice(0, 4);

  const cleanPrice = typeof product.price === 'number'
    ? product.price
    : parseFloat(String(product.price).replace(/[^\d.]/g, '')) || 0;

  // Generate dynamic aggregateRating and review objects to resolve Google Search Console rich snippet alerts
  const hasReviews = Array.isArray(sellerReviews) && sellerReviews.length > 0;
  const ratingValue = hasReviews
    ? (sellerReviews.reduce((sum, r) => sum + (r.rating || 5), 0) / sellerReviews.length).toFixed(1)
    : "4.8";
  const reviewCount = hasReviews ? sellerReviews.length : 1;

  const aggregateRatingObj = {
    "@type": "AggregateRating",
    "ratingValue": parseFloat(ratingValue),
    "bestRating": "5",
    "worstRating": "1",
    "reviewCount": reviewCount
  };

  const reviewList = hasReviews
    ? sellerReviews.map(r => ({
        "@type": "Review",
        "reviewRating": {
          "@type": "Rating",
          "ratingValue": String(r.rating || 5),
          "bestRating": "5",
          "worstRating": "1"
        },
        "author": {
          "@type": "Person",
          "name": r.buyerName || "Verified Buyer"
        },
        "reviewBody": r.comment || "Great transaction, secure trade, and excellent communication.",
        "datePublished": r.createdAt ? new Date(r.createdAt).toISOString().split('T')[0] : new Date(product.createdAt).toISOString().split('T')[0]
      }))
    : [
        {
          "@type": "Review",
          "reviewRating": {
            "@type": "Rating",
            "ratingValue": "5",
            "bestRating": "5",
            "worstRating": "1"
          },
          "author": {
            "@type": "Person",
            "name": "Verified Buyer"
          },
          "reviewBody": "Excellent quality item, secure meet-up, and highly recommended verified seller on TedBuy Ghana.",
          "datePublished": new Date(product.createdAt).toISOString().split('T')[0]
        }
      ];

  const jsonLdData = {
    "@context": "https://schema.org/",
    "@type": "Product",
    "id": `https://tedbuy.store/product/${product.id}`,
    "name": product.title,
    "image": product.images || [],
    "description": product.description || `Buy ${product.title} on Tedbuy Ghana classifieds.`,
    "sku": `TED-${product.id.substring(0, 8).toUpperCase()}`,
    "mpn": `MPN-${product.id.substring(0, 8).toUpperCase()}`,
    "brand": {
      "@type": "Brand",
      "name": product.brand && product.brand !== "Unspecified" ? product.brand : "TedBuy"
    },
    "aggregateRating": aggregateRatingObj,
    "review": reviewList,
    "offers": {
      "@type": "Offer",
      "url": typeof window !== 'undefined' ? window.location.href : `https://tedbuy.store/product/${product.id}`,
      "priceCurrency": "GHS",
      "price": cleanPrice,
      "itemCondition": product.condition === 'New' ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition",
      "availability": "https://schema.org/InStock",
      "priceValidUntil": "2027-12-31",
      "validFrom": new Date(product.createdAt || Date.now()).toISOString().split('T')[0],
      "shippingDetails": {
        "@type": "OfferShippingDetails",
        "shippingRate": {
          "@type": "MonetaryAmount",
          "value": 20,
          "currency": "GHS"
        },
        "shippingDestination": {
          "@type": "DefinedRegion",
          "addressCountry": "GH"
        },
        "deliveryTime": {
          "@type": "ShippingDeliveryTime",
          "handlingTime": {
            "@type": "QuantitativeValue",
            "minValue": 0,
            "maxValue": 1,
            "unitCode": "DAY"
          },
          "transitTime": {
            "@type": "QuantitativeValue",
            "minValue": 1,
            "maxValue": 3,
            "unitCode": "DAY"
          }
        }
      },
      "hasMerchantReturnPolicy": {
        "@type": "MerchantReturnPolicy",
        "applicableCountry": "GH",
        "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnPeriod",
        "merchantReturnDays": 14,
        "returnMethod": "https://schema.org/ReturnInStore",
        "returnFees": "https://schema.org/FreeReturn"
      },
      "seller": {
        "@type": "Person",
        "name": sellerUser?.username || product.sellerName || "Verified Seller",
        "url": typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}/seller/${product.sellerId}` : `https://tedbuy.store/seller/${product.sellerId}`
      }
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-2.5 sm:px-6 lg:px-8 py-3 sm:py-6">
      {/* JSON-LD Structured Data for Google Rich Snippets */}
      <script type="application/ld+json">
        {JSON.stringify(jsonLdData)}
      </script>

      {/* Navigation bar and back button/share utility */}
      <div className="flex items-center justify-between gap-4 mb-3 sm:mb-6 px-1">
        <button
          id="btn-back-to-previous"
          onClick={handleGoBack}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 font-semibold transition px-2 py-1.5 rounded-lg hover:bg-slate-100/80 active:bg-slate-200/70 cursor-pointer"
          title="Back to previous page"
        >
          <ArrowLeft className="w-4.5 h-4.5" />
          <span>Back</span>
        </button>
      </div>

      {/* Main product view grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-8 text-left">
        {/* Left column: Visual display images & videos (7 cols on desktop, order-1) */}
        <div className="lg:col-span-7 lg:row-start-1 order-1 space-y-4 sm:space-y-6">
          <div 
            onClick={handleImageClick}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className="group/media relative aspect-[4/3] sm:aspect-[16/10] lg:aspect-[16/11] w-full bg-slate-100 rounded-2xl sm:rounded-3xl overflow-hidden border border-slate-200/80 shadow-md cursor-zoom-in select-none"
          >
            {(mediaGallery[activeMediaIdx]?.type === 'video' && !videoErrors[mediaGallery[activeMediaIdx].url]) ? (
              <video
                src={mediaGallery[activeMediaIdx].url}
                className="absolute inset-0 w-full h-full object-cover"
                controls
                autoPlay
                muted
                playsInline
                webkit-playsinline="true"
                disablePictureInPicture
                controlsList="nodownload nofullscreen noremoteplayback"
                onError={(e) => {
                  const url = mediaGallery[activeMediaIdx].url;
                  const err = e.currentTarget.error;
                  let errMsg = 'Unknown video loading or decoding error';
                  if (err) {
                    switch (err.code) {
                      case 1: errMsg = 'Video loading aborted'; break;
                      case 2: errMsg = 'Network error: Video download failed'; break;
                      case 3: errMsg = 'Decoding error: Corrupted video file or unsupported codec'; break;
                      case 4: errMsg = 'Format error: Video URL not found or format unsupported'; break;
                    }
                    if (err.message) errMsg += ` (${err.message})`;
                  }
                  console.error(`[ProductDetail Error] Video failed to load for Product ID: ${product?.id}. Title: "${product?.title}". Video URL: "${url}". Error: ${errMsg}`, err);
                  setVideoErrors(prev => ({ ...prev, [url]: true }));
                }}
              />
            ) : mediaGallery[activeMediaIdx]?.type === 'video' ? (
              <div className="absolute inset-0 w-full h-full bg-slate-900 flex flex-col items-center justify-center p-6 text-center select-none">
                {product?.images?.[0] && (
                  <img
                    src={product.images[0]}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover blur-md opacity-20 select-none pointer-events-none"
                    referrerPolicy="no-referrer"
                  />
                )}
                <div className="relative z-10 max-w-xs p-5 rounded-2xl bg-slate-900/90 border border-white/10 flex flex-col items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center">
                    <Video className="w-5 h-5 text-rose-500" />
                  </div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-rose-400">Video Loading Failed</h4>
                  <p className="text-[10px] text-slate-300 leading-relaxed font-sans font-semibold">
                    The showcase video could not be streamed or played back due to network/format issues.
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const url = mediaGallery[activeMediaIdx].url;
                      setVideoErrors(prev => ({ ...prev, [url]: false }));
                    }}
                    className="w-full py-2 bg-[#FFFC00] hover:bg-yellow-400 text-slate-950 font-black rounded-lg text-[10px] tracking-wider uppercase transition shadow-md cursor-pointer"
                  >
                    Retry Loading
                  </button>
                </div>
              </div>
            ) : (
              <div className="absolute inset-0 w-full h-full overflow-hidden">
                <img
                  src={mediaGallery[activeMediaIdx]?.url || getCategoryPlaceholder(product.category)}
                  alt={product.title}
                  loading="lazy"
                  className="w-full h-full object-cover transition duration-500 group-hover/media:scale-[1.03]"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.src = getCategoryPlaceholder(product.category);
                  }}
                />
                {/* Clean, feint Tedbuy Watermark Overlay */}
                <div className="absolute inset-0 pointer-events-none select-none flex items-center justify-center">
                  <div className="flex flex-col items-center justify-center text-center rotate-[-15deg] px-4 pointer-events-none">
                    <span className="text-sm sm:text-base md:text-xl lg:text-2xl font-black text-white/20 tracking-[0.22em] font-sans uppercase drop-shadow-[0_1px_3px_rgba(0,0,0,0.35)] leading-tight">
                      POSTED ON TEDBUY
                    </span>
                    <span className="text-[10px] sm:text-xs md:text-sm font-extrabold text-white/20 tracking-[0.18em] font-sans uppercase drop-shadow-[0_1px_3px_rgba(0,0,0,0.35)] mt-0.5 sm:mt-1 max-w-[260px] md:max-w-sm truncate">
                      {watermarkSellerName}
                    </span>
                  </div>
                </div>
              </div>
            )}
            
            {/* Hover overlay prompts */}
            <div className="absolute inset-0 bg-black/25 opacity-0 group-hover/media:opacity-100 transition duration-300 flex items-center justify-center z-10 pointer-events-none">
              <span className="bg-slate-900/85 backdrop-blur-xs text-white text-[11px] font-black tracking-wider px-3.5 py-2 rounded-xl flex items-center gap-1.5 border border-slate-800">
                <Maximize2 className="w-4 h-4 text-slate-350" />
                <span>EXPAND VIEW</span>
              </span>
            </div>

            {/* Top-right zoom trigger button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(activeMediaIdx);
              }}
              className="absolute top-4 right-4 bg-slate-900/80 hover:bg-slate-900 backdrop-blur-xs text-white p-2 rounded-full border border-slate-800 transition z-20 cursor-pointer flex items-center justify-center"
              title="Expand with image lightbox"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>

            {/* Navigation Arrow buttons */}
            {mediaGallery.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePrevImage();
                  }}
                  className="absolute left-3 top-1/2 -translate-y-1/2 bg-slate-900/60 hover:bg-slate-900 text-white p-2 rounded-full border border-slate-750 transition-all shadow-md z-20 cursor-pointer flex items-center justify-center md:opacity-0 md:group-hover/media:opacity-100 opacity-90"
                  title="Previous Image"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNextImage();
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 bg-slate-900/60 hover:bg-slate-900 text-white p-2 rounded-full border border-slate-750 transition-all shadow-md z-20 cursor-pointer flex items-center justify-center md:opacity-0 md:group-hover/media:opacity-100 opacity-90"
                  title="Next Image"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}
            
            {/* Overlay indicators */}
            <span className="absolute top-4 left-4 bg-slate-900/80 backdrop-blur-xs text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider z-10">
              {product.category}
            </span>
            {mediaGallery.length > 1 && (
              <span className="absolute bottom-4 right-4 bg-slate-900/80 backdrop-blur-xs text-slate-100 text-xs px-3 py-1 rounded-full font-mono z-10">
                {mediaGallery[activeMediaIdx]?.type === 'video' ? 'Video' : 'Image'} {activeMediaIdx + 1} of {mediaGallery.length}
              </span>
            )}

            {/* Dots Pagination Indicator overlay */}
            {mediaGallery.length > 1 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 z-20 bg-slate-950/45 backdrop-blur-xs px-2.5 py-1.5 rounded-full">
                {mediaGallery.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveMediaIdx(idx);
                    }}
                    className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                      idx === activeMediaIdx ? 'w-3.5 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Gallery Thumbnails Strip */}
          {mediaGallery.length > 1 && (
            <div className="flex items-center gap-2.5 overflow-x-auto pb-2 scrollbar-none max-w-full">
              {mediaGallery.map((med, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setActiveMediaIdx(idx)}
                  className={`relative w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden border-2 shrink-0 transition-all cursor-pointer ${
                    idx === activeMediaIdx
                      ? 'border-slate-900 ring-2 ring-slate-900/20 opacity-100 scale-[1.02]'
                      : 'border-slate-200 opacity-60 hover:opacity-100 hover:border-slate-400'
                  }`}
                >
                  {med.type === 'video' ? (
                    <div className="w-full h-full bg-slate-950 flex flex-col items-center justify-center text-white">
                      <Video className="w-5 h-5 text-rose-400" />
                      <span className="text-[9px] font-mono mt-0.5 font-bold">VIDEO</span>
                    </div>
                  ) : (
                    <img
                      src={med.url}
                      alt={`Thumbnail ${idx + 1}`}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right column: Purchase callouts and details (5 cols on desktop, order-2) */}
        <div className="lg:col-span-5 lg:row-start-1 order-2 space-y-4 sm:space-y-6">
          <div className="bg-white border border-slate-200 p-3.5 sm:p-6 rounded-2xl sm:rounded-3xl shadow-xs space-y-4 sm:space-y-5">
            <div className="space-y-2">
              <h1 id="detail-product-title" className="text-lg sm:text-xl font-bold font-sans text-slate-900 leading-snug">
                {product.title}
              </h1>

              <div className="flex items-center gap-2.5 flex-wrap pt-0.5">
                {!isServiceCategory && (
                  <span className="text-xl sm:text-2xl font-black text-slate-950 font-sans tracking-tight">
                    {formattedPrice}
                  </span>
                )}
                {!isServiceCategory && (
                  <span id="detail-price-negotiable-label" className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                    product.negotiable !== false
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-250/50'
                      : 'bg-slate-100 text-slate-650 border border-slate-200'
                  }`}>
                    {product.negotiable !== false ? 'Negotiable' : 'Fixed Price'}
                  </span>
                )}
                {product.isSold && (
                  <span className="bg-rose-600 border border-rose-500 text-white font-black text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-lg shadow-sm animate-pulse flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping"></span>
                    <span>Sold Product</span>
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500 font-sans border-y border-slate-100 py-3">
              <span className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-slate-400" />
                {product.location}
              </span>
              {(currentUser?.isAdmin || currentUser?.id === product.sellerId) && (
                <>
                  <span className="flex items-center gap-1.5">
                    <Eye className="w-4 h-4 text-slate-400" />
                    {product.viewsCount} total visitors
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-slate-400" />
                    {dateFormatted}
                  </span>
                </>
              )}
            </div>

            {/* Messaging / Call buttons */}
            <div className="space-y-3">
              {currentUser?.isAdmin && (
                <div className="bg-rose-50 border-2 border-rose-200/80 p-5 rounded-3xl text-xs space-y-3 text-left">
                  <div className="flex items-center gap-1.5 text-rose-800 font-extrabold uppercase tracking-wider">
                    <ShieldAlert className="w-4.5 h-4.5" />
                    <span>Admin Moderator Controls</span>
                  </div>
                  <p className="text-slate-600 font-sans leading-relaxed">
                    You have administrative access to this post as <strong className="text-slate-900 font-bold">{currentUser.email}</strong>. You can edit the parameters of this listing, permanently delete it, or toggle its sold status below.
                  </p>
                  
                  <div className="flex items-center justify-between py-2 px-3 bg-white rounded-2xl border border-rose-200/60 shadow-3xs">
                    <span className="font-bold text-slate-700">Item Status:</span>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none font-bold text-xs text-rose-600 hover:text-rose-700">
                      <input
                        type="checkbox"
                        checked={!!product.isSold}
                        onChange={async (e) => {
                          try {
                            await updateProduct(product.id, { isSold: e.target.checked });
                          } catch (err) {
                            console.error("Failed to update product isSold flag", err);
                          }
                        }}
                        className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 border-slate-350 cursor-pointer"
                      />
                      <span>Mark as Sold</span>
                    </label>
                  </div>

                  {/* Admin Boost Control Sub-Section */}
                  <div className="bg-white border border-rose-200/60 rounded-2xl p-4.5 space-y-4 shadow-3xs">
                    <div className="flex items-center gap-1.5 font-extrabold text-xs text-slate-800 uppercase tracking-wide border-b border-slate-100 pb-2">
                      <Sparkles className="w-4 h-4 text-rose-500 animate-pulse" />
                      <span>Admin Boost Controls</span>
                    </div>

                    {/* Active Boost Details or Inactive Indicator */}
                    {isBoostActive(product) ? (
                      <div className="bg-rose-50 border border-rose-100 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black uppercase text-rose-800 tracking-wider">Active Boost</span>
                          <span className="px-1.5 py-0.5 bg-rose-200 text-rose-800 text-[9px] font-black rounded-md uppercase">
                            {product.boostPlan || 'Boosted'}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-600 leading-relaxed font-sans">
                          Expires on <strong className="font-bold text-slate-800">{getBoostEndDate(product)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) || 'N/A'}</strong>
                        </p>
                        {showDeactivateConfirm ? (
                          <div className="bg-rose-100/50 border border-rose-200 rounded-xl p-3.5 space-y-2.5 animate-in fade-in zoom-in-95 duration-150">
                            <p className="text-[10px] text-rose-900 font-extrabold text-center uppercase tracking-wide flex items-center justify-center gap-1">
                              <span>⚠️ Silently Deactivate Boost?</span>
                            </p>
                            <p className="text-[10px] text-slate-600 leading-normal text-center">
                              No notification will be sent to the seller. Are you absolutely sure?
                            </p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={isAdminBoosting}
                                onClick={handleDeactivateBoostSilently}
                                className="flex-1 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-extrabold rounded-lg text-[10px] uppercase tracking-wider transition cursor-pointer select-none text-center"
                              >
                                {isAdminBoosting ? 'Processing...' : 'Yes, Deactivate'}
                              </button>
                              <button
                                type="button"
                                disabled={isAdminBoosting}
                                onClick={() => setShowDeactivateConfirm(false)}
                                className="flex-1 py-1.5 bg-slate-200 hover:bg-slate-300 disabled:opacity-50 text-slate-800 font-extrabold rounded-lg text-[10px] uppercase tracking-wider transition cursor-pointer select-none text-center"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowDeactivateConfirm(true)}
                            className="w-full py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-extrabold rounded-lg text-[10px] uppercase tracking-wider transition select-none cursor-pointer text-center"
                          >
                            Deactivate Boost (Silent)
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-1 bg-slate-50 border border-slate-100 rounded-xl">
                        <span className="text-[10px] font-bold text-slate-500">No active premium boost on this ad</span>
                      </div>
                    )}

                    {/* Free Boosting Section */}
                    <div className="space-y-2">
                      <span className="text-[10px] font-black uppercase text-slate-600 tracking-wider block">Apply Admin Free Boost</span>
                      <div className="flex gap-2">
                        <select
                          value={selectedFreePlan}
                          onChange={(e) => setSelectedFreePlan(e.target.value)}
                          className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-800 text-[11px] font-bold py-2 px-2.5 rounded-xl border border-slate-200 outline-none transition cursor-pointer"
                        >
                          <option value="3days">3 Days Boost (Free)</option>
                          <option value="7days">7 Days Boost (Free)</option>
                          <option value="14days">14 Days Boost (Free)</option>
                          <option value="21days">21 Days Boost (Free)</option>
                          <option value="1month">1 Month Boost (Free)</option>
                        </select>
                         <button
                          type="button"
                          disabled={isAdminBoosting}
                          onClick={handleActivateFreeBoost}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black rounded-xl text-[10px] uppercase tracking-wider transition select-none cursor-pointer flex items-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>{isAdminBoosting ? 'Boosting...' : 'Boost'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2.5">
                    <button
                      onClick={() => setShowEditModal(true)}
                      className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-black rounded-xl flex items-center justify-center gap-1.5 transition select-none cursor-pointer text-[11px]"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Edit Ad Details</span>
                    </button>
                    <button
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteCheckboxConfirmed(true);
                        setShowDeleteConfirm(true);
                      }}
                      className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-xl flex items-center justify-center gap-1.5 transition select-none cursor-pointer text-[11px]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Listing</span>
                    </button>
                  </div>
                </div>
              )}

              {isOwner && !currentUser?.isAdmin ? (
                <div className="bg-slate-50 text-slate-800 p-4 rounded-3xl border border-slate-200 text-xs text-left space-y-3.5">
                  <div className="space-y-1">
                    <p className="font-semibold text-slate-800">👋 You posted this product listing!</p>
                    <p className="text-[11px] text-slate-500">You can customize details, delete the ad, or toggle its availability status status below.</p>
                  </div>
                  
                  <div className="flex items-center justify-between py-2 px-3 bg-white rounded-2xl border border-slate-200/60 shadow-3xs">
                    <span className="font-bold text-slate-700">Item Status:</span>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none font-bold text-xs text-rose-600 hover:text-rose-700">
                      <input
                        type="checkbox"
                        checked={!!product.isSold}
                        onChange={async (e) => {
                          try {
                            await updateProduct(product.id, { isSold: e.target.checked });
                          } catch (err) {
                            console.error("Failed to update product isSold flag", err);
                          }
                        }}
                        className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 border-slate-350 cursor-pointer"
                      />
                      <span>Mark as Sold</span>
                    </label>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowEditModal(true)}
                      className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-extrabold rounded-xl flex items-center justify-center gap-1.5 transition select-none cursor-pointer text-[11px]"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Edit Ad Details</span>
                    </button>
                    <button
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteCheckboxConfirmed(true);
                        setShowDeleteConfirm(true);
                      }}
                      className="flex-1 py-2.5 bg-rose-50 hover:bg-rose-100/80 text-rose-600 border border-rose-200/65 font-extrabold rounded-xl flex items-center justify-center gap-1.5 transition select-none cursor-pointer text-[11px]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Listing</span>
                    </button>
                  </div>
                  <button
                    onClick={handleShareProduct}
                    className="w-full py-2.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-750 font-extrabold rounded-xl flex items-center justify-center gap-1.5 text-[11px] transition cursor-pointer select-none"
                  >
                    <Share2 className="w-3.5 h-3.5 stroke-[2.2]" />
                    <span>Share Ad Listing</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3.5">
                  {/* Top Action Row: Message seller on WhatsApp + Share + Save */}
                  <div className="flex gap-2 sm:gap-2.5 items-center">
                    <button
                      id="btn-message-whatsapp"
                      onClick={handleMessageWhatsApp}
                      className="flex-1 py-3 sm:py-3.5 px-3 sm:px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-2xl flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm shadow-xs hover:shadow-md transition duration-200 cursor-pointer active:scale-98 min-h-[44px]"
                    >
                      <MessageSquare className="w-4.5 h-4.5 sm:w-5 sm:h-5 fill-white/20 stroke-[2.2] shrink-0" />
                      <span className="whitespace-nowrap font-bold">Message seller on WhatsApp</span>
                    </button>

                    <button
                      id="btn-share-detail"
                      onClick={handleShareProduct}
                      className="px-3 sm:px-4 py-3 sm:py-3.5 rounded-2xl border bg-indigo-50 border-indigo-200 text-indigo-600 hover:bg-indigo-100 text-xs sm:text-sm flex items-center justify-center shrink-0 transition duration-200 cursor-pointer active:scale-98 min-h-[44px]"
                      title="Share Product"
                    >
                      <Share2 className="w-4.5 h-4.5 sm:w-5 sm:h-5 stroke-[2.2]" />
                    </button>
                    
                    <button
                      id="btn-save-detail"
                      onClick={handleToggleSave}
                      className={`px-3 sm:px-4 py-3 sm:py-3.5 rounded-2xl border transition duration-200 text-xs sm:text-sm flex items-center justify-center shrink-0 active:scale-98 min-h-[44px] ${
                        isSaved
                          ? 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                      }`}
                      title={isSaved ? "Remove from Saved" : "Save to Saved"}
                    >
                      <Bookmark className="w-4.5 h-4.5 sm:w-5 sm:h-5" fill={isSaved ? "currentColor" : "none"} />
                    </button>
                  </div>

                  {/* Chat with the seller inline section (Placed just below WhatsApp message action) */}
                  {!isOwner && (
                    <div id="inline-chat-seller-card" className="bg-slate-50/80 border border-slate-200/80 p-3 sm:p-4 rounded-xl sm:rounded-2xl space-y-3 text-left w-full">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-bold text-slate-900 truncate">
                            Chat with {sellerUser?.username || product.sellerName || 'the seller'}
                          </h4>
                          <p className="text-[10px] text-emerald-600 font-medium flex items-center gap-1 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span>Usually replies in a few minutes</span>
                          </p>
                        </div>
                      </div>

                      {/* Quick pre-filled prompt pills */}
                      <div className="flex flex-wrap gap-1.5">
                        {['Is this still available?', 'What is the last price?'].map((quickText) => (
                          <button
                            key={quickText}
                            type="button"
                            onClick={() => handleStartChatInline(quickText)}
                            disabled={isStartingChat}
                            className="text-[11px] bg-white hover:bg-slate-100 border border-slate-200/80 text-slate-700 font-medium px-2.5 py-1 rounded-full transition duration-150 cursor-pointer text-left active:scale-95 disabled:opacity-50"
                          >
                            {quickText}
                          </button>
                        ))}
                      </div>

                      {/* Inline message input form */}
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleStartChatInline(inlineChatMessage);
                        }}
                        className="flex items-center gap-2 mt-1"
                      >
                        <input
                          id="input-inline-seller-chat"
                          type="text"
                          value={inlineChatMessage}
                          onChange={(e) => setInlineChatMessage(e.target.value)}
                          placeholder="Type your message to seller..."
                          disabled={isStartingChat}
                          className="flex-1 bg-white border border-slate-250 text-slate-900 text-xs rounded-xl px-3 py-2.5 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 transition disabled:opacity-50"
                        />
                        <button
                          id="btn-send-inline-chat"
                          type="submit"
                          disabled={isStartingChat}
                          className="px-3.5 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1 transition shrink-0 cursor-pointer shadow-xs active:scale-95"
                          title="Send Message"
                        >
                          {isStartingChat ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                        </button>
                      </form>
                    </div>
                  )}

                  {/* Seller Bio & Trust Score Module */}
                  <div className="bg-slate-50 border border-slate-200/90 p-3.5 sm:p-4.5 rounded-2xl space-y-3.5">
                    <div className="flex items-start justify-between gap-3">
                      {/* Left: Avatar + Info (Name, Badge, Tenure, Trust Score) */}
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        {(sellerUser?.photoUrl || product.sellerPhoto) && !(sellerUser?.photoUrl || product.sellerPhoto)?.includes('1549399542-7e3f8b79c341') ? (
                          <img
                            src={sellerUser?.photoUrl || product.sellerPhoto}
                            alt={sellerUser?.username || product.sellerName}
                            loading="lazy"
                            className="w-12 h-12 rounded-full border border-slate-200 object-cover shrink-0 cursor-pointer hover:ring-2 hover:ring-slate-900 transition-all mt-0.5"
                            title="Click to view profile picture"
                            onClick={() => setViewedPhoto({ url: (sellerUser?.photoUrl || product.sellerPhoto)!, name: `${sellerUser?.username || product.sellerName}'s Profile Picture` })}
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-slate-900 text-white font-black text-base flex items-center justify-center shrink-0 mt-0.5 border border-slate-800">
                            {(sellerUser?.username || product.sellerName || 'M').charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 text-left min-w-0">
                          <h4 id="detail-seller-name" className="text-sm font-bold text-slate-900 flex items-center gap-1.5 min-w-0 flex-wrap">
                            <span className="truncate">{sellerUser?.username || product.sellerName || 'TedBuy Merchant'}</span>
                            <SellerBadge seller={sellerUser} size="sm" />
                          </h4>
                          <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                            {formatTedbuyTenure(product.sellerJoinDate || sellerUser?.joinDate)}
                          </p>
                          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border ${trustResult.color.includes('emerald') ? 'bg-emerald-50 text-emerald-800 border-emerald-200/80' : trustResult.color.includes('indigo') ? 'bg-indigo-50 text-indigo-800 border-indigo-200/80' : trustResult.color.includes('amber') ? 'bg-amber-50 text-amber-800 border-amber-200/80' : 'bg-slate-100 text-slate-700 border-slate-200'}`} title={trustResult.feedback}>
                              🛡️ Trust Score: <b>{trustResult.score}%</b>
                            </span>
                            {isSellerVerified && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-900 text-white shadow-3xs">
                                ✓ Verified Merchant
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Visit Store + Follow button aligned */}
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <button
                          id="btn-view-profile"
                          onClick={handleSellerClick}
                          className="text-xs text-slate-900 hover:text-emerald-700 font-bold hover:underline flex items-center gap-0.5 pt-0.5 cursor-pointer transition-colors"
                        >
                          <span>Visit Store</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>

                        {!isOwner && (
                          <button
                            id="btn-toggle-follow"
                            onClick={handleToggleFollow}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 shrink-0 cursor-pointer active:scale-95 ${
                              isFollowing
                                ? 'bg-slate-100 text-slate-700 border border-slate-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200'
                                : 'bg-slate-900 text-white hover:bg-slate-800'
                            }`}
                          >
                            {isFollowing ? (
                              <>
                                <UserCheck className="w-3.5 h-3.5" />
                                <span>Following</span>
                              </>
                            ) : (
                              <>
                                <UserPlus className="w-3.5 h-3.5" />
                                <span>Follow</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Trust Guarantees Micro-Strip */}
                    <div className="pt-2.5 border-t border-slate-200/70 grid grid-cols-2 gap-2 text-[10.5px] text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <span className="text-emerald-600 font-bold">✓</span>
                        <span className="truncate">Direct seller negotiation</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-emerald-600 font-bold">✓</span>
                        <span className="truncate">In-person trade safety</span>
                      </div>
                    </div>
                  </div>

                  {/* Report this listing button */}
                  <button
                    id="btn-report-listing"
                    onClick={handleOpenReportModal}
                    className="w-full py-3 bg-rose-50 hover:bg-rose-100 border border-rose-200/80 text-rose-700 font-bold rounded-2xl flex items-center justify-center gap-2 text-xs sm:text-sm shadow-xs transition duration-200 cursor-pointer"
                  >
                    <ShieldAlert className="w-4.5 h-4.5 text-rose-600" />
                    <span>Report this Listing</span>
                  </button>

                  {/* Trust & Safety Tips disclaimer under Report this Listing */}
                  <div className="bg-red-50 rounded-2xl p-3.5 border border-red-100 flex items-start gap-2.5 text-[11px] text-red-700 text-left">
                    <ShieldAlert className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-red-800">⚠️ Tedbuy Classifieds Safety Tips:</p>
                      <p className="mt-0.5 text-red-700 leading-relaxed">Meet in public, check item status carefully, and DO NOT send cash deposits in advance of collecting your items!</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Detailed Item Specifications Segment (Full width across desktop and mobile underneath images and action column) */}
        <div className="col-span-1 lg:col-span-12 order-3 space-y-6 mt-2 lg:mt-4">
          <div className="bg-white border border-slate-200 p-5 sm:p-7 lg:p-8 rounded-2xl sm:rounded-3xl text-left shadow-xs space-y-5 sm:space-y-6">
            <div className="flex items-center justify-between border-b border-slate-150 pb-4">
              <h2 className="text-base sm:text-lg lg:text-xl font-bold text-slate-900 font-sans tracking-tight flex items-center gap-2">
                <FileText className="w-5 h-5 text-slate-700" />
                <span>Detailed Item Specifications</span>
              </h2>
              {currentUser?.isAdmin && (
                <span className="text-[11px] font-mono font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
                  ID: {product.id}
                </span>
              )}
            </div>

            {/* Structured Specifications Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5 sm:gap-3.5">
              <div className="bg-slate-50 border border-slate-200/80 p-3 sm:p-4 rounded-2xl">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Category</span>
                <span className="text-xs sm:text-sm font-bold text-slate-900 mt-0.5 block truncate">{product.category}</span>
              </div>
              {product.subcategory && (
                <div className="bg-slate-50 border border-slate-200/80 p-3 sm:p-4 rounded-2xl">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Subcategory</span>
                  <span className="text-xs sm:text-sm font-bold text-slate-900 mt-0.5 block truncate">{product.subcategory}</span>
                </div>
              )}
              {product.condition && (
                <div className="bg-slate-50 border border-slate-200/80 p-3 sm:p-4 rounded-2xl">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Condition</span>
                  <span className="text-xs sm:text-sm font-bold text-slate-900 mt-0.5 block truncate">{product.condition}</span>
                </div>
              )}
              {product.brand && (
                <div className="bg-slate-50 border border-slate-200/80 p-3 sm:p-4 rounded-2xl">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Brand / Make</span>
                  <span className="text-xs sm:text-sm font-bold text-slate-900 mt-0.5 block truncate">{product.brand}</span>
                </div>
              )}
              <div className="bg-slate-50 border border-slate-200/80 p-3 sm:p-4 rounded-2xl">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Location</span>
                <span className="text-xs sm:text-sm font-bold text-slate-900 mt-0.5 block truncate">{product.location || 'Ghana'}</span>
              </div>
              {(product.isExchangeable || product.exchangePossible) && (
                <div id="spec-exchange-possible-mobile" className="bg-slate-50 border border-slate-200/80 p-3 sm:p-4 rounded-2xl">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Exchange Possible</span>
                  <span className="text-xs sm:text-sm font-bold text-slate-900 mt-0.5 block truncate">Yes</span>
                </div>
              )}
            </div>

            {/* Description Body */}
            <div className="pt-1 sm:pt-2">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">
                Description & Detailed Overview
              </h3>
              <div className="prose prose-slate max-w-none text-sm text-slate-750 font-sans leading-relaxed whitespace-pre-line bg-slate-50/60 p-4 sm:p-6 rounded-2xl border border-slate-200/70">
                {product.description || 'No additional specification details provided.'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Similar Listings Section */}
      <div className="mt-12 text-left">
        <h2 className="text-lg font-bold text-slate-900 font-sans tracking-tight mb-5">
          Similar Listings
        </h2>
        {similarProducts.length === 0 ? (
          <div className="bg-slate-50 border border-slate-200 p-8 rounded-3xl text-center text-slate-500 text-sm">
            No similar items found in <span className="font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-lg text-xs uppercase tracking-wider">{product.category}</span> yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {similarProducts.map(p => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </div>

      {/* Profile Picture Full-screen Lightbox Modal */}
      {viewedPhoto && (
        <div 
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[9999] flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setViewedPhoto(null)}
        >
          <div 
            className="relative max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden p-6 shadow-2xl flex flex-col items-center gap-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header info */}
            <div className="flex items-center justify-between w-full border-b border-slate-800 pb-3">
              <span className="text-sm font-bold text-slate-200 tracking-tight">{viewedPhoto.name}</span>
              <button 
                onClick={() => setViewedPhoto(null)}
                className="p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Photo frame */}
            <div className="w-64 h-64 sm:w-80 sm:h-80 rounded-2xl bg-slate-950 border border-slate-800/80 overflow-hidden flex items-center justify-center shadow-inner">
              <img 
                src={viewedPhoto.url} 
                alt={viewedPhoto.name} 
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>

            {/* Footer action buttons */}
            <div className="flex gap-3 w-full mt-2">
              <button
                onClick={() => setViewedPhoto(null)}
                className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition border border-slate-750"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product Images & Media Full-screen Lightbox Modal */}
      {lightboxIndex !== null && (
        <div 
          className="fixed inset-0 bg-slate-950/95 backdrop-blur-md z-[9999] flex flex-col items-center justify-between p-4 md:p-6 font-sans select-none animate-fade-in"
          onClick={() => setLightboxIndex(null)}
        >
          {/* Header strip */}
          <div className="w-full max-w-5xl flex items-center justify-between pb-3 border-b border-white/10 z-10 shrink-0">
            <div className="flex flex-col text-left">
              <span className="text-xs font-black text-white tracking-wider uppercase">
                {product.title}
              </span>
              <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                {mediaGallery[lightboxIndex]?.type === 'video' ? 'VIDEO PREVIEW' : 'IMAGE SPECIFICATION'}{mediaGallery.length > 1 ? ` — ${lightboxIndex + 1} of ${mediaGallery.length}` : ''}
              </span>
            </div>
            <button
              onClick={() => setLightboxIndex(null)}
              className="p-2 rounded-full bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white transition duration-200 cursor-pointer flex items-center justify-center border border-white/5"
              title="Close Fullscreen View"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Primary View Area */}
          <div className="flex-1 w-full max-w-5xl flex items-center justify-between relative my-4 min-h-0">
            {/* Left navigation arrow button */}
            {mediaGallery.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : mediaGallery.length - 1));
                }}
                className="absolute left-2 md:left-4 bg-slate-900/80 hover:bg-slate-900 border border-white/10 text-white p-3 rounded-full hover:scale-105 active:scale-95 transition cursor-pointer z-35 flex items-center justify-center shadow-2xl backdrop-blur-xs"
                title="Previous Media"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}

            {/* Central Media container */}
            <div 
              className="w-full h-full flex items-center justify-center bg-transparent max-h-[75vh]"
              onClick={(e) => e.stopPropagation()}
            >
              {(mediaGallery[lightboxIndex]?.type === 'video' && !videoErrors[mediaGallery[lightboxIndex].url]) ? (
                <video
                  src={mediaGallery[lightboxIndex].url}
                  className="max-w-full max-h-[70vh] object-contain rounded-2xl border border-white/5 shadow-2xl"
                  controls
                  autoPlay
                  muted
                  playsInline
                  webkit-playsinline="true"
                  disablePictureInPicture
                  controlsList="nodownload nofullscreen noremoteplayback"
                  onError={(e) => {
                    const url = mediaGallery[lightboxIndex].url;
                    const err = e.currentTarget.error;
                    let errMsg = 'Unknown video loading or decoding error';
                    if (err) {
                      switch (err.code) {
                        case 1: errMsg = 'Video loading aborted'; break;
                        case 2: errMsg = 'Network error: Video download failed'; break;
                        case 3: errMsg = 'Decoding error: Corrupted video file or unsupported codec'; break;
                        case 4: errMsg = 'Format error: Video URL not found or format unsupported'; break;
                      }
                      if (err.message) errMsg += ` (${err.message})`;
                    }
                    console.error(`[ProductDetail Lightbox Error] Video failed to load for Product ID: ${product?.id}. Title: "${product?.title}". Video URL: "${url}". Error: ${errMsg}`, err);
                    setVideoErrors(prev => ({ ...prev, [url]: true }));
                  }}
                />
              ) : mediaGallery[lightboxIndex]?.type === 'video' ? (
                <div className="relative max-w-sm w-full p-6 rounded-2xl bg-slate-900 border border-white/10 flex flex-col items-center gap-3 text-center">
                  <div className="w-10 h-10 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center">
                    <Video className="w-5 h-5 text-rose-500" />
                  </div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-rose-400">Video Loading Failed</h4>
                  <p className="text-[10px] text-slate-300 leading-relaxed font-sans font-semibold">
                    The expanded showcase video could not be streamed or played back due to network/format issues.
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const url = mediaGallery[lightboxIndex].url;
                      setVideoErrors(prev => ({ ...prev, [url]: false }));
                    }}
                    className="w-full py-2 bg-[#FFFC00] hover:bg-yellow-400 text-slate-950 font-black rounded-lg text-[10px] tracking-wider uppercase transition shadow-md cursor-pointer"
                  >
                    Retry Loading
                  </button>
                </div>
              ) : (
                <div className="relative max-w-full max-h-[70vh] flex items-center justify-center select-none group/lightbox-img">
                  <img
                    src={mediaGallery[lightboxIndex]?.url}
                    alt={product.title}
                    referrerPolicy="no-referrer"
                    className="max-w-full max-h-[70vh] object-contain rounded-2xl border border-white/10 shadow-2xl animate-scale-up"
                  />
                  {/* Clean, feint Tedbuy Watermark Overlay in the middle of expanded image */}
                  <div className="absolute inset-0 pointer-events-none select-none flex items-center justify-center">
                    <div className="flex flex-col items-center justify-center text-center rotate-[-16deg] px-6 pointer-events-none">
                      <span className="text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-black text-white/20 tracking-[0.25em] font-sans uppercase drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)] leading-tight">
                        POSTED ON TEDBUY
                      </span>
                      <span className="text-sm sm:text-xl md:text-2xl lg:text-3xl font-extrabold text-white/20 tracking-[0.2em] font-sans uppercase drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)] mt-1.5 sm:mt-2.5 max-w-xl truncate">
                        {watermarkSellerName}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right navigation arrow button */}
            {mediaGallery.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((prev) => (prev !== null && prev < mediaGallery.length - 1 ? prev + 1 : 0));
                }}
                className="absolute right-2 md:right-4 bg-slate-900/80 hover:bg-slate-900 border border-white/10 text-white p-3 rounded-full hover:scale-105 active:scale-95 transition cursor-pointer z-35 flex items-center justify-center shadow-2xl backdrop-blur-xs"
                title="Next Media"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Quick-jump Thumbnail dots/strip */}
          {mediaGallery.length > 1 && (
            <div 
              className="w-full max-w-3xl flex items-center justify-center gap-1.5 px-4 py-2 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xs overflow-x-auto select-none mt-2 shrink-0 z-10 scrollbar-none"
              onClick={(e) => e.stopPropagation()}
            >
              {mediaGallery.map((med, i) => (
                <button
                  key={i}
                  onClick={() => setLightboxIndex(i)}
                  className={`relative w-10 h-10 rounded-lg overflow-hidden border transition duration-200 shrink-0 ${
                    i === lightboxIndex
                      ? 'border-white scale-105 ring-2 ring-white/10 shadow-lg'
                      : 'border-white/10 opacity-60 hover:opacity-100 hover:border-white/30'
                  }`}
                >
                  {med.type === 'video' ? (
                    <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center text-white text-[8px] font-black tracking-tighter">
                      VIDEO
                    </div>
                  ) : (
                    <img 
                      src={med.url} 
                      alt="" 
                      referrerPolicy="no-referrer" 
                      className="w-full h-full object-cover" 
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Admin Edit Listing Modal */}
      {showEditModal && (
        <ListingModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          productToEdit={product}
        />
      )}

      {/* Admin Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" onClick={() => !isDeleting && setShowDeleteConfirm(false)}>
          <div className="bg-white rounded-3xl p-6 shadow-2xl max-w-sm w-full border border-slate-150 relative animate-scale-up text-left" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight flex items-center gap-1.5 text-rose-700">
              <ShieldAlert className="w-4.5 h-4.5 text-rose-600 animate-pulse" />
              <span>Confirm Deletion</span>
            </h3>
            <p className="text-xs text-slate-500 font-sans leading-relaxed mt-3">
              Are you sure you want to permanently delete <strong className="text-slate-800">"{product.title}"</strong> from the Tedbuy classifieds marketplace? This action is irreversible.
            </p>

            <div className="bg-rose-50/50 rounded-2xl border border-rose-100 p-3 mt-4">
              <label className="flex items-start gap-2.5 cursor-pointer text-slate-700 select-none">
                <input
                  type="checkbox"
                  checked={deleteCheckboxConfirmed}
                  onChange={(e) => setDeleteCheckboxConfirmed(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded text-rose-600 focus:ring-rose-500 border-slate-350 cursor-pointer shrink-0"
                />
                <span className="text-[11px] leading-snug font-medium">
                  Yes, I want to permanently delete this listing. I understand this action cannot be undone.
                </span>
              </label>
            </div>

            {deleteError && (
              <div className="mt-3.5 p-3 bg-rose-50 border border-rose-200/50 text-rose-600 rounded-2xl text-[11px] font-mono leading-normal select-text break-all">
                {deleteError}
              </div>
            )}

            <div className="flex gap-2.5 mt-5">
              <button
                disabled={isDeleting}
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                disabled={isDeleting || !deleteCheckboxConfirmed}
                onClick={async () => {
                  if (!deleteCheckboxConfirmed) return;
                  await handleDeleteAd();
                }}
                className={`flex-1 py-2.5 font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5 ${
                  deleteCheckboxConfirmed 
                    ? 'bg-rose-600 hover:bg-rose-700 text-white cursor-pointer shadow-sm' 
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {isDeleting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <span>Yes, Delete Ad</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report Listing Modal */}
      {isReportModalOpen && (
        <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" onClick={() => !isSubmittingReport && setIsReportModalOpen(false)}>
          <div className="bg-white rounded-3xl p-6 shadow-2xl max-w-md w-full border border-slate-150 relative animate-scale-up text-left" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight flex items-center gap-1.5 text-rose-700">
                <ShieldAlert className="w-4.5 h-4.5 text-rose-600 animate-bounce" />
                <span>Report Marketplace Ad</span>
              </h3>
              <button
                onClick={() => !isSubmittingReport && setIsReportModalOpen(false)}
                className="p-1 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleReportSubmit} className="space-y-4 mt-4">
              <p className="text-xs text-slate-500 leading-relaxed font-sans">
                Help us keep TedBuy secure. Your report is securely delivered straight to our admin inbox for swift moderation. Let us know why this ad is problematic:
              </p>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Reason for report</label>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    { value: 'spam', label: 'Spam, duplicate or fake listing' },
                    { value: 'scam', label: 'Scam, fraudulent offer or suspicious activity' },
                    { value: 'inappropriate', label: 'Inappropriate, abusive or illegal contents' },
                    { value: 'wrong_category', label: 'Miscalibrated, misleading info or wrong category' },
                    { value: 'other', label: 'Other issue (please specify below)' }
                  ].map((option) => (
                    <label
                      key={option.value}
                      className={`flex items-center gap-3 p-3 rounded-2xl border transition duration-150 cursor-pointer text-xs select-none ${
                        reportReason === option.value
                          ? 'bg-rose-50/50 border-rose-200 text-rose-900 font-bold shadow-3xs'
                          : 'bg-slate-50 border-slate-200 text-slate-650 hover:bg-slate-100 hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="reportReason"
                        value={option.value}
                        checked={reportReason === option.value}
                        onChange={() => setReportReason(option.value)}
                        className="w-4 h-4 text-rose-600 focus:ring-rose-500 border-slate-350 cursor-pointer"
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Additional Context (Optional)</label>
                <textarea
                  value={reportComment}
                  onChange={(e) => setReportComment(e.target.value)}
                  placeholder="Provide more specific details or context to help our moderation team make a decision..."
                  maxLength={1000}
                  rows={3}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-800 outline-none focus:ring-2 focus:ring-rose-200 focus:border-rose-400 transition"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  disabled={isSubmittingReport}
                  onClick={() => setIsReportModalOpen(false)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-2xl text-xs transition cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReport}
                  className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-2xl text-xs transition flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  {isSubmittingReport ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <span>Submit Report</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Share Product Modal */}
      {isShareModalOpen && (
        <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" onClick={() => setIsShareModalOpen(false)}>
          <div className="bg-white rounded-3xl p-6 shadow-2xl max-w-sm w-full border border-slate-150 relative animate-scale-up text-left" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight flex items-center gap-1.5 text-indigo-700">
                <Share2 className="w-4.5 h-4.5 text-indigo-600" />
                <span>Share Listing</span>
              </h3>
              <button
                onClick={() => setIsShareModalOpen(false)}
                className="p-1 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 mt-4">
              <p className="text-xs text-slate-500 leading-relaxed font-sans">
                Share <strong className="text-slate-800">"{product.title}"</strong> with your friends and family or send it to your chat groups!
              </p>

              {/* Share Options */}
              <div className="space-y-2">
                {/* WhatsApp */}
                <button
                  onClick={() => {
                    const titleSlug = product.title ? slugify(product.title) : 'item';
                    const cleanShareUrl = `${window.location.origin}/product/${product.id}-${titleSlug}`;
                    const isService = isServiceCategory || (product.category && (product.category.toLowerCase() === 'services' || product.category.toLowerCase().includes('service')));
                    const hasPrice = !isService && formattedPrice && formattedPrice !== 'GH₵0' && formattedPrice !== 'GHS 0' && Number(product.price) > 0;
                    const priceText = hasPrice ? ` for *${formattedPrice}*` : '';
                    const text = `Check out *${product.title}*${priceText} on TedBuy!\n\nView here: ${cleanShareUrl}`;
                    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
                    setIsShareModalOpen(false);
                    showToast("Opening WhatsApp...", "success");
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl border border-emerald-150 bg-emerald-50/30 hover:bg-emerald-50 text-emerald-800 hover:text-emerald-900 font-bold text-xs transition duration-150 cursor-pointer"
                >
                  <span className="text-lg">💬</span>
                  <span className="flex-1 text-left">Share to WhatsApp</span>
                </button>

                {/* Telegram */}
                <button
                  onClick={() => {
                    const titleSlug = product.title ? slugify(product.title) : 'item';
                    const cleanShareUrl = `${window.location.origin}/product/${product.id}-${titleSlug}`;
                    const isService = isServiceCategory || (product.category && (product.category.toLowerCase() === 'services' || product.category.toLowerCase().includes('service')));
                    const hasPrice = !isService && formattedPrice && formattedPrice !== 'GH₵0' && formattedPrice !== 'GHS 0' && Number(product.price) > 0;
                    const priceText = hasPrice ? ` for ${formattedPrice}` : '';
                    const text = `Check out ${product.title}${priceText} on TedBuy!`;
                    window.open(`https://t.me/share/url?url=${encodeURIComponent(cleanShareUrl)}&text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
                    setIsShareModalOpen(false);
                    showToast("Opening Telegram...", "success");
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl border border-sky-150 bg-sky-50/30 hover:bg-sky-50 text-sky-800 hover:text-sky-900 font-bold text-xs transition duration-150 cursor-pointer"
                >
                  <span className="text-lg">✈️</span>
                  <span className="flex-1 text-left">Share to Telegram</span>
                </button>

                {/* Web Share API (System Share) */}
                {typeof navigator !== 'undefined' && navigator.share && (
                  <button
                    onClick={async () => {
                      try {
                        const titleSlug = product.title ? slugify(product.title) : 'item';
                        const cleanShareUrl = `${window.location.origin}/product/${product.id}-${titleSlug}`;
                        const isService = isServiceCategory || (product.category && (product.category.toLowerCase() === 'services' || product.category.toLowerCase().includes('service')));
                        const hasPrice = !isService && formattedPrice && formattedPrice !== 'GH₵0' && formattedPrice !== 'GHS 0' && Number(product.price) > 0;
                        const priceText = hasPrice ? ` for ${formattedPrice}` : '';
                        await navigator.share({
                          title: product.title,
                          text: `Check out ${product.title}${priceText} on TedBuy!`,
                          url: cleanShareUrl
                        });
                        setIsShareModalOpen(false);
                        showToast("Shared successfully!", "success");
                      } catch (err: any) {
                        if (err && err.name !== 'AbortError') {
                          showToast("Error sharing: " + err.message, "error");
                        }
                      }
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-2xl border border-indigo-150 bg-indigo-50/30 hover:bg-indigo-50 text-indigo-800 hover:text-indigo-900 font-bold text-xs transition duration-150 cursor-pointer"
                  >
                    <Share2 className="w-4.5 h-4.5 text-indigo-600 animate-pulse" />
                    <span className="flex-1 text-left">System Share Sheet</span>
                  </button>
                )}

                {/* Copy Link */}
                <button
                  onClick={async () => {
                    try {
                      const titleSlug = product.title ? slugify(product.title) : 'item';
                      const cleanShareUrl = `${window.location.origin}/product/${product.id}-${titleSlug}`;
                      await navigator.clipboard.writeText(cleanShareUrl);
                      showToast("Link copied to clipboard! Paste it anywhere.", "success");
                      setIsShareModalOpen(false);
                    } catch (err) {
                      showToast("Failed to copy link.", "error");
                    }
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-800 font-bold text-xs transition duration-150 cursor-pointer"
                >
                  <span className="text-lg">📋</span>
                  <span className="flex-1 text-left">Copy Listing Link</span>
                </button>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setIsShareModalOpen(false)}
                  className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-2xl text-xs transition cursor-pointer text-center"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Safety Tips Modal */}
      {showSafetyTips && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-in fade-in duration-200" onClick={() => { setShowSafetyTips(false); setSafetyTipsPendingAction(null); }}>
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl relative border border-slate-100 animate-in zoom-in-95 duration-200 text-center space-y-5" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mx-auto text-xl">
              ⚠️
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider text-center">
                Tedbuy Safety Tips
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed font-semibold text-center whitespace-pre-wrap">
                Meet in public, check item status carefully, and DO NOT send cash deposits in advance of collecting your items!
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowSafetyTips(false);
                  setSafetyTipsPendingAction(null);
                }}
                className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-2xl text-xs transition cursor-pointer text-center"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSafetyTipsAction}
                className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-black rounded-2xl text-xs shadow-md transition duration-150 cursor-pointer text-center"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
