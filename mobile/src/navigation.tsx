import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { View, Text, StyleSheet } from 'react-native';
import { HomeScreen } from './screens/HomeScreen';
import { ChatsScreen } from './screens/ChatsScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SearchScreen } from './screens/SearchScreen';
import { SellScreen } from './screens/SellScreen';
import { ProductDetailScreen } from './screens/ProductDetailScreen';
import { MainTabsParamList, RootStackParamList } from './types';
import { Product } from './types';

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
        tabBarActiveTintColor: '#ea580c',
        tabBarInactiveTintColor: '#64748b',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#e2e8f0',
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 8,
          paddingTop: 6,
          shadowColor: '#0f172a',
          shadowOpacity: 0.05,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: -3 },
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '800', marginTop: 2 },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeStackScreen}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 18, color }}>🏠</Text>
          ),
        }}
      />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={{
          tabBarLabel: 'Search',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 18, color }}>🔍</Text>
          ),
        }}
      />
      <Tab.Screen
        name="Sell"
        component={SellScreen}
        options={{
          tabBarLabel: () => null,
          tabBarIcon: () => (
            <View style={styles.sellTabButton}>
              <Text style={styles.sellTabButtonPlus}>+</Text>
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Chats"
        component={ChatsScreen}
        options={{
          tabBarLabel: 'Chats',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 18, color }}>💬</Text>
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 18, color }}>👤</Text>
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  sellTabButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -20,
    shadowColor: '#ea580c',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    borderWidth: 2,
    borderColor: '#ffffff',
    elevation: 4,
  },
  sellTabButtonPlus: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '800',
    marginTop: -3,
  },
});
