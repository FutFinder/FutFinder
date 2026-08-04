import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Star } from 'lucide-react-native';

import { clubColors, clubRadius } from '../../theme/colors';

/**
 * Fila de 4 estadísticas del club: V · E · D · RATING.
 *
 * Colores según la referencia: victoria en verde, empate en blanco,
 * derrota en coral, rating en blanco.
 *
 * El rating llega ya formateado ('4,6' o 'N.A.', ver clubMeta.ratingLabel).
 * Cuando es 'N.A.' se muestra una estrella junto al texto, para que se lea
 * como "sin valoración todavía" en vez de un 0.0 falso.
 */
export default function ClubStatsRow({ record, ratingLabel }) {
  const sinRating = ratingLabel === 'N.A.';

  return (
    <View style={styles.grid}>
      <Cell
        value={record.v}
        label="V"
        valueColor={clubColors.win}
        labelColor="rgba(90, 224, 106, 0.75)"
        cellStyle={styles.cellWin}
      />
      <Cell value={record.e} label="E" />
      <Cell
        value={record.d}
        label="D"
        valueColor={clubColors.loss}
        labelColor="rgba(232, 115, 123, 0.7)"
        cellStyle={styles.cellLoss}
      />
      <View
        style={styles.cell}
        accessibilityLabel={
          sinRating ? 'Valoración no disponible' : `Valoración ${ratingLabel} de 5`
        }
      >
        <View style={styles.ratingRow}>
          {sinRating && <Star color={clubColors.textMuted} size={13} strokeWidth={2.2} />}
          <Text style={styles.value}>{ratingLabel}</Text>
        </View>
        <Text style={styles.label}>RATING</Text>
      </View>
    </View>
  );
}

function Cell({ value, label, valueColor, labelColor, cellStyle }) {
  return (
    <View style={[styles.cell, cellStyle]}>
      <Text style={[styles.value, valueColor && { color: valueColor }]}>{value}</Text>
      <Text style={[styles.label, labelColor && { color: labelColor }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: 6, marginTop: 14 },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderRadius: clubRadius.md,
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  cellWin: {
    backgroundColor: 'rgba(90, 224, 106, 0.11)',
    borderColor: 'rgba(90, 224, 106, 0.24)',
  },
  cellLoss: {
    backgroundColor: 'rgba(232, 115, 123, 0.10)',
    borderColor: 'rgba(232, 115, 123, 0.24)',
  },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  value: {
    color: clubColors.textPrimary,
    fontSize: 19,
    fontWeight: '800',
    lineHeight: 22,
  },
  label: {
    color: clubColors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 4,
  },
});
