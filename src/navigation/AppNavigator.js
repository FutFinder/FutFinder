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
import PublishMatchScreen from '../screens/PublishMatchScreen';
import EditMatchScreen from '../screens/EditMatchScreen';
import ManageMatchScreen from '../screens/ManageMatchScreen';
import MatchRequestStatusScreen from '../screens/MatchRequestStatusScreen';
import MatchSpotScreen from '../screens/MatchSpotScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import ChatThreadScreen from '../screens/ChatThreadScreen';
import ChatDetailsScreen from '../screens/ChatDetailsScreen';
import FriendsScreen from '../screens/FriendsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import MatchDetailScreen from '../screens/MatchDetailScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import RateMatchScreen from '../screens/RateMatchScreen';
import CreateClubScreen from '../screens/CreateClubScreen';
import ClubDetailScreen from '../screens/ClubDetailScreen';
import ClubMembersScreen from '../screens/ClubMembersScreen';
import ClubGalleryScreen from '../screens/ClubGalleryScreen';
import ClubChallengeScreen from '../screens/ClubChallengeScreen';
import ClubChallengesScreen from '../screens/ClubChallengesScreen';
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
 * Deep links.
 *
 * La hoja de compartir del módulo Partidos genera enlaces
 * `futfinder.cl/p/<id>`, así que la app tiene que saber abrirlos: sin esto el
 * enlace compartido caía en la raíz. En web además hace que cada pantalla
 * tenga una URL propia, así que recargar no pierde el contexto.
 */
const linking = {
  prefixes: ['futfinder://', 'https://futfinder.cl', 'https://www.futfinder.cl'],
  config: {
    screens: {
      Main: {
        screens: {
          HomeTab: 'inicio',
          SearchTab: 'partidos',
          ClubsTab: 'clubes',
          ChatTab: 'chat',
          ProfileTab: 'perfil',
        },
      },
      // `p/<id>` es el formato del enlace público que compartimos.
      MatchDetail: 'p/:matchId',
      ManageMatch: 'p/:matchId/gestionar',
      MatchSpot: 'p/:matchId/mi-cupo',
      MatchRequestStatus: 'p/:matchId/mi-solicitud',
      EditMatch: 'p/:matchId/editar',
      CreateMatch: 'publicar',
    },
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
    <NavigationContainer ref={navigationRef} theme={navTheme} linking={linking}>
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
        {/*
          Publicar un partido es un wizard de 3 pasos; editar uno publicado es
          un formulario único. La ruta CreateMatch se mantiene porque la usan
          Inicio, la tab de crear y el flujo de desafíos entre clubes.
        */}
        <Stack.Screen
          name="CreateMatch"
          component={PublishMatchScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="EditMatch"
          component={EditMatchScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="ManageMatch"
          component={ManageMatchScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="MatchRequestStatus"
          component={MatchRequestStatusScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="MatchSpot"
          component={MatchSpotScreen}
          options={{ animation: 'slide_from_right' }}
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
          name="ChatDetails"
          component={ChatDetailsScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="Friends"
          component={FriendsScreen}
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
          name="ClubMembers"
          component={ClubMembersScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="ClubGallery"
          component={ClubGalleryScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="ClubChallenge"
          component={ClubChallengeScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="ClubChallenges"
          component={ClubChallengesScreen}
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
