import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';

const SWIPE_BACK_MIN_DISTANCE = 60;
const SWIPE_BACK_MIN_VELOCITY = 400;

/** Swipe-right-to-go-back for screens that toggle between an internal
 * "detail" view and a "list" view via local state (e.g. ChatsScreen's
 * inbox/thread) rather than a real React Navigation stack push -- the
 * root Stack.Navigator's own gestureEnabled + fullScreenGestureEnabled
 * (navigation/index.tsx) only fires on an actual stack pop, so it has
 * zero effect on these.
 *
 * Matches the same activeOffsetX/failOffsetY/distance/velocity
 * thresholds already established and proven across the app
 * (HomeScreen.tsx's grid/video and video/seller swipes, ProfileScreen.tsx's
 * settings/dashboard swipe) rather than a bespoke PanResponder -- gesture-
 * handler composes correctly with a nested FlatList/ScrollView's own
 * native scroll recognizer, which a manual dx/dy-ratio heuristic doesn't
 * do as reliably. Wrap the screen's content in
 * <GestureDetector gesture={swipeBackGesture}>. */
export function useSwipeBackGesture(onSwipeBack: () => void) {
  return useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-20, 20])
        .failOffsetY([-15, 15])
        .onEnd((e) => {
          if (e.translationX > SWIPE_BACK_MIN_DISTANCE && e.velocityX > SWIPE_BACK_MIN_VELOCITY) {
            onSwipeBack();
          }
        }),
    [onSwipeBack]
  );
}
