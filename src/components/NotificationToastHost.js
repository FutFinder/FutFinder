import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, X } from 'lucide-react-native';

import { paleta as C, radios as R, fuentes as F } from '../theme/colors';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToNotifications } from '../services/notifications';
import { navigateToNotification } from '../utils/notificationTargets';
import { getMatchById } from '../services/matches';
import { getClubById } from '../services/clubs';
import { ICON, TAG, FALLBACK_TAG } from './notifications/NotificationCard';
import {
  empujarToast, quitarToast, suscribirseAToasts, DURACION_TOAST_MS,
} from '../utils/notificationToasts';
import { navigationRef } from '../navigation/AppNavigator';

/**
 * El popup que se abre arriba cuando llega un aviso nuevo mientras la app
 * está abierta, con acceso directo a lo que avisa — para eso está: en la
 * bandeja de Avisos hay que salir de donde estás para enterarte, y acá no.
 *
 * NO SE MUESTRA SI YA ESTÁS EN "Avisos": la fila nueva ya aparece sola ahí
 * por el mismo canal Realtime (ver NotificationsScreen), así que el popup
 * encima sería el mismo aviso dos veces.
 *
 * SOLO POR INSERT, NO POR UPDATE: una fila que se actualiza (p.ej. el
 * recuento de un `message_new` agrupado subiendo de 2 a 3) no es un aviso
 * nuevo — ver el comentario de `_eventType` en `services/notifications.js`.
 *
 * Reutiliza el ícono y el color por tipo de NotificationCard (misma fuente
 * de verdad que la bandeja) y el mismo `navigateToNotification` que ya usan
 * App.js (tap sobre un push) y NotificationsScreen (tap sobre la tarjeta),
 * así que un tipo nuevo o un destino corregido no se mantiene en tres partes.
 */
export default function NotificationToastHost() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    if (!user?.id) return undefined;
    return subscribeToNotifications(user.id, (notif) => {
      if (notif._eventType !== 'INSERT') return;
      if (navigationRef.getCurrentRoute?.()?.name === 'Notifications') return;
      empujarToast(notif);
    });
  }, [user?.id]);

  useEffect(() => suscribirseAToasts(setToasts), []);

  useEffect(() => {
    if (toasts.length === 0) return undefined;
    const relojes = toasts.map((n) => setTimeout(() => quitarToast(n.id), DURACION_TOAST_MS));
    return () => relojes.forEach(clearTimeout);
  }, [toasts]);

  if (toasts.length === 0) return null;

  const abrir = async (n) => {
    quitarToast(n.id);
    const root = navigationRef;
    await navigateToNotification(n, {
      navigate: (screen, params) => root.navigate(screen, params),
      onMissing: () => {},
      onUnresolved: () => {},
      getMatchById,
      getClubById,
    });
  };

  return (
    <View style={[styles.capa, { top: insets.top + 8 }]} pointerEvents="box-none">
      {toasts.map((n) => {
        const Icon = ICON[n.type] || Bell;
        const tag = TAG[n.type] || FALLBACK_TAG;
        return (
          <Pressable
            key={n.id}
            onPress={() => abrir(n)}
            accessibilityRole="button"
            accessibilityLabel={`${n.title}${n.body ? `. ${n.body}` : ''}. Toca para verlo`}
            style={({ pressed }) => [styles.toast, { borderColor: tag.border }, pressed && { opacity: 0.85 }]}
          >
            <View style={[styles.iconWrap, { backgroundColor: tag.bg, borderColor: tag.border }]}>
              <Icon color={tag.color} size={18} strokeWidth={1.9} />
            </View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={styles.titulo}>{n.title}</Text>
              {n.body ? <Text numberOfLines={2} style={styles.mensaje}>{n.body}</Text> : null}
            </View>
            <Pressable
              onPress={() => quitarToast(n.id)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Cerrar este aviso"
              style={styles.cerrar}
            >
              <X color={C.textMuted} size={14} strokeWidth={2.2} />
            </Pressable>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  capa: {
    position: 'absolute',
    left: 12,
    right: 12,
    gap: 8,
    zIndex: 9999,
    alignItems: 'center',
  },
  toast: {
    width: '100%',
    maxWidth: 420,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: R.cardSm,
    backgroundColor: C.surface,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  iconWrap: {
    height: 34,
    width: 34,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titulo: { fontSize: 14, fontFamily: F.extraBold, letterSpacing: -0.2, color: C.tinta },
  mensaje: { color: C.textDim, fontSize: 12.5, lineHeight: 17.5, marginTop: 3 },
  cerrar: {
    height: 24,
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
