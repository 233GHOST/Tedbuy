import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { TedBuyLogo } from '../components/TedBuyLogo';
import { BackButton } from '../components/BackButton';
import { BoostModal } from '../components/BoostModal';
import { auth, observeAuthState, signIn, signUp, signInWithGoogle, watchProducts, watchUsers, fetchUserById, deleteProductMobile, updateProduct, updateUserProfile, uploadMediaToCloudinaryMobile, resetPasswordEmail, getFriendlyAuthErrorMessage, logOut, getDropshipStatus, listingErrorTitle } from '../firebase';
import * as WebBrowser from 'expo-web-browser';
import {
  Users as UsersIcon,
  Bookmark,
  Eye,
  EyeOff,
  Flame,
  Clock,
  Edit2,
  Tag,
  MapPin,
  Trash2,
  ShieldCheck,
  UserCircle2,
  Bell,
  Store,
  Truck,
  HelpCircle,
  ChevronRight,
  Settings as SettingsIcon,
  LogOut,
  ArrowLeft,
  Camera,
  Check,
  Share2,
  ShoppingBag,
  Search,
  X,
  Plus,
} from 'lucide-react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { fonts } from '../theme';
import { TAB_BAR_HEIGHT, useTabBarVisibility } from '../context/TabBarVisibility';
import { isBoostActive, getBoostEndDate } from '../utils/boost';
import { formatProductPrice } from '../utils/formatPrice';
import { isUserAdmin, isUserVerified } from '../types';
import { useSavedProducts } from '../context/SavedProducts';
import { resolveProductImageUri } from '../utils/productImage';
import { CategoryImagePlaceholder } from '../components/CategoryImagePlaceholder';

export function ProfileScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  // See SearchScreen.tsx for why every tab needs this: the tab bar's
  // hide/show state is one shared value across all tabs, so a screen that
  // never resets it on focus can get stuck showing no tab bar at all.
  const { resetTabBar } = useTabBarVisibility();
  useEffect(() => {
    resetTabBar();
    const unsub = navigation?.addListener?.('focus', resetTabBar);
    return unsub;
  }, [navigation, resetTabBar]);
  const [user, setUser] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [userProfile, setUserProfile] = useState<any>(null);
  // Own-profile Followers/Following — was entirely missing on mobile (the
  // same feature already exists for viewing OTHER sellers in
  // SellerProfileScreen.tsx; this ports that same pattern for yourself).
  // The counts here drive the header stat row; tapping either stat now
  // navigates to a dedicated FollowersFollowing screen instead of opening
  // an in-page modal.
  const [allUsers, setAllUsers] = useState<any[]>([]);

  // Dashboard header avatar — change/remove directly from here, reusing the
  // exact same pick/crop/upload logic ProfileStoreSettingsScreen already
  // uses for the same field (userProfile.photoUrl via updateUserProfile).
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const handlePickNewAvatar = async () => {
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
      const updated = await updateUserProfile({ photoUrl: uploadedUrl });
      setUserProfile(updated);
    } catch (err: any) {
      Alert.alert('Upload Failed', err?.message || 'Could not upload your photo. Please try again.');
    } finally {
      setIsUploadingAvatar(false);
    }
  };
  const handleRemoveAvatar = async () => {
    try {
      setIsUploadingAvatar(true);
      const updated = await updateUserProfile({ photoUrl: '' });
      setUserProfile(updated);
    } catch (err: any) {
      Alert.alert('Could Not Remove Photo', err?.message || 'Please try again.');
    } finally {
      setIsUploadingAvatar(false);
    }
  };
  const handleAvatarPress = () => {
    if (isUploadingAvatar) return;
    const options: any[] = [
      { text: 'Change Photo', onPress: handlePickNewAvatar },
    ];
    if (userProfile?.photoUrl) {
      options.push({ text: 'Remove Photo', style: 'destructive', onPress: handleRemoveAvatar });
    }
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Profile Photo', undefined, options);
  };

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

  const [dropshipEnabled, setDropshipEnabled] = useState(false);
  useEffect(() => {
    if (!user) { setDropshipEnabled(false); return; }
    let active = true;
    getDropshipStatus().then((on) => { if (active) setDropshipEnabled(on); }).catch(() => {});
    return () => { active = false; };
  }, [user]);

  // Tab state for Logged In User: matches web's 3-way segment navigation
  const [activeTab, setActiveTab] = useState<'dashboard' | 'saved' | 'settings'>('dashboard');
  // Persistent-tab gotcha (see SellScreen.tsx's editProduct for the same
  // pattern): the Profile tab stays mounted across tab switches, so reading
  // route.params directly would leave activeTab stuck on whatever was last
  // requested. Consume the param once, clear it, and reset to Dashboard if
  // the user taps the Profile tab icon again mid-session.
  useEffect(() => {
    if (route?.params?.tab) {
      setActiveTab(route.params.tab);
      navigation.setParams({ tab: undefined });
    }
  }, [route?.params?.tab]);
  useEffect(() => {
    const unsub = navigation?.addListener?.('tabPress', () => {
      setActiveTab('dashboard');
    });
    return unsub;
  }, [navigation]);
  // Switching the internal Dashboard/Saved/Settings toggle doesn't fire a
  // navigation focus event (it's the same screen), so the on-focus reset
  // above doesn't cover it — explicitly reset here too.
  useEffect(() => {
    resetTabBar();
  }, [activeTab, resetTabBar]);

  // Settings is an internal tab toggle, not a pushed navigation screen, so
  // the app-wide swipe-to-go-back (navigation/index.tsx) doesn't reach it —
  // there's no previous screen to pop to, just this same screen's other
  // tab. Mirrors HomeScreen.tsx's grid/video swipe gesture exactly:
  // activeOffsetX/failOffsetY lets a horizontal drag win only once it's
  // unambiguously horizontal, so it never fights the settings list's own
  // vertical scroll.
  const settingsBackGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-15, 15])
    .onEnd((e: any) => {
      if (e.translationX > 60 && e.velocityX > 400) {
        setActiveTab('dashboard');
      }
    });

  // Boost purchase — was entirely missing on mobile (only passive boost
  // badges existed, no way to actually buy one from a phone).
  const [boostingProduct, setBoostingProduct] = useState<any>(null);
  const [togglingSoldId, setTogglingSoldId] = useState<string | null>(null);

  // Matches web's SellerDashboard "Mark as Sold" / "Mark as Available" toggle.
  const handleToggleSold = async (item: any) => {
    // The Pressable's own `disabled={togglingSoldId === item.id}` lags a
    // render behind (same lag handleAuth explicitly guards against
    // elsewhere in this file), so a fast double-tap could fire two
    // concurrent updateProduct calls before the first re-render lands.
    if (togglingSoldId) return;
    setTogglingSoldId(item.id);
    const nextSold = !item.isSold;
    try {
      // updateProduct now always throws rather than silently resolving
      // to undefined on a load failure (mobile/src/firebase.ts), so
      // `updated` is guaranteed real here -- no fallback-to-optimistic
      // needed, which previously masked a failed update as a success.
      const updated = await updateProduct(item.id, {
        isSold: nextSold,
        status: nextSold ? 'sold' : 'active',
        soldAt: nextSold ? new Date().toISOString() : null
      });
      setProducts((prev) => prev.map((p) => (p.id === item.id ? { ...p, ...updated } : p)));
    } catch (err: any) {
      Alert.alert(listingErrorTitle(err, 'Error'), err.message || 'Could not update listing status.');
    } finally {
      setTogglingSoldId(null);
    }
  };

  // Populates the Edit Profile form from the real Supabase-backed profile,
  // not the raw Firebase Auth user object. Previously read straight off
  // `user` (Firebase Auth) — which has no username/phoneNumber(custom)/
  // whatsAppNumber/photoUrl/role/followingSellers fields at all, so these
  // always evaluated to '' — meaning the form always LOOKED blank even when
  // a phone/WhatsApp number was already saved, and hitting Save without
  // re-typing them would silently wipe out the real saved values (since
  // apiFetch treats an explicit '' as "clear this field", not "unchanged").
  useEffect(() => {
    const unsubscribeAuth = observeAuthState((currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        fetchUserById(currentUser.uid).then((profile) => {
          if (profile) setUserProfile(profile);
        });
      } else {
        setUserProfile(null);
      }
    });

    const unsubscribeProducts = watchProducts((result) => {
      setProducts(result);
    });

    const unsubscribeUsers = watchUsers((result) => {
      setAllUsers(result);
    });

    return () => {
      unsubscribeAuth();
      unsubscribeProducts();
      unsubscribeUsers();
    };
  }, []);

  // watchProducts is a one-shot fetch, not a live subscription — so
  // "My Classified Listings" only ever reflected whatever the state was at
  // the moment this screen first mounted. ProductDetailScreen's own Mark as
  // Sold toggle only updates its own local product state, not this screen's
  // — and since ProductDetailScreen is pushed on top of this one (this
  // screen stays mounted underneath, never remounting), navigating back
  // here after toggling sold status elsewhere showed the exact same stale
  // "Mark Sold" state the list had on first load, even though the product's
  // own detail page had already confirmed "Sold". Re-running the fetch on
  // focus keeps this list honest whenever the user actually looks at it.
  useEffect(() => {
    const unsubscribeFocus = navigation.addListener('focus', () => {
      // noCache: true — this refresh exists specifically to catch a change
      // that just happened elsewhere (e.g. Mark as Sold on the product's own
      // detail page); trusting the ordinary ~60s server cache here would
      // defeat the point on a focus that lands within that window.
      //
      // The `failed` flag was previously discarded -- watchProducts resolves
      // to [] on a transient server failure indistinguishably from a
      // genuinely empty catalog, so any hiccup on focus wiped the user's
      // real "My Classified Listings"/"Saved Bookmarks" (both derived from
      // this same `products` state) down to their empty states with no
      // error shown, even though nothing had actually changed server-side.
      watchProducts((result, failed) => {
        if (failed) return;
        setProducts(result);
      }, true);
    });
    return unsubscribeFocus;
  }, [navigation]);

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
        await signUp(trimmedEmail, trimmedPassword, trimmedUsername);
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

  const handleDeleteAd = (productId: string, title: string) => {
    Alert.alert(
      'Delete Listing',
      `Are you sure you want to permanently remove "${title}" from TedBuy? This action is irreversible.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Permanently',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProductMobile(productId);
              setProducts((prev) => prev.filter((p) => p.id !== productId));
              Alert.alert('Listing Deleted', 'Your classified ad has been removed.');
            } catch (err: any) {
              Alert.alert(listingErrorTitle(err, 'Error'), err.message || 'Could not delete product.');
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
            // logOut() -> firebase.ts's signOut(auth) call is unguarded
            // (only the Google-SDK signOut inside it is try/caught) -- a
            // rejection here previously became an unhandled rejection with
            // the dialog already closed and no indication sign-out failed,
            // leaving the user still logged in with nothing telling them
            // why.
            try {
              await logOut();
              setActiveTab('dashboard');
            } catch (err: any) {
              Alert.alert('Sign Out Failed', err?.message || 'Could not sign out. Please try again.');
            }
          },
        },
      ]
    );
  };

  // Filter products for Dashboard with batch-14 pagination & infinite scroll
  const BATCH_SIZE = 14;
  const [visibleListingCount, setVisibleListingCount] = useState(BATCH_SIZE);
  const myListings = user ? products.filter((p) => p.sellerId === user.uid) : [];
  
  // Search query & status filter chips for user's ads (matches web ProfileSettings.tsx exactly)
  const [listingSearchQuery, setListingSearchQuery] = useState('');
  const [listingFilter, setListingFilter] = useState<'all' | 'active' | 'boosted' | 'sold'>('all');

  const filteredMyListings = useMemo(() => {
    return myListings.filter((item) => {
      if (listingFilter === 'active' && item.isSold) return false;
      if (listingFilter === 'sold' && !item.isSold) return false;
      if (listingFilter === 'boosted' && !isBoostActive(item)) return false;

      if (listingSearchQuery.trim()) {
        const q = listingSearchQuery.trim().toLowerCase();
        const titleMatch = (item.title || '').toLowerCase().includes(q);
        const descMatch = (item.description || '').toLowerCase().includes(q);
        const catMatch = (item.category || '').toLowerCase().includes(q);
        const brandMatch = (item.brand || '').toLowerCase().includes(q);
        const locMatch = (item.location || '').toLowerCase().includes(q);
        if (!titleMatch && !descMatch && !catMatch && !brandMatch && !locMatch) return false;
      }
      return true;
    });
  }, [myListings, listingFilter, listingSearchQuery]);

  const displayedListings = filteredMyListings.slice(0, visibleListingCount);

  // Total views across all seller listings (matches web's totalViews calculation)
  const totalViews = useMemo(() => {
    return myListings.reduce((sum, p) => sum + Number(p.viewsCount || p.views || 0), 0);
  }, [myListings]);

  const activeAdsCount = myListings.filter((p) => !p.isSold).length;
  const boostedAdsCount = myListings.filter((p) => isBoostActive(p)).length;
  const soldAdsCount = myListings.filter((p) => p.isSold).length;

  const handleShareStore = async () => {
    if (!user) return;
    const storeName = userProfile?.displayName || userProfile?.username || user.displayName || 'Seller Store';
    const storeUrl = `https://tedbuy.store/#/seller/${user.uid}`;
    try {
      await Share.share({
        title: `${storeName} on TedBuy`,
        message: `Check out ${storeName}'s storefront on TedBuy Ghana!\n\n${storeUrl}`,
        url: storeUrl,
      });
    } catch {
      // User cancelled
    }
  };

  // Matches web's real bookmark model (currentUser.savedProductIds) — was
  // reading product.likedUserIds, an unrelated field the bookmark button
  // never actually wrote to (see firebase.ts's toggleSaveProductRemote).
  // Reads the shared SavedProducts context (not userProfile directly) so a
  // bookmark toggled from any other screen shows up here immediately.
  const { savedProductIds: savedProductIdList } = useSavedProducts();
  const savedBookmarks = products.filter((p) => savedProductIdList.includes(p.id));
  // Matches web's sellerFollowers/sellerFollowing for the current user's own profile.
  const myFollowers = user ? allUsers.filter((u) => Array.isArray(u.followingSellers) && u.followingSellers.includes(user.uid)) : [];
  const myFollowing = userProfile ? allUsers.filter((u) => Array.isArray(userProfile.followingSellers) && userProfile.followingSellers.includes(u.id)) : [];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* 1. Guest Screen / Sign-in / Register form */}
      {!user ? (
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
      ) : (
        /* 2. Logged In User Dashboard Screen — Exact pixel alignment with web ProfileSettings.tsx */
        <View style={styles.container}>
          {/* Top Brand Header Bar: Dark Navy (#0f172a) with TedBuy Logo & Bookmark */}
          <View style={styles.topHeaderContainer}>
            <View style={styles.topBar}>
              <Pressable
                style={styles.topBarLeft}
                onPress={() => navigation.navigate('Home')}
              >
                <View style={styles.brandBadge}>
                  <TedBuyLogo size={24} />
                </View>
                <Text style={styles.brandName}>
                  Ted<Text style={styles.brandNameAccent}>Buy</Text>
                </Text>
              </Pressable>
              <View style={styles.topBarRight}>
                <Pressable
                  style={styles.headerBookmarkBtn}
                  onPress={() => navigation.navigate('SavedProducts')}
                >
                  <Bookmark size={18} color="#ffffff" strokeWidth={2.2} fill={savedBookmarks.length ? '#fda4af' : 'none'} />
                  {savedBookmarks.length > 0 && (
                    <View style={styles.headerBookmarkBadge}>
                      <Text style={styles.headerBookmarkBadgeText}>{savedBookmarks.length}</Text>
                    </View>
                  )}
                </Pressable>
              </View>
            </View>
          </View>

          {/* Sub-Header Bar: "← Marketplace" & Section Label ("MY PROFILE" / "SETTINGS") */}
          <View style={styles.subHeaderRow}>
            <Pressable
              onPress={() => {
                if (activeTab !== 'dashboard') {
                  setActiveTab('dashboard');
                } else {
                  navigation.navigate('Home');
                }
              }}
              style={styles.marketplaceBackBtn}
            >
              <ArrowLeft size={16} color="#334155" strokeWidth={2.4} />
              <Text style={styles.marketplaceBackText}>Marketplace</Text>
            </Pressable>
            <Text style={styles.subHeaderTitle}>
              {activeTab === 'settings' ? 'SETTINGS' : activeTab === 'saved' ? 'SAVED DEALS' : 'MY PROFILE'}
            </Text>
          </View>

          <ScrollView
            contentContainerStyle={[styles.mainScrollContent, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 16 }]}
            showsVerticalScrollIndicator={false}
            onScroll={({ nativeEvent }) => {
              if (activeTab !== 'dashboard') return;
              const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
              const isCloseToBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 250;
              if (isCloseToBottom && visibleListingCount < filteredMyListings.length) {
                setVisibleListingCount((prev) => prev + BATCH_SIZE);
              }
            }}
            scrollEventThrottle={400}
          >
            {/* Clean White Profile Card (Avatar, Verified Badge, Email, Partner Tag, Gear, 4 Stats, Bio, Actions) */}
            <View style={styles.profileCard}>
              {/* Profile Top Row */}
              <View style={styles.profileMainRow}>
                {/* Avatar with Camera Badge */}
                <View style={styles.avatarWrapper}>
                  <Pressable
                    onPress={handleAvatarPress}
                    style={styles.avatarContainer}
                    disabled={isUploadingAvatar}
                    accessibilityRole="button"
                    accessibilityLabel="Change profile photo"
                  >
                    {isUploadingAvatar ? (
                      <ActivityIndicator size="small" color="#ea580c" />
                    ) : userProfile?.photoUrl ? (
                      <Image source={{ uri: userProfile.photoUrl }} style={styles.avatarImage} />
                    ) : (
                      <Text style={styles.avatarInitialText}>
                        {String(userProfile?.displayName || user.displayName || user.email || 'T').substring(0, 2).toUpperCase()}
                      </Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={handleAvatarPress}
                    style={styles.cameraBadge}
                    disabled={isUploadingAvatar}
                    accessibilityRole="button"
                    accessibilityLabel="Change photo"
                  >
                    <Camera size={11} color="#ffffff" strokeWidth={2.5} />
                  </Pressable>
                </View>

                {/* Name, Email, Authorized Partner Badge */}
                <View style={styles.profileInfoCol}>
                  <View style={styles.nameRow}>
                    <Text style={styles.profileDisplayName} numberOfLines={1}>
                      {userProfile?.displayName || userProfile?.username || user.displayName || user.email?.split('@')[0] || 'TedBuy Partner'}
                    </Text>
                    {isUserVerified(userProfile || user) && (
                      <View style={styles.verifiedCheckBadge}>
                        <Check size={9} color="#ea580c" strokeWidth={3.5} />
                      </View>
                    )}
                  </View>
                  <Text style={styles.profileEmail} numberOfLines={1}>
                    {user.email}
                  </Text>
                  <View style={styles.badgeRow}>
                    <View style={styles.partnerBadge}>
                      <Text style={styles.partnerBadgeText}>✓ Authorized Partner</Text>
                    </View>
                    {isUserAdmin(userProfile) && (
                      <View style={styles.adminBadge}>
                        <Text style={styles.adminBadgeText}>Admin</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Settings Gear Toggle */}
                <Pressable
                  onPress={() => {
                    setActiveTab((prev) => (prev === 'settings' ? 'dashboard' : 'settings'));
                  }}
                  style={[
                    styles.settingsGearBtn,
                    activeTab === 'settings' && styles.settingsGearBtnActive,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Settings"
                >
                  <SettingsIcon
                    size={18}
                    color={activeTab === 'settings' ? '#ffffff' : '#475569'}
                    strokeWidth={2.2}
                  />
                </Pressable>
              </View>

              {/* 4-Column Stats Row: Following, Followers, Views, Saved */}
              <View style={styles.statsRow}>
                <Pressable
                  onPress={() => navigation.navigate('FollowersFollowing', { userId: user.uid, initialTab: 'following' })}
                  style={styles.statCol}
                >
                  <Text style={styles.statNumber}>{myFollowing.length}</Text>
                  <Text style={styles.statLabel}>Following</Text>
                </Pressable>

                <Pressable
                  onPress={() => navigation.navigate('FollowersFollowing', { userId: user.uid, initialTab: 'followers' })}
                  style={styles.statCol}
                >
                  <Text style={styles.statNumber}>{myFollowers.length}</Text>
                  <Text style={styles.statLabel}>Followers</Text>
                </Pressable>

                <View style={styles.statCol}>
                  <View style={styles.viewsNumberRow}>
                    <Eye size={12} color="#ea580c" />
                    <Text style={styles.statNumber}>{totalViews}</Text>
                  </View>
                  <Text style={styles.statLabel}>Views</Text>
                </View>

                <Pressable
                  onPress={() => setActiveTab('saved')}
                  style={styles.statCol}
                >
                  <Text style={styles.statNumber}>{savedBookmarks.length}</Text>
                  <Text style={styles.statLabel}>Saved</Text>
                </Pressable>
              </View>

              {/* Store Bio Row */}
              {userProfile?.bio ? (
                <View style={styles.bioContainer}>
                  <Text style={styles.bioText} numberOfLines={2}>
                    "{userProfile.bio}"
                  </Text>
                  <Pressable
                    onPress={() => navigation.navigate('ProfileStoreSettings')}
                    style={styles.bioActionBtn}
                  >
                    <Text style={styles.bioActionBtnText}>Edit</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.bioContainer}>
                  <Text style={styles.bioPlaceholderText}>No store bio added yet</Text>
                  <Pressable
                    onPress={() => navigation.navigate('ProfileStoreSettings')}
                    style={styles.bioActionBtn}
                  >
                    <Text style={styles.bioActionBtnText}>+ Add Bio</Text>
                  </Pressable>
                </View>
              )}

              {/* Quick Action Buttons: View Storefront & Share Store */}
              <View style={styles.quickActionsRow}>
                <Pressable
                  onPress={() => navigation.navigate('SellerProfile', { sellerId: user.uid })}
                  style={styles.quickActionBtn}
                >
                  <Store size={15} color="#0f172a" strokeWidth={2.2} />
                  <Text style={styles.quickActionBtnText}>View Storefront</Text>
                </Pressable>

                <Pressable
                  onPress={handleShareStore}
                  style={styles.quickActionBtn}
                >
                  <Share2 size={15} color="#475569" strokeWidth={2.2} />
                  <Text style={styles.quickActionBtnText}>Share Store</Text>
                </Pressable>
              </View>
            </View>

            {/* Segmented Navigation Tabs: [My Ads (12)], [Saved (0)], [Settings] */}
            <View style={styles.segmentControl}>
              <Pressable
                onPress={() => setActiveTab('dashboard')}
                style={[
                  styles.segmentTab,
                  activeTab === 'dashboard' && styles.segmentTabActive,
                ]}
              >
                <ShoppingBag size={14} color={activeTab === 'dashboard' ? '#0f172a' : '#64748b'} strokeWidth={2.2} />
                <Text style={[styles.segmentTabText, activeTab === 'dashboard' && styles.segmentTabTextActive]}>
                  My Ads ({myListings.length})
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setActiveTab('saved')}
                style={[
                  styles.segmentTab,
                  activeTab === 'saved' && styles.segmentTabActive,
                ]}
              >
                <Bookmark size={14} color={activeTab === 'saved' ? '#0f172a' : '#64748b'} strokeWidth={2.2} />
                <Text style={[styles.segmentTabText, activeTab === 'saved' && styles.segmentTabTextActive]}>
                  Saved ({savedBookmarks.length})
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setActiveTab('settings')}
                style={[
                  styles.segmentTab,
                  activeTab === 'settings' && styles.segmentTabActive,
                ]}
              >
                <SettingsIcon size={14} color={activeTab === 'settings' ? '#0f172a' : '#64748b'} strokeWidth={2.2} />
                <Text style={[styles.segmentTabText, activeTab === 'settings' && styles.segmentTabTextActive]}>
                  Settings
                </Text>
              </Pressable>
            </View>

            {/* TAB 1: MY CLASSIFIED LISTINGS */}
            {activeTab === 'dashboard' && (
              <View style={styles.tabContentContainer}>
                {dropshipEnabled && (
                  <Pressable
                    onPress={() => {
                      WebBrowser.openBrowserAsync('https://www.tedbuy.store/dropship').catch(() => {
                        Alert.alert('Could Not Open Dropship', 'Please try again in a moment.');
                      });
                    }}
                    style={[styles.settingsMenuGroup, styles.settingsMenuRow, { borderBottomWidth: 0, marginHorizontal: 14, marginBottom: 14 }]}
                  >
                    <View style={styles.settingsItemLeft}>
                      <View style={styles.settingsMenuIconBadge}>
                        <Truck size={17} color="#0f172a" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.settingsItemTitle}>TedBuy Dropship</Text>
                        <Text style={styles.settingsItemSubtitle}>Supply products or sell without stock</Text>
                      </View>
                    </View>
                    <ChevronRight size={18} color="#94a3b8" />
                  </Pressable>
                )}

                {/* Section Header */}
                <View style={styles.listingsHeaderRow}>
                  <Text style={styles.listingsHeading}>MY CLASSIFIED LISTINGS</Text>
                  <Text style={styles.listingsSubheading}>
                    Showing {displayedListings.length} of {filteredMyListings.length} ads • {totalViews} views
                  </Text>
                </View>

                {/* Search Input Bar */}
                {myListings.length > 0 && (
                  <View style={styles.searchBarContainer}>
                    <Search size={14} color="#94a3b8" style={styles.searchIcon} />
                    <TextInput
                      value={listingSearchQuery}
                      onChangeText={setListingSearchQuery}
                      placeholder="Search your listings..."
                      placeholderTextColor="#94a3b8"
                      style={styles.searchInput}
                    />
                    {listingSearchQuery.length > 0 && (
                      <Pressable onPress={() => setListingSearchQuery('')} style={styles.clearSearchBtn}>
                        <X size={14} color="#64748b" />
                      </Pressable>
                    )}
                  </View>
                )}

                {/* Filter Chips Horizontal Scroll */}
                {myListings.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterChipsRow}
                  >
                    {/* All Chip */}
                    <Pressable
                      onPress={() => setListingFilter('all')}
                      style={[styles.filterChip, listingFilter === 'all' ? styles.filterChipActive : styles.filterChipInactive]}
                    >
                      <Text style={[styles.filterChipText, listingFilter === 'all' && styles.filterChipTextActive]}>All</Text>
                      <View style={[styles.filterBadge, listingFilter === 'all' ? styles.filterBadgeActive : styles.filterBadgeInactive]}>
                        <Text style={[styles.filterBadgeText, listingFilter === 'all' && styles.filterBadgeTextActive]}>{myListings.length}</Text>
                      </View>
                    </Pressable>

                    {/* Active Chip */}
                    <Pressable
                      onPress={() => setListingFilter('active')}
                      style={[styles.filterChip, listingFilter === 'active' ? styles.filterChipActive : styles.filterChipInactive]}
                    >
                      <Text style={[styles.filterChipText, listingFilter === 'active' && styles.filterChipTextActive]}>Active</Text>
                      <View style={[styles.filterBadge, listingFilter === 'active' ? styles.filterBadgeActive : styles.filterBadgeInactive]}>
                        <Text style={[styles.filterBadgeText, listingFilter === 'active' && styles.filterBadgeTextActive]}>{activeAdsCount}</Text>
                      </View>
                    </Pressable>

                    {/* Boosted Chip */}
                    <Pressable
                      onPress={() => setListingFilter('boosted')}
                      style={[styles.filterChip, listingFilter === 'boosted' ? styles.filterChipActive : styles.filterChipInactive]}
                    >
                      <Flame size={11} color={listingFilter === 'boosted' ? '#fb923c' : '#ea580c'} />
                      <Text style={[styles.filterChipText, listingFilter === 'boosted' && styles.filterChipTextActive]}>Boosted</Text>
                      <View style={[styles.filterBadge, listingFilter === 'boosted' ? styles.filterBadgeActive : styles.filterBadgeInactive]}>
                        <Text style={[styles.filterBadgeText, listingFilter === 'boosted' && styles.filterBadgeTextActive]}>{boostedAdsCount}</Text>
                      </View>
                    </Pressable>

                    {/* Sold Chip */}
                    <Pressable
                      onPress={() => setListingFilter('sold')}
                      style={[styles.filterChip, listingFilter === 'sold' ? styles.filterChipActive : styles.filterChipInactive]}
                    >
                      <Text style={[styles.filterChipText, listingFilter === 'sold' && styles.filterChipTextActive]}>Sold</Text>
                      <View style={[styles.filterBadge, listingFilter === 'sold' ? styles.filterBadgeActive : styles.filterBadgeInactive]}>
                        <Text style={[styles.filterBadgeText, listingFilter === 'sold' && styles.filterBadgeTextActive]}>{soldAdsCount}</Text>
                      </View>
                    </Pressable>
                  </ScrollView>
                )}

                {/* Listings Items / Empty State */}
                {filteredMyListings.length === 0 ? (
                  <View style={styles.emptyListingsCard}>
                    <ShoppingBag size={38} color="#cbd5e1" />
                    <Text style={styles.emptyListingsTitle}>
                      {myListings.length === 0 ? 'No Listings Yet' : 'No matching listings found'}
                    </Text>
                    <Text style={styles.emptyListingsSubtitle}>
                      {myListings.length === 0
                        ? "You haven't listed any products or services for sale on Tedbuy yet."
                        : 'Try clearing your search query or switching filters.'}
                    </Text>
                    {myListings.length === 0 && (
                      <Pressable
                        onPress={() => navigation.navigate('Sell')}
                        style={styles.createFirstAdBtn}
                      >
                        <Plus size={15} color="#ffffff" strokeWidth={2.4} />
                        <Text style={styles.createFirstAdBtnText}>Create First Ad</Text>
                      </Pressable>
                    )}
                  </View>
                ) : (
                  <>
                    {displayedListings.map((item) => (
                      <View key={item.id} style={styles.listingCard}>
                        {/* Clickable Header Part: Thumbnail + Price + Title + Location/Views */}
                        <Pressable
                          onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}
                          style={styles.listingCardHeader}
                        >
                          {resolveProductImageUri(item) ? (
                            <Image source={{ uri: resolveProductImageUri(item)! }} style={styles.listingCardImg} />
                          ) : (
                            <CategoryImagePlaceholder category={item.category} style={styles.listingCardImg} iconSize={20} />
                          )}
                          <View style={styles.listingCardInfo}>
                            <View style={styles.listingCardPriceRow}>
                              <Text style={styles.listingCardPrice}>{formatProductPrice(item.price)}</Text>
                              {item.isSold && (
                                <View style={styles.soldBadge}>
                                  <Text style={styles.soldBadgeText}>Sold</Text>
                                </View>
                              )}
                              {isBoostActive(item) && (
                                <View style={styles.activeSellerBadge}>
                                  <Flame size={10} color="#78350f" fill="#78350f" />
                                  <Text style={styles.activeSellerBadgeText}>Active Seller</Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.listingCardTitle} numberOfLines={1}>
                              {item.title}
                            </Text>
                            <View style={styles.listingCardMetaRow}>
                              <Text style={styles.listingCardLocation} numberOfLines={1}>
                                {item.location || 'Ghana'}
                              </Text>
                              <Text style={styles.metaBullet}>•</Text>
                              <View style={styles.viewsMeta}>
                                <Eye size={11} color="#94a3b8" />
                                <Text style={styles.viewsMetaText}>{item.viewsCount || item.views || 0} views</Text>
                              </View>
                            </View>
                          </View>
                        </Pressable>

                        {/* 4 Action Buttons: [• Mark Sold], [✎ Edit], [⚡ Boost], [🗑 Del] */}
                        <View style={styles.listingCardActionsRow}>
                          <Pressable
                            onPress={() => handleToggleSold(item)}
                            disabled={togglingSoldId === item.id}
                            style={[
                              styles.listingActionBtn,
                              item.isSold ? styles.listingActionBtnSoldActive : styles.listingActionBtnSoldInactive,
                            ]}
                          >
                            {togglingSoldId === item.id ? (
                              <ActivityIndicator size="small" color={item.isSold ? '#e11d48' : '#64748b'} />
                            ) : (
                              <>
                                <View style={[styles.statusDot, item.isSold ? styles.statusDotSold : styles.statusDotInactive]} />
                                <Text
                                  style={[
                                    styles.listingActionBtnText,
                                    item.isSold ? styles.actionTextSold : styles.actionTextNormal,
                                  ]}
                                >
                                  {item.isSold ? 'Sold' : 'Mark Sold'}
                                </Text>
                              </>
                            )}
                          </Pressable>

                          <Pressable
                            onPress={() => navigation.navigate('Sell', { editProduct: item })}
                            style={[styles.listingActionBtn, styles.listingActionBtnNormal]}
                          >
                            <Edit2 size={12} color="#334155" />
                            <Text style={[styles.listingActionBtnText, styles.actionTextNormal]}>Edit</Text>
                          </Pressable>

                          <Pressable
                            onPress={() => setBoostingProduct(item)}
                            style={[styles.listingActionBtn, styles.listingActionBtnBoost]}
                          >
                            <Flame size={12} color="#ea580c" />
                            <Text style={[styles.listingActionBtnText, styles.actionTextBoost]}>Boost</Text>
                          </Pressable>

                          <Pressable
                            onPress={() => handleDeleteAd(item.id, item.title)}
                            style={[styles.listingActionBtn, styles.listingActionBtnDel]}
                          >
                            <Trash2 size={12} color="#dc2626" />
                            <Text style={[styles.listingActionBtnText, styles.actionTextDel]}>Del</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}

                    {visibleListingCount < filteredMyListings.length && (
                      <Pressable
                        onPress={() => setVisibleListingCount((prev) => prev + BATCH_SIZE)}
                        style={styles.loadMoreBtn}
                      >
                        <Text style={styles.loadMoreBtnText}>
                          Load More Ads ({displayedListings.length} of {filteredMyListings.length})
                        </Text>
                      </Pressable>
                    )}
                  </>
                )}
              </View>
            )}

            {/* TAB 2: SAVED BOOKMARKED DEALS */}
            {activeTab === 'saved' && (
              <View style={styles.tabContentContainer}>
                <View style={styles.listingsHeaderRow}>
                  <Text style={styles.listingsHeading}>SAVED BOOKMARKED DEALS</Text>
                  <Text style={styles.listingsSubheading}>
                    {savedBookmarks.length} saved listings
                  </Text>
                </View>

                {savedBookmarks.length === 0 ? (
                  <View style={styles.emptyListingsCard}>
                    <Bookmark size={38} color="#cbd5e1" />
                    <Text style={styles.emptyListingsTitle}>No Saved Deals Yet</Text>
                    <Text style={styles.emptyListingsSubtitle}>
                      Tap the bookmark icon on any classified ad to save it here for fast retrieval.
                    </Text>
                    <Pressable
                      onPress={() => navigation.navigate('Home')}
                      style={styles.createFirstAdBtn}
                    >
                      <Text style={styles.createFirstAdBtnText}>Browse Marketplace</Text>
                    </Pressable>
                  </View>
                ) : (
                  savedBookmarks.map((item) => (
                    <Pressable
                      key={item.id}
                      onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}
                      style={styles.bookmarkCard}
                    >
                      {resolveProductImageUri(item) ? (
                        <Image source={{ uri: resolveProductImageUri(item)! }} style={styles.bookmarkImg} />
                      ) : (
                        <CategoryImagePlaceholder category={item.category} style={styles.bookmarkImg} iconSize={18} />
                      )}
                      <View style={styles.bookmarkInfo}>
                        <Text style={styles.bookmarkTitle} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={styles.bookmarkPrice}>{formatProductPrice(item.price)}</Text>
                        <Text style={styles.bookmarkMeta}>
                          Seller: {item.sellerName || 'Verified Seller'}
                        </Text>
                      </View>
                      <Text style={styles.viewIndicatorChevron}>→</Text>
                    </Pressable>
                  ))
                )}
              </View>
            )}

            {/* TAB 3: SETTINGS HUB */}
            {activeTab === 'settings' && (
              <GestureDetector gesture={settingsBackGesture}>
                <View style={styles.settingsContent}>
                  <BackButton onPress={() => setActiveTab('dashboard')} color="#0f172a" style={{ marginBottom: 10 }} />
                  <View style={styles.settingsMenuGroup}>
                    <Pressable onPress={() => navigation.navigate('AccountSecuritySettings')} style={[styles.settingsMenuRow, { borderBottomWidth: 0 }]}>
                      <View style={styles.settingsItemLeft}>
                        <View style={styles.settingsMenuIconBadge}>
                          <ShieldCheck size={17} color="#0f172a" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.settingsItemTitle}>Account &amp; Security</Text>
                          <Text style={styles.settingsItemSubtitle}>Manage your account, verification and security</Text>
                        </View>
                      </View>
                      <ChevronRight size={18} color="#94a3b8" />
                    </Pressable>
                  </View>

                  <View style={styles.settingsMenuGroup}>
                    <Pressable onPress={() => navigation.navigate('ProfileStoreSettings')} style={[styles.settingsMenuRow, { borderBottomWidth: 0 }]}>
                      <View style={styles.settingsItemLeft}>
                        <View style={styles.settingsMenuIconBadge}>
                          <UserCircle2 size={17} color="#0f172a" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.settingsItemTitle}>Profile &amp; Store</Text>
                          <Text style={styles.settingsItemSubtitle}>Manage your public profile and store information</Text>
                        </View>
                      </View>
                      <ChevronRight size={18} color="#94a3b8" />
                    </Pressable>
                  </View>

                  <View style={styles.settingsMenuGroup}>
                    <Pressable onPress={() => navigation.navigate('NotificationSettings')} style={[styles.settingsMenuRow, { borderBottomWidth: 0 }]}>
                      <View style={styles.settingsItemLeft}>
                        <View style={styles.settingsMenuIconBadge}>
                          <Bell size={17} color="#0f172a" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.settingsItemTitle}>Notifications</Text>
                          <Text style={styles.settingsItemSubtitle}>Control which activities notify you</Text>
                        </View>
                      </View>
                      <ChevronRight size={18} color="#94a3b8" />
                    </Pressable>
                  </View>

                  <View style={styles.settingsMenuGroup}>
                    <Pressable onPress={() => navigation.navigate('SellingBuyingSettings')} style={[styles.settingsMenuRow, { borderBottomWidth: 0 }]}>
                      <View style={styles.settingsItemLeft}>
                        <View style={styles.settingsMenuIconBadge}>
                          <Store size={17} color="#0f172a" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.settingsItemTitle}>Selling &amp; Buying</Text>
                          <Text style={styles.settingsItemSubtitle}>Manage your marketplace account focus</Text>
                        </View>
                      </View>
                      <ChevronRight size={18} color="#94a3b8" />
                    </Pressable>
                  </View>

                  <View style={styles.settingsMenuGroup}>
                    <Pressable onPress={() => navigation.navigate('HelpSupportSettings')} style={[styles.settingsMenuRow, { borderBottomWidth: 0 }]}>
                      <View style={styles.settingsItemLeft}>
                        <View style={styles.settingsMenuIconBadge}>
                          <HelpCircle size={17} color="#0f172a" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.settingsItemTitle}>Help &amp; Support</Text>
                          <Text style={styles.settingsItemSubtitle}>Safety, FAQ, legal information and app details</Text>
                        </View>
                      </View>
                      <ChevronRight size={18} color="#94a3b8" />
                    </Pressable>
                  </View>

                  <Pressable onPress={handleSignOut} style={styles.settingsLogoutRow}>
                    <View style={styles.settingsLogoutIconBadge}>
                      <LogOut size={17} color="#e11d48" />
                    </View>
                    <Text style={styles.settingsLogoutText}>Log Out</Text>
                  </Pressable>
                </View>
              </GestureDetector>
            )}
          </ScrollView>
        </View>
      )}

      <BoostModal
        visible={boostingProduct !== null}
        onClose={() => setBoostingProduct(null)}
        product={boostingProduct}
        isAdmin={isUserAdmin(userProfile)}
        onSuccess={(updated) => {
          if (updated) {
            setProducts((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
          }
        }}
      />

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0f172a' },
  container: { flex: 1, backgroundColor: '#f8fafc' },

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

  /* Top Brand Header matching web */
  topHeaderContainer: { backgroundColor: '#0f172a', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#020617' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topBarLeft: { flexDirection: 'row', alignItems: 'center' },
  brandBadge: { width: 34, height: 34, borderRadius: 8, backgroundColor: '#020617', borderColor: '#1e293b', borderWidth: 1, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  brandName: { color: '#ffffff', fontSize: 20, fontFamily: fonts.extrabold, letterSpacing: -0.5 },
  brandNameAccent: { color: '#ea580c' },
  topBarRight: { flexDirection: 'row', alignItems: 'center' },
  headerBookmarkBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#1e293b', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#334155', position: 'relative' },
  headerBookmarkBadge: { position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#f43f5e', borderWidth: 1.5, borderColor: '#0f172a', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3 },
  headerBookmarkBadgeText: { color: '#ffffff', fontSize: 9, fontFamily: fonts.extrabold },

  /* Sub-header row: Marketplace link & My Profile title */
  subHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  marketplaceBackBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  marketplaceBackText: { fontSize: 13, fontFamily: fonts.bold, color: '#334155' },
  subHeaderTitle: { fontSize: 11, fontFamily: fonts.extrabold, color: '#94a3b8', letterSpacing: 0.8, textTransform: 'uppercase' },

  mainScrollContent: { paddingTop: 4 },

  /* Profile Card: White rounded card matching web */
  profileCard: { backgroundColor: '#ffffff', borderRadius: 24, borderWidth: 1, borderColor: '#e2e8f0', marginHorizontal: 14, padding: 14, shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  profileMainRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  avatarWrapper: { position: 'relative', marginRight: 12 },
  avatarContainer: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#f1f5f9', borderWidth: 2, borderColor: '#e2e8f0', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitialText: { fontSize: 18, fontFamily: fonts.extrabold, color: '#334155' },
  cameraBadge: { position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: '#0f172a', borderWidth: 2, borderColor: '#ffffff', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, elevation: 2 },
  profileInfoCol: { flex: 1, minWidth: 0, justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  profileDisplayName: { fontSize: 15, fontFamily: fonts.extrabold, color: '#0f172a' },
  verifiedCheckBadge: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#ffedd5', justifyContent: 'center', alignItems: 'center' },
  profileEmail: { fontSize: 11.5, color: '#64748b', marginTop: 1 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  partnerBadge: { backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa', borderRadius: 9999, paddingHorizontal: 7, paddingVertical: 1.5 },
  partnerBadgeText: { fontSize: 9.5, fontFamily: fonts.bold, color: '#ea580c' },
  adminBadge: { backgroundColor: '#faf5ff', borderWidth: 1, borderColor: '#e9d5ff', borderRadius: 9999, paddingHorizontal: 7, paddingVertical: 1.5 },
  adminBadgeText: { fontSize: 9.5, fontFamily: fonts.bold, color: '#7e22ce' },
  settingsGearBtn: { width: 36, height: 36, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  settingsGearBtnActive: { backgroundColor: '#0f172a', borderColor: '#0f172a' },

  /* 4 Stats columns */
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  statCol: { flex: 1, alignItems: 'center', paddingVertical: 2 },
  statNumber: { fontSize: 13.5, fontFamily: fonts.extrabold, color: '#0f172a' },
  statLabel: { fontSize: 10.5, fontFamily: fonts.medium, color: '#64748b', marginTop: 2 },
  viewsNumberRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },

  /* Bio */
  bioContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  bioPlaceholderText: { fontSize: 11, color: '#94a3b8' },
  bioText: { fontSize: 11, color: '#475569', fontStyle: 'italic', flex: 1, marginRight: 8 },
  bioActionBtn: { paddingVertical: 2, paddingHorizontal: 4 },
  bioActionBtnText: { fontSize: 11, fontFamily: fonts.bold, color: '#0f172a' },

  /* Quick Actions: View Storefront & Share Store */
  quickActionsRow: { flexDirection: 'row', gap: 10, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  quickActionBtn: { flex: 1, height: 38, borderRadius: 12, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  quickActionBtnText: { fontSize: 12, fontFamily: fonts.bold, color: '#1e293b' },

  /* Segmented 3-tab navigation */
  segmentControl: { marginHorizontal: 14, marginTop: 12, marginBottom: 10, backgroundColor: '#f1f5f9', borderRadius: 14, padding: 4, flexDirection: 'row', gap: 4 },
  segmentTab: { flex: 1, paddingVertical: 8, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  segmentTabActive: { backgroundColor: '#ffffff', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segmentTabText: { fontSize: 11.5, fontFamily: fonts.bold, color: '#64748b' },
  segmentTabTextActive: { color: '#0f172a', fontFamily: fonts.extrabold },

  tabContentContainer: { marginTop: 4 },

  /* Classified Listings Header & Search */
  listingsHeaderRow: { paddingHorizontal: 14, marginBottom: 8 },
  listingsHeading: { fontSize: 12, fontFamily: fonts.extrabold, color: '#0f172a', letterSpacing: 0.5, textTransform: 'uppercase' },
  listingsSubheading: { fontSize: 11, color: '#64748b', marginTop: 2 },
  searchBarContainer: { marginHorizontal: 14, marginBottom: 10, height: 38, backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center' },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 12, color: '#0f172a', fontFamily: fonts.medium, height: 36, padding: 0 },
  clearSearchBtn: { padding: 4 },

  /* Filter chips */
  filterChipsRow: { paddingHorizontal: 14, gap: 6, marginBottom: 12 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  filterChipActive: { backgroundColor: '#0f172a' },
  filterChipInactive: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0' },
  filterChipText: { fontSize: 11, fontFamily: fonts.bold, textTransform: 'capitalize', color: '#475569' },
  filterChipTextActive: { color: '#ffffff' },
  filterBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 9999 },
  filterBadgeActive: { backgroundColor: '#1e293b' },
  filterBadgeInactive: { backgroundColor: '#f1f5f9' },
  filterBadgeText: { fontSize: 9.5, fontFamily: fonts.extrabold, color: '#64748b' },
  filterBadgeTextActive: { color: '#cbd5e1' },

  /* Listing Card matching web ProfileSettings.tsx */
  listingCard: { backgroundColor: '#ffffff', borderRadius: 18, borderWidth: 1, borderColor: '#e2e8f0', padding: 12, marginHorizontal: 14, marginBottom: 10, shadowColor: '#0f172a', shadowOpacity: 0.03, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  listingCardHeader: { flexDirection: 'row', alignItems: 'center' },
  listingCardImg: { width: 64, height: 64, borderRadius: 12, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  listingCardInfo: { flex: 1, marginLeft: 12, minWidth: 0 },
  listingCardPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  listingCardPrice: { fontSize: 15, fontFamily: fonts.extrabold, color: '#0f172a' },
  soldBadge: { backgroundColor: '#ffe4e6', paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 6 },
  soldBadgeText: { color: '#be123c', fontSize: 9.5, fontFamily: fonts.bold },
  activeSellerBadge: { backgroundColor: '#fef3c7', paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 3 },
  activeSellerBadgeText: { color: '#92400e', fontSize: 9.5, fontFamily: fonts.bold },
  listingCardTitle: { fontSize: 13, fontFamily: fonts.bold, color: '#1e293b', marginTop: 2 },
  listingCardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  listingCardLocation: { fontSize: 11, color: '#94a3b8', maxWidth: 110 },
  metaBullet: { fontSize: 11, color: '#cbd5e1' },
  viewsMeta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  viewsMetaText: { fontSize: 11, color: '#94a3b8' },

  /* Listing Card 4 Action Buttons */
  listingCardActionsRow: { flexDirection: 'row', gap: 6, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  listingActionBtn: { flex: 1, height: 32, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  listingActionBtnSoldInactive: { backgroundColor: '#f1f5f9' },
  listingActionBtnSoldActive: { backgroundColor: '#ffe4e6', borderWidth: 1, borderColor: '#fecdd3' },
  statusDot: { width: 5, height: 5, borderRadius: 2.5 },
  statusDotInactive: { backgroundColor: '#94a3b8' },
  statusDotSold: { backgroundColor: '#e11d48' },
  listingActionBtnNormal: { backgroundColor: '#f1f5f9' },
  listingActionBtnBoost: { backgroundColor: '#fff7ed' },
  listingActionBtnDel: { backgroundColor: '#fef2f2' },
  listingActionBtnText: { fontSize: 11, fontFamily: fonts.bold },
  actionTextNormal: { color: '#334155' },
  actionTextSold: { color: '#be123c' },
  actionTextBoost: { color: '#ea580c' },
  actionTextDel: { color: '#dc2626' },

  /* Empty state */
  emptyListingsCard: { backgroundColor: '#ffffff', borderRadius: 20, borderWidth: 1, borderColor: '#e2e8f0', padding: 24, marginHorizontal: 14, alignItems: 'center' },
  emptyListingsTitle: { fontSize: 14, fontFamily: fonts.bold, color: '#0f172a', marginTop: 10 },
  emptyListingsSubtitle: { fontSize: 12, color: '#64748b', textAlign: 'center', marginTop: 4, lineHeight: 18 },
  createFirstAdBtn: { marginTop: 14, backgroundColor: '#ea580c', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  createFirstAdBtnText: { color: '#ffffff', fontSize: 12, fontFamily: fonts.bold },
  loadMoreBtn: { backgroundColor: '#ffffff', borderRadius: 14, paddingVertical: 12, alignItems: 'center', marginHorizontal: 14, marginBottom: 16, marginTop: 4, borderWidth: 1, borderColor: '#e2e8f0' },
  loadMoreBtnText: { fontSize: 12, fontFamily: fonts.bold, color: '#334155' },

  /* Saved Bookmarks Card */
  bookmarkCard: { flexDirection: 'row', backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', padding: 10, marginHorizontal: 14, marginBottom: 10, alignItems: 'center', shadowColor: '#0f172a', shadowOpacity: 0.02, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  bookmarkImg: { width: 52, height: 52, borderRadius: 10, backgroundColor: '#cbd5e1' },
  bookmarkInfo: { flex: 1, marginLeft: 12 },
  bookmarkTitle: { fontSize: 13, fontFamily: fonts.extrabold, color: '#0f172a' },
  bookmarkPrice: { fontSize: 13, fontFamily: fonts.extrabold, color: '#020617', marginTop: 2 },
  bookmarkMeta: { fontSize: 10.5, color: '#64748b', marginTop: 2 },
  viewIndicatorChevron: { color: '#94a3b8', fontSize: 16, paddingHorizontal: 4, fontFamily: fonts.bold },

  /* Settings Content */
  settingsContent: { padding: 14 },
  settingsMenuGroup: { backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', marginBottom: 12 },
  settingsMenuRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  settingsMenuIconBadge: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  settingsItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, paddingRight: 10 },
  settingsItemTitle: { fontSize: 13.5, fontFamily: fonts.extrabold, color: '#0f172a' },
  settingsItemSubtitle: { fontSize: 11, color: '#64748b', marginTop: 1 },
  settingsLogoutRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#fecdd3', borderRadius: 16, paddingVertical: 14, marginTop: 4 },
  settingsLogoutIconBadge: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  settingsLogoutText: { fontSize: 13.5, fontFamily: fonts.extrabold, color: '#e11d48' },
});
