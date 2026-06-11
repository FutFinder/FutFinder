import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Lock, Crown } from 'lucide-react-native';
import { colors, radius } from '../theme/colors';

// Dorado premium — único acento fuera de la paleta verde, reservado
// exclusivamente para distinguir features de pago.
const GOLD = '#D4A437';
const GOLD_SOFT = 'rgba(212, 164, 55, 0.12)';

/**
 * Indicador visual de función Premium.
 *
 * Variants:
 *  - 'badge'  → chip "PREMIUM" con corona (para títulos/headers)
 *  - 'locked' → candado + "Premium" (para features bloqueadas en plan Estándar)
 */
export default function PremiumBadge({ variant = 'badge', style }) {
  if (variant === 'locked') {
    return (
      <View style={[styles.box, style]}>
        <Lock color={GOLD} size={12} strokeWidth={2.4} />
        <Text style={styles.text}>Premium</Text>
      </View>
    );
  }
  return (
    <View style={[styles.box, style]}>
      <Crown color={GOLD} size={12} strokeWidth={2.4} />
      <Text style={styles.text}>PREMIUM</Text>
    </View>
  );
}

export const premiumGold = GOLD;

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  text: {
    color: GOLD,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
});
