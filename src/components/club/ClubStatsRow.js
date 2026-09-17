import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Star } from 'lucide-react-native';

import {
  reservas as C,
  reservasRadius as R,
  reservasFonts as F,
} from '../../theme/colors';

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
        valueColor={C.win}
        labelColor="rgba(85,223,105, 0.75)"
        cellStyle={styles.cellWin}
      />
      <Cell value={record.e} label="E" />
      <Cell
        value={record.d}
        label="D"
        valueColor={C.loss}
        labelColor="rgba(237,107,118, 0.7)"
        cellStyle={styles.cellLoss}
      />
      <View
        style={styles.cell}
        accessibilityLabel={
          sinRating ? 'Valoración no disponible' : `Valoración ${ratingLabel} de 5`
        }
      >
        <View style={styles.ratingRow}>
          {sinRating && <Star color={C.textMuted} size={13} strokeWidth={2.2} />}
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
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.borderSoft,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  cellWin: {
    backgroundColor: 'rgba(85,223,105, 0.11)',
    borderColor: 'rgba(85,223,105, 0.24)',
  },
  cellLoss: {
    backgroundColor: 'rgba(237,107,118, 0.10)',
    borderColor: 'rgba(237,107,118, 0.24)',
  },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  value: {
    color: C.textPrimary,
    fontSize: 19,
    fontFamily: F.extraBold,
    lineHeight: 22,
  },
  label: {
    color: C.textMuted,
    fontSize: 10,
    fontFamily: F.bold,
    letterSpacing: 1,
    marginTop: 4,
  },
});
