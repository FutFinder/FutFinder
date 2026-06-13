import React from 'react';
import {
  NavigationContainer,
  createNavigationContainerRef,
  DarkTheme as NavDarkTheme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Ref global para poder navegar desde fuera de las pantallas
// (la usamos en App.js para reaccionar al tap de una notif push).
export const navigationRef = createNavigationContainerRef();

import SplashScreen from '../screens/SplashScreen';
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
import NotificationsScreen from '../screens/NotificationsScreen';
import RateMatchScreen from '../screens/RateMatchScreen';
import CreateClubScreen from '../screens/CreateClubScreen';
import ClubDetailScreen from '../screens/ClubDetailScreen';
import ExploreClubsScreen from '../screens/ExploreClubsScreen';
import ClubPlansScreen from '../screens/ClubPlansScreen';
import EditClubScreen from '../screens/EditClubScreen';
import ClubInviteScreen from '../screens/ClubInviteScreen';
import SettingsScreen from '../screens/SettingsScreen';
import TrustScoreHistoryScreen from '../screens/TrustScoreHistoryScreen';
import MainTabs from './MainTabs';

import { colors } from '../theme/colors';

const Stack = createNativeStackNavigator();

// Extendemos DarkTheme (que ya trae fonts + colors completos)
// y le pisamos solo los colores corporativos de FutFinder.
const navTheme = {
  ...NavDarkTheme,
  dark: true,
  colors: {
    ...NavDarkTheme.colors,
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
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      <Stack.Navigator
        initialRouteName="Splash"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="Splash" component={SplashScreen} options={{ animation: 'none' }} />
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
        <Stack.Screen
          name="Notifications"
          component={NotificationsScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="RateMatch"
          component={RateMatchScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="CreateClub"
          component={CreateClubScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="ClubDetail"
          component={ClubDetailScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="ExploreClubs"
          component={ExploreClubsScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="ClubPlans"
          component={ClubPlansScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="EditClub"
          component={EditClubScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="ClubInvite"
          component={ClubInviteScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="TrustScoreHistory"
          component={TrustScoreHistoryScreen}
          options={{ animation: 'slide_from_right' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
