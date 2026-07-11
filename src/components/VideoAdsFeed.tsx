import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Product, isUserVerified } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Video, 
  MessageSquare, 
  Bookmark, 
  Maximize2, 
  Volume2, 
  VolumeX, 
  Play, 
  Pause, 
  ArrowLeft, 
  ArrowRight,
  Sparkles,
  MapPin,
  Tag,
  CheckCircle,
  ShoppingBag,
  ExternalLink,
  ChevronUp,
  ChevronDown,
  Heart,
  Plus,
  Share2,
  Flame,
  Eye,
  X
} from 'lucide-react';

// Helper to convert base64 data URIs securely into highly compatible, sandboxing-safe Blob URLs.
// This implements a bulletproof decoder using browser-native atob() with full support for URL-safe base64 and standard padding.
const base64ToBlobUrl = (base64Str: string, defaultMime = 'video/mp4'): string => {
  if (!base64Str) return '';
  if (!base64Str.startsWith('data:')) return base64Str;
  
  try {
    const parts = base64Str.split(',');
    if (parts.length < 2) return base64Str;
    const header = parts[0];
    const base64Part = parts.slice(1).join(',');

    const mimeMatch = header.match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : defaultMime;

    // Normalize any URL-safe base64 characters (- to +, _ to /) and trim
    let normalizedBase64 = base64Part.trim()
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    // Remove any whitespaces, newlines, or invalid non-base64 characters
    normalizedBase64 = normalizedBase64.replace(/[^A-Za-z0-9+/=]/g, '');

    // Restore missing padding if needed
    const pad = normalizedBase64.length % 4;
    if (pad === 2) {
      normalizedBase64 += '==';
    } else if (pad === 3) {
      normalizedBase64 += '=';
    }

    const binaryStr = atob(normalizedBase64);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: mime });
    return URL.createObjectURL(blob);
  } catch (error) {
    console.warn("[VideoAdsFeed] base64ToBlobUrl custom native decoder error, returning raw:", error);
    return base64Str;
  }
};

// Global ultra-high performance cache for Decoded Blob URLs.
// Avoids redundant, blocking, expensive Base64 reconversions on quick scrolls, creating seamless TikTok-like transitions.
const decodedBlobUrlCache = new Map<string, string>();
const MAX_DECODED_CACHE_SIZE = 32;

const getProcessedUrl = (url: string): string => {
  if (!url) return '';
  if (!url.startsWith('data:')) return url;
  
  if (decodedBlobUrlCache.has(url)) {
    return decodedBlobUrlCache.get(url)!;
  }
  
  if (decodedBlobUrlCache.size >= MAX_DECODED_CACHE_SIZE) {
    const oldestKey = decodedBlobUrlCache.keys().next().value;
    if (oldestKey) {
      try {
        URL.revokeObjectURL(decodedBlobUrlCache.get(oldestKey)!);
      } catch (err) {
        console.warn("[VideoAdsFeed] Failed evicting and revoking cached object URL:", err);
      }
      decodedBlobUrlCache.delete(oldestKey);
    }
  }
  
  const bUrl = base64ToBlobUrl(url, 'video/mp4');
  decodedBlobUrlCache.set(url, bUrl);
  return bUrl;
};

export interface ReelItemProps {
  product: Product;
  isActive: boolean;
  shouldLoad: boolean;
  isMuted: boolean;
  onMuteToggle: (e: React.MouseEvent) => void;
  onSaveClick: (e: React.MouseEvent) => void;
  isSaved: boolean;
  onMessageSeller: (e: React.MouseEvent) => void;
  onViewFullAd: (productId: string) => void;
  volume: number;
  onVolumeChange: (vol: number) => void;
  isSellerVerified: boolean;
}

const ReelItem: React.FC<ReelItemProps> = ({
  product,
  isActive,
  shouldLoad,
  isMuted,
  onMuteToggle,
  onSaveClick,
  isSaved,
  onMessageSeller,
  onViewFullAd,
  volume,
  onVolumeChange,
  isSellerVerified,
}) => {
  const { 
    updateProduct, 
    setCurrentView, 
    setSelectedSellerId,
    currentUser,
    setAuthMode,
    setShowAuthModal,
    followSeller,
    users
  } = useApp();

  const seller = users?.find(u => u.id === product.sellerId);
  const isPrioSeller = seller && (
    (seller.visitCount && seller.visitCount >= 2) ||
    (seller.rapidPostScore && seller.rapidPostScore >= 2)
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [processedVideoUrl, setProcessedVideoUrl] = useState<string>('');
  const activeBlobUrlRef = useRef<string>('');
  const [showShareToast, setShowShareToast] = useState(false);

  const handleShareClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const shareUrl = `${window.location.origin}/?product=${product.id}`;
    const shareText = `⚡ Watch organic Spotlight Review: "${product.title}" - ${formatPrice(product.price)} on TedBuy! 🍿 ${shareUrl}`;
    
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareText)
        .then(() => {
          setShowShareToast(true);
          setTimeout(() => setShowShareToast(false), 3000);
        })
        .catch(err => {
          console.warn("Could not copy clipboard: ", err);
        });
    }
  };

  const activeViewsCount = useMemo(() => {
    const seed = product?.id ? product.id.charCodeAt(0) + product.id.charCodeAt(product.id.length - 1) : 42;
    return (seed % 65) + 12 + Math.floor(currentTime * 1.5);
  }, [product?.id, currentTime]);

  // Auto-hide controls & progress bar states
  const [showControls, setShowControls] = useState<boolean>(true);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetControlsTimeout = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  };

  useEffect(() => {
    if (!isActive) {
      setShowControls(true);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      return;
    }

    if (!isPlaying) {
      setShowControls(true);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    } else {
      resetControlsTimeout();
    }

    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [isPlaying, isActive]);

  const isOwnProfile = currentUser?.id === product?.sellerId;
  const isFollowing = currentUser?.followingSellers?.includes(product?.sellerId || '') || false;

  const handleFollowClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser) {
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    if (product?.sellerId) {
      await followSeller(product.sellerId);
    }
  };

  const handleSellerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (product?.sellerId) {
      setSelectedSellerId(product.sellerId);
      setCurrentView('seller-profile');
    }
  };

  const currentVideoUrl = product?.videos?.[0] || '';

  // Instant preloading & decoding using global memoized Blob cache to prevent freeze and enable buttery smooth TikTok swipe
  useEffect(() => {
    if (!shouldLoad) {
      setProcessedVideoUrl('');
      return;
    }

    if (!currentVideoUrl) {
      setProcessedVideoUrl('');
      return;
    }

    const cachedUrl = getProcessedUrl(currentVideoUrl);
    setProcessedVideoUrl(cachedUrl);
  }, [currentVideoUrl, shouldLoad]);

  // Sync volume and mute changes dynamically without triggering video play re-initializations
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = volume;
      video.muted = isMuted;
    }
  }, [isMuted, volume]);

  // Synchronize playback with active state and handle mobile browser auto-play policies
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !processedVideoUrl) return;

    let isCurrent = true;

    const attemptPlay = () => {
      if (!isCurrent || !isActive || !video) return;

      // Always synchronize standard audio controls
      video.volume = volume;
      video.muted = isMuted;

      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            if (isCurrent) setIsPlaying(true);
          })
          .catch(error => {
            console.log("[ReelItem] Blocked entry playback, recovering muted...", error);
            if (video && isCurrent) {
              video.muted = true;
              video.play()
                .then(() => {
                  if (isCurrent) setIsPlaying(true);
                })
                .catch(innerErr => {
                  console.log("[ReelItem] Unrecoverable block:", innerErr);
                  if (isCurrent) setIsPlaying(false);
                });
            }
          });
      }
    };

    if (isActive) {
      // Call play immediately for rapid Tiktok-style responsiveness
      attemptPlay();

      // Also listen to state transition events as a safe backup in case metadata wasn't parsed yet
      const handleMetadataLoaded = () => {
        if (isCurrent && isActive) {
          attemptPlay();
        }
      };

      video.addEventListener('loadedmetadata', handleMetadataLoaded);
      video.addEventListener('canplay', handleMetadataLoaded);

      return () => {
        isCurrent = false;
        if (video) {
          video.removeEventListener('loadedmetadata', handleMetadataLoaded);
          video.removeEventListener('canplay', handleMetadataLoaded);
        }
      };
    } else {
      video.pause();
      setIsPlaying(false);
    }

    return () => {
      isCurrent = false;
    };
  }, [isActive, processedVideoUrl]);

  const handlePlayPause = () => {
    if (!videoRef.current || !processedVideoUrl) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => {
        console.warn("[ReelItem] Play click blocked:", err);
      });
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || 0);
    }
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const newTime = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleVolumeSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    onVolumeChange(parseFloat(e.target.value));
  };

  const formatTime = (timeInSeconds: number) => {
    if (isNaN(timeInSeconds) || !isFinite(timeInSeconds)) return '0:00';
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const formatPrice = (priceVal: string | number) => {
    const num = Number(String(priceVal).replace(/GHS|GH₵|,/g, '').trim());
    if (isNaN(num) || num <= 0) return 'Inquire';
    return `GH₵${num.toLocaleString()}`;
  };

  const handleVideoContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Bypasses if clicking on control panel HUD actions to keep seek/volume snappy and click-through clean
    if (target.closest('.pointer-events-auto') || target.closest('input') || target.closest('button')) {
      return;
    }
    handlePlayPause();
  };

  return (
    <div ref={containerRef} className="flex items-center justify-center w-full h-full p-0 select-none">
      {/* Immersive full-screen video player container where everything floats on top */}
      <div 
        onClick={handleVideoContainerClick}
        onMouseMove={resetControlsTimeout}
        onTouchStart={resetControlsTimeout}
        onMouseEnter={resetControlsTimeout}
        className="relative w-full h-full bg-slate-950 overflow-hidden group cursor-pointer flex items-center justify-center shrink-0 transition-all duration-300"
      >
        {!shouldLoad ? (
          <div className="text-center p-6 text-slate-500">
            <Video className="w-14 h-14 mx-auto stroke-[1] text-[#FFFC00]/85 mb-3 animate-pulse" />
            <p className="text-[11px] font-mono font-black text-slate-400 uppercase tracking-widest">Preloading spotlight...</p>
          </div>
        ) : !processedVideoUrl ? (
          <div className="text-center p-6 text-slate-500">
            {currentVideoUrl ? (
              <>
                <Video className="w-14 h-14 mx-auto stroke-[1.2] text-[#FFFC00] mb-3 animate-spin" />
                <p className="text-[11px] font-mono font-black text-[#FFFC00]/95 uppercase tracking-widest">Streaming media...</p>
              </>
            ) : (
              <>
                <Video className="w-14 h-14 mx-auto stroke-[1] text-slate-600 mb-3" />
                <p className="text-xs font-bold text-slate-500">Showcase Unavailable</p>
              </>
            )}
          </div>
        ) : (
          <video
            ref={videoRef}
            src={processedVideoUrl}
            autoPlay={isActive}
            loop
            muted={isMuted}
            playsInline
            webkit-playsinline="true"
            preload="auto"
            crossOrigin="anonymous"
            style={{ 
              transform: 'translate3d(0, 0, 0)', 
              backfaceVisibility: 'hidden',
              willChange: 'transform' 
            }}
            className="w-full h-full object-cover select-none transition-opacity duration-300"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onDurationChange={handleLoadedMetadata}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
        )}

        {/* Snapchat Header Progress Pills Indicator */}
        <div className="absolute top-2.5 inset-x-3.5 h-[3px] flex gap-1 z-30 pointer-events-none">
          <div className="flex-1 h-full bg-white/20 rounded-full overflow-hidden">
            <div 
              className="h-full bg-[#FFFC00] rounded-full transition-all duration-100 ease-linear shadow-[0_0_8px_rgba(255,252,0,0.9)]"
              style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
            />
          </div>
        </div>





        {/* Glassmorphic Copy Status Toast */}
        <AnimatePresence>
          {showShareToast && (
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: -10 }}
              className="absolute top-18 left-1/2 -translate-x-1/2 z-45 bg-[#FFFC00] text-slate-950 px-3.5 py-1.5 rounded-full text-[10px] font-black tracking-widest uppercase shadow-[0_10px_25px_rgba(255,252,0,0.45)] flex items-center gap-1.5 pointer-events-none"
            >
              <Sparkles className="w-3.5 h-3.5 animate-pulse text-slate-950 fill-slate-950" />
              <span>Link Copied! Share Spotlight 🚀</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Video Play HUD overlay (When paused) */}
        {!isPlaying && (
          <div className="absolute inset-0 z-20 bg-black/45 flex items-center justify-center pointer-events-none">
            <div className="p-4.5 rounded-full bg-black/60 backdrop-blur-md border border-white/20 scale-110 drop-shadow-2xl">
              <Play className="w-7 h-7 text-[#FFFC00] fill-[#FFFC00]" />
            </div>
          </div>
        )}

        {/* Immersive bottom text details overlay */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/100 via-black/65 to-transparent p-4 pb-7 text-left z-20 flex flex-col justify-end pointer-events-none">
          <div className="space-y-2 pointer-events-auto max-w-[72%]">
            <div className="flex flex-wrap gap-1.5">
              <span className="px-2.5 py-0.5 bg-[#FFFC00] text-slate-950 text-[9px] font-black rounded-md tracking-wider uppercase inline-flex items-center gap-1 shadow-md">
                <Tag className="w-2.5 h-2.5" />
                {product?.category}
              </span>
              {isPrioSeller && (
                <span className="px-2.5 py-0.5 bg-gradient-to-r from-[#FFFC00] to-yellow-400 text-slate-950 text-[9px] font-black rounded-md tracking-wider uppercase inline-flex items-center gap-1.5 shadow-md">
                  <Flame className="w-2.5 h-2.5 text-slate-900 fill-slate-900 animate-pulse" />
                  <span>Featured Seller</span>
                </span>
              )}
            </div>
            
            <h3 className="text-sm sm:text-base font-black text-white leading-tight truncate drop-shadow-md">{product?.title}</h3>
            
            <div className="flex items-center gap-2">
              <p className="text-base font-black text-[#FFFC00] drop-shadow-md">{formatPrice(product?.price)}</p>
              <div className="text-[9px] font-extrabold text-[#FFFC00]/95 flex items-center gap-0.5 bg-white/10 backdrop-blur-md px-2 py-0.5 rounded-full border border-white/10">
                <MapPin className="w-2.5 h-2.5 text-[#FFFC00]" />
                <span className="truncate max-w-[75px]">{product?.location}</span>
              </div>
            </div>

            {product?.description && (
              <p className="text-[10px] text-slate-200 line-clamp-2 leading-relaxed font-sans font-semibold drop-shadow-sm">
                {product.description}
              </p>
            )}
          </div>
        </div>

        {/* Glassmorphic Snapchat-style Floating HUD Panel on the right edge */}
        <div className="absolute right-2 sm:right-3.5 bottom-8 sm:bottom-12 flex flex-col gap-2.5 sm:gap-4.5 z-30 items-center pointer-events-auto pb-2 sm:pb-4">
          
          {/* Seller Avatar Ring Badge */}
          <div 
            onClick={handleSellerClick}
            className="relative group/avatar cursor-pointer"
          >
            {product?.sellerPhoto && !product.sellerPhoto.includes('1549399542-7e3f8b79c341') ? (
              <img 
                src={product.sellerPhoto} 
                alt="" 
                className="w-9 h-9 sm:w-11 sm:h-11 rounded-full border-2 border-[#FFFC00] object-cover shadow-xl transition-transform hover:scale-110 duration-200" 
              />
            ) : (
              <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-full border-2 border-[#FFFC00] bg-slate-800 text-slate-100 flex items-center justify-center font-black text-[10px] sm:text-xs shadow-xl transition-transform hover:scale-110 duration-200 uppercase whitespace-nowrap">
                {product?.sellerName ? product.sellerName.substring(0, 2) : 'U'}
              </div>
            )}
            
            {/* Snapchat Subscribe Plus icon overlay */}
            <AnimatePresence>
              {!isOwnProfile && !isFollowing && (
                <motion.button
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  whileHover={{ scale: 1.25 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={handleFollowClick}
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-[#FFFC00]/95 hover:bg-[#FFFC00] text-slate-950 border border-slate-950 rounded-full w-3.5 h-3.5 sm:w-4.5 sm:h-4.5 flex items-center justify-center shadow-lg transition-all duration-150 z-20 cursor-pointer outline-none select-none"
                  title={`Subscribe @${product?.sellerName}`}
                >
                  <Plus className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-slate-950 stroke-[4.5]" />
                </motion.button>
              )}
            </AnimatePresence>

            {isSellerVerified && (
              <div className="absolute -bottom-1 -right-1 bg-emerald-500 rounded-full p-0.5 border border-slate-950 shadow-md animate-scale-up">
                <CheckCircle className="w-2 h-2 sm:w-2.5 sm:h-2.5 text-white fill-white" />
              </div>
            )}
          </div>



          {/* Snapchat-style Bookmarks / Save Action */}
          <div className="flex flex-col items-center">
            <button
              onClick={onSaveClick}
              className={`w-8.5 h-8.5 sm:w-10.5 sm:h-10.5 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl ${
                isSaved 
                  ? 'bg-amber-500 text-white scale-110 shadow-amber-500/30' 
                  : 'bg-black/50 backdrop-blur-md text-white border border-white/10 hover:bg-black/75 hover:scale-110'
              }`}
            >
              <Bookmark className={`w-4 h-4 sm:w-5 sm:h-5 ${isSaved ? 'fill-white text-white' : 'text-white'}`} />
            </button>
            <span className="text-[9px] sm:text-[10px] font-extrabold text-white mt-1 sm:mt-1.5 drop-shadow-md select-none">
              {isSaved ? 'Saved' : 'Save'}
            </span>
          </div>

          {/* Direct WhatsApp Chat Action */}
          <div className="flex flex-col items-center">
            <button
              onClick={onMessageSeller}
              className="w-8.5 h-8.5 sm:w-10.5 sm:h-10.5 rounded-full bg-emerald-500 text-white flex items-center justify-center transition-all duration-300 shadow-xl hover:bg-emerald-400 hover:scale-110 active:scale-95 shadow-emerald-500/20"
            >
              <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5 text-white fill-white" />
            </button>
            <span className="text-[9px] sm:text-[10px] font-extrabold text-white mt-1 sm:mt-1.5 drop-shadow-md select-none">
              Chat
            </span>
          </div>

          {/* Dynamic Paper-Plane Share Action */}
          <div className="flex flex-col items-center">
            <button
              onClick={handleShareClick}
              className="w-8.5 h-8.5 sm:w-10.5 sm:h-10.5 rounded-full bg-[#FFFC00]/15 backdrop-blur-md border border-[#FFFC00]/30 text-[#FFFC00] flex items-center justify-center transition-all duration-300 shadow-xl hover:bg-[#FFFC00]/30 hover:scale-110 active:scale-95"
            >
              <Share2 className="w-4 h-4 sm:w-5 sm:h-5 text-[#FFFC00] stroke-[2.2]" />
            </button>
            <span className="text-[9px] sm:text-[10px] font-extrabold text-[#FFFC00] mt-1 sm:mt-1.5 drop-shadow-md select-none">
              Share
            </span>
          </div>

          {/* Spec presentation ad Details */}
          <div className="flex flex-col items-center">
            <button
              onClick={() => onViewFullAd(product.id)}
              className="w-8.5 h-8.5 sm:w-10.5 sm:h-10.5 rounded-full bg-white text-slate-950 flex items-center justify-center transition-all duration-300 shadow-xl hover:bg-slate-100 hover:scale-110 active:scale-95"
            >
              <Maximize2 className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-slate-950 stroke-[2.5]" />
            </button>
            <span className="text-[9px] sm:text-[10px] font-black text-white mt-1 sm:mt-1.5 tracking-wide drop-shadow-md select-none">
              Specs
            </span>
          </div>
        </div>

        {/* Minimalist interactive seeking timeline at the absolute bottom edge */}
        <div className="absolute bottom-0 inset-x-0 h-1.5 bg-black/40 z-30 pointer-events-auto flex items-end">
          <input
            type="range"
            min="0"
            max={duration || 10}
            step="0.01"
            value={currentTime}
            onChange={handleSeekChange}
            onClick={(e) => e.stopPropagation()}
            className="w-full accent-[#FFFC00] hover:accent-[#FFFC00] h-1 bg-white/15 appearance-none cursor-pointer transition-all outline-none"
          />
        </div>
      </div>
    </div>
  );
};

export const VideoAdsFeed: React.FC = () => {
  const {
    products,
    users,
    currentUser,
    setCurrentView,
    setSelectedProductId,
    toggleSaveProduct,
    setShowAuthModal,
    setAuthMode,
    startChat,
    isProductsLoading,
    hasMoreProducts,
    loadMoreProducts,
    setIsVerificationBlockOpen,
    setBlockedActionType,
    showToast,
    homeViewMode,
    setHomeViewMode,
    isBottomNavVisible,
    setIsBottomNavVisible
  } = useApp();

  const feedScrollContainerRef = useRef<HTMLDivElement>(null);
  const productRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  const videoProducts = useMemo(() => {
    const filtered = products.filter(p => p.videos && p.videos.length > 0);
    
    const getSellerScore = (sellerId: string): number => {
      const seller = users?.find(u => u.id === sellerId);
      if (!seller) return 0;
      const visitCount = seller.visitCount || 0;
      const rapidPostScore = seller.rapidPostScore || 0;

      const visitScore = visitCount * 50;
      const postScore = rapidPostScore * 200;

      return visitScore + postScore;
    };

    return [...filtered].sort((a, b) => {
      const scoreA = getSellerScore(a.sellerId);
      const scoreB = getSellerScore(b.sellerId);

      if (scoreA !== scoreB) {
        return scoreB - scoreA; // Highly active/frequent posters always first!
      }

      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
  }, [products, users]);

  // Background filler effect: If the filtered video products count is small, proactively request more products in the background
  useEffect(() => {
    if (videoProducts.length < 10 && hasMoreProducts && !isProductsLoading) {
      const timer = setTimeout(() => {
        loadMoreProducts();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [videoProducts.length, hasMoreProducts, isProductsLoading, loadMoreProducts]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const [contactingProduct, setContactingProduct] = useState<Product | null>(null);

  // Sync scroll positioning with Intersection Observer
  useEffect(() => {
    const container = feedScrollContainerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const prodId = entry.target.getAttribute('data-product-id');
          if (prodId) {
            const idx = videoProducts.findIndex(p => p.id === prodId);
            if (idx !== -1) {
              setActiveIndex(idx);
            }
          }
        }
      });
    }, {
      root: container,
      threshold: 0.65, // Active video is centered and occupies at least 65% of the viewport height
    });

    videoProducts.forEach(p => {
      const el = productRefs.current[p.id];
      if (el) {
        observer.observe(el);
      }
    });

    return () => {
      observer.disconnect();
    };
  }, [videoProducts]);

  // Hide bottom navigation on scroll down, show on scroll up inside the video feed container
  useEffect(() => {
    const container = feedScrollContainerRef.current;
    if (!container) return;

    let lastScrollTop = container.scrollTop;
    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const currentScrollTop = container.scrollTop;
          // Threshold of 12px scroll to prevent jittering
          if (Math.abs(currentScrollTop - lastScrollTop) > 12) {
            if (currentScrollTop > lastScrollTop && currentScrollTop > 60) {
              setIsBottomNavVisible(false);
            } else {
              setIsBottomNavVisible(true);
            }
          }
          lastScrollTop = Math.max(0, currentScrollTop);
          ticking = false;
        });
        ticking = true;
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [setIsBottomNavVisible]);

  // Always reset bottom nav to visible when leaving/unmounting the video feed
  useEffect(() => {
    return () => {
      setIsBottomNavVisible(true);
    };
  }, [setIsBottomNavVisible]);

  const scrollToProduct = (idx: number) => {
    const p = videoProducts[idx];
    if (p) {
      const el = productRefs.current[p.id];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  const handleNext = () => {
    if (videoProducts.length === 0) return;
    const nextIdx = (activeIndex + 1) % videoProducts.length;
    setActiveIndex(nextIdx);
    scrollToProduct(nextIdx);
  };

  const handlePrev = () => {
    if (videoProducts.length === 0) return;
    const prevIdx = (activeIndex - 1 + videoProducts.length) % videoProducts.length;
    setActiveIndex(prevIdx);
    scrollToProduct(prevIdx);
  };

  const handleViewFullAd = (productId: string) => {
    setSelectedProductId(productId);
    setCurrentView('product-detail');
  };

  const formatPrice = (priceVal: string | number) => {
    const num = Number(String(priceVal).replace(/GHS|GH₵|,/g, '').trim());
    if (isNaN(num) || num <= 0) return 'Inquire';
    return `GH₵${num.toLocaleString()}`;
  };

  if (videoProducts.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-3xl p-8 sm:p-12 text-center max-w-2xl mx-auto my-8 shadow-sm">
        <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <Video className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-black text-slate-900 tracking-tight">No Dynamic Video Ads Yet!</h3>
        <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
          Be the first to create a beautiful interactive video ad! Dynamic video ads are displayed in a fully scrollable, immersive feed on our homepage to captivate real-time buyers.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => {
              const btn = document.getElementById('hero-post-ad-btn');
              if (btn) btn.click();
            }}
            className="px-6 py-3 bg-slate-900 text-white font-extrabold text-sm rounded-xl hover:bg-slate-800 transition shadow-sm cursor-pointer"
          >
            🎥 Post a Video Ad First!
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 h-full w-full bg-slate-950 overflow-hidden flex flex-col text-white relative animate-fade-in">
 
      {/* 1. Immersive vertical center-aligned Reels viewport container */}
      <div className="flex-1 relative bg-slate-950 flex flex-col justify-start overflow-hidden">
        {/* Modern "Scroll to watch ads" top overlay indicator replacing the old thumbnail navigation block */}
        <div className="absolute top-4 left-4 z-30 flex items-center gap-2 bg-black/75 backdrop-blur-md border border-white/10 px-3.5 py-1.5 rounded-full shadow-2xl pointer-events-none select-none">
          <div className="flex items-center justify-center bg-[#FFFC00] text-slate-950 rounded-full p-0.5 animate-bounce">
            <ChevronDown className="w-3.5 h-3.5 stroke-[3]" />
          </div>
          <span className="text-[10px] font-black tracking-widest text-[#FFFC00] font-sans uppercase">
            Scroll to watch ads
          </span>
        </div>

        {/* Scrollable scroll-snap container */}
        <div 
          ref={feedScrollContainerRef}
          className="w-full h-full overflow-y-auto snap-y snap-mandatory scroll-smooth flex flex-col items-center gap-0 scrollbar-none"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {videoProducts.map((product, idx) => {
            const isSaved = currentUser?.savedProductIds?.includes(product.id) || false;
 
            return (
              <div 
                key={product.id}
                ref={el => { productRefs.current[product.id] = el; }}
                data-product-id={product.id}
                className="w-full h-full snap-center shrink-0 flex items-center justify-center p-0"
              >
                <ReelItem
                  product={product}
                  isActive={activeIndex === idx}
                  shouldLoad={activeIndex === idx || (activeIndex + 1) % videoProducts.length === idx}
                  isMuted={isMuted}
                  onMuteToggle={(e) => {
                    e.stopPropagation();
                    setIsMuted(prev => !prev);
                  }}
                  onSaveClick={(e) => {
                    e.stopPropagation();
                    if (!currentUser) {
                      setAuthMode('login');
                      setShowAuthModal(true);
                      return;
                    }
                    toggleSaveProduct(product.id);
                  }}
                  isSaved={isSaved}
                  onMessageSeller={(e) => {
                    e.stopPropagation();
                    if (!currentUser) {
                      setAuthMode('login');
                      setShowAuthModal(true);
                      return;
                    }
                    setContactingProduct(product);
                  }}
                  onViewFullAd={handleViewFullAd}
                  volume={volume}
                  onVolumeChange={(nextVol) => {
                    setVolume(nextVol);
                    if (nextVol > 0) {
                      setIsMuted(false);
                    } else {
                      setIsMuted(true);
                    }
                  }}
                  isSellerVerified={isUserVerified(users?.find(u => u.id === product.sellerId))}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* WhatsApp or In-App Chat Contact Options modal overlay */}
      <AnimatePresence>
        {contactingProduct && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-[99]" onClick={() => setContactingProduct(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-sm w-full shadow-2xl relative text-left"
            >
              {/* Close button */}
              <button
                onClick={() => setContactingProduct(null)}
                className="absolute top-4 right-4 p-2 rounded-full bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white transition cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Header section with brand yellow highlights */}
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#FFFC00]/20 to-amber-500/10 border border-[#FFFC00]/30 text-[#FFFC00] flex items-center justify-center mb-5 shadow-inner">
                <MessageSquare className="w-5.5 h-5.5 stroke-[2.2]" />
              </div>

              <h4 className="text-base font-black uppercase text-slate-100 tracking-wider mb-1 flex items-center gap-1.5 leading-snug">
                Contact Seller
              </h4>
              <p className="text-xs text-slate-400 font-medium leading-relaxed mb-6">
                How would you like to negotiate or chat with <span className="font-extrabold text-[#FFFC00]">@{contactingProduct.sellerName}</span> regarding this video ad?
              </p>

              {/* Action buttons */}
              <div className="space-y-3.5">
                {/* 1. Direct WhatsApp Option */}
                <button
                  onClick={() => {
                    const sellerUser = users?.find(u => u.id === contactingProduct.sellerId);
                    const hasWhatsApp = !!sellerUser?.whatsAppNumber;

                    if (!currentUser) {
                      setContactingProduct(null);
                      setAuthMode('login');
                      setShowAuthModal(true);
                      return;
                    }

                    if (!currentUser.emailVerified) {
                      // Trigger email verification workflow natively
                      setBlockedActionType('whatsApp');
                      setIsVerificationBlockOpen(true);
                      setContactingProduct(null);
                      return;
                    }

                    if (!hasWhatsApp) {
                      // Custom graceful automatic fallback to SECURE IN-APP CHAT
                      showToast(`@${contactingProduct.sellerName} hasn't listed a WhatsApp link yet. Let's message them in-app instead!`, 'info');
                      try {
                        startChat(contactingProduct.id, "Hi, I saw your video ad! Is this item still available?");
                        setCurrentView('chats');
                      } catch (err) {
                        showToast("Failed to initiate in-app chat", "error");
                        console.error(err);
                      }
                      setContactingProduct(null);
                      return;
                    }

                    // Format and open official WhatsApp link securely
                    let cleanNumber = sellerUser.whatsAppNumber!.replace(/\D/g, '');
                    if (cleanNumber.startsWith('0') && cleanNumber.length === 10) {
                      cleanNumber = '233' + cleanNumber.substring(1);
                    } else if (!cleanNumber.startsWith('233') && cleanNumber.length === 9) {
                      cleanNumber = '233' + cleanNumber;
                    }

                    const prefilledText = `Hello! I'm interested in your listed item "${contactingProduct.title}" on Tedbuy marketplace. Let's chat!`;
                    const finalUrl = `https://wa.me/${cleanNumber}?text=${encodeURIComponent(prefilledText)}`;
                    window.open(finalUrl, '_blank', 'noopener,noreferrer');
                    setContactingProduct(null);
                  }}
                  className="w-full flex items-center justify-between p-4 rounded-2xl bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/20 hover:border-emerald-500/45 text-left transition duration-200 group cursor-pointer"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-emerald-600 flex items-center justify-center text-white shrink-0 shadow-lg shadow-emerald-500/20">
                      <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                        <path d="M12.004 2.012c-5.511 0-9.996 4.487-9.996 9.998 0 2.083.639 4.02 1.738 5.626L2.33 21.84l4.331-1.42a9.932 9.932 0 005.343 1.545c5.511 0 9.997-4.487 9.997-9.999s-4.486-9.954-9.997-9.954zm5.823 13.1c-.244.385-1.196 1.155-1.579 1.258-.385.103-.784.148-2.148-.385a8.775 8.775 0 01-3.692-3.15c-.414-.62-.738-1.344-.738-2.1 0-1.257.636-1.892.857-2.144.22-.25.592-.354.887-.354.103 0 .192.006.265.006.223 0 .428-.016.621.43.243.568.827 1.996.899 2.143.074.147.123.324.025.515-.1.19-.147.31-.294.485-.147.172-.31.383-.442.511-.147.147-.301.31-.129.62.172.294.764 1.257 1.636 2.031.734.654 1.348 1.018 1.722 1.205.385.184.606.147.828-.103.22-.25.96-1.12 1.221-1.503.25-.386.516-.31.874-.184.354.123 2.251 1.06 2.637 1.25.385.183.635.28.723.427.09.148.09 1.154-.153 1.54z"/>
                      </svg>
                    </div>
                    <div>
                      <span className="font-bold text-slate-100 text-xs block group-hover:text-emerald-400 transition-colors font-sans">WhatsApp Messager</span>
                      <p className="text-[10px] text-slate-400 mt-0.5 font-medium leading-normal">Message direct via WhatsApp link</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 group-hover:translate-x-1.5 transition-all" />
                </button>

                {/* 2. Direct In-App Chat Option */}
                <button
                  onClick={() => {
                    if (!currentUser) {
                      setContactingProduct(null);
                      setAuthMode('login');
                      setShowAuthModal(true);
                      return;
                    }
                    try {
                      startChat(contactingProduct.id, "Hi, I saw your video ad! Is this item still available?");
                      setCurrentView('chats');
                      setContactingProduct(null);
                    } catch (err) {
                      showToast("Failed to initiate secure in-app chat", "error");
                      console.error("Failed to start chat:", err);
                    }
                  }}
                  className="w-full flex items-center justify-between p-4 rounded-2xl bg-[#FFFC00]/5 hover:bg-[#FFFC00]/10 border border-[#FFFC00]/10 hover:border-[#FFFC00]/25 text-left transition duration-200 group cursor-pointer"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-[#FFFC00] flex items-center justify-center text-slate-950 shrink-0 shadow-lg shadow-[#FFFC00]/10">
                      <MessageSquare className="w-5 h-5 text-slate-950 fill-slate-950" />
                    </div>
                    <div>
                      <span className="font-bold text-slate-100 text-xs block group-hover:text-[#FFFC00] transition-colors font-sans">In-App Secure Chat</span>
                      <p className="text-[10px] text-slate-400 mt-0.5 font-medium leading-normal">Safe native peer-to-peer messaging</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-[#FFFC00] group-hover:translate-x-1.5 transition-all" />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
