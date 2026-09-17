import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import {
  reservas as C,
  reservasRadius as R,
  reservasFonts as F,
  alfa,
} from '../../theme/colors';

/** Paleta por tono de estado, tal como la define el diseño. */
const TONOS = {
  green: { color: C.green, chipBg: alfa(C.green, 0.14) },
  yellow: { color: C.draw, chipBg: 'rgba(224, 194, 90, 0.14)' },
  coral: { color: C.loss, chipBg: alfa(C.red, 0.14) },
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
    backgroundColor: C.surface,
    borderRadius: R.row,
    borderWidth: 1,
    borderColor: C.borderSoft,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  pressed: { backgroundColor: C.surfaceHover },
  bar: { width: 4, height: 40, borderRadius: 3 },
  center: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: {
    color: C.textPrimary,
    fontSize: 13.5,
    fontFamily: F.bold,
    flexShrink: 1,
  },
  mvp: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: 'rgba(240, 200, 90, 0.14)',
  },
  mvpText: {
    color: C.gold,
    fontSize: 9.5,
    fontFamily: F.extraBold,
    letterSpacing: 0.5,
  },
  meta: { color: C.textMuted, fontSize: 11.5, marginTop: 3 },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: R.chip,
  },
  chipText: { fontSize: 10.5, fontFamily: F.bold },
});
