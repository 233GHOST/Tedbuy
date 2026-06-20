import { Product, Category, User } from '../types';
import { getRegionForLocation } from '../regions';

function parseNumericPrice(p: string | number): number {
  if (typeof p === 'number') return p;
  if (!p) return 0;
  const cleaned = String(p).replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Calculates a dynamic priority score for a seller.
 * Considers visit count, stay time (activeSeconds), and rapid posting frequency.
 */
export function getSellerPriorityScore(sellerId: string, users: User[] = [], allProducts: Product[] = []): number {
  if (!sellerId) return 0;
  const safeUsers = Array.isArray(users) ? users : [];
  const safeProducts = Array.isArray(allProducts) ? allProducts : [];

  const seller = safeUsers.find(u => u && u.id === sellerId);
  if (!seller) return 0;

  const rawVisit = typeof seller.visitCount === 'number' ? seller.visitCount : 0;
  const visitCount = Number.isFinite(rawVisit) ? rawVisit : 0;

  const rawActive = typeof seller.activeSeconds === 'number' ? seller.activeSeconds : 0;
  const activeSeconds = Number.isFinite(rawActive) ? rawActive : 0;

  // 1. Visit Count Score: 15 points per visit (cap at 300)
  const visitScore = Math.min(300, visitCount * 15);

  // 2. Playtime / Stay-time Score: 1 point per 5 seconds spent (cap at 600)
  const stayScore = Math.min(600, activeSeconds / 5);

  // 3. Rapid Posting Check:
  // Count how many products they posted in the last 48 hours
  const now = Date.now();
  const fortyEightHoursAgo = now - 48 * 60 * 60 * 1000;
  const sellerProds = safeProducts.filter(p => p && p.sellerId === sellerId);
  
  // Sort timestamps of their products (newest first)
  const sortedTimes = sellerProds
    .map(p => p.createdAt ? new Date(p.createdAt).getTime() : 0)
    .filter(t => t > 0)
    .sort((a, b) => b - a);

  let rapidPosterScore = 0;
  let isRapidPoster = false;

  // If they have posted 2 or more products, check interval pacing
  if (sortedTimes.length >= 2) {
    for (let i = 0; i < sortedTimes.length - 1; i++) {
      const intervalMs = sortedTimes[i] - sortedTimes[i + 1];
      const intervalHours = intervalMs / (1000 * 60 * 60);
      if (intervalHours > 0 && intervalHours <= 3) {
        // Posted within 3 hours of previous post!
        isRapidPoster = true;
        rapidPosterScore += 150; // extra boost
      } else if (intervalHours > 0 && intervalHours <= 24) {
        // Posted within 24 hours of previous post!
        isRapidPoster = true;
        rapidPosterScore += 50;
      }
    }
  }

  // Recent posts density:
  const recentPostsCount = sortedTimes.filter(t => t >= fortyEightHoursAgo).length;
  if (recentPostsCount >= 2) {
    isRapidPoster = true;
    rapidPosterScore += recentPostsCount * 40;
  }

  // Combine into a total score
  const totalScore = visitScore + stayScore + rapidPosterScore;

  // If seller meets any significant activity threshold, give them a massive premium weight (+10000)
  // so their listings always jump to the front of standard listings page and video ads stream
  const isPrioritySeller = (visitCount >= 4) || (activeSeconds >= 120) || isRapidPoster;
  
  if (isPrioritySeller) {
    return 10000 + totalScore;
  }
  
  return totalScore;
}

/**
 * A highly optimized memoized selector scope for product filters and sorting.
 * Employs referential identity preservation when content records are equivalent.
 */
export function createProductSelector() {
  let lastProducts: Product[] = [];
  let lastCategory: Category | null = null;
  let lastQuery = '';
  let lastRegion = 'All';
  let lastCity = 'All';
  let lastMin = '';
  let lastMax = '';
  let lastSortByPrice: 'default' | 'asc' | 'desc' = 'default';
  let lastSortByAds: 'newest' | 'oldest' = 'newest';
  let lastUsers: User[] = [];
  
  let cachedSorted: Product[] = [];

  return (
    products: Product[],
    category: Category | null,
    queryText: string,
    region: string,
    city: string,
    minPrice: string,
    maxPrice: string,
    sortByPrice: 'default' | 'asc' | 'desc',
    sortByAds: 'newest' | 'oldest',
    users: User[] = []
  ): Product[] => {
    if (
      lastProducts === products &&
      lastCategory === category &&
      lastQuery === queryText &&
      lastRegion === region &&
      lastCity === city &&
      lastMin === minPrice &&
      lastMax === maxPrice &&
      lastSortByPrice === sortByPrice &&
      lastSortByAds === sortByAds &&
      lastUsers === users
    ) {
      return cachedSorted;
    }

    lastProducts = products;
    lastCategory = category;
    lastQuery = queryText;
    lastRegion = region;
    lastCity = city;
    lastMin = minPrice;
    lastMax = maxPrice;
    lastSortByPrice = sortByPrice;
    lastSortByAds = sortByAds;
    lastUsers = users;

    const filtered = products.filter(product => {
      const matchesCategory = !category || 
        product.category === category || 
        (product.category && category && product.category.toLowerCase() === category.toLowerCase());
        
      const matchesSearch = !queryText.trim() ||
        product.title.toLowerCase().includes(queryText.toLowerCase()) ||
        (product.category && product.category.toLowerCase().includes(queryText.toLowerCase())) ||
        product.description.toLowerCase().includes(queryText.toLowerCase()) ||
        product.location.toLowerCase().includes(queryText.toLowerCase());

      let matchesRegion = true;
      if (region !== 'All') {
        const prodRegion = getRegionForLocation(product.location);
        matchesRegion = (prodRegion === region);
      }

      let matchesCity = true;
      if (city !== 'All') {
        matchesCity = product.location.toLowerCase().includes(city.toLowerCase());
      }

      const numericPrice = parseNumericPrice(product.price);

      let matchesMinPrice = true;
      if (minPrice.trim() !== '') {
        const minVal = parseFloat(minPrice);
        if (!isNaN(minVal)) {
          matchesMinPrice = numericPrice >= minVal;
        }
      }

      let matchesMaxPrice = true;
      if (maxPrice.trim() !== '') {
        const maxVal = parseFloat(maxPrice);
        if (!isNaN(maxVal)) {
          matchesMaxPrice = numericPrice <= maxVal;
        }
      }

      return matchesCategory && matchesSearch && matchesRegion && matchesCity && matchesMinPrice && matchesMaxPrice;
    });

    const sorted = [...filtered].sort((a, b) => {
      // Prioritize sellers who often visit, stay in the app, or post rapidly
      let scoreA = getSellerPriorityScore(a.sellerId, users, products);
      let scoreB = getSellerPriorityScore(b.sellerId, users, products);

      if (!Number.isFinite(scoreA)) scoreA = 0;
      if (!Number.isFinite(scoreB)) scoreB = 0;

      if (scoreA !== scoreB) {
        return scoreB - scoreA; // Highest score goes first!
      }

      if (sortByPrice === 'asc') {
        const diff = parseNumericPrice(a.price) - parseNumericPrice(b.price);
        if (diff !== 0) return diff;
      } else if (sortByPrice === 'desc') {
        const diff = parseNumericPrice(b.price) - parseNumericPrice(a.price);
        if (diff !== 0) return diff;
      }

      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (sortByAds === 'newest') {
        return dateB - dateA;
      } else if (sortByAds === 'oldest') {
        return dateA - dateB;
      }

      return 0;
    });

    if (
      cachedSorted.length === sorted.length &&
      cachedSorted.every((item, idx) => item.id === sorted[idx].id && item.isSold === sorted[idx].isSold && item.viewsCount === sorted[idx].viewsCount)
    ) {
      return cachedSorted;
    }

    cachedSorted = sorted;
    return cachedSorted;
  };
}
