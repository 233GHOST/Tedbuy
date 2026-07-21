import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth';
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
export const auth = getAuth(app);
export const db = getFirestore(app);

export async function createProduct(productData: any) {
  return addDoc(collection(db, 'products'), {
    ...productData,
    createdAt: new Date().toISOString(),
    likesCount: 0,
    likedUserIds: [],
    images: productData.images || ['https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80'],
  });
}

export async function signIn(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signUp(email: string, password: string, username: string) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(credential.user, { displayName: username });
  // Store user details inside the "users" collection
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
  await setDoc(doc(db, 'users', credential.user.uid), newUser);
  return credential;
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

export async function fetchProductById(productId: string) {
  const snapshot = await getDoc(doc(db, 'products', productId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function fetchUserById(userId: string) {
  const snapshot = await getDoc(doc(db, 'users', userId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export function watchProducts(callback: (products: any[]) => void) {
  const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'), limit(50));
  return onSnapshot(q, (snapshot) => callback(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))));
}

export function watchUsers(callback: (users: any[]) => void) {
  return onSnapshot(collection(db, 'users'), (snapshot) => callback(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))));
}

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

export async function toggleLikeProduct(id: string, userId: string) {
  const productRef = doc(db, 'products', id);
  const productDoc = await getDoc(productRef);
  if (productDoc.exists()) {
    const existingData = productDoc.data() as any;
    const currentLikedUserIds = Array.isArray(existingData.likedUserIds) ? existingData.likedUserIds : [];
    const hasLiked = currentLikedUserIds.includes(userId);
    let nextLikedUserIds: string[];
    if (hasLiked) {
      nextLikedUserIds = currentLikedUserIds.filter((uid: string) => uid !== userId);
    } else {
      nextLikedUserIds = [...currentLikedUserIds, userId];
    }
    await updateDoc(productRef, {
      likedUserIds: nextLikedUserIds,
      likesCount: nextLikedUserIds.length
    });
  }
}

export async function startChat(productId: string, initialMessage?: string) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication Required: Please sign in or create an account from the Profile tab.');

  const productDoc = await getDoc(doc(db, 'products', productId));
  if (!productDoc.exists()) return '';
  const product = { id: productDoc.id, ...productDoc.data() } as any;

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
    productImage: product.images?.[0] || 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80',
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

export async function updateProduct(id: string, data: Partial<any>) {
  const productRef = doc(db, 'products', id);
  return updateDoc(productRef, data);
}
