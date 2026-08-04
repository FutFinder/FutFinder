import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { dsColors, dsRadius, dsSizes } from '../../theme/colors';

/**
 * Fila de acción del perfil: icono en recuadro, etiqueta y chevron.
 * Se usa para "Editar mi perfil" y equivalentes.
 *
 * @param {'default'|'danger'} tone
 */
export default function ProfileActionRow({
  icon,
  label,
  onPress,
  tone = 'default',
  accessibilityLabel,
  style,
}) {
  const danger = tone === 'danger';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      style={({ pressed }) => [
        styles.row,
        danger && styles.rowDanger,
        pressed && (danger ? styles.pressedDanger : styles.pressed),
        style,
      ]}
    >
      <View style={[styles.icon, danger && styles.iconDanger]}>{icon}</View>
      <Text style={[styles.label, danger && styles.labelDanger]}>{label}</Text>
      <ChevronRight
        color={danger ? 'rgba(232, 115, 123, 0.55)' : 'rgba(255, 255, 255, 0.35)'}
        size={16}
        strokeWidth={2.2}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    marginHorizontal: dsSizes.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: dsColors.surface,
    borderWidth: 1,
    borderColor: dsColors.borderSoft,
    borderRadius: dsRadius.lg,
    padding: 13,
  },
  rowDanger: {
    backgroundColor: 'rgba(232, 115, 123, 0.07)',
    borderColor: 'rgba(232, 115, 123, 0.35)',
  },
  pressed: { backgroundColor: dsColors.surfaceHover },
  pressedDanger: { backgroundColor: 'rgba(232, 115, 123, 0.14)' },
  icon: {
    width: 36,
    height: 36,
    borderRadius: dsRadius.sm,
    backgroundColor: 'rgba(90, 224, 106, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDanger: { backgroundColor: 'rgba(232, 115, 123, 0.14)' },
  label: { flex: 1, color: dsColors.textPrimary, fontSize: 14, fontWeight: '700' },
  labelDanger: { color: dsColors.loss },
});
