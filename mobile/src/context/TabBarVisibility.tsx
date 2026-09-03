import React, { createContext, useContext, useRef, useState } from 'react';
import { Animated } from 'react-native';

export const TAB_BAR_HEIGHT = 68;
const SCROLL_THRESHOLD = 6;
const TOP_ZONE = 4;
// The raised "+"/Sell tab button (navigation/index.tsx's sellTabButton)
// pokes ~20px above the bar's own top edge via marginTop:-20 on its
// container. Sliding the bar down by only TAB_BAR_HEIGHT still leaves that
// button's top slice visible past the screen's bottom edge when "hidden" —
// this adds enough extra travel (plus a small safety margin for its shadow)
// to clear it fully.
const HIDE_TRANSLATE_Y = TAB_BAR_HEIGHT + 28;

interface TabBarVisibilityContextValue {
  translateY: Animated.Value;
  onScroll: (event: any) => void;
  resetTabBar: () => void;
  hideTabBar: () => void;
  isDarkTabBar: boolean;
  setIsDarkTabBar: (dark: boolean) => void;
}

const TabBarVisibilityContext = createContext<TabBarVisibilityContextValue | null>(null);

/**
 * Drives the bottom tab bar's hide-on-scroll-down / reveal-on-scroll-up
 * behavior. Rebuilt from a previous Animated.diffClamp(scrollY, ...)
 * design — that approach fed the SAME shared Animated.Value directly from
 * every scrollable screen's raw contentOffset.y, AND from manual
 * hideTabBar()/resetTabBar() calls (e.g. opening a chat conversation, or a
 * screen resetting on focus). The two don't mix safely: resetTabBar() sets
 * the value to 0 as bookkeeping, but never actually scrolls the real
 * ScrollView back to its top — so the very next onScroll event reports that
 * view's true (unchanged) offset, which diffClamp reads as one enormous
 * delta and instantly reinterprets as "scrolled way down," re-hiding (or
 * otherwise desyncing) the bar regardless of the reset that just happened.
 * That's what "got stuck" was: any scroll-driven screen visited after a
 * manual reset could immediately undo it.
 *
 * This version tracks scroll DIRECTION per-screen (each screen's own onScroll
 * call resets its own lastY the moment resetTabBar()/hideTabBar() runs, via
 * the shared lastYRef below) and only ever commands the bar to an explicit
 * target (shown or hidden) — there's no persisted "clamp accumulator" that
 * can drift out of sync with reality, so a manual command always wins until
 * the next real scroll motion, and a small scroll on a screen sitting at the
 * top can never spuriously re-hide it.
 */
export function TabBarVisibilityProvider({ children }: { children: React.ReactNode }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const isHiddenRef = useRef(false);
  const lastYRef = useRef(0);

  const animateTo = (hidden: boolean) => {
    if (isHiddenRef.current === hidden) return;
    isHiddenRef.current = hidden;
    Animated.timing(translateY, {
      toValue: hidden ? HIDE_TRANSLATE_Y : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  const onScroll = (event: any) => {
    const y = event?.nativeEvent?.contentOffset?.y ?? 0;
    const delta = y - lastYRef.current;
    lastYRef.current = y;

    if (y <= TOP_ZONE) {
      animateTo(false);
      return;
    }
    if (delta > SCROLL_THRESHOLD) {
      animateTo(true);
    } else if (delta < -SCROLL_THRESHOLD) {
      animateTo(false);
    }
  };

  const resetTabBar = () => {
    // Resyncs the direction-tracker to "top" so the next scroll event on
    // whichever screen this runs on computes its delta from a sane baseline,
    // instead of jumping from that screen's real (unrelated) last offset.
    lastYRef.current = 0;
    animateTo(false);
  };

  // For full-takeover UI within a tab (e.g. an open chat conversation) where
  // the tab bar should stay out of the way regardless of scroll position.
  const hideTabBar = () => {
    animateTo(true);
  };

  // White for normal light-background browsing, dark only for the immersive
  // Watch Video Ads feed (a dark bar reads heavy against the standard grid,
  // but matches/disappears into the full-bleed video feed).
  const [isDarkTabBar, setIsDarkTabBar] = useState(false);

  return (
    <TabBarVisibilityContext.Provider value={{ translateY, onScroll, resetTabBar, hideTabBar, isDarkTabBar, setIsDarkTabBar }}>
      {children}
    </TabBarVisibilityContext.Provider>
  );
}

export function useTabBarVisibility() {
  const ctx = useContext(TabBarVisibilityContext);
  if (!ctx) throw new Error('useTabBarVisibility must be used within TabBarVisibilityProvider');
  return ctx;
}
