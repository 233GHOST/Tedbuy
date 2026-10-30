// Shared-media guard: a Cloudinary asset is never deleted while any OTHER remaining record still
// shows it -- a product other than the one being deleted/edited (whoever owns it), or a user's
// photoUrl other than the profile being deleted. Without this, a seller could copy another
// seller's photo URL into their own listing or profile and then delete it (and an honest seller
// reusing one photo on two listings lost it on both when deleting one). Compared by Cloudinary
// publicId where it parses (so transformed/re-versioned variants of the same asset count),
// else by exact URL. Applies to admins too. Pure: server.ts loads the candidate rows.
import { extractCloudinaryInfo } from '../cloudinaryInfo.js';

export type ProductMediaRef = { productId: string; images?: unknown; videos?: unknown; imageUrls?: unknown; videoUrls?: unknown };
export type UserPhotoRef = { id: string; photoUrl?: string | null };
export type MediaRefExclusion = { productId?: string | null; userId?: string | null };
export type MediaTarget = string | { url?: string | null; publicId?: string | null };

// Same rules as server.ts parseMediaArray: media fields may be arrays, JSON-encoded arrays
// (sometimes encoded more than once), or a single URL string.
export function parseMediaList(val: unknown): string[] {
  if (!val) return [];
  let current: unknown = val;
  while (typeof current === 'string') {
    const trimmed = current.trim();
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      try {
        current = JSON.parse(trimmed);
      } catch (_) {
        break;
      }
    } else {
      break;
    }
  }
  if (Array.isArray(current)) {
    return current.filter((item: unknown): item is string =>
      typeof item === 'string' && item.trim().length > 0 && item !== '[]' && item !== 'null');
  }
  if (typeof current === 'string' && current.trim().length > 0 && current !== '[]' && current !== 'null') {
    return [current.trim()];
  }
  return [];
}

export function mediaUrlsOf(ref: Omit<ProductMediaRef, 'productId'>): string[] {
  return [
    ...parseMediaList(ref.images),
    ...parseMediaList(ref.imageUrls),
    ...parseMediaList(ref.videos),
    ...parseMediaList(ref.videoUrls),
  ];
}

/** The publicId a delete of `target` would destroy, or null when it is not a Cloudinary asset. */
export function targetPublicId(target: MediaTarget): string | null {
  if (typeof target === 'string') return extractCloudinaryInfo(target)?.publicId || null;
  if (target.publicId) return target.publicId;
  return target.url ? extractCloudinaryInfo(target.url)?.publicId || null : null;
}

function targetUrl(target: MediaTarget): string | null {
  return typeof target === 'string' ? target : target.url || null;
}

function matches(ref: string, url: string | null, publicId: string | null): boolean {
  if (!ref) return false;
  if (url && ref.trim() === url.trim()) return true;
  if (publicId) {
    const refPublicId = extractCloudinaryInfo(ref)?.publicId;
    if (refPublicId && refPublicId === publicId) return true;
  }
  return false;
}

export function isStillReferenced(
  target: MediaTarget,
  productRefs: ReadonlyArray<ProductMediaRef> | null | undefined,
  userPhotoRefs: ReadonlyArray<UserPhotoRef> | null | undefined,
  exclude: MediaRefExclusion,
): boolean {
  const url = targetUrl(target);
  const publicId = targetPublicId(target);
  const excludedProduct = exclude.productId != null && exclude.productId !== '' ? String(exclude.productId) : null;
  const excludedUser = exclude.userId != null && exclude.userId !== '' ? String(exclude.userId) : null;

  for (const p of productRefs || []) {
    if (!p) continue;
    if (excludedProduct !== null && String(p.productId) === excludedProduct) continue;
    if (mediaUrlsOf(p).some((ref) => matches(ref, url, publicId))) return true;
  }
  for (const u of userPhotoRefs || []) {
    if (!u) continue;
    if (excludedUser !== null && String(u.id) === excludedUser) continue;
    if (typeof u.photoUrl === 'string' && matches(u.photoUrl, url, publicId)) return true;
  }
  return false;
}
