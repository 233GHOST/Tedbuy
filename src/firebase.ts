import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import firebaseConfig from '../firebase-applet-config.json';

const metaEnv = (import.meta as any).env || {};

const resolveAuthDomain = () => {
  if (typeof window !== 'undefined') {
    const currentHost = window.location.hostname;
    if (currentHost === 'localhost' || currentHost === '127.0.0.1' || currentHost.endsWith('.local')) {
      return metaEnv.VITE_FIREBASE_AUTH_DOMAIN || 'localhost';
    }
    return metaEnv.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain || currentHost;
  }

  return metaEnv.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain || 'www.tedbuy.store';
};

const finalFirebaseConfig = {
  apiKey: metaEnv.VITE_FIREBASE_API_KEY || firebaseConfig.apiKey,
  authDomain: resolveAuthDomain(),
  projectId: metaEnv.VITE_FIREBASE_PROJECT_ID || firebaseConfig.projectId,
  storageBucket: metaEnv.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket,
  messagingSenderId: metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfig.messagingSenderId,
  appId: metaEnv.VITE_FIREBASE_APP_ID || firebaseConfig.appId,
  measurementId: metaEnv.VITE_FIREBASE_MEASUREMENT_ID || firebaseConfig.measurementId || ''
};

const app = initializeApp(finalFirebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const getAuthHeader = async (): Promise<Record<string, string>> => {
  const headers: Record<string, string> = {};
  try {
    if (auth.currentUser) {
      const token = await auth.currentUser.getIdToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    if (!headers['Authorization'] && typeof window !== 'undefined') {
      const customToken = localStorage.getItem('tedbuy_custom_auth_token');
      if (customToken) headers['Authorization'] = `Bearer ${customToken}`;
    }
    if (typeof window !== 'undefined') {
      const impSessionStr = localStorage.getItem('tedbuy_impersonation_session');
      if (impSessionStr) {
        try {
          const parsed = JSON.parse(impSessionStr);
          if (parsed && parsed.sessionId && new Date(parsed.expiresAt).getTime() > Date.now()) {
            headers['x-impersonation-session-id'] = parsed.sessionId;
          }
        } catch (_) {}
      }
    }
  } catch (e) {
    console.warn('[getAuthHeader] Failed to extract Firebase Auth ID token:', e);
  }
  return headers;
};

// --- Firebase Cloud Messaging (FCM) Support ---
export const getFcmMessaging = async () => {
  try {
    const supported = await isSupported();
    if (supported) {
      return getMessaging(app);
    }
  } catch (err) {
    console.warn('[FCM] Messaging is not supported or blocked in this browser environment:', err);
  }
  return null;
};

// Graceful FCM Token Retrieval (handles iframe restrictions cleanly)
export const requestFcmToken = async (): Promise<string | null> => {
  try {
    const supported = await isSupported();
    if (!supported) {
      console.log('[FCM] Push messaging is not supported in this browser context.');
      return null;
    }

    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        if (Notification.permission === 'default') {
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') {
            console.log('[FCM] Notification permission was denied by the user.');
            return null;
          }
        } else if (Notification.permission === 'denied') {
          console.log('[FCM] Notification permission is status: denied.');
          return null;
        }
      } catch (permissionErr) {
        console.warn('[FCM] Could not request notification permission in sandbox/iframe context:', permissionErr);
        return null;
      }
    }

    const messagingInstance = getMessaging(app);
    const vapidKey = 'BJHv5e_fO77N-1UunKsz_vG_X-W8Bv97Q4Q1bH_p16PZg72lX8y9nL0P3g5Nq1T1z-67O8276y-X8y7';
    const token = await getToken(messagingInstance, { vapidKey });
    console.log('[FCM] Token retrieved successfully:', token);
    return token;
  } catch (tokenErr) {
    console.warn('[FCM] Gracefully handled token extraction exception (expected in iframe previews):', tokenErr);
    return null;
  }
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface BackendErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

type ErrorListener = (errorInfo: BackendErrorInfo) => void;
const errorListeners = new Set<ErrorListener>();

export function registerBackendErrorListener(listener: ErrorListener) {
  errorListeners.add(listener);
  return () => {
    errorListeners.delete(listener);
  };
}

export function handleBackendError(error: unknown, operationType: OperationType, path: string | null) {
  const errMessage = error instanceof Error ? error.message : String(error);
  const errCode = (error as any)?.code || '';

  const isPermissionError =
    errCode === 'permission-denied' ||
    errMessage.toLowerCase().includes('permission') ||
    errMessage.toLowerCase().includes('insufficient');

  const errInfo: BackendErrorInfo = {
    error: errMessage,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };

  errorListeners.forEach(listener => {
    try {
      listener(errInfo);
    } catch (listenerErr) {
      console.error('Error in registered backend error listener callback:', listenerErr);
    }
  });

  if (isPermissionError) {
    console.error('Backend Security Permission Error: ', JSON.stringify(errInfo));
    if (operationType !== OperationType.LIST && operationType !== OperationType.GET) {
      throw new Error(JSON.stringify(errInfo));
    }
  } else {
    console.warn('Backend Connection/State Notice (Recoverable/Offline Cached):', JSON.stringify(errInfo));
  }
}
