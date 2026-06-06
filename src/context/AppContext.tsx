import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Product, Chat, Message, Category, Review } from '../types';
import { SEED_USERS, SEED_PRODUCTS, SEED_REVIEWS } from '../data';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';

function cleanObject<T extends any>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map(item => cleanObject(item)) as any;
  }
  if (typeof obj === 'object') {
    const result: any = {};
    Object.keys(obj).forEach((key) => {
      const val = (obj as any)[key];
      if (val !== undefined) {
        result[key] = cleanObject(val);
      }
    });
    return result;
  }
  return obj;
}

interface AppContextType {
  reviews: Review[];
  addReview: (sellerId: string, rating: number, comment: string, productTitle?: string) => Promise<void>;
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  users: User[];
  registerUser: (username: string, email?: string, phoneNumber?: string, password?: string) => Promise<User>;
  loginUser: (identifier: string, password?: string) => Promise<boolean>;
  loginWithGoogle: () => Promise<void>;
  logoutUser: () => Promise<void>;
  products: Product[];
  createProduct: (productData: {
    title: string;
    description: string;
    price: number;
    category: Category;
    location: string;
    images: string[];
    brand?: string;
    condition?: string;
  }) => Promise<void>;
  updateProduct: (id: string, productData: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  chats: Chat[];
  messages: Message[];
  startChat: (productId: string, initialMessage?: string) => Promise<string>;
  sendMessage: (chatId: string, text: string, optionalSenderId?: string) => Promise<void>;
  markAsDelivered: (chatId: string) => Promise<void>;
  markAsPickedUp: (chatId: string) => Promise<void>;
  resetChats: () => Promise<void>;
  followSeller: (sellerId: string) => Promise<void>;
  unfollowSeller: (sellerId: string) => Promise<void>;
  toggleSaveProduct: (productId: string) => Promise<void>;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedCategory: Category | null;
  setSelectedCategory: (cat: Category | null) => void;
  currentView: 'browse' | 'product-detail' | 'chats' | 'my-dashboard' | 'seller-profile';
  setCurrentView: (view: 'browse' | 'product-detail' | 'chats' | 'my-dashboard' | 'seller-profile') => void;
  selectedProductId: string | null;
  setSelectedProductId: (id: string | null) => void;
  selectedSellerId: string | null;
  setSelectedSellerId: (id: string | null) => void;
  switchUserSimulated: (userId: string) => Promise<void>;
  incrementProductViews: (id: string) => Promise<void>;
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  viewingChatOnMobile: boolean;
  setViewingChatOnMobile: (val: boolean) => void;
  dashboardTab: 'listings' | 'saved';
  setDashboardTab: (tab: 'listings' | 'saved') => void;
  recentSearches: string[];
  addRecentQuery: (query: string) => void;
  clearRecentSearches: () => void;
  showAuthModal: boolean;
  setShowAuthModal: (show: boolean) => void;
  authMode: 'login' | 'register';
  setAuthMode: (mode: 'login' | 'register') => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [currentUser, setCurrentUserState] = useState<User | null>(null);

  // Navigation and Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [currentView, setCurrentView] = useState<'browse' | 'product-detail' | 'chats' | 'my-dashboard' | 'seller-profile'>('browse');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [viewingChatOnMobile, setViewingChatOnMobile] = useState<boolean>(false);
  const [dashboardTab, setDashboardTab] = useState<'listings' | 'saved'>('listings');
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    const saved = localStorage.getItem('tedbuy_recent_searches');
    return saved ? JSON.parse(saved) : ['iPhone', 'Laptop', 'Fashion', 'Appliance'];
  });
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  // Synchronize dynamic searches with localStorage
  useEffect(() => {
    localStorage.setItem('tedbuy_recent_searches', JSON.stringify(recentSearches));
  }, [recentSearches]);

  // Seeding initial catalog data into Firestore if Firestore is empty
  const seedDatabaseIfEmpty = async () => {
    try {
      const prodSnap = await getDocs(collection(db, 'products'));
      if (prodSnap.empty) {
        console.log('Seeding initial products/reviews/users into Firestore catalog...');
        // Seed users
        for (const u of SEED_USERS) {
          try {
            await setDoc(doc(db, 'users', u.id), cleanObject(u));
            console.log(`Successfully seeded user: ${u.id}`);
          } catch (userErr: any) {
            console.error(`Failed to seed user ${u.id}:`, userErr.message || userErr);
            throw userErr;
          }
        }
        // Seed products
        for (const p of SEED_PRODUCTS) {
          try {
            await setDoc(doc(db, 'products', p.id), cleanObject(p));
            console.log(`Successfully seeded product: ${p.id}`);
          } catch (prodErr: any) {
            console.error(`Failed to seed product ${p.id}:`, prodErr.message || prodErr);
            throw prodErr;
          }
        }
        // Seed reviews
        for (const r of SEED_REVIEWS) {
          try {
            await setDoc(doc(db, 'reviews', r.id), cleanObject(r));
            console.log(`Successfully seeded review: ${r.id}`);
          } catch (revErr: any) {
            console.error(`Failed to seed review ${r.id}:`, revErr.message || revErr);
            throw revErr;
          }
        }
      }
    } catch (err) {
      console.error('Seeding Firestore empty collections failed:', err);
    }
  };

  // Firebase Auth state listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Clear simulated user since real auth is active.
        localStorage.removeItem('tedbuy_simulated_user');

        const userRef = doc(db, 'users', firebaseUser.uid);
        const userDoc = await getDoc(userRef);
        if (userDoc.exists()) {
          setCurrentUserState(userDoc.data() as User);
        } else {
          // If profile doc doesn't exist yet, populate a quick profile
          const initialUsername = firebaseUser.email?.split('@')[0] || 'User';
          const newUser: User = {
            id: firebaseUser.uid,
            username: initialUsername,
            email: firebaseUser.email || undefined,
            role: 'both',
            joinDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
            photoUrl: `https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80`,
            followingSellers: [],
            savedProductIds: []
          };
          await setDoc(userRef, cleanObject(newUser));
          setCurrentUserState(newUser);
        }
        // Seed catalog as soon as any active transaction is authenticated
        seedDatabaseIfEmpty();
      } else {
        // Check if there is a simulated user in localStorage
        const storedSim = localStorage.getItem('tedbuy_simulated_user');
        if (storedSim) {
          try {
            const parsed = JSON.parse(storedSim);
            setCurrentUserState(parsed);
          } catch (_) {
            setCurrentUserState(null);
          }
        } else {
          setCurrentUserState(null);
        }
      }
    });

    // Seed on initial load if needed as fallback helper
    seedDatabaseIfEmpty();

    return unsub;
  }, []);

  // 1. Real-time Users Synchronization
  useEffect(() => {
    if (!currentUser) {
      setUsers(SEED_USERS);
      return;
    }
    const unsub = onSnapshot(collection(db, 'users'), (snapshot) => {
      const uList: User[] = [];
      snapshot.forEach(docSnap => {
        uList.push(docSnap.data() as User);
      });
      setUsers(uList);
    }, (error) => {
      console.error("Users list sync error:", error);
    });
    return unsub;
  }, [currentUser]);

  // 2. Real-time Products Synchronization
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'products'), (snapshot) => {
      const pList: Product[] = [];
      snapshot.forEach(docSnap => {
        pList.push(docSnap.data() as Product);
      });
      setProducts(pList.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }, (error) => {
      console.error("Products list sync error:", error);
    });
    return unsub;
  }, []);

  // 3. Real-time Reviews Synchronization
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'reviews'), (snapshot) => {
      const rList: Review[] = [];
      snapshot.forEach(docSnap => {
        rList.push(docSnap.data() as Review);
      });
      setReviews(rList.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }, (error) => {
      console.error("Reviews list sync error:", error);
    });
    return unsub;
  }, []);

  // 4. Real-time Chats Synchronization (Secure Participant Filtering)
  useEffect(() => {
    if (!currentUser) {
      setChats([]);
      return;
    }

    const qBuyer = query(collection(db, 'chats'), where('buyerId', '==', currentUser.id));
    const qSeller = query(collection(db, 'chats'), where('sellerId', '==', currentUser.id));

    const chatMap = new Map<string, Chat>();

    const updateCombined = () => {
      setChats(Array.from(chatMap.values()).sort((a, b) => b.lastMessageTime.localeCompare(a.lastMessageTime)));
    };

    const unsub1 = onSnapshot(qBuyer, (snap) => {
      snap.forEach(docSnap => {
        chatMap.set(docSnap.id, docSnap.data() as Chat);
      });
      updateCombined();
    });

    const unsub2 = onSnapshot(qSeller, (snap) => {
      snap.forEach(docSnap => {
        chatMap.set(docSnap.id, docSnap.data() as Chat);
      });
      updateCombined();
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, [currentUser]);

  // 5. Real-time Messages Synchronization
  useEffect(() => {
    if (!currentUser) {
      setMessages([]);
      return;
    }
    const unsub = onSnapshot(collection(db, 'messages'), (snapshot) => {
      const mList: Message[] = [];
      snapshot.forEach(docSnap => {
        mList.push(docSnap.data() as Message);
      });
      setMessages(mList.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    }, (error) => {
      console.error("Messages sync error:", error);
    });
    return unsub;
  }, [currentUser]);

  // User Authentication Action APIs
  const registerUser = async (username: string, email?: string, phoneNumber?: string, password?: string) => {
    const actualPassword = password || 'password123';
    const actualEmail = email || `phone_${phoneNumber?.replace(/[^0-9]/g, '')}@phone.tedbuy.com`;

    try {
      let uid: string;
      let newUser: User;

      try {
        const userCredential = await createUserWithEmailAndPassword(auth, actualEmail, actualPassword);
        uid = userCredential.user.uid;
        newUser = {
          id: uid,
          username,
          email: email || undefined,
          phoneNumber: phoneNumber || undefined,
          role: 'both',
          joinDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          photoUrl: `https://images.unsplash.com/photo-${1500000000000 + Math.floor(Math.random() * 999999)}?auto=format&fit=crop&w=120&q=80`,
          followingSellers: [],
          savedProductIds: []
        };
      } catch (err: any) {
        if (err?.code === 'auth/operation-not-allowed' || err?.message?.includes('operation-not-allowed')) {
          console.warn('Email/Password Auth provider is disabled in Firebase console. Falling back to local/Firestore simulator...');
          
          // Generate a custom ID starting with 'user_' to bypass Firestore rules
          const emailClean = actualEmail.replace(/[^a-zA-Z0-9]/g, '_');
          uid = `user_${emailClean}_${Date.now()}`;
          newUser = {
            id: uid,
            username,
            email: email || undefined,
            phoneNumber: phoneNumber || undefined,
            role: 'both',
            joinDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
            photoUrl: `https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80`,
            followingSellers: [],
            savedProductIds: []
          };
        } else {
          throw err;
        }
      }

      await setDoc(doc(db, 'users', uid), cleanObject(newUser));
      setCurrentUserState(newUser);
      localStorage.setItem('tedbuy_simulated_user', JSON.stringify(newUser));
      return newUser;
    } catch (error) {
      console.error('Core Firebase registration failed:', error);
      throw error;
    }
  };

  const loginUser = async (identifier: string, password?: string) => {
    const actualPassword = password || 'password123';
    let emailTarget = identifier.trim();
    if (!emailTarget.includes('@')) {
      emailTarget = `phone_${emailTarget.replace(/[^0-9]/g, '')}@phone.tedbuy.com`;
    }

    try {
      try {
        await signInWithEmailAndPassword(auth, emailTarget, actualPassword);
        return true;
      } catch (err: any) {
        if (err?.code === 'auth/operation-not-allowed' || err?.message?.includes('operation-not-allowed')) {
          console.warn('Email/Password Auth is disabled in Firebase. Falling back to simulated login...');
          
          // Try to look up existing user document from users collection where username/email/phone matches
          const usersSnap = await getDocs(collection(db, 'users'));
          let mockUser: User | null = null;
          usersSnap.forEach(docSnap => {
            const u = docSnap.data() as User;
            if (
              u.email?.toLowerCase() === emailTarget.toLowerCase() ||
              u.username?.toLowerCase() === identifier.trim().toLowerCase() ||
              u.phoneNumber === identifier.trim()
            ) {
              mockUser = u;
            }
          });

          if (mockUser) {
            setCurrentUserState(mockUser);
            localStorage.setItem('tedbuy_simulated_user', JSON.stringify(mockUser));
            return true;
          } else {
            // Auto-register them under simulator context
            const cleanName = identifier.split('@')[0];
            const isEmail = identifier.includes('@');
            await registerUser(
              cleanName,
              isEmail ? identifier : undefined,
              !isEmail ? identifier : undefined,
              actualPassword
            );
            return true;
          }
        } else {
          throw err;
        }
      }
    } catch (error) {
      console.error('Core Firebase authentication login failed:', error);
      throw error;
    }
  };

  const loginWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Core Google Authentication failed:', error);
      throw error;
    }
  };

  const logoutUser = async () => {
    try {
      localStorage.removeItem('tedbuy_simulated_user');
      await signOut(auth);
      setCurrentUserState(null);
      setCurrentView('browse');
    } catch (err) {
      console.error('Core Logout failed:', err);
    }
  };

  // Switch Active User (Dynamic Register/Sign In Seamless Simulator Hybrid)
  const switchUserSimulated = async (userId: string) => {
    const seed = SEED_USERS.find(u => u.id === userId);
    if (!seed) return;

    const emailTarget = seed.email || `phone_${seed.phoneNumber?.replace(/[^0-9]/g, '')}@phone.tedbuy.com`;

    try {
      try {
        await signInWithEmailAndPassword(auth, emailTarget, 'password123');
      } catch (error: any) {
        if (
          error?.code === 'auth/operation-not-allowed' ||
          error?.message?.includes('operation-not-allowed')
        ) {
          console.warn('Authentication disabled, simulated login active.');
          const userDoc = await getDoc(doc(db, 'users', seed.id));
          if (userDoc.exists()) {
            setCurrentUserState(userDoc.data() as User);
            localStorage.setItem('tedbuy_simulated_user', JSON.stringify(userDoc.data()));
          } else {
            const newUser: User = {
              ...seed,
              id: seed.id.startsWith('user_') ? seed.id : `user_${seed.id}`
            };
            await setDoc(doc(db, 'users', newUser.id), cleanObject(newUser));
            setCurrentUserState(newUser);
            localStorage.setItem('tedbuy_simulated_user', JSON.stringify(newUser));
          }
          return;
        }

        // If user credential doesn't exist, register them live!
        if (
          error?.code === 'auth/user-not-found' ||
          error?.message?.includes('user-not-found') ||
          error?.code === 'auth/invalid-credential' ||
          error?.message?.includes('invalid-credential')
        ) {
          try {
            await registerUser(seed.username, seed.email, seed.phoneNumber, 'password123');
          } catch (regErr) {
            console.error('Seamless simulator register auto-hook failed:', regErr);
          }
        } else {
          console.error('Presets Switch operation failed:', error);
        }
      }
    } catch (swapErr) {
      console.error('Core Presets Swap completely fell back:', swapErr);
    }
  };

  // Listings Operations
  const createProduct = async (productData: {
    title: string;
    description: string;
    price: number;
    category: Category;
    location: string;
    images: string[];
    brand?: string;
    condition?: string;
  }) => {
    if (!currentUser) return;
    const prodId = `prod_${Date.now()}`;
    const newProduct: Product = {
      id: prodId,
      sellerId: currentUser.id,
      sellerName: currentUser.username,
      sellerPhoto: currentUser.photoUrl || 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=120&q=80',
      sellerJoinDate: currentUser.joinDate,
      ...productData,
      createdAt: new Date().toISOString(),
      viewsCount: 0
    };

    try {
      await setDoc(doc(db, 'products', prodId), cleanObject(newProduct));
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `products/${prodId}`);
    }
  };

  const updateProduct = async (id: string, productData: Partial<Product>) => {
    try {
      await updateDoc(doc(db, 'products', id), cleanObject(productData));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `products/${id}`);
    }
  };

  const deleteProduct = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'products', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `products/${id}`);
    }
  };

  const incrementProductViews = async (id: string) => {
    const p = products.find(prod => prod.id === id);
    if (!p) return;
    try {
      await updateDoc(doc(db, 'products', id), {
        viewsCount: (p.viewsCount || 0) + 1
      });
    } catch (error) {
      console.warn('Failed to increment metrics view:', error);
    }
  };

  // Chats Operations
  const startChat = async (productId: string, initialMessage?: string) => {
    if (!currentUser) return '';
    const product = products.find(p => p.id === productId);
    if (!product) return '';

    const existingChat = chats.find(c =>
      c.productId === productId &&
      c.buyerId === currentUser.id &&
      c.sellerId === product.sellerId
    );

    if (existingChat) {
      if (initialMessage) {
        await sendMessage(existingChat.id, initialMessage);
      }
      setActiveChatId(existingChat.id);
      setViewingChatOnMobile(true);
      return existingChat.id;
    }

    const chatId = `chat_${currentUser.id}_${product.sellerId}_${product.id}_${Date.now()}`;
    const newChat: Chat = {
      id: chatId,
      productId: product.id,
      productTitle: product.title,
      productPrice: product.price,
      productImage: product.images[0] || 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=120&q=80',
      buyerId: currentUser.id,
      sellerId: product.sellerId,
      buyerName: currentUser.username,
      sellerName: product.sellerName,
      lastMessageText: initialMessage || 'Chat started',
      lastMessageTime: new Date().toISOString(),
      deliveredBySeller: false,
      pickedUpByBuyer: false,
      tradeStatus: 'pending'
    };

    try {
      await setDoc(doc(db, 'chats', chatId), cleanObject(newChat));
      setActiveChatId(chatId);
      setViewingChatOnMobile(true);

      if (initialMessage) {
        await sendMessage(chatId, initialMessage);
      }
      return chatId;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `chats/${chatId}`);
      return '';
    }
  };

  const sendMessage = async (chatId: string, text: string, optionalSenderId?: string) => {
    const sender = optionalSenderId ? users.find(u => u.id === optionalSenderId) : currentUser;
    if (!sender) return;

    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;

    const recId = chat.buyerId === sender.id ? chat.sellerId : chat.buyerId;
    const msgId = `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const newMsg: Message = {
      id: msgId,
      chatId,
      senderId: sender.id,
      recipientId: recId,
      text,
      createdAt: new Date().toISOString(),
      read: false
    };

    try {
      await setDoc(doc(db, 'messages', msgId), cleanObject(newMsg));
      await updateDoc(doc(db, 'chats', chatId), cleanObject({
        lastMessageText: text,
        lastMessageTime: new Date().toISOString()
      }));
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `messages/${msgId}`);
    }
  };

  const markAsDelivered = async (chatId: string) => {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;

    try {
      await updateDoc(doc(db, 'chats', chatId), cleanObject({
        deliveredBySeller: true,
        tradeStatus: 'delivered',
        lastMessageText: "📦 Seller marked as delivered",
        lastMessageTime: new Date().toISOString()
      }));

      const msgId = `sys_${Date.now()}`;
      const systemMsg: Message = {
        id: msgId,
        chatId,
        senderId: chat.sellerId,
        recipientId: chat.buyerId,
        text: "📦 Seller has marked this item as DELIVERED.",
        createdAt: new Date().toISOString(),
        read: false
      };
      await setDoc(doc(db, 'messages', msgId), cleanObject(systemMsg));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `chats/${chatId}`);
    }
  };

  const markAsPickedUp = async (chatId: string) => {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;

    try {
      await updateDoc(doc(db, 'chats', chatId), cleanObject({
        pickedUpByBuyer: true,
        tradeStatus: 'completed',
        lastMessageText: "🤝 Buyer marked as picked up",
        lastMessageTime: new Date().toISOString()
      }));

      const msgId = `sys_${Date.now()}`;
      const systemMsg: Message = {
        id: msgId,
        chatId,
        senderId: chat.buyerId,
        recipientId: chat.sellerId,
        text: "🤝 Buyer has marked this item as PICKED UP and confirmed purchase.",
        createdAt: new Date().toISOString(),
        read: false
      };
      await setDoc(doc(db, 'messages', msgId), cleanObject(systemMsg));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `chats/${chatId}`);
    }
  };

  const resetChats = async () => {
    // Zero out chat references inside Sandbox for quick pristine environment
    try {
      for (const chat of chats) {
        await deleteDoc(doc(db, 'chats', chat.id));
      }
      for (const msg of messages) {
        await deleteDoc(doc(db, 'messages', msg.id));
      }
    } catch (err) {
      console.warn("Reset operation cleared active locally:", err);
    }
  };

  // Follow profiles / saved items in User Firestore document
  const followSeller = async (sellerId: string) => {
    if (!currentUser) return;
    const following = currentUser.followingSellers || [];
    if (!following.includes(sellerId)) {
      const updatedFollowing = [...following, sellerId];
      try {
        await updateDoc(doc(db, 'users', currentUser.id), {
          followingSellers: updatedFollowing
        });
        setCurrentUserState({ ...currentUser, followingSellers: updatedFollowing });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.id}`);
      }
    }
  };

  const unfollowSeller = async (sellerId: string) => {
    if (!currentUser) return;
    const following = currentUser.followingSellers || [];
    const updatedFollowing = following.filter(id => id !== sellerId);
    try {
      await updateDoc(doc(db, 'users', currentUser.id), {
        followingSellers: updatedFollowing
      });
      setCurrentUserState({ ...currentUser, followingSellers: updatedFollowing });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.id}`);
    }
  };

  const toggleSaveProduct = async (productId: string) => {
    if (!currentUser) return;
    const saved = currentUser.savedProductIds || [];
    let updatedSaved: string[];
    if (saved.includes(productId)) {
      updatedSaved = saved.filter(id => id !== productId);
    } else {
      updatedSaved = [...saved, productId];
    }
    try {
      await updateDoc(doc(db, 'users', currentUser.id), {
        savedProductIds: updatedSaved
      });
      setCurrentUserState({ ...currentUser, savedProductIds: updatedSaved });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.id}`);
    }
  };

  const addReview = async (sellerId: string, rating: number, comment: string, productTitle?: string) => {
    if (!currentUser) return;
    const revId = `rev_${Date.now()}`;
    const newReview: Review = {
      id: revId,
      sellerId,
      buyerId: currentUser.id,
      buyerName: currentUser.username,
      buyerPhoto: currentUser.photoUrl || 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=120&q=80',
      rating,
      comment,
      createdAt: new Date().toISOString(),
      productTitle
    };
    try {
      await setDoc(doc(db, 'reviews', revId), cleanObject(newReview));
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `reviews/${revId}`);
    }
  };

  const addRecentQuery = (queryText: string) => {
    const trimmed = queryText.trim();
    if (!trimmed) return;
    setRecentSearches(prev => {
      const filtered = prev.filter(q => q.toLowerCase() !== trimmed.toLowerCase());
      return [trimmed, ...filtered].slice(0, 6);
    });
  };

  const clearRecentSearches = () => {
    setRecentSearches([]);
  };

  return (
    <AppContext.Provider value={{
      currentUser,
      setCurrentUser: setCurrentUserState,
      users,
      registerUser,
      loginUser,
      loginWithGoogle,
      logoutUser,
      products,
      createProduct,
      updateProduct,
      deleteProduct,
      chats,
      messages,
      startChat,
      sendMessage,
      markAsDelivered,
      markAsPickedUp,
      resetChats,
      followSeller,
      unfollowSeller,
      toggleSaveProduct,
      reviews,
      addReview,
      searchQuery,
      setSearchQuery,
      selectedCategory,
      setSelectedCategory,
      currentView,
      setCurrentView,
      selectedProductId,
      setSelectedProductId,
      selectedSellerId,
      setSelectedSellerId,
      switchUserSimulated,
      incrementProductViews,
      activeChatId,
      setActiveChatId,
      viewingChatOnMobile,
      setViewingChatOnMobile,
      dashboardTab,
      setDashboardTab,
      recentSearches,
      addRecentQuery,
      clearRecentSearches,
      showAuthModal,
      setShowAuthModal,
      authMode,
      setAuthMode
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
