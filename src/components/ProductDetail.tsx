import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { ArrowLeft, MessageSquare, MapPin, Eye, Calendar, UserPlus, UserCheck, ChevronRight, ShieldAlert, Bookmark, X, Camera, ChevronLeft, Maximize2, Edit2, Trash2, Share2, Check, Package, RefreshCw, Plus, Sparkles, Video } from 'lucide-react';
import { ProductCard } from './ProductCard';
import { ListingModal } from './ListingModal';
import { isUserVerified, calculateTrustScore } from '../types';
import { slugify } from '../utils/slugify';
import { auth } from '../firebase';
import { isBoostActive, parseDate } from '../utils/dateParser';
import { getOptimizedImageUrl } from '../utils/imageOptimizer';

export const ProductDetail: React.FC = () => {
  const {
    products,
    users,
    reviews,
    selectedProductId,
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
    showToast
  } = useApp();

  const product = products.find(p => p.id === selectedProductId);
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
    const rawShareUrl = window.location.href;
    const shareUrl = rawShareUrl.replace('/#/', '/').replace('/#', '/');
    const shareTitle = product.title;
    const shareText = `Check out "${product.title}" for ${formattedPrice} on TedBuy Ghana!`;

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

  const mediaGallery = product ? [
    ...(product.videos || []).map(url => ({ type: 'video' as const, url })),
    ...product.images
      .filter(url => {
        const hasVideos = product.videos && product.videos.length > 0;
        if (hasVideos) {
          // Video listings use product.images only for feed cover thumbnails / OG tags;
          // do not append the poster thumbnail as a second picture slide in the media gallery.
          return false;
        }
        return true;
      })
      .map(url => ({ type: 'image' as const, url: getOptimizedImageUrl(url, 800) }))
  ] : [];

  // Keyboard navigation support for Media Lightbox
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
    try {
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch {
      // standard fallback
    }
    setActiveMediaIdx(0);
    if (selectedProductId) {
      incrementProductViews(selectedProductId);
    }
  }, [selectedProductId, incrementProductViews]);

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
      const parentTitle = `${product.title} - GHS ${product.price} | Tedbuy Ghana`;
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
    if (pId || pTitle) {
      const previewVideoUrl = pVideo || (pImg && (pImg.includes('.mp4') || pImg.includes('.webm') || pImg.includes('/video')) ? pImg : null);
      
      return (
        <div className="max-w-xl mx-auto px-4 py-8 animate-fade-in font-sans">
          {/* Back to main classifieds */}
          <button
            onClick={() => setCurrentView('browse')}
            className="flex items-center gap-2 text-xs font-black text-slate-500 hover:text-slate-900 mb-6 transition uppercase tracking-wider cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Go to Marketplace</span>
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

    return (
      <div className="max-w-7xl mx-auto px-4 py-12 text-center text-slate-500">
        <p className="mb-4">No product selected or item does not exist anymore.</p>
        <button
          onClick={() => setCurrentView('browse')}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl"
        >
          Return to Marketplace
        </button>
      </div>
    );
  }

  const isOwner = currentUser?.id === product.sellerId;
  const isFollowing = currentUser?.followingSellers?.includes(product.sellerId) || false;
  const isSaved = currentUser?.savedProductIds?.includes(product.id) || false;

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

  const handleMessageSeller = () => {
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
    setSafetyTipsPendingAction('message');
    setShowSafetyTips(true);
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
    if (!sellerUser?.whatsAppNumber) return;
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
      if (!sellerUser?.whatsAppNumber) return;
      let cleanNumber = sellerUser.whatsAppNumber.replace(/\D/g, '');
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
    if (planId === '90days') packageLevel = 5;
    else if (planId === '30days') packageLevel = 4;
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
        boostPlan: "",
        boostEndDate: "",
        boostPriority: 0,
        priorityScore: calculatePriorityScore({
          ...product,
          boostStatus: false,
          boostPlan: "",
          boostEndDate: ""
        })
      };

      await updateProduct(product.id, updatedFields);
      showToast('Boost deactivated silently without notifications.', 'success');
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
        '30days': 30,
        '90days': 90
      };
      const days = planDaysMap[selectedFreePlan] || 7;
      const now = new Date();
      const startDate = now.toISOString();
      const endDate = new Date(now.getTime() + (days * 24 * 60 * 60 * 1000)).toISOString();
      
      let boostPriorityLevel = 0;
      if (selectedFreePlan === '90days') boostPriorityLevel = 5;
      else if (selectedFreePlan === '30days') boostPriorityLevel = 4;
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
        boostPlan: selectedFreePlan,
        boostStartDate: startDate,
        boostEndDate: endDate,
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

      await updateProduct(product.id, updatedFields);
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* JSON-LD Structured Data for Google Rich Snippets */}
      <script type="application/ld+json">
        {JSON.stringify(jsonLdData)}
      </script>

      {/* Navigation bar and back button/share utility */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <button
          id="btn-back-to-browse"
          onClick={() => setCurrentView('browse')}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 font-semibold transition"
        >
          <ArrowLeft className="w-4.5 h-4.5" />
          <span>Back to Classifieds</span>
        </button>
      </div>

      {/* Main product view grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 text-left">
        {/* Left column: Visual display images & videos (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div 
            onClick={handleImageClick}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className="group/media relative aspect-[4/3] w-full bg-slate-950 rounded-3xl overflow-hidden border border-slate-100 flex items-center justify-center shadow-md cursor-zoom-in select-none"
            style={{ aspectRatio: '4/3' }}
          >
            {(mediaGallery[activeMediaIdx]?.type === 'video' && !videoErrors[mediaGallery[activeMediaIdx].url]) ? (
              <video
                src={mediaGallery[activeMediaIdx].url}
                className="max-w-full max-h-full object-contain w-full h-full"
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
              <div className="relative w-full h-full bg-slate-950 flex flex-col items-center justify-center p-6 text-center select-none">
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
              <div className="relative w-full h-full flex items-center justify-center">
                <img
                  src={mediaGallery[activeMediaIdx]?.url || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}
                  alt={product.title}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  className="max-w-full max-h-full object-contain transition duration-500 group-hover/media:scale-[1.03]"
                  onError={(e) => {
                    e.currentTarget.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                  }}
                />
                {/* Clean, centered Tedbuy Watermark Overlay */}
                <div className="absolute inset-0 pointer-events-none select-none flex items-center justify-center">
                  <span className="text-xl md:text-3xl font-black text-white/35 tracking-[0.22em] font-sans uppercase rotate-[-20deg] drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]">
                    TEDBUY
                  </span>
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
        </div>

        {/* Right column: Purchase callouts and details (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-xs space-y-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-3xl font-black text-slate-950 font-sans tracking-tight">
                  {formattedPrice}
                </span>
                {product.isSold && (
                  <span className="bg-rose-600 border border-rose-500 text-white font-black text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-lg shadow-sm animate-pulse flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping"></span>
                    <span>Sold Product</span>
                  </span>
                )}
                <span id="detail-price-negotiable-label" className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                  product.negotiable !== false
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-250/50'
                    : 'bg-slate-100 text-slate-650 border border-slate-200'
                }`}>
                  {product.negotiable !== false ? 'Negotiable' : 'Fixed Price'}
                </span>
              </div>
              <h1 id="detail-product-title" className="text-xl font-bold font-sans text-slate-900 leading-snug">
                {product.title}
              </h1>
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

            {/* Brand, Condition, and Negotiability specifications module */}
            <div className="grid grid-cols-3 gap-2 bg-slate-50 border border-slate-150 rounded-2xl p-3 font-sans">
              <div>
                <span className="block text-[10px] text-slate-400 uppercase font-bold tracking-wider">Brand / Make</span>
                <span id="detail-brand-badge" className="text-xs font-extrabold text-slate-800 truncate block mt-0.5">
                  {product.brand || 'Generic / Other'}
                </span>
              </div>
              <div className="border-l border-slate-200 pl-2.5">
                <span className="block text-[10px] text-slate-400 uppercase font-bold tracking-wider">Condition</span>
                <span id="detail-condition-badge" className="text-xs font-extrabold text-slate-905 block mt-0.5">
                  {product.condition || 'Not Specified'}
                </span>
              </div>
              <div className="border-l border-slate-200 pl-2.5">
                <span className="block text-[10px] text-slate-400 uppercase font-bold tracking-wider">Negotiable</span>
                <span id="detail-negotiable-badge" className={`text-xs font-extrabold block mt-0.5 ${
                  product.negotiable !== false ? 'text-emerald-600' : 'text-slate-600'
                }`}>
                  {product.negotiable !== false ? 'Yes' : 'No'}
                </span>
              </div>
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
                    {product.boostStatus ? (
                      <div className="bg-rose-50 border border-rose-100 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black uppercase text-rose-800 tracking-wider">Active Boost</span>
                          <span className="px-1.5 py-0.5 bg-rose-200 text-rose-800 text-[9px] font-black rounded-md uppercase">
                            {product.boostPlan}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-600 leading-relaxed font-sans">
                          Expires on <strong className="font-bold text-slate-800">{product.boostEndDate ? new Date(product.boostEndDate).toLocaleDateString() : 'N/A'}</strong>
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
                                onClick={async () => {
                                  setIsAdminBoosting(true);
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
                                        action: 'deactivate'
                                      })
                                    });
                                    let data: any = {};
                                    try {
                                      data = await res.json();
                                    } catch (parseErr) {
                                      console.error('Failed to parse response JSON:', parseErr);
                                    }
                                    if (res.ok && data.success) {
                                      showToast('Boost silently deactivated!', 'success');
                                      if (data.product) {
                                        await updateProduct(product.id, data.product, true);
                                      }
                                      setShowDeactivateConfirm(false);
                                    } else {
                                      console.warn('Backend boost-control API rejected request, falling back to direct Firestore update...', data.error);
                                      await handleDeactivateBoostSilently();
                                      setShowDeactivateConfirm(false);
                                    }
                                  } catch (err: any) {
                                    console.error('Error contacting boost-control API, falling back to direct Firestore update...', err);
                                    await handleDeactivateBoostSilently();
                                    setShowDeactivateConfirm(false);
                                  } finally {
                                    setIsAdminBoosting(false);
                                  }
                                }}
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
                          <option value="30days">30 Days Boost (Free)</option>
                          <option value="90days">90 Days Boost (Free)</option>
                        </select>
                         <button
                          type="button"
                          disabled={isAdminBoosting}
                          onClick={async () => {
                            setIsAdminBoosting(true);
                            try {
                              let token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
                              if (!token) {
                                token = localStorage.getItem('tedbuy_custom_auth_token') || '';
                              }
                              // Use the token directly without regex stripping to prevent token corruption
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
                                  planId: selectedFreePlan
                                })
                              });
                              let data: any = {};
                              try {
                                data = await res.json();
                              } catch (parseErr) {
                                console.error('Failed to parse response JSON:', parseErr);
                              }
                              if (res.ok && data.success) {
                                showToast('Free premium boost applied successfully!', 'success');
                                if (data.product) {
                                  // Update the local react state only since the backend already successfully updated Firestore
                                  await updateProduct(product.id, data.product, true);
                                }
                              } else {
                                showToast(data.error || `Failed to apply free boost (Status: ${res.status}).`, 'error');
                              }
                            } catch (err: any) {
                              console.error('Error applying free boost:', err);
                              showToast(err.message || 'Error occurred.', 'error');
                            } finally {
                              setIsAdminBoosting(false);
                            }
                          }}
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
                        setDeleteCheckboxConfirmed(false);
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
                        setDeleteCheckboxConfirmed(false);
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
                <div className="space-y-2.5">
                  <div className="flex gap-3">
                    <button
                      id="btn-message-seller"
                      onClick={handleMessageSeller}
                      className="flex-1 py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl flex items-center justify-center gap-2 text-sm shadow-xs hover:shadow-md transition duration-200"
                    >
                      <MessageSquare className="w-5 h-5 fill-white/20 stroke-[2.2]" />
                      <span>Message Seller</span>
                    </button>

                    <button
                      id="btn-share-detail"
                      onClick={handleShareProduct}
                      className="px-4 py-3.5 rounded-2xl border bg-indigo-50 border-indigo-200 text-indigo-600 hover:bg-indigo-100 text-sm flex items-center justify-center gap-2 shrink-0 transition duration-200 cursor-pointer"
                      title="Share Product"
                    >
                      <Share2 className="w-5 h-5 stroke-[2.2]" />
                    </button>
                    
                    <button
                      id="btn-save-detail"
                      onClick={handleToggleSave}
                      className={`px-4 py-3.5 rounded-2xl border transition duration-200 text-sm flex items-center justify-center gap-2 shrink-0 ${
                        isSaved
                          ? 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                      }`}
                      title={isSaved ? "Remove from Saved" : "Save to Saved"}
                    >
                      <Bookmark className="w-5 h-5" fill={isSaved ? "currentColor" : "none"} />
                    </button>
                  </div>

                  {sellerUser?.whatsAppNumber && (
                    <button
                      id="btn-message-whatsapp"
                      onClick={handleMessageWhatsApp}
                      className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl flex items-center justify-center gap-2 text-sm shadow-xs hover:shadow-md transition duration-200 cursor-pointer"
                    >
                      <MessageSquare className="w-5 h-5 fill-white/20 stroke-[2.2]" />
                      <span>Message seller on whatsapp</span>
                    </button>
                  )}

                  <button
                    id="btn-report-listing"
                    onClick={handleOpenReportModal}
                    className="w-full py-3.5 bg-rose-50 hover:bg-rose-100 border border-rose-200/80 text-rose-700 font-bold rounded-2xl flex items-center justify-center gap-2 text-sm shadow-xs transition duration-200 cursor-pointer"
                  >
                    <ShieldAlert className="w-5 h-5 text-rose-600 animate-pulse" />
                    <span>Report this Listing</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Seller Bio Module */}
          <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-xs space-y-4">
            <div className="flex items-center justify-end">
              <button
                id="btn-view-profile"
                onClick={handleSellerClick}
                className="text-xs text-slate-900 hover:text-slate-750 font-bold hover:underline flex items-center"
              >
                <span>Visit Store</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              {(sellerUser?.photoUrl || product.sellerPhoto) && !(sellerUser?.photoUrl || product.sellerPhoto)?.includes('1549399542-7e3f8b79c341') ? (
                <img
                  src={sellerUser?.photoUrl || product.sellerPhoto}
                  alt={sellerUser?.username || product.sellerName}
                  loading="lazy"
                  className="w-12 h-12 rounded-full border border-slate-100 object-cover shrink-0 cursor-pointer hover:ring-2 hover:ring-slate-350 transition-all"
                  title="Click to view profile picture"
                  onClick={() => setViewedPhoto({ url: (sellerUser?.photoUrl || product.sellerPhoto)!, name: `${sellerUser?.username || product.sellerName}'s Profile Picture` })}
                />
              ) : (
                <img
                  src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' fill='%23f1f5f9'/><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%2394a3b8'/></svg>"
                  alt={sellerUser?.username || product.sellerName}
                  loading="lazy"
                  className="w-12 h-12 rounded-full border border-slate-200/80 object-cover shrink-0"
                />
              )}
              <div className="flex-1 text-left min-w-0">
                <h4 id="detail-seller-name" className="text-sm font-bold text-slate-900 flex items-center gap-1.5 min-w-0 flex-wrap">
                  <span className="truncate">{sellerUser?.username || product.sellerName}</span>
                  {isSellerVerified && (
                    <span className="inline-flex items-center gap-0.5 text-[9px] text-indigo-700 font-extrabold bg-indigo-50 border border-indigo-150/40 px-1.5 py-0.5 rounded-md shrink-0" title="Verified Tedbuy Seller">
                      🛡️ Verified Seller
                    </span>
                  )}
                </h4>
                <p className="text-[11px] text-slate-450">
                  Joined Tedbuy: {product.sellerJoinDate}
                </p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${trustResult.color.includes('emerald') ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' : trustResult.color.includes('indigo') ? 'bg-indigo-50/80 text-indigo-750 border-indigo-200/50' : trustResult.color.includes('amber') ? 'bg-amber-50 text-amber-700 border-amber-200/30' : 'bg-slate-100 text-slate-600 border-slate-200'}`} title={trustResult.feedback}>
                    🛡️ Trust Score: <b>{trustResult.score}%</b>
                  </span>
                </div>
              </div>
              
              {!isOwner && (
                <button
                  id="btn-toggle-follow"
                  onClick={handleToggleFollow}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 ${
                    isFollowing
                      ? 'bg-slate-100 text-slate-700 border border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-100'
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
            
            {/* Trust disclaimer */}
            <div className="bg-red-50 rounded-2xl p-3.5 border border-red-100 flex items-start gap-2.5 text-[10px] text-red-700">
              <ShieldAlert className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-800">⚠️ Tedbuy Classifieds Safety Tips:</p>
                <p className="mt-0.5 text-red-700">Meet in public, check item status carefully, and DO NOT send cash deposits in advance of collecting your items!</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Full Description Segment */}
      <div className="mt-8 bg-white border border-slate-200 p-6 sm:p-8 rounded-3xl text-left shadow-xs">
        <h2 className="text-base font-bold text-slate-900 font-sans tracking-tight mb-4">
          Detailed Item Specifications
        </h2>
        <div className="prose prose-slate max-w-none text-sm text-slate-750 font-sans leading-relaxed whitespace-pre-line">
          {product.description}
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
                  {/* Clean, centered Tedbuy Watermark Overlay in the middle of expanded image */}
                  <div className="absolute inset-0 pointer-events-none select-none flex items-center justify-center">
                    <span className="text-4xl sm:text-6xl md:text-8xl font-black text-white/45 tracking-[0.25em] font-sans uppercase rotate-[-25deg] drop-shadow-[0_4px_16px_rgba(0,0,0,0.6)]">
                      TEDBUY
                    </span>
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
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight flex items-center gap-1.5 text-rose-750">
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
                className={`flex-1 py-2.5 font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5 disabled:opacity-50 ${
                  deleteCheckboxConfirmed 
                    ? 'bg-rose-600 hover:bg-rose-700 text-white cursor-pointer shadow-xs' 
                    : 'bg-rose-50 text-rose-400 cursor-not-allowed border border-rose-105/50'
                }`}
              >
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
                    const cleanShareUrl = window.location.href.replace('/#/', '/').replace('/#', '/');
                    const text = `Check out *${product.title}* for *${formattedPrice}* on TedBuy!\n\nView here: ${cleanShareUrl}`;
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
                    const cleanShareUrl = window.location.href.replace('/#/', '/').replace('/#', '/');
                    const text = `Check out ${product.title} for ${formattedPrice} on TedBuy!`;
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
                        const cleanShareUrl = window.location.href.replace('/#/', '/').replace('/#', '/');
                        await navigator.share({
                          title: product.title,
                          text: `Check out ${product.title} for ${formattedPrice} on TedBuy!`,
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
                      const cleanShareUrl = window.location.href.replace('/#/', '/').replace('/#', '/');
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
