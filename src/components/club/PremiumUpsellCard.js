import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Crown, ChevronRight } from 'lucide-react-native';

import { clubColors, clubRadius, clubSizes } from '../../theme/colors';

/**
 * Tarjeta de promoción de Premium: corona dorada, título, texto secundario
 * y chevron. Solo se renderiza desde la pantalla cuando el club NO es Premium.
 */
export default function PremiumUpsellCard({
  title = 'Desbloquea Premium',
  subtitle = 'Desafíos ilimitados y estadísticas avanzadas',
  onPress,
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.icon}>
        <Crown color={clubColors.gold} size={18} strokeWidth={2} />
      </View>
      <View style={styles.texts}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <ChevronRight color={clubColors.textMuted} size={16} strokeWidth={2.2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginHorizontal: clubSizes.gutter,
    marginTop: 22,
    backgroundColor: clubColors.surface,
    borderRadius: clubRadius.lg,
    borderWidth: 1,
    borderColor: clubColors.border,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  pressed: { backgroundColor: clubColors.surfaceHover },
  icon: {
    width: 36,
    height: 36,
    borderRadius: clubRadius.sm,
    backgroundColor: clubColors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: { flex: 1, minWidth: 0 },
  title: {
    color: clubColors.textPrimary,
    fontSize: 13.5,
    fontWeight: '700',
  },
  subtitle: {
    color: clubColors.textSecondary,
    fontSize: 11.5,
    marginTop: 2,
  },
});
