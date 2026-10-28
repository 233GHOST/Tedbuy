// Cloudinary delivery URL -> { publicId, resourceType }. Shared by server.ts (asset deletion)
// and the Dropship media guard, which must protect exactly the publicId a delete would hit
// (supabase/migrations/20261028120000_dropship_listings.sql dropship_media_public_id mirrors
// this logic; server/dropship/listings.sql.test.ts checks they agree).
export function extractCloudinaryInfo(url: string): { publicId: string; resourceType: 'image' | 'video' } | null {
  if (!url || !url.includes('res.cloudinary.com')) return null;
  try {
    const isVideo = url.includes('/video/upload/');
    const resourceType: 'image' | 'video' = isVideo ? 'video' : 'image';
    
    const parts = url.split('/upload/');
    if (parts.length < 2) return null;

    // The version segment (v<digits>) always immediately precedes the real
    // public_id path, and is a reliable anchor regardless of how many
    // transformation segments (poster frame so_/f_jpg, a trim's so_/eo_,
    // the eager quality/size variant, ...) are chained before it — unlike
    // the old logic here, which only ever stripped ONE segment and so left
    // the version marker glued onto the "public_id" for any transformed
    // URL, silently breaking cleanup (Discard/Retake) for anything but a
    // bare, untransformed secure_url.
    const segments = parts[1].split('/');
    const versionIdx = segments.findIndex((s) => /^v\d+$/.test(s));
    const publicIdSegments = versionIdx !== -1 ? segments.slice(versionIdx + 1) : segments;
    const pathAfterUpload = publicIdSegments.join('/');

    const lastDot = pathAfterUpload.lastIndexOf('.');
    const publicId = lastDot !== -1 ? pathAfterUpload.substring(0, lastDot) : pathAfterUpload;
    return { publicId, resourceType };
  } catch (_) {
    return null;
  }
}
