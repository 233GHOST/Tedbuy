import { useEffect, useRef, useState } from 'react';

export function useIntersectionObserver(options: IntersectionObserverInit = {}) {
  const [isIntersecting, setIsIntersecting] = useState(false);
  const elementRef = useRef<HTMLElement | null>(null);

  const root = options.root;
  const rootMargin = options.rootMargin || '100px';
  const threshold = options.threshold;

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    // Use a local observer reference to prevent cleanup race conditions
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsIntersecting(true);
        observer.unobserve(element);
      }
    }, { root, rootMargin, threshold });

    observer.observe(element);

    return () => {
      if (element) {
        observer.unobserve(element);
      }
    };
  }, [root, rootMargin, threshold]);

  return [elementRef, isIntersecting] as const;
}
