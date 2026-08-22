import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { dsColors, dsSizes } from '../../theme/colors';
import { temaClub } from '../../theme/clubThemes';

/**
 * Cabecera de sección: título a la izquierda y enlace de acción a la derecha
 * ("Ver todos" / "Ver todo" / "Ver todas").
 * La acción solo se renderiza si llega `actionLabel` y `onAction`.
 *
 * El enlace toma el color del club (`tema`) porque es un acento de su
 * pantalla; sin tema queda el verde de la app, que es lo que corresponde en
 * el perfil de jugador y en las pantallas que no son de un club.
 */
export default function SectionHeader({ title, actionLabel, onAction, style, tema = temaClub() }) {
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
          <Text style={[styles.actionText, { color: tema.main }]}>{actionLabel}</Text>
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
    paddingHorizontal: dsSizes.gutter,
    paddingTop: 26,
    paddingBottom: 10,
  },
  title: {
    color: dsColors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  action: { paddingVertical: 6, paddingLeft: 10 },
  actionText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
