import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, getDocs, query, orderBy, limit, where, onSnapshot, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyDddmRJVV3ywN5AeLsT7iZ4E2K329StfVA',
  authDomain: 'www.tedbuy.store',
  projectId: 'tedbuy-fb79a',
  storageBucket: 'tedbuy-fb79a.firebasestorage.app',
  messagingSenderId: '735307724523',
  appId: '1:735307724523:web:b9a8f1ff69c0cab69230ae',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export async function signIn(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signUp(email: string, password: string) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export async function logOut() {
  return signOut(auth);
}

export function observeAuthState(callback: (user: any) => void) {
  return onAuthStateChanged(auth, callback);
}

export async function fetchProducts(limitCount = 20) {
  const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'), limit(limitCount));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

export async function fetchChatsForUser(userId: string) {
  const q = query(collection(db, 'chats'), where('buyerId', '==', userId), limit(20));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

export async function fetchProductById(productId: string) {
  const snapshot = await getDoc(doc(db, 'products', productId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function fetchUserById(userId: string) {
  const snapshot = await getDoc(doc(db, 'users', userId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export function watchProducts(callback: (products: any[]) => void) {
  const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'), limit(20));
  return onSnapshot(q, (snapshot) => callback(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))));
}

export function watchUsers(callback: (users: any[]) => void) {
  return onSnapshot(collection(db, 'users'), (snapshot) => callback(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))));
}
