import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { categories } from '../data';
import { Product } from '../types';
import { auth, watchProducts, watchUsers } from '../firebase';

interface HomeScreenProps {
  onOpenProduct: (product: Product) => void;
  route?: any;
  navigation?: any;
}

const categoryIcons: Record<string, string> = {
  All: '🌐',
  Phones: '📱',
  Laptops: '💻',
  Fashion: '👟',
  Vehicles: '🚗',
  Other: '📦',
};

export function HomeScreen({ onOpenProduct, route, navigation }: HomeScreenProps) {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchText, setSearchText] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'video'>('grid');
  const [products, setProducts] = useState<Product[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [savedProducts, setSavedProducts] = useState<Record<string, boolean>>({});

  // Listen to parameters from Search or Sell navigation
  useEffect(() => {
    if (route?.params?.category) {
      setSelectedCategory(route.params.category);
    }
    if (route?.params?.search) {
      setSearchText(route.params.search);
    }
  }, [route?.params]);

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

  const handleToggleSave = (productId: string) => {
    setSavedProducts((prev) => {
      const updated = { ...prev, [productId]: !prev[productId] };
      Alert.alert(
        updated[productId] ? 'Saved 🔖' : 'Removed',
        updated[productId]
          ? 'Listing saved to your bookmarks.'
          : 'Listing removed from bookmarks.'
      );
      return updated;
    });
  };

  const handleRefresh = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
    }, 600);
  };

  const handleStartChat = (product: Product) => {
    Alert.alert(
      'WhatsApp Chat 💬',
      `Open a direct secure chat with the seller "${product.sellerName || 'Verified Seller'}" to discuss "${product.title}"?`,
      [
        { text: 'Start Chat', onPress: () => Alert.alert('Chat Active', 'Direct encrypted secure tunnel initialized!') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleShare = (product: Product) => {
    Alert.alert(
      'Share Spotlight 🚀',
      `Copy direct link for "${product.title}" (${product.price}) to clipboard?`,
      [
        { text: 'Copy Link', onPress: () => Alert.alert('Copied!', 'Listing link copied to clipboard.') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Premium Web-aligned top header */}
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
          <View style={styles.topBarRight}>
            <Pressable style={styles.bookmarkBadge} onPress={() => Alert.alert('Saved Deals', 'Use the bookmark icon on any item or video to save them here!')}>
              <Text style={styles.bookmarkIcon}>🔖</Text>
            </Pressable>
            {auth.currentUser ? (
              <Pressable
                onPress={() => navigation?.navigate('Profile')}
                style={styles.loginBtn}
              >
                <Text style={styles.loginBtnText}>My Account</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => navigation?.navigate('Profile')}
                style={styles.loginBtn}
              >
                <Text style={styles.loginBtnText}>→ Log In</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {/* Main body of the screen */}
      <View style={styles.body}>
        {viewMode === 'grid' ? (
          <FlatList
            data={filteredProducts}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View>
                {/* Search Container matching Web App "LOOKING FOR SOMETHING?" card */}
                <View style={styles.searchBoxCard}>
                  <Text style={styles.searchLabel}>LOOKING FOR SOMETHING?</Text>
                  <View style={styles.searchRow}>
                    <Text style={styles.searchEmoji}>🔍</Text>
                    <TextInput
                      value={searchText}
                      onChangeText={setSearchText}
                      placeholder="Search phones, laptops, sneakers..."
                      style={styles.input}
                      placeholderTextColor="#64748b"
                    />
                  </View>
                </View>

                {/* Pill Toggle Switcher for Standard Grid / Watch Video Ads */}
                <View style={styles.toggleCapsule}>
                  <Pressable
                    onPress={() => setViewMode('grid')}
                    style={[styles.toggleBtn, viewMode === 'grid' && styles.toggleBtnActive]}
                  >
                    <Text style={[styles.toggleBtnIcon, viewMode === 'grid' && styles.toggleBtnIconActive]}>⊞</Text>
                    <Text style={[styles.toggleBtnText, viewMode === 'grid' && styles.toggleBtnTextActive]}>Standard Grid</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setViewMode('video')}
                    style={[styles.toggleBtn, viewMode === 'video' && styles.toggleBtnActive]}
                  >
                    <Text style={styles.toggleVideoCameraEmoji}>📹</Text>
                    <Text style={[styles.toggleBtnText, viewMode === 'video' && styles.toggleBtnTextActive]}>Watch Video Ads</Text>
                  </Pressable>
                </View>

                {/* Explore Classified Categories Section Header */}
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionHeaderLeft}>
                    <Text style={styles.sectionHeaderIcon}>📈</Text>
                    <Text style={styles.sectionHeaderTitle}>Explore Classified Categories</Text>
                  </View>
                  <Pressable onPress={() => setSelectedCategory('All')} style={styles.viewAllBtn}>
                    <Text style={styles.viewAllText}>View All Grid</Text>
                  </Pressable>
                </View>

                {/* Categories Scroll row */}
                <View style={{ height: 48, marginBottom: 16 }}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
                    {categories.map((category) => {
                      const active = selectedCategory === category;
                      return (
                        <Pressable key={category} onPress={() => setSelectedCategory(category)} style={[styles.categoryChip, active && styles.categoryChipActive]}>
                          <Text style={styles.categoryIcon}>{categoryIcons[category] || '📦'}</Text>
                          <Text style={[styles.categoryText, active && styles.categoryTextActive]}>
                            {category === 'All' ? 'All Categories' : category}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                {/* Ghana Location Filters block */}
                <View style={styles.locationFilterCard}>
                  <View style={styles.locationLeft}>
                    <Text style={styles.locationPinEmoji}>📍</Text>
                    <Text style={styles.locationTitle}>Ghana Location Filters</Text>
                  </View>
                  <View style={styles.locationRight}>
                    <View style={styles.locationBadge}>
                      <Text style={styles.locationBadgeText}>All</Text>
                    </View>
                    <Text style={styles.dropdownChevron}>▼</Text>
                  </View>
                </View>

                {/* Latest Classified Deals section */}
                <View style={styles.dealsHeaderRow}>
                  <Text style={styles.dealsTitle}>Latest Classified Deals</Text>
                  <Pressable style={styles.refreshButton} onPress={handleRefresh}>
                    <Text style={styles.refreshIcon}>🔄</Text>
                  </Pressable>
                </View>

                {/* Sort Ads bar */}
                <View style={styles.sortBar}>
                  <Text style={styles.sortText}>Sort Ads: <Text style={styles.sortValue}>Newest First ⇅</Text></Text>
                </View>
              </View>
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateTitle}>No listings match your search.</Text>
                <Text style={styles.emptyStateText}>Try a different category or search term.</Text>
              </View>
            }
            renderItem={({ item }) => {
              const sellerUser = users.find((u) => u.id === item.sellerId);
              return (
                <Pressable onPress={() => onOpenProduct(item)} style={styles.card}>
                  <Image source={{ uri: Array.isArray(item.images) && item.images.length ? item.images[0] : 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80' }} style={styles.image} />
                  <View style={styles.cardContent}>
                    <View style={styles.cardTopRow}>
                      <View style={styles.verifiedBadge}>
                        <Text style={styles.verifiedText}>✓ Verified Seller</Text>
                      </View>
                      <Text style={styles.price}>{item.price}</Text>
                    </View>
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    <Text style={styles.meta}>{item.category || 'Other'} • {item.location || 'Ghana'}</Text>
                    <Text style={styles.description} numberOfLines={2}>{item.description}</Text>
                    <View style={styles.footerRow}>
                      <Text style={styles.seller}>Seller: {sellerUser?.username || item.sellerName || 'Verified seller'}</Text>
                      <Pressable onPress={() => handleToggleSave(item.id)}>
                        <Text style={styles.likes}>
                          {savedProducts[item.id] ? '❤️' : '🤍'} {item.likesCount || 0}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </Pressable>
              );
            }}
          />
        ) : (
          /* IMERSIVE VIDEO ADS FEED (Swiper/Reels style) */
          <View style={styles.videoFeedContainer}>
            <FlatList
              data={products}
              pagingEnabled
              keyExtractor={(item) => `video-${item.id}`}
              showsVerticalScrollIndicator={false}
              renderItem={({ item, index }) => {
                const isSaved = !!savedProducts[item.id];
                return (
                  <View style={styles.videoPlayerFrame}>
                    {/* Simulated video cover frame using product image with subtle overlay */}
                    <Image
                      source={{ uri: Array.isArray(item.images) && item.images.length ? item.images[0] : 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80' }}
                      style={styles.videoPlaceholderImage}
                      blurRadius={1}
                    />
                    <View style={styles.videoOverlay} />

                    {/* Scrolling/progress bar at the top */}
                    <View style={styles.videoProgressBarContainer}>
                      <View style={styles.videoProgressBarActive} />
                    </View>

                    {/* Central Play Indicator Badge */}
                    <View style={styles.playBadgeContainer}>
                      <View style={styles.playBadge}>
                        <Text style={styles.playArrow}>▶</Text>
                      </View>
                    </View>

                    {/* Immersive bottom details row */}
                    <View style={styles.videoBottomDetails}>
                      <View style={styles.featuredTag}>
                        <Text style={styles.featuredTagText}>🔥 VIDEO SPOTLIGHT</Text>
                      </View>
                      <Text style={styles.videoProductTitle}>{item.title}</Text>
                      <View style={styles.videoPriceLocationRow}>
                        <Text style={styles.videoProductPrice}>{item.price}</Text>
                        <View style={styles.videoLocationBadge}>
                          <Text style={styles.videoLocationText}>📍 {item.location || 'Ghana'}</Text>
                        </View>
                      </View>
                      <Text style={styles.videoProductDesc} numberOfLines={2}>
                        {item.description || 'Verified listing with live video inspection score.'}
                      </Text>
                    </View>

                    {/* Snapchat-style Right hand column of action buttons */}
                    <View style={styles.videoRightActionsColumn}>
                      {/* Seller avatar */}
                      <View style={styles.videoAvatarContainer}>
                        <View style={styles.videoAvatar}>
                          <Text style={styles.videoAvatarText}>
                            {String(item.sellerName || 'VS').substring(0, 2).toUpperCase()}
                          </Text>
                        </View>
                        <View style={styles.subscribeBadge}>
                          <Text style={styles.subscribeBadgeText}>+</Text>
                        </View>
                      </View>

                      {/* Bookmark button */}
                      <Pressable style={styles.actionBtn} onPress={() => handleToggleSave(item.id)}>
                        <View style={[styles.actionBtnCircle, isSaved && styles.actionBtnCircleActive]}>
                          <Text style={styles.actionBtnIcon}>🔖</Text>
                        </View>
                        <Text style={styles.actionBtnLabel}>{isSaved ? 'Saved' : 'Save'}</Text>
                      </Pressable>

                      {/* WhatsApp Chat */}
                      <Pressable style={styles.actionBtn} onPress={() => handleStartChat(item)}>
                        <View style={[styles.actionBtnCircle, { backgroundColor: '#22c55e' }]}>
                          <Text style={styles.actionBtnIcon}>💬</Text>
                        </View>
                        <Text style={styles.actionBtnLabel}>Chat</Text>
                      </Pressable>

                      {/* Share */}
                      <Pressable style={styles.actionBtn} onPress={() => handleShare(item)}>
                        <View style={styles.actionBtnCircle}>
                          <Text style={styles.actionBtnIcon}>✈️</Text>
                        </View>
                        <Text style={styles.actionBtnLabel}>Share</Text>
                      </Pressable>

                      {/* Specs */}
                      <Pressable style={styles.actionBtn} onPress={() => onOpenProduct(item)}>
                        <View style={[styles.actionBtnCircle, { backgroundColor: '#ffffff' }]}>
                          <Text style={[styles.actionBtnIcon, { color: '#0f172a' }]}>🔎</Text>
                        </View>
                        <Text style={styles.actionBtnLabel}>Specs</Text>
                      </Pressable>

                      {/* Return to grid */}
                      <Pressable style={styles.actionBtn} onPress={() => setViewMode('grid')}>
                        <View style={[styles.actionBtnCircle, { backgroundColor: '#020617' }]}>
                          <Text style={styles.actionBtnIcon}>⊞</Text>
                        </View>
                        <Text style={styles.actionBtnLabel}>Grid</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              }}
            />
          </View>
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
  topBarRight: { flexDirection: 'row', alignItems: 'center' },
  bookmarkBadge: { marginRight: 12, width: 34, height: 34, borderRadius: 8, backgroundColor: '#1e293b', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  bookmarkIcon: { fontSize: 16 },
  loginBtn: { backgroundColor: '#ffffff', paddingHorizontal: 14, height: 34, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  loginBtnText: { color: '#0f172a', fontWeight: '800', fontSize: 12 },

  body: { flex: 1, backgroundColor: '#f8fafc' },
  listContent: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24 },

  /* Search Card component styled like Web App */
  searchBoxCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    marginBottom: 14,
  },
  searchLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    height: 44,
  },
  searchEmoji: { fontSize: 16, marginRight: 8, color: '#64748b' },
  input: { flex: 1, fontSize: 14, color: '#0f172a', fontWeight: '500' },

  /* Capsule Switcher component styled like Web App */
  toggleCapsule: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    padding: 4,
    marginBottom: 16,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: 'row',
    height: 38,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleBtnActive: {
    backgroundColor: '#0f172a',
  },
  toggleBtnIcon: {
    fontSize: 14,
    marginRight: 6,
    color: '#64748b',
    fontWeight: 'bold',
  },
  toggleBtnIconActive: {
    color: '#ffffff',
  },
  toggleVideoCameraEmoji: {
    fontSize: 14,
    marginRight: 6,
  },
  toggleBtnText: {
    color: '#64748b',
    fontWeight: '700',
    fontSize: 12.5,
  },
  toggleBtnTextActive: {
    color: '#ffffff',
    fontWeight: '800',
  },

  /* Categories block matching Web App */
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionHeaderIcon: {
    fontSize: 15,
    marginRight: 6,
  },
  sectionHeaderTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  viewAllBtn: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  viewAllText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0f172a',
  },
  categoryRow: { paddingBottom: 6 },
  categoryChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, marginRight: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  categoryChipActive: { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  categoryIcon: { fontSize: 13, marginRight: 6 },
  categoryText: { color: '#475569', fontWeight: '700', fontSize: 12 },
  categoryTextActive: { color: '#fff', fontWeight: '800' },

  /* Ghana Location Filter Card component styled like Web App */
  locationFilterCard: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 52,
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.02,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    marginBottom: 16,
  },
  locationLeft: { flexDirection: 'row', alignItems: 'center' },
  locationPinEmoji: { fontSize: 16, marginRight: 8 },
  locationTitle: { color: '#0f172a', fontSize: 13.5, fontWeight: '800', letterSpacing: -0.2 },
  locationRight: { flexDirection: 'row', alignItems: 'center' },
  locationBadge: { backgroundColor: '#f1f5f9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginRight: 6 },
  locationBadgeText: { color: '#64748b', fontSize: 11, fontWeight: '700' },
  dropdownChevron: { color: '#94a3b8', fontSize: 11 },

  /* Latest Classified Deals header styling */
  dealsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    marginTop: 4,
    paddingHorizontal: 2,
  },
  dealsTitle: { fontSize: 16, fontWeight: '900', color: '#0f172a', letterSpacing: -0.3 },
  refreshButton: { padding: 4 },
  refreshIcon: { fontSize: 15 },
  sortBar: { marginBottom: 12, paddingHorizontal: 2 },
  sortText: { color: '#64748b', fontSize: 11.5, fontWeight: '600' },
  sortValue: { color: '#0f172a', fontWeight: '800' },

  /* Products standard listing card components */
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
  likes: { fontSize: 12, fontWeight: '700' },

  /* IMMERSIVE REELS SIMULATION COMPONENTS */
  videoFeedContainer: { flex: 1, backgroundColor: '#020617' },
  videoPlayerFrame: {
    height: 560,
    backgroundColor: '#000000',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
    overflow: 'hidden',
    margin: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  videoPlaceholderImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  videoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(2, 6, 23, 0.45)',
  },
  videoProgressBarContainer: {
    position: 'absolute',
    top: 10,
    left: 12,
    right: 12,
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 999,
    overflow: 'hidden',
    zIndex: 10,
  },
  videoProgressBarActive: {
    width: '38%',
    height: '100%',
    backgroundColor: '#ea580c',
  },
  playBadgeContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
  },
  playBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  playArrow: {
    color: '#ffffff',
    fontSize: 18,
    marginLeft: 3,
  },
  videoBottomDetails: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 90,
    zIndex: 10,
  },
  featuredTag: {
    alignSelf: 'flex-start',
    backgroundColor: '#ea580c',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginBottom: 6,
  },
  featuredTagText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  videoProductTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  videoPriceLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  videoProductPrice: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
  videoLocationBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  videoLocationText: {
    color: '#ffffff',
    fontSize: 9.5,
    fontWeight: '700',
  },
  videoProductDesc: {
    color: '#cbd5e1',
    fontSize: 11,
    marginTop: 6,
    lineHeight: 16,
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  videoRightActionsColumn: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    alignItems: 'center',
    gap: 12,
    zIndex: 10,
  },
  videoAvatarContainer: {
    position: 'relative',
    marginBottom: 4,
  },
  videoAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#ea580c',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  videoAvatarText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  subscribeBadge: {
    position: 'absolute',
    bottom: -4,
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    width: 14,
    height: 14,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ea580c',
  },
  subscribeBadgeText: {
    color: '#ea580c',
    fontSize: 9,
    fontWeight: '900',
  },
  actionBtn: {
    alignItems: 'center',
  },
  actionBtnCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  actionBtnCircleActive: {
    backgroundColor: '#ea580c',
  },
  actionBtnIcon: {
    fontSize: 15,
    color: '#ffffff',
  },
  actionBtnLabel: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
    marginTop: 3,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 2,
  },
});
