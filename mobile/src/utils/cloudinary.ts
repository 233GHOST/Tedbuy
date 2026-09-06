import { getAuthHeaderMobile } from '../firebase';

// Same production API host used for every other server call in the mobile app.
const API_BASE = 'https://www.tedbuy.store';

export interface CloudinaryVideoUploadResult {
  secure_url: string;
  public_id: string;
  bytes: number;
  duration?: number;
  // The poster-frame JPG Cloudinary ALSO pre-generated as part of this same
  // eager request (see sign-video-upload's eager string: video variant then
  // poster variant, pipe-separated). Callers should store this verbatim as
  // the listing's videoPoster rather than deriving their own so_/f_jpg URL
  // from secure_url — a differently-parameterized poster transform is one
  // Cloudinary has never generated, so it falls back to the same on-demand
  // cold-stall this eager pipeline exists to avoid (measured at 4.86s cold
  // vs 0.7-0.9s warm for this exact transform — see the sign-video-upload
  // comment in server.ts).
  posterUrl?: string;
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
  onProgress?: (percent: number) => void,
  // Optional trim range (seconds) chosen on the trim step, BEFORE upload
  // starts — passed straight through to the signing endpoint so it can fold
  // so_/eo_ into the same eager transform it already generates synchronously
  // during upload. Omit (or pass the full clip) for an untrimmed video. See
  // that endpoint's comment for why this can't be a client-side URL rewrite
  // applied after the fact.
  trimStart?: number,
  trimEnd?: number
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
      body: JSON.stringify(
        trimStart != null && trimEnd != null ? { trimStart, trimEnd } : {}
      ),
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

  const { signature, timestamp, apiKey, cloudName, folder, eager } = signData;

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
  // Must exactly match what the server signed (paramsToSign in
  // /api/cloudinary/sign-video-upload) or Cloudinary rejects the whole
  // request as a signature mismatch. Generates the 720p/auto-quality feed
  // variant synchronously as part of this same upload — see that
  // endpoint's comment for why this replaced a playback-time transform.
  if (eager) formData.append('eager', eager);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, true);
    // Was previously unset — a stalled connection mid-upload left this
    // promise pending forever, leaving the video stuck at 'uploading' and
    // Publish disabled indefinitely. Videos are larger than photos, so this
    // gets a longer ceiling than the image-upload path's 60s — raised
    // further now that the request also waits for the eager transform
    // (real video transcoding) to finish before Cloudinary responds.
    xhr.timeout = 180000;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        // Upload bytes are only the first part of this request now (eager
        // transcoding happens server-side after the bytes finish landing,
        // with no progress signal of its own) — capped at 92% so the UI
        // doesn't sit at "100%" while Cloudinary is still transcoding.
        onProgress(Math.min(92, Math.round((event.loaded / event.total) * 100)));
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
          onProgress?.(100);
          // Prefer the pre-optimized eager variant when Cloudinary actually
          // produced one; fall back to the original if eager processing
          // failed for some reason (e.g. an unsupported source codec) —
          // never block publishing on the optimization succeeding.
          const optimizedUrl = Array.isArray(response.eager) && response.eager[0]?.secure_url
            ? response.eager[0].secure_url
            : response.secure_url;
          resolve({
            secure_url: optimizedUrl,
            public_id: response.public_id || '',
            bytes: response.bytes || 0,
            duration: response.duration,
            posterUrl: Array.isArray(response.eager) ? response.eager[1]?.secure_url : undefined,
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

/** True when a chosen trim range is actually the whole clip (untouched
 * handles) — used to skip sending trim params to the upload-signing
 * endpoint entirely for the common case of "didn't trim," rather than
 * asking Cloudinary to bake a no-op so_0,eo_duration into the eager
 * transform for no visual benefit. Real trims are applied server-side, at
 * upload time — see /api/cloudinary/sign-video-upload's comment for why
 * this can no longer be a client-side URL rewrite applied after upload. */
export function isFullVideoRange(trimStart: number, trimEnd: number, durationSec: number): boolean {
  const start = Math.max(0, Math.round(trimStart));
  const end = Math.max(start + 1, Math.round(trimEnd));
  return start <= 0 && durationSec > 0 && end >= Math.floor(durationSec);
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
