import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { UserPlus } from 'lucide-react-native';

import {
  paleta as C,
  radios as R,
  medidas as S,
  fuentes as F,
} from '../../theme/colors';
import BrandMark from '../BrandMark';
import NotificationBell from '../NotificationBell';
import ClubHeaderButton from '../club/ClubHeaderButton';

/**
 * Cabecera de la bandeja: marca, bell de avisos, acceso a «Amigos y
 * solicitudes» con el contador de solicitudes recibidas, y el título
 * grande.
 *
 * El botón de amigos mide 38 px pero lleva `hitSlop` para llegar a los
 * 44 px táctiles que exige el diseño.
 */
export default function ChatInboxHeader({ pendingRequests = 0, onPressFriends }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <BrandMark />

        <View style={styles.rightGroup}>
          <ClubHeaderButton />
          <NotificationBell />

          <Pressable
            onPress={onPressFriends}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={
              pendingRequests > 0
                ? `Amigos y solicitudes, ${pendingRequests} pendientes`
                : 'Amigos y solicitudes'
            }
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
          >
            <UserPlus color={C.textStrong} size={18} strokeWidth={1.8} />
            {pendingRequests > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {pendingRequests > 9 ? '9+' : pendingRequests}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

      <Text style={styles.title} accessibilityRole="header">
        Chats y amigos
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: S.screenPadding + 4, paddingTop: 4, paddingBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rightGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: R.chip,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.bg,
  },
  badgeText: {
    color: C.greenInk,
    fontSize: 9.5,
    fontFamily: F.extraBold,
    includeFontPadding: false,
  },

  title: {
    marginTop: 12,
    color: C.textPrimary,
    fontSize: 27,
    fontFamily: F.extraBold,
    letterSpacing: -0.7,
  },
});
