import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, watchProducts, watchUsers, startChat, toggleFollowSeller } from '../firebase';
import { ProductCard } from '../components/ProductCard';
import { Product } from '../types';

interface SellerProfileScreenProps {
  sellerId: string;
  onBack: () => void;
  navigation: any;
}

export function SellerProfileScreen({ sellerId, onBack, navigation }: SellerProfileScreenProps) {
  const [seller, setSeller] = useState<any>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'listings' | 'reviews'>('listings');
  const [isFollowing, setIsFollowing] = useState(false);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [startingChat, setStartingChat] = useState(false);

  // Review modal states
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewsList, setReviewsList] = useState<any[]>([
    {
      id: 'rev_1',
      buyerName: 'Kwame A.',
      rating: 5,
      comment: 'Very reliable seller! Item was in excellent condition exactly as described.',
      createdAt: '2 days ago',
    },
    {
      id: 'rev_2',
      buyerName: 'Esi M.',
      rating: 5,
      comment: 'Fast communication and smooth meetup in Accra. Recommended!',
      createdAt: '1 week ago',
    },
  ]);

  const currentUser = auth.currentUser;

  useEffect(() => {
    let isMounted = true;
    
    const unsubUsers = watchUsers((usersList) => {
      if (!isMounted) return;
      const found = usersList.find((u: any) => u.id === sellerId || u.uid === sellerId);
      if (found) {
        setSeller(found);
        if (currentUser && Array.isArray(currentUser.followingSellers)) {
          setIsFollowing(currentUser.followingSellers.includes(sellerId));
        }
      }
    });

    const unsubProducts = watchProducts((allProducts) => {
      if (!isMounted) return;
      const filtered = (allProducts as Product[]).filter((p) => p.sellerId === sellerId);
      setProducts(filtered);
      setLoading(false);
    });

    return () => {
      isMounted = false;
      unsubUsers();
      unsubProducts();
    };
  }, [sellerId]);

  const handleToggleFollow = async () => {
    if (!currentUser) {
      Alert.alert('Authentication Required', 'Please sign in or register to follow merchants.');
      return;
    }
    try {
      const updatedState = !isFollowing;
      setIsFollowing(updatedState);
      await toggleFollowSeller(sellerId, currentUser.uid);
      Alert.alert(
        updatedState ? 'Merchant Followed 🔔' : 'Unfollowed',
        updatedState
          ? `You will now receive updates when ${seller?.username || 'this merchant'} posts new items.`
          : `Removed from your followed sellers.`
      );
    } catch (err: any) {
      setIsFollowing(!isFollowing);
      Alert.alert('Error', err.message || 'Could not update follow status.');
    }
  };

  const handleStartChat = async () => {
    if (!currentUser) {
      Alert.alert('Sign In Required', 'Please sign in to message sellers directly on TedBuy.');
      return;
    }
    if (currentUser.uid === sellerId) {
      Alert.alert('Notice', 'This is your own seller storefront.');
      return;
    }
    try {
      setStartingChat(true);
      const dummyProduct: any = products[0] || {
        id: 'general_' + sellerId,
        title: 'Inquiry for ' + (seller?.username || 'Seller'),
        price: 'Negotiable',
        image: seller?.photoUrl || 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80',
      };
      const chatId = await startChat(dummyProduct, currentUser.uid, sellerId);
      setStartingChat(false);
      navigation.navigate('Chats', { activeChatId: chatId });
    } catch (err: any) {
      setStartingChat(false);
      Alert.alert('Chat Initializer Error', err.message || 'Could not open chat channel.');
    }
  };

  const handleOpenWhatsApp = () => {
    if (!seller?.whatsAppNumber && !seller?.phoneNumber) {
      Alert.alert('WhatsApp Unavailable', 'This merchant has not attached a public WhatsApp line.');
      return;
    }
    setShowSafetyModal(true);
  };

  const confirmWhatsAppRedirect = () => {
    setShowSafetyModal(false);
    let rawNum = seller?.whatsAppNumber || seller?.phoneNumber || '';
    let cleanNumber = rawNum.replace(/\D/g, '');
    if (cleanNumber.startsWith('0') && cleanNumber.length === 10) {
      cleanNumber = '233' + cleanNumber.substring(1);
    } else if (!cleanNumber.startsWith('233') && cleanNumber.length === 9) {
      cleanNumber = '233' + cleanNumber;
    }
    const msg = encodeURIComponent(`Hello! I saw your merchant store on TedBuy Ghana and would like to inquire about your listings.`);
    const url = `https://wa.me/${cleanNumber}?text=${msg}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Unable to open WhatsApp application.');
    });
  };

  const handleAddReview = () => {
    if (!reviewComment.trim()) {
      Alert.alert('Empty Review', 'Please enter a short comment explaining your trading experience.');
      return;
    }
    const newRev = {
      id: 'rev_' + Date.now(),
      buyerName: currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Community Buyer',
      rating: reviewRating,
      comment: reviewComment.trim(),
      createdAt: 'Just now',
    };
    setReviewsList([newRev, ...reviewsList]);
    setReviewComment('');
    setShowReviewModal(false);
    Alert.alert('Review Submitted ⭐', 'Thank you for building community trust on TedBuy!');
  };

  const sellerName = seller?.username || seller?.displayName || 'Verified Merchant';
  const joinDate = seller?.joinDate || 'Jan 2026';
  const trustScore = 92; // High confidence trust score

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Top Header Bar */}
      <View style={styles.headerBar}>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {sellerName}'s Store
        </Text>
        <Pressable onPress={handleToggleFollow} style={[styles.followTopBtn, isFollowing && styles.followingTopBtn]}>
          <Text style={[styles.followTopBtnText, isFollowing && styles.followingTopBtnText]}>
            {isFollowing ? '✓ Following' : '+ Follow'}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Cover / Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatarRow}>
            <View style={styles.avatarContainer}>
              <Text style={styles.avatarText}>
                {sellerName.substring(0, 2).toUpperCase()}
              </Text>
            </View>
            <View style={styles.profileMeta}>
              <View style={styles.verifiedTag}>
                <Text style={styles.verifiedTagText}>✓ VERIFIED SELLER</Text>
              </View>
              <Text style={styles.sellerNameText}>{sellerName}</Text>
              <Text style={styles.memberSinceText}>Member since {joinDate} • Accra, Ghana</Text>
            </View>
          </View>

          <Text style={styles.bioText}>
            {seller?.bio || 'Official verified merchant on TedBuy marketplace. Quality electronics, phones, and fashion items with fast delivery across major regions in Ghana.'}
          </Text>

          {/* Trust Score & Stats Banner */}
          <View style={styles.statsBanner}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{products.length}</Text>
              <Text style={styles.statLabel}>LISTINGS</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.trustScoreValue}>{trustScore}/100</Text>
              <Text style={styles.trustScoreLabel}>EXCELLENT TRUST</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statValue}>★ 4.9</Text>
              <Text style={styles.statLabel}>RATING</Text>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionButtonsRow}>
            <Pressable
              onPress={handleStartChat}
              disabled={startingChat}
              style={[styles.primaryActionBtn, { flex: 1.2 }]}
            >
              {startingChat ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text style={styles.primaryActionBtnText}>💬 Chat on TedBuy</Text>
              )}
            </Pressable>

            <Pressable
              onPress={handleOpenWhatsApp}
              style={[styles.whatsappActionBtn, { flex: 1 }]}
            >
              <Text style={styles.whatsappActionBtnText}>💚 WhatsApp</Text>
            </Pressable>
          </View>
        </View>

        {/* Navigation Tabs */}
        <View style={styles.tabBar}>
          <Pressable
            onPress={() => setActiveTab('listings')}
            style={[styles.tabItem, activeTab === 'listings' && styles.tabItemActive]}
          >
            <Text style={[styles.tabItemText, activeTab === 'listings' && styles.tabItemTextActive]}>
              Active Listings ({products.length})
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab('reviews')}
            style={[styles.tabItem, activeTab === 'reviews' && styles.tabItemActive]}
          >
            <Text style={[styles.tabItemText, activeTab === 'reviews' && styles.tabItemTextActive]}>
              Reviews ({reviewsList.length})
            </Text>
          </Pressable>
        </View>

        {/* Tab Content */}
        {activeTab === 'listings' ? (
          <View style={styles.listingsContainer}>
            {loading ? (
              <ActivityIndicator size="large" color="#ea580c" style={{ marginVertical: 32 }} />
            ) : products.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateTitle}>No Active Listings</Text>
                <Text style={styles.emptyStateSub}>This merchant does not have any active products listed right now.</Text>
              </View>
            ) : (
              <View style={styles.productsGrid}>
                {products.map((item) => (
                  <View key={item.id} style={{ width: '50%' }}>
                    <ProductCard
                      product={item}
                      onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}
                    />
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={styles.reviewsContainer}>
            <View style={styles.reviewHeaderRow}>
              <Text style={styles.reviewHeaderTitle}>Merchant Ratings</Text>
              <Pressable onPress={() => setShowReviewModal(true)} style={styles.addReviewBtn}>
                <Text style={styles.addReviewBtnText}>+ Write Review</Text>
              </Pressable>
            </View>

            {reviewsList.map((rev) => (
              <View key={rev.id} style={styles.reviewCard}>
                <View style={styles.reviewCardHeader}>
                  <Text style={styles.reviewerName}>{rev.buyerName}</Text>
                  <Text style={styles.reviewStars}>{'★'.repeat(rev.rating)}</Text>
                </View>
                <Text style={styles.reviewComment}>{rev.comment}</Text>
                <Text style={styles.reviewDate}>{rev.createdAt}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Safety Tips Modal before WhatsApp */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={showSafetyModal}
        onRequestClose={() => setShowSafetyModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.safetyModalCard}>
            <Text style={styles.safetyModalTitle}>🛡️ Safe Meetup Guidance</Text>
            <Text style={styles.safetyModalText}>
              • Always meet sellers in well-lit public places (malls, stations, bustling banks).{'\n'}
              • Inspect the item thoroughly before making payment.{'\n'}
              • Never send wire transfers or mobile money advance payments prior to physical inspection.
            </Text>
            <View style={styles.safetyModalButtons}>
              <Pressable onPress={() => setShowSafetyModal(false)} style={styles.safetyCancelBtn}>
                <Text style={styles.safetyCancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={confirmWhatsAppRedirect} style={styles.safetyConfirmBtn}>
                <Text style={styles.safetyConfirmText}>I Understand, Proceed →</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Review Submission Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showReviewModal}
        onRequestClose={() => setShowReviewModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.reviewModalCard}>
            <View style={styles.reviewModalHeader}>
              <Text style={styles.reviewModalTitle}>Write Merchant Review</Text>
              <Pressable onPress={() => setShowReviewModal(false)}>
                <Text style={{ fontSize: 18, color: '#64748b' }}>✕</Text>
              </Pressable>
            </View>

            <Text style={styles.starRatingLabel}>Rating Score:</Text>
            <View style={styles.starRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable key={star} onPress={() => setReviewRating(star)}>
                  <Text style={[styles.starIcon, star <= reviewRating && styles.starIconSelected]}>
                    ★
                  </Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              style={styles.reviewInput}
              value={reviewComment}
              onChangeText={setReviewComment}
              placeholder="Describe product quality, delivery speed, and overall trade experience..."
              placeholderTextColor="#94a3b8"
              multiline
            />

            <Pressable onPress={handleAddReview} style={styles.submitReviewBtn}>
              <Text style={styles.submitReviewBtnText}>Submit Customer Feedback</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0f172a' },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  backBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 10,
  },
  backBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 12 },
  headerTitle: { flex: 1, color: '#ffffff', fontWeight: '900', fontSize: 15 },
  followTopBtn: {
    backgroundColor: '#ea580c',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  followingTopBtn: { backgroundColor: '#334155' },
  followTopBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 11 },
  followingTopBtnText: { color: '#cbd5e1' },

  scrollContent: { backgroundColor: '#f8fafc', paddingBottom: 40 },

  profileCard: {
    backgroundColor: '#ffffff',
    margin: 14,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  avatarRow: { flexDirection: 'row', alignItems: 'center' },
  avatarContainer: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#ea580c',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: { color: '#ffffff', fontWeight: '900', fontSize: 18 },
  profileMeta: { flex: 1 },
  verifiedTag: {
    backgroundColor: '#f0fdf4',
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    marginBottom: 4,
  },
  verifiedTagText: { color: '#166534', fontSize: 9, fontWeight: '900' },
  sellerNameText: { fontSize: 17, fontWeight: '900', color: '#0f172a' },
  memberSinceText: { fontSize: 11, color: '#64748b', marginTop: 2, fontWeight: '600' },

  bioText: {
    fontSize: 12.5,
    color: '#334155',
    lineHeight: 18,
    marginTop: 12,
    backgroundColor: '#f8fafc',
    padding: 10,
    borderRadius: 10,
  },

  statsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#0f172a',
    borderRadius: 14,
    paddingVertical: 12,
    marginTop: 14,
  },
  statBox: { alignItems: 'center' },
  statValue: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  statLabel: { color: '#94a3b8', fontSize: 8.5, fontWeight: '800', marginTop: 2 },
  statDivider: { width: 1, height: 24, backgroundColor: '#334155' },
  trustScoreValue: { color: '#22c55e', fontSize: 16, fontWeight: '900' },
  trustScoreLabel: { color: '#86efac', fontSize: 8.5, fontWeight: '800', marginTop: 2 },

  actionButtonsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  primaryActionBtn: {
    backgroundColor: '#ea580c',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryActionBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 13 },
  whatsappActionBtn: {
    backgroundColor: '#16a34a',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  whatsappActionBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 13 },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    marginHorizontal: 14,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  tabItem: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabItemActive: { backgroundColor: '#0f172a' },
  tabItemText: { fontSize: 12, fontWeight: '800', color: '#64748b' },
  tabItemTextActive: { color: '#ffffff' },

  listingsContainer: { paddingHorizontal: 10, paddingTop: 12 },
  productsGrid: { flexDirection: 'row', flexWrap: 'wrap' },

  emptyState: { padding: 32, alignItems: 'center' },
  emptyStateTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  emptyStateSub: { fontSize: 12, color: '#64748b', textAlign: 'center', marginTop: 4 },

  reviewsContainer: { paddingHorizontal: 14, paddingTop: 14 },
  reviewHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  reviewHeaderTitle: { fontSize: 15, fontWeight: '900', color: '#0f172a' },
  addReviewBtn: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addReviewBtnText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },

  reviewCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  reviewCardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  reviewerName: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  reviewStars: { fontSize: 12, color: '#eab308' },
  reviewComment: { fontSize: 12, color: '#475569', lineHeight: 17 },
  reviewDate: { fontSize: 10, color: '#94a3b8', marginTop: 6 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  safetyModalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    width: '100%',
  },
  safetyModalTitle: { fontSize: 16, fontWeight: '900', color: '#0f172a', marginBottom: 10 },
  safetyModalText: { fontSize: 12.5, color: '#334155', lineHeight: 20, marginBottom: 16 },
  safetyModalButtons: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  safetyCancelBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  safetyCancelText: { color: '#64748b', fontWeight: '800', fontSize: 12 },
  safetyConfirmBtn: { backgroundColor: '#16a34a', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  safetyConfirmText: { color: '#ffffff', fontWeight: '800', fontSize: 12 },

  reviewModalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    width: '100%',
  },
  reviewModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  reviewModalTitle: { fontSize: 16, fontWeight: '900', color: '#0f172a' },
  starRatingLabel: { fontSize: 12, fontWeight: '800', color: '#64748b' },
  starRow: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  starIcon: { fontSize: 28, color: '#cbd5e1' },
  starIconSelected: { color: '#eab308' },
  reviewInput: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    fontSize: 13,
    color: '#0f172a',
    height: 90,
    textAlignVertical: 'top',
    marginVertical: 12,
  },
  submitReviewBtn: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  submitReviewBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 13 },
});
