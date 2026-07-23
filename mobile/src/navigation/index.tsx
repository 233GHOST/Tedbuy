import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { View, Text, StyleSheet } from 'react-native';
import { HomeScreen } from '../screens/HomeScreen';
import { ChatsScreen } from '../screens/ChatsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { SellScreen } from '../screens/SellScreen';
import { ProductDetailScreen } from '../screens/ProductDetailScreen';
import { SellerProfileScreen } from '../screens/SellerProfileScreen';
import { MainTabsParamList, RootStackParamList } from '../types';
import { Product } from '../types';

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
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#0f172a',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#e2e8f0',
          borderTopWidth: 1,
          height: 68,
          paddingBottom: 8,
          paddingTop: 6,
          shadowColor: '#0f172a',
          shadowOpacity: 0.08,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -4 },
          elevation: 8,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeStackScreen}
        options={{
          tabBarLabel: ({ focused }) => (
            <Text style={[
              styles.tabBarLabelText,
              focused ? styles.tabBarLabelActive : styles.tabBarLabelInactive
            ]}>
              HOME
            </Text>
          ),
          tabBarIcon: ({ focused }) => (
            <View style={styles.tabIconContainer}>
              <Text style={[styles.tabIconEmoji, focused && styles.tabIconEmojiActive]}>🏠</Text>
              {focused && <View style={styles.activeIndicatorDot} />}
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={{
          tabBarLabel: ({ focused }) => (
            <Text style={[
              styles.tabBarLabelText,
              focused ? styles.tabBarLabelActive : styles.tabBarLabelInactive
            ]}>
              SEARCH
            </Text>
          ),
          tabBarIcon: ({ focused }) => (
            <View style={styles.tabIconContainer}>
              <Text style={[styles.tabIconEmoji, focused && styles.tabIconEmojiActive]}>🔍</Text>
              {focused && <View style={styles.activeIndicatorDot} />}
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Sell"
        component={SellScreen}
        options={{
          tabBarLabel: () => (
            <Text style={styles.sellLabelText}>SELL</Text>
          ),
          tabBarIcon: () => (
            <View style={styles.sellTabContainer}>
              <View style={styles.sellTabButton}>
                <Text style={styles.sellTabButtonPlus}>+</Text>
              </View>
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Chats"
        component={ChatsScreen}
        options={{
          tabBarLabel: ({ focused }) => (
            <Text style={[
              styles.tabBarLabelText,
              focused ? styles.tabBarLabelActive : styles.tabBarLabelInactive
            ]}>
              CHATS
            </Text>
          ),
          tabBarIcon: ({ focused }) => (
            <View style={styles.tabIconContainer}>
              <Text style={[styles.tabIconEmoji, focused && styles.tabIconEmojiActive]}>💬</Text>
              {focused && <View style={styles.activeIndicatorDot} />}
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: ({ focused }) => (
            <Text style={[
              styles.tabBarLabelText,
              focused ? styles.tabBarLabelActive : styles.tabBarLabelInactive
            ]}>
              PROFILE
            </Text>
          ),
          tabBarIcon: ({ focused }) => (
            <View style={styles.tabIconContainer}>
              <Text style={[styles.tabIconEmoji, focused && styles.tabIconEmojiActive]}>👤</Text>
              {focused && <View style={styles.activeIndicatorDot} />}
            </View>
          ),
        }}
      />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
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
              />
            );
          }}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
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
  tabIconEmoji: {
    fontSize: 20,
    opacity: 0.7,
  },
  tabIconEmojiActive: {
    fontSize: 22,
    opacity: 1,
  },
  activeIndicatorDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#0f172a',
    position: 'absolute',
    bottom: -2,
  },
  tabBarLabelText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginTop: 2,
  },
  tabBarLabelActive: {
    color: '#0f172a',
    fontWeight: '950',
  },
  tabBarLabelInactive: {
    color: '#94a3b8',
    fontWeight: '600',
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
  sellTabButtonPlus: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '900',
    marginTop: -2,
  },
  sellLabelText: {
    fontSize: 9,
    fontWeight: '950',
    color: '#0f172a',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginTop: 2,
  },
});
