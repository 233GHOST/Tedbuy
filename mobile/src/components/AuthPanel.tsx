import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Eye, EyeOff } from 'lucide-react-native';
import { TedBuyLogo } from './TedBuyLogo';
import { signIn, signUp, signInWithGoogle, resetPasswordEmail, getFriendlyAuthErrorMessage } from '../firebase';
import { fonts } from '../theme';
import { TAB_BAR_HEIGHT } from '../context/TabBarVisibility';

// The signed-out Profile tab: sign in, sign up, forgot password and the
// Google button. Rendered by ProfileScreen when there is no user.
export function AuthPanel(props: { onSignedIn?: () => void }) {
  const insets = useSafeAreaInsets();

  // Form states for Guest
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [isSendingReset, setIsSendingReset] = useState(false);

  const handleSendPasswordReset = async () => {
    if (isSendingReset) return;
    try {
      setIsSendingReset(true);
      await resetPasswordEmail(resetEmail);
      Alert.alert('Reset Link Sent', `Check ${resetEmail.trim()} for instructions to reset your password.`);
      setShowForgotPassword(false);
      setResetEmail('');
    } catch (err: any) {
      Alert.alert('Could Not Send Reset Link', getFriendlyAuthErrorMessage(err));
    } finally {
      setIsSendingReset(false);
    }
  };

  const handleAuth = async () => {
    // Every sibling handler in this file (password reset, delete account)
    // guards against a fast double-tap firing the request twice; this one
    // previously relied only on the button's `disabled` prop, which lags a
    // render behind.
    if (authLoading) return;

    const trimmedEmail = email.trim();
    const trimmedPassword = password;
    const trimmedUsername = username.trim();

    if (!trimmedEmail || !trimmedPassword) {
      Alert.alert('Form Incomplete', 'Please fill out all required credentials.');
      return;
    }

    if (isRegisterMode && !trimmedUsername) {
      Alert.alert('Form Incomplete', 'Please provide a store or display name.');
      return;
    }

    try {
      setAuthLoading(true);
      if (isRegisterMode) {
        await signUp({ email: trimmedEmail, password: trimmedPassword, username: trimmedUsername, phoneNumber: '' });
        Alert.alert('Welcome to TedBuy! 🎉', 'Your digital storefront has been successfully initialized.');
      } else {
        await signIn(trimmedEmail, trimmedPassword);
      }
      // Reset form
      setEmail('');
      setPassword('');
      setUsername('');
      setIsPasswordVisible(false);
    } catch (err: any) {
      Alert.alert('Authentication Failure', getFriendlyAuthErrorMessage(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    if (authLoading) return;
    try {
      setAuthLoading(true);
      await signInWithGoogle();
    } catch (err: any) {
      Alert.alert('Google Sign-In Failed', err?.message || 'Could not sign in with Google. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={[styles.authScroll, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom }]}>
      <View style={styles.authHeader}>
        <View style={styles.logoBadge}>
          <TedBuyLogo size={40} />
        </View>
        <Text style={styles.authTitle}>
          Ted<Text style={styles.orangeText}>Buy</Text> Mobile
        </Text>
        <Text style={styles.authSubtitle}>
          Join Ghana's premier classified marketplace and connect with thousands of active merchants.
        </Text>
      </View>

      <View style={styles.authCard}>
        <Text style={styles.cardLabel}>
          {isRegisterMode ? 'CREATE MERCHANT ACCOUNT' : 'SECURE LOG IN'}
        </Text>

        {isRegisterMode && (
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Store or Display Name</Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              maxLength={50}
              placeholder="e.g. Nana Gadgets, Ama Fashion"
              placeholderTextColor="#94a3b8"
              style={styles.textInput}
              accessibilityLabel="Store or Display Name"
            />
          </View>
        )}

        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Email Address</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.textInput}
            accessibilityLabel="Email Address"
          />
        </View>

        {showForgotPassword ? (
          <>
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Email Address</Text>
              <TextInput
                value={resetEmail}
                onChangeText={setResetEmail}
                placeholder="you@example.com"
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
                keyboardType="email-address"
                style={styles.textInput}
                accessibilityLabel="Email Address"
              />
            </View>
            <Pressable
              onPress={handleSendPasswordReset}
              style={styles.authSubmitButton}
              disabled={isSendingReset}
            >
              {isSendingReset ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text style={styles.authSubmitText}>Send Reset Link</Text>
              )}
            </Pressable>
            <Pressable onPress={() => setShowForgotPassword(false)} style={styles.toggleAuthModeBtn}>
              <Text style={styles.toggleAuthModeText}>← Back to Sign In</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.inputContainer}>
              <View style={styles.passwordLabelRow}>
                <Text style={styles.inputLabel}>Password</Text>
                {!isRegisterMode && (
                  <Pressable onPress={() => setShowForgotPassword(true)}>
                    <Text style={styles.forgotPasswordLink}>Forgot Password?</Text>
                  </Pressable>
                )}
              </View>
              <View style={styles.passwordFieldRow}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor="#94a3b8"
                  secureTextEntry={!isPasswordVisible}
                  autoCapitalize="none"
                  style={[styles.textInput, styles.passwordFieldInput]}
                  accessibilityLabel="Password"
                />
                <Pressable
                  onPress={() => setIsPasswordVisible((prev) => !prev)}
                  hitSlop={10}
                  style={styles.passwordVisibilityBtn}
                  accessibilityRole="button"
                  accessibilityLabel={isPasswordVisible ? 'Hide password' : 'Show password'}
                  accessibilityState={{ selected: isPasswordVisible }}
                >
                  {isPasswordVisible ? (
                    <EyeOff size={18} color="#64748b" strokeWidth={2} />
                  ) : (
                    <Eye size={18} color="#64748b" strokeWidth={2} />
                  )}
                </Pressable>
              </View>
            </View>

            <Pressable
              onPress={handleAuth}
              style={styles.authSubmitButton}
              disabled={authLoading}
            >
              {authLoading ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text style={styles.authSubmitText}>
                  {isRegisterMode ? 'Create Store' : 'Sign In'}
                </Text>
              )}
            </Pressable>

            <View style={styles.authDividerRow}>
              <View style={styles.authDividerLine} />
              <Text style={styles.authDividerText}>OR</Text>
              <View style={styles.authDividerLine} />
            </View>

            {/* Same Firebase project as web (tedbuy-fb79a) — a buyer or
                seller who signed up with Google on web lands in that
                exact same TedBuy account here, not a new one. */}
            <Pressable
              onPress={handleGoogleAuth}
              style={styles.googleAuthButton}
              disabled={authLoading}
            >
              <Text style={styles.googleAuthButtonText}>Continue with Google</Text>
            </Pressable>

            <Pressable
              onPress={() => setIsRegisterMode(!isRegisterMode)}
              style={styles.toggleAuthModeBtn}
            >
              <Text style={styles.toggleAuthModeText}>
                {isRegisterMode
                  ? 'Already have an account? Sign In'
                  : "Don't have an account? Register Here"}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  /* Guest / Auth styling */
  authScroll: { paddingHorizontal: 24, paddingVertical: 32, alignItems: 'center' },
  authHeader: { alignItems: 'center', marginBottom: 24, marginTop: 12 },
  logoBadge: { width: 56, height: 56, borderRadius: 16, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  authTitle: { fontSize: 28, fontFamily: fonts.extrabold, color: '#ffffff' },
  orangeText: { color: '#ea580c' },
  authSubtitle: { fontSize: 13, color: '#94a3b8', textAlign: 'center', marginTop: 8, lineHeight: 18, paddingHorizontal: 16 },

  authCard: { backgroundColor: '#ffffff', borderRadius: 24, padding: 20, width: '100%', shadowColor: '#0f172a', shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, borderWidth: 1, borderColor: '#e2e8f0' },
  cardLabel: { fontSize: 11, fontFamily: fonts.extrabold, letterSpacing: 1.2, color: '#64748b', marginBottom: 16 },
  inputContainer: { marginBottom: 14 },
  inputLabel: { fontSize: 11, fontFamily: fonts.bold, color: '#1e293b', marginBottom: 6 },
  passwordLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  forgotPasswordLink: { fontSize: 10.5, fontFamily: fonts.bold, color: '#475569', marginBottom: 6 },
  textInput: { height: 46, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 14, fontSize: 14, color: '#0f172a', fontFamily: fonts.medium },
  passwordFieldRow: { position: 'relative', justifyContent: 'center' },
  passwordFieldInput: { paddingRight: 44 },
  passwordVisibilityBtn: { position: 'absolute', right: 4, height: 46, width: 40, alignItems: 'center', justifyContent: 'center' },
  authSubmitButton: { marginTop: 10, backgroundColor: '#0f172a', height: 46, borderRadius: 10, justifyContent: 'center', alignItems: 'center', shadowColor: '#0f172a', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  authSubmitText: { color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 14 },
  authDividerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, marginBottom: 4 },
  authDividerLine: { flex: 1, height: 1, backgroundColor: '#e2e8f0' },
  authDividerText: { marginHorizontal: 10, color: '#94a3b8', fontSize: 11, fontFamily: fonts.extrabold },
  googleAuthButton: { marginTop: 10, height: 46, borderRadius: 10, borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#ffffff', justifyContent: 'center', alignItems: 'center' },
  googleAuthButtonText: { color: '#0f172a', fontFamily: fonts.extrabold, fontSize: 14 },
  toggleAuthModeBtn: { marginTop: 14, alignSelf: 'center' },
  toggleAuthModeText: { color: '#2563eb', fontSize: 12.5, fontFamily: fonts.bold },
});
