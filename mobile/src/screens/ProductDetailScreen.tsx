import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View, Alert, Modal, Dimensions, Share, Linking, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { fetchProductById, fetchUserById, toggleLikeProduct, startChat, auth, watchProducts } from '../firebase';
import { Product, isUserAdmin, isUserVerified } from '../types';
import { formatTedbuyTenure } from '../utils/tenure';

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
  const [inlineMessage, setInlineMessage] = useState('');

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

    const handleMessageWhatsApp = () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert(
        'Authentication Required',
        'Please sign in or register to contact the seller on WhatsApp.'
      );
      return;
    }
    const phoneOrWhatsApp = seller?.whatsAppNumber || seller?.phoneNumber || product.sellerWhatsApp || product.sellerPhone;
    if (!phoneOrWhatsApp) {
      Alert.alert(
        'WhatsApp Not Provided',
        'The seller has not provided a WhatsApp contact number. You can chat with them directly using Tedbuy chat!'
      );
      return;
    }
    let cleanNumber = phoneOrWhatsApp.replace(/\D/g, '');
    if (cleanNumber.startsWith('0') && cleanNumber.length === 10) {
      cleanNumber = '233' + cleanNumber.substring(1);
    } else if (!cleanNumber.startsWith('233') && cleanNumber.length === 9) {
      cleanNumber = '233' + cleanNumber;
    }
    const prefilledText = `Hello! I'm interested in your listed item "${product.title}" on Tedbuy marketplace. Let's chat!`;
    const finalUrl = `https://wa.me/${cleanNumber}?text=${encodeURIComponent(prefilledText)}`;
    Linking.openURL(finalUrl).catch(() => {
      Alert.alert('Error', 'Unable to open WhatsApp on your device.');
    });
  };

  const handleStartChatWithText = async (customMessage?: string) => {
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
      const chosenMsg = (customMessage && customMessage.trim()) 
        ? customMessage.trim() 
        : (inlineMessage.trim() || `Hi, is "${product.title}" still available?`);
      const chatId = await startChat(productId, chosenMsg);
      if (chatId) {
        setInlineMessage('');
        navigation.navigate('MainTabs', { screen: 'Chats', params: { activeChatId: chatId } });
      }
    } catch (err: any) {
      Alert.alert('Unable to Connect', err.message || 'Could not initiate chat with the seller.');
    } finally {
      setIsStartingChat(false);
    }
  };

  const handleMessageSeller = async () => {
    handleStartChatWithText();
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
        <Text style={styles.errorText}>This listing has expired, been sold, or is no longer available.</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Pressable onPress={onBack} style={styles.backButton}>
            <Text style={styles.backText}>Return to Marketplace</Text>
          </Pressable>
          <Pressable onPress={onBack} style={[styles.backButton, { backgroundColor: '#f97316', borderColor: '#ea580c' }]}>
            <Text style={[styles.backText, { color: '#ffffff' }]}>Browse Similar Listings</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const imagesArray = Array.isArray(product.images) && product.images.length
    ? product.images.filter((img: string) => typeof img === 'string' && img.length > 0 && !img.includes('unsplash.com'))
    : ((product.image && !product.image.includes('unsplash.com')) ? [product.image] : (product.displayImage && !product.displayImage.includes('unsplash.com') ? [product.displayImage] : (product.videoPoster ? [product.videoPoster] : [])));
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
          {/* Title first */}
          <Text style={styles.title}>{product.title}</Text>

          {/* Price with Negotiable badge right beside it */}
          <View style={styles.priceRowContainer}>
            <Text style={styles.price}>{product.price}</Text>
            {product.negotiable && (
              <View style={styles.negotiableLabel}>
                <Text style={styles.negotiableText}>Negotiable</Text>
              </View>
            )}
            {isUserAdmin(seller) ? (
              <View style={[styles.verifiedBadge, { backgroundColor: '#dbeafe', borderColor: '#bfdbfe' }]}>
                <Text style={[styles.verifiedText, { color: '#1d4ed8' }]}>🔹 Official Admin</Text>
              </View>
            ) : isUserVerified(seller) ? (
              <View style={styles.verifiedBadge}>
                <Text style={styles.verifiedText}>✓ Verified Seller</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.meta}>
            {product.category || 'Other'} • {product.location || 'Ghana'}
          </Text>

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
              onPress={async () => {
                if (!product) return;
                const cleanSlug = (product.title || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                const isService = product.category ? (product.category.toLowerCase() === 'services' || product.category.toLowerCase().includes('service')) : false;
                const hasPrice = !isService && product.price && Number(product.price) > 0;
                const priceText = hasPrice ? ` for GHS ${product.price}` : '';
                const shareUrl = `https://www.tedbuy.store/product/${product.id}-${cleanSlug}?title=${encodeURIComponent(product.title || '')}&price=${hasPrice ? encodeURIComponent(product.price) : ''}`;
                try {
                  await Share.share({
                    title: product.title,
                    message: `Check out "${product.title}"${priceText} on TedBuy Ghana!\n\n${shareUrl}`,
                    url: shareUrl,
                  });
                } catch (err) {
                  Alert.alert('Shared!', `Link for "${product.title}" copied.`);
                }
              }}
              style={styles.shareButton}
            >
              <Text style={styles.shareButtonText}>✈️ Share</Text>
            </Pressable>
          </View>

          {/* Message Seller on WhatsApp Button */}
          <Pressable
            onPress={handleMessageWhatsApp}
            style={styles.whatsappButton}
          >
            <Text style={styles.whatsappButtonText}>💬 Message Seller on WhatsApp</Text>
          </Pressable>

          {/* Inline Chat with Seller Card (Directly below WhatsApp) */}
          <View style={styles.inlineChatCard}>
            <Text style={styles.inlineChatTitle}>Chat with the seller</Text>
            
            {/* Quick reply suggestions */}
            <View style={styles.quickRepliesRow}>
              {['Is this still available?', 'What is the last price?'].map((quickText) => (
                <Pressable
                  key={quickText}
                  onPress={() => handleStartChatWithText(quickText)}
                  disabled={isStartingChat}
                  style={styles.quickReplyPill}
                >
                  <Text style={styles.quickReplyPillText}>{quickText}</Text>
                </Pressable>
              ))}
            </View>

            {/* Inline message input */}
            <View style={styles.inlineInputRow}>
              <TextInput
                value={inlineMessage}
                onChangeText={setInlineMessage}
                placeholder="Type your message to seller..."
                placeholderTextColor="#94a3b8"
                style={styles.inlineInput}
              />
              <Pressable
                onPress={() => handleStartChatWithText()}
                disabled={isStartingChat}
                style={styles.inlineSendBtn}
              >
                {isStartingChat ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.inlineSendBtnText}>Send</Text>
                )}
              </Pressable>
            </View>
          </View>

          {/* Seller Profile & Trust Card */}
          <Pressable
            onPress={() => {
              const sid = seller?.id || product.sellerId;
              if (sid) {
                navigation.navigate('SellerProfile', { sellerId: sid });
              } else {
                setIsSellerModalVisible(true);
              }
            }}
            style={styles.sellerBox}
          >
            <View style={styles.sellerRow}>
              <View style={styles.sellerAvatar}>
                <Text style={styles.sellerAvatarText}>
                  {String(seller?.username || product.sellerName || 'M').substring(0, 2).toUpperCase()}
                </Text>
              </View>
              <View style={styles.sellerInfo}>
                <View style={styles.sellerHeaderBadgeRow}>
                  <Text style={styles.sellerName} numberOfLines={1}>
                    {seller?.username || product.sellerName || 'TedBuy Merchant'}
                  </Text>
                  {isUserAdmin(seller) ? (
                    <View style={[styles.microBadge, { backgroundColor: '#dbeafe', borderColor: '#bfdbfe' }]}>
                      <Text style={[styles.microBadgeText, { color: '#1d4ed8' }]}>Admin</Text>
                    </View>
                  ) : isUserVerified(seller) ? (
                    <View style={styles.microBadge}>
                      <Text style={styles.microBadgeText}>✓ Verified</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.sellerTenure}>
                  {formatTedbuyTenure(seller?.joinDate || product.sellerJoinDate)}
                </Text>
                <View style={styles.trustScorePill}>
                  <Text style={styles.trustScorePillText}>🛡️ High Trust Verified</Text>
                </View>
              </View>
              <View style={styles.viewStoreBtn}>
                <Text style={styles.viewSellerBtnText}>Store →</Text>
              </View>
            </View>

            {/* Trust highlights */}
            <View style={styles.trustGuaranteesRow}>
              <View style={styles.trustGuaranteeItem}>
                <Text style={styles.trustGuaranteeCheck}>✓</Text>
                <Text style={styles.trustGuaranteeText}>Direct negotiation</Text>
              </View>
              <View style={styles.trustGuaranteeItem}>
                <Text style={styles.trustGuaranteeCheck}>✓</Text>
                <Text style={styles.trustGuaranteeText}>In-person trade safety</Text>
              </View>
            </View>
          </Pressable>

          {/* Safety Tips Banner */}
          <View style={styles.safetyTipsCard}>
            <Text style={styles.safetyTipsTitle}>⚠️ Tedbuy Classifieds Safety Tips:</Text>
            <Text style={styles.safetyTipsBody}>
              Meet in public, check item status carefully, and DO NOT send cash deposits in advance of collecting your items!
            </Text>
          </View>

          <View style={styles.divider} />

          {/* Detailed Item Specifications */}
          <Text style={styles.sectionTitle}>Detailed Item Specifications</Text>
          <View style={styles.specsGrid}>
            <View style={styles.specBox}>
              <Text style={styles.specLabel}>Category</Text>
              <Text style={styles.specValue} numberOfLines={1}>{product.category || 'Other'}</Text>
            </View>
            {product.condition ? (
              <View style={styles.specBox}>
                <Text style={styles.specLabel}>Condition</Text>
                <Text style={styles.specValue} numberOfLines={1}>{product.condition}</Text>
              </View>
            ) : null}
            <View style={styles.specBox}>
              <Text style={styles.specLabel}>Location</Text>
              <Text style={styles.specValue} numberOfLines={1}>{product.location || 'Ghana'}</Text>
            </View>
            {(product.isExchangeable || product.exchangePossible) ? (
              <View style={styles.specBox}>
                <Text style={styles.specLabel}>Exchange Possible</Text>
                <Text style={[styles.specValue, { color: '#047857' }]} numberOfLines={1}>Yes</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>Listing Description</Text>
          <Text style={styles.description}>{product.description}</Text>
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
                  {formatTedbuyTenure(seller?.joinDate || product?.sellerJoinDate)}
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
                          : (otherItem.displayImage || otherItem.image || otherItem.videoPoster || ''),
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
  carouselContainer: { width: width, height: 320, backgroundColor: '#f1f5f9', position: 'relative' },
  carouselImage: { width: width, height: 320, resizeMode: 'cover' },
  carouselIndicators: { position: 'absolute', bottom: 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  indicatorDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255, 255, 255, 0.4)' },
  indicatorDotActive: { width: 14, backgroundColor: '#ffffff' },

  card: { marginHorizontal: 10, marginTop: -20, backgroundColor: '#ffffff', borderRadius: 20, padding: 14, shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, borderWidth: 1, borderColor: '#e2e8f0', zIndex: 10 },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  verifiedBadge: { backgroundColor: '#f0fdf4', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#bbf7d0' },
  verifiedText: { color: '#166534', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  priceRowContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  negotiableLabel: { backgroundColor: '#fff7ed', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#ffedd5' },
  negotiableText: { color: '#c2410c', fontSize: 10, fontWeight: '800' },
  price: { color: '#0f172a', fontSize: 18, fontWeight: '900', letterSpacing: -0.5 },

  title: { color: '#0f172a', fontSize: 19, fontWeight: '800', marginTop: 4, letterSpacing: -0.5 },
  meta: { color: '#64748b', marginTop: 6, fontSize: 12, fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#f1f5f9', marginVertical: 14 },
  sectionTitle: { color: '#0f172a', fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  description: { color: '#334155', lineHeight: 22, fontSize: 13.5, fontWeight: '400' },

  infoRow: { flexDirection: 'row', marginTop: 16, gap: 10 },
  infoBox: { flex: 1, backgroundColor: '#f8fafc', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  infoLabel: { color: '#64748b', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { color: '#0f172a', fontWeight: '800', marginTop: 4, fontSize: 13 },

  actionButtonRow: { flexDirection: 'row', marginTop: 14, gap: 10 },
  likeButton: { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 12, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#cbd5e1' },
  likeButtonActive: { backgroundColor: '#fee2e2', borderColor: '#fecaca' },
  likeButtonText: { color: '#0f172a', fontWeight: '700', fontSize: 13 },
  shareButton: { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 12, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#cbd5e1' },
  shareButtonText: { color: '#0f172a', fontWeight: '700', fontSize: 13 },

  whatsappButton: { marginTop: 12, backgroundColor: '#15803d', borderRadius: 14, paddingVertical: 13, alignItems: 'center', shadowColor: '#15803d', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  whatsappButtonText: { color: '#ffffff', fontWeight: '800', fontSize: 13.5, letterSpacing: 0.2 },

  /* Inline Chat Box */
  inlineChatCard: { marginTop: 14, backgroundColor: '#f8fafc', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  inlineChatTitle: { fontSize: 12, fontWeight: '800', color: '#0f172a', marginBottom: 8 },
  quickRepliesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  quickReplyPill: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  quickReplyPillText: { fontSize: 11, color: '#334155', fontWeight: '600' },
  inlineInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  inlineInput: { flex: 1, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, fontSize: 12.5, color: '#0f172a' },
  inlineSendBtn: { backgroundColor: '#0f172a', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9, justifyContent: 'center', alignItems: 'center' },
  inlineSendBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },

  /* Safety Tips Styling */
  safetyTipsCard: { marginTop: 14, backgroundColor: '#fef2f2', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#fee2e2' },
  safetyTipsTitle: { color: '#991b1b', fontSize: 11.5, fontWeight: '800', marginBottom: 4 },
  safetyTipsBody: { color: '#b91c1c', fontSize: 11, fontWeight: '500', lineHeight: 16 },

  /* Seller tease styling */
  sellerBox: { marginTop: 16, backgroundColor: '#f8fafc', borderRadius: 18, padding: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  sellerRow: { flexDirection: 'row', alignItems: 'center' },
  sellerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center', marginRight: 12, borderWidth: 1, borderColor: '#1e293b' },
  sellerAvatarText: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  sellerInfo: { flex: 1 },
  sellerHeaderBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  sellerName: { color: '#0f172a', fontSize: 14, fontWeight: '800' },
  sellerTenure: { color: '#64748b', fontSize: 11, fontWeight: '500', marginTop: 1 },
  microBadge: { backgroundColor: '#f0fdf4', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: '#bbf7d0' },
  microBadgeText: { color: '#166534', fontSize: 9.5, fontWeight: '800' },
  trustScorePill: { marginTop: 4, alignSelf: 'flex-start', backgroundColor: '#ecfdf5', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: '#a7f3d0' },
  trustScorePillText: { color: '#065f46', fontSize: 9.5, fontWeight: '800' },
  viewStoreBtn: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#ffffff', borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1' },
  viewSellerBtnText: { color: '#0f172a', fontWeight: '800', fontSize: 11 },
  trustGuaranteesRow: { flexDirection: 'row', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e2e8f0', justifyContent: 'space-between' },
  trustGuaranteeItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  trustGuaranteeCheck: { color: '#16a34a', fontWeight: '900', fontSize: 11 },
  trustGuaranteeText: { color: '#475569', fontSize: 10.5, fontWeight: '600' },

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

  specsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  specBox: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, minWidth: '47%', flexGrow: 1 },
  specLabel: { fontSize: 10, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 },
  specValue: { fontSize: 13, fontWeight: '700', color: '#0f172a', marginTop: 2 },
});
