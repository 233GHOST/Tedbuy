import { getAuthHeaderMobile } from '../firebase';

// Same production API host used for every other server call in the mobile app.
const API_BASE = 'https://www.tedbuy.store';

export interface CloudinaryVideoUploadResult {
  secure_url: string;
  public_id: string;
  bytes: number;
  duration?: number;
}

/**
 * Uploads a video directly from the device to Cloudinary, bypassing the
 * TedBuy server for the actual video bytes entirely — mirrors the web app's
 * signed direct-upload flow (see src/utils/cloudinary.ts,
 * uploadVideoDirectToCloudinary). The server only issues a short-lived
 * signature via /api/cloudinary/sign-video-upload; it never receives the
 * Cloudinary API secret or the video payload. Requires an authenticated user.
 */
export async function uploadVideoDirectToCloudinaryMobile(
  fileUri: string,
  onProgress?: (percent: number) => void
): Promise<CloudinaryVideoUploadResult> {
  const authHeaders = await getAuthHeaderMobile();
  // Was previously unbounded — a stalled connection here (before any video
  // bytes even start moving) left the whole upload promise pending forever.
  const signController = new AbortController();
  const signTimeoutId = setTimeout(() => signController.abort(), 20000);
  let signRes: Response;
  try {
    signRes = await fetch(`${API_BASE}/api/cloudinary/sign-video-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      signal: signController.signal,
    });
  } catch (err: any) {
    clearTimeout(signTimeoutId);
    if (err?.name === 'AbortError') {
      throw new Error('Upload timed out. Please check your connection and try again.');
    }
    throw new Error("You're offline. Check your internet connection and try again.");
  }
  clearTimeout(signTimeoutId);

  if (!signRes.ok) {
    let msg = `Failed to get upload authorization (status ${signRes.status})`;
    try {
      const body = await signRes.json();
      if (body?.error) msg = body.error;
    } catch (_) {}
    throw new Error(msg);
  }

  const signData = await signRes.json();
  if (!signData?.success) {
    throw new Error(signData?.error || 'Failed to get upload authorization');
  }

  const { signature, timestamp, apiKey, cloudName, folder } = signData;

  const formData = new FormData();
  formData.append('file', {
    uri: fileUri,
    type: 'video/mp4',
    name: `tedbuy_video_${Date.now()}.mp4`,
  } as any);
  formData.append('api_key', apiKey);
  formData.append('timestamp', String(timestamp));
  formData.append('signature', signature);
  formData.append('folder', folder);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, true);
    // Was previously unset — a stalled connection mid-upload left this
    // promise pending forever, leaving the video stuck at 'uploading' and
    // Publish disabled indefinitely. Videos are larger than photos, so this
    // gets a longer ceiling than the image-upload path's 60s.
    xhr.timeout = 120000;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          if (!response.secure_url) {
            reject(new Error('Cloudinary upload succeeded but returned no secure URL.'));
            return;
          }
          resolve({
            secure_url: response.secure_url,
            public_id: response.public_id || '',
            bytes: response.bytes || 0,
            duration: response.duration,
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
    xhr.ontimeout = () => reject(new Error('Upload timed out. Please check your connection and try again.'));
    xhr.onabort = () => reject(new Error('Upload was cancelled.'));
    xhr.send(formData);
  });
}

/** Mirrors web's getCloudinaryVideoPoster — a poster frame derived on-the-fly
 * from the video via Cloudinary's own transform, no separate image needed. */
export function getCloudinaryVideoPosterMobile(url?: string): string {
  if (!url || !url.includes('res.cloudinary.com')) return '';
  const posterUrl = url.replace(/\.[a-zA-Z0-9]+$/, '.jpg');
  return posterUrl.replace('/upload/', '/upload/so_0,f_jpg,q_auto,w_800/');
}

/** REVERTED to a pass-through — this used to append q_auto,f_auto,w_720,
 * c_limit to cap video playback quality/size. That transform is computed
 * lazily: the FIRST time anyone ever requests a given video at that exact
 * transformation, Cloudinary has to fully re-encode it server-side before
 * sending back a single byte, which for a real video can take far longer
 * than a normal buffering wait — it presented as a video that just never
 * loads. Every video already viewed once got fast (Cloudinary caches the
 * transform after that), but any video being watched for the first time
 * anywhere hit this stall, which is strictly worse than the larger-file
 * problem it was meant to solve. The right way to get this benefit is an
 * EAGER transformation requested at upload time (so the optimized version
 * is pre-generated before anyone ever plays it, not on their first request)
 * — a server-side change to /api/cloudinary/sign-video-upload, not a
 * playback-time URL rewrite. Left as a pass-through rather than deleted so
 * that follow-up work has a clear landing spot. */
export function getOptimizedVideoUrlMobile(url?: string): string {
  return url || '';
}

/** Bakes a start/end trim directly into the stored Cloudinary URL via its
 * so_/eo_ (start offset / end offset, in seconds) video transform params —
 * Cloudinary serves back only that slice on every playback, with no local
 * re-encoding needed. This is the mobile-appropriate equivalent of web's
 * client-side canvas+MediaRecorder trim pipeline (a browser-only API with no
 * React Native equivalent, and real re-encoding on-device would require a
 * native module like ffmpeg-kit, which this Expo-Go-compatible project can't
 * add without a custom dev-client rebuild). The video is uploaded exactly
 * once either way — this only changes which URL gets stored as the
 * listing's video, so there's no double upload. No-ops (returns the URL
 * unchanged) if the range covers the whole clip or isn't a Cloudinary URL. */
export function getTrimmedVideoUrlMobile(url: string, trimStart: number, trimEnd: number, durationSec: number): string {
  if (!url || !url.includes('res.cloudinary.com')) return url;
  const start = Math.max(0, Math.round(trimStart));
  const end = Math.max(start + 1, Math.round(trimEnd));
  const isFullRange = start <= 0 && durationSec > 0 && end >= Math.floor(durationSec);
  if (isFullRange) return url;
  return url.replace('/upload/', `/upload/so_${start},eo_${end}/`);
}

/** Matches web's deleteFromCloudinary — used on Discard in the posting
 * wizard to clean up an already-uploaded (but never actually posted) asset,
 * and on Retake/Remove after a successful upload. Authenticated; the server
 * endpoint verifies the caller before calling Cloudinary's destroy API. */
export async function deleteCloudinaryAssetMobile(url: string): Promise<void> {
  if (!url || !url.includes('res.cloudinary.com')) return;
  try {
    const authHeaders = await getAuthHeaderMobile();
    await fetch(`${API_BASE}/api/cloudinary/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ url }),
    });
  } catch (err) {
    // Best-effort cleanup — an orphaned Cloudinary asset from a discarded
    // draft is a minor storage cost, never something worth surfacing an
    // error to the user over.
    console.warn('[deleteCloudinaryAssetMobile] cleanup failed (non-fatal):', err);
  }
}
