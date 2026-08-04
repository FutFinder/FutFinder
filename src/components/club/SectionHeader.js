import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { clubColors, clubSizes } from '../../theme/colors';

/**
 * Cabecera de sección: título a la izquierda y acción verde a la derecha
 * ("Ver todos" / "Ver todo" / "Ver todas").
 * La acción solo se renderiza si llega `actionLabel` y `onAction`.
 */
export default function SectionHeader({ title, actionLabel, onAction, style }) {
  return (
    <View style={[styles.row, style]}>
      <Text style={styles.title}>{title}</Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel} de ${title}`}
          style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: clubSizes.gutter,
    paddingTop: 26,
    paddingBottom: 10,
  },
  title: {
    color: clubColors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  action: { paddingVertical: 6, paddingLeft: 10 },
  actionText: {
    color: clubColors.green,
    fontSize: 13,
    fontWeight: '700',
  },
});
