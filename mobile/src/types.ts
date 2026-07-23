export interface Product {
  id: string;
  title: string;
  price: string | number;
  category?: string;
  location?: string;
  image?: string;
  images?: string[];
  description?: string;
  seller?: string;
  sellerId?: string;
  sellerName?: string;
  sellerRating?: number;
  likes?: number;
  likesCount?: number;
  negotiable?: boolean;
  condition?: string;
  createdAt?: string;
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

export interface UserProfile {
  id: string;
  name: string;
  username: string;
  rating: number;
  listings: number;
  joined: string;
  bio: string;
}

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
