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

    const getSellerScore = (sellerId: string): number => {
      const seller = users?.find(u => u.id === sellerId);
      if (!seller) return 0;
      const visitCount = seller.visitCount || 0;
      const totalStayTime = seller.totalStayTime || 0; // in seconds
      const rapidPostScore = seller.rapidPostScore || 0;

      // Compound Score Formula: 50 points per visit, 12 points per 10s of stay time, 200 points per rapidPostScore
      const visitScore = visitCount * 50;
      const stayScore = Math.floor(totalStayTime / 10) * 12;
      const postScore = rapidPostScore * 200;

      return visitScore + stayScore + postScore;
    };

    const sorted = [...filtered].sort((a, b) => {
      const scoreA = getSellerScore(a.sellerId);
      const scoreB = getSellerScore(b.sellerId);

      if (scoreA !== scoreB) {
        return scoreB - scoreA; // Higher seller activity score always ranks first!
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
