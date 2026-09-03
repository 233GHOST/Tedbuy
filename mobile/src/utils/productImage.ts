import { getCloudinaryVideoPosterMobile } from './cloudinary';

/** Matches web's resolveProductImage/resolveProductImages (src/utils/productUtils.ts)
 * — real uploaded photos first, then a video poster frame for a video-only
 * listing, and NEVER an unrelated stock photo as a last resort. Mobile
 * previously fell back to a single hardcoded Unsplash "phone on a desk"
 * photo everywhere (ProductCard.tsx, ProfileScreen.tsx dashboard cards) —
 * so a video-only laptop listing with no photos showed a random phone
 * picture, which reads as "the seller's actual photo" and is actively
 * misleading. Returns null when there's truly no real image to show, so the
 * caller can render an honest category-tinted placeholder box instead of an
 * <Image> at all. */

const isVideoPosterUrl = (url: string) =>
  url.includes('res.cloudinary.com') && url.includes('/upload/so_0,f_jpg');

function filterValidImages(arr: any[]): string[] {
  return arr.filter(
    (img: any) =>
      typeof img === 'string' &&
      img.trim().length > 0 &&
      !img.includes('/api/products/') &&
      !img.startsWith('data:image/svg+xml') &&
      !isVideoPosterUrl(img)
  );
}

export function resolveProductImageUri(product: any): string | null {
  if (!product) return null;

  let list: string[] = [];
  if (Array.isArray(product.images) && product.images.length > 0) {
    list = filterValidImages(product.images);
  }
  if (list.length === 0 && Array.isArray(product.imageUrls) && product.imageUrls.length > 0) {
    list = filterValidImages(product.imageUrls);
  }
  if (list[0]) return list[0];

  const hasVideo = Array.isArray(product.videos) && product.videos.length > 0;

  // Matches web's resolveProductImages exactly (src/utils/productUtils.ts
  // ~line 138): when there's no real images array, fall back to whichever
  // single denormalized field is populated, in this priority order. This is
  // the field the server's own /api/products LIST endpoint actually returns
  // (displayImage/thumbnailUrl — it never sends a full images array for the
  // summary/grid view) — checking only `images`/`imageUrls` here missed
  // every real photo on every listing fetched through that endpoint.
  if (!hasVideo) {
    const candidates = [product.displayImage, product.primaryImage, product.primaryPicture, product.image, product.thumbnailUrl];
    for (const field of candidates) {
      if (typeof field === 'string' && filterValidImages([field]).length > 0) {
        return field.trim();
      }
    }
  }

  // Video-only listing — use a poster frame derived from the video itself,
  // never a candidate single field like displayImage/primaryPicture (those
  // are often just this same auto-derived poster re-saved, and surfacing a
  // single stray field here risks showing a stale/unrelated image).
  if (product.videoPoster) return product.videoPoster;
  if (hasVideo && product.videos[0]) {
    const poster = getCloudinaryVideoPosterMobile(product.videos[0]);
    if (poster) return poster;
  }

  return null;
}

/** Matches web's getCategoryPlaceholder color choices (src/utils/productUtils.ts)
 * — used to tint the native placeholder box when resolveProductImageUri
 * returns null, instead of web's SVG data-URI (React Native's core Image
 * component doesn't reliably rasterize inline SVG, so the same "honest,
 * category-colored, non-misleading placeholder" intent is ported as a real
 * View + icon instead of an <Image> data-URI). */
export function getCategoryPlaceholderColor(category?: string): string {
  const cat = (category || 'Other').toLowerCase();
  if (cat.includes('phone')) return '#6366f1';
  if (cat.includes('laptop') || cat.includes('electronic')) return '#0284c7';
  if (cat.includes('fashion')) return '#ec4899';
  if (cat.includes('vehicle')) return '#f59e0b';
  if (cat.includes('property') || cat.includes('home')) return '#10b981';
  return '#3b82f6';
}
