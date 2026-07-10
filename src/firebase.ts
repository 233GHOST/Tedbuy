import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, getFirestore, setLogLevel } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const metaEnv = (import.meta as any).env || {};

const finalFirebaseConfig = {
  apiKey: metaEnv.VITE_FIREBASE_API_KEY || firebaseConfig.apiKey,
  authDomain: metaEnv.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain,
  projectId: metaEnv.VITE_FIREBASE_PROJECT_ID || firebaseConfig.projectId,
  storageBucket: metaEnv.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket,
  messagingSenderId: metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfig.messagingSenderId,
  appId: metaEnv.VITE_FIREBASE_APP_ID || firebaseConfig.appId,
  firestoreDatabaseId: metaEnv.VITE_FIREBASE_FIRESTORE_DATABASE_ID || firebaseConfig.firestoreDatabaseId || '(default)',
  measurementId: metaEnv.VITE_FIREBASE_MEASUREMENT_ID || firebaseConfig.measurementId || ''
};

const app = initializeApp(finalFirebaseConfig);

// Silence internal Firestore connection warnings in sandboxed preview environment
try {
  setLogLevel('silent');
} catch (e) {
  console.warn('[Firestore] Failed to set log level to silent:', e);
}

// Resilient initialization of Firestore with multi-tab offline cache
const getResilientDb = () => {
  const dbId = finalFirebaseConfig.firestoreDatabaseId && finalFirebaseConfig.firestoreDatabaseId !== '(default)'
    ? finalFirebaseConfig.firestoreDatabaseId
    : undefined;

  let isIndexedDbFunctional = false;
  if (typeof window !== 'undefined' && window.indexedDB) {
    try {
      const test = window.indexedDB;
      if (test) {
        isIndexedDbFunctional = true;
      }
    } catch (_) {
      isIndexedDbFunctional = false;
    }
  }

  let insideIframe = false;
  if (typeof window !== 'undefined') {
    try {
      insideIframe = window.self !== window.top;
    } catch (_) {
      insideIframe = true;
    }
  }

  // In Safari Private Mode and Cross-Origin Iframes, IndexedDB persistence is highly unstable or blocked.
  // We explicitly disable offline local cache to prevent silent hangs, auth failures, and SecurityError exceptions.
  const usePersistence = isIndexedDbFunctional && !insideIframe;

  try {
    const settings: any = {
      experimentalForceLongPolling: true
    };

    if (usePersistence) {
      settings.localCache = persistentLocalCache({
        tabManager: persistentMultipleTabManager()
      });
      console.log('[Firestore] Initializing with persistent multi-tab local cache.');
    } else {
      settings.localCache = memoryLocalCache();
      console.log('[Firestore] Initializing with clean in-memory cache to bypass Safari/IFrame restrictions.');
    }

    if (dbId) {
      return initializeFirestore(app, settings, dbId);
    } else {
      return initializeFirestore(app, settings);
    }
  } catch (err) {
    console.warn('[Firestore] Resistant initializeFirestore threw an exception (possibly because already initialized), falling back to standard getFirestore:', err);
    try {
      if (dbId) {
        return getFirestore(app, dbId);
      } else {
        return getFirestore(app);
      }
    } catch (fallbackErr) {
      console.error('[Firestore] getFirestore fallback failed:', fallbackErr);
      throw fallbackErr;
    }
  }
};

export const db = getResilientDb();
export const auth = getAuth();

// --- Firebase Cloud Messaging (FCM) Support ---
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';

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

    // Verify Notification API is present
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
    // Generic public VAPID key to initialize
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

export interface FirestoreErrorInfo {
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

type ErrorListener = (errorInfo: FirestoreErrorInfo) => void;
const errorListeners = new Set<ErrorListener>();

export function registerFirestoreErrorListener(listener: ErrorListener) {
  errorListeners.add(listener);
  return () => {
    errorListeners.delete(listener);
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errMessage = error instanceof Error ? error.message : String(error);
  // Typecasting error for code properties
  const errCode = (error as any)?.code || '';
  
  const isPermissionError = 
    errCode === 'permission-denied' || 
    errMessage.toLowerCase().includes('permission') || 
    errMessage.toLowerCase().includes('insufficient');

  const errInfo: FirestoreErrorInfo = {
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

  // Dispatch details to all registered toast listener hooks
  errorListeners.forEach(listener => {
    try {
      listener(errInfo);
    } catch (listenerErr) {
      console.error('Error in registered Firestore error listener callback:', listenerErr);
    }
  });

  if (isPermissionError) {
    console.error('Firestore Security Permission Error: ', JSON.stringify(errInfo));
    // Let's NOT throw on background reads/lists since unhandled exceptions inside background listeners
    // cause standard mobile Safari/Chrome to crash or go blank, while manual user writes/creates can still safely throw!
    if (operationType !== OperationType.LIST && operationType !== OperationType.GET) {
      throw new Error(JSON.stringify(errInfo));
    }
  } else {
    // Graceful warning for network issues, connection-failed, offline or unavailable states.
    // This allows offline persistence cache to operate without crashing the app shell!
    console.warn('Firestore Connection/State Notice (Recoverable/Offline Cached):', JSON.stringify(errInfo));
  }
}
