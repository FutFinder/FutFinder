import React from 'react';
import { Text, Pressable, StyleSheet } from 'react-native';
import { Crown } from 'lucide-react-native';

import { clubColors, clubRadius, clubSizes } from '../../theme/colors';

/**
 * Insignia del plan del club en la barra superior: corona + GRATIS/PREMIUM.
 * Es pulsable y lleva a la pantalla de planes.
 */
export default function ClubPlanBadge({ esPremium, onPress }) {
  const label = esPremium ? 'PREMIUM' : 'GRATIS';
  const tint = esPremium ? clubColors.gold : clubColors.textSecondary;

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
      <Text style={[styles.label, { color: esPremium ? clubColors.gold : clubColors.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: clubSizes.iconBtn,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    borderRadius: clubRadius.md,
    borderWidth: 1,
    borderColor: clubColors.border,
    backgroundColor: clubColors.chip,
  },
  chipPremium: {
    borderColor: 'rgba(240, 200, 90, 0.35)',
    backgroundColor: clubColors.goldSoft,
  },
  label: {
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
});
