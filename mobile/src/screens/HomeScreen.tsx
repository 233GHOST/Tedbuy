import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { categories } from '../data';
import { Product } from '../types';
import { watchProducts } from '../firebase';

interface HomeScreenProps {
  onOpenProduct: (product: Product) => void;
}

const categoryIcons: Record<string, string> = {
  All: '✨',
  Phones: '📱',
  Laptops: '💻',
  Fashion: '👟',
  Vehicles: '🚗',
  Other: '📦',
};

export function HomeScreen({ onOpenProduct }: HomeScreenProps) {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchText, setSearchText] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = watchProducts((result) => {
      setProducts(result as Product[]);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const category = product.category || 'Other';
      const title = String(product.title || '').toLowerCase();
      const location = String(product.location || '').toLowerCase();
      const query = searchText.toLowerCase();
      const matchesCategory = selectedCategory === 'All' || category === selectedCategory;
      const matchesSearch = title.includes(query) || location.includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [products, searchText, selectedCategory]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <View style={styles.brandBadge}><Text style={styles.brandBadgeText}>T</Text></View>
          <View>
            <Text style={styles.eyebrow}>Tedbuy Ghana</Text>
            <Text style={styles.title}>Verified marketplace</Text>
          </View>
        </View>
        <View style={styles.badge}><Text style={styles.badgeText}>Live</Text></View>
      </View>

      <View style={styles.heroCard}>
        <View style={styles.heroRow}>
          <View style={styles.heroAccent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.heroLabel}>Popular right now</Text>
            <Text style={styles.heroTitle}>Find trusted gadgets, fashion, and vehicles with the same polished feel as the web experience.</Text>
          </View>
        </View>
      </View>

      <View style={styles.searchBox}>
        <Text style={styles.searchIcon}>🔎</Text>
        <TextInput value={searchText} onChangeText={setSearchText} placeholder="Search phones, laptops, cars..." style={styles.input} placeholderTextColor="#6b7280" />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
        {categories.map((category) => {
          const active = selectedCategory === category;
          return (
            <Pressable key={category} onPress={() => setSelectedCategory(category)} style={[styles.categoryChip, active && styles.categoryChipActive]}>
              <Text style={styles.categoryIcon}>{categoryIcons[category] || '📦'}</Text>
              <Text style={[styles.categoryText, active && styles.categoryTextActive]}>{category}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator size="large" color="#0f766e" /></View>
      ) : (
        <FlatList
          data={filteredProducts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<View style={styles.emptyState}><Text style={styles.emptyStateTitle}>No listings match your search.</Text><Text style={styles.emptyStateText}>Try a different category or search term.</Text></View>}
          renderItem={({ item }) => (
            <Pressable onPress={() => onOpenProduct(item)} style={styles.card}>
              <Image source={{ uri: Array.isArray(item.images) && item.images.length ? item.images[0] : 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80' }} style={styles.image} />
              <View style={styles.cardContent}>
                <View style={styles.cardTopRow}>
                  <View style={styles.verifiedBadge}><Text style={styles.verifiedText}>Verified</Text></View>
                  <Text style={styles.price}>{item.price}</Text>
                </View>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.meta}>{item.category || 'Other'} • {item.location || 'Ghana'}</Text>
                <Text style={styles.description} numberOfLines={2}>{item.description}</Text>
                <View style={styles.footerRow}>
                  <Text style={styles.seller}>Seller: {item.sellerName || 'Verified seller'}</Text>
                  <Text style={styles.likes}>♥ {item.likesCount || 0}</Text>
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f4f7fb' },
  topBar: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topBarLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  brandBadge: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#0f766e', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  brandBadgeText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  eyebrow: { color: '#0f766e', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2 },
  title: { color: '#0f172a', fontSize: 20, fontWeight: '800', marginTop: 1 },
  badge: { backgroundColor: '#dcfce7', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  badgeText: { color: '#166534', fontWeight: '700', fontSize: 12 },
  heroCard: { marginHorizontal: 20, marginBottom: 10, backgroundColor: '#ffffff', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  heroAccent: { width: 4, height: 40, borderRadius: 999, backgroundColor: '#0f766e', marginRight: 10 },
  heroLabel: { color: '#0f766e', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2 },
  heroTitle: { color: '#0f172a', fontSize: 14, fontWeight: '700', marginTop: 2, lineHeight: 19 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', marginHorizontal: 20, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  searchIcon: { fontSize: 15, marginRight: 8 },
  input: { flex: 1, fontSize: 14, color: '#0f172a' },
  categoryRow: { paddingHorizontal: 16, paddingBottom: 8 },
  categoryChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, marginRight: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  categoryChipActive: { backgroundColor: '#0f766e', borderColor: '#0f766e' },
  categoryIcon: { fontSize: 13, marginRight: 6 },
  categoryText: { color: '#334155', fontWeight: '600', fontSize: 13 },
  categoryTextActive: { color: '#fff' },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyState: { backgroundColor: '#fff', borderRadius: 16, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  emptyStateTitle: { color: '#0f172a', fontWeight: '700', fontSize: 15 },
  emptyStateText: { color: '#64748b', marginTop: 4, textAlign: 'center', fontSize: 13 },
  card: { backgroundColor: '#fff', borderRadius: 18, marginBottom: 14, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, borderWidth: 1, borderColor: '#eef2f7' },
  image: { width: '100%', height: 182 },
  cardContent: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12 },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  verifiedBadge: { backgroundColor: '#ecfeff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  verifiedText: { color: '#0f766e', fontSize: 10, fontWeight: '700' },
  price: { color: '#0f766e', fontWeight: '800', fontSize: 14 },
  cardTitle: { color: '#0f172a', fontSize: 15, fontWeight: '700', marginTop: 7 },
  meta: { color: '#64748b', fontSize: 11.5, marginTop: 3 },
  description: { color: '#475569', marginTop: 7, lineHeight: 18, fontSize: 13 },
  footerRow: { marginTop: 9, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  seller: { color: '#334155', fontSize: 11.5, fontWeight: '600' },
  likes: { color: '#ef4444', fontSize: 11.5, fontWeight: '700' },
});
