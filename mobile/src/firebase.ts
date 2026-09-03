import { AppState, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import { initializeAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile, sendPasswordResetEmail, sendEmailVerification } from 'firebase/auth';
// @ts-ignore — getReactNativePersistence exists at runtime (Metro resolves the
// "react-native" package-export condition correctly) but the firebase package's
// bundled .d.ts doesn't pick up that condition, a long-standing upstream typing
// gap (firebase-js-sdk#9316, #8332, #7584) — this is a types-only miss.
import { getReactNativePersistence } from 'firebase/auth';
import { getFirestore, collection, getDocs, query, orderBy, limit, where, onSnapshot, doc, getDoc, addDoc, setDoc, updateDoc } from 'firebase/firestore';

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
async function apiFetch(path: string, options: { method?: string; body?: any } = {}): Promise<any> {
  const authHeaders = await getAuthHeaderMobile();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

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
      console.warn(`[apiFetch] Timed out after ${API_TIMEOUT_MS}ms: ${path}`);
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

  try {
    const result = await new Promise<{ success: boolean; result?: any; error?: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', serverUrl, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
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

  const videoPoster = (cloudinaryVideos[0] && cloudinaryVideos[0].includes('res.cloudinary.com'))
    ? cloudinaryVideos[0].replace(/\.[a-zA-Z0-9]+$/, '.jpg').replace('/upload/', '/upload/so_0,f_jpg,q_auto,w_800/')
    : '';

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
    videoPoster: videoPoster || productData.videoPoster || '',
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

export async function logOut() {
  return signOut(auth);
}

/** Matches web's deleteAccount (src/context/AppContext.tsx) — same
 * super-admin guard, same server soft-deletion endpoint, then signs out.
 * Was entirely missing on mobile: there was no way to close an account. */
export async function deleteAccount() {
  const currentUser = auth.currentUser;
  if (!currentUser) return;

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
}

export function observeAuthState(callback: (user: any) => void) {
  return onAuthStateChanged(auth, callback);
}

// Underlies both fetchProducts (below, unchanged contract — always resolves
// with an array, used by call sites that don't distinguish empty-vs-failed)
// and watchProducts (which does distinguish, so the feed can tell a real
// network failure apart from a genuinely empty catalog instead of both
// silently rendering as "no products").
export async function fetchProductsWithStatus(limitCount = 24, searchQuery?: string, category?: string): Promise<{ products: any[]; failed: boolean }> {
  try {
    const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://www.tedbuy.store';
    let apiUrl = `${origin}/api/products?page=1&limit=${limitCount}`;
    if (searchQuery && searchQuery.trim()) {
      apiUrl += `&q=${encodeURIComponent(searchQuery.trim())}`;
    }
    if (category && category !== 'All' && category !== 'all') {
      apiUrl += `&category=${encodeURIComponent(category.trim())}`;
    }
    const res = await fetch(apiUrl);
    const data = await res.json();
    if (data.success && Array.isArray(data.products)) {
      return { products: data.products, failed: false };
    }
    console.warn('[mobile fetchProducts] Server returned an unsuccessful response:', data?.error);
  } catch (err) {
    console.warn('[mobile fetchProducts Error]', err);
    return { products: [], failed: true };
  }
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
  try {
    const res = await fetch(`${apiOrigin()}/api/search/suggestions?q=${encodeURIComponent(query)}&limit=${limitCount}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.items)) return data.items;
  } catch (err) {
    console.warn('[fetchSearchSuggestions Error]', err);
  }
  return [];
}

/** Matches web's VideoAdsFeed loadNextBatch — same /api/video-ads endpoint
 * (server-side Fisher-Yates shuffle, excludes already-seen IDs, replays the
 * pool once exhausted rather than truly ending). Previously mobile's video
 * feed was just a filter over the same bounded 200-product page as the main
 * grid, with no onEndReached handler — it silently stopped once scrolled
 * past all video items in that page, unlike web's effectively endless feed. */
export async function fetchVideoAds(limitCount = 5, excludeIds: string[] = []): Promise<any[]> {
  try {
    const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://www.tedbuy.store';
    let apiUrl = `${origin}/api/video-ads?limit=${limitCount}`;
    if (excludeIds.length > 0) {
      apiUrl += `&exclude=${encodeURIComponent(excludeIds.join(','))}`;
    }
    const res = await fetch(apiUrl);
    const data = await res.json();
    if (data.success && Array.isArray(data.products)) {
      return data.products;
    }
  } catch (err) {
    console.warn('[fetchVideoAds Error]', err);
  }
  return [];
}

export async function fetchChatsForUser(userId: string) {
  const qBuyer = query(collection(db, 'chats'), where('buyerId', '==', userId));
  const qSeller = query(collection(db, 'chats'), where('sellerId', '==', userId));
  const [buyerSnap, sellerSnap] = await Promise.all([getDocs(qBuyer), getDocs(qSeller)]);
  
  const chatMap = new Map<string, any>();
  buyerSnap.docs.forEach((docSnap) => chatMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() }));
  sellerSnap.docs.forEach((docSnap) => chatMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() }));
  
  return Array.from(chatMap.values()).sort((a, b) => {
    const timeA = a.lastMessageTime || '';
    const timeB = b.lastMessageTime || '';
    return timeB.localeCompare(timeA);
  });
}

// Throws on a genuine network/timeout/malformed-response failure — a reachable
// server saying "not found" still resolves to null, exactly as before. This
// lets ProductDetailScreen show "check your connection, try again" instead of
// "this listing has expired/been sold" for what might just be a dropped
// connection.
export async function fetchProductById(productId: string) {
  const apiUrl = typeof window !== 'undefined' && window.location?.origin
    ? `${window.location.origin}/api/products/${productId}`
    : `https://www.tedbuy.store/api/products/${productId}`;

  let res: Response;
  try {
    res = await fetch(apiUrl);
  } catch (err) {
    console.warn('[mobile fetchProductById] Network error:', err);
    throw new Error("You're offline. Check your internet connection and try again.");
  }

  let data: any;
  try {
    data = await res.json();
  } catch (err) {
    console.warn('[mobile fetchProductById] Malformed response:', err);
    throw new Error('TedBuy sent back an unexpected response. Please try again.');
  }

  return data.success && data.product ? data.product : null;
}

export async function fetchUserById(userId: string) {
  if (!userId) return null;
  try {
    const data = await apiFetch(`/api/users/get?id=${encodeURIComponent(userId)}`);
    if (data.success && data.user) return data.user;
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
export function watchProducts(callback: (products: any[], failed?: boolean) => void) {
  let active = true;
  const load = async () => {
    const { products, failed } = await fetchProductsWithStatus(200);
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
// status fresh enough for a marketplace without that blowup.
export function watchUsers(callback: (users: any[]) => void) {
  let active = true;

  const fetchOnce = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      if (!active) return;
      callback(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    } catch (err) {
      console.warn('[watchUsers] fetch error:', err);
    }
  };

  fetchOnce();
  const interval = setInterval(fetchOnce, 3 * 60 * 1000);
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') fetchOnce();
  });

  return () => {
    active = false;
    clearInterval(interval);
    subscription.remove();
  };
}

// ---------------------------------------------------------------------------
// LEGACY (Firestore direct access) — superseded by the authenticated API
// functions below (fetchChatsApi, fetchMessagesApi, startChatApi,
// sendMessageApi, markChatReadApi). No screen calls these anymore; kept
// temporarily, unused, as a rollback reference until the API path has been
// validated on real devices. Firestore chat/message/user data itself is left
// untouched — nothing here deletes it.
// ---------------------------------------------------------------------------
export function watchChats(userId: string, callback: (chats: any[]) => void) {
  const qBuyer = query(collection(db, 'chats'), where('buyerId', '==', userId));
  const qSeller = query(collection(db, 'chats'), where('sellerId', '==', userId));
  
  const chatMap = new Map<string, any>();
  
  const triggerUpdate = () => {
    const combined = Array.from(chatMap.values()).sort((a, b) => {
      const timeA = a.lastMessageTime || '';
      const timeB = b.lastMessageTime || '';
      return timeB.localeCompare(timeA);
    });
    callback(combined);
  };

  const unsub1 = onSnapshot(qBuyer, (snap) => {
    snap.forEach(docSnap => {
      chatMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
    });
    triggerUpdate();
  });

  const unsub2 = onSnapshot(qSeller, (snap) => {
    snap.forEach(docSnap => {
      chatMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
    });
    triggerUpdate();
  });

  return () => {
    unsub1();
    unsub2();
  };
}

export function watchMessages(chatId: string, callback: (messages: any[]) => void) {
  const q = query(collection(db, 'messages'), where('chatId', '==', chatId));
  return onSnapshot(q, (snap) => {
    const msgs = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    msgs.sort((a: any, b: any) => {
      const dateA = a.createdAt || '';
      const dateB = b.createdAt || '';
      return dateA.localeCompare(dateB);
    });
    callback(msgs);
  });
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
  if (!data.success) throw new Error(data.error || 'Payment verification failed.');
  return data.product;
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
  if (!finalUsername) throw new Error('Store Name is required.');
  if (finalUsername.length > 50) throw new Error('Store Name must be 50 characters or less.');
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
  return updatedUser;
}

export async function startChat(productId: string, initialMessage?: string) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication Required: Please sign in or create an account from the Profile tab.');

  const product = await fetchProductById(productId);
  if (!product) return '';

  // Prevent starting chat with yourself
  if (product.sellerId === currentUser.uid) {
    throw new Error('Self-Trade Action: You cannot start a trade conversation on your own listing.');
  }

  // Check if chat already exists
  const qBuyer = query(
    collection(db, 'chats'),
    where('productId', '==', productId),
    where('buyerId', '==', currentUser.uid),
    where('sellerId', '==', product.sellerId)
  );
  const buyerSnap = await getDocs(qBuyer);
  if (!buyerSnap.empty) {
    const existingChatId = buyerSnap.docs[0].id;
    if (initialMessage) {
      await sendMessage(existingChatId, initialMessage);
    }
    return existingChatId;
  }

  const chatId = `chat_${currentUser.uid}_${product.sellerId}_${product.id}_${Date.now()}`;
  const newChat = {
    id: chatId,
    productId: product.id,
    productTitle: product.title,
    productPrice: product.price,
    // Real photo/video-poster only — an empty string here (never a random
    // stock photo) tells ChatsScreen's thumbnail to fall back to its own
    // honest category placeholder instead.
    productImage: resolveProductImageUri(product) || '',
    buyerId: currentUser.uid,
    sellerId: product.sellerId,
    buyerName: currentUser.displayName || currentUser.email?.split('@')[0] || 'Buyer',
    sellerName: product.sellerName || 'Seller',
    lastMessageText: initialMessage || 'Chat started',
    lastMessageTime: new Date().toISOString(),
    tradeStatus: 'pending'
  };

  await setDoc(doc(db, 'chats', chatId), newChat);
  if (initialMessage) {
    await sendMessage(chatId, initialMessage);
  }
  return chatId;
}

export async function sendMessage(chatId: string, text: string) {
  const currentUser = auth.currentUser;
  if (!currentUser) return;

  const chatDoc = await getDoc(doc(db, 'chats', chatId));
  if (!chatDoc.exists()) return;
  const chat = chatDoc.data() as any;

  const msgId = `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const newMsg = {
    id: msgId,
    chatId,
    senderId: currentUser.uid,
    recipientId: chat.buyerId === currentUser.uid ? chat.sellerId : chat.buyerId,
    text,
    createdAt: new Date().toISOString(),
    read: false
  };

  await setDoc(doc(db, 'messages', msgId), newMsg);
  await updateDoc(doc(db, 'chats', chatId), {
    lastMessageText: text,
    lastMessageTime: newMsg.createdAt
  });
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
  const product = await fetchProductById(id);
  if (!product) return;

  const updated = { ...product, ...data };
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
