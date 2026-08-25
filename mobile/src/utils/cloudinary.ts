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
  const signRes = await fetch(`${API_BASE}/api/cloudinary/sign-video-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
  });

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
