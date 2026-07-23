import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { categories } from '../data';

interface SearchScreenProps {
  navigation: any;
}

const categoryIcons: Record<string, string> = {
  All: '🌐',
  Phones: '📱',
  Laptops: '💻',
  Fashion: '👟',
  'Home Appliances': '📺',
  Vehicles: '🚗',
  Property: '🏠',
  'Beauty and Care': '✨',
  Games: '🎮',
  Electronics: '⚡',
  Services: '🛠️',
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
  'Beauty and Care': 'Skincare, makeup, perfume, hair',
  Games: 'PlayStation, Xbox, Nintendo, FIFA',
  Electronics: 'TVs, audio speakers, cameras',
  Services: 'Artisans, repair, freelance work',
  Other: 'Miscellaneous items & equipment',
};

export function SearchScreen({ navigation }: SearchScreenProps) {
  const [searchText, setSearchText] = useState('');

  const handleSearchSubmit = () => {
    // Navigate back to Home with the query applied
    navigation.navigate('Home', { screen: 'HomeMain', params: { search: searchText } });
  };

  const handleSelectCategory = (cat: string) => {
    // Navigate to Home with the category selected
    navigation.navigate('Home', { screen: 'HomeMain', params: { category: cat } });
  };

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
              onSubmitEditing={handleSearchSubmit}
              placeholder="Search phones, laptops, sneakers..."
              style={styles.input}
              placeholderTextColor="#64748b"
              returnKeyType="search"
            />
          </View>
          <Pressable onPress={handleSearchSubmit} style={styles.searchButton}>
            <Text style={styles.searchButtonText}>SEARCH NOW</Text>
          </Pressable>
        </View>

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
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, backgroundColor: '#0f172a', borderBottomWidth: 1, borderBottomColor: '#020617' },
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
    marginBottom: 20,
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
