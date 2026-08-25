import React, { useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { categories } from '../data';
import { auth, createProduct, uploadMediaToCloudinaryMobile } from '../firebase';

interface SellScreenProps {
  navigation: any;
}

const MAX_IMAGES = 10;

interface PickedImage {
  id: string;
  localUri: string;
  status: 'uploading' | 'done' | 'error';
  progress: number;
  remoteUrl?: string;
  error?: string;
}

export function SellScreen({ navigation }: SellScreenProps) {
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Phones');
  const [condition, setCondition] = useState('Brand New');
  const [negotiable, setNegotiable] = useState(true);
  const [isExchangeable, setIsExchangeable] = useState(false);
  const [location, setLocation] = useState('Accra Mall');
  const [images, setImages] = useState<PickedImage[]>([]);
  const [description, setDescription] = useState('');
  const [descHeight, setDescHeight] = useState(100);
  const [loading, setLoading] = useState(false);

  const formCategories = categories.filter((c) => c !== 'All');
  const conditions = ['Brand New', 'Refurbished', 'Used'];

  const updateImage = (id: string, patch: Partial<PickedImage>) => {
    setImages((prev) => prev.map((img) => (img.id === id ? { ...img, ...patch } : img)));
  };

  const uploadPickedImage = async (id: string, localUri: string, base64: string) => {
    updateImage(id, { status: 'uploading', progress: 0, error: undefined });
    try {
      const remoteUrl = await uploadMediaToCloudinaryMobile(
        `data:image/jpeg;base64,${base64}`,
        'image',
        (percent) => updateImage(id, { progress: percent })
      );
      updateImage(id, { status: 'done', progress: 100, remoteUrl });
    } catch (err: any) {
      updateImage(id, { status: 'error', error: err?.message || 'Upload failed' });
    }
  };

  const handlePickImages = async () => {
    const remainingSlots = MAX_IMAGES - images.length;
    if (remainingSlots <= 0) {
      Alert.alert('Limit Reached', `You can only upload up to ${MAX_IMAGES} images per listing.`);
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photo Access Needed',
        'TedBuy needs access to your photos to add pictures to your listing. Please enable photo access in your device Settings.'
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remainingSlots,
      quality: 1,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) return;

    for (const asset of result.assets) {
      const id = `img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      try {
        const manipulated = await ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: 1200 } }],
          { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        );
        setImages((prev) => [
          ...prev,
          { id, localUri: manipulated.uri, status: 'uploading', progress: 0 },
        ]);
        if (manipulated.base64) {
          uploadPickedImage(id, manipulated.uri, manipulated.base64);
        } else {
          updateImage(id, { status: 'error', error: 'Could not process image' });
        }
      } catch (err: any) {
        Alert.alert('Image Error', `Could not process one of the selected photos: ${err?.message || 'Unknown error'}`);
      }
    }
  };

  const handleRemoveImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handleRetryImage = (id: string) => {
    const img = images.find((i) => i.id === id);
    if (!img) return;
    // Re-read the already-compressed local file back to base64 for retry.
    ImageManipulator.manipulateAsync(img.localUri, [], { base64: true, compress: 1 })
      .then((res) => {
        if (res.base64) uploadPickedImage(id, img.localUri, res.base64);
        else updateImage(id, { status: 'error', error: 'Could not re-read image for retry' });
      })
      .catch(() => updateImage(id, { status: 'error', error: 'Could not re-read image for retry' }));
  };

  const handleSetCover = (id: string) => {
    setImages((prev) => {
      const idx = prev.findIndex((img) => img.id === id);
      if (idx <= 0) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.unshift(item);
      return next;
    });
  };

  const handlePublish = async () => {
    if (!auth.currentUser) {
      Alert.alert('Authentication Required', 'Please sign in or create an account from the Profile tab to publish listings.', [
        { text: 'Go to Profile', onPress: () => navigation.navigate('Profile') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }

    if (selectedCategory === 'Jobs & Employment') {
      if (!title.trim() || !description.trim()) {
        Alert.alert('Missing Fields', 'Please fill in the job title and detailed description.');
        return;
      }
    } else {
      if (!title.trim() || !price.trim() || !description.trim()) {
        Alert.alert('Missing Fields', 'Please fill in the listing title, price, and description.');
        return;
      }
    }

    if (images.some((img) => img.status === 'uploading')) {
      Alert.alert('Please Wait', 'Some photos are still uploading. Please wait for them to finish.');
      return;
    }
    if (images.some((img) => img.status === 'error')) {
      Alert.alert('Photo Upload Failed', 'One or more photos failed to upload. Remove them or retry before publishing.');
      return;
    }

    setLoading(true);
    try {
      let formattedPrice = 'Inquire';
      if (selectedCategory !== 'Jobs & Employment') {
        formattedPrice = price.toLowerCase().includes('ghs') || price.toLowerCase().includes('gh₵')
          ? price
          : `GHS ${Number(price.replace(/[^0-9]/g, '')).toLocaleString()}`;
      }

      const uploadedImageUrls = images.map((img) => img.remoteUrl!).filter(Boolean);
      const defaultImage = selectedCategory === 'Jobs & Employment'
        ? 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=900&q=80'
        : 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80';
      const finalImages = uploadedImageUrls.length > 0 ? uploadedImageUrls : [defaultImage];
      const prodId = `prod_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      const productData = {
        id: prodId,
        title: title.trim(),
        price: formattedPrice,
        category: selectedCategory,
        condition: selectedCategory === 'Jobs & Employment' ? 'Job Opening' : condition,
        negotiable: selectedCategory === 'Jobs & Employment' ? false : negotiable,
        isExchangeable: selectedCategory === 'Jobs & Employment' ? false : isExchangeable,
        exchangePossible: selectedCategory === 'Jobs & Employment' ? false : isExchangeable,
        location: location.trim() || 'Accra, Ghana',
        description: description.trim(),
        image: finalImages[0],
        images: finalImages,
        sellerId: auth.currentUser.uid,
        sellerName: auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Verified Seller',
        sellerPhoto: auth.currentUser.photoURL || '',
        sellerJoinDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        createdAt: new Date().toISOString(),
        viewsCount: 0,
        likesCount: 0,
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
            setImages([]);
            setIsExchangeable(false);
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
              <Text style={styles.formSectionTitle}>
                {selectedCategory === 'Jobs & Employment' ? 'JOB VACANCY DETAILS' : 'LISTING SPECIFICATIONS'}
              </Text>

              {/* Category selector first */}
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

              {/* Title */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {selectedCategory === 'Jobs & Employment' ? 'Job Title' : 'Listing Title'}
                </Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder={selectedCategory === 'Jobs & Employment' ? "e.g. Graphic Designer, Store Manager, Sales Executive" : "e.g. iPhone 15 Pro Max 256GB"}
                  style={styles.input}
                  placeholderTextColor="#94a3b8"
                />
              </View>

              {/* Price - Hidden for Jobs & Employment */}
              {selectedCategory !== 'Jobs & Employment' && (
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
              )}

              {/* Condition - Hidden for Jobs & Employment */}
              {selectedCategory !== 'Jobs & Employment' && (
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
              )}

              {/* Exchange Possible Toggle - Hidden for Jobs & Employment */}
              {selectedCategory !== 'Jobs & Employment' && (
                <View style={styles.toggleRowContainer}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={styles.toggleTitle}>Exchange / Swap Possible</Text>
                    <Text style={styles.toggleSubtitle}>Indicate if you accept item trade or exchange</Text>
                  </View>
                  <Switch
                    value={isExchangeable}
                    onValueChange={setIsExchangeable}
                    trackColor={{ false: '#e2e8f0', true: '#10b981' }}
                    thumbColor={isExchangeable ? '#ffffff' : '#f8fafc'}
                  />
                </View>
              )}

              {/* Location in Ghana */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {selectedCategory === 'Jobs & Employment' ? 'Location (Region in Ghana)' : 'Location in Ghana'}
                </Text>
                <TextInput
                  value={location}
                  onChangeText={setLocation}
                  placeholder={selectedCategory === 'Jobs & Employment' ? "e.g. East Legon, Greater Accra or Kumasi, Ashanti" : "e.g. East Legon, Accra"}
                  style={styles.input}
                  placeholderTextColor="#94a3b8"
                />
              </View>

              {/* Description */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {selectedCategory === 'Jobs & Employment' ? 'Detailed Job Description & Requirements' : 'Detailed Description'}
                </Text>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  onContentSizeChange={(e) => {
                    const nextH = Math.max(100, e.nativeEvent.contentSize.height);
                    setDescHeight(nextH);
                  }}
                  placeholder={selectedCategory === 'Jobs & Employment' ? "Describe job responsibilities, candidate requirements, work schedule, compensation, and how to apply..." : "Describe your item condition, specifications, and if price is negotiable..."}
                  style={[styles.input, styles.textArea, { height: Math.max(100, descHeight) }]}
                  multiline
                  numberOfLines={4}
                  scrollEnabled={false}
                  placeholderTextColor="#94a3b8"
                  textAlignVertical="top"
                />
              </View>

              {/* Photos */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {selectedCategory === 'Jobs & Employment' ? 'Company Logo / Job Flyer Photos (Optional)' : 'Product Photos (Optional)'}
                </Text>
                <Text style={styles.photoHint}>
                  The first photo is your cover image. Tap any other photo to make it the cover. Up to {MAX_IMAGES} photos.
                </Text>
                <View style={styles.photoGrid}>
                  {images.map((img, idx) => (
                    <Pressable
                      key={img.id}
                      onPress={() => img.status === 'done' && idx !== 0 && handleSetCover(img.id)}
                      style={styles.photoThumbWrapper}
                    >
                      <Image source={{ uri: img.localUri }} style={styles.photoThumb} />
                      {idx === 0 && (
                        <View style={styles.coverBadge}>
                          <Text style={styles.coverBadgeText}>COVER</Text>
                        </View>
                      )}
                      {img.status === 'uploading' && (
                        <View style={styles.photoOverlay}>
                          <ActivityIndicator size="small" color="#ffffff" />
                          <Text style={styles.photoOverlayText}>{img.progress}%</Text>
                        </View>
                      )}
                      {img.status === 'error' && (
                        <View style={[styles.photoOverlay, styles.photoOverlayError]}>
                          <Text style={styles.photoOverlayText}>Failed</Text>
                          <Pressable onPress={() => handleRetryImage(img.id)} style={styles.retryBtn}>
                            <Text style={styles.retryBtnText}>Retry</Text>
                          </Pressable>
                        </View>
                      )}
                      <Pressable onPress={() => handleRemoveImage(img.id)} style={styles.removePhotoBtn} hitSlop={6}>
                        <Text style={styles.removePhotoBtnText}>✕</Text>
                      </Pressable>
                    </Pressable>
                  ))}
                  {images.length < MAX_IMAGES && (
                    <Pressable onPress={handlePickImages} style={styles.addPhotoBtn}>
                      <Text style={styles.addPhotoBtnIcon}>+</Text>
                      <Text style={styles.addPhotoBtnText}>Add Photo</Text>
                    </Pressable>
                  )}
                </View>
              </View>

              {/* Publish Button */}
              <Pressable
                onPress={handlePublish}
                disabled={loading || images.some((img) => img.status === 'uploading')}
                style={[styles.publishButton, (loading || images.some((img) => img.status === 'uploading')) && styles.publishButtonDisabled]}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.publishButtonText}>
                    {images.some((img) => img.status === 'uploading')
                      ? 'UPLOADING PHOTOS...'
                      : selectedCategory === 'Jobs & Employment' ? 'POST JOB VACANCY' : 'PUBLISH CLASSIFIED AD'}
                  </Text>
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
  toggleRowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  toggleTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 2,
  },
  toggleSubtitle: {
    fontSize: 11,
    color: '#64748b',
    lineHeight: 14,
  },
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

  photoHint: { fontSize: 11, color: '#94a3b8', marginBottom: 10, marginTop: -2, lineHeight: 15 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoThumbWrapper: {
    width: 84,
    height: 84,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    position: 'relative',
  },
  photoThumb: { width: '100%', height: '100%', resizeMode: 'cover' },
  coverBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: '#0f172a',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  coverBadgeText: { color: '#ffffff', fontSize: 8, fontWeight: '900', letterSpacing: 0.3 },
  photoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  photoOverlayError: { backgroundColor: 'rgba(220, 38, 38, 0.75)' },
  photoOverlayText: { color: '#ffffff', fontSize: 10, fontWeight: '800' },
  retryBtn: { backgroundColor: '#ffffff', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginTop: 2 },
  retryBtnText: { color: '#dc2626', fontSize: 10, fontWeight: '800' },
  removePhotoBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removePhotoBtnText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  addPhotoBtn: {
    width: 84,
    height: 84,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  addPhotoBtnIcon: { fontSize: 22, color: '#64748b', fontWeight: '300' },
  addPhotoBtnText: { fontSize: 9.5, color: '#64748b', fontWeight: '700', marginTop: 2 },
});
