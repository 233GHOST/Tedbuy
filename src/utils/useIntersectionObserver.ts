import { useEffect, useRef, useState } from 'react';

export function useIntersectionObserver(options: IntersectionObserverInit = {}) {
  const [isIntersecting, setIsIntersecting] = useState(false);
  const elementRef = useRef<HTMLElement | null>(null);

  const root = options.root;
  const rootMargin = options.rootMargin || '100px';
  const threshold = options.threshold;

  useEffect(() => {
    let safetyTimeout: NodeJS.Timeout | null = null;
    
    // Safety fallback: auto-intersect after an explicit delay under sandboxed iframe / Safari constraints.
    // In Safari or inside sandboxed iframes, IntersectionObserver target intersections 
    // often silently fail to fire due to cross-origin layout context limitations.
    const isSafariOrIFrame = typeof window !== 'undefined' && (
      window.self !== window.top ||
      (/Safari/i.test(navigator.userAgent) && !/Chrome/i.test(navigator.userAgent))
    );
    
    const fallbackTimeoutMs = isSafariOrIFrame ? 150 : 2500; // Faster fallback for Safari/iframe, safety net for other laggy browsers
    
    safetyTimeout = setTimeout(() => {
      setIsIntersecting(true);
    }, fallbackTimeoutMs);

    const element = elementRef.current;
    if (!element) {
      return () => {
        if (safetyTimeout) clearTimeout(safetyTimeout);
      };
    }

    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      setIsIntersecting(true);
      if (safetyTimeout) clearTimeout(safetyTimeout);
      return;
    }

    // Use a local observer reference to prevent cleanup race conditions
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsIntersecting(true);
        if (safetyTimeout) clearTimeout(safetyTimeout);
        observer.unobserve(element);
      }
    }, { root, rootMargin, threshold });

    observer.observe(element);

    return () => {
      if (safetyTimeout) clearTimeout(safetyTimeout);
      if (element) {
        observer.unobserve(element);
      }
    };
  }, [root, rootMargin, threshold]);

  return [elementRef, isIntersecting] as const;
}
