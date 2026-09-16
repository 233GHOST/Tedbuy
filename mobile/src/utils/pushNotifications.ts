import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Some platforms suppress a notification banner while the app is already
// open in the foreground by default -- that would make a real-time event
// (a new message arriving while browsing, say) silently invisible even
// though the notification was genuinely sent. Show it regardless.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Requests notification permission and returns a real Expo push token, or
 * null if the user denied permission, this is a simulator/emulator (push
 * tokens require a physical device), or anything else went wrong. Never
 * throws -- every caller should treat "no token" as a normal, expected
 * outcome (the user simply said no), not an error to surface to them.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    // Simulators/emulators cannot receive real pushes -- not an error,
    // just nothing to register.
    return null;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      return null;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      console.warn('[pushNotifications] No EAS projectId configured -- cannot request a push token.');
      return null;
    }

    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    return tokenResponse.data;
  } catch (err) {
    console.warn('[pushNotifications] Failed to register for push notifications:', err);
    return null;
  }
}
