import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { TedBuyLogo } from '../components/TedBuyLogo';
import { BoostModal } from '../components/BoostModal';
import { auth, observeAuthState, signIn, signUp, watchProducts, watchUsers, fetchUserById, deleteProductMobile, updateProduct, updateUserProfile, uploadMediaToCloudinaryMobile, resetPasswordEmail, getFriendlyAuthErrorMessage } from '../firebase';
import { Users as UsersIcon, Bookmark, Eye, Flame, Clock, Edit2, Tag, MapPin, Trash2, ShieldCheck, UserCircle2, Bell, Store, HelpCircle, ChevronRight, Settings as SettingsIcon } from 'lucide-react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { fonts } from '../theme';
import { TAB_BAR_HEIGHT, useTabBarVisibility } from '../context/TabBarVisibility';
import { isBoostActive, getBoostEndDate } from '../utils/boost';
import { formatProductPrice } from '../utils/formatPrice';
import { isUserAdmin } from '../types';
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
  const [resetEmail, setResetEmail] = useState('');
  const [isSendingReset, setIsSendingReset] = useState(false);

  // Tab state for Logged In User
  // Tapping the bottom Profile tab now lands cleanly on the Dashboard —
  // Settings is reached explicitly via the gear icon in the header instead
  // (matches web's split entry points: a dedicated shortcut for the
  // Dashboard vs. a separate settings entry point, rather than one bottom
  // tab defaulting to Settings).
  const [activeTab, setActiveTab] = useState<'dashboard' | 'settings'>('dashboard');
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
  // Switching the internal Dashboard/Settings toggle doesn't fire a
  // navigation focus event (it's the same screen), so the on-focus reset
  // above doesn't cover it — explicitly reset here too.
  useEffect(() => {
    resetTabBar();
  }, [activeTab, resetTabBar]);

  // Boost purchase — was entirely missing on mobile (only passive boost
  // badges existed, no way to actually buy one from a phone).
  const [boostingProduct, setBoostingProduct] = useState<any>(null);
  const [togglingSoldId, setTogglingSoldId] = useState<string | null>(null);

  // Matches web's SellerDashboard "Mark as Sold" / "Mark as Available" toggle.
  const handleToggleSold = async (item: any) => {
    setTogglingSoldId(item.id);
    try {
      const updated = await updateProduct(item.id, { isSold: !item.isSold });
      setProducts((prev) => prev.map((p) => (p.id === item.id ? { ...p, ...(updated || { isSold: !item.isSold }) } : p)));
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not update listing status.');
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
    } catch (err: any) {
      Alert.alert('Authentication Failure', getFriendlyAuthErrorMessage(err));
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
              Alert.alert('Error', err.message || 'Could not delete product.');
            }
          },
        },
      ]
    );
  };

  // Filter products for Dashboard
  const myListings = user ? products.filter((p) => p.sellerId === user.uid) : [];
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
                  placeholder="e.g. Nana Gadgets, Ama Fashion"
                  placeholderTextColor="#94a3b8"
                  style={styles.textInput}
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
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="••••••••"
                    placeholderTextColor="#94a3b8"
                    secureTextEntry
                    autoCapitalize="none"
                    style={styles.textInput}
                  />
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
                      {isRegisterMode ? 'Initialize Storefront' : 'Sign In Safely'}
                    </Text>
                  )}
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
      ) : (
        /* 2. Logged In User Dashboard Screen */
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.profileHeader}>
            <Pressable onPress={handleAvatarPress} style={styles.avatar} disabled={isUploadingAvatar}>
              {isUploadingAvatar ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : userProfile?.photoUrl ? (
                <Image source={{ uri: userProfile.photoUrl }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarText}>
                  {String(user.displayName || user.email || 'T').substring(0, 2).toUpperCase()}
                </Text>
              )}
            </Pressable>
            <View style={styles.profileHeaderBody}>
              <Text style={styles.merchantName}>
                {user.displayName || 'TedBuy Partner'}
              </Text>
              <Text style={styles.merchantEmail}>{user.email}</Text>
              <Text style={styles.merchantBadge}>✓ Authorized Partner</Text>
            </View>
            <Pressable onPress={() => setActiveTab('settings')} style={styles.headerSettingsBtn} hitSlop={10}>
              <SettingsIcon size={22} color="#ffffff" />
            </Pressable>
          </View>

          {/* Followers / Following / Saved — was entirely missing on mobile
              for your own profile (the same feature already existed for
              viewing OTHER sellers). All three stats are tappable: Following/
              Followers open a dedicated screen, Saved jumps to the Saved
              Deals screen. Dashboard-only — Settings has its own content and
              shouldn't carry these stats along with it. */}
          {activeTab === 'dashboard' && (
            <>
              <View style={styles.followStatsRow}>
                <Pressable
                  onPress={() => navigation.navigate('FollowersFollowing', { userId: user.uid, initialTab: 'following' })}
                  style={styles.followStatItem}
                >
                  <UsersIcon size={17} color="#475569" strokeWidth={2.4} />
                  <Text style={styles.followStatText}><Text style={styles.followStatCount}>{myFollowing.length}</Text> following</Text>
                </Pressable>
                <Pressable
                  onPress={() => navigation.navigate('FollowersFollowing', { userId: user.uid, initialTab: 'followers' })}
                  style={styles.followStatItem}
                >
                  <UsersIcon size={17} color="#475569" strokeWidth={2.4} />
                  <Text style={styles.followStatText}><Text style={styles.followStatCount}>{myFollowers.length}</Text> followers</Text>
                </Pressable>
                <Pressable
                  onPress={() => navigation.navigate('SavedProducts')}
                  style={styles.followStatItem}
                >
                  <Bookmark size={17} color="#475569" strokeWidth={2.4} />
                  <Text style={styles.followStatText}><Text style={styles.followStatCount}>{savedBookmarks.length}</Text> saved</Text>
                </Pressable>
              </View>

              {!!userProfile?.bio && (
                <Text style={styles.bioText}>{userProfile.bio}</Text>
              )}
            </>
          )}

          {/* Tab content — no visible segment control (Settings is reached
              via the header gear icon; Settings content below carries its
              own "Back to Dashboard" row instead of a toggle). */}
          {activeTab === 'dashboard' ? (
            <ScrollView contentContainerStyle={[styles.dashboardContent, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom }]}>
              {/* My Classified Ads Section */}
              <Text style={styles.sectionHeading}>My Classified Listings ({myListings.length})</Text>
              {myListings.length === 0 ? (
                <View style={styles.emptyContentCard}>
                  <Text style={styles.emptyCardText}>You haven't listed any classified products yet.</Text>
                  <Pressable
                    onPress={() => navigation.navigate('Sell')}
                    style={styles.miniCta}
                  >
                    <Text style={styles.miniCtaText}>Create First Ad</Text>
                  </Pressable>
                </View>
              ) : (
                myListings.map((item) => {
                  const isServices = !!(item.category && (item.category.toLowerCase() === 'services' || item.category.toLowerCase().includes('service')));
                  return (
                    <View key={item.id} style={styles.dashboardListingCard}>
                      {/* Matches web's SellerDashboard.tsx mobile-breakpoint
                          layout exactly (grid-cols-1 stack: info row, then
                          category pill, then views, then action row) —
                          previously a cramped 3-column row with a 5-button
                          vertical stack that didn't match web at all. The
                          whole info block navigates to the listing, same as
                          web's row-level onClick={handleCardClick}. */}
                      <Pressable onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}>
                        <View style={styles.dashboardListingInfoRow}>
                          {resolveProductImageUri(item) ? (
                            <Image source={{ uri: resolveProductImageUri(item)! }} style={styles.dashboardListingImg} />
                          ) : (
                            <CategoryImagePlaceholder category={item.category} style={styles.dashboardListingImg} iconSize={22} />
                          )}
                          <View style={styles.dashboardListingInfo}>
                            {!isServices ? (
                              <View style={styles.dashboardBadgeRow}>
                                <Text style={styles.dashboardListingPrice}>{formatProductPrice(item.price)}</Text>
                                {item.isSold && (
                                  <View style={styles.soldBadge}>
                                    <Text style={styles.soldBadgeText}>Sold</Text>
                                  </View>
                                )}
                                {isBoostActive(item) && (
                                  <View style={styles.activeSellerBadge}>
                                    <Flame size={9} color="#78350f" fill="#78350f" />
                                    <Text style={styles.activeSellerBadgeText}>Active Seller</Text>
                                  </View>
                                )}
                              </View>
                            ) : (item.isSold || isBoostActive(item)) && (
                              <View style={styles.dashboardBadgeRow}>
                                {item.isSold && (
                                  <View style={styles.soldBadge}>
                                    <Text style={styles.soldBadgeText}>Sold</Text>
                                  </View>
                                )}
                                {isBoostActive(item) && (
                                  <View style={styles.activeSellerBadge}>
                                    <Flame size={9} color="#78350f" fill="#78350f" />
                                    <Text style={styles.activeSellerBadgeText}>Active Seller</Text>
                                  </View>
                                )}
                              </View>
                            )}
                            <Text style={styles.dashboardListingTitle} numberOfLines={1}>
                              {item.title}
                            </Text>
                            {!!(item.brand || item.condition) && (
                              <Text style={styles.dashboardListingBrandCondition} numberOfLines={1}>
                                {item.brand ? 'Brand: ' : ''}{item.brand ? <Text style={styles.dashboardListingBrandConditionStrong}>{item.brand}</Text> : ''}
                                {item.brand && item.condition ? '  |  ' : ''}
                                {item.condition ? 'Condition: ' : ''}{item.condition ? <Text style={styles.dashboardListingBrandConditionStrong}>{item.condition}</Text> : ''}
                              </Text>
                            )}
                            <View style={styles.dashboardLocationRow}>
                              <MapPin size={12} color="#94a3b8" />
                              <Text style={styles.dashboardListingLocation}>{item.location || 'Ghana'}</Text>
                            </View>
                            {isBoostActive(item) && getBoostEndDate(item) && (
                              <View style={styles.boostExpiryPill}>
                                <Clock size={11} color="#b45309" />
                                <Text style={styles.boostExpiryPillText}>
                                  Expires: {getBoostEndDate(item)!.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                </Text>
                              </View>
                            )}
                          </View>
                        </View>

                        <View style={styles.dashboardCategoryPill}>
                          <Tag size={11} color="#475569" />
                          <Text style={styles.dashboardCategoryPillText}>{(item.category || 'Other').toUpperCase()}</Text>
                        </View>

                        <View style={styles.dashboardViewsRow}>
                          <Eye size={13} color="#94a3b8" />
                          <Text style={styles.dashboardViewsText}>
                            <Text style={styles.dashboardViewsCount}>{item.viewsCount || 0}</Text> views
                          </Text>
                        </View>
                      </Pressable>

                      <View style={styles.dashboardActionsRow}>
                        <Pressable
                          onPress={() => handleToggleSold(item)}
                          disabled={togglingSoldId === item.id}
                          style={item.isSold ? styles.listingBtnAvailable : styles.listingBtnSold}
                        >
                          {togglingSoldId === item.id ? (
                            <ActivityIndicator size="small" color={item.isSold ? '#e11d48' : '#0f172a'} />
                          ) : (
                            <Text style={item.isSold ? styles.listingBtnAvailableText : styles.listingBtnSoldText}>
                              {item.isSold ? 'Sold' : 'Mark Sold'}
                            </Text>
                          )}
                        </Pressable>
                        <Pressable
                          onPress={() => setBoostingProduct(item)}
                          style={styles.listingBtnBoost}
                        >
                          <Text style={styles.listingBtnBoostText}>{isBoostActive(item) ? 'Extend' : 'Boost'}</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => navigation.navigate('Sell', { editProduct: item })}
                          style={styles.iconActionBtn}
                        >
                          <Edit2 size={16} color="#475569" />
                        </Pressable>
                        <Pressable
                          onPress={() => handleDeleteAd(item.id, item.title)}
                          style={styles.iconActionBtn}
                        >
                          <Trash2 size={16} color="#94a3b8" />
                        </Pressable>
                      </View>
                    </View>
                  );
                })
              )}

              {/* Saved Bookmarks Section */}
              <Text style={styles.sectionHeading}>Saved Bookmarked Deals ({savedBookmarks.length})</Text>
              {savedBookmarks.length === 0 ? (
                <View style={styles.emptyContentCard}>
                  <Text style={styles.emptyCardText}>No bookmarks saved yet. Use the bookmark button on listings to save them here.</Text>
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
                      {!(item.category && (item.category.toLowerCase() === 'services' || item.category.toLowerCase().includes('service'))) && (
                        <Text style={styles.bookmarkPrice}>{formatProductPrice(item.price)}</Text>
                      )}
                      <Text style={styles.bookmarkMeta}>
                        Seller: {item.sellerName || 'Verified Seller'}
                      </Text>
                    </View>
                    <Text style={styles.viewIndicatorChevron}>→</Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
          ) : (
            /* Settings Tab — a clean navigation hub. Each category below
               owns a dedicated screen (see mobile/src/screens/*SettingsScreen.tsx);
               nothing settings-specific renders inline here anymore. */
            <ScrollView contentContainerStyle={[styles.settingsContent, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom }]}>
              <Pressable onPress={() => setActiveTab('dashboard')} style={styles.backToDashboardRow} hitSlop={8}>
                <ChevronRight size={16} color="#475569" style={{ transform: [{ rotate: '180deg' }] }} />
                <Text style={styles.backToDashboardText}>Back to Dashboard</Text>
              </Pressable>
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
            </ScrollView>
          )}
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
  authSubmitButton: { marginTop: 10, backgroundColor: '#0f172a', height: 46, borderRadius: 10, justifyContent: 'center', alignItems: 'center', shadowColor: '#0f172a', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  authSubmitText: { color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 14 },
  toggleAuthModeBtn: { marginTop: 14, alignSelf: 'center' },
  toggleAuthModeText: { color: '#2563eb', fontSize: 12.5, fontFamily: fonts.bold },

  /* Logged In Profile Styling */
  profileHeader: { flexDirection: 'row', padding: 18, backgroundColor: '#0f172a', alignItems: 'center' },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#1e293b', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#ffffff', position: 'relative', overflow: 'hidden' },
  avatarText: { color: '#ffffff', fontSize: 22, fontFamily: fonts.extrabold },
  avatarImg: { width: '100%', height: '100%' },
  profileHeaderBody: { flex: 1, marginLeft: 14 },
  merchantName: { color: '#ffffff', fontSize: 20, fontFamily: fonts.extrabold, letterSpacing: -0.4 },
  merchantEmail: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  merchantBadge: { alignSelf: 'flex-start', backgroundColor: '#ea580c', color: '#ffffff', fontSize: 9, fontFamily: fonts.extrabold, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginTop: 6 },
  headerSettingsBtn: { alignSelf: 'flex-start', width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },

  backToDashboardRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, marginBottom: 6 },
  backToDashboardText: { color: '#475569', fontSize: 13, fontFamily: fonts.bold },

  /* Dashboard Content */
  dashboardContent: { padding: 16 },
  sectionHeading: { fontSize: 14, fontFamily: fonts.extrabold, color: '#0f172a', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 },
  emptyContentCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 16, alignItems: 'center', borderStyle: 'dashed', borderWidth: 1.5, borderColor: '#cbd5e1', marginBottom: 18 },
  emptyCardText: { fontSize: 13, color: '#64748b', textAlign: 'center', lineHeight: 18 },
  miniCta: { marginTop: 10, backgroundColor: '#0f172a', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  miniCtaText: { color: '#ffffff', fontSize: 11, fontFamily: fonts.extrabold },

  dashboardListingCard: { backgroundColor: '#ffffff', borderRadius: 20, borderWidth: 1, borderColor: '#e2e8f0', padding: 14, marginBottom: 12, shadowColor: '#0f172a', shadowOpacity: 0.03, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  dashboardListingInfoRow: { flexDirection: 'row' },
  dashboardListingImg: { width: 64, height: 64, borderRadius: 12, backgroundColor: '#cbd5e1' },
  dashboardListingInfo: { flex: 1, marginLeft: 14, gap: 2 },
  dashboardBadgeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  dashboardListingTitle: { fontSize: 14, fontFamily: fonts.bold, color: '#1e293b', marginTop: 2 },
  dashboardListingPrice: { fontSize: 16, fontFamily: fonts.extrabold, color: '#020617' },
  dashboardListingBrandCondition: { fontSize: 10.5, color: '#64748b', marginTop: 2 },
  dashboardListingBrandConditionStrong: { color: '#334155', fontFamily: fonts.bold },
  dashboardLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  dashboardListingLocation: { fontSize: 11, color: '#64748b', fontFamily: fonts.medium },
  boostExpiryPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6, alignSelf: 'flex-start' },
  boostExpiryPillText: { fontSize: 10, color: '#b45309', fontFamily: fonts.bold },
  activeSellerBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#f59e0b', borderWidth: 1, borderColor: '#d97706', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  activeSellerBadgeText: { color: '#1c1917', fontSize: 8.5, fontFamily: fonts.extrabold, textTransform: 'uppercase' },

  dashboardCategoryPill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, backgroundColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginTop: 12 },
  dashboardCategoryPillText: { fontSize: 10, fontFamily: fonts.extrabold, color: '#334155', letterSpacing: 0.4 },
  dashboardViewsRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  dashboardViewsText: { fontSize: 11.5, color: '#94a3b8', fontFamily: fonts.medium },
  dashboardViewsCount: { fontFamily: fonts.extrabold, color: '#64748b' },

  dashboardActionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 14 },
  iconActionBtn: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
  listingBtnBoost: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#f59e0b', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#d97706' },
  listingBtnBoostText: { color: '#1c1917', fontSize: 10.5, fontFamily: fonts.extrabold, textTransform: 'uppercase' },
  listingBtnSold: { backgroundColor: '#ffffff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
  listingBtnSoldText: { color: '#475569', fontSize: 10.5, fontFamily: fonts.extrabold, textTransform: 'uppercase' },
  listingBtnAvailable: { backgroundColor: '#fff1f2', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#fecdd3', alignItems: 'center', justifyContent: 'center' },
  listingBtnAvailableText: { color: '#e11d48', fontSize: 10.5, fontFamily: fonts.extrabold, textTransform: 'uppercase' },
  soldBadge: { backgroundColor: '#ffe4e6', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: '#fecdd3' },
  soldBadgeText: { color: '#be123c', fontSize: 8, fontFamily: fonts.extrabold, textTransform: 'uppercase', letterSpacing: 0.4 },

  // Saved Bookmarks tab — a simpler horizontal list-item card, kept distinct
  // from dashboardListingCard above since My Listings was redesigned to a
  // stacked layout matching web's SellerDashboard.tsx mobile breakpoint.
  bookmarkCard: { flexDirection: 'row', backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', padding: 10, marginBottom: 10, alignItems: 'center', shadowColor: '#0f172a', shadowOpacity: 0.02, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  bookmarkImg: { width: 52, height: 52, borderRadius: 10, backgroundColor: '#cbd5e1' },
  bookmarkInfo: { flex: 1, marginLeft: 12 },
  bookmarkTitle: { fontSize: 13, fontFamily: fonts.extrabold, color: '#0f172a' },
  bookmarkPrice: { fontSize: 13, fontFamily: fonts.extrabold, color: '#020617', marginTop: 2 },
  bookmarkMeta: { fontSize: 10.5, color: '#64748b', marginTop: 2 },

  viewIndicatorChevron: { color: '#94a3b8', fontSize: 16, paddingHorizontal: 4, fontFamily: fonts.bold },

  /* Settings Content — the cards themselves carry the visual hierarchy;
     no standalone category labels above them (each card's own title already
     names the category, so a heading repeating it added nothing). */
  settingsContent: { padding: 16 },
  settingsMenuGroup: { backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', marginBottom: 12 },
  settingsMenuRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  settingsMenuIconBadge: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  settingsItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, paddingRight: 10 },
  settingsItemTitle: { fontSize: 13.5, fontFamily: fonts.extrabold, color: '#0f172a' },
  settingsItemSubtitle: { fontSize: 11, color: '#64748b', marginTop: 1 },

  followStatsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, paddingHorizontal: 10, paddingVertical: 12, backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  followStatItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  followStatText: { fontSize: 15, color: '#334155', fontFamily: fonts.bold },
  followStatCount: { color: '#0f172a', fontFamily: fonts.extrabold, fontSize: 16 },
  bioText: { color: '#475569', fontSize: 12.5, lineHeight: 17, marginTop: 10, paddingHorizontal: 14 },
});
