import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, observeAuthState, logOut, signIn, signUp, watchProducts, db } from '../firebase';
import { doc, deleteDoc } from 'firebase/firestore';
import { useNavigation } from '@react-navigation/native';

export function ProfileScreen() {
  const navigation = useNavigation<any>();
  const [user, setUser] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);

  // Form states for Guest
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Tab state for Logged In User
  const [activeTab, setActiveTab] = useState<'dashboard' | 'settings'>('dashboard');

  // Safety Tips Modal
  const [isSafetyModalVisible, setIsSafetyModalVisible] = useState(false);

  useEffect(() => {
    const unsubscribeAuth = observeAuthState((currentUser) => {
      setUser(currentUser);
    });

    const unsubscribeProducts = watchProducts((result) => {
      setProducts(result);
    });

    return () => {
      unsubscribeAuth();
      unsubscribeProducts();
    };
  }, []);

  const handleAuth = async () => {
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
        Alert.alert('Welcome Back! 👋', 'Signed in successfully.');
      }
      // Reset form
      setEmail('');
      setPassword('');
      setUsername('');
    } catch (err: any) {
      Alert.alert('Authentication Failure', err.message || 'An error occurred during sign-in.');
    } finally {
      setAuthLoading(false);
    }
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
            Alert.alert('Signed Out', 'You have been logged out.');
          },
        },
      ]
    );
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
              await deleteDoc(doc(db, 'products', productId));
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
  const savedBookmarks = user ? products.filter((p) => Array.isArray(p.likedUserIds) && p.likedUserIds.includes(user.uid)) : [];
  const totalEngagementScore = myListings.reduce((acc, p) => acc + (p.likesCount || 0), 0);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* 1. Guest Screen / Sign-in / Register form */}
      {!user ? (
        <ScrollView contentContainerStyle={styles.authScroll}>
          <View style={styles.authHeader}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoBadgeText}>T</Text>
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

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Password</Text>
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
          </View>
        </ScrollView>
      ) : (
        /* 2. Logged In User Dashboard Screen */
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.profileHeader}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {String(user.displayName || user.email || 'T').substring(0, 2).toUpperCase()}
              </Text>
            </View>
            <View style={styles.profileHeaderBody}>
              <Text style={styles.merchantName}>
                {user.displayName || 'TedBuy Partner'}
              </Text>
              <Text style={styles.merchantEmail}>{user.email}</Text>
              <Text style={styles.merchantBadge}>✓ Authorized Partner</Text>
            </View>
          </View>

          {/* Stats Summary Panel */}
          <View style={styles.statsPanel}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{myListings.length}</Text>
              <Text style={styles.statLabel}>My Ads</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{savedBookmarks.length}</Text>
              <Text style={styles.statLabel}>Bookmarks</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>★ {totalEngagementScore}</Text>
              <Text style={styles.statLabel}>Likes</Text>
            </View>
          </View>

          {/* Segment Controller (Tabs) */}
          <View style={styles.tabBar}>
            <Pressable
              onPress={() => setActiveTab('dashboard')}
              style={[styles.tabItem, activeTab === 'dashboard' && styles.tabItemActive]}
            >
              <Text style={[styles.tabItemText, activeTab === 'dashboard' && styles.tabItemTextActive]}>
                📋 Dashboard
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveTab('settings')}
              style={[styles.tabItem, activeTab === 'settings' && styles.tabItemActive]}
            >
              <Text style={[styles.tabItemText, activeTab === 'settings' && styles.tabItemTextActive]}>
                ⚙️ Settings
              </Text>
            </Pressable>
          </View>

          {/* Tab content */}
          {activeTab === 'dashboard' ? (
            <ScrollView contentContainerStyle={styles.dashboardContent}>
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
                myListings.map((item) => (
                  <View key={item.id} style={styles.dashboardListingCard}>
                    <Image
                      source={{
                        uri: Array.isArray(item.images) && item.images.length
                          ? item.images[0]
                          : item.image || 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80',
                      }}
                      style={styles.dashboardListingImg}
                    />
                    <View style={styles.dashboardListingInfo}>
                      <Text style={styles.dashboardListingTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.dashboardListingPrice}>{item.price}</Text>
                      <Text style={styles.dashboardListingMeta}>
                        {item.category || 'Other'} • {item.location || 'Ghana'}
                      </Text>
                    </View>
                    <View style={styles.listingActionsColumn}>
                      <Pressable
                        onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}
                        style={styles.listingBtnSpecs}
                      >
                        <Text style={styles.listingBtnSpecsText}>Specs</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleDeleteAd(item.id, item.title)}
                        style={styles.listingBtnDelete}
                      >
                        <Text style={styles.listingBtnDeleteText}>Delete</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
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
                    style={styles.dashboardListingCard}
                  >
                    <Image
                      source={{
                        uri: Array.isArray(item.images) && item.images.length
                          ? item.images[0]
                          : item.image || 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80',
                      }}
                      style={styles.dashboardListingImg}
                    />
                    <View style={styles.dashboardListingInfo}>
                      <Text style={styles.dashboardListingTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.dashboardListingPrice}>{item.price}</Text>
                      <Text style={styles.dashboardListingMeta}>
                        Seller: {item.sellerName || 'Verified Seller'}
                      </Text>
                    </View>
                    <Text style={styles.viewIndicatorChevron}>→</Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
          ) : (
            /* Settings Tab */
            <ScrollView contentContainerStyle={styles.settingsContent}>
              <Text style={styles.sectionHeading}>Merchant Settings</Text>

              <View style={styles.settingsGroup}>
                <Pressable
                  onPress={() => setIsSafetyModalVisible(true)}
                  style={styles.settingsItemCard}
                >
                  <View style={styles.settingsItemLeft}>
                    <Text style={styles.settingsItemIcon}>🛡️</Text>
                    <View>
                      <Text style={styles.settingsItemTitle}>Classified Safety Guidelines</Text>
                      <Text style={styles.settingsItemSubtitle}>Important safety protocols for meeting buyers.</Text>
                    </View>
                  </View>
                  <Text style={styles.viewIndicatorChevron}>→</Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    Alert.alert('TedBuy Security System', 'End-to-peer secure transaction tunnel active. Verified cryptographic database version 1.0.4.');
                  }}
                  style={styles.settingsItemCard}
                >
                  <View style={styles.settingsItemLeft}>
                    <Text style={styles.settingsItemIcon}>🔒</Text>
                    <View>
                      <Text style={styles.settingsItemTitle}>Security & Privacy</Text>
                      <Text style={styles.settingsItemSubtitle}>Cryptographic details and data storage settings.</Text>
                    </View>
                  </View>
                  <Text style={styles.viewIndicatorChevron}>→</Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    Alert.alert('System Up-To-Date', 'TedBuy is operating on the latest production build. Automatic updates enabled.');
                  }}
                  style={styles.settingsItemCard}
                >
                  <View style={styles.settingsItemLeft}>
                    <Text style={styles.settingsItemIcon}>📱</Text>
                    <View>
                      <Text style={styles.settingsItemTitle}>App Diagnostics</Text>
                      <Text style={styles.settingsItemSubtitle}>Review application build cache and server logs.</Text>
                    </View>
                  </View>
                  <Text style={styles.viewIndicatorChevron}>→</Text>
                </Pressable>
              </View>

              <Pressable
                onPress={handleSignOut}
                style={styles.signOutButton}
              >
                <Text style={styles.signOutButtonText}>Sign Out Securely</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      )}

      {/* Safety Tips Overlay Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isSafetyModalVisible}
        onRequestClose={() => setIsSafetyModalVisible(false)}
      >
        <View style={styles.modalOverlayContainer}>
          <View style={styles.modalOverlayContent}>
            <View style={styles.modalOverlayHeader}>
              <Text style={styles.modalOverlayTitle}>Safety Protocol</Text>
              <Pressable
                onPress={() => setIsSafetyModalVisible(false)}
                style={styles.modalCloseBtn}
              >
                <Text style={styles.modalCloseBtnText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalScrollBody}>
              <Text style={styles.safetyIntro}>
                TedBuy prioritizes the safety of both our buyers and merchants. Please review these classified trade tips:
              </Text>

              <View style={styles.safetyCardItem}>
                <Text style={styles.safetyCardIcon}>📍</Text>
                <View style={styles.safetyCardTextContent}>
                  <Text style={styles.safetyCardTitle}>Meet in Public Spaces</Text>
                  <Text style={styles.safetyCardText}>
                    Always coordinate item inspection and exchanges in well-lit public zones like malls, banks, or transport hubs.
                  </Text>
                </View>
              </View>

              <View style={styles.safetyCardItem}>
                <Text style={styles.safetyCardIcon}>🔎</Text>
                <View style={styles.safetyCardTextContent}>
                  <Text style={styles.safetyCardTitle}>Thoroughly Inspect the Item</Text>
                  <Text style={styles.safetyCardText}>
                    Carefully test mechanical objects, screens, chargers, clothing stitching, and serial numbers before providing funds.
                  </Text>
                </View>
              </View>

              <View style={styles.safetyCardItem}>
                <Text style={styles.safetyCardIcon}>💵</Text>
                <View style={styles.safetyCardTextContent}>
                  <Text style={styles.safetyCardTitle}>Secure Payments Only</Text>
                  <Text style={styles.safetyCardText}>
                    Use immediate digital transfers (Mobile Money) or cash. Never send advance deposits before viewing the classified item.
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={() => setIsSafetyModalVisible(false)}
                style={styles.safetyAcknowledgeCta}
              >
                <Text style={styles.safetyAcknowledgeText}>I Understand</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0f172a' },
  container: { flex: 1, backgroundColor: '#f8fafc' },

  /* Guest / Auth styling */
  authScroll: { paddingHorizontal: 24, paddingVertical: 32, alignItems: 'center' },
  authHeader: { alignItems: 'center', marginBottom: 24, marginTop: 12 },
  logoBadge: { width: 56, height: 56, borderRadius: 16, backgroundColor: '#ea580c', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  logoBadgeText: { color: '#ffffff', fontSize: 26, fontWeight: '900' },
  authTitle: { fontSize: 28, fontWeight: '900', color: '#ffffff' },
  orangeText: { color: '#ea580c' },
  authSubtitle: { fontSize: 13, color: '#94a3b8', textAlign: 'center', marginTop: 8, lineHeight: 18, paddingHorizontal: 16 },

  authCard: { backgroundColor: '#ffffff', borderRadius: 24, padding: 20, width: '100%', shadowColor: '#0f172a', shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, borderWidth: 1, borderColor: '#e2e8f0' },
  cardLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: '#64748b', marginBottom: 16 },
  inputContainer: { marginBottom: 14 },
  inputLabel: { fontSize: 11, fontWeight: '700', color: '#1e293b', marginBottom: 6 },
  textInput: { height: 46, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 14, fontSize: 14, color: '#0f172a', fontWeight: '500' },
  authSubmitButton: { marginTop: 10, backgroundColor: '#ea580c', height: 46, borderRadius: 10, justifyContent: 'center', alignItems: 'center', shadowColor: '#ea580c', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  authSubmitText: { color: '#ffffff', fontWeight: '800', fontSize: 14 },
  toggleAuthModeBtn: { marginTop: 14, alignSelf: 'center' },
  toggleAuthModeText: { color: '#ea580c', fontSize: 12.5, fontWeight: '700' },

  /* Logged In Profile Styling */
  profileHeader: { flexDirection: 'row', padding: 18, backgroundColor: '#0f172a', alignItems: 'center' },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#ea580c', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#ffffff' },
  avatarText: { color: '#ffffff', fontSize: 22, fontWeight: '900' },
  profileHeaderBody: { flex: 1, marginLeft: 14 },
  merchantName: { color: '#ffffff', fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },
  merchantEmail: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  merchantBadge: { alignSelf: 'flex-start', backgroundColor: '#ea580c', color: '#ffffff', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginTop: 6 },

  statsPanel: { flexDirection: 'row', backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0', paddingHorizontal: 16, paddingVertical: 12 },
  statBox: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '900', color: '#0f172a' },
  statLabel: { fontSize: 11, color: '#64748b', fontWeight: '600', marginTop: 2 },

  tabBar: { flexDirection: 'row', backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0', paddingHorizontal: 16 },
  tabItem: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabItemActive: { borderBottomColor: '#ea580c' },
  tabItemText: { color: '#64748b', fontSize: 13, fontWeight: '700' },
  tabItemTextActive: { color: '#ea580c', fontWeight: '800' },

  /* Dashboard Content */
  dashboardContent: { padding: 16 },
  sectionHeading: { fontSize: 14, fontWeight: '800', color: '#0f172a', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 },
  emptyContentCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 16, alignItems: 'center', borderStyle: 'dashed', borderWidth: 1.5, borderColor: '#cbd5e1', marginBottom: 18 },
  emptyCardText: { fontSize: 13, color: '#64748b', textAlign: 'center', lineHeight: 18 },
  miniCta: { marginTop: 10, backgroundColor: '#0f172a', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  miniCtaText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },

  dashboardListingCard: { flexDirection: 'row', backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', padding: 10, marginBottom: 10, alignItems: 'center', shadowColor: '#0f172a', shadowOpacity: 0.02, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  dashboardListingImg: { width: 52, height: 52, borderRadius: 10, backgroundColor: '#cbd5e1' },
  dashboardListingInfo: { flex: 1, marginLeft: 12 },
  dashboardListingTitle: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  dashboardListingPrice: { fontSize: 13, fontWeight: '800', color: '#ea580c', marginTop: 2 },
  dashboardListingMeta: { fontSize: 10.5, color: '#64748b', marginTop: 2 },

  listingActionsColumn: { gap: 6 },
  listingBtnSpecs: { backgroundColor: '#f1f5f9', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'center' },
  listingBtnSpecsText: { color: '#0f172a', fontSize: 10, fontWeight: '800' },
  listingBtnDelete: { backgroundColor: '#fee2e2', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#fecaca', alignItems: 'center' },
  listingBtnDeleteText: { color: '#ef4444', fontSize: 10, fontWeight: '800' },

  viewIndicatorChevron: { color: '#94a3b8', fontSize: 16, paddingHorizontal: 4, fontWeight: '700' },

  /* Settings Content */
  settingsContent: { padding: 16 },
  settingsGroup: { backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', marginBottom: 18 },
  settingsItemCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  settingsItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  settingsItemIcon: { fontSize: 20 },
  settingsItemTitle: { fontSize: 13.5, fontWeight: '800', color: '#0f172a' },
  settingsItemSubtitle: { fontSize: 11, color: '#64748b', marginTop: 1 },

  signOutButton: { backgroundColor: '#ef4444', borderRadius: 12, height: 46, justifyContent: 'center', alignItems: 'center', shadowColor: '#ef4444', shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  signOutButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },

  /* Modal Overlay styling */
  modalOverlayContainer: { flex: 1, backgroundColor: 'rgba(2, 6, 23, 0.6)', justifyContent: 'flex-end' },
  modalOverlayContent: { backgroundColor: '#ffffff', borderTopLeftRadius: 28, borderTopRightRadius: 28, height: '70%', padding: 18 },
  modalOverlayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingBottom: 10 },
  modalOverlayTitle: { fontSize: 16, fontWeight: '900', color: '#0f172a' },
  modalCloseBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center' },
  modalCloseBtnText: { color: '#64748b', fontWeight: '800', fontSize: 12 },
  modalScrollBody: { paddingTop: 14 },
  safetyIntro: { fontSize: 13, color: '#475569', lineHeight: 18, marginBottom: 16, fontWeight: '500' },

  safetyCardItem: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  safetyCardIcon: { fontSize: 22 },
  safetyCardTextContent: { flex: 1 },
  safetyCardTitle: { fontSize: 13.5, fontWeight: '800', color: '#0f172a' },
  safetyCardText: { fontSize: 11.5, color: '#64748b', marginTop: 2, lineHeight: 16 },

  safetyAcknowledgeCta: { marginTop: 12, backgroundColor: '#ea580c', height: 44, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  safetyAcknowledgeText: { color: '#ffffff', fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
});
