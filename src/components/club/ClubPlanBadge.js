import React from 'react';
import { Text, Pressable, StyleSheet } from 'react-native';
import { Crown } from 'lucide-react-native';

import {
  reservas as C,
  reservasRadius as R,
  reservasSizes as S,
  reservasFonts as F,
} from '../../theme/colors';

/**
 * Insignia del plan del club en la barra superior: corona + GRATIS/PREMIUM.
 * Es pulsable y lleva a la pantalla de planes.
 */
export default function ClubPlanBadge({ esPremium, onPress }) {
  const label = esPremium ? 'PREMIUM' : 'GRATIS';
  const tint = esPremium ? C.gold : C.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={
        esPremium ? 'Plan Premium del club. Ver planes' : 'Plan gratuito del club. Ver planes'
      }
      style={({ pressed }) => [
        styles.chip,
        esPremium && styles.chipPremium,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Crown color={tint} size={15} strokeWidth={2} />
      <Text style={[styles.label, { color: esPremium ? C.gold : C.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: S.iconBtn,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.chip,
  },
  chipPremium: {
    borderColor: 'rgba(240, 200, 90, 0.35)',
    backgroundColor: C.goldSoft,
  },
  label: {
    fontSize: 11.5,
    fontFamily: F.extraBold,
    letterSpacing: 0.4,
  },
});
