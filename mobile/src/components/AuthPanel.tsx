import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Check, CheckCheck, Eye, EyeOff, Plus, UserCircle2, X } from 'lucide-react-native';
import { TedBuyLogo } from './TedBuyLogo';
import { signIn, signUp, signInWithGoogle, linkPendingGoogleWithPassword, clearPendingGoogleLink, resetPasswordEmail, getFriendlyAuthErrorMessage, sendRegistrationCode, verifyRegistrationCode } from '../firebase';
import { fonts } from '../theme';
import { TAB_BAR_HEIGHT } from '../context/TabBarVisibility';
import { validateEmailSecure, validatePasswordStrength, validateUsernameSecure, validatePhoneSecure } from '../utils/registrationValidation';
import { normalizeOtpInput, RESERVED_REGISTRATION_EMAIL, RESERVED_EMAIL_MESSAGE } from '../utils/authFlow';
import { isReservedStoreName } from '../types';
import { TERMS_SECTIONS, TERMS_TITLE, TERMS_SUBTITLE, TERMS_AGREE_LABEL, TERMS_WARNING_TITLE } from '../content/policies';

const RESEND_COOLDOWN_SECONDS = 60;

// Same clean-up the website's sign-up form applies to a typed email
// (Navbar.tsx cleanEmailString): drop smart quotes and any spaces.
function cleanEmailString(val: string): string {
  return val
    .trim()
    .replace(/[“”„‟″‶"']/g, '')
    .replace(/\s+/g, '');
}

type PendingRegistration = {
  username: string;
  email: string;
  phoneNumber: string;
  password: string;
  photoUri?: string;
};

// The signed-out Profile tab: sign in, sign up (with an emailed 6-digit code,
// same as the website), forgot password and the Google button. Rendered by
// ProfileScreen when there is no user.
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

  // Sign-up only (website's register form)
  const [phoneNumber, setPhoneNumber] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);
  const [photoUri, setPhotoUri] = useState('');
  const [isPreparingPhoto, setIsPreparingPhoto] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [registerError, setRegisterError] = useState('');

  // Code step. Pending details live only in this component's state.
  const [pending, setPending] = useState<PendingRegistration | null>(null);
  const [otpInput, setOtpInput] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isResendingCode, setIsResendingCode] = useState(false);

  // Google link step: set when Google sign-in found a password account
  // with the same email.
  const [googleLinkEmail, setGoogleLinkEmail] = useState<string | null>(null);
  const [linkPassword, setLinkPassword] = useState('');
  const [isLinkPasswordVisible, setIsLinkPasswordVisible] = useState(false);
  const [linkError, setLinkError] = useState('');

  // Never leave a held Google credential behind when this panel goes away.
  useEffect(() => () => clearPendingGoogleLink(), []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0)), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

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

  const handleSignIn = async () => {
    // Guards against a fast double-tap firing the request twice; the
    // button's `disabled` prop lags a render behind.
    if (authLoading) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      Alert.alert('Form Incomplete', 'Please fill out all required credentials.');
      return;
    }

    try {
      setAuthLoading(true);
      await signIn(trimmedEmail, password);
      setEmail('');
      setPassword('');
      setIsPasswordVisible(false);
      props.onSignedIn?.();
    } catch (err: any) {
      Alert.alert('Authentication Failure', getFriendlyAuthErrorMessage(err));
    } finally {
      setAuthLoading(false);
    }
  };

  // Same picker settings as ProfileScreen's handlePickNewAvatar. The photo is
  // only prepared here; signUp uploads it once the account exists.
  const handlePickRegisterPhoto = async () => {
    if (isPreparingPhoto) return;
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
      setIsPreparingPhoto(true);
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 400 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!manipulated.base64) throw new Error('Could not process image');
      setPhotoUri(`data:image/jpeg;base64,${manipulated.base64}`);
    } catch (err: any) {
      Alert.alert('Photo Not Added', err?.message || 'Could not use that photo. Please try another one.');
    } finally {
      setIsPreparingPhoto(false);
    }
  };

  // Website order and wording (Navbar.tsx handleAuthSubmit + AppContext
  // registerUser/initiateRegistration), then the code is emailed.
  const handleRegisterSubmit = async () => {
    if (authLoading) return;
    setRegisterError('');

    if (!agreeTerms) {
      setRegisterError('You must agree to the Terms of Service and Tedbuy Policies to create an account.');
      return;
    }
    const usernameCheck = validateUsernameSecure(username);
    if (!usernameCheck.isValid) {
      setRegisterError(usernameCheck.error || 'Invalid username.');
      return;
    }
    const cleanRegEmail = cleanEmailString(email);
    if (!cleanRegEmail) {
      setRegisterError('Email address is required to register.');
      return;
    }
    const emailCheck = validateEmailSecure(cleanRegEmail);
    if (!emailCheck.isValid) {
      setRegisterError(emailCheck.error || 'Invalid email address.');
      return;
    }
    const phoneCheck = validatePhoneSecure(phoneNumber);
    if (!phoneCheck.isValid) {
      setRegisterError(phoneCheck.error || 'Invalid phone number.');
      return;
    }
    const passwordCheck = validatePasswordStrength(password);
    if (!passwordCheck.isValid) {
      setRegisterError(passwordCheck.error || 'Weak password.');
      return;
    }
    if (password !== confirmPassword) {
      setRegisterError('Passwords do not match.');
      return;
    }
    const lowerEmail = cleanRegEmail.toLowerCase();
    if (lowerEmail === RESERVED_REGISTRATION_EMAIL) {
      setRegisterError(RESERVED_EMAIL_MESSAGE);
      return;
    }
    if (isReservedStoreName(username)) {
      setRegisterError('This store name is reserved by TedBuy.');
      return;
    }

    const details: PendingRegistration = {
      username: username.trim(),
      email: lowerEmail,
      phoneNumber: phoneNumber.trim(),
      password,
      photoUri: photoUri || undefined,
    };
    try {
      setAuthLoading(true);
      const res = await sendRegistrationCode(details.email, details.username);
      if (!res.success) {
        setRegisterError(res.error || 'Failed to send verification code. Please check your email and try again.');
        return;
      }
      setPending(details);
      setOtpInput('');
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      Alert.alert('Code Sent', 'A 6-digit verification code has been sent to your email address.');
    } catch (err: any) {
      setRegisterError(err?.message || 'Failed to initiate registration. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (!pending || isResendingCode || resendCooldown > 0) return;
    setIsResendingCode(true);
    setRegisterError('');
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    try {
      const res = await sendRegistrationCode(pending.email, pending.username);
      if (res.success) {
        Alert.alert('Code Sent', 'Verification code resent to your email.');
      } else {
        setRegisterError(res.error || 'Failed to resend code.');
      }
    } catch (err: any) {
      setRegisterError(err?.message || 'Failed to resend code.');
    } finally {
      setIsResendingCode(false);
    }
  };

  const handleChangeEmail = () => {
    // Back to the form with every field still filled in.
    setPending(null);
    setOtpInput('');
    setRegisterError('');
  };

  const handleVerifyAndCreate = async () => {
    if (!pending || authLoading) return;
    setRegisterError('');
    const cleanOtp = normalizeOtpInput(otpInput);
    if (cleanOtp.length !== 6) {
      setRegisterError('Please enter a valid 6-digit verification code.');
      return;
    }
    try {
      setAuthLoading(true);
      const verifyRes = await verifyRegistrationCode(pending.email, cleanOtp);
      if (!verifyRes.success) {
        setRegisterError(verifyRes.error || 'Invalid or expired verification code. Please check your code and try again.');
        return;
      }
      const { verified } = await signUp(pending);
      if (verified) {
        Alert.alert('Welcome to TedBuy! 🎉', 'Account registered and verified successfully! Welcome to TedBuy.');
      } else {
        Alert.alert(
          'Account Created',
          "Your account was created, but we couldn't confirm your email yet. Use 'Verify email' when asked to finish."
        );
      }
      setPending(null);
      setOtpInput('');
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      setUsername('');
      setPhoneNumber('');
      setPhotoUri('');
      setAgreeTerms(false);
      props.onSignedIn?.();
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
      const result = await signInWithGoogle();
      if (result.status === 'needs-password') {
        setGoogleLinkEmail(result.email);
        setLinkPassword('');
        setLinkError('');
      }
    } catch (err: any) {
      Alert.alert('Google Sign-In Failed', err?.message || 'Could not sign in with Google. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  const closeGoogleLink = () => {
    clearPendingGoogleLink();
    setGoogleLinkEmail(null);
    setIsRegisterMode(false);
    setLinkPassword('');
    setIsLinkPasswordVisible(false);
    setLinkError('');
  };

  const handleLinkGoogle = async () => {
    if (authLoading) return;
    if (!linkPassword) {
      setLinkError('Please enter your account password.');
      return;
    }
    try {
      setAuthLoading(true);
      await linkPendingGoogleWithPassword(linkPassword);
      closeGoogleLink();
      props.onSignedIn?.();
    } catch (err: any) {
      setLinkError(getFriendlyAuthErrorMessage(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const toggleMode = () => {
    setIsRegisterMode(!isRegisterMode);
    setRegisterError('');
    setPending(null);
    setOtpInput('');
    setIsPasswordVisible(false);
  };

  const renderError = () =>
    registerError ? (
      <View style={styles.errorBox} accessibilityRole="alert">
        <Text style={styles.errorText}>{registerError}</Text>
      </View>
    ) : null;

  const renderPasswordField = (opts: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    visible: boolean;
    toggle: () => void;
    right?: React.ReactNode;
  }) => (
    <View style={styles.inputContainer}>
      <View style={styles.passwordLabelRow}>
        <Text style={styles.inputLabel}>{opts.label}</Text>
        {opts.right}
      </View>
      <View style={styles.passwordFieldRow}>
        <TextInput
          value={opts.value}
          onChangeText={opts.onChange}
          placeholder={opts.placeholder}
          placeholderTextColor="#94a3b8"
          secureTextEntry={!opts.visible}
          autoCapitalize="none"
          style={[styles.textInput, styles.passwordFieldInput]}
          accessibilityLabel={opts.label}
        />
        <Pressable
          onPress={opts.toggle}
          hitSlop={10}
          style={styles.passwordVisibilityBtn}
          accessibilityRole="button"
          accessibilityLabel={opts.visible ? 'Hide password' : 'Show password'}
          accessibilityState={{ selected: opts.visible }}
        >
          {opts.visible ? (
            <EyeOff size={18} color="#64748b" strokeWidth={2} />
          ) : (
            <Eye size={18} color="#64748b" strokeWidth={2} />
          )}
        </Pressable>
      </View>
    </View>
  );

  const renderGoogleAndToggle = () => (
    <>
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

      <Pressable onPress={toggleMode} style={styles.toggleAuthModeBtn}>
        <Text style={styles.toggleAuthModeText}>
          {isRegisterMode
            ? 'Already have an account? Sign In'
            : "Don't have an account? Register Here"}
        </Text>
      </Pressable>
    </>
  );

  const renderCodeStep = (details: PendingRegistration) => (
    <>
      <View style={styles.otpHeader}>
        <View style={styles.otpIconCircle}>
          <CheckCheck size={24} color="#059669" strokeWidth={2.2} />
        </View>
        <Text style={styles.otpTitle}>Verify your Email</Text>
        <Text style={styles.otpSubtitle}>
          We sent a 6-digit verification code to <Text style={styles.otpEmail}>{details.email}</Text>.
        </Text>
      </View>

      <View style={styles.inputContainer}>
        <Text style={[styles.inputLabel, { textAlign: 'center' }]}>Enter 6-Digit Code *</Text>
        <TextInput
          value={otpInput}
          onChangeText={(v) => setOtpInput(normalizeOtpInput(v))}
          placeholder="000000"
          placeholderTextColor="#cbd5e1"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={6}
          style={[styles.textInput, styles.otpInput]}
          accessibilityLabel="Enter 6-Digit Code"
        />
      </View>

      <View style={styles.resendRow}>
        {resendCooldown > 0 ? (
          <Text style={styles.resendWaitText}>Resend in {resendCooldown}s</Text>
        ) : (
          <Pressable onPress={handleResendCode} disabled={isResendingCode} hitSlop={8}>
            <Text style={[styles.resendLink, isResendingCode && { opacity: 0.5 }]}>Resend Code</Text>
          </Pressable>
        )}
      </View>

      {renderError()}

      <Pressable
        onPress={handleVerifyAndCreate}
        style={[styles.authSubmitButton, styles.verifyButton]}
        disabled={authLoading}
      >
        {authLoading ? (
          <ActivityIndicator color="#ffffff" size="small" />
        ) : (
          <Text style={styles.authSubmitText}>Verify & Create Account</Text>
        )}
      </Pressable>

      <Pressable onPress={handleChangeEmail} style={styles.changeEmailButton} disabled={authLoading}>
        <Text style={styles.changeEmailText}>← Change Email / Go Back</Text>
      </Pressable>
    </>
  );

  const renderRegisterForm = () => (
    <>
      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>Username / Store Name *</Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder="e.g. Ama's Boutique, David Apparels"
          placeholderTextColor="#94a3b8"
          autoCapitalize="none"
          style={styles.textInput}
          accessibilityLabel="Username / Store Name"
        />
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>Email Address *</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="name@example.com"
          placeholderTextColor="#94a3b8"
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.textInput}
          accessibilityLabel="Email Address"
        />
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>Phone Number *</Text>
        <TextInput
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          placeholder="e.g. 0241234567 or +233241234567"
          placeholderTextColor="#94a3b8"
          keyboardType="phone-pad"
          style={styles.textInput}
          accessibilityLabel="Phone Number"
        />
      </View>

      {renderPasswordField({
        label: 'Account Password *',
        value: password,
        onChange: setPassword,
        placeholder: 'Minimum 8 characters with upper, lower, number, symbol',
        visible: isPasswordVisible,
        toggle: () => setIsPasswordVisible((prev) => !prev),
      })}

      {renderPasswordField({
        label: 'Confirm Password *',
        value: confirmPassword,
        onChange: setConfirmPassword,
        placeholder: 'Re-enter your password',
        visible: isConfirmPasswordVisible,
        toggle: () => setIsConfirmPasswordVisible((prev) => !prev),
      })}

      <View style={styles.inputContainer}>
        <View style={styles.passwordLabelRow}>
          <Text style={styles.inputLabel}>Profile Picture (Optional)</Text>
          <Text style={styles.photoHint}>Tap to select photo</Text>
        </View>
        <Pressable
          onPress={handlePickRegisterPhoto}
          style={styles.photoRow}
          accessibilityRole="button"
          accessibilityLabel="Profile Picture (Optional)"
        >
          <View style={styles.photoAvatarWrap}>
            <View style={styles.photoAvatar}>
              {isPreparingPhoto ? (
                <ActivityIndicator size="small" color="#64748b" />
              ) : photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.photoImage} />
              ) : (
                <UserCircle2 size={30} color="#94a3b8" strokeWidth={1.6} />
              )}
            </View>
            <View style={styles.photoPlusBadge}>
              <Plus size={11} color="#ffffff" strokeWidth={3} />
            </View>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.photoTitle}>Upload custom photo</Text>
            <Text style={styles.photoSubtitle}>Select any PNG, JPG, or WEBP picture from your computer or phone.</Text>
          </View>
          {photoUri && !isPreparingPhoto ? (
            <Pressable onPress={() => setPhotoUri('')} hitSlop={10} accessibilityLabel="Remove photo">
              <X size={16} color="#64748b" />
            </Pressable>
          ) : null}
        </Pressable>
      </View>

      <Pressable onPress={() => setShowTermsModal(true)} style={styles.readPoliciesRow}>
        <Text style={styles.readPoliciesText}>Read Tedbuy Policies</Text>
        <Text style={styles.readPoliciesBadge}>READ →</Text>
      </Pressable>

      <View style={styles.agreeRow}>
        <Pressable
          onPress={() => setAgreeTerms((prev) => !prev)}
          hitSlop={8}
          style={[styles.checkbox, agreeTerms && styles.checkboxChecked]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreeTerms }}
          accessibilityLabel="I have read and I agree to the Terms of Service and Tedbuy Policies"
        >
          {agreeTerms ? <Check size={13} color="#ffffff" strokeWidth={3} /> : null}
        </Pressable>
        <Text style={styles.agreeText} onPress={() => setAgreeTerms((prev) => !prev)}>
          I have read and I agree to the{' '}
          <Text style={styles.agreeLink} onPress={() => setShowTermsModal(true)}>Terms of Service</Text>
          {' '}and{' '}
          <Text style={styles.agreeLink} onPress={() => setShowTermsModal(true)}>Tedbuy Policies</Text>
          . *
        </Text>
      </View>

      {renderError()}

      <Pressable
        onPress={handleRegisterSubmit}
        style={styles.authSubmitButton}
        disabled={authLoading}
      >
        {authLoading ? (
          <ActivityIndicator color="#ffffff" size="small" />
        ) : (
          <Text style={styles.authSubmitText}>Create Account</Text>
        )}
      </Pressable>

      {renderGoogleAndToggle()}
    </>
  );

  const renderGoogleLink = (linkEmail: string) => (
    <>
      <Text style={styles.otpSubtitle}>
        An account already exists with this email address. Enter its password to link Google.
      </Text>
      {linkEmail ? <Text style={[styles.otpSubtitle, styles.otpEmail, { marginBottom: 12 }]}>{linkEmail}</Text> : null}
      {linkError ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{linkError}</Text>
        </View>
      ) : null}
      {renderPasswordField({
        label: 'Account Password',
        value: linkPassword,
        onChange: (v) => { setLinkPassword(v); setLinkError(''); },
        placeholder: 'Enter your account password',
        visible: isLinkPasswordVisible,
        toggle: () => setIsLinkPasswordVisible((prev) => !prev),
      })}
      <Pressable onPress={handleLinkGoogle} style={styles.authSubmitButton} disabled={authLoading}>
        {authLoading ? (
          <ActivityIndicator color="#ffffff" size="small" />
        ) : (
          <Text style={styles.authSubmitText}>Confirm and Link Google</Text>
        )}
      </Pressable>
      <Pressable onPress={closeGoogleLink} style={styles.toggleAuthModeBtn}>
        <Text style={styles.toggleAuthModeText}>Cancel and return to sign in</Text>
      </Pressable>
    </>
  );

  const renderSignIn = () => (
    <>
      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>Email Address or Phone Number</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email, username or phone number"
          placeholderTextColor="#94a3b8"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.textInput}
          accessibilityLabel="Email Address or Phone Number"
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
          {renderPasswordField({
            label: 'Password',
            value: password,
            onChange: setPassword,
            placeholder: '••••••••',
            visible: isPasswordVisible,
            toggle: () => setIsPasswordVisible((prev) => !prev),
            right: (
              <Pressable onPress={() => setShowForgotPassword(true)}>
                <Text style={styles.forgotPasswordLink}>Forgot Password?</Text>
              </Pressable>
            ),
          })}

          <Pressable
            onPress={handleSignIn}
            style={styles.authSubmitButton}
            disabled={authLoading}
          >
            {authLoading ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.authSubmitText}>Sign In</Text>
            )}
          </Pressable>

          {renderGoogleAndToggle()}
        </>
      )}
    </>
  );

  let termsNumber = 0;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
    <ScrollView
      contentContainerStyle={[styles.authScroll, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
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

        {googleLinkEmail !== null
          ? renderGoogleLink(googleLinkEmail)
          : isRegisterMode
            ? (pending ? renderCodeStep(pending) : renderRegisterForm())
            : renderSignIn()}
      </View>
    </ScrollView>

    <Modal
      visible={showTermsModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowTermsModal(false)}
    >
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { paddingBottom: 16 + insets.bottom }]}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>{TERMS_TITLE}</Text>
              <Text style={styles.modalSubtitle}>{TERMS_SUBTITLE}</Text>
            </View>
            <Pressable onPress={() => setShowTermsModal(false)} hitSlop={10} style={styles.modalCloseBtn} accessibilityLabel="Close Terms">
              <X size={18} color="#64748b" />
            </Pressable>
          </View>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 8 }}>
            {TERMS_SECTIONS.map((section) => {
              if (section.title === TERMS_WARNING_TITLE) {
                return (
                  <View key={section.title} style={styles.termsWarning}>
                    <Text style={styles.termsWarningTitle}>⚠️ {section.title}</Text>
                    <Text style={styles.termsWarningBody}>{section.body}</Text>
                  </View>
                );
              }
              termsNumber += 1;
              return (
                <View key={section.title} style={styles.termsSection}>
                  <View style={styles.termsHeadingRow}>
                    <View style={styles.termsNumber}>
                      <Text style={styles.termsNumberText}>{termsNumber}</Text>
                    </View>
                    <Text style={styles.termsHeading}>{section.title.toUpperCase()}</Text>
                  </View>
                  <Text style={styles.termsBody}>{section.body}</Text>
                </View>
              );
            })}
          </ScrollView>
          <Pressable
            style={styles.modalAgreeRow}
            onPress={() => {
              const next = !agreeTerms;
              setAgreeTerms(next);
              if (next) setTimeout(() => setShowTermsModal(false), 180);
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreeTerms }}
          >
            <View style={[styles.checkbox, agreeTerms && styles.checkboxChecked]}>
              {agreeTerms ? <Check size={13} color="#ffffff" strokeWidth={3} /> : null}
            </View>
            <Text style={styles.modalAgreeText}>{TERMS_AGREE_LABEL}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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

  errorBox: { backgroundColor: '#fff1f2', borderWidth: 1, borderColor: '#fecdd3', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 4, marginBottom: 4 },
  errorText: { color: '#be123c', fontSize: 12, fontFamily: fonts.bold, lineHeight: 17 },

  /* Sign-up: profile picture, policies, terms checkbox */
  photoHint: { fontSize: 10, color: '#94a3b8', fontFamily: fonts.medium, marginBottom: 6 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, padding: 12 },
  photoAvatarWrap: { position: 'relative' },
  photoAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#cbd5e1', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  photoImage: { width: '100%', height: '100%' },
  photoPlusBadge: { position: 'absolute', bottom: -2, right: -2, width: 20, height: 20, borderRadius: 10, backgroundColor: '#0f172a', borderWidth: 1.5, borderColor: '#ffffff', justifyContent: 'center', alignItems: 'center' },
  photoTitle: { fontSize: 11.5, fontFamily: fonts.bold, color: '#1e293b', marginBottom: 2 },
  photoSubtitle: { fontSize: 10.5, color: '#64748b', lineHeight: 14 },
  readPoliciesRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginBottom: 12 },
  readPoliciesText: { fontSize: 11.5, fontFamily: fonts.bold, color: '#1e293b' },
  readPoliciesBadge: { fontSize: 10, fontFamily: fonts.extrabold, color: '#4f46e5', letterSpacing: 0.8, backgroundColor: '#eef2ff', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, overflow: 'hidden' },
  agreeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9', marginBottom: 8 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#cbd5e1', backgroundColor: '#ffffff', justifyContent: 'center', alignItems: 'center', marginTop: 1 },
  checkboxChecked: { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  agreeText: { flex: 1, fontSize: 12, color: '#475569', lineHeight: 17 },
  agreeLink: { fontFamily: fonts.extrabold, color: '#020617', textDecorationLine: 'underline' },

  /* Sign-up: code step */
  otpHeader: { alignItems: 'center', marginBottom: 16 },
  otpIconCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#d1fae5', justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  otpTitle: { fontSize: 18, fontFamily: fonts.extrabold, color: '#0f172a' },
  otpSubtitle: { fontSize: 12, color: '#64748b', textAlign: 'center', marginTop: 4, lineHeight: 17 },
  otpEmail: { fontFamily: fonts.bold, color: '#1e293b' },
  otpInput: { height: 54, textAlign: 'center', fontSize: 24, letterSpacing: 10, fontFamily: fonts.bold, backgroundColor: '#ffffff' },
  resendRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 2, marginBottom: 6 },
  resendWaitText: { fontSize: 12, color: '#94a3b8', fontFamily: fonts.medium },
  resendLink: { fontSize: 12, color: '#059669', fontFamily: fonts.extrabold },
  verifyButton: { backgroundColor: '#059669', shadowColor: '#059669' },
  changeEmailButton: { marginTop: 10, height: 42, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc', justifyContent: 'center', alignItems: 'center' },
  changeEmailText: { fontSize: 12, fontFamily: fonts.bold, color: '#64748b' },

  /* Terms modal */
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#ffffff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 18, maxHeight: '88%' },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingBottom: 12, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  modalTitle: { fontSize: 16, fontFamily: fonts.extrabold, color: '#020617' },
  modalSubtitle: { fontSize: 11, color: '#64748b', fontFamily: fonts.medium, marginTop: 2 },
  modalCloseBtn: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f1f5f9' },
  termsSection: { marginBottom: 14 },
  termsHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 },
  termsNumber: { width: 20, height: 20, borderRadius: 6, backgroundColor: '#eef2ff', justifyContent: 'center', alignItems: 'center' },
  termsNumberText: { fontSize: 10, fontFamily: fonts.extrabold, color: '#4338ca' },
  termsHeading: { flex: 1, fontSize: 12, fontFamily: fonts.extrabold, color: '#0f172a', letterSpacing: 0.6 },
  termsBody: { fontSize: 11.5, color: '#475569', lineHeight: 17, paddingLeft: 26 },
  termsWarning: { backgroundColor: '#fff1f2', borderWidth: 1, borderColor: '#ffe4e6', borderRadius: 12, padding: 14, marginBottom: 14 },
  termsWarningTitle: { fontSize: 11, fontFamily: fonts.extrabold, color: '#9f1239', letterSpacing: 0.4, marginBottom: 3 },
  termsWarningBody: { fontSize: 11, fontFamily: fonts.bold, color: '#be123c', lineHeight: 16 },
  modalAgreeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8, paddingVertical: 12, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#f1f5f9', borderRadius: 12 },
  modalAgreeText: { fontSize: 12, fontFamily: fonts.bold, color: '#1e293b' },
});
