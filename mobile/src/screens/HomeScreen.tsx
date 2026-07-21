import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { categories } from '../data';
import { Product } from '../types';
import { watchProducts, watchUsers } from '../firebase';

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
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubProducts = watchProducts((result) => {
      setProducts(result as Product[]);
      setLoading(false);
    });

    const unsubUsers = watchUsers((result) => {
      setUsers(result);
    });

    return () => {
      unsubProducts();
      unsubUsers();
    };
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
      {/* Premium Web-aligned Header */}
      <View style={styles.headerContainer}>
        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            <View style={styles.brandBadge}>
              <Text style={styles.brandBadgeText}>T</Text>
            </View>
            <Text style={styles.brandName}>
              Ted<Text style={styles.brandNameAccent}>Buy</Text>
            </Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>● Live</Text>
          </View>
        </View>
        <Text style={styles.headerSubtitle}>Ghana's Verified Video Marketplace</Text>
      </View>

      <View style={styles.body}>
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
          <TextInput value={searchText} onChangeText={setSearchText} placeholder="Search phones, laptops, cars..." style={styles.input} placeholderTextColor="#64748b" />
        </View>

        <View style={{ height: 48, marginBottom: 4 }}>
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
        </View>

        {loading ? (
          <View style={styles.loading}><ActivityIndicator size="large" color="#ea580c" /></View>
        ) : (
          <FlatList
            data={filteredProducts}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<View style={styles.emptyState}><Text style={styles.emptyStateTitle}>No listings match your search.</Text><Text style={styles.emptyStateText}>Try a different category or search term.</Text></View>}
            renderItem={({ item }) => {
              const sellerUser = users.find((u) => u.id === item.sellerId);
              return (
                <Pressable onPress={() => onOpenProduct(item)} style={styles.card}>
                  <Image source={{ uri: Array.isArray(item.images) && item.images.length ? item.images[0] : 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80' }} style={styles.image} />
                  <View style={styles.cardContent}>
                    <View style={styles.cardTopRow}>
                      <View style={styles.verifiedBadge}><Text style={styles.verifiedText}>✓ Verified Seller</Text></View>
                      <Text style={styles.price}>{item.price}</Text>
                    </View>
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    <Text style={styles.meta}>{item.category || 'Other'} • {item.location || 'Ghana'}</Text>
                    <Text style={styles.description} numberOfLines={2}>{item.description}</Text>
                    <View style={styles.footerRow}>
                      <Text style={styles.seller}>Seller: {sellerUser?.username || item.sellerName || 'Verified seller'}</Text>
                      <Text style={styles.likes}>♥ {item.likesCount || 0}</Text>
                    </View>
                  </View>
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0f172a' },
  headerContainer: { backgroundColor: '#0f172a', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#020617' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topBarLeft: { flexDirection: 'row', alignItems: 'center' },
  brandBadge: { width: 34, height: 34, borderRadius: 8, backgroundColor: '#020617', borderColor: '#1e293b', borderWidth: 1, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  brandBadgeText: { color: '#ea580c', fontSize: 16, fontWeight: '900' },
  brandName: { color: '#ffffff', fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
  brandNameAccent: { color: '#ea580c' },
  headerSubtitle: { color: '#94a3b8', fontSize: 11, fontWeight: '600', marginTop: 5, textTransform: 'uppercase', letterSpacing: 1.1 },
  badge: { backgroundColor: '#1e293b', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: '#334155' },
  badgeText: { color: '#34d399', fontWeight: '700', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  body: { flex: 1, backgroundColor: '#f8fafc' },
  heroCard: { marginHorizontal: 16, marginTop: 14, marginBottom: 10, backgroundColor: '#ffffff', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, borderWidth: 1, borderColor: '#e2e8f0' },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  heroAccent: { width: 4, height: 42, borderRadius: 999, backgroundColor: '#ea580c', marginRight: 10 },
  heroLabel: { color: '#ea580c', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2 },
  heroTitle: { color: '#1e293b', fontSize: 13, fontWeight: '600', marginTop: 2, lineHeight: 18 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', marginHorizontal: 16, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, marginBottom: 12, shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, borderWidth: 1, borderColor: '#e2e8f0' },
  searchIcon: { fontSize: 15, marginRight: 8 },
  input: { flex: 1, fontSize: 14, color: '#0f172a', paddingVertical: 4 },
  categoryRow: { paddingHorizontal: 16, paddingBottom: 6 },
  categoryChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, marginRight: 8, borderWidth: 1, borderColor: '#cbd5e1' },
  categoryChipActive: { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  categoryIcon: { fontSize: 13, marginRight: 6 },
  categoryText: { color: '#475569', fontWeight: '700', fontSize: 12 },
  categoryTextActive: { color: '#fff' },
  listContent: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },
  emptyState: { backgroundColor: '#fff', borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', marginTop: 20 },
  emptyStateTitle: { color: '#0f172a', fontWeight: '800', fontSize: 15 },
  emptyStateText: { color: '#64748b', marginTop: 4, textAlign: 'center', fontSize: 13 },
  card: { backgroundColor: '#fff', borderRadius: 16, marginBottom: 14, overflow: 'hidden', shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, borderWidth: 1, borderColor: '#e2e8f0' },
  image: { width: '100%', height: 180 },
  cardContent: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14 },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  verifiedBadge: { backgroundColor: '#f0fdf4', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#bbf7d0' },
  verifiedText: { color: '#166534', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  price: { color: '#0f172a', fontWeight: '900', fontSize: 16, letterSpacing: -0.3 },
  cardTitle: { color: '#1e293b', fontSize: 14, fontWeight: '700', marginTop: 6 },
  meta: { color: '#64748b', fontSize: 11, marginTop: 3 },
  description: { color: '#475569', marginTop: 7, lineHeight: 18, fontSize: 12.5 },
  footerRow: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  seller: { color: '#475569', fontSize: 11.5, fontWeight: '600' },
  likes: { color: '#ef4444', fontSize: 11.5, fontWeight: '700' },
});5, fontWeight: '700' },
});
