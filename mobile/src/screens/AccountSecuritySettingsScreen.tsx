import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, ShieldCheck, Mail, RefreshCw, KeyRound, LogOut } from 'lucide-react-native';
import {
  auth,
  observeAuthState,
  fetchUserById,
  logOut,
  deleteAccount,
  resetPasswordEmail,
  sendVerificationEmail,
  reloadEmailVerificationStatus,
} from '../firebase';
import { isUserVerified, isUserAdmin } from '../types';
import { colors, radius, spacing, fonts } from '../theme';

interface Props {
  onBack: () => void;
}

/** Dedicated Account & Security screen. Every action here is a relocation of
 * existing, already-working ProfileScreen.tsx logic (verification actions,
 * sign-out, account deletion) plus one new entry point — Reset Password —
 * which reuses the existing resetPasswordEmail() the guest login screen
 * already calls; no new auth/deletion architecture is introduced. */
export function AccountSecuritySettingsScreen({ onBack }: Props) {
  const [user, setUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);

  const [isResendingEmail, setIsResendingEmail] = useState(false);
  const [isReloadingStatus, setIsReloadingStatus] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  useEffect(() => {
    const unsub = observeAuthState((currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        fetchUserById(currentUser.uid).then((profile) => {
          if (profile) setUserProfile(profile);
        });
      }
    });
    return unsub;
  }, []);

  const handleSendVerificationEmail = async () => {
    if (isResendingEmail) return;
    try {
      setIsResendingEmail(true);
      await sendVerificationEmail();
      Alert.alert('Link Sent', `A verification link was sent to ${user?.email || 'your email'}.`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to send verification email.');
    } finally {
      setIsResendingEmail(false);
    }
  };

  const handleReloadVerificationStatus = async () => {
    if (isReloadingStatus) return;
    try {
      setIsReloadingStatus(true);
      const isVerified = await reloadEmailVerificationStatus();
      if (isVerified) {
        setUserProfile((prev: any) => (prev ? { ...prev, emailVerified: true } : prev));
        Alert.alert('Verified! 🔒', 'Your email address has been verified.');
      } else {
        Alert.alert('Still Unverified', `Please click the link sent to ${user?.email || 'your email'}.`);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Unable to check status right now.');
    } finally {
      setIsReloadingStatus(false);
    }
  };

  // New entry point for an already-logged-in user — previously password
  // reset only existed on the guest/logged-out auth form. Reuses the exact
  // same resetPasswordEmail() call, just targeting the current session's own
  // known email address instead of a re-typed one.
  const handleResetPassword = () => {
    if (!user?.email || isSendingReset) return;
    Alert.alert(
      'Reset Password',
      `Send a password reset link to ${user.email}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Link',
          onPress: async () => {
            try {
              setIsSendingReset(true);
              await resetPasswordEmail(user.email);
              Alert.alert('Reset Link Sent', `Check ${user.email} for instructions to reset your password.`);
            } catch (err: any) {
              Alert.alert('Could Not Send Reset Link', err?.message || 'Please try again.');
            } finally {
              setIsSendingReset(false);
            }
          },
        },
      ]
    );
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out Session',
      'Are you sure you want to end your current session? You will need to log in again to post ads or chat with merchants.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await logOut();
            onBack();
          },
        },
      ]
    );
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      Alert.alert('Confirmation Required', 'Please type DELETE in the box to confirm your account deletion.');
      return;
    }
    if (isDeletingAccount) return;
    try {
      setIsDeletingAccount(true);
      await deleteAccount();
      setIsDeleteModalVisible(false);
      setDeleteConfirmText('');
      Alert.alert('Account Closed', 'Your account has been closed and your personal details anonymized.');
      onBack();
    } catch (err: any) {
      Alert.alert('Could Not Delete Account', err?.message || 'Please try again.');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backBtn} hitSlop={10}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Account &amp; Security</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.groupLabel}>Account</Text>
        <View style={styles.group}>
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Email Address</Text>
              <Text style={styles.rowSubtitle}>{user?.email || '—'}</Text>
            </View>
            <View style={userProfile?.emailVerified ? styles.badgeComplete : styles.badgeMissing}>
              <Text style={userProfile?.emailVerified ? styles.badgeCompleteText : styles.badgeMissingText}>
                {userProfile?.emailVerified ? '✓ Verified' : 'Unverified'}
              </Text>
            </View>
          </View>
        </View>

        {!userProfile?.emailVerified && (
          <View style={styles.actionCard}>
            <Text style={styles.actionCardTitle}>Email Inbox Verification</Text>
            <Text style={styles.actionCardBody}>
              Your email is currently unverified. Send a secure link to your registered email address.
            </Text>
            <Pressable onPress={handleSendVerificationEmail} disabled={isResendingEmail || isReloadingStatus} style={styles.actionBtn}>
              {isResendingEmail ? <ActivityIndicator size="small" color="#ffffff" /> : <Mail size={14} color="#ffffff" />}
              <Text style={styles.actionBtnText}>Send Verification Link</Text>
            </Pressable>
            <Pressable onPress={handleReloadVerificationStatus} disabled={isResendingEmail || isReloadingStatus} style={[styles.actionBtn, styles.actionBtnSecondary]}>
              {isReloadingStatus ? <ActivityIndicator size="small" color="#ffffff" /> : <RefreshCw size={14} color="#cbd5e1" />}
              <Text style={styles.actionBtnText}>I Have Verified (Check Status)</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.statusBanner}>
          {isUserAdmin(userProfile) ? (
            <View style={[styles.statusBox, { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' }]}>
              <Text style={[styles.statusTitle, { color: '#1e3a8a' }]}>🔹 Official Admin Account</Text>
              <Text style={[styles.statusText, { color: '#1d4ed8' }]}>
                Your account is an Official TedBuy Administrator. The blue admin badge is active on your store and listings.
              </Text>
            </View>
          ) : isUserVerified(userProfile) ? (
            <View style={[styles.statusBox, { backgroundColor: '#ecfdf5', borderColor: '#a7f3d0' }]}>
              <Text style={[styles.statusTitle, { color: '#065f46' }]}>🛡️ Verified Seller Status Active</Text>
              <Text style={[styles.statusText, { color: '#047857' }]}>
                Amazing! Your account meets all verified guidelines. The trust badge resides on your ads!
              </Text>
            </View>
          ) : (
            <View style={[styles.statusBox, { backgroundColor: '#fffbeb', borderColor: '#fde68a' }]}>
              <Text style={[styles.statusTitle, { color: '#92400e' }]}>⚠️ Verification Pending</Text>
              <Text style={[styles.statusText, { color: '#b45309' }]}>
                Complete your profile under Profile &amp; Store to obtain automatic verification.
              </Text>
            </View>
          )}
        </View>

        <Text style={styles.groupLabel}>Security</Text>
        <View style={styles.group}>
          <Pressable onPress={handleResetPassword} disabled={isSendingReset} style={[styles.row, { borderBottomWidth: 0 }]}>
            <View style={styles.rowLeft}>
              <View style={styles.iconBadge}>
                <KeyRound size={16} color={colors.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Reset Password</Text>
                <Text style={styles.rowSubtitle}>Email yourself a secure password reset link.</Text>
              </View>
            </View>
            {isSendingReset ? <ActivityIndicator size="small" color={colors.textMuted} /> : <Text style={styles.chevron}>→</Text>}
          </Pressable>
        </View>

        <Pressable onPress={handleSignOut} style={styles.signOutBtn}>
          <LogOut size={16} color={colors.text} />
          <Text style={styles.signOutBtnText}>Sign Out Securely</Text>
        </Pressable>

        <Pressable onPress={() => setIsDeleteModalVisible(true)} style={styles.deleteBtn}>
          <Text style={styles.deleteBtnText}>Delete Account</Text>
        </Pressable>
      </ScrollView>

      <Modal
        animationType="fade"
        transparent
        visible={isDeleteModalVisible}
        onRequestClose={() => !isDeletingAccount && setIsDeleteModalVisible(false)}
      >
        <Pressable style={styles.deleteModalOverlay} onPress={() => !isDeletingAccount && setIsDeleteModalVisible(false)}>
          <Pressable style={styles.deleteModalCard} onPress={Keyboard.dismiss}>
            <Text style={styles.deleteModalTitle}>Delete Your Account</Text>
            <Text style={styles.deleteModalBody}>
              This closes your account and anonymizes your personal details. Your listings will be archived. This cannot be undone.
            </Text>
            <Text style={styles.deleteModalLabel}>Type DELETE to confirm</Text>
            <TextInput
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder="DELETE"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="characters"
              style={styles.deleteModalInput}
            />
            <View style={styles.deleteModalActions}>
              <Pressable
                onPress={() => { setIsDeleteModalVisible(false); setDeleteConfirmText(''); }}
                disabled={isDeletingAccount}
                style={styles.deleteModalCancelBtn}
              >
                <Text style={styles.deleteModalCancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleDeleteAccount} disabled={isDeletingAccount} style={[styles.deleteModalConfirmBtn, isDeletingAccount && { opacity: 0.6 }]}>
                {isDeletingAccount ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.deleteModalConfirmBtnText}>Delete Permanently</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1, paddingRight: spacing.md },
  iconBadge: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: 14.5, fontFamily: fonts.bold, color: colors.text },
  rowSubtitle: { fontSize: 12.5, color: colors.textMuted, marginTop: 2 },
  chevron: { fontSize: 16, color: colors.textFaint },
  badgeComplete: { backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#a7f3d0', borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  badgeCompleteText: { fontSize: 11, fontFamily: fonts.bold, color: '#065f46' },
  badgeMissing: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  badgeMissingText: { fontSize: 11, fontFamily: fonts.bold, color: '#b91c1c' },
  actionCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm, marginBottom: spacing.md },
  actionCardTitle: { fontSize: 14, fontFamily: fonts.extrabold, color: colors.text },
  actionCardBody: { fontSize: 12.5, color: colors.textMuted, lineHeight: 18 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 11, marginTop: 4 },
  actionBtnSecondary: { backgroundColor: colors.primaryHover },
  actionBtnText: { color: '#ffffff', fontSize: 13, fontFamily: fonts.bold },
  statusBanner: { marginBottom: spacing.md },
  statusBox: { borderRadius: radius.md, borderWidth: 1, padding: spacing.md },
  statusTitle: { fontSize: 13.5, fontFamily: fonts.extrabold, marginBottom: 4 },
  statusText: { fontSize: 12.5, lineHeight: 18 },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 14,
    marginTop: spacing.lg,
  },
  signOutBtnText: { fontSize: 14, fontFamily: fonts.bold, color: colors.text },
  deleteBtn: { alignItems: 'center', paddingVertical: 14, marginTop: spacing.sm },
  deleteBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.danger },
  deleteModalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'center', padding: spacing.lg },
  deleteModalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  deleteModalTitle: { fontSize: 16, fontFamily: fonts.extrabold, color: colors.text, marginBottom: 8 },
  deleteModalBody: { fontSize: 13, color: colors.textMuted, lineHeight: 19, marginBottom: 14 },
  deleteModalLabel: { fontSize: 12, fontFamily: fonts.bold, color: colors.text, marginBottom: 6 },
  deleteModalInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text, marginBottom: 16 },
  deleteModalActions: { flexDirection: 'row', gap: 10 },
  deleteModalCancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  deleteModalCancelBtnText: { fontSize: 13.5, fontFamily: fonts.bold, color: colors.text },
  deleteModalConfirmBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.sm, backgroundColor: colors.danger },
  deleteModalConfirmBtnText: { fontSize: 13.5, fontFamily: fonts.bold, color: '#ffffff' },
});
