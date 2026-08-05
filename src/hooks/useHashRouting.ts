import { useEffect } from 'react';
import { Category, Product } from '../types';

interface UseHashRoutingProps {
  currentView: 'browse' | 'product-detail' | 'chats' | 'my-dashboard' | 'seller-profile' | 'profile-settings';
  selectedProductId: string | null;
  selectedSellerId: string | null;
  selectedCategory: Category | null;
  products: Product[];
  slugify: (text: string) => string;
}

/**
 * Custom hook that listens to currentView and updates the browser URL hash to
 * enable robust bookmarking and prevent Vercel/CDN 404 errors on refresh.
 */
export function useHashRouting({
  currentView,
  selectedProductId,
  selectedSellerId,
  selectedCategory,
  products,
  slugify,
}: UseHashRoutingProps) {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let targetPath = '/';
    if (currentView === 'product-detail' && selectedProductId) {
      const prod = products.find(p => p.id === selectedProductId);
      if (prod) {
        const slug = slugify(prod.title);
        targetPath = `/product/${selectedProductId}-${slug}`;
      } else {
        // While products are loading, preserve the current hash/pathname structure
        const currentPath = window.location.hash.replace(/^#/, '') || window.location.pathname;
        if (currentPath.includes(`/product/${selectedProductId}`) || currentPath.includes(`/products/${selectedProductId}`)) {
          targetPath = currentPath;
        } else {
          targetPath = `/product/${selectedProductId}`;
        }
      }
    } else if (currentView === 'seller-profile' && selectedSellerId) {
      const currentPath = window.location.hash.replace(/^#/, '') || window.location.pathname;
      if (currentPath.includes(`/seller/${selectedSellerId}`) || currentPath.includes(`/sellers/${selectedSellerId}`)) {
        targetPath = currentPath;
      } else {
        targetPath = `/seller/${selectedSellerId}`;
      }
    } else if (currentView === 'chats') {
      targetPath = '/chats';
    } else if (currentView === 'my-dashboard') {
      targetPath = '/dashboard';
    } else if (currentView === 'profile-settings') {
      targetPath = '/settings';
    } else if (currentView === 'browse' && selectedCategory) {
      targetPath = `/${slugify(selectedCategory)}`;
    }

    const targetHash = targetPath === '/' ? '' : `#${targetPath}`;

    // Gracefully clean up full-path URLs into hash-based URLs without adding to history twice if unchanged
    const currentHash = window.location.hash;
    const currentPathname = window.location.pathname;

    if (currentPathname !== '/' || currentHash !== targetHash) {
      const cleanPath = targetHash ? `/${targetHash}` : '/';
      window.history.pushState(
        { currentView, selectedProductId, selectedSellerId, selectedCategory },
        '',
        cleanPath
      );
    }
  }, [currentView, selectedProductId, selectedSellerId, selectedCategory, products, slugify]);
}
