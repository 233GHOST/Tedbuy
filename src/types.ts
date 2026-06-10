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
}

export const isUserVerified = (user?: User | null): boolean => {
  if (!user) return false;
  
  // Completed Profile Setup check
  const hasUsername = !!(user.username && user.username.trim().length >= 3);
  const hasPhone = !!(user.phoneNumber && user.phoneNumber.trim().length >= 7);

  return hasUsername && hasPhone;
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
  | 'Trending'
  | 'Property'
  | 'Food'
  | 'Home'
  | 'Furniture'
  | 'Repair and Construction'
  | 'Beauty and Care'
  | 'Electronics'
  | 'Jobs & Services'
  | 'Services'
  | 'Animals & Pets'
  | 'Books & Education'
  | 'Sports & Outdoors'
  | 'Toys & Games'
  | 'Agriculture & Foodstuff'
  | 'Health & Fitness'
  | 'Commercial Equipment'
  | 'Art & Crafts'
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
  negotiable?: boolean;
  createdAt: string;
  viewsCount: number;
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

export function normalizeCategory(cat: string): Category {
  if (!cat) return 'Other';
  const clean = cat.trim().toLowerCase();
  if (clean === 'phone' || clean === 'phones') return 'Phones';
  if (clean === 'laptop' || clean === 'laptops') return 'Laptops';
  if (clean === 'fashion') return 'Fashion';
  if (clean === 'home appliance' || clean === 'home appliances' || clean === 'appliances' || clean === 'appliance') return 'Home Appliances';
  if (clean === 'vehicle' || clean === 'vehicles') return 'Vehicles';
  if (clean === 'other' || clean === 'others') return 'Other';
  if (clean === 'trending' || clean === 'trending list') return 'Trending';
  if (clean === 'property' || clean === 'properties' || clean === 'real estate') return 'Property';
  if (clean === 'food' || clean === 'foods' || clean === 'foodstuff') return 'Food';
  if (clean === 'home') return 'Home';
  if (clean === 'furniture') return 'Furniture';
  if (clean === 'repair and construction' || clean === 'repair & construction' || clean === 'repair' || clean === 'construction') return 'Repair and Construction';
  if (clean === 'beauty and care' || clean === 'beauty & care' || clean === 'beauty' || clean === 'care') return 'Beauty and Care';
  if (clean === 'electronics' || clean === 'electronic') return 'Electronics';
  if (clean === 'jobs & services' || clean === 'jobs and services' || clean === 'jobs' || clean === 'job') return 'Jobs & Services';
  if (clean === 'services' || clean === 'service') return 'Services';
  if (clean === 'animals & pets' || clean === 'animals and pets' || clean === 'pets' || clean === 'pet' || clean === 'animals' || clean === 'animal') return 'Animals & Pets';
  if (clean === 'books & education' || clean === 'books and education' || clean === 'books' || clean === 'education' || clean === 'book') return 'Books & Education';
  if (clean === 'sports & outdoors' || clean === 'sports and outdoors' || clean === 'sports' || clean === 'sport' || clean === 'outdoors') return 'Sports & Outdoors';
  if (clean === 'toys & games' || clean === 'toys and games' || clean === 'toys' || clean === 'games' || clean === 'game') return 'Toys & Games';
  if (clean === 'agriculture & foodstuff' || clean === 'agriculture and foodstuff' || clean === 'agriculture' || clean === 'farming') return 'Agriculture & Foodstuff';
  if (clean === 'health & fitness' || clean === 'health and fitness' || clean === 'health' || clean === 'fitness') return 'Health & Fitness';
  if (clean === 'commercial equipment' || clean === 'commercial equipments' || clean === 'equipment') return 'Commercial Equipment';
  if (clean === 'art & crafts' || clean === 'art and crafts' || clean === 'art' || clean === 'crafts' || clean === 'craft') return 'Art & Crafts';

  const knownCategories: Category[] = [
    'Phones',
    'Laptops',
    'Fashion',
    'Home Appliances',
    'Vehicles',
    'Trending',
    'Property',
    'Food',
    'Home',
    'Furniture',
    'Repair and Construction',
    'Beauty and Care',
    'Electronics',
    'Jobs & Services',
    'Services',
    'Animals & Pets',
    'Books & Education',
    'Sports & Outdoors',
    'Toys & Games',
    'Agriculture & Foodstuff',
    'Health & Fitness',
    'Commercial Equipment',
    'Art & Crafts',
    'Other'
  ];

  const found = knownCategories.find(c => c.toLowerCase() === clean);
  return found || 'Other';
}

