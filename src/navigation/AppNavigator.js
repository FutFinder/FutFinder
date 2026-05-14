import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import WelcomeScreen from '../screens/WelcomeScreen';
import LoginScreen from '../screens/LoginScreen';
import VerificationScreen from '../screens/VerificationScreen';
import LocationPermissionScreen from '../screens/LocationPermissionScreen';
import TermsScreen from '../screens/TermsScreen';
import SuccessScreen from '../screens/SuccessScreen';
import CreateMatchScreen from '../screens/CreateMatchScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import ChatThreadScreen from '../screens/ChatThreadScreen';
import ProfileScreen from '../screens/ProfileScreen';
import MatchDetailScreen from '../screens/MatchDetailScreen';
import MainTabs from './MainTabs';

import { colors } from '../theme/colors';

const Stack = createNativeStackNavigator();

const navTheme = {
  dark: true,
  colors: {
    primary: colors.primary,
    background: colors.background,
    card: colors.background,
    text: colors.textPrimary,
    border: colors.border,
    notification: colors.primary,
  },
};

/**
 * Estructura de la app:
 *
 *  RootStack
 *  ├── Welcome (initial)
 *  ├── Login / Verification / LocationPermission / Terms / Success  (onboarding)
 *  ├── Main         ← BottomTabs (HomeTab, SearchTab, CreateTab*, ChatTab, ProfileTab)
 *  ├── CreateMatch  (modal-style, oculta tab bar)
 *  └── EditProfile  (modal-style, oculta tab bar)
 *
 *  * CreateTab intercepta el press y navega al stack CreateMatch.
 */
export default function AppNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        initialRouteName="Welcome"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ animation: 'fade' }} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Verification" component={VerificationScreen} />
        <Stack.Screen name="LocationPermission" component={LocationPermissionScreen} />
        <Stack.Screen name="Terms" component={TermsScreen} />
        <Stack.Screen name="Success" component={SuccessScreen} options={{ animation: 'fade' }} />

        {/* Una vez logueado, el usuario vive dentro de Main (tabs) */}
        <Stack.Screen name="Main" component={MainTabs} options={{ animation: 'fade' }} />

        {/* Detalles que se abren sobre las tabs (la tab bar se oculta) */}
        <Stack.Screen
          name="CreateMatch"
          component={CreateMatchScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="EditProfile"
          component={EditProfileScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="ChatThread"
          component={ChatThreadScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="UserProfile"
          component={ProfileScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="MatchDetail"
          component={MatchDetailScreen}
          options={{ animation: 'slide_from_right' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
