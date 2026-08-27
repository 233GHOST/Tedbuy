import { Product, Category, normalizeCategory } from '../types';
import { getBoostEndDate } from './dateParser';
import { getOptimizedImageUrl } from './imageOptimizer';
import { getCloudinaryThumbnail, getCloudinaryVideoPoster } from './cloudinary';

export const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * Returns a clean SVG placeholder URL for a category
 */
export function getCategoryPlaceholder(category?: string): string {
  const cat = (category || 'Other').toLowerCase();
  let iconColor = '%233b82f6';
  if (cat.includes('phone')) iconColor = '%236366f1';
  else if (cat.includes('laptop') || cat.includes('electronic')) iconColor = '%230284c7';
  else if (cat.includes('fashion')) iconColor = '%23ec4899';
  else if (cat.includes('vehicle')) iconColor = '%23f59e0b';
  else if (cat.includes('property') || cat.includes('home')) iconColor = '%2310b981';

  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300" fill="none"><rect width="400" height="300" fill="%23f8fafc"/><path d="M160 110h80v80h-80z" fill="${iconColor}" opacity="0.15"/><circle cx="200" cy="150" r="30" fill="${iconColor}" opacity="0.3"/><text x="50%" y="85%" dominant-baseline="middle" text-anchor="middle" fill="%2394a3b8" font-family="sans-serif" font-size="14">${encodeURIComponent(category || 'TedBuy Product')}</text></svg>`;
}

/**
 * Extracts a canonical key for a media URL to deduplicate variations (e.g. Cloudinary transformation params)
 */
export function getCanonicalMediaKey(url: string): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  if (trimmed.includes('res.cloudinary.com')) {
    try {
      const parsedUrl = new URL(trimmed);
      const pathname = parsedUrl.pathname;
      const uploadIdx = pathname.indexOf('/upload/');
      if (uploadIdx !== -1) {
        const prefix = pathname.substring(0, uploadIdx + 8);
        const rest = pathname.substring(uploadIdx + 8);
        const segments = rest.split('/');
        const cleanSegments = segments.filter(seg => {
          if (!seg) return false;
          // Cloudinary transformation segments typically contain commas or transform keys like c_..., w_..., h_...
          if (seg.includes(',') || /^[a-z]{1,3}_/.test(seg)) {
            return false;
          }
          return true;
        });
        return `${parsedUrl.host}${prefix}${cleanSegments.join('/')}`;
      }
    } catch (_) {}
  }

  return trimmed.split('?')[0].replace(/\/+$/, '').toLowerCase();
}

/**
 * Deduplicates image URLs by removing Cloudinary transformation duplicates and identical strings.
 */
export function deduplicateImageUrls(urls: string[]): string[] {
  if (!Array.isArray(urls)) return [];
  const seenKeys = new Set<string>();
  const result: string[] = [];

  for (const rawUrl of urls) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) continue;
    const url = rawUrl.trim();
    if (url.includes('/api/products/') || url.startsWith('data:image/svg+xml')) continue;
    const key = getCanonicalMediaKey(url);
    if (key && !seenKeys.has(key)) {
      seenKeys.add(key);
      result.push(url);
    }
  }

  return result;
}

/**
 * Resolve the primary display image URL for any product directly.
 */
export function resolveProductImage(product?: Partial<Product> | null, width: number = 400): string {
  if (!product) return getCategoryPlaceholder('Other');
  const allImages = resolveProductImages(product, width);
  if (allImages[0]) return allImages[0];
  // Fall back to a poster frame derived from the product's video (never mixed
  // into the images gallery itself) before the generic category icon.
  // normalizeProduct() already computes this for normalized products; recompute
  // on-the-fly here only for callers passing an un-normalized product-like object.
  if (product.videoPoster) return product.videoPoster;
  if (Array.isArray(product.videos) && product.videos[0]) {
    return getCloudinaryVideoPoster(product.videos[0]);
  }
  return getCategoryPlaceholder(product.category);
}

/**
 * Resolve all valid image URLs for a product.
 */
export function resolveProductImages(product?: Partial<Product> | null, width?: number): string[] {
  if (!product) return [];

  const prod = product as any;

  // Matches the exact transform signature getCloudinaryVideoPoster() builds
  // (so_0,f_jpg,...). Excluding it here — not just via the hasVideo fallback
  // guard below — means any listing that already has one of these URLs
  // sitting in its stored images array (written before this fix existed)
  // self-heals automatically the moment this code deploys, with no need to
  // re-save each affected listing individually.
  const isVideoPosterUrl = (url: string) => url.includes('res.cloudinary.com') && url.includes('/upload/so_0,f_jpg');

  const filterValid = (arr: any[]) =>
    arr.filter(
      (img: any) =>
        typeof img === 'string' &&
        img.trim().length > 0 &&
        !img.includes('/api/products/') &&
        !img.startsWith('data:image/svg+xml') &&
        !img.includes('unsplash.com') &&
        !isVideoPosterUrl(img)
    );

  let list: string[] = [];
  if (Array.isArray(prod.images) && prod.images.length > 0) {
    list = filterValid(prod.images);
  }
  if (list.length === 0 && Array.isArray(prod.imageUrls) && prod.imageUrls.length > 0) {
    list = filterValid(prod.imageUrls);
  }

  // Only check candidate single fields if no image array was found, AND the
  // product has no video. For video listings, displayImage/primaryPicture are
  // often just an auto-derived cover frame (see getCloudinaryVideoPoster) —
  // a real, useful fallback for card/thumbnail contexts, but not a genuine
  // uploaded photo. Surfacing it here would make it appear as a second,
  // independently-swipeable gallery item alongside the video, which is
  // exactly the "phantom extra image" this function must not produce. An
  // empty gallery for a video-only listing is the correct, truthful result.
  const hasVideo = Array.isArray(prod.videos) && prod.videos.length > 0;
  if (list.length === 0 && !hasVideo) {
    const candidateSingleFields = [
      prod.displayImage,
      prod.primaryImage,
      prod.primaryPicture,
      prod.image,
      prod.thumbnailUrl
    ];

    for (const field of candidateSingleFields) {
      if (typeof field === 'string' && field.trim().length > 0 && !field.includes('/api/products/') && !field.startsWith('data:image/svg+xml') && !field.includes('unsplash.com') && !isVideoPosterUrl(field)) {
        list = [field.trim()];
        break;
      }
    }
  }

  const dedupedList = deduplicateImageUrls(list).filter(img => !img.includes('unsplash.com'));

  // Same reasoning as above: a video-only listing genuinely has zero photos,
  // and that's correct — don't pad the gallery with a placeholder icon either.
  if (dedupedList.length === 0 && !hasVideo) {
    dedupedList.push(getCategoryPlaceholder(product.category));
  }

  return dedupedList.map(img => (width && !img.startsWith('data:') ? getOptimizedImageUrl(img, width) : img));
}

/**
 * Canonical product normalization helper.
 * Standardizes to Product interface with direct Cloudinary URLs.
 */
export function normalizeProduct(rawProduct: any): Product {
  if (!rawProduct) {
    const fallbackCat = 'Other';
    const placeholder = getCategoryPlaceholder(fallbackCat);
    return {
      id: '',
      sellerId: '',
      sellerName: '',
      sellerEmail: '',
      sellerPhoto: '',
      sellerJoinDate: new Date().toISOString(),
      title: '',
      description: '',
      price: 0,
      currency: 'GHS',
      condition: 'New',
      category: fallbackCat,
      location: '',
      images: [placeholder],
      imageUrls: [placeholder],
      thumbnailUrls: [placeholder],
      thumbnailUrl: placeholder,
      displayImage: placeholder,
      primaryImage: placeholder,
      videos: [],
      videoUrls: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      views: 0,
      viewsCount: 0,
      likes: 0,
      likesCount: 0,
      status: 'active',
      boostStatus: false
    };
  }

  const id = String(rawProduct.id || '');

  // Parse images
  let rawImages: string[] = [];
  if (Array.isArray(rawProduct.images) && rawProduct.images.length > 0) {
    rawImages = rawProduct.images.filter((i: any) => typeof i === 'string' && i.trim().length > 0);
  } else if (Array.isArray(rawProduct.imageUrls) && rawProduct.imageUrls.length > 0) {
    rawImages = rawProduct.imageUrls.filter((i: any) => typeof i === 'string' && i.trim().length > 0);
  } else if (typeof rawProduct.images === 'string' && rawProduct.images.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawProduct.images);
      if (Array.isArray(parsed)) rawImages = parsed;
    } catch (_) {
      if (rawProduct.images.includes(',')) {
        rawImages = rawProduct.images.split(',').map((s: string) => s.trim());
      } else {
        rawImages = [rawProduct.images.trim()];
      }
    }
  }

  // Only check candidate single fields if rawImages is empty
  if (rawImages.length === 0) {
    const candidateSingleFields = [
      rawProduct.displayImage,
      rawProduct.primaryImage,
      rawProduct.primaryPicture,
      rawProduct.image,
      rawProduct.thumbnailUrl
    ];

    for (const field of candidateSingleFields) {
      if (typeof field === 'string' && field.trim().length > 0 && !field.startsWith('data:image/svg+xml') && !field.includes('/api/products/') && !field.includes('unsplash.com')) {
        rawImages = [field.trim()];
        break;
      }
    }
  }

  // Filter out any stale proxy URLs, unsplash URLs, or placeholder SVGs and deduplicate
  const cleanImages = deduplicateImageUrls(rawImages).filter(img => !img.includes('unsplash.com'));

  // Parse videos
  let rawVideos: string[] = [];
  if (Array.isArray(rawProduct.videoUrls)) {
    rawVideos = rawProduct.videoUrls.filter((v: any) => typeof v === 'string' && v.trim().length > 0);
  } else if (Array.isArray(rawProduct.videos)) {
    rawVideos = rawProduct.videos.filter((v: any) => typeof v === 'string' && v.trim().length > 0);
  } else if (typeof rawProduct.videos === 'string' && rawProduct.videos.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawProduct.videos);
      if (Array.isArray(parsed)) rawVideos = parsed;
    } catch (_) {
      rawVideos = [rawProduct.videos.trim()];
    }
  }

  const cleanVideos = rawVideos.filter(vid => typeof vid === 'string' && vid.trim().length > 0 && !vid.includes('/api/products/'));

  const category = normalizeCategory(rawProduct.category);

  // Video poster
  const videoPoster = rawProduct.videoPoster || (cleanVideos[0] ? getCloudinaryVideoPoster(cleanVideos[0]) : undefined);

  const primaryImgUrl = cleanImages[0] ||
    (rawProduct.displayImage && !rawProduct.displayImage.startsWith('data:image/svg+xml') && !rawProduct.displayImage.includes('unsplash.com') ? rawProduct.displayImage : '') ||
    (rawProduct.primaryPicture && !rawProduct.primaryPicture.startsWith('data:image/svg+xml') && !rawProduct.primaryPicture.includes('unsplash.com') ? rawProduct.primaryPicture : '') ||
    videoPoster ||
    getCategoryPlaceholder(category);

  // Generate thumbnail URLs
  const thumbnailUrls = cleanImages.map(img => getCloudinaryThumbnail(img));
  const primaryThumb = thumbnailUrls[0] ||
    (rawProduct.thumbnailUrl && !rawProduct.thumbnailUrl.startsWith('data:image/svg+xml') && !rawProduct.thumbnailUrl.includes('unsplash.com') ? rawProduct.thumbnailUrl : '') ||
    (videoPoster ? getCloudinaryThumbnail(videoPoster) : primaryImgUrl);

  const views = Number(rawProduct.views || rawProduct.viewsCount || rawProduct.views_count) || 0;
  const likes = Number(rawProduct.likes || rawProduct.likesCount || rawProduct.likes_count) || 0;

  const rawBoostEndDate = rawProduct.boostEndDate || rawProduct.boost_end_date || rawProduct.boostExpiry || rawProduct.boost_expiry || undefined;
  const rawBoostStartDate = rawProduct.boostStartDate || rawProduct.boost_start_date || rawProduct.lastBoostedAt || rawProduct.last_boosted_at || undefined;
  const boostPlan = rawProduct.boostPlan || rawProduct.boost_plan || undefined;

  const computedBoostEndDate = getBoostEndDate({ ...rawProduct, boostEndDate: rawBoostEndDate, boostStartDate: rawBoostStartDate, boostPlan });
  const activeBoost = computedBoostEndDate ? computedBoostEndDate.getTime() > Date.now() : false;

  return {
    ...rawProduct,
    id,
    title: rawProduct.title || '',
    description: rawProduct.description || '',
    price: rawProduct.price !== undefined ? Number(rawProduct.price) : 0,
    currency: rawProduct.currency || 'GHS',
    condition: rawProduct.condition || 'Used - Good',
    category,
    subcategory: rawProduct.subcategory || rawProduct.subCategory || '',
    location: rawProduct.location || '',
    brand: rawProduct.brand || '',
    negotiable: rawProduct.negotiable === true,
    isExchangeable: rawProduct.isExchangeable === true || rawProduct.exchangePossible === true,
    exchangePossible: rawProduct.exchangePossible === true || rawProduct.isExchangeable === true,
    sellerId: rawProduct.sellerId || rawProduct.seller_id || '',
    sellerName: rawProduct.sellerName || rawProduct.seller_name || 'Seller',
    sellerEmail: rawProduct.sellerEmail || rawProduct.seller_email || '',
    sellerPhoto: rawProduct.sellerPhoto || rawProduct.seller_photo || '',
    sellerJoinDate: rawProduct.sellerJoinDate || rawProduct.seller_join_date || new Date().toISOString(),
    createdAt: rawProduct.createdAt || rawProduct.created_at || new Date().toISOString(),
    updatedAt: rawProduct.updatedAt || rawProduct.updated_at || rawProduct.createdAt || new Date().toISOString(),
    views,
    viewsCount: views,
    likes,
    likesCount: likes,
    status: rawProduct.status || 'active',
    boostStatus: activeBoost,
    isBoosted: activeBoost,
    boostPlan: boostPlan || (activeBoost ? '7days' : undefined),
    boostStartDate: rawBoostStartDate,
    boostEndDate: computedBoostEndDate ? computedBoostEndDate.toISOString() : undefined,
    boostExpiry: computedBoostEndDate ? computedBoostEndDate.toISOString() : undefined,
    imageUrls: cleanImages.length > 0 ? cleanImages : (cleanVideos.length > 0 ? [] : [primaryImgUrl]),
    images: cleanImages.length > 0 ? cleanImages : (cleanVideos.length > 0 ? [] : [primaryImgUrl]),
    thumbnailUrls: thumbnailUrls.length > 0 ? thumbnailUrls : (cleanVideos.length > 0 ? [] : [primaryThumb]),
    thumbnailUrl: primaryThumb,
    videoUrls: cleanVideos,
    videos: cleanVideos,
    videoPoster,
    displayImage: primaryImgUrl,
    primaryImage: primaryImgUrl
  };
}
