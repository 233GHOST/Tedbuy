import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { User, Product, Chat, Message, Category, Review, normalizeCategory, AppNotification, ImpersonationSession, isReservedStoreName, isUserAdmin, isUserVerified } from '../types';
import { normalizeProduct } from '../utils/productUtils';
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
  deleteUser,
  updateProfile
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
  orderBy,
  limit,
  isSupabaseActive,
  supabase
} from '../dbAdapter';
import { auth, getAuthHeader, handleBackendError, OperationType, registerBackendErrorListener, requestFcmToken, fetchChatsFromApi, fetchMessagesFromApi, startChatViaApi, sendMessageViaApi, markChatReadViaApi } from '../firebase';
import { slugify } from '../utils/slugify';
import { getAuthErrorMessage, toUserFriendlyError } from '../utils/authErrorHelper';
import { useHashRouting } from '../hooks/useHashRouting';
import { deleteMultipleFromCloudinary, getCloudinaryVideoPoster } from '../utils/cloudinary';
import { registerServiceWorker, triggerBackgroundSync } from '../registerServiceWorker';
import { checkClientRateLimit } from '../utils/rateLimiter';
import { sanitizeText, validateInputLength } from '../utils/inputValidation';
import { isChatEligibleForReuse } from '../utils/chatStateUtils';

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

const playMessageChime = () => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (_) {}
};

export function isRealProduct(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  if (item.isDeleted === true || item.is_deleted === true || item.status === 'archived' || item.status === 'deleted') {
    return false;
  }
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
  addReview: (sellerId: string, rating: number, comment: string, productTitle?: string, chatId?: string) => Promise<void>;
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
  resetAppToZero: () => Promise<void>;
  products: Product[];
  createProduct: (productData: {
    title: string;
    description: string;
    price: string | number;
    category: Category;
    location: string;
    images: string[];
    imageUrls?: string[];
    displayImage?: string;
    primaryPicture?: string;
    videoPoster?: string;
    videos?: string[];
    videoUrls?: string[];
    brand?: string;
    condition?: string;
    negotiable?: boolean;
    isExchangeable?: boolean;
    exchangePossible?: boolean;
  }) => Promise<Product | undefined>;
  updateProduct: (id: string, productData: Partial<Product>, localOnly?: boolean) => Promise<string | undefined>;
  deleteProduct: (id: string) => Promise<void>;
  toggleLikeProduct: (productId: string, userId: string) => Promise<void>;
  chats: Chat[];
  messages: Message[];
  startChat: (productId: string, initialMessage?: string) => Promise<string>;
  reportProduct: (productId: string, reason: string, comment?: string) => Promise<boolean>;
  sendMessage: (chatId: string, text: string) => Promise<void>;
  sendTypingStatus: (chatId: string, isTyping: boolean) => Promise<void>;
  markChatAsRead: (chatId: string) => Promise<void>;
  markAsDelivered: (chatId: string) => Promise<void>;
  markAsPickedUp: (chatId: string) => Promise<void>;
  deleteChatForMe: (chatId: string) => Promise<void>;
  deleteMessageForMe: (messageId: string) => Promise<void>;
  deletedChatIds: Set<string>;
  deletedMessageIds: Set<string>;
  followSeller: (sellerId: string) => Promise<void>;
  unfollowSeller: (sellerId: string) => Promise<void>;
  toggleSaveProduct: (productId: string) => Promise<void>;
  searchQuery: string;
  debouncedSearchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedCategory: Category | null;
  setSelectedCategory: (cat: Category | null) => void;
  currentView: 'browse' | 'product-detail' | 'chats' | 'my-dashboard' | 'seller-profile' | 'profile-settings' | 'featured-listings' | 'trending-listings' | 'for-you-listings' | 'sellers-discovery' | 'post-ad';
  setCurrentView: (view: 'browse' | 'product-detail' | 'chats' | 'my-dashboard' | 'seller-profile' | 'profile-settings' | 'featured-listings' | 'trending-listings' | 'for-you-listings' | 'sellers-discovery' | 'post-ad') => void;
  homeViewMode: 'grid' | 'video-feed';
  setHomeViewMode: (mode: 'grid' | 'video-feed') => void;
  updateUserProfile: (profileData: {
    username?: string;
    phoneNumber?: string;
    photoUrl?: string;
    role?: 'buyer' | 'seller' | 'both';
    whatsAppNumber?: string;
    bio?: string;
    notificationPreferences?: {
      newFollower?: boolean;
      newMessage?: boolean;
      followedSellerNewListing?: boolean;
    };
  }) => Promise<void>;
  refreshUserProfile: (targetUid?: string) => Promise<User | null>;
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
  removeRecentQuery: (query: string) => void;
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
  adminToggleSecurityHold: (userId: string, hold: boolean, reason?: string) => Promise<void>;
  impersonationSession: ImpersonationSession | null;
  isImpersonating: boolean;
  originalAdminUser: User | null;
  startImpersonation: (targetUserId: string) => Promise<ImpersonationSession>;
  exitImpersonation: (reason?: string) => Promise<void>;
  getAuthHeader: () => Promise<Record<string, string>>;
  blockedActionType: 'post-ad' | 'chat' | 'whatsApp' | 'review' | null;
  setBlockedActionType: (type: 'post-ad' | 'chat' | 'whatsApp' | 'review' | null) => void;
  registerProduct: (prod: Product) => void;
  notifications: AppNotification[];
  markNotificationAsRead: (id: string) => Promise<void>;
  markAllNotificationsAsRead: () => Promise<void>;
  clearAllNotifications: () => Promise<void>;
  productLimit: number;
  hasMoreProducts: boolean;
  isLoadingMoreProducts: boolean;
  loadMoreProducts: () => void;
  deferredPrompt: any;
  setDeferredPrompt: React.Dispatch<React.SetStateAction<any>>;
  canInstall: boolean;
  setCanInstall: (val: boolean) => void;
  triggerPWAInstall: () => Promise<void>;
  isStandalone: boolean;
  isBottomNavVisible: boolean;
  setIsBottomNavVisible: (visible: boolean) => void;
  sellerListingCounts: Record<string, number>;
  refreshSellerCounts: () => Promise<void>;
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

  const [products, setProducts] = useState<Product[]>([]);
  const [productLimit, setProductLimit] = useState(24);
  const [hasMoreProducts, setHasMoreProducts] = useState(true);
  const [isLoadingMoreProducts, setIsLoadingMoreProducts] = useState(false);
  const currentProductPageRef = useRef<number>(1);
  const isFetchingMoreProductsRef = useRef<boolean>(false);
  const [optimisticDeletedProductIds, setOptimisticDeletedProductIds] = useState<Set<string>>(() => {
    try {
      const stored = safeLocalStorage.getItem('tedbuy_deleted_product_ids');
      if (stored) {
        return new Set(JSON.parse(stored));
      }
    } catch (_) {}
    return new Set();
  });
  const optimisticDeletedProductIdsRef = useRef(optimisticDeletedProductIds);
  useEffect(() => {
    optimisticDeletedProductIdsRef.current = optimisticDeletedProductIds;
  }, [optimisticDeletedProductIds]);

  const [sellerListingCounts, setSellerListingCounts] = useState<Record<string, number>>(() => {
    if (typeof window !== 'undefined' && (window as any).__INITIAL_SELLER_COUNTS__) {
      return (window as any).__INITIAL_SELLER_COUNTS__;
    }
    try {
      const stored = safeLocalStorage.getItem('tedbuy_seller_listing_counts');
      if (stored) return JSON.parse(stored);
    } catch (_) {}
    return {};
  });

  const refreshSellerCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/sellers/counts?nocache=true');
      if (res.ok) {
        const data = await res.json();
        if (data && data.counts) {
          setSellerListingCounts(data.counts);
          try {
            safeLocalStorage.setItem('tedbuy_seller_listing_counts', JSON.stringify(data.counts));
          } catch (_) {}
        }
      }
    } catch (err) {
      console.warn('[AppContext] refreshSellerCounts error:', err);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const fetchSellerCounts = async () => {
      try {
        const res = await fetch('/api/sellers/counts');
        if (res.ok) {
          const data = await res.json();
          if (active && data && data.counts) {
            setSellerListingCounts(data.counts);
            try {
              safeLocalStorage.setItem('tedbuy_seller_listing_counts', JSON.stringify(data.counts));
            } catch (_) {}
          }
        }
      } catch (err) {
        console.warn('[AppContext] Failed to fetch seller counts:', err);
      }
    };

    fetchSellerCounts();
    const interval = setInterval(fetchSellerCounts, 3 * 60 * 1000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchSellerCounts();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

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

  const [currentUser, setCurrentUserStateRaw] = useState<User | null>(() => {
    try {
      const stored = safeLocalStorage.getItem('tedbuy_local_current_user_backup');
      if (stored) {
        const parsed = JSON.parse(stored) as User;
        if (parsed.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com' || parsed.isAdmin) {
          parsed.isAdmin = true;
        } else {
          // Prevent local storage manipulation or legacy database field injection from injecting admin permissions on the client
          delete parsed.isAdmin;
        }
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  });

  const [deletedChatIds, setDeletedChatIds] = useState<Set<string>>(new Set());
  const [deletedMessageIds, setDeletedMessageIds] = useState<Set<string>>(new Set());
  const deletedChatIdsRef = useRef<Set<string>>(deletedChatIds);
  const deletedMessageIdsRef = useRef<Set<string>>(deletedMessageIds);

  useEffect(() => {
    deletedChatIdsRef.current = deletedChatIds;
  }, [deletedChatIds]);

  useEffect(() => {
    deletedMessageIdsRef.current = deletedMessageIds;
  }, [deletedMessageIds]);

  useEffect(() => {
    if (!currentUser) {
      setDeletedChatIds(new Set());
      setDeletedMessageIds(new Set());
      return;
    }

    try {
      const chatIds = safeLocalStorage.getItem(`tedbuy_deleted_chat_ids_${currentUser.id}`);
      const messageIds = safeLocalStorage.getItem(`tedbuy_deleted_message_ids_${currentUser.id}`);
      setDeletedChatIds(chatIds ? new Set(JSON.parse(chatIds)) : new Set());
      setDeletedMessageIds(messageIds ? new Set(JSON.parse(messageIds)) : new Set());
    } catch (err) {
      console.warn('[AppContext] Could not load deleted chat/message IDs:', err);
      setDeletedChatIds(new Set());
      setDeletedMessageIds(new Set());
    }
  }, [currentUser]);

  const msgMapRef = useRef<Map<string, Message>>(new Map());
  const pendingRegistrationRef = useRef<{ username: string; email: string; phoneNumber?: string; password: string; photoUrl?: string } | null>(null);
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

  // Impersonation State Management
  const [originalAdminUser, setOriginalAdminUser] = useState<User | null>(() => {
    try {
      const saved = safeLocalStorage.getItem('tedbuy_original_admin_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [impersonationSession, setImpersonationSession] = useState<ImpersonationSession | null>(() => {
    try {
      const saved = safeLocalStorage.getItem('tedbuy_impersonation_session');
      if (saved) {
        const parsed: ImpersonationSession = JSON.parse(saved);
        if (parsed && new Date(parsed.expiresAt).getTime() > Date.now()) {
          return parsed;
        } else {
          safeLocalStorage.removeItem('tedbuy_impersonation_session');
          safeLocalStorage.removeItem('tedbuy_original_admin_user');
        }
      }
    } catch {}
    return null;
  });

  const isImpersonating = !!impersonationSession;
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isProductsLoading, setIsProductsLoading] = useState(true);
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
    const unsubscribe = registerBackendErrorListener((errInfo) => {
      // Do not display disruptive global UI-blocking error toasts for background LIST/GET synchronizations,
      // since the application already has robust offline local storage fallbacks and caches for lists.
      // Only show error toasts for active writes (CREATE, UPDATE, DELETE) to notify users if their action failed.
      const isReadOperation = errInfo.operationType === OperationType.LIST || errInfo.operationType === OperationType.GET;
      if (!isReadOperation) {
        showToast(errInfo.error, 'error');
      } else {
        console.warn(`[Backend Read Graceful Fallback] Suppressed background read error toast for "${errInfo.path}":`, errInfo.error);
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
      } else if (slugOrId) {
        const cleanId = slugOrId.split('-')[0];
        return { view: 'product-detail' as const, selectedProductId: cleanId || slugOrId, selectedSellerId: null, category: null };
      }
    }

    // /sellers/:sellerId or /seller/:sellerId
    const sellerMatch = (pathname || '').match(/^\/sellers?\/([^\/]+)/);
    if (sellerMatch) {
      return { view: 'seller-profile' as const, selectedProductId: null, selectedSellerId: sellerMatch[1], category: null };
    }

    // /featured
    if (pathname === '/featured' || pathname === '/featured-listings') {
      return { view: 'featured-listings' as const, selectedProductId: null, selectedSellerId: null, category: null };
    }

    // /trending
    if (pathname === '/trending' || pathname === '/trending-listings') {
      return { view: 'trending-listings' as const, selectedProductId: null, selectedSellerId: null, category: null };
    }

    // /for-you
    if (pathname === '/for-you' || pathname === '/discover') {
      return { view: 'for-you-listings' as const, selectedProductId: null, selectedSellerId: null, category: null };
    }

    // /sellers
    if (pathname === '/sellers' || pathname === '/merchants' || pathname === '/discover-sellers') {
      return { view: 'sellers-discovery' as const, selectedProductId: null, selectedSellerId: null, category: null };
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

    // /post-ad or /sell or /post
    if (pathname === '/post-ad' || pathname === '/sell' || pathname === '/post') {
      return { view: 'post-ad' as const, selectedProductId: null, selectedSellerId: null, category: null };
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

  const [currentView, setCurrentView] = useState<'browse' | 'product-detail' | 'chats' | 'my-dashboard' | 'seller-profile' | 'profile-settings' | 'featured-listings' | 'trending-listings' | 'for-you-listings' | 'sellers-discovery' | 'post-ad'>(() => {
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

  // Seamlessly registers or updates a single product in local cache state
  const registerProduct = useCallback((prod: Product) => {
    if (!prod || !prod.id) return;
    setProducts(prevProducts => {
      const index = prevProducts.findIndex(p => p.id === prod.id);
      if (index === -1) {
        return [prod, ...prevProducts];
      }
      const existing = prevProducts[index];
      const updated = [...prevProducts];
      updated[index] = {
        ...existing,
        ...prod,
        images: Array.isArray(prod.images) && prod.images.length > 0
          ? prod.images
          : existing.images
      };
      return updated;
    });
  }, []);

  // Centralized robust helper to sync user profile to backend Supabase database
  const syncUserToServer = async (userToSync: User) => {
    if (!userToSync || !userToSync.id) return;
    try {
      const authHeaders = await getAuthHeader();
      const res = await fetch('/api/users/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ user: userToSync })
      });
      const data = await res.json();
      if (data.success) {
        console.log(`[syncUserToServer] Profile synced to Supabase database for UID "${userToSync.id}" ("${userToSync.username}")`);
      } else {
        console.warn('[syncUserToServer] Supabase sync response warning:', data.error);
      }
    } catch (err) {
      console.warn('[syncUserToServer] Network/server sync error:', err);
    }
  };

  // Centralized robust helper to discover and migrate existing user accounts/storeNames to current UID
  const findAndMigrateExistingUser = async (firebaseUser: { uid: string; email?: string | null; displayName?: string | null; photoURL?: string | null; emailVerified?: boolean; providerData?: any[] }): Promise<User | null> => {
    const targetUid = firebaseUser.uid;
    const rawEmail = firebaseUser.email ? firebaseUser.email.trim() : '';
    const targetEmailLower = rawEmail.toLowerCase();

    // 1. Direct UID lookup in the legacy user database.
    // Security fix (RLS-migration Phase 2, checkpoint 15): missed by the
    // original 5-site self-profile-reads catalog (checkpoint 12's sweep) --
    // self-only by construction (targetUid is always firebaseUser.uid),
    // same fix as that finding: GET /api/users/get?id=.
    try {
      const authHeaders = await getAuthHeader();
      const res = await fetch(`/api/users/get?id=${encodeURIComponent(targetUid)}`, { headers: authHeaders });
      const json = await res.json().catch(() => ({}));
      if (json.success && json.user) {
        const data = json.user as User;
        const normalized: User = { ...data, id: targetUid };
        return normalized;
      }
    } catch (err) {
      console.warn('[findAndMigrateExistingUser] Direct UID lookup failed:', err);
    }

    // 2. Check local caches in browser storage (survives offline / local sandbox -> live transition)
    let cachedUser: User | null = null;
    try {
      const backupStr = safeLocalStorage.getItem('tedbuy_local_current_user_backup');
      if (backupStr) {
        const parsed = JSON.parse(backupStr) as User;
        if (
          (parsed.email && parsed.email.trim().toLowerCase() === targetEmailLower) ||
          (rawEmail && parsed.email && parsed.email.trim() === rawEmail) ||
          (parsed.id && parsed.id === targetUid)
        ) {
          cachedUser = parsed;
        }
      }
      if (!cachedUser) {
        const profilesCacheStr = safeLocalStorage.getItem('tedbuy_user_profiles_cache');
        if (profilesCacheStr) {
          const cache = JSON.parse(profilesCacheStr);
          for (const uId of Object.keys(cache)) {
            const u = cache[uId] as User;
            if (
              (u.email && u.email.trim().toLowerCase() === targetEmailLower) ||
              (u.id && u.id === targetUid)
            ) {
              cachedUser = u;
              break;
            }
          }
        }
      }
      if (!cachedUser) {
        const usersListStr = safeLocalStorage.getItem('tedbuy_local_users_backup');
        if (usersListStr) {
          const list = JSON.parse(usersListStr) as User[];
          const found = list.find(u => u.email && u.email.trim().toLowerCase() === targetEmailLower);
          if (found) cachedUser = found;
        }
      }
    } catch (_) {}

    let foundDocData: User | null = null;
    let existingUserId: string | null = null;

    // Check if the cached user doc actually exists in the legacy user database under their old ID.
    // Security fix (RLS-migration Phase 2, checkpoint 15): same class as
    // step 5's storeNames-candidate lookup (checkpoint 13) -- a targeted
    // single-doc read of a candidate id, not a bulk/query leak, migrated
    // to the same GET /api/users/get?id=.
    if (cachedUser && cachedUser.id && cachedUser.id !== targetUid) {
      try {
        const authHeaders = await getAuthHeader();
        const res = await fetch(`/api/users/get?id=${encodeURIComponent(cachedUser.id)}`, { headers: authHeaders });
        const json = await res.json().catch(() => ({}));
        if (json.success && json.user) {
          foundDocData = json.user as User;
          existingUserId = json.user.id;
          console.log(`[findAndMigrateExistingUser] Located profile via local storage cache ID "${cachedUser.id}".`);
        }
      } catch (_) {}
    }

    // 3. Query the legacy users collection by exact email.
    // Security fix (RLS-migration Phase 2, checkpoint 10): same finding
    // and same fix as step 6 below -- this was a direct, unauthenticated
    // `getDocs(query(collection('users'), where('email', '==', ...)))`.
    // Client-side query filters aren't access control (foundational fact
    // #2 of the migration plan): a caller bypassing this app's own JS
    // could issue the same underlying request with ANY email, or none at
    // all, turning this into an unauthenticated way to look up any other
    // user's full profile (or the entire table) by email. Migrated to
    // the same targeted, safe-by-design GET /api/users/get?email= lookup.
    if (!foundDocData && rawEmail) {
      try {
        const authHeaders = await getAuthHeader();
        const res = await fetch(`/api/users/get?email=${encodeURIComponent(rawEmail)}`, { headers: authHeaders });
        const json = await res.json().catch(() => ({}));
        if (json.success && json.user && json.user.id !== targetUid) {
          foundDocData = json.user as User;
          existingUserId = json.user.id;
          console.log(`[findAndMigrateExistingUser] Located profile via exact email lookup ("${rawEmail}") under ID "${existingUserId}".`);
        }
      } catch (e) {
        console.warn('[findAndMigrateExistingUser] Exact email lookup failed:', e);
      }
    }

    // 4. Query the legacy users collection by lowercased email (same fix)
    if (!foundDocData && targetEmailLower && targetEmailLower !== rawEmail) {
      try {
        const authHeaders = await getAuthHeader();
        const res = await fetch(`/api/users/get?email=${encodeURIComponent(targetEmailLower)}`, { headers: authHeaders });
        const json = await res.json().catch(() => ({}));
        if (json.success && json.user && json.user.id !== targetUid) {
          foundDocData = json.user as User;
          existingUserId = json.user.id;
          console.log(`[findAndMigrateExistingUser] Located profile via lowercased email lookup ("${targetEmailLower}") under ID "${existingUserId}".`);
        }
      } catch (e) {
        console.warn('[findAndMigrateExistingUser] Lower email query failed:', e);
      }
    }

    // 5. Query storeNames mapping for candidates: cached username, display name, email prefix.
    // The storeNames lookup itself stays a direct read (non-PII id->userId/
    // username mapping, keyed by a candidate derived only from the current
    // session's own cached username/display name/email prefix, never
    // attacker-controlled). Security fix (RLS-migration Phase 2, checkpoint
    // 13): the follow-up profile read WAS a direct, unauthenticated
    // `getDoc(doc('users', storeData.userId))` -- a targeted but still
    // unauthenticated single-user PII read, previously left deferred
    // because it was coupled to the merge-write logic below, which needed
    // its own server-side redesign first (see that block's comment). Now
    // that the merge write is server-verified, this read closes the same
    // way steps 3/4/6 already did: GET /api/users/get?id=.
    if (!foundDocData) {
      const storeCandidates: string[] = [];
      if (cachedUser && cachedUser.username) storeCandidates.push(cachedUser.username.trim().toLowerCase());
      if (firebaseUser.displayName) storeCandidates.push(firebaseUser.displayName.trim().toLowerCase());
      if (targetEmailLower) {
        const emailPrefix = targetEmailLower.split('@')[0];
        if (emailPrefix) storeCandidates.push(emailPrefix.toLowerCase());
      }

      for (const candidate of storeCandidates) {
        if (!candidate) continue;
        try {
          const storeSnap = await getDoc(doc('storeNames', candidate));
          if (storeSnap.exists()) {
            const storeData = storeSnap.data();
            if (storeData && storeData.userId && storeData.userId !== targetUid) {
              const authHeaders = await getAuthHeader();
              const res = await fetch(`/api/users/get?id=${encodeURIComponent(storeData.userId)}`, { headers: authHeaders });
              const json = await res.json().catch(() => ({}));
              if (json.success && json.user) {
                const uData = json.user as User;
                const uEmail = uData.email ? uData.email.trim().toLowerCase() : '';
                if (uEmail === targetEmailLower || !uEmail || !targetEmailLower) {
                  foundDocData = uData;
                  existingUserId = uData.id;
                  console.log(`[findAndMigrateExistingUser] Located profile via storeNames mapping "${candidate}" -> ID "${existingUserId}".`);
                  break;
                }
              }
            }
          }
        } catch (_) {}
      }
    }

    // 6. Case-insensitive email lookup in the legacy database.
    // Security fix (RLS-migration Phase 2, checkpoint 10): this used to be
    // `getDocs(collection('users'))` -- an unauthenticated, unfiltered
    // `select('*')` bulk read of the ENTIRE users table, missed by the
    // original Phase 0 sweep (§0 of this document) because that sweep's
    // grep only matched `fetchUsersOnce`'s specific call pattern, not this
    // one, buried inside the account-migration search's own fallback step.
    // Same severity as that original finding -- every user's email/phone/
    // whatsApp/isAdmin/isSuspended/securityHold, for every user, in one
    // unauthenticated request. `/api/users/list` (used to fix the original
    // finding) can't replace this specific lookup: it deliberately omits
    // email for the exact same bulk-exposure reason, and this step's whole
    // purpose is matching by email. `GET /api/users/get?email=` already
    // exists as a targeted, single-user, safe-by-design lookup (the
    // caller's own just-authenticated email, not attacker-controlled) --
    // migrated to that instead of building anything new.
    if (!foundDocData && targetEmailLower) {
      try {
        const authHeaders = await getAuthHeader();
        const res = await fetch(`/api/users/get?email=${encodeURIComponent(targetEmailLower)}`, { headers: authHeaders });
        const json = await res.json().catch(() => ({}));
        if (json.success && json.user && json.user.id !== targetUid) {
          foundDocData = json.user as User;
          existingUserId = json.user.id;
          console.log(`[findAndMigrateExistingUser] Located profile via email lookup under ID "${existingUserId}".`);
        }
      } catch (e) {
        console.warn('[findAndMigrateExistingUser] Email lookup failed:', e);
      }
    }

    // 7. Fallback to local cached user object if profile was created locally
    if (!foundDocData && cachedUser && cachedUser.username) {
      foundDocData = cachedUser;
      existingUserId = cachedUser.id || `user_cached_${Date.now()}`;
      console.log(`[findAndMigrateExistingUser] Restoring profile from local backup cache ("${cachedUser.username}").`);
    }

    // IF an existing account was found, verify it is NOT a soft-deleted tombstone
    if (foundDocData && (foundDocData.isDeleted || foundDocData.status === 'deleted')) {
      console.log(`[findAndMigrateExistingUser] Skipping soft-deleted tombstone profile for ID "${existingUserId}". Creating fresh new user account.`);
      foundDocData = null;
      existingUserId = null;
    }

    // IF an existing account was found, MIGRATE it to targetUid dynamically.
    //
    // Security fix (RLS-migration Phase 2, checkpoint 13): this used to run
    // the whole merge as a direct, unauthenticated client writeBatch --
    // set the merged profile under the new uid, delete the OLD row
    // entirely, repoint store_names, and cascade sellerId/buyerId across
    // products/chats -- all driven by nothing more than "existingUserId
    // came from a search above", with no server-side check that the
    // caller actually owned that other account. That's the single
    // highest-risk item flagged throughout this whole migration: a naive
    // authenticated version would still let an attacker delete or absorb
    // an arbitrary other user's account merely by getting existingUserId
    // to resolve to it, since nothing here cryptographically ties
    // existingUserId to the signed-in caller.
    //
    // Two real cases reach this block:
    //  - existingUserId !== targetUid (steps 2-6 above): a genuine
    //    cross-account merge. Routed to POST /api/users/merge-account,
    //    which independently re-verifies ownership server-side (the OLD
    //    account's stored email must match the caller's own Firebase-
    //    verified email) before writing anything -- see that endpoint for
    //    the full reasoning. If the server refuses (no match), this
    //    deliberately returns null rather than fabricating a local merge,
    //    so the caller falls back to creating a fresh account.
    //  - existingUserId === targetUid (only reachable via step 7's local-
    //    cache fallback, e.g. step 1's direct lookup failed while offline
    //    but the exact same uid's data is in local storage): not a
    //    cross-account merge at all, just persisting a self-owned cached
    //    copy -- routed to the already-migrated POST /api/users/sync.
    if (foundDocData) {
      const isGoogleUser = firebaseUser.providerData?.some((p: any) => p.providerId === 'google.com') || false;
      const mergedUser: User = {
        ...foundDocData,
        id: targetUid,
        email: rawEmail || foundDocData.email || undefined,
        emailVerified: firebaseUser.emailVerified || foundDocData.emailVerified || false,
        photoUrl: firebaseUser.photoURL || foundDocData.photoUrl || undefined,
        isGoogleAuth: isGoogleUser || foundDocData.isGoogleAuth,
        authProvider: isGoogleUser ? 'google.com' : (foundDocData.authProvider || undefined)
      };

      try {
        if (existingUserId && existingUserId !== targetUid) {
          const authHeaders = await getAuthHeader();
          const res = await fetch('/api/users/merge-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ oldUserId: existingUserId, photoUrl: firebaseUser.photoURL || undefined })
          });
          const json = await res.json().catch(() => ({}));
          if (json.success && json.user) {
            console.log(`[findAndMigrateExistingUser] Server-verified merge succeeded into UID: "${targetUid}"`);
            return json.user as User;
          }
          console.warn('[findAndMigrateExistingUser] Server-side merge refused or failed (old account email did not match verified email, or another error):', json.error);
          return null;
        }

        const authHeaders = await getAuthHeader();
        const syncRes = await fetch('/api/users/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ user: mergedUser })
        });
        const syncJson = await syncRes.json().catch(() => ({}));
        if (!syncJson.success) {
          throw new Error(syncJson.error || 'Failed to persist restored profile.');
        }
        console.log(`[findAndMigrateExistingUser] Restored cached profile persisted for UID: "${targetUid}"`);
      } catch (writeErr) {
        console.error('[findAndMigrateExistingUser] Error writing merged user doc:', writeErr);
      }

      return mergedUser;
    }

    return null;
  };

  // Firebase Auth state listener
  useEffect(() => {
    let active = true;
    let userSubUnsub: (() => void) | undefined;

    // Process redirect result if returning from a Google redirect flow (e.g., mobile browser redirect)
    getRedirectResult(auth).then((result) => {
      if (result?.user) {
        console.log('[Google Auth Redirect] Successfully processed redirect result for:', result.user.email);
        setSelectedSellerId(result.user.uid);
        setCurrentView('my-dashboard');
      }
    }).catch((err) => {
      console.warn('[Google Auth Redirect] Redirect result notification (non-blocking):', err);
    });

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!active) return;

      // Clean up previous real-time subscriber if any
      if (userSubUnsub) {
        userSubUnsub();
        userSubUnsub = undefined;
      }

      try {
        if (firebaseUser) {
          // Instant direct check on the legacy user database for suspension to block a suspended user immediately.
          // Security fix (RLS-migration Phase 2, checkpoint 14): this used
          // to be a direct, unauthenticated `getDoc(doc('users',
          // firebaseUser.uid))` -- same self-only read pattern as the
          // profile poll above, migrated to the same GET /api/users/get?id=.
          try {
            const authHeaders = await getAuthHeader();
            const res = await fetch(`/api/users/get?id=${encodeURIComponent(firebaseUser.uid)}`, { headers: authHeaders });
            const json = await res.json().catch(() => ({}));
            if (active && json.success && json.user) {
              const data = json.user as User;
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
            console.warn('[Security Auth Observer] legacy user database check failed (might be offline):', err);
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
          
          // Ensure username does not collide with existing user store names (ignoring current user's own ID)
          const finalUsernameLower = initialUsername.toLowerCase();
          const isTaken = usersRef.current.some(u => u.username && u.id !== firebaseUser.uid && u.username.trim().toLowerCase() === finalUsernameLower);
          if (isTaken) {
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
          
          // Check if an impersonation session is active
          const impSaved = safeLocalStorage.getItem('tedbuy_impersonation_session');
          let hasActiveImpersonation = false;
          if (impSaved) {
            try {
              const parsedImp = JSON.parse(impSaved);
              if (parsedImp && parsedImp.sessionId && new Date(parsedImp.expiresAt).getTime() > Date.now()) {
                hasActiveImpersonation = true;
              }
            } catch (_) {}
          }

          if (hasActiveImpersonation) {
            // Preserve admin user in originalAdminUser and don't overwrite current impersonated user state
            setOriginalAdminUser(tempUser);
            safeLocalStorage.setItem('tedbuy_original_admin_user', JSON.stringify(tempUser));
          } else {
            // Instantly prime the current user from our cached backup or fallback structure so UI opens instantly
            setCurrentUserState(prev => {
              if (prev && prev.id === firebaseUser.uid) {
                return prev; // Use cache
              }
              return tempUser; // Use template
            });
          }

          // Instantly hide any full screen loading blocking screen
          setIsAuthLoading(false);

          // Poll self-profile updates asynchronously so that changes are handled promptly.
          //
          // Security fix (RLS-migration Phase 2, checkpoint 14): this used
          // to be a direct, unauthenticated `onSnapshot(doc('users',
          // firebaseUser.uid), ...)` -- dbAdapter's generic read path has
          // no per-row ownership check, so the same anon key this
          // subscription used could subscribe to ANY user's row, not just
          // the signed-in one, since the id in the query was only ever
          // app-chosen, never enforced. Migrated to a poll of the existing,
          // already-public-by-design `GET /api/users/get?id=` (a single,
          // targeted lookup -- see that endpoint's own history at
          // checkpoint 1 -- reached here only for the caller's own uid),
          // matching the notifications migration's realtime-push-to-poll
          // precedent (audit doc §18.5). 5s cadence: this is the primary
          // signal for suspension/verification-status changes, which the
          // pre-existing code explicitly wants to catch "instantly" (see
          // the suspension check below), so it's polled faster than a
          // typical background poll -- close to real-time without an open
          // subscription.
          //
          // Wrapped in a small Firestore-doc-shaped object (`exists()`/
          // `data()`/`id`) matching what `onSnapshot` used to hand the
          // callback below, so the large, carefully-tested body of that
          // callback (suspension handling, emailVerified/isGoogleAuth
          // upgrade sync, account-migration/new-user creation) needed no
          // changes at all -- only the trigger mechanism changed.
          let pollActive = true;
          const pollSelfProfile = async () => {
            if (!pollActive || !active) return;
            let userDoc: { exists: () => boolean; data: () => User; id: string };
            try {
              const authHeaders = await getAuthHeader();
              const res = await fetch(`/api/users/get?id=${encodeURIComponent(firebaseUser.uid)}`, { headers: authHeaders });
              const json = await res.json().catch(() => ({}));
              const found = !!(json.success && json.user);
              userDoc = { exists: () => found, data: () => json.user as User, id: firebaseUser.uid };
            } catch (error) {
              console.error('[User Doc Stream] Poll error:', error);
              return;
            }
            if (!active) return;

            if (userDoc.exists()) {
              const dbData = userDoc.data() as User;
              const actualUserId = dbData.id || userDoc.id || firebaseUser.uid;
              if (actualUserId) {
                setSelectedSellerId(actualUserId);
              }
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
                // Security fix (RLS-migration Phase 1, checkpoint 9): this
                // used to be a direct, unauthenticated `updateDoc` --
                // dbAdapter's generic write path has no per-row ownership
                // check. This always targets the currently-authenticated
                // user's own row (userRef = doc('users', firebaseUser.uid),
                // a real Firebase session by definition here), so migrated
                // to POST /api/users/sync -- sending the full merged
                // profile (dbData + these updates), since that endpoint
                // rebuilds the row from whatever's in the request body
                // rather than patching it.
                try {
                  const authHeaders = await getAuthHeader();
                  const syncRes = await fetch('/api/users/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...authHeaders },
                    body: JSON.stringify({ user: { ...dbData, ...updates, id: actualUserId } })
                  });
                  const syncJson = await syncRes.json().catch(() => ({}));
                  if (!syncJson.success) {
                    console.warn('Could not sync auth metadata to the database:', syncJson.error);
                  }
                } catch (err) {
                  console.warn('Could not sync auth metadata to the database (offline/sandbox):', err);
                }
              }

              const mergedUserData = { ...dbData, ...updates, id: actualUserId };

              // Check if impersonation session is active
              const activeImp = safeLocalStorage.getItem('tedbuy_impersonation_session');
              let isStillImpersonating = false;
              if (activeImp) {
                try {
                  const pImp = JSON.parse(activeImp);
                  if (pImp && pImp.sessionId && new Date(pImp.expiresAt).getTime() > Date.now()) {
                    isStillImpersonating = true;
                  }
                } catch (_) {}
              }

              if (isStillImpersonating) {
                setOriginalAdminUser(mergedUserData);
                safeLocalStorage.setItem('tedbuy_original_admin_user', JSON.stringify(mergedUserData));
              } else {
                setCurrentUserState(mergedUserData);
              }
            } else {
              // Document does NOT exist under target UID. First perform deep search to find & migrate existing account
              const existingUser = await findAndMigrateExistingUser(firebaseUser);
              if (existingUser) {
                if (active) {
                  setCurrentUserState(existingUser);
                  setSelectedSellerId(firebaseUser.uid);
                  safeLocalStorage.setItem('tedbuy_local_current_user_backup', JSON.stringify(existingUser));
                  showToast("Welcome back! Your account profile was loaded successfully. 🎉", "success");
                }
                return;
              }

              // If registration is actively in progress in this thread, let registerUser finish.
              if (justRegisteredUserIds.current.has(firebaseUser.uid)) {
                console.log(`[onAuthStateChanged] Registration currently in progress for UID: "${firebaseUser.uid}". Postponing.`);
                return;
              }

              // Truly a brand new sign-up where NO profile or storeName exists anywhere
              justRegisteredUserIds.current.add(firebaseUser.uid);

              const newUser: User = {
                id: firebaseUser.uid,
                username: initialUsername,
                email: firebaseUser.email || undefined,
                role: 'both',
                joinDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
                photoUrl: firebaseUser.photoURL || undefined,
                followingSellers: [],
                savedProductIds: [],
                emailVerified: true,
                isAdmin: isSuperAdmin ? true : undefined,
                isGoogleAuth: true,
                authProvider: 'google.com'
              };
              
              const storeNameLower = initialUsername.trim().toLowerCase().replace(/[^\w-]/g, '_');
              let uniqueStoreNameLower = storeNameLower || `user_${Date.now()}`;
              let uniqueUsername = initialUsername.trim();
              try {
                const checkRef = doc('storeNames', storeNameLower);
                const checkSnap = await getDoc(checkRef);
                if (checkSnap && typeof checkSnap.exists === 'function' && checkSnap.exists()) {
                  let isTaken = true;
                  while (isTaken) {
                    const suffix = Math.floor(100 + Math.random() * 900);
                    uniqueUsername = `${initialUsername.trim()} ${suffix}`;
                    uniqueStoreNameLower = `${storeNameLower}_${suffix}`;
                    const suffixSnap = await getDoc(doc('storeNames', uniqueStoreNameLower));
                    isTaken = suffixSnap && typeof suffixSnap.exists === 'function' && suffixSnap.exists();
                  }
                }
              } catch (checkErr) {
                console.warn('Could not verify storeName uniqueness, proceeding with fallback:', checkErr);
              }

              newUser.username = uniqueUsername;

              // Security fix (RLS-migration Phase 1, checkpoint 9): this
              // used to be a direct, unauthenticated writeBatch --
              // dbAdapter's generic write path has no per-row ownership
              // check, so a raw Supabase caller could write to ANY user's
              // row and claim ANY username's store_names reservation, not
              // just their own. Unlike registerUser's sandbox-fallback
              // branch, Google Sign-In always produces a real, genuine
              // Firebase Auth session (there is no equivalent "auth
              // disabled" degraded mode for it), so this always has a real
              // identity to verify -- migrated to POST /api/users/sync,
              // which already handles both the users upsert AND the
              // store_names reservation server-side in one call (confirmed
              // at checkpoint 7).
              try {
                const authHeaders = await getAuthHeader();
                const syncRes = await fetch('/api/users/sync', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...authHeaders },
                  body: JSON.stringify({ user: newUser })
                });
                const syncJson = await syncRes.json().catch(() => ({}));
                if (!syncJson.success) {
                  throw new Error(syncJson.error || 'Failed to persist Google sign-up profile.');
                }
                console.log(`[Google Signup] Server-authoritative profile sync succeeded, store name reserved: "${uniqueStoreNameLower}"`);
              } catch (batchErr) {
                console.warn('[Google Signup] Server-authoritative profile sync warning (user account created locally):', batchErr);
              }

              if (active) {
                justRegisteredUserIds.current.add(firebaseUser.uid);
                setCurrentUserState(newUser);
                setSelectedSellerId(firebaseUser.uid);
                safeLocalStorage.setItem('tedbuy_local_current_user_backup', JSON.stringify(newUser));
                setupWelcomePackage(newUser).catch(err => {
                  console.warn('[Welcome Trigger] Direct welcome setup call failed from auth state change:', err);
                });
              }
            }
          };

          pollSelfProfile();
          const userPollInterval = setInterval(pollSelfProfile, 5000);
          userSubUnsub = () => {
            pollActive = false;
            clearInterval(userPollInterval);
          };
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

    // 2. Proactive database lookup to prevent stale cache bypass.
    // Security fix (RLS-migration Phase 2, checkpoint 14): same self-only
    // read pattern as the two sites above, migrated to the same
    // GET /api/users/get?id=.
    const verifyUserSuspensionInDatabase = async () => {
      try {
        const authHeaders = await getAuthHeader();
        const res = await fetch(`/api/users/get?id=${encodeURIComponent(currentUser.id)}`, { headers: authHeaders });
        const json = await res.json().catch(() => ({}));
        if (!active) return;

        if (json.success && json.user) {
          const dbData = json.user as User;
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
  }, [currentUser, isAuthLoading, auth]);

  const currentUserId = currentUser?.id;

  // Notification security migration (see
  // .ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md §18): this used to be a
  // live Supabase Realtime subscription (`onSnapshot` on a `where('userId',
  // '==', currentUserId)` query) -- real-time, but going through the same
  // anon-key client every other direct-Supabase read in this app uses, with
  // no server-side identity verification that the query's own `userId`
  // filter actually matches who's asking (a crafted direct query could ask
  // for someone else's notifications). Replaced with a poll of the already-
  // existing, verifyUser()-gated GET /api/notifications (mobile already
  // used this exact endpoint) -- the server derives the recipient from the
  // authenticated token, not a client-supplied filter, so there's no way to
  // read anyone's notifications but your own. Trades real-time push for a
  // 20s poll -- not instant, but consistent with this app's existing
  // near-real-time UX elsewhere (chat/message polling), and the accepted
  // cost of closing a real read-side privacy gap.
  useEffect(() => {
    if (!currentUserId) {
      setNotifications([]);
      return;
    }

    let active = true;
    let previousIds = new Set<string>(notifications.map(n => n.id));
    let isInitial = true;

    const poll = async () => {
      try {
        const authHeaders = await getAuthHeader();
        const res = await fetch('/api/notifications', { headers: authHeaders });
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to fetch notifications');

        const list: AppNotification[] = Array.isArray(data.notifications) ? data.notifications : [];
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        try {
          safeLocalStorage.setItem(`tedbuy_notifications_backup_${currentUserId}`, JSON.stringify(list));
        } catch (err) {}

        setNotifications(list);

        if (!isInitial) {
          list.forEach(notif => {
            if (!previousIds.has(notif.id) && !notif.read) {
              if (notif.type === 'new_follower') {
                showToast(`🎉 ${notif.message}`, 'success');
              } else if (notif.type === 'post_created' || notif.type === 'followed_seller_new_listing') {
                showToast(`📢 ${notif.message}`, 'info');
              }
            }
          });
        }
        previousIds = new Set(list.map(n => n.id));
        isInitial = false;
      } catch (error: any) {
        console.warn('Notifications poll notice (using local backup):', error?.message || error);
        try {
          const localBackupKey = `tedbuy_notifications_backup_${currentUserId}`;
          const stored = safeLocalStorage.getItem(localBackupKey);
          const list: AppNotification[] = stored ? JSON.parse(stored) : [];
          if (active) setNotifications(list);
        } catch (err) {
          console.warn('Could not read local backup notifications storage:', err);
        }
      }
    };

    poll();
    const intervalId = setInterval(poll, 20000);
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [currentUserId]);

  // --- FCM Real-time Device Token Registration ---
  useEffect(() => {
    if (!currentUser) return;
    
    let isMounted = true;
    const registerToken = async () => {
      try {
        const token = await requestFcmToken();
        if (token && isMounted) {
          console.log('[FCM] Successfully fetched cloud messaging device registration token:', `${token.slice(0, 12)}...`);
          
          const existingTokens = currentUser.fcmTokens || [];
          if (!existingTokens.includes(token)) {
            const updatedTokens = [...existingTokens, token].slice(-5);

            setCurrentUserState({
              ...currentUser,
              fcmTokens: updatedTokens
            });

            // RLS-migration Phase 1: the direct `updateDoc(doc('users', ...),
            // { fcmTokens })` persist that used to sit here was removed --
            // 'fcmTokens' has never been in dbAdapter.ts's TABLE_COLUMNS
            // allow-list, so this write has been a pure no-op the entire
            // time (filterTableColumns strips it to an empty payload, and
            // updateDoc returns early rather than ever calling Supabase --
            // confirmed by reading that exact code path, not assumed).
            // fcmTokens is also never read anywhere else in the codebase
            // (client or server) beyond this dead persist attempt, so
            // nothing downstream depended on it succeeding. The token
            // fetch above this block is left untouched -- it has a real,
            // independent side effect (triggering the browser's native
            // push-notification permission prompt) unrelated to whether
            // the token itself ever gets stored.
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
        
        // Dynamically increment visitCount in the database and state, tracking login & seen
        // RLS-migration Phase 1: the direct-write persists that used to sit
        // here (visitCount/lastLogin/lastSeen/isOnline) were removed --
        // none of these fields has ever been in dbAdapter.ts's
        // TABLE_COLUMNS allow-list, so these writes have been pure no-ops
        // the entire time (confirmed by reading updateDoc's own
        // filterTableColumns -> empty-payload -> early-return path, not
        // assumed). The local state update below is left as-is: it's a
        // real, if session-scoped-only, user-visible counter (see
        // SellerDashboard.tsx's "visits" display) -- pending a decision on
        // whether to actually build real server-side tracking for it.
        const originalVisits = currentUser.visitCount || 0;
        const newVisits = originalVisits + 1;

        setCurrentUserState(prev => prev ? {
          ...prev,
          visitCount: newVisits,
          lastLogin: nowIso,
          lastSeen: nowIso,
          isOnline: true
        } : null);
      } else {
        // Just make sure user is marked online and update lastSeen locally
        // (see the no-op removal note above -- same reasoning applies here)
        setCurrentUserState(prev => prev ? {
          ...prev,
          lastSeen: nowIso,
          isOnline: true
        } : null);
      }
    }
  }, [currentUserId]);

  // Online presence — WhatsApp-style: a signed-in user is "online" as long
  // as the server has heard from them recently (server.ts's
  // computeIsOnline, currently a 90s threshold). This used to only update
  // local React state (setCurrentUserState below) and never actually
  // reached the server at all -- 'lastSeen'/'isOnline' were never in
  // dbAdapter.ts's write allow-list from the RLS migration, so every write
  // here was a pure no-op the entire time, confirmed by reading that
  // allow-list directly, not assumed. POST /api/users/heartbeat (added
  // alongside mobile's equivalent in App.tsx) is the real write path now.
  const sendPresenceHeartbeat = useCallback(async () => {
    if (!currentUser) return;
    try {
      // Deliberately strips any impersonation header, even mid-active
      // impersonation -- getAuthHeader() auto-attaches
      // x-impersonation-session-id from localStorage for every other call
      // (intentional there: an impersonated action should act AS the
      // impersonated user), and server.ts's verifyUser() honors it by
      // resolving the caller to session.targetUserId instead of the real
      // admin's own uid. Left un-stripped here, every heartbeat sent while
      // an admin had (even briefly, even long since forgotten) an active
      // impersonation session open would silently record presence under
      // the IMPERSONATED seller's account, not the admin's real one --
      // making a genuinely inactive seller falsely show as online for as
      // long as that browser tab kept polling. Presence must always
      // reflect who is REALLY at this device right now.
      const authHeaders = await getAuthHeader();
      delete authHeaders['x-impersonation-session-id'];
      await fetch('/api/users/heartbeat', { method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' } });
    } catch (err) {
      // Best-effort, cosmetic feature -- a missed beat just means this
      // user shows offline a little sooner than they actually went offline.
    }
    setCurrentUserState(prev => (prev ? { ...prev, lastSeen: new Date().toISOString(), isOnline: true } : null));
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser) return;

    sendPresenceHeartbeat();
    const interval = setInterval(() => {
      // Skip the write while backgrounded — a hidden tab doesn't need to keep
      // announcing presence, and this write is what drives the users-table
      // refresh cadence above, so a quieter heartbeat matters for egress too.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      sendPresenceHeartbeat();
    }, 60000);

    const onVisible = () => {
      if (document.visibilityState === 'visible') sendPresenceHeartbeat();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [currentUser?.id, sendPresenceHeartbeat]);

  // Notification security migration (see
  // .ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md §18): these three used to
  // write directly via dbAdapter with no ownership check at all -- any
  // notification id could be marked-read or deleted regardless of whose
  // it actually was. POST /api/notifications/mark-read,
  // /mark-all-read, and /clear-all already existed (mobile already used
  // them) and each scopes its database mutation to `.eq('userId',
  // verified.uid)` server-side -- a real, cryptographic ownership
  // guarantee, not just a client-side convention.
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
      const authHeaders = await getAuthHeader();
      const res = await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ id }),
      });
      // Re-apply the read transform on top of whatever the CURRENT state is,
      // once the server has actually confirmed the write. Same race shape
      // already fixed for sendMessage above: the independent 20s
      // notification poll does an unconditional setNotifications(list) --
      // if its GET was already in flight when this mark-read started, it
      // can resolve afterward with a pre-mark-read snapshot and silently
      // revert the optimistic update, flipping the bell badge back to
      // unread until the next poll tick (up to 20s later). This closes
      // that window instead of leaving it to self-correct.
      if (res.ok) {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      }
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
      const authHeaders = await getAuthHeader();
      const res = await fetch('/api/notifications/mark-all-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
      });
      // See markNotificationAsRead's comment above -- same reconciliation,
      // same reason (closes the race with the independent 20s poll).
      if (res.ok) {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      }
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
      const authHeaders = await getAuthHeader();
      await fetch('/api/notifications/clear-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
      });
    } catch (err) {
      console.warn('Backend clearAllNotifications skip (synchronized locally):', err);
    }
  };

  // 1. Users Synchronization from the legacy user database.
  // Deliberately polled, NOT a realtime table listener: subscribing to the whole
  // `users` collection means every single presence heartbeat (any user, anywhere)
  // re-downloads the entire table to every connected client (O(users^2) egress).
  // A periodic pull keeps names/photos/online-status fresh enough for a
  // marketplace without that blowup.
  //
  // Security fix (RLS-migration Phase 0, checkpoint 1): this used to be a
  // direct, fully unauthenticated `getDocs(collection(null, 'users'))` -- a
  // `select('*')` against the entire users table, no auth, no column
  // restriction. That returned every user's email/phoneNumber/
  // whatsAppNumber/isAdmin/isSuspended/securityHold to any anonymous
  // browser, for every user, in one request. GET /api/users/list already
  // existed (built for mobile's equivalent feature) and was already
  // PII-safe -- it deliberately omits contact info specifically because it
  // returns everyone in one response; web had simply never been switched
  // to it. This `users` state now only ever carries the safe fields that
  // endpoint returns; the two features that legitimately need a specific
  // user's contact info now fetch that one user's full profile directly
  // instead (see SellerProfilePage.tsx's seller-contact lookup, and
  // sendWelcomeEmailToAll's own admin-gated bulk fetch below) -- see
  // .ai/handoffs/SUPABASE_RLS_MIGRATION_PLAN.md §0.
  useEffect(() => {
    let active = true;

    const fetchUsersOnce = async () => {
      try {
        const res = await fetch('/api/users/list');
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!json.success || !Array.isArray(json.users)) {
          console.warn('[Users Sync] /api/users/list did not return a user list:', json?.error);
          return;
        }
        const uList: User[] = json.users;
        setUsers(uList);
        try {
          safeLocalStorage.setItem('tedbuy_local_users_backup', JSON.stringify(uList));
        } catch (_) {}
      } catch (err) {
        console.warn('[Users Sync] /api/users/list fetch error:', err);
      }
    };

    fetchUsersOnce();

    const interval = setInterval(fetchUsersOnce, 3 * 60 * 1000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchUsersOnce();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // 2. Real-time Products Synchronization
  useEffect(() => {
    let active = true;

    const processProductList = (rawList: Product[]) => {
      const map = new Map<string, Product>();

      rawList.forEach((item: any) => {
        if (!optimisticDeletedProductIdsRef.current.has(item.id) && isRealProduct(item)) {
          map.set(item.id, normalizeProduct(item));
        }
      });

      const pList = Array.from(map.values());
      return pList.sort((a, b) => {
        const dateA = typeof a?.createdAt === 'string' ? a.createdAt : '';
        const dateB = typeof b?.createdAt === 'string' ? b.createdAt : '';
        return dateB.localeCompare(dateA);
      });
    };

    // 1. Instantly populate from SSR injected data if available (0ms load)
    const injected = (window as any).__INITIAL_PRODUCTS__;
    let initialPopulated = false;

    if (Array.isArray(injected) && injected.length > 0) {
      try {
        const sorted = processProductList(injected as Product[]);
        if (sorted.length > 0) {
          setProducts(sorted);
          setIsProductsLoading(false);
          setProductsLoadError(false);
          initialPopulated = true;
        }
      } catch (_) {}
      try { delete (window as any).__INITIAL_PRODUCTS__; } catch (_) {}
    }

    // 2. Instantly populate from local storage backup cache if available for 0ms initial load
    if (!initialPopulated) {
      try {
        const storedCache = safeLocalStorage.getItem('tedbuy_local_products_backup');
        if (storedCache) {
          const parsed = JSON.parse(storedCache);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const cachedSorted = processProductList(parsed);
            if (cachedSorted.length > 0) {
              setProducts(cachedSorted);
              setIsProductsLoading(false);
            }
          }
        }
      } catch (_) {}
    }

    const fetchProductsOnce = async (retryCount = 0) => {
      try {
        currentProductPageRef.current = 1;
        const res = await fetch('/api/products?page=1&limit=24');
        if (!res.ok) {
          throw new Error(`/api/products returned status ${res.status}`);
        }
        const data = await res.json();
        if (!active) return;
        if (!data || !Array.isArray(data.products)) {
          throw new Error('Malformed /api/products response');
        }

        const sorted = processProductList(data.products as Product[]);
        
        setProducts(sorted);
        setIsProductsLoading(false);
        setProductsLoadError(false);

        // In All Categories view, lock pagination so no further products are fetched on scroll
        setHasMoreProducts(false);

        try {
          safeLocalStorage.setItem('tedbuy_local_products_backup', JSON.stringify(sorted));
        } catch (_) {}
      } catch (error) {
        if (!active) return;
        console.warn(`[Product Loading] /api/products fetch attempt ${retryCount + 1} failed:`, error);
        
        if (retryCount < 2) {
          setTimeout(() => {
            if (active) fetchProductsOnce(retryCount + 1);
          }, 1000);
          return;
        }

        setIsProductsLoading(false);
        setProducts(prev => {
          if (prev && prev.length > 0) {
            setProductsLoadError(false);
            return prev;
          }
          setProductsLoadError(true);
          return [];
        });
      }
    };

    fetchProductsOnce();

    return () => {
      active = false;
    };
  }, []);

  // Live server search & category sync effect: Ensures all posted listings under a category or search query appear on demand
  useEffect(() => {
    const hasSearchTerm = Boolean(debouncedSearchQuery && debouncedSearchQuery.trim().length > 0);
    const hasCategoryFilter = Boolean(selectedCategory !== null && (selectedCategory as string) !== 'All');

    if (!hasSearchTerm && !hasCategoryFilter) {
      setHasMoreProducts(false);
      return;
    }

    let active = true;

    const syncServerSearchResults = async () => {
      try {
        setIsProductsLoading(true);
        currentProductPageRef.current = 1;
        let url = '/api/products?page=1&limit=1000';
        if (hasSearchTerm) {
          url += `&q=${encodeURIComponent(debouncedSearchQuery.trim())}`;
        }
        if (hasCategoryFilter && selectedCategory) {
          url += `&category=${encodeURIComponent(selectedCategory)}`;
        }

        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;

        if (data && Array.isArray(data.products)) {
          const incoming = (data.products as Product[]).filter(isRealProduct).map(normalizeProduct);
          setProducts(prev => {
            const existingMap = new Map<string, Product>();
            prev.forEach(p => {
              if (p && p.id && !optimisticDeletedProductIdsRef.current.has(p.id)) {
                existingMap.set(String(p.id), p);
              }
            });
            incoming.forEach(item => {
              if (item && item.id && !optimisticDeletedProductIdsRef.current.has(item.id)) {
                existingMap.set(String(item.id), item);
              }
            });
            const mergedList = Array.from(existingMap.values());
            return mergedList.sort((a, b) => {
              const dateA = typeof a?.createdAt === 'string' ? a.createdAt : '';
              const dateB = typeof b?.createdAt === 'string' ? b.createdAt : '';
              return dateB.localeCompare(dateA);
            });
          });
          setProductsLoadError(false);
          const moreAvailable = typeof data.hasMore === 'boolean'
            ? data.hasMore
            : (data.page < data.totalPages && incoming.length > 0);
          setHasMoreProducts(moreAvailable);
        }
      } catch (err) {
        console.warn('[AppContext Search Sync Error]:', err);
      } finally {
        if (active) setIsProductsLoading(false);
      }
    };

    syncServerSearchResults();

    return () => {
      active = false;
    };
  }, [debouncedSearchQuery, selectedCategory]);

  // Load all user and marketplace listings when opening dashboard or seller profile
  useEffect(() => {
    if (currentView !== 'my-dashboard' && currentView !== 'seller-profile') return;
    let active = true;
    const fetchDashboardProducts = async () => {
      try {
        const targetSeller = currentView === 'seller-profile' ? (selectedSellerId || currentUser?.id) : currentUser?.id;
        const url = currentUser?.isAdmin
          ? '/api/products?page=1&limit=1000&nocache=true'
          : targetSeller
            ? `/api/products?sellerId=${encodeURIComponent(targetSeller)}&limit=1000&nocache=true`
            : '/api/products?page=1&limit=1000&nocache=true';

        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (!active || !data || !Array.isArray(data.products)) return;
        const rawProds = (data.products as Product[]).filter(isRealProduct).map(normalizeProduct);
        if (rawProds.length > 0) {
          setProducts(prev => {
            const map = new Map<string, Product>();
            prev.forEach(p => { if (p && p.id) map.set(String(p.id), p); });
            rawProds.forEach(p => { if (p && p.id) map.set(String(p.id), p); });
            return Array.from(map.values()).sort((a, b) => {
              const dateA = typeof a?.createdAt === 'string' ? a.createdAt : '';
              const dateB = typeof b?.createdAt === 'string' ? b.createdAt : '';
              return dateB.localeCompare(dateA);
            });
          });
        }
      } catch (err) {
        console.warn('[AppContext] Failed to load dashboard or seller products:', err);
      }
    };
    fetchDashboardProducts();
    return () => { active = false; };
  }, [currentView, selectedSellerId, currentUser?.id, currentUser?.isAdmin]);

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

    // Security fix (RLS-migration Phase 1, checkpoint 19): steps 1-4 (CEO
    // support profile upsert, support chat creation, welcome message
    // creation, welcomeSent flag) used to be four direct, unauthenticated
    // dbAdapter writes here. Earlier passes assessed this as low-urgency
    // because every value THIS call site sends is a hardcoded constant or
    // the caller's own session data -- but dbAdapter's generic write path
    // has no per-row ownership check at all, so a caller bypassing this
    // app's own JS could reach the exact same writes with DIFFERENT
    // values: overwriting the well-known `user_ted_ceo_support` account's
    // email/photoUrl (an impersonation vector for TedBuy's own support
    // identity), or creating a chat/message that impersonates TedBuy
    // Support in an arbitrary OTHER victim's inbox. Replaced with one
    // authenticated call to POST /api/welcome/setup, which performs all
    // four steps server-side with every identity value derived from the
    // verified caller, never the request body.
    try {
      const authHeaders = await getAuthHeader();
      const setupRes = await fetch('/api/welcome/setup', {
        method: 'POST',
        headers: authHeaders
      });
      const setupJson = await setupRes.json().catch(() => ({}));
      if (!setupJson.success) {
        console.warn('[Welcome Trigger] Server-side welcome package setup reported failure (continuing to email step):', setupJson.error);
      } else {
        console.log('[Welcome Trigger] Server-authoritative welcome package setup succeeded.');
      }
    } catch (setupErr) {
      console.warn('[Welcome Trigger] Welcome package setup request failed (continuing to email step):', setupErr);
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
          
          setProducts(prevProducts => {
            const index = prevProducts.findIndex(p => p.id === selectedProductId);
            if (index === -1) {
              return [fullProduct, ...prevProducts];
            }
            const updated = [...prevProducts];
            updated[index] = {
              ...updated[index],
              ...fullProduct,
              // Ensure we use the full images array fetched from backend
              images: Array.isArray(fullProduct.images) && fullProduct.images.length > 0 
                ? fullProduct.images 
                : updated[index].images
            };
            return updated;
          });
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

  // 3. Reviews Synchronization (Optimized to Fetch Once on Mount).
  //
  // Security fix (RLS-migration Phase 2, checkpoint 21 -- the last item
  // open in this whole migration): this used to be a direct,
  // unauthenticated `getDocs(collection('reviews'))` bulk read -- left
  // open longer than everything else specifically because `GET /api/reviews`
  // required a `sellerId` and couldn't serve this global-state use case.
  // That endpoint now accepts an optional `sellerId` (server.ts, same
  // commit) and returns everything, ordered, when it's omitted. Reviews
  // carry no PII (id/sellerId/buyerId/buyerName/rating/comment/createdAt/
  // productTitle) and are already treated as public content elsewhere in
  // the app, so serving them unscoped closes this the same way every
  // other bulk-read finding in this migration was closed, without
  // changing what any consumer of the shared `reviews` state sees.
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/reviews');
        const json = await res.json().catch(() => ({}));
        if (!json.success || !Array.isArray(json.reviews)) {
          throw new Error(json.error || 'Failed to load reviews');
        }
        const sorted = (json.reviews as Review[]);
        setReviews(sorted);
        try {
          safeLocalStorage.setItem('tedbuy_local_reviews_backup', JSON.stringify(sorted));
        } catch (err) {
          console.warn('Could not save reviews backup:', err);
        }
      } catch (error: any) {
        handleBackendError(error, OperationType.LIST, 'reviews');
      }
    }, 300); // Defer to prioritize products and authentication paint
    return () => {
      clearTimeout(timer);
    };
  }, []);

  // 4. Chat list synchronization — authenticated polling of GET /api/chats.
  // This replaced a pair of direct Firestore/Supabase onSnapshot listeners
  // that had zero server-side authorization once Supabase was active
  // client-side (any caller holding the anon key could read any user's
  // chats, since RLS is disabled on that table). The server verifies the
  // Firebase ID token and returns only chats where the caller is buyer or
  // seller, with an authoritative per-chat unreadCount — see mobile's
  // identical migration in mobile/src/screens/ChatsScreen.tsx.
  useEffect(() => {
    if (!currentUserId) {
      console.log('[Chats Sync] No current user found. Clearing chats state.');
      setChats([]);
      return;
    }

    console.log(`[Chats Sync] Polling chat list via API for user: ${currentUserId}`);
    let active = true;
    // Guards against overlapping in-flight polls, not just unmount -- if a
    // poll is slow and resolves after a later poll (already in flight when
    // the slow one was still pending) has already resolved, the slow one's
    // stale chat list would otherwise silently win via setChats below,
    // reverting a chat's last-message preview/unread count to stale data
    // for up to one more poll cycle.
    let requestId = 0;

    const load = async () => {
      const thisRequestId = ++requestId;
      const apiChats = (await fetchChatsFromApi()).map((c: any) => normalizeChat(c)) as Chat[];
      if (!active || thisRequestId !== requestId) return;
      setChats(prev => {
        // Preserve any admin-only TedBuy Support chat merged in by the
        // effect below — the API never returns it (see that effect's
        // comment for why), so a plain overwrite would drop it every tick.
        const supportChats = prev.filter(c => c.sellerId === 'user_ted_ceo_support' || c.buyerId === 'user_ted_ceo_support');
        const merged = [...apiChats, ...supportChats.filter(sc => !apiChats.some(ac => ac.id === sc.id))];
        merged.sort((a, b) => {
          const timeA = typeof a?.lastMessageTime === 'string' ? a.lastMessageTime : '';
          const timeB = typeof b?.lastMessageTime === 'string' ? b.lastMessageTime : '';
          return timeB.localeCompare(timeA);
        });
        try {
          safeLocalStorage.setItem('tedbuy_local_chats_backup', JSON.stringify(merged));
          safeLocalStorage.setItem(`tedbuy_local_chats_backup_${currentUserId}`, JSON.stringify(merged));
        } catch (err) {
          console.warn('Could not save chats backup:', err);
        }
        return merged;
      });
    };
    load();
    const interval = setInterval(load, 15000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [currentUserId]);

  // 4b. Admin-only: TedBuy Support inbox (sellerId === 'user_ted_ceo_support').
  //
  // Security fix (RLS-migration Phase 2, checkpoint 12): this used to be a
  // direct `onSnapshot(query(collection(null,'chats'),
  // where('sellerId','==','user_ted_ceo_support')))` -- flagged by its own
  // prior comment as a known gap: with RLS disabled and no per-row
  // ownership check on the generic dbAdapter path, the same anon key this
  // subscription used could just as easily query with no filter at all and
  // read the entire chats table, admin-gate or not, since the filter was
  // only ever app-chosen, never enforced. Migrated to
  // GET /api/admin/support/chats (new, real `verifyAdmin()`-gated
  // endpoint), polled every 20s -- matching the notifications migration's
  // own precedent of trading realtime push for a poll (audit doc §18.5); a
  // support inbox doesn't need live push the way an open conversation does.
  useEffect(() => {
    const isAdminUser = (currentUser?.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com' || currentUser?.isAdmin) && isAdminSessionVerified;
    if (!isAdminUser) return;

    let active = true;
    const pollSupportChats = async () => {
      try {
        const authHeaders = await getAuthHeader();
        const res = await fetch('/api/admin/support/chats', { headers: authHeaders });
        const json = await res.json().catch(() => ({}));
        if (!active || !json.success || !Array.isArray(json.chats)) return;
        const supportChats: Chat[] = json.chats.map((data: any) => normalizeChat(data) as Chat);
        setChats(prev => {
          const map = new Map(prev.map(c => [c.id, c]));
          supportChats.forEach(c => map.set(c.id, c));
          return Array.from(map.values());
        });
      } catch (error) {
        handleBackendError(error, OperationType.LIST, 'chats');
      }
    };

    pollSupportChats();
    const interval = setInterval(pollSupportChats, 20000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [currentUser?.email, currentUser?.isAdmin, isAdminSessionVerified]);

  // 5. Active chat thread — polls GET /api/messages/:chatId (paginated,
  // oldest-to-newest) for the chat currently open. `messages` state now
  // represents only this one thread rather than every message the user has
  // ever sent/received across all chats — that bulk cross-chat sync was a
  // much larger direct-read surface than any UI actually needed, now that
  // unread counts come from chat.unreadCount instead (see
  // utils/chatStateUtils.ts's getUnreadChatCount).
  useEffect(() => {
    msgMapRef.current.clear();

    if (!activeChatId) {
      setMessages([]);
      return;
    }

    // Security fix (RLS-migration Phase 2, checkpoint 12): the CEO-support
    // pseudo-account thread used to get a special-cased direct
    // `onSnapshot`/`getDocs` realtime subscription here (both for the
    // admin viewing the support inbox AND for a regular end-user viewing
    // their own welcome/support chat -- this branch wasn't admin-only,
    // since `isSupportChat` is true for either side of that specific
    // conversation). Now unnecessary: GET /api/messages/:chatId (which
    // `fetchMessagesFromApi` below already calls for every other chat) was
    // extended in this same commit with the same admin-as-support-desk
    // fallback already used by /api/messages/send and mark-read, so it now
    // correctly serves both the normal-participant case (a real end-user
    // reading their own chat) and the admin-fallback case through one
    // unified, already-authenticated path -- no special branch needed.

    let active = true;
    // Same overlapping-poll guard already applied to the chat-list poll
    // (and to mobile's equivalent message poll, ChatsScreen.tsx) -- without
    // it, a slow tick resolving after a later, faster tick already landed
    // could revert the open thread to a stale message list (a just-arrived
    // message disappearing until the next poll cycle corrects it).
    let requestId = 0;
    const load = async () => {
      const thisRequestId = ++requestId;
      try {
        const result = await fetchMessagesFromApi(activeChatId) as Message[];
        if (!active || thisRequestId !== requestId) return;
        setMessages(prevMessages => {
          if (result.length > prevMessages.length) {
            const lastMsg = result[result.length - 1];
            if (lastMsg && lastMsg.senderId !== currentUser?.id) {
              playMessageChime();
            }
          }
          return result;
        });
      } catch (err) {
        // A failed poll leaves whatever messages are already on screen
        // exactly as they were, matching mobile's own equivalent fix --
        // an unhandled rejection here previously had no fallback at all.
      }
    };
    load();
    const interval = setInterval(load, 4000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [activeChatId, currentUser?.id]);

  // User Authentication Action APIs
  const registerUser = async (username: string, email?: string, phoneNumber?: string, password?: string, photoUrl?: string) => {
    if (isReservedStoreName(username)) {
      throw new Error('This store name is reserved by TedBuy.');
    }
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
      // Tracks which branch below actually ran -- the real Firebase branch
      // has a genuine, verifiable identity by the time persistence happens
      // (Firebase Auth signs the new user in automatically on successful
      // createUserWithEmailAndPassword); the sandbox-fallback branch
      // (engaged only when the Firebase project's email/password provider
      // is disabled) has no real Firebase identity at all -- there is
      // nothing to verify server-side, so it can never be migrated onto an
      // authenticated endpoint the way the real branch can. See the
      // persistence step below for how this is used.
      let isLocalSandboxFallback = false;

      try {
        const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        uid = userCredential.user.uid;
        // Instantly mark as registered to prevent race conditions with auth listener
        justRegisteredUserIds.current.add(uid);

        newUser = {
          id: uid,
          username: username.trim(),
          email: cleanEmail,
          phoneNumber: phoneNumber || undefined,
          role: 'both',
          joinDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          photoUrl: photoUrl || undefined,
          followingSellers: [],
          savedProductIds: [],
          emailVerified: true // Verified via Brevo 6-digit OTP code
        };
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
          isLocalSandboxFallback = true;
        } else {
          throw authErrorDetail;
        }
      }

      // Security fix (RLS-migration Phase 1, checkpoint 9): the real-
      // Firebase-user branch above signs the new user in automatically
      // (Firebase Auth's own behavior on a successful
      // createUserWithEmailAndPassword), so by this point there IS a real,
      // verifiable identity -- persisted via POST /api/users/sync instead
      // of a direct, unauthenticated writeBatch (dbAdapter's generic write
      // path has no per-row ownership check; a raw Supabase caller could
      // otherwise write to ANY user's row and claim ANY username's
      // store_names reservation, not just their own). That endpoint
      // already handles both the users upsert AND the store_names
      // reservation server-side in one call (confirmed at checkpoint 7).
      // The sandbox-fallback branch is NOT migrated: it has no real
      // Firebase identity at all (email/password auth is disabled for the
      // whole project in that case), so there is nothing for
      // verifyUser() to verify -- requiring the authenticated endpoint
      // here would simply break the fallback outright rather than secure
      // it. It keeps its original direct-write behavior, unchanged.
      if (isLocalSandboxFallback) {
        try {
          const batch = writeBatch(null);
          batch.set(doc('users', uid), cleanObject(newUser));
          const storeNameLower = username.trim().toLowerCase();
          batch.set(doc('storeNames', storeNameLower), {
            userId: uid,
            username: username.trim()
          });
          await batch.commit();
          console.log(`[Registration] Saved sandbox-fallback user profile and reserved store name: "${storeNameLower}"`);
        } catch (dbErr) {
          console.warn('Fitted profile registry to database (failed/local simulation only):', dbErr);
          try {
            await setDoc(doc('users', uid), cleanObject(newUser));
          } catch (_) {}
        }
      } else {
        const authHeaders = await getAuthHeader();
        const syncRes = await fetch('/api/users/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ user: newUser })
        });
        const syncJson = await syncRes.json().catch(() => ({}));
        if (!syncJson.success) {
          // Correctness fix: this used to be caught by its own try/catch
          // right here and only console.warn'd -- registerUser proceeded
          // past it regardless, set local state, and returned newUser
          // successfully, so verifyAndCompleteRegistration reported
          // success:true and Navbar showed "Account registered and
          // verified successfully!" even though no Supabase profile row
          // was ever created. The Firebase Auth account above IS real by
          // this point though (createUserWithEmailAndPassword already
          // succeeded), so this throw does leave a real auth account with
          // no server profile behind it if sync keeps failing -- narrower
          // and far better than silently pretending the whole thing
          // worked, but a full fix (e.g. rolling back the auth account,
          // or a retry path on next login) is still open.
          throw new Error(syncJson.error || 'Failed to persist registered profile.');
        }
        console.log(`[Registration] Server-authoritative profile sync succeeded, store name reserved for UID: ${uid}`);
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
      if (newUser.id) {
        setSelectedSellerId(newUser.id);
      }
      setCurrentView('my-dashboard');

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
      const cleanEmail = email.trim().toLowerCase();
      if (cleanEmail === 'asumaduvincent7@gmail.com') {
        throw new Error('Registration Limit: The email address "asumaduvincent7@gmail.com" has been reserved for system security. Please use a different individual email address to register.');
      }

      // Call Brevo OTP API endpoint
      const response = await fetch('/api/auth/send-registration-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, username: username.trim() })
      });

      const resData = await response.json().catch(() => ({}));
      if (!response.ok || !resData.success) {
        throw new Error(resData.error || 'Failed to send verification code. Please check your email and try again.');
      }

      // Store pending registration details for step 2 verification
      pendingRegistrationRef.current = {
        username: username.trim(),
        email: cleanEmail,
        phoneNumber: phoneNumber?.trim() || undefined,
        password,
        photoUrl: photoUrl || undefined
      };

      return { success: true };
    } catch (err: any) {
      console.error('[initiateRegistration] Error:', err);
      throw err;
    }
  }, []);

  const verifyAndCompleteRegistration = useCallback(async (email: string, otp: string) => {
    try {
      const cleanEmail = email.trim().toLowerCase();
      const cleanOtp = otp.trim().replace(/\D/g, '');

      if (!cleanOtp || cleanOtp.length !== 6) {
        throw new Error('Please enter a valid 6-digit verification code.');
      }

      // 1. Verify OTP with backend endpoint
      const response = await fetch('/api/auth/verify-registration-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, otp: cleanOtp })
      });

      const resData = await response.json().catch(() => ({}));
      if (!response.ok || !resData.success) {
        throw new Error(resData.error || 'Invalid or expired verification code. Please check your code and try again.');
      }

      // 2. Retrieve saved registration details
      const pending = pendingRegistrationRef.current;
      if (!pending || pending.email !== cleanEmail) {
        throw new Error('Registration session expired. Please change email or re-enter your registration details.');
      }

      // 3. Complete user creation in Firebase & Supabase
      const newUser = await registerUser(
        pending.username,
        pending.email,
        pending.phoneNumber,
        pending.password,
        pending.photoUrl
      );

      pendingRegistrationRef.current = null;
      return { success: true, user: newUser, simulatedMode: false };
    } catch (err: any) {
      console.error('[verifyAndCompleteRegistration] Error:', err);
      throw err;
    }
  }, [registerUser]);

  const refreshUserProfile = async (targetUid?: string): Promise<User | null> => {
    const firebaseUser = auth.currentUser;
    const uid = targetUid || firebaseUser?.uid || currentUser?.id;
    if (!uid) {
      console.warn('[Auth Handler Sync] No valid UID available for profile refresh.');
      return null;
    }
    try {
      if (firebaseUser && firebaseUser.uid === uid) {
        const found = await findAndMigrateExistingUser(firebaseUser);
        if (found) {
          setCurrentUserState(found);
          setSelectedSellerId(found.id);
          safeLocalStorage.setItem('tedbuy_local_current_user_backup', JSON.stringify(found));
          console.log(`[Auth Handler Sync] User profile state successfully synced for "${found.username || found.id}"`);
          return found;
        }
      } else {
        // Security fix (RLS-migration Phase 2, checkpoint 14): same
        // self-only read pattern as the other sites in this checkpoint
        // (this branch's only real caller, loginUser, always passes the
        // just-authenticated firebaseUser's own uid -- see the sole call
        // site below), migrated to the same GET /api/users/get?id=.
        const authHeaders = await getAuthHeader();
        const res = await fetch(`/api/users/get?id=${encodeURIComponent(uid)}`, { headers: authHeaders });
        const json = await res.json().catch(() => ({}));
        if (json.success && json.user) {
          const dbData = json.user as User;
          const normalizedUser: User = {
            ...dbData,
            id: dbData.id || uid,
            emailVerified: auth.currentUser?.emailVerified || dbData.emailVerified || false
          };
          setCurrentUserState(normalizedUser);
          setSelectedSellerId(normalizedUser.id);
          safeLocalStorage.setItem('tedbuy_local_current_user_backup', JSON.stringify(normalizedUser));
          return normalizedUser;
        }
      }
    } catch (err) {
      console.warn(`[Auth Handler Sync] Error fetching user doc from the legacy database for UID "${uid}":`, err);
    }
    return null;
  };

  const loginUser = async (identifier: string, password?: string) => {
    if (!password) {
      throw new Error('Password is required.');
    }
    const cleanIdentifier = identifier.trim();
    if (!cleanIdentifier) {
      throw new Error('Please enter your email address, username, or phone number.');
    }

    try {
      console.log('[loginUser] Authenticating directly with Firebase Authentication SDK...', cleanIdentifier);
      
      let emailTarget = cleanIdentifier;

      // If user provided a username or phone number without '@', look up their email address
      if (!cleanIdentifier.includes('@')) {
        const cleanLower = cleanIdentifier.toLowerCase();
        // Fast-path cache check against the shared `users` state -- this
        // will normally miss now (RLS-migration Phase 0 moved that state
        // off a bulk read that included email/phoneNumber onto the
        // PII-safe GET /api/users/list, which doesn't), always falling
        // through to the lookup below instead.
        const foundUser = users.find(
          u => (u.username && u.username.toLowerCase() === cleanLower) ||
               (u.phoneNumber && u.phoneNumber === cleanIdentifier)
        );
        if (foundUser && foundUser.email) {
          emailTarget = foundUser.email;
        } else {
          // Security fix (RLS-migration Phase 2, checkpoint 16, superseded
          // by the email-privacy fix below): this used to be a direct,
          // unauthenticated `getDocs(query(collection('users'),
          // where('username'/'phoneNumber', '==', ...)))` -- client-side
          // query filters aren't access control; a caller bypassing this
          // app's own JS could issue the same query with ANY username or
          // phone number. First migrated to GET /api/users/get?username=/
          // &phoneNumber=, which closed the unauthenticated-query problem
          // but still returned the full user profile (email included) to
          // this necessarily-pre-auth caller (no session exists yet at
          // this point in the login flow). Migrated again to the
          // dedicated, minimal POST /api/auth/resolve-login-identifier,
          // which returns only the email needed to continue
          // signInWithEmailAndPassword below -- no id, phoneNumber,
          // whatsAppNumber, or other profile field, and a stricter
          // pre-auth rate limit than the general-purpose users/get.
          try {
            const resolveRes = await fetch('/api/auth/resolve-login-identifier', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ identifier: cleanIdentifier })
            });
            const resolveJson = await resolveRes.json().catch(() => ({}));
            if (resolveJson.success && resolveJson.email) {
              emailTarget = resolveJson.email;
            }
          } catch (lookupErr) {
            console.warn('[loginUser] Identifier lookup in the legacy database failed:', lookupErr);
          }
        }
      }

      // Execute Firebase Authentication directly using Web Auth SDK with DB sync fallback
      let firebaseUser: any = null;
      try {
        const userCredential = await signInWithEmailAndPassword(auth, emailTarget, password);
        firebaseUser = userCredential.user;
      } catch (authErr: any) {
        console.warn('[loginUser] Primary Firebase auth failed, checking database password sync fallback:', authErr?.message);
        
        try {
          const syncRes = await fetch('/api/auth/verify-and-sync-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailTarget, password })
          });
          const syncData = await syncRes.json().catch(() => ({}));

          if (syncRes.ok && syncData.success && syncData.user) {
            console.log('[loginUser] Database password verification successful for:', emailTarget);
            // Try signing in again if Firebase password was updated by backend
            try {
              const retryCred = await signInWithEmailAndPassword(auth, emailTarget, password);
              firebaseUser = retryCred.user;
            } catch (retryErr) {
              console.warn('[loginUser] Retry signInWithEmailAndPassword after backend sync still failed:', retryErr);
            }

            const backendUser = syncData.user;
            let loggedInUser: User = {
              id: backendUser.id || (firebaseUser ? firebaseUser.uid : `usr_${Date.now()}`),
              username: backendUser.username || emailTarget.split('@')[0],
              email: backendUser.email || emailTarget,
              role: backendUser.role || 'both',
              phoneNumber: backendUser.phoneNumber,
              photoUrl: backendUser.photoUrl,
              joinDate: backendUser.joinDate || new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
              followingSellers: backendUser.followingSellers || [],
              savedProductIds: backendUser.savedProductIds || [],
              emailVerified: true,
              isAdmin: backendUser.isAdmin
            };

            if (loggedInUser.isSuspended) {
              await signOut(auth).catch(() => {});
              setIsSuspendedBlockOpen(true);
              throw new Error('Your account has been suspended. Please contact support.');
            }

            safeLocalStorage.setItem('tedbuy_local_current_user_backup', JSON.stringify(loggedInUser));
            setCurrentUserState(loggedInUser);
            if (loggedInUser.id) {
              setSelectedSellerId(loggedInUser.id);
            }
            setCurrentView('my-dashboard');
            return true;
          } else {
            throw authErr;
          }
        } catch (fallbackErr: any) {
          if (fallbackErr?.message?.includes('suspended')) {
            throw fallbackErr;
          }
          throw authErr;
        }
      }

      // Clear any simulation flags
      safeLocalStorage.removeItem('tedbuy_simulated_mode');

      // First check and migrate existing account profile to current authenticated UID
      let loggedInUser = await findAndMigrateExistingUser(firebaseUser);

      // Fetch the complete user profile directly from the database
      if (!loggedInUser) {
        loggedInUser = await refreshUserProfile(firebaseUser.uid);
      }

      // Fallback: Check local state/caches before creating a minimal profile
      if (!loggedInUser) {
        const cachedInUsers = users.find(u => u.id === firebaseUser.uid);
        if (cachedInUsers) {
          loggedInUser = cachedInUsers;
        } else {
          try {
            const backupStr = safeLocalStorage.getItem('tedbuy_local_current_user_backup');
            if (backupStr) {
              const parsed = JSON.parse(backupStr) as User;
              if (parsed.id === firebaseUser.uid) loggedInUser = parsed;
            }
          } catch (_) {}
        }
      }

      // ONLY construct and save a new user document if the user document truly does not exist in the legacy database or caches
      if (!loggedInUser) {
        console.log(`[loginUser] User doc not found in the legacy user database or cache for UID "${firebaseUser.uid}". Initializing basic doc...`);
        const isSuperAdmin = firebaseUser.email?.trim().toLowerCase() === 'asumaduvincent7@gmail.com';
        loggedInUser = {
          id: firebaseUser.uid,
          username: firebaseUser.displayName || emailTarget.split('@')[0],
          email: firebaseUser.email || emailTarget,
          role: 'both',
          joinDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          photoUrl: firebaseUser.photoURL || undefined,
          followingSellers: [],
          savedProductIds: [],
          emailVerified: firebaseUser.emailVerified || false,
          isAdmin: isSuperAdmin ? true : undefined
        };
        // Security fix (RLS-migration Phase 1, checkpoint 9): this used to
        // be a direct, unauthenticated `setDoc` -- dbAdapter's generic
        // write path has no per-row ownership check at all. Login always
        // requires a real, successfully-authenticated Firebase session by
        // this point (unlike registerUser's sandbox-fallback branch), so
        // there's a real identity to verify -- migrated to POST
        // /api/users/sync, which also reserves this username in
        // store_names as a side effect of its normal behavior (this
        // minimal-fallback-profile path previously never did, a
        // pre-existing gap this migration incidentally closes rather than
        // a deliberate separate change).
        try {
          const authHeaders = await getAuthHeader();
          const syncRes = await fetch('/api/users/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ user: loggedInUser })
          });
          const syncJson = await syncRes.json().catch(() => ({}));
          if (!syncJson.success) {
            throw new Error(syncJson.error || 'Failed to persist initial user document.');
          }
        } catch (writeErr) {
          console.warn('[loginUser] Failed to persist initial user document to the database:', writeErr);
        }
      }

      if (loggedInUser.isSuspended) {
        await signOut(auth);
        setIsSuspendedBlockOpen(true);
        throw new Error('Your account has been suspended. Please contact support.');
      }

      safeLocalStorage.setItem('tedbuy_local_current_user_backup', JSON.stringify(loggedInUser));
      setCurrentUserState(loggedInUser);
      if (loggedInUser.id) {
        setSelectedSellerId(loggedInUser.id);
      }
      setCurrentView('my-dashboard');
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
      console.log('[resetPasswordEmail] Sending password reset email via Brevo server API...');
      const response = await fetch('/api/auth/send-password-reset', {
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
        const errText = data.error || data.message || 'Password reset request could not be completed.';
        const error = new Error(errText);
        throw error;
      } else {
        const errData = await response.json().catch(() => ({}));
        const errText = errData.error || errData.message || `Server HTTP ${response.status}`;
        const error = new Error(errText);
        if (response.status === 403 || errText.toLowerCase().includes('suspended')) {
          (error as any).isSuspended = true;
        }
        throw error;
      }
    } catch (error: any) {
      console.error('[resetPasswordEmail] Error:', error);
      throw error;
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

      console.log('Triggering Google Auth flow...');
      try {
        const result = await signInWithPopup(auth, provider);
        const googleUser = result.user;
        if (googleUser && googleUser.email) {
          const emailClean = googleUser.email.trim().toLowerCase();

          // Security fix (RLS-migration Phase 2, checkpoint 14): same
          // self-only read pattern as the other sites in this checkpoint
          // (googleUser.uid is the identity that just signed in), migrated
          // to the same GET /api/users/get?id=.
          try {
            const authHeaders = await getAuthHeader();
            const res = await fetch(`/api/users/get?id=${encodeURIComponent(googleUser.uid)}`, { headers: authHeaders });
            const json = await res.json().catch(() => ({}));
            if (json.success && json.user) {
              const dbData = json.user as User;
              if (dbData && dbData.isSuspended) {
                await signOut(auth);
                setIsSuspendedBlockOpen(true);
                throw new Error("Your account has been suspended by TedBuy Administration due to safety or policy violations. Please contact TedBuy Support at info.tedbuy@gmail.com to appeal.");
              }
            }
          } catch (snapErr: any) {
            if (snapErr?.message?.includes('suspended')) {
              throw snapErr;
            }
            console.warn('[Google Sign-In] Database pre-check non-blocking exception:', snapErr);
          }

          console.log('[Google Sign-In] Successful sign-in as ' + emailClean + '. Session initialization in progress.');
          if (googleUser.uid) {
            setSelectedSellerId(googleUser.uid);
          }
          setCurrentView('my-dashboard');
          return;
        }
      } catch (popupErr: any) {
        if (popupErr?.code === 'auth/account-exists-with-different-credential') {
          throw popupErr;
        }

        if (auth.currentUser) {
          console.log('[Google Sign-In] Firebase user is signed in via background listener:', auth.currentUser.email);
          setSelectedSellerId(auth.currentUser.uid);
          setCurrentView('my-dashboard');
          return;
        }

        console.log('[Google Sign-In] Popup note:', popupErr?.code || popupErr?.message, '- Switching to redirect fallback...');

        if (isInIframe) {
          const targetUrl = `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`;
          window.open(targetUrl, '_blank', 'noopener,noreferrer');
        }

        await signInWithRedirect(auth, provider);
        return;
      }
    } catch (error: any) {
      if (process.env.NODE_ENV === "development") {
        console.error('Google sign-in error:', error);
      }
      if (error?.code === 'auth/popup-blocked') {
        throw new Error('Google sign-in popup was blocked by your browser. Please allow popups for this site or open in a new tab to continue!');
      }
      if (error?.code === 'auth/unauthorized-domain' || error?.code === 'auth/invalid-domain' || error?.message?.includes('authorized domain')) {
        throw new Error('Google sign-in is blocked for this domain. Please make sure the current site URL is added to Firebase Authentication > Settings > Authorized domains.');
      }
      if (error?.code === 'auth/account-exists-with-different-credential') {
        const pendingCred = GoogleAuthProvider.credentialFromError(error);
        const email = error.customData?.email || '';
        setGoogleLinkingData({ email, credential: pendingCred });
        throw new Error('An account already exists with this email address. Please sign in using your original sign-in method.');
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

  const exitImpersonation = useCallback(async (reason?: string) => {
    const currentSession = impersonationSession;
    if (currentSession) {
      try {
        const headers = await getAuthHeader();
        await fetch('/api/admin/impersonate/exit', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: currentSession.sessionId })
        });
      } catch (err) {
        console.warn('[AppContext] Exit impersonation API call note:', err);
      }
    }

    const adminToRestore = originalAdminUser || (currentUser?.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com' ? currentUser : null);

    setImpersonationSession(null);
    setOriginalAdminUser(null);
    safeLocalStorage.removeItem('tedbuy_impersonation_session');
    safeLocalStorage.removeItem('tedbuy_original_admin_user');

    if (adminToRestore) {
      setCurrentUserState(adminToRestore);
      safeLocalStorage.setItem('tedbuy_local_current_user_backup', JSON.stringify(adminToRestore));
    }

    if (reason === 'expired') {
      showToast('Impersonation session has expired. Returned to administrator account.', 'info');
    } else if (reason !== 'logout') {
      showToast('Exited impersonation mode. Returned to administrator account.', 'success');
    }
  }, [impersonationSession, originalAdminUser, currentUser, showToast]);

  const startImpersonation = useCallback(async (targetUserId: string): Promise<ImpersonationSession> => {
    const activeAdmin = originalAdminUser || currentUser;
    if (!activeAdmin) throw new Error('No active administrator session');

    const isBaseAdmin = activeAdmin.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com' || activeAdmin.isAdmin;
    if (!isBaseAdmin) throw new Error('Unauthorized: Admin access required');

    const headers = await getAuthHeader();
    const res = await fetch('/api/admin/impersonate/start', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId })
    });

    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to start impersonation session');
    }

    const { session, targetUser } = data;

    if (!originalAdminUser) {
      setOriginalAdminUser(activeAdmin);
      safeLocalStorage.setItem('tedbuy_original_admin_user', JSON.stringify(activeAdmin));
    }

    setImpersonationSession(session);
    safeLocalStorage.setItem('tedbuy_impersonation_session', JSON.stringify(session));

    setCurrentUserState(targetUser);
    safeLocalStorage.setItem('tedbuy_local_current_user_backup', JSON.stringify(targetUser));

    showToast(`⚠️ Impersonation Mode Active: Now viewing TedBuy as ${targetUser.username || targetUser.email}`, 'info');
    return session;
  }, [currentUser, originalAdminUser, showToast]);

  useEffect(() => {
    if (!impersonationSession) return;
    const interval = setInterval(() => {
      if (new Date(impersonationSession.expiresAt).getTime() <= Date.now()) {
        console.log('[AppContext] Impersonation session expired by timer.');
        exitImpersonation('expired');
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [impersonationSession, exitImpersonation]);

  const logoutUser = async () => {
    try {
      if (impersonationSession) {
        await exitImpersonation('logout');
      }
      setIsAdminSessionVerified(false);
      setAdminFailedAttempts(0);
      try {
        await signOut(auth);
      } catch (soErr) {
        console.warn('SignOut error during logoutUser:', soErr);
      }
      safeLocalStorage.removeItem('tedbuy_simulated_mode');
      safeLocalStorage.removeItem('tedbuy_simulated_user');
      safeLocalStorage.removeItem('tedbuy_local_created_products');
      safeLocalStorage.removeItem('tedbuy_local_products_overrides');
      safeLocalStorage.removeItem('tedbuy_custom_auth_token');
      safeLocalStorage.removeItem('tedbuy_local_current_user_backup');
      safeLocalStorage.removeItem('tedbuy_user_profiles_cache');
      setCurrentUserState(null);
      setCurrentView('browse');
      showToast('Logged out successfully.', 'info');
    } catch (err) {
      console.error('Core Logout failed:', err);
    }
  };

  const resetAppToZero = async () => {
    try {
      console.log('[resetAppToZero] Resetting all authentication and application state back to zero start point...');
      setIsAdminSessionVerified(false);
      setAdminFailedAttempts(0);
      try {
        await signOut(auth);
      } catch (soErr) {
        console.warn('SignOut error during resetAppToZero:', soErr);
      }

      // Purge all localStorage & sessionStorage entries
      try {
        if (typeof window !== 'undefined') {
          if (window.localStorage) {
            window.localStorage.clear();
          }
          if (window.sessionStorage) {
            window.sessionStorage.clear();
          }
        }
      } catch (e) {
        console.warn('Storage clear during reset error:', e);
      }

      // Reset all context state
      setCurrentUserState(null);
      setSelectedSellerId(null);
      setActiveChatId(null);
      setSearchQuery('');
      setSelectedCategory('All' as Category);
      setGoogleLinkingData(null);
      setCurrentView('browse');

      showToast('App and authentication reset to ground zero. 🔄', 'info');
    } catch (err) {
      console.error('Reset to zero failed:', err);
    }
  };

  // P0 security fix: '2330' was previously ALWAYS accepted as a valid PIN,
  // regardless of what VITE_ADMIN_PIN was actually configured to -- a
  // hardcoded bypass baked into the shipped client bundle, readable by
  // anyone. Removed. This remains a client-side-only check (VITE_ADMIN_PIN
  // is itself bundled into the client JS, so it was never a real secret
  // either) -- it is NOT a substitute for server-side authorization, and no
  // privileged action should ever treat isAdminSessionVerified as proof of
  // anything. It exists purely as UX friction before showing admin UI; the
  // actual privileged endpoints (see /api/admin/*) independently
  // re-verify admin status via verifyUser()'s cryptographic Firebase-token
  // check regardless of this flag.
  const verifyAdminPIN = useCallback(async (pin: string): Promise<boolean> => {
    const trimmed = pin.trim();
    const customPin = (import.meta as any).env.VITE_ADMIN_PIN || '2330';
    const isValid = trimmed === customPin.trim();

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
        // Security fix (RLS-migration Phase 1, checkpoint 9): this used to
        // be a direct, unauthenticated `updateDoc` -- dbAdapter's generic
        // write path has no per-row ownership check. Migrated to POST
        // /api/users/sync, which doesn't even trust the client's
        // emailVerified claim regardless -- it independently re-derives
        // the real value from Firebase Admin SDK's own record server-side
        // (see .ai/handoffs/SUPABASE_RLS_MIGRATION_PLAN.md §0/§19 of the
        // audit doc), so this is doubly safe: neither the write path nor
        // the field's value is client-trusted anymore.
        const authHeaders = await getAuthHeader();
        const syncRes = await fetch('/api/users/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ user: { ...currentUser, emailVerified: true } })
        });
        const syncJson = await syncRes.json().catch(() => ({}));
        if (!syncJson.success) {
          throw new Error(syncJson.error || 'Failed to persist verification status.');
        }
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
        const userDoc = await getDoc(doc('users', seed.id));
        if (userDoc.exists()) {
          setCurrentUserState(userDoc.data() as User);
          safeLocalStorage.setItem('tedbuy_simulated_user', JSON.stringify(userDoc.data()));
        } else {
          const newUser: User = {
            ...seed,
            id: seed.id.startsWith('user_') ? seed.id : `user_${seed.id}`
          };
          await setDoc(doc('users', newUser.id), cleanObject(newUser));
          setCurrentUserState(newUser);
          safeLocalStorage.setItem('tedbuy_simulated_user', JSON.stringify(newUser));
        }
      } catch (dbErr) {
        console.warn('Failed to load/create simulated user in the database, performing in-memory fallback:', dbErr);
        // Even if database write/read fails, set the local state so the app continues working elegantly
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
    imageUrls?: string[];
    displayImage?: string;
    primaryPicture?: string;
    videoPoster?: string;
    videos?: string[];
    videoUrls?: string[];
    brand?: string;
    condition?: string;
    negotiable?: boolean;
    isExchangeable?: boolean;
    exchangePossible?: boolean;
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
    const cleanImgs = sanitizedProductData.images || [];
    const videoPoster = (sanitizedProductData as any).videoPoster ||
      (sanitizedProductData.videos?.[0] ? getCloudinaryVideoPoster(sanitizedProductData.videos[0]) : '');
    const displayImg = cleanImgs[0] || videoPoster || '';

    const newProduct: Product = {
      id: prodId,
      sellerId: currentUser.id,
      sellerName: currentUser.username,
      sellerEmail: currentUser.email || '',
      sellerPhoto: currentUser.photoUrl || '',
      sellerJoinDate: currentUser.joinDate,
      ...sanitizedProductData,
      images: cleanImgs,
      imageUrls: cleanImgs,
      videoPoster: videoPoster,
      displayImage: displayImg,
      primaryPicture: displayImg,
      category: normalizeCategory(productData.category),
      createdAt: new Date().toISOString(),
      viewsCount: 0,
      isSyncing: true
    };

    try {
      const payload = cleanObject({ ...newProduct, isSyncing: false });

      // Step A: Optimistically inject into products list state -- gives an
      // instant "isSyncing: true" card in the feed while Step B confirms
      // with the server, same UX as before.
      setProducts(prev => [newProduct, ...prev]);

      // Step B: Save to server API.
      //
      // Security fix (RLS-migration Phase 1, checkpoint 23): this used to
      // ALSO run a "Priority 2" direct, unauthenticated
      // `setDoc(doc('products', prodId), payload)` straight to Supabase
      // after the authenticated sync above -- dbAdapter's generic write
      // path has no per-row ownership check. This call site's own payload
      // is always self-authored (sellerId is hardcoded to currentUser.id a
      // few lines above, not part of this function's input type at all),
      // but the direct write itself doesn't care what THIS caller sends --
      // a caller bypassing this app's own JS entirely could reach the same
      // write with ANY sellerId/title/price/images, creating fake listings
      // attributed to arbitrary real sellers, fully unauthenticated. The
      // server sync above already creates the product correctly and
      // safely (server-enforced sellerId = the verified caller). Removed
      // the redundant, insecure "fallback".
      //
      // Correctness fix: this used to be an un-awaited, fire-and-forget IIFE
      // that never checked the response at all -- fetch() only rejects on a
      // network-level failure, never on a 4xx/5xx, so any server-side
      // rejection (validation, ownership, rate limit, a 5xx) left the
      // optimistic product from Step A sitting in local state with nothing
      // to say it never actually saved, while createProduct still resolved
      // successfully to its caller (ListingModal.tsx then showed "Ad posted
      // successfully!" regardless). Same class of bug as the mobile
      // createProduct fix and the boost-deactivate fix earlier this
      // session. Now properly awaited, checked, and rolled back on failure.
      let savedProduct: Product = newProduct;
      try {
        const authHeaders = await getAuthHeader();
        const res = await fetch('/api/products/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ product: payload })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to publish listing.');
        }
        if (data.product) {
          savedProduct = data.product;
        }
        setProducts(prev => prev.map(p => p.id === prodId ? { ...p, ...(data.product || {}), isSyncing: false } : p));
        fetch('/api/sitemap/clear', { method: 'POST', headers: authHeaders }).catch(() => {});
      } catch (syncErr) {
        // Never actually saved -- remove the optimistic card rather than
        // leave a phantom listing sitting in local state.
        setProducts(prev => prev.filter(p => p.id !== prodId));
        throw syncErr;
      }

      // Update current user's rapid post score dynamically.
      // RLS-migration Phase 1: the direct-write persist that used to sit
      // here was removed -- 'rapidPostScore' has never been in
      // dbAdapter.ts's TABLE_COLUMNS allow-list, so this write has been a
      // pure no-op the entire time (confirmed by reading updateDoc's own
      // filterTableColumns -> empty-payload -> early-return path, not
      // assumed). The local state update below is left as-is: it's a
      // real, if session-scoped-only, user-visible value (see
      // SellerDashboard.tsx's "recent posts" display) -- pending a
      // decision on whether to actually build real server-side tracking
      // for it.
      try {
        const sellerProds = products.filter(p => p.sellerId === currentUser.id);
        const nowMs = Date.now();
        const postsLast3Days = sellerProds.filter(p => {
          const createdMs = p.createdAt ? new Date(p.createdAt).getTime() : 0;
          return (nowMs - createdMs) < 3 * 24 * 60 * 60 * 1000; // 3 days
        }).length + 1; // + 1 for the newly posted one

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

      // Notification security migration (see
      // .ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md §18): this used to
      // directly broadcast a "post_created" notification to every
      // follower/following user via dbAdapter -- redundant AND insecure
      // (fully client-controlled sender identity, no ownership check on
      // the write). The /api/products/sync call above already triggers
      // the equivalent, server-authoritative "new listing from a seller
      // you follow" notification (server.ts, using real follower data and
      // the verified seller identity) -- no client-side dispatch needed.

      return savedProduct;
    } catch (err) {
      handleBackendError(err, OperationType.CREATE, `products/${prodId}`);
    }
  };

  const updateProduct = async (id: string, productData: Partial<Product>, localOnly = false): Promise<string | undefined> => {
    // Snapshot of local state before any optimistic mutation below, so a
    // failed sync can be rolled back instead of leaving the optimistic
    // change in place while the caller is told it failed -- matches
    // deleteProduct's existing rollback-on-failure pattern. Without this,
    // e.g. SellerDashboard's Mark Sold/Available toggle showed the new
    // status as if it had saved even when the server rejected it.
    const existedInStateBefore = products.some(p => p.id === id);
    const originalStateProduct = products.find(p => p.id === id);
    try {
      let localProduct = products.find(p => p.id === id);
      if (!localProduct) {
        try {
          const res = await fetch(`/api/products/${id}`);
          if (res.ok) {
            const data = await res.json();
            localProduct = data.product || data;
          }
        } catch (_) {}
      }
      const keys = Object.keys(productData);
      const isSocialOnly = keys.every(k => ['likesCount', 'likedUserIds', 'viewsCount'].includes(k));

      // Authorization Guard
      if (!isSocialOnly) {
        if (!currentUser) {
          throw new Error('Authentication Required: You must be logged in to modify listings.');
        }
        const isSuperAdmin = currentUser.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com' ||
          originalAdminUser?.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com' ||
          currentUser.isAdmin ||
          originalAdminUser?.isAdmin;
        const isOwner = localProduct && (
          localProduct.sellerId === currentUser.id ||
          localProduct.sellerId === `user_${currentUser.id}` ||
          localProduct.sellerId === `phone_${currentUser.id}` ||
          (originalAdminUser && (
            localProduct.sellerId === originalAdminUser.id ||
            localProduct.sellerId === `user_${originalAdminUser.id}` ||
            localProduct.sellerId === `phone_${originalAdminUser.id}`
          )) ||
          (currentUser.email && localProduct.sellerEmail?.toLowerCase() === currentUser.email.toLowerCase()) ||
          (originalAdminUser?.email && localProduct.sellerEmail?.toLowerCase() === originalAdminUser.email.toLowerCase())
        );
        if (localProduct && !isOwner && !isSuperAdmin && !currentUser.isAdmin) {
          throw new Error('Unauthorized Access: You do not have permissions to modify this listing.');
        }
      }

      const updatedData = { ...productData };
      const currentVideos = (updatedData.videos && Array.isArray(updatedData.videos))
        ? updatedData.videos
        : (localProduct?.videos || []);
      const fallbackPoster = (updatedData as any).videoPoster ||
        (currentVideos[0] ? getCloudinaryVideoPoster(currentVideos[0]) : '');

      if (updatedData.images && Array.isArray(updatedData.images)) {
        updatedData.imageUrls = updatedData.images;
        if (updatedData.images.length > 0) {
          updatedData.displayImage = updatedData.images[0];
          (updatedData as any).primaryPicture = updatedData.images[0];
        } else if (fallbackPoster) {
          updatedData.displayImage = fallbackPoster;
          (updatedData as any).primaryPicture = fallbackPoster;
          (updatedData as any).videoPoster = fallbackPoster;
        }
      } else if (updatedData.imageUrls && Array.isArray(updatedData.imageUrls)) {
        updatedData.images = updatedData.imageUrls;
        if (updatedData.imageUrls.length > 0) {
          updatedData.displayImage = updatedData.imageUrls[0];
          (updatedData as any).primaryPicture = updatedData.imageUrls[0];
        } else if (fallbackPoster) {
          updatedData.displayImage = fallbackPoster;
          (updatedData as any).primaryPicture = fallbackPoster;
          (updatedData as any).videoPoster = fallbackPoster;
        }
      } else if (fallbackPoster && !updatedData.displayImage && !localProduct?.images?.length) {
        updatedData.displayImage = fallbackPoster;
        (updatedData as any).primaryPicture = fallbackPoster;
        (updatedData as any).videoPoster = fallbackPoster;
      }

      if (updatedData.title) updatedData.title = sanitizeText(updatedData.title);
      if (updatedData.description) updatedData.description = sanitizeText(updatedData.description);
      if (updatedData.location) updatedData.location = sanitizeText(updatedData.location);
      if (updatedData.brand) updatedData.brand = sanitizeText(updatedData.brand);

      if (updatedData.category) {
        updatedData.category = normalizeCategory(updatedData.category);
      }

      // Harmonize isSold, status, and soldAt
      if (updatedData.isSold !== undefined) {
        const nextSold = updatedData.isSold === true;
        updatedData.isSold = nextSold;
        if (nextSold) {
          updatedData.status = 'sold';
          if (!updatedData.soldAt) updatedData.soldAt = new Date().toISOString();
        } else {
          updatedData.status = 'active';
          updatedData.soldAt = null;
        }
      } else if (updatedData.status === 'sold') {
        updatedData.isSold = true;
        if (!updatedData.soldAt) updatedData.soldAt = new Date().toISOString();
      } else if (updatedData.status === 'active') {
        updatedData.isSold = false;
        updatedData.soldAt = null;
      }

      // Optimistically update local memory state
      // Stamping updatedAt here (not just spreading updatedData) matters:
      // components that merge this context's products against their own
      // separately-fetched copy (e.g. ProfileSettings' My Classified
      // Listings) use updatedAt to decide which copy is actually newer —
      // without a fresh stamp here, an optimistic update look identical in
      // age to a stale copy fetched before it, and lose that comparison.
      setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updatedData, updatedAt: new Date().toISOString() } : p));

      // Step C: Try updating standard database document, but in a completely non-blocking asynchronous way
      if (localOnly) {
        console.log('[updateProduct] Local-only state update requested. Skipping remote backend write.');
        return id;
      }

      if (localProduct) {
        const keys = Object.keys(updatedData);
        const silentKeys = [
          'likesCount', 'likedUserIds', 'viewsCount',
          'boostStatus', 'boostPlan', 'boostEndDate', 'boostStartDate',
          'boostPriority', 'priorityScore', 'boostHistory', 'paymentStatus',
          'paymentReference', 'boostAmount', 'boostPackagePrice',
          'boostPriorityLevel', 'remainingBoostTime', 'lastBoostPurchase', 'lastBoostedAt'
        ];
        const isSocialOnly = keys.every(k => silentKeys.includes(k));

        if (isSocialOnly) {
          // Security fix (RLS-migration Phase 1, checkpoint 17): this used
          // to ALSO fire a direct, unauthenticated `updateDoc(productRef,
          // cleanObject(updatedData))` straight to Supabase (dbAdapter's
          // generic write path has no per-row ownership check) in parallel
          // with the authenticated sync below -- and critically, this
          // client-side `isSocialOnly` classification bundles boost fields
          // (boostStatus/boostEndDate/boostPriority/...) in with the
          // genuinely-social ones (likesCount/likedUserIds/viewsCount) to
          // decide whether ITS OWN auth guard above can be skipped, while
          // POST /api/products/sync's server-side bypass (SOCIAL_ONLY_FIELDS,
          // that endpoint's own code) is deliberately narrower -- likes/views
          // only, never boost fields. That meant the direct write could set
          // boostStatus/boostEndDate/boostPriority on ANY product for free,
          // by anyone, fully unauthenticated -- completely bypassing both
          // this function's own auth guard AND the server's separate,
          // already-fixed protection against exactly this (the
          // trustBoostFields P0 fix noted in cleanProduct, server.ts) --
          // since the direct write never went through that server logic at
          // all. Removed entirely; the sync call below already does
          // everything the direct write did, correctly and safely: real
          // social-only changes (likes/views) bypass ownership server-side
          // exactly as before, and boost-field changes now actually go
          // through the server's real ownership/payment-integrity checks
          // instead of skipping them.
          try {
            const authHeaders = await getAuthHeader();
            const fullSocialUpdate = { ...localProduct, ...updatedData, id };
            await fetch('/api/products/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHeaders },
              body: JSON.stringify({ product: fullSocialUpdate })
            });
            fetch('/api/sitemap/clear', { method: 'POST', headers: authHeaders }).catch(() => {});
          } catch (syncErr) {
            console.warn('[updateProduct] Server sync failed (social-only):', syncErr);
          }
        } else {
          // CRITICAL: Always strictly preserve original seller info for existing listings
          const finalSellerId = localProduct?.sellerId || (updatedData as any).sellerId || '';
          const finalSellerName = localProduct?.sellerName || (updatedData as any).sellerName || 'Seller';
          const finalSellerEmail = localProduct?.sellerEmail || (updatedData as any).sellerEmail || '';
          const finalSellerPhoto = localProduct?.sellerPhoto || (updatedData as any).sellerPhoto || '';
          const finalSellerJoinDate = localProduct?.sellerJoinDate || (updatedData as any).sellerJoinDate || '';
          const finalCreatedAt = localProduct?.createdAt || (updatedData as any).createdAt || new Date().toISOString();

          const fullProductUpdate = {
            ...localProduct,
            ...updatedData,
            id,
            sellerId: finalSellerId,
            sellerName: finalSellerName,
            sellerEmail: finalSellerEmail,
            sellerPhoto: finalSellerPhoto,
            sellerJoinDate: finalSellerJoinDate,
            createdAt: finalCreatedAt,
            updatedAt: new Date().toISOString()
          };
          if (updatedData.isSold === false) {
            fullProductUpdate.status = 'active';
            fullProductUpdate.isSold = false;
            fullProductUpdate.soldAt = null;
          } else if (updatedData.isSold === true) {
            fullProductUpdate.status = 'sold';
            fullProductUpdate.isSold = true;
          }

          // Optimistically update local memory state with full merged fields
          setProducts(prev => {
            const exists = prev.some(p => p.id === id);
            if (exists) {
              return prev.map(p => p.id === id ? { ...p, ...fullProductUpdate } : p);
            }
            return [fullProductUpdate as Product, ...prev];
          });

          // Sync to backend API endpoint to ensure Supabase and server cache reflect full edits
          let serverSyncSucceeded = false;
          try {
            const authHeaders = await getAuthHeader();
            const syncRes = await fetch('/api/products/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHeaders },
              body: JSON.stringify({ product: fullProductUpdate })
            });
            const syncJson = await syncRes.json();
            if (syncJson.success && syncJson.product) {
              serverSyncSucceeded = true;
              setProducts(prev => {
                const exists = prev.some(p => p.id === id);
                if (exists) {
                  return prev.map(p => p.id === id ? { ...p, ...syncJson.product } : p);
                }
                return [syncJson.product, ...prev];
              });
            } else if (!syncJson.success) {
              throw new Error(syncJson.error || 'Failed to update listing on server');
            }
            fetch('/api/sitemap/clear', { method: 'POST', headers: authHeaders }).catch(() => {});
          } catch (syncErr) {
            console.warn('[updateProduct] Server sync error:', syncErr);
            throw syncErr;
          }

          // Security fix (RLS-migration Phase 1, checkpoint 17): this used
          // to ALSO do a direct, unauthenticated `setDoc(productRef, ...)`
          // straight to Supabase after the authenticated sync above already
          // succeeded. Only ever reached after that ownership-checked call
          // had already persisted the exact same data (the sync's own
          // try/catch re-throws on failure, skipping this block entirely),
          // so it was purely redundant -- `syncJson.product` already
          // updated local state above -- not a distinct privilege-
          // escalation path on its own, but still an unnecessary
          // unauthenticated write against the same root architectural gap
          // (dbAdapter has no per-row ownership check) flagged throughout
          // this migration. Removed.
          if (!serverSyncSucceeded) {
            console.warn('[updateProduct] Warning: server sync did not report success.');
          }

          // Notification security migration (see
          // .ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md §18): this used to
          // directly broadcast a "post_created" (listing updated)
          // notification to every user who saved this product or follows
          // this seller, via dbAdapter -- redundant AND insecure (fully
          // client-controlled sender identity/content, no ownership check
          // on the write). The /api/products/sync call above now triggers
          // the equivalent, server-authoritative version (server.ts,
          // mirroring the new-listing notification block using real
          // saved/follower data and the verified seller identity) -- no
          // client-side dispatch needed.
        }
      } else {
        // Local product wasn't found in memory state - perform atomic update and sync while preserving existing seller.
        //
        // Security fix (RLS-migration Phase 1, checkpoint 17): the highest-
        // severity of the three findings closed in this checkpoint. This
        // branch is reached whenever the product isn't in local `products`
        // state (e.g. a fresh session, or an id never fetched into it) --
        // and the Authorization Guard above short-circuits to allow it
        // through regardless of ownership in that case (`localProduct &&
        // !isOwner...` is false whenever `localProduct` is falsy, since
        // `isOwner` can't even be computed without it), requiring only that
        // SOME user is logged in, not that they own this specific product.
        // The direct `updateDoc(productRef, cleanObject(safeData))` that
        // used to run here wrote `safeData` (built from `updatedData`, the
        // caller's own arbitrary input) straight to Supabase with zero
        // ownership check at all -- meaning ANY signed-in user could modify
        // ANY OTHER seller's listing (not just isSold/status/soldAt; any
        // field present in `updatedData`), simply by calling updateProduct
        // for a product id not currently cached client-side. Removed;
        // POST /api/products/sync below already enforces real ownership
        // (existingSellerId must match the caller, or admin) for anything
        // that isn't a genuine social-only change, so this closes the gap
        // rather than merely narrowing it.
        const safeData: any = {
          ...updatedData,
          id,
          updatedAt: new Date().toISOString()
        };
        if (updatedData.isSold === false) {
          safeData.status = 'active';
          safeData.isSold = false;
          safeData.soldAt = null;
        } else if (updatedData.isSold === true) {
          safeData.status = 'sold';
          safeData.isSold = true;
        }

        try {
          const authHeaders = await getAuthHeader();
          const syncRes = await fetch('/api/products/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ product: safeData })
          });
          const syncJson = await syncRes.json().catch(() => ({}));
          if (!syncJson.success) {
            throw new Error(syncJson.error || 'Failed to update listing on server');
          }
          refreshSellerCounts().catch(() => {});
        } catch (syncErr) {
          console.warn('[updateProduct] Server sync error:', syncErr);
          throw syncErr;
        }
      }

      refreshSellerCounts().catch(() => {});
      return id;
    } catch (err) {
      // Never actually persisted server-side -- roll back to the
      // pre-optimistic snapshot rather than leave the caller believing
      // the change stuck.
      setProducts(prev => {
        if (existedInStateBefore) {
          return prev.map(p => p.id === id ? originalStateProduct! : p);
        }
        return prev.filter(p => p.id !== id);
      });
      handleBackendError(err, OperationType.UPDATE, `products/${id}`);
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

    // Add to optimistic deleted product IDs state
    setOptimisticDeletedProductIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    // Optimistically update local memory state
    setProducts(prev => prev.filter(p => p.id !== id));

    // If active user had bookmarked this item, immediately update saved list.
    // Security fix (RLS-migration Phase 1, checkpoint 5): this used to be a
    // direct `updateDoc(doc('users', currentUser.id), { savedProductIds })`
    // -- dbAdapter's generic write path has no per-row ownership check, so
    // a raw Supabase caller could set ANY user's savedProductIds, not just
    // their own. Routed through the already-existing, already-ownership-
    // checked syncUserToServer -> POST /api/users/sync instead -- best-
    // effort/fire-and-forget here, matching the original's own
    // `.catch(() => {})` swallow-all semantics (this is a side-effect
    // cleanup, not the primary user-facing save action).
    if (currentUser?.savedProductIds?.includes(id)) {
      const updatedSaved = currentUser.savedProductIds.filter(pid => pid !== id);
      setCurrentUserState(prev => prev ? { ...prev, savedProductIds: updatedSaved } : null);
      syncUserToServer({ ...currentUser, savedProductIds: updatedSaved });
    }

    // Trigger server deletion (Supabase, server memory & disk cache, and Cloudinary media destroy).
    //
    // Correctness fix (found reviewing the ownership check added to
    // POST /api/cloudinary/delete, commit 8bb0b62): that endpoint now
    // verifies each url appears in the media fields of a product the
    // caller owns -- correct for the security fix, but this Cloudinary
    // cleanup used to be fire-and-forget (`.catch(...)`, never awaited)
    // immediately followed by the product-delete request below, with no
    // guarantee either would reach the server first. If the product-delete
    // request landed first, the product row would already be gone by the
    // time the ownership check ran, so the url would never be found and
    // the (now-correct) check would reject the delete -- silently leaving
    // the deleted listing's images/videos orphaned in Cloudinary forever.
    // Now awaited and sequenced strictly before the product-delete
    // request, so the server always sees the product row (and its media)
    // still in place when it verifies these deletes.
    try {
      if (localProduct) {
        const mediaUrls = [
          ...(Array.isArray(localProduct.images) ? localProduct.images : []),
          ...(Array.isArray(localProduct.videos) ? localProduct.videos : []),
          ...(localProduct.primaryPicture ? [localProduct.primaryPicture] : []),
          ...(localProduct.primaryVideo ? [localProduct.primaryVideo] : [])
        ].filter(u => typeof u === 'string' && u.includes('res.cloudinary.com'));

        if (mediaUrls.length > 0) {
          await deleteMultipleFromCloudinary(mediaUrls).catch(err => console.warn('[deleteProduct] Cloudinary cleanup error:', err));
        }
      }

      // Security fix (RLS-migration Phase 1, checkpoint 22): this used to
      // ALSO run a direct, unauthenticated `deleteDoc(doc('products', id))`
      // straight to Supabase right after the request above -- dbAdapter's
      // generic write path has no per-row ownership check, so a caller
      // bypassing this app's own JS could delete ANY product by id, fully
      // unauthenticated, no login required at all. The most severe finding
      // in this whole migration's final re-sweep (worse than any of the
      // updateProduct gaps closed at checkpoint 17 -- deletion, not
      // modification, and reachable with zero authentication rather than
      // "any signed-in user"). POST /api/products/delete above already
      // independently re-verifies real ownership server-side (fetches the
      // actual sellerId from Supabase, checks it against the verified
      // caller or admin) -- this client-side function's own ownership
      // guard was always only a UX pre-check, never the real boundary.
      // Removed entirely; nothing else did this deletion.
      // Correctness fix: this used to be a `.then()` chain the outer
      // function never awaited, whose own fetch() was only `.catch()`'d for
      // a network-level failure -- never checked for a non-2xx response at
      // all. That meant a real server-side rejection (ownership race,
      // validation, a 5xx) left the optimistic removal above in place with
      // nothing to say the delete never actually happened, while
      // deleteProduct still resolved successfully to its callers
      // (ProfileSettings.tsx, SellerDashboard.tsx, ProductDetail.tsx all
      // show a "deleted successfully" toast right after `await
      // deleteProduct(...)`, unconditionally). Same class of bug as
      // createProduct, fixed earlier this session. Now properly awaited,
      // checked, and rolled back on failure.
      const authHeaders = await getAuthHeader();
      const res = await fetch('/api/products/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ id })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete listing.');
      }

      fetch('/api/sitemap/clear', { method: 'POST', headers: authHeaders }).catch(() => {});
    } catch (err) {
      // Never actually deleted server-side -- roll back the optimistic
      // removal rather than leave the caller believing this succeeded.
      if (localProduct) {
        setProducts(prev => (prev.some(p => p.id === id) ? prev : [localProduct, ...prev]));
      }
      setOptimisticDeletedProductIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      throw err;
    }

    refreshSellerCounts().catch(() => {});
  };

  // Security fix (RLS-migration Phase 0, checkpoint 3): this used to write
  // likedUserIds/likesCount directly via dbAdapter's updateDoc -- a raw
  // Supabase write with no ownership check and no server-side validation
  // that the caller was only ever toggling their OWN id (a caller
  // bypassing this function's own convention could set the array to
  // anything, for any product, impersonating or erasing other users'
  // likes). POST /api/products/sync already has this exact self-toggle
  // logic implemented correctly server-side (fixed earlier this session --
  // see .ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md §21.1): it only ever
  // toggles the CALLING user's own id relative to what's already saved,
  // deriving likesCount from the result, regardless of what array the
  // client sends. A minimal `{id, likedUserIds}` payload qualifies for
  // that endpoint's "social-only" ownership-check bypass (every key sent
  // is in SOCIAL_ONLY_FIELDS), so liking someone else's listing still
  // works exactly as before -- just through the authenticated, validated
  // path instead of a raw write. The desired next state is still computed
  // client-side (for instant UI feedback and the send-my-own-id-or-not
  // payload the server's toggle logic expects), but the actual persisted
  // state always comes back from the server's response, not the client's
  // guess.
  const toggleLikeProduct = async (id: string, userId: string) => {
    if (!currentUser) {
      throw new Error('Authentication Required: You must be logged in to like listings.');
    }
    const verifiedUserId = currentUser.id;

    try {
      const productRef = doc('products', id);
      const productDoc = await getDoc(productRef);

      const currentLikedUserIds = productDoc.exists()
        ? (Array.isArray((productDoc.data() as Product)?.likedUserIds) ? (productDoc.data() as Product).likedUserIds! : [])
        : (Array.isArray(products.find(p => p.id === id)?.likedUserIds) ? products.find(p => p.id === id)!.likedUserIds! : []);
      const hasLiked = currentLikedUserIds.includes(verifiedUserId);
      const desiredLikedUserIds = hasLiked
        ? currentLikedUserIds.filter(uid => uid !== verifiedUserId)
        : Array.from(new Set([...currentLikedUserIds, verifiedUserId]));

      const authHeaders = await getAuthHeader();
      const res = await fetch('/api/products/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ product: { id, likedUserIds: desiredLikedUserIds } })
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success || !json.product) {
        throw new Error(json.error || 'Failed to update like status.');
      }

      const finalLikedUserIds: string[] = Array.isArray(json.product.likedUserIds) ? json.product.likedUserIds : desiredLikedUserIds;
      const finalLikesCount: number = typeof json.product.likesCount === 'number' ? json.product.likesCount : finalLikedUserIds.length;

      setProducts(prev => prev.map(p => p.id === id ? { ...p, likedUserIds: finalLikedUserIds, likesCount: finalLikesCount } : p));
    } catch (err) {
      console.warn('[toggleLikeProduct] Error updating product likes:', err);
      // Fallback purely local update in case of network loss
      setProducts(prev => {
        return prev.map(p => {
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

    // Security fix (RLS-migration Phase 0, checkpoint 3): this used to be a
    // direct `updateDoc(doc('products', id), { viewsCount: increment(1) })`.
    // dbAdapter's increment() helper looks like a real atomic increment but
    // isn't one -- the "current + 1" arithmetic happens entirely client-side
    // in the browser (re-fetching the row via the anon Supabase client,
    // adding 1, writing the absolute result), so a caller bypassing this
    // function's own convention could set any value just as easily as a
    // raw write. POST /api/products/:id/view now does the real increment
    // server-side (never trusts a client-supplied count) and enforces the
    // same "one real view per ~10 minutes" cooldown this function's own
    // localStorage check expresses, except server-side, per-IP -- so it
    // can't be bypassed by skipping this function entirely. Deliberately
    // NOT behind authentication: anonymous visitors legitimately generate
    // real views (see the self-view check above, which only applies when
    // `currentUser` exists) -- an auth header is still sent when available,
    // purely so the server can apply the same self-view exclusion too.
    try {
      const authHeaders = currentUser ? await getAuthHeader() : {};
      await fetch(`/api/products/${encodeURIComponent(id)}/view`, {
        method: 'POST',
        headers: authHeaders
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

    try {
      // 1. Save to reports collection — routed through the server
      // (POST /api/reports/create), NOT a direct database write like this
      // used to be. The direct write took reporterId/reporterName straight
      // from local client state (`currentUser`), which -- combined with
      // 'reports' having no TABLE_COLUMNS allow-list at all in
      // dbAdapter.ts (every other table has one; this was a real gap, not
      // a deliberate choice, so filterTableColumns let every field through
      // unfiltered) -- meant any signed-in user could file a report that
      // falsely attributed authorship to someone else, or overwrite an
      // existing report's content outright by id. The server endpoint
      // already existed (verifyUser()-gated, derives reporterId from the
      // verified token, never from the request body) but web had never
      // been migrated to use it -- see
      // .ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md §21.
      const authHeaders = await getAuthHeader();
      const res = await fetch('/api/reports/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ productId: product.id, productTitle: product.title, reason, comment }),
      });
      const reportRes = await res.json().catch(() => ({}));
      if (!reportRes.success) {
        throw new Error(reportRes.error || 'Failed to submit report.');
      }

      // 2. Locate or create support chat for the reporting user to send to admins inbox.
      //
      // Security fix (RLS-migration Phase 1, checkpoint 24): the fallback
      // creation used to be a direct, unauthenticated `setDoc(doc('chats',
      // supportChatId), ...)` -- same finding, same fix, as
      // setupWelcomePackage's chat creation (checkpoint 19): a caller
      // bypassing this app's own JS could create a chat impersonating
      // TedBuy Support in an arbitrary OTHER victim's inbox. Rather than
      // build a second endpoint for what's conceptually the same "ensure
      // my own support chat exists" operation, reused
      // POST /api/welcome/setup (checkpoint 19) -- it's idempotent and
      // guarantees a chat at the fixed id `chat_support_<uid>` exists for
      // the verified caller, which also fixes a minor pre-existing
      // inconsistency where this fallback used to mint a second, different
      // support-chat id pattern (`chat_<uid>_user_ted_ceo_support_
      // support_welcome_<timestamp>`) instead of reusing the one
      // setupWelcomePackage already creates for every verified user.
      let supportChat = chats.find(c =>
        c.productId === 'support_welcome' &&
        c.buyerId === currentUser.id &&
        c.sellerId === 'user_ted_ceo_support'
      );

      let supportChatId = supportChat?.id;

      if (!supportChatId) {
        const authHeadersForSetup = await getAuthHeader();
        const setupRes = await fetch('/api/welcome/setup', { method: 'POST', headers: authHeadersForSetup });
        const setupJson = await setupRes.json().catch(() => ({}));
        supportChatId = setupJson.success && setupJson.chatId ? setupJson.chatId : `chat_support_${currentUser.id}`;
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
      handleBackendError(err, OperationType.CREATE, `reports/${reportId}`);
      throw err;
    }
  };

  // Chats Operations
  // Starts (or reuses) a chat via the authenticated TedBuy API — the server
  // derives buyerId from the verified Firebase token and sellerId from the
  // actual product row, never from anything the client sends, and does its
  // own reuse check against Supabase (so the client-side dedup this function
  // used to do against local `chats` state is redundant — the server is now
  // the source of truth for that). See mobile/src/firebase.ts's startChatApi
  // for the identical mobile-side implementation.
  const startChat = async (productId: string, initialMessage?: string) => {
    if (!currentUser) return '';

    // Client-side rate-limit pre-check for fast UX; the server enforces its
    // own limit independently and is authoritative.
    const rLimit = checkClientRateLimit('create_chat', currentUser.id);
    if (!rLimit.allowed) {
      throw new Error(`Rate limit exceeded: You can only start 5 chats within 5 minutes. Please try again in ${rLimit.remainingSecs} seconds.`);
    }

    const cleanInitialMessage = initialMessage ? sanitizeText(initialMessage) : undefined;

    try {
      const chatId = await startChatViaApi(productId, cleanInitialMessage);

      setCurrentView('chats');
      setActiveChatId(chatId);
      setViewingChatOnMobile(true);

      // Refresh the inbox immediately rather than waiting for the next poll
      // tick so the new/reused chat appears right away.
      const apiChats = (await fetchChatsFromApi()).map((c: any) => normalizeChat(c)) as Chat[];
      setChats(prev => {
        const map = new Map(prev.map(c => [c.id, c]));
        apiChats.forEach(c => map.set(c.id, c));
        const merged = Array.from(map.values()).sort((a, b) => {
          const timeA = typeof a?.lastMessageTime === 'string' ? a.lastMessageTime : '';
          const timeB = typeof b?.lastMessageTime === 'string' ? b.lastMessageTime : '';
          return timeB.localeCompare(timeA);
        });
        try {
          safeLocalStorage.setItem('tedbuy_local_chats_backup', JSON.stringify(merged));
          safeLocalStorage.setItem(`tedbuy_local_chats_backup_${currentUser.id}`, JSON.stringify(merged));
        } catch (_) {}
        return merged;
      });

      return chatId;
    } catch (err) {
      handleBackendError(err, OperationType.CREATE, 'chats');
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
          // Both the regular and admin-support-desk cases now go through
          // the same authenticated API -- see sendMessage()'s comment
          // (.ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md §18) for why the
          // server endpoint handles the support pseudo-account case too.
          await sendMessageViaApi(msg.chatId, msg.text);

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

  // Sends a message via the authenticated TedBuy API — the server derives
  // senderId from the verified Firebase token and recipientId from the
  // actual chat row; this function only ever supplies chatId + text (the
  // `optionalSenderId` override that used to exist here had zero real
  // callers anywhere in the app — traced before removal, not assumed).
  //
  // The one narrow exception is the TedBuy Support pseudo-account thread,
  // where an admin genuinely needs to reply *as* 'user_ted_ceo_support'
  // rather than their own uid. The authenticated API correctly has no way to
  // allow that (it would be exactly the sender-spoofing this migration
  // exists to close), so that one case keeps the pre-existing direct write,
  // unchanged. A regular user messaging their OWN support chat (e.g. via
  // "report listing") is unaffected — they're already the genuine buyer
  // participant, so the new API handles that correctly.
  const sendMessage = async (chatId: string, text: string) => {
    if (!currentUser) return;

    // Client-side rate-limit pre-check for fast UX; the server enforces its
    // own limit independently and is authoritative.
    const rLimit = checkClientRateLimit('send_message', currentUser.id);
    if (!rLimit.allowed) {
      throw new Error(`Rate limit exceeded: You are sending messages too fast. Please wait ${rLimit.remainingSecs} seconds.`);
    }

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
    const isAdminReplyingAsSupport = isAdminUser && chat.sellerId === 'user_ted_ceo_support';

    const senderId = isAdminReplyingAsSupport ? 'user_ted_ceo_support' : currentUser.id;
    const recId = chat.buyerId === senderId ? chat.sellerId : chat.buyerId;

    const msgId = `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newMsg: Message = {
      id: msgId,
      chatId,
      senderId,
      recipientId: recId,
      text: cleanText,
      createdAt: new Date().toISOString(),
      read: false
    };

    // Snappy optimistic UI: `messages` currently represents this open thread.
    setMessages(prev => [...prev, newMsg]);
    setChats(prevChats => prevChats.map(c => c.id === chatId ? { ...c, lastMessageText: text, lastMessageTime: newMsg.createdAt } : c));

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

    // Notification security migration (see
    // .ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md §18): both the regular
    // send path and the admin-support-desk path used to write directly via
    // dbAdapter -- for support-desk specifically, this was the one
    // remaining case with no server endpoint to fall back to, which meant
    // fully closing the notification write vulnerability would have either
    // left this one path insecure or silently broken it. Fixed properly
    // instead: POST /api/messages/send (via sendMessageViaApi) now handles
    // the admin-support-desk case too, verifying the caller is genuinely
    // an admin server-side before allowing a send as the support
    // pseudo-account, and creates the correct notification the same way
    // every other message does. No client-side notification write remains
    // anywhere in this function.
    if (!navigator.onLine && !isAdminReplyingAsSupport) {
      console.log('[Offline Queue] Offline detected during send. Queueing message locally.');
      queueMessageOffline(newMsg);
      triggerBackgroundSync();
      return;
    }

    try {
      const sentMessage = await sendMessageViaApi(chatId, cleanText);
      // Reconcile the optimistic entry with the real, server-persisted
      // message. Closes a real race with the independent 4s message poll
      // (this file's own `load()` effect for the active chat thread): that
      // poll's setMessages blindly REPLACES the whole list with whatever
      // it fetched, not a merge -- if its GET was already in flight when
      // this send started, it can resolve afterward with a snapshot from
      // before this message was persisted, silently wiping the optimistic
      // entry until the next poll tick (up to 4s later). Re-inserting the
      // now-confirmed message into whatever the CURRENT state is (via the
      // functional setMessages form, so it's never working from a stale
      // snapshot) guarantees it's present the moment this send resolves,
      // regardless of what any concurrent poll did in between. Matches on
      // id to avoid a duplicate if a lucky poll timing already picked it
      // up with its real server id.
      if (sentMessage?.id) {
        setMessages(prev => {
          const withoutOptimistic = prev.filter(m => m.id !== msgId);
          if (withoutOptimistic.some(m => m.id === sentMessage.id)) return withoutOptimistic;
          return [...withoutOptimistic, sentMessage];
        });
      }
    } catch (err) {
      if (isAdminReplyingAsSupport) {
        console.warn('[sendMessage] Support-desk send failed:', err);
        return;
      }
      console.warn('[sendMessage] API send failed. Moving message to offline queue for background sync retry.', err);
      queueMessageOffline(newMsg);
      triggerBackgroundSync();
    }
  };

  const sendTypingStatus = useCallback(async (chatId: string, isTyping: boolean) => {
    if (!currentUser || !chatId) return;
    try {
      await setDoc(doc('chat_typing', chatId), {
        [currentUser.id]: isTyping ? Date.now() : 0
      }, { merge: true });
    } catch (err) {
      console.warn('[Typing Status] Error sending typing status:', err);
    }
  }, [currentUser]);

  // Marks the caller's unread messages in a chat as read via the
  // authenticated API — the server verifies participation and only ever
  // touches the caller's own unread rows (never another user's).
  //
  // Security fix (RLS-migration Phase 1, checkpoint 8): this used to branch
  // on `isSupportChat` and fall back to a direct
  // `updateDoc(doc('messages', msg.id), { read: true })` for the CEO-
  // support pseudo-account thread, since that account isn't a real chat
  // participant under /api/messages/mark-read's normal check -- the same
  // shape as the admin-as-support-desk gap /api/messages/send already
  // closed (§18 of the audit doc). Added the matching fallback to
  // /api/messages/mark-read itself in this same commit (reachable only by
  // a cryptographically-verified admin, only for the support account's
  // own chat), so this function no longer needs a special case at all --
  // markChatReadViaApi now handles both cases correctly server-side.
  const markChatAsRead = useCallback(async (chatId: string) => {
    if (!currentUser) return;

    const unreadMsgs = messages.filter(m => m.chatId === chatId && m.recipientId === currentUser.id && !m.read);
    if (unreadMsgs.length === 0) return;

    // Snappy optimistic local update — messages state represents this open thread.
    setMessages(prev => prev.map(m => (m.chatId === chatId && m.recipientId === currentUser.id && !m.read) ? { ...m, read: true } : m));

    await markChatReadViaApi(chatId);
    // Reflect the read state in the chat list's unreadCount immediately
    // rather than waiting for the next 15s poll tick.
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, unreadCount: 0 } : c));
  }, [currentUser, messages]);

  const persistDeletedChatIds = (nextIds: Set<string>) => {
    if (!currentUser) return;
    try {
      safeLocalStorage.setItem(`tedbuy_deleted_chat_ids_${currentUser.id}`, JSON.stringify(Array.from(nextIds)));
    } catch (err) {
      console.warn('[AppContext] Could not persist deleted chat IDs:', err);
    }
  };

  const persistDeletedMessageIds = (nextIds: Set<string>) => {
    if (!currentUser) return;
    try {
      safeLocalStorage.setItem(`tedbuy_deleted_message_ids_${currentUser.id}`, JSON.stringify(Array.from(nextIds)));
    } catch (err) {
      console.warn('[AppContext] Could not persist deleted message IDs:', err);
    }
  };

  const deleteChatForMe = async (chatId: string) => {
    if (!currentUser) return;

    let nextDeletedIds: Set<string>;
    setDeletedChatIds(prev => {
      nextDeletedIds = new Set(prev);
      nextDeletedIds.add(chatId);
      persistDeletedChatIds(nextDeletedIds);
      return nextDeletedIds;
    });

    setDeletedMessageIds(prev => {
      const next = new Set(prev);
      messages.filter(m => m.chatId === chatId).forEach(m => next.add(m.id));
      persistDeletedMessageIds(next);
      return next;
    });

    if (activeChatId === chatId) {
      const nextChat = chats.find(c => c.id !== chatId && !nextDeletedIds.has(c.id) && (c.buyerId === currentUser.id || c.sellerId === currentUser.id));
      setActiveChatId(nextChat?.id || null);
    }
  };

  const deleteMessageForMe = async (messageId: string) => {
    if (!currentUser) return;
    setDeletedMessageIds(prev => {
      const next = new Set(prev);
      next.add(messageId);
      persistDeletedMessageIds(next);
      return next;
    });
  };

  // P0 security fix: these two used to write tradeStatus directly to
  // Supabase via dbAdapter -- with no ownership check anywhere in that
  // path (RLS disabled, dbAdapter itself never verifies the caller is
  // actually this chat's seller/buyer), meaning any user could set
  // tradeStatus: 'completed' on any chat, including one they merely
  // started but never actually transacted on. This mattered beyond just
  // these two chat-status fields: /api/reviews/create trusts a chat's
  // tradeStatus === 'completed' as its proof a real trade happened before
  // allowing a review -- so this was a live fraud vector for fabricating
  // eligibility to leave (or receive) reviews without a genuine
  // transaction. Mobile already had the correct fix (see
  // mobile/src/firebase.ts's markAsDelivered/markAsPickedUp) -- the real
  // server endpoints (POST /api/chats/mark-delivered,
  // POST /api/chats/mark-picked-up) already existed, already independently
  // verify the caller is genuinely this chat's seller/buyer via
  // getChatIfParticipant, and already create the system message
  // server-side -- web just never called them. Now it does.
  const markAsDelivered = async (chatId: string) => {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;

    try {
      const authHeaders = await getAuthHeader();
      const res = await fetch('/api/chats/mark-delivered', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ chatId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not confirm delivery.');
      }

      const now = new Date().toISOString();
      setChats(prev => prev.map(c => c.id === chatId ? {
        ...c,
        deliveredBySeller: true,
        tradeStatus: 'delivered',
        lastMessageText: '📦 Seller marked item as delivered',
        lastMessageTime: now
      } : c));
    } catch (err) {
      handleBackendError(err, OperationType.UPDATE, `chats/${chatId}`);
    }
  };

  const markAsPickedUp = async (chatId: string) => {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;

    try {
      const authHeaders = await getAuthHeader();
      const res = await fetch('/api/chats/mark-picked-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ chatId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not confirm pickup.');
      }

      const now = new Date().toISOString();
      setChats(prev => prev.map(c => c.id === chatId ? {
        ...c,
        pickedUpByBuyer: true,
        tradeStatus: 'completed',
        lastMessageText: "🤝 Buyer marked as picked up",
        lastMessageTime: now
      } : c));
    } catch (err) {
      handleBackendError(err, OperationType.UPDATE, `chats/${chatId}`);
    }
  };

  // Follow profiles / saved items in user document
  // Notification security migration (see
  // .ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md §18): both functions used
  // to write followingSellers AND a "new follower" notification directly
  // via dbAdapter -- the followingSellers write only ever targeted the
  // caller's own row (never a real vulnerability on its own), but the
  // notification write targeted the SELLER's userId with fully
  // client-controlled sender name/photo, through a path with no
  // per-row ownership check at all. POST /api/users/follow already existed
  // (mobile already used it) and does both correctly: updates only the
  // verified caller's own followingSellers, and creates the follow
  // notification server-side with the sender identity read from the
  // caller's own verified database row, never from the request body.
  const followSeller = async (sellerId: string) => {
    if (!currentUser) return;
    const following = Array.isArray(currentUser.followingSellers) ? currentUser.followingSellers : [];
    if (following.includes(sellerId)) return;
    const updatedFollowing = [...following, sellerId];
    try {
      const authHeaders = await getAuthHeader();
      const res = await fetch('/api/users/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ sellerId, follow: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to follow seller.');
      }
      setCurrentUserState({ ...currentUser, followingSellers: data.followingSellers || updatedFollowing });
    } catch (err) {
      handleBackendError(err, OperationType.UPDATE, `users/${currentUser.id}`);
    }
  };

  const unfollowSeller = async (sellerId: string) => {
    if (!currentUser) return;
    const following = currentUser.followingSellers || [];
    const updatedFollowing = following.filter(id => id !== sellerId);
    try {
      const authHeaders = await getAuthHeader();
      const res = await fetch('/api/users/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ sellerId, follow: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to unfollow seller.');
      }
      setCurrentUserState({ ...currentUser, followingSellers: data.followingSellers || updatedFollowing });
    } catch (err) {
      handleBackendError(err, OperationType.UPDATE, `users/${currentUser.id}`);
    }
  };

  // Automatically reconcile and prune stale/deleted product IDs from currentUser.savedProductIds
  // This guarantees that the user's bookmarks list and bookmark badge counts never display ghost/stale counts
  // Security fix (RLS-migration Phase 1, checkpoint 5): same reasoning as
  // deleteProduct's savedProductIds cleanup above -- routed through
  // syncUserToServer -> POST /api/users/sync (ownership-checked) instead of
  // a direct dbAdapter write, fire-and-forget to match this effect's own
  // existing best-effort semantics.
  useEffect(() => {
    if (!currentUser || !Array.isArray(currentUser.savedProductIds) || currentUser.savedProductIds.length === 0) {
      return;
    }
    // Only prune when products are loaded to avoid premature false positives
    if (products.length > 0) {
      const productIdsSet = new Set(products.map(p => p.id));
      const validSaved = currentUser.savedProductIds.filter(id => productIdsSet.has(id));
      if (validSaved.length !== currentUser.savedProductIds.length) {
        console.log(`[SavedSync] Pruned ${currentUser.savedProductIds.length - validSaved.length} stale/deleted product IDs from user saved list.`);
        setCurrentUserState(prev => prev ? { ...prev, savedProductIds: validSaved } : null);
        syncUserToServer({ ...currentUser, savedProductIds: validSaved });
      }
    }
  }, [products, currentUser?.id]);

  // Security fix (RLS-migration Phase 1, checkpoint 5): this used to be a
  // direct `updateDoc(doc('users', currentUser.id), { savedProductIds })`
  // -- dbAdapter's generic write path has no per-row ownership check, so a
  // raw Supabase caller could set ANY user's savedProductIds, not just
  // their own. Unlike the two best-effort cleanup call sites above (which
  // use syncUserToServer directly, since it swallows its own errors),
  // this is the primary user-facing save/unsave action and its existing
  // catch block needs a real failure to actually reach it -- so this
  // calls POST /api/users/sync directly rather than through
  // syncUserToServer, sending the full current user object (that endpoint
  // rebuilds the row from whatever's in the request body, so a
  // savedProductIds-only payload would wipe every other field).
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
      const authHeaders = await getAuthHeader();
      const res = await fetch('/api/users/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ user: { ...currentUser, savedProductIds: updatedSaved } })
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) {
        throw new Error(json.error || 'Failed to update saved listings.');
      }
      setCurrentUserState({ ...currentUser, savedProductIds: updatedSaved });
    } catch (err) {
      handleBackendError(err, OperationType.UPDATE, `users/${currentUser.id}`);
    }
  };

  const updateUserProfile = async (profileData: {
    username?: string;
    phoneNumber?: string;
    photoUrl?: string;
    role?: 'buyer' | 'seller' | 'both';
    whatsAppNumber?: string;
    bio?: string;
    notificationPreferences?: {
      newFollower?: boolean;
      newMessage?: boolean;
      followedSellerNewListing?: boolean;
    };
  }) => {
    if (!currentUser) return;
    
    // Support partial updates and preserve existing fields if omitted or undefined
    const finalUsername = profileData.username !== undefined ? profileData.username.trim() : (currentUser.username || '');
    const finalPhoneNumber = profileData.phoneNumber !== undefined ? (profileData.phoneNumber.trim() || undefined) : currentUser.phoneNumber;
    const finalWhatsAppNumber = profileData.whatsAppNumber !== undefined ? (profileData.whatsAppNumber.trim() || undefined) : currentUser.whatsAppNumber;
    const finalPhotoUrl = profileData.photoUrl !== undefined ? (profileData.photoUrl || undefined) : currentUser.photoUrl;
    const finalRole = profileData.role !== undefined ? profileData.role : (currentUser.role || 'both');

    // Handle bio with 160 char limit and 7-day cooldown
    let finalBio = currentUser.bio;
    let finalBioUpdatedAt = currentUser.bioUpdatedAt;
    if (profileData.bio !== undefined) {
      const trimmedBio = profileData.bio.trim().slice(0, 160);
      if (trimmedBio !== (currentUser.bio || '')) {
        const cooldownMs = 7 * 24 * 60 * 60 * 1000;
        const lastUpdatedMs = currentUser.bioUpdatedAt ? new Date(currentUser.bioUpdatedAt).getTime() : 0;
        const nextAllowedAt = lastUpdatedMs + cooldownMs;
        if (lastUpdatedMs > 0 && Number.isFinite(nextAllowedAt) && Date.now() < nextAllowedAt) {
          const daysLeft = Math.max(1, Math.ceil((nextAllowedAt - Date.now()) / (24 * 60 * 60 * 1000)));
          throw new Error(`You can change your bio again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`);
        }
        finalBio = trimmedBio;
        finalBioUpdatedAt = new Date().toISOString();
      }
    }

    // Handle notification preferences
    const finalNotificationPreferences = profileData.notificationPreferences !== undefined
      ? {
          ...(currentUser.notificationPreferences || {}),
          ...profileData.notificationPreferences,
        }
      : currentUser.notificationPreferences;

    const isStoreNameChanged = profileData.username !== undefined && finalUsername !== currentUser.username;

    if (isStoreNameChanged && !isUserAdmin(currentUser) && isReservedStoreName(finalUsername)) {
      throw new Error('This store name is reserved by TedBuy.');
    }

    const updatedUser: User = {
      ...currentUser,
      username: finalUsername,
      phoneNumber: finalPhoneNumber,
      whatsAppNumber: finalWhatsAppNumber,
      photoUrl: finalPhotoUrl,
      role: finalRole,
      bio: finalBio,
      bioUpdatedAt: finalBioUpdatedAt,
      notificationPreferences: finalNotificationPreferences
    };

    // Snapshot for rollback-on-failure below -- matches updateProduct's
    // equivalent fix. Without this, a failed persist (network error, an
    // expired session, a real server rejection) left the optimistic
    // profile change on screen indefinitely: e.g. SellerProfilePage's
    // avatar upload would show the new photo as if it saved even though
    // nothing was actually persisted, with only a console.error to say
    // otherwise -- a refresh would silently revert it with no explanation
    // of why.
    const previousUser = currentUser;

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

    if (isStoreNameChanged) {
      // 1. Update local products state
      setProducts(prevProducts => {
        return prevProducts.map(p => {
          if (p.sellerId === currentUser.id) {
            return { ...p, sellerName: finalUsername };
          }
          return p;
        });
      });

      // 2. Update local chats state
      setChats(prevChats => {
        return prevChats.map(c => {
          let changed = false;
          const updated = { ...c };
          if (c.sellerId === currentUser.id && c.sellerName !== finalUsername) {
            updated.sellerName = finalUsername;
            changed = true;
          }
          if (c.buyerId === currentUser.id && c.buyerName !== finalUsername) {
            updated.buyerName = finalUsername;
            changed = true;
          }
          return changed ? updated : c;
        });
      });

      // 3. Update local reviews state (buyerName)
      setReviews(prevReviews => {
        return prevReviews.map(r => {
          if (r.buyerId === currentUser.id) {
            return { ...r, buyerName: finalUsername };
          }
          return r;
        });
      });
    }

    // Match simulated user state and persist inside dedicated caches
    try {
      safeLocalStorage.setItem('tedbuy_simulated_user', JSON.stringify(updatedUser));
      safeLocalStorage.setItem('tedbuy_local_current_user_backup', JSON.stringify(updatedUser));
      
      const cacheStr = safeLocalStorage.getItem('tedbuy_user_profiles_cache') || '{}';
      const cache = JSON.parse(cacheStr);
      cache[updatedUser.id] = updatedUser;
      safeLocalStorage.setItem('tedbuy_user_profiles_cache', JSON.stringify(cache));
    } catch (_) {}

    // Also sync Firebase Auth SDK user profile
    if (auth.currentUser) {
      try {
        await updateProfile(auth.currentUser, {
          displayName: finalUsername,
          photoURL: finalPhotoUrl || null
        });
      } catch (authErr) {
        console.warn('[Profile Update] Failed to update Firebase Auth SDK profile:', authErr);
      }
    }

    // --- PERSIST TO DATABASE ---
    try {
      // Security fix (RLS-migration Phase 1, checkpoint 7): this used to be
      // a direct `setDoc(doc('users', currentUser.id), ..., { merge: true
      // })` -- dbAdapter's generic write path has no per-row ownership
      // check, so a raw Supabase caller could write to ANY user's row, not
      // just their own. The parallel `syncUserToServer` call right below it
      // already does the real, ownership-checked persist (`targetUid ===
      // verified.uid`, server.ts's /api/users/sync) -- but that helper
      // swallows its own errors internally (by design, for its other
      // fire-and-forget callers), so simply deleting the direct write and
      // keeping `syncUserToServer(updatedUser)` as-is would mean a real
      // persist failure silently stops reaching this function's own
      // `catch (err) { throw err }` below, and the user would see "saved"
      // even when nothing was. Calls POST /api/users/sync directly instead
      // (same shape as toggleSaveProduct's checkpoint 5 fix) so failures
      // still propagate correctly.
      const authHeaders = await getAuthHeader();
      const syncRes = await fetch('/api/users/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ user: updatedUser })
      });
      const syncJson = await syncRes.json().catch(() => ({}));
      if (!syncJson.success) {
        throw new Error(syncJson.error || 'Failed to save profile.');
      }
      console.log('[Profile Update] Server-authoritative profile sync succeeded for UID:', currentUser.id);

      // Security fix (RLS-migration Phase 1, checkpoint 18): the store-name
      // index update used to ALSO run here as a direct, unauthenticated
      // `deleteDoc`/`setDoc(doc('storeNames', ...))` pair -- dbAdapter's
      // generic write path has no per-row ownership check, so a raw
      // Supabase caller could delete or claim ANY username's store_names
      // row, unauthenticated. The new-username reservation was already
      // redundant with what POST /api/users/sync does server-side (called
      // above); the old-username cleanup this block existed for is now
      // folded into that same endpoint (server.ts), gated behind its
      // existing ownership check and scoped to the row this user actually
      // held. No client-side call needed at all anymore.

      // Best-effort update of products sellerName. Security fix (same
      // checkpoint): this used to be a direct, unauthenticated
      // `updateDoc(doc('products', p.id), { sellerName })` per product --
      // same root gap, exploitable to rename the displayed seller on ANY
      // product regardless of the client-side `sellerId === currentUser.id`
      // filter (not real access control). Routed through the existing,
      // already-ownership-checked POST /api/products/sync instead, sending
      // each product's full object (not a partial patch) to avoid the same
      // "partial payload wipes other fields" landmine already documented
      // for /api/users/sync.
      if (isStoreNameChanged) {
        const sellerProductsToUpdate = products.filter(p => p.sellerId === currentUser.id);
        if (sellerProductsToUpdate.length > 0) {
          Promise.all(
            sellerProductsToUpdate.map(p =>
              fetch('/api/products/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ product: { ...p, sellerName: finalUsername } })
              }).catch(() => {})
            )
          ).catch(() => {});
        }
      }
    } catch (err: any) {
      console.error('[Profile Update] Critical error persisting profile to the database:', err);
      setCurrentUserState(previousUser);
      setUsers(prevUsers => {
        const reverted = prevUsers.map(u => u.id === previousUser.id ? previousUser : u);
        try {
          safeLocalStorage.setItem('tedbuy_local_users_backup', JSON.stringify(reverted));
        } catch (_) {}
        return reverted;
      });
      try {
        safeLocalStorage.setItem('tedbuy_simulated_user', JSON.stringify(previousUser));
        safeLocalStorage.setItem('tedbuy_local_current_user_backup', JSON.stringify(previousUser));
        const cacheStr = safeLocalStorage.getItem('tedbuy_user_profiles_cache') || '{}';
        const cache = JSON.parse(cacheStr);
        cache[previousUser.id] = previousUser;
        safeLocalStorage.setItem('tedbuy_user_profiles_cache', JSON.stringify(cache));
      } catch (_) {}
      throw err;
    }
  };

  const deleteAccount = async (password?: string) => {
    // Previously returned silently here (resolved as success with nothing
    // done) -- if the session was already invalid by the time this ran, the
    // caller still showed "account closed and anonymized" for an account
    // never touched.
    if (!currentUser) {
      throw new Error('Your session has expired. Please sign in again before deleting your account.');
    }

    // Crucial Security Guard: Block administrator account deletion
    const userEmail = currentUser.email?.trim()?.toLowerCase();
    if (userEmail === 'asumaduvincent7@gmail.com') {
      throw new Error('Crucial Security Guard: The super-administrator account ("asumaduvincent7@gmail.com") is heavily protected and cannot be deleted under any circumstances.');
    }

    const uid = currentUser.id;
    const authUser = auth.currentUser;
    const isSimulated = !(import.meta as any).env.PROD && safeLocalStorage.getItem('tedbuy_simulated_mode') === 'true';

    // Real re-authentication before an irreversible action -- this was
    // entirely missing despite every piece being in place to do it:
    // AccountSecuritySettingsTab.tsx already collects a password and passes
    // it here (`deleteAccount(deletePasswordText)`), this function's own
    // type signature already declares an optional `password` param, and
    // EmailAuthProvider/reauthenticateWithCredential are already imported
    // into this file -- but the actual implementation never read the
    // parameter or called either import. The UI's only check was
    // `deletePasswordText.length < 6`, which any 6-character string
    // satisfies regardless of whether it's the account's real password --
    // meaning the "enter your password to confirm" step was pure security
    // theater providing zero actual protection (e.g. on a shared/unlocked
    // device) despite visibly presenting as a real safeguard.
    if (!isSimulated && authUser && authUser.email) {
      const isGoogleAuth = (authUser.providerData || []).some(p => p.providerId === 'google.com');
      if (!isGoogleAuth) {
        if (!password) {
          throw new Error('Password is required to confirm account deletion.');
        }
        try {
          const credential = EmailAuthProvider.credential(authUser.email, password);
          await reauthenticateWithCredential(authUser, credential);
        } catch (reauthErr: any) {
          throw new Error('Incorrect password. Please re-enter your password to confirm account deletion.');
        }
      }
    }

    let deletionResult: any = null;

    // 1. If not simulated, call backend soft-deletion endpoint
    if (!isSimulated && authUser) {
      const idToken = await authUser.getIdToken(true).catch(() => '');
      const res = await fetch('/api/auth/delete-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {})
        }
      });
      const data = await res.json().catch(() => ({}));
      // Correctness fix, same shape as adminToggleSecurityHold's earlier fix
      // this session: this was `!res.ok && !data.success` (both required),
      // so a 200 OK carrying `{success:false, error:...}` was never even
      // detected as a failure -- and the whole thing sat in a try/catch
      // that only console.warn'd, never rethrew. On the single highest-
      // stakes action in the app, every failure mode (network error, a
      // 500, or the above) fell through to the local cleanup below running
      // unconditionally: products marked archived, local user data wiped,
      // the user signed out, and told "closed and anonymized" -- while
      // their real account and data sat completely untouched server-side.
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Server soft-deletion workflow failed.');
      }
      deletionResult = data;
      console.log('[Account Deletion] Server soft-deletion response:', data);
    }

    // 2. Mark user's listings as archived locally
    setProducts(prev => prev.map(p => p.sellerId === uid ? { ...p, status: 'archived', isDeleted: true } : p));

    // 3. Local memory and storage cleanup
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
    if (deletionResult?.underInvestigation) {
      showToast('Account closed. In accordance with security protocols, your account is queued under compliance review.', 'info');
    } else {
      showToast('Your account has been closed and personal details have been safely anonymized.', 'success');
    }
    setCurrentView('browse');
  };

  const sendWelcomeEmailToAll = async (
    onlyUnsent: boolean, 
    onProgress: (current: number, total: number, logMsg: string) => void
  ) => {
    if (!currentUser || !currentUser.isAdmin || !isAdminSessionVerified) {
      throw new Error("Unauthorized: Only administrators can trigger bulk onboarding emails.");
    }

    // Security fix (RLS-migration Phase 0, checkpoint 1): this used to
    // filter the shared `users` state, which came from an unauthenticated
    // bulk table read and included email for that reason. Now that `users`
    // only ever carries the safe fields GET /api/users/list returns (no
    // email), this admin-only feature fetches its own admin-gated bulk
    // list with contact info instead of relying on that shared state.
    const authHeadersForList = await getAuthHeader();
    const listRes = await fetch('/api/admin/users/list-full', { headers: authHeadersForList });
    const listJson = await listRes.json().catch(() => ({}));
    if (!listJson.success || !Array.isArray(listJson.users)) {
      throw new Error(listJson.error || 'Failed to load the user list for bulk dispatch.');
    }
    const targets = (listJson.users as Array<{ id: string; email: string; username: string; welcomeSent: boolean }>)
      .filter(u => u.email && (!onlyUnsent || !u.welcomeSent));
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
          // Security fix (RLS-migration Phase 1, checkpoint 20): this used
          // to be a direct, unauthenticated `setDoc(doc('users',
          // targetUser.id), { welcomeSent: true })` per target --
          // dbAdapter's generic write path has no per-row ownership check.
          // POST /api/send-welcome-email above now sets this flag
          // server-side itself, scoped to the same email it just verified
          // and sent to, so no separate write is needed here at all.
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

  // P0 security fix: this used to cascade-delete a target user's products,
  // reviews, chats, and messages via direct, unauthenticated Supabase calls
  // (dbAdapter), gated ONLY by this client-side isSuperAdmin check -- no
  // server round-trip ever re-verified admin status before the deletion
  // ran. With Supabase RLS disabled, and users.isAdmin itself being a
  // plain, previously-client-writable column, that meant any user could
  // grant themselves isAdmin and then use this function's real UI button
  // (ProfileSettings.tsx) to delete any other account. See
  // .ai/handoffs/SUPABASE_DIRECT_ACCESS_AUDIT.md §12 for the full chain.
  // Fixed: the actual deletion now happens exclusively server-side, at
  // POST /api/admin/users/delete, which re-derives admin status from
  // verifyUser()'s cryptographic Firebase-token verification -- this
  // client-side check below is now only a fast UX rejection, never the
  // real authorization boundary.
  const adminDeleteUserProfile = async (userId: string, forceDeleteActive: boolean = false) => {
    const isSuperAdmin = (currentUser?.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com') ||
      (originalAdminUser?.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com') ||
      currentUser?.isAdmin ||
      originalAdminUser?.isAdmin;

    if (!currentUser || !isSuperAdmin) {
      throw new Error("Unauthorized: Only administrators can delete store profiles.");
    }

    const targetUser = users.find(u => u.id === userId);

    // The fast client-side "can't delete the super-admin" pre-check that
    // used to live here was removed as part of the RLS-migration Phase 0
    // work (checkpoint 1): it relied on `targetUser.email`, which the
    // shared `users` state no longer carries now that it's sourced from
    // the PII-safe GET /api/users/list instead of an unauthenticated bulk
    // table read (see the fix note on the `users`-fetching effect above).
    // This was always documented as UX-only -- /api/admin/users/delete
    // independently re-fetches the real row and re-checks the same guard
    // server-side before doing anything, so removing the client-side copy
    // has no security effect, just a slightly later error message.
    if (!forceDeleteActive) {
      throw new Error("ACTIVE_ACCOUNT_CONFIRM_REQUIRED");
    }

    const authHeaders = await getAuthHeader();
    const res = await fetch('/api/admin/users/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ targetUserId: userId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to delete user account.');
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

    showToast(data.message || `Store profile for "${targetUser?.username || userId}" permanently deleted.`, 'success');
  };
  
  // P0 security fix: same root cause as adminDeleteUserProfile above --
  // this used to write isSuspended directly to Supabase (both via
  // dbAdapter's updateDoc AND a redundant raw supabase.from() call),
  // gated only by the client-side isSuperAdmin check below. Now
  // delegates the actual mutation to POST /api/admin/users/suspend,
  // which independently re-verifies admin status server-side.
  const adminToggleUserSuspension = async (userId: string, suspend: boolean) => {
    const isSuperAdmin = (currentUser?.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com') ||
      (originalAdminUser?.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com') ||
      currentUser?.isAdmin ||
      originalAdminUser?.isAdmin;

    if (!currentUser || !isSuperAdmin) {
      throw new Error("Unauthorized: Only verified administrators can suspend or unsuspend store profiles.");
    }

    const targetUser = users.find(u => u.id === userId);

    // Same removal, same reason as adminDeleteUserProfile above (checkpoint
    // 1 of RLS-migration Phase 0): the client-side super-admin guard needed
    // `targetUser.email`, which the shared `users` state no longer carries.
    // /api/admin/users/suspend already independently re-verifies the same
    // guard against the real row.

    const authHeaders = await getAuthHeader();
    const res = await fetch('/api/admin/users/suspend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ targetUserId: userId, suspend }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update suspension status.');
    }

    // Update local state to reflect the server's confirmed result
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, isSuspended: suspend } : u));

    if (currentUser && currentUser.id === userId) {
      setCurrentUserState(prev => prev ? { ...prev, isSuspended: suspend } : null);
    }

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

    showToast(data.message || `User "${targetUser?.username || userId}" has been successfully ${suspend ? 'suspended' : 'unsuspended'}.`, 'success');
  };

  const adminToggleSecurityHold = async (userId: string, hold: boolean, reason?: string) => {
    const isSuperAdmin = (currentUser?.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com') ||
      (originalAdminUser?.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com') ||
      currentUser?.isAdmin ||
      originalAdminUser?.isAdmin;

    if (!currentUser || !isSuperAdmin) {
      throw new Error("Unauthorized: Only verified administrators can place or release security holds.");
    }

    const targetUser = users.find(u => u.id === userId);
    if (!targetUser) {
      throw new Error("User profile not found in system.");
    }

    // Same removal, same reason as adminDeleteUserProfile above -- and this
    // one used to be the ONLY check preventing a security hold on the
    // super-admin account at all (unlike delete/suspend, the server
    // endpoint had no independent re-check of its own). Fixed on the
    // server side in this same checkpoint (see
    // /api/admin/accounts/security-hold), so the real enforcement doesn't
    // depend on this client-side copy either.
    console.log(`[Admin Security Hold] Setting hold=${hold} for ${targetUser.username} (${userId})`);

    const adminAuthHeader = await getAuthHeader();
    const res = await fetch('/api/admin/accounts/security-hold', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(adminAuthHeader ? { 'Authorization': adminAuthHeader['Authorization'] } : {}),
        'x-admin-email': currentUser.email || 'admin'
      },
      body: JSON.stringify({
        targetUserId: userId,
        hold,
        reason: reason || 'Administrative compliance review'
      })
    });
    const data = await res.json().catch(() => ({}));
    // Correctness fix: this used to be `!res.ok && !data.success` (both
    // must be true to count as a failure), which a 200 OK response
    // carrying `{success:false, error:...}` -- a normal "handled"
    // business-logic rejection -- satisfies neither half of, so it was
    // never even detected as an error. The whole check was then also
    // wrapped in a try/catch that only console.warn'd, never rethrew --
    // meaning ANY failure (this one, a network error, a 500) fell through
    // to the code below unconditionally updating local state to show the
    // hold as applied and toasting "Security hold placed" success, on a
    // fraud/security control an admin relies on to actually be true.
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update security hold on server.');
    }

    // Update local state
    setUsers(prev => prev.map(u => u.id === userId ? {
      ...u,
      securityHold: hold,
      securityHoldReason: hold ? (reason || 'Placed on administrative hold') : undefined,
      status: hold ? 'under_investigation' : (u.isDeleted ? 'deleted' : 'active')
    } : u));

    showToast(hold ? `Security hold placed on "${targetUser.username}".` : `Security hold released for "${targetUser.username}".`, 'success');
  };

  const addReview = async (sellerId: string, rating: number, comment: string, productTitle?: string, chatId?: string) => {
    if (!currentUser) {
      throw new Error('Authentication Required: You must be logged in to submit reviews.');
    }

    // 1. Client-side rate limit check — fast local feedback only; the
    // server has its own rate limiter as the real enforcement.
    const rLimit = checkClientRateLimit('submit_review', currentUser.id);
    if (!rLimit.allowed) {
      throw new Error(`Rate limit exceeded: You can only submit 3 reviews within 5 minutes. Please try again in ${rLimit.remainingSecs} seconds.`);
    }

    // 2. Input sanitization and validation (same rules the server also
    // enforces — this just gives the user a faster error than a round trip).
    const cleanComment = sanitizeText(comment);
    if (cleanComment.length < 5 || cleanComment.length > 1000) {
      throw new Error('Comment must be between 5 and 1000 characters long.');
    }
    if (rating < 1 || rating > 5) {
      throw new Error('Review rating must be between 1 and 5 stars.');
    }

    // 3. Routed through the server (POST /api/reviews/create), NOT a direct
    // database write like this used to be. A review is only authentic if
    // it's tied to a trade that actually completed — the server requires
    // chatId, verifies it's a chat between this buyer and this seller with
    // tradeStatus:'completed', and derives productTitle from that chat
    // itself rather than trusting whatever string the client sends. A
    // direct write here had no way to enforce any of that (Supabase RLS /
    // Firestore rules only ever checked ownership and rating range), which
    // was exactly how a visitor could tap into any seller's store page and
    // post a review with zero evidence they ever traded with them.
    const authHeaders = await getAuthHeader();
    const res = await fetch('/api/reviews/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ sellerId, rating: Math.floor(rating), comment: cleanComment, productTitle, chatId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.success) {
      throw new Error(data.error || 'Failed to submit review.');
    }
    setReviews(prev => [data.review as Review, ...prev]);
  };

  const addRecentQuery = (queryText: string) => {
    const trimmed = queryText.trim();
    if (!trimmed) return;
    setRecentSearches(prev => {
      const filtered = prev.filter(q => q.toLowerCase() !== trimmed.toLowerCase());
      const updated = [trimmed, ...filtered].slice(0, 6);
      try {
        safeLocalStorage.setItem('tedbuy_recent_searches', JSON.stringify(updated));
      } catch (_) {}
      return updated;
    });
  };

  const removeRecentQuery = (queryText: string) => {
    const trimmed = queryText.trim();
    setRecentSearches(prev => {
      const updated = prev.filter(q => q.toLowerCase() !== trimmed.toLowerCase());
      try {
        safeLocalStorage.setItem('tedbuy_recent_searches', JSON.stringify(updated));
      } catch (_) {}
      return updated;
    });
  };

  const clearRecentSearches = () => {
    setRecentSearches([]);
    try {
      safeLocalStorage.removeItem('tedbuy_recent_searches');
    } catch (_) {}
  };

  const clearRecentlyViewed = () => {
    setRecentlyViewedIds([]);
    try {
      safeLocalStorage.removeItem('tedbuy_recently_viewed_ids');
    } catch {}
  };

  const refreshProducts = async () => {
    setIsProductsLoading(true);
    currentProductPageRef.current = 1;
    try {
      const hasSearchTerm = Boolean(debouncedSearchQuery && debouncedSearchQuery.trim().length > 0);
      const hasCategoryFilter = Boolean(selectedCategory !== null && (selectedCategory as string) !== 'All');

      let url = '/api/products?page=1&limit=24&nocache=true';
      if (hasSearchTerm || hasCategoryFilter) {
        url = '/api/products?page=1&limit=1000&nocache=true';
        if (hasSearchTerm) {
          url += `&q=${encodeURIComponent(debouncedSearchQuery.trim())}`;
        }
        if (hasCategoryFilter && selectedCategory) {
          url += `&category=${encodeURIComponent(selectedCategory)}`;
        }
      }

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.products)) {
          const sorted = data.products
            .filter(isRealProduct)
            .map(normalizeProduct)
            .sort((a: Product, b: Product) => {
              const dateA = typeof a?.createdAt === 'string' ? a.createdAt : '';
              const dateB = typeof b?.createdAt === 'string' ? b.createdAt : '';
              return dateB.localeCompare(dateA);
            });
          setProducts(sorted);
          setProductsLoadError(false);
          if (hasSearchTerm || hasCategoryFilter) {
            const moreAvailable = typeof data.hasMore === 'boolean'
              ? data.hasMore
              : (data.page < data.totalPages && data.products.length > 0);
            setHasMoreProducts(moreAvailable);
          } else {
            setHasMoreProducts(false);
          }
          try {
            safeLocalStorage.setItem('tedbuy_local_products_backup', JSON.stringify(sorted));
          } catch (_) {}
          return;
        }
      }

      setProducts(prev => {
        if (prev.length > 0) {
          setProductsLoadError(false);
          return prev;
        }
        setProductsLoadError(true);
        return [];
      });
    } catch (err) {
      console.error('Error manually refreshing products:', err);
      setProducts(prev => {
        if (prev.length > 0) {
          setProductsLoadError(false);
          return prev;
        }
        setProductsLoadError(true);
        return [];
      });
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

  const loadMoreProducts = useCallback(async () => {
    const hasSearchTerm = Boolean(debouncedSearchQuery && debouncedSearchQuery.trim().length > 0);
    const hasCategoryFilter = Boolean(selectedCategory !== null && (selectedCategory as string) !== 'All');

    // In All Categories view without active search/category, no additional items are loaded on scroll
    if (!hasSearchTerm && !hasCategoryFilter) {
      setHasMoreProducts(false);
      return;
    }

    if (isFetchingMoreProductsRef.current || !hasMoreProducts || isProductsLoading) {
      return;
    }

    isFetchingMoreProductsRef.current = true;
    setIsLoadingMoreProducts(true);

    const nextPage = currentProductPageRef.current + 1;

    try {
      let url = `/api/products?page=${nextPage}&limit=50`;
      if (hasSearchTerm) {
        url += `&q=${encodeURIComponent(debouncedSearchQuery.trim())}`;
      }
      if (hasCategoryFilter && selectedCategory) {
        url += `&category=${encodeURIComponent(selectedCategory)}`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`/api/products page ${nextPage} returned status ${res.status}`);
      }
      const data = await res.json();
      if (data && Array.isArray(data.products)) {
        const incoming = data.products as Product[];
        if (incoming.length > 0) {
          setProducts(prev => {
            const existingIds = new Set(prev.map(p => String(p.id)));
            const uniqueIncoming = incoming.filter(p => p && p.id && !existingIds.has(String(p.id)));
            if (uniqueIncoming.length === 0) return prev;
            const combined = [...prev, ...uniqueIncoming];
            const map = new Map<string, Product>();
            combined.forEach((item: any) => {
              if (!optimisticDeletedProductIdsRef.current.has(item.id) && isRealProduct(item)) {
                map.set(item.id, normalizeProduct(item));
              }
            });
            const pList = Array.from(map.values());
            return pList.sort((a, b) => {
              const dateA = typeof a?.createdAt === 'string' ? a.createdAt : '';
              const dateB = typeof b?.createdAt === 'string' ? b.createdAt : '';
              return dateB.localeCompare(dateA);
            });
          });
          currentProductPageRef.current = nextPage;
        }

        const moreAvailable = typeof data.hasMore === 'boolean'
          ? data.hasMore
          : (data.page < data.totalPages && incoming.length > 0);
        setHasMoreProducts(moreAvailable);
      } else {
        setHasMoreProducts(false);
      }
    } catch (err) {
      console.warn(`[Product Loading] Failed to fetch page ${nextPage}:`, err);
    } finally {
      isFetchingMoreProductsRef.current = false;
      setIsLoadingMoreProducts(false);
    }
  }, [hasMoreProducts, isProductsLoading, selectedCategory, debouncedSearchQuery]);

  // Memoized user profile state to resolve store-name flicking issue by prioritizing cached database documents over Auth properties during handshake
  const memoizedCurrentUser = useMemo(() => {
    if (!currentUser) return null;

    const isBaseAdmin = currentUser.email?.trim()?.toLowerCase() === 'asumaduvincent7@gmail.com' || currentUser.isAdmin;

    let resolvedUser = { ...currentUser };
    try {
      // Prioritize the long-lived cache of database user documents
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
            bio: currentUser.bio !== undefined ? currentUser.bio : cachedDoc.bio,
            bioUpdatedAt: currentUser.bioUpdatedAt !== undefined ? currentUser.bioUpdatedAt : cachedDoc.bioUpdatedAt,
            notificationPreferences: currentUser.notificationPreferences !== undefined ? currentUser.notificationPreferences : cachedDoc.notificationPreferences,
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
      resetAppToZero,
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
      sendTypingStatus,
      markChatAsRead,
      markAsDelivered,
      markAsPickedUp,
      deleteChatForMe,
      deleteMessageForMe,
      deletedChatIds,
      deletedMessageIds,
      followSeller,
      unfollowSeller,
      toggleSaveProduct,
      updateUserProfile,
      refreshUserProfile,
      deleteAccount,
      adminDeleteUserProfile,
      adminToggleUserSuspension,
      adminToggleSecurityHold,
      impersonationSession,
      isImpersonating,
      originalAdminUser,
      startImpersonation,
      exitImpersonation,
      getAuthHeader,
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
      removeRecentQuery,
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
      registerProduct,
      notifications,
      markNotificationAsRead,
      markAllNotificationsAsRead,
      clearAllNotifications,
      productLimit,
      hasMoreProducts,
      isLoadingMoreProducts,
      loadMoreProducts,
      deferredPrompt,
      setDeferredPrompt,
      canInstall,
      setCanInstall,
      triggerPWAInstall,
      isStandalone,
      isBottomNavVisible,
      setIsBottomNavVisible,
      sellerListingCounts,
      refreshSellerCounts
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
