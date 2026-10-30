import { useEffect, useRef, useState } from 'react';

/**
 * Runs a server-list fetch whenever `key` (e.g. the category or product id) or
 * `reloadToken` changes. Returns null until the fetch for the CURRENT key has
 * answered (or if it failed), so callers fall back to the on-phone list; a
 * response for an older key is dropped and never shown for the new one.
 */
export function useServerList<T = any>(
  fetcher: () => Promise<T[] | null>,
  key: string,
  reloadToken = 0,
  enabled = true
): T[] | null {
  const [result, setResult] = useState<{ key: string; list: T[] | null }>({ key: '', list: null });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetcherRef.current().then((list) => {
      if (!cancelled) setResult({ key, list });
    });
    return () => {
      cancelled = true;
    };
  }, [key, reloadToken, enabled]);

  return enabled && result.key === key ? result.list : null;
}
