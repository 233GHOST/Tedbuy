import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Sparkles } from 'lucide-react-native';
import { auth, watchProducts, watchUsers } from '../firebase';
import { Product } from '../types';
import { fonts } from '../theme';
import { ProductCard } from '../components/ProductCard';
import { getForYouProducts } from '../utils/recommendationScore';

interface ForYouScreenProps {
  onBack: () => void;
  navigation?: any;
}

export function ForYouScreen({ onBack, navigation }: ForYouScreenProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubProducts = watchProducts((result) => {
      setProducts(result as Product[]);
      setLoading(false);
    });
    const unsubUsers = watchUsers((result) => setUsers(result));
    return () => {
      unsubProducts();
      unsubUsers();
    };
  }, []);

  const forYouResult = useMemo(() => getForYouProducts({
    products,
    users,
    currentUserId: auth.currentUser?.uid,
    limit: 60,
  }), [products, users]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <ArrowLeft size={15} color="#64748b" strokeWidth={2.3} />
          <Text style={styles.backBtnText}>Back to Marketplace</Text>
        </Pressable>
        <View style={styles.titleRow}>
          <View style={styles.iconBadge}>
            <Sparkles size={18} color="#ffffff" strokeWidth={2.2} />
          </View>
          <Text style={styles.title}>{loading ? 'For You' : forYouResult.headline}</Text>
        </View>
        {!loading && forYouResult.subtitle && (
          <Text style={styles.subtitle}>{forYouResult.subtitle}</Text>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#0f172a" />
        </View>
      ) : (
        <FlatList
          data={forYouResult.items}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          keyExtractor={(item) => `for-you-all-${item.id}`}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <ProductCard
              product={item}
              onPress={() => navigation?.navigate('ProductDetail', { productId: item.id })}
              onSellerPress={(sellerId) => navigation?.navigate('SellerProfile', { sellerId })}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIconBadge}>
                <Sparkles size={22} color="#0f172a" strokeWidth={2.2} />
              </View>
              <Text style={styles.emptyTitle}>No Recommendations Yet</Text>
              <Text style={styles.emptyText}>Browse a few listings and we'll start personalizing this for you.</Text>
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBadge: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, color: '#0f172a', fontFamily: fonts.extrabold, letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: '#64748b', fontFamily: fonts.semibold, marginTop: 6, marginLeft: 46 },
  listContent: { padding: 16 },
  columnWrapper: { justifyContent: 'space-between', paddingHorizontal: 4 },
  loadingState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyState: { alignItems: 'center', justifyContent: 'center', padding: 40, marginTop: 20 },
  emptyIconBadge: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  emptyTitle: { fontSize: 15, color: '#1e293b', fontFamily: fonts.bold, marginBottom: 4 },
  emptyText: { fontSize: 12.5, color: '#64748b', textAlign: 'center', maxWidth: 260 },
});
