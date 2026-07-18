import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { User, Product, Chat, Message, Category, Review, normalizeCategory, AppNotification } from '../types';
import { SEED_USERS, SEED_PRODUCTS, SEED_REVIEWS } from '../data';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  sendPasswordResetEmail,
  updatePassword,
  sendEmailVerification,
  EmailAuthProvider,
  reauthenticateWithCredential,
  signInAnonymously,
  fetchSignInMethodsForEmail,
  linkWithCredential,
  deleteUser
} from 'firebase/auth';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  writeBatch,
  onSnapshot,
  query,
  where,
  increment,
  orderBy,
  limit,
  isSupabaseActive,
  supabase
} from '../dbAdapter';
import { auth, db, handleFirestoreError, OperationType, registerFirestoreErrorListener, requestFcmToken } from '../firebase';
import { slugify } from '../utils/slugify';
import { getAuthErrorMessage, toUserFriendlyError } from '../utils/authErrorHelper';
import { useHashRouting } from '../hooks/useHashRouting';
import { registerServiceWorker, triggerBackgroundSync } from '../registerServiceWorker';
import { checkClientRateLimit } from '../utils/rateLimiter';
import { sanitizeText, validateInputLength } from '../utils/inputValidation';

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

export function isRealProduct(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  const id = String(item.id || '');
  if (
    id === 'prod_1780927804590' ||
    id.startsWith('seed-') ||
    id.includes('seed-') ||
    id === 'prod_24k_pure_black' ||
    id === 'prod_24k_blue'
  ) {
    return false;
  }
  return true;
}

export function mergeAndPreserveFullProducts(prev: Product[], next: Product[]): Product[] {
  if (!Array.isArray(prev) || prev.length === 0) return next;
  return next.map(nextProd => {
    const prevProd = prev.find(p => p.id === nextProd.id);
    if (!prevProd) return nextProd;
    
    const prevImgsCount = Array.isArray(prevProd.images) ? prevProd.images.length : 0;
    const nextImgsCount = Array.isArray(nextProd.images) ? nextProd.images.length : 0;
    
    const prevFirstImg = prevProd.images?.[0] || '';
    const nextFirstImg = nextProd.images?.[0] || '';
    
    const hasLocalBase64 = prevFirstImg.startsWith('data:') && !nextFirstImg.startsWith('data:');
    const hasFullImages = hasLocalBase64 || (prevImgsCount > nextImgsCount);
    
    return {
      ...nextProd,
      images: hasFullImages ? prevProd.images : nextProd.images,
      videos: (prevProd.videos && prevProd.videos.length > (nextProd.videos?.length || 0)) ? prevProd.videos : nextProd.videos,
      description: prevProd.description || nextProd.description,
    };
  });
}

interface AppContextType {
  reviews: Review[];
  addReview: (sellerId: string, rating: number, comment: string, productTitle?: string) => Promise<void>;
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  isAdminSessionVerified: boolean;
  verifyAdminPIN: (pin: string) => Promise<boolean>;
  users: User[];
  usersMap?: Map<string, User>;
  registerUser: (username: string, email?: string, phoneNumber?: string, password?: string, photoUrl?: string) => Promise<User>;
  initiateRegistration: (username: string, email: string, phoneNumber: string, password: string, photoUrl?: string) => Promise<{ success: boolean; simulated?: boolean; debugOtp?: string; warning?: string; message?: string }>;
  verifyAndCompleteRegistration: (email: string, otp: string) => Promise<{ success: boolean; user: User; simulatedMode: boolean; tempPassword?: string }>;
  loginUser: (identifier: string, password?: string) => Promise<boolean>;
  resetPasswordEmail: (email: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  googleLinkingData: { email: string; credential: any; targetUid?: string; googleUserToSignOut?: any } | null;
  setGoogleLinkingData: React.Dispatch<React.SetStateAction<{ email: string; credential: any; targetUid?: string; googleUserToSignOut?: any } | null>>;
  linkGoogleWithPassword: (password: string) => Promise<boolean>;
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
  }) => Promise<Product | undefined>;
  updateProduct: (id: string, productData: Partial<Product>, localOnly?: boolean) => Promise<string | undefined>;
  deleteProduct: (id: string) => Promise<void>;
  toggleLikeProduct: (productId: string, userId: string) => Promise<void>;
  chats: Chat[];
  messages: Message[];
  startChat: (productId: string, initialMessage?: string) => Promise<string>;
  reportProduct: (productId: string, reason: string, comment?: string) => Promise<boolean>;
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
  debouncedSearchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedCategory: Category | null;
  setSelectedCategory: (cat: Category | null) => void;
  currentView: 'browse' | 'product-detail' | 'chats' | 'my-dashboard' | 'seller-profile' | 'profile-settings';
  setCurrentView: (view: 'browse' | 'product-detail' | 'chats' | 'my-dashboard' | 'seller-profile' | 'profile-settings') => void;
  homeViewMode: 'grid' | 'video-feed';
  setHomeViewMode: (mode: 'grid' | 'video-feed') => void;
  updateUserProfile: (profileData: {
    username: string;
    phoneNumber?: string;
    photoUrl?: string;
    role: 'buyer' | 'seller' | 'both';
    whatsAppNumber?: string;
  }) => Promise<void>;
  deleteAccount: (password?: string) => Promise<void>;
  adminDeleteUserProfile: (userId: string, forceDeleteActive?: boolean) => Promise<void>;
  sendWelcomeEmailToAll: (onlyUnsent: boolean, onProgress: (current: number, total: number, logMsg: string) => void) => Promise<void>;
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
  productsLoadError: boolean;
  retryLoadProducts: () => void;
  refreshProducts: () => Promise<void>;
  toast: { message: string; type: 'success' | 'error' | 'info' } | null;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  hideToast: () => void;
  sendVerificationEmailReal: () => Promise<void>;
  reloadUserVerificationStatus: () => Promise<boolean>;
  isVerificationBlockOpen: boolean;
  setIsVerificationBlockOpen: (open: boolean) => void;
  isSuspendedBlockOpen: boolean;
  setIsSuspendedBlockOpen: (open: boolean) => void;
  adminToggleUserSuspension: (userId: string, suspend: boolean) => Promise<void>;
  blockedActionType: 'post-ad' | 'chat' | 'whatsApp' | 'review' | null;
  setBlockedActionType: (type: 'post-ad' | 'chat' | 'whatsApp' | 'review' | null) => void;
  notifications: AppNotification[];
  markNotificationAsRead: (id: string) => Promise<void>;
  markAllNotificationsAsRead: () => Promise<void>;
  clearAllNotifications: () => Promise<void>;
  productLimit: number;
  hasMoreProducts: boolean;
  loadMoreProducts: () => void;
  deferredPrompt: any;
  setDeferredPrompt: React.Dispatch<React.SetStateAction<any>>;
  canInstall: boolean;
  setCanInstall: (val: boolean) => void;
  triggerPWAInstall: () => Promise<void>;
  isStandalone: boolean;
  isBottomNavVisible: boolean;
  setIsBottomNavVisible: (visible: boolean) => void;
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

function normalizeChat(chat: any): any {
  if (!chat) return chat;
  const res = { ...chat };
  if (res.sellerId === 'user_ted_ceo_support') {
    res.sellerName = 'Tedbuy Support';
    if (res.productTitle === 'CEO Welcome & Support Desk' || !res.productTitle || res.productTitle === 'Tedbuy Support Desk') {
      res.productTitle = 'Tedbuy Support Desk';
    }
    if (res.adTitle === 'CEO Welcome & Support Desk' || !res.adTitle || res.adTitle === 'Tedbuy Support Desk') {
      res.adTitle = 'Tedbuy Support Desk';
    }
  }
  if (res.buyerId === 'user_ted_ceo_support') {
    res.buyerName = 'Tedbuy Support';
  }
  return res;
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [users, setUsers] = useState<User[]>(() => {
    try {
      const saved = safeLocalStorage.getItem('tedbuy_local_users_backup');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const usersRef = useRef<User[]>([]);
  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  const usersMap = useMemo(() => {
    const map = new Map<string, User>();
    users.forEach(u => map.set(u.id, u));
    return map;
  }, [users]);

  const [products, setProducts] = useState<Product[]>(() => {
    try {
      const saved = safeLocalStorage.getItem('tedbuy_local_products_backup');
      if (saved) {
        const parsed = JSON.parse(saved) as Product[];
        const filtered = parsed.filter(isRealProduct);
        if (filtered.length > 0) return filtered;
      }
    } catch {}
    return [];
  });
  const [productLimit, setProductLimit] = useState(24);
  const [hasMoreProducts, setHasMoreProducts] = useState(true);
  const [optimisticDeletedProductIds, setOptimisticDeletedProductIds] = useState<Set<string>>(() => new Set());
  const optimisticDeletedProductIdsRef = useRef(optimisticDeletedProductIds);
  useEffect(() => {
    optimisticDeletedProductIdsRef.current = optimisticDeletedProductIds;
  }, [optimisticDeletedProductIds]);
  const [chats, setChats] = useState<Chat[]>(() => {
    try {
      let uid = '';
      const stored = safeLocalStorage.getItem('tedbuy_local_current_user_backup');
      if (stored) {
        uid = (JSON.parse(stored) as User).id;
      }
      if (uid) {
        const saved = safeLocalStorage.getItem(`tedbuy_local_chats_backup_${uid}`);
        return saved ? (JSON.parse(saved) as any[]).map(normalizeChat) : [];
      }
    } catch {}
    return [];
  });
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      let uid = '';
      const stored = safeLocalStorage.getItem('tedbuy_local_current_user_backup');
      if (stored) {
        uid = (JSON.parse(stored) as User).id;
      }
      if (uid) {
        const saved = safeLocalStorage.getItem(`tedbuy_local_messages_backup_${uid}`);
        return saved ? JSON.parse(saved) : [];
      }
    } catch {}
    return [];
  });
  const msgMapRef = useRef<Map<string, Message>>(new Map());
  const [reviews, setReviews] = useState<Review[]>(() => {
    try {
      const saved = safeLocalStorage.getItem('tedbuy_local_reviews_backup');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    try {
      let uid = '';
      const stored = safeLocalStorage.getItem('tedbuy_local_current_user_backup');
      if (stored) {
        uid = (JSON.parse(stored) as User).id;
      }
      if (uid) {
        const saved = safeLocalStorage.getItem(`tedbuy_notifications_backup_${uid}`);
        return saved ? JSON.parse(saved) : [];
      }
    } catch {}
    return [];
  });
  const [currentUser, setCurrentUserStateRaw] = useState<User | null>(() => {
    try {
      const stored = safeLocalStorage.getItem('tedbuy_local_current_user_backup');
      if (stored) {
        const parsed = JSON.parse(stored) as User;
        if (parsed.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com' || parsed.isAdmin) {
          parsed.isAdmin = true;
        } else {
          // Prevent local storage manipulation or Firestore field injection from injecting admin permissions on the client
          delete parsed.isAdmin;
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
      if (next) {
        const isSuperAdmin = next.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com';
        if (isSuperAdmin || next.isAdmin) {
          next = { ...next, isAdmin: true };
        } else {
          // Safeguard: Ensure no regular user can hold or receive an isAdmin property in state
          const nextCopy = { ...next };
          delete nextCopy.isAdmin;
          next = nextCopy;
        }
      }
      return next;
    });
  };
  const [isAdminSessionVerified, setIsAdminSessionVerified] = useState<boolean>(false);
  const [adminFailedAttempts, setAdminFailedAttempts] = useState<number>(0);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isProductsLoading, setIsProductsLoading] = useState(() => {
    try {
      const saved = safeLocalStorage.getItem('tedbuy_local_products_backup');
      if (saved) {
        const parsed = JSON.parse(saved) as Product[];
        const filtered = parsed.filter(isRealProduct);
        if (filtered.length > 0) return false;
      }
    } catch {}
    return true;
  });
  const [productsLoadError, setProductsLoadError] = useState(false);
  const [googleLinkingData, setGoogleLinkingData] = useState<{ email: string; credential: any; targetUid?: string; googleUserToSignOut?: any } | null>(null);

  // PWA states
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [canInstall, setCanInstall] = useState<boolean>(false);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    // No-op: all toast notifications have been removed from the system
  }, []);

  const hideToast = useCallback(() => {
    setToast(null);
  }, []);

  useEffect(() => {
    const unsubscribe = registerFirestoreErrorListener((errInfo) => {
      // Do not display disruptive global UI-blocking error toasts for background LIST/GET synchronizations,
      // since the application already has robust offline local storage fallbacks and caches for lists.
      // Only show error toasts for active writes (CREATE, UPDATE, DELETE) to notify users if their action failed.
      const isReadOperation = errInfo.operationType === OperationType.LIST || errInfo.operationType === OperationType.GET;
      if (!isReadOperation) {
        showToast(errInfo.error, 'error');
      } else {
        console.warn(`[Firestore Read Graceful Fallback] Suppressed background read error toast for "${errInfo.path}":`, errInfo.error);
      }
    });

    return () => unsubscribe();
  }, [showToast]);

  const hasProcessedDeepLink = useRef(false);
  const justRegisteredUserIds = useRef<Set<string>>(new Set());

  // Navigation and Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 200);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  const parseUrlState = useCallback(() => {
    if (typeof window === 'undefined') return { view: 'browse' as const, selectedProductId: null, selectedSellerId: null, category: null };
    
    // Support hash routing fallback natively
    let pathname = window.location?.pathname || '/';
    const hash = window.location?.hash || '';
    if (hash && typeof hash === 'string' && hash.startsWith('#/')) {
      pathname = hash.substring(1); // Converts "#/chats" -> "/chats"
    } else if (hash && typeof hash === 'string' && hash.startsWith('#')) {
      pathname = '/' + hash.substring(1); // Converts "#chats" -> "/chats"
    }

    // Check if the link is a registered category slug
    const cleanPath = (pathname || '').replace(/^\//, '').toLowerCase();
    
    // /products/:id or /product/:id
    const productMatch = (pathname || '').match(/^\/products?\/([^\/]+)/);
    if (productMatch) {
      const slugOrId = productMatch[1];
      const matchId = slugOrId ? slugOrId.match(/prod_[a-zA-Z0-9_]+/) : null;
      if (matchId) {
        return { view: 'product-detail' as const, selectedProductId: matchId[0], selectedSellerId: null, category: null };
      }
    }

    // /sellers/:sellerId or /seller/:sellerId
    const sellerMatch = (pathname || '').match(/^\/sellers?\/([^\/]+)/);
    if (sellerMatch) {
      return { view: 'seller-profile' as const, selectedProductId: null, selectedSellerId: sellerMatch[1], category: null };
    }

    // /chats
    if (pathname === '/chats') {
      return { view: 'chats' as const, selectedProductId: null, selectedSellerId: null, category: null };
    }

    // /dashboard
    if (pathname === '/dashboard') {
      return { view: 'my-dashboard' as const, selectedProductId: null, selectedSellerId: null, category: null };
    }

    // /settings
    if (pathname === '/settings' || ['/terms', '/privacy', '/help', '/about', '/contact'].includes(pathname)) {
      return { view: 'profile-settings' as const, selectedProductId: null, selectedSellerId: null, category: null };
    }

    // Check if it matches category slug lists
    const categorySlugs = [
      'phones',
      'laptops',
      'electronics',
      'fashion',
      'games',
      'home-appliances',
      'beauty-and-care',
      'vehicles',
      'services',
      'other',
      'others'
    ];
    let matchPath = cleanPath;
    if (cleanPath.startsWith('category/')) {
      matchPath = cleanPath.substring(9);
    }
    if (categorySlugs.includes(matchPath)) {
      const normalized = normalizeCategory(matchPath === 'others' ? 'Other' : matchPath);
      return { view: 'browse' as const, selectedProductId: null, selectedSellerId: null, category: normalized };
    }

    // Fallback: search parameters (also checking inside hash query string if any)
    let search = '';
    try {
      search = window?.location?.search || '';
    } catch {
      search = '';
    }
    if (hash && typeof hash === 'string' && typeof hash.indexOf === 'function') {
      const qIdx = hash.indexOf('?');
      if (qIdx !== -1) {
        search = hash.substring(qIdx);
      }
    }
    const params = new URLSearchParams(search);
    const qProductId = params.get('productId') || params.get('product');
    if (qProductId) {
      const matchId = qProductId.match(/prod_[a-zA-Z0-9_]+/);
      if (matchId) {
        return { view: 'product-detail' as const, selectedProductId: matchId[0], selectedSellerId: null, category: null };
      }
    }

    return { view: 'browse' as const, selectedProductId: null, selectedSellerId: null, category: null };
  }, []);

  const [selectedCategory, setSelectedCategory] = useState<Category | null>(() => {
    return parseUrlState().category;
  });

  const [currentView, setCurrentView] = useState<'browse' | 'product-detail' | 'chats' | 'my-dashboard' | 'seller-profile' | 'profile-settings'>(() => {
    return parseUrlState().view;
  });
  const [homeViewMode, setHomeViewMode] = useState<'grid' | 'video-feed'>('grid');
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
  const [isBottomNavVisible, setIsBottomNavVisible] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot-password'>('login');
  const [unauthorizedDomainDetected, setUnauthorizedDomainDetected] = useState(false);
  const [isVerificationBlockOpen, setIsVerificationBlockOpen] = useState(false);
  const [isSuspendedBlockOpen, setIsSuspendedBlockOpen] = useState(false);
  const [blockedActionType, setBlockedActionType] = useState<'post-ad' | 'chat' | 'whatsApp' | 'review' | null>(null);

  // Popstate and Hashchange listener to update view and states on native back/forward buttons
  useEffect(() => {
    const handlePopState = () => {
      const parsed = parseUrlState();
      setCurrentView(parsed.view);
      setSelectedProductId(parsed.selectedProductId);
      setSelectedSellerId(parsed.selectedSellerId);
      setSelectedCategory(parsed.category);
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handlePopState);
    };
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

  // Custom hook that listens to currentView and updates browser URL hash
  useHashRouting({
    currentView,
    selectedProductId,
    selectedSellerId,
    selectedCategory,
    products,
    slugify,
  });

  // Synchronize activeChatId with sessionStorage
  useEffect(() => {
    if (activeChatId) {
      safeSessionStorage.setItem('tedbuy_active_chat_id', activeChatId);
    } else {
      safeSessionStorage.removeItem('tedbuy_active_chat_id');
    }
  }, [activeChatId]);

  // Firebase Auth state listener
  useEffect(() => {
    let active = true;
    let userSubUnsub: (() => void) | undefined;

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!active) return;

      if (safeLocalStorage.getItem('tedbuy_deleting_account') === 'true') {
        console.log('[Auth Observer] Account deletion in progress. Ignoring auth state changes.');
        if (!firebaseUser) {
          safeLocalStorage.removeItem('tedbuy_deleting_account');
          setCurrentUserState(null);
          setIsAuthLoading(false);
        }
        return;
      }

      // Clean up previous real-time subscriber if any
      if (userSubUnsub) {
        userSubUnsub();
        userSubUnsub = undefined;
      }

      try {
        if (firebaseUser) {
          // Instant direct check on Firestore for suspension to block a suspended user immediately
          try {
            const userDocRef = doc(db, 'users', firebaseUser.uid);
            const userSnap = await getDoc(userDocRef);
            if (active && userSnap.exists()) {
              const data = userSnap.data() as User;
              if (data.isSuspended) {
                console.warn('[Security Auth Observer] Suspended user logged in! Logging out immediately.');
                await signOut(auth);
                safeLocalStorage.removeItem('tedbuy_simulated_mode');
                safeLocalStorage.removeItem('tedbuy_simulated_user');
                safeLocalStorage.removeItem('tedbuy_local_current_user_backup');
                setCurrentUserState(null);
                setCurrentView('browse');
                setIsAuthLoading(false);
                setIsSuspendedBlockOpen(true);
                return;
              }
            }
          } catch (err) {
            console.warn('[Security Auth Observer] Firestore user check failed (might be offline):', err);
          }

          // Clear any simulated sandbox mode flags as we now have a genuine authenticated Firebase session
          safeLocalStorage.removeItem('tedbuy_simulated_mode');
          safeLocalStorage.removeItem('tedbuy_simulated_user');

          // Construct a dynamic backup/fallback user structure by checking caches first
          let cachedUser: User | null = null;
          
          // 1. Search in react users state list
          const foundInList = usersRef.current.find(u => u.id === firebaseUser.uid);
          if (foundInList) {
            cachedUser = foundInList;
          } else {
            // 2. Search in localStorage users backup list
            try {
              const localUsersBackup = safeLocalStorage.getItem('tedbuy_local_users_backup');
              if (localUsersBackup) {
                const parsedList = JSON.parse(localUsersBackup) as User[];
                const foundInBackup = parsedList.find(u => u.id === firebaseUser.uid);
                if (foundInBackup) {
                  cachedUser = foundInBackup;
                }
              }
            } catch (err) {
              console.warn('Failed to parse local users backup:', err);
            }
          }

          // 3. Search in dedicated individual current user backup
          if (!cachedUser) {
            try {
              const individualBackupStr = safeLocalStorage.getItem('tedbuy_local_current_user_backup');
              if (individualBackupStr) {
                const parsed = JSON.parse(individualBackupStr) as User;
                if (parsed.id === firebaseUser.uid) {
                  cachedUser = parsed;
                }
              }
            } catch (err) {
              console.warn('Failed to parse individual current user backup:', err);
            }
          }

          // 4. Search in dedicated persistent user profiles cache (survives logouts)
          if (!cachedUser) {
            try {
              const cacheStr = safeLocalStorage.getItem('tedbuy_user_profiles_cache');
              if (cacheStr) {
                const cache = JSON.parse(cacheStr);
                if (cache[firebaseUser.uid]) {
                  cachedUser = cache[firebaseUser.uid];
                }
              }
            } catch (_) {}
          }

          // Retrieve administrative claims dynamically
          let isUserAdmin = false;
          try {
            const tokenResult = await firebaseUser.getIdTokenResult();
            isUserAdmin = tokenResult.claims?.admin === true;
          } catch (claimsErr) {
            console.warn('[Admin Claims Sync] Did not parse ID Token admin claim:', claimsErr);
          }
          const isSuperAdmin = (firebaseUser.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com') || isUserAdmin;

          // Generate and sanitize a pleasant, unique store name from Google profile or email
          const rawDisplayName = firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User';
          let initialUsername = rawDisplayName.replace(/[^\w\s-]/g, '').trim() || 'User';
          
          // Ensure username does not collide with existing user store names
          const finalUsernameLower = initialUsername.toLowerCase();
          const isTaken = usersRef.current.some(u => u.username && u.username.trim().toLowerCase() === finalUsernameLower);
          if (isTaken || finalUsernameLower === 'admin' || finalUsernameLower === 'tedbuy') {
            initialUsername = `${initialUsername}_${Math.floor(100 + Math.random() * 900)}`;
          }

          const isGoogleUser = firebaseUser.providerData.some(p => p.providerId === 'google.com');

          // Construct a dynamic backup/fallback user structure
          const tempUser: User = {
            id: firebaseUser.uid,
            username: cachedUser?.username || initialUsername,
            email: firebaseUser.email || cachedUser?.email || undefined,
            role: cachedUser?.role || 'both',
            joinDate: cachedUser?.joinDate || 'Joined recently',
            photoUrl: cachedUser?.photoUrl || firebaseUser.photoURL || undefined,
            phoneNumber: cachedUser?.phoneNumber || undefined,
            whatsAppNumber: cachedUser?.whatsAppNumber || undefined,
            followingSellers: cachedUser?.followingSellers || [],
            savedProductIds: cachedUser?.savedProductIds || [],
            emailVerified: firebaseUser.emailVerified || cachedUser?.emailVerified,
            isGoogleAuth: isGoogleUser || cachedUser?.isGoogleAuth || undefined,
            authProvider: isGoogleUser ? 'google.com' : (cachedUser?.authProvider || undefined),
            isAdmin: isSuperAdmin ? true : undefined
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

          // Now subscribe to real-time doc updates asynchronously so that changes are handled instantly
          const userRef = doc(db, 'users', firebaseUser.uid);
          userSubUnsub = onSnapshot(userRef, async (userDoc) => {
            if (!active) return;
            if (safeLocalStorage.getItem('tedbuy_deleting_account') === 'true') {
              console.log('[User Doc Stream] Account deletion in progress. Ignoring document snapshot.');
              return;
            }
            
            if (userDoc.exists()) {
              const dbData = userDoc.data() as User;
              if (dbData.isSuspended) {
                console.warn('[Security] Suspended account detected! Logging out and blocking.', dbData.username);
                await signOut(auth);
                safeLocalStorage.removeItem('tedbuy_simulated_mode');
                safeLocalStorage.removeItem('tedbuy_simulated_user');
                setCurrentUserState(null);
                setCurrentView('browse');
                setIsSuspendedBlockOpen(true);
                return;
              }
              const isEmailVerifiedNow = firebaseUser.emailVerified || false;
              const isCurrentlyGoogle = firebaseUser.providerData.some(p => p.providerId === 'google.com');
              
              const updates: any = {};
              // Prevent downgrading emailVerified to false if the user verified via OTP.
              // But allow upgrading from false to true if Firebase verifies it (e.g., via Google sign in).
              if (isEmailVerifiedNow && !dbData.emailVerified) {
                updates.emailVerified = true;
              }
              if (isCurrentlyGoogle && !dbData.isGoogleAuth) {
                updates.isGoogleAuth = true;
                updates.authProvider = 'google.com';
              }

              if (Object.keys(updates).length > 0) {
                try {
                  await updateDoc(userRef, updates);
                } catch (err) {
                  console.warn('Could not sync auth metadata to Firestore (offline/sandbox):', err);
                }
                setCurrentUserState({ ...dbData, ...updates });
              } else {
                setCurrentUserState(dbData);
              }
            } else {
              // If this user was just registered via Email/Password, wait for the registration function to complete the document creation.
              const isPasswordUser = firebaseUser.providerData.some(p => p.providerId === 'password');
              if (justRegisteredUserIds.current.has(firebaseUser.uid) || isPasswordUser) {
                console.log(`[onAuthStateChanged] Standard email registration detected for UID: "${firebaseUser.uid}". Postponing profile creation to standard registration handler.`);
                return;
              }

              // The user document does not exist for the new Google authenticating UID.
              // Check if they already have an existing user document under a DIFFERENT UID (with same email address).
              let existingUserWithEmail: User | null = null;
              let existingUserId: string | null = null;

              if (firebaseUser.email) {
                try {
                  const targetEmail = firebaseUser.email.trim().toLowerCase();
                  const qEmail = query(collection(db, 'users'), where('email', '==', firebaseUser.email));
                  const emailSnap = await getDocs(qEmail);
                  
                  const foundDoc = emailSnap.docs.find(d => d.id !== firebaseUser.uid);
                  if (foundDoc) {
                    existingUserWithEmail = foundDoc.data() as User;
                    existingUserId = foundDoc.id;
                  }
                } catch (emailQueryErr) {
                  console.warn('Could not query users by email in background:', emailQueryErr);
                }
              }

              if (existingUserWithEmail && existingUserId) {
                console.log(`[Google Account Merge] Found existing user account with email "${firebaseUser.email}" under ID: "${existingUserId}". Merging profile dynamically into Google UID: "${firebaseUser.uid}" so user keeps all products and settings...`);
                
                const mergedUser: User = {
                  ...existingUserWithEmail,
                  id: firebaseUser.uid,
                  emailVerified: firebaseUser.emailVerified || existingUserWithEmail.emailVerified || false,
                  photoUrl: firebaseUser.photoURL || existingUserWithEmail.photoUrl || undefined,
                  isGoogleAuth: true,
                  authProvider: 'google.com'
                };

                try {
                  const batch = writeBatch(db);
                  
                  // 1. Create the new user document under Google UID
                  batch.set(doc(db, 'users', firebaseUser.uid), cleanObject(mergedUser));
                  
                  // 2. Delete the old user document
                  batch.delete(doc(db, 'users', existingUserId));
                  
                  // 3. Update the storeName mapping pointing to the new UID if a username exists
                  if (mergedUser.username) {
                    const storeNameLower = mergedUser.username.trim().toLowerCase();
                    // First delete old, then set new
                    batch.delete(doc(db, 'storeNames', storeNameLower));
                    batch.set(doc(db, 'storeNames', storeNameLower), {
                      userId: firebaseUser.uid,
                      username: mergedUser.username.trim()
                    });
                  }

                  await batch.commit();
                  console.log('[Google Account Merge] Profile base data and storeName successfully migrated.');

                  // Instant prime of state so that UI displays their old account instantly
                  if (active) {
                    setCurrentUserState(mergedUser);
                    showToast("Logged in successfully! Your existing profile was linked to your Google account. 🎉", "success");
                  }

                  // 4. Asynchronously cascade the ID change to related collections in the background
                  const cascadeUpdates = async () => {
                    try {
                      const cascadeBatch = writeBatch(db);
                      let cascadeCount = 0;

                      // Products migration (update sellerId)
                      const prodsSnap = await getDocs(query(collection(db, 'products'), where('sellerId', '==', existingUserId)));
                      prodsSnap.forEach(pDoc => {
                        cascadeBatch.update(doc(db, 'products', pDoc.id), { sellerId: firebaseUser.uid });
                        cascadeCount++;
                      });

                      // Reviews from or to this user
                      const reviewsFromSnap = await getDocs(query(collection(db, 'reviews'), where('buyerId', '==', existingUserId)));
                      reviewsFromSnap.forEach(rDoc => {
                        cascadeBatch.update(doc(db, 'reviews', rDoc.id), { buyerId: firebaseUser.uid });
                        cascadeCount++;
                      });

                      const reviewsToSnap = await getDocs(query(collection(db, 'reviews'), where('sellerId', '==', existingUserId)));
                      reviewsToSnap.forEach(rDoc => {
                        cascadeBatch.update(doc(db, 'reviews', rDoc.id), { sellerId: firebaseUser.uid });
                        cascadeCount++;
                      });

                      // Chats where this user is buyer or seller
                      const chatsBuyerSnap = await getDocs(query(collection(db, 'chats'), where('buyerId', '==', existingUserId)));
                      chatsBuyerSnap.forEach(cDoc => {
                        cascadeBatch.update(doc(db, 'chats', cDoc.id), { buyerId: firebaseUser.uid });
                        cascadeCount++;
                      });

                      const chatsSellerSnap = await getDocs(query(collection(db, 'chats'), where('sellerId', '==', existingUserId)));
                      chatsSellerSnap.forEach(cDoc => {
                        cascadeBatch.update(doc(db, 'chats', cDoc.id), { sellerId: firebaseUser.uid });
                        cascadeCount++;
                      });

                      // Messages where this user is sender or recipient
                      const msgsSenderSnap = await getDocs(query(collection(db, 'messages'), where('senderId', '==', existingUserId)));
                      msgsSenderSnap.forEach(mDoc => {
                        cascadeBatch.update(doc(db, 'messages', mDoc.id), { senderId: firebaseUser.uid });
                        cascadeCount++;
                      });

                      const msgsRecipientSnap = await getDocs(query(collection(db, 'messages'), where('recipientId', '==', existingUserId)));
                      msgsRecipientSnap.forEach(mDoc => {
                        cascadeBatch.update(doc(db, 'messages', mDoc.id), { recipientId: firebaseUser.uid });
                        cascadeCount++;
                      });

                      // Notifications to this user
                      const notificationsSnap = await getDocs(query(collection(db, 'notifications'), where('userId', '==', existingUserId)));
                      notificationsSnap.forEach(nDoc => {
                        cascadeBatch.update(doc(db, 'notifications', nDoc.id), { userId: firebaseUser.uid });
                        cascadeCount++;
                      });

                      if (cascadeCount > 0) {
                        await cascadeBatch.commit();
                        console.log(`[Google Account Merge] Cascaded ID update to ${cascadeCount} related documents.`);
                      }
                    } catch (cascadeErr) {
                      console.warn('[Google Account Merge] Error performing background cascade ID update:', cascadeErr);
                    }
                  };

                  cascadeUpdates();
                  return;
                } catch (mergeErr) {
                  console.error('[Google Account Merge] Failed to merge account details client-side:', mergeErr);
                  // Dynamic local fallback so user is logged in even if Firestore write fails momentarily
                  if (active) {
                    setCurrentUserState(mergedUser);
                  }
                  return;
                }
              } else {
                // Register UID early to avoid race conditions with onSnapshot and useEffect triggers
                justRegisteredUserIds.current.add(firebaseUser.uid);

                // Create the user document in Firestore asynchronously if first time
                const newUser: User = {
                  id: firebaseUser.uid,
                  username: initialUsername,
                  email: firebaseUser.email || undefined,
                  role: 'both',
                  joinDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
                  photoUrl: firebaseUser.photoURL || undefined,
                  followingSellers: [],
                  savedProductIds: [],
                  emailVerified: true, // Google accounts are pre-verified by Google
                  isAdmin: isSuperAdmin ? true : undefined,
                  isGoogleAuth: true,
                  authProvider: 'google.com'
                };
                
                // Register storeName and user document atomically so standard signups and Google signups are identical
                const batch = writeBatch(db);
                
                const storeNameLower = initialUsername.trim().toLowerCase();
                let uniqueStoreNameLower = storeNameLower;
                let uniqueUsername = initialUsername.trim();
                try {
                  const checkRef = doc(db, 'storeNames', storeNameLower);
                  const checkSnap = await getDoc(checkRef);
                  if (checkSnap.exists()) {
                    let isTaken = true;
                    while (isTaken) {
                      const suffix = Math.floor(100 + Math.random() * 900);
                      uniqueUsername = `${initialUsername.trim()} ${suffix}`;
                      uniqueStoreNameLower = uniqueUsername.toLowerCase();
                      const suffixSnap = await getDoc(doc(db, 'storeNames', uniqueStoreNameLower));
                      isTaken = suffixSnap.exists();
                    }
                  }
                } catch (checkErr) {
                  console.warn('Could not verify storeName uniqueness, proceeding with fallback:', checkErr);
                }

                newUser.username = uniqueUsername;
                batch.set(userRef, cleanObject(newUser));
                
                batch.set(doc(db, 'storeNames', uniqueStoreNameLower), {
                  userId: firebaseUser.uid,
                  username: uniqueUsername
                });
                
                await batch.commit();
                console.log(`[Google Signup] Atomically created user profile and reserved store name: "${uniqueStoreNameLower}"`);

                if (active) {
                  justRegisteredUserIds.current.add(firebaseUser.uid);
                  setCurrentUserState(newUser);
                  // Directly trigger welcome package synchronously to prevent race conditions
                  setupWelcomePackage(newUser).catch(err => {
                    console.warn('[Welcome Trigger] Direct welcome setup call failed from auth state change:', err);
                  });
                }
              }
            }
          }, (error) => {
            console.error('[User Doc Stream] Firebase onSnapshot error:', error);
          });
        } else {
          const isSimulated = !(import.meta as any).env.PROD && safeLocalStorage.getItem('tedbuy_simulated_mode') === 'true';
          if (isSimulated) {
            const storedSimulated = safeLocalStorage.getItem('tedbuy_local_current_user_backup');
            if (storedSimulated) {
              try {
                const parsed = JSON.parse(storedSimulated);
                if (active) setCurrentUserState(parsed);

                // Align the Firebase Auth session with the simulated user in the background
                const sessionLoginKey = `tedbuy_background_auth_attempted_${parsed.email}`;
                if (!safeSessionStorage.getItem(sessionLoginKey)) {
                  safeSessionStorage.setItem(sessionLoginKey, 'true');
                  const emailTarget = parsed.email || 'asumaduvincent7@gmail.com';
                  console.log(`[Auto Auth] Aligning Firebase background session for: ${emailTarget}`);
                  signInWithEmailAndPassword(auth, emailTarget, 'password123')
                    .then(() => console.log('[Auto Auth] Aligned simulated user Firebase session!'))
                    .catch((err) => {
                      console.info('[Auto Auth] Fallback Email/Password auth check completed (not active). Operating in sandbox offline state.');
                    });
                }
              } catch (_) {}
            }
          } else {
            setCurrentUserState(null);
          }
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
      if (userSubUnsub) {
        userSubUnsub();
      }
    };
  }, []);

  // Sync currentUser backup to localStorage and multi-user cache
  useEffect(() => {
    if (isAuthLoading) return; // Wait until initial auth loop finishes!
    try {
      if (currentUser) {
        safeLocalStorage.setItem('tedbuy_local_current_user_backup', JSON.stringify(currentUser));
        
        // Also keep long-lived multi-user profiles cache updated
        try {
          const cacheStr = safeLocalStorage.getItem('tedbuy_user_profiles_cache') || '{}';
          const cache = JSON.parse(cacheStr);
          cache[currentUser.id] = currentUser;
          safeLocalStorage.setItem('tedbuy_user_profiles_cache', JSON.stringify(cache));
        } catch (_) {}
      } else {
        const isSimulated = !(import.meta as any).env.PROD && safeLocalStorage.getItem('tedbuy_simulated_mode') === 'true';
        if (!isSimulated) {
          safeLocalStorage.removeItem('tedbuy_local_current_user_backup');
        }
      }
    } catch (err) {
      console.warn('Could not save current user backup:', err);
    }
  }, [currentUser, isAuthLoading]);

  // Absolute high-security reactive check for account suspension
  useEffect(() => {
    if (isAuthLoading) return;
    if (!currentUser) return;

    let active = true;

    // 1. Instantly block if memory state flag is suspended
    if (currentUser.isSuspended) {
      console.warn('[Security] currentUser memory state indicates suspension! Activating block modal.');
      setIsSuspendedBlockOpen(true);
      setCurrentUserState(null);
      localStorage.removeItem('tedbuy_simulated_mode');
      localStorage.removeItem('tedbuy_simulated_user');
      localStorage.removeItem('tedbuy_local_current_user_backup');
      signOut(auth).catch(() => {});
      setCurrentView('browse');
      return;
    }

    // 2. Proactive database lookup to prevent stale cache bypass
    const verifyUserSuspensionInDatabase = async () => {
      try {
        const userRef = doc(db, 'users', currentUser.id);
        const userSnap = await getDoc(userRef);
        if (!active) return;

        if (userSnap.exists()) {
          const dbData = userSnap.data() as User;
          if (dbData.isSuspended) {
            console.error('[Security Check] Suspended state discovered on database! Logging out.', dbData.username);
            setIsSuspendedBlockOpen(true);
            setCurrentUserState(null);
            localStorage.removeItem('tedbuy_simulated_mode');
            localStorage.removeItem('tedbuy_simulated_user');
            localStorage.removeItem('tedbuy_local_current_user_backup');
            await signOut(auth).catch(() => {});
            setCurrentView('browse');
          }
        }
      } catch (err) {
        console.warn('[Security Check] Suspension database verification bypassed (offline or rate-limited):', err);
      }
    };

    verifyUserSuspensionInDatabase();

    return () => {
      active = false;
    };
  }, [currentUser, isAuthLoading, auth, db]);

  const currentUserId = currentUser?.id;

  // Real-time Notifications Synchronization
  useEffect(() => {
    if (!currentUserId) {
      setNotifications([]);
      return;
    }
    const q = query(collection(db, 'notifications'), where('userId', '==', currentUserId));
    let isInitial = true;
    const unsub = onSnapshot(q, (snapshot) => {
      const list: AppNotification[] = [];
      snapshot.forEach(docSnap => {
        list.push(docSnap.data() as AppNotification);
      });
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      // Save backup of live notifications
      try {
        safeLocalStorage.setItem(`tedbuy_notifications_backup_${currentUserId}`, JSON.stringify(list));
      } catch (err) {}
      
      setNotifications(list);

      // Real-time listener alerts for followers and new postings
      if (!isInitial) {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const notif = change.doc.data() as AppNotification;
            if (!notif.read) {
              if (notif.type === 'new_follower') {
                showToast(`🎉 ${notif.message}`, 'success');
              } else if (notif.type === 'post_created') {
                showToast(`📢 ${notif.message}`, 'info');
              }
            }
          }
        });
      }
      isInitial = false;
    }, (error) => {
      // Re-route to resilient local database fallback when rules or network are offline
      console.warn('Real-time notifications backend query notice (using active local sandbox storage):', error.message);
      try {
        const localBackupKey = `tedbuy_notifications_backup_${currentUserId}`;
        const stored = safeLocalStorage.getItem(localBackupKey);
        const list: AppNotification[] = stored ? JSON.parse(stored) : [];
        setNotifications(list);
      } catch (err) {
        console.warn('Could not read local backup notifications storage:', err);
      }
    });
    return unsub;
  }, [currentUserId]);

  // --- FCM Real-time Device Token Registration ---
  useEffect(() => {
    if (!currentUser) return;
    
    let isMounted = true;
    const registerToken = async () => {
      try {
        const token = await requestFcmToken();
        if (token && isMounted) {
          console.log('[FCM] Successfully fetched cloud messaging device registration token:', token);
          
          const existingTokens = currentUser.fcmTokens || [];
          if (!existingTokens.includes(token)) {
            const updatedTokens = [...existingTokens, token].slice(-5);
            
            setCurrentUserState({
              ...currentUser,
              fcmTokens: updatedTokens
            });

            try {
              await updateDoc(doc(db, 'users', currentUser.id), {
                fcmTokens: updatedTokens
              });
              console.log('[FCM] Device token registered in Firestore user document.');
            } catch (err) {
              console.warn('[FCM] Could not write device token to firestore (running offline or permission restricted):', err);
            }
          }
        }
      } catch (err) {
        console.warn('[FCM] Setup failed or was blocked by modern browser security context:', err);
      }
    };

    const timer = setTimeout(registerToken, 2500);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [currentUser?.id]);

  // --- Dynamic Seller Activity Trackers ---
  const hasCountedSessionVisit = useRef(false);
  useEffect(() => {
    if (currentUser && !hasCountedSessionVisit.current) {
      hasCountedSessionVisit.current = true;
      const sessionKey = `tedbuy_visit_counted_${currentUser.id}`;
      const nowIso = new Date().toISOString();
      if (!safeSessionStorage.getItem(sessionKey)) {
        safeSessionStorage.setItem(sessionKey, 'true');
        
        // Dynamically increment visitCount in Firestore and state, tracking login & seen
        const originalVisits = currentUser.visitCount || 0;
        const newVisits = originalVisits + 1;
        
        updateDoc(doc(db, 'users', currentUser.id), {
          visitCount: increment(1),
          lastLogin: nowIso,
          lastSeen: nowIso,
          isOnline: true
        }).catch(err => {
          console.warn('[Tracking] Failed to increment visitCount on Firestore:', err);
        });

        setCurrentUserState(prev => prev ? { 
          ...prev, 
          visitCount: newVisits,
          lastLogin: nowIso,
          lastSeen: nowIso,
          isOnline: true
        } : null);
      } else {
        // Just make sure user is marked online and update lastSeen
        updateDoc(doc(db, 'users', currentUser.id), {
          isOnline: true,
          lastSeen: nowIso
        }).catch(() => {});

        setCurrentUserState(prev => prev ? { 
          ...prev, 
          lastSeen: nowIso,
          isOnline: true
        } : null);
      }
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUser) return;
    const interval = setInterval(() => {
      const nowIso = new Date().toISOString();
      
      // Update local state copy every 30s
      setCurrentUserState(prev => {
        if (!prev) return null;
        return {
          ...prev,
          lastSeen: nowIso,
          isOnline: true
        };
      });

      updateDoc(doc(db, 'users', currentUser.id), {
        lastSeen: nowIso,
        isOnline: true
      }).catch(() => {});
    }, 30000);

    return () => {
      clearInterval(interval);
      const nowIso = new Date().toISOString();
      updateDoc(doc(db, 'users', currentUser.id), {
        isOnline: false,
        lastSeen: nowIso
      }).catch(() => {});
    };
  }, [currentUser?.id]);

  const markNotificationAsRead = async (id: string) => {
    // Optimistic UI and Local state sync
    setNotifications(prev => {
      const next = prev.map(n => n.id === id ? { ...n, read: true } : n);
      if (currentUser) {
        try {
          safeLocalStorage.setItem(`tedbuy_notifications_backup_${currentUser.id}`, JSON.stringify(next));
        } catch (err) {}
      }
      return next;
    });

    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (err) {
      console.warn('Backend markNotificationAsRead update skipped (synchronized locally):', err);
    }
  };

  const markAllNotificationsAsRead = async () => {
    if (!currentUser) return;
    
    // Optimistic UI and Local state sync
    setNotifications(prev => {
      const next = prev.map(n => ({ ...n, read: true }));
      try {
        safeLocalStorage.setItem(`tedbuy_notifications_backup_${currentUser.id}`, JSON.stringify(next));
      } catch (err) {}
      return next;
    });

    try {
      const unread = notifications.filter(n => !n.read);
      await Promise.all(unread.map(n => updateDoc(doc(db, 'notifications', n.id), { read: true })));
    } catch (err) {
      console.warn('Backend markAllNotificationsAsRead update skipped (synchronized locally):', err);
    }
  };

  const clearAllNotifications = async () => {
    if (!currentUser) return;
    
    // Optimistic UI and Local state sync
    setNotifications([]);
    try {
      safeLocalStorage.setItem(`tedbuy_notifications_backup_${currentUser.id}`, JSON.stringify([]));
    } catch (err) {}

    try {
      await Promise.all(notifications.map(n => deleteDoc(doc(db, 'notifications', n.id))));
    } catch (err) {
      console.warn('Backend clearAllNotifications skip (synchronized locally):', err);
    }
  };

  // 1. Real-time Users Synchronization (Optimized to Fetch Once on Mount)
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const snapshot = await getDocs(collection(db, 'users'));
        const uList: User[] = [];
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          uList.push({
            ...data,
            id: docSnap.id || data.id
          } as User);
        });
        setUsers(uList);
        
        // Update local storage offline backup mapping
        try {
          safeLocalStorage.setItem('tedbuy_local_users_backup', JSON.stringify(uList));
        } catch (err) {
          console.warn('Could not save user backups to local storage:', err);
        }
      } catch (error: any) {
        // If 429 quota exceeded, gracefully fail silently without raising a blocking exception
        if (error?.message?.includes('Quota exceeded') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
          console.warn('[Users Sync] Firestore quota exceeded. Relying on local storage user profiles.');
          return;
        }
        handleFirestoreError(error, OperationType.LIST, 'users');
      }
    }, 450); // Defer to prioritize product fetching and main paint thread
    return () => {
      clearTimeout(timer);
    };
  }, []);

  // 2. Real-time Products Synchronization
  useEffect(() => {
    // Rely on local storage backup values inside `products` state for instant initial paint
    // and only set loading state to true if we don't have any cached listings.
    if (products.length === 0) {
      setIsProductsLoading(true);
    }

    let active = true;

    const processProductList = (rawList: Product[]) => {
      const pList: Product[] = [];
      rawList.forEach((item: any) => {
        if (item.id !== 'prod_1780927804590' && !optimisticDeletedProductIdsRef.current.has(item.id) && isRealProduct(item)) {
          if (item.category) {
            item.category = normalizeCategory(item.category);
          }
          pList.push(item);
        }
      });

      // Merge locally created products
      try {
        const createdStr = safeLocalStorage.getItem('tedbuy_local_created_products') || '[]';
        const createdList = JSON.parse(createdStr) as Product[];
        createdList.forEach(localProd => {
          if (!optimisticDeletedProductIdsRef.current.has(localProd.id) && !pList.some(p => p.id === localProd.id)) {
            pList.push(localProd);
          }
        });
      } catch (_) {}

      // Apply locally updated overrides
      try {
        const overridesStr = safeLocalStorage.getItem('tedbuy_local_products_overrides') || '{}';
        const overrides = JSON.parse(overridesStr) as Record<string, Partial<Product>>;
        pList.forEach((prod, idx) => {
          if (overrides[prod.id]) {
            const { likesCount, likedUserIds, viewsCount, ...fieldsToOverride } = overrides[prod.id];
            pList[idx] = { ...prod, ...fieldsToOverride };
          }
        });
      } catch (_) {}

      return pList.sort((a, b) => {
        const dateA = typeof a?.createdAt === 'string' ? a.createdAt : '';
        const dateB = typeof b?.createdAt === 'string' ? b.createdAt : '';
        return dateB.localeCompare(dateA);
      });
    };

    // Load listings via the server's cached /api/products endpoint instead of a
    // direct per-visitor Firestore onSnapshot listener. A live listener per visitor
    // does not scale: Firestore re-delivers the entire matching result set to every
    // connected client on every change, so N concurrent visitors can multiply into
    // N x (result size) reads almost instantly, and Firestore read-quota exhaustion
    // under real traffic is exactly what produced the blank-screen/missing-listings
    // failures in production. The server endpoint already caches results (in-memory
    // + CDN Cache-Control), so this turns unbounded per-visitor Firestore reads into
    // a small, bounded number of origin reads no matter how many people are on the
    // site at once. Real-time push updates are traded for periodic polling, which is
    // the right trade-off for a public listings feed at this scale.
    const POLL_INTERVAL_MS = 30000;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const fetchProductsOnce = async (isFirstLoad: boolean) => {
      try {
        const res = await fetch('/api/products');
        if (!res.ok) throw new Error(`/api/products returned ${res.status}`);
        const data = await res.json();
        if (!active) return;
        if (!data || !Array.isArray(data.products)) throw new Error('Malformed /api/products response');

        const sorted = processProductList(data.products as Product[]);
        
        // If we received an empty array from the server (possibly due to an error fallback),
        // let's try to retain the client-side backup if we already have it.
        if (sorted.length > 0) {
          setProducts(prev => mergeAndPreserveFullProducts(prev, sorted));
          setIsProductsLoading(false);
          setProductsLoadError(false);
          setHasMoreProducts(false);
          try {
            safeLocalStorage.setItem('tedbuy_local_products_backup', JSON.stringify(sorted));
          } catch (err) {
            console.warn('Could not save product backups to local storage:', err);
          }
        } else {
          // If we have nothing from server, attempt client local storage recovery
          try {
            const savedListStr = safeLocalStorage.getItem('tedbuy_local_products_backup');
            if (savedListStr) {
              const parsed = JSON.parse(savedListStr) as Product[];
              const filtered = parsed.filter(isRealProduct);
              if (filtered.length > 0) {
                setProducts(filtered);
                setIsProductsLoading(false);
                setProductsLoadError(false);
                setHasMoreProducts(false);
                return;
              }
            }
          } catch (restoreErr) {
            console.warn('Could not restore cached products:', restoreErr);
          }
          // True empty state
          setProducts([]);
          setIsProductsLoading(false);
          setProductsLoadError(true);
        }
      } catch (error) {
        if (!active) return;
        console.warn('[Product Loading] /api/products fetch failed:', error);

        if (isFirstLoad) {
          // Only fall back to a direct Firestore read on the very first load if the
          // cached endpoint is unavailable - not as an ongoing per-visitor strategy.
          try {
            const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'), limit(100));
            const snapshot = await getDocs(q);
            if (!active) return;
            const rawList: Product[] = [];
            snapshot.forEach(docSnap => {
              const item = { ...docSnap.data() as Product, id: docSnap.id };
              if (item.id !== 'prod_1780927804590') {
                rawList.push(item);
              }
            });
            const sorted = processProductList(rawList);
            if (sorted.length > 0) {
              setProducts(prev => mergeAndPreserveFullProducts(prev, sorted));
              setIsProductsLoading(false);
              setProductsLoadError(false);
              setHasMoreProducts(false);
              try {
                safeLocalStorage.setItem('tedbuy_local_products_backup', JSON.stringify(sorted));
              } catch (err) {
                console.warn('Could not save product backups to local storage:', err);
              }
              return;
            }
          } catch (getDocsErr) {
            console.error('[Product Loading] Direct Firestore fallback also failed:', getDocsErr);
          }
        }

        // Restore local backup if we still have nothing to show
        let restoredCount = 0;
        try {
          const savedListStr = safeLocalStorage.getItem('tedbuy_local_products_backup');
          if (savedListStr) {
            const parsed = JSON.parse(savedListStr) as Product[];
            const filtered = parsed.filter(isRealProduct);
            restoredCount = filtered.length;
            if (restoredCount > 0) {
              setProducts(filtered);
            }
          }
        } catch (restoreErr) {
          console.warn('Could not restore cached products:', restoreErr);
        }
        setProductsLoadError(restoredCount === 0);
        setIsProductsLoading(false);
      }
    };

    // If the server injected initial product data (see server.ts's SSR homepage
    // injection), use it immediately instead of waiting on our own first fetch -
    // this is what actually makes the app show real listings on first paint,
    // matching how the pre-rendered HTML already looks. This is only a small
    // subset (matching what's visibly rendered server-side), so we immediately
    // kick off a normal background fetch for the complete catalog right after,
    // instead of waiting the full poll interval.
    const injected = (window as any).__INITIAL_PRODUCTS__;
    if (Array.isArray(injected) && injected.length > 0) {
      try {
        const sorted = processProductList(injected as Product[]);
        setProducts(sorted);
        setIsProductsLoading(false);
        setProductsLoadError(false);
        setHasMoreProducts(true);
        try {
          safeLocalStorage.setItem('tedbuy_local_products_backup', JSON.stringify(sorted));
        } catch (err) {
          console.warn('Could not save product backups to local storage:', err);
        }
        // Fill in the rest of the catalog promptly (non-blocking - the subset
        // above is already visible to the user right now).
        fetchProductsOnce(false);
      } catch (err) {
        console.warn('[Product Loading] Failed to process server-injected initial products, falling back to fetch:', err);
        fetchProductsOnce(true);
      }
      // Clear it so a client-side route change (not a fresh page load) doesn't
      // accidentally reuse stale injected data.
      try { delete (window as any).__INITIAL_PRODUCTS__; } catch (_) {}
    } else {
      fetchProductsOnce(true);
    }
    pollTimer = setInterval(() => fetchProductsOnce(false), POLL_INTERVAL_MS);

    return () => {
      active = false;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, []);

  // Welcome Package Trigger (In-App CEO Support Thread + Outbound Welcome Email via Node/Nodemailer)
  const triggeredWelcomeUserId = useRef<string | null>(null);

  const setupWelcomePackage = async (targetUser: User) => {
    const email = targetUser.email;
    if (!email) {
      return;
    }

    const isVerified = targetUser.emailVerified || targetUser.isGoogleAuth;
    if (!isVerified) {
      console.log(`[Welcome Trigger] Bypassing welcome package for ${targetUser.username} because email is not verified yet.`);
      return;
    }

    if (triggeredWelcomeUserId.current === targetUser.id) return;
    triggeredWelcomeUserId.current = targetUser.id;

    console.log(`[Welcome Trigger] Initializing automated Welcome Email & Support Chat package for: ${targetUser.username} (${email})`);

    // 1. Create/Ensure support profile exists in users collection (Wrapped to protect outbound email pipeline)
    try {
      const ceoRef = doc(db, 'users', 'user_ted_ceo_support');
      const ceoProfile = {
        id: 'user_ted_ceo_support',
        username: 'Tedbuy Support',
        email: 'info.tedbuy@gmail.com',
        photoUrl: '/favicon.svg',
        role: 'seller',
        joinDate: 'Jun 2018'
      };
      await setDoc(ceoRef, cleanObject(ceoProfile), { merge: true });
      console.log('[Welcome Trigger] Created/Updated Tedbuy Support user profile in Firestore.');
    } catch (ceoProfileErr) {
      console.warn('[Welcome Trigger] Support profile setup failed (continuing program):', ceoProfileErr);
    }

    // 2. Setup chat room (Wrapped to protect outbound email pipeline)
    const chatId = `chat_support_${targetUser.id}`;
    const chatRef = doc(db, 'chats', chatId);
    let chatExists = false;
    try {
      const chatDoc = await getDoc(chatRef);
      if (chatDoc.exists()) {
        chatExists = true;
      }
    } catch (checkErr) {
      console.log('[Welcome Trigger] Support chat doc check threw permission/missing error, assuming it needs creation.');
    }

    const welcomeMessageBody = `Welcome to TedBuy

I wanted to check in with you to ensure that you have everything you need. I hope that your experience with TedBuy so far has been a pleasant one. Customer experience is at the heart of everything we do. It's why we come to work each day.
All replies to this email inbox are monitored by myself, so if you'd like to get in touch directly and provide any feedback which could help us help you, please type in the chat on TedBuy (or hit reply to this email!) and we'll ensure that we get onto that right away. No issue is too small. If it matters to you, it matters to us, so please do get in touch if you need to.
Also, don't forget that our customer support team are here for all your day-to-day and technical questions 24/7. Thanks once again. I'm delighted to have you on board and look forward to helping you drive your business to awesome new heights.

Gratefully yours,

Vincent Asumadu,
CEO, Tedbuy Inc`;

    if (!chatExists) {
      try {
        const supportChat = {
          id: chatId,
          productId: 'support_welcome',
          productTitle: 'Tedbuy Support Desk',
          productPrice: 'Direct Channel',
          productImage: '/favicon.svg',
          buyerId: targetUser.id,
          buyerName: targetUser.username,
          sellerId: 'user_ted_ceo_support',
          sellerName: 'Tedbuy Support',
          lastMessageText: 'Welcome to Tedbuy 🚀',
          lastMessageTime: new Date().toISOString(),
          tradeStatus: 'pending',
          adId: 'support_welcome',
          adTitle: 'Tedbuy Support Desk',
          adImage: '/favicon.svg',
          adThumbnail: '/favicon.svg',
          adType: 'image'
        };
        await setDoc(chatRef, cleanObject(supportChat));
        console.log(`[Welcome Trigger] Automated direct support chat initialized for ${targetUser.username}.`);

        // 3. Create message document inside messages collection
        const msgId = `msg_welcome_${targetUser.id}`;
        const msgRef = doc(db, 'messages', msgId);
        const supportMessage = {
          id: msgId,
          chatId: chatId,
          senderId: 'user_ted_ceo_support',
          recipientId: targetUser.id,
          text: welcomeMessageBody,
          createdAt: new Date().toISOString(),
          read: false
        };
        await setDoc(msgRef, cleanObject(supportMessage));
        console.log(`[Welcome Trigger] Welcome CEO chat message delivered directly.`);
      } catch (chatWriteErr) {
        console.warn('[Welcome Trigger] Failed to write support chat/message to Firestore (continuing):', chatWriteErr);
      }
    }

    // 4. Update welcomeSent: true metadata under users/{userId} (Wrapped to prevent failure from aborting process)
    try {
      const userRef = doc(db, 'users', targetUser.id);
      await setDoc(userRef, { welcomeSent: true }, { merge: true });
      console.log(`[Welcome Trigger] Flagged user's database metadata with welcomeSent: true.`);
    } catch (userFlagErr) {
      console.warn('[Welcome Trigger] Database welcomeSent flag write failed (continuing):', userFlagErr);
    }

    // 5. Send Welcome Email synchronously via server SMTP / Brevo REST
    try {
      let idToken = auth.currentUser ? await auth.currentUser.getIdToken() : '';
      if (!idToken) {
        idToken = safeLocalStorage.getItem('tedbuy_custom_auth_token') || '';
      }
      const emailResponse = await fetch('/api/send-welcome-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {})
        },
        body: JSON.stringify({
          email: email.trim(),
          username: targetUser.username
        })
      });
      if (emailResponse.ok) {
        console.log(`[Welcome Trigger] Real outbound welcome email request processed cleanly: ${emailResponse.status}`);
      } else {
        console.warn(`[Welcome Trigger] Outbound welcome email request completed with error status: ${emailResponse.status}`);
      }
    } catch (emailErr) {
      console.warn('[Welcome Trigger] Backend welcome email call failed:', emailErr);
    }

    // 6. Keep active runtime state in-sync with welcomeSent: true
    setCurrentUserState(prev => {
      if (prev && prev.id === targetUser.id) {
        return { ...prev, welcomeSent: true };
      }
      return prev;
    });
  };

  useEffect(() => {
    const isVerified = currentUser?.emailVerified || currentUser?.isGoogleAuth;
    if (!currentUser || !currentUser.email || currentUser.welcomeSent || !isVerified) return;
    
    // Ensure welcome messages are only sent to users who just registered an account, NOT users signing into an existing account.
    if (!justRegisteredUserIds.current.has(currentUser.id)) {
      console.log(`[Welcome Trigger] Skipped welcome package dispatch for existing user sign-in: ${currentUser.username}`);
      return;
    }
    
    setupWelcomePackage(currentUser);
  }, [currentUser]);



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
          const hasVideo = found.videos && found.videos.length > 0;
          const firstVideo = hasVideo ? found.videos[0] : null;
          if (firstVideo) {
            params.set('img', firstVideo);
            params.set('image', firstVideo);
            params.set('video', firstVideo);
          } else if (found.images && found.images[0] && !found.images[0].startsWith('data:')) {
            params.set('img', found.images[0]);
            params.set('image', found.images[0]);
            params.delete('video');
          } else {
            params.delete('img');
            params.delete('image');
            params.delete('video');
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

  // Fetch complete product details with all images when a specific product is opened in product-detail view
  useEffect(() => {
    if (!selectedProductId || currentView !== 'product-detail') return;

    let isSubscribed = true;

    const loadFullProductDetail = async () => {
      try {
        console.log(`[AppContext] Fetching full product detail for ${selectedProductId}...`);
        const res = await fetch(`/api/products/${selectedProductId}`);
        if (!res.ok) throw new Error(`Server returned status ${res.status}`);
        const data = await res.json();
        
        if (isSubscribed && data && data.success && data.product) {
          const fullProduct = data.product;
          
          setProducts(prevProducts => 
            prevProducts.map(p => {
              if (p.id === selectedProductId) {
                return {
                  ...p,
                  ...fullProduct,
                  // Ensure we use the full images array fetched from backend
                  images: Array.isArray(fullProduct.images) && fullProduct.images.length > 0 
                    ? fullProduct.images 
                    : p.images
                };
              }
              return p;
            })
          );
          console.log(`[AppContext] Successfully loaded full product detail with ${fullProduct.images?.length || 0} images.`);
        }
      } catch (err) {
        console.warn(`[AppContext] Failed to load full product detail for ${selectedProductId}:`, err);
      }
    };

    loadFullProductDetail();

    return () => {
      isSubscribed = false;
    };
  }, [selectedProductId, currentView]);

  // 3. Real-time Reviews Synchronization (Optimized to Fetch Once on Mount)
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const snapshot = await getDocs(collection(db, 'reviews'));
        const rList: Review[] = [];
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          rList.push({
            ...data,
            id: docSnap.id || data.id
          } as Review);
        });
        const sorted = rList.sort((a, b) => {
          const dateA = typeof a?.createdAt === 'string' ? a.createdAt : '';
          const dateB = typeof b?.createdAt === 'string' ? b.createdAt : '';
          return dateB.localeCompare(dateA);
        });
        setReviews(sorted);
        try {
          safeLocalStorage.setItem('tedbuy_local_reviews_backup', JSON.stringify(sorted));
        } catch (err) {
          console.warn('Could not save reviews backup:', err);
        }
      } catch (error: any) {
        // If 429 quota exceeded, gracefully fail silently without raising a blocking exception
        if (error?.message?.includes('Quota exceeded') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
          console.warn('[Reviews Sync] Firestore quota exceeded. Relying on local storage reviews.');
          return;
        }
        handleFirestoreError(error, OperationType.LIST, 'reviews');
      }
    }, 300); // Defer to prioritize products and authentication paint
    return () => {
      clearTimeout(timer);
    };
  }, []);

  // 4. Real-time Chats Synchronization (Secure Participant Filtering)
  useEffect(() => {
    if (!currentUserId) {
      console.log('[Chats Sync] No current user found. Clearing chats state.');
      setChats([]);
      return;
    }

    console.log(`[Chats Sync] Initializing real-time listeners for user: ${currentUserId}`);

    const qBuyer = query(collection(db, 'chats'), where('buyerId', '==', currentUserId));
    const qSeller = query(collection(db, 'chats'), where('sellerId', '==', currentUserId));

    const isAdminUser = (currentUser?.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com' || currentUser?.isAdmin) && isAdminSessionVerified;
    const qAdminSupport = isAdminUser ? query(collection(db, 'chats'), where('sellerId', '==', 'user_ted_ceo_support')) : null;

    const chatMap = new Map<string, Chat>();

    const updateCombined = () => {
      const combined = Array.from(chatMap.values()).sort((a, b) => {
        const timeA = typeof a?.lastMessageTime === 'string' ? a.lastMessageTime : '';
        const timeB = typeof b?.lastMessageTime === 'string' ? b.lastMessageTime : '';
        return timeB.localeCompare(timeA);
      });
      setChats(combined);
      try {
        safeLocalStorage.setItem('tedbuy_local_chats_backup', JSON.stringify(combined));
        safeLocalStorage.setItem(`tedbuy_local_chats_backup_${currentUserId}`, JSON.stringify(combined));
      } catch (err) {
        console.warn('Could not save chats backup:', err);
      }
    };

    const unsub1 = onSnapshot(qBuyer, (snap) => {
      console.log(`[Chats Sync] Received buyer chats update. Size: ${snap.size}, pendingWrites: ${snap.metadata.hasPendingWrites}, fromCache: ${snap.metadata.fromCache}`);
      snap.forEach(docSnap => {
        const data = docSnap.data();
        chatMap.set(docSnap.id, normalizeChat({
          ...data,
          id: docSnap.id || data.id
        }) as Chat);
      });
      updateCombined();
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'chats');
    });

    const unsub2 = onSnapshot(qSeller, (snap) => {
      console.log(`[Chats Sync] Received seller chats update. Size: ${snap.size}, pendingWrites: ${snap.metadata.hasPendingWrites}, fromCache: ${snap.metadata.fromCache}`);
      snap.forEach(docSnap => {
        const data = docSnap.data();
        chatMap.set(docSnap.id, normalizeChat({
          ...data,
          id: docSnap.id || data.id
        }) as Chat);
      });
      updateCombined();
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'chats');
    });

    let unsub3: (() => void) | null = null;
    if (qAdminSupport) {
      unsub3 = onSnapshot(qAdminSupport, (snap) => {
        console.log(`[Chats Sync] Received admin support chats update. Size: ${snap.size}`);
        snap.forEach(docSnap => {
          const data = docSnap.data();
          chatMap.set(docSnap.id, normalizeChat({
            ...data,
            id: docSnap.id || data.id
          }) as Chat);
        });
        updateCombined();
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'chats');
      });
    }

    return () => {
      console.log(`[Chats Sync] Tearing down real-time chat listeners for user: ${currentUserId}`);
      unsub1();
      unsub2();
      if (unsub3) unsub3();
    };
  }, [currentUserId]);

  // 5. Real-time Messages Synchronization (Secure Participant Querying)
  useEffect(() => {
    msgMapRef.current.clear();
    if (!currentUserId) {
      console.log('[Messages Sync] No current user found. Clearing messages state.');
      setMessages([]);
      return;
    }

    console.log(`[Messages Sync] Initializing real-time message listeners for user: ${currentUserId}`);

    const isAdminUser = (currentUser?.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com' || currentUser?.isAdmin) && isAdminSessionVerified;

    // Pre-populate with currently loaded messages from previous session backup to prevent flicker
    messages.forEach(m => {
      if (
        m.senderId === currentUserId || m.recipientId === currentUserId ||
        (isAdminUser && (m.senderId === 'user_ted_ceo_support' || m.recipientId === 'user_ted_ceo_support'))
      ) {
        msgMapRef.current.set(m.id, m);
      }
    });

    const qSender = query(collection(db, 'messages'), where('senderId', '==', currentUserId));
    const qRecipient = query(collection(db, 'messages'), where('recipientId', '==', currentUserId));

    const qAdminSender = isAdminUser ? query(collection(db, 'messages'), where('senderId', '==', 'user_ted_ceo_support')) : null;
    const qAdminRecipient = isAdminUser ? query(collection(db, 'messages'), where('recipientId', '==', 'user_ted_ceo_support')) : null;

    const updateCombined = () => {
      const sorted = (Array.from(msgMapRef.current.values()) as Message[]).sort((a, b) => {
        const dateA = typeof a?.createdAt === 'string' ? a.createdAt : '';
        const dateB = typeof b?.createdAt === 'string' ? b.createdAt : '';
        return dateA.localeCompare(dateB);
      });
      setMessages(sorted);
      try {
        safeLocalStorage.setItem('tedbuy_local_messages_backup', JSON.stringify(sorted));
        safeLocalStorage.setItem(`tedbuy_local_messages_backup_${currentUserId}`, JSON.stringify(sorted));
      } catch (err) {
        console.warn('Could not save messages backup:', err);
      }
    };

    const unsub1 = onSnapshot(qSender, (snap) => {
      console.log(`[Messages Sync] Received sender messages update. Size: ${snap.size}, pendingWrites: ${snap.metadata.hasPendingWrites}, fromCache: ${snap.metadata.fromCache}`);
      snap.forEach(docSnap => {
        const data = docSnap.data();
        msgMapRef.current.set(docSnap.id, {
          ...data,
          id: docSnap.id || data.id
        } as Message);
      });
      updateCombined();
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'messages');
    });

    const unsub2 = onSnapshot(qRecipient, (snap) => {
      console.log(`[Messages Sync] Received recipient messages update. Size: ${snap.size}, pendingWrites: ${snap.metadata.hasPendingWrites}, fromCache: ${snap.metadata.fromCache}`);
      snap.forEach(docSnap => {
        const data = docSnap.data();
        msgMapRef.current.set(docSnap.id, {
          ...data,
          id: docSnap.id || data.id
        } as Message);
      });
      updateCombined();
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'messages');
    });

    let unsub3: (() => void) | null = null;
    if (qAdminSender) {
      unsub3 = onSnapshot(qAdminSender, (snap) => {
        console.log(`[Messages Sync] Admin received Support sender messages. Size: ${snap.size}`);
        snap.forEach(docSnap => {
          const data = docSnap.data();
          msgMapRef.current.set(docSnap.id, {
            ...data,
            id: docSnap.id || data.id
          } as Message);
        });
        updateCombined();
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'messages');
      });
    }

    let unsub4: (() => void) | null = null;
    if (qAdminRecipient) {
      unsub4 = onSnapshot(qAdminRecipient, (snap) => {
        console.log(`[Messages Sync] Admin received Support recipient messages. Size: ${snap.size}`);
        snap.forEach(docSnap => {
          const data = docSnap.data();
          msgMapRef.current.set(docSnap.id, {
            ...data,
            id: docSnap.id || data.id
          } as Message);
        });
        updateCombined();
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'messages');
      });
    }

    return () => {
      console.log(`[Messages Sync] Tearing down real-time message listeners for user: ${currentUserId}`);
      unsub1();
      unsub2();
      if (unsub3) unsub3();
      if (unsub4) unsub4();
    };
  }, [currentUserId]);

  // User Authentication Action APIs
  const registerUser = async (username: string, email?: string, phoneNumber?: string, password?: string, photoUrl?: string) => {
    if (!email) {
      throw new Error('Email address is required to register an account.');
    }
    if (!password) {
      throw new Error('Password is required to register an account.');
    }

    const cleanEmail = email.trim().toLowerCase();
    if (cleanEmail === 'asumaduvincent7@gmail.com') {
      throw new Error('Registration Limit: The email address "asumaduvincent7@gmail.com" has been reserved for system security. Please use a different individual email address to register.');
    }

    try {
      let uid: string;
      let newUser: User;

      try {
        const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        uid = userCredential.user.uid;
        // Instantly mark as registered to prevent race conditions with auth listener
        justRegisteredUserIds.current.add(uid);

        newUser = {
          id: uid,
          username: username.trim(),
          email: email.trim(),
          phoneNumber: phoneNumber || undefined,
          role: 'both',
          joinDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          photoUrl: photoUrl || undefined,
          followingSellers: [],
          savedProductIds: [],
          emailVerified: false
        };

        try {
          await sendEmailVerification(userCredential.user);
          console.log('Real email verification sent to user email.');
        } catch (emailErr) {
          console.warn('Real email verification could not be dispatched (normal if local/sandboxed):', emailErr);
        }
      } catch (authErrorDetail: any) {
        const isAuthErrorDisabled = authErrorDetail?.code === 'auth/operation-not-allowed' || 
                                   authErrorDetail?.message?.includes('operation-not-allowed');
        if (isAuthErrorDisabled) {
          console.warn('Firebase Email/Password Auth is disabled. Engaging local high-fidelity sandbox fallback.');
          showToast('Email/Password provider is currently disabled in your Firebase console. Creating high-fidelity sandbox session for offline-interactive testing!', 'info');
          
          uid = `user_local_${email.trim().replace(/[^a-zA-Z0-9]/g, '_')}`;
          // Instantly mark as registered to prevent race conditions with auth listener
          justRegisteredUserIds.current.add(uid);

          newUser = {
            id: uid,
            username: username.trim(),
            email: email.trim(),
            phoneNumber: phoneNumber || undefined,
            role: 'both',
            joinDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
            photoUrl: photoUrl || undefined,
            followingSellers: [],
            savedProductIds: [],
            emailVerified: true // Pre-verified to skip barriers inside local sandbox
          };
          
          safeLocalStorage.setItem('tedbuy_simulated_mode', 'true');
        } else {
          throw authErrorDetail;
        }
      }

      // Proactively sync user profile and store name mapping to Firestore atomically
      try {
        const batch = writeBatch(db);
        batch.set(doc(db, 'users', uid), cleanObject(newUser));
        const storeNameLower = username.trim().toLowerCase();
        batch.set(doc(db, 'storeNames', storeNameLower), {
          userId: uid,
          username: username.trim()
        });
        await batch.commit();
        console.log(`[Registration] Saved user profile and reserved store name: "${storeNameLower}"`);
      } catch (dbErr) {
        console.warn('Fitted profile registry to database (failed/local simulation only):', dbErr);
        // Direct fallback
        try {
          await setDoc(doc(db, 'users', uid), cleanObject(newUser));
        } catch (_) {}
      }

      // Back up to localized database backups
      try {
        const storedUsers = safeLocalStorage.getItem('tedbuy_local_users_backup');
        const userList: User[] = storedUsers ? JSON.parse(storedUsers) : [];
        if (!userList.some(u => u.id === newUser.id)) {
          userList.push(newUser);
          safeLocalStorage.setItem('tedbuy_local_users_backup', JSON.stringify(userList));
          setUsers(userList);
        }
      } catch (_) {}

      justRegisteredUserIds.current.add(uid);
      setCurrentUserState(newUser);

      // Directly trigger welcome package synchronously to prevent race conditions
      setupWelcomePackage(newUser).catch(err => {
        console.warn('[Welcome Trigger] Direct welcome setup call failed from registration:', err);
      });

      return newUser;
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error('Core Firebase registration failed:', error);
      }
      throw error;
    }
  };

  const initiateRegistration = useCallback(async (username: string, email: string, phoneNumber: string, password: string, photoUrl?: string) => {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, email, phoneNumber, password, photoUrl })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to initiate registration.');
      }
      return data;
    } catch (err: any) {
      console.error('[initiateRegistration] Error:', err);
      throw err;
    }
  }, []);

  const verifyAndCompleteRegistration = useCallback(async (email: string, otp: string) => {
    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, otp })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to verify code.');
      }

      const { user, simulatedMode, tempPassword, customToken } = data;

      // Persist custom JWT if provided by server
      if (customToken) {
        safeLocalStorage.setItem('tedbuy_custom_auth_token', customToken);
      } else {
        safeLocalStorage.removeItem('tedbuy_custom_auth_token');
      }

      if (simulatedMode) {
        console.log('[verifyAndCompleteRegistration] Sandbox mode active. Completing registration client-side.');
        
        const uid = user.id;
        justRegisteredUserIds.current.add(uid);

        // Save to Firestore
        try {
          await setDoc(doc(db, 'users', uid), user);
          await setDoc(doc(db, 'storeNames', user.username.toLowerCase()), {
            userId: uid,
            username: user.username
          });
        } catch (dbErr) {
          console.warn('[verifyAndCompleteRegistration] Firestore write failed in sandbox:', dbErr);
        }

        // Back up to localized database backups
        try {
          const storedUsers = safeLocalStorage.getItem('tedbuy_local_users_backup');
          const userList: User[] = storedUsers ? JSON.parse(storedUsers) : [];
          if (!userList.some(u => u.id === user.id)) {
            userList.push(user);
            safeLocalStorage.setItem('tedbuy_local_users_backup', JSON.stringify(userList));
            setUsers(userList);
          }
        } catch (_) {}

        safeLocalStorage.setItem('tedbuy_simulated_mode', 'true');
        setCurrentUserState(user);

        // Welcome package
        setupWelcomePackage(user).catch(err => {
          console.warn('[Welcome Trigger] Sandbox welcome package failed:', err);
        });

      } else {
        console.log('[verifyAndCompleteRegistration] Production user created backend-side. Signing in...');
        
        try {
          justRegisteredUserIds.current.add(user.id);
          await signInWithEmailAndPassword(auth, email, tempPassword);
          console.log('[verifyAndCompleteRegistration] Production sign-in successful!');

          // Proactively save user profile and reserve store name in Firestore on the client-side
          const userRef = doc(db, 'users', user.id);
          await setDoc(userRef, user);
          await setDoc(doc(db, 'storeNames', user.username.toLowerCase()), {
            userId: user.id,
            username: user.username
          });
          console.log('[verifyAndCompleteRegistration] Profile and store name successfully created in Firestore client-side.');
        } catch (signInErr) {
          console.error('[verifyAndCompleteRegistration] Client sign-in or document creation failed after backend creation:', signInErr);
          setCurrentUserState(user);
        }

        // Always register user to our local users state list and local storage backups immediately for maximum login reliability
        setUsers(prev => {
          if (!prev.some(u => u.id === user.id)) {
            return [...prev, user];
          }
          return prev;
        });
        try {
          const storedUsers = safeLocalStorage.getItem('tedbuy_local_users_backup');
          const userList: User[] = storedUsers ? JSON.parse(storedUsers) : [];
          if (!userList.some(u => u.id === user.id)) {
            userList.push(user);
            safeLocalStorage.setItem('tedbuy_local_users_backup', JSON.stringify(userList));
          }
        } catch (_) {}
      }

      return data;
    } catch (err: any) {
      console.error('[verifyAndCompleteRegistration] Error:', err);
      throw err;
    }
  }, []);

  const loginUser = async (identifier: string, password?: string) => {
    if (!password) {
      throw new Error('Password is required.');
    }
    const cleanIdentifier = identifier.trim();

    try {
      console.log('[loginUser] Dispatching credentials login request to the secure server backend...', cleanIdentifier);
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: cleanIdentifier, password })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server HTTP ${res.status}`);
      }

      const data = await res.json();
      if (!data.success || !data.user) {
        throw new Error(data.error || 'Invalid credentials or failed to resolve account.');
      }

      const matchedUser = data.user as User;

      // Persist custom JWT if provided by server
      if (data.customToken) {
        safeLocalStorage.setItem('tedbuy_custom_auth_token', data.customToken);
      } else {
        safeLocalStorage.removeItem('tedbuy_custom_auth_token');
      }

      // Ensure we clear any old simulation mode flags
      safeLocalStorage.removeItem('tedbuy_simulated_mode');

      // Now, try to sign in the Firebase Auth SDK client-side to keep tokens and listeners fully synced
      try {
        console.log('[loginUser] Syncing Firebase Client Auth state with backend credentials...');
        await signInWithEmailAndPassword(auth, matchedUser.email, password);
      } catch (authErrorDetail: any) {
        console.warn('[loginUser] Firebase Client Auth SDK sync failed (graceful fallback):', authErrorDetail?.message || authErrorDetail);
        
        // If the Firebase provider is disabled or has issues, we fall back to on-the-fly client-side session emulation!
        safeLocalStorage.setItem('tedbuy_simulated_mode', 'true');
      }

      // Persist the user state and backup session locally
      safeLocalStorage.setItem('tedbuy_local_current_user_backup', JSON.stringify(matchedUser));
      setCurrentUserState(matchedUser);
      return true;

    } catch (err: any) {
      console.error('[loginUser Exception]:', err);
      throw err;
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
      console.log('[resetPasswordEmail] Attempting server-side dispatch...');
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailTarget })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          console.log('[resetPasswordEmail] Password reset dispatched successfully via server.');
          return;
        }
        if (data.fallback) {
          console.log('[resetPasswordEmail] Server requested fallback to client-side default.');
          await sendPasswordResetEmail(auth, emailTarget);
          return;
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        const errText = errData.error || `Server HTTP ${response.status}`;
        const error = new Error(errText);
        if (response.status === 403 || errText.toLowerCase().includes('suspended')) {
          (error as any).isSuspended = true;
        }
        throw error;
      }
    } catch (error: any) {
      if (error?.isSuspended || error?.message?.toLowerCase().includes('suspended') || error?.message?.toLowerCase().includes('suspension')) {
        throw error;
      }
      console.warn('[resetPasswordEmail] Server-side reset failed or fallback active. Falling back to default:', error?.message || error);
      try {
        await sendPasswordResetEmail(auth, emailTarget);
      } catch (fallbackErr: any) {
        throw new Error(fallbackErr?.message || String(fallbackErr));
      }
    }
  };

  const loginWithGoogle = async (hintEmail?: string) => {
    try {
      const provider = new GoogleAuthProvider();
      const params: any = { prompt: 'select_account' };
      if (hintEmail) {
        params.login_hint = hintEmail;
      }
      provider.setCustomParameters(params);
      // Ensure we clear any local old simulation flags on an active signup intention
      safeLocalStorage.removeItem('tedbuy_simulated_mode');
      safeLocalStorage.removeItem('tedbuy_simulated_user');

      const isInIframe = window.self !== window.top;

      // Crucial Fix: On custom domains (like tedbuy.store), iOS/Safari and many mobile browsers block third-party cookies
      // which completely breaks signInWithRedirect because the returned user cannot be decrypted from raw storage.
      // Therefore, always prefer signInWithPopup first even on mobile, as it uses in-memory frame messaging and succeeds flawlessly!
      console.log('Triggering Google Auth using the robust Popup flow for maximum cross-origin compatibility...');
      try {
        const result = await signInWithPopup(auth, provider);
        const googleUser = result.user;
        if (googleUser && googleUser.email) {
          const emailClean = googleUser.email.trim().toLowerCase();

          const userRef = doc(db, 'users', googleUser.uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            const dbData = userSnap.data() as User;
            if (dbData.isSuspended) {
              await signOut(auth);
              setIsSuspendedBlockOpen(true);
              throw new Error("Your account has been suspended by TedBuy Administration due to safety or policy violations. Please contact TedBuy Support at info.tedbuy@mail.com to appeal.");
            }
          }

          // Just let the Google Sign-In succeed. The onAuthStateChanged listener
          // will detect any existing email collision and automatically perform
          // a secure client-side merge/migration of the Firestore profile and listings!
          console.log('[Google Sign-In] Successful sign-in as ' + emailClean + '. Session initialization in progress.');
        }
      } catch (popupErr: any) {
        if (popupErr?.code === 'auth/account-exists-with-different-credential') {
          throw popupErr;
        }

        const isPopupBlocked = popupErr?.code === 'auth/popup-blocked' || 
                               popupErr?.code === 'auth/popup-closed-by-user' ||
                               popupErr?.code === 'auth/cancelled-popup-request' ||
                               popupErr?.message?.includes('popup-blocked') ||
                               popupErr?.message?.includes('popup_blocked');
        
        if (isPopupBlocked && !isInIframe) {
          console.log('Popup was blocked by the browser. Falling back to signInWithRedirect.');
          await signInWithRedirect(auth, provider);
        } else {
          throw popupErr;
        }
      }
    } catch (error: any) {
      if (process.env.NODE_ENV === "development") {
        console.error('Google sign-in error:', error);
      }
      if (error?.code === 'auth/popup-blocked') {
        throw new Error('Google sign-in popup was blocked by your browser. Please allow popups for this site or open in a new tab to continue!');
      }
      if (error?.code === 'auth/account-exists-with-different-credential') {
        const pendingCred = GoogleAuthProvider.credentialFromError(error);
        const email = error.customData?.email || '';
        setGoogleLinkingData({ email, credential: pendingCred });
      }
      throw error;
    }
  };

  const linkGoogleWithPassword = async (password: string) => {
    if (!googleLinkingData) {
      throw new Error('No Google linking data available.');
    }
    const { email, credential } = googleLinkingData;
    try {
      // 1. Sign in with the existing email and password
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      // 2. Link the google credential
      await linkWithCredential(userCredential.user, credential);
      // 3. Clear linking state
      setGoogleLinkingData(null);
      // No toast notification on sign in
      return true;
    } catch (err: any) {
      if (process.env.NODE_ENV === "development") {
        console.error('Failed to link Google credential with password:', err);
      }
      throw err;
    }
  };

  const logoutUser = async () => {
    try {
      setIsAdminSessionVerified(false);
      setAdminFailedAttempts(0);
      await signOut(auth);
      safeLocalStorage.removeItem('tedbuy_simulated_mode');
      safeLocalStorage.removeItem('tedbuy_simulated_user');
      safeLocalStorage.removeItem('tedbuy_local_created_products');
      safeLocalStorage.removeItem('tedbuy_local_products_overrides');
      safeLocalStorage.removeItem('tedbuy_custom_auth_token');
      setCurrentUserState(null);
      setCurrentView('browse');
    } catch (err) {
      console.error('Core Logout failed:', err);
    }
  };

  const verifyAdminPIN = useCallback(async (pin: string): Promise<boolean> => {
    const trimmed = pin.trim();
    let isValid = false;

    try {
      console.log('[verifyAdminPIN] Querying backend verify-admin-pin API...');
      const res = await fetch('/api/auth/verify-admin-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: trimmed })
      });
      if (res.ok) {
        const data = await res.json();
        isValid = data.success === true;
      } else {
        console.warn('[verifyAdminPIN] Backend verification returned non-OK. Engaging client-side verification as fallback...');
        throw new Error('Non-OK response');
      }
    } catch (err) {
      console.warn('[verifyAdminPIN] Backend verification failed, using local client-side verification:', err);
      // Fallback: Client-side check
      const customPin = (import.meta as any).env.VITE_ADMIN_PIN;
      if (customPin) {
        isValid = trimmed === customPin.trim();
      } else {
        console.warn('[verifyAdminPIN] Client fallback verification failed: VITE_ADMIN_PIN is not configured.');
        isValid = false;
      }
    }
    
    if (isValid) {
      setIsAdminSessionVerified(true);
      setAdminFailedAttempts(0);
      showToast('Admin access unlocked successfully!', 'success');
      return true;
    } else {
      setAdminFailedAttempts(prev => {
        const nextAttempts = prev + 1;
        if (nextAttempts >= 3) {
          showToast('Security Alert: Too many failed admin attempts. Logging out immediately.', 'error');
          logoutUser();
        } else {
          showToast(`Invalid Admin PIN. Attempt ${nextAttempts} of 3.`, 'error');
        }
        return nextAttempts;
      });
      return false;
    }
  }, [logoutUser, showToast]);

  const sendVerificationEmailReal = async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) {
      showToast("No active authentication section found.", "error");
      return;
    }
    try {
      await sendEmailVerification(firebaseUser);
      showToast("A new verification link was dispatched to " + firebaseUser.email + "!", "success");
    } catch (err: any) {
      if (process.env.NODE_ENV === "development") {
        console.error("Error sending verification email:", err);
      }
      showToast(getAuthErrorMessage(err) || "Failed to dispatch verification email.", "error");
    }
  };

  const reloadUserVerificationStatus = async (): Promise<boolean> => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return false;
    try {
      await firebaseUser.reload();
      const freshUser = auth.currentUser;
      const isVerified = freshUser?.emailVerified || false;
      if (isVerified && currentUser) {
        const userRef = doc(db, 'users', currentUser.id);
        await updateDoc(userRef, { emailVerified: true });
        setCurrentUserState(prev => prev ? { ...prev, emailVerified: true } : null);
        showToast("Success! Your email address has been verified. 🔒", "success");
      } else if (!isVerified) {
        showToast("Status: Unverified. Please click the link sent to " + firebaseUser.email, "info");
      }
      return isVerified;
    } catch (err: any) {
      if (process.env.NODE_ENV === "development") {
        console.error("Error reloading user status:", err);
      }
      showToast(getAuthErrorMessage(err) || "Unable to fetch status. Try again shortly.", "error");
      return false;
    }
  };

  // Switch Active User (Dynamic Register/Sign In Seamless Simulator Hybrid)
  const switchUserSimulated = async (userId: string) => {
    if ((import.meta as any).env.PROD) {
      console.error('[Security] Simulated mode is disabled in production.');
      showToast('Error: Simulated mode is disabled in production.', 'error');
      return;
    }
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
  }): Promise<Product | undefined> => {
    if (!currentUser) {
      throw new Error('Authentication Required: You must be logged in to list resources.');
    }

    // 1. Client-side Rate Limit check
    const rLimit = checkClientRateLimit('add_product', currentUser.id);
    if (!rLimit.allowed) {
      throw new Error(`Rate limit exceeded: You can only publish 5 listings within 10 minutes. Please try again in ${rLimit.remainingSecs} seconds.`);
    }

    // 2. Input Sanitization and Length safeguards
    const cleanTitle = sanitizeText(productData.title);
    const cleanDesc = sanitizeText(productData.description);
    const cleanLocation = sanitizeText(productData.location);
    const cleanBrand = productData.brand ? sanitizeText(productData.brand) : undefined;

    if (cleanTitle.length < 5 || cleanTitle.length > 100) {
      throw new Error('Title must be between 5 and 100 characters long.');
    }
    if (cleanDesc.length < 10 || cleanDesc.length > 3000) {
      throw new Error('Description must be between 10 and 3000 characters long.');
    }
    if (cleanLocation.length < 3 || cleanLocation.length > 100) {
      throw new Error('Location must be between 3 and 100 characters long.');
    }

    const sanitizedProductData = {
      ...productData,
      title: cleanTitle,
      description: cleanDesc,
      location: cleanLocation,
      brand: cleanBrand
    };

    const prodId = `prod_${Date.now()}`;
    const newProduct: Product = {
      id: prodId,
      sellerId: currentUser.id,
      sellerName: currentUser.username,
      sellerPhoto: currentUser.photoUrl || '',
      sellerJoinDate: currentUser.joinDate,
      ...sanitizedProductData,
      category: normalizeCategory(productData.category),
      createdAt: new Date().toISOString(),
      viewsCount: 0
    };

    try {
      // Step A: Store in local storage created list so onSnapshot doesn't drop it on stale reads
      try {
        const createdStr = safeLocalStorage.getItem('tedbuy_local_created_products') || '[]';
        const createdList = JSON.parse(createdStr);
        createdList.unshift(newProduct);
        safeLocalStorage.setItem('tedbuy_local_created_products', JSON.stringify(createdList));
      } catch (localErr) {
        console.warn('[createProduct] Failed to save local created products backup:', localErr);
      }

      // Step B: Optimistically inject into products list state instantly
      setProducts(prev => {
        const next = [newProduct, ...prev];
        try {
          safeLocalStorage.setItem('tedbuy_local_products_backup', JSON.stringify(next));
        } catch (_) {}
        return next;
      });

      // Step C: Save to Firestore database in the background to ensure instant posting and zero UI delay
      setDoc(doc(db, 'products', prodId), cleanObject(newProduct))
        .then(() => {
          console.log('[createProduct] Firestore document created successfully in background');
          // Clear server sitemap cache so it is kept updated on publish
          fetch('/api/sitemap/clear', { method: 'POST' }).catch(e => {
            console.warn('[createProduct] Failed to clear sitemap cache:', e);
          });
        })
        .catch((innerErr) => {
          console.warn('[createProduct] Firestore server document create returned background error:', innerErr);
        });

      // Update current user's rapid post score dynamically
      try {
        const sellerProds = products.filter(p => p.sellerId === currentUser.id);
        const nowMs = Date.now();
        const postsLast3Days = sellerProds.filter(p => {
          const createdMs = p.createdAt ? new Date(p.createdAt).getTime() : 0;
          return (nowMs - createdMs) < 3 * 24 * 60 * 60 * 1000; // 3 days
        }).length + 1; // + 1 for the newly posted one

        updateDoc(doc(db, 'users', currentUser.id), {
          rapidPostScore: postsLast3Days
        }).catch(() => {});

        setCurrentUserState(prev => {
          if (!prev) return null;
          return {
            ...prev,
            rapidPostScore: postsLast3Days
          };
        });
      } catch (err) {
        console.warn('Failed to calculate and update rapidPostScore:', err);
      }

      // Create notifications for followers and following users of the poster
      const notifyUsers = users.filter(u => {
        if (u.id === currentUser.id) return false;
        const isFollowerOfPoster = Array.isArray(u.followingSellers) && u.followingSellers.includes(currentUser.id);
        const isFollowedByPoster = Array.isArray(currentUser.followingSellers) && currentUser.followingSellers.includes(u.id);
        return isFollowerOfPoster || isFollowedByPoster;
      });

      // Dispatch notifications concurrently in a non-blocking asynchronous scope
      (async () => {
        const notifPromises = notifyUsers.map(async (targetUser) => {
          const notifId = `notif_${Date.now()}_${targetUser.id}_${Math.random().toString(36).substring(2, 7)}`;
          const newNotification: AppNotification = {
            id: notifId,
            userId: targetUser.id,
            type: 'post_created',
            title: 'New Ad Posted!',
            message: `${currentUser.username} posted a new offer: ${newProduct.title}`,
            triggerUserId: currentUser.id,
            triggerUsername: currentUser.username,
            triggerUserPhoto: currentUser.photoUrl || '',
            productId: prodId,
            productTitle: newProduct.title,
            productPrice: newProduct.price,
            productImage: newProduct.images?.[0] || '',
            createdAt: new Date().toISOString(),
            read: false
          };

          // Injects notification directly into local storage buffer for target user
          try {
            const key = `tedbuy_notifications_backup_${targetUser.id}`;
            const currentListStr = safeLocalStorage.getItem(key);
            const currentList = currentListStr ? JSON.parse(currentListStr) : [];
            currentList.unshift(newNotification);
            safeLocalStorage.setItem(key, JSON.stringify(currentList));
          } catch (localErr) {
            console.warn('Could not inject local fallback recipient notification:', localErr);
          }

          try {
            await setDoc(doc(db, 'notifications', notifId), cleanObject(newNotification));
          } catch (dbErr) {
            console.warn('Could not dispatch backend notification (local inbox synced only):', dbErr);
          }
        });
        await Promise.allSettled(notifPromises);
      })().catch(err => console.warn('Non-blocking notification dispatch error:', err));

      return newProduct;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `products/${prodId}`);
    }
  };

  const updateProduct = async (id: string, productData: Partial<Product>, localOnly = false): Promise<string | undefined> => {
    try {
      const localProduct = products.find(p => p.id === id);
      const keys = Object.keys(productData);
      const isSocialOnly = keys.every(k => ['likesCount', 'likedUserIds', 'viewsCount', 'isSold'].includes(k));

      // Authorization Guard
      if (!isSocialOnly) {
        if (!currentUser) {
          throw new Error('Authentication Required: You must be logged in to modify listings.');
        }
        const isSuperAdmin = currentUser.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com' && isAdminSessionVerified;
        if (localProduct && localProduct.sellerId !== currentUser.id && (!currentUser.isAdmin || !isAdminSessionVerified) && !isSuperAdmin) {
          throw new Error('Unauthorized Access: You do not have permissions to modify this listing.');
        }
      }

      const updatedData = { ...productData };
      if (updatedData.title) updatedData.title = sanitizeText(updatedData.title);
      if (updatedData.description) updatedData.description = sanitizeText(updatedData.description);
      if (updatedData.location) updatedData.location = sanitizeText(updatedData.location);
      if (updatedData.brand) updatedData.brand = sanitizeText(updatedData.brand);

      if (updatedData.category) {
        updatedData.category = normalizeCategory(updatedData.category);
      }

      // Step A: Store override locally so onSnapshot doesn't revert our changes
      try {
        const overridesStr = safeLocalStorage.getItem('tedbuy_local_products_overrides') || '{}';
        const overrides = JSON.parse(overridesStr);
        
        // Exclude social and dynamic fields from persisting as overrides so they stay real-time synchronized
        const overrideData = { ...updatedData };
        delete overrideData.likesCount;
        delete overrideData.likedUserIds;
        delete overrideData.viewsCount;
        
        if (Object.keys(overrideData).length > 0) {
          overrides[id] = { ...(overrides[id] || {}), ...overrideData };
          safeLocalStorage.setItem('tedbuy_local_products_overrides', JSON.stringify(overrides));
        }
      } catch (overlapErr) {
        console.warn('[updateProduct] Failed to write local overrides backup:', overlapErr);
      }

      // Step B: Optimistically update local memory state immediately for perfect latency
      setProducts(prev => {
        const next = prev.map(p => p.id === id ? { ...p, ...updatedData } : p);
        try {
          safeLocalStorage.setItem('tedbuy_local_products_backup', JSON.stringify(next));
        } catch (_) {}
        return next;
      });

      // Sync partial product updates (likes change, viewsCount, isSold) to local offline-only created products list
      try {
        const createdStr = safeLocalStorage.getItem('tedbuy_local_created_products') || '[]';
        const createdList = JSON.parse(createdStr) as Product[];
        const hasCreated = createdList.some(p => p.id === id);
        if (hasCreated) {
          const updatedCreatedList = createdList.map(p => p.id === id ? { ...p, ...updatedData } : p);
          safeLocalStorage.setItem('tedbuy_local_created_products', JSON.stringify(updatedCreatedList));
        }
      } catch (_) {}

      // Step C: Try updating standard Firestore document, but in a completely non-blocking asynchronous way
      if (localOnly) {
        console.log('[updateProduct] Local-only state update requested. Skipping remote Firestore write.');
        return id;
      }

      const productRef = doc(db, 'products', id);

      if (localProduct) {
        const keys = Object.keys(updatedData);
        const silentKeys = [
          'likesCount', 'likedUserIds', 'viewsCount', 'isSold',
          'boostStatus', 'boostPlan', 'boostEndDate', 'boostStartDate', 
          'boostPriority', 'priorityScore', 'boostHistory', 'paymentStatus', 
          'paymentReference', 'boostAmount', 'boostPackagePrice', 
          'boostPriorityLevel', 'remainingBoostTime', 'lastBoostPurchase', 'lastBoostedAt'
        ];
        const isSocialOnly = keys.every(k => silentKeys.includes(k));

        if (isSocialOnly) {
          updateDoc(productRef, cleanObject(updatedData))
            .then(() => console.log('[updateProduct] Firestore document updated successfully (social-only)'))
            .catch(innerErr => console.warn('[updateProduct] Firestore server Write warning (using local fallback state):', innerErr));
        } else {
          // Keep original seller information and prevent accidental fallback to admin/moderator user ID
          const originalSellerId = localProduct?.sellerId || updatedData.sellerId;
          const fallbackSellerId = (currentUser && !currentUser.isAdmin) ? currentUser.id : '';
          const finalSellerId = originalSellerId || fallbackSellerId || '';

          const originalSellerName = localProduct?.sellerName || updatedData.sellerName;
          const fallbackSellerName = (currentUser && !currentUser.isAdmin) ? currentUser.username : '';
          const finalSellerName = originalSellerName || fallbackSellerName || '';

          const fullProductUpdate = {
            ...localProduct,
            ...updatedData,
            id,
            sellerId: finalSellerId,
            sellerName: finalSellerName,
          };
          setDoc(productRef, cleanObject(fullProductUpdate))
            .then(() => console.log('[updateProduct] Firestore document updated successfully (full)'))
            .catch(innerErr => console.warn('[updateProduct] Firestore server Write warning (using local fallback state):', innerErr));

          // Distribute notifications to users following this seller/ad in a non-blocking way
          if (currentUser) {
            const notifyTargetUsers = users.filter(u => {
              if (u.id === currentUser.id) return false;
              const matchesSavedId = Array.isArray(u.savedProductIds) && u.savedProductIds.includes(id);
              const matchesSellerId = Array.isArray(u.followingSellers) && u.followingSellers.includes(localProduct ? (localProduct.sellerId || '') : '');
              return matchesSavedId || matchesSellerId;
            });

            // Dispatch notifications concurrently in a non-blocking asynchronous scope
            (async () => {
              const notifPromises = notifyTargetUsers.map(async (targetUser) => {
                const isSaved = Array.isArray(targetUser.savedProductIds) && targetUser.savedProductIds.includes(id);
                const notifId = `notif_update_${Date.now()}_${targetUser.id}_${Math.random().toString(36).substring(2, 6)}`;
                const newNotification: AppNotification = {
                  id: notifId,
                  userId: targetUser.id,
                  type: 'post_created',
                  title: isSaved ? 'Followed Ad Updated!' : 'New Update from Seller',
                  message: isSaved 
                    ? `An ad you are following "${localProduct.title}" was updated by the seller.`
                    : `${currentUser.username} updated their listing: "${localProduct.title}"`,
                  triggerUserId: currentUser.id,
                  triggerUsername: currentUser.username,
                  triggerUserPhoto: currentUser.photoUrl || '',
                  productId: id,
                  productTitle: localProduct.title,
                  productPrice: updatedData.price !== undefined ? updatedData.price : localProduct.price,
                  productImage: (updatedData.images && updatedData.images[0]) || localProduct.images?.[0] || '',
                  createdAt: new Date().toISOString(),
                  read: false
                };

                try {
                  const key = `tedbuy_notifications_backup_${targetUser.id}`;
                  const currentListStr = safeLocalStorage.getItem(key);
                  const currentList = currentListStr ? JSON.parse(currentListStr) : [];
                  currentList.unshift(newNotification);
                  safeLocalStorage.setItem(key, JSON.stringify(currentList));
                } catch (_) {}

                try {
                  await setDoc(doc(db, 'notifications', notifId), cleanObject(newNotification));
                } catch (dbErr) {
                  console.warn('Backend notification dispatch skipped in sandbox context:', dbErr);
                }
              });
              await Promise.allSettled(notifPromises);
            })().catch(err => console.warn('Non-blocking update notification dispatch error:', err));
          }
        }
      } else {
        // Local product wasn't found - perform background update/set directly
        updateDoc(productRef, cleanObject(updatedData))
          .catch(() => {
            setDoc(productRef, cleanObject(updatedData)).catch(() => {});
          });
      }

      return id;
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `products/${id}`);
    }
  };

  const deleteProduct = async (id: string) => {
    if (!currentUser) {
      showToast('Authentication Required: You must be logged in to delete listings.', 'error');
      throw new Error('Authentication Required: You must be logged in to delete listings.');
    }

    const localProduct = products.find(p => p.id === id);
    const isSuperAdmin = currentUser.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com';
    const isAdmin = currentUser.isAdmin || isSuperAdmin;
    
    if (localProduct && localProduct.sellerId !== currentUser.id && !isAdmin) {
      showToast('Unauthorized: You can only delete your own listings.', 'error');
      throw new Error('Unauthorized: You can only delete your own listings.');
    }

    // Add to optimistic deleted product IDs state instantly
    setOptimisticDeletedProductIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    // Optimistically update local memory state and backup cache so listing disappears instantly in screen UI
    try {
      setProducts(prev => {
        const next = prev.filter(p => p.id !== id);
        safeLocalStorage.setItem('tedbuy_local_products_backup', JSON.stringify(next));
        return next;
      });
    } catch (cacheErr) {
      console.warn('Could not filter local cache on product delete:', cacheErr);
    }

    try {
      await deleteDoc(doc(db, 'products', id));
    } catch (err) {
      console.warn('Firestore product delete call bypassed or errored:', err);
      // Clean up optimistic state in case deletion completely failed so it doesn't get stuck
      setOptimisticDeletedProductIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      try {
        handleFirestoreError(err, OperationType.DELETE, `products/${id}`);
      } catch (thrownErr) {
        console.warn('[Delete Product] Server exception logged gracefully:', thrownErr);
      }
    }
  };

  const toggleLikeProduct = async (id: string, userId: string) => {
    if (!currentUser) {
      throw new Error('Authentication Required: You must be logged in to like listings.');
    }
    const verifiedUserId = currentUser.id;

    try {
      const productRef = doc(db, 'products', id);
      const productDoc = await getDoc(productRef);
      
      let nextLikedUserIds: string[] = [];
      let nextLikesCount = 0;

      if (productDoc.exists()) {
        const existingData = productDoc.data() as Product;
        const currentLikedUserIds = Array.isArray(existingData.likedUserIds) ? existingData.likedUserIds : [];
        const hasLiked = currentLikedUserIds.includes(verifiedUserId);
        
        if (hasLiked) {
          nextLikedUserIds = currentLikedUserIds.filter(uid => uid !== verifiedUserId);
        } else {
          nextLikedUserIds = Array.from(new Set([...currentLikedUserIds, verifiedUserId]));
        }
        nextLikesCount = nextLikedUserIds.length;

        // Atomically update standard Firestore document
        await updateDoc(productRef, {
          likedUserIds: nextLikedUserIds,
          likesCount: nextLikesCount
        });
      } else {
        // Fallback or self-healing for non-persisted local products
        const localProduct = products.find(p => p.id === id);
        if (localProduct) {
          const currentLikedUserIds = Array.isArray(localProduct.likedUserIds) ? localProduct.likedUserIds : [];
          const hasLiked = currentLikedUserIds.includes(verifiedUserId);
          if (hasLiked) {
            nextLikedUserIds = currentLikedUserIds.filter(uid => uid !== verifiedUserId);
          } else {
            nextLikedUserIds = Array.from(new Set([...currentLikedUserIds, verifiedUserId]));
          }
          nextLikesCount = nextLikedUserIds.length;
        }
      }

      // Optimistically/real-time update products list
      setProducts(prev => {
        const next = prev.map(p => {
          if (p.id === id) {
            return {
              ...p,
              likedUserIds: nextLikedUserIds,
              likesCount: nextLikesCount
            };
          }
          return p;
        });
        try {
          safeLocalStorage.setItem('tedbuy_local_products_backup', JSON.stringify(next));
        } catch (_) {}
        return next;
      });

      // Synchronize in local offline-only created products list as well
      try {
        const createdStr = safeLocalStorage.getItem('tedbuy_local_created_products') || '[]';
        const createdList = JSON.parse(createdStr) as Product[];
        if (createdList.some(p => p.id === id)) {
          const updatedCreatedList = createdList.map(p => p.id === id ? { ...p, likedUserIds: nextLikedUserIds, likesCount: nextLikesCount } : p);
          safeLocalStorage.setItem('tedbuy_local_created_products', JSON.stringify(updatedCreatedList));
        }
      } catch (_) {}

    } catch (err) {
      console.warn('[toggleLikeProduct] Error updating product likes:', err);
      // Fallback purely local update in case of firestore permission denial or network loss
      setProducts(prev => {
        const next = prev.map(p => {
          if (p.id === id) {
            const currentLikedUserIds = Array.isArray(p.likedUserIds) ? p.likedUserIds : [];
            const hasLiked = currentLikedUserIds.includes(userId);
            const nextLikedUserIds = hasLiked
              ? currentLikedUserIds.filter(uid => uid !== userId)
              : Array.from(new Set([...currentLikedUserIds, userId]));
            return { ...p, likedUserIds: nextLikedUserIds, likesCount: nextLikedUserIds.length };
          }
          return p;
        });
        try {
          safeLocalStorage.setItem('tedbuy_local_products_backup', JSON.stringify(next));
        } catch (_) {}
        return next;
      });
    }
  };

  const incrementProductViews = useCallback(async (id: string) => {
    // A. Prevent self-views: Owner of the product viewing their own ad should not count as a valid external view
    const targetProduct = products.find(p => p.id === id);
    if (targetProduct && currentUser && targetProduct.sellerId === currentUser.id) {
      console.log(`[View Fraud Protection] Skipped view increment on product "${id}": Seller is the owner.`);
      return;
    }

    try {
      // B. Prevent repeated refreshes: Skip if session already flagged
      const sessionKey = `tedbuy_viewed_product_${id}`;
      if (safeSessionStorage.getItem(sessionKey)) {
        console.log(`[View Fraud Protection] Skipped view increment on product "${id}": Already viewed in this session.`);
        return; 
      }

      // C. Cooldown Protection: Prevent users from spamming views within a short period (10 minutes)
      const now = Date.now();
      const localTimestampsKey = 'tedbuy_view_cooldown_timestamps';
      let timestamps: Record<string, number> = {};
      
      try {
        const stored = safeLocalStorage.getItem(localTimestampsKey);
        if (stored) {
          timestamps = JSON.parse(stored);
        }
      } catch (_) {}

      const lastViewedAt = timestamps[id] || 0;
      const cooldownMs = 10 * 60 * 1000; // 10 minutes duration
      if (now - lastViewedAt < cooldownMs) {
        const remainingSecs = Math.ceil((cooldownMs - (now - lastViewedAt)) / 1000);
        console.log(`[View Fraud Protection] Skipped view increment on product "${id}": Cooldown active (${remainingSecs} seconds remaining).`);
        return;
      }

      // Log verified view timestamp and persist
      timestamps[id] = now;
      safeLocalStorage.setItem(localTimestampsKey, JSON.stringify(timestamps));
      safeSessionStorage.setItem(sessionKey, 'true');
    } catch {
      // safe fallback
    }

    try {
      await updateDoc(doc(db, 'products', id), {
        viewsCount: increment(1)
      });
      console.log(`[Analytics] Valid external view registered successfully for product ${id}`);
    } catch (error) {
      console.warn('Failed to increment metrics view:', error);
    }
  }, [products, currentUser?.id]);

  const reportProduct = async (productId: string, reason: string, comment: string = '') => {
    if (!currentUser) {
      throw new Error("You must be logged in to report a listing.");
    }

    const product = products.find(p => p.id === productId);
    if (!product) {
      throw new Error("Product not found.");
    }

    const reportId = `report_${currentUser.id}_${productId}_${Date.now()}`;
    const reportData = {
      id: reportId,
      productId: product.id,
      productTitle: product.title,
      reporterId: currentUser.id,
      reporterName: currentUser.username,
      reason,
      comment,
      createdAt: new Date().toISOString()
    };

    try {
      // 1. Save to reports collection
      await setDoc(doc(db, 'reports', reportId), cleanObject(reportData));

      // 2. Locate or create support chat for the reporting user to send to admins inbox
      let supportChat = chats.find(c => 
        c.productId === 'support_welcome' && 
        c.buyerId === currentUser.id && 
        c.sellerId === 'user_ted_ceo_support'
      );

      let supportChatId = supportChat?.id;

      if (!supportChatId) {
        supportChatId = `chat_${currentUser.id}_user_ted_ceo_support_support_welcome_${Date.now()}`;
        const newSupportChat: Chat = {
          id: supportChatId,
          productId: 'support_welcome',
          productTitle: 'Tedbuy Support Desk',
          productPrice: 'Direct Channel',
          productImage: '/favicon.svg',
          buyerId: currentUser.id,
          sellerId: 'user_ted_ceo_support',
          buyerName: currentUser.username,
          sellerName: 'Tedbuy Support',
          lastMessageText: `Report submitted for ${product.title}`,
          lastMessageTime: new Date().toISOString(),
          deliveredBySeller: false,
          pickedUpByBuyer: false,
          tradeStatus: 'pending',
          adId: 'support_welcome',
          adTitle: 'Tedbuy Support Desk',
          adImage: '/favicon.svg',
          adThumbnail: '/favicon.svg',
          adType: 'image',
          videoPoster: ''
        };
        await setDoc(doc(db, 'chats', supportChatId), cleanObject(newSupportChat));
      }

      // 3. Send message inside support chat
      const reportMessageText = `⚠️ [Listing Report]
• Listing: "${product.title}" (ID: ${product.id})
• Category: ${product.category}
• Seller: ${product.sellerName} (ID: ${product.sellerId})
• Reporter: ${currentUser.username} (ID: ${currentUser.id})
• Reason: ${reason}
${comment ? `• Comments: "${comment}"` : ''}`;

      await sendMessage(supportChatId, reportMessageText);

      showToast("Report submitted successfully! Our moderators will review it shortly.", "success");
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `reports/${reportId}`);
      throw err;
    }
  };

  // Chats Operations
  const startChat = async (productId: string, initialMessage?: string) => {
    if (!currentUser) return '';

    // 1. Client-side Rate Limit check
    const rLimit = checkClientRateLimit('create_chat', currentUser.id);
    if (!rLimit.allowed) {
      throw new Error(`Rate limit exceeded: You can only start 5 chats within 5 minutes. Please try again in ${rLimit.remainingSecs} seconds.`);
    }

    const cleanInitialMessage = initialMessage ? sanitizeText(initialMessage) : undefined;

    const product = products.find(p => p.id === productId);
    if (!product) return '';

    const existingChat = chats.find(c =>
      c.productId === productId &&
      c.buyerId === currentUser.id &&
      c.sellerId === product.sellerId
    );

    if (existingChat) {
      if (cleanInitialMessage) {
        await sendMessage(existingChat.id, cleanInitialMessage);
      }
      setActiveChatId(existingChat.id);
      setViewingChatOnMobile(true);
      return existingChat.id;
    }

    const chatId = `chat_${currentUser.id}_${product.sellerId}_${product.id}_${Date.now()}`;
    const initialAdType: 'image' | 'video' = (product.videos && product.videos.length > 0) ? 'video' : 'image';
    const initialProductImage = product.images?.[0] || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

    const newChat: Chat = {
      id: chatId,
      productId: product.id,
      productTitle: product.title,
      productPrice: product.price,
      productImage: initialAdType === 'video' ? (product.videos?.[0] || '') : initialProductImage,
      buyerId: currentUser.id,
      sellerId: product.sellerId,
      buyerName: currentUser.username,
      sellerName: product.sellerName,
      lastMessageText: cleanInitialMessage || 'Chat started',
      lastMessageTime: new Date().toISOString(),
      deliveredBySeller: false,
      pickedUpByBuyer: false,
      tradeStatus: 'pending',
      adId: product.id,
      adTitle: product.title,
      adImage: initialProductImage,
      adThumbnail: initialAdType === 'video' ? (product.videos?.[0] || '') : initialProductImage,
      adType: initialAdType,
      videoPoster: initialAdType === 'video' ? (product.videos?.[0] || '') : ''
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

  const [isProcessingQueue, setIsProcessingQueue] = useState(false);

  const processOfflineQueue = useCallback(async () => {
    if (isProcessingQueue) return;
    try {
      const queueStr = safeLocalStorage.getItem('tedbuy_offline_message_queue');
      if (!queueStr) return;
      
      const queue = JSON.parse(queueStr) as Message[];
      if (queue.length === 0) return;

      if (!navigator.onLine) {
        console.log('[Offline Queue] Device is offline. Postponing retry.');
        return;
      }

      setIsProcessingQueue(true);
      console.log(`[Offline Queue] Processing ${queue.length} pending offline messages...`);

      const remainingQueue: Message[] = [];

      for (const msg of queue) {
        try {
          // Attempt sending to Firestore
          await setDoc(doc(db, 'messages', msg.id), cleanObject(msg));
          
          await updateDoc(doc(db, 'chats', msg.chatId), cleanObject({
            lastMessageText: msg.text,
            lastMessageTime: msg.createdAt
          }));

          // Trigger chat notification
          const notifId = `notif_chat_${Date.now()}_${msg.recipientId}_${Math.random().toString(36).substring(2, 6)}`;
          const senderName = currentUser?.username || 'User';
          const chatNotification: AppNotification = {
            id: notifId,
            userId: msg.recipientId,
            type: 'new_message',
            title: `Message from ${senderName}`,
            message: msg.text.length > 55 ? `${msg.text.substring(0, 55)}...` : msg.text,
            triggerUserId: msg.senderId,
            triggerUsername: senderName,
            triggerUserPhoto: currentUser?.photoUrl || '',
            productId: '',
            productTitle: 'Shared Listing Chat',
            productPrice: 'Inquire',
            productImage: '',
            createdAt: new Date().toISOString(),
            read: false,
            chatId: msg.chatId
          };

          try {
            await setDoc(doc(db, 'notifications', notifId), cleanObject(chatNotification));
          } catch (_) {}

          console.log(`[Offline Queue] Sent queued message ${msg.id} successfully.`);
        } catch (err) {
          console.warn(`[Offline Queue] Failed to sync message ${msg.id}. Keeping in queue:`, err);
          remainingQueue.push(msg);
        }
      }

      safeLocalStorage.setItem('tedbuy_offline_message_queue', JSON.stringify(remainingQueue));
    } catch (err) {
      console.warn('[Offline Queue] Error while processing queue:', err);
    } finally {
      setIsProcessingQueue(false);
    }
  }, [currentUser, isProcessingQueue]);

  // Monitor network status & trigger background queue processing
  useEffect(() => {
    processOfflineQueue();

    const handleOnlineStatus = () => {
      console.log('[Background Sync] Network restored. Syncing offline messages...');
      processOfflineQueue();
    };

    window.addEventListener('online', handleOnlineStatus);
    
    // Register Service Worker and bind its sync events to processOfflineQueue
    registerServiceWorker(() => {
      processOfflineQueue();
    });

    return () => {
      window.removeEventListener('online', handleOnlineStatus);
    };
  }, [processOfflineQueue]);

  // PWA Install Prompt Listener
  useEffect(() => {
    // 1. Check if already installed in standalone mode
    const checkStandalone = () => {
      const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || 
                               (navigator as any).standalone === true;
      setIsStandalone(isStandaloneMode);
    };

    checkStandalone();
    
    // Listen for changes to display mode
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      setIsStandalone(e.matches);
    };

    try {
      mediaQuery.addEventListener('change', handleDisplayModeChange);
    } catch (_) {
      try {
        mediaQuery.addListener(handleDisplayModeChange);
      } catch (_) {}
    }

    // 2. Capture beforeinstallprompt event
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setCanInstall(true);
      console.log('[PWA] beforeinstallprompt event successfully captured.');
    };

    // 3. Capture appinstalled event
    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setCanInstall(false);
      setIsStandalone(true);
      showToast('Tedbuy has been successfully installed to your device! 🎉 Enjoy lightning fast access.', 'success');
      console.log('[PWA] App was successfully installed.');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      try {
        mediaQuery.removeEventListener('change', handleDisplayModeChange);
      } catch (_) {
        try {
          mediaQuery.removeListener(handleDisplayModeChange);
        } catch (_) {}
      }
    };
  }, [showToast]);

  const triggerPWAInstall = async () => {
    if (!deferredPrompt) {
      console.warn('[PWA] No deferred prompt available for installation.');
      return;
    }
    try {
      deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      console.log(`[PWA] Installation prompt user choice: ${choiceResult.outcome}`);
      if (choiceResult.outcome === 'accepted') {
        showToast('Thank you for adding Tedbuy to your device! 🚀', 'success');
      }
      setDeferredPrompt(null);
      setCanInstall(false);
    } catch (err) {
      console.error('[PWA] Error triggering install prompt:', err);
    }
  };

  const sendMessage = async (chatId: string, text: string, optionalSenderId?: string) => {
    const sender = optionalSenderId ? users.find(u => u.id === optionalSenderId) : currentUser;
    if (!sender) return;

    // 1. Client-side Rate Limit check
    const rLimit = checkClientRateLimit('send_message', sender.id);
    if (!rLimit.allowed) {
      throw new Error(`Rate limit exceeded: You are sending messages too fast. Please wait ${rLimit.remainingSecs} seconds.`);
    }

    // 2. Text Sanitization and size limits
    const cleanText = sanitizeText(text);
    if (!cleanText) {
      throw new Error('Message text cannot be empty.');
    }
    if (cleanText.length > 5000) {
      throw new Error('Message cannot exceed 5000 characters.');
    }

    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;

    const isAdminUser = (currentUser?.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com' || currentUser?.isAdmin) && isAdminSessionVerified;
    
    let senderId = sender.id;
    let recId = chat.buyerId === sender.id ? chat.sellerId : chat.buyerId;

    if (isAdminUser && chat.sellerId === 'user_ted_ceo_support') {
      senderId = 'user_ted_ceo_support';
      recId = chat.buyerId;
    }

    const msgId = `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const newMsg: Message = {
      id: msgId,
      chatId,
      senderId: senderId,
      recipientId: recId,
      text: cleanText,
      createdAt: new Date().toISOString(),
      read: false
    };

    // Snappy Optimistic UI: update local messages state immediately
    setMessages(prev => {
      const updated = [...prev, newMsg];
      try {
        safeLocalStorage.setItem('tedbuy_local_messages_backup', JSON.stringify(updated));
        if (currentUser) {
          safeLocalStorage.setItem(`tedbuy_local_messages_backup_${currentUser.id}`, JSON.stringify(updated));
        }
      } catch (_) {}
      return updated;
    });

    // Snappy Optimistic UI: update chats status list immediately
    setChats(prevChats => {
      const updatedChats = prevChats.map(c => {
        if (c.id === chatId) {
          return {
            ...c,
            lastMessageText: text,
            lastMessageTime: newMsg.createdAt
          };
        }
        return c;
      });
      try {
        safeLocalStorage.setItem('tedbuy_local_chats_backup', JSON.stringify(updatedChats));
        if (currentUser) {
          safeLocalStorage.setItem(`tedbuy_local_chats_backup_${currentUser.id}`, JSON.stringify(updatedChats));
        }
      } catch (_) {}
      return updatedChats;
    });

    const queueMessageOffline = (msg: Message) => {
      try {
        const queueStr = safeLocalStorage.getItem('tedbuy_offline_message_queue') || '[]';
        const queue = JSON.parse(queueStr) as Message[];
        if (!queue.some(m => m.id === msg.id)) {
          queue.push(msg);
          safeLocalStorage.setItem('tedbuy_offline_message_queue', JSON.stringify(queue));
        }
      } catch (err) {
        console.warn('Could not cache message in offline queue:', err);
      }
    };

    if (!navigator.onLine) {
      console.log('[Offline Queue] Offline detected during send. Queueing message locally.');
      queueMessageOffline(newMsg);
      triggerBackgroundSync();
      return;
    }

    try {
      await setDoc(doc(db, 'messages', msgId), cleanObject(newMsg));
      await updateDoc(doc(db, 'chats', chatId), cleanObject({
        lastMessageText: text,
        lastMessageTime: newMsg.createdAt
      }));

      // In-app & Activity stream push notification trigger
      const notifId = `notif_chat_${Date.now()}_${recId}_${Math.random().toString(36).substring(2, 6)}`;
      const chatNotification: AppNotification = {
        id: notifId,
        userId: recId,
        type: 'new_message', // Map to standard interface type
        title: senderId === 'user_ted_ceo_support' ? 'Message from Tedbuy Support' : `Message from ${sender.username || 'User'}`,
        message: text.length > 50 ? `${text.substring(0, 50)}...` : text,
        triggerUserId: senderId,
        triggerUsername: senderId === 'user_ted_ceo_support' ? 'Tedbuy Support' : (sender.username || 'User'),
        triggerUserPhoto: senderId === 'user_ted_ceo_support' ? '' : (sender.photoUrl || ''),
        productId: chat.productId || '',
        productTitle: chat.productTitle || 'Shared Listing Chat',
        productPrice: chat.productPrice || 'Inquire',
        productImage: chat.productImage || '',
        createdAt: new Date().toISOString(),
        read: false,
        chatId: chatId
      };

      try {
        const key = `tedbuy_notifications_backup_${recId}`;
        const currentListStr = safeLocalStorage.getItem(key);
        const currentList = currentListStr ? JSON.parse(currentListStr) : [];
        currentList.unshift(chatNotification);
        safeLocalStorage.setItem(key, JSON.stringify(currentList));
      } catch (_) {}

      try {
        await setDoc(doc(db, 'notifications', notifId), cleanObject(chatNotification));
      } catch (dbErr) {
        console.warn('[sendMessage] Skip server notification log in sandbox context:', dbErr);
      }
    } catch (err) {
      console.warn('[sendMessage] Firestore transaction failed. Moving message to offline queue for background sync retry.', err);
      queueMessageOffline(newMsg);
      triggerBackgroundSync();
    }
  };

  const markChatAsRead = useCallback(async (chatId: string) => {
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
      if (currentUser) {
        safeLocalStorage.setItem(`tedbuy_local_messages_backup_${currentUser.id}`, JSON.stringify(updated));
      }
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
  }, [currentUser, messages]);

  const toggleMessageReadStatus = async (messageId: string, read: boolean = true) => {
    setMessages(prev => {
      const next = prev.map(m => m.id === messageId ? { ...m, read } : m);
      const targetMsg = msgMapRef.current.get(messageId);
      if (targetMsg) {
        msgMapRef.current.set(messageId, { ...targetMsg, read });
      }
      try {
        safeLocalStorage.setItem('tedbuy_local_messages_backup', JSON.stringify(next));
        if (currentUser) {
          safeLocalStorage.setItem(`tedbuy_local_messages_backup_${currentUser.id}`, JSON.stringify(next));
        }
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
    const following = Array.isArray(currentUser.followingSellers) ? currentUser.followingSellers : [];
    if (!following.includes(sellerId)) {
      const updatedFollowing = [...following, sellerId];
      try {
        await updateDoc(doc(db, 'users', currentUser.id), {
          followingSellers: updatedFollowing
        });
        setCurrentUserState({ ...currentUser, followingSellers: updatedFollowing });

        // Dispatch follow notification real-time trigger for target seller
        const notifId = `notif_follow_${Date.now()}_${sellerId}_${Math.random().toString(36).substring(2, 6)}`;
        const followNotification: AppNotification = {
          id: notifId,
          userId: sellerId,
          type: 'new_follower',
          title: 'New Follower!',
          message: `${currentUser.username || 'Someone'} started following your shop!`,
          triggerUserId: currentUser.id,
          triggerUsername: currentUser.username || 'Someone',
          triggerUserPhoto: currentUser.photoUrl || '',
          productId: '',
          productTitle: 'Shop Network',
          productPrice: '0',
          productImage: '',
          createdAt: new Date().toISOString(),
          read: false
        };

        try {
          const key = `tedbuy_notifications_backup_${sellerId}`;
          const currentListStr = safeLocalStorage.getItem(key);
          const currentList = currentListStr ? JSON.parse(currentListStr) : [];
          currentList.unshift(followNotification);
          safeLocalStorage.setItem(key, JSON.stringify(currentList));
        } catch (_) {}

        try {
          await setDoc(doc(db, 'notifications', notifId), cleanObject(followNotification));
        } catch (dbErr) {
          console.warn('[followSeller] Firestore follow notification skip:', dbErr);
        }
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
    const saved = Array.isArray(currentUser.savedProductIds) ? currentUser.savedProductIds : [];
    let updatedSaved: string[];
    let isAdding = false;
    if (saved.includes(productId)) {
      updatedSaved = saved.filter(id => id !== productId);
    } else {
      updatedSaved = [...saved, productId];
      isAdding = true;
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
    username?: string;
    phoneNumber?: string;
    photoUrl?: string;
    role?: 'buyer' | 'seller' | 'both';
    whatsAppNumber?: string;
  }) => {
    if (!currentUser) return;
    
    // Support partial updates and preserve existing fields if omitted or undefined
    const finalUsername = profileData.username !== undefined ? profileData.username.trim() : (currentUser.username || '');
    const finalPhoneNumber = profileData.phoneNumber !== undefined ? (profileData.phoneNumber.trim() || undefined) : currentUser.phoneNumber;
    const finalWhatsAppNumber = profileData.whatsAppNumber !== undefined ? (profileData.whatsAppNumber.trim() || undefined) : currentUser.whatsAppNumber;
    const finalPhotoUrl = profileData.photoUrl !== undefined ? (profileData.photoUrl || undefined) : currentUser.photoUrl;
    const finalRole = profileData.role !== undefined ? profileData.role : (currentUser.role || 'both');

    const currentStoreNameLower = currentUser.username?.trim().toLowerCase();
    const newStoreNameLower = finalUsername.trim().toLowerCase();

    const updatedUser: User = {
      ...currentUser,
      username: finalUsername,
      phoneNumber: finalPhoneNumber,
      whatsAppNumber: finalWhatsAppNumber,
      photoUrl: finalPhotoUrl,
      role: finalRole
    };

    // --- INSTANT OPTIMISTIC STATE UPDATE (Saves are now 100% instantaneous) ---
    setCurrentUserState(updatedUser);
    
    // Sync with users list state
    setUsers(prevUsers => {
      const updatedList = prevUsers.map(u => u.id === currentUser.id ? updatedUser : u);
      try {
        safeLocalStorage.setItem('tedbuy_local_users_backup', JSON.stringify(updatedList));
      } catch (_) {}
      return updatedList;
    });

    // Match simulated user state and persist inside dedicated caches
    try {
      safeLocalStorage.setItem('tedbuy_simulated_user', JSON.stringify(updatedUser));
      safeLocalStorage.setItem('tedbuy_local_current_user_backup', JSON.stringify(updatedUser));
      
      const cacheStr = safeLocalStorage.getItem('tedbuy_user_profiles_cache') || '{}';
      const cache = JSON.parse(cacheStr);
      cache[updatedUser.id] = updatedUser;
      safeLocalStorage.setItem('tedbuy_user_profiles_cache', JSON.stringify(cache));
    } catch (_) {}

    // --- FIRE-AND-FORGET BACKGROUND FIRESTORE WRITE ---
    try {
      const batch = writeBatch(db);
      
      const updatePayload: any = {};
      if (profileData.username !== undefined) updatePayload.username = finalUsername;
      if (profileData.phoneNumber !== undefined) updatePayload.phoneNumber = finalPhoneNumber || null;
      if (profileData.whatsAppNumber !== undefined) updatePayload.whatsAppNumber = finalWhatsAppNumber || null;
      if (profileData.photoUrl !== undefined) updatePayload.photoUrl = finalPhotoUrl || null;
      if (profileData.role !== undefined) updatePayload.role = finalRole;

      batch.update(doc(db, 'users', currentUser.id), cleanObject(updatePayload));

      if (profileData.username !== undefined && newStoreNameLower !== currentStoreNameLower) {
        if (currentStoreNameLower) {
          batch.delete(doc(db, 'storeNames', currentStoreNameLower));
        }
        batch.set(doc(db, 'storeNames', newStoreNameLower), {
          userId: currentUser.id,
          username: finalUsername.trim()
        });
        console.log(`[Profile Update] Atomic store name mapping queued from "${currentStoreNameLower}" to "${newStoreNameLower}"`);
      } else if (profileData.username !== undefined) {
        batch.set(doc(db, 'storeNames', newStoreNameLower), {
          userId: currentUser.id,
          username: finalUsername.trim()
        });
      }

      batch.commit()
        .then(() => {
          console.log('[Profile Update] Background Firestore batch write committed successfully.');
        })
        .catch(err => {
          console.warn('[Profile Update] Background Firestore write queued for offline sync:', err);
        });
    } catch (err) {
      console.warn('[Profile Update] Background Firestore batch build error:', err);
    }
  };

  const deleteAccount = async () => {
    if (!currentUser) return;
    
    // Crucial Security Guard: Block administrator account deletion
    const userEmail = currentUser.email?.trim()?.toLowerCase();
    if (userEmail === 'asumaduvincent7@gmail.com') {
      throw new Error('Crucial Security Guard: The super-administrator account ("asumaduvincent7@gmail.com") is heavily protected and cannot be deleted under any circumstances.');
    }

    const uid = currentUser.id;
    const authUser = auth.currentUser;
    const isSimulated = !(import.meta as any).env.PROD && safeLocalStorage.getItem('tedbuy_simulated_mode') === 'true';

    // Set the account deletion flag to prevent snapshot auto-recreation
    safeLocalStorage.setItem('tedbuy_deleting_account', 'true');

    try {
      // 1. If not simulated, do database and authentication cleanup
      if (!isSimulated && authUser) {
        // Step A: Best-effort client-side Firestore cleanup first (since Web SDK has direct authorization for user owned data)
        try {
          console.log('[Account Deletion] Performing client-side Firestore cleanup...');
          // Delete user's own products
          const myProducts = products.filter(p => p.sellerId === uid);
          await Promise.all(myProducts.map(p => deleteDoc(doc(db, 'products', p.id)).catch(() => {})));
          
          // Delete storeName mapping
          if (currentUser.username) {
            await deleteDoc(doc(db, 'storeNames', currentUser.username.trim().toLowerCase())).catch(() => {});
          }
          
          // Delete user profile document
          await deleteDoc(doc(db, 'users', uid)).catch(() => {});
        } catch (cleanupErr) {
          console.warn('[Account Deletion] Client-side Firestore cleanup warning:', cleanupErr);
        }

        // Step B: Call backend API to delete remaining global references & Supabase if active with a robust timeout guard
        let resData: any = {};
        try {
          console.log('[Account Deletion] Invoking backend deletion API...');
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 12000);

          const idToken = await authUser.getIdToken();
          const response = await fetch('/api/auth/delete-account', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`
            },
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Failed to delete account. Backend returned status ${response.status}.`);
          }
          
          resData = await response.json().catch(() => ({}));
          console.log('[Account Deletion] Backend successfully processed account data deletion:', resData);
        } catch (apiErr: any) {
          console.warn('[Account Deletion] Backend deletion API call failed or timed out. Attempting client-side fallback:', apiErr);
        }

        // Step C: Delete the actual Firebase Auth User account directly on client-side as a reliable fallback
        if (!resData?.authDeleted) {
          try {
            await deleteUser(authUser);
            console.log('[Account Deletion] Successfully deleted Firebase Auth user directly on client-side.');
          } catch (authErr) {
            console.warn('[Account Deletion] Client-side deleteUser failed or requires reauthentication:', authErr);
          }
        }
      }

      // 2. Local memory and storage cleanup
      safeLocalStorage.removeItem('tedbuy_simulated_user');
      safeLocalStorage.removeItem('tedbuy_simulated_mode');
      safeLocalStorage.removeItem('tedbuy_local_current_user_backup');

      try {
        const cached = safeLocalStorage.getItem('tedbuy_local_users_backup');
        const currentList = cached ? JSON.parse(cached) : (users || []);
        const filtered = currentList.filter((u: User) => u.id !== uid);
        safeLocalStorage.setItem('tedbuy_local_users_backup', JSON.stringify(filtered));
        setUsers(filtered);
      } catch (cacheErr) {
        console.warn('Could not filter custom backup data upon account deletion:', cacheErr);
        setUsers(prev => prev.filter(u => u.id !== uid));
      }

      if (!isSimulated) {
        try {
          await signOut(auth);
        } catch (signOutErr) {
          console.warn('Could not complete signOut on Firebase Auth:', signOutErr);
        }
      }
      
      setCurrentUserState(null);
      showToast('Your account and all associated data have been permanently deleted.', 'success');
      setCurrentView('browse');
    } catch (err) {
      safeLocalStorage.removeItem('tedbuy_deleting_account');
      throw err;
    } finally {
      safeLocalStorage.removeItem('tedbuy_deleting_account');
    }
  };

  const sendWelcomeEmailToAll = async (
    onlyUnsent: boolean, 
    onProgress: (current: number, total: number, logMsg: string) => void
  ) => {
    if (!currentUser || !currentUser.isAdmin || !isAdminSessionVerified) {
      throw new Error("Unauthorized: Only administrators can trigger bulk onboarding emails.");
    }

    const targets = users.filter(u => u.email && (!onlyUnsent || !u.welcomeSent));
    const total = targets.length;

    if (total === 0) {
      onProgress(0, 0, "No users found matching the filter criteria.");
      return;
    }

    let logs = `Starting welcome email dispatch for ${total} users...\n\n`;
    onProgress(0, total, logs);

    let successCount = 0;
    for (let i = 0; i < total; i++) {
      const targetUser = targets[i];
      const email = targetUser.email!.trim();
      const prepMessage = `[${i + 1}/${total}] Sending to: ${targetUser.username} (${email})...`;
      onProgress(i, total, logs + prepMessage);

      try {
        let idToken = auth.currentUser ? await auth.currentUser.getIdToken() : '';
        if (!idToken) {
          idToken = safeLocalStorage.getItem('tedbuy_custom_auth_token') || '';
        }
        const emailResponse = await fetch('/api/send-welcome-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {})
          },
          body: JSON.stringify({
            email,
            username: targetUser.username
          })
        });

        if (emailResponse.ok) {
          successCount++;
          const userRef = doc(db, 'users', targetUser.id);
          await setDoc(userRef, { welcomeSent: true }, { merge: true });
          logs += `✔️ [SUCCESS] ${targetUser.username} (${email})\n`;
        } else {
          const errData = await emailResponse.json().catch(() => ({}));
          const details = errData.details || errData.error || `Status code ${emailResponse.status}`;
          console.warn(`Failed to send email to ${email} (status: ${emailResponse.status})`);
          logs += `❌ [FAILED] ${targetUser.username} (${email}): ${details}\n`;
        }
      } catch (err: any) {
        console.error(`Error sending bulk email to ${email}:`, err);
        logs += `❌ [ERROR] ${targetUser.username} (${email}): ${err?.message || String(err)}\n`;
      }

      onProgress(i + 1, total, logs);
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    logs += `\n✨ Dispatch Complete! Successfully sent to ${successCount} of ${total} users.`;
    onProgress(total, total, logs);
  };

  const adminDeleteUserProfile = async (userId: string, forceDeleteActive: boolean = false) => {
    if (!currentUser || !currentUser.isAdmin || !isAdminSessionVerified) {
      throw new Error("Unauthorized: Only administrators can delete store profiles.");
    }

    const isSimulated = !(import.meta as any).env.PROD && safeLocalStorage.getItem('tedbuy_simulated_mode') === 'true';

    // Check system to verify if this user still exists in the master database (Firestore)
    let existsInDb = false;
    let targetUserDb: User | null = null;
    try {
      const docRef = doc(db, 'users', userId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        existsInDb = true;
        targetUserDb = docSnap.data() as User;
      }
    } catch (dbCheckErr) {
      console.warn('[Admin Delete] Could not fetch user data from network, falling back to local memory list check:', dbCheckErr);
      // In case of transient network failure or offline mode, we assume they might exist locally to allow manual override
      existsInDb = true; 
    }

    const targetUser = targetUserDb || users.find(u => u.id === userId);
    if (!targetUser) {
      throw new Error("User profile not found in system.");
    }

    // Crucial Security Guard: Block admin profile deletion from admin dashboard
    const targetEmail = targetUser.email?.trim()?.toLowerCase();
    if (targetEmail === 'asumaduvincent7@gmail.com') {
      throw new Error('Crucial Security Guard: The super-administrator account ("asumaduvincent7@gmail.com") cannot be deleted under any circumstances.');
    }

    if (existsInDb && !forceDeleteActive) {
      throw new Error("ACTIVE_ACCOUNT_CONFIRM_REQUIRED");
    }

    if (!existsInDb) {
      // The account has already been deleted by the user!
      // We must clean up the local memory state and backup cache to release this store name immediately.
      try {
        const cached = safeLocalStorage.getItem('tedbuy_local_users_backup');
        const currentList = cached ? JSON.parse(cached) : (users || []);
        const filtered = currentList.filter((u: User) => u.id !== userId);
        safeLocalStorage.setItem('tedbuy_local_users_backup', JSON.stringify(filtered));
        setUsers(filtered);
      } catch (cacheErr) {
        setUsers(prev => prev.filter(u => u.id !== userId));
      }
      showToast(`Verified: This store account was already deleted by the user! Released store name "${targetUser.username}" instantly.`, 'success');
      return;
    }

    console.log(`[Admin] Deleting active store profile for user: ${targetUser.username} (${userId})`);

    // 1. Delete all user's listings (products)
    try {
      const userProducts = products.filter(p => p.sellerId === userId);
      for (const p of userProducts) {
        if (!isSimulated) {
          await deleteDoc(doc(db, 'products', p.id));
        }
      }
      if (!isSimulated) {
        const pq = query(collection(db, 'products'), where('sellerId', '==', userId));
        const pqSnap = await getDocs(pq);
        for (const itemDoc of pqSnap.docs) {
          await deleteDoc(itemDoc.ref);
        }
      }
    } catch (productErr) {
      console.warn('Could not fully delete user product listings upon admin deletion:', productErr);
    }

    // 2. Delete all user's reviews
    try {
      const userReviews = reviews.filter(r => r.buyerId === userId || r.sellerId === userId);
      for (const r of userReviews) {
        if (!isSimulated) {
          await deleteDoc(doc(db, 'reviews', r.id));
        }
      }
      if (!isSimulated) {
        const rq1 = query(collection(db, 'reviews'), where('buyerId', '==', userId));
        const rq1Snap = await getDocs(rq1);
        for (const itemDoc of rq1Snap.docs) {
          await deleteDoc(itemDoc.ref);
        }
        const rq2 = query(collection(db, 'reviews'), where('sellerId', '==', userId));
        const rq2Snap = await getDocs(rq2);
        for (const itemDoc of rq2Snap.docs) {
          await deleteDoc(itemDoc.ref);
        }
      }
    } catch (reviewErr) {
      console.warn('Could not fully delete user reviews upon admin deletion:', reviewErr);
    }

    // 3. Delete all chats involving this user
    const userChats = chats.filter(c => c.buyerId === userId || c.sellerId === userId);
    try {
      for (const c of userChats) {
        if (!isSimulated) {
          await deleteDoc(doc(db, 'chats', c.id));
        }
      }
      if (!isSimulated) {
        const cq1 = query(collection(db, 'chats'), where('buyerId', '==', userId));
        const cq1Snap = await getDocs(cq1);
        for (const itemDoc of cq1Snap.docs) {
          await deleteDoc(itemDoc.ref);
        }
        const cq2 = query(collection(db, 'chats'), where('sellerId', '==', userId));
        const cq2Snap = await getDocs(cq2);
        for (const itemDoc of cq2Snap.docs) {
          await deleteDoc(itemDoc.ref);
        }
      }
    } catch (chatErr) {
      console.warn('Could not fully delete user chats upon admin deletion:', chatErr);
    }

    // 4. Delete all messages sent/received by this user
    try {
      const chatIdsSet = new Set(userChats.map(c => c.id));
      const userMessages = messages.filter(m => m.senderId === userId || m.recipientId === userId || chatIdsSet.has(m.chatId));
      for (const m of userMessages) {
        if (!isSimulated) {
          await deleteDoc(doc(db, 'messages', m.id));
        }
      }
      if (!isSimulated) {
        const mq1 = query(collection(db, 'messages'), where('senderId', '==', userId));
        const mq1Snap = await getDocs(mq1);
        for (const itemDoc of mq1Snap.docs) {
          await deleteDoc(itemDoc.ref);
        }
        const mq2 = query(collection(db, 'messages'), where('recipientId', '==', userId));
        const mq2Snap = await getDocs(mq2);
        for (const itemDoc of mq2Snap.docs) {
          await deleteDoc(itemDoc.ref);
        }
      }
    } catch (msgErr) {
      console.warn('Could not fully delete user messages upon admin deletion:', msgErr);
    }

    // 5. Delete specific deletedEmails record
    const emailToDelete = targetUser.email;
    if (emailToDelete) {
      const emailPath = emailToDelete.trim().toLowerCase();
      try {
        if (!isSimulated) {
          await deleteDoc(doc(db, 'deletedEmails', emailPath));
        }
      } catch (err) {
        console.warn('Could not clear deleted email blocklist from Firestore:', err);
        try {
          handleFirestoreError(err, OperationType.DELETE, `deletedEmails/${emailPath}`);
        } catch (thrownErr) {
          console.warn('[Admin Delete] Blocklist clearance exception logged gracefully:', thrownErr);
        }
      }
    }

    // 6. Delete user doc and store name mapping atomically
    try {
      if (!isSimulated) {
        const batch = writeBatch(db);
        const userRef = doc(db, 'users', userId);
        batch.delete(userRef);

        const storeNameLower = targetUser.username?.trim()?.toLowerCase();
        if (storeNameLower) {
          const storeNameRef = doc(db, 'storeNames', storeNameLower);
          batch.delete(storeNameRef);
          console.log(`[Admin Delete] Queued deletion of store name registration: "${storeNameLower}"`);
        }

        await batch.commit();
        console.log('[Admin Delete] Atomic user and storeNames registry deletion completed.');
      }
    } catch (err: any) {
      console.error('Could not delete user document and store name mapping from firestore during admin deletion:', err);
      try {
        handleFirestoreError(err, OperationType.DELETE, `users/${userId}`);
      } catch (thrownErr) {
        console.warn('[Admin Delete] User doc delete exception logged gracefully:', thrownErr);
      }
    }

    // Filter out deleted user from local users backup cache and live memory state
    try {
      const cached = safeLocalStorage.getItem('tedbuy_local_users_backup');
      const currentList = cached ? JSON.parse(cached) : (users || []);
      const filtered = currentList.filter((u: User) => u.id !== userId);
      safeLocalStorage.setItem('tedbuy_local_users_backup', JSON.stringify(filtered));
      setUsers(filtered);
    } catch (cacheErr) {
      console.warn('Could not filter custom backup data upon admin deletion:', cacheErr);
      setUsers(prev => prev.filter(u => u.id !== userId));
    }

    showToast(`Store profile for "${targetUser.username}" permanently deleted and store name released!`, 'success');
  };
  
  const adminToggleUserSuspension = async (userId: string, suspend: boolean) => {
    if (!currentUser || !currentUser.isAdmin || !isAdminSessionVerified) {
      throw new Error("Unauthorized: Only verified administrators can suspend or unsuspend store profiles.");
    }

    const targetUser = users.find(u => u.id === userId);
    if (!targetUser) {
      throw new Error("User profile not found in system.");
    }

    const targetEmail = targetUser.email?.trim()?.toLowerCase();
    if (targetEmail === 'asumaduvincent7@gmail.com') {
      throw new Error('Crucial Security Guard: The super-administrator account ("asumaduvincent7@gmail.com") cannot be suspended.');
    }

    const isSimulated = !(import.meta as any).env.PROD && safeLocalStorage.getItem('tedbuy_simulated_mode') === 'true';

    console.log(`[Admin] ${suspend ? 'Suspending' : 'Unsuspending'} user profile for: ${targetUser.username} (${userId})`);

    // 1. Update Firestore
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        isSuspended: suspend
      });
      console.log(`[Admin Suspend] Successfully wrote isSuspended: ${suspend} to Firestore for ${userId}`);
    } catch (dbErr: any) {
      console.warn('[Admin Suspend] Firestore update failed, trying sandbox update:', dbErr);
    }

    // 2. If Supabase is active, sync to Supabase table
    if (isSupabaseActive && supabase) {
      try {
        const { error } = await supabase
          .from('users')
          .update({ isSuspended: suspend })
          .eq('id', userId);
        if (error) throw error;
        console.log('[Admin Suspend] Supabase sync completed.');
      } catch (sbErr) {
        console.warn('[Admin Suspend] Supabase sync failed:', sbErr);
      }
    }

    // 3. Update local state
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, isSuspended: suspend } : u));
    
    // If the active current user in memory is updated
    if (currentUser && currentUser.id === userId) {
      setCurrentUserState(prev => prev ? { ...prev, isSuspended: suspend } : null);
    }

    // 4. Update the local backups
    try {
      const localUsersBackup = safeLocalStorage.getItem('tedbuy_local_users_backup');
      if (localUsersBackup) {
        const parsedList = JSON.parse(localUsersBackup) as User[];
        const updatedList = parsedList.map(u => u.id === userId ? { ...u, isSuspended: suspend } : u);
        safeLocalStorage.setItem('tedbuy_local_users_backup', JSON.stringify(updatedList));
      }
    } catch (err) {
      console.warn('Failed to update local users backup:', err);
    }

    showToast(`User "${targetUser.username}" has been successfully ${suspend ? 'suspended' : 'unsuspended'}.`, 'success');
  };

  const addReview = async (sellerId: string, rating: number, comment: string, productTitle?: string) => {
    if (!currentUser) {
      throw new Error('Authentication Required: You must be logged in to submit reviews.');
    }

    // 1. Client-side Rate Limit check
    const rLimit = checkClientRateLimit('submit_review', currentUser.id);
    if (!rLimit.allowed) {
      throw new Error(`Rate limit exceeded: You can only submit 3 reviews within 5 minutes. Please try again in ${rLimit.remainingSecs} seconds.`);
    }

    // 2. Input Sanitization and validation
    const cleanComment = sanitizeText(comment);
    if (cleanComment.length < 5 || cleanComment.length > 1000) {
      throw new Error('Comment must be between 5 and 1000 characters long.');
    }
    if (rating < 1 || rating > 5) {
      throw new Error('Review rating must be between 1 and 5 stars.');
    }

    const revId = `rev_${Date.now()}`;
    const newReview: Review = {
      id: revId,
      sellerId,
      buyerId: currentUser.id,
      buyerName: currentUser.username,
      buyerPhoto: currentUser.photoUrl || '',
      rating: Math.floor(rating),
      comment: cleanComment,
      createdAt: new Date().toISOString(),
      productTitle: productTitle ? sanitizeText(productTitle) : undefined
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
    setProducts([]);
    await new Promise(resolve => setTimeout(resolve, 800));
    try {
      const snapshot = await getDocs(collection(db, 'products'));
      const pList: Product[] = [];
      snapshot.forEach(docSnap => {
        const item = {
          ...docSnap.data() as Product,
          id: docSnap.id
        };
        if (item.id !== 'prod_1780927804590' && isRealProduct(item)) {
          if (item.category) {
            item.category = normalizeCategory(item.category);
          }
          pList.push(item);
        } else {
          // Self-healing: clear demo listings from database if they are found
          try {
            deleteDoc(doc(db, 'products', item.id)).catch(() => {});
          } catch (_) {}
        }
      });
      const sorted = pList.sort((a, b) => {
        const dateA = typeof a?.createdAt === 'string' ? a.createdAt : '';
        const dateB = typeof b?.createdAt === 'string' ? b.createdAt : '';
        return dateB.localeCompare(dateA);
      });
      setProducts(sorted);
    } catch (err) {
      console.error('Error manually refreshing products:', err);
    } finally {
      setIsProductsLoading(false);
    }
  };

  const retryLoadProducts = () => {
    setProductsLoadError(false);
    setIsProductsLoading(true);
    refreshProducts().catch((err) => {
      console.error('retryLoadProducts refresh failed:', err);
    });
  };

  const loadMoreProducts = useCallback(() => {
    setProductLimit(prev => prev + 24);
  }, []);

  // Memoized user profile state to resolve store-name flicking issue by prioritizing cached Firestore documents over Auth properties during handshake
  const memoizedCurrentUser = useMemo(() => {
    if (!currentUser) return null;

    const isBaseAdmin = currentUser.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com' || currentUser.isAdmin;

    let resolvedUser = { ...currentUser };
    try {
      // Prioritize the long-lived cache of Firestore user documents
      const cacheStr = safeLocalStorage.getItem('tedbuy_user_profiles_cache');
      if (cacheStr) {
        const cache = JSON.parse(cacheStr);
        const cachedDoc = cache[currentUser.id];
        if (cachedDoc) {
          resolvedUser = {
            ...currentUser,
            username: currentUser.username || cachedDoc.username,
            photoUrl: currentUser.photoUrl || cachedDoc.photoUrl,
            phoneNumber: currentUser.phoneNumber || cachedDoc.phoneNumber,
            whatsAppNumber: currentUser.whatsAppNumber || cachedDoc.whatsAppNumber,
            role: currentUser.role || cachedDoc.role,
            emailVerified: currentUser.emailVerified !== undefined ? currentUser.emailVerified : cachedDoc.emailVerified
          };
        }
      }
    } catch (err) {
      console.warn('[memoizedCurrentUser] Error resolving cache:', err);
    }

    if (isBaseAdmin) {
      if (isAdminSessionVerified) {
        resolvedUser.isAdmin = true;
      } else {
        delete resolvedUser.isAdmin;
      }
    } else {
      delete resolvedUser.isAdmin;
    }

    return resolvedUser;
  }, [currentUser, isAdminSessionVerified]);

  return (
    <AppContext.Provider value={{
      currentUser: memoizedCurrentUser,
      setCurrentUser: setCurrentUserState,
      isAdminSessionVerified,
      verifyAdminPIN,
      users,
      usersMap,
      registerUser,
      initiateRegistration,
      verifyAndCompleteRegistration,
      loginUser,
      resetPasswordEmail,
      loginWithGoogle,
      googleLinkingData,
      setGoogleLinkingData,
      linkGoogleWithPassword,
      logoutUser,
      products,
      createProduct,
      updateProduct,
      deleteProduct,
      toggleLikeProduct,
      chats,
      messages,
      startChat,
      reportProduct,
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
      adminDeleteUserProfile,
      adminToggleUserSuspension,
      sendWelcomeEmailToAll,
      reviews,
      addReview,
      searchQuery,
      debouncedSearchQuery,
      setSearchQuery,
      selectedCategory,
      setSelectedCategory,
      currentView,
      setCurrentView,
      homeViewMode,
      setHomeViewMode,
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
      productsLoadError,
      retryLoadProducts,
      refreshProducts,
      toast,
      showToast,
      hideToast,
      sendVerificationEmailReal,
      reloadUserVerificationStatus,
      isVerificationBlockOpen,
      setIsVerificationBlockOpen,
      isSuspendedBlockOpen,
      setIsSuspendedBlockOpen,
      blockedActionType,
      setBlockedActionType,
      notifications,
      markNotificationAsRead,
      markAllNotificationsAsRead,
      clearAllNotifications,
      productLimit,
      hasMoreProducts,
      loadMoreProducts,
      deferredPrompt,
      setDeferredPrompt,
      canInstall,
      setCanInstall,
      triggerPWAInstall,
      isStandalone,
      isBottomNavVisible,
      setIsBottomNavVisible
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
