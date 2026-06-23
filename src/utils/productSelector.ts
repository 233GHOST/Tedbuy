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
            const inTitle = product.title.toLowerCase().includes(cleanVal);
            const inDesc = product.description.toLowerCase().includes(cleanVal);
            if (!inTitle && !inDesc) {
              matchesExtra = false;
              break;
            }
          }
        }
      }

      return matchesCategory && matchesSearch && matchesRegion && matchesCity && matchesMinPrice && matchesMaxPrice && matchesExtra;
    });

    const getAdRankingScore = (product: Product): {
      rankingScore: number;
      sellerActivityScore: number;
      popularityScore: number;
      freshnessScore: number;
      qualityScore: number;
    } => {
      // 1. Seller Activity Score (40% weight)
      let sellerActivityScore = 0;
      const seller = users?.find(u => u.id === product.sellerId);
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

        // Recent app usage: visits & stay (Max 30 pts)
        const visits = seller.visitCount || 0;
        const visitsScore = Math.min(15, visits * 1); // 1 pt per visit, max 15

        const staySeconds = seller.totalStayTime || 0;
        const stayScore = Math.min(15, Math.floor(staySeconds / 30) * 1); // 1 pt per 30s stay, max 15

        sellerActivityScore += visitsScore + stayScore;
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

    const sorted = [...filtered].sort((a, b) => {
      const scoresA = scoringMap.get(a.id) || { rankingScore: 0 };
      const scoresB = scoringMap.get(b.id) || { rankingScore: 0 };

      // Under explicit price sorting, sort primarily by price and fallback to rankingScore for tie breaking
      if (sortByPrice === 'asc') {
        const diff = parseNumericPrice(a.price) - parseNumericPrice(b.price);
        if (diff !== 0) return diff;
        return scoresB.rankingScore - scoresA.rankingScore;
      } else if (sortByPrice === 'desc') {
        const diff = parseNumericPrice(b.price) - parseNumericPrice(a.price);
        if (diff !== 0) return diff;
        return scoresB.rankingScore - scoresA.rankingScore;
      }

      // Otherwise if sortByPrice === 'default', sort primarily by smart rankingScore!
      if (scoresA.rankingScore !== scoresB.rankingScore) {
        return scoresB.rankingScore - scoresA.rankingScore;
      }

      // Break ties using the user's date-based preferences (newest vs oldest)
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
