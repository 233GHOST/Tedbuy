import 'react-native-gesture-handler';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { AppNavigator } from './src/navigation';
import { applyGlobalFont } from './src/applyGlobalFont';
import { configureGoogleSignIn, observeAuthState, registerPushToken, sendPresenceHeartbeat } from './src/firebase';
import { registerForPushNotificationsAsync } from './src/utils/pushNotifications';
import { SuspensionGate } from './src/components/SuspensionGate';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { UnreadChatsProvider } from './src/context/UnreadChats';
import { SavedProductsProvider } from './src/context/SavedProducts';
import { DismissKeyboardView } from './src/components/DismissKeyboardView';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Safe to call unconditionally — a no-op until GOOGLE_WEB_CLIENT_ID is filled
// in (firebase.ts), and self-guarded against Expo Go (no native module) so
// this never breaks app startup either way.
configureGoogleSignIn();

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      applyGlobalFont();
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  // Register (or re-register — the OS can occasionally rotate an Expo push
  // token) this device for push notifications once a user is actually
  // signed in, so the backend knows where to deliver a new message/follower/
  // listing-update push. registerForPushNotificationsAsync() never throws
  // and resolves to null for every "nothing to do here" case (denied
  // permission, simulator, Expo Go) — registerPushToken() is itself a
  // no-op without both a token and a signed-in user.
  useEffect(() => {
    const unsub = observeAuthState((user) => {
      if (!user) return;
      registerForPushNotificationsAsync().then((token) => {
        if (token) registerPushToken(token);
      });
    });
    return unsub;
  }, []);

  // Online presence — WhatsApp-style: a signed-in user is "online" as long
  // as the server has heard from them recently (see server.ts's
  // computeIsOnline), so this just needs to keep sending a heartbeat while
  // the app is actually in the foreground. No heartbeat while backgrounded
  // or signed out -- both correctly let the user fall back to "offline"
  // server-side once ONLINE_THRESHOLD_MS elapses, with nothing here needing
  // to explicitly announce "I'm going offline now" (unreliable anyway --
  // an app kill or lost connection never gets a chance to run that).
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let signedIn = false;

    const startHeartbeat = () => {
      if (interval) return;
      sendPresenceHeartbeat();
      interval = setInterval(() => {
        if (AppState.currentState === 'active') sendPresenceHeartbeat();
      }, 60000);
    };
    const stopHeartbeat = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    const unsubAuth = observeAuthState((user) => {
      signedIn = !!user;
      if (signedIn) startHeartbeat();
      else stopHeartbeat();
    });

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (!signedIn) return;
      if (nextState === 'active') sendPresenceHeartbeat();
    });

    return () => {
      unsubAuth();
      appStateSub.remove();
      stopHeartbeat();
    };
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    // Required by react-native-gesture-handler for its own gesture
    // recognizers to correctly claim/release touches (previously only the
    // side-effect import at the top of this file was present, no root
    // wrapper) — gesture-handler backs react-native-screens' native-stack
    // transitions and any in-app PanResponder/gesture use, and without this
    // wrapper touch/gesture negotiation across the app can misbehave in
    // ways that are hard to trace back to this one missing piece (e.g. a
    // pagingEnabled FlatList's own scroll gesture never completing a page
    // transition).
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <SuspensionGate>
          <UnreadChatsProvider>
            <SavedProductsProvider>
              <DismissKeyboardView>
                <AppNavigator />
              </DismissKeyboardView>
              {/* Every screen's top header in this app is dark navy (#0f172a) —
                  "auto" picks status bar icon color from the OS theme, not
                  what's actually behind it, so in light mode it was rendering
                  dark icons against that dark header (nearly invisible clock/
                  signal/battery). Forced light (white icons) since that's
                  correct everywhere in this app, not just conditionally. */}
              <StatusBar style="light" />
            </SavedProductsProvider>
          </UnreadChatsProvider>
        </SuspensionGate>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
