import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { View, Text, StyleSheet } from 'react-native';
import { Search, PlusCircle, MessageSquare, User } from 'lucide-react-native';
import { HomeTabIcon } from '../components/HomeTabIcon';
import { HomeScreen } from '../screens/HomeScreen';
import { ChatsScreen } from '../screens/ChatsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { SellScreen } from '../screens/SellScreen';
import { ProductDetailScreen } from '../screens/ProductDetailScreen';
import { SellerProfileScreen } from '../screens/SellerProfileScreen';
import { FollowersFollowingScreen } from '../screens/FollowersFollowingScreen';
import { FeaturedListingsScreen } from '../screens/FeaturedListingsScreen';
import { DiscoverSellersScreen } from '../screens/DiscoverSellersScreen';
import { TrendingListingsScreen } from '../screens/TrendingListingsScreen';
import { SavedProductsScreen } from '../screens/SavedProductsScreen';
import { ForYouScreen } from '../screens/ForYouScreen';
import { AccountSecuritySettingsScreen } from '../screens/AccountSecuritySettingsScreen';
import { ProfileStoreSettingsScreen } from '../screens/ProfileStoreSettingsScreen';
import { NotificationSettingsScreen } from '../screens/NotificationSettingsScreen';
import { SellingBuyingSettingsScreen } from '../screens/SellingBuyingSettingsScreen';
import { HelpSupportSettingsScreen } from '../screens/HelpSupportSettingsScreen';
import { MainTabsParamList, RootStackParamList } from '../types';
import { Product } from '../types';
import { fonts } from '../theme';
import { TabBarVisibilityProvider, useTabBarVisibility } from '../context/TabBarVisibility';
import { useUnreadChatsCount } from '../context/UnreadChats';

const Tab = createBottomTabNavigator<MainTabsParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function HomeStackScreen({ route, navigation }: any) {
  return (
    <HomeScreen
      route={route}
      navigation={navigation}
      onOpenProduct={(product: Product) => navigation.navigate('ProductDetail', { productId: product.id })}
    />
  );
}

function MainTabs() {
  const { translateY, isDarkTabBar } = useTabBarVisibility();
  // Matches web's Navbar.tsx unreadCount badge — was entirely absent on
  // mobile, so a user with unread messages had no indicator outside the
  // Chats tab's own list.
  const unreadChatsCount = useUnreadChatsCount();
  // White for normal light-background browsing, dark only for the immersive
  // Watch Video Ads feed — a dark bar reads heavy against the standard grid,
  // but disappears nicely against the full-bleed video feed.
  const activeIconColor = isDarkTabBar ? '#ffffff' : '#0f172a';
  const inactiveIconColor = '#94a3b8';

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: activeIconColor,
        tabBarInactiveTintColor: inactiveIconColor,
        tabBarStyle: {
          backgroundColor: isDarkTabBar ? '#0f172a' : '#ffffff',
          borderTopColor: isDarkTabBar ? '#020617' : '#e2e8f0',
          borderTopWidth: 1,
          height: 68,
          paddingBottom: 8,
          paddingTop: 6,
          shadowColor: '#000000',
          shadowOpacity: isDarkTabBar ? 0.2 : 0.06,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -4 },
          elevation: 8,
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          transform: [{ translateY }],
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeStackScreen}
        options={{
          tabBarLabel: ({ focused }) => (
            <Text style={[styles.tabBarLabelText, { color: focused ? activeIconColor : inactiveIconColor, fontFamily: fonts.extrabold }]}>
              HOME
            </Text>
          ),
          tabBarIcon: ({ focused }) => (
            <View style={styles.tabIconContainer}>
              <HomeTabIcon
                size={focused ? 22 : 20}
                color={focused ? activeIconColor : inactiveIconColor}
                cutoutColor={isDarkTabBar ? '#0f172a' : '#ffffff'}
              />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={{
          tabBarLabel: ({ focused }) => (
            <Text style={[styles.tabBarLabelText, { color: focused ? activeIconColor : inactiveIconColor, fontFamily: fonts.extrabold }]}>
              SEARCH
            </Text>
          ),
          tabBarIcon: ({ focused }) => (
            <View style={styles.tabIconContainer}>
              <Search size={focused ? 22 : 20} color={focused ? activeIconColor : inactiveIconColor} strokeWidth={2.4} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Sell"
        component={SellScreen}
        options={{
          tabBarLabel: () => (
            <Text style={[styles.sellLabelText, { color: isDarkTabBar ? '#ffffff' : '#0f172a' }]}>SELL</Text>
          ),
          tabBarIcon: () => (
            <View style={styles.sellTabContainer}>
              <View style={styles.sellTabButton}>
                <PlusCircle size={26} color="#ffffff" strokeWidth={2.4} />
              </View>
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Chats"
        component={ChatsScreen}
        options={{
          tabBarBadge: unreadChatsCount > 0 ? unreadChatsCount : undefined,
          tabBarBadgeStyle: { backgroundColor: '#e11d48', fontFamily: fonts.extrabold, fontSize: 10 },
          tabBarLabel: ({ focused }) => (
            <Text style={[styles.tabBarLabelText, { color: focused ? activeIconColor : inactiveIconColor, fontFamily: fonts.extrabold }]}>
              CHATS
            </Text>
          ),
          tabBarIcon: ({ focused }) => (
            <View style={styles.tabIconContainer}>
              <MessageSquare size={focused ? 22 : 20} color={focused ? activeIconColor : inactiveIconColor} strokeWidth={2.2} fill={focused ? activeIconColor : 'none'} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: ({ focused }) => (
            <Text style={[styles.tabBarLabelText, { color: focused ? activeIconColor : inactiveIconColor, fontFamily: fonts.extrabold }]}>
              PROFILE
            </Text>
          ),
          tabBarIcon: ({ focused }) => (
            <View style={styles.tabIconContainer}>
              <User size={focused ? 22 : 20} color={focused ? activeIconColor : inactiveIconColor} strokeWidth={2.2} fill={focused ? activeIconColor : 'none'} />
            </View>
          ),
        }}
      />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  return (
    <TabBarVisibilityProvider>
    <NavigationContainer>
      {/* gestureEnabled + fullScreenGestureEnabled swipe left-to-right to go
          back is automatic on iOS, but native-stack does NOT enable it on
          Android by default — nor does it kick in there without an explicit
          `animation`, since the gesture is driven by the same transition the
          system animation uses (the default has none to drive). Both set
          here at the navigator level so every pushed screen gets it, not
          just the ones that opted in individually before this. */}
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="MainTabs" component={MainTabs} />
        <Stack.Screen name="ProductDetail" options={{ presentation: 'card' }}>
          {({ route }) => {
            const navigation = useNavigation<any>();
            return <ProductDetailScreen productId={route.params.productId} onBack={() => navigation.goBack()} />;
          }}
        </Stack.Screen>
        <Stack.Screen name="SellerProfile" options={{ presentation: 'card' }}>
          {({ route }) => {
            const navigation = useNavigation<any>();
            return (
              <SellerProfileScreen
                sellerId={route.params.sellerId}
                onBack={() => navigation.goBack()}
                navigation={navigation}
                initialTab={route.params.initialTab}
              />
            );
          }}
        </Stack.Screen>
        <Stack.Screen name="FollowersFollowing" options={{ presentation: 'card' }}>
          {({ route }) => {
            const navigation = useNavigation<any>();
            return (
              <FollowersFollowingScreen
                userId={route.params.userId}
                initialTab={route.params.initialTab}
                onBack={() => navigation.goBack()}
                navigation={navigation}
              />
            );
          }}
        </Stack.Screen>
        <Stack.Screen name="FeaturedListings" options={{ presentation: 'card' }}>
          {({ route }) => {
            const navigation = useNavigation<any>();
            return (
              <FeaturedListingsScreen
                category={route.params?.category}
                onBack={() => navigation.goBack()}
                navigation={navigation}
              />
            );
          }}
        </Stack.Screen>
        <Stack.Screen name="DiscoverSellers" options={{ presentation: 'card' }}>
          {() => {
            const navigation = useNavigation<any>();
            return <DiscoverSellersScreen onBack={() => navigation.goBack()} navigation={navigation} />;
          }}
        </Stack.Screen>
        <Stack.Screen name="TrendingListings" options={{ presentation: 'card' }}>
          {() => {
            const navigation = useNavigation<any>();
            return <TrendingListingsScreen onBack={() => navigation.goBack()} navigation={navigation} />;
          }}
        </Stack.Screen>
        <Stack.Screen name="SavedProducts" options={{ presentation: 'card' }}>
          {() => {
            const navigation = useNavigation<any>();
            return <SavedProductsScreen onBack={() => navigation.goBack()} navigation={navigation} />;
          }}
        </Stack.Screen>
        <Stack.Screen name="ForYou" options={{ presentation: 'card' }}>
          {() => {
            const navigation = useNavigation<any>();
            return <ForYouScreen onBack={() => navigation.goBack()} navigation={navigation} />;
          }}
        </Stack.Screen>
        <Stack.Screen name="AccountSecuritySettings" options={{ presentation: 'card' }}>
          {() => {
            const navigation = useNavigation<any>();
            return <AccountSecuritySettingsScreen onBack={() => navigation.goBack()} />;
          }}
        </Stack.Screen>
        <Stack.Screen name="ProfileStoreSettings" options={{ presentation: 'card' }}>
          {() => {
            const navigation = useNavigation<any>();
            return <ProfileStoreSettingsScreen onBack={() => navigation.goBack()} />;
          }}
        </Stack.Screen>
        <Stack.Screen name="NotificationSettings" options={{ presentation: 'card' }}>
          {() => {
            const navigation = useNavigation<any>();
            return <NotificationSettingsScreen onBack={() => navigation.goBack()} />;
          }}
        </Stack.Screen>
        <Stack.Screen name="SellingBuyingSettings" options={{ presentation: 'card' }}>
          {() => {
            const navigation = useNavigation<any>();
            return <SellingBuyingSettingsScreen onBack={() => navigation.goBack()} />;
          }}
        </Stack.Screen>
        <Stack.Screen name="HelpSupportSettings" options={{ presentation: 'card' }}>
          {() => {
            const navigation = useNavigation<any>();
            return <HelpSupportSettingsScreen onBack={() => navigation.goBack()} />;
          }}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
    </TabBarVisibilityProvider>
  );
}

const styles = StyleSheet.create({
  tabIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    width: 40,
    position: 'relative',
  },
  tabBarLabelText: {
    fontSize: 9,
    fontFamily: fonts.extrabold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginTop: 2,
  },
  sellTabContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    height: 48,
    marginTop: -20,
  },
  sellTabButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    borderWidth: 4,
    borderColor: '#ffffff',
    elevation: 6,
  },
  sellLabelText: {
    fontSize: 9,
    fontFamily: fonts.extrabold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginTop: 2,
  },
});
