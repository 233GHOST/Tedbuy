import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MapPin, Building2, Sparkles, Search as SearchIcon } from 'lucide-react-native';
import { categories } from '../data';
import { watchProducts, fetchSearchSuggestions } from '../firebase';
import { Product } from '../types';
import { getPrefixAutocompleteSuggestions, AutocompleteSuggestion } from '../utils/searchAutocomplete';
import { fonts } from '../theme';
import { TAB_BAR_HEIGHT, useTabBarVisibility } from '../context/TabBarVisibility';

const RECENT_SEARCHES_KEY = 'tedbuy_recent_searches';

// Matches web's SearchSuggestions.tsx GHANA_CITIES exactly (same 14 cities,
// same order) — was entirely absent on mobile, so typing "acc" never
// surfaced an "in Location: Accra" quick filter the way web does.
const GHANA_CITIES = [
  'Accra', 'Kumasi', 'Takoradi', 'Tamale', 'Tema', 'Cape Coast', 'Sunyani',
  'Koforidua', 'East Legon', 'Spintex', 'Madina', 'Osu', 'Airport Residential', 'Dansoman',
];

interface SearchScreenProps {
  navigation: any;
}

const POPULAR_KEYWORDS = [
  'iPhone 15 Pro Max',
  'HP EliteBook Laptop',
  'MacBook Air M2',
  'Samsung Galaxy S24',
  'PlayStation 5 Console',
  'Toyota Corolla',
  'Nike Air Force 1',
  'Hisense 55" 4K Smart TV',
  'Apple AirPods Pro',
  'Honda Civic',
  'Office Chair',
  'Double Door Fridge',
  'Dell Laptop',
  'iPad'
];

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

const categoryDescriptions: Record<string, string> = {
  All: 'Explore everything on TedBuy',
  Phones: 'iPhones, Android, accessories',
  Laptops: 'MacBooks, Windows laptops, parts',
  Fashion: 'Sneakers, apparel, watches, bags',
  'Home Appliances': 'Refrigerators, microwaves, ACs',
  Vehicles: 'Cars, motorcycles, vehicle parts',
  Property: 'Houses, land, apartments for rent/sale',
  'Furniture & Home': 'Sofas, beds, tables, decor, office furniture',
  'Beauty and Care': 'Skincare, makeup, perfume, hair',
  Games: 'PlayStation, Xbox, Nintendo, FIFA',
  Electronics: 'TVs, audio speakers, cameras',
  Services: 'Artisans, repair, freelance work',
  'Jobs & Employment': 'Full-time, remote, admin, IT, trades',
  'Agriculture & Food': 'Crops, livestock, seeds, farm machinery',
  'Pets & Animals': 'Dogs, puppies, birds, pet food, supplies',
  'Sports & Fitness': 'Gym equipment, bicycles, sportswear',
  'Kids & Baby': 'Baby clothing, strollers, toys, cribs',
  'Commercial & Tools': 'Power tools, generators, industrial equipment',
  'Books & Hobbies': 'Textbooks, novels, instruments, crafts',
  Other: 'Miscellaneous items & equipment',
};

export function SearchScreen({ navigation }: SearchScreenProps) {
  const insets = useSafeAreaInsets();
  const [searchText, setSearchText] = useState('');
  // Was hardcoded fake data ('iPhone 14', 'MacBook', 'Sneakers') that reset
  // to those same three terms on every app restart — never actually
  // reflected what the user searched. Now backed by AsyncStorage, matching
  // web's real recent-searches persistence (src/context/AppContext.tsx).
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  // Server-backed suggestions (150ms debounce, matches web) — queries the
  // full server-side catalog via /api/search/suggestions, not just whatever
  // bounded page of products is already loaded on-device.
  const [serverSuggestions, setServerSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against a race where an earlier, slower request resolves after a
  // newer one and overwrites its fresher results — e.g. typing "h" then
  // quickly "hyun", with the "h" response arriving late over a slow network.
  const suggestionRequestIdRef = useRef(0);

  // The bottom tab bar is a single shared Animated.Value across every tab
  // (TabBarVisibility.tsx) — if it was hidden from another tab (e.g. an open
  // chat conversation calls hideTabBar()) and the user then switches to
  // Search, it stayed hidden forever since this screen never reset it,
  // silently blocking all further tab navigation from here. Every tab screen
  // must reset it on focus so switching tabs always guarantees a visible bar.
  const { resetTabBar } = useTabBarVisibility();
  useEffect(() => {
    resetTabBar();
    const unsub = navigation?.addListener?.('focus', resetTabBar);
    return unsub;
  }, [navigation, resetTabBar]);

  useEffect(() => {
    AsyncStorage.getItem(RECENT_SEARCHES_KEY).then((saved) => {
      if (saved) {
        try {
          setRecentSearches(JSON.parse(saved));
        } catch {
          // ignore corrupt storage
        }
      }
    });
    const unsub = watchProducts((result) => setProducts(result as Product[]));
    return unsub;
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recentSearches)).catch(() => {});
  }, [recentSearches]);

  const trimmedQuery = searchText.trim().toLowerCase();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!trimmedQuery) {
      // A newly-empty query always wins immediately — bump the request id so
      // any suggestion request already in flight is discarded when it lands.
      suggestionRequestIdRef.current += 1;
      setServerSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      const requestId = ++suggestionRequestIdRef.current;
      fetchSearchSuggestions(searchText, 8).then((results) => {
        // A newer keystroke may have already started its own request — only
        // apply this response if it's still the most recent one in flight.
        if (requestId === suggestionRequestIdRef.current) setServerSuggestions(results);
      });
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [trimmedQuery, searchText]);

  const handleSearchSubmit = (queryToUse?: string) => {
    const finalQuery = (queryToUse !== undefined ? queryToUse : searchText).trim();
    if (!finalQuery) return;

    // Add to recents
    setRecentSearches((prev) => {
      const filtered = prev.filter((item) => item.toLowerCase() !== finalQuery.toLowerCase());
      return [finalQuery, ...filtered].slice(0, 6);
    });

    // Navigate back to Home with the query applied
    navigation.navigate('Home', { search: finalQuery });
  };

  const handleSelectCategory = (cat: string) => {
    navigation.navigate('Home', { category: cat });
  };

  const handleSelectLocation = (city: string) => {
    navigation.navigate('Home', { location: city });
  };

  const handleSelectProduct = (productId: string) => {
    navigation.navigate('ProductDetail', { productId });
  };

  const handleRemoveRecent = (term: string) => {
    setRecentSearches((prev) => prev.filter((t) => t !== term));
  };

  // Filter matching categories
  const matchingCategories = useMemo(() => {
    if (!trimmedQuery) return [];
    return categories
      .filter((cat) => cat !== 'All' && (cat.toLowerCase().startsWith(trimmedQuery) || cat.toLowerCase().includes(trimmedQuery)))
      .sort((a, b) => {
        const aPrefix = a.toLowerCase().startsWith(trimmedQuery) ? 1 : 0;
        const bPrefix = b.toLowerCase().startsWith(trimmedQuery) ? 1 : 0;
        return bPrefix - aPrefix;
      })
      .slice(0, 3);
  }, [trimmedQuery]);

  // Matches web's GHANA_CITIES quick-filter chips (SearchSuggestions.tsx) —
  // ≥2 chars typed, prefix-then-contains, top 2.
  const matchingLocations = useMemo(() => {
    if (!trimmedQuery || trimmedQuery.length < 2) return [];
    return GHANA_CITIES.filter(
      (city) => city.toLowerCase().startsWith(trimmedQuery) || city.toLowerCase().includes(trimmedQuery)
    ).slice(0, 2);
  }, [trimmedQuery]);

  // Filter matching prefix autocomplete suggestions — was matched against
  // hardcoded fake sample products (fictional sellers, stock photos), so
  // autocomplete could suggest terms for items that were never actually for
  // sale, or miss real listings entirely. Now matched against live products,
  // merged with server-backed suggestions covering the full catalog (not
  // just this device's bounded product page), and keeps each suggestion's
  // `type` (brand/trending/title/phrase) instead of discarding it — matches
  // web's local-priority dedup-by-lowercased-text merge exactly.
  const matchingKeywords = useMemo<AutocompleteSuggestion[]>(() => {
    // "Trending Searches" (the popular-keyword chip list shown before the
    // user has typed anything) was removed per explicit request — this now
    // only ever surfaces live SEARCH SUGGESTIONS once the user has actually
    // typed a query, never a default/idle-state chip list.
    if (!searchText.trim()) return [];
    const local = getPrefixAutocompleteSuggestions(searchText, products as any, {
      limit: 8,
      popularKeywords: POPULAR_KEYWORDS
    });
    const seen = new Set<string>();
    const merged: AutocompleteSuggestion[] = [];
    for (const s of local) {
      const key = s.text.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(s);
      }
    }
    for (const s of serverSuggestions) {
      const key = s.text.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(s);
      }
    }
    return merged.slice(0, 8);
  }, [searchText, products, serverSuggestions]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Search Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Search Listings</Text>
        <Text style={styles.subtitle}>Find verified deals across Ghana instantly</Text>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT + insets.bottom }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Search Input Container */}
        <View style={styles.searchBoxCard}>
          <Text style={styles.searchLabel}>WHAT ARE YOU LOOKING FOR?</Text>
          <View style={styles.searchRow}>
            <Text style={styles.searchEmoji}>🔍</Text>
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              onSubmitEditing={() => handleSearchSubmit()}
              placeholder="Search phones, laptops, sneakers..."
              style={styles.input}
              placeholderTextColor="#64748b"
              returnKeyType="search"
            />
            {searchText.length > 0 && (
              <Pressable onPress={() => setSearchText('')} style={styles.clearBtn} hitSlop={8}>
                <Text style={styles.clearBtnText}>✕</Text>
              </Pressable>
            )}
          </View>
          <Pressable onPress={() => handleSearchSubmit()} style={styles.searchButton}>
            <Text style={styles.searchButtonText}>SEARCH NOW</Text>
          </Pressable>
        </View>

        {/* 1. Live Matching Categories + Locations Suggestion */}
        {(matchingCategories.length > 0 || matchingLocations.length > 0) && (
          <View style={styles.suggestionBlock}>
            <Text style={styles.subSectionTitle}>FILTER BY CATEGORY OR LOCATION</Text>
            <View style={styles.tagWrap}>
              {matchingCategories.map((cat) => (
                <Pressable
                  key={cat}
                  onPress={() => handleSelectCategory(cat)}
                  style={styles.catSuggestionChip}
                >
                  <Text style={styles.chipEmoji}>{categoryIcons[cat] || '📦'}</Text>
                  <Text style={styles.catSuggestionText}>Category: {cat}</Text>
                  <Text style={styles.chipArrow}>➔</Text>
                </Pressable>
              ))}
              {matchingLocations.map((city) => (
                <Pressable
                  key={city}
                  onPress={() => handleSelectLocation(city)}
                  style={styles.locSuggestionChip}
                >
                  <MapPin size={13} color="#059669" />
                  <Text style={styles.locSuggestionText}>Location: {city}</Text>
                  <Text style={styles.chipArrowGreen}>➔</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* 2. Keyword / Auto-complete suggestions */}
        {matchingKeywords.length > 0 && (
          <View style={styles.suggestionBlock}>
            <Text style={styles.subSectionTitle}>
              SEARCH SUGGESTIONS
            </Text>
            <View style={styles.tagWrap}>
              {matchingKeywords.map((item, idx) => (
                <Pressable
                  key={`${item.text}-${idx}`}
                  onPress={() => {
                    setSearchText(item.text);
                    handleSearchSubmit(item.text);
                  }}
                  style={styles.keywordChip}
                >
                  {item.type === 'brand' ? (
                    <Building2 size={13} color="#334155" />
                  ) : item.type === 'trending' ? (
                    <Sparkles size={13} color="#d97706" />
                  ) : (
                    <SearchIcon size={13} color="#334155" />
                  )}
                  <Text style={styles.keywordChipText}>{item.text}</Text>
                  {item.type === 'brand' && (
                    <View style={styles.brandBadge}>
                      <Text style={styles.brandBadgeText}>BRAND</Text>
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* 4. Recent Searches */}
        {recentSearches.length > 0 && (
          <View style={styles.suggestionBlock}>
            <View style={styles.recentHeader}>
              <Text style={styles.subSectionTitle}>RECENT SEARCHES</Text>
              <Pressable onPress={() => setRecentSearches([])} hitSlop={8}>
                <Text style={styles.clearAllText}>Clear</Text>
              </Pressable>
            </View>
            <View style={styles.tagWrap}>
              {recentSearches.map((term) => (
                <View key={term} style={styles.recentChip}>
                  <Pressable
                    onPress={() => {
                      setSearchText(term);
                      handleSearchSubmit(term);
                    }}
                    style={styles.recentChipMain}
                  >
                    <Text style={styles.recentChipText}>🕒 {term}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleRemoveRecent(term)}
                    style={styles.removeRecentBtn}
                    hitSlop={6}
                  >
                    <Text style={styles.removeRecentText}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Categories Grid Label */}
        <Text style={styles.sectionTitle}>Browse Categories</Text>

        <View style={styles.grid}>
          {categories.map((cat) => (
            <Pressable
              key={cat}
              onPress={() => handleSelectCategory(cat)}
              style={styles.gridCard}
            >
              <View style={styles.iconContainer}>
                <Text style={styles.gridIcon}>{categoryIcons[cat] || '📦'}</Text>
              </View>
              <View style={styles.cardContent}>
                <Text style={styles.categoryName}>
                  {cat === 'All' ? 'All Categories' : cat}
                </Text>
                <Text style={styles.categoryDesc} numberOfLines={1}>
                  {categoryDescriptions[cat] || 'Other items and parts'}
                </Text>
              </View>
              <Text style={styles.chevron}>➔</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0f172a' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: '#020617',
  },
  title: { color: '#ffffff', fontSize: 24, fontFamily: fonts.extrabold, letterSpacing: -0.5 },
  subtitle: { color: '#94a3b8', marginTop: 4, fontSize: 13, lineHeight: 18, fontFamily: fonts.medium },
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
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
    marginBottom: 16,
  },
  searchLabel: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: fonts.extrabold,
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
    height: 48,
  },
  searchEmoji: { fontSize: 16, marginRight: 8, color: '#64748b' },
  input: { flex: 1, fontSize: 14, color: '#0f172a', fontFamily: fonts.medium },
  clearBtn: { padding: 6 },
  clearBtnText: { color: '#94a3b8', fontSize: 13, fontFamily: fonts.extrabold },
  searchButton: {
    marginTop: 14,
    backgroundColor: '#0f172a',
    borderRadius: 12,
    height: 46,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  searchButtonText: { color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 13, letterSpacing: 0.8 },
  suggestionBlock: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  subSectionTitle: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: fonts.extrabold,
    letterSpacing: 1,
    marginBottom: 10,
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  catSuggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffedd5',
    borderWidth: 1,
    borderColor: '#fed7aa',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
  },
  chipEmoji: { fontSize: 14 },
  catSuggestionText: { color: '#c2410c', fontSize: 12, fontFamily: fonts.bold },
  chipArrow: { color: '#c2410c', fontSize: 10, fontFamily: fonts.extrabold },
  locSuggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
  },
  locSuggestionText: { color: '#059669', fontSize: 12, fontFamily: fonts.bold },
  chipArrowGreen: { color: '#059669', fontSize: 10, fontFamily: fonts.extrabold },
  keywordChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  keywordChipText: { color: '#0f172a', fontSize: 13, fontFamily: fonts.extrabold },
  brandBadge: {
    backgroundColor: '#e2e8f0',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 2,
  },
  brandBadgeText: { color: '#0f172a', fontSize: 8, fontFamily: fonts.extrabold, letterSpacing: 0.5 },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  clearAllText: {
    color: '#e11d48',
    fontSize: 11,
    fontFamily: fonts.bold,
    marginBottom: 10,
  },
  recentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 4,
  },
  recentChipMain: {
    paddingRight: 6,
  },
  recentChipText: {
    color: '#1e293b',
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  removeRecentBtn: {
    padding: 4,
  },
  removeRecentText: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: fonts.extrabold,
  },
  productList: {
    gap: 8,
  },
  productSuggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  productThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
  },
  productInfo: {
    flex: 1,
    marginLeft: 10,
    marginRight: 6,
  },
  productTitle: {
    color: '#0f172a',
    fontSize: 13,
    fontFamily: fonts.extrabold,
  },
  productMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  productPrice: {
    color: '#0f172a',
    fontSize: 11,
    fontFamily: fonts.extrabold,
  },
  productCategory: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: fonts.medium,
  },
  productLocation: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: fonts.medium,
  },
  viewBadge: {
    color: '#0f172a',
    fontSize: 10,
    fontFamily: fonts.extrabold,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  sectionTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontFamily: fonts.extrabold,
    letterSpacing: -0.3,
    marginBottom: 12,
    marginLeft: 4,
  },
  grid: { gap: 10 },
  gridCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.02,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#ffedd5',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  gridIcon: { fontSize: 20 },
  cardContent: { flex: 1, marginLeft: 12, marginRight: 8 },
  categoryName: { color: '#1e293b', fontSize: 14, fontFamily: fonts.extrabold },
  categoryDesc: { color: '#64748b', fontSize: 11, marginTop: 2, fontFamily: fonts.medium },
  chevron: { color: '#cbd5e1', fontSize: 14, fontFamily: fonts.extrabold },
});
