import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import React from 'react';
import {StyleSheet, Text} from 'react-native';
import {colors, fontSize} from '@/constants/theme';
import {AddStockScreen} from '@/screens/AddStockScreen';
import {DashboardScreen} from '@/screens/DashboardScreen';
import {ImageBarcodeScreen} from '@/screens/ImageBarcodeScreen';
import {InventoryHistoryScreen} from '@/screens/InventoryHistoryScreen';
import {MoreScreen} from '@/screens/MoreScreen';
import {ProductDetailScreen} from '@/screens/ProductDetailScreen';
import {ProductFormScreen} from '@/screens/ProductFormScreen';
import {ProductImagesScreen} from '@/screens/ProductImagesScreen';
import {ProductListScreen} from '@/screens/ProductListScreen';
import {SaleDetailScreen} from '@/screens/SaleDetailScreen';
import {SalesScreen} from '@/screens/SalesScreen';
import {ScanResultScreen} from '@/screens/ScanResultScreen';
import {ScannerScreen} from '@/screens/ScannerScreen';
import {SellScreen} from '@/screens/SellScreen';
import {SettingsScreen} from '@/screens/SettingsScreen';
import {StockAdjustScreen} from '@/screens/StockAdjustScreen';
import type {RootStackParamList, TabParamList} from './types';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Text glyphs instead of a vector-icon package: one less native dependency to
 * link, and the app ships no font assets it does not need.
 */
function tabIcon(glyph: string) {
  return function TabIcon({color}: {color: string}) {
    return <Text style={[styles.icon, {color}]}>{glyph}</Text>;
  };
}

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: {backgroundColor: colors.primary},
        headerTintColor: colors.white,
        headerTitleStyle: {fontWeight: '700'},
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {backgroundColor: colors.surface, borderTopColor: colors.border},
        tabBarLabelStyle: {fontSize: fontSize.xs, fontWeight: '700'},
      }}>
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{title: 'Dashboard', tabBarIcon: tabIcon('▦')}}
      />
      <Tab.Screen
        name="Products"
        component={ProductListScreen}
        options={{title: 'Products', tabBarIcon: tabIcon('▤')}}
      />
      <Tab.Screen
        name="Sales"
        component={SalesScreen}
        options={{title: 'Sales', tabBarIcon: tabIcon('₹')}}
      />
      <Tab.Screen
        name="More"
        component={MoreScreen}
        options={{title: 'More', tabBarIcon: tabIcon('☰')}}
      />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {backgroundColor: colors.primary},
        headerTintColor: colors.white,
        headerTitleStyle: {fontWeight: '700'},
        headerBackButtonDisplayMode: 'minimal',
      }}>
      <Stack.Screen name="Tabs" component={Tabs} options={{headerShown: false}} />
      <Stack.Screen
        name="Scanner"
        component={ScannerScreen}
        options={{headerShown: false, animation: 'fade'}}
      />
      <Stack.Screen
        name="ScanResult"
        component={ScanResultScreen}
        options={{title: 'Scan result'}}
      />
      <Stack.Screen
        name="ProductDetail"
        component={ProductDetailScreen}
        options={{title: 'Product'}}
      />
      <Stack.Screen name="ProductForm" component={ProductFormScreen} options={{title: 'Product'}} />
      <Stack.Screen
        name="ProductImages"
        component={ProductImagesScreen}
        options={{title: 'Photos'}}
      />
      <Stack.Screen
        name="ImageBarcode"
        component={ImageBarcodeScreen}
        options={{title: 'Barcode from photo'}}
      />
      <Stack.Screen name="Sell" component={SellScreen} options={{title: 'Sell'}} />
      <Stack.Screen name="AddStock" component={AddStockScreen} options={{title: 'Add stock'}} />
      <Stack.Screen
        name="StockAdjust"
        component={StockAdjustScreen}
        options={{title: 'Adjust stock'}}
      />
      <Stack.Screen name="SaleDetail" component={SaleDetailScreen} options={{title: 'Sale'}} />
      <Stack.Screen
        name="InventoryHistory"
        component={InventoryHistoryScreen}
        options={{title: 'Stock history'}}
      />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{title: 'Settings'}} />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  icon: {
    fontSize: 20,
    lineHeight: 24,
  },
});
