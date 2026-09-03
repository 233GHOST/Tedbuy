export interface Product {
  id: string;
  title: string;
  price: string | number;
  category?: string;
  location?: string;
  brand?: string;
  image?: string;
  images?: string[];
  displayImage?: string;
  thumbnailUrl?: string;
  primaryImage?: string;
  description?: string;
  seller?: string;
  sellerId?: string;
  sellerName?: string;
  sellerPhoto?: string;
  sellerAvatar?: string;
  sellerRating?: number;
  isVerified?: boolean;
  sellerVerified?: boolean;
  likes?: number;
  likesCount?: number;
  viewsCount?: number;
  views?: number;
  negotiable?: boolean;
  isExchangeable?: boolean;
  exchangePossible?: boolean;
  condition?: string;
  createdAt?: string;
  isSold?: boolean;
  boostStatus?: string;
  boostEndDate?: string;
  boostStartDate?: string;
  boostPlan?: string;
  lastBoostedAt?: string;
  likedUserIds?: string[];
  videos?: string[];
}

export interface ChatItem {
  id: string;
  name: string;
  lastMessage: string;
  time: string;
  unread?: number;
  avatar: string;
}

export interface User {
  id: string;
  username?: string;
  displayName?: string;
  email?: string;
  phoneNumber?: string;
  photoUrl?: string;
  joinDate?: string;
  role?: string;
  isAdmin?: boolean;
  emailVerified?: boolean;
  isVerified?: boolean;
  isGoogleAuth?: boolean;
  region?: string;
  location?: string;
  rating?: number;
  reviewCount?: number;
  followingSellers?: string[];
  savedProductIds?: string[];
  bio?: string;
  bioUpdatedAt?: string;
  isSuspended?: boolean;
  isOnline?: boolean;
  lastSeen?: string;
  lastLogin?: string;
  visitCount?: number;
  notificationPreferences?: {
    newFollower?: boolean;
    newMessage?: boolean;
    followedSellerNewListing?: boolean;
  };
}

export type UserProfile = User;

export const isUserVerified = (user?: User | UserProfile | null): boolean => {
  if (!user) return false;
  return !!(user as any).emailVerified || !!(user as any).isVerified;
};

/** Matches web's calculateTrustScore (src/types.ts) exactly — same inputs
 * produce the same score, so a seller's trust rating agrees across platforms. */
export const calculateTrustScore = (
  seller?: User | UserProfile | any | null,
  sellerReviews: Review[] = []
): { score: number; level: string; feedback: string } => {
  if (!seller) return { score: 0, level: 'Unrated', feedback: 'No seller record.' };

  const isVerified = isUserVerified(seller);
  let score = isVerified ? 80 : 55;

  const totalReviews = sellerReviews.length;
  if (totalReviews > 0) {
    const positiveReviews = sellerReviews.filter((r) => r.rating >= 4);
    const negativeReviews = sellerReviews.filter((r) => r.rating <= 2);
    score += positiveReviews.length * 5;
    score -= negativeReviews.length * 15;
  }

  score = Math.max(30, Math.min(100, score));

  let level = 'Standard';
  let feedback = 'Profile details are registered. Trade safely with community agreements.';

  if (score >= 90) {
    level = 'Excellent Quality';
    feedback = 'Immaculate feedback & completed marketplace standards.';
  } else if (score >= 75) {
    level = 'High Confidence';
    feedback = 'Verified profile, solid ratings & active service.';
  } else if (score >= 50) {
    level = 'Fair Rank';
    feedback = 'Ready for transactions. Complete profiles or obtain positive feedback.';
  } else {
    level = 'Caution';
    feedback = 'Minimal profile data or unsatisfactory ratings. Use caution.';
  }

  return { score, level, feedback };
};

export const isUserAdmin = (user?: User | UserProfile | any | null): boolean => {
  if (!user) return false;
  return user.isAdmin === true || (user.email ? user.email.trim().toLowerCase() === 'asumaduvincent7@gmail.com' : false);
};

export const isReservedStoreName = (name?: string | null): boolean => {
  if (!name) return false;
  const normalized = name.trim().toLowerCase().replace(/[\s\-_]+/g, '');
  return normalized.includes('tedbuy');
};

export type RootStackParamList = {
  MainTabs: undefined;
  ProductDetail: { productId: string };
  SellerProfile: { sellerId: string };
  FollowersFollowing: { userId: string; initialTab?: 'followers' | 'following' };
  FeaturedListings: { category?: string } | undefined;
  DiscoverSellers: undefined;
  TrendingListings: undefined;
  SavedProducts: undefined;
  ForYou: undefined;
  AccountSecuritySettings: undefined;
  ProfileStoreSettings: undefined;
  NotificationSettings: undefined;
  SellingBuyingSettings: undefined;
  HelpSupportSettings: undefined;
};

export interface Review {
  id: string;
  sellerId: string;
  buyerId: string;
  buyerName: string;
  buyerPhoto?: string;
  rating: number; // 1 to 5
  comment: string;
  createdAt: string;
  productTitle?: string;
}

export type MainTabsParamList = {
  Home: { resetToGrid?: number; category?: string; search?: string; location?: string } | undefined;
  Search: undefined;
  Sell: { editProduct?: Product } | undefined;
  Chats: { activeChatId?: string } | undefined;
  Profile: { tab?: 'dashboard' | 'settings' } | undefined;
};
