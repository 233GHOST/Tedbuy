import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Bookmark } from 'lucide-react-native';
import { watchProducts } from '../firebase';
import { Product } from '../types';
import { fonts } from '../theme';
import { ProductCard } from '../components/ProductCard';
import { useSavedProducts } from '../context/SavedProducts';

interface SavedProductsScreenProps {
  onBack: () => void;
  navigation?: any;
}

/** Matches web's "Saved" tab on the Vendor Hub / dashboard — a bookmarked
 * heart on a product should always lead somewhere real. Previously mobile
 * had no dedicated place for this at all: bookmarking wrote to the wrong
 * field entirely (see context/SavedProducts.tsx), and even once fixed, the
 * only way to see saved items was to scroll past "My Classified Listings"
 * on the Profile Dashboard tab. This is its own screen, reached directly
 * from the header's bookmark badge, same as web's dedicated Saved view. */
export function SavedProductsScreen({ onBack, navigation }: SavedProductsScreenProps) {
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const { savedProductIds } = useSavedProducts();

  useEffect(() => {
    const unsub = watchProducts((result) => {
      setAllProducts(result);
      setLoading(false);
    });
    return unsub;
  }, []);

  const savedProducts = allProducts.filter((p) => savedProductIds.includes(p.id));

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <ArrowLeft size={15} color="#64748b" strokeWidth={2.3} />
          <Text style={styles.backBtnText}>Back to Marketplace</Text>
        </Pressable>
        <View style={styles.titleRow}>
          <View style={styles.iconBadge}>
            <Bookmark size={18} color="#ffffff" strokeWidth={2.3} fill="#ffffff" />
          </View>
          <Text style={styles.title}>Saved Deals</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#0f172a" />
        </View>
      ) : (
        <FlatList
          data={savedProducts}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          keyExtractor={(item) => `saved-${item.id}`}
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
                <Bookmark size={22} color="#e11d48" strokeWidth={2.2} />
              </View>
              <Text style={styles.emptyTitle}>No Saved Deals Yet</Text>
              <Text style={styles.emptyText}>Tap the bookmark icon on any listing to save it here for later.</Text>
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
  iconBadge: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#e11d48', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, color: '#0f172a', fontFamily: fonts.extrabold, letterSpacing: -0.3 },
  listContent: { padding: 16 },
  columnWrapper: { justifyContent: 'space-between', paddingHorizontal: 4 },
  loadingState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyState: { alignItems: 'center', justifyContent: 'center', padding: 40, marginTop: 20 },
  emptyIconBadge: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff1f2', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  emptyTitle: { fontSize: 15, color: '#1e293b', fontFamily: fonts.bold, marginBottom: 4 },
  emptyText: { fontSize: 12.5, color: '#64748b', textAlign: 'center', maxWidth: 260 },
});
