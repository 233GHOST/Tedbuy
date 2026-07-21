import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View, Alert, Modal, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { fetchProductById, fetchUserById, toggleLikeProduct, startChat, auth, watchProducts } from '../firebase';
import { Product } from '../types';

const { width } = Dimensions.get('window');

interface ProductDetailScreenProps {
  productId: string;
  onBack: () => void;
}

export function ProductDetailScreen({ productId, onBack }: ProductDetailScreenProps) {
  const navigation = useNavigation<any>();
  const [product, setProduct] = useState<any>(null);
  const [seller, setSeller] = useState<any>(null);
  const [sellerListings, setSellerListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isLiking, setIsLiking] = useState(false);
  const [isSellerModalVisible, setIsSellerModalVisible] = useState(false);
  const [isStartingChat, setIsStartingChat] = useState(false);

  useEffect(() => {
    // Single-entry subscription and loader
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

    // Watch listings to filter seller's other items
    const unsubProducts = watchProducts((allProducts) => {
      if (product?.sellerId) {
        const otherListings = allProducts.filter(
          (p) => p.sellerId === product.sellerId && p.id !== product.id
        );
        setSellerListings(otherListings);
      }
    });

    return () => {
      unsubProducts();
    };
  }, [productId, product?.sellerId]);

  const handleLike = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert('Authentication Required', 'Please sign in or register to save items to your favorites.');
      return;
    }
    if (isLiking) return;

    try {
      setIsLiking(true);
      await toggleLikeProduct(productId, user.uid);
      const updatedProduct = await fetchProductById(productId);
      if (updatedProduct) {
        setProduct(updatedProduct);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not update favorites.');
    } finally {
      setIsLiking(false);
    }
  };

  const handleMessageSeller = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert(
        'Authentication Required',
        'Please log in or create an account under the Profile tab to start an encrypted trade negotiation chat with this seller.',
        [{ text: 'OK' }]
      );
      return;
    }

    if (product.sellerId === user.uid) {
      Alert.alert('Self-Trade Action', 'You cannot start a trade negotiation conversation on your own listing.');
      return;
    }

    try {
      setIsStartingChat(true);
      const initialMsg = `Hi, is "${product.title}" still available?`;
      const chatId = await startChat(productId, initialMsg);
      if (chatId) {
        Alert.alert(
          'Trade Chat Started 💬',
          'Enabling secure peer-to-peer end-to-end encryption. Would you like to view this chat now?',
          [
            {
              text: 'Open Chat',
              onPress: () => {
                onBack();
                navigation.navigate('Chats', { activeChatId: chatId });
              },
            },
            { text: 'Keep Browsing', style: 'cancel' },
          ]
        );
      }
    } catch (err: any) {
      Alert.alert('Unable to Connect', err.message || 'Could not initiate chat with the seller.');
    } finally {
      setIsStartingChat(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#ea580c" />
      </View>
    );
  }

  if (!product) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>This listing has been removed or is no longer available.</Text>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>Return Home</Text>
        </Pressable>
      </View>
    );
  }

  const imagesArray = Array.isArray(product.images) && product.images.length ? product.images : [product.image || 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80'];
  const hasMultipleImages = imagesArray.length > 1;
  const user = auth.currentUser;
  const hasLiked = user && Array.isArray(product.likedUserIds) && product.likedUserIds.includes(user.uid);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Header bar */}
      <View style={styles.headerBar}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.headerLabel} numberOfLines={1}>
          {product.title}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Horizontal scrollable image gallery with index counter dots */}
        <View style={styles.carouselContainer}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={(e) => {
              const offsetX = e.nativeEvent.contentOffset.x;
              const index = Math.round(offsetX / width);
              setCurrentImageIndex(index);
            }}
            scrollEventThrottle={16}
          >
            {imagesArray.map((imgUri: string, idx: number) => (
              <Image key={idx} source={{ uri: imgUri }} style={styles.carouselImage} />
            ))}
          </ScrollView>
          {hasMultipleImages && (
            <View style={styles.carouselIndicators}>
              {imagesArray.map((_: any, idx: number) => (
                <View
                  key={idx}
                  style={[
                    styles.indicatorDot,
                    currentImageIndex === idx && styles.indicatorDotActive,
                  ]}
                />
              ))}
            </View>
          )}
        </View>

        {/* Product specs card */}
        <View style={styles.card}>
          <View style={styles.cardTopRow}>
            <View style={styles.verifiedBadge}>
              <Text style={styles.verifiedText}>✓ Verified Seller</Text>
            </View>
            <View style={styles.pricingRow}>
              {product.negotiable && (
                <View style={styles.negotiableLabel}>
                  <Text style={styles.negotiableText}>Negotiable</Text>
                </View>
              )}
              <Text style={styles.price}>{product.price}</Text>
            </View>
          </View>

          <Text style={styles.title}>{product.title}</Text>
          <Text style={styles.meta}>
            {product.category || 'Other'} • {product.location || 'Ghana'}
          </Text>

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>Listing Description</Text>
          <Text style={styles.description}>{product.description}</Text>

          {/* Key Specs Row */}
          <View style={styles.infoRow}>
            <View style={styles.infoBox}>
              <Text style={styles.infoLabel}>Condition</Text>
              <Text style={styles.infoValue}>{product.condition || 'Good'}</Text>
            </View>
            <View style={styles.infoBox}>
              <Text style={styles.infoLabel}>Trade Status</Text>
              <Text style={styles.infoValue}>{product.negotiable ? 'Flexible' : 'Firm'}</Text>
            </View>
          </View>

          {/* Favorite & Share Bar */}
          <View style={styles.actionButtonRow}>
            <Pressable
              onPress={handleLike}
              style={[styles.likeButton, hasLiked && styles.likeButtonActive]}
            >
              <Text style={styles.likeButtonText}>
                {hasLiked ? '🔖 Saved' : '🤍 Bookmark Deal'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                Alert.alert('Shared!', `Spotlight URL for "${product.title}" copied safely.`);
              }}
              style={styles.shareButton}
            >
              <Text style={styles.shareButtonText}>✈️ Share</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={handleMessageSeller}
            style={styles.ctaButton}
            disabled={isStartingChat}
          >
            {isStartingChat ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.ctaText}>💬 Secure Message Seller</Text>
            )}
          </Pressable>

          {/* Seller Profile teaser box */}
          <Pressable
            onPress={() => setIsSellerModalVisible(true)}
            style={styles.sellerBox}
          >
            <View style={styles.sellerRow}>
              <View style={styles.sellerAvatar}>
                <Text style={styles.sellerAvatarText}>
                  {String(seller?.username || product.sellerName || 'VS').substring(0, 2).toUpperCase()}
                </Text>
              </View>
              <View style={styles.sellerInfo}>
                <Text style={styles.sellerTitle}>Verified Merchant Partner</Text>
                <Text style={styles.sellerName}>
                  {seller?.username || product.sellerName || 'Verified TedBuy Seller'}
                </Text>
                <Text style={styles.sellerRating}>
                  ★ {product.likesCount || 0} engagement score
                </Text>
              </View>
              <Text style={styles.viewSellerBtnText}>View →</Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>

      {/* Seller Profile Overlay Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isSellerModalVisible}
        onRequestClose={() => setIsSellerModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalHeaderTitle}>Merchant Profile</Text>
              <Pressable
                onPress={() => setIsSellerModalVisible(false)}
                style={styles.modalCloseBtn}
              >
                <Text style={styles.modalCloseBtnText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll}>
              <View style={styles.modalProfileCard}>
                <View style={styles.modalAvatar}>
                  <Text style={styles.modalAvatarText}>
                    {String(seller?.username || product.sellerName || 'VS').substring(0, 2).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.modalSellerName}>
                  {seller?.username || product.sellerName || 'Verified Merchant'}
                </Text>
                <Text style={styles.modalJoined}>
                  Member since {seller?.joinDate || 'Jan 2026'}
                </Text>
                <Text style={styles.modalBio}>
                  {seller?.bio || 'Verified TedBuy merchant. Deals across major regions in Ghana.'}
                </Text>

                <View style={styles.sellerStatsRow}>
                  <View style={styles.sellerStatBox}>
                    <Text style={styles.sellerStatValue}>
                      {sellerListings.length + 1}
                    </Text>
                    <Text style={styles.sellerStatLabel}>Listings</Text>
                  </View>
                  <View style={styles.sellerStatBox}>
                    <Text style={styles.sellerStatValue}>
                      ★ {product.likesCount || 0}
                    </Text>
                    <Text style={styles.sellerStatLabel}>Likes</Text>
                  </View>
                </View>
              </View>

              {/* Other Active Listings from Seller */}
              <Text style={styles.otherDealsTitle}>Other Deals from this Seller</Text>
              {sellerListings.length === 0 ? (
                <Text style={styles.emptyOtherText}>No other active listings from this seller.</Text>
              ) : (
                sellerListings.map((otherItem) => (
                  <Pressable
                    key={otherItem.id}
                    onPress={() => {
                      setIsSellerModalVisible(false);
                      // Navigate to details
                      setLoading(true);
                      setProduct(null);
                      setCurrentImageIndex(0);
                      fetchProductById(otherItem.id).then((result) => {
                        setProduct(result);
                        setLoading(false);
                      });
                    }}
                    style={styles.otherItemCard}
                  >
                    <Image
                      source={{
                        uri: Array.isArray(otherItem.images) && otherItem.images.length
                          ? otherItem.images[0]
                          : otherItem.image || 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80',
                      }}
                      style={styles.otherItemImg}
                    />
                    <View style={styles.otherItemInfo}>
                      <Text style={styles.otherItemTitle} numberOfLines={1}>
                        {otherItem.title}
                      </Text>
                      <Text style={styles.otherItemPrice}>{otherItem.price}</Text>
                      <Text style={styles.otherItemMeta}>
                        {otherItem.category} • {otherItem.location}
                      </Text>
                    </View>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0f172a' },
  content: { backgroundColor: '#f8fafc', paddingBottom: 32 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc', padding: 24 },
  errorText: { color: '#64748b', fontSize: 14, fontWeight: '600', marginBottom: 16, textAlign: 'center' },
  headerBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#0f172a', borderBottomWidth: 1, borderBottomColor: '#020617' },
  backButton: { marginRight: 12, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#1e293b', borderRadius: 8, borderWidth: 1, borderColor: '#334155' },
  backText: { color: '#ffffff', fontWeight: '800', fontSize: 13 },
  headerLabel: { color: '#ffffff', fontWeight: '800', fontSize: 15, flex: 1, letterSpacing: -0.3 },

  /* Horizontal Carousel Styles */
  carouselContainer: { width: width, height: 300, backgroundColor: '#cbd5e1', position: 'relative' },
  carouselImage: { width: width, height: 300, resizeMode: 'cover' },
  carouselIndicators: { position: 'absolute', bottom: 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  indicatorDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255, 255, 255, 0.4)' },
  indicatorDotActive: { width: 14, backgroundColor: '#ffffff' },

  card: { marginHorizontal: 16, marginTop: -20, backgroundColor: '#ffffff', borderRadius: 24, padding: 18, shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, borderWidth: 1, borderColor: '#e2e8f0', zIndex: 10 },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  verifiedBadge: { backgroundColor: '#f0fdf4', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#bbf7d0' },
  verifiedText: { color: '#166534', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  pricingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  negotiableLabel: { backgroundColor: '#fff7ed', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#ffedd5' },
  negotiableText: { color: '#c2410c', fontSize: 10, fontWeight: '800' },
  price: { color: '#ea580c', fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },

  title: { color: '#0f172a', fontSize: 21, fontWeight: '800', marginTop: 12, letterSpacing: -0.5 },
  meta: { color: '#64748b', marginTop: 4, fontSize: 12, fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#f1f5f9', marginVertical: 14 },
  sectionTitle: { color: '#0f172a', fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  description: { color: '#334155', lineHeight: 22, fontSize: 13.5, fontWeight: '400' },

  infoRow: { flexDirection: 'row', marginTop: 16, gap: 10 },
  infoBox: { flex: 1, backgroundColor: '#f8fafc', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  infoLabel: { color: '#64748b', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { color: '#0f172a', fontWeight: '800', marginTop: 4, fontSize: 13 },

  actionButtonRow: { flexDirection: 'row', marginTop: 18, gap: 10 },
  likeButton: { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 12, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#cbd5e1' },
  likeButtonActive: { backgroundColor: '#fee2e2', borderColor: '#fecaca' },
  likeButtonText: { color: '#0f172a', fontWeight: '700', fontSize: 13 },
  shareButton: { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 12, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#cbd5e1' },
  shareButtonText: { color: '#0f172a', fontWeight: '700', fontSize: 13 },

  ctaButton: { marginTop: 14, backgroundColor: '#ea580c', borderRadius: 14, paddingVertical: 14, alignItems: 'center', shadowColor: '#ea580c', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  ctaText: { color: '#ffffff', fontWeight: '800', fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.5 },

  /* Seller tease styling */
  sellerBox: { marginTop: 16, backgroundColor: '#f8fafc', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  sellerRow: { flexDirection: 'row', alignItems: 'center' },
  sellerAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#ea580c', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  sellerAvatarText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  sellerInfo: { flex: 1 },
  sellerTitle: { color: '#ea580c', fontWeight: '800', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 },
  sellerName: { color: '#0f172a', fontSize: 14, fontWeight: '800', marginTop: 1 },
  sellerRating: { color: '#64748b', fontSize: 11, fontWeight: '500', marginTop: 1 },
  viewSellerBtnText: { color: '#ea580c', fontWeight: '800', fontSize: 12, paddingHorizontal: 6 },

  /* Modal styling */
  modalContainer: { flex: 1, backgroundColor: 'rgba(2, 6, 23, 0.6)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#ffffff', borderTopLeftRadius: 32, borderTopRightRadius: 32, height: '80%', paddingHorizontal: 20, paddingTop: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingBottom: 12 },
  modalHeaderTitle: { fontSize: 18, fontWeight: '900', color: '#0f172a' },
  modalCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center' },
  modalCloseBtnText: { color: '#64748b', fontWeight: '700', fontSize: 14 },
  modalScroll: { paddingTop: 16, paddingBottom: 32 },

  modalProfileCard: { alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 20 },
  modalAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#ea580c', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  modalAvatarText: { color: '#ffffff', fontSize: 20, fontWeight: '900' },
  modalSellerName: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  modalJoined: { fontSize: 12, color: '#64748b', marginTop: 2, fontWeight: '600' },
  modalBio: { fontSize: 13, color: '#475569', marginTop: 8, textAlign: 'center', lineHeight: 18, paddingHorizontal: 12 },

  sellerStatsRow: { flexDirection: 'row', gap: 16, marginTop: 14, justifyContent: 'center' },
  sellerStatBox: { backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', width: 80, height: 54, justifyContent: 'center', alignItems: 'center' },
  sellerStatValue: { fontSize: 16, fontWeight: '900', color: '#0f172a' },
  sellerStatLabel: { fontSize: 10, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginTop: 2 },

  otherDealsTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a', marginBottom: 12 },
  emptyOtherText: { color: '#94a3b8', fontSize: 13, textAlign: 'center', marginVertical: 16 },

  otherItemCard: { flexDirection: 'row', backgroundColor: '#ffffff', borderRadius: 16, borderHeight: 1, borderColor: '#cbd5e1', padding: 10, borderWidth: 1, marginBottom: 10, alignItems: 'center' },
  otherItemImg: { width: 64, height: 64, borderRadius: 10, backgroundColor: '#cbd5e1' },
  otherItemInfo: { flex: 1, marginLeft: 12 },
  otherItemTitle: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  otherItemPrice: { fontSize: 13, fontWeight: '800', color: '#ea580c', marginTop: 2 },
  otherItemMeta: { fontSize: 10, color: '#64748b', marginTop: 2 },
});
