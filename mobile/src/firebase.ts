import { AppState, Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import { initializeAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile, sendPasswordResetEmail, sendEmailVerification, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
// @ts-ignore — getReactNativePersistence exists at runtime (Metro resolves the
// "react-native" package-export condition correctly) but the firebase package's
// bundled .d.ts doesn't pick up that condition, a long-standing upstream typing
// gap (firebase-js-sdk#9316, #8332, #7584) — this is a types-only miss.
import { getReactNativePersistence } from 'firebase/auth';
import { getFirestore, collection, query, where, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { Product } from './types';

const firebaseConfig = {
  apiKey: 'AIzaSyDddmRJVV3ywN5AeLsT7iZ4E2K329StfVA',
  authDomain: 'www.tedbuy.store',
  projectId: 'tedbuy-fb79a',
  storageBucket: 'tedbuy-fb79a.firebasestorage.app',
  messagingSenderId: '735307724523',
  appId: '1:735307724523:web:b9a8f1ff69c0cab69230ae',
};

const app = initializeApp(firebaseConfig);
// Persist to AsyncStorage so users stay logged in across app restarts —
// getAuth() defaults to memory-only persistence on React Native, which was
// silently logging everyone out every time the app was closed.
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});
export const db = getFirestore(app);

/** Translates a raw Firebase Auth error (e.g. "Firebase: Error
 * (auth/wrong-password)") into a message a normal user can act on. Falls
 * back to a generic message for any code not explicitly mapped below rather
 * than ever showing the raw SDK string. */
export function getFriendlyAuthErrorMessage(err: any): string {
  const code: string = err?.code || '';
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address doesn\'t look valid. Please check it and try again.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password. Please try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact TedBuy support.';
    case 'auth/email-already-in-use':
      return 'An account already exists with this email. Try signing in instead.';
    case 'auth/weak-password':
      return 'Please choose a stronger password (at least 6 characters).';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment before trying again.';
    case 'auth/network-request-failed':
      return 'You appear to be offline. Please check your connection and try again.';
    case 'auth/requires-recent-login':
      return 'Please sign out and sign back in, then try that again.';
    default:
      return err?.message && !code ? err.message : 'Something went wrong. Please try again.';
  }
}

export async function getAuthHeaderMobile(): Promise<Record<string, string>> {
  try {
    if (auth.currentUser) {
      const token = await auth.currentUser.getIdToken();
      if (token) return { Authorization: `Bearer ${token}` };
    }
  } catch (e) {
    console.warn('[getAuthHeaderMobile] Could not get ID token:', (e as any)?.message || e);
  }
  return {};
}

function apiOrigin(): string {
  return typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'https://www.tedbuy.store';
}

export type ApiErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'PARSE'
  | 'SESSION_EXPIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMIT'
  | 'SERVER'
  | 'CLIENT';

const API_TIMEOUT_MS = 20000;

// Server-authored 4xx messages (server.ts) are already hand-written for end
// users ("This store name is reserved by TedBuy.", "Product not found.") —
// those are passed through unchanged. Only the cases below need a client-side
// override: 401 to a single consistent, actionable phrase; 5xx because
// err.message on the server can occasionally carry raw exception text that
// must never reach a user; 429 as a safe fallback if the server ever omits it.
function friendlyMessageForStatus(status: number, serverMessage?: string): { message: string; code: ApiErrorCode } {
  if (status === 401) {
    return { message: 'Your session has expired. Please sign in again.', code: 'SESSION_EXPIRED' };
  }
  if (status === 403) {
    return { message: serverMessage || "You don't have permission to do that.", code: 'FORBIDDEN' };
  }
  if (status === 404) {
    return { message: serverMessage || 'That could not be found.', code: 'NOT_FOUND' };
  }
  if (status === 429) {
    return { message: serverMessage || "You're doing that too fast. Please wait a moment and try again.", code: 'RATE_LIMIT' };
  }
  if (status >= 500) {
    return { message: "TedBuy couldn't complete that request right now. Please try again.", code: 'SERVER' };
  }
  return { message: serverMessage || 'That request could not be completed. Please check your input and try again.', code: 'CLIENT' };
}

/** Builds the Error a caller throws after `if (!data.success)`, carrying the
 * apiFetch-assigned `errorCode` along as a real property on the Error
 * instance (not just baked into the message string) — so a caller like
 * ChatsScreen's offline-retry queue can reliably ask "was this a
 * network/timeout failure?" via `err.errorCode` instead of pattern-matching
 * the human-readable message text, which is fragile and locale-fragile. */
function apiErrorFromResponse(data: any, fallback: string): Error & { errorCode?: ApiErrorCode } {
  const err = new Error(data?.error || fallback) as Error & { errorCode?: ApiErrorCode };
  if (data?.errorCode) err.errorCode = data.errorCode;
  return err;
}

/** True for a failure worth silently retrying later (dropped connection,
 * server took too long) — false for anything else (bad request, forbidden,
 * not found, validation), which should surface to the user instead of being
 * queued forever. Prefers the structured `errorCode` from apiFetch when
 * present; falls back to message-text sniffing only for errors that didn't
 * originate from apiFetch (e.g. a raw thrown exception). */
export function isRetryableApiError(err: any): boolean {
  if (err?.errorCode === 'NETWORK' || err?.errorCode === 'TIMEOUT') return true;
  if (err?.errorCode) return false;
  const msg = String(err?.message || '').toLowerCase();
  return !msg || msg.includes('network') || msg.includes('fetch') || msg.includes('timeout') || msg.includes('offline') || msg.includes('connection');
}

// Centralized session-expiration handling. A 401 from our own server means
// verifyUser() rejected the Firebase ID token — the token is genuinely
// invalid (expired/revoked/malformed), not merely "wrong permission" (that's
// a 403, handled entirely separately via the FORBIDDEN errorCode above and
// never routed through here). Firebase Auth's own onAuthStateChanged has no
// way to know our server independently rejected a token, so without this the
// user would stay looking "signed in" while every authenticated action kept
// silently failing with the same message, forever, until they happened to
// find Sign Out themselves.
let sessionExpiredHandled = false;
onAuthStateChanged(auth, (user) => {
  // Re-arm once the user is genuinely signed in again, so a *future*
  // expiration is caught too.
  if (user) sessionExpiredHandled = false;
});

function handleSessionExpired() {
  // Guards against several concurrent requests (e.g. a screen's own fetch
  // plus a couple of polling intervals) all hitting 401 around the same
  // moment and each independently trying to sign the user out.
  if (sessionExpiredHandled) return;
  sessionExpiredHandled = true;
  Alert.alert('Session Expired', 'Your session has expired. Please sign in again.');
  // Reuses the existing sign-out path — every screen that already reacts to
  // auth state (ProfileScreen, SavedProducts, SuspensionGate) via
  // observeAuthState/onAuthStateChanged responds exactly as if the user had
  // tapped "Sign Out" themselves; no new navigation/auth architecture needed.
  signOut(auth).catch(() => {});
}

// Shared authenticated JSON request helper for the TedBuy API. Chats, messages,
// and user-profile writes are canonically stored in Supabase and are only ever
// reached through this server — the app never talks to Supabase directly, so
// no Supabase credential of any kind (privileged or anon) is ever needed here.
//
// Contract (unchanged for every existing caller): always resolves — never
// rejects — with a plain object that has `success`/`error` fields, exactly
// like the server's own JSON responses. Every caller already does
// `if (!data.success) throw new Error(data.error || fallback)`, so normalizing
// network/timeout/malformed-response/status-code failures into that same
// shape here means every one of those ~25 call sites gets safe, friendly,
// non-hanging behavior with zero changes required at the call site. An
// `errorCode` field is also attached for any caller that wants to react to a
// specific failure kind (e.g. SESSION_EXPIRED) without parsing message text.
async function apiFetch(path: string, options: { method?: string; body?: any; timeoutMs?: number } = {}): Promise<any> {
  const authHeaders = await getAuthHeaderMobile();
  const controller = new AbortController();
  const effectiveTimeoutMs = options.timeoutMs ?? API_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), effectiveTimeoutMs);

  let res: Response;
  try {
    res = await fetch(`${apiOrigin()}${path}`, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError') {
      console.warn(`[apiFetch] Timed out after ${effectiveTimeoutMs}ms: ${path}`);
      return { success: false, error: 'That took too long. Please check your connection and try again.', errorCode: 'TIMEOUT' as ApiErrorCode };
    }
    console.warn(`[apiFetch] Network error on ${path}:`, err?.message || err);
    return { success: false, error: "You're offline. Check your internet connection and try again.", errorCode: 'NETWORK' as ApiErrorCode };
  }
  clearTimeout(timeoutId);

  let data: any;
  try {
    data = await res.json();
  } catch (err) {
    console.warn(`[apiFetch] Malformed response (status ${res.status}) from ${path}`);
    return { success: false, error: 'TedBuy sent back an unexpected response. Please try again.', errorCode: 'PARSE' as ApiErrorCode };
  }

  if (!res.ok) {
    if (res.status >= 500 && data?.error) {
      // Diagnostic detail stays in the log only — never shown to the user.
      console.warn(`[apiFetch] Server error ${res.status} on ${path}:`, data.error);
    }
    const { message, code } = friendlyMessageForStatus(res.status, data?.error);
    if (res.status === 401) handleSessionExpired();
    return { ...data, success: false, error: message, errorCode: code };
  }

  return data;
}

export async function uploadMediaToCloudinaryMobile(
  fileUriOrBase64: string,
  resourceType: 'image' | 'video' = 'image',
  onProgress?: (percent: number) => void
): Promise<string> {
  if (!fileUriOrBase64) return '';
  if (fileUriOrBase64.startsWith('https://res.cloudinary.com')) return fileUriOrBase64;

  const serverUrl = typeof window !== 'undefined' && window.location?.origin
    ? `${window.location.origin}/api/cloudinary/upload`
    : 'https://www.tedbuy.store/api/cloudinary/upload';

  // Security fix (matches the server-side fix to /api/cloudinary/upload,
  // same commit): that endpoint now requires authentication. Fetched
  // before opening the XHR since the header value must be available
  // synchronously at that point.
  const authHeaders = await getAuthHeaderMobile();

  try {
    const result = await new Promise<{ success: boolean; result?: any; error?: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', serverUrl, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      if (authHeaders.Authorization) {
        xhr.setRequestHeader('Authorization', authHeaders.Authorization);
      }
      // Was previously unset — a stalled connection (server hung, wifi died
      // mid-request) left this promise pending forever, which left the
      // image's status stuck at 'uploading' and Publish disabled with no way
      // out. 60s is generous for a single (already-compressed) photo.
      xhr.timeout = 60000;

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        };
      }

      xhr.onload = () => {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (e) {
          reject(new Error('Invalid JSON response from upload server.'));
        }
      };
      xhr.onerror = () => reject(new Error('Network error during upload.'));
      xhr.ontimeout = () => reject(new Error('Upload timed out. Please check your connection and try again.'));
      xhr.onabort = () => reject(new Error('Upload was cancelled.'));
      xhr.send(JSON.stringify({ file: fileUriOrBase64, resource_type: resourceType }));
    });

    if (result.success && result.result?.secure_url) {
      return result.result.secure_url;
    }
    if (result.success && result.result?.url) {
      return result.result.url;
    }
    throw new Error(result.error || 'Cloudinary mobile upload failed');
  } catch (err: any) {
    console.warn('[uploadMediaToCloudinaryMobile Warning]:', err?.message || err);
    if (fileUriOrBase64.startsWith('http')) return fileUriOrBase64;
    throw err;
  }
}

export async function createProduct(productData: any) {
  const prodId = productData.id || `prod_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // 0. Auto-upload any local/Base64/blob images or videos to Cloudinary
  const inputImages: string[] = Array.isArray(productData.images) && productData.images.length > 0
    ? productData.images
    : (productData.image ? [productData.image] : []);
  const inputVideos: string[] = Array.isArray(productData.videos) ? productData.videos : [];

  const cloudinaryImages: string[] = [];
  for (const img of inputImages) {
    if (typeof img === 'string' && (img.startsWith('data:') || img.startsWith('file:') || img.startsWith('blob:'))) {
      const cUrl = await uploadMediaToCloudinaryMobile(img, 'image');
      if (cUrl) cloudinaryImages.push(cUrl);
    } else if (img) {
      cloudinaryImages.push(img);
    }
  }

  const cloudinaryVideos: string[] = [];
  for (const vid of inputVideos) {
    if (typeof vid === 'string' && (vid.startsWith('data:') || vid.startsWith('file:') || vid.startsWith('blob:'))) {
      const cUrl = await uploadMediaToCloudinaryMobile(vid, 'video');
      if (cUrl) cloudinaryVideos.push(cUrl);
    } else if (vid) {
      cloudinaryVideos.push(vid);
    }
  }

  // Prefer the caller-supplied videoPoster (SellScreen passes the real
  // eager-generated poster straight from Cloudinary's own upload response —
  // see uploadVideoDirectToCloudinaryMobile's posterUrl) over deriving one
  // here. A derived so_/f_jpg URL is a transform Cloudinary has never
  // pre-generated, which falls back to the same on-demand cold-stall the
  // eager pipeline exists to avoid (measured at 4.86s cold vs 0.7-0.9s warm
  // for this exact transform — see sign-video-upload's comment in
  // server.ts). Only derived as a last resort, for any caller that hasn't
  // supplied one — matching the server's actual eager poster dimensions so
  // an untrimmed video at least has a chance of hitting that warm cache.
  const derivedVideoPoster = (!productData.videoPoster && cloudinaryVideos[0] && cloudinaryVideos[0].includes('res.cloudinary.com'))
    ? cloudinaryVideos[0].replace(/\.[a-zA-Z0-9]+$/, '.jpg').replace('/upload/', '/upload/so_0,f_jpg,q_auto,w_1200,h_630,c_fill/')
    : '';
  const videoPoster = productData.videoPoster || derivedVideoPoster;

  const finalProduct = {
    ...productData,
    id: prodId,
    createdAt: productData.createdAt || new Date().toISOString(),
    viewsCount: Number(productData.viewsCount) || 0,
    likesCount: Number(productData.likesCount) || 0,
    likedUserIds: Array.isArray(productData.likedUserIds) ? productData.likedUserIds : [],
    images: cloudinaryImages,
    imageUrls: cloudinaryImages,
    videos: cloudinaryVideos,
    videoUrls: cloudinaryVideos,
    videoPoster,
    displayImage: cloudinaryImages[0] || videoPoster || '',
    primaryPicture: cloudinaryImages[0] || videoPoster || ''
  };

  // Sync to server API so Supabase is updated and server cache is
  // invalidated instantly. Previously swallowed every failure and never
  // checked the response, so a failed publish still showed "Success 🎉" to
  // the seller while nothing was actually created.
  const data = await apiFetch('/api/products/sync', { method: 'POST', body: { product: finalProduct } });
  if (!data.success) {
    throw new Error(data.error || 'Failed to publish listing.');
  }

  return data.product || finalProduct;
}

/** Length/tone preset — mirrors server.ts's AI_STYLE_PRESETS exactly (that's
 * the only place word-count ranges are actually defined; this type just
 * names the three valid choices for the UI). */
export type AiDescriptionStyleMobile = 'short' | 'standard' | 'detailed';

export interface ListingDescriptionInputMobile {
  category: string;
  title: string;
  condition?: string;
  price?: string | number;
  location?: string;
  brand?: string;
  negotiable?: boolean;
  isExchangeable?: boolean;
  existingDescription?: string;
  /** Up to 3 entries — each either an already-uploaded Cloudinary URL (typical case, since photos upload on pick) or a `data:image/jpeg;base64,...` fallback for one not yet uploaded. */
  images?: string[];
  /** Defaults server-side to 'standard' when omitted. */
  style?: AiDescriptionStyleMobile;
}

// Thin client for POST /api/ai/generate-listing-description — all prompt
// building and provider logic lives server-side so this behaves identically
// to the web app's generator. Never throws: mirrors apiFetch's own contract
// so SellScreen can just check `.success`. Uses a longer timeout than the
// app's other API calls — multimodal (image) generation genuinely takes
// longer than pure text.
export async function generateListingDescriptionMobile(
  input: ListingDescriptionInputMobile
): Promise<{ success: boolean; description?: string; warning?: string; error?: string }> {
  const data = await apiFetch('/api/ai/generate-listing-description', { method: 'POST', body: input, timeoutMs: 35000 });
  if (!data.success) {
    return { success: false, error: data.error || "Couldn't generate a description right now. You can write your description manually." };
  }
  return { success: true, description: data.description as string, warning: typeof data.warning === 'string' ? data.warning : undefined };
}

export async function deleteProductMobile(productId: string) {
  if (!productId) return;

  // Call server delete API so Cloudinary assets are purged, Supabase record
  // deleted, and server caches cleared. Previously swallowed every failure
  // (network error, 403 not-owner, 500) and never checked the response body,
  // so the UI always showed "Listing Deleted" even when nothing was deleted.
  const data = await apiFetch('/api/products/delete', { method: 'POST', body: { productId } });
  if (!data.success) {
    throw new Error(data.error || 'Could not delete listing.');
  }
}

export async function signIn(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

/** Matches web's resetPasswordEmail (src/context/AppContext.tsx) — tries the
 * server's branded reset email first, falls back to Firebase Auth's own
 * client-side email if the server asks for it. Was entirely missing on
 * mobile: a forgotten password meant permanent lockout with no recovery. */
export async function resetPasswordEmail(email: string) {
  const emailTarget = email.trim();
  if (!emailTarget || !emailTarget.includes('@')) {
    throw new Error('Please enter a valid email address.');
  }

  const data = await apiFetch('/api/auth/send-password-reset', {
    method: 'POST',
    body: { email: emailTarget },
  });
  if (data?.success) return;
  if (data?.fallback) {
    await sendPasswordResetEmail(auth, emailTarget);
    return;
  }
  // apiFetch never throws — a genuine network/timeout/malformed-response
  // failure (as opposed to a real server-side error) surfaces here as one of
  // these error codes, and is worth a direct attempt via the Firebase SDK
  // rather than failing outright.
  if (data?.errorCode === 'NETWORK' || data?.errorCode === 'TIMEOUT' || data?.errorCode === 'PARSE') {
    await sendPasswordResetEmail(auth, emailTarget);
    return;
  }
  throw new Error(data?.error || data?.message || 'Password reset request could not be completed.');
}

/** Matches web's sendVerificationEmailReal (src/context/AppContext.tsx) —
 * same Firebase client SDK call. Web gates chat, WhatsApp contact, posting an
 * ad, and reviews behind email verification; mobile had none of these gates. */
export async function sendVerificationEmail() {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) throw new Error('No active authentication session found.');
  await sendEmailVerification(firebaseUser);
}

/** Matches web's reloadUserVerificationStatus — reloads the Firebase Auth
 * user, and if now verified, syncs emailVerified:true to the user's own
 * Supabase profile via /api/users/sync (never a direct client write). */
export async function reloadEmailVerificationStatus(): Promise<boolean> {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) return false;
  await firebaseUser.reload();
  const isVerified = auth.currentUser?.emailVerified || false;
  if (isVerified) {
    try {
      const myProfile = await fetchUserById(firebaseUser.uid);
      if (myProfile) {
        await apiFetch('/api/users/sync', {
          method: 'POST',
          body: { user: { ...myProfile, id: firebaseUser.uid, emailVerified: true } },
        });
      }
    } catch (err) {
      console.warn('[reloadEmailVerificationStatus] Could not sync emailVerified to profile:', err);
    }
  }
  return isVerified;
}

import { isReservedStoreName } from './types';
import { resolveProductImageUri } from './utils/productImage';

export async function signUp(email: string, password: string, username: string) {
  if (isReservedStoreName(username)) {
    throw new Error('This store name is reserved by TedBuy.');
  }
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(credential.user, { displayName: username });

  // User profiles are canonical in Supabase, written only through the
  // authenticated server API — /api/users/sync verifies the Firebase ID
  // token and only allows a user to write their own profile (id === uid).
  const newUser = {
    id: credential.user.uid,
    username: username.trim(),
    email: email.trim(),
    role: 'both',
    joinDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    followingSellers: [],
    savedProductIds: [],
    emailVerified: false,
  };
  // The Firebase Auth account above is already real and permanent at this
  // point — a failure here previously was only console.warn'd, so the app
  // told the user "Welcome to TedBuy!" while they actually had no Supabase
  // profile, and nothing ever retried it (fetchUserById just returns null
  // forever on every future sign-in, silently breaking Dashboard/Settings).
  // A couple of quick retries gives a transient network blip a real chance
  // to resolve itself; if it still fails, the user is told honestly rather
  // than shown a false success.
  let profileSynced = false;
  for (let attempt = 0; attempt < 3 && !profileSynced; attempt++) {
    const data = await apiFetch('/api/users/sync', { method: 'POST', body: { user: newUser } });
    if (data.success) {
      profileSynced = true;
    } else {
      console.warn(`[signUp] Profile sync attempt ${attempt + 1} failed:`, data.error);
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  if (!profileSynced) {
    throw new Error('Your account was created, but we could not finish setting up your profile. Please check your connection and try signing in again.');
  }
  return credential;
}

// The web OAuth client id from the SAME Firebase project (tedbuy-fb79a) that
// web's own Google sign-in already uses — visible in Firebase Console under
// Authentication > Sign-in method > Google > Web SDK configuration, or
// Google Cloud Console > APIs & Services > Credentials as the "Web client
// (auto created by Google Service)" entry. This is NOT the Android/iOS
// client id, even though this is a native/mobile sign-in — GoogleSignin
// needs it to request an id_token whose audience Firebase Auth will accept.
// Empty until that's filled in, which signInWithGoogle below checks for
// rather than failing with a cryptic native-SDK error.
const GOOGLE_WEB_CLIENT_ID = '735307724523-hojhs1sp150gvfccokckvclbs3a230gh.apps.googleusercontent.com';

// @react-native-google-signin/google-signin ships real native code with no
// Expo Go equivalent (unlike everything else this file imports) — a static
// top-level `import` of it would throw "native module not found" the
// instant this file loads, which is every screen in the app, breaking
// Expo Go entirely rather than just the Google sign-in feature. Deferred to
// a lazy require inside the two functions that actually need it, so Expo Go
// keeps working for everything else until a custom dev-client build (see
// app.json's ios/android googleServicesFile + package/bundleIdentifier,
// added alongside this) exists to actually run it.
function getGoogleSignInModule(): any {
  try {
    return require('@react-native-google-signin/google-signin').GoogleSignin;
  } catch (err) {
    throw new Error('Google sign-in requires a custom dev-client build — it is not available in Expo Go.');
  }
}

/** Call once at app startup (see App.tsx) — configuring more than once is
 * harmless, but never configuring before signInWithGoogle() leaves
 * GoogleSignin.signIn() unable to return a usable idToken. */
export function configureGoogleSignIn() {
  if (!GOOGLE_WEB_CLIENT_ID) return;
  try {
    getGoogleSignInModule().configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
  } catch (err) {
    // Expo Go, or the native module genuinely isn't present — sign-in itself
    // will surface a clear error when actually attempted; nothing to do here.
  }
}

/** Matches web's loginWithGoogle (src/context/AppContext.tsx) — same
 * Firebase project (tedbuy-fb79a), so signing in with the same Google
 * account here resolves to the exact same Firebase UID as on web, landing
 * in the same TedBuy account automatically; no separate account-linking
 * step needed. New-account creation mirrors signUp() above (an
 * authenticated /api/users/sync call, never a direct database write) —
 * unlike web, which still writes the new user doc client-side. */
export async function signInWithGoogle() {
  if (!GOOGLE_WEB_CLIENT_ID) {
    throw new Error('Google sign-in is not configured yet.');
  }
  const GoogleSignin = getGoogleSignInModule();
  await GoogleSignin.hasPlayServices();
  const response = await GoogleSignin.signIn();
  const idToken = response?.data?.idToken;
  if (!idToken) {
    throw new Error('Google sign-in did not return an authentication token.');
  }

  const credential = GoogleAuthProvider.credential(idToken);
  const userCred = await signInWithCredential(auth, credential);
  const firebaseUser = userCred.user;

  // First time this Google account has ever signed into TedBuy on any
  // platform — create the profile row, exactly like signUp() does for a
  // new email/password account.
  const existingProfile = await fetchUserById(firebaseUser.uid);
  if (!existingProfile) {
    const newUser = {
      id: firebaseUser.uid,
      username: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || `User_${firebaseUser.uid.substring(0, 5)}`,
      email: firebaseUser.email || undefined,
      role: 'both',
      joinDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      photoUrl: firebaseUser.photoURL || undefined,
      followingSellers: [],
      savedProductIds: [],
      // Google already verifies the email address itself.
      emailVerified: true,
      isGoogleAuth: true,
      authProvider: 'google.com',
    };
    let profileSynced = false;
    for (let attempt = 0; attempt < 3 && !profileSynced; attempt++) {
      const data = await apiFetch('/api/users/sync', { method: 'POST', body: { user: newUser } });
      if (data.success) {
        profileSynced = true;
      } else {
        console.warn(`[signInWithGoogle] Profile sync attempt ${attempt + 1} failed:`, data.error);
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
    if (!profileSynced) {
      throw new Error('Signed in, but we could not finish setting up your profile. Please check your connection and try again.');
    }
  }

  return userCred;
}

/**
 * Saves the device's Expo push token against the signed-in user's own row
 * server-side, so the backend can later send a real push notification (new
 * message, new follower, listing update) instead of the user only ever
 * learning about it if they happen to have the app open. Best-effort --
 * failure here (offline, server hiccup) shouldn't block anything else the
 * caller is doing, so this never throws.
 */
export async function registerPushToken(token: string) {
  if (!token || !auth.currentUser) return;
  try {
    const data = await apiFetch('/api/users/push-token', { method: 'POST', body: { pushToken: token, platform: Platform.OS } });
    if (!data.success) {
      console.warn('[registerPushToken] Server rejected push token registration:', data.error);
    }
  } catch (err) {
    console.warn('[registerPushToken] Failed to register push token:', err);
  }
}

/**
 * Marks the signed-in user as active right now. "Online" is always derived
 * server-side from how recently this was last called (see server.ts's
 * computeIsOnline), not a stored boolean -- matches the WhatsApp-style
 * presence model App.tsx calls this from every 2 minutes while foregrounded
 * and signed in. Best-effort, same as registerPushToken -- a missed
 * heartbeat (offline, backgrounded, server hiccup) just means this user
 * shows as offline a little sooner than they actually went offline, never
 * an error the caller needs to handle.
 */
export async function sendPresenceHeartbeat() {
  if (!auth.currentUser) return;
  try {
    const data = await apiFetch('/api/users/heartbeat', { method: 'POST' });
    if (!data.success) {
      console.warn('[sendPresenceHeartbeat] Server rejected heartbeat:', data.error);
    }
  } catch (err) {
    console.warn('[sendPresenceHeartbeat] Failed to send heartbeat:', err);
  }
}

export async function logOut() {
  // The native Google Sign-In SDK keeps its own signed-in session on the
  // device, entirely separate from Firebase Auth -- signOut(auth) alone
  // never clears it, so a user who signs out and then taps "Sign in with
  // Google" again was silently re-signed into the same account instead of
  // seeing the account picker. Best-effort: the native module doesn't
  // exist in Expo Go, and a user who never used Google sign-in has no
  // session to clear either way, so any failure here is expected and safe
  // to ignore.
  try {
    await getGoogleSignInModule().signOut();
  } catch (err) {
    // Expo Go, module not configured, or no active Google session.
  }
  return signOut(auth);
}

/** Matches web's deleteAccount (src/context/AppContext.tsx) — same
 * super-admin guard, same server soft-deletion endpoint, then signs out.
 * Was entirely missing on mobile: there was no way to close an account. */
export async function deleteAccount(): Promise<{ message: string; underInvestigation: boolean }> {
  const currentUser = auth.currentUser;
  // Previously returned silently here (resolved successfully with no server
  // call at all) -- if the session had already been invalidated elsewhere
  // (e.g. handleSessionExpired's signOut firing from some other in-flight
  // request while the delete modal was still open), the screen still showed
  // "Account Closed... anonymized" for an account that was never touched.
  if (!currentUser) {
    throw new Error('Your session has expired. Please sign in again before deleting your account.');
  }

  const userEmail = currentUser.email?.trim()?.toLowerCase();
  if (userEmail === 'asumaduvincent7@gmail.com') {
    throw new Error('The super-administrator account is protected and cannot be deleted.');
  }

  // apiFetch attaches the current user's own verified ID token via
  // getAuthHeaderMobile() — no manual token/header wiring needed here.
  // Previously a failure here was only console.warn'd and sign-out happened
  // anyway — the user was told "Account Closed" even when the server never
  // actually deleted anything. Now a failure stops before sign-out and
  // propagates so the caller can show the real outcome.
  const data = await apiFetch('/api/auth/delete-account', { method: 'POST' });
  if (!data.success) {
    throw new Error(data.error || 'Could not delete your account right now. Please try again.');
  }

  await signOut(auth);
  // The server has two materially different outcomes for this same
  // success:true response -- a security-hold account is frozen/queued for
  // compliance review (evidence preserved, nothing anonymized) rather than
  // the normal soft-delete/anonymize path. The caller previously always
  // showed a hardcoded "closed and anonymized" message regardless of which
  // one actually happened, telling a user under investigation something
  // factually wrong about their own account and data.
  return {
    message: data.message || 'Your account has been closed.',
    underInvestigation: !!data.underInvestigation,
  };
}

export function observeAuthState(callback: (user: any) => void) {
  return onAuthStateChanged(auth, callback);
}

// Underlies both fetchProducts (below, unchanged contract — always resolves
// with an array, used by call sites that don't distinguish empty-vs-failed)
// and watchProducts (which does distinguish, so the feed can tell a real
// network failure apart from a genuinely empty catalog instead of both
// silently rendering as "no products").
export async function fetchProductsWithStatus(limitCount = 24, searchQuery?: string, category?: string, noCache = false): Promise<{ products: any[]; failed: boolean }> {
  let apiUrl = `/api/products?page=1&limit=${limitCount}`;
  if (searchQuery && searchQuery.trim()) {
    apiUrl += `&q=${encodeURIComponent(searchQuery.trim())}`;
  }
  if (category && category !== 'All' && category !== 'all') {
    apiUrl += `&category=${encodeURIComponent(category.trim())}`;
  }
  if (noCache) {
    apiUrl += '&nocache=true';
  }
  // Routed through apiFetch() -- a raw fetch() here had no AbortController,
  // so a stalled connection left watchProducts() (and every screen it feeds)
  // spinning forever with no error to recover from, same failure mode
  // fetchProductById used to have before it was fixed the same way.
  const data = await apiFetch(apiUrl);
  if (data.success && Array.isArray(data.products)) {
    return { products: data.products, failed: false };
  }
  console.warn('[mobile fetchProducts] Server returned an unsuccessful response:', data?.error);
  return { products: [], failed: true };
}

export async function fetchProducts(limitCount = 24, searchQuery?: string, category?: string) {
  const { products } = await fetchProductsWithStatus(limitCount, searchQuery, category);
  return products;
}

/** Matches web's SearchSuggestions server-fallback fetch (150ms debounce
 * lives in the caller) — queries the FULL server-side catalog via
 * getPrefixAutocompleteSuggestions, not just whatever page of products is
 * already loaded client-side. Previously mobile's search only ever
 * autocompleted against its local ~200-product page, missing anything
 * beyond it that web's server-backed suggestions would surface. */
export async function fetchSearchSuggestions(query: string, limitCount = 8): Promise<import('./utils/searchAutocomplete').AutocompleteSuggestion[]> {
  if (!query.trim()) return [];
  const data = await apiFetch(`/api/search/suggestions?q=${encodeURIComponent(query)}&limit=${limitCount}`);
  if (data.success && Array.isArray(data.items)) return data.items;
  return [];
}

/** Matches web's VideoAdsFeed loadNextBatch — same /api/video-ads endpoint
 * (server-side Fisher-Yates shuffle, excludes already-seen IDs, replays the
 * pool once exhausted rather than truly ending). Previously mobile's video
 * feed was just a filter over the same bounded 200-product page as the main
 * grid, with no onEndReached handler — it silently stopped once scrolled
 * past all video items in that page, unlike web's effectively endless feed. */
export async function fetchVideoAds(limitCount = 5, excludeIds: string[] = []): Promise<any[]> {
  let apiUrl = `/api/video-ads?limit=${limitCount}`;
  if (excludeIds.length > 0) {
    apiUrl += `&exclude=${encodeURIComponent(excludeIds.join(','))}`;
  }
  const data = await apiFetch(apiUrl);
  if (data.success && Array.isArray(data.products)) {
    return data.products;
  }
  return [];
}

// Throws on a genuine network/timeout/malformed-response failure — a reachable
// server saying "not found" still resolves to null, exactly as before. This
// lets ProductDetailScreen show "check your connection, try again" instead of
// "this listing has expired/been sold" for what might just be a dropped
// connection.
export async function fetchProductById(productId: string, noCache = false) {
  // Previously a raw, un-timed-out fetch() — unlike every other request in
  // this file, which goes through apiFetch()'s AbortController. On a slow
  // or dropped connection this could hang forever with no way to recover,
  // which is exactly what made "Mark Sold" (built on updateProduct below,
  // which calls this first) spin indefinitely instead of ever erroring out.
  const url = noCache ? `/api/products/${productId}?nocache=true` : `/api/products/${productId}`;
  const data = await apiFetch(url);
  if (data.errorCode === 'NETWORK' || data.errorCode === 'TIMEOUT' || data.errorCode === 'PARSE') {
    throw new Error(data.error);
  }
  return data.success && data.product ? data.product : null;
}

export async function fetchUserById(userId: string) {
  if (!userId) return null;
  try {
    const data = await apiFetch(`/api/users/get?id=${encodeURIComponent(userId)}`);
    if (data.success && data.user) {
      let user = data.user;
      // The cached emailVerified column only ever gets corrected when
      // reloadEmailVerificationStatus() runs — previously that only
      // happened if the user found and tapped "I Have Verified" inside the
      // blocking modal. A user who verifies by clicking the link straight
      // from their inbox (the normal path) leaves Firebase Auth correctly
      // marked verified while this cached profile stays stuck false
      // forever, keeping every emailVerified-gated action (posting,
      // reviews, chat, WhatsApp) blocked with no way out. Self-heal it
      // here, for every screen that loads the signed-in user's own
      // profile, not just the one screen with a manual recheck button.
      // Inlined (not calling reloadEmailVerificationStatus(), which itself
      // calls fetchUserById) to avoid recursing back into this function.
      if (!user.emailVerified && auth.currentUser?.uid === userId) {
        try {
          await auth.currentUser.reload();
          if (auth.currentUser?.emailVerified) {
            user = { ...user, emailVerified: true };
            apiFetch('/api/users/sync', {
              method: 'POST',
              body: { user: { ...user, id: userId, emailVerified: true } },
            }).catch((err) => console.warn('[fetchUserById] Could not persist reconciled emailVerified:', err));
          }
        } catch (err) {
          console.warn('[fetchUserById] emailVerified reconcile failed:', err);
        }
      }
      return user;
    }
  } catch (err) {
    console.warn('[fetchUserById Error]', err);
  }
  return null;
}

// The optional second callback argument is additive — existing callers that
// only destructure `(products) => ...` are unaffected. A screen that wants to
// show "Couldn't load listings, try again" instead of a silent empty grid on
// a real network failure (as opposed to a genuinely empty catalog) can read
// it; everyone else keeps working exactly as before.
// Shared across every watchProducts() caller -- this app has no global
// products store (unlike web's AppContext), so ~10 different screens
// (Home, Search, Profile, ForYou, Trending, Featured, Seller Profile,
// Discover Sellers, Saved Products, Product Detail) each independently
// called watchProducts() on mount, each firing its own fresh 200-item
// fetch with zero sharing -- visiting even 3-4 screens re-downloaded and
// re-parsed the same ~200-item catalog 3-4 separate times. This cache
// lets near-simultaneous/rapid callers (mounting around the same time, or
// switching tabs within the window below) share one in-flight request and
// its result, instead of each firing their own. 45s is long enough to
// dedupe realistic tab-switching during a single session, short enough
// that a genuinely stale view is unlikely to matter for a "browse the
// catalog" screen (every screen that needs a guaranteed-fresh read after
// an action already uses noCache=true, which always bypasses this).
let productsCache: { data: any[]; timestamp: number } | null = null;
let productsCacheInFlight: Promise<{ products: any[]; failed: boolean }> | null = null;
const PRODUCTS_CACHE_TTL_MS = 45 * 1000;

export function watchProducts(callback: (products: any[], failed?: boolean) => void, noCache = false) {
  let active = true;
  const load = async () => {
    if (!noCache && productsCache && (Date.now() - productsCache.timestamp) < PRODUCTS_CACHE_TTL_MS) {
      if (active) callback(productsCache.data, false);
      return;
    }
    if (!noCache && productsCacheInFlight) {
      const result = await productsCacheInFlight;
      if (active) callback(result.products, result.failed);
      return;
    }
    const fetchPromise = fetchProductsWithStatus(200, undefined, undefined, noCache);
    if (!noCache) productsCacheInFlight = fetchPromise;
    const { products, failed } = await fetchPromise;
    if (!noCache) {
      productsCacheInFlight = null;
      if (!failed) productsCache = { data: products, timestamp: Date.now() };
    }
    if (active) callback(products, failed);
  };
  load();
  return () => {
    active = false;
  };
}

// Deliberately polled, NOT a realtime listener on the whole `users` collection:
// that would re-download every user's record on any single user's presence
// write, anywhere in the app — the same O(users^2) egress bug already fixed
// on web (see AppContext.tsx). A periodic pull keeps names/photos/online
// status fresh enough for a marketplace without that blowup. Interval
// matches the 90s online-presence threshold (server.ts's
// ONLINE_THRESHOLD_MS) rather than being independently chosen -- polling
// slower than that would show a stale "online" for longer than the status
// itself is actually considered valid server-side.
//
// Goes through /api/users/list (Supabase), NOT a direct Firestore read of
// `users` like this used to do. That Firestore collection is only a mirror
// of the real Supabase table and can drift out of sync with it — confirmed
// live: a seller's Supabase username was "Richie" while their Firestore
// mirror still said "Vince", so the Popular Stores card (this function's
// data) showed one name while tapping into their actual profile (fetched
// via /api/users/get, correctly Supabase-sourced) showed the other. This
// closes that gap at the source instead of leaving a second, driftable copy
// of user data in play.
export function watchUsers(callback: (users: any[]) => void) {
  let active = true;

  const fetchOnce = async () => {
    try {
      const data = await apiFetch('/api/users/list');
      if (!active) return;
      if (data.success && Array.isArray(data.users)) {
        callback(data.users);
      } else {
        console.warn('[watchUsers] Server returned an unsuccessful response:', data?.error);
      }
    } catch (err) {
      console.warn('[watchUsers] fetch error:', err);
    }
  };

  fetchOnce();
  const interval = setInterval(fetchOnce, 60 * 1000);
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') fetchOnce();
  });

  return () => {
    active = false;
    clearInterval(interval);
    subscription.remove();
  };
}

/** Matches web's toggleSaveProduct (src/context/AppContext.tsx) — the real
 * bookmark mechanism: updates the CURRENT USER's own savedProductIds array,
 * not the product record. Mobile's bookmark button was previously wired to
 * toggleLikeProduct() below instead, which writes to the PRODUCT's
 * likedUserIds via /api/products/sync — an endpoint that correctly rejects
 * non-owners with "Forbidden: You do not have permission to modify this
 * listing", since bookmarking someone else's listing should never require
 * owning it. Bookmarking your own user profile's saved list has no such
 * ownership conflict (verified server-side in /api/users/sync: isOwner ||
 * isAdmin), which is why this fixes the 403. */
export async function toggleSaveProductRemote(productId: string, currentSavedIds: string[]): Promise<string[]> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('You must be logged in to save deals.');
  const myProfile = await fetchUserById(currentUser.uid);
  if (!myProfile) throw new Error('Could not load your profile.');
  const saved = Array.isArray(currentSavedIds) ? currentSavedIds : [];
  const updatedSaved = saved.includes(productId)
    ? saved.filter((id) => id !== productId)
    : [...saved, productId];
  const updatedUser = { ...myProfile, id: currentUser.uid, savedProductIds: updatedSaved };
  const data = await apiFetch('/api/users/sync', { method: 'POST', body: { user: updatedUser } });
  if (!data.success) {
    throw new Error(data.error || 'Could not update favorites.');
  }
  return updatedSaved;
}

export async function toggleLikeProduct(id: string, userId: string) {
  const product = await fetchProductById(id);
  if (!product) {
    throw new Error('Product not found.');
  }

  const currentLikedUserIds = Array.isArray(product.likedUserIds) ? product.likedUserIds : [];
  const hasLiked = currentLikedUserIds.includes(userId);
  const nextLikedUserIds = hasLiked
    ? currentLikedUserIds.filter((uid: string) => uid !== userId)
    : [...currentLikedUserIds, userId];

  const updated = {
    ...product,
    likedUserIds: nextLikedUserIds,
    likesCount: nextLikedUserIds.length
  };

  // Previously swallowed every failure and never checked the response, so a
  // failed save silently left the UI showing "saved" when nothing persisted
  // (the callers' try/catch error handling was dead code as a result).
  const data = await apiFetch('/api/products/sync', { method: 'POST', body: { product: updated } });
  if (!data.success) {
    throw new Error(data.error || 'Could not update favorites.');
  }
}

/** Matches web's reportProduct (src/context/AppContext.tsx) — reports are a
 * Supabase-backed table (see dbAdapter's VALID_TABLE_MAP), so this goes
 * through the verified server endpoint rather than a direct Firestore write,
 * which would silently write to a table moderators never look at. Web also
 * auto-creates a support-desk chat thread as a receipt; that's a secondary
 * notification nicety layered on a different (legacy direct-write) chat path
 * mobile's canonical chat API doesn't expose, so it's intentionally omitted
 * here — the report itself is still fully recorded for moderation either way. */
export async function reportProduct(productId: string, reason: string, comment: string = '') {
  const product = await fetchProductById(productId);
  if (!product) {
    throw new Error('Product not found.');
  }

  const data = await apiFetch('/api/reports/create', {
    method: 'POST',
    body: { productId: product.id, productTitle: product.title || '', reason, comment },
  });
  if (!data.success) throw new Error(data.error || 'Failed to submit report.');
}

/** Matches web's reviews context state — reviews are a Supabase-backed table,
 * so this reads through the server API rather than Firestore directly, so
 * ratings a buyer leaves on web are visible on mobile and vice versa. */
export async function fetchReviewsForSeller(sellerId: string): Promise<any[]> {
  try {
    const data = await apiFetch(`/api/reviews?sellerId=${encodeURIComponent(sellerId)}`);
    return data.success ? data.reviews || [] : [];
  } catch (err) {
    console.warn('[fetchReviewsForSeller Error]', err);
    return [];
  }
}

/** Matches web's addReview (src/context/AppContext.tsx) — same validation
 * rules, routed through the server (Supabase-backed 'reviews' table) so a
 * review left on mobile shows up on web immediately and counts toward the
 * same trust score. */
export async function addReview(sellerId: string, rating: number, comment: string, productTitle?: string, chatId?: string) {
  const data = await apiFetch('/api/reviews/create', {
    method: 'POST',
    body: { sellerId, rating, comment, productTitle, chatId },
  });
  if (!data.success) throw new Error(data.error || 'Failed to submit review.');
  return data.review;
}

/** Matches web's markAsDelivered/markAsPickedUp (src/context/AppContext.tsx)
 * in effect, but NOT by writing to Firestore directly — mobile's chats live
 * in Supabase via the /api/chats* endpoints (see fetchChatsApi/sendMessageApi
 * below), so a direct Firestore write here was silently writing to a
 * database mobile's own chat list never reads from. Routes through the new
 * server endpoints instead, which update the correct (Supabase) backend. */
export async function markAsDelivered(chatId: string) {
  const data = await apiFetch('/api/chats/mark-delivered', { method: 'POST', body: { chatId } });
  if (!data.success) {
    throw new Error(data.error || 'Could not confirm delivery.');
  }
}

export async function markAsPickedUp(chatId: string) {
  const data = await apiFetch('/api/chats/mark-picked-up', { method: 'POST', body: { chatId } });
  if (!data.success) {
    throw new Error(data.error || 'Could not confirm pickup.');
  }
}

/** Matches web's notifications state (src/context/AppContext.tsx) — web reads
 * the 'notifications' table directly with its own Supabase client; mobile has
 * no such client, so this polls the same table through the verified server
 * API instead. This entire feed was previously absent on mobile. */
export async function fetchNotifications(): Promise<any[]> {
  try {
    const data = await apiFetch('/api/notifications');
    return data.success ? data.notifications || [] : [];
  } catch (err) {
    console.warn('[fetchNotifications Error]', err);
    return [];
  }
}

export async function markNotificationAsRead(id: string) {
  const data = await apiFetch('/api/notifications/mark-read', { method: 'POST', body: { id } });
  if (!data.success) throw new Error(data.error || 'Could not mark notification as read.');
}

export async function markAllNotificationsAsRead() {
  const data = await apiFetch('/api/notifications/mark-all-read', { method: 'POST' });
  if (!data.success) throw new Error(data.error || 'Could not mark notifications as read.');
}

export async function clearAllNotifications() {
  const data = await apiFetch('/api/notifications/clear-all', { method: 'POST' });
  if (!data.success) throw new Error(data.error || 'Could not clear notifications.');
}

/** Matches web's BoostModal verification call (src/components/BoostModal.tsx)
 * — same /api/verify-payment endpoint, which only the authenticated seller
 * of the listing (or an admin) may call. Web currently runs this in demo
 * mode (no live Paystack keys configured), so mobile mirrors that same
 * simulated momo/card flow rather than a real charge. */
export async function activateBoost(
  productId: string,
  planId: string,
  paymentMethod: string,
  amountGHS: number,
  paymentReference: string
) {
  const data = await apiFetch('/api/verify-payment', {
    method: 'POST',
    body: { productId, planId, paymentMethod, amountGHS, paymentReference },
  });
  if (!data.success) {
    const err: any = new Error(data.error || 'Payment verification failed.');
    // Lets callers (BoostModal's checkout-close reconciliation) tell "we
    // genuinely couldn't reach/parse the verification call, so we don't
    // actually know if the payment went through" apart from "the server
    // ran the check and confirmed this reference was never paid" -- the
    // first case is worth surfacing to the user (a real charge could have
    // gone through with nothing to show for it), the second is a safe,
    // silent cancel.
    err.errorCode = data.errorCode;
    throw err;
  }
  return data.product;
}

/** Starts a real Paystack transaction server-side (mobile has no browser to
 * run web's inline.js popup) and returns a hosted checkout URL to open in a
 * WebView, plus the real reference to verify afterward via activateBoost. */
export async function initializeBoostPayment(
  productId: string,
  planId: string
): Promise<{ success: boolean; authorizationUrl?: string; reference?: string; error?: string }> {
  const data = await apiFetch('/api/paystack/initialize-boost', {
    method: 'POST',
    body: { productId, planId },
  });
  if (!data.success) {
    return { success: false, error: data.error || 'Could not start payment. Please try again.' };
  }
  return { success: true, authorizationUrl: data.authorizationUrl, reference: data.reference };
}

/** Matches web's followSeller/unfollowSeller (src/context/AppContext.tsx) —
 * routed through a dedicated server endpoint (rather than a generic profile
 * sync) so the seller also gets a 'new_follower' notification on a new
 * follow, same as web. */
export async function toggleFollowSeller(sellerId: string, currentUserId: string) {
  if (!sellerId || !currentUserId) throw new Error('Could not update follow status.');

  // Previously returned silently here on a failed profile lookup — every
  // caller's optimistic UI update then had no error to roll back on, so a
  // network blip made a follow button look successful when nothing saved.
  const myProfile = await fetchUserById(currentUserId);
  if (!myProfile) throw new Error('Could not load your profile. Please check your connection and try again.');
  const following: string[] = Array.isArray(myProfile.followingSellers) ? myProfile.followingSellers : [];
  const follow = !following.includes(sellerId);

  const data = await apiFetch('/api/users/follow', {
    method: 'POST',
    body: { sellerId, follow }
  });
  if (!data.success) {
    throw new Error(data.error || 'Could not update follow status');
  }
}

/** Matches web's updateUserProfile (src/context/AppContext.tsx) — same
 * /api/users/sync path, same reserved-name guard, same partial-update
 * semantics (omitted fields keep their current value). This was entirely
 * missing on mobile: there was no way at all to set/edit username, phone,
 * WhatsApp number, or avatar — the exact fields buyers use to reach a
 * seller, so a mobile-only seller had no way to be contacted. */
export interface NotificationPreferences {
  newFollower: boolean;
  newMessage: boolean;
  followedSellerNewListing: boolean;
}

export async function updateUserProfile(profileData: {
  username?: string;
  phoneNumber?: string;
  whatsAppNumber?: string;
  photoUrl?: string;
  role?: 'buyer' | 'seller' | 'both';
  bio?: string;
  notificationPreferences?: Partial<NotificationPreferences>;
}) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('You must be logged in to update your profile.');

  const myProfile = await fetchUserById(currentUser.uid);
  if (!myProfile) throw new Error('Could not load your profile.');

  const finalUsername = profileData.username !== undefined ? profileData.username.trim() : (myProfile.username || '');
  // Only validate the username when THIS call is actually changing it --
  // these checks used to run unconditionally, so a stored username that
  // predates this validation (or was ever grandfathered in over the 50-char
  // cap through some other path) permanently blocked every future
  // profile-only edit (avatar, bio, phone, notification prefs -- anything
  // that omits `username` and so falls back to the stale stored value)
  // with a "Store Name must be 50 characters or less" error that had
  // nothing to do with what the user was actually trying to save.
  if (profileData.username !== undefined) {
    if (!finalUsername) throw new Error('Store Name is required.');
    if (finalUsername.length > 50) throw new Error('Store Name must be 50 characters or less.');
  }
  const isStoreNameChanged = profileData.username !== undefined && finalUsername !== myProfile.username;
  if (isStoreNameChanged && isReservedStoreName(finalUsername)) {
    throw new Error('This store name is reserved by TedBuy.');
  }

  const finalPhoneNumber = profileData.phoneNumber !== undefined ? (profileData.phoneNumber.trim() || undefined) : myProfile.phoneNumber;
  if (finalPhoneNumber && finalPhoneNumber.length > 25) throw new Error('Phone number must be under 25 characters.');
  const finalWhatsAppNumber = profileData.whatsAppNumber !== undefined ? (profileData.whatsAppNumber.trim() || undefined) : myProfile.whatsAppNumber;
  if (finalWhatsAppNumber && finalWhatsAppNumber.length > 25) throw new Error('WhatsApp number must be under 25 characters.');
  const finalPhotoUrl = profileData.photoUrl !== undefined ? profileData.photoUrl : myProfile.photoUrl;
  const finalRole = profileData.role !== undefined ? profileData.role : (myProfile.role || 'both');
  const finalBio = profileData.bio !== undefined ? profileData.bio.trim() : myProfile.bio;
  if (finalBio && finalBio.length > 160) throw new Error('Bio must be 160 characters or less.');
  // Merge (not replace) so toggling one notification type doesn't silently
  // reset the other two back to their defaults.
  const finalNotificationPreferences = profileData.notificationPreferences !== undefined
    ? { ...(myProfile.notificationPreferences || {}), ...profileData.notificationPreferences }
    : myProfile.notificationPreferences;

  const updatedUser = {
    ...myProfile,
    id: currentUser.uid,
    username: finalUsername,
    phoneNumber: finalPhoneNumber,
    whatsAppNumber: finalWhatsAppNumber,
    photoUrl: finalPhotoUrl,
    role: finalRole,
    ...(profileData.bio !== undefined ? { bio: finalBio } : {}),
    ...(finalNotificationPreferences !== undefined ? { notificationPreferences: finalNotificationPreferences } : {}),
  };

  try {
    await updateProfile(currentUser, { displayName: finalUsername, photoURL: finalPhotoUrl || null });
  } catch (authErr) {
    console.warn('[updateUserProfile] Firebase Auth SDK profile update warning:', authErr);
  }

  const data = await apiFetch('/api/users/sync', { method: 'POST', body: { user: updatedUser } });
  if (!data.success) {
    throw new Error(data.error || 'Could not update profile.');
  }

  // Matches web's updateUserProfile (src/context/AppContext.tsx) -- was
  // entirely missing on mobile. Renaming a store here previously updated
  // the profile itself, but every already-published listing kept showing
  // the old sellerName until each was individually re-saved. (Web also
  // patches its own in-memory chats/reviews state on rename, but never
  // persists that to the database either -- a session-only cosmetic touch
  // with no mobile equivalent to port, since mobile has no comparable
  // shared state object; the real, durable fix is this products
  // reconciliation.) Best-effort, non-blocking -- a reconciliation failure
  // here shouldn't fail the profile save that already succeeded above.
  if (isStoreNameChanged) {
    fetchProductsForSeller(currentUser.uid, myProfile.email).then((sellerProducts) => {
      if (sellerProducts.length === 0) return;
      Promise.all(
        sellerProducts.map((p) =>
          apiFetch('/api/products/sync', { method: 'POST', body: { product: { ...p, sellerName: finalUsername } } }).catch(() => {})
        )
      ).catch(() => {});
    }).catch(() => {});
  }

  return updatedUser;
}

// ---------------------------------------------------------------------------
// Chats & Messages — authenticated API (canonical path)
// ---------------------------------------------------------------------------
// All chat/message reads and writes go through the TedBuy server, which
// verifies the Firebase ID token and enforces that a user may only see or
// act on chats where they are the buyer or seller. Sender identity is always
// derived server-side from the verified token — this file never sends a
// senderId/buyerId and expects it to be trusted.

// Throws on a genuine failure (network/timeout/server) so the inbox can tell
// "couldn't load" apart from "you truly have no conversations yet" — the
// caller (ChatsScreen) only surfaces this on the very first load, not on a
// transient background-poll blip once chats are already showing.
export async function fetchChatsApi(): Promise<any[]> {
  const data = await apiFetch('/api/chats');
  if (data.success && Array.isArray(data.chats)) return data.chats;
  console.warn('[fetchChatsApi Error]', data.error);
  throw apiErrorFromResponse(data, 'Could not load your conversations.');
}

export async function fetchMessagesApi(chatId: string, before?: string): Promise<any[]> {
  if (!chatId) return [];
  const qs = before ? `?before=${encodeURIComponent(before)}` : '';
  const data = await apiFetch(`/api/messages/${encodeURIComponent(chatId)}${qs}`);
  if (data.success && Array.isArray(data.messages)) return data.messages;
  console.warn('[fetchMessagesApi Error]', data.error);
  throw apiErrorFromResponse(data, 'Could not load this conversation.');
}

export async function startChatApi(productId: string, initialMessage?: string): Promise<string> {
  const data = await apiFetch('/api/chats/start', {
    method: 'POST',
    body: { productId, initialMessage }
  });
  if (!data.success) {
    throw apiErrorFromResponse(data, 'Could not start chat');
  }
  return data.chatId;
}

export async function sendMessageApi(chatId: string, text: string): Promise<any> {
  const data = await apiFetch('/api/messages/send', {
    method: 'POST',
    body: { chatId, text }
  });
  if (!data.success) {
    throw apiErrorFromResponse(data, 'Could not send message');
  }
  return data.message;
}

export async function markChatReadApi(chatId: string): Promise<void> {
  try {
    await apiFetch('/api/messages/mark-read', { method: 'POST', body: { chatId } });
  } catch (err) {
    console.warn('[markChatReadApi Error]', err);
  }
}

/** Matches web's sendTypingStatus/typing listener (AppContext.tsx +
 * ChatInterface.tsx) exactly, including the 'chat_typing' collection name.
 * Unlike products/users/chats/messages, 'chat_typing' was never migrated to
 * Supabase (it's not in dbAdapter's VALID_TABLE_MAP) — web itself still
 * writes it straight to Firestore, so doing the same here isn't reintroducing
 * insecure direct access to a Supabase-backed collection; it's using the
 * same legacy Firestore path web already uses for this specific, ephemeral,
 * non-authoritative presence data (worst case someone fakes a "typing"
 * ping — there's no sensitive read/write or business logic at stake). */
export async function sendTypingStatus(chatId: string, isTyping: boolean) {
  const currentUser = auth.currentUser;
  if (!currentUser || !chatId) return;
  try {
    await setDoc(doc(db, 'chat_typing', chatId), {
      [currentUser.uid]: isTyping ? Date.now() : 0
    }, { merge: true });
  } catch (err) {
    console.warn('[sendTypingStatus Error]', err);
  }
}

const TYPING_STALE_MS = 4500;

export function watchTypingStatus(chatId: string, callback: (isPeerTyping: boolean) => void) {
  const currentUser = auth.currentUser;
  if (!chatId || !currentUser) {
    callback(false);
    return () => {};
  }
  return onSnapshot(doc(db, 'chat_typing', chatId), (snap) => {
    const data: any = snap.exists() ? snap.data() : {};
    const now = Date.now();
    let typing = false;
    Object.entries(data || {}).forEach(([userId, timestamp]) => {
      if (userId !== currentUser.uid) {
        const ts = Number(timestamp) || 0;
        if (ts > 0 && now - ts < TYPING_STALE_MS) typing = true;
      }
    });
    callback(typing);
  }, (err) => {
    console.warn('[watchTypingStatus Error]', err);
  });
}

export async function updateProduct(id: string, data: Partial<any>) {
  // Products are canonically stored in Supabase (synced via /api/products/sync),
  // not Firestore — a raw Firestore write here would never reach the record
  // fetchProducts/fetchProductById actually read.
  const product = await fetchProductById(id, true);
  if (!product) {
    // Previously returned undefined silently instead of throwing --
    // fetchProductById collapses "genuinely not found" and "server
    // responded but with success:false" into the same null result (it only
    // throws for NETWORK/TIMEOUT/PARSE), so a transient non-network failure
    // here looked identical to nothing having gone wrong at all. Callers
    // (ProfileScreen.tsx/ProductCard.tsx handleSoldToggle) then showed a
    // "Listing Sold!" success alert regardless, since nothing told them the
    // call had actually failed.
    throw new Error('Could not load this listing to update it. Please try again.');
  }

  const patchData = { ...data };
  if (patchData.isSold !== undefined) {
    const nextSold = patchData.isSold === true;
    patchData.isSold = nextSold;
    if (nextSold) {
      patchData.status = 'sold';
      if (!patchData.soldAt) patchData.soldAt = new Date().toISOString();
    } else {
      patchData.status = 'active';
      patchData.soldAt = null;
    }
  } else if (patchData.status === 'sold') {
    patchData.isSold = true;
    if (!patchData.soldAt) patchData.soldAt = new Date().toISOString();
  } else if (patchData.status === 'active') {
    patchData.isSold = false;
    patchData.soldAt = null;
  }

  const updated = { ...product, ...patchData };
  if (patchData.isSold === false) {
    updated.status = 'active';
    updated.isSold = false;
    updated.soldAt = null;
  } else if (patchData.isSold === true) {
    updated.status = 'sold';
    updated.isSold = true;
  }

  const resData = await apiFetch('/api/products/sync', { method: 'POST', body: { product: updated } });
  if (!resData.success) {
    throw new Error(resData.error || 'Failed to update product');
  }
  return resData.product;
}

const VIEW_COOLDOWN_MS = 10 * 60 * 1000; // matches web's view-fraud cooldown
const VIEW_TIMESTAMPS_KEY = 'tedbuy_view_timestamps';

/** Real view tracking — previously viewsCount was only ever initialized to 0
 * at creation and never incremented anywhere on mobile, so "popular stores"
 * ranking by views had no real signal to use. Goes through the same
 * /api/products/sync social-only path as likes (server now allows
 * non-owners to touch just this field), with the same per-device 10-minute
 * cooldown web uses to stop a single visitor from inflating one product's
 * count by reopening it repeatedly. */
export async function trackProductView(productId: string) {
  try {
    let timestamps: Record<string, number> = {};
    try {
      const raw = await AsyncStorage.getItem(VIEW_TIMESTAMPS_KEY);
      if (raw) timestamps = JSON.parse(raw);
    } catch {
      timestamps = {};
    }
    const now = Date.now();
    const lastViewedAt = timestamps[productId] || 0;
    if (now - lastViewedAt < VIEW_COOLDOWN_MS) return;

    const product = await fetchProductById(productId);
    if (!product) return;
    const updated = { ...product, viewsCount: (Number(product.viewsCount) || 0) + 1 };
    const resData = await apiFetch('/api/products/sync', { method: 'POST', body: { product: updated } });
    if (!resData.success) return;

    timestamps[productId] = now;
    await AsyncStorage.setItem(VIEW_TIMESTAMPS_KEY, JSON.stringify(timestamps));
  } catch (err) {
    console.warn('[trackProductView Error]', err);
  }
}

export async function fetchSellerListingCounts(): Promise<Record<string, number>> {
  const data = await apiFetch('/api/sellers/counts?nocache=true');
  return data?.counts || {};
}

export async function fetchProductsForSeller(sellerId: string, sellerEmail?: string): Promise<Product[]> {
  const query = new URLSearchParams({
    sellerId,
    limit: '1000',
    nocache: 'true',
  });
  if (sellerEmail) query.set('sellerEmail', sellerEmail);
  const data = await apiFetch(`/api/products?${query.toString()}`);
  if (data && Array.isArray(data.products)) {
    return data.products;
  }
  return [];
}
