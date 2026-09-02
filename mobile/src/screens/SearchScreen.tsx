import React, { useState, useMemo } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { categories, products as sampleProducts } from '../data';
import { getPrefixAutocompleteSuggestions } from '../../src/utils/searchAutocomplete';

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
  'Laptops & Computers': '💻',
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
  'Laptops & Computers': 'MacBooks, Windows laptops, desktop PCs, parts',
  Laptops: 'MacBooks, Windows laptops, desktop PCs, parts',
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
  const [searchText, setSearchText] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([
    'iPhone 14',
    'MacBook',
    'Sneakers',
  ]);

  const trimmedQuery = searchText.trim().toLowerCase();

  const handleSearchSubmit = (queryToUse?: string) => {
    const finalQuery = (queryToUse !== undefined ? queryToUse : searchText).trim();
    if (!finalQuery) return;

    // Add to recents
    setRecentSearches((prev) => {
      const filtered = prev.filter((item) => item.toLowerCase() !== finalQuery.toLowerCase());
      return [finalQuery, ...filtered].slice(0, 6);
    });

    // Navigate back to Home with the query applied
    navigation.navigate('Home', { screen: 'HomeMain', params: { search: finalQuery } });
  };

  const handleSelectCategory = (cat: string) => {
    navigation.navigate('Home', { screen: 'HomeMain', params: { category: cat } });
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

  // Filter matching prefix autocomplete suggestions
  const matchingKeywords = useMemo(() => {
    const rawSuggestions = getPrefixAutocompleteSuggestions(searchText, sampleProducts as any, {
      limit: 6,
      popularKeywords: POPULAR_KEYWORDS
    });
    return rawSuggestions.map(s => s.text);
  }, [searchText, sampleProducts]);

  // Filter matching sample/live products
  const matchingProducts = useMemo(() => {
    if (!trimmedQuery) return [];
    return sampleProducts
      .filter(
        (p) =>
          p.title.toLowerCase().includes(trimmedQuery) ||
          p.category.toLowerCase().includes(trimmedQuery) ||
          p.description.toLowerCase().includes(trimmedQuery)
      )
      .slice(0, 3);
  }, [trimmedQuery]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Search Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Search Listings</Text>
        <Text style={styles.subtitle}>Find verified deals across Ghana instantly</Text>
      </View>

      <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
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

        {/* 1. Live Matching Categories Suggestion */}
        {matchingCategories.length > 0 && (
          <View style={styles.suggestionBlock}>
            <Text style={styles.subSectionTitle}>MATCHING CATEGORIES</Text>
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
            </View>
          </View>
        )}

        {/* 2. Keyword / Auto-complete suggestions */}
        {matchingKeywords.length > 0 && (
          <View style={styles.suggestionBlock}>
            <Text style={styles.subSectionTitle}>
              {trimmedQuery ? 'SEARCH SUGGESTIONS' : 'TRENDING SEARCHES'}
            </Text>
            <View style={styles.tagWrap}>
              {matchingKeywords.map((kw) => (
                <Pressable
                  key={kw}
                  onPress={() => {
                    setSearchText(kw);
                    handleSearchSubmit(kw);
                  }}
                  style={styles.keywordChip}
                >
                  <Text style={styles.keywordChipText}>🔍 {kw}</Text>
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
  title: { color: '#ffffff', fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { color: '#94a3b8', marginTop: 4, fontSize: 13, lineHeight: 18, fontWeight: '500' },
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
    height: 48,
  },
  searchEmoji: { fontSize: 16, marginRight: 8, color: '#64748b' },
  input: { flex: 1, fontSize: 14, color: '#0f172a', fontWeight: '500' },
  clearBtn: { padding: 6 },
  clearBtnText: { color: '#94a3b8', fontSize: 13, fontWeight: '800' },
  searchButton: {
    marginTop: 14,
    backgroundColor: '#ea580c',
    borderRadius: 12,
    height: 46,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#ea580c',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  searchButtonText: { color: '#ffffff', fontWeight: '800', fontSize: 13, letterSpacing: 0.8 },
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
    fontWeight: '900',
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
  catSuggestionText: { color: '#c2410c', fontSize: 12, fontWeight: '700' },
  chipArrow: { color: '#c2410c', fontSize: 10, fontWeight: '900' },
  keywordChip: {
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  keywordChipText: { color: '#0f172a', fontSize: 13, fontWeight: '800' },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  clearAllText: {
    color: '#e11d48',
    fontSize: 11,
    fontWeight: '700',
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
    fontWeight: '700',
  },
  removeRecentBtn: {
    padding: 4,
  },
  removeRecentText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '900',
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
    fontWeight: '800',
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
    fontWeight: '900',
  },
  productCategory: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '500',
  },
  productLocation: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '500',
  },
  viewBadge: {
    color: '#ea580c',
    fontSize: 10,
    fontWeight: '800',
    backgroundColor: '#ffedd5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  sectionTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
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
  categoryName: { color: '#1e293b', fontSize: 14, fontWeight: '800' },
  categoryDesc: { color: '#64748b', fontSize: 11, marginTop: 2, fontWeight: '500' },
  chevron: { color: '#cbd5e1', fontSize: 14, fontWeight: '900' },
});
