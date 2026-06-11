import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(
  app,
  firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? firebaseConfig.firestoreDatabaseId
    : undefined
); /* CRITICAL: The app will break without this line */

// Enable offline persistence for seamless LTE/offline support
if (typeof window !== 'undefined') {
  enableIndexedDbPersistence(db).catch((err) => {
    console.warn('Firestore offline persistence could not be enabled:', err.code, err.message);
  });
}

export const auth = getAuth();

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
