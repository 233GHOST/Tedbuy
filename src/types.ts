export interface User {
  id: string;
  username: string;
  email?: string;
  phoneNumber?: string;
  photoUrl?: string;
  joinDate: string;
  role: 'buyer' | 'seller' | 'both';
  followingSellers?: string[]; // IDs of sellers this user follows
  savedProductIds?: string[]; // Bookmarked product IDs
  whatsAppNumber?: string;
  isAdmin?: boolean;
  welcomeSent?: boolean;
  emailVerified?: boolean;
  isGoogleAuth?: boolean;
  authProvider?: string;
  isSuspended?: boolean;
  fcmTokens?: string[];
  visitCount?: number;
  rapidPostScore?: number;
  lastLogin?: string; // ISO string
  lastSeen?: string; // ISO string
  isOnline?: boolean;
}

export const isUserVerified = (user?: User | null): boolean => {
  if (!user) return false;
  return !!user.emailVerified;
};

export const calculateTrustScore = (
  seller?: User | null,
  sellerReviews: Review[] = []
): { score: number; level: string; color: string; feedback: string; labelClass: string } => {
  if (!seller) return { score: 0, level: 'Unrated', color: 'text-slate-400 bg-slate-150', labelClass: 'text-slate-600 bg-slate-100', feedback: 'No seller record.' };

  const isVerified = isUserVerified(seller);
  let score = isVerified ? 80 : 55; // verified profile boosts confidence instantly

  // Factor in reviews
  const totalReviews = sellerReviews.length;
  if (totalReviews > 0) {
    const positiveReviews = sellerReviews.filter(r => r.rating >= 4);
    const negativeReviews = sellerReviews.filter(r => r.rating <= 2);
    
    // Each positive review adds to trust
    score += positiveReviews.length * 5;
    
    // Each negative review heavily penalizes trust
    score -= negativeReviews.length * 15;
  }

  // Constrain between 30 and 100
  score = Math.max(30, Math.min(100, score));

  let level = 'Standard';
  let color = 'bg-blue-50 border-blue-200/60 text-blue-850';
  let labelClass = 'bg-blue-600 text-white';
  let feedback = 'Profile details are registered. Trade safely with community agreements.';

  if (score >= 90) {
    level = 'Excellent Quality';
    color = 'bg-emerald-50 border-emerald-250/50 text-emerald-900';
    labelClass = 'bg-emerald-600 text-white';
    feedback = 'Immaculate feedback & completed marketplace standards.';
  } else if (score >= 75) {
    level = 'High Confidence';
    color = 'bg-indigo-50 border-indigo-250/30 text-indigo-900';
    labelClass = 'bg-indigo-600 text-white';
    feedback = 'Verified profile, solid ratings & active service.';
  } else if (score >= 50) {
    level = 'Fair Rank';
    color = 'bg-amber-50 border-amber-250/40 text-amber-900';
    labelClass = 'bg-amber-500 text-white';
    feedback = 'Ready for transactions. Complete profiles or obtain positive feedback.';
  } else {
    level = 'Caution';
    color = 'bg-rose-50 border-rose-250/40 text-rose-900';
    labelClass = 'bg-rose-650 text-white';
    feedback = 'Minimal profile data or unsatisfactory ratings. Use caution.';
  }

  return { score, level, color, feedback, labelClass };
};

export type Category =
  | 'Phones'
  | 'Laptops'
  | 'Fashion'
  | 'Home Appliances'
  | 'Vehicles'
  | 'Property'
  | 'Beauty and Care'
  | 'Games'
  | 'Electronics'
  | 'Services'
  | 'Other';

export interface Product {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerPhoto?: string;
  sellerJoinDate: string;
  title: string;
  description: string;
  price: string | number;
  category: Category;
  location: string;
  brand?: string;
  condition?: string;
  images: string[]; // 1 to 10 images (urls or base64)
  videos?: string[]; // Optional: 1 to 2 videos (urls or base64)
  primaryPicture?: string;
  primaryVideo?: string;
  negotiable?: boolean;
  createdAt: string;
  viewsCount: number;
  isSold?: boolean;
  likesCount?: number;
  likedUserIds?: string[];
  
  // Boost ad fields
  boostStatus?: boolean;
  boostPlan?: string;
  boostStartDate?: string;
  boostEndDate?: string;
  paymentStatus?: 'pending' | 'success' | 'failed' | 'cancelled';
  paymentReference?: string;
  boostPriority?: number;
  priorityScore?: number;
  lastBoostedAt?: string;
  boostAmount?: number;
  boostPackagePrice?: number;
  boostPriorityLevel?: number;
  remainingBoostTime?: number;
  lastBoostPurchase?: string;
  boostHistory?: {
    planId: string;
    planName: string;
    startDate: string;
    endDate: string;
    paymentReference: string;
    amount: number;
    gateway?: string;
    paymentMethod?: string;
    createdAt?: string;
  }[];
}

export interface Chat {
  id: string;
  productId: string;
  productTitle: string;
  productPrice: string | number;
  productImage: string;
  buyerId: string;
  sellerId: string;
  buyerName: string;
  sellerName: string;
  lastMessageText: string;
  lastMessageTime: string;
  deliveredBySeller?: boolean;
  pickedUpByBuyer?: boolean;
  tradeStatus?: 'pending' | 'delivered' | 'completed';
  adId?: string;
  adTitle?: string;
  adImage?: string;
  adThumbnail?: string;
  adType?: 'image' | 'video';
  videoPoster?: string;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  recipientId: string;
  text: string;
  createdAt: string;
  read: boolean;
}

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

export function normalizeCategory(cat: any): Category {
  if (!cat) return 'Other';
  const clean = String(cat).trim().toLowerCase();
  
  // High-priority exact or robust matching for Beauty and Care
  if (
    clean.includes('beauty') || 
    clean.includes('makeup') || 
    clean.includes('cosmetic') || 
    clean === 'care' || 
    clean === 'beauty and care' || 
    clean === 'beauty & care' || 
    clean === 'beauty care' || 
    clean === 'beautycare' ||
    clean === 'skin care' ||
    clean === 'eyecare' ||
    clean === 'haircare' ||
    clean === 'hygiene'
  ) {
    return 'Beauty and Care';
  }

  if (clean === 'phone' || clean === 'phones' || clean.includes('phone')) return 'Phones';
  if (clean === 'laptop' || clean === 'laptops' || clean.includes('laptop') || clean.includes('notebook')) return 'Laptops';
  if (clean === 'fashion' || clean.includes('fashion') || clean.includes('cloth') || clean.includes('wear')) return 'Fashion';
  if (clean === 'home appliance' || clean === 'home appliances' || clean === 'appliances' || clean === 'appliance' || clean.includes('appliance') || clean.includes('fridge') || clean.includes('microwave') || clean.includes('washing machine')) return 'Home Appliances';
  if (clean === 'vehicle' || clean === 'vehicles' || clean === 'car' || clean === 'cars' || clean.includes('vehicle')) return 'Vehicles';
  if (clean === 'game' || clean === 'games' || clean.includes('game') || clean.includes('playstation') || clean.includes('xbox') || clean.includes('nintendo') || clean.includes('console') || clean.includes('fifa')) return 'Games';
  if (clean === 'electronics' || clean === 'electronic' || clean.includes('electronic') || clean.includes('tv') || clean.includes('television') || clean.includes('audio') || clean.includes('speaker') || clean.includes('headphone') || clean.includes('camera')) return 'Electronics';
  if (clean === 'service' || clean === 'services' || clean.includes('service') || clean.includes('job') || clean.includes('freelance') || clean.includes('work') || clean.includes('repair')) return 'Services';
  if (clean === 'property' || clean === 'properties' || clean === 'real estate' || clean.includes('house') || clean.includes('land') || clean.includes('apartment') || clean.includes('room')) return 'Property';
  if (clean === 'other' || clean === 'others') return 'Other';

  const knownCategories: Category[] = [
    'Phones',
    'Laptops',
    'Fashion',
    'Home Appliances',
    'Vehicles',
    'Property',
    'Beauty and Care',
    'Games',
    'Electronics',
    'Services',
    'Other'
  ];

  const found = knownCategories.find(c => c.toLowerCase() === clean);
  return found || 'Other';
}

export interface AppNotification {
  id: string;
  userId: string; // The user who receives the notification
  type: 'post_created' | 'new_follower' | 'new_message';
  title: string;
  message: string;
  triggerUserId: string; // The user who made the post or sent the message
  triggerUsername: string;
  triggerUserPhoto?: string;
  productId: string; // The product that was posted
  productTitle: string;
  productPrice: string | number;
  productImage: string;
  createdAt: string;
  read: boolean;
  chatId?: string;
}


