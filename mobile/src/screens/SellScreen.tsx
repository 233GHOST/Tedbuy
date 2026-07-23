import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { categories } from '../data';
import { auth, createProduct } from '../firebase';

interface SellScreenProps {
  navigation: any;
}

export function SellScreen({ navigation }: SellScreenProps) {
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Phones');
  const [condition, setCondition] = useState('Brand New');
  const [negotiable, setNegotiable] = useState(true);
  const [location, setLocation] = useState('Accra Mall');
  const [imageUrl, setImageUrl] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const formCategories = categories.filter((c) => c !== 'All');
  const conditions = ['Brand New', 'Refurbished', 'Used'];

  const handlePublish = async () => {
    if (!auth.currentUser) {
      Alert.alert('Authentication Required', 'Please sign in or create an account from the Profile tab to publish listings.', [
        { text: 'Go to Profile', onPress: () => navigation.navigate('Profile') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }

    if (!title.trim() || !price.trim() || !description.trim()) {
      Alert.alert('Missing Fields', 'Please fill in the listing title, price, and description.');
      return;
    }

    setLoading(true);
    try {
      const formattedPrice = price.toLowerCase().includes('ghs') || price.toLowerCase().includes('gh₵')
        ? price
        : `GHS ${Number(price.replace(/[^0-9]/g, '')).toLocaleString()}`;

      const defaultImage = imageUrl.trim() || 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80';

      const productData = {
        title: title.trim(),
        price: formattedPrice,
        category: selectedCategory,
        condition: condition,
        negotiable: negotiable,
        location: location.trim(),
        description: description.trim(),
        image: defaultImage,
        images: [defaultImage],
        sellerId: auth.currentUser.uid,
        sellerName: auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Verified Seller',
      };

      await createProduct(productData);
      setLoading(false);
      Alert.alert('Success 🎉', 'Your listing was successfully published on TedBuy Ghana!', [
        {
          text: 'View Feed',
          onPress: () => {
            setTitle('');
            setPrice('');
            setDescription('');
            setImageUrl('');
            navigation.navigate('Home');
          },
        },
      ]);
    } catch (error: any) {
      setLoading(false);
      Alert.alert('Publish Error', error.message || 'Something went wrong while publishing.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Sell Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Post an Ad</Text>
        <Text style={styles.subtitle}>Sell your items to thousands of buyers in Ghana</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
          {!auth.currentUser ? (
            <View style={styles.authLockCard}>
              <Text style={styles.lockEmoji}>🔒</Text>
              <Text style={styles.lockTitle}>Authentication Required</Text>
              <Text style={styles.lockText}>
                You must be logged in to your TedBuy account to create listings. Connect with buyers directly and track your ads.
              </Text>
              <Pressable
                onPress={() => navigation.navigate('Profile')}
                style={styles.authButton}
              >
                <Text style={styles.authButtonText}>SIGN IN / SIGN UP</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.formCard}>
              <Text style={styles.formSectionTitle}>LISTING SPECIFICATIONS</Text>

              {/* Title */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Listing Title</Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="e.g. iPhone 15 Pro Max 256GB"
                  style={styles.input}
                  placeholderTextColor="#94a3b8"
                />
              </View>

              {/* Price */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Price (GHS)</Text>
                <View style={styles.priceInputWrapper}>
                  <Text style={styles.pricePrefix}>GH₵</Text>
                  <TextInput
                    value={price}
                    onChangeText={setPrice}
                    placeholder="e.g. 9500"
                    keyboardType="numeric"
                    style={[styles.input, { flex: 1, borderWidth: 0, paddingLeft: 6, height: 44 }]}
                    placeholderTextColor="#94a3b8"
                  />
                </View>
              </View>

              {/* Category selector */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Category</Text>
                <View style={styles.chipRow}>
                  {formCategories.map((cat) => {
                    const isSelected = selectedCategory === cat;
                    return (
                      <Pressable
                        key={cat}
                        onPress={() => setSelectedCategory(cat)}
                        style={[styles.chip, isSelected && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                          {cat}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Condition */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Item Condition</Text>
                <View style={styles.chipRow}>
                  {conditions.map((cond) => {
                    const isSelected = condition === cond;
                    return (
                      <Pressable
                        key={cond}
                        onPress={() => setCondition(cond)}
                        style={[styles.chip, isSelected && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                          {cond}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Image URL */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Product Image URL (Optional)</Text>
                <TextInput
                  value={imageUrl}
                  onChangeText={setImageUrl}
                  placeholder="https://images.unsplash.com/photo-..."
                  style={styles.input}
                  placeholderTextColor="#94a3b8"
                  autoCapitalize="none"
                />
              </View>

              {/* Location */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Location in Ghana</Text>
                <TextInput
                  value={location}
                  onChangeText={setLocation}
                  placeholder="e.g. East Legon, Accra"
                  style={styles.input}
                  placeholderTextColor="#94a3b8"
                />
              </View>

              {/* Description */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Detailed Description</Text>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Describe your item condition, specifications, and if price is negotiable..."
                  style={[styles.input, styles.textArea]}
                  multiline
                  numberOfLines={4}
                  placeholderTextColor="#94a3b8"
                  textAlignVertical="top"
                />
              </View>

              {/* Publish Button */}
              <Pressable
                onPress={handlePublish}
                disabled={loading}
                style={[styles.publishButton, loading && styles.publishButtonDisabled]}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.publishButtonText}>PUBLISH CLASSIFIED AD</Text>
                )}
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0f172a' },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, backgroundColor: '#0f172a', borderBottomWidth: 1, borderBottomColor: '#020617' },
  title: { color: '#ffffff', fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { color: '#94a3b8', marginTop: 4, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  container: { flex: 1, backgroundColor: '#f8fafc' },
  contentContainer: { padding: 16, paddingBottom: 32 },
  authLockCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    marginTop: 40,
  },
  lockEmoji: { fontSize: 44, marginBottom: 16 },
  lockTitle: { fontSize: 18, fontWeight: '800', color: '#1e293b', marginBottom: 8 },
  lockText: { fontSize: 13.5, color: '#64748b', textAlign: 'center', lineHeight: 20, marginBottom: 20, fontWeight: '500' },
  authButton: {
    backgroundColor: '#ea580c',
    borderRadius: 12,
    height: 48,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#ea580c',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  authButtonText: { color: '#ffffff', fontWeight: '800', fontSize: 13, letterSpacing: 0.8 },
  formCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  formSectionTitle: {
    color: '#ea580c',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 16,
  },
  inputGroup: { marginBottom: 16 },
  label: { color: '#475569', fontSize: 12.5, fontWeight: '700', marginBottom: 6 },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 14,
    color: '#0f172a',
    fontWeight: '500',
  },
  priceInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  pricePrefix: { color: '#0f172a', fontSize: 14, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  chipActive: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
  },
  chipText: { color: '#475569', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#ffffff', fontWeight: '700' },
  textArea: { height: 100, paddingTop: 10, paddingBottom: 10 },
  publishButton: {
    marginTop: 10,
    backgroundColor: '#ea580c',
    borderRadius: 12,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#ea580c',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  publishButtonDisabled: { backgroundColor: '#ffedd5' },
  publishButtonText: { color: '#ffffff', fontWeight: '800', fontSize: 13, letterSpacing: 0.8 },
});
