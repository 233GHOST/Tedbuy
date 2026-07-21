import React, { useState, useEffect } from 'react';
import { View, Text, Image, Pressable, StyleSheet, Platform, Alert, ActivityIndicator, Switch } from 'react-native';
import { Product } from '../types';
import { auth, toggleLikeProduct, updateProduct } from '../firebase';

interface ProductCardProps {
  product: Product;
  onPress?: () => void;
  onToggleSave?: (productId: string) => void;
  isSaved?: boolean;
}

export function ProductCard({ product, onPress, onToggleSave, isSaved: propIsSaved }: ProductCardProps) {
  const [loaded, setLoaded] = useState(false);
  const [isLiking, setIsLiking] = useState(false);
  const [localIsSaved, setLocalIsSaved] = useState(false);
  const [updatingSold, setUpdatingSold] = useState(false);

  const currentUser = auth.currentUser;
  const isAdminOrSeller = !!(currentUser && (product.sellerId === currentUser.uid));

  // Sync saved/liked status
  useEffect(() => {
    if (propIsSaved !== undefined) {
      setLocalIsSaved(propIsSaved);
    } else if (currentUser && Array.isArray(product.likedUserIds)) {
      setLocalIsSaved(product.likedUserIds.includes(currentUser.uid));
    } else {
      setLocalIsSaved(false);
    }
  }, [propIsSaved, product.likedUserIds, currentUser]);

  // Robust price formatting matching the web app's Intl logic with graceful fallback
  const formatProductPrice = (priceVal: string | number) => {
    if (typeof priceVal === 'string') {
      const lower = priceVal.trim().toLowerCase();
      if (lower === 'contact for price' || lower === 'contact for price.' || lower.includes('contact for price')) {
        return 'Inquire';
      }
    }
    
    const getGHFormatted = (num: number) => {
      try {
        return new Intl.NumberFormat('en-GH', {
          style: 'currency',
          currency: 'GHS',
          maximumFractionDigits: 0
        }).format(num);
      } catch (e) {
        return `GH₵ ${num.toLocaleString()}`;
      }
    };

    if (typeof priceVal === 'number') {
      return getGHFormatted(priceVal);
    }
    
    const cleanStr = String(priceVal).replace(/GHS/gi, '').replace(/GH₵/gi, '').replace(/,/g, '').trim();
    const num = Number(cleanStr);
    if (!isNaN(num) && cleanStr !== '') {
      return getGHFormatted(num);
    }
    return priceVal;
  };

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
  const isPrioSeller = isBoostActive();
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
      await toggleLikeProduct(product.id, currentUser.uid);
      setLocalIsSaved(!localIsSaved);
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

  const coverImageUrl = Array.isArray(product.images) && product.images.length > 0
    ? product.images[0]
    : product.image || 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80';

  const dateFormatted = product.createdAt 
    ? new Date(product.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';

  return (
    <Pressable style={styles.cardContainer} onPress={onPress}>
      {/* 1. Image cover section with 1:1 Aspect Ratio */}
      <View style={styles.imageContainer}>
        {/* Main Product Image */}
        <Image
          source={{ uri: coverImageUrl }}
          style={styles.coverImage}
          onLoadStart={() => setLoaded(false)}
          onLoadEnd={() => setLoaded(true)}
        />

        {/* Loading Spinner Overlays */}
        {!loaded && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="small" color="#ea580c" />
          </View>
        )}

        {/* Top-Left Status Tags Row */}
        <View style={styles.tagsContainer}>
          {isPrioSeller && (
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
        {product.condition && (
          <View style={styles.conditionTag}>
            <Text style={styles.conditionTagText}>{product.condition}</Text>
          </View>
        )}

        {/* Bottom-Right Video Ad Ribbon */}
        {hasVideoAd && (
          <View style={styles.videoRibbon}>
            <Text style={styles.videoRibbonText}>📹 Video Ad</Text>
          </View>
        )}

        {/* Absolute Floating Save Button (Bookmark) */}
        <Pressable 
          style={[styles.bookmarkButton, localIsSaved && styles.bookmarkButtonActive]} 
          onPress={handleSaveClick}
          disabled={isLiking}
        >
          {isLiking ? (
            <ActivityIndicator size="small" color={localIsSaved ? '#ffffff' : '#ea580c'} />
          ) : (
            <Text style={[styles.bookmarkEmoji, localIsSaved && styles.bookmarkEmojiActive]}>
              {localIsSaved ? '🔖' : '🤍'}
            </Text>
          )}
        </Pressable>

        {/* Metadata overlay bar if seller/owner of the ad */}
        {isAdminOrSeller && (
          <View style={styles.ownerOverlayBar}>
            <Text style={styles.ownerOverlayText}>👁️ {(product as any).viewsCount || 0} views</Text>
            {dateFormatted ? <Text style={styles.ownerOverlayText}>📅 {dateFormatted}</Text> : null}
          </View>
        )}
      </View>

      {/* 2. Detail Info Section below Image */}
      <View style={styles.infoSection}>
        <View style={styles.priceRow}>
          <Text style={styles.priceText}>{formattedPrice}</Text>
          {product.negotiable !== false && (
            <View style={styles.negotiableTag}>
              <Text style={styles.negotiableTagText}>Negotiable</Text>
            </View>
          )}
        </View>

        {/* Brand tag pill */}
        {product.brand ? (
          <View style={styles.brandContainer}>
            <Text style={styles.brandText}>{product.brand.toUpperCase()}</Text>
          </View>
        ) : null}

        {/* Listing Title */}
        <Text style={styles.titleText} numberOfLines={2}>
          {product.title}
        </Text>

        {/* Location Indicator */}
        <View style={styles.locationContainer}>
          <Text style={styles.locationPin}>📍</Text>
          <Text style={styles.locationText} numberOfLines={1}>
            {product.location || 'Ghana'}
          </Text>
        </View>

        {/* Seller Info Row */}
        <View style={styles.sellerRow}>
          <Text style={styles.sellerLabelText}>
            Seller: <Text style={styles.sellerNameText}>{product.sellerName || 'Verified Merchant'}</Text>
          </Text>
          {product.likesCount && product.likesCount > 0 ? (
            <Text style={styles.likesCountText}>❤️ {product.likesCount}</Text>
          ) : null}
        </View>

        {/* 3. Mark as Sold Status Toggle (Exclusive to Sellers/Admins) */}
        {isAdminOrSeller && (
          <View style={styles.soldToggleBar}>
            <Text style={styles.soldToggleLabel}>Mark item as Sold</Text>
            {updatingSold ? (
              <ActivityIndicator size="small" color="#ea580c" />
            ) : (
              <Switch
                value={!!(product as any).isSold}
                onValueChange={handleSoldToggle}
                trackColor={{ false: '#cbd5e1', true: '#fecaca' }}
                thumbColor={!!(product as any).isSold ? '#ef4444' : '#f1f5f9'}
                ios_backgroundColor="#cbd5e1"
              />
            )}
          </View>
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
  prioTagText: {
    color: '#0f172a',
    fontSize: 9.5,
    fontWeight: '900',
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
    fontWeight: '900',
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
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  videoRibbon: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(5, 150, 105, 0.9)',
    borderWidth: 1,
    borderColor: '#10b981',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    zIndex: 4,
  },
  videoRibbonText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '900',
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
    backgroundColor: '#ef4444',
    borderColor: '#ef4444',
  },
  bookmarkEmoji: {
    fontSize: 14,
    color: '#475569',
  },
  bookmarkEmojiActive: {
    color: '#ffffff',
  },
  ownerOverlayBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    zIndex: 3,
  },
  ownerOverlayText: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '700',
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
    fontWeight: '900',
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
    fontWeight: '800',
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
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  titleText: {
    color: '#1e293b',
    fontSize: 13.5,
    fontWeight: '600',
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
    fontWeight: '500',
  },
  sellerRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sellerLabelText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '500',
  },
  sellerNameText: {
    color: '#334155',
    fontWeight: '700',
  },
  likesCountText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
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
    fontSize: 11,
    color: '#dc2626',
    fontWeight: '800',
    textTransform: 'uppercase',
  },
});
