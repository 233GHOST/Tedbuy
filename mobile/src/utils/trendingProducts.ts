import { Product } from '../types';

/** Shared by the Home carousel and the "Trending Ads" full-list screen. */
export function computeTrendingProducts(
  products: Product[],
  selectedCategory?: string,
  limit?: number
): Product[] {
  const list = products.filter((p) => {
    if (!p || (p as any).status === 'hidden' || (p as any).isSold || (p as any).status === 'sold') return false;
    if (selectedCategory && selectedCategory !== 'All') {
      const pCat = String(p.category || '').toLowerCase().trim();
      const selCat = String(selectedCategory).toLowerCase().trim();
      if (pCat !== selCat && !pCat.includes(selCat) && !selCat.includes(pCat)) return false;
    }
    return true;
  });

  const sorted = list.sort((a, b) => {
    const aViews = Number((a as any).viewsCount || (a as any).views) || 0;
    const bViews = Number((b as any).viewsCount || (b as any).views) || 0;
    if (bViews !== aViews) return bViews - aViews;
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });

  return limit ? sorted.slice(0, limit) : sorted;
}
