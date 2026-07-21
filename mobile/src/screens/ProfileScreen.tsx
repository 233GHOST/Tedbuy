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

      <View style={styles.body}>
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
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0f172a' },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f172a', borderBottomWidth: 1, borderBottomColor: '#020617' },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#ea580c', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#ffffff' },
  avatarText: { color: '#fff', fontSize: 22, fontWeight: '900' },
  headerBody: { flex: 1, marginLeft: 14 },
  name: { color: '#ffffff', fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },
  username: { color: '#94a3b8', marginTop: 3, fontSize: 13, fontWeight: '500' },
  bio: { color: '#cbd5e1', marginTop: 8, lineHeight: 18, fontSize: 12 },
  body: { flex: 1, backgroundColor: '#f8fafc', paddingTop: 16 },
  statsRow: { flexDirection: 'row', paddingHorizontal: 16 },
  statCard: { flex: 1, backgroundColor: '#fff', padding: 14, borderRadius: 16, alignItems: 'center', marginRight: 8, borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#0f172a', shadowOpacity: 0.03, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  statValue: { color: '#0f172a', fontSize: 18, fontWeight: '800' },
  statLabel: { color: '#64748b', marginTop: 4, fontSize: 12, fontWeight: '600' },
  actions: { paddingHorizontal: 16, paddingTop: 14 },
  actionCard: { backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 10, shadowColor: '#0f172a', shadowOpacity: 0.03, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, borderWidth: 1, borderColor: '#e2e8f0' },
  actionTitle: { color: '#1e293b', fontSize: 15, fontWeight: '800' },
  actionText: { color: '#64748b', marginTop: 4, fontSize: 12.5, lineHeight: 18 },
});
