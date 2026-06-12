import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { User, Product, Chat, Message, Category, Review, normalizeCategory } from '../types';
import { SEED_USERS, SEED_PRODUCTS, SEED_REVIEWS } from '../data';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
  updatePassword
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
  where,
  increment
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
  registerUser: (username: string, email?: string, phoneNumber?: string, password?: string, photoUrl?: string) => Promise<User>;
  loginUser: (identifier: string, password?: string) => Promise<boolean>;
  resetPasswordEmail: (email: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logoutUser: () => Promise<void>;
  products: Product[];
  createProduct: (productData: {
    title: string;
    description: string;
    price: string | number;
    category: Category;
    location: string;
    images: string[];
    videos?: string[];
    brand?: string;
    condition?: string;
    negotiable?: boolean;
  }) => Promise<void>;
  updateProduct: (id: string, productData: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  chats: Chat[];
  messages: Message[];
  startChat: (productId: string, initialMessage?: string) => Promise<string>;
  sendMessage: (chatId: string, text: string, optionalSenderId?: string) => Promise<void>;
  markChatAsRead: (chatId: string) => Promise<void>;
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
  currentView: 'browse' | 'product-detail' | 'chats' | 'my-dashboard' | 'seller-profile' | 'profile-settings';
  setCurrentView: (view: 'browse' | 'product-detail' | 'chats' | 'my-dashboard' | 'seller-profile' | 'profile-settings') => void;
  updateUserProfile: (profileData: {
    username: string;
    phoneNumber?: string;
    photoUrl?: string;
    role: 'buyer' | 'seller' | 'both';
    whatsAppNumber?: string;
  }) => Promise<void>;
  deleteAccount: () => Promise<void>;
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
  recentlyViewedIds: string[];
  clearRecentlyViewed: () => void;
  showAuthModal: boolean;
  setShowAuthModal: (show: boolean) => void;
  authMode: 'login' | 'register' | 'forgot-password';
  setAuthMode: (mode: 'login' | 'register' | 'forgot-password') => void;
  unauthorizedDomainDetected: boolean;
  setUnauthorizedDomainDetected: (detected: boolean) => void;
  isAuthLoading: boolean;
  isProductsLoading: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const safeLocalStorage = {
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Ignore security/quota exceptions
    }
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore security exceptions
    }
  }
};

const safeSessionStorage = {
  getItem: (key: string): string | null => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Ignore security exceptions
    }
  },
  removeItem: (key: string): void => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Ignore security exceptions
    }
  }
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [users, setUsers] = useState<User[]>(() => {
    try {
      const stored = safeLocalStorage.getItem('tedbuy_local_users_backup');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [products, setProducts] = useState<Product[]>(() => {
    try {
      const stored = safeLocalStorage.getItem('tedbuy_local_products_backup');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [chats, setChats] = useState<Chat[]>(() => {
    try {
      const stored = safeLocalStorage.getItem('tedbuy_local_chats_backup');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [reviews, setReviews] = useState<Review[]>(() => {
    try {
      const stored = safeLocalStorage.getItem('tedbuy_local_reviews_backup');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [currentUser, setCurrentUserState] = useState<User | null>(() => {
    try {
      const stored = safeLocalStorage.getItem('tedbuy_local_current_user_backup');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isProductsLoading, setIsProductsLoading] = useState(() => {
    try {
      const stored = safeLocalStorage.getItem('tedbuy_local_products_backup');
      return !(stored && JSON.parse(stored).length > 0);
    } catch {
      return true;
    }
  });

  const hasProcessedDeepLink = useRef(false);

  // Navigation and Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [currentView, setCurrentView] = useState<'browse' | 'product-detail' | 'chats' | 'my-dashboard' | 'seller-profile' | 'profile-settings'>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlProductId = params.get('productId');
      if (urlProductId) return 'product-detail';
      const saved = safeSessionStorage.getItem('tedbuy_current_view');
      return (saved as any) || 'browse';
    }
    return 'browse';
  });
  const [selectedProductId, setSelectedProductId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlProductId = params.get('productId');
      if (urlProductId) return urlProductId;
      return safeSessionStorage.getItem('tedbuy_selected_product_id');
    }
    return null;
  });
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return safeSessionStorage.getItem('tedbuy_selected_seller_id');
    }
    return null;
  });
  const [activeChatId, setActiveChatId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return safeSessionStorage.getItem('tedbuy_active_chat_id');
    }
    return null;
  });
  const [viewingChatOnMobile, setViewingChatOnMobile] = useState<boolean>(false);
  const [dashboardTab, setDashboardTab] = useState<'listings' | 'saved'>('listings');
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const saved = safeLocalStorage.getItem('tedbuy_recent_searches');
      return saved ? JSON.parse(saved) : ['iPhone', 'Laptop', 'Fashion', 'Appliance'];
    } catch {
      return ['iPhone', 'Laptop', 'Fashion', 'Appliance'];
    }
  });
  const [recentlyViewedIds, setRecentlyViewedIds] = useState<string[]>(() => {
    try {
      const saved = safeLocalStorage.getItem('tedbuy_recently_viewed_ids');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot-password'>('login');
  const [unauthorizedDomainDetected, setUnauthorizedDomainDetected] = useState(false);

  // Synchronize dynamic searches with localStorage
  useEffect(() => {
    safeLocalStorage.setItem('tedbuy_recent_searches', JSON.stringify(recentSearches));
  }, [recentSearches]);

  // Track product selection for recently viewed section
  useEffect(() => {
    if (selectedProductId) {
      setRecentlyViewedIds((prev) => {
        const filtered = prev.filter(id => id !== selectedProductId);
        const updated = [selectedProductId, ...filtered].slice(0, 5);
        safeLocalStorage.setItem('tedbuy_recently_viewed_ids', JSON.stringify(updated));
        return updated;
      });
    }
  }, [selectedProductId]);

  // Synchronize navigation view context to sessionStorage for reload persistence
  useEffect(() => {
    if (typeof window !== 'undefined') {
      safeSessionStorage.setItem('tedbuy_current_view', currentView);
      if (selectedProductId) {
        safeSessionStorage.setItem('tedbuy_selected_product_id', selectedProductId);
      } else {
        safeSessionStorage.removeItem('tedbuy_selected_product_id');
      }
      if (selectedSellerId) {
        safeSessionStorage.setItem('tedbuy_selected_seller_id', selectedSellerId);
      } else {
        safeSessionStorage.removeItem('tedbuy_selected_seller_id');
      }
      if (activeChatId) {
        safeSessionStorage.setItem('tedbuy_active_chat_id', activeChatId);
      } else {
        safeSessionStorage.removeItem('tedbuy_active_chat_id');
      }
    }
  }, [currentView, selectedProductId, selectedSellerId, activeChatId]);

  // Firebase Auth state listener
  useEffect(() => {
    let active = true;
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!active) return;
      try {
        if (firebaseUser) {
          const initialUsername = firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User';
          
          // Construct a dynamic backup/fallback user structure
          const tempUser: User = {
            id: firebaseUser.uid,
            username: initialUsername,
            email: firebaseUser.email || undefined,
            role: 'both',
            joinDate: 'Joined recently',
            photoUrl: firebaseUser.photoURL || undefined,
            followingSellers: [],
            savedProductIds: []
          };
          
          // Instantly prime the current user from our cached backup or fallback structure so UI opens instantly
          setCurrentUserState(prev => {
            if (prev && prev.id === firebaseUser.uid) {
              return prev; // Use cache
            }
            return tempUser; // Use template
          });

          // Instantly hide any full screen loading blocking screen
          setIsAuthLoading(false);

          // Now fetch the true DB record asynchronously in the background so it never blocks UI.
          try {
            const userRef = doc(db, 'users', firebaseUser.uid);
            const userDoc = await getDoc(userRef);
            if (!active) return;
            
            if (userDoc.exists()) {
              setCurrentUserState(userDoc.data() as User);
            } else {
              // Create the user document in Firestore asynchronously if first time
              const newUser: User = {
                id: firebaseUser.uid,
                username: initialUsername,
                email: firebaseUser.email || undefined,
                role: 'both',
                joinDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
                photoUrl: firebaseUser.photoURL || undefined,
                followingSellers: [],
                savedProductIds: []
              };
              await setDoc(userRef, cleanObject(newUser));
              if (active) setCurrentUserState(newUser);
            }
          } catch (dbErr) {
            console.warn('Background user record fetch failed (normal offline fallback):', dbErr);
          }
        } else {
          setCurrentUserState(null);
          setIsAuthLoading(false);
        }
      } catch (err) {
        console.error('Error fetching/setting auth user details:', err);
        setIsAuthLoading(false);
      }
    });

    return () => {
      active = false;
      unsub();
    };
  }, []);

  // Sync currentUser backup to localStorage
  useEffect(() => {
    try {
      if (currentUser) {
        safeLocalStorage.setItem('tedbuy_local_current_user_backup', JSON.stringify(currentUser));
      } else {
        safeLocalStorage.removeItem('tedbuy_local_current_user_backup');
      }
    } catch (err) {
      console.warn('Could not save current user backup:', err);
    }
  }, [currentUser]);

  // 1. Real-time Users Synchronization
  useEffect(() => {
    let unsub: (() => void) | undefined;
    const timer = setTimeout(() => {
      unsub = onSnapshot(collection(db, 'users'), (snapshot) => {
        const uList: User[] = [];
        snapshot.forEach(docSnap => {
          uList.push(docSnap.data() as User);
        });
        setUsers(uList);
        
        // Update local storage offline backup mapping
        try {
          safeLocalStorage.setItem('tedbuy_local_users_backup', JSON.stringify(uList));
        } catch (err) {
          console.warn('Could not save user backups to local storage:', err);
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'users');
      });
    }, 450); // Defer to prioritize product fetching and main paint thread
    return () => {
      clearTimeout(timer);
      if (unsub) unsub();
    };
  }, []);

  // 2. Real-time Products Synchronization
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'products'), (snapshot) => {
      const pList: Product[] = [];
      snapshot.forEach(docSnap => {
        const item = docSnap.data() as Product;
        if (item.id !== 'prod_1780927804590') {
          if (item.category) {
            item.category = normalizeCategory(item.category);
          }
          pList.push(item);
        }
      });
      const sorted = pList.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setProducts(sorted);
      setIsProductsLoading(false);
      try {
        // Proactively generate a lightweight backup schema to avoid QuotaExceeded errors in localStorage
        const safeBackup = sorted.map(p => ({
          ...p,
          // Retain ordinary image URLs but truncate base64 strings to tiny placeholder segments
          images: p.images ? p.images.map(img => img.startsWith('data:') ? (img.length > 300 ? img.substring(0, 100) + '...[truncated base64]' : img) : img) : [],
          // Truncate descriptions to save space
          description: p.description ? (p.description.length > 800 ? p.description.substring(0, 800) + '...' : p.description) : ''
        }));
        safeLocalStorage.setItem('tedbuy_local_products_backup', JSON.stringify(safeBackup));
      } catch (err) {
        console.warn('Could not save offline products backup:', err);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'products');
      setIsProductsLoading(false);
    });

    return unsub;
  }, []);

  // 2.5. Deep Linking Handler for product sharing (?productId=...)
  useEffect(() => {
    if (products.length > 0 && !hasProcessedDeepLink.current && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlProductId = params.get('productId');
      if (urlProductId) {
        const found = products.find(p => p.id === urlProductId);
        if (found) {
          hasProcessedDeepLink.current = true;
          setSelectedProductId(found.id);
          setCurrentView('product-detail');
          try {
            const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
            window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
          } catch (historyErr) {
            console.warn('Could not replace history state:', historyErr);
          }
        }
      } else {
        // No productId present in URL, mark check as successfully completed once list loads
        hasProcessedDeepLink.current = true;
      }
    }
  }, [products]);

  // 3. Real-time Reviews Synchronization
  useEffect(() => {
    let unsub: (() => void) | undefined;
    const timer = setTimeout(() => {
      unsub = onSnapshot(collection(db, 'reviews'), (snapshot) => {
        const rList: Review[] = [];
        snapshot.forEach(docSnap => {
          rList.push(docSnap.data() as Review);
        });
        const sorted = rList.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setReviews(sorted);
        try {
          safeLocalStorage.setItem('tedbuy_local_reviews_backup', JSON.stringify(sorted));
        } catch (err) {
          console.warn('Could not save reviews backup:', err);
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'reviews');
      });
    }, 300); // Defer to prioritize products and authentication paint
    return () => {
      clearTimeout(timer);
      if (unsub) unsub();
    };
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
      const combined = Array.from(chatMap.values()).sort((a, b) => b.lastMessageTime.localeCompare(a.lastMessageTime));
      setChats(combined);
      try {
        safeLocalStorage.setItem('tedbuy_local_chats_backup', JSON.stringify(combined));
      } catch (err) {
        console.warn('Could not save chats backup:', err);
      }
    };

    const unsub1 = onSnapshot(qBuyer, (snap) => {
      snap.forEach(docSnap => {
        chatMap.set(docSnap.id, docSnap.data() as Chat);
      });
      updateCombined();
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'chats');
    });

    const unsub2 = onSnapshot(qSeller, (snap) => {
      snap.forEach(docSnap => {
        chatMap.set(docSnap.id, docSnap.data() as Chat);
      });
      updateCombined();
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'chats');
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, [currentUser]);

  // 5. Real-time Messages Synchronization (Secure Participant Querying)
  useEffect(() => {
    if (!currentUser) {
      setMessages([]);
      return;
    }

    const qSender = query(collection(db, 'messages'), where('senderId', '==', currentUser.id));
    const qRecipient = query(collection(db, 'messages'), where('recipientId', '==', currentUser.id));

    const msgMap = new Map<string, Message>();

    const updateCombined = () => {
      setMessages(Array.from(msgMap.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    };

    const unsub1 = onSnapshot(qSender, (snap) => {
      snap.forEach(docSnap => {
        msgMap.set(docSnap.id, docSnap.data() as Message);
      });
      updateCombined();
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'messages');
    });

    const unsub2 = onSnapshot(qRecipient, (snap) => {
      snap.forEach(docSnap => {
        msgMap.set(docSnap.id, docSnap.data() as Message);
      });
      updateCombined();
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'messages');
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, [currentUser]);

  // User Authentication Action APIs
  const registerUser = async (username: string, email?: string, phoneNumber?: string, password?: string, photoUrl?: string) => {
    if (!email) {
      throw new Error('Email address is required to register an account.');
    }
    if (!password) {
      throw new Error('Password is required to register an account.');
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const uid = userCredential.user.uid;

      const newUser: User = {
        id: uid,
        username: username.trim(),
        email: email.trim(),
        phoneNumber: phoneNumber || undefined,
        role: 'both',
        joinDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        photoUrl: photoUrl || undefined,
        followingSellers: [],
        savedProductIds: []
      };

      await setDoc(doc(db, 'users', uid), cleanObject(newUser));
      setCurrentUserState(newUser);
      return newUser;
    } catch (error) {
      console.error('Core Firebase registration failed:', error);
      throw error;
    }
  };

  const loginUser = async (identifier: string, password?: string) => {
    if (!password) {
      throw new Error('Password is required.');
    }
    const cleanIdentifier = identifier.trim();

    // Check if the identifier is an email address
    if (cleanIdentifier.includes('@')) {
      try {
        await signInWithEmailAndPassword(auth, cleanIdentifier, password);
        return true;
      } catch (authErrorDetail: any) {
        console.error('Firebase Auth failed for email:', cleanIdentifier, authErrorDetail);
        throw authErrorDetail;
      }
    } else {
      // Identifier is a username or phone number (e.g. Ama, John, Jane or +233...)
      let targetEmail: string | null = null;
      try {
        const usersSnap = await getDocs(collection(db, 'users'));
        usersSnap.forEach((docSnap) => {
          const u = docSnap.data() as User;
          const matchUsername = u.username?.toLowerCase() === cleanIdentifier.toLowerCase();
          const matchPhone = u.phoneNumber?.replace(/\s+/g, '') === cleanIdentifier.replace(/\s+/g, '');
          if (matchUsername || matchPhone) {
            targetEmail = u.email || null;
          }
        });
      } catch (dbErr) {
        console.error('Could not query users list from database for username/phone match:', dbErr);
      }

      if (targetEmail) {
        try {
          await signInWithEmailAndPassword(auth, targetEmail, password);
          return true;
        } catch (authErrorDetail: any) {
          console.error('Firebase Auth failed for user email resolved from username/phone:', targetEmail, authErrorDetail);
          throw authErrorDetail;
        }
      } else {
        throw new Error('No registered account was found matching this username or phone number.');
      }
    }
  };

  const resetPasswordEmail = async (email: string) => {
    if (!email) {
      throw new Error('Email address is required.');
    }
    const emailTarget = email.trim();
    if (!emailTarget.includes('@')) {
      throw new Error('Please enter a valid email address.');
    }
    try {
      await sendPasswordResetEmail(auth, emailTarget);
    } catch (error) {
      console.error('Firebase password reset failed:', error);
      throw error;
    }
  };

  const loginWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      const isUnauthDomain = 
        error?.code === 'auth/unauthorized-domain' || 
        error?.message?.includes('unauthorized-domain') || 
        error?.message?.includes('unauthorized domain');

      if (isUnauthDomain) {
        setUnauthorizedDomainDetected(true);
        console.warn('Google Auth domain is unauthorized. Falling back to simulated profile to maintain high interactivity.');
        const defaultSeed = SEED_USERS[0];
        try {
          const userDoc = await getDoc(doc(db, 'users', defaultSeed.id));
          if (userDoc.exists()) {
            setCurrentUserState(userDoc.data() as User);
            safeLocalStorage.setItem('tedbuy_simulated_user', JSON.stringify(userDoc.data()));
          } else {
            const newUser: User = {
              ...defaultSeed,
              id: defaultSeed.id.startsWith('user_') ? defaultSeed.id : `user_${defaultSeed.id}`
            };
            await setDoc(doc(db, 'users', newUser.id), cleanObject(newUser));
            setCurrentUserState(newUser);
            safeLocalStorage.setItem('tedbuy_simulated_user', JSON.stringify(newUser));
          }
        } catch (simErr) {
          console.warn('Fallback simulated user check failed, using direct memory fallback:', simErr);
          setCurrentUserState(defaultSeed);
          safeLocalStorage.setItem('tedbuy_simulated_user', JSON.stringify(defaultSeed));
        }
        return; // Resolve cleanly!
      }
      console.error('Core Google Authentication failed:', error);
      throw error;
    }
  };

  const logoutUser = async () => {
    try {
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

    const fallbackToSimulatedUser = async () => {
      try {
        const userDoc = await getDoc(doc(db, 'users', seed.id));
        if (userDoc.exists()) {
          setCurrentUserState(userDoc.data() as User);
          safeLocalStorage.setItem('tedbuy_simulated_user', JSON.stringify(userDoc.data()));
        } else {
          const newUser: User = {
            ...seed,
            id: seed.id.startsWith('user_') ? seed.id : `user_${seed.id}`
          };
          await setDoc(doc(db, 'users', newUser.id), cleanObject(newUser));
          setCurrentUserState(newUser);
          safeLocalStorage.setItem('tedbuy_simulated_user', JSON.stringify(newUser));
        }
      } catch (dbErr) {
        console.warn('Failed to load/create simulated user in Firestore, performing in-memory fallback:', dbErr);
        // Even if Firestore write/read fails, set the local state so the app continues working elegantly
        setCurrentUserState(seed);
        safeLocalStorage.setItem('tedbuy_simulated_user', JSON.stringify(seed));
      }
    };

    try {
      try {
        await signInWithEmailAndPassword(auth, emailTarget, 'password123');
      } catch (error: any) {
        // If user credential doesn't exist, we can try to register them live
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
            await fallbackToSimulatedUser();
          }
        } else {
          console.warn('Real switch failed with unexpected error, falling back to simulated login context:', error?.message || error);
          await fallbackToSimulatedUser();
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
    price: string | number;
    category: Category;
    location: string;
    images: string[];
    videos?: string[];
    brand?: string;
    condition?: string;
    negotiable?: boolean;
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
      category: normalizeCategory(productData.category),
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
      const updatedData = { ...productData };
      if (updatedData.category) {
        updatedData.category = normalizeCategory(updatedData.category);
      }

      const productRef = doc(db, 'products', id);
      const productDoc = await getDoc(productRef);
      if (productDoc.exists()) {
        const existingData = productDoc.data() as Product;
        const fullProductUpdate = {
          ...existingData,
          ...updatedData,
          id,
          sellerId: existingData.sellerId || currentUser?.id || '',
        };
        await setDoc(productRef, cleanObject(fullProductUpdate));
      } else {
        await updateDoc(productRef, cleanObject(updatedData));
      }
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

  const incrementProductViews = useCallback(async (id: string) => {
    try {
      const sessionKey = `tedbuy_viewed_product_${id}`;
      if (safeSessionStorage.getItem(sessionKey)) {
        return; // Already logged this session, skip duplicate remote increment to avoid infinite feedback loops and quota waste
      }
      safeSessionStorage.setItem(sessionKey, 'true');
    } catch {
      // safe fallback
    }

    try {
      await updateDoc(doc(db, 'products', id), {
        viewsCount: increment(1)
      });
    } catch (error) {
      console.warn('Failed to increment metrics view:', error);
    }
  }, []);

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

  const markChatAsRead = async (chatId: string) => {
    if (!currentUser) return;
    const unreadMsgs = messages.filter(
      m => m.chatId === chatId && m.recipientId === currentUser.id && !m.read
    );
    if (unreadMsgs.length === 0) return;

    // Snappy optimistic local state update
    setMessages(prev =>
      prev.map(m => {
        if (m.chatId === chatId && m.recipientId === currentUser.id && !m.read) {
          return { ...m, read: true };
        }
        return m;
      })
    );

    try {
      const promises = unreadMsgs.map(msg =>
        updateDoc(doc(db, 'messages', msg.id), { read: true })
      );
      await Promise.all(promises);
    } catch (err) {
      console.error('Error marking messages as read in Firestore:', err);
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

  const updateUserProfile = async (profileData: {
    username: string;
    phoneNumber?: string;
    photoUrl?: string;
    role: 'buyer' | 'seller' | 'both';
    whatsAppNumber?: string;
  }) => {
    if (!currentUser) return;
    const { username, phoneNumber, photoUrl, role, whatsAppNumber } = profileData;
    const updatedUser: User = {
      ...currentUser,
      username,
      phoneNumber: phoneNumber || undefined,
      whatsAppNumber: whatsAppNumber || undefined,
      photoUrl: photoUrl || undefined,
      role
    };

    try {
      await updateDoc(doc(db, 'users', currentUser.id), cleanObject({
        username,
        phoneNumber: phoneNumber || null,
        whatsAppNumber: whatsAppNumber || null,
        photoUrl: photoUrl || null,
        role
      }));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.id}`);
    }

    // Always update local status & localStorage
    setCurrentUserState(updatedUser);
    safeLocalStorage.setItem('tedbuy_simulated_user', JSON.stringify(updatedUser));
  };

  const deleteAccount = async () => {
    if (!currentUser) return;
    const uid = currentUser.id;

    // 1. Delete all user's listings (products)
    try {
      const userProducts = products.filter(p => p.sellerId === uid);
      for (const p of userProducts) {
        await deleteDoc(doc(db, 'products', p.id));
      }
    } catch (productErr) {
      console.warn('Could not fully delete user product listings upon account deletion:', productErr);
    }

    // 2. Delete all user's reviews (authored or received)
    try {
      const userReviews = reviews.filter(r => r.buyerId === uid || r.sellerId === uid);
      for (const r of userReviews) {
        await deleteDoc(doc(db, 'reviews', r.id));
      }
    } catch (reviewErr) {
      console.warn('Could not fully delete user reviews upon account deletion:', reviewErr);
    }

    // 3. Delete all chats involving this user
    const userChats = chats.filter(c => c.buyerId === uid || c.sellerId === uid);
    try {
      for (const c of userChats) {
        await deleteDoc(doc(db, 'chats', c.id));
      }
    } catch (chatErr) {
      console.warn('Could not fully delete user chats upon account deletion:', chatErr);
    }

    // 4. Delete all messages sent/received by this user, or belonging to those deleted chats
    try {
      const chatIdsSet = new Set(userChats.map(c => c.id));
      const userMessages = messages.filter(m => m.senderId === uid || m.recipientId === uid || chatIdsSet.has(m.chatId));
      for (const m of userMessages) {
        await deleteDoc(doc(db, 'messages', m.id));
      }
    } catch (msgErr) {
      console.warn('Could not fully delete user messages upon account deletion:', msgErr);
    }

    // 5. Delete user profile document from firestore
    try {
      await deleteDoc(doc(db, 'users', uid));
    } catch (err) {
      console.warn('Could not delete user document from firestore:', err);
    }

    // 6. Delete Firebase Auth user
    try {
      const authUser = auth.currentUser;
      if (authUser && authUser.uid === uid) {
        await authUser.delete();
      }
    } catch (err) {
      console.warn('Could not delete auth user:', err);
    }

    safeLocalStorage.removeItem('tedbuy_simulated_user');

    // Filter out deleted user from local users backup cache
    try {
      const cached = safeLocalStorage.getItem('tedbuy_local_users_backup');
      if (cached) {
        const uList: User[] = JSON.parse(cached);
        const filtered = uList.filter(u => u.id !== uid);
        safeLocalStorage.setItem('tedbuy_local_users_backup', JSON.stringify(filtered));
      }
    } catch (cacheErr) {
      console.warn('Could not filter custom backup data upon account deletion:', cacheErr);
    }

    await signOut(auth);
    setCurrentUserState(null);
    setCurrentView('browse');
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

  const clearRecentlyViewed = () => {
    setRecentlyViewedIds([]);
    try {
      safeLocalStorage.removeItem('tedbuy_recently_viewed_ids');
    } catch {}
  };

  return (
    <AppContext.Provider value={{
      currentUser,
      setCurrentUser: setCurrentUserState,
      users,
      registerUser,
      loginUser,
      resetPasswordEmail,
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
      markChatAsRead,
      markAsDelivered,
      markAsPickedUp,
      resetChats,
      followSeller,
      unfollowSeller,
      toggleSaveProduct,
      updateUserProfile,
      deleteAccount,
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
      recentlyViewedIds,
      clearRecentlyViewed,
      showAuthModal,
      setShowAuthModal,
      authMode,
      setAuthMode,
      unauthorizedDomainDetected,
      setUnauthorizedDomainDetected,
      isAuthLoading,
      isProductsLoading
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
