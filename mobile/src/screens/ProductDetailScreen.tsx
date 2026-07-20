import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchProductById } from '../firebase';

interface ProductDetailScreenProps {
  productId: string;
  onBack: () => void;
}

export function ProductDetailScreen({ productId, onBack }: ProductDetailScreenProps) {
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProductById(productId).then((result) => {
      setProduct(result);
      setLoading(false);
    });
  }, [productId]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#0f766e" /></View>;
  }

  if (!product) {
    return null;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backText}>← Back</Text></Pressable>
        <Image source={{ uri: Array.isArray(product.images) && product.images.length ? product.images[0] : 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80' }} style={styles.image} />
        <View style={styles.card}>
          <Text style={styles.title}>{product.title}</Text>
          <Text style={styles.price}>{product.price}</Text>
          <Text style={styles.meta}>{product.category || 'Other'} • {product.location || 'Ghana'}</Text>
          <Text style={styles.description}>{product.description}</Text>
          <View style={styles.infoRow}>
            <View style={styles.infoBox}><Text style={styles.infoLabel}>Condition</Text><Text style={styles.infoValue}>{product.condition || 'Good'}</Text></View>
            <View style={styles.infoBox}><Text style={styles.infoLabel}>Negotiable</Text><Text style={styles.infoValue}>{product.negotiable ? 'Yes' : 'No'}</Text></View>
          </View>
          <View style={styles.sellerBox}>
            <Text style={styles.sellerTitle}>Seller</Text>
            <Text style={styles.sellerName}>{product.sellerName || 'Verified seller'}</Text>
            <Text style={styles.sellerRating}>★ {product.likesCount || 0} engagement</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f4f7fb' },
  content: { paddingBottom: 24 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f4f7fb' },
  backButton: { marginHorizontal: 16, marginTop: 8, marginBottom: 8 },
  backText: { color: '#0f766e', fontWeight: '700' },
  image: { width: '100%', height: 260 },
  card: { marginHorizontal: 16, marginTop: 12, backgroundColor: '#fff', borderRadius: 20, padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  title: { color: '#0f172a', fontSize: 24, fontWeight: '800' },
  price: { color: '#0f766e', fontSize: 20, fontWeight: '800', marginTop: 6 },
  meta: { color: '#64748b', marginTop: 6 },
  description: { color: '#475569', marginTop: 12, lineHeight: 22 },
  infoRow: { flexDirection: 'row', marginTop: 14, gap: 10 },
  infoBox: { flex: 1, backgroundColor: '#f8fafc', borderRadius: 12, padding: 10 },
  infoLabel: { color: '#64748b', fontSize: 12 },
  infoValue: { color: '#0f172a', fontWeight: '700', marginTop: 4 },
  sellerBox: { marginTop: 14, backgroundColor: '#ecfeff', borderRadius: 12, padding: 12 },
  sellerTitle: { color: '#0f766e', fontWeight: '700' },
  sellerName: { color: '#0f172a', fontSize: 16, fontWeight: '700', marginTop: 4 },
  sellerRating: { color: '#64748b', marginTop: 4 },
});
