/**
 * TedBuy Android Direct-Download Release Configuration
 * Single source of truth for the /download page and the /downloads/tedbuy.apk
 * redirect route. Values are env-driven so a new release can be rolled out by
 * updating host env vars (e.g. in the Render dashboard) without a code deploy.
 */

const envObj: Record<string, any> = typeof process !== 'undefined' && process.env ? process.env : {};

const parseOptionalNumber = (val: any): number | null => {
  if (typeof val !== 'string' || !val.trim()) return null;
  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : null;
};

export interface AppReleaseConfig {
  /** Human-readable app version shown on the download page (kept in sync with mobile/app.json). */
  version: string;
  /** Direct CDN URL the /downloads/tedbuy.apk route redirects to. Empty = no release published yet. */
  apkUrl: string;
  /** Approximate APK size in megabytes, if known. */
  apkSizeMB: number | null;
  /** SHA-256 checksum of the published APK, for integrity verification. */
  sha256: string;
  /** Minimum supported Android version, e.g. "Android 8.0+". Left blank until confirmed against a real build. */
  minAndroidVersion: string;
  /** ISO date (YYYY-MM-DD) the current release was published. */
  releaseDate: string;
}

export const APP_RELEASE_CONFIG: AppReleaseConfig = {
  version: envObj.ANDROID_APP_VERSION || '1.0.0',
  apkUrl: envObj.ANDROID_APK_URL || '',
  apkSizeMB: parseOptionalNumber(envObj.ANDROID_APK_SIZE_MB),
  sha256: envObj.ANDROID_APK_SHA256 || '',
  minAndroidVersion: envObj.ANDROID_MIN_OS || '',
  releaseDate: envObj.ANDROID_APK_RELEASE_DATE || '',
};

export function isAndroidReleaseAvailable(config: AppReleaseConfig = APP_RELEASE_CONFIG): boolean {
  return Boolean(config.apkUrl && config.apkUrl.trim());
}
