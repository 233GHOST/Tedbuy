import { useEffect } from 'react';
import { Category, Product } from '../types';

interface UseSEOProps {
  currentView: string;
  selectedProductId?: string | null;
  selectedSellerId?: string | null;
  selectedCategory?: Category | null;
  searchQuery?: string;
  products?: Product[];
  seller?: any;
}

export function useSEO({
  currentView,
  selectedProductId,
  selectedSellerId,
  selectedCategory,
  searchQuery,
  products = [],
  seller,
}: UseSEOProps) {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let title = "TedBuy - Buy & Sell Verified Items in Ghana";
    let description = "Ghana's #1 Social Classifieds & Video Commerce platform. Buy, sell, and discover items in action with immersive video ads, verified direct chats, and trusted local deals directly on TedBuy.";
    let canonical = "https://tedbuy.store/";
    let ogImage = "https://tedbuy.store/icon-192.png";
    let schemaType = "WebSite";
    let schemaData: any = null;

    if (currentView === 'product-detail' && selectedProductId) {
      const product = products.find(p => p.id === selectedProductId);
      if (product) {
        const priceStr = product.price ? ` - GHS ${product.price}` : '';
        title = `${product.title}${priceStr} | TedBuy Ghana`;
        description = product.description
          ? product.description.slice(0, 160) + (product.description.length > 160 ? '...' : '')
          : `Buy ${product.title} safely on TedBuy Ghana. Verified seller in ${product.location || 'Ghana'}.`;
        
        canonical = `https://tedbuy.store/#/product/${selectedProductId}`;
        
        if (product.images && product.images.length > 0) {
          ogImage = product.images[0];
        } else if (product.primaryPicture) {
          ogImage = product.primaryPicture;
        }

        schemaType = "Product";
        const cleanPrice = product.price ? String(product.price).replace(/[^\d.]/g, '') : '0';
        schemaData = {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": product.title,
          "description": description,
          "image": [ogImage],
          "offers": {
            "@type": "Offer",
            "priceCurrency": "GHS",
            "price": cleanPrice || '0',
            "itemCondition": "https://schema.org/UsedCondition",
            "availability": "https://schema.org/InStock"
          }
        };
      }
    } else if (currentView === 'seller-profile' && selectedSellerId) {
      const sellerName = seller?.username || seller?.displayName || 'Verified Merchant';
      title = `${sellerName}'s Official Store | TedBuy Ghana`;
      description = seller?.bio || `View verified listings, ratings, and contact info for ${sellerName} on TedBuy Ghana.`;
      canonical = `https://tedbuy.store/#/seller/${selectedSellerId}`;
      if (seller?.photoUrl) ogImage = seller.photoUrl;

      schemaData = {
        "@context": "https://schema.org",
        "@type": "Store",
        "name": sellerName,
        "description": description,
        "url": canonical,
        "image": ogImage
      };
    } else if (selectedCategory) {
      title = `Verified ${selectedCategory} for Sale in Ghana | TedBuy`;
      description = `Discover top deals on ${selectedCategory} from verified sellers in Accra, Kumasi, and across Ghana on TedBuy.`;
      const catSlug = selectedCategory.toLowerCase().replace(/\s+/g, '-');
      canonical = `https://tedbuy.store/#/${catSlug}`;

      schemaData = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": title,
        "description": description,
        "url": canonical
      };
    } else if (searchQuery && searchQuery.trim()) {
      title = `Search results for "${searchQuery.trim()}" | TedBuy Ghana`;
      description = `Find deals matching "${searchQuery.trim()}" on TedBuy Ghana marketplace. Verified sellers & direct chat.`;
      canonical = `https://tedbuy.store/?q=${encodeURIComponent(searchQuery.trim())}`;
    }

    // Update document title
    document.title = title;

    // Helper to update meta tag content
    const updateMeta = (selector: string, content: string) => {
      let el = document.querySelector(selector);
      if (!el) {
        el = document.createElement('meta');
        if (selector.includes('name=')) {
          const nameMatch = selector.match(/name="([^"]+)"/);
          if (nameMatch) el.setAttribute('name', nameMatch[1]);
        } else if (selector.includes('property=')) {
          const propMatch = selector.match(/property="([^"]+)"/);
          if (propMatch) el.setAttribute('property', propMatch[1]);
        }
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };

    updateMeta('meta[name="description"]', description);
    updateMeta('meta[property="og:title"]', title);
    updateMeta('meta[property="og:description"]', description);
    updateMeta('meta[property="og:image"]', ogImage);
    updateMeta('meta[property="og:url"]', canonical);
    updateMeta('meta[name="twitter:title"]', title);
    updateMeta('meta[name="twitter:description"]', description);
    updateMeta('meta[name="twitter:image"]', ogImage);

    // Update Canonical URL
    let linkCanonical = document.querySelector('link[rel="canonical"]');
    if (!linkCanonical) {
      linkCanonical = document.createElement('link');
      linkCanonical.setAttribute('rel', 'canonical');
      document.head.appendChild(linkCanonical);
    }
    linkCanonical.setAttribute('href', canonical);

    // Dynamic JSON-LD script block
    let scriptJsonLd = document.getElementById('dynamic-jsonld-schema');
    if (schemaData) {
      if (!scriptJsonLd) {
        scriptJsonLd = document.createElement('script');
        scriptJsonLd.id = 'dynamic-jsonld-schema';
        scriptJsonLd.setAttribute('type', 'application/ld+json');
        document.head.appendChild(scriptJsonLd);
      }
      scriptJsonLd.textContent = JSON.stringify(schemaData);
    } else if (scriptJsonLd) {
      scriptJsonLd.remove();
    }

  }, [currentView, selectedProductId, selectedSellerId, selectedCategory, searchQuery, products, seller]);
}
