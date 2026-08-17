import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
  DarkTheme as NavDarkTheme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Ref global para poder navegar desde fuera de las pantallas
// (la usamos en App.js para reaccionar al tap de una notif push).
export const navigationRef = createNavigationContainerRef();

// Se resuelve cuando el NavigationContainer terminó de montar (onReady).
// App.js lo espera antes de tocar navigationRef.addListener/.navigate — antes
// de eso, el ref existe pero no está "attached" y esas llamadas no son seguras.
let resolveNavigationReady;
export const navigationReadyPromise = new Promise((resolve) => {
  resolveNavigationReady = resolve;
});

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
import ClubProposalScreen from '../screens/ClubProposalScreen';
import ClubMatchRosterScreen from '../screens/ClubMatchRosterScreen';
import ClubMatchChangeScreen from '../screens/ClubMatchChangeScreen';
import ExploreClubsScreen from '../screens/ExploreClubsScreen';
import ClubPlansScreen from '../screens/ClubPlansScreen';
import EditClubScreen from '../screens/EditClubScreen';
import ClubInviteScreen from '../screens/ClubInviteScreen';
import SettingsScreen from '../screens/SettingsScreen';
import TrustScoreHistoryScreen from '../screens/TrustScoreHistoryScreen';
import ReservasUiGalleryScreen from '../screens/ReservasUiGalleryScreen';
import MainTabs from './MainTabs';
import withAuthGuard from './withAuthGuard';
import withErrorBoundary from './withErrorBoundary';
import { useAuth } from '../contexts/AuthContext';

import { colors } from '../theme/colors';

const Stack = createNativeStackNavigator();

// Rutas de onboarding: son las únicas que se pueden ver sin sesión. Todo lo
// demás en este stack pasa por `withAuthGuard`, que ya les pone su propio
// error boundary. Éstas no pasan por el guard, así que se les envuelve a
// mano: un fallo en Login o en Splash dejaría la app en blanco antes
// siquiera de poder iniciar sesión.
const SafeSplashScreen = withErrorBoundary(SplashScreen, 'Splash');
const SafeWelcomeScreen = withErrorBoundary(WelcomeScreen, 'Welcome');
const SafeLoginScreen = withErrorBoundary(LoginScreen, 'Login');
const SafeVerificationScreen = withErrorBoundary(VerificationScreen, 'Verification');
const SafeLocationPermissionScreen = withErrorBoundary(LocationPermissionScreen, 'LocationPermission');
const SafeTermsScreen = withErrorBoundary(TermsScreen, 'Terms');
const SafeSuccessScreen = withErrorBoundary(SuccessScreen, 'Success');
// Galería interna de QA (Fase 1 del handoff de Reservas): no muestra datos
// de usuario, así que no pasa por withAuthGuard — es la misma razón por la
// que Welcome/Login tampoco lo hacen.
const SafeReservasUiGalleryScreen = withErrorBoundary(ReservasUiGalleryScreen, 'ReservasUiGallery');

const GuardedMainTabs = withAuthGuard(MainTabs, 'Main');
const GuardedPublishMatchScreen = withAuthGuard(PublishMatchScreen, 'CreateMatch');
const GuardedEditMatchScreen = withAuthGuard(EditMatchScreen, 'EditMatch');
const GuardedManageMatchScreen = withAuthGuard(ManageMatchScreen, 'ManageMatch');
const GuardedMatchRequestStatusScreen = withAuthGuard(MatchRequestStatusScreen, 'MatchRequestStatus');
const GuardedMatchSpotScreen = withAuthGuard(MatchSpotScreen, 'MatchSpot');
const GuardedEditProfileScreen = withAuthGuard(EditProfileScreen, 'EditProfile');
const GuardedChatThreadScreen = withAuthGuard(ChatThreadScreen, 'ChatThread');
const GuardedChatDetailsScreen = withAuthGuard(ChatDetailsScreen, 'ChatDetails');
const GuardedFriendsScreen = withAuthGuard(FriendsScreen, 'Friends');
const GuardedProfileScreen = withAuthGuard(ProfileScreen, 'UserProfile');
const GuardedMatchDetailScreen = withAuthGuard(MatchDetailScreen, 'MatchDetail');
const GuardedNotificationsScreen = withAuthGuard(NotificationsScreen, 'Notifications');
const GuardedRateMatchScreen = withAuthGuard(RateMatchScreen, 'RateMatch');
const GuardedCreateClubScreen = withAuthGuard(CreateClubScreen, 'CreateClub');
const GuardedClubDetailScreen = withAuthGuard(ClubDetailScreen, 'ClubDetail');
const GuardedClubMembersScreen = withAuthGuard(ClubMembersScreen, 'ClubMembers');
const GuardedClubGalleryScreen = withAuthGuard(ClubGalleryScreen, 'ClubGallery');
const GuardedClubChallengeScreen = withAuthGuard(ClubChallengeScreen, 'ClubChallenge');
const GuardedClubChallengesScreen = withAuthGuard(ClubChallengesScreen, 'ClubChallenges');
const GuardedClubProposalScreen = withAuthGuard(ClubProposalScreen, 'ClubProposal');
const GuardedClubMatchRosterScreen = withAuthGuard(ClubMatchRosterScreen, 'ClubMatchRoster');
const GuardedClubMatchChangeScreen = withAuthGuard(ClubMatchChangeScreen, 'ClubMatchChange');
const GuardedExploreClubsScreen = withAuthGuard(ExploreClubsScreen, 'ExploreClubs');
const GuardedClubPlansScreen = withAuthGuard(ClubPlansScreen, 'ClubPlans');
const GuardedEditClubScreen = withAuthGuard(EditClubScreen, 'EditClub');
const GuardedClubInviteScreen = withAuthGuard(ClubInviteScreen, 'ClubInvite');
const GuardedSettingsScreen = withAuthGuard(SettingsScreen, 'Settings');
const GuardedTrustScoreHistoryScreen = withAuthGuard(TrustScoreHistoryScreen, 'TrustScoreHistory');

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
      // Destino del CTA «IR AHORA» de los avisos de desafío. Sin esta
      // entrada, tocar el push con la app cerrada dejaba al usuario en la
      // raíz en vez de en la conversación.
      ChatThread: 'chat/:threadKey',
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
  const { isReady } = useAuth();

  // La sesión tiene que quedar resuelta ANTES de montar el NavigationContainer:
  // es el dueño de `linking`, así que si lo montamos antes, un deep link
  // (ej. futfinder.cl/p/123) se procesaría sin saber todavía si hay sesión.
  if (!isReady) {
    return <View style={styles.authLoading} />;
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      linking={linking}
      onReady={resolveNavigationReady}
    >
      <Stack.Navigator
        initialRouteName="Splash"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="Splash" component={SafeSplashScreen} options={{ animation: 'none' }} />
        <Stack.Screen name="Welcome" component={SafeWelcomeScreen} options={{ animation: 'fade' }} />
        <Stack.Screen name="Login" component={SafeLoginScreen} />
        <Stack.Screen name="Verification" component={SafeVerificationScreen} />
        <Stack.Screen name="LocationPermission" component={SafeLocationPermissionScreen} />
        <Stack.Screen name="Terms" component={SafeTermsScreen} />
        <Stack.Screen name="Success" component={SafeSuccessScreen} options={{ animation: 'fade' }} />

        {/* Una vez logueado, el usuario vive dentro de Main (tabs) */}
        <Stack.Screen name="Main" component={GuardedMainTabs} options={{ animation: 'fade' }} />

        {/* Detalles que se abren sobre las tabs (la tab bar se oculta) */}
        {/*
          Publicar un partido es un wizard de 3 pasos; editar uno publicado es
          un formulario único. La ruta CreateMatch se mantiene porque la usan
          Inicio, la tab de crear y el flujo de desafíos entre clubes.
        */}
        <Stack.Screen
          name="CreateMatch"
          component={GuardedPublishMatchScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="EditMatch"
          component={GuardedEditMatchScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="ManageMatch"
          component={GuardedManageMatchScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="MatchRequestStatus"
          component={GuardedMatchRequestStatusScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="MatchSpot"
          component={GuardedMatchSpotScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="EditProfile"
          component={GuardedEditProfileScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="ChatThread"
          component={GuardedChatThreadScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="ChatDetails"
          component={GuardedChatDetailsScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="Friends"
          component={GuardedFriendsScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="UserProfile"
          component={GuardedProfileScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="MatchDetail"
          component={GuardedMatchDetailScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="Notifications"
          component={GuardedNotificationsScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="RateMatch"
          component={GuardedRateMatchScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="CreateClub"
          component={GuardedCreateClubScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="ClubDetail"
          component={GuardedClubDetailScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="ClubMembers"
          component={GuardedClubMembersScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="ClubGallery"
          component={GuardedClubGalleryScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="ClubChallenge"
          component={GuardedClubChallengeScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="ClubChallenges"
          component={GuardedClubChallengesScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="ClubProposal"
          component={GuardedClubProposalScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="ClubMatchRoster"
          component={GuardedClubMatchRosterScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="ClubMatchChange"
          component={GuardedClubMatchChangeScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="ExploreClubs"
          component={GuardedExploreClubsScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="ClubPlans"
          component={GuardedClubPlansScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="EditClub"
          component={GuardedEditClubScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="ClubInvite"
          component={GuardedClubInviteScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="Settings"
          component={GuardedSettingsScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="TrustScoreHistory"
          component={GuardedTrustScoreHistoryScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="ReservasUiGallery"
          component={SafeReservasUiGalleryScreen}
          options={{ animation: 'slide_from_right' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  authLoading: { flex: 1, backgroundColor: colors.background },
});
