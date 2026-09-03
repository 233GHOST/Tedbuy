import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { ChevronLeft, Camera } from 'lucide-react-native';
import { observeAuthState, fetchUserById, updateUserProfile, uploadMediaToCloudinaryMobile } from '../firebase';
import { isReservedStoreName, isUserAdmin } from '../types';
import { colors, radius, spacing, fonts } from '../theme';

interface Props {
  onBack: () => void;
}

/** Dedicated Profile & Store screen — relocation of ProfileScreen.tsx's
 * "Edit Profile" card (avatar, store name, phone, WhatsApp) with its exact
 * existing validation and updateUserProfile() save logic. Account Focus
 * (buyer/seller/both) now lives on its own Selling & Buying screen instead —
 * everything else here is unchanged. */
export function ProfileStoreSettingsScreen({ onBack }: Props) {
  const [userProfile, setUserProfile] = useState<any>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editWhatsApp, setEditWhatsApp] = useState('');
  const [editPhotoUrl, setEditPhotoUrl] = useState('');
  const [editBio, setEditBio] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

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
      setEditUsername(userProfile.username || '');
      setEditPhone(userProfile.phoneNumber || '');
      setEditWhatsApp(userProfile.whatsAppNumber || '');
      setEditPhotoUrl(userProfile.photoUrl || '');
      setEditBio(userProfile.bio || '');
    }
  }, [userProfile]);

  const bioLockedUntilMs = userProfile?.bioUpdatedAt
    ? new Date(userProfile.bioUpdatedAt).getTime() + 7 * 24 * 60 * 60 * 1000
    : null;
  const isBioLocked = !!bioLockedUntilMs && Date.now() < bioLockedUntilMs;
  const bioDaysLeft = bioLockedUntilMs ? Math.max(1, Math.ceil((bioLockedUntilMs - Date.now()) / (24 * 60 * 60 * 1000))) : 0;

  const handleChangeAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo Access Needed', 'TedBuy needs access to your photos to change your profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled || !result.assets || result.assets.length === 0) return;

    try {
      setIsUploadingAvatar(true);
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 400 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!manipulated.base64) throw new Error('Could not process image');
      const uploadedUrl = await uploadMediaToCloudinaryMobile(`data:image/jpeg;base64,${manipulated.base64}`, 'image');
      setEditPhotoUrl(uploadedUrl);
    } catch (err: any) {
      Alert.alert('Upload Failed', err?.message || 'Could not upload your photo. Please try again.');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleSaveProfile = async () => {
    if (isSavingProfile) return;
    const trimmedUsername = editUsername.trim();
    if (!trimmedUsername) {
      Alert.alert('Store Name Required', 'Please enter a store name.');
      return;
    }
    if (!isUserAdmin(userProfile) && isReservedStoreName(trimmedUsername)) {
      Alert.alert('Reserved Store Name', 'This store name is reserved by TedBuy.');
      return;
    }
    if (trimmedUsername.length > 50) {
      Alert.alert('Store Name Too Long', 'Store Name must be 50 characters or less.');
      return;
    }
    if (editPhone && editPhone.length > 25) {
      Alert.alert('Phone Number Too Long', 'Phone number must be under 25 characters.');
      return;
    }
    if (editWhatsApp && editWhatsApp.length > 25) {
      Alert.alert('WhatsApp Number Too Long', 'WhatsApp number must be under 25 characters.');
      return;
    }
    try {
      setIsSavingProfile(true);
      const updated = await updateUserProfile({
        username: trimmedUsername,
        phoneNumber: editPhone.trim(),
        whatsAppNumber: editWhatsApp.trim(),
        photoUrl: editPhotoUrl,
        bio: editBio.trim(),
      });
      setUserProfile(updated);
      Alert.alert('Profile Updated', 'Your store settings have been saved.');
    } catch (err: any) {
      Alert.alert('Save Failed', err?.message || 'Could not update your profile. Please try again.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backBtn} hitSlop={10}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Profile &amp; Store</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Pressable onPress={handleChangeAvatar} style={styles.avatarWrap} disabled={isUploadingAvatar}>
            {editPhotoUrl ? (
              <Image source={{ uri: editPhotoUrl }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitial}>{editUsername.charAt(0).toUpperCase() || 'U'}</Text>
              </View>
            )}
            <View style={styles.avatarCameraBadge}>
              {isUploadingAvatar ? <ActivityIndicator size="small" color="#ffffff" /> : <Camera size={13} color="#ffffff" strokeWidth={2.3} />}
            </View>
          </Pressable>

          <Text style={styles.fieldLabel}>Store / Display Name</Text>
          <TextInput
            value={editUsername}
            onChangeText={setEditUsername}
            placeholder="e.g. Nana Gadgets"
            placeholderTextColor={colors.textFaint}
            style={styles.textInput}
            maxLength={50}
          />

          <Text style={styles.fieldLabel}>Phone Number</Text>
          <TextInput
            value={editPhone}
            onChangeText={setEditPhone}
            placeholder="e.g. 024 123 4567"
            placeholderTextColor={colors.textFaint}
            keyboardType="phone-pad"
            style={styles.textInput}
            maxLength={25}
          />

          <Text style={styles.fieldLabel}>WhatsApp Number</Text>
          <TextInput
            value={editWhatsApp}
            onChangeText={setEditWhatsApp}
            placeholder="e.g. 024 123 4567"
            placeholderTextColor={colors.textFaint}
            keyboardType="phone-pad"
            style={styles.textInput}
            maxLength={25}
          />
          <Text style={styles.fieldHint}>Buyers use this to reach you directly on WhatsApp from your listings.</Text>

          <Text style={styles.fieldLabel}>Bio</Text>
          <TextInput
            value={editBio}
            onChangeText={setEditBio}
            placeholder="Tell buyers a bit about you or your store"
            placeholderTextColor={colors.textFaint}
            style={[styles.textInput, styles.bioInput]}
            maxLength={160}
            multiline
            editable={!isBioLocked}
          />
          <Text style={styles.fieldHint}>
            {isBioLocked
              ? `You can change your bio again in ${bioDaysLeft} day${bioDaysLeft === 1 ? '' : 's'}.`
              : `${editBio.length}/160 · Your bio can be changed once every 7 days.`}
          </Text>

          <Pressable onPress={handleSaveProfile} disabled={isSavingProfile} style={styles.saveBtn}>
            {isSavingProfile ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
          </Pressable>
        </View>
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
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, alignItems: 'center' },
  avatarWrap: { marginBottom: spacing.lg },
  avatarImg: { width: 88, height: 88, borderRadius: 44 },
  avatarFallback: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#ffffff', fontSize: 32, fontFamily: fonts.extrabold },
  avatarCameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  fieldLabel: { alignSelf: 'flex-start', fontSize: 12.5, fontFamily: fonts.bold, color: colors.text, marginBottom: 6, marginTop: spacing.md },
  textInput: { alignSelf: 'stretch', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: colors.text },
  bioInput: { minHeight: 80, textAlignVertical: 'top' },
  fieldHint: { alignSelf: 'flex-start', fontSize: 11.5, color: colors.textFaint, marginTop: 4 },
  saveBtn: { alignSelf: 'stretch', backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 14, alignItems: 'center', marginTop: spacing.xl },
  saveBtnText: { color: '#ffffff', fontSize: 14, fontFamily: fonts.bold },
});
