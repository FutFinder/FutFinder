import 'react-native-gesture-handler';
import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AppNavigator, { navigationRef } from './src/navigation/AppNavigator';
import { supabase, isSupabaseConfigured } from './src/services/supabase';
import {
  registerForPushNotifications,
  unregisterPushToken,
  addNotificationListeners,
} from './src/services/notifications';

/**
 * Cuando el usuario toca una notif (con la app cerrada o en background),
 * la llevamos a la pantalla relacionada.
 *
 * Esperamos a que el navegador esté listo antes de navegar (a veces el tap
 * pasa antes de que NavigationContainer haya montado).
 */
function handleNotificationTap(response) {
  const data = response?.notification?.request?.content?.data || {};

  const go = () => {
    if (!navigationRef.isReady()) return;
    switch (data.type) {
      case 'message_new':
        if (data.threadId) {
          navigationRef.navigate('ChatThread', { threadId: data.threadId });
        }
        break;
      case 'match_join':
      case 'match_reminder':
      case 'join_request':
      case 'join_approved':
      case 'join_rejected':
        if (data.matchId) {
          navigationRef.navigate('MatchDetail', { matchId: data.matchId });
        }
        break;
      case 'match_rate':
        // Recordatorio de calificar → directo a la pantalla de rating
        if (data.matchId) {
          navigationRef.navigate('RateMatch', { matchId: data.matchId });
        }
        break;
      case 'club_request':
      case 'club_request_accepted':
        // Solicitud de club: el admin la resuelve (y el aceptado la ve)
        // en el detalle del club.
        if (data.clubId) {
          navigationRef.navigate('ClubDetail', { clubId: data.clubId });
        }
        break;
      case 'club_request_rejected':
        // Rechazado: a la pestaña Clubes a buscar otro equipo.
        navigationRef.navigate('Main', { screen: 'ClubsTab' });
        break;
      case 'friend_request':
      case 'friend_accept':
        // Vamos a la pestaña de perfil — luego puedes crear una pantalla "Notificaciones".
        navigationRef.navigate('Main', { screen: 'ProfileTab' });
        break;
      case 'match_cancelled':
        // El partido ya no existe → mandamos a buscar otro
        navigationRef.navigate('Main', { screen: 'SearchTab' });
        break;
      default:
        break;
    }
  };

  // Si el nav aún no está listo, esperamos un poquito
  if (navigationRef.isReady()) go();
  else setTimeout(go, 600);
}

export default function App() {
  // Guardamos el último userId para poder borrar su token al hacer logout
  const lastUserIdRef = useRef(null);

  useEffect(() => {
    // 1) Listeners globales de notifs (received + tapped)
    const cleanupListeners = addNotificationListeners({
      onReceived: (_notif) => {
        // Aquí podrías refrescar badge, mostrar toast, etc.
      },
      onTapped: handleNotificationTap,
    });

    // 2) Si la app se abrió DESDE una notif (estaba cerrada), capturamos eso.
    //    expo-notifications expone getLastNotificationResponseAsync para el cold start.
    (async () => {
      try {
        const { getLastNotificationResponseAsync } = await import(
          'expo-notifications'
        );
        const last = await getLastNotificationResponseAsync();
        if (last) handleNotificationTap(last);
      } catch (_) {
        /* en web esto puede fallar, lo ignoramos */
      }
    })();

    // 3) Si Supabase no está configurado, no enganchamos auth.
    if (!isSupabaseConfigured) {
      return () => {
        cleanupListeners();
      };
    }

    // 4) Registrar token cuando ya hay sesión al arrancar la app
    (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data?.session?.user;
      if (user?.id) {
        lastUserIdRef.current = user.id;
        registerForPushNotifications(user.id);
      }
    })();

    // 5) Reaccionar a login / logout
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user?.id ?? null;

      if (event === 'SIGNED_IN' && userId) {
        lastUserIdRef.current = userId;
        registerForPushNotifications(userId);
      }

      if (event === 'SIGNED_OUT' && lastUserIdRef.current) {
        unregisterPushToken(lastUserIdRef.current);
        lastUserIdRef.current = null;
      }
    });

    return () => {
      cleanupListeners();
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AppNavigator />
    </SafeAreaProvider>
  );
}
