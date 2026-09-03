import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Store, Search, X } from 'lucide-react-native';
import { auth, watchProducts, watchUsers, fetchUserById, toggleFollowSeller } from '../firebase';
import { Product } from '../types';
import { fonts } from '../theme';
import { computeDiscoverSellers } from '../utils/discoverSellers';
import { SellerCard } from '../components/SellerCard';

interface DiscoverSellersScreenProps {
  onBack: () => void;
  navigation?: any;
}

export function DiscoverSellersScreen({ onBack, navigation }: DiscoverSellersScreenProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const loading = !productsLoaded || !usersLoaded;
  const [searchQuery, setSearchQuery] = useState('');
  // Store-name search + inline follow — was previously only a static
  // ranked grid with no way to find a specific store or follow it without
  // opening its full profile page first.
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    const unsubProducts = watchProducts((result) => {
      setProducts(result);
      setProductsLoaded(true);
    });
    const unsubUsers = watchUsers((result) => {
      setUsers(result);
      setUsersLoaded(true);
    });
    return () => {
      unsubProducts();
      unsubUsers();
    };
  }, []);

  useEffect(() => {
    if (auth.currentUser) {
      fetchUserById(auth.currentUser.uid).then((profile) => {
        if (profile && Array.isArray(profile.followingSellers)) {
          setFollowingIds(new Set(profile.followingSellers));
        }
      });
    }
  }, []);

  const sellers = useMemo(() => computeDiscoverSellers(products, users), [products, users]);

  const filteredSellers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sellers;
    return sellers.filter((s) => s.name.toLowerCase().includes(q));
  }, [sellers, searchQuery]);

  const handleToggleFollow = async (sellerId: string) => {
    const user = auth.currentUser;
    if (!user) {
      navigation?.navigate('Profile');
      return;
    }
    const wasFollowing = followingIds.has(sellerId);
    setTogglingId(sellerId);
    setFollowingIds((prev) => {
      const next = new Set(prev);
      if (wasFollowing) next.delete(sellerId);
      else next.add(sellerId);
      return next;
    });
    try {
      await toggleFollowSeller(sellerId, user.uid);
    } catch (err: any) {
      // Revert optimistic update on failure
      setFollowingIds((prev) => {
        const next = new Set(prev);
        if (wasFollowing) next.add(sellerId);
        else next.delete(sellerId);
        return next;
      });
      Alert.alert('Error', err?.message || 'Could not update follow status.');
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <ArrowLeft size={15} color="#64748b" strokeWidth={2.3} />
          <Text style={styles.backBtnText}>Back to Marketplace</Text>
        </Pressable>
        <View style={styles.titleRow}>
          <View style={styles.iconBadge}>
            <Store size={18} color="#ffffff" strokeWidth={2.2} />
          </View>
          <Text style={styles.title}>Popular Stores</Text>
        </View>

        <View style={styles.searchRow}>
          <Search size={15} color="#94a3b8" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search store names..."
            placeholderTextColor="#94a3b8"
            style={styles.searchInput}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <X size={15} color="#94a3b8" />
            </Pressable>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#0f172a" />
        </View>
      ) : (
        <FlatList
          data={filteredSellers}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          keyExtractor={(item) => `discover-seller-${item.id}`}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: seller }) => (
            <SellerCard
              seller={seller}
              onPress={() => navigation?.navigate('SellerProfile', { sellerId: seller.id })}
              style={styles.sellerCard}
              isFollowing={followingIds.has(seller.id)}
              isTogglingFollow={togglingId === seller.id}
              onToggleFollow={() => handleToggleFollow(seller.id)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIconBadge}>
                <Store size={22} color="#0f172a" strokeWidth={2.2} />
              </View>
              <Text style={styles.emptyTitle}>{searchQuery ? 'No Matching Stores' : 'No Sellers Yet'}</Text>
              <Text style={styles.emptyText}>
                {searchQuery ? 'Try a different store name.' : 'Active merchants with listings will show up here.'}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f8fafc' },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#e2e8f0', backgroundColor: '#ffffff' },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, alignSelf: 'flex-start' },
  backBtnText: { color: '#64748b', fontSize: 12, fontFamily: fonts.bold },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  iconBadge: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, color: '#0f172a', fontFamily: fonts.extrabold, letterSpacing: -0.3 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f1f5f9', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, fontSize: 13, color: '#0f172a', fontFamily: fonts.medium },
  listContent: { padding: 16 },
  columnWrapper: { justifyContent: 'space-between' },
  loadingState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  sellerCard: { width: '48%', marginBottom: 12 },
  emptyState: { alignItems: 'center', justifyContent: 'center', padding: 40, marginTop: 20 },
  emptyIconBadge: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  emptyTitle: { fontSize: 15, color: '#1e293b', fontFamily: fonts.bold, marginBottom: 4 },
  emptyText: { fontSize: 12.5, color: '#64748b', textAlign: 'center', maxWidth: 260 },
});
