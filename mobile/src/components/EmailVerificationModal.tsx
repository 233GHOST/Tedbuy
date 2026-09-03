import React, { useState } from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { Mail, ShieldAlert, RefreshCw, X } from 'lucide-react-native';
import { auth, sendVerificationEmail, reloadEmailVerificationStatus, getFriendlyAuthErrorMessage } from '../firebase';
import { colors, fonts, radius, spacing } from '../theme';

export type BlockedActionType = 'post-ad' | 'chat' | 'whatsApp' | 'review' | null;

interface EmailVerificationModalProps {
  visible: boolean;
  onClose: () => void;
  actionType: BlockedActionType;
  /** Called once the user's email is confirmed verified, so the caller can
   * proceed with the action that was blocked. */
  onVerified: () => void;
}

function getActionFriendlyName(actionType: BlockedActionType): string {
  switch (actionType) {
    case 'post-ad':
      return 'post a new ad/classified listing';
    case 'chat':
      return 'start a direct chat negotiation';
    case 'whatsApp':
      return 'contact a seller via WhatsApp link';
    case 'review':
      return 'submit a trust-rating review';
    default:
      return 'access full marketplace features';
  }
}

/** Matches web's VerificationBlockModal (src/components/VerificationBlockModal.tsx)
 * — same two actions (resend link, recheck status), same copy. Web gates
 * chat, WhatsApp contact, posting an ad, and reviews behind email
 * verification; mobile previously had none of these gates. */
export const EmailVerificationModal: React.FC<EmailVerificationModalProps> = ({ visible, onClose, actionType, onVerified }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const handleRecheck = async () => {
    setIsLoading(true);
    try {
      const isVerified = await reloadEmailVerificationStatus();
      if (isVerified) {
        onClose();
        onVerified();
      } else {
        Alert.alert('Still Unverified', `Please click the link sent to ${auth.currentUser?.email || 'your email'}.`);
      }
    } catch (err: any) {
      Alert.alert('Error', getFriendlyAuthErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    setIsResending(true);
    try {
      await sendVerificationEmail();
      Alert.alert('Link Sent', `A new verification link was dispatched to ${auth.currentUser?.email || 'your email'}.`);
    } catch (err: any) {
      Alert.alert('Error', getFriendlyAuthErrorMessage(err));
    } finally {
      setIsResending(false);
    }
  };

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={10}>
            <X size={18} color={colors.textMuted} />
          </Pressable>

          <View style={styles.icon}>
            <ShieldAlert size={22} color="#d97706" strokeWidth={2.2} />
          </View>

          <Text style={styles.title}>Email Verification Required</Text>
          <Text style={styles.body}>
            To foster a trusted GHS classifieds community, you must verify your email address before you can{' '}
            <Text style={styles.bodyBold}>{getActionFriendlyName(actionType)}</Text>.
          </Text>

          <View style={styles.infoCard}>
            <Mail size={18} color={colors.textFaint} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.infoTitle}>Verification Link Sent</Text>
              <Text style={styles.infoEmail}>{auth.currentUser?.email || ''}</Text>
              <Text style={styles.infoNote}>
                If you just signed up, check your junk or spam folder. You must click the verification link inside that message.
              </Text>
            </View>
          </View>

          <Pressable onPress={handleRecheck} disabled={isLoading || isResending} style={[styles.primaryBtn, (isLoading || isResending) && { opacity: 0.6 }]}>
            {isLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <RefreshCw size={15} color="#fff" strokeWidth={2.2} />
            )}
            <Text style={styles.primaryBtnText}>I Have Verified (Check Status)</Text>
          </Pressable>

          <View style={styles.actionsRow}>
            <Pressable onPress={handleResend} disabled={isLoading || isResending} style={styles.secondaryBtn}>
              {isResending ? (
                <ActivityIndicator size="small" color={colors.textMuted} />
              ) : (
                <Mail size={13} color={colors.textMuted} strokeWidth={2.2} />
              )}
              <Text style={styles.secondaryBtnText}>Resend Link</Text>
            </Pressable>
            <Pressable onPress={onClose} style={styles.dismissBtn}>
              <Text style={styles.dismissBtnText}>Browse Only</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  card: { width: '100%', maxWidth: 340, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, position: 'relative' },
  closeBtn: { position: 'absolute', top: spacing.md, right: spacing.md, zIndex: 1 },
  icon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: '#fffbeb', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  title: { fontFamily: fonts.extrabold, fontSize: 17, color: colors.textStrong },
  body: { fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 18 },
  bodyBold: { fontFamily: fonts.extrabold, color: colors.textStrong },
  infoCard: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginVertical: spacing.lg },
  infoTitle: { fontFamily: fonts.extrabold, fontSize: 11, color: colors.text },
  infoEmail: { fontFamily: fonts.semibold, fontSize: 11, color: colors.textMuted, marginTop: 2 },
  infoNote: { fontFamily: fonts.medium, fontSize: 10, color: colors.textFaint, marginTop: spacing.sm, lineHeight: 14 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.md },
  primaryBtnText: { fontFamily: fonts.extrabold, fontSize: 12, color: '#fff' },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  secondaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm },
  secondaryBtnText: { fontFamily: fonts.bold, fontSize: 11, color: colors.text },
  dismissBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, paddingVertical: spacing.sm },
  dismissBtnText: { fontFamily: fonts.bold, fontSize: 11, color: colors.textMuted },
});
