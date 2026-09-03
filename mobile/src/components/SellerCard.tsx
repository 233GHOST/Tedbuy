import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { CheckCircle2, MapPin, Package, ArrowUpRight, Plus, Check } from 'lucide-react-native';
import { fonts } from '../theme';
import { DiscoverSeller } from '../utils/discoverSellers';

interface SellerCardProps {
  seller: DiscoverSeller;
  onPress: () => void;
  style?: any;
  // Follow directly from the card — was previously only possible after
  // opening the seller's full profile page.
  isFollowing?: boolean;
  onToggleFollow?: () => void;
  isTogglingFollow?: boolean;
}

/** Matches web's SellersToDiscover card exactly: left-aligned info, a
 * rounded-square (not circular) avatar, a category pill pinned top-right,
 * and a bottom stats/action row separated by a divider. */
export function SellerCard({ seller, onPress, style, isFollowing, onToggleFollow, isTogglingFollow }: SellerCardProps) {
  return (
    <Pressable onPress={onPress} style={[styles.card, style]}>
      <View>
        <View style={styles.avatarRow}>
          <View style={styles.avatarBox}>
            {seller.photo ? (
              <Image source={{ uri: seller.photo }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitial}>{seller.name.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            {seller.isVerified && (
              <View style={styles.verifiedBadge}>
                <CheckCircle2 size={14} color="#059669" fill="#d1fae5" strokeWidth={2.2} />
              </View>
            )}
          </View>
          <View style={styles.categoryPill}>
            <Text style={styles.categoryPillText} numberOfLines={1}>{seller.primaryCategory}</Text>
          </View>
        </View>

        <Text style={styles.sellerName} numberOfLines={1}>{seller.name}</Text>
        <View style={styles.locationRow}>
          <MapPin size={11} color="#94a3b8" strokeWidth={2.3} />
          <Text style={styles.sellerLocation} numberOfLines={1}>{seller.location}</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.itemsCount}>
          <Package size={13} color="#94a3b8" strokeWidth={2.2} />
          <Text style={styles.itemsCountText}>{seller.listingCount} {seller.listingCount === 1 ? 'item' : 'items'}</Text>
        </View>
        <View style={styles.visitStore}>
          <Text style={styles.visitStoreText}>Visit Store</Text>
          <ArrowUpRight size={13} color="#ea580c" strokeWidth={2.4} />
        </View>
      </View>

      {onToggleFollow && (
        <Pressable
          onPress={(e: any) => { e?.stopPropagation?.(); onToggleFollow(); }}
          disabled={isTogglingFollow}
          style={[styles.followBtn, isFollowing && styles.followBtnActive]}
        >
          {isTogglingFollow ? (
            <ActivityIndicator size="small" color={isFollowing ? '#475569' : '#ffffff'} />
          ) : (
            <>
              {isFollowing ? (
                <Check size={12} color="#475569" strokeWidth={2.5} />
              ) : (
                <Plus size={12} color="#ffffff" strokeWidth={2.5} />
              )}
              <Text style={[styles.followBtnText, isFollowing && styles.followBtnTextActive]}>
                {isFollowing ? 'Following' : 'Follow'}
              </Text>
            </>
          )}
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    padding: 14,
    justifyContent: 'space-between',
  },
  avatarRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 },
  avatarBox: { position: 'relative' },
  avatarImg: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#e2e8f0', borderWidth: 1, borderColor: '#e2e8f0' },
  avatarFallback: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#e2e8f0', borderWidth: 1, borderColor: '#cbd5e1', justifyContent: 'center', alignItems: 'center' },
  avatarInitial: { color: '#334155', fontSize: 17, fontFamily: fonts.extrabold },
  verifiedBadge: {
    position: 'absolute', bottom: -3, right: -3, backgroundColor: '#ffffff',
    borderRadius: 9, padding: 1, shadowColor: '#0f172a', shadowOpacity: 0.15, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  categoryPill: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, maxWidth: 90 },
  categoryPillText: { fontSize: 9.5, color: '#475569', fontFamily: fonts.extrabold },
  sellerName: { fontSize: 13.5, color: '#0f172a', fontFamily: fonts.bold, marginBottom: 4 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sellerLocation: { fontSize: 10.5, color: '#64748b', fontFamily: fonts.semibold, flexShrink: 1 },
  statsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e2e8f0',
  },
  itemsCount: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  itemsCountText: { fontSize: 11, color: '#334155', fontFamily: fonts.bold },
  visitStore: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  visitStoreText: { fontSize: 10.5, color: '#ea580c', fontFamily: fonts.bold },
  followBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#0f172a', borderRadius: 10, paddingVertical: 8, marginTop: 10 },
  followBtnActive: { backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#cbd5e1' },
  followBtnText: { fontSize: 11, color: '#ffffff', fontFamily: fonts.extrabold },
  followBtnTextActive: { color: '#475569' },
});
