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
        <View style={styles.headerBar}>
          <Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backText}>← Back</Text></Pressable>
          <Text style={styles.headerLabel}>Listing details</Text>
        </View>
        <Image source={{ uri: Array.isArray(product.images) && product.images.length ? product.images[0] : 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80' }} style={styles.image} />
        <View style={styles.card}>
          <View style={styles.cardTopRow}>
            <View style={styles.verifiedBadge}><Text style={styles.verifiedText}>Verified</Text></View>
            <Text style={styles.price}>{product.price}</Text>
          </View>
          <Text style={styles.title}>{product.title}</Text>
          <Text style={styles.meta}>{product.category || 'Other'} • {product.location || 'Ghana'}</Text>
          <Text style={styles.description}>{product.description}</Text>
          <View style={styles.infoRow}>
            <View style={styles.infoBox}><Text style={styles.infoLabel}>Condition</Text><Text style={styles.infoValue}>{product.condition || 'Good'}</Text></View>
            <View style={styles.infoBox}><Text style={styles.infoLabel}>Negotiable</Text><Text style={styles.infoValue}>{product.negotiable ? 'Yes' : 'No'}</Text></View>
          </View>
          <Pressable style={styles.ctaButton}><Text style={styles.ctaText}>Message seller</Text></Pressable>
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
  headerBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  backButton: { marginRight: 12, paddingVertical: 4 },
  backText: { color: '#0f766e', fontWeight: '700', fontSize: 14 },
  headerLabel: { color: '#0f172a', fontWeight: '700', fontSize: 14 },
  image: { width: '100%', height: 262 },
  card: { marginHorizontal: 16, marginTop: 12, backgroundColor: '#fff', borderRadius: 18, padding: 14, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, borderWidth: 1, borderColor: '#eef2f7' },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  verifiedBadge: { backgroundColor: '#ecfeff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  verifiedText: { color: '#0f766e', fontSize: 10, fontWeight: '700' },
  title: { color: '#0f172a', fontSize: 20, fontWeight: '800', marginTop: 7 },
  price: { color: '#0f766e', fontSize: 16, fontWeight: '800' },
  meta: { color: '#64748b', marginTop: 5, fontSize: 12 },
  description: { color: '#475569', marginTop: 10, lineHeight: 20, fontSize: 13 },
  infoRow: { flexDirection: 'row', marginTop: 12 },
  infoBox: { flex: 1, backgroundColor: '#f8fafc', borderRadius: 12, padding: 10, marginRight: 8 },
  infoLabel: { color: '#64748b', fontSize: 12 },
  infoValue: { color: '#0f172a', fontWeight: '700', marginTop: 4, fontSize: 13 },
  ctaButton: { marginTop: 12, backgroundColor: '#0f766e', borderRadius: 12, paddingVertical: 12, alignItems: 'center', shadowColor: '#0f766e', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sellerBox: { marginTop: 12, backgroundColor: '#ecfeff', borderRadius: 12, padding: 12 },
  sellerTitle: { color: '#0f766e', fontWeight: '700', fontSize: 13 },
  sellerName: { color: '#0f172a', fontSize: 15, fontWeight: '700', marginTop: 4 },
  sellerRating: { color: '#64748b', marginTop: 4, fontSize: 12 },
});
