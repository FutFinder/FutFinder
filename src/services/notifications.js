import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import { supabase, isSupabaseConfigured } from './supabase';
// El multiplexado de un canal Realtime es lógica pura y ya estaba resuelta
// para el chat: se reutiliza en vez de escribir una segunda versión.
import { createSharedChannel } from '../utils/chatMeta';

/**
 * Servicio de notificaciones push de FutFinder.
 *
 * Flujo:
 *  1. registerForPushNotifications(userId)
 *     - pide permisos
 *     - obtiene Expo push token
 *     - lo guarda en la tabla `push_tokens`
 *  2. addNotificationListeners({ onReceived, onTapped })
 *     - se llama una vez en App.js para reaccionar a notifs
 *  3. unregisterPushToken(userId) (al hacer logout)
 *
 * Nota: en web no se obtienen push tokens nativos (FCM/APNs).
 * En simuladores tampoco funciona, solo dispositivos físicos.
 */

// =========================================================
// 1. Configuración global del comportamiento de notifs
// =========================================================
// Cómo se muestra una notif cuando la app está EN PRIMER PLANO.
// Por defecto Expo no muestra nada con la app abierta — esto lo cambia.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // shouldShowAlert quedó obsoleto: ahora se controla por separado el
    // banner (foreground) y la entrada en el centro de notificaciones.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// =========================================================
// 2. Registro del push token
// =========================================================

/**
 * Pide permisos, obtiene el token y lo guarda en Supabase.
 * Devuelve { token, error }.
 */
export async function registerForPushNotifications(userId) {
  try {
    // Web: no aplica push nativo
    if (Platform.OS === 'web') {
      return { token: null, error: null, skipped: 'web' };
    }
    // Simuladores: no funcionan
    if (!Device.isDevice) {
      console.log('[push] No se ejecuta en simulador.');
      return { token: null, error: null, skipped: 'simulator' };
    }

    // 2.1 Canal Android (sin esto NO suena en Android)
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'FutFinder',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#71B533',
      });
    }

    // 2.2 Permisos
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      return { token: null, error: new Error('Permiso de notificaciones denegado') };
    }

    // 2.3 Obtener Expo push token
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId;

    if (!projectId) {
      return {
        token: null,
        error: new Error('Falta projectId en app.config.js (extra.eas.projectId)'),
      };
    }

    const tokenResp = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResp.data;
    console.log('[push] Expo token:', token);

    // 2.4 Guardar en Supabase
    if (isSupabaseConfigured && userId) {
      const { error } = await supabase
        .from('push_tokens')
        .upsert(
          {
            user_id: userId,
            token,
            platform: Platform.OS,
            device_name: Device.deviceName || Device.modelName || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,token' }
        );
      if (error) {
        console.warn('[push] error guardando token', error);
        return { token, error };
      }
    }

    return { token, error: null };
  } catch (err) {
    console.warn('[push] error general', err);
    return { token: null, error: err };
  }
}

/**
 * Borra el token del dispositivo actual al hacer logout.
 * (Si no lo borras, ese dispositivo seguirá recibiendo pushes del usuario anterior.)
 */
export async function unregisterPushToken(userId) {
  try {
    if (!isSupabaseConfigured || !userId) return { error: null };
    if (Platform.OS === 'web') return { error: null };

    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId;
    if (!projectId) return { error: null };

    const tokenResp = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResp.data;

    const { error } = await supabase
      .from('push_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('token', token);

    return { error };
  } catch (err) {
    return { error: err };
  }
}

// =========================================================
// 3. Listeners (notif recibida / tapeada)
// =========================================================

/**
 * Registra listeners globales.
 * onReceived(notification) → app abierta, llega push
 * onTapped(response)       → el usuario tocó la notif (en cualquier estado)
 *
 * Devuelve una función para limpiar listeners (llamar en cleanup).
 */
export function addNotificationListeners({ onReceived, onTapped } = {}) {
  const sub1 = Notifications.addNotificationReceivedListener((notif) => {
    console.log('[push] received', notif);
    onReceived?.(notif);
  });
  const sub2 = Notifications.addNotificationResponseReceivedListener((resp) => {
    console.log('[push] tapped', resp);
    onTapped?.(resp);
  });
  return () => {
    sub1.remove();
    sub2.remove();
  };
}

// =========================================================
// 4. Helpers de inbox (tabla notifications)
// =========================================================

/**
 * Lista notificaciones del usuario actual (más recientes primero).
 *
 * Sin sesión, RLS devolvería igualmente una lista vacía (no hay
 * `auth.uid()` con el que calzar `user_id`) — eso se vería como "Todo al
 * día" en la bandeja, aunque el motivo real sea la falta de sesión. Se
 * chequea `user` explícitamente para distinguir ambos casos, igual que ya
 * hace `deleteAllNotifications` en este mismo archivo.
 */
export async function listNotifications({ limit = 50 } = {}) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: [], error: { message: 'No autenticado' } };
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  return { data: data || [], error };
}

/** Cuenta cuántas no leídas tiene el usuario (para badge). */
export async function countUnread() {
  if (!isSupabaseConfigured) return 0;
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('read', false);
  if (error) return 0;
  return count || 0;
}

/** Marca una notif como leída. */
export async function markAsRead(notificationId) {
  if (!isSupabaseConfigured) return { error: null };
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', notificationId);
  return { error };
}

/** Marca todas como leídas. */
export async function markAllAsRead() {
  if (!isSupabaseConfigured) return { error: null };
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('read', false);
  return { error };
}

/** Borra una notificación. */
export async function deleteNotification(notificationId) {
  if (!isSupabaseConfigured) return { error: null };
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', notificationId);
  return { error };
}

/** Borra TODAS las notificaciones del usuario actual. */
export async function deleteAllNotifications() {
  if (!isSupabaseConfigured) return { error: null };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: { message: 'No autenticado' } };
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('user_id', user.id);
  return { error };
}

/**
 * Suscripción Realtime a notificaciones del usuario actual.
 * Escucha INSERT (notif nueva) y UPDATE (agrupación de mensajes).
 * onEvent(notif) recibe la row actualizada en ambos casos.
 * Devuelve función para unsubscribe.
 */
/**
 * Un canal compartido POR USUARIO, no uno por llamador.
 *
 * `supabase.channel(topic)` NO crea un canal nuevo si ya existe uno con
 * ese topic: devuelve el que hay (ver `RealtimeClient.channel`). Como el
 * topic acá es determinista (`notif-<userId>`), el segundo llamador
 * recibía un canal YA SUSCRITO y el `.on('postgres_changes', …)`
 * encadenado reventaba con «cannot add postgres_changes callbacks for
 * realtime channel after subscribe()».
 *
 * Pasaba de verdad: el badge de `MainTabs` está suscrito siempre, así que
 * abrir la pantalla de Avisos disparaba el error.
 *
 * Se resuelve igual que en el chat (`createSharedChannel`): un solo canal
 * real por usuario, abierto con el primer suscriptor y cerrado con el
 * último, y cada llamador recibe los mismos eventos.
 */
const canalesPorUsuario = new Map();

function canalDeNotificaciones(userId) {
  let compartido = canalesPorUsuario.get(userId);
  if (compartido) return compartido;

  compartido = createSharedChannel({
    open: ({ emit }) => {
      const filtro = {
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      };
      return supabase
        .channel(`notif-${userId}`)
        .on('postgres_changes', { ...filtro, event: 'INSERT' }, (p) => emit(p.new))
        .on('postgres_changes', { ...filtro, event: 'UPDATE' }, (p) => emit(p.new))
        .subscribe();
    },
    close: (channel) => {
      canalesPorUsuario.delete(userId);
      try {
        supabase.removeChannel(channel);
      } catch {
        // noop
      }
    },
  });

  canalesPorUsuario.set(userId, compartido);
  return compartido;
}

export function subscribeToNotifications(userId, onEvent) {
  if (!isSupabaseConfigured || !userId) return () => {};
  return canalDeNotificaciones(userId).subscribe((notif) => onEvent?.(notif));
}
