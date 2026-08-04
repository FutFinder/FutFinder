import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { dsColors, dsRadius } from '../../theme/colors';

/** Paleta por tono de estado, tal como la define el diseño. */
const TONOS = {
  green: { color: dsColors.green, chipBg: 'rgba(90, 224, 106, 0.14)' },
  yellow: { color: dsColors.draw, chipBg: 'rgba(224, 194, 90, 0.14)' },
  coral: { color: dsColors.loss, chipBg: 'rgba(232, 115, 123, 0.14)' },
  muted: { color: 'rgba(255, 255, 255, 0.45)', chipBg: 'rgba(255, 255, 255, 0.07)' },
};

/**
 * Una participación del historial: barra de color, título (+ MVP), fecha ·
 * cancha, chip de estado y chevron.
 *
 * El chip lleva el texto del estado además del color, para no depender solo
 * del color como indicador.
 *
 * @param {object} estado { label, tone } de participacionEstado()
 */
export default function ParticipationCard({ titulo, meta, estado, esMvp, onPress }) {
  const tono = TONOS[estado.tone] || TONOS.muted;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${titulo}. ${meta}. ${estado.label}${esMvp ? '. MVP del partido' : ''}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={[styles.bar, { backgroundColor: tono.color }]} />

      <View style={styles.center}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {titulo}
          </Text>
          {esMvp && (
            <View style={styles.mvp}>
              <Text style={styles.mvpText}>MVP</Text>
            </View>
          )}
        </View>
        {meta ? (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>

      <View style={[styles.chip, { backgroundColor: tono.chipBg }]}>
        <Text style={[styles.chipText, { color: tono.color }]}>{estado.label}</Text>
      </View>

      <ChevronRight color="rgba(255, 255, 255, 0.35)" size={16} strokeWidth={2.2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: dsColors.surface,
    borderRadius: dsRadius.lg,
    borderWidth: 1,
    borderColor: dsColors.borderSoft,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  pressed: { backgroundColor: dsColors.surfaceHover },
  bar: { width: 4, height: 40, borderRadius: 3 },
  center: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: {
    color: dsColors.textPrimary,
    fontSize: 13.5,
    fontWeight: '700',
    flexShrink: 1,
  },
  mvp: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: 'rgba(240, 200, 90, 0.14)',
  },
  mvpText: {
    color: dsColors.gold,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  meta: { color: dsColors.textMuted, fontSize: 11.5, marginTop: 3 },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: dsRadius.chip,
  },
  chipText: { fontSize: 10.5, fontWeight: '700' },
});
