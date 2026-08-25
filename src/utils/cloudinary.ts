/**
 * Cloudinary Media Integration Utility for TedBuy
 * Handles image & video uploads, responsive transformations, video streaming URLs,
 * thumbnail generation, retry logic, and upload progress tracking.
 */

import { validateCloudinaryTransformations } from './imageOptimizer';
import { getAuthHeader } from '../firebase';
export { validateCloudinaryTransformations };

export interface CloudinaryUploadResult {
  url: string;
  secure_url: string;
  public_id: string;
  format: string;
  resource_type: 'image' | 'video';
  bytes: number;
  width?: number;
  height?: number;
  duration?: number;
  thumbnail_url: string;
  small_url: string;
  medium_url: string;
  large_url: string;
  video_poster_url?: string;
  streaming_url?: string;
}

/**
 * Helper to construct Cloudinary transformed URLs from a base Cloudinary URL
 */
export function buildCloudinaryUrl(
  url: string,
  transformations: string
): string {
  if (!url || typeof url !== 'string' || !url.includes('res.cloudinary.com')) {
    return url;
  }
  // Standard format: https://res.cloudinary.com/<cloud_name>/<resource_type>/upload/<transformations>/<public_id>
  return url.replace('/upload/', `/upload/${transformations}/`);
}

/**
 * Get optimized image thumbnail URL (200x200 smart crop)
 */
export function getCloudinaryThumbnail(url: string): string {
  if (!url) return '';
  if (url.includes('res.cloudinary.com')) {
    return buildCloudinaryUrl(url, 'c_thumb,w_200,h_200,g_auto,f_auto,q_auto');
  }
  return url;
}

/**
 * Get responsive image URL by width
 */
export function getCloudinaryResponsiveUrl(url: string, width: number): string {
  if (!url) return '';
  if (url.includes('res.cloudinary.com')) {
    return buildCloudinaryUrl(url, `w_${width},c_limit,f_auto,q_auto`);
  }
  return url;
}

/**
 * Get video streaming URL with auto format and quality
 */
export function getCloudinaryStreamingVideoUrl(url: string): string {
  if (!url) return '';
  if (url.includes('res.cloudinary.com')) {
    return buildCloudinaryUrl(url, 'vc_auto,q_auto,f_auto');
  }
  return url;
}

/**
 * Get video poster image URL (first frame of video as JPEG)
 */
export function getCloudinaryVideoPoster(url: string): string {
  if (!url) return '';
  if (url.includes('res.cloudinary.com')) {
    // Replace .mp4 or other extension with .jpg and add poster transformation
    let posterUrl = url.replace(/\.[a-zA-Z0-9]+$/, '.jpg');
    return buildCloudinaryUrl(posterUrl, 'so_0,f_jpg,q_auto,w_800');
  }
  return url;
}

/**
 * Upload an image or video file or Base64 string to Cloudinary with retry logic and progress feedback
 */
export async function uploadToCloudinary(
  fileOrBase64: File | Blob | string,
  resourceType: 'image' | 'video' = 'image',
  onProgress?: (progress: number) => void,
  maxRetries: number = 3
): Promise<CloudinaryUploadResult> {
  let attempt = 0;
  let lastError: any = null;

  // 1. If payload is already a full HTTP/HTTPS URL, return structured result immediately
  if (typeof fileOrBase64 === 'string' && (fileOrBase64.startsWith('http://') || fileOrBase64.startsWith('https://'))) {
    const secureUrl = fileOrBase64;
    return {
      url: secureUrl,
      secure_url: secureUrl,
      public_id: extractCloudinaryInfo(secureUrl)?.publicId || '',
      format: 'jpg',
      resource_type: resourceType,
      bytes: 0,
      thumbnail_url: getCloudinaryThumbnail(secureUrl),
      small_url: getCloudinaryResponsiveUrl(secureUrl, 400),
      medium_url: getCloudinaryResponsiveUrl(secureUrl, 800),
      large_url: getCloudinaryResponsiveUrl(secureUrl, 1200)
    };
  }

  // 2. Prepare base64 string payload
  let base64Payload = '';
  if (typeof fileOrBase64 === 'string') {
    if (fileOrBase64.startsWith('blob:')) {
      try {
        const res = await fetch(fileOrBase64);
        const blob = await res.blob();
        base64Payload = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = (err) => reject(err);
          reader.readAsDataURL(blob);
        });
      } catch (blobErr) {
        console.warn('[uploadToCloudinary] Failed converting blob URL to base64 data URL:', blobErr);
        base64Payload = fileOrBase64;
      }
    } else {
      base64Payload = fileOrBase64;
    }
  } else {
    base64Payload = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(fileOrBase64 as Blob);
    });
  }

  while (attempt < maxRetries) {
    try {
      attempt++;
      if (onProgress) onProgress(10 * attempt);

      const jsonBody = JSON.stringify({
        file: base64Payload,
        resource_type: resourceType,
        folder: 'tedbuy_products'
      });

      const xhr = new XMLHttpRequest();
      
      const uploadPromise = new Promise<CloudinaryUploadResult>((resolve, reject) => {
        xhr.open('POST', '/api/cloudinary/upload', true);
        xhr.setRequestHeader('Content-Type', 'application/json');

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && onProgress) {
            const percentComplete = Math.round((event.loaded / event.total) * 100);
            onProgress(percentComplete);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const response = JSON.parse(xhr.responseText);
              if (response.success) {
                const secureUrl = response.secure_url || (response.result && response.result.secure_url);
                if (!secureUrl) {
                  reject(new Error(response.error || 'Cloudinary upload succeeded but returned no secure URL.'));
                  return;
                }

                const resultObj: CloudinaryUploadResult = response.result || {
                  url: response.url || secureUrl,
                  secure_url: secureUrl,
                  public_id: response.public_id || '',
                  format: response.format || 'jpg',
                  resource_type: resourceType,
                  bytes: response.bytes || 0,
                  thumbnail_url: getCloudinaryThumbnail(secureUrl),
                  small_url: getCloudinaryResponsiveUrl(secureUrl, 400),
                  medium_url: getCloudinaryResponsiveUrl(secureUrl, 800),
                  large_url: getCloudinaryResponsiveUrl(secureUrl, 1200)
                };

                resolve(resultObj);
              } else {
                reject(new Error(response.error || 'Cloudinary upload failed on server.'));
              }
            } catch (e) {
              reject(new Error('Invalid JSON response from upload server.'));
            }
          } else {
            let errorDetails = `Server upload error status: ${xhr.status}`;
            try {
              const errParsed = JSON.parse(xhr.responseText);
              if (errParsed.error) errorDetails = errParsed.error;
            } catch (_) {}
            reject(new Error(errorDetails));
          }
        };

        xhr.onerror = () => reject(new Error('Network error during upload.'));
        xhr.ontimeout = () => reject(new Error('Upload request timed out.'));

        xhr.send(jsonBody);
      });

      const result = await uploadPromise;
      if (onProgress) onProgress(100);
      return result;
    } catch (err) {
      lastError = err;
      console.warn(`[Cloudinary Upload Attempt ${attempt}/${maxRetries} Failed]:`, err);
      if (attempt < maxRetries) {
        // Exponential backoff delay
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  // Fallback: If Cloudinary server upload fails after retries, return valid base64 data URL for images so post creation succeeds
  if (base64Payload && base64Payload.startsWith('data:')) {
    console.warn('[uploadToCloudinary] Cloudinary server upload failed. Falling back to base64 data URI media.');
    return {
      url: base64Payload,
      secure_url: base64Payload,
      public_id: '',
      format: resourceType === 'image' ? 'jpg' : 'mp4',
      resource_type: resourceType,
      bytes: base64Payload.length,
      thumbnail_url: base64Payload,
      small_url: base64Payload,
      medium_url: base64Payload,
      large_url: base64Payload
    };
  }

  throw new Error(`Failed to upload media to Cloudinary after ${maxRetries} attempts: ${lastError?.message || lastError}`);
}

/**
 * Upload a video directly from the browser to Cloudinary, bypassing the TedBuy
 * server for the actual video bytes entirely. The server (via
 * /api/cloudinary/sign-video-upload) only issues a short-lived signature — it
 * never receives the Cloudinary API secret client-side, and never receives or
 * proxies the video payload. Requires the caller to be authenticated; the
 * signing endpoint enforces that server-side using the app's existing auth.
 *
 * Video only — images still go through uploadToCloudinary()/the server relay.
 */
export async function uploadVideoDirectToCloudinary(
  file: File | Blob,
  onProgress?: (progress: number) => void
): Promise<CloudinaryUploadResult> {
  const authHeaders = await getAuthHeader();
  const signRes = await fetch('/api/cloudinary/sign-video-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders }
  });

  if (!signRes.ok) {
    let errMsg = `Failed to get upload authorization (status ${signRes.status})`;
    try {
      const errBody = await signRes.json();
      if (errBody?.error) errMsg = errBody.error;
    } catch (_) {}
    throw new Error(errMsg);
  }

  const signData = await signRes.json();
  if (!signData?.success) {
    throw new Error(signData?.error || 'Failed to get upload authorization');
  }

  const { signature, timestamp, apiKey, cloudName, folder } = signData;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('api_key', apiKey);
  formData.append('timestamp', String(timestamp));
  formData.append('signature', signature);
  formData.append('folder', folder);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          const secureUrl = response.secure_url;
          if (!secureUrl) {
            reject(new Error('Cloudinary upload succeeded but returned no secure URL.'));
            return;
          }
          resolve({
            url: response.url || secureUrl,
            secure_url: secureUrl,
            public_id: response.public_id || '',
            format: response.format || 'mp4',
            resource_type: 'video',
            bytes: response.bytes || 0,
            width: response.width,
            height: response.height,
            duration: response.duration,
            thumbnail_url: getCloudinaryVideoPoster(secureUrl),
            small_url: getCloudinaryResponsiveUrl(secureUrl, 400),
            medium_url: getCloudinaryResponsiveUrl(secureUrl, 800),
            large_url: getCloudinaryResponsiveUrl(secureUrl, 1200)
          });
        } catch (e) {
          reject(new Error('Invalid JSON response from Cloudinary.'));
        }
      } else {
        let errorDetails = `Cloudinary upload error status: ${xhr.status}`;
        try {
          const errParsed = JSON.parse(xhr.responseText);
          if (errParsed?.error?.message) errorDetails = errParsed.error.message;
        } catch (_) {}
        reject(new Error(errorDetails));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during direct Cloudinary upload.'));
    xhr.send(formData);
  });
}

/**
 * Extract resource_type and public_id from a Cloudinary URL
 */
export function extractCloudinaryInfo(url: string): { publicId: string; resourceType: 'image' | 'video' } | null {
  if (!url || typeof url !== 'string' || !url.includes('res.cloudinary.com')) {
    return null;
  }
  try {
    const uploadIdx = url.indexOf('/upload/');
    if (uploadIdx === -1) return null;

    const prefix = url.substring(0, uploadIdx);
    const resourceType: 'image' | 'video' = prefix.endsWith('/video') ? 'video' : 'image';

    const pathAfterUpload = url.substring(uploadIdx + 8);
    const rawSegments = pathAfterUpload.split('/');

    const cleanSegments = rawSegments.filter(seg => {
      if (!seg) return false;
      if (/^v\d+$/.test(seg)) return false;
      if (seg.includes(',') || /^(c_|w_|h_|f_|q_|so_|vc_|g_)/.test(seg)) return false;
      return true;
    });

    if (cleanSegments.length === 0) return null;

    const fullPathWithExt = cleanSegments.join('/');
    const publicId = fullPathWithExt.replace(/\.[a-zA-Z0-9]+$/, '');

    return { publicId, resourceType };
  } catch (err) {
    return null;
  }
}

/**
 * Delete a single Cloudinary asset via server API endpoint
 */
export async function deleteFromCloudinary(
  urlOrPublicId: string,
  resourceType?: 'image' | 'video'
): Promise<boolean> {
  if (!urlOrPublicId) return false;
  try {
    const authHeaders = await getAuthHeader();
    const res = await fetch('/api/cloudinary/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        url: urlOrPublicId.startsWith('http') ? urlOrPublicId : undefined,
        public_id: !urlOrPublicId.startsWith('http') ? urlOrPublicId : undefined,
        resource_type: resourceType
      })
    });
    const data = await res.json();
    return !!data?.success;
  } catch (err) {
    console.warn('[deleteFromCloudinary] Delete request failed:', err);
    return false;
  }
}

/**
 * Delete multiple Cloudinary assets by URLs or public_ids
 */
export async function deleteMultipleFromCloudinary(
  urlsOrPublicIds: string[]
): Promise<{ deletedCount: number }> {
  if (!Array.isArray(urlsOrPublicIds) || urlsOrPublicIds.length === 0) {
    return { deletedCount: 0 };
  }
  let count = 0;
  for (const item of urlsOrPublicIds) {
    const success = await deleteFromCloudinary(item);
    if (success) count++;
  }
  return { deletedCount: count };
}

/**
 * Automatically find removed Cloudinary assets between old and new URL arrays and destroy them
 */
export async function cleanupOrphanedCloudinaryAssets(
  oldUrls: string[],
  newUrls: string[]
): Promise<{ cleanedCount: number }> {
  if (!Array.isArray(oldUrls) || oldUrls.length === 0) {
    return { cleanedCount: 0 };
  }
  const newSet = new Set(Array.isArray(newUrls) ? newUrls : []);
  const removedUrls = oldUrls.filter(u => typeof u === 'string' && u.includes('res.cloudinary.com') && !newSet.has(u));

  if (removedUrls.length === 0) {
    return { cleanedCount: 0 };
  }

  try {
    const authHeaders = await getAuthHeader();
    const res = await fetch('/api/cloudinary/cleanup-orphans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ oldUrls, newUrls })
    });
    const data = await res.json();
    return { cleanedCount: data?.count || 0 };
  } catch (err) {
    console.warn('[cleanupOrphanedCloudinaryAssets] Orphan cleanup endpoint error:', err);
    const res = await deleteMultipleFromCloudinary(removedUrls);
    return { cleanedCount: res.deletedCount };
  }
}

