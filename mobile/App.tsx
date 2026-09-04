import 'react-native-gesture-handler';
import { useEffect } from 'react';
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
import { SuspensionGate } from './src/components/SuspensionGate';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { UnreadChatsProvider } from './src/context/UnreadChats';
import { SavedProductsProvider } from './src/context/SavedProducts';
import { DismissKeyboardView } from './src/components/DismissKeyboardView';

SplashScreen.preventAutoHideAsync().catch(() => {});

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

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
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
  );
}
