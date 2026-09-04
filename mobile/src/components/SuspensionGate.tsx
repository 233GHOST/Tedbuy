import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Linking, StyleSheet } from 'react-native';
import { Mail, ShieldAlert } from 'lucide-react-native';
import { auth, observeAuthState, fetchUserById, logOut } from '../firebase';
import { colors, fonts, radius, spacing } from '../theme';

const CHECK_INTERVAL_MS = 60 * 1000;

/** Matches web's suspension check (AppContext.tsx) + SuspendedBlockModal —
 * previously entirely absent on mobile, meaning a suspended account (banned
 * by admin for fraud/abuse/safety violations) had full unrestricted use of
 * the mobile app. Checks on sign-in and periodically thereafter, same as
 * web's periodic re-check to prevent a stale cached "not suspended" state
 * from persisting. Note: like web, this is a client-side UX layer — the
 * server itself doesn't reject writes from a suspended account either
 * (verifyUser() has no suspension check), so this brings mobile to parity
 * with web's existing (not fully server-enforced) model rather than
 * inventing new server-side enforcement mid-audit. */
export function SuspensionGate({ children }: { children: React.ReactNode }) {
  const [isSuspended, setIsSuspended] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const checkSuspension = async (uid: string) => {
      const profile = await fetchUserById(uid);
      if (profile?.isSuspended) {
        setIsSuspended(true);
        if (intervalRef.current) clearInterval(intervalRef.current);
        logOut().catch(() => {});
      }
    };

    const unsub = observeAuthState((user) => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (user) {
        checkSuspension(user.uid);
        intervalRef.current = setInterval(() => checkSuspension(user.uid), CHECK_INTERVAL_MS);
      }
    });

    return () => {
      unsub();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  if (!isSuspended) return <>{children}</>;

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <View style={styles.icon}>
          <ShieldAlert size={26} color="#e11d48" strokeWidth={2.2} />
        </View>
        <Text style={styles.title}>Account Suspended</Text>
        <Text style={styles.body}>
          Your account has been suspended by TedBuy Administration due to safety or policy violations.
        </Text>

        <View style={styles.infoCard}>
          <Mail size={16} color="#e11d48" style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.infoTitle}>Support & Appeals Contact</Text>
            <Text style={styles.infoEmail}>info.tedbuy@gmail.com</Text>
            <Text style={styles.infoNote}>
              Please contact TedBuy support to appeal this action, resolve fraud reports, or clarify safety policy compliance. Be sure to reference your registered email address or phone identifier.
            </Text>
          </View>
        </View>

        <Pressable
          onPress={() => Linking.openURL('mailto:info.tedbuy@gmail.com?subject=TedBuy Account Appeal')}
          style={styles.primaryBtn}
        >
          <Mail size={15} color="#fff" />
          <Text style={styles.primaryBtnText}>Contact TedBuy Support</Text>
        </Pressable>

        <Pressable onPress={() => setIsSuspended(false)} style={styles.dismissBtn}>
          <Text style={styles.dismissBtnText}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,23,42,0.85)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg, zIndex: 9999 },
  card: { width: '100%', maxWidth: 360, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, borderWidth: 1, borderColor: '#fecdd3' },
  icon: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: '#fff1f2', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  title: { fontFamily: fonts.extrabold, fontSize: 18, color: colors.textStrong },
  body: { fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 18 },
  infoCard: { flexDirection: 'row', gap: spacing.sm, backgroundColor: '#fff1f2', borderWidth: 1, borderColor: '#fecdd3', borderRadius: radius.lg, padding: spacing.md, marginVertical: spacing.lg },
  infoTitle: { fontFamily: fonts.extrabold, fontSize: 11, color: colors.text },
  infoEmail: { fontFamily: fonts.bold, fontSize: 11, color: '#e11d48', marginTop: 2 },
  infoNote: { fontFamily: fonts.medium, fontSize: 10, color: colors.textFaint, marginTop: spacing.sm, lineHeight: 14 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md },
  primaryBtnText: { fontFamily: fonts.extrabold, fontSize: 12, color: '#fff' },
  dismissBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.md, marginTop: spacing.sm },
  dismissBtnText: { fontFamily: fonts.bold, fontSize: 11, color: colors.textMuted },
});
