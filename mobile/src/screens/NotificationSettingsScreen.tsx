import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, UserPlus, MessageCircle, Store } from 'lucide-react-native';
import { auth, observeAuthState, fetchUserById, updateUserProfile } from '../firebase';
import { colors, radius, spacing, fonts } from '../theme';

interface Props {
  onBack: () => void;
}

/** Dedicated Notification Settings screen — relocated verbatim from
 * ProfileScreen.tsx's Settings tab (same three preferences, same
 * handleToggleNotificationPref merge-update behavior, same backend contract).
 * Nothing here is new functionality: `notificationPreferences` already
 * persists via updateUserProfile()'s existing partial-merge semantics, and
 * the server's shouldNotifyUser() already gates new_follower/new_message/
 * followed_seller_new_listing notifications on these exact three keys. */
export function NotificationSettingsScreen({ onBack }: Props) {
  const [userProfile, setUserProfile] = useState<any>(null);
  const [notifyNewFollower, setNotifyNewFollower] = useState(true);
  const [notifyNewMessage, setNotifyNewMessage] = useState(true);
  const [notifyFollowedSellerNewListing, setNotifyFollowedSellerNewListing] = useState(true);
  const [savingNotifKey, setSavingNotifKey] = useState<string | null>(null);

  useEffect(() => {
    const unsub = observeAuthState((currentUser) => {
      if (currentUser) {
        fetchUserById(currentUser.uid).then((profile) => {
          if (profile) setUserProfile(profile);
        });
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (userProfile) {
      const prefs = userProfile.notificationPreferences;
      setNotifyNewFollower(prefs?.newFollower !== false);
      setNotifyNewMessage(prefs?.newMessage !== false);
      setNotifyFollowedSellerNewListing(prefs?.followedSellerNewListing !== false);
    }
  }, [userProfile]);

  const handleToggleNotificationPref = async (
    key: 'newFollower' | 'newMessage' | 'followedSellerNewListing',
    nextValue: boolean,
    setLocal: (v: boolean) => void
  ) => {
    const prevValue = !nextValue;
    setLocal(nextValue);
    setSavingNotifKey(key);
    try {
      // Only the changed key is sent — updateUserProfile merges it into the
      // existing notificationPreferences object server-side rather than
      // replacing it, so toggling one preference can never reset the other two.
      const updated = await updateUserProfile({ notificationPreferences: { [key]: nextValue } });
      setUserProfile(updated);
    } catch (err: any) {
      setLocal(prevValue);
      Alert.alert('Could Not Update', err?.message || 'Please try again.');
    } finally {
      setSavingNotifKey(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backBtn} hitSlop={10}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>Control which activities notify you.</Text>

        <Text style={styles.groupLabel}>Social Activity</Text>
        <View style={styles.group}>
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <View style={styles.rowLeft}>
              <View style={styles.iconBadge}>
                <UserPlus size={16} color={colors.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>New Followers</Text>
                <Text style={styles.rowSubtitle}>When someone starts following your store.</Text>
              </View>
            </View>
            <Switch
              value={notifyNewFollower}
              onValueChange={(v) => handleToggleNotificationPref('newFollower', v, setNotifyNewFollower)}
              disabled={savingNotifKey === 'newFollower'}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#ffffff"
            />
          </View>
        </View>

        <Text style={styles.groupLabel}>Messages</Text>
        <View style={styles.group}>
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <View style={styles.rowLeft}>
              <View style={styles.iconBadge}>
                <MessageCircle size={16} color={colors.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>New Messages</Text>
                <Text style={styles.rowSubtitle}>Chat activity from buyers and sellers.</Text>
              </View>
            </View>
            <Switch
              value={notifyNewMessage}
              onValueChange={(v) => handleToggleNotificationPref('newMessage', v, setNotifyNewMessage)}
              disabled={savingNotifKey === 'newMessage'}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#ffffff"
            />
          </View>
        </View>

        <Text style={styles.groupLabel}>Followed Stores</Text>
        <View style={styles.group}>
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <View style={styles.rowLeft}>
              <View style={styles.iconBadge}>
                <Store size={16} color={colors.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Stores You Follow</Text>
                <Text style={styles.rowSubtitle}>When a store you follow posts a new listing.</Text>
              </View>
            </View>
            <Switch
              value={notifyFollowedSellerNewListing}
              onValueChange={(v) => handleToggleNotificationPref('followedSellerNewListing', v, setNotifyFollowedSellerNewListing)}
              disabled={savingNotifKey === 'followedSellerNewListing'}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#ffffff"
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 34, height: 34, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontFamily: fonts.extrabold, color: colors.text },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  intro: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.lg },
  groupLabel: {
    fontSize: 12,
    fontFamily: fonts.extrabold,
    color: colors.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1, paddingRight: spacing.md },
  iconBadge: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: 14.5, fontFamily: fonts.bold, color: colors.text },
  rowSubtitle: { fontSize: 12.5, color: colors.textMuted, marginTop: 2 },
});
