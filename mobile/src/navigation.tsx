import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { HomeScreen } from './screens/HomeScreen';
import { ChatsScreen } from './screens/ChatsScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { ProductDetailScreen } from './screens/ProductDetailScreen';
import { MainTabsParamList, RootStackParamList } from './types';
import { Product } from './types';

const Tab = createBottomTabNavigator<MainTabsParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function HomeStackScreen() {
  const navigation = useNavigation<any>();

  return (
    <HomeScreen
      onOpenProduct={(product: Product) => navigation.navigate('ProductDetail', { productId: product.id })}
    />
  );
}

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarActiveTintColor: '#0f766e', tabBarInactiveTintColor: '#64748b' }}>
      <Tab.Screen name="Home" component={HomeStackScreen} />
      <Tab.Screen name="Chats" component={ChatsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="MainTabs" component={MainTabs} />
        <Stack.Screen name="ProductDetail" options={{ presentation: 'card' }}>
          {({ route }) => <ProductDetailScreen productId={route.params.productId} onBack={() => {}} />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
