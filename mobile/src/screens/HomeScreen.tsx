import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { categories } from '../data';
import { Product } from '../types';
import { watchProducts } from '../firebase';

interface HomeScreenProps {
  onOpenProduct: (product: Product) => void;
}

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
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Tedbuy Mobile</Text>
          <Text style={styles.title}>Find trusted deals nearby</Text>
        </View>
        <View style={styles.badge}><Text style={styles.badgeText}>Live</Text></View>
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
              <Text style={[styles.categoryText, active && styles.categoryTextActive]}>{category}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator size="large" color="#0f766e" /></View>
      ) : (
        <FlatList data={filteredProducts} keyExtractor={(item) => item.id} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false} renderItem={({ item }) => (
          <Pressable onPress={() => onOpenProduct(item)} style={styles.card}>
            <Image source={{ uri: Array.isArray(item.images) && item.images.length ? item.images[0] : 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80' }} style={styles.image} />
            <View style={styles.cardContent}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.price}>{item.price}</Text>
              </View>
              <Text style={styles.meta}>{item.category || 'Other'} • {item.location || 'Ghana'}</Text>
              <Text style={styles.description} numberOfLines={2}>{item.description}</Text>
              <View style={styles.footerRow}>
                <Text style={styles.seller}>Seller: {item.sellerName || 'Verified seller'}</Text>
                <Text style={styles.likes}>♥ {item.likesCount || 0}</Text>
              </View>
            </View>
          </Pressable>
        )} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f4f7fb' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { color: '#0f766e', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2 },
  title: { color: '#0f172a', fontSize: 24, fontWeight: '800', marginTop: 4 },
  badge: { backgroundColor: '#dcfce7', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  badgeText: { color: '#166534', fontWeight: '700' },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', marginHorizontal: 20, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  searchIcon: { fontSize: 16, marginRight: 8 },
  input: { flex: 1, fontSize: 15, color: '#0f172a' },
  categoryRow: { paddingHorizontal: 16, paddingBottom: 10 },
  categoryChip: { backgroundColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, marginRight: 8 },
  categoryChipActive: { backgroundColor: '#0f766e' },
  categoryText: { color: '#334155', fontWeight: '600' },
  categoryTextActive: { color: '#fff' },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 18, marginBottom: 14, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  image: { width: '100%', height: 180 },
  cardContent: { padding: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: '#0f172a', fontSize: 16, fontWeight: '700', flex: 1, marginRight: 8 },
  price: { color: '#0f766e', fontWeight: '800' },
  meta: { color: '#64748b', fontSize: 12, marginTop: 4 },
  description: { color: '#475569', marginTop: 8, lineHeight: 20 },
  footerRow: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  seller: { color: '#334155', fontSize: 12, fontWeight: '600' },
  likes: { color: '#ef4444', fontSize: 12, fontWeight: '700' },
});
