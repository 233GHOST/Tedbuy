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
}

export type UserProfile = User;

export const isUserVerified = (user?: User | UserProfile | null): boolean => {
  if (!user) return false;
  return !!(user as any).emailVerified || !!(user as any).isVerified;
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
};

export type MainTabsParamList = {
  Home: undefined;
  Search: undefined;
  Sell: undefined;
  Chats: undefined;
  Profile: undefined;
};
