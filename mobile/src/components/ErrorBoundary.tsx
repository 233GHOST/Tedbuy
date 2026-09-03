import React from 'react';
import { View, Text, Pressable, StyleSheet, SafeAreaView } from 'react-native';
import { AlertTriangle, RefreshCw, LogOut } from 'lucide-react-native';
import { auth, logOut } from '../firebase';
import { colors, fonts, radius, spacing } from '../theme';

interface Props {
  children?: React.ReactNode;
}

interface State {
  hasError: boolean;
}

/** Matches web's ErrorBoundary.tsx — was entirely absent on mobile, so an
 * uncaught render-time crash anywhere in the tree would take down the whole
 * app to a native red-screen/crash with no graceful recovery, unlike web's
 * "Try Again" / "Sign Out" fallback UI. Web's chunk-loading auto-reload
 * branch (dynamic import failures) has no RN equivalent — the whole JS
 * bundle loads upfront, there's no code-splitting to fail — so it's
 * correctly omitted here rather than fabricated. */
export class ErrorBoundary extends React.Component<Props, State> {
  public override state: State = { hasError: false };

  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  public override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught render crash:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false });
  };

  private handleEmergencyLogout = async () => {
    try {
      await logOut();
    } catch (e) {
      console.error('[ErrorBoundary] Emergency logout failed:', e);
    }
    this.setState({ hasError: false });
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.container}>
            <View style={styles.card}>
              <View style={styles.iconBadge}>
                <AlertTriangle size={30} color={colors.warning} strokeWidth={2.2} />
              </View>
              <Text style={styles.title}>Something went wrong</Text>
              <Text style={styles.body}>
                We encountered a temporary render-time issue or connection disruption. Don't worry, your data and saved preferences are preserved safely!
              </Text>
              <Pressable onPress={this.handleReset} style={styles.primaryBtn}>
                <RefreshCw size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>Try Again</Text>
              </Pressable>
              {auth.currentUser && (
                <Pressable onPress={this.handleEmergencyLogout} style={styles.dangerBtn}>
                  <LogOut size={16} color={colors.danger} />
                  <Text style={styles.dangerBtnText}>Sign Out of Account</Text>
                </Pressable>
              )}
            </View>
          </View>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: { width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, alignItems: 'center' },
  iconBadge: { width: 64, height: 64, borderRadius: 999, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  title: { fontFamily: fonts.extrabold, fontSize: 18, color: colors.textStrong, textAlign: 'center', marginBottom: spacing.sm },
  body: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.textMuted, textAlign: 'center', lineHeight: 18, marginBottom: spacing.xl },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, width: '100%' },
  primaryBtnText: { fontFamily: fonts.bold, fontSize: 13, color: '#fff' },
  dangerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#fff1f2', borderWidth: 1, borderColor: '#fecdd3', borderRadius: radius.md, paddingVertical: spacing.md, width: '100%', marginTop: spacing.sm },
  dangerBtnText: { fontFamily: fonts.bold, fontSize: 13, color: colors.danger },
});
