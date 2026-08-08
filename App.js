import 'react-native-gesture-handler';
import './global.css';
import React, { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActionSheetProvider } from '@expo/react-native-action-sheet';

import AppNavigator, { navigationRef, navigationReadyPromise } from './src/navigation/AppNavigator';
import { AuthProvider } from './src/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from './src/services/supabase';
import {
  registerForPushNotifications,
  unregisterPushToken,
  addNotificationListeners,
} from './src/services/notifications';
import { navigateToNotification } from './src/utils/notificationTargets';
import { getMatchById } from './src/services/matches';
import { getClubById } from './src/services/clubs';

// Ids de notificación (fila real de `notifications`, no el id efímero del
// push) ya procesados en esta sesión de la app. `getLastNotificationResponseAsync`
// (arranque frío) y `addNotificationResponseReceivedListener` pueden entregar
// el mismo tap dos veces — sin esto, navegaríamos al mismo destino dos veces.
const handledNotificationIds = new Set();

/**
 * Espera a que el NavigationContainer haya montado (onReady) y a que ya no
 * estemos parados en Splash — recién ahí sabemos que la sesión terminó de
 * resolverse y que la pila de navegación tiene la ruta inicial correcta
 * (Main / Welcome / LocationPermission). Navegar antes de eso es lo que
 * causaba el bug: un tap de push podía "adelantarse" a Splash y terminar
 * pisado por su propio `navigation.reset(...)` un instante después.
 *
 * Reemplaza el reintento único de 600ms: en vez de una espera fija, un push
 * recibido durante el arranque frío queda pendiente (esta promesa) hasta que
 * la navegación esté realmente lista, sin cota de tiempo arbitraria — salvo
 * una red de seguridad generosa para no bloquear el tap para siempre si algo
 * saliera mal.
 */
async function waitUntilPastSplash() {
  await navigationReadyPromise;
  if (navigationRef.getCurrentRoute()?.name !== 'Splash') return;

  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(safety);
      unsubscribe();
      resolve();
    };
    const unsubscribe = navigationRef.addListener('state', () => {
      if (navigationRef.getCurrentRoute()?.name !== 'Splash') finish();
    });
    const safety = setTimeout(finish, 15000);
  });
}

/**
 * Cuando el usuario toca una notif (con la app cerrada, en background, o
 * abierta), la llevamos a la pantalla relacionada. Comparte con
 * NotificationsScreen la misma resolución de destino (ver
 * `utils/notificationTargets`), así que un tipo nuevo solo se agrega una vez.
 */
async function handleNotificationTap(response) {
  const data = response?.notification?.request?.content?.data || {};
  const id = data.notificationId || response?.notification?.request?.identifier;
  if (id) {
    if (handledNotificationIds.has(id)) return;
    handledNotificationIds.add(id);
  }

  await waitUntilPastSplash();

  await navigateToNotification(
    { type: data.type, data },
    {
      navigate: (screen, params) => navigationRef.navigate(screen, params),
      onMissing: (copy) => Alert.alert(copy.title, copy.message),
      onUnresolved: (copy) => Alert.alert(copy.title, copy.message),
      getMatchById,
      getClubById,
    }
  );
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
    <ActionSheetProvider>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AuthProvider>
          <AppNavigator />
        </AuthProvider>
      </SafeAreaProvider>
    </ActionSheetProvider>
  );
}
