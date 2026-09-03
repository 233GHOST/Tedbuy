import React, { useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, Platform, Alert, ActivityIndicator } from 'react-native';
import { Heart, Check } from 'lucide-react-native';
import { Product } from '../types';
import { auth, updateProduct } from '../firebase';
import { fonts } from '../theme';
import { formatProductPrice } from '../utils/formatPrice';
import { resolveProductImageUri } from '../utils/productImage';
import { CategoryImagePlaceholder } from './CategoryImagePlaceholder';
import { useSavedProducts } from '../context/SavedProducts';

interface ProductCardProps {
  product: Product;
  onPress?: () => void;
  onToggleSave?: (productId: string) => void;
  onSellerPress?: (sellerId: string) => void;
  isSaved?: boolean;
  isFeaturedVariant?: boolean;
  isTrendingVariant?: boolean;
}

export function ProductCard({
  product,
  onPress,
  onToggleSave,
  onSellerPress,
  isSaved: propIsSaved,
  isFeaturedVariant,
  isTrendingVariant,
}: ProductCardProps) {
  const [loaded, setLoaded] = useState(false);
  const [isLiking, setIsLiking] = useState(false);
  const [updatingSold, setUpdatingSold] = useState(false);

  const currentUser = auth.currentUser;
  const isAdminOrSeller = !!(currentUser && (product.sellerId === currentUser.uid));

  // Real bookmark status — reads the current user's own savedProductIds via
  // the shared SavedProducts context (see context/SavedProducts.tsx and
  // firebase.ts's toggleSaveProductRemote for why this replaced the
  // likedUserIds-based bug that 403'd on any non-owned listing).
  const { isSaved: isSavedInContext, toggleSaved } = useSavedProducts();
  const localIsSaved = propIsSaved !== undefined ? propIsSaved : isSavedInContext(product.id);

  // Robust date format
  const parseDate = (dateVal: any): Date | null => {
    if (!dateVal) return null;
    if (dateVal instanceof Date) return dateVal;
    if (typeof dateVal.toDate === 'function') {
      try {
        return dateVal.toDate();
      } catch (_) {}
    }
    if (typeof dateVal === 'object') {
      if (typeof dateVal.seconds === 'number') {
        return new Date(dateVal.seconds * 1000);
      }
      if (typeof dateVal._seconds === 'number') {
        return new Date(dateVal._seconds * 1000);
      }
    }
    const d = new Date(dateVal);
    if (!isNaN(d.getTime())) {
      return d;
    }
    return null;
  };

  // Active premium boost check matching web isBoostActive logic
  const isBoostActive = (): boolean => {
    const boostStatus = (product as any).boostStatus;
    const boostEndDate = (product as any).boostEndDate;
    if (!boostStatus) return false;
    const endDate = parseDate(boostEndDate);
    if (!endDate) return false;
    return endDate.getTime() > Date.now();
  };

  const formattedPrice = formatProductPrice(product.price);
  const isServiceCategory = product.category ? (product.category.toLowerCase() === 'services' || product.category.toLowerCase().includes('service')) : false;
  const isPrioSeller = isBoostActive() && !isFeaturedVariant;
  const hasVideoAd = product.videos && product.videos.length > 0;

  // Handles bookmark/save click
  const handleSaveClick = async () => {
    if (!currentUser) {
      Alert.alert(
        'Authentication Required',
        'Your bookmarks are synchronized across mobile & web. Please go to the Profile tab to sign in and save deals.'
      );
      return;
    }

    if (onToggleSave) {
      onToggleSave(product.id);
      return;
    }

    try {
      setIsLiking(true);
      await toggleSaved(product.id);
    } catch (err: any) {
      Alert.alert('Bookmark Failed', err.message || 'Could not update favorites.');
    } finally {
      setIsLiking(false);
    }
  };

  // Handles "Mark as Sold" toggle
  const handleSoldToggle = async () => {
    if (updatingSold) return;
    const nextSoldState = !(product as any).isSold;
    try {
      setUpdatingSold(true);
      await updateProduct(product.id, { isSold: nextSoldState });
      Alert.alert(
        nextSoldState ? 'Listing Sold! 🎉' : 'Listing Restored',
        nextSoldState 
          ? `"${product.title}" has been successfully marked as sold.`
          : `"${product.title}" is now active in the classified feed again.`
      );
    } catch (err: any) {
      Alert.alert('Update Failed', err.message || 'Could not update listing status.');
    } finally {
      setUpdatingSold(false);
    }
  };

  // Real photo or video-poster only — never an unrelated stock photo. See
  // utils/productImage.ts.
  const coverImageUrl = resolveProductImageUri(product);

  return (
    <Pressable style={styles.cardContainer} onPress={onPress}>
      {/* 1. Image cover section with 1:1 Aspect Ratio */}
      <View style={styles.imageContainer}>
        {/* Main Product Image — an honest category placeholder when there's
            no real photo/video-poster, never a random stock photo. */}
        {coverImageUrl ? (
          <Image
            source={{ uri: coverImageUrl }}
            style={styles.coverImage}
            onLoadStart={() => setLoaded(false)}
            onLoadEnd={() => setLoaded(true)}
          />
        ) : (
          <CategoryImagePlaceholder category={product.category} style={styles.coverImage} iconSize={30} />
        )}

        {/* Loading Spinner Overlays */}
        {coverImageUrl && !loaded && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="small" color="#0f172a" />
          </View>
        )}

        {/* Top-Left Status Tags Row */}
        <View style={styles.tagsContainer}>
          {isPrioSeller && !isTrendingVariant && (
            <View style={styles.prioTag}>
              <Text style={styles.prioTagText}>🔥 Active Seller</Text>
            </View>
          )}
          {(product as any).isSold && (
            <View style={styles.soldTag}>
              <Text style={styles.soldTagText}>SOLD</Text>
            </View>
          )}
        </View>

        {/* Top-Right Condition Tag */}
        {product.condition && !isTrendingVariant && (
          <View style={styles.conditionTag}>
            <Text style={styles.conditionTagText}>{product.condition}</Text>
          </View>
        )}

        {/* Absolute Floating Save Button (Bookmark) */}
        <Pressable 
          style={[styles.bookmarkButton, localIsSaved && styles.bookmarkButtonActive]} 
          onPress={handleSaveClick}
          disabled={isLiking}
        >
          {isLiking ? (
            <ActivityIndicator size="small" color={localIsSaved ? '#ffffff' : '#94a3b8'} />
          ) : (
            <Heart
              size={15}
              color={localIsSaved ? '#ffffff' : '#94a3b8'}
              fill={localIsSaved ? '#ffffff' : 'none'}
              strokeWidth={2.3}
            />
          )}
        </Pressable>
      </View>

      {/* 2. Detail Info Section below Image */}
      <View style={styles.infoSection}>
        {/* Listing Title */}
        <Text style={styles.titleText} numberOfLines={2}>
          {product.title}
        </Text>

        {!isServiceCategory && (
          <View style={styles.priceRow}>
            <Text style={styles.priceText}>{formattedPrice}</Text>
            {product.negotiable !== false && !isTrendingVariant && (
              <View style={styles.negotiableTag}>
                <Text style={styles.negotiableTagText}>Negotiable</Text>
              </View>
            )}
          </View>
        )}

        {/* Brand tag pill */}
        {product.brand && !isTrendingVariant ? (
          <View style={styles.brandContainer}>
            <Text style={styles.brandText}>{product.brand.toUpperCase()}</Text>
          </View>
        ) : null}

        {/* Social Touchpoint: Seller Info & Location Row */}
        {!isTrendingVariant && (
          <Pressable
            style={styles.sellerTouchpointRow}
            onPress={() => onSellerPress?.(product.sellerId)}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          >
            <View style={styles.sellerLeftCol}>
              <View style={styles.sellerAvatarSmall}>
                {(product as any).sellerPhoto || (product as any).sellerAvatar ? (
                  <Image
                    source={{ uri: (product as any).sellerPhoto || (product as any).sellerAvatar }}
                    style={styles.sellerAvatarImgSmall}
                  />
                ) : (
                  <Text style={styles.sellerAvatarLetterSmall}>
                    {(product.sellerName || 'M').charAt(0).toUpperCase()}
                  </Text>
                )}
              </View>

              <View style={styles.sellerNameCol}>
                <View style={styles.sellerNameVerifiedRow}>
                  <Text style={styles.sellerNameText} numberOfLines={1}>
                    {product.sellerName || 'Verified Merchant'}
                  </Text>
                  {((product as any).isVerified || (product as any).sellerVerified || (product as any).verified) && (
                    <View style={styles.verifiedCheckSmall}>
                      <Text style={styles.verifiedCheckText}>✓</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>

            {product.location ? (
              <View style={styles.sellerLocationBadge}>
                <Text style={styles.locationPinSmall}>📍</Text>
                <Text style={styles.locationTextSmall} numberOfLines={1}>
                  {product.location}
                </Text>
              </View>
            ) : null}
          </Pressable>
        )}

        {/* Engagement Signals Row */}
        {!isTrendingVariant && Boolean(product.likesCount && product.likesCount > 0) && (
          <View style={styles.engagementRow}>
            <Text style={styles.likesCountText}>❤️ {product.likesCount} {product.likesCount === 1 ? 'save' : 'saves'}</Text>
          </View>
        )}

        {/* 3. Mark as Sold Status (Exclusive to Sellers/Admins) — matches
            web's ProductCard checkbox, not a toggle switch. */}
        {isAdminOrSeller && !isTrendingVariant && (
          <Pressable
            style={styles.soldToggleBar}
            onPress={handleSoldToggle}
            disabled={updatingSold}
            hitSlop={6}
          >
            <Text style={styles.soldToggleLabel}>Status</Text>
            {updatingSold ? (
              <ActivityIndicator size="small" color="#e11d48" />
            ) : (
              <View style={styles.soldCheckboxRow}>
                <View style={[styles.soldCheckbox, (product as any).isSold && styles.soldCheckboxChecked]}>
                  {(product as any).isSold && <Check size={10} color="#ffffff" strokeWidth={3.5} />}
                </View>
                <Text style={styles.soldCheckboxLabel}>Mark Sold</Text>
              </View>
            )}
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    flex: 1,
    marginHorizontal: 4,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 12,
  },
  imageContainer: {
    position: 'relative',
    width: '100%',
    aspectRatio: 1, // Keep standard 1:1 aspect ratio matching the web app
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  loadingOverlay: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  tagsContainer: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    zIndex: 5,
  },
  prioTag: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  trendingTag: {
    backgroundColor: '#dc2626',
    borderWidth: 1,
    borderColor: '#f87171',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  trendingTagText: {
    color: '#ffffff',
    fontSize: 9.5,
    fontFamily: fonts.extrabold,
    textTransform: 'uppercase',
  },
  prioTagText: {
    color: '#0f172a',
    fontSize: 9.5,
    fontFamily: fonts.extrabold,
    textTransform: 'uppercase',
  },
  soldTag: {
    backgroundColor: '#dc2626',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  soldTagText: {
    color: '#ffffff',
    fontSize: 9.5,
    fontFamily: fonts.extrabold,
    letterSpacing: 0.5,
  },
  conditionTag: {
    position: 'absolute',
    top: 10,
    right: 48,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    zIndex: 5,
  },
  conditionTagText: {
    color: '#ffffff',
    fontSize: 9,
    fontFamily: fonts.extrabold,
    textTransform: 'uppercase',
  },
  bookmarkButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    zIndex: 10,
  },
  bookmarkButtonActive: {
    backgroundColor: '#f43f5e',
    borderColor: '#f43f5e',
  },
  infoSection: {
    padding: 12,
    backgroundColor: '#ffffff',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  priceText: {
    fontSize: 16,
    fontFamily: fonts.extrabold,
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  negotiableTag: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  negotiableTagText: {
    color: '#047857',
    fontSize: 8.5,
    fontFamily: fonts.extrabold,
    textTransform: 'uppercase',
  },
  brandContainer: {
    alignSelf: 'flex-start',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 6,
  },
  brandText: {
    color: '#475569',
    fontSize: 9,
    fontFamily: fonts.extrabold,
    letterSpacing: 0.5,
  },
  titleText: {
    color: '#1e293b',
    fontSize: 13.5,
    fontFamily: fonts.semibold,
    lineHeight: 18,
    marginTop: 6,
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  locationPin: {
    fontSize: 12,
  },
  locationText: {
    color: '#64748b',
    fontSize: 11,
    fontFamily: fonts.medium,
  },
  sellerTouchpointRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
  },
  sellerLeftCol: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 6,
  },
  sellerAvatarSmall: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  sellerAvatarImgSmall: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  sellerAvatarLetterSmall: {
    color: '#ffffff',
    fontSize: 10,
    fontFamily: fonts.extrabold,
  },
  sellerNameCol: {
    flex: 1,
  },
  sellerNameVerifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sellerNameText: {
    color: '#1e293b',
    fontSize: 11,
    fontFamily: fonts.bold,
    flexShrink: 1,
  },
  verifiedCheckSmall: {
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifiedCheckText: {
    color: '#ffffff',
    fontSize: 8,
    fontFamily: fonts.extrabold,
  },
  sellerLocationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    maxWidth: 80,
  },
  locationPinSmall: {
    fontSize: 9.5,
  },
  locationTextSmall: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: fonts.medium,
  },
  engagementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  likesCountText: {
    fontSize: 10,
    color: '#64748b',
    fontFamily: fonts.semibold,
  },

  soldToggleBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    borderStyle: 'dashed',
    marginTop: 10,
    paddingTop: 10,
  },
  soldToggleLabel: {
    fontSize: 10,
    color: '#94a3b8',
    fontFamily: fonts.extrabold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  soldCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  soldCheckbox: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  soldCheckboxChecked: {
    backgroundColor: '#e11d48',
    borderColor: '#e11d48',
  },
  soldCheckboxLabel: {
    fontSize: 12,
    color: '#e11d48',
    fontFamily: fonts.extrabold,
  },
});
