import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MapPin, UserPlus } from 'lucide-react-native';

import { chatColors, dsRadius, dsSizes } from '../../theme/colors';

/**
 * Cabecera de la bandeja: marca, acceso a «Amigos y solicitudes» con el
 * contador de solicitudes recibidas, y el título grande.
 *
 * El botón mide 38 px pero lleva `hitSlop` para llegar a los 44 px táctiles
 * que exige el diseño.
 */
export default function ChatInboxHeader({ pendingRequests = 0, onPressFriends }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.brand}>
          <MapPin color={chatColors.green} size={18} strokeWidth={2} />
          <Text style={styles.brandText}>
            fut<Text style={styles.brandAccent}>finder</Text>
          </Text>
        </View>

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
          <UserPlus color="rgba(255,255,255,0.8)" size={18} strokeWidth={1.8} />
          {pendingRequests > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {pendingRequests > 9 ? '9+' : pendingRequests}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      <Text style={styles.title} accessibilityRole="header">
        Chats y amigos
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: dsSizes.gutter + 4, paddingTop: 4, paddingBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brandText: {
    color: chatColors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  brandAccent: { color: chatColors.green },

  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: dsRadius.sm,
    backgroundColor: chatColors.surface,
    borderWidth: 1,
    borderColor: chatColors.borderSoft,
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
    backgroundColor: chatColors.green,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: chatColors.background,
  },
  badgeText: {
    color: chatColors.inkOnGreen,
    fontSize: 9.5,
    fontWeight: '800',
    includeFontPadding: false,
  },

  title: {
    marginTop: 12,
    color: chatColors.textPrimary,
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: -0.7,
  },
});
