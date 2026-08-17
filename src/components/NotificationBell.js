import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Bell } from 'lucide-react-native';

import { reservas as C, reservasRadius as R, reservasSizes as S } from '../theme/colors';
import useUnreadNotifications from '../utils/useUnreadNotifications';

/**
 * Campana de avisos global — decisión del handoff de Reservas: sale de la
 * barra inferior (donde vivía como tab) y pasa arriba a la derecha en el
 * header de cada pestaña, con el mismo aspecto en toda la app (no se
 * adapta a la paleta de cada rediseño — por eso usa los tokens fijos de
 * `reservas`, la fuente de este cambio, y no los de la pantalla que la
 * aloja).
 */
export default function NotificationBell({ style }) {
  const navigation = useNavigation();
  const unread = useUnreadNotifications();

  return (
    <Pressable
      onPress={() => navigation.navigate('Notifications')}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `Avisos, ${unread} sin leer` : 'Avisos'}
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.75 }, style]}
    >
      <Bell color={C.textPrimary} size={19} strokeWidth={1.8} />
      {unread > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 9 ? '9+' : String(unread)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: S.iconBtn,
    height: S.iconBtn,
    borderRadius: R.iconBtn,
    backgroundColor: 'rgba(25,29,26,0.8)',
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    paddingHorizontal: 3,
    backgroundColor: C.red,
    borderWidth: 2,
    borderColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: C.textOnRed,
  },
});
