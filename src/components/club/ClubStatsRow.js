import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Star } from 'lucide-react-native';

import {
  paleta as C,
  radios as R,
  fuentes as F,
  alfa,
} from '../../theme/colors';

/**
 * Fila de 4 estadísticas del club: victorias, empates, derrotas y valoración.
 *
 * Colores según la referencia: victoria en verde, empate en blanco,
 * derrota en coral, valoración en blanco.
 *
 * LOS RÓTULOS SE ESCRIBEN. Eran «V», «E», «D» y «RATING»: tres abreviaturas y
 * una palabra en inglés que quien recién llega tiene que interpretar.
 *
 * El rating llega ya formateado ('4,6' o el centinela 'N.A.', ver
 * clubMeta.ratingLabel). Cuando no hay valoraciones se dice así, en español,
 * con la estrella apagada — nunca un 0,0 falso.
 */
export default function ClubStatsRow({ record, ratingLabel }) {
  const sinRating = !ratingLabel || ratingLabel === 'N.A.';

  return (
    <View style={styles.grid}>
      <Cell
        value={record.v}
        label="VICTORIAS"
        valueColor={C.win}
        labelColor={alfa(C.green, 0.75)}
        cellStyle={styles.cellWin}
      />
      <Cell value={record.e} label="EMPATES" />
      <Cell
        value={record.d}
        label="DERROTAS"
        valueColor={C.loss}
        labelColor={alfa(C.red, 0.7)}
        cellStyle={styles.cellLoss}
      />
      <View
        style={styles.cell}
        accessibilityLabel={
          sinRating ? 'Todavía sin valoraciones' : `Valoración ${ratingLabel} de 5`
        }
      >
        <View style={styles.ratingRow}>
          {sinRating && <Star color={C.textMuted} size={13} strokeWidth={2.2} />}
          <Text style={[styles.value, sinRating && styles.valueVacio]} numberOfLines={1}>
            {sinRating ? 'Sin valorar' : ratingLabel}
          </Text>
        </View>
        <Text style={styles.label}>VALORACIÓN</Text>
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
    backgroundColor: alfa(C.tinta, 0.05),
  },
  cellWin: {
    backgroundColor: alfa(C.green, 0.11),
    borderColor: alfa(C.green, 0.24),
  },
  cellLoss: {
    backgroundColor: alfa(C.red, 0.10),
    borderColor: alfa(C.red, 0.24),
  },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  value: {
    color: C.textPrimary,
    fontSize: 19,
    fontFamily: F.extraBold,
    lineHeight: 22,
  },
  valueVacio: { fontSize: 12, lineHeight: 16, color: C.textMuted },
  label: {
    color: C.textMuted,
    // Con los rótulos escritos enteros («VICTORIAS», «VALORACIÓN») el
    // espaciado de 1 punto ya no cabe en una casilla de cuatro.
    fontSize: 9,
    fontFamily: F.bold,
    letterSpacing: 0.2,
    marginTop: 4,
    textAlign: 'center',
  },
});
