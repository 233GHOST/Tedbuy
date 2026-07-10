import { Product, Category, User } from '../types';
import { getRegionForLocation } from '../regions';
import { parseDate } from './dateParser';

function parseNumericPrice(p: string | number): number {
  if (typeof p === 'number') return p;
  if (!p) return 0;
  const cleaned = String(p).replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * A highly optimized memoized selector scope for product filters and sorting.
 * Employs referential identity preservation when content records are equivalent.
 */
export function createProductSelector() {
  let lastProducts: Product[] = [];
  let lastUsers: User[] = [];
  let lastCategory: Category | null = null;
  let lastQuery = '';
  let lastRegion = 'All';
  let lastCity = 'All';
  let lastMin = '';
  let lastMax = '';
  let lastSortByPrice: 'default' | 'asc' | 'desc' = 'default';
  let lastSortByAds: 'newest' | 'oldest' = 'newest';
  let lastExtraFiltersStr = '{}';
  
  let cachedSorted: Product[] = [];

  return (
    products: Product[],
    users: User[],
    category: Category | null,
    queryText: string,
    region: string,
    city: string,
    minPrice: string,
    maxPrice: string,
    sortByPrice: 'default' | 'asc' | 'desc',
    sortByAds: 'newest' | 'oldest',
    extraFilters?: Record<string, string>
  ): Product[] => {
    const extraFiltersStr = extraFilters ? JSON.stringify(extraFilters) : '{}';
    if (
      lastProducts === products &&
      lastUsers === users &&
      lastCategory === category &&
      lastQuery === queryText &&
      lastRegion === region &&
      lastCity === city &&
      lastMin === minPrice &&
      lastMax === maxPrice &&
      lastSortByPrice === sortByPrice &&
      lastSortByAds === sortByAds &&
      lastExtraFiltersStr === extraFiltersStr
    ) {
      return cachedSorted;
    }

    lastProducts = products;
    lastUsers = users;
    lastCategory = category;
    lastQuery = queryText;
    lastRegion = region;
    lastCity = city;
    lastMin = minPrice;
    lastMax = maxPrice;
    lastSortByPrice = sortByPrice;
    lastSortByAds = sortByAds;
    lastExtraFiltersStr = extraFiltersStr;

    const parsedExtraFilters: Record<string, string> = extraFilters || {};

    const filtered = products.filter(product => {
      if (!product) return false;
      const prodTitle = String(product.title || '');
      const prodCategory = String(product.category || '');
      const prodDesc = String(product.description || '');
      const prodLocation = String(product.location || '');

      const matchesCategory = !category || 
        prodCategory === category || 
        (prodCategory && category && prodCategory.toLowerCase() === category.toLowerCase());
        
      const matchesSearch = !queryText.trim() ||
        prodTitle.toLowerCase().includes(queryText.toLowerCase()) ||
        prodCategory.toLowerCase().includes(queryText.toLowerCase()) ||
        prodDesc.toLowerCase().includes(queryText.toLowerCase()) ||
        prodLocation.toLowerCase().includes(queryText.toLowerCase());

      let matchesRegion = true;
      if (region !== 'All') {
        const prodRegion = getRegionForLocation(prodLocation);
        matchesRegion = (prodRegion === region);
      }

      let matchesCity = true;
      if (city !== 'All') {
        matchesCity = prodLocation.toLowerCase().includes(city.toLowerCase());
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

      // Match dynamic category-specific fields (e.g. brand, model, storage, condition, etc.)
      let matchesExtra = true;
      if (Object.keys(parsedExtraFilters).length > 0) {
        for (const [key, value] of Object.entries(parsedExtraFilters)) {
          if (!value || value === 'All') continue;

          // Check if attribute is stored explicitly in product attributes
          const productVal = (product as any)[key];
          if (productVal !== undefined && productVal !== null) {
            const cleanProdVal = String(productVal).toLowerCase().trim();
            const cleanFilterVal = String(value).toLowerCase().trim();
            if (cleanProdVal !== cleanFilterVal && !cleanProdVal.includes(cleanFilterVal)) {
              matchesExtra = false;
              break;
            }
          } else {
            // Fallback for keyword correlation in Title & Description for backward compatibility
            const cleanVal = String(value).toLowerCase().trim();
            const inTitle = prodTitle.toLowerCase().includes(cleanVal);
            const inDesc = prodDesc.toLowerCase().includes(cleanVal);
            if (!inTitle && !inDesc) {
              matchesExtra = false;
              break;
            }
          }
        }
      }

      return matchesCategory && matchesSearch && matchesRegion && matchesCity && matchesMinPrice && matchesMaxPrice && matchesExtra;
    });

    const userMap = new Map<string, User>();
    if (users) {
      users.forEach(u => {
        if (u && u.id) {
          userMap.set(u.id, u);
        }
      });
    }

    const getAdRankingScore = (product: Product): {
      rankingScore: number;
      sellerActivityScore: number;
      popularityScore: number;
      freshnessScore: number;
      qualityScore: number;
    } => {
      // 1. Seller Activity Score (40% weight)
      let sellerActivityScore = 0;
      const seller = userMap.get(product.sellerId);
      if (seller) {
        // Online status (Max 40 pts)
        if (seller.isOnline) {
          sellerActivityScore += 40;
        }

        // Active recency (Max 30 pts)
        const lastActiveStr = seller.lastSeen || seller.lastLogin;
        if (lastActiveStr) {
          try {
            const lastActiveTime = new Date(lastActiveStr).getTime();
            const diffMs = Date.now() - lastActiveTime;
            const diffHours = diffMs / (1000 * 60 * 60);

            if (diffHours <= 1) {
              sellerActivityScore += 30;
            } else if (diffHours <= 24) {
              sellerActivityScore += 20;
            } else if (diffHours <= 72) {
              sellerActivityScore += 10;
            }
          } catch (_) {}
        }

        // Recent app usage: visits (Max 30 pts)
        const visits = seller.visitCount || 0;
        const visitsScore = Math.min(30, visits * 2); // 2 pts per visit, max 30

        sellerActivityScore += visitsScore;
      }

      // 2. Popularity Score (30% weight)
      const views = product.viewsCount || 0;
      // Logarithmic scaling with max cap of 100
      const popularityScore = Math.min(100, Math.log2(views + 1) * 12);

      // 3. Freshness Score (20% weight)
      let freshnessScore = 0;
      if (product.createdAt) {
        try {
          const createdTime = new Date(product.createdAt).getTime();
          const diffMs = Date.now() - createdTime;
          const diffDays = diffMs / (1000 * 60 * 60 * 24);

          if (diffDays <= 3) {
            freshnessScore = 100; // Strong boost
          } else if (diffDays <= 14) {
            freshnessScore = 50; // Moderate boost
          }
        } catch (_) {}
      }

      // 4. Quality Score (10% weight)
      let qualityScore = 0;
      const imagesCount = product.images ? product.images.length : 0;
      if (imagesCount > 1) {
        qualityScore += 30;
      } else if (imagesCount === 1) {
        qualityScore += 15;
      }

      const descLen = product.description ? product.description.trim().length : 0;
      if (descLen >= 120) {
        qualityScore += 25;
      } else if (descLen >= 40) {
        qualityScore += 15;
      }

      const priceVal = parseNumericPrice(product.price);
      if (priceVal > 0 && priceVal < 5000000) {
        qualityScore += 15;
      }

      if (product.category && product.category !== 'Other') {
        qualityScore += 15;
      }

      if (product.location && product.location.trim() !== '' && product.location.toLowerCase() !== 'all') {
        qualityScore += 15;
      }

      // Final balanced calculation with the requested weights
      const rankingScore = (
        sellerActivityScore * 0.40 +
        popularityScore * 0.30 +
        freshnessScore * 0.20 +
        qualityScore * 0.10
      );

      return {
        rankingScore: parseFloat(rankingScore.toFixed(2)),
        sellerActivityScore,
        popularityScore: parseFloat(popularityScore.toFixed(2)),
        freshnessScore,
        qualityScore
      };
    };

    // Calculate ranking scores and group-log diagnostics (STEP 12)
    const scoringMap = new Map<string, ReturnType<typeof getAdRankingScore>>();
    
    // Fill scoringMap
    filtered.forEach(p => {
      scoringMap.set(p.id, getAdRankingScore(p));
    });

    // Logging diagnostics
    if (typeof window !== 'undefined' && filtered.length > 0) {
      console.groupCollapsed('[Tedbuy Smart Ad Ranking Diagnostics] Evaluated Ads:', filtered.length);
      filtered.forEach(p => {
        const scores = scoringMap.get(p.id);
        if (scores) {
          console.log({
            adId: p.id,
            title: p.title,
            rankingScore: scores.rankingScore,
            sellerActivityScore: scores.sellerActivityScore,
            popularityScore: scores.popularityScore,
            freshnessScore: scores.freshnessScore,
            qualityScore: scores.qualityScore
          });
        }
      });
      console.groupEnd();
    }

    const isBoostActive = (p: Product): boolean => {
      if (!p.boostStatus) return false;
      const endDate = parseDate(p.boostEndDate);
      if (!endDate) return false;
      return endDate.getTime() > Date.now();
    };

    const sorted = [...filtered].sort((a, b) => {
      const scoresA = scoringMap.get(a.id) || { rankingScore: 0 };
      const scoresB = scoringMap.get(b.id) || { rankingScore: 0 };

      const boostA = isBoostActive(a);
      const boostB = isBoostActive(b);

      // Boosted listings must always appear above all normal listings under all sorting and filtering
      if (boostA && !boostB) return -1;
      if (!boostA && boostB) return 1;

      // If both are boosted:
      if (boostA && boostB) {
        // If sorting by price explicitly, sort within boosted group by price
        if (sortByPrice === 'asc') {
          const diff = parseNumericPrice(a.price) - parseNumericPrice(b.price);
          if (diff !== 0) return diff;
        } else if (sortByPrice === 'desc') {
          const diff = parseNumericPrice(b.price) - parseNumericPrice(a.price);
          if (diff !== 0) return diff;
        }

        // Default prioritization for boosted listings (or for price-sort ties within boosted listings)
        // PRIORITY LEVEL 1: BOOST PACKAGE VALUE (GHS price / level)
        // Package hierarchy: GH₵20 > GH₵12 > GH₵7 > GH₵3 > GH₵1
        const getBoostPriorityLevel = (planId?: string): number => {
          if (!planId) return 0;
          if (planId === '90days') return 5; // GH₵20
          if (planId === '30days') return 4; // GH₵12
          if (planId === '14days') return 3; // GH₵7
          if (planId === '7days') return 2;  // GH₵3
          if (planId === '3days') return 1;  // GH₵1
          return 0;
        };

        const levelA = getBoostPriorityLevel(a.boostPlan);
        const levelB = getBoostPriorityLevel(b.boostPlan);
        if (levelA !== levelB) {
          return levelB - levelA; // Higher price/level package first
        }

        // PRIORITY LEVEL 2: REMAINING BOOST TIME
        const timeA = a.boostEndDate ? new Date(a.boostEndDate).getTime() : 0;
        const timeB = b.boostEndDate ? new Date(b.boostEndDate).getTime() : 0;
        if (timeA !== timeB) {
          return timeB - timeA; // Longest remaining duration first
        }

        // PRIORITY LEVEL 3: EXISTING ENGAGEMENT SCORE
        if (scoresA.rankingScore !== scoresB.rankingScore) {
          return scoresB.rankingScore - scoresA.rankingScore;
        }

        // PRIORITY LEVEL 4: NEWEST LISTING
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      }

      // If both are normal (not boosted):
      // Under explicit price sorting, sort primarily by price and fallback to rankingScore for tie breaking
      if (sortByPrice === 'asc') {
        const diff = parseNumericPrice(a.price) - parseNumericPrice(b.price);
        if (diff !== 0) return diff;
      } else if (sortByPrice === 'desc') {
        const diff = parseNumericPrice(b.price) - parseNumericPrice(a.price);
        if (diff !== 0) return diff;
      }

      // Default: sort by smart rankingScore!
      if (scoresA.rankingScore !== scoresB.rankingScore) {
        return scoresB.rankingScore - scoresA.rankingScore;
      }

      // Break ties using user's date-based preferences
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
