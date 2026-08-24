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

export async function getAuthHeaderMobile(): Promise<Record<string, string>> {
  try {
    if (auth.currentUser) {
      const token = await auth.currentUser.getIdToken();
      if (token) return { Authorization: `Bearer ${token}` };
    }
  } catch (e) {}
  return {};
}

export async function uploadMediaToCloudinaryMobile(
  fileUriOrBase64: string,
  resourceType: 'image' | 'video' = 'image'
): Promise<string> {
  if (!fileUriOrBase64) return '';
  if (fileUriOrBase64.startsWith('https://res.cloudinary.com')) return fileUriOrBase64;

  const serverUrl = typeof window !== 'undefined' && window.location?.origin
    ? `${window.location.origin}/api/cloudinary/upload`
    : 'https://www.tedbuy.store/api/cloudinary/upload';

  try {
    const response = await fetch(serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: fileUriOrBase64,
        resource_type: resourceType
      })
    });

    const data = await response.json();
    if (data.success && data.result?.secure_url) {
      return data.result.secure_url;
    }
    if (data.success && data.result?.url) {
      return data.result.url;
    }
    throw new Error(data.error || 'Cloudinary mobile upload failed');
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

  const finalProduct = {
    ...productData,
    id: prodId,
    createdAt: productData.createdAt || new Date().toISOString(),
    viewsCount: Number(productData.viewsCount) || 0,
    likesCount: Number(productData.likesCount) || 0,
    likedUserIds: Array.isArray(productData.likedUserIds) ? productData.likedUserIds : [],
    images: cloudinaryImages.length > 0
      ? cloudinaryImages
      : ['https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80'],
    videos: cloudinaryVideos
  };

  // Sync to server API so Supabase is updated and server cache is invalidated instantly
  try {
    const syncUrl = typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/api/products/sync`
      : 'https://www.tedbuy.store/api/products/sync';

    const authHeaders = await getAuthHeaderMobile();
    await fetch(syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ product: finalProduct })
    });
  } catch (err) {
    console.warn('[Mobile createProduct Sync Exception]', err);
  }

  return finalProduct;
}

export async function deleteProductMobile(productId: string) {
  if (!productId) return;

  // Call server delete API so Cloudinary assets are purged, Supabase record deleted, and server caches cleared
  try {
    const deleteUrl = typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/api/products/delete`
      : 'https://www.tedbuy.store/api/products/delete';

    const authHeaders = await getAuthHeaderMobile();
    await fetch(deleteUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ productId })
    });
  } catch (err) {
    console.warn('[Mobile deleteProduct Exception]:', err);
  }
}

export async function signIn(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

import { isReservedStoreName } from './types';

export async function signUp(email: string, password: string, username: string) {
  if (isReservedStoreName(username)) {
    throw new Error('This store name is reserved by TedBuy.');
  }
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

export async function fetchProducts(limitCount = 24, searchQuery?: string, category?: string) {
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
      return data.products;
    }
  } catch (err) {
    console.warn('[mobile fetchProducts Error]', err);
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

export async function fetchProductById(productId: string) {
  try {
    const apiUrl = typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/api/products/${productId}`
      : `https://www.tedbuy.store/api/products/${productId}`;
    const res = await fetch(apiUrl);
    const data = await res.json();
    if (data.success && data.product) {
      return data.product;
    }
  } catch (err) {
    console.warn('[mobile fetchProductById Error]', err);
  }
  return null;
}

export async function fetchUserById(userId: string) {
  const snapshot = await getDoc(doc(db, 'users', userId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export function watchProducts(callback: (products: any[]) => void) {
  let active = true;
  const load = async () => {
    const items = await fetchProducts(200);
    if (active) callback(items);
  };
  load();
  return () => {
    active = false;
  };
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
  const product = await fetchProductById(id);
  if (product) {
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

    try {
      const syncUrl = typeof window !== 'undefined' && window.location?.origin
        ? `${window.location.origin}/api/products/sync`
        : 'https://www.tedbuy.store/api/products/sync';

      await fetch(syncUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: updated })
      });
    } catch (err) {
      console.warn('[toggleLikeProduct Sync Error]', err);
    }
  }
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
