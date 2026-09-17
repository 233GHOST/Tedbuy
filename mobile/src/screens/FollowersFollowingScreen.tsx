import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, X, UserPlus, UserMinus } from 'lucide-react-native';
import { BackButton } from '../components/BackButton';
import { auth, watchUsers, fetchUserById, toggleFollowSeller } from '../firebase';
import { fonts } from '../theme';

interface Props {
  userId: string;
  initialTab?: 'followers' | 'following';
  onBack: () => void;
  navigation: any;
}

/** Dedicated Following/Followers screen — replaces the old in-page modal on
 * ProfileScreen.tsx with a full screen matching the Instagram-style
 * reference the user provided (back button, tabs with counts, search,
 * follow-toggle rows). Works for any user's network, not just your own, so
 * it can also replace SellerProfileScreen.tsx's identical modal later. */
export function FollowersFollowingScreen({ userId, initialTab = 'followers', onBack, navigation }: Props) {
  const [targetProfile, setTargetProfile] = useState<any>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'followers' | 'following'>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  // A Set, not a single id -- a single shared value rejected a tap on ANY
  // row while a different row's request was still in flight (only the
  // in-flight row got the disabled/spinner treatment, so other rows looked
  // tappable but silently dropped the tap with zero feedback).
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  const currentUser = auth.currentUser;

  useEffect(() => {
    // Preemptive fix for the same "stale data across in-place navigation"
    // bug just found and fixed in SellerProfileScreen.tsx/SellerProfilePage.tsx
    // this session -- not reachable today (the only caller always passes
    // the signed-in user's own uid, so `userId` never actually changes
    // across a reused screen instance), but this screen's own header
    // comment says it's meant to replace SellerProfileScreen's identical
    // modal for arbitrary target users next, at which point switching
    // targets via React Navigation reusing this instance would otherwise
    // show the previous target's stale username/list until the new fetch
    // resolves.
    setTargetProfile(null);
    fetchUserById(userId).then((profile) => {
      if (profile) setTargetProfile(profile);
    });
  }, [userId]);

  useEffect(() => {
    if (currentUser) {
      fetchUserById(currentUser.uid).then((profile) => {
        if (profile) setCurrentUserProfile(profile);
      });
    }
  }, [currentUser?.uid]);

  useEffect(() => {
    const unsub = watchUsers((result) => setAllUsers(result));
    return unsub;
  }, []);

  const followers = useMemo(
    () => allUsers.filter((u) => Array.isArray(u.followingSellers) && u.followingSellers.includes(userId)),
    [allUsers, userId]
  );
  const following = useMemo(() => {
    // When viewing your own Following list (the only case reachable today
    // -- ProfileScreen.tsx always passes your own uid), targetProfile and
    // currentUserProfile represent the same account, but only
    // currentUserProfile.followingSellers gets updated by
    // handleToggleFollow's optimistic update below. Preferring that live
    // copy here means following/unfollowing someone from this screen
    // updates the list and count immediately instead of requiring the user
    // to leave and re-enter the screen to see the change.
    const sourceProfile = (currentUser && targetProfile?.id === currentUser.uid) ? currentUserProfile : targetProfile;
    return sourceProfile ? allUsers.filter((u) => Array.isArray(sourceProfile.followingSellers) && sourceProfile.followingSellers.includes(u.id)) : [];
  }, [allUsers, targetProfile, currentUserProfile, currentUser]);

  const activeList = activeTab === 'following' ? following : followers;
  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeList;
    return activeList.filter((u) => String(u.username || '').toLowerCase().includes(q));
  }, [activeList, searchQuery]);

  const handleToggleFollow = async (targetUserId: string) => {
    if (!currentUser || togglingIds.has(targetUserId)) return;
    setTogglingIds((prev) => new Set(prev).add(targetUserId));
    try {
      await toggleFollowSeller(targetUserId, currentUser.uid);
      setCurrentUserProfile((prev: any) => {
        if (!prev) return prev;
        const list: string[] = Array.isArray(prev.followingSellers) ? prev.followingSellers : [];
        const next = list.includes(targetUserId) ? list.filter((id) => id !== targetUserId) : [...list, targetUserId];
        return { ...prev, followingSellers: next };
      });
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not update follow status.');
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(targetUserId);
        return next;
      });
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <BackButton onPress={onBack} color="#0f172a" />
        <Text style={styles.headerTitle} numberOfLines={1}>{targetProfile?.username || 'Network'}</Text>
        <View style={{ width: 34 }} />
      </View>

      <View style={styles.tabRow}>
        <Pressable onPress={() => setActiveTab('following')} style={styles.tabItem}>
          <Text style={[styles.tabText, activeTab === 'following' && styles.tabTextActive]}>
            Following <Text style={styles.tabCount}>{following.length}</Text>
          </Text>
          {activeTab === 'following' && <View style={styles.tabUnderline} />}
        </Pressable>
        <Pressable onPress={() => setActiveTab('followers')} style={styles.tabItem}>
          <Text style={[styles.tabText, activeTab === 'followers' && styles.tabTextActive]}>
            Followers <Text style={styles.tabCount}>{followers.length}</Text>
          </Text>
          {activeTab === 'followers' && <View style={styles.tabUnderline} />}
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <Search size={15} color="#94a3b8" />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search"
          placeholderTextColor="#94a3b8"
          style={styles.searchInput}
        />
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
            <X size={15} color="#94a3b8" />
          </Pressable>
        )}
      </View>

      <FlatList
        data={filteredList}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>
              {searchQuery ? 'No Matches' : activeTab === 'following' ? 'Not following anyone' : 'No followers yet'}
            </Text>
            {!searchQuery && (
              <Text style={styles.emptyText}>
                {activeTab === 'following'
                  ? "Follow sellers to see their new listings here."
                  : 'No one is following this store yet.'}
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const isMe = currentUser?.uid === item.id;
          const amIFollowing = Array.isArray(currentUserProfile?.followingSellers) && currentUserProfile.followingSellers.includes(item.id);
          const itemAvatar = item.photoUrl && !String(item.photoUrl).includes('1549399542-7e3f8b79c341') ? item.photoUrl : null;
          return (
            <View style={styles.row}>
              <Pressable
                onPress={() => navigation.navigate('SellerProfile', { sellerId: item.id })}
                style={styles.rowUser}
              >
                {itemAvatar ? (
                  <Image source={{ uri: itemAvatar }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarText}>{String(item.username || 'U').slice(0, 2).toUpperCase()}</Text>
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{item.username || 'TedBuy User'}</Text>
                  <Text style={styles.rowRole}>{item.role || 'user'}</Text>
                </View>
              </Pressable>
              {!isMe && currentUser && (
                <Pressable
                  onPress={() => handleToggleFollow(item.id)}
                  disabled={togglingIds.has(item.id)}
                  style={[styles.actionBtn, amIFollowing && styles.actionBtnActive]}
                >
                  {togglingIds.has(item.id) ? (
                    <ActivityIndicator size="small" color={amIFollowing ? '#e11d48' : '#0f172a'} />
                  ) : (
                    <>
                      {amIFollowing ? <UserMinus size={11} color="#e11d48" /> : <UserPlus size={11} color="#0f172a" />}
                      <Text style={[styles.actionText, amIFollowing && styles.actionTextActive]}>
                        {amIFollowing ? 'Unfollow' : 'Follow'}
                      </Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#ffffff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 15, fontFamily: fonts.extrabold, color: '#0f172a' },

  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabText: { fontSize: 13, fontFamily: fonts.bold, color: '#94a3b8' },
  tabTextActive: { color: '#0f172a' },
  tabCount: { fontFamily: fonts.extrabold },
  tabUnderline: { position: 'absolute', bottom: -1, height: 2, width: '60%', backgroundColor: '#0f172a', borderRadius: 1 },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f1f5f9', borderRadius: 12, marginHorizontal: 16, marginTop: 12, marginBottom: 4, paddingHorizontal: 12, height: 40 },
  searchInput: { flex: 1, fontSize: 13, color: '#0f172a', fontFamily: fonts.medium },

  listContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  rowUser: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, color: '#64748b', fontFamily: fonts.extrabold },
  rowName: { fontSize: 13.5, color: '#0f172a', fontFamily: fonts.extrabold },
  rowRole: { fontSize: 10.5, color: '#94a3b8', fontFamily: fonts.semibold, textTransform: 'capitalize', marginTop: 1 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  actionBtnActive: { borderColor: '#fecdd3', backgroundColor: '#fff1f2' },
  actionText: { fontSize: 11, fontFamily: fonts.bold, color: '#0f172a' },
  actionTextActive: { color: '#e11d48' },

  emptyState: { alignItems: 'center', justifyContent: 'center', padding: 40, marginTop: 20 },
  emptyTitle: { fontSize: 13, fontFamily: fonts.extrabold, color: '#1e293b' },
  emptyText: { fontSize: 11.5, color: '#64748b', textAlign: 'center', marginTop: 4, maxWidth: 260 },
});
