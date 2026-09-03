import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchChatsApi, observeAuthState } from '../firebase';

const POLL_MS = 20000;

const UnreadChatsContext = createContext<number>(0);

/** Matches web's Navbar.tsx unreadCount badge (getUnreadChatCount,
 * src/utils/chatStateUtils.ts: sum of unreadCount across chats, excluding
 * ones the user deleted-for-me and ones whose trade is already completed)
 * — was entirely absent on mobile, so a user with unread messages saw no
 * indicator anywhere outside the Chats tab's own list. Lives above the tab
 * navigator (not inside ChatsScreen) so the badge stays live no matter which
 * tab is currently open, same as web's navbar is always visible regardless
 * of page. Polls independently of ChatsScreen's own in-screen polling —
 * a second lightweight poll is preferable to threading cross-screen state
 * through every tab just to avoid it. */
export function UnreadChatsProvider({ children }: { children: React.ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const load = async (uid: string) => {
      try {
        const chats = await fetchChatsApi();
        let deletedIds = new Set<string>();
        try {
          const raw = await AsyncStorage.getItem(`tedbuy_deleted_chat_ids_${uid}`);
          if (raw) deletedIds = new Set(JSON.parse(raw));
        } catch {
          // ignore corrupt storage
        }
        const total = (chats || []).reduce((sum: number, chat: any) => {
          if (deletedIds.has(chat.id)) return sum;
          if (chat.tradeStatus === 'completed') return sum;
          return sum + (chat.unreadCount || 0);
        }, 0);
        setUnreadCount(total);
      } catch {
        // keep last known count on a transient fetch failure
      }
    };

    const unsub = observeAuthState((user) => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (user) {
        load(user.uid);
        pollRef.current = setInterval(() => load(user.uid), POLL_MS);
      } else {
        setUnreadCount(0);
      }
    });

    return () => {
      unsub();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return <UnreadChatsContext.Provider value={unreadCount}>{children}</UnreadChatsContext.Provider>;
}

export function useUnreadChatsCount() {
  return useContext(UnreadChatsContext);
}
