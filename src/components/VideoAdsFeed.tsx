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
  Plus
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [processedVideoUrl, setProcessedVideoUrl] = useState<string>('');
  const activeBlobUrlRef = useRef<string>('');

  // States for user engagements
  const [isLiked, setIsLiked] = useState<boolean>(() => {
    try {
      const likedList = JSON.parse(localStorage.getItem('user_video_likes') || '[]');
      return likedList.includes(product?.id || '');
    } catch {
      return false;
    }
  });
  const [showBigHeart, setShowBigHeart] = useState<boolean>(false);
  const [bigHeartCoords, setBigHeartCoords] = useState({ x: 0, y: 0 });
  const lastClickTimeRef = useRef<number>(0);

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

  useEffect(() => {
    try {
      const likedList = JSON.parse(localStorage.getItem('user_video_likes') || '[]');
      setIsLiked(likedList.includes(product?.id || ''));
    } catch {
      setIsLiked(false);
    }
  }, [product?.id]);

  const { 
    updateProduct, 
    setCurrentView, 
    setSelectedSellerId,
    currentUser,
    setAuthMode,
    setShowAuthModal,
    followSeller
  } = useApp();

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

  const handleToggleLike = async (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    if (!currentUser) {
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    const nextLiked = !isLiked;
    setIsLiked(nextLiked);

    try {
      const likedList = JSON.parse(localStorage.getItem('user_video_likes') || '[]');
      let updated: string[];
      if (nextLiked) {
        updated = Array.from(new Set([...likedList, product.id]));
      } else {
        updated = likedList.filter((id: string) => id !== product.id);
      }
      localStorage.setItem('user_video_likes', JSON.stringify(updated));

      const currentLikes = product.likesCount || 0;
      const nextLikesCount = nextLiked ? currentLikes + 1 : Math.max(0, currentLikes - 1);
      await updateProduct(product.id, { likesCount: nextLikesCount });
    } catch (err) {
      console.warn("localStorage or likesCount update error", err);
    }
  };

  const likesCount = product.likesCount || (isLiked ? 1 : 0);

  const currentVideoUrl = product?.videos?.[0] || '';

  // Safe synchronous data-URI/base64-to-blob-url decoder with active-unload garbage collection
  useEffect(() => {
    if (!shouldLoad) {
      setProcessedVideoUrl('');
      const prevBlobUrl = activeBlobUrlRef.current;
      if (prevBlobUrl && prevBlobUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(prevBlobUrl);
        } catch (e) {
          console.warn("[ReelItem] Revoking blob failed on unload", e);
        }
        activeBlobUrlRef.current = '';
      }
      return;
    }

    if (!currentVideoUrl) {
      setProcessedVideoUrl('');
      return;
    }

    if (!currentVideoUrl.startsWith('data:')) {
      setProcessedVideoUrl(currentVideoUrl);
      return;
    }

    // Reuse existing URL if registered to prevent duplicate builds
    if (activeBlobUrlRef.current) {
      setProcessedVideoUrl(activeBlobUrlRef.current);
      return;
    }

    const bUrl = base64ToBlobUrl(currentVideoUrl, 'video/mp4');
    activeBlobUrlRef.current = bUrl;
    setProcessedVideoUrl(bUrl);
  }, [currentVideoUrl, shouldLoad]);

  // Clean up blob URL on final Component unmount
  useEffect(() => {
    return () => {
      const finalBlob = activeBlobUrlRef.current;
      if (finalBlob && finalBlob.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(finalBlob);
        } catch (e) {
          // Ignore
        }
      }
    };
  }, []);

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
      if (video.readyState >= 2) {
        attemptPlay();
      } else {
        const handleCanPlay = () => {
          if (video) {
            video.removeEventListener('canplay', handleCanPlay);
          }
          attemptPlay();
        };
        video.addEventListener('canplay', handleCanPlay);
        return () => {
          if (video) {
            video.removeEventListener('canplay', handleCanPlay);
          }
          isCurrent = false;
        };
      }
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

    const now = Date.now();
    const prev = lastClickTimeRef.current;
    lastClickTimeRef.current = now;

    if (now - prev < 300) {
      e.preventDefault();
      if (!currentUser) {
        setAuthMode('login');
        setShowAuthModal(true);
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      setBigHeartCoords({ x: clickX, y: clickY });
      setShowBigHeart(false);
      setTimeout(() => {
        setShowBigHeart(true);
      }, 5);

      if (!isLiked) {
        handleToggleLike();
      }
    } else {
      handlePlayPause();
    }
  };

  return (
    <div ref={containerRef} className="flex items-center justify-center w-full px-2 py-3 select-none">
      {/* Immersive Aspect locked video player container with Snapchat Reels proportions */}
      <div 
        onClick={handleVideoContainerClick}
        onMouseMove={resetControlsTimeout}
        onTouchStart={resetControlsTimeout}
        onMouseEnter={resetControlsTimeout}
        className="relative aspect-[9/16] w-full max-w-[320px] sm:max-w-[340px] md:max-w-[360px] h-[550px] sm:h-[600px] md:h-[640px] bg-slate-950 rounded-[2.5rem] overflow-hidden shadow-[0_25px_60px_-15px_rgba(0,0,0,0.85)] border border-white/10 group cursor-pointer flex items-center justify-center shrink-0 transition-transform duration-300 hover:scale-[1.01]"
      >
        {!shouldLoad ? (
          <div className="text-center p-6 text-slate-500">
            <Video className="w-14 h-14 mx-auto stroke-[1] text-emerald-500/80 mb-3 animate-pulse" />
            <p className="text-[11px] font-mono font-black text-slate-400 uppercase tracking-widest">Tap to load showcase</p>
          </div>
        ) : !processedVideoUrl ? (
          <div className="text-center p-6 text-slate-500">
            {currentVideoUrl ? (
              <>
                <Video className="w-14 h-14 mx-auto stroke-[1.2] text-emerald-400 mb-3 animate-spin" />
                <p className="text-[11px] font-mono font-black text-slate-400 uppercase tracking-widest">Initializing high-res stream...</p>
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
            loop
            muted={isMuted}
            playsInline
            webkit-playsinline="true"
            preload="auto"
            className="w-full h-full object-cover animate-fade-in select-none"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onDurationChange={handleLoadedMetadata}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
        )}

        {/* Snapchat Floating Header HUD */}
        <div className="absolute top-4 inset-x-4 flex items-center justify-end z-30 pointer-events-none">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMuteToggle(e);
            }}
            className="w-9 h-9 rounded-full bg-black/60 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white hover:bg-black/85 transition-all cursor-pointer pointer-events-auto shadow-lg"
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? (
              <VolumeX className="w-4 h-4 text-rose-400 stroke-[1.8]" />
            ) : (
              <Volume2 className="w-4 h-4 text-emerald-400 animate-pulse stroke-[1.8]" />
            )}
          </button>
        </div>

        {/* Floating Heart Burst Overlay on Double-Tap */}
        <AnimatePresence>
          {showBigHeart && (
            <motion.div
              initial={{ scale: 0, opacity: 0, rotate: -25 }}
              animate={{ 
                scale: [0, 1.5, 0.85, 1.2, 1], 
                opacity: [0, 1, 1, 0.8, 0], 
                y: -50,
                rotate: [-25, -5, -15]
              }}
              exit={{ opacity: 0, scale: 0 }}
              transition={{ duration: 0.65, ease: "easeOut" }}
              style={{
                position: 'absolute',
                left: bigHeartCoords.x - 40,
                top: bigHeartCoords.y - 40,
                zIndex: 40,
                pointerEvents: 'none'
              }}
              className="text-white drop-shadow-[0_15px_30px_rgba(244,63,94,0.85)]"
            >
              <Heart className="w-20 h-20 fill-rose-500 text-rose-500 stroke-[1]" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Playback overlay control status indicator (when paused) */}
        {!isPlaying && (
          <div className="absolute inset-0 z-20 bg-black/40 flex items-center justify-center pointer-events-none animate-fade-in">
            <div className="p-4 rounded-full bg-black/70 backdrop-blur-md border border-white/15 scale-110 transition-all shadow-2xl">
              <Play className="w-8 h-8 text-emerald-400 fill-emerald-400" />
            </div>
          </div>
        )}

        {/* Immersive bottom text details overlay */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/100 via-black/60 to-transparent p-4 pb-8 text-left z-20 flex flex-col justify-end pointer-events-none">
          <div className="space-y-2 pointer-events-auto max-w-[70%]">
            <span className="px-2 py-0.5 bg-emerald-500 text-white text-[9px] font-black rounded-md tracking-wider uppercase inline-flex items-center gap-1 shadow-sm">
              <Tag className="w-2.5 h-2.5" />
              {product?.category}
            </span>
            
            <h3 className="text-sm sm:text-base font-black text-white leading-tight truncate drop-shadow-md">{product?.title}</h3>
            
            <div className="flex items-center gap-2">
              <p className="text-base font-black text-emerald-400 drop-shadow-sm">{formatPrice(product?.price)}</p>
              <div className="text-[9px] font-extrabold text-slate-300 flex items-center gap-0.5 bg-white/10 backdrop-blur-md px-1.5 py-0.5 rounded-full border border-white/5">
                <MapPin className="w-2.5 h-2.5 text-emerald-400" />
                <span className="truncate max-w-[80px]">{product?.location}</span>
              </div>
            </div>

            {product?.description && (
              <p className="text-[10px] text-slate-200 line-clamp-2 leading-relaxed font-sans font-medium drop-shadow-sm">
                {product.description}
              </p>
            )}

            <div className="flex items-center gap-1.5 pt-1">
              <span 
                onClick={handleSellerClick}
                className="text-[11px] font-bold text-white hover:underline cursor-pointer drop-shadow-md"
              >
                @{product?.sellerName}
              </span>
            </div>
          </div>
        </div>

        {/* Glassmorphic Snapchat-style floating action buttons on the right edge */}
        <div className="absolute right-4 bottom-14 flex flex-col gap-4 z-30 items-center pointer-events-auto">
          {/* Seller Avatar Badge with status */}
          <div 
            onClick={handleSellerClick}
            className="relative group/avatar cursor-pointer"
          >
            {product?.sellerPhoto && !product.sellerPhoto.includes('1549399542-7e3f8b79c341') ? (
              <img 
                src={product.sellerPhoto} 
                alt="" 
                className="w-11 h-11 rounded-full border-2 border-emerald-400 object-cover shadow-xl transition-transform hover:scale-105 duration-200" 
              />
            ) : (
              <div className="w-11 h-11 rounded-full border-2 border-emerald-400 bg-slate-800 text-slate-100 flex items-center justify-center font-black text-xs shadow-xl transition-transform hover:scale-105 duration-200 uppercase whitespace-nowrap">
                {product?.sellerName ? product.sellerName.substring(0, 2) : 'U'}
              </div>
            )}
            
            {/* Animated Follow Plus button overlay */}
            <AnimatePresence>
              {!isOwnProfile && !isFollowing && (
                <motion.button
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={handleFollowClick}
                  className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white border border-slate-950 rounded-full w-4.5 h-4.5 flex items-center justify-center shadow-lg transition-all duration-150 z-20 cursor-pointer outline-none select-none"
                  title={`Follow ${product?.sellerName}`}
                >
                  <Plus className="w-2.5 h-2.5 text-white stroke-[3.5]" />
                </motion.button>
              )}
            </AnimatePresence>

            {isSellerVerified && (
              <div className="absolute -bottom-1 -right-1 bg-emerald-500 rounded-full p-0.5 border border-slate-950 shadow-md">
                <CheckCircle className="w-2.5 h-2.5 text-white fill-white" />
              </div>
            )}
          </div>

          {/* Double tap heart icon widget */}
          <div className="flex flex-col items-center">
            <button
              onClick={() => handleToggleLike()}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl ${
                isLiked 
                  ? 'bg-rose-500 text-white scale-110 shadow-rose-500/20' 
                  : 'bg-black/55 backdrop-blur-xl text-white border border-white/10 hover:bg-black/75 hover:scale-105'
              }`}
            >
              <motion.div
                animate={isLiked ? { scale: [1, 1.4, 0.9, 1.15, 1], rotate: [0, -10, 10, 0] } : { scale: 1, rotate: 0 }}
                transition={{ duration: 0.4 }}
              >
                <Heart className={`w-5 h-5 ${isLiked ? 'fill-white text-white stroke-[1.5]' : 'text-white'}`} />
              </motion.div>
            </button>
            <span className="text-[10px] font-black text-white mt-1 drop-shadow-md select-none">
              {likesCount}
            </span>
          </div>

          {/* Bookmarks widget */}
          <div className="flex flex-col items-center">
            <button
              onClick={onSaveClick}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl ${
                isSaved 
                  ? 'bg-amber-500 text-white scale-110 shadow-amber-505/20' 
                  : 'bg-black/55 backdrop-blur-xl text-white border border-white/10 hover:bg-black/75 hover:scale-105'
              }`}
            >
              <Bookmark className={`w-5 h-5 ${isSaved ? 'fill-white text-white' : 'text-white'}`} />
            </button>
            <span className="text-[10px] font-black text-white mt-1 drop-shadow-md select-none">
              {isSaved ? 'Saved' : 'Save'}
            </span>
          </div>

          {/* Direct chat with seller WhatsApp indicator */}
          <div className="flex flex-col items-center">
            <button
              onClick={onMessageSeller}
              className="w-11 h-11 rounded-full bg-emerald-500 text-white flex items-center justify-center transition-all duration-300 shadow-xl hover:bg-emerald-400 hover:scale-110 active:scale-95 shadow-emerald-500/10"
            >
              <MessageSquare className="w-5 h-5 text-white fill-white" />
            </button>
            <span className="text-[10px] font-black text-white mt-1 drop-shadow-md select-none">
              Chat
            </span>
          </div>

          {/* Details / Full Ad presentation */}
          <div className="flex flex-col items-center">
            <button
              onClick={() => onViewFullAd(product.id)}
              className="w-11 h-11 rounded-full bg-white text-slate-950 flex items-center justify-center transition-all duration-300 shadow-2xl hover:bg-slate-100 hover:scale-110 active:scale-95"
            >
              <Maximize2 className="w-4.5 h-4.5 text-slate-950 stroke-[2.2]" />
            </button>
            <span className="text-[10px] font-black text-white mt-1 tracking-wide drop-shadow-md select-none">
              View
            </span>
          </div>
        </div>

        {/* Minimalist interactive seeking timeline at the absolute bottom edge */}
        <div className="absolute bottom-0 inset-x-0 h-1.5 bg-black/45 z-30 pointer-events-auto flex items-end">
          <input
            type="range"
            min="0"
            max={duration || 10}
            step="0.01"
            value={currentTime}
            onChange={handleSeekChange}
            onClick={(e) => e.stopPropagation()}
            className="w-full accent-emerald-500 hover:accent-emerald-400 h-1 bg-white/20 appearance-none cursor-pointer transition-all outline-none"
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
    startChat
  } = useApp();

  const feedScrollContainerRef = useRef<HTMLDivElement>(null);
  const productRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  const videoProducts = useMemo(() => {
    return products.filter(p => p.videos && p.videos.length > 0);
  }, [products]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(1);

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
      threshold: 0.55, // 55% visible is the active reel in focus
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
    <div className="min-h-[600px] lg:h-[680px] w-full border border-slate-200 bg-slate-950 rounded-3xl overflow-hidden shadow-xl flex flex-col lg:flex-row text-white mt-4">
      {/* 2. Left side navigation list of video showcases */}
      <div className="lg:w-80 border-b lg:border-b-0 lg:border-r border-slate-800 bg-slate-900 p-4 flex flex-col h-full overflow-hidden shrink-0">
        <div className="mb-4 text-left">
          <h3 className="text-sm font-black text-white mt-1">Watch Buyer Showcases</h3>
          <p className="text-[10px] text-slate-400 mt-0.5">Click to switch or scroll between video demonstrations</p>
        </div>

        {/* Scroll list */}
        <div className="flex flex-row lg:flex-col gap-3 overflow-x-auto lg:overflow-y-auto pb-2 lg:pb-0 scrollbar-thin scrollbar-thumb-slate-800 flex-1 select-none">
          {videoProducts.map((p, idx) => {
            const isSelected = activeIndex === idx;
            const priceText = formatPrice(p.price);
            
            return (
              <button
                key={p.id}
                onClick={() => {
                  setActiveIndex(idx);
                  scrollToProduct(idx);
                }}
                className={`text-left flex items-center gap-3 p-2 rounded-xl border transition-all shrink-0 w-60 lg:w-full cursor-pointer select-none outline-none ${
                  isSelected 
                    ? 'bg-slate-800 border-slate-750 shadow-md ring-1 ring-emerald-500' 
                    : 'bg-slate-950/40 border-slate-900 hover:bg-slate-800/25 hover:border-slate-800'
                }`}
              >
                {/* Visual Thumbnail */}
                <div className="w-10 h-10 rounded-lg bg-slate-900 border border-slate-800 relative flex items-center justify-center overflow-hidden shrink-0">
                  {p.images && p.images.length > 0 ? (
                    <img src={p.images[0]} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Video className="w-4 h-4 text-slate-500" />
                  )}
                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                    <Play className="w-2.5 h-2.5 text-white fill-white" />
                  </div>
                </div>

                <div className="min-w-0 flex-1 text-left">
                  <p className="text-[11px] font-bold text-white truncate leading-snug">{p.title}</p>
                  <p className="text-[10px] font-black text-emerald-400 mt-0.5">{priceText}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 1. Immersive vertical center-aligned Reels viewport container */}
      <div className="flex-1 relative bg-slate-950 flex flex-col justify-start overflow-hidden">
        {/* Scrollable scroll-snap container */}
        <div 
          ref={feedScrollContainerRef}
          className="w-full h-full overflow-y-auto snap-y snap-mandatory scroll-smooth py-6 flex flex-col items-center gap-12 scrollbar-none"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {videoProducts.map((product, idx) => {
            const isSaved = currentUser?.savedProductIds?.includes(product.id) || false;

            return (
              <div 
                key={product.id}
                ref={el => { productRefs.current[product.id] = el; }}
                data-product-id={product.id}
                className="w-full snap-center shrink-0 flex items-center justify-center"
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
                    try {
                      startChat(product.id, "Hi, I saw your video ad! Is this item still available?");
                      setCurrentView('chats');
                    } catch (err) {
                      console.error("Failed to start chat:", err);
                    }
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

        {/* Floating absolute navigation tracker arrows */}
        <div className="absolute bottom-6 right-6 z-30 hidden md:flex items-center gap-2 bg-slate-900/90 backdrop-blur border border-slate-800 p-2 rounded-xl shadow-lg">
          <button
            onClick={handlePrev}
            className="p-1 px-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition text-[10px] font-black cursor-pointer shadow-sm border border-slate-705"
            title="Previous Video"
          >
            Prev
          </button>
          <span className="text-[10px] text-slate-300 font-mono font-black px-1 select-none">
            {activeIndex + 1} / {videoProducts.length}
          </span>
          <button
            onClick={handleNext}
            className="p-1 px-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition text-[10px] font-black cursor-pointer shadow-sm border border-slate-705"
            title="Next Video"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};
