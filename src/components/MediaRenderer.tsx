import React, { useState } from 'react';

export interface MediaRendererProps {
  src?: string;
  alt?: string;
  className?: string;
  videoClassName?: string;
  poster?: string;
  autoPlay?: boolean;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
  playsInline?: boolean;
  objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  onLoad?: () => void;
  onError?: (e?: any) => void;
  fallback?: React.ReactNode;
}

/**
 * Intelligent Media Detection helper that determines whether a URL/data string
 * represents a video or an image asset based on Cloudinary pathing, file extensions,
 * MIME types, or video API endpoint patterns.
 */
export function isVideoAsset(url?: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const lower = url.trim().toLowerCase();

  // Data URIs
  if (lower.startsWith('data:video/')) return true;

  // File Extensions
  if (
    lower.endsWith('.mp4') ||
    lower.endsWith('.webm') ||
    lower.endsWith('.mov') ||
    lower.endsWith('.m4v') ||
    lower.endsWith('.ogg') ||
    lower.endsWith('.m3u8')
  ) {
    return true;
  }

  // Cloudinary resource paths
  if (lower.includes('/video/upload/') || lower.includes('/f_auto,q_auto/v') && lower.includes('/video/')) return true;

  // API proxy patterns
  if (lower.includes('/api/products/') && (lower.endsWith('/video.mp4') || lower.endsWith('/video'))) return true;

  return false;
}

/**
 * Unified MediaRenderer component that intelligently selects between an `<img>` tag
 * or a `<video>` tag based on file extension, MIME type, or Cloudinary URL characteristics.
 */
export const MediaRenderer: React.FC<MediaRendererProps> = ({
  src,
  alt = 'Product media asset',
  className = 'w-full h-full object-cover',
  videoClassName,
  poster,
  autoPlay = true,
  controls = false,
  loop = true,
  muted = false,
  playsInline = true,
  objectFit = 'cover',
  onLoad,
  onError,
  fallback
}) => {
  const [hasError, setHasError] = useState(false);

  React.useEffect(() => {
    setHasError(false);
  }, [src]);

  if (!src || hasError) {
    if (fallback) return <>{fallback}</>;
    return (
      <div className="w-full h-full bg-slate-100 flex items-center justify-center text-slate-400 text-xs font-medium">
        <span>No Media</span>
      </div>
    );
  }

  const isVideo = isVideoAsset(src);

  if (isVideo) {
    return (
      <video
        src={src}
        poster={poster}
        autoPlay={autoPlay}
        controls={controls}
        loop={loop}
        muted={muted}
        playsInline={playsInline}
        webkit-playsinline="true"
        disablePictureInPicture
        className={videoClassName || className}
        style={{ objectFit }}
        onError={(e) => {
          setHasError(true);
          if (onError) onError(e);
        }}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={className}
      style={{ objectFit }}
      onLoad={onLoad}
      onError={(e) => {
        setHasError(true);
        if (onError) onError(e);
      }}
    />
  );
};

export default MediaRenderer;
