import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { observeAuthState, fetchUserById, updateUserProfile } from '../firebase';
import { colors, radius, spacing, fonts } from '../theme';

interface Props {
  onBack: () => void;
}

const ROLE_OPTIONS = [
  ['buyer', 'Buyer Focus', 'Focussed on exploring deals, saved ads, and secure purchasing.'],
  ['seller', 'Seller Focus', 'Focussed on advertising ads, store metrics and bargain chats.'],
  ['both', 'Dual Persona', 'Run store listings while purchasing classified items side-by-side.'],
] as const;

/** Dedicated Selling & Buying screen. Today this honestly contains the one
 * real marketplace-focus preference that exists (the "role" field, relocated
 * from ProfileScreen.tsx's Edit Profile card) rather than two separate
 * Selling/Buying sections invented to look fuller than the app's actual
 * functionality — additional seller/buyer preferences can be added to this
 * same screen later without another architecture change. */
export function SellingBuyingSettingsScreen({ onBack }: Props) {
  const [userProfile, setUserProfile] = useState<any>(null);
  const [editRole, setEditRole] = useState<'buyer' | 'seller' | 'both'>('both');
  const [isSavingRole, setIsSavingRole] = useState(false);

  useEffect(() => {
    const unsub = observeAuthState((currentUser) => {
      if (currentUser) {
        fetchUserById(currentUser.uid).then((profile) => {
          if (profile) setUserProfile(profile);
        });
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (userProfile) {
      setEditRole(userProfile.role === 'buyer' || userProfile.role === 'seller' ? userProfile.role : 'both');
    }
  }, [userProfile]);

  const handleSaveRole = async () => {
    if (isSavingRole) return;
    try {
      setIsSavingRole(true);
      const updated = await updateUserProfile({ role: editRole });
      setUserProfile(updated);
      Alert.alert('Preference Saved', 'Your marketplace account focus has been updated.');
    } catch (err: any) {
      Alert.alert('Save Failed', err?.message || 'Could not update your preference. Please try again.');
    } finally {
      setIsSavingRole(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backBtn} hitSlop={10}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Selling &amp; Buying</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.groupLabel}>Account Focus</Text>
        <Text style={styles.intro}>Tell TedBuy how you mainly use the marketplace.</Text>

        <View style={styles.optionsColumn}>
          {ROLE_OPTIONS.map(([value, title, subtitle]) => {
            const isSelected = editRole === value;
            return (
              <Pressable
                key={value}
                onPress={() => setEditRole(value)}
                style={[styles.optionCard, isSelected && styles.optionCardActive]}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Text style={styles.optionTitle}>{title}</Text>
                  {isSelected && (
                    <View style={styles.optionCheck}>
                      <Text style={{ color: '#fff', fontSize: 10, fontFamily: fonts.extrabold }}>✓</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.optionSubtitle}>{subtitle}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable onPress={handleSaveRole} disabled={isSavingRole} style={styles.saveBtn}>
          {isSavingRole ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 34, height: 34, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontFamily: fonts.extrabold, color: colors.text },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  groupLabel: {
    fontSize: 12,
    fontFamily: fonts.extrabold,
    color: colors.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  intro: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.lg },
  optionsColumn: { gap: spacing.sm },
  optionCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, padding: spacing.md },
  optionCardActive: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  optionTitle: { fontSize: 14.5, fontFamily: fonts.extrabold, color: colors.text },
  optionSubtitle: { fontSize: 12.5, color: colors.textMuted, marginTop: 4, lineHeight: 17 },
  optionCheck: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 14, alignItems: 'center', marginTop: spacing.xl },
  saveBtnText: { color: '#ffffff', fontSize: 14, fontFamily: fonts.bold },
});
