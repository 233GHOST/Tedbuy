import { useEffect, useRef } from 'react';
import { Category, Product } from '../types';

interface UseHashRoutingProps {
  currentView: 'browse' | 'product-detail' | 'chats' | 'my-dashboard' | 'seller-profile' | 'profile-settings' | 'featured-listings';
  selectedProductId: string | null;
  selectedSellerId: string | null;
  selectedCategory: Category | null;
  products: Product[];
  slugify: (text: string) => string;
}

/**
 * Custom hook that synchronizes currentView with browser URL hash.
 * 
 * Ensures:
 * 1. Navigating forward pushes EXACTLY ONE clean history entry.
 * 2. Asynchronous slug resolution or title loading uses replaceState (preventing duplicate history entries).
 * 3. Popstate (back / forward button) does not re-push state, allowing 1-click instant back navigation.
 */
export function useHashRouting({
  currentView,
  selectedProductId,
  selectedSellerId,
  selectedCategory,
  products,
  slugify,
}: UseHashRoutingProps) {
  const isPopStateRef = useRef(false);
  const lastViewRef = useRef<string>(currentView);
  const lastProductIdRef = useRef<string | null>(selectedProductId);
  const lastSellerIdRef = useRef<string | null>(selectedSellerId);
  const lastCategoryRef = useRef<Category | null>(selectedCategory);
  const lastHashRef = useRef<string>(typeof window !== 'undefined' ? window.location.hash : '');

  // Track popstate/hashchange events to avoid pushing history on back navigation
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onPop = () => {
      isPopStateRef.current = true;
      lastHashRef.current = window.location.hash;
    };

    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // If change was initiated by browser popstate (Back/Forward), do not create a new history entry
    if (isPopStateRef.current) {
      isPopStateRef.current = false;
      lastViewRef.current = currentView;
      lastProductIdRef.current = selectedProductId;
      lastSellerIdRef.current = selectedSellerId;
      lastCategoryRef.current = selectedCategory;
      lastHashRef.current = window.location.hash;
      return;
    }

    let targetPath = '/';
    if (currentView === 'product-detail' && selectedProductId) {
      const prod = products.find(p => p.id === selectedProductId);
      if (prod && prod.title) {
        const slug = slugify(prod.title);
        targetPath = `/product/${selectedProductId}-${slug}`;
      } else {
        targetPath = `/product/${selectedProductId}`;
      }
    } else if (currentView === 'seller-profile' && selectedSellerId) {
      targetPath = `/seller/${selectedSellerId}`;
    } else if (currentView === 'chats') {
      targetPath = '/chats';
    } else if (currentView === 'my-dashboard') {
      targetPath = '/dashboard';
    } else if (currentView === 'profile-settings') {
      targetPath = '/settings';
    } else if (currentView === 'featured-listings') {
      targetPath = '/featured';
    } else if (currentView === 'browse' && selectedCategory) {
      targetPath = `/${slugify(selectedCategory)}`;
    }

    const targetHash = targetPath === '/' ? '' : `#${targetPath}`;
    const currentHash = window.location.hash;

    // Check if the logical entity is the same (e.g. same product, just title slug was resolved)
    const isSameEntity =
      lastViewRef.current === currentView &&
      lastProductIdRef.current === selectedProductId &&
      lastSellerIdRef.current === selectedSellerId &&
      lastCategoryRef.current === selectedCategory;

    // If the hash is already matching, do nothing
    if (currentHash === targetHash || (targetHash === '' && (currentHash === '' || currentHash === '#/' || currentHash === '#'))) {
      lastViewRef.current = currentView;
      lastProductIdRef.current = selectedProductId;
      lastSellerIdRef.current = selectedSellerId;
      lastCategoryRef.current = selectedCategory;
      lastHashRef.current = currentHash;
      return;
    }

    const cleanPath = targetHash ? `/${targetHash}` : '/';

    if (isSameEntity) {
      // Slug or minor format refinement on same page -> replaceState (never push duplicate history)
      window.history.replaceState(
        { currentView, selectedProductId, selectedSellerId, selectedCategory },
        '',
        cleanPath
      );
    } else {
      // Genuinely new view transition -> pushState exactly once
      window.history.pushState(
        { currentView, selectedProductId, selectedSellerId, selectedCategory },
        '',
        cleanPath
      );
    }

    lastViewRef.current = currentView;
    lastProductIdRef.current = selectedProductId;
    lastSellerIdRef.current = selectedSellerId;
    lastCategoryRef.current = selectedCategory;
    lastHashRef.current = targetHash;
  }, [currentView, selectedProductId, selectedSellerId, selectedCategory, products, slugify]);
}
