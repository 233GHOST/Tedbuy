/**
 * Utility to compress images client-side using Canvas.
 * Keeps physical quality high but decreases storage footprint (under 150KB typically),
 * ensuring swift saves and prevention of Firestore document size limit errors (1MB).
 */

/**
 * Utility to compress images client-side using Canvas.
 * Keeps physical quality high but decreases storage footprint (under 150KB typically),
 * ensuring swift saves and prevention of Firestore document size limit errors (1MB).
 */
export const compressImage = async (file: File, maxWidth = 900, maxHeight = 900, quality = 0.75): Promise<string> => {
  let finalFile = file;

  // Check if file is HEIC/HEIF
  const fileNameLower = file.name.toLowerCase();
  const isHeic = fileNameLower.endsWith('.heic') || fileNameLower.endsWith('.heif') || file.type === 'image/heic' || file.type === 'image/heif';

  if (isHeic) {
    try {
      // Dynamically imported - this library is sizable and only actually needed for
      // the relatively rare case of a user uploading a HEIC/HEIF (iPhone) photo, so it
      // shouldn't be part of the main, always-loaded bundle for every visitor.
      const { default: heic2any } = await import('heic2any');
      const converted = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: quality
      });
      const blob = Array.isArray(converted) ? converted[0] : converted;
      const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
      finalFile = new File([blob], newName, { type: 'image/jpeg' });
    } catch (err) {
      console.warn('HEIC to JPEG conversion failed, trying to read directly:', err);
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Calculate new dimensions preserving aspect ratio
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(event.target?.result as string);
          return;
        }

        // Draw and compress
        ctx.drawImage(img, 0, 0, width, height);
        
        // Export to high-quality JPEG (or webp if supported)
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      
      img.onerror = (err) => {
        reject(err);
      };
      
      img.src = event.target?.result as string;
    };
    reader.onerror = (err) => {
      reject(err);
    };
    reader.readAsDataURL(finalFile);
  });
};

/**
 * Generates an optimized image URL with dynamic resizing, compression, and WebP format selection.
 * Handles both local proxy endpoints and external CDN-supported URLs (like Unsplash).
 */
export const getOptimizedImageUrl = (
  url: string,
  width?: number,
  quality: number = 80,
  format: string = 'webp'
): string => {
  if (!url) return '';

  // 1. If it is already a base64 string, return it directly as we cannot optimize base64 client-side on-the-fly easily
  if (url.startsWith('data:')) {
    return url;
  }

  // 2. Unsplash Native CDN Optimization (extremely performant, auto WebP/AVIF selection)
  if (url.includes('images.unsplash.com')) {
    let optimized = url;
    // Replace width
    if (width !== undefined) {
      if (optimized.includes('w=')) {
        optimized = optimized.replace(/([?&])w=\d+/g, `$1w=${width}`);
      } else {
        optimized += (optimized.includes('?') ? '&' : '?') + `w=${width}`;
      }
    }
    // Replace quality
    if (optimized.includes('q=')) {
      optimized = optimized.replace(/([?&])q=\d+/g, `$1q=${quality}`);
    } else {
      optimized += `&q=${quality}`;
    }
    // Set auto-format
    if (!optimized.includes('auto=')) {
      optimized += '&auto=format';
    }
    return optimized;
  }

  // 3. Local API Image Optimizer Routing (Sharp-powered on backend)
  if (url.startsWith('/api/products/')) {
    const baseUrl = url.split('?')[0];
    const params = new URLSearchParams();
    if (width !== undefined) params.set('w', String(width));
    params.set('q', String(quality));
    params.set('fmt', format);
    return `${baseUrl}?${params.toString()}`;
  }

  // 4. External URL Proxy Routing
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const params = new URLSearchParams();
    params.set('image', url);
    if (width !== undefined) params.set('w', String(width));
    params.set('q', String(quality));
    params.set('fmt', format);
    return `/api/products/optimized/image?${params.toString()}`;
  }

  return url;
};

