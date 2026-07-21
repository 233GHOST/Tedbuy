import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, observeAuthState, logOut } from '../firebase';

export function ProfileScreen() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const unsubscribe = observeAuthState((currentUser) => setUser(currentUser));
    return unsubscribe;
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{(user?.email || 'T').slice(0, 2).toUpperCase()}</Text></View>
        <View style={styles.headerBody}>
          <Text style={styles.name}>{user?.displayName || 'Tedbuy member'}</Text>
          <Text style={styles.username}>{user?.email || 'Sign in to sync your account'}</Text>
          <Text style={styles.bio}>Your account is connected to the live Tedbuy backend and keeps your activity in sync.</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}><Text style={styles.statValue}>{user ? 'Live' : 'Guest'}</Text><Text style={styles.statLabel}>Status</Text></View>
        <View style={styles.statCard}><Text style={styles.statValue}>Safe</Text><Text style={styles.statLabel}>Trades</Text></View>
        <View style={styles.statCard}><Text style={styles.statValue}>24/7</Text><Text style={styles.statLabel}>Support</Text></View>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.actionCard} onPress={() => auth.currentUser ? logOut() : null}><Text style={styles.actionTitle}>{auth.currentUser ? 'Sign out' : 'Sign in required'}</Text><Text style={styles.actionText}>{auth.currentUser ? 'End your current session' : 'Use your Tedbuy account to start syncing'}</Text></Pressable>
        <Pressable style={styles.actionCard}><Text style={styles.actionTitle}>Seller dashboard</Text><Text style={styles.actionText}>Track your ads and activity from one place</Text></Pressable>
        <Pressable style={styles.actionCard}><Text style={styles.actionTitle}>Safety tips</Text><Text style={styles.actionText}>Meet in public and verify payment before you trade</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f4f7fb' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#0f766e', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 22, fontWeight: '800' },
  headerBody: { flex: 1, marginLeft: 12 },
  name: { color: '#0f172a', fontSize: 20, fontWeight: '800' },
  username: { color: '#64748b', marginTop: 2 },
  bio: { color: '#475569', marginTop: 6, lineHeight: 20 },
  statsRow: { flexDirection: 'row', paddingHorizontal: 16 },
  statCard: { flex: 1, backgroundColor: '#fff', padding: 14, borderRadius: 16, alignItems: 'center', marginRight: 8, borderWidth: 1, borderColor: '#eef2f7' },
  statValue: { color: '#0f172a', fontSize: 18, fontWeight: '800' },
  statLabel: { color: '#64748b', marginTop: 4 },
  actions: { paddingHorizontal: 16, paddingTop: 18 },
  actionCard: { backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, borderWidth: 1, borderColor: '#eef2f7' },
  actionTitle: { color: '#0f172a', fontSize: 16, fontWeight: '700' },
  actionText: { color: '#64748b', marginTop: 4 },
});
