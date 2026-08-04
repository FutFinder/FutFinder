import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { dsColors, dsRadius, dsSizes } from '../../theme/colors';

/**
 * Estado vacío de una sección (sin rivales, sin partidos).
 * Icono en recuadro, título, subtítulo y acción opcional.
 */
export default function EmptyStateCard({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
  variant = 'ghost', // 'ghost' (borde verde) | 'solid' (verde relleno)
}) {
  const solid = variant === 'solid';

  return (
    <View style={styles.card}>
      <View style={styles.icon}>{icon}</View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          // Botón de 38 px + hitSlop = mínimo táctil de 44.
          hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [
            styles.btn,
            solid ? styles.btnSolid : styles.btnGhost,
            pressed && { opacity: 0.8 },
          ]}
        >
          <Text style={solid ? styles.btnSolidText : styles.btnGhostText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: dsSizes.gutter,
    backgroundColor: dsColors.surface,
    borderRadius: dsRadius.lg,
    borderWidth: 1,
    borderColor: dsColors.borderSoft,
    padding: 16,
    alignItems: 'center',
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: dsRadius.sm,
    backgroundColor: dsColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 9,
  },
  title: {
    color: dsColors.textPrimary,
    fontSize: 13.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: dsColors.textSecondary,
    fontSize: 11.5,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 4,
  },
  btn: {
    height: 38,
    minWidth: 140,
    paddingHorizontal: 16,
    marginTop: 11,
    borderRadius: dsRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: {
    borderWidth: 1,
    borderColor: dsColors.greenBorder,
    backgroundColor: dsColors.greenSoft,
  },
  btnGhostText: { color: dsColors.green, fontSize: 12.5, fontWeight: '700' },
  btnSolid: { backgroundColor: dsColors.green },
  btnSolidText: { color: dsColors.greenInk, fontSize: 12.5, fontWeight: '800' },
});
