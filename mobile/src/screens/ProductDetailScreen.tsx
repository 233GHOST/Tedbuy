import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchProductById, fetchUserById } from '../firebase';

interface ProductDetailScreenProps {
  productId: string;
  onBack: () => void;
}

export function ProductDetailScreen({ productId, onBack }: ProductDetailScreenProps) {
  const [product, setProduct] = useState<any>(null);
  const [seller, setSeller] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProductById(productId).then((result) => {
      setProduct(result);
      if (result?.sellerId) {
        fetchUserById(result.sellerId).then((userResult) => {
          if (userResult) {
            setSeller(userResult);
          }
        });
      }
      setLoading(false);
    });
  }, [productId]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#ea580c" /></View>;
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
            <View style={styles.verifiedBadge}><Text style={styles.verifiedText}>✓ Verified Seller</Text></View>
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
            <Text style={styles.sellerName}>{seller?.username || product.sellerName || 'Verified seller'}</Text>
            <Text style={styles.sellerRating}>★ {product.likesCount || 0} engagement</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0f172a' },
  content: { backgroundColor: '#f8fafc', paddingBottom: 24 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },
  headerBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, backgroundColor: '#0f172a', borderBottomWidth: 1, borderBottomColor: '#020617' },
  backButton: { marginRight: 12, paddingVertical: 4, paddingHorizontal: 8, backgroundColor: '#1e293b', borderRadius: 6, borderWidth: 1, borderColor: '#334155' },
  backText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  headerLabel: { color: '#ffffff', fontWeight: '800', fontSize: 15, letterSpacing: -0.3 },
  image: { width: '100%', height: 280, backgroundColor: '#cbd5e1' },
  card: { marginHorizontal: 16, marginTop: 14, backgroundColor: '#fff', borderRadius: 16, padding: 16, shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, borderWidth: 1, borderColor: '#e2e8f0' },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  verifiedBadge: { backgroundColor: '#f0fdf4', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#bbf7d0' },
  verifiedText: { color: '#166534', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { color: '#1e293b', fontSize: 20, fontWeight: '800', marginTop: 10, letterSpacing: -0.4 },
  price: { color: '#0f172a', fontSize: 18, fontWeight: '900', letterSpacing: -0.5 },
  meta: { color: '#64748b', marginTop: 5, fontSize: 12, fontWeight: '500' },
  description: { color: '#475569', marginTop: 12, lineHeight: 22, fontSize: 13 },
  infoRow: { flexDirection: 'row', marginTop: 14 },
  infoBox: { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 10, padding: 10, marginRight: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  infoLabel: { color: '#64748b', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { color: '#0f172a', fontWeight: '800', marginTop: 4, fontSize: 13 },
  ctaButton: { marginTop: 16, backgroundColor: '#ea580c', borderRadius: 10, paddingVertical: 12, alignItems: 'center', shadowColor: '#ea580c', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.5 },
  sellerBox: { marginTop: 16, backgroundColor: '#f8fafc', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  sellerTitle: { color: '#ea580c', fontWeight: '800', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 },
  sellerName: { color: '#1e293b', fontSize: 15, fontWeight: '800', marginTop: 4 },
  sellerRating: { color: '#64748b', marginTop: 4, fontSize: 12, fontWeight: '500' },
});
