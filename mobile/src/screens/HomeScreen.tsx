import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { categories } from '../data';
import { Product } from '../types';
import { auth, fetchProducts, watchProducts, watchUsers } from '../firebase';
import { ProductCard } from '../components/ProductCard';

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
  'Home Appliances': '🔌',
  Vehicles: '🚗',
  Property: '🏠',
  'Furniture & Home': '🛋️',
  'Beauty and Care': '✨',
  Games: '🎮',
  Electronics: '⚡',
  Services: '🛠️',
  'Jobs & Employment': '💼',
  'Agriculture & Food': '🌾',
  'Pets & Animals': '🐾',
  'Sports & Fitness': '🏋️',
  'Kids & Baby': '👶',
  'Commercial & Tools': '🏗️',
  'Books & Hobbies': '📚',
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
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const [minPriceFilter, setMinPriceFilter] = useState('');
  const [maxPriceFilter, setMaxPriceFilter] = useState('');
  const [selectedBrandFilter, setSelectedBrandFilter] = useState('');

  // Close filter dropdown on category change
  useEffect(() => {
    setIsFilterDropdownOpen(false);
    setMinPriceFilter('');
    setMaxPriceFilter('');
    setSelectedBrandFilter('');
  }, [selectedCategory]);

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

  // Fetch server search results when search query or category changes
  useEffect(() => {
    if (!searchText.trim() && selectedCategory === 'All') return;

    let active = true;

    fetchProducts(200, searchText, selectedCategory).then((items) => {
      if (!active) return;
      if (Array.isArray(items) && items.length > 0) {
        setProducts((prev) => {
          const map = new Map<string, Product>();
          prev.forEach((p) => { if (p && p.id) map.set(String(p.id), p as Product); });
          items.forEach((p) => { if (p && p.id) map.set(String(p.id), p as Product); });
          return Array.from(map.values());
        });
      }
    }).catch(() => {});

    return () => {
      active = false;
    };
  }, [searchText, selectedCategory]);

  const filteredProducts = useMemo(() => {
    const list = products.filter((product) => {
      const title = String(product.title || '').toLowerCase();
      const description = String(product.description || '').toLowerCase();
      const category = String(product.category || 'Other');
      const brand = String((product as any).brand || '').toLowerCase();
      const location = String(product.location || '').toLowerCase();
      const query = searchText.toLowerCase().trim();

      const matchesCategory = selectedCategory === 'All' || category === selectedCategory;
      const matchesSearch = !query ||
        title.includes(query) ||
        description.includes(query) ||
        category.toLowerCase().includes(query) ||
        brand.includes(query) ||
        location.includes(query);

      const price = Number(product.price) || 0;
      const matchesMin = !minPriceFilter || price >= Number(minPriceFilter);
      const matchesMax = !maxPriceFilter || price <= Number(maxPriceFilter);
      const matchesBrand = !selectedBrandFilter || brand.includes(selectedBrandFilter.toLowerCase()) || title.includes(selectedBrandFilter.toLowerCase());

      return matchesCategory && matchesSearch && matchesMin && matchesMax && matchesBrand;
    });

    const isBoostActive = (p: Product): boolean => {
      if (!p) return false;
      const status = p.boostStatus || (p as any).boost_status || (p as any).isBoosted || (p as any).is_boosted;
      if (!status) return false;
      if (p.boostEndDate) {
        const endDate = new Date(p.boostEndDate);
        if (!isNaN(endDate.getTime())) return endDate.getTime() > Date.now();
      }
      return true;
    };

    return list.sort((a, b) => {
      const boostA = isBoostActive(a);
      const boostB = isBoostActive(b);
      if (boostA && !boostB) return -1;
      if (!boostA && boostB) return 1;
      if (boostA && boostB) {
        const scoreA = Number((a as any).priorityScore || (a as any).boostPriority || 0);
        const scoreB = Number((b as any).priorityScore || (b as any).boostPriority || 0);
        if (scoreA !== scoreB) return scoreB - scoreA;
      }
      return 0;
    });
  }, [products, searchText, selectedCategory]);

  const [categoryDisplayLimit, setCategoryDisplayLimit] = useState(24);

  // Reset pagination limit on filter or category change
  useEffect(() => {
    setCategoryDisplayLimit(24);
  }, [selectedCategory, searchText, minPriceFilter, maxPriceFilter, selectedBrandFilter]);

  const isAllCategories = (selectedCategory === 'All' || !selectedCategory) && !searchText.trim();
  const displayedProducts = useMemo(() => {
    return isAllCategories ? filteredProducts.slice(0, 24) : filteredProducts.slice(0, categoryDisplayLimit);
  }, [isAllCategories, filteredProducts, categoryDisplayLimit]);

  // Featured boosted listings memo
  const featuredProducts = useMemo(() => {
    return products.filter((p) => {
      if (!p || (p as any).status === 'hidden' || (p as any).isSold || (p as any).status === 'sold') return false;
      if (selectedCategory && selectedCategory !== 'All') {
        const pCat = String(p.category || '').toLowerCase().trim();
        const selCat = String(selectedCategory).toLowerCase().trim();
        if (pCat !== selCat && !pCat.includes(selCat) && !selCat.includes(pCat)) return false;
      }
      const status = p.boostStatus || (p as any).boost_status || (p as any).isBoosted || (p as any).is_boosted;
      if (!status) return false;
      if (p.boostEndDate) {
        const endDate = new Date(p.boostEndDate);
        if (!isNaN(endDate.getTime())) return endDate.getTime() > Date.now();
      }
      return true;
    }).sort((a, b) => {
      const scoreA = Number((a as any).priorityScore || (a as any).boostPriority || 0);
      const scoreB = Number((b as any).priorityScore || (b as any).boostPriority || 0);
      return scoreB - scoreA;
    });
  }, [products, selectedCategory]);

  // Trending 10 most viewed listings memo
  const trendingProducts = useMemo(() => {
    const list = products.filter((p) => {
      if (!p || (p as any).status === 'hidden' || (p as any).isSold || (p as any).status === 'sold') return false;
      if (selectedCategory && selectedCategory !== 'All') {
        const pCat = String(p.category || '').toLowerCase().trim();
        const selCat = String(selectedCategory).toLowerCase().trim();
        if (pCat !== selCat && !pCat.includes(selCat) && !selCat.includes(pCat)) return false;
      }
      return true;
    });

    return list.sort((a, b) => {
      const aViews = Number((a as any).viewsCount || (a as any).views) || 0;
      const bViews = Number((b as any).viewsCount || (b as any).views) || 0;
      if (bViews !== aViews) return bViews - aViews;
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    }).slice(0, 10);
  }, [products, selectedCategory]);

  // Sellers to Discover memo (Active Ghanaian merchants with active listings)
  const discoverSellers = useMemo(() => {
    if (!users || users.length === 0 || !products || products.length === 0) return [];

    const sellerListingCount: Record<string, number> = {};
    const sellerActiveProducts: Record<string, Product[]> = {};

    products.forEach((p) => {
      if (!p || (p as any).status === 'hidden' || (p as any).isSold || (p as any).status === 'sold') return;
      const sId = p.sellerId || (p as any).seller_id || (p as any).userId;
      if (!sId) return;

      if (selectedCategory && selectedCategory !== 'All') {
        const pCat = String(p.category || '').toLowerCase().trim();
        const selCat = String(selectedCategory).toLowerCase().trim();
        if (pCat !== selCat && !pCat.includes(selCat) && !selCat.includes(pCat)) return;
      }

      sellerListingCount[sId] = (sellerListingCount[sId] || 0) + 1;
      if (!sellerActiveProducts[sId]) sellerActiveProducts[sId] = [];
      sellerActiveProducts[sId].push(p);
    });

    const activeSellerIds = Object.keys(sellerListingCount);
    if (activeSellerIds.length === 0) return [];

    return activeSellerIds
      .map((id) => {
        const user = users.find((u) => u && (u.id === id || u.uid === id));
        const sellerListings = sellerActiveProducts[id] || [];
        const isVerified = Boolean(
          user?.isVerified ||
          user?.verified ||
          user?.idVerified ||
          user?.badge === 'verified'
        );

        const name = user?.username || user?.displayName || user?.name || 'Verified Merchant';
        const photo = user?.photoUrl || user?.avatar || user?.photoURL || '';
        const location = user?.location || sellerListings[0]?.location || 'Ghana';
        const rating = Number(user?.rating || user?.sellerRating || 4.9);
        const count = sellerListingCount[id] || 0;

        return {
          id,
          name,
          photo,
          location,
          isVerified,
          rating,
          listingCount: count,
          primaryCategory: sellerListings[0]?.category || 'General',
        };
      })
      .filter((s) => s.listingCount > 0)
      .sort((a, b) => {
        if (a.isVerified && !b.isVerified) return -1;
        if (!a.isVerified && b.isVerified) return 1;
        return b.listingCount - a.listingCount;
      })
      .slice(0, 12);
  }, [users, products, selectedCategory]);

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
            key="grid-2-cols"
            numColumns={2}
            columnWrapperStyle={styles.columnWrapper}
            data={displayedProducts}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View>
                {/* Search Container matching Web App "LOOKING FOR SOMETHING?" card */}
                <View style={styles.searchBoxCard}>
                  {/* Social Marketplace Headline Badge */}
                  <View style={styles.socialBadgeRow}>
                    <View style={styles.socialBadgePill}>
                      <View style={styles.socialPulseDot} />
                      <Text style={styles.socialBadgeText}>Ghana's Social Marketplace</Text>
                    </View>
                    <Text style={styles.socialBadgeSub}>Discover • Connect • Shop</Text>
                  </View>

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

                {/* Explore Marketplace Categories Section Header */}
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionHeaderLeft}>
                    <Text style={styles.sectionHeaderIcon}>📈</Text>
                    <Text style={styles.sectionHeaderTitle}>Explore Marketplace Categories</Text>
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

                {/* Category Filter Dropdown (e.g. FILTER PHONES) */}
                {selectedCategory !== 'All' && (
                  <View style={styles.categoryFilterDropdownContainer}>
                    <Pressable
                      style={styles.categoryFilterDropdownHeader}
                      onPress={() => setIsFilterDropdownOpen(!isFilterDropdownOpen)}
                    >
                      <View style={styles.categoryFilterHeaderLeft}>
                        <View style={styles.categoryFilterIconBadge}>
                          <Text style={{ fontSize: 13 }}>⚙️</Text>
                        </View>
                        <Text style={styles.categoryFilterTitle}>
                          FILTER {selectedCategory.toUpperCase()}
                        </Text>
                        {(minPriceFilter || maxPriceFilter || selectedBrandFilter) ? (
                          <View style={styles.activeFilterCountBadge}>
                            <Text style={styles.activeFilterCountText}>Active</Text>
                          </View>
                        ) : null}
                      </View>
                      <View style={styles.categoryFilterHeaderRight}>
                        <View style={[styles.filterTogglePill, isFilterDropdownOpen && styles.filterTogglePillOpen]}>
                          <Text style={[styles.filterTogglePillText, isFilterDropdownOpen && styles.filterTogglePillTextOpen]}>
                            {isFilterDropdownOpen ? 'Hide' : 'Filter'}
                          </Text>
                          <Text style={[styles.filterTogglePillChevron, isFilterDropdownOpen && styles.filterTogglePillChevronOpen]}>
                            {isFilterDropdownOpen ? '▲' : '▼'}
                          </Text>
                        </View>
                      </View>
                    </Pressable>

                    {/* Expandable Body */}
                    {isFilterDropdownOpen && (
                      <View style={styles.categoryFilterBody}>
                        {/* Price Range inputs */}
                        <Text style={styles.filterSectionMiniTitle}>PRICE RANGE (GH₵)</Text>
                        <View style={styles.priceFilterRow}>
                          <TextInput
                            placeholder="Min GH₵"
                            placeholderTextColor="#94a3b8"
                            keyboardType="numeric"
                            value={minPriceFilter}
                            onChangeText={setMinPriceFilter}
                            style={styles.priceInputBox}
                          />
                          <Text style={styles.priceRangeDash}>-</Text>
                          <TextInput
                            placeholder="Max GH₵"
                            placeholderTextColor="#94a3b8"
                            keyboardType="numeric"
                            value={maxPriceFilter}
                            onChangeText={setMaxPriceFilter}
                            style={styles.priceInputBox}
                          />
                        </View>

                        {/* Reset and Apply Row */}
                        <View style={styles.filterActionRow}>
                          {(minPriceFilter || maxPriceFilter || selectedBrandFilter) ? (
                            <Pressable
                              style={styles.filterResetBtn}
                              onPress={() => {
                                setMinPriceFilter('');
                                setMaxPriceFilter('');
                                setSelectedBrandFilter('');
                              }}
                            >
                              <Text style={styles.filterResetBtnText}>Reset</Text>
                            </Pressable>
                          ) : <View />}
                          <Pressable
                            style={styles.filterApplyBtn}
                            onPress={() => setIsFilterDropdownOpen(false)}
                          >
                            <Text style={styles.filterApplyBtnText}>Show Results</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </View>
                )}

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

                {/* Sellers to Discover Section (Active Ghanaian Merchants & Storefronts) */}
                {discoverSellers.length > 0 && !searchText.trim() && (
                  <View style={styles.carouselSection}>
                    <View style={styles.carouselHeaderRow}>
                      <View style={styles.carouselHeaderLeft}>
                        <Text style={styles.carouselIcon}>🏪</Text>
                        <Text style={styles.carouselTitle}>Sellers to Discover</Text>
                        <View style={styles.verifiedCountBadge}>
                          <Text style={styles.verifiedCountBadgeText}>{discoverSellers.length}</Text>
                        </View>
                      </View>
                    </View>
                    <ScrollView
                      horizontal
                      nestedScrollEnabled={true}
                      directionalLockEnabled={true}
                      scrollEventThrottle={16}
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.horizontalCarouselContainer}
                    >
                      {discoverSellers.map((seller) => (
                        <Pressable
                          key={`seller-card-${seller.id}`}
                          onPress={() => navigation?.navigate('SellerProfile', { sellerId: seller.id })}
                          style={styles.sellerDiscoverCard}
                        >
                          <View style={styles.sellerAvatarBox}>
                            {seller.photo ? (
                              <Image source={{ uri: seller.photo }} style={styles.sellerAvatarImg} />
                            ) : (
                              <View style={styles.sellerAvatarFallback}>
                                <Text style={styles.sellerAvatarInitial}>
                                  {seller.name.charAt(0).toUpperCase()}
                                </Text>
                              </View>
                            )}
                            {seller.isVerified && (
                              <View style={styles.sellerCardVerifiedBadge}>
                                <Text style={styles.sellerCardVerifiedCheck}>✓</Text>
                              </View>
                            )}
                          </View>

                          <Text style={styles.sellerCardName} numberOfLines={1}>
                            {seller.name}
                          </Text>

                          <Text style={styles.sellerCardLocation} numberOfLines={1}>
                            📍 {seller.location}
                          </Text>

                          <View style={styles.sellerCardMetaPill}>
                            <Text style={styles.sellerCardMetaCount}>
                              {seller.listingCount} {seller.listingCount === 1 ? 'Ad' : 'Ads'}
                            </Text>
                            <Text style={styles.sellerCardMetaCategory} numberOfLines={1}>
                              • {seller.primaryCategory}
                            </Text>
                          </View>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* Featured Boosted Listings Carousel */}
                {featuredProducts.length > 0 && !searchText.trim() && (
                  <View style={styles.carouselSection}>
                    <View style={styles.carouselHeaderRow}>
                      <View style={styles.carouselHeaderLeft}>
                        <Text style={styles.carouselIcon}>🔥</Text>
                        <Text style={styles.carouselTitle}>Featured Listings</Text>
                      </View>
                    </View>
                    <ScrollView 
                      horizontal 
                      nestedScrollEnabled={true}
                      directionalLockEnabled={true}
                      scrollEventThrottle={16}
                      showsHorizontalScrollIndicator={false} 
                      contentContainerStyle={styles.horizontalCarouselContainer}
                    >
                      {featuredProducts.map((item) => (
                        <View key={`featured-${item.id}`} style={styles.carouselCardItem}>
                          <ProductCard
                            product={item}
                            onPress={() => onOpenProduct(item)}
                            onSellerPress={(sellerId) => navigation?.navigate('SellerProfile', { sellerId })}
                            isSaved={!!savedProducts[item.id]}
                            onToggleSave={handleToggleSave}
                            isFeaturedVariant={true}
                          />
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* Trending Ads Carousel (Top 10 Most Viewed Items) */}
                {trendingProducts.length > 0 && !searchText.trim() && (
                  <View style={styles.carouselSection}>
                    <View style={styles.carouselHeaderRow}>
                      <View style={styles.carouselHeaderLeft}>
                        <Text style={styles.carouselIcon}>📈</Text>
                        <Text style={styles.carouselTitle}>Trending Ads</Text>
                      </View>
                    </View>
                    <ScrollView 
                      horizontal 
                      nestedScrollEnabled={true}
                      directionalLockEnabled={true}
                      scrollEventThrottle={16}
                      showsHorizontalScrollIndicator={false} 
                      contentContainerStyle={styles.horizontalCarouselContainerSmall}
                    >
                      {trendingProducts.map((item) => (
                        <View key={`trending-${item.id}`} style={styles.carouselCardItemSmall}>
                          <ProductCard
                            product={item}
                            onPress={() => onOpenProduct(item)}
                            onSellerPress={(sellerId) => navigation?.navigate('SellerProfile', { sellerId })}
                            isSaved={!!savedProducts[item.id]}
                            onToggleSave={handleToggleSave}
                            isTrendingVariant={true}
                          />
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* Latest Marketplace Deals section */}
                <View style={styles.dealsHeaderRow}>
                  <Text style={styles.dealsTitle}>Latest Marketplace Deals</Text>
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
            renderItem={({ item }) => (
              <ProductCard
                product={item}
                onPress={() => onOpenProduct(item)}
                onSellerPress={(sellerId) => navigation?.navigate('SellerProfile', { sellerId })}
                isSaved={!!savedProducts[item.id]}
                onToggleSave={handleToggleSave}
              />
            )}
            onEndReached={() => {
              if (!isAllCategories && displayedProducts.length < filteredProducts.length) {
                setCategoryDisplayLimit((prev) => prev + 24);
              }
            }}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              !isAllCategories && displayedProducts.length < filteredProducts.length ? (
                <View style={styles.loadMoreContainer}>
                  <Pressable
                    onPress={() => setCategoryDisplayLimit((prev) => prev + 24)}
                    style={styles.loadMoreBtn}
                  >
                    <Text style={styles.loadMoreText}>
                      Load More (+{Math.min(24, filteredProducts.length - displayedProducts.length)} more)
                    </Text>
                  </Pressable>
                </View>
              ) : null
            }
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
  listContent: { paddingHorizontal: 12, paddingTop: 14, paddingBottom: 24 },
  columnWrapper: { justifyContent: 'space-between', paddingHorizontal: 4 },

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

  /* Category Filter Dropdown Card */
  categoryFilterDropdownContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 14,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  categoryFilterDropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
  },
  categoryFilterHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  categoryFilterIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  categoryFilterTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -0.2,
  },
  activeFilterCountBadge: {
    backgroundColor: '#10b981',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    marginLeft: 6,
  },
  activeFilterCountText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  categoryFilterHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterTogglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  filterTogglePillOpen: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
  },
  filterTogglePillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#065f46',
    marginRight: 4,
  },
  filterTogglePillTextOpen: {
    color: '#ffffff',
  },
  filterTogglePillChevron: {
    fontSize: 9,
    color: '#059669',
  },
  filterTogglePillChevronOpen: {
    color: '#34d399',
  },
  categoryFilterBody: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    backgroundColor: '#ffffff',
  },
  filterSectionMiniTitle: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  priceFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  priceInputBox: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    color: '#0f172a',
    fontWeight: '600',
  },
  priceRangeDash: {
    marginHorizontal: 8,
    color: '#94a3b8',
    fontWeight: 'bold',
  },
  filterActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#f8fafc',
  },
  filterResetBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#fee2e2',
  },
  filterResetBtnText: {
    color: '#dc2626',
    fontSize: 11,
    fontWeight: '800',
  },
  filterApplyBtn: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#0f172a',
    marginLeft: 'auto',
  },
  filterApplyBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },

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
  carouselSection: {
    marginBottom: 18,
  },
  carouselHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  carouselHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  carouselIcon: {
    fontSize: 16,
  },
  carouselTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  trendingPill: {
    backgroundColor: '#ffe4e6',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 4,
  },
  trendingPillText: {
    color: '#e11d48',
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  horizontalCarouselContainer: {
    gap: 12,
    paddingRight: 12,
  },
  horizontalCarouselContainerSmall: {
    gap: 10,
    paddingRight: 12,
  },
  carouselCardItem: {
    width: 175,
  },
  carouselCardItemSmall: {
    width: 118,
  },
  loadMoreContainer: {
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadMoreBtn: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  loadMoreText: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '700',
  },
  socialBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 6,
  },
  socialBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 5,
  },
  socialPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  socialBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.2,
  },
  socialBadgeSub: {
    fontSize: 9.5,
    fontWeight: '600',
    color: '#64748b',
  },
  verifiedCountBadge: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  verifiedCountBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
  },
  sellerDiscoverCard: {
    width: 140,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  sellerAvatarBox: {
    position: 'relative',
    marginBottom: 8,
  },
  sellerAvatarImg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#f1f5f9',
  },
  sellerAvatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sellerAvatarInitial: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  sellerCardVerifiedBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#0f172a',
    width: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  sellerCardVerifiedCheck: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '900',
  },
  sellerCardName: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
    width: '100%',
    marginBottom: 2,
  },
  sellerCardLocation: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'center',
    width: '100%',
    marginBottom: 8,
  },
  sellerCardMetaPill: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#f1f5f9',
    gap: 3,
  },
  sellerCardMetaCount: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#0f172a',
  },
  sellerCardMetaCategory: {
    fontSize: 9.5,
    fontWeight: '600',
    color: '#64748b',
    flexShrink: 1,
  },
});
