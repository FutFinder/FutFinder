import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { dsColors, dsRadius, dsSizes } from '../../theme/colors';
import { temaClub } from '../../theme/clubThemes';

/**
 * Estado vacío de una sección (sin rivales, sin partidos).
 * Icono en recuadro, título, subtítulo y acción opcional.
 *
 * El botón es un botón secundario atado al club, así que toma su color.
 */
export default function EmptyStateCard({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
  variant = 'ghost', // 'ghost' (borde de color) | 'solid' (color relleno)
  tema = temaClub(),
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
            solid
              ? { backgroundColor: tema.main }
              : { borderWidth: 1, borderColor: tema.border, backgroundColor: tema.soft },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Text
            style={[
              solid ? styles.btnSolidText : styles.btnGhostText,
              { color: solid ? tema.ink : tema.main },
            ]}
          >
            {actionLabel}
          </Text>
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
  btnGhostText: { fontSize: 12.5, fontWeight: '700' },
  btnSolidText: { fontSize: 12.5, fontWeight: '800' },
});
