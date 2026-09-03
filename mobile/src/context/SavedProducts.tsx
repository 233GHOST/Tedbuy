import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { fetchUserById, observeAuthState, toggleSaveProductRemote } from '../firebase';

interface SavedProductsContextValue {
  savedProductIds: string[];
  isSaved: (productId: string) => boolean;
  toggleSaved: (productId: string) => Promise<void>;
}

const SavedProductsContext = createContext<SavedProductsContextValue>({
  savedProductIds: [],
  isSaved: () => false,
  toggleSaved: async () => {},
});

/** Lives above the tab navigator so every ProductCard reads/writes the same
 * savedProductIds list (the current user's real bookmark list — see
 * firebase.ts's toggleSaveProductRemote for why this replaced the
 * likedUserIds-based bug), instead of each card independently deriving a
 * "saved" flag from the wrong field and each screen keeping its own
 * disconnected local copy. */
export function SavedProductsProvider({ children }: { children: React.ReactNode }) {
  const [savedProductIds, setSavedProductIds] = useState<string[]>([]);
  const savedIdsRef = useRef<string[]>([]);
  savedIdsRef.current = savedProductIds;

  useEffect(() => {
    const unsub = observeAuthState((user) => {
      if (user) {
        fetchUserById(user.uid).then((profile) => {
          setSavedProductIds(Array.isArray(profile?.savedProductIds) ? profile!.savedProductIds : []);
        });
      } else {
        setSavedProductIds([]);
      }
    });
    return unsub;
  }, []);

  const toggleSaved = async (productId: string) => {
    const before = savedIdsRef.current;
    const wasSaved = before.includes(productId);
    const optimistic = wasSaved ? before.filter((id) => id !== productId) : [...before, productId];
    setSavedProductIds(optimistic);
    try {
      const confirmed = await toggleSaveProductRemote(productId, before);
      setSavedProductIds(confirmed);
    } catch (err) {
      setSavedProductIds(before);
      throw err;
    }
  };

  return (
    <SavedProductsContext.Provider
      value={{
        savedProductIds,
        isSaved: (productId: string) => savedProductIds.includes(productId),
        toggleSaved,
      }}
    >
      {children}
    </SavedProductsContext.Provider>
  );
}

export function useSavedProducts() {
  return useContext(SavedProductsContext);
}
