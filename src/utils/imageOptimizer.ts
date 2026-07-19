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

        let finalQuality = quality;
        let finalWidth = width;
        let finalHeight = height;
        let dataUrl = '';
        let pass = 0;
        
        // Target base64 length limit of 80,000 chars (~60KB binary size), preventing heavy base64 bloat in database
        const maxDataUrlLength = 80000;

        while (pass < 4) {
          const canvas = document.createElement('canvas');
          canvas.width = finalWidth;
          canvas.height = finalHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            dataUrl = event.target?.result as string;
            break;
          }

          // Draw image
          ctx.drawImage(img, 0, 0, finalWidth, finalHeight);

          // Try WebP first (about 25-30% smaller than JPEG at same quality)
          dataUrl = canvas.toDataURL('image/webp', finalQuality);
          
          // Fallback to JPEG if browser doesn't support WebP export or returns raw PNG
          if (!dataUrl.startsWith('data:image/webp') && dataUrl.startsWith('data:image/png')) {
            dataUrl = canvas.toDataURL('image/jpeg', finalQuality);
          }

          if (dataUrl.length <= maxDataUrlLength) {
            break;
          }

          // Progressive reduction: scale down dimensions by 15% and quality by 15% for next pass
          finalWidth = Math.round(finalWidth * 0.85);
          finalHeight = Math.round(finalHeight * 0.85);
          finalQuality = Math.max(0.4, finalQuality * 0.85);
          pass++;
        }

        console.log(`[Image Optimizer] Succeeded in pass ${pass + 1}. Size: ${Math.round(dataUrl.length / 1024)} KB. Dimensions: ${finalWidth}x${finalHeight}`);
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
    const [baseUrl, existingQuery] = url.split('?');
    const params = new URLSearchParams(existingQuery || '');
    // Preserve idx (which image in the gallery this is) -- only the optimization
    // params below should be overwritten, everything else from the original URL stays.
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

