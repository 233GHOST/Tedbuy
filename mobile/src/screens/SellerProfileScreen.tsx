import React, { useEffect, useRef, useState } from 'react';
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
import { auth, watchProducts, watchUsers, fetchUserById, startChatApi, toggleFollowSeller, fetchReviewsForSeller, addReview } from '../firebase';
import { Users as UsersIcon, UserPlus, UserMinus } from 'lucide-react-native';
import { ProductCard } from '../components/ProductCard';
import { Product, isUserAdmin, isUserVerified, calculateTrustScore } from '../types';
import { isBoostActive } from '../utils/boost';
import { EmailVerificationModal, BlockedActionType } from '../components/EmailVerificationModal';
import { DismissKeyboardView } from '../components/DismissKeyboardView';
import { formatTedbuyTenure } from '../utils/tenure';
import { fonts } from '../theme';

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
  // Unlike the app's other follow buttons, this one has no `disabled` prop
  // and no state-based guard — the button stays tappable for the entire
  // network round-trip, not just one render frame, so a real double-tap
  // during a slow connection could fire two independent, un-gated follow
  // calls that race each other server-side. A ref closes that window
  // synchronously, matching the pattern already used for Publish/Sign-In/Pay.
  const isTogglingFollowRef = useRef(false);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [startingChat, setStartingChat] = useState(false);

  // Review modal states
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  // Matches web's SellerProfilePage.tsx "Purchased Item (Optional)" dropdown
  // — was entirely absent on mobile, so a review left from the seller
  // profile page could never be tagged to a specific product/deal.
  const [reviewProductTitle, setReviewProductTitle] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [reviewsList, setReviewsList] = useState<any[]>([]);
  // Matches web's currentUser.emailVerified gate on WhatsApp/review actions.
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);
  const [blockedActionType, setBlockedActionType] = useState<BlockedActionType>(null);
  // Followers/Following — was entirely missing on mobile. Matches web's
  // sellerFollowers/sellerFollowing (derived from the full users list, same
  // as web) plus its tabbed modal with per-user follow/unfollow.
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [showFollowModal, setShowFollowModal] = useState(false);
  const [activeFollowTab, setActiveFollowTab] = useState<'followers' | 'following'>('followers');
  const [togglingFollowUserId, setTogglingFollowUserId] = useState<string | null>(null);
  // Store catalog search + category filter — was entirely missing on
  // mobile's listings tab. Matches web's local search/filter exactly.
  const [storeSearchQuery, setStoreSearchQuery] = useState('');
  const [storeSelectedCategory, setStoreSelectedCategory] = useState<string | null>(null);

  const currentUser = auth.currentUser;

  useEffect(() => {
    let isMounted = true;

    // Seller profile and (if signed in) the caller's own profile — both come
    // from the authenticated /api/users/get endpoint, not Firestore.
    // followingSellers lives on the user's profile row, not the Firebase Auth
    // object, so the caller's own profile has to be fetched separately.
    fetchUserById(sellerId).then((found) => {
      if (!isMounted || !found) return;
      setSeller(found);
    });

    fetchReviewsForSeller(sellerId).then((found) => {
      if (!isMounted) return;
      setReviewsList(found.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    });

    if (currentUser) {
      fetchUserById(currentUser.uid).then((myProfile: any) => {
        if (!isMounted || !myProfile) return;
        setCurrentUserProfile(myProfile);
        if (Array.isArray(myProfile.followingSellers)) {
          setIsFollowing(myProfile.followingSellers.includes(sellerId));
        }
      });
    }

    const unsubUsers = watchUsers((result) => {
      if (isMounted) setAllUsers(result);
    });

    const unsubProducts = watchProducts((allProducts) => {
      if (!isMounted) return;
      const filtered = (allProducts as Product[]).filter((p: any) => {
        if (p.sellerId === sellerId || p.user_id === sellerId) return true;
        if (p.sellerName && sellerId && p.sellerName.trim().toLowerCase() === sellerId.trim().toLowerCase()) return true;
        if (seller && (
          p.sellerId === seller.id || 
          p.sellerId === seller.uid || 
          p.user_id === seller.id ||
          (p.sellerName && seller.username && p.sellerName.trim().toLowerCase() === seller.username.trim().toLowerCase()) ||
          (p.sellerEmail && seller.email && p.sellerEmail.trim().toLowerCase() === seller.email.trim().toLowerCase())
        )) return true;
        return false;
      });
      setProducts(filtered);
      setLoading(false);
    });

    return () => {
      isMounted = false;
      unsubProducts();
      unsubUsers();
    };
  }, [sellerId, seller?.id, seller?.username, seller?.email]);

  const handleToggleFollow = async () => {
    if (!currentUser) {
      Alert.alert('Authentication Required', 'Please sign in or register to follow merchants.');
      return;
    }
    if (isTogglingFollowRef.current) return;
    isTogglingFollowRef.current = true;
    // Captured before the optimistic update — React state updates aren't
    // visible until the next render, so reading `isFollowing` again inside
    // the catch below would still see this same pre-toggle value, not a
    // true "previous state" to roll back to.
    const previousState = isFollowing;
    const updatedState = !previousState;
    try {
      setIsFollowing(updatedState);
      await toggleFollowSeller(sellerId, currentUser.uid);
      Alert.alert(
        updatedState ? 'Merchant Followed 🔔' : 'Unfollowed',
        updatedState
          ? `You will now receive updates when ${seller?.username || 'this merchant'} posts new items.`
          : `Removed from your followed sellers.`
      );
    } catch (err: any) {
      setIsFollowing(previousState);
      Alert.alert('Error', err.message || 'Could not update follow status.');
    } finally {
      isTogglingFollowRef.current = false;
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
    if (!products[0]) {
      Alert.alert('No Listings Yet', 'This merchant has no active listings to inquire about right now.');
      return;
    }

    try {
      setStartingChat(true);
      const chatId = await startChatApi(products[0].id);
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
    if (!currentUserProfile?.emailVerified) {
      setBlockedActionType('whatsApp');
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
    const msg = encodeURIComponent(`Hello ${sellerName}! I see your store on Tedbuy marketplace and would love to chat.`);
    const url = `https://wa.me/${cleanNumber}?text=${msg}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Unable to open WhatsApp application.');
    });
  };

  const handleAddReview = async () => {
    if (!currentUser) {
      Alert.alert('Authentication Required', 'Please sign in to submit a review.');
      return;
    }
    if (!currentUserProfile?.emailVerified) {
      setBlockedActionType('review');
      return;
    }
    if (reviewComment.trim().length < 5) {
      Alert.alert('Review Too Short', 'Please enter at least 5 characters describing your trading experience.');
      return;
    }
    if (isSubmittingReview) return;

    try {
      setIsSubmittingReview(true);
      const newRev = await addReview(sellerId, reviewRating, reviewComment.trim(), reviewProductTitle || undefined);
      setReviewsList((prev) => [newRev, ...prev]);
      setReviewComment('');
      setReviewRating(5);
      setReviewProductTitle('');
      setShowReviewModal(false);
      Alert.alert('Review Submitted ⭐', 'Thank you for building community trust on TedBuy!');
    } catch (err: any) {
      Alert.alert('Review Failed', err?.message || 'Could not submit your review. Please try again.');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const sellerName = seller?.username || seller?.displayName || products[0]?.sellerName || 'Verified Merchant';
  const joinDate = seller?.joinDate || 'Jan 2026';
  const trust = calculateTrustScore(seller, reviewsList as any);
  const isOwner = !!(currentUser && currentUser.uid === sellerId);
  const isActiveSeller = products.some((p) => isBoostActive(p));
  const avatarUrl = seller?.photoUrl && !String(seller.photoUrl).includes('1549399542-7e3f8b79c341') ? seller.photoUrl : null;
  // Matches web's sellerFollowers/sellerFollowing exactly (SellerProfilePage.tsx).
  const sellerFollowers = seller ? allUsers.filter((u) => Array.isArray(u.followingSellers) && u.followingSellers.includes(seller.id)) : [];
  const sellerFollowing = seller ? allUsers.filter((u) => Array.isArray(seller.followingSellers) && seller.followingSellers.includes(u.id)) : [];

  // Matches web's availableCategories/filteredSellerProducts exactly.
  const availableCategories = Array.from(new Set(products.map((p) => p.category).filter(Boolean))) as string[];
  const filteredProducts = products.filter((p: any) => {
    const q = storeSearchQuery.trim().toLowerCase();
    const matchesSearch = !q ||
      String(p.title || '').toLowerCase().includes(q) ||
      (p.brand && String(p.brand).toLowerCase().includes(q)) ||
      (p.description && String(p.description).toLowerCase().includes(q));
    const matchesCategory = !storeSelectedCategory || p.category === storeSelectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleToggleFollowInList = async (targetUserId: string) => {
    if (!currentUser || togglingFollowUserId) return;
    try {
      setTogglingFollowUserId(targetUserId);
      await toggleFollowSeller(targetUserId, currentUser.uid);
      setCurrentUserProfile((prev: any) => {
        if (!prev) return prev;
        const following: string[] = Array.isArray(prev.followingSellers) ? prev.followingSellers : [];
        const next = following.includes(targetUserId) ? following.filter((id) => id !== targetUserId) : [...following, targetUserId];
        return { ...prev, followingSellers: next };
      });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not update follow status.');
    } finally {
      setTogglingFollowUserId(null);
    }
  };

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
        {!isOwner && (
          <Pressable onPress={handleToggleFollow} style={[styles.followTopBtn, isFollowing && styles.followingTopBtn]}>
            <Text style={[styles.followTopBtnText, isFollowing && styles.followingTopBtnText]}>
              {isFollowing ? '✓ Following' : '+ Follow'}
            </Text>
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Cover / Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatarRow}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarContainer} resizeMode="cover" />
            ) : (
              <View style={styles.avatarContainer}>
                <Text style={styles.avatarText}>
                  {sellerName.substring(0, 2).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.profileMeta}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {isUserAdmin(seller) ? (
                  <View style={[styles.verifiedTag, { backgroundColor: '#dbeafe', borderColor: '#bfdbfe' }]}>
                    <Text style={[styles.verifiedTagText, { color: '#1d4ed8' }]}>🔹 OFFICIAL ADMIN</Text>
                  </View>
                ) : isUserVerified(seller) ? (
                  <View style={styles.verifiedTag}>
                    <Text style={styles.verifiedTagText}>✓ VERIFIED SELLER</Text>
                  </View>
                ) : null}
                {isActiveSeller && (
                  <View style={styles.activeSellerTag}>
                    <Text style={styles.activeSellerTagText}>🔥 ACTIVE SELLER</Text>
                  </View>
                )}
              </View>
              <Text style={styles.sellerNameText}>{sellerName}</Text>
              <Text style={styles.memberSinceText}>{formatTedbuyTenure(seller?.joinDate || seller?.createdAt)} • Accra, Ghana</Text>
            </View>
          </View>

          <Text style={styles.bioText}>
            {seller?.bio || 'Official verified merchant on TedBuy marketplace. Quality electronics, phones, and fashion items with fast delivery across major regions in Ghana.'}
          </Text>

          {/* Followers / Following — was entirely missing on mobile */}
          <View style={styles.followStatsRow}>
            <Pressable
              onPress={() => { setActiveFollowTab('followers'); setShowFollowModal(true); }}
              style={styles.followStatItem}
            >
              <UsersIcon size={13} color="#94a3b8" />
              <Text style={styles.followStatText}><Text style={styles.followStatCount}>{sellerFollowers.length}</Text> followers</Text>
            </Pressable>
            <Pressable
              onPress={() => { setActiveFollowTab('following'); setShowFollowModal(true); }}
              style={styles.followStatItem}
            >
              <UsersIcon size={13} color="#94a3b8" />
              <Text style={styles.followStatText}><Text style={styles.followStatCount}>{sellerFollowing.length}</Text> following</Text>
            </Pressable>
          </View>

          {/* Trust Score & Stats Banner */}
          <View style={styles.statsBanner}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{products.length}</Text>
              <Text style={styles.statLabel}>LISTINGS</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={[
                styles.trustScoreValue,
                { color: trust.score >= 90 ? '#22c55e' : trust.score >= 75 ? '#818cf8' : trust.score >= 50 ? '#fbbf24' : '#fb7185' },
              ]}>{trust.score}/100</Text>
              <Text style={styles.trustScoreLabel}>{trust.level.toUpperCase()}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statValue}>
                {reviewsList.length > 0
                  ? `★ ${(reviewsList.reduce((sum, r) => sum + r.rating, 0) / reviewsList.length).toFixed(1)}`
                  : '— '}
              </Text>
              <Text style={styles.statLabel}>RATING</Text>
            </View>
          </View>

          {/* Action Buttons — hidden for the seller's own profile, matching web */}
          {!isOwner && (
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
          )}
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
            {/* Store catalog search — was entirely missing on mobile */}
            {products.length > 0 && (
              <View style={styles.storeSearchWrapper}>
                <TextInput
                  value={storeSearchQuery}
                  onChangeText={setStoreSearchQuery}
                  placeholder="Search store inventory..."
                  placeholderTextColor="#94a3b8"
                  style={styles.storeSearchInput}
                />
                {!!storeSearchQuery && (
                  <Pressable onPress={() => setStoreSearchQuery('')} style={styles.storeSearchClearBtn}>
                    <Text style={{ color: '#94a3b8', fontSize: 13 }}>✕</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* Category filter chips — was entirely missing on mobile */}
            {availableCategories.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storeCategoryRow}>
                <Pressable
                  onPress={() => setStoreSelectedCategory(null)}
                  style={[styles.storeCategoryChip, storeSelectedCategory === null && styles.storeCategoryChipActive]}
                >
                  <Text style={[styles.storeCategoryChipText, storeSelectedCategory === null && styles.storeCategoryChipTextActive]}>
                    All ({products.length})
                  </Text>
                </Pressable>
                {availableCategories.map((cat) => {
                  const count = products.filter((p: any) => p.category === cat).length;
                  const isSelected = storeSelectedCategory === cat;
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => setStoreSelectedCategory(isSelected ? null : cat)}
                      style={[styles.storeCategoryChip, isSelected && styles.storeCategoryChipActive]}
                    >
                      <Text style={[styles.storeCategoryChipText, isSelected && styles.storeCategoryChipTextActive]}>
                        {cat} ({count})
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            {loading ? (
              <ActivityIndicator size="large" color="#0f172a" style={{ marginVertical: 32 }} />
            ) : products.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateTitle}>No Active Listings</Text>
                <Text style={styles.emptyStateSub}>This merchant does not have any active products listed right now.</Text>
              </View>
            ) : filteredProducts.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateTitle}>No matching items</Text>
                <Text style={styles.emptyStateSub}>Try a different search term or category.</Text>
              </View>
            ) : (
              <View style={styles.productsGrid}>
                {filteredProducts.map((item: any) => (
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
              {!isOwner && (
                <Pressable onPress={() => setShowReviewModal(true)} style={styles.addReviewBtn}>
                  <Text style={styles.addReviewBtnText}>+ Write Review</Text>
                </Pressable>
              )}
            </View>

            {reviewsList.map((rev) => (
              <View key={rev.id} style={styles.reviewCard}>
                <View style={styles.reviewCardHeader}>
                  <Text style={styles.reviewerName}>{rev.buyerName}</Text>
                  <Text style={styles.reviewStars}>{'★'.repeat(rev.rating)}</Text>
                </View>
                <Text style={styles.reviewComment}>{rev.comment}</Text>
                <Text style={styles.reviewDate}>
                  {new Date(rev.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </Text>
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
        <DismissKeyboardView>
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
            {/* Matches web's SellerProfilePage.tsx per-rating caption exactly
                (this mobile screen is SellerProfilePage's equivalent, not
                ChatInterface's inline ReviewModal, which uses different text
                — was mistakenly copied from the wrong web component). */}
            <Text style={styles.reviewRatingCaption}>
              {reviewRating === 5 && '⭐ Excellent'}
              {reviewRating === 4 && '👍 Good'}
              {reviewRating === 3 && '👌 Average'}
              {reviewRating === 2 && '⚠️ Poor'}
              {reviewRating === 1 && '❌ Terrible'}
            </Text>

            {/* Matches web's "Purchased Item (Optional)" dropdown — lets a
                reviewer tag their review to one of the seller's own listings,
                or leave it as a general store review. */}
            {products.length > 0 && (
              <View style={{ marginBottom: 10 }}>
                <Text style={styles.starRatingLabel}>Purchased Item (Optional):</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                  <Pressable
                    onPress={() => setReviewProductTitle('')}
                    style={[styles.reviewProductChip, !reviewProductTitle && styles.reviewProductChipActive]}
                  >
                    <Text style={[styles.reviewProductChipText, !reviewProductTitle && styles.reviewProductChipTextActive]}>
                      General Store Review
                    </Text>
                  </Pressable>
                  {products.slice(0, 20).map((p: any) => (
                    <Pressable
                      key={p.id}
                      onPress={() => setReviewProductTitle(p.title)}
                      style={[styles.reviewProductChip, reviewProductTitle === p.title && styles.reviewProductChipActive]}
                    >
                      <Text
                        style={[styles.reviewProductChipText, reviewProductTitle === p.title && styles.reviewProductChipTextActive]}
                        numberOfLines={1}
                      >
                        {p.title}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            <TextInput
              style={styles.reviewInput}
              value={reviewComment}
              onChangeText={setReviewComment}
              placeholder="Describe product quality, delivery speed, and overall trade experience..."
              placeholderTextColor="#94a3b8"
              multiline
              maxLength={1000}
            />
            {/* Matches server's real cap (server.ts /api/reviews/create rejects
                >1000 chars) — web's own UI cap of 200 is stricter than what the
                server actually enforces, so mobile matches the real constraint
                rather than copying web's inconsistent stricter one. */}
            <Text style={styles.reviewCharCount}>{reviewComment.length}/1000</Text>

            <Pressable onPress={handleAddReview} style={styles.submitReviewBtn}>
              <Text style={styles.submitReviewBtnText}>Submit Customer Feedback</Text>
            </Pressable>
          </View>
        </View>
        </DismissKeyboardView>
      </Modal>

      <EmailVerificationModal
        visible={blockedActionType !== null}
        actionType={blockedActionType}
        onClose={() => setBlockedActionType(null)}
        onVerified={() => setCurrentUserProfile((prev: any) => (prev ? { ...prev, emailVerified: true } : prev))}
      />

      {/* Followers / Following list modal — matches web's tabbed modal */}
      <Modal
        animationType="slide"
        transparent
        visible={showFollowModal}
        onRequestClose={() => setShowFollowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.followModalCard}>
            <View style={styles.followModalHeader}>
              <Text style={styles.followModalTitle}>{sellerName}'s Network</Text>
              <Pressable onPress={() => setShowFollowModal(false)}>
                <Text style={{ fontSize: 18, color: '#64748b' }}>✕</Text>
              </Pressable>
            </View>

            <View style={styles.followTabRow}>
              <Pressable
                onPress={() => setActiveFollowTab('following')}
                style={[styles.followTab, activeFollowTab === 'following' && styles.followTabActive]}
              >
                <Text style={[styles.followTabText, activeFollowTab === 'following' && styles.followTabTextActive]}>
                  Following ({sellerFollowing.length})
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setActiveFollowTab('followers')}
                style={[styles.followTab, activeFollowTab === 'followers' && styles.followTabActive]}
              >
                <Text style={[styles.followTabText, activeFollowTab === 'followers' && styles.followTabTextActive]}>
                  Followers ({sellerFollowers.length})
                </Text>
              </Pressable>
            </View>

            <FlatList
              data={activeFollowTab === 'following' ? sellerFollowing : sellerFollowers}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 420 }}
              contentContainerStyle={{ padding: 14, gap: 10 }}
              ListEmptyComponent={
                <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                  <Text style={styles.followEmptyTitle}>
                    {activeFollowTab === 'following' ? 'Not following anyone' : 'No followers yet'}
                  </Text>
                  <Text style={styles.followEmptyText}>
                    {activeFollowTab === 'following'
                      ? "This store hasn't followed other members in the community yet."
                      : 'No one is following this store yet.'}
                  </Text>
                </View>
              }
              renderItem={({ item }) => {
                const isMe = currentUser?.uid === item.id;
                const amIFollowing = Array.isArray(currentUserProfile?.followingSellers) && currentUserProfile.followingSellers.includes(item.id);
                const itemAvatar = item.photoUrl && !String(item.photoUrl).includes('1549399542-7e3f8b79c341') ? item.photoUrl : null;
                return (
                  <View style={styles.followListRow}>
                    <Pressable
                      onPress={() => {
                        setShowFollowModal(false);
                        navigation.navigate('SellerProfile', { sellerId: item.id });
                      }}
                      style={styles.followListUser}
                    >
                      {itemAvatar ? (
                        <Image source={{ uri: itemAvatar }} style={styles.followListAvatar} />
                      ) : (
                        <View style={[styles.followListAvatar, styles.followListAvatarFallback]}>
                          <Text style={styles.followListAvatarText}>{String(item.username || 'U').slice(0, 2).toUpperCase()}</Text>
                        </View>
                      )}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.followListName} numberOfLines={1}>{item.username || 'TedBuy User'}</Text>
                        <Text style={styles.followListRole}>{item.role || 'user'}</Text>
                      </View>
                    </Pressable>
                    {!isMe && currentUser && (
                      <Pressable
                        onPress={() => handleToggleFollowInList(item.id)}
                        disabled={togglingFollowUserId === item.id}
                        style={[styles.followListActionBtn, amIFollowing && styles.followListActionBtnActive]}
                      >
                        {togglingFollowUserId === item.id ? (
                          <ActivityIndicator size="small" color={amIFollowing ? '#e11d48' : '#0f172a'} />
                        ) : (
                          <>
                            {amIFollowing ? <UserMinus size={11} color="#e11d48" /> : <UserPlus size={11} color="#0f172a" />}
                            <Text style={[styles.followListActionText, amIFollowing && styles.followListActionTextActive]}>
                              {amIFollowing ? 'Unfollow' : 'Follow'}
                            </Text>
                          </>
                        )}
                      </Pressable>
                    )}
                  </View>
                );
              }}
            />
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
  backBtnText: { color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 12 },
  headerTitle: { flex: 1, color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 15 },
  followTopBtn: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  followingTopBtn: { backgroundColor: '#334155' },
  followTopBtnText: { color: '#0f172a', fontFamily: fonts.extrabold, fontSize: 11 },
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
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: { color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 18 },
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
  verifiedTagText: { color: '#166534', fontSize: 9, fontFamily: fonts.extrabold },
  activeSellerTag: {
    backgroundColor: '#fffbeb',
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#fde68a',
    marginBottom: 4,
  },
  activeSellerTagText: { color: '#92400e', fontSize: 9, fontFamily: fonts.extrabold },
  sellerNameText: { fontSize: 17, fontFamily: fonts.extrabold, color: '#0f172a' },
  memberSinceText: { fontSize: 11, color: '#64748b', marginTop: 2, fontFamily: fonts.semibold },

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
  statValue: { color: '#ffffff', fontSize: 16, fontFamily: fonts.extrabold },
  statLabel: { color: '#94a3b8', fontSize: 8.5, fontFamily: fonts.extrabold, marginTop: 2 },
  statDivider: { width: 1, height: 24, backgroundColor: '#334155' },
  trustScoreValue: { color: '#22c55e', fontSize: 16, fontFamily: fonts.extrabold },
  trustScoreLabel: { color: '#86efac', fontSize: 8.5, fontFamily: fonts.extrabold, marginTop: 2 },

  actionButtonsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  primaryActionBtn: {
    backgroundColor: '#0f172a',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryActionBtnText: { color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 13 },
  whatsappActionBtn: {
    backgroundColor: '#059669',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  whatsappActionBtnText: { color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 13 },

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
  tabItemText: { fontSize: 12, fontFamily: fonts.extrabold, color: '#64748b' },
  tabItemTextActive: { color: '#ffffff' },

  listingsContainer: { paddingHorizontal: 10, paddingTop: 12 },
  storeSearchWrapper: { position: 'relative', marginBottom: 10, marginHorizontal: 4 },
  storeSearchInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, paddingRight: 32, fontSize: 12.5, color: '#0f172a', fontFamily: fonts.semibold },
  storeSearchClearBtn: { position: 'absolute', right: 10, top: 9 },
  storeCategoryRow: { gap: 6, paddingHorizontal: 4, paddingBottom: 10 },
  storeCategoryChip: { backgroundColor: '#f1f5f9', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  storeCategoryChipActive: { backgroundColor: '#0f172a' },
  storeCategoryChipText: { fontSize: 11, color: '#475569', fontFamily: fonts.bold },
  storeCategoryChipTextActive: { color: '#ffffff' },
  productsGrid: { flexDirection: 'row', flexWrap: 'wrap' },

  emptyState: { padding: 32, alignItems: 'center' },
  emptyStateTitle: { fontSize: 16, fontFamily: fonts.extrabold, color: '#0f172a' },
  emptyStateSub: { fontSize: 12, color: '#64748b', textAlign: 'center', marginTop: 4 },

  reviewsContainer: { paddingHorizontal: 14, paddingTop: 14 },
  reviewHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  reviewHeaderTitle: { fontSize: 15, fontFamily: fonts.extrabold, color: '#0f172a' },
  addReviewBtn: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addReviewBtnText: { color: '#ffffff', fontSize: 11, fontFamily: fonts.extrabold },

  reviewCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  reviewCardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  reviewerName: { fontSize: 13, fontFamily: fonts.extrabold, color: '#0f172a' },
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
  safetyModalTitle: { fontSize: 16, fontFamily: fonts.extrabold, color: '#0f172a', marginBottom: 10 },
  safetyModalText: { fontSize: 12.5, color: '#334155', lineHeight: 20, marginBottom: 16 },
  safetyModalButtons: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  safetyCancelBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  safetyCancelText: { color: '#64748b', fontFamily: fonts.extrabold, fontSize: 12 },
  safetyConfirmBtn: { backgroundColor: '#16a34a', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  safetyConfirmText: { color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 12 },

  reviewModalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    width: '100%',
  },
  reviewModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  reviewModalTitle: { fontSize: 16, fontFamily: fonts.extrabold, color: '#0f172a' },
  starRatingLabel: { fontSize: 12, fontFamily: fonts.extrabold, color: '#64748b' },
  starRow: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  starIcon: { fontSize: 28, color: '#cbd5e1' },
  starIconSelected: { color: '#eab308' },
  reviewRatingCaption: { fontSize: 11, fontFamily: fonts.bold, color: '#475569', textAlign: 'center', marginBottom: 10 },
  reviewCharCount: { fontSize: 9, fontFamily: fonts.medium, color: '#94a3b8', textAlign: 'right', marginTop: 4 },
  reviewProductChip: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, marginRight: 6, maxWidth: 160 },
  reviewProductChipActive: { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  reviewProductChipText: { fontSize: 10, fontFamily: fonts.bold, color: '#475569' },
  reviewProductChipTextActive: { color: '#ffffff' },
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
  submitReviewBtnText: { color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 13 },

  followStatsRow: { flexDirection: 'row', gap: 16, marginTop: 10 },
  followStatItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  followStatText: { fontSize: 11.5, color: '#64748b', fontFamily: fonts.semibold },
  followStatCount: { color: '#0f172a', fontFamily: fonts.extrabold },

  followModalCard: { backgroundColor: '#ffffff', borderRadius: 20, width: '100%', maxHeight: '80%', overflow: 'hidden' },
  followModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  followModalTitle: { fontSize: 15, fontFamily: fonts.extrabold, color: '#0f172a' },
  followTabRow: { flexDirection: 'row', gap: 4, padding: 6, backgroundColor: '#f8fafc' },
  followTab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  followTabActive: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0' },
  followTabText: { fontSize: 11.5, fontFamily: fonts.bold, color: '#64748b' },
  followTabTextActive: { color: '#0f172a' },
  followEmptyTitle: { fontSize: 13, fontFamily: fonts.extrabold, color: '#1e293b' },
  followEmptyText: { fontSize: 11.5, color: '#64748b', textAlign: 'center', marginTop: 4, maxWidth: 260 },
  followListRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#f1f5f9', borderRadius: 14, padding: 10 },
  followListUser: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  followListAvatar: { width: 38, height: 38, borderRadius: 19 },
  followListAvatarFallback: { backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  followListAvatarText: { fontSize: 12, color: '#64748b', fontFamily: fonts.extrabold },
  followListName: { fontSize: 12.5, color: '#0f172a', fontFamily: fonts.extrabold },
  followListRole: { fontSize: 9.5, color: '#94a3b8', fontFamily: fonts.semibold, textTransform: 'capitalize', marginTop: 1 },
  followListActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  followListActionBtnActive: { borderColor: '#fecdd3', backgroundColor: '#fff1f2' },
  followListActionText: { fontSize: 10, fontFamily: fonts.bold, color: '#0f172a' },
  followListActionTextActive: { color: '#e11d48' },
});
