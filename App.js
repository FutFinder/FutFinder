import 'react-native-gesture-handler';
import './global.css';

// Antes que nada: un error que ocurra mientras se monta la app también tiene
// que llegar a alguna parte. Sin `EXPO_PUBLIC_SENTRY_DSN` esto no hace nada.
import { iniciarObservabilidad } from './src/services/observabilidad';

iniciarObservabilidad();
import React, { useEffect } from 'react';
import { Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActionSheetProvider } from '@expo/react-native-action-sheet';
import { useFonts } from 'expo-font';
import {
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';

import AppNavigator, { navigationRef, navigationReadyPromise } from './src/navigation/AppNavigator';
import { AuthProvider } from './src/contexts/AuthContext';
import ErrorBoundary from './src/components/ErrorBoundary';
import { supabase, isSupabaseConfigured } from './src/services/supabase';
import { isSessionUsable } from './src/services/authPolicy';
import { necesitaSegundoPaso, nivelDesdeSesion } from './src/services/mfaPolicy';

// El token de push se registra sólo con una sesión que ya entró del todo: con
// la verificación en dos pasos activada, la contraseña sola deja una sesión
// `aal1` que NO es acceso (AuthContext), y registrar el token ahí dejaba el
// teléfono de quien sabía la contraseña recibiendo los avisos de la cuenta.
// Desde la migración 177 el servidor además rechaza esa petición.
const sesionQueEntro = (session) =>
  isSessionUsable(session) && !necesitaSegundoPaso(nivelDesdeSesion(session));
import {
  registerForPushNotifications,
  addNotificationListeners,
} from './src/services/notifications';
import { navigateToNotification } from './src/utils/notificationTargets';
import { getMatchById } from './src/services/matches';
import { getClubById } from './src/services/clubs';
import AvisosHost from './src/components/AvisosHost';
import NotificationToastHost from './src/components/NotificationToastHost';
import AvisoCookies from './src/components/AvisoCookies';

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
  // Manrope es la tipografía de toda la app (theme/colors.js: `fuentes`).
  // Se espera a que cargue antes de pintar nada: ver `if (!fontsLoaded)`
  // más abajo.
  const [fontsLoaded] = useFonts({
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });

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
      const session = data?.session;
      if (sesionQueEntro(session)) {
        registerForPushNotifications(session.user.id);
      }
    })();

    // 5) Reaccionar a login / logout
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user?.id ?? null;

      // `MFA_CHALLENGE_VERIFIED` es cuando una sesión `aal1` sube a `aal2`.
      if ((event === 'SIGNED_IN' || event === 'MFA_CHALLENGE_VERIFIED') && userId && sesionQueEntro(session)) {
        registerForPushNotifications(userId);
      }

      // El token de push NO se borra en SIGNED_OUT: cuando llega ese evento la
      // sesión ya no existe y el delete sale como anon (42501). Lo da de baja
      // `signOut` antes de cerrar (services/auth.js, utils/cierreDeSesion.js).
    });

    return () => {
      cleanupListeners();
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  // Sin esto, cualquier pantalla podría montarse un instante antes de
  // que Manrope esté lista y quedar con la fuente por defecto hasta el
  // siguiente re-render. La espera es breve (son 4 pesos, ya cacheados tras
  // la primera carga) y el splash animado de la app cubre visualmente esta
  // ventana igual.
  if (!fontsLoaded) return null;

  // Cada pantalla ya trae su propio boundary (ver `withErrorBoundary`), que
  // es el que mantiene la app usable. Éste es la última red: cubre lo que
  // vive FUERA de las pantallas —los proveedores, el navegador mismo— y es
  // lo único que separa un fallo ahí de una pantalla en blanco sin texto.
  return (
    <ErrorBoundary nombre="la aplicación">
      <ActionSheetProvider>
        <SafeAreaProvider>
          <StatusBar style="light" />
          <AuthProvider>
            <AppNavigator />
            {/* Fuera del navegador a propósito: un aviso lanzado por una
                acción que cambia de pantalla se leería a medias si muriera
                con la pantalla que lo lanzó. */}
            <AvisosHost />
            <NotificationToastHost />
            <AvisoCookies
              onVerDetalle={() => {
                if (navigationRef.isReady()) navigationRef.navigate('Cookies');
              }}
            />
          </AuthProvider>
        </SafeAreaProvider>
      </ActionSheetProvider>
    </ErrorBoundary>
  );
}
