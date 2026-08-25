import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { Product, isUserVerified, isUserAdmin } from '../types';
import { isVideoAsset } from './MediaRenderer';
import { slugify } from '../utils/slugify';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Video, 
  MessageSquare, 
  Bookmark, 
  Maximize2, 
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
  Send,
  Forward,
  Flame,
  Eye,
  X
} from 'lucide-react';
import { 
  getProcessedVideoUrl, 
  preloadVideoBatch 
} from '../utils/videoCache';

let globalBottomNavTimeout: NodeJS.Timeout | null = null;

export const showBottomNavWith2_5SecAutoHide = (setIsBottomNavVisible: (vis: boolean) => void) => {
  setIsBottomNavVisible(true);
  if (globalBottomNavTimeout) {
    clearTimeout(globalBottomNavTimeout);
  }
  globalBottomNavTimeout = setTimeout(() => {
    setIsBottomNavVisible(false);
  }, 2500);
};

export const hideBottomNavImmediately = (setIsBottomNavVisible: (vis: boolean) => void) => {
  setIsBottomNavVisible(false);
  if (globalBottomNavTimeout) {
    clearTimeout(globalBottomNavTimeout);
    globalBottomNavTimeout = null;
  }
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
    users,
    setIsBottomNavVisible,
    isBottomNavVisible,
    setHomeViewMode,
    showToast
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
  const [videoError, setVideoError] = useState(false);
  const [videoErrorDetails, setVideoErrorDetails] = useState('');
  const activeBlobUrlRef = useRef<string>('');
  const [showShareToast, setShowShareToast] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  // Clean, server-resolvable share URL for this product — used by every button in the share modal below.
  // (A bare "?product=" query param is never read by the server's SSR meta-tag injection, so links
  // built that way silently lost their product preview.)
  const modalShareUrl = `${window.location.origin}/product/${product.id}-${slugify(product.title)}`;

  const handleShareClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const shareUrl = modalShareUrl;
    const shareTitle = product.title;
    const isService = product ? (product.category === 'Services' || product.category?.toLowerCase() === 'services' || product.category?.toLowerCase().includes('service')) : false;
    const formattedPriceStr = formatPrice(product.price);
    const hasPrice = !isService && product.price !== undefined && product.price !== null && Number(product.price) > 0 && formattedPriceStr !== 'GH₵0' && formattedPriceStr !== 'GHS 0';
    const priceText = hasPrice ? ` for ${formattedPriceStr}` : '';
    const shareText = `Check out "${product.title}"${priceText} on TedBuy Ghana!`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl
        });
        showToast?.("Shared successfully! 🎉", "success");
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

  // Instant preloading & decoding for base64 Data URLs and direct video URLs
  useEffect(() => {
    setVideoError(false);
    setVideoErrorDetails('');

    if (!shouldLoad || !currentVideoUrl) {
      setProcessedVideoUrl('');
      return;
    }

    // Resolve immediately with no delay
    const playableUrl = getProcessedVideoUrl(currentVideoUrl);
    setProcessedVideoUrl(playableUrl);
  }, [currentVideoUrl, shouldLoad]);

  // Sync volume and mute changes dynamically without triggering video play re-initializations
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = volume;
      video.muted = isMuted;
      if (!isMuted) {
        video.muted = false;
        if (video.paused && isActive) {
          video.play().catch(() => {});
        }
      }
    }
  }, [isMuted, volume, isActive]);

  // Global user interaction listener for individual reel item to unlock audio instantly on gesture
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isActive) return;

    const handleUserInteraction = () => {
      if (video) {
        video.muted = false;
        video.volume = volume || 1;
        if (video.paused && isActive) {
          video.play().catch(() => {});
        }
      }
    };

    window.addEventListener('click', handleUserInteraction, { capture: true, passive: true });
    window.addEventListener('touchstart', handleUserInteraction, { capture: true, passive: true });
    window.addEventListener('pointerdown', handleUserInteraction, { capture: true, passive: true });

    return () => {
      window.removeEventListener('click', handleUserInteraction, { capture: true });
      window.removeEventListener('touchstart', handleUserInteraction, { capture: true });
      window.removeEventListener('pointerdown', handleUserInteraction, { capture: true });
    };
  }, [isActive, volume]);

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
    // Automatically unmute and enable audio when user interacts with video feed
    if (isMuted) {
      if (videoRef.current) {
        videoRef.current.muted = false;
      }
      onMuteToggle(e);
    }
    if (isBottomNavVisible) {
      hideBottomNavImmediately(setIsBottomNavVisible);
    } else {
      showBottomNavWith2_5SecAutoHide(setIsBottomNavVisible);
    }
    handlePlayPause();
  };

  return (
    <div ref={containerRef} className="flex items-center justify-center w-full h-full p-0 select-none">
      {/* Immersive full-screen video player container where everything floats on top */}
      <div 
        onClick={handleVideoContainerClick}
        onMouseMove={resetControlsTimeout}
        onTouchStart={(e) => {
          resetControlsTimeout();
        }}
        onMouseEnter={resetControlsTimeout}
        className="relative w-full h-full bg-slate-950 overflow-hidden group cursor-pointer flex items-center justify-center shrink-0 transition-all duration-300"
      >
        {!shouldLoad ? (
          <div className="text-center p-6 text-slate-500">
            <Video className="w-14 h-14 mx-auto stroke-[1] text-[#FFFC00]/85 mb-3 animate-pulse" />
            <p className="text-[11px] font-mono font-black text-slate-400 uppercase tracking-widest">Preloading spotlight...</p>
          </div>
        ) : videoError ? (
          <div className="relative w-full h-full flex flex-col items-center justify-center bg-slate-950 p-6 text-center select-none">
            {/* Display first product image as blurred background fallback */}
            {product.images?.[0] && (
              <img
                src={product.images[0]}
                alt=""
                className="absolute inset-0 w-full h-full object-cover blur-md opacity-30 select-none pointer-events-none"
                referrerPolicy="no-referrer"
              />
            )}
            <div className="relative z-10 max-w-xs p-6 rounded-3xl bg-slate-900/90 backdrop-blur-md border border-white/10 shadow-2xl flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center">
                <Video className="w-6 h-6 text-rose-500" />
              </div>
              <h4 className="text-xs font-black uppercase tracking-wider text-rose-400">Media Playback Error</h4>
              <p className="text-[10px] text-slate-300 leading-relaxed font-sans font-semibold">
                {videoErrorDetails || "This video couldn't be loaded or played back due to a network or format issue."}
              </p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setVideoError(false);
                  setVideoErrorDetails('');
                  const video = videoRef.current;
                  if (video) {
                    video.load();
                    video.play().catch(err => {
                      console.warn('[ReelItem] Retry play failed:', err);
                    });
                  }
                }}
                className="mt-2 w-full py-2.5 bg-[#FFFC00] hover:bg-yellow-400 text-slate-950 font-black rounded-xl text-[10px] tracking-widest uppercase transition shadow-md cursor-pointer"
              >
                Retry Showcase
              </button>
            </div>
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
            disablePictureInPicture
            controlsList="nodownload nofullscreen noremoteplayback"
            preload="auto"
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
            onError={(e) => {
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
              console.error(`[ReelItem Error] Video failed to load for Product ID: ${product.id}. Title: "${product.title}". Video URL: "${currentVideoUrl}". Processed URL: "${processedVideoUrl}". Error: ${errMsg}`, err);
              setVideoError(true);
              setVideoErrorDetails(errMsg);
            }}
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
            {isPrioSeller && (
              <div className="flex flex-wrap gap-1.5">
                <span className="px-2.5 py-0.5 bg-gradient-to-r from-[#FFFC00] to-yellow-400 text-slate-950 text-[9px] font-black rounded-md tracking-wider uppercase inline-flex items-center gap-1.5 shadow-md">
                  <Flame className="w-2.5 h-2.5 text-slate-900 fill-slate-900 animate-pulse" />
                  <span>Active Seller</span>
                </span>
              </div>
            )}
            
            <h3 className="text-sm sm:text-base font-black text-white leading-tight truncate drop-shadow-md">{product?.title}</h3>
            
            <div className="flex items-center gap-2">
              <p className="text-xs sm:text-sm font-black text-[#FFFC00] drop-shadow-md">{formatPrice(product?.price)}</p>
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
                {(seller?.username || product?.sellerName) ? (seller?.username || product?.sellerName).substring(0, 2) : 'U'}
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
                  title={`Subscribe @${seller?.username || product?.sellerName}`}
                >
                  <Plus className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-slate-950 stroke-[4.5]" />
                </motion.button>
              )}
            </AnimatePresence>

            {isUserAdmin(seller) ? (
              <div className="absolute -bottom-1 -right-1 rounded-full p-0.5 bg-white shadow-md animate-scale-up" title="Official TedBuy Admin Account">
                <img src="/admin-badge.svg" alt="Admin Verification Badge" className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
            ) : isSellerVerified ? (
              <div className="absolute -bottom-1 -right-1 bg-emerald-500 rounded-full p-0.5 border border-slate-950 shadow-md animate-scale-up">
                <CheckCircle className="w-2 h-2 sm:w-2.5 sm:h-2.5 text-white fill-white" />
              </div>
            ) : null}
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
              <Forward className="w-4.5 h-4.5 sm:w-5.5 sm:h-5.5 text-[#FFFC00] stroke-[2.2]" />
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
      </div>

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
                    const shareUrl = modalShareUrl;
                    const isService = product ? (product.category === 'Services' || product.category?.toLowerCase() === 'services' || product.category?.toLowerCase().includes('service')) : false;
                    const formattedPriceStr = formatPrice(product.price);
                    const hasPrice = !isService && product.price !== undefined && product.price !== null && Number(product.price) > 0 && formattedPriceStr !== 'GH₵0' && formattedPriceStr !== 'GHS 0';
                    const priceText = hasPrice ? ` for *${formattedPriceStr}*` : '';
                    const text = `Check out *${product.title}*${priceText} on TedBuy!\n\nView here: ${shareUrl}`;
                    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
                    setIsShareModalOpen(false);
                    showToast?.("Opening WhatsApp...", "success");
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl border border-emerald-150 bg-emerald-50/30 hover:bg-emerald-50 text-emerald-800 hover:text-emerald-900 font-bold text-xs transition duration-150 cursor-pointer"
                >
                  <span className="text-lg">💬</span>
                  <span className="flex-1 text-left">Share to WhatsApp</span>
                </button>

                {/* Telegram */}
                <button
                  onClick={() => {
                    const shareUrl = modalShareUrl;
                    const isService = product ? (product.category === 'Services' || product.category?.toLowerCase() === 'services' || product.category?.toLowerCase().includes('service')) : false;
                    const formattedPriceStr = formatPrice(product.price);
                    const hasPrice = !isService && product.price !== undefined && product.price !== null && Number(product.price) > 0 && formattedPriceStr !== 'GH₵0' && formattedPriceStr !== 'GHS 0';
                    const priceText = hasPrice ? ` for ${formattedPriceStr}` : '';
                    const text = `Check out ${product.title}${priceText} on TedBuy!`;
                    window.open(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
                    setIsShareModalOpen(false);
                    showToast?.("Opening Telegram...", "success");
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
                        const shareUrl = modalShareUrl;
                        const isService = product ? (product.category === 'Services' || product.category?.toLowerCase() === 'services' || product.category?.toLowerCase().includes('service')) : false;
                        const formattedPriceStr = formatPrice(product.price);
                        const hasPrice = !isService && product.price !== undefined && product.price !== null && Number(product.price) > 0 && formattedPriceStr !== 'GH₵0' && formattedPriceStr !== 'GHS 0';
                        const priceText = hasPrice ? ` for ${formattedPriceStr}` : '';
                        await navigator.share({
                          title: product.title,
                          text: `Check out ${product.title}${priceText} on TedBuy!`,
                          url: shareUrl
                        });
                        setIsShareModalOpen(false);
                        showToast?.("Shared successfully!", "success");
                      } catch (err: any) {
                        if (err && err.name !== 'AbortError') {
                          showToast?.("Error sharing: " + err.message, "error");
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
                      const shareUrl = modalShareUrl;
                      await navigator.clipboard.writeText(shareUrl);
                      showToast?.("Link copied to clipboard! Paste it anywhere.", "success");
                      setIsShareModalOpen(false);
                    } catch (err) {
                      showToast?.("Failed to copy link.", "error");
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
    </div>
  );
};

export interface VideoFeedItem {
  feedKey: string;
  product: Product;
}

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
  // Tracks the "scroll to watch ads" hint's visibility. A ref (not just state)
  // is needed because the scroll handler below is set up once per mount and
  // would otherwise read a stale value of hasScrolledOnce from its closure.
  const hasScrolledOnceRef = useRef(false);

  const [feedItems, setFeedItems] = useState<VideoFeedItem[]>([]);
  const [isLoadingBatch, setIsLoadingBatch] = useState<boolean>(false);
  const [batchCount, setBatchCount] = useState<number>(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hasScrolledOnce, setHasScrolledOnce] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [contactingProduct, setContactingProduct] = useState<Product | null>(null);

  const isFetchingRef = useRef<boolean>(false);
  const seenProductIdsRef = useRef<Set<string>>(new Set());
  const initialLoadedRef = useRef<boolean>(false);

  // Helper to extract active video products from global products array
  const getLocalVideoProducts = useCallback((): Product[] => {
    return products.filter(p => {
      if (!p || p.isDeleted || p.status === 'hidden' || p.status === 'archived' || p.isSold) return false;
      const vids = Array.isArray(p.videos) ? p.videos : (Array.isArray((p as any).videoUrls) ? (p as any).videoUrls : []);
      const imgs = Array.isArray(p.images) ? p.images : [];
      return vids.some((v: any) => isVideoAsset(v)) || imgs.some((img: any) => isVideoAsset(img));
    });
  }, [products]);

  // Load next dynamic batch of 5 products in non-fixed / shuffled order
  const loadNextBatch = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsLoadingBatch(true);

    try {
      const BATCH_SIZE = 5;
      let fetchedBatch: Product[] = [];

      // 1. Try fetching a fresh dynamic batch of 5 from backend API with excluded recent IDs
      try {
        const recentSeen = Array.from(seenProductIdsRef.current).slice(-30).join(',');
        const res = await fetch(`/api/video-ads?limit=${BATCH_SIZE}&exclude=${encodeURIComponent(recentSeen)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.products) && data.products.length > 0) {
            fetchedBatch = data.products;
          }
        }
      } catch (apiErr) {
        console.warn('[VideoAdsFeed] API /api/video-ads fetch error, relying on local pool:', apiErr);
      }

      // 2. Pool with local products
      const localPool = getLocalVideoProducts();
      const combinedMap = new Map<string, Product>();
      localPool.forEach(p => combinedMap.set(p.id, p));
      fetchedBatch.forEach(p => combinedMap.set(p.id, p));
      const fullPool = Array.from(combinedMap.values());

      if (fullPool.length === 0) {
        setIsLoadingBatch(false);
        isFetchingRef.current = false;
        return;
      }

      // 3. Assemble dynamic batch of 5 in non-ordered / shuffled manner
      const newBatchProducts: Product[] = [];

      // A. Add unseen products from fetchedBatch
      for (const p of fetchedBatch) {
        if (newBatchProducts.length < BATCH_SIZE && !seenProductIdsRef.current.has(p.id)) {
          newBatchProducts.push(p);
          seenProductIdsRef.current.add(p.id);
        }
      }

      // B. If still need items, take unseen items from fullPool with dynamic Fisher-Yates shuffle
      if (newBatchProducts.length < BATCH_SIZE) {
        const unseenCandidates = fullPool.filter(p => !seenProductIdsRef.current.has(p.id));
        const shuffledUnseen = [...unseenCandidates];
        for (let i = shuffledUnseen.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const temp = shuffledUnseen[i];
          shuffledUnseen[i] = shuffledUnseen[j];
          shuffledUnseen[j] = temp;
        }

        for (const p of shuffledUnseen) {
          if (newBatchProducts.length < BATCH_SIZE) {
            newBatchProducts.push(p);
            seenProductIdsRef.current.add(p.id);
          }
        }
      }

      // C. If unseen items are exhausted, dynamically sample/shuffle from fullPool
      // (avoiding consecutive back-to-back duplicate product IDs)
      if (newBatchProducts.length < BATCH_SIZE && fullPool.length > 0) {
        const shuffledPool = [...fullPool];
        for (let i = shuffledPool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const temp = shuffledPool[i];
          shuffledPool[i] = shuffledPool[j];
          shuffledPool[j] = temp;
        }

        let poolCursor = 0;
        let attempts = 0;
        while (newBatchProducts.length < BATCH_SIZE && attempts < 30) {
          attempts++;
          const candidate = shuffledPool[poolCursor % shuffledPool.length];
          const lastProd = newBatchProducts[newBatchProducts.length - 1] || feedItems[feedItems.length - 1]?.product;
          
          if (fullPool.length === 1 || !lastProd || candidate.id !== lastProd.id) {
            newBatchProducts.push(candidate);
          }
          poolCursor++;
        }
      }

      // 4. Append the 5 items to feedItems with unique keys
      if (newBatchProducts.length > 0) {
        setBatchCount(prevBatch => {
          const nextBatchNum = prevBatch + 1;
          const newItems: VideoFeedItem[] = newBatchProducts.map((product, idx) => ({
            feedKey: `${product.id}_b${nextBatchNum}_i${idx}_${Math.random().toString(36).substring(2, 7)}`,
            product
          }));

          setFeedItems(prev => [...prev, ...newItems]);
          return nextBatchNum;
        });
      }

      // Proactively fetch more global products in background if hasMoreProducts
      if (hasMoreProducts && !isProductsLoading) {
        loadMoreProducts();
      }
    } catch (err) {
      console.error('[VideoAdsFeed] Error in loadNextBatch:', err);
    } finally {
      setIsLoadingBatch(false);
      isFetchingRef.current = false;
    }
  }, [feedItems, getLocalVideoProducts, hasMoreProducts, isProductsLoading, loadMoreProducts]);

  // Initial load effect
  useEffect(() => {
    if (!initialLoadedRef.current) {
      initialLoadedRef.current = true;
      loadNextBatch();
    } else if (feedItems.length === 0 && products.length > 0 && !isFetchingRef.current) {
      loadNextBatch();
    }
  }, [loadNextBatch, feedItems.length, products.length]);

  // Global user interaction listener to guarantee unmuted audio on mobile & web browsers
  useEffect(() => {
    const unlockAudio = () => {
      setIsMuted(false);
    };
    window.addEventListener('click', unlockAudio, { capture: true, passive: true });
    window.addEventListener('touchstart', unlockAudio, { capture: true, passive: true });
    window.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true });
    window.addEventListener('scroll', unlockAudio, { capture: true, passive: true });

    return () => {
      window.removeEventListener('click', unlockAudio, { capture: true });
      window.removeEventListener('touchstart', unlockAudio, { capture: true });
      window.removeEventListener('pointerdown', unlockAudio, { capture: true });
      window.removeEventListener('scroll', unlockAudio, { capture: true });
    };
  }, []);

  // Sync scroll positioning & trigger next batch when approaching end of feed
  useEffect(() => {
    const container = feedScrollContainerRef.current;
    if (!container || feedItems.length === 0) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const key = entry.target.getAttribute('data-feed-key');
          if (key) {
            const idx = feedItems.findIndex(item => item.feedKey === key);
            if (idx !== -1) {
              setActiveIndex(idx);

              // Automatically fetch next batch of 5 when user reaches the 2nd to last item!
              if (idx >= feedItems.length - 2 && !isFetchingRef.current) {
                loadNextBatch();
              }
            }
          }
        }
      });
    }, {
      root: container,
      threshold: 0.65, // Active video is centered and occupies at least 65% of the viewport height
    });

    feedItems.forEach(item => {
      const el = productRefs.current[item.feedKey];
      if (el) {
        observer.observe(el);
      }
    });

    return () => {
      observer.disconnect();
    };
  }, [feedItems, loadNextBatch]);

  // Proactive TikTok-style video preloader:
  // Automatically downloads and caches in CacheStorage all past watched videos (up to activeIndex)
  // as well as the next 4 upcoming videos, so scrolling back up or going offline guarantees instant playback.
  useEffect(() => {
    if (feedItems.length === 0) return;

    const urlsToPreload: string[] = [];
    const startIndex = Math.max(0, activeIndex - 15);
    const endIndex = Math.min(feedItems.length - 1, activeIndex + 4);

    for (let i = startIndex; i <= endIndex; i++) {
      const vid = feedItems[i]?.product?.videos?.[0];
      if (vid) {
        urlsToPreload.push(vid);
      }
    }

    if (urlsToPreload.length > 0) {
      preloadVideoBatch(urlsToPreload);
    }
  }, [activeIndex, feedItems]);

  // Scroll listener to toggle bottom navigation & trigger infinite scroll when near bottom
  useEffect(() => {
    const container = feedScrollContainerRef.current;
    if (!container) return;

    let lastScrollTop = container.scrollTop;
    let ticking = false;

    const handleScroll = () => {
      if (!hasScrolledOnceRef.current) {
        hasScrolledOnceRef.current = true;
        setHasScrolledOnce(true);
      }

      if (!ticking) {
        window.requestAnimationFrame(() => {
          const currentScrollTop = container.scrollTop;
          const diff = currentScrollTop - lastScrollTop;
          
          // Threshold of 10px scroll to prevent jittering
          if (Math.abs(diff) > 10) {
            if (diff > 0) {
              // Scrolling down the feed -> Hide navigation immediately
              hideBottomNavImmediately(setIsBottomNavVisible);
            } else {
              // Scrolling up the feed -> Show navigation with 2.5 second auto-hide
              showBottomNavWith2_5SecAutoHide(setIsBottomNavVisible);
            }
          }

          // Near bottom trigger (within 400px of bottom)
          if (container.scrollHeight - (currentScrollTop + container.clientHeight) < 400) {
            if (!isFetchingRef.current) {
              loadNextBatch();
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
  }, [setIsBottomNavVisible, loadNextBatch]);

  // Always reset bottom nav to visible and clear active timers when leaving/unmounting the video feed
  useEffect(() => {
    showBottomNavWith2_5SecAutoHide(setIsBottomNavVisible);

    return () => {
      if (globalBottomNavTimeout) {
        clearTimeout(globalBottomNavTimeout);
        globalBottomNavTimeout = null;
      }
      setIsBottomNavVisible(true);
    };
  }, [setIsBottomNavVisible]);

  const scrollToItem = (idx: number) => {
    const item = feedItems[idx];
    if (item) {
      const el = productRefs.current[item.feedKey];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  const handleNext = () => {
    if (feedItems.length === 0) return;
    const nextIdx = activeIndex + 1;
    if (nextIdx >= feedItems.length) {
      loadNextBatch();
    } else {
      setActiveIndex(nextIdx);
      scrollToItem(nextIdx);
    }
  };

  const handlePrev = () => {
    if (feedItems.length === 0) return;
    const prevIdx = Math.max(0, activeIndex - 1);
    setActiveIndex(prevIdx);
    scrollToItem(prevIdx);
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

  if (feedItems.length === 0 && !isLoadingBatch) {
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
        {/* Modern "Scroll to watch ads" top overlay indicator — shown only until the
            user's first scroll in this session of the video feed; reappears if they
            leave and come back since the component remounts fresh each time. */}
        {!hasScrolledOnce && (
          <div className="absolute top-4 left-4 z-30 flex items-center gap-2 bg-black/75 backdrop-blur-md border border-white/10 px-3.5 py-1.5 rounded-full shadow-2xl pointer-events-none select-none">
            <div className="flex items-center justify-center bg-[#FFFC00] text-slate-950 rounded-full p-0.5 animate-bounce">
              <ChevronDown className="w-3.5 h-3.5 stroke-[3]" />
            </div>
            <span className="text-[10px] font-black tracking-widest text-[#FFFC00] font-sans uppercase">
              Scroll to watch ads
            </span>
            {isLoadingBatch && (
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping ml-1" title="Fetching batch" />
            )}
          </div>
        )}

        {/* Scrollable scroll-snap container */}
        <div 
          ref={feedScrollContainerRef}
          className="w-full h-full overflow-y-auto snap-y snap-mandatory scroll-smooth flex flex-col items-center gap-0 scrollbar-none"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {feedItems.map((item, idx) => {
            const { product, feedKey } = item;
            const isSaved = currentUser?.savedProductIds?.includes(product.id) || false;
 
            return (
              <div 
                key={feedKey}
                ref={el => { productRefs.current[feedKey] = el; }}
                data-feed-key={feedKey}
                data-product-id={product.id}
                className="w-full h-full snap-center shrink-0 flex items-center justify-center p-0"
              >
                <ReelItem
                  product={product}
                  isActive={activeIndex === idx}
                  // TikTok-like retention window:
                  // Keep at least 15 previous videos + current + 3 ahead mounted and cached,
                  // so scrolling back up plays instantly even when internet is completely disconnected!
                  shouldLoad={
                    idx >= activeIndex - 15 && idx <= activeIndex + 3
                  }
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

          {/* Dynamic Batch Loading Indicator */}
          {isLoadingBatch && (
            <div className="w-full py-8 flex items-center justify-center gap-2.5 text-slate-300 snap-center">
              <div className="w-4 h-4 border-2 border-[#FFFC00] border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-black tracking-wide uppercase text-[#FFFC00]">Loading..</span>
            </div>
          )}
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
