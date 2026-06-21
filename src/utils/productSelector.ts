import { Product, Category } from '../types';
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
  let lastCategory: Category | null = null;
  let lastQuery = '';
  let lastRegion = 'All';
  let lastCity = 'All';
  let lastMin = '';
  let lastMax = '';
  let lastSortByPrice: 'default' | 'asc' | 'desc' = 'default';
  let lastSortByAds: 'newest' | 'oldest' = 'newest';
  
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
    sortByAds: 'newest' | 'oldest'
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
      lastSortByAds === sortByAds
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
