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
import { slugify } from '../utils/slugify';

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
  toggleMessageReadStatus: (messageId: string, read?: boolean) => Promise<void>;
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
  refreshProducts: () => Promise<void>;
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
  const [users, setUsers] = useState<User[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const msgMapRef = useRef<Map<string, Message>>(new Map());
  const [reviews, setReviews] = useState<Review[]>([]);
  const [currentUser, setCurrentUserStateRaw] = useState<User | null>(() => {
    try {
      const stored = safeLocalStorage.getItem('tedbuy_local_current_user_backup');
      if (stored) {
        const parsed = JSON.parse(stored) as User;
        if (parsed.email === 'asumaduvincent7@gmail.com') {
          parsed.isAdmin = true;
        }
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  });

  const setCurrentUserState = (val: User | null | ((prev: User | null) => User | null)) => {
    setCurrentUserStateRaw(prev => {
      let next = typeof val === 'function' ? val(prev) : val;
      if (next && next.email === 'asumaduvincent7@gmail.com') {
        next = { ...next, isAdmin: true };
      }
      return next;
    });
  };
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isProductsLoading, setIsProductsLoading] = useState(true);

  const hasProcessedDeepLink = useRef(false);

  // Navigation and Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);

  const parseUrlState = useCallback(() => {
    if (typeof window === 'undefined') return { view: 'browse' as const, selectedProductId: null, selectedSellerId: null };
    const pathname = window.location.pathname;
    
    // /products/:id or /product/:id
    const productMatch = pathname.match(/^\/products?\/([^\/]+)/);
    if (productMatch) {
      const slugOrId = productMatch[1];
      const matchId = slugOrId.match(/prod_[a-zA-Z0-9_]+/);
      if (matchId) {
        return { view: 'product-detail' as const, selectedProductId: matchId[0], selectedSellerId: null };
      }
    }

    // /sellers/:sellerId or /seller/:sellerId
    const sellerMatch = pathname.match(/^\/sellers?\/([^\/]+)/);
    if (sellerMatch) {
      return { view: 'seller-profile' as const, selectedProductId: null, selectedSellerId: sellerMatch[1] };
    }

    // /chats
    if (pathname === '/chats') {
      return { view: 'chats' as const, selectedProductId: null, selectedSellerId: null };
    }

    // /dashboard
    if (pathname === '/dashboard') {
      return { view: 'my-dashboard' as const, selectedProductId: null, selectedSellerId: null };
    }

    // /settings
    if (pathname === '/settings') {
      return { view: 'profile-settings' as const, selectedProductId: null, selectedSellerId: null };
    }

    // Fallback: search parameters
    const params = new URLSearchParams(window.location.search);
    const qProductId = params.get('productId');
    if (qProductId) {
      const matchId = qProductId.match(/prod_[a-zA-Z0-9_]+/);
      if (matchId) {
        return { view: 'product-detail' as const, selectedProductId: matchId[0], selectedSellerId: null };
      }
    }

    return { view: 'browse' as const, selectedProductId: null, selectedSellerId: null };
  }, []);

  const [currentView, setCurrentView] = useState<'browse' | 'product-detail' | 'chats' | 'my-dashboard' | 'seller-profile' | 'profile-settings'>(() => {
    return parseUrlState().view;
  });
  const [selectedProductId, setSelectedProductId] = useState<string | null>(() => {
    return parseUrlState().selectedProductId;
  });
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(() => {
    return parseUrlState().selectedSellerId;
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

  // Popstate listener to update view and states on native back/forward buttons
  useEffect(() => {
    const handlePopState = () => {
      const parsed = parseUrlState();
      setCurrentView(parsed.view);
      setSelectedProductId(parsed.selectedProductId);
      setSelectedSellerId(parsed.selectedSellerId);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [parseUrlState]);

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

  // Synchronize navigation view context to address bar URL
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    let targetPath = '/';
    if (currentView === 'product-detail' && selectedProductId) {
      const prod = products.find(p => p.id === selectedProductId);
      const slug = prod ? `-${slugify(prod.title)}` : '';
      targetPath = `/product/${selectedProductId}${slug}`;
    } else if (currentView === 'seller-profile' && selectedSellerId) {
      targetPath = `/seller/${selectedSellerId}`;
    } else if (currentView === 'chats') {
      targetPath = '/chats';
    } else if (currentView === 'my-dashboard') {
      targetPath = '/dashboard';
    } else if (currentView === 'profile-settings') {
      targetPath = '/settings';
    }

    if (window.location.pathname !== targetPath) {
      window.history.pushState(
        { currentView, selectedProductId, selectedSellerId },
        '',
        targetPath
      );
    }

    if (activeChatId) {
      safeSessionStorage.setItem('tedbuy_active_chat_id', activeChatId);
    } else {
      safeSessionStorage.removeItem('tedbuy_active_chat_id');
    }
  }, [currentView, selectedProductId, selectedSellerId, activeChatId, products]);

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
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'products');
      setIsProductsLoading(false);
    });

    return unsub;
  }, []);

  // 2.2 Auto-Seeding Search Console Specific Products (24k pure black / 24k blue)
  useEffect(() => {
    if (isProductsLoading) return;
    
    const seedSelfHealingData = async () => {
      try {
        // Enforce verified seller is in the database for optimal profile views
        const sellerRef = doc(db, 'users', 'user_ted_verified');
        const sellerSnap = await getDoc(sellerRef);
        if (!sellerSnap.exists()) {
          const verifiedSeller: User = {
            id: 'user_ted_verified',
            username: 'Kofi_Perfumes_Gh',
            email: 'kofiperfumer@tedbuy.com',
            phoneNumber: '+233241234567',
            whatsAppNumber: '+233241234567',
            photoUrl: '',
            joinDate: '2024-03-12',
            role: 'seller'
          };
          await setDoc(sellerRef, cleanObject(verifiedSeller));
          console.log('[Seeder] Kofi_Perfumes_Gh verified seller profile created in Firestore.');
        }

        // Seed 24k Pure Black
        if (!products.some(p => p.id === 'prod_24k_pure_black')) {
          const prodPureBlack: Product = {
            id: 'prod_24k_pure_black',
            sellerId: 'user_ted_verified',
            sellerName: 'Kofi_Perfumes_Gh',
            sellerPhoto: '',
            sellerJoinDate: '2024-03-12',
            title: '24K Pure Black Eau de Toilette Perfume',
            brand: 'Lomani / Royal',
            category: 'Beauty and Care',
            description: 'Original 24K Pure Black Eau de Toilette for Men (100ml). A sweet, popular long-lasting bold fragrance in Ghana featuring deep notes of wood, leather, citrus and warm amber. Offers a masculine projection that commands attention. Highly requested on the Accra market. Trade safely on Tedbuy with verified delivery and direct trade.',
            price: 150,
            location: 'Accra, Greater Accra',
            condition: 'New',
            images: ['https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=600&q=80'],
            negotiable: true,
            createdAt: '2026-06-11T12:00:00.000Z',
            viewsCount: 147
          };
          await setDoc(doc(db, 'products', 'prod_24k_pure_black'), cleanObject(prodPureBlack));
          console.log('[Seeder] 24k Pure Black Perfume injected to Firestore.');
        }

        // Seed 24k Blue
        if (!products.some(p => p.id === 'prod_24k_blue')) {
          const prodBlueIntense: Product = {
            id: 'prod_24k_blue',
            sellerId: 'user_ted_verified',
            sellerName: 'Kofi_Perfumes_Gh',
            sellerPhoto: '',
            sellerJoinDate: '2024-03-12',
            title: '24K Blue Intense Perfume pour Homme',
            brand: 'Fragrance World',
            category: 'Beauty and Care',
            description: 'Certified 24K Blue Intense Perfume for Men (100ml). A premium refreshing active fragrance showcasing deep aquatic notes, fresh ocean tones, rich clary sage, and clean dry woods. Perfect for active lifestyles and hot weather in Ghana. Trade directly on Tedbuy.',
            price: 160,
            location: 'Kumasi, Ashanti',
            condition: 'New',
            images: ['https://images.unsplash.com/photo-1594035910387-fea47794261f?auto=format&fit=crop&w=600&q=80'],
            negotiable: true,
            createdAt: '2026-06-11T14:30:00.000Z',
            viewsCount: 198
          };
          await setDoc(doc(db, 'products', 'prod_24k_blue'), cleanObject(prodBlueIntense));
          console.log('[Seeder] 24k Blue Perfume injected to Firestore.');
        }

      } catch (err) {
        console.warn('[Seeder] Failed to ensure search-console listings:', err);
      }
    };

    seedSelfHealingData();
  }, [products, isProductsLoading]);

  // 2.5. Deep Linking and Browser URL Synchronization
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const params = new URLSearchParams(window.location.search);
      const urlProductId = params.get('productId');

      if (currentView === 'product-detail' && selectedProductId) {
        // If we are viewing a product, ensure the URL has the correct parameters
        const found = products.find(p => p.id === selectedProductId);
        if (found) {
          params.set('productId', selectedProductId);
          params.set('title', found.title);
          if (found.images && found.images[0] && !found.images[0].startsWith('data:')) {
            params.set('img', found.images[0]);
            params.set('image', found.images[0]);
          } else {
            params.delete('img');
            params.delete('image');
          }
          params.set('price', typeof found.price === 'number' ? `GH₵${found.price}` : String(found.price));
          params.set('location', found.location);
          
          const newSearch = `?${params.toString()}`;
          if (window.location.search !== newSearch) {
            window.history.replaceState({ path: window.location.pathname + newSearch }, '', window.location.pathname + newSearch);
          }
        }
      } else if (currentView === 'browse') {
        // Clear search parameters when return to browse
        if (window.location.search !== '') {
          window.history.replaceState({ path: window.location.pathname }, '', window.location.pathname);
        }
      }
    } catch (err) {
      console.warn('URL Sync Error:', err);
    }
  }, [currentView, selectedProductId, products]);

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
    msgMapRef.current.clear();
    if (!currentUser) {
      setMessages([]);
      return;
    }

    // Pre-populate with currently loaded messages from previous session backup to prevent flicker
    messages.forEach(m => {
      if (m.senderId === currentUser.id || m.recipientId === currentUser.id) {
        msgMapRef.current.set(m.id, m);
      }
    });

    const qSender = query(collection(db, 'messages'), where('senderId', '==', currentUser.id));
    const qRecipient = query(collection(db, 'messages'), where('recipientId', '==', currentUser.id));

    const updateCombined = () => {
      const sorted = (Array.from(msgMapRef.current.values()) as Message[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      setMessages(sorted);
      try {
        safeLocalStorage.setItem('tedbuy_local_messages_backup', JSON.stringify(sorted));
      } catch (err) {
        console.warn('Could not save messages backup:', err);
      }
    };

    const unsub1 = onSnapshot(qSender, (snap) => {
      snap.forEach(docSnap => {
        msgMapRef.current.set(docSnap.id, docSnap.data() as Message);
      });
      updateCombined();
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'messages');
    });

    const unsub2 = onSnapshot(qRecipient, (snap) => {
      snap.forEach(docSnap => {
        msgMapRef.current.set(docSnap.id, docSnap.data() as Message);
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
      // Identifier is a username, phone number, or WhatsApp number (e.g. Ama, +233...)
      let targetEmail: string | null = null;

      const normalizePhone = (num: string): string => {
        if (!num) return '';
        const digits = num.replace(/\D/g, '');
        // If it starts with '0' and followed by 9 digits (standard local Ghana format), convert '0' to '233'
        if (digits.startsWith('0') && digits.length === 10) {
          return '233' + digits.substring(1);
        }
        return digits;
      };

      const normalizedInput = normalizePhone(cleanIdentifier);

      try {
        const usersSnap = await getDocs(collection(db, 'users'));
        usersSnap.forEach((docSnap) => {
          const u = docSnap.data() as User;
          const matchUsername = u.username?.toLowerCase() === cleanIdentifier.toLowerCase();
          
          const userPhoneNormalized = u.phoneNumber ? normalizePhone(u.phoneNumber) : '';
          const userWhatsAppNormalized = u.whatsAppNumber ? normalizePhone(u.whatsAppNumber) : '';
          
          const matchPhone = normalizedInput && userPhoneNormalized && userPhoneNormalized === normalizedInput;
          const matchWhatsApp = normalizedInput && userWhatsAppNormalized && userWhatsAppNormalized === normalizedInput;
          
          if (matchUsername || matchPhone || matchWhatsApp) {
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
      sellerPhoto: currentUser.photoUrl || '',
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
    const updated = messages.map(m => {
      if (m.chatId === chatId && m.recipientId === currentUser.id && !m.read) {
        // Synchronously update msgMapRef so any subsequent background snapshot doesn't revert it
        msgMapRef.current.set(m.id, { ...m, read: true });
        return { ...m, read: true };
      }
      return m;
    });

    setMessages(updated);
    try {
      safeLocalStorage.setItem('tedbuy_local_messages_backup', JSON.stringify(updated));
    } catch (err) {
      console.warn('Could not save messages backup:', err);
    }

    try {
      const promises = unreadMsgs.map(msg =>
        updateDoc(doc(db, 'messages', msg.id), { read: true })
      );
      await Promise.all(promises);
    } catch (err) {
      console.error('Error marking messages as read in Firestore:', err);
    }
  };

  const toggleMessageReadStatus = async (messageId: string, read: boolean = true) => {
    setMessages(prev => {
      const next = prev.map(m => m.id === messageId ? { ...m, read } : m);
      const targetMsg = msgMapRef.current.get(messageId);
      if (targetMsg) {
        msgMapRef.current.set(messageId, { ...targetMsg, read });
      }
      try {
        safeLocalStorage.setItem('tedbuy_local_messages_backup', JSON.stringify(next));
      } catch (err) {
        console.warn('Could not save messages backup:', err);
      }
      return next;
    });

    try {
      await updateDoc(doc(db, 'messages', messageId), { read });
    } catch (err) {
      console.error('Error toggling message read status in Firestore:', err);
      handleFirestoreError(err, OperationType.UPDATE, `messages/${messageId}`);
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
      buyerPhoto: currentUser.photoUrl || '',
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

  const refreshProducts = async () => {
    setIsProductsLoading(true);
    await new Promise(resolve => setTimeout(resolve, 800));
    try {
      const snapshot = await getDocs(collection(db, 'products'));
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
    } catch (err) {
      console.error('Error manually refreshing products:', err);
    } finally {
      setIsProductsLoading(false);
    }
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
      toggleMessageReadStatus,
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
      isProductsLoading,
      refreshProducts
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
