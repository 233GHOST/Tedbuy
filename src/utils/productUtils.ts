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
 * Resolve the primary display image URL for any product directly.
 */
export function resolveProductImage(product?: Partial<Product> | null, width: number = 400): string {
  if (!product) return getCategoryPlaceholder('Other');
  const allImages = resolveProductImages(product, width);
  return allImages[0] || getCategoryPlaceholder(product.category);
}

/**
 * Resolve all valid image URLs for a product.
 */
export function resolveProductImages(product?: Partial<Product> | null, width?: number): string[] {
  if (!product) return [];

  const prod = product as any;

  const imgs = Array.isArray(prod.images) ? prod.images.filter((img: any) => typeof img === 'string' && img.trim().length > 0) : [];
  const imgUrls = Array.isArray(prod.imageUrls) ? prod.imageUrls.filter((img: any) => typeof img === 'string' && img.trim().length > 0) : [];

  let list: string[] = imgs.length >= imgUrls.length ? imgs : imgUrls;

  if (list.length === 0 && prod.displayImage) list.push(prod.displayImage);
  if (list.length === 0 && prod.primaryImage) list.push(prod.primaryImage);
  if (list.length === 0 && prod.primaryPicture) list.push(prod.primaryPicture);
  if (list.length === 0 && prod.image) list.push(prod.image);

  if (list.length === 0) {
    list.push(getCategoryPlaceholder(product.category));
  }

  const uniqueList = Array.from(new Set(list));
  return uniqueList.map(img => (width ? getOptimizedImageUrl(img, width) : img));
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
  if (Array.isArray(rawProduct.imageUrls)) {
    rawImages = rawProduct.imageUrls.filter((i: any) => typeof i === 'string' && i.trim().length > 0);
  } else if (Array.isArray(rawProduct.images)) {
    rawImages = rawProduct.images.filter((i: any) => typeof i === 'string' && i.trim().length > 0);
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

  if (rawProduct.primaryPicture && typeof rawProduct.primaryPicture === 'string' && !rawImages.includes(rawProduct.primaryPicture)) {
    rawImages.unshift(rawProduct.primaryPicture);
  }
  if (rawProduct.image && typeof rawProduct.image === 'string' && !rawImages.includes(rawProduct.image)) {
    rawImages.unshift(rawProduct.image);
  }

  // Filter out any stale proxy URLs or non-URL debris
  const cleanImages = rawImages.filter(img => typeof img === 'string' && img.trim().length > 0 && !img.includes('/api/products/'));

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
  const primaryImgUrl = cleanImages[0] || getCategoryPlaceholder(category);

  // Generate thumbnail URLs
  const thumbnailUrls = cleanImages.map(img => getCloudinaryThumbnail(img));
  const primaryThumb = thumbnailUrls[0] || primaryImgUrl;

  // Video poster
  const videoPoster = rawProduct.videoPoster || (cleanVideos[0] ? getCloudinaryVideoPoster(cleanVideos[0]) : undefined);

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
    imageUrls: cleanImages.length > 0 ? cleanImages : [primaryImgUrl],
    images: cleanImages.length > 0 ? cleanImages : [primaryImgUrl],
    thumbnailUrls: thumbnailUrls.length > 0 ? thumbnailUrls : [primaryThumb],
    thumbnailUrl: primaryThumb,
    videoUrls: cleanVideos,
    videos: cleanVideos,
    videoPoster,
    displayImage: primaryImgUrl,
    primaryImage: primaryImgUrl
  };
}
