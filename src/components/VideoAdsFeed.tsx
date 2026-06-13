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
  Heart
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

  const { updateProduct } = useApp();

  const handleToggleLike = async (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
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
    <div ref={containerRef} className="flex flex-col md:flex-row items-center justify-center gap-4 w-full px-2 max-w-lg md:max-w-2xl mx-auto py-2">
      {/* Aspect locked video player container */}
      <div 
        onClick={handleVideoContainerClick}
        onMouseMove={resetControlsTimeout}
        onTouchStart={resetControlsTimeout}
        onMouseEnter={resetControlsTimeout}
        className="relative aspect-[9/16] w-full max-w-[280px] md:max-w-[310px] h-[480px] md:h-[550px] bg-black rounded-2xl overflow-hidden shadow-2xl border border-slate-850 group cursor-pointer flex items-center justify-center shrink-0"
      >
        {!shouldLoad ? (
          <div className="text-center p-4 text-slate-500">
            <Video className="w-12 h-12 mx-auto stroke-[1.2] opacity-40 mb-2 text-emerald-500/85 animate-pulse" />
            <p className="text-[11px] font-mono font-medium text-slate-400">Tap to load showcase...</p>
          </div>
        ) : !processedVideoUrl ? (
          <div className="text-center p-4 text-slate-500">
            {currentVideoUrl ? (
              <>
                <Video className="w-12 h-12 mx-auto stroke-[1.2] opacity-40 mb-2 animate-spin text-emerald-400" />
                <p className="text-[11.5px] font-mono font-medium text-slate-400">Initializing showcase stream...</p>
              </>
            ) : (
              <>
                <Video className="w-12 h-12 mx-auto stroke-[1.2] opacity-40 mb-2" />
                <p className="text-xs font-mono">No video found</p>
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
            preload="auto"
            className="w-full h-full object-cover animate-fade-in"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onDurationChange={handleLoadedMetadata}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
        )}

        {/* Floating Heart Burst Overlay on Double-Tap */}
        <AnimatePresence>
          {showBigHeart && (
            <motion.div
              initial={{ scale: 0, opacity: 0, rotate: -25 }}
              animate={{ 
                scale: [0, 1.4, 0.85, 1.15, 1], 
                opacity: [0, 1, 1, 0.8, 0], 
                y: -45,
                rotate: [-25, -10, -15]
              }}
              exit={{ opacity: 0, scale: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              style={{
                position: 'absolute',
                left: bigHeartCoords.x - 32, // (64 width / 2)
                top: bigHeartCoords.y - 32, // (64 height / 2)
                zIndex: 40,
                pointerEvents: 'none'
              }}
              className="text-white drop-shadow-[0_12px_20px_rgba(244,63,94,0.65)]"
            >
              <Heart className="w-16 h-16 fill-rose-500 text-rose-500 stroke-[1.5]" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Playback overlay control status indicator */}
        {!isPlaying && (
          <div className="absolute inset-0 z-20 bg-black/30 flex items-center justify-center pointer-events-none animate-fade-in">
            <div className="p-4 rounded-full bg-slate-900/80 backdrop-blur-sm border border-slate-800 scale-105 transition-all">
              <Play className="w-6 h-6 text-white fill-white" />
            </div>
          </div>
        )}

        {/* Overlay Details Card */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/80 to-transparent p-4 text-left z-20 flex flex-col justify-end pointer-events-none">
          <div className="space-y-1.5 pointer-events-auto">
            <span className="px-2 py-0.5 bg-emerald-600 text-white text-[9px] font-black rounded-md tracking-wider uppercase inline-flex items-center gap-1">
              <Tag className="w-2.5 h-2.5" />
              {product?.category}
            </span>
            
            <h3 className="text-sm font-black text-white leading-tight truncate">{product?.title}</h3>
            
            <div className="flex items-center justify-between">
              <p className="text-sm font-black text-emerald-400">{formatPrice(product?.price)}</p>
              <p className="text-[9px] text-slate-350 flex items-center gap-0.5">
                <MapPin className="w-2.5 h-2.5 text-slate-400" />
                <span className="truncate max-w-[100px]">{product?.location}</span>
              </p>
            </div>

            {product?.description && (
              <p className="text-[10px] text-slate-300 line-clamp-2 leading-tight font-sans font-medium">
                {product.description}
              </p>
            )}

            {/* Custom Interactive Video Control Overlay Panel */}
            <div 
              onClick={(e) => e.stopPropagation()}
              className={`bg-slate-900/95 backdrop-blur-md rounded-xl p-2 border border-slate-800 space-y-2 shadow-xl transition-all duration-300 transform ${
                showControls 
                  ? 'opacity-100 translate-y-0 pointer-events-auto' 
                  : 'opacity-0 translate-y-2 pointer-events-none'
              }`}
            >
              {/* Range scroller slider */}
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max={duration || 10}
                  step="0.01"
                  value={currentTime}
                  onChange={handleSeekChange}
                  className="w-full accent-emerald-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer hover:bg-slate-700 transition"
                />
              </div>

              {/* Mute and playback button HUD */}
              <div className="flex items-center justify-between text-white select-none">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePlayPause();
                    }}
                    className="p-1 rounded bg-slate-850 hover:bg-slate-800 text-white transition flex items-center justify-center cursor-pointer border border-slate-800 shadow-sm"
                    title={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? (
                      <Pause className="w-3 h-3 text-white fill-white" />
                    ) : (
                      <Play className="w-3 h-3 text-white fill-white" />
                    )}
                  </button>

                  <span className="text-[9px] font-mono leading-none font-bold text-slate-300">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>

                <div className="flex items-center gap-1 group/volume-hud">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMuteToggle(e);
                    }}
                    className="p-1 rounded bg-slate-850 hover:bg-slate-800 transition flex items-center justify-center cursor-pointer border border-slate-800 shadow-sm"
                    title={isMuted ? "Unmute" : "Mute"}
                  >
                    {isMuted ? (
                      <VolumeX className="w-3 h-3 text-slate-450" />
                    ) : (
                      <Volume2 className="w-3 h-3 text-emerald-400 animate-pulse" />
                    )}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeSliderChange}
                    className="w-10 accent-emerald-500 h-0.5 bg-slate-850 rounded-lg appearance-none cursor-pointer opacity-30 group-hover/volume-hud:opacity-100 transition-all"
                  />
                </div>
              </div>
            </div>

            {/* Profile badge details */}
            <div className="flex items-center gap-2 pt-1 border-t border-slate-900/50">
              <img 
                src={product?.sellerPhoto} 
                alt="" 
                className="w-5 h-5 rounded-full border border-slate-750 object-cover" 
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-0.5">
                  <p className="text-[9px] font-black text-white truncate leading-none">{product?.sellerName}</p>
                  {isSellerVerified && <CheckCircle className="w-2.5 h-2.5 text-emerald-400 fill-emerald-400 shrink-0" />}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating vertical sidebar action buttons */}
      <div className="flex md:flex-col gap-2.5 justify-center items-center shrink-0">
        <button
          onClick={() => handleToggleLike()}
          className={`flex flex-col items-center justify-center p-2.5 rounded-xl border transition-all duration-200 cursor-pointer w-16 h-14 ${
            isLiked 
              ? 'bg-rose-500/15 border-rose-500/40 text-rose-500 font-bold hover:bg-rose-500/25' 
              : 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white'
          }`}
        >
          <motion.div
            animate={isLiked ? { scale: [1, 1.4, 0.9, 1.15, 1], rotate: [0, -10, 10, 0] } : { scale: 1, rotate: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Heart className={`w-4 h-4 ${isLiked ? 'fill-rose-500 text-rose-500' : 'text-slate-450 hover:text-white'}`} />
          </motion.div>
          <span className="text-[9px] mt-0.5 font-black tracking-tight select-none">
            {likesCount}
          </span>
        </button>

        <button
          onClick={onSaveClick}
          className={`flex flex-col items-center justify-center p-2.5 rounded-xl border transition-all duration-200 cursor-pointer w-16 h-14 ${
            isSaved 
              ? 'bg-rose-500/15 border-rose-500/40 text-rose-500 font-bold hover:bg-rose-500/25' 
              : 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white'
          }`}
        >
          <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-rose-500' : ''}`} />
          <span className="text-[8px] mt-0.5 font-bold tracking-tight">Saved</span>
        </button>

        <button
          onClick={onMessageSeller}
          className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 hover:scale-105 active:scale-95 text-white border border-emerald-550/20 transition cursor-pointer w-16 h-14"
        >
          <MessageSquare className="w-4 h-4 text-white" />
          <span className="text-[8px] mt-0.5 font-black tracking-tight">Chat</span>
        </button>

        <button
          onClick={() => onViewFullAd(product.id)}
          className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-white hover:bg-slate-100 hover:scale-105 active:scale-95 text-slate-950 font-black transition w-16 h-14 cursor-pointer"
        >
          <Maximize2 className="w-4 h-4 text-slate-950" />
          <span className="text-[8px] mt-0.5 tracking-tight leading-none">View Ad</span>
        </button>
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
          <div className="flex items-center gap-2">
            <span className="p-1 px-2 bg-emerald-600 text-white rounded-lg text-[9px] font-black uppercase tracking-wider animate-pulse flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5" />
              <span>LIVE</span>
            </span>
          </div>
          <h3 className="text-sm font-black text-white mt-1">Watch Buyer Showcases</h3>
          <p className="text-[10px] text-slate-400 mt-0.5">Click to switch or scroll between live demonstrations</p>
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
