import * as Notifications from 'expo-notifications';
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
 * null if the user denied permission or anything else went wrong (an Android
 * emulator with Google Play can register, which is how order pushes are tested). Never
 * throws -- every caller should treat "no token" as a normal, expected
 * outcome (the user simply said no), not an error to surface to them.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
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
      // Order updates (new order, item on its way, ...): sound and heads-up banner.
      await Notifications.setNotificationChannelAsync('orders', {
        name: 'Orders',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
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
