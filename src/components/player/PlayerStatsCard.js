import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import {
  reservas as C,
  reservasRadius as R,
  reservasSizes as S,
  reservasFonts as F,
  alfa,
} from '../../theme/colors';

/**
 * "Rendimiento": jugados · inscritos · MVPs + tasa de asistencia.
 *
 * Los tres contadores son ceros REALES (los datos existen y valen 0), así que
 * se muestran como 0 y no como N.A. — pero atenuados cuando todo está en cero,
 * para que un perfil nuevo no parezca tener actividad.
 *
 * La tasa de asistencia sí puede ser incalculable: `attendance.pct === null`
 * significa que no hay partidos cerrados y se muestra "N.A." con la barra
 * vacía, nunca un 100 % que el jugador no se ha ganado.
 *
 * @param {object} stats      { partidos_jugados, inscritos, mvps }
 * @param {object} attendance { value, pct, hint } de attendanceDisplay()
 */
export default function PlayerStatsCard({ stats, attendance }) {
  const jugados = stats?.partidos_jugados ?? 0;
  const inscritos = stats?.inscritos ?? 0;
  const mvps = stats?.mvps ?? 0;
  const sinActividad = jugados === 0 && inscritos === 0 && mvps === 0;

  return (
    <View style={styles.card}>
      <View style={styles.grid}>
        <Cell value={jugados} label="JUGADOS" highlight={jugados > 0} dim={sinActividad} />
        <Cell value={inscritos} label="INSCRITOS" dim={sinActividad} />
        <Cell value={mvps} label="MVPs" dim={sinActividad} />
      </View>

      <View style={styles.attRow}>
        <Text style={styles.attLabel}>Tasa de asistencia</Text>
        <Text
          style={[styles.attValue, attendance.pct === null && styles.attValueEmpty]}
          accessibilityLabel={
            attendance.pct === null
              ? 'Tasa de asistencia no disponible'
              : `Tasa de asistencia ${attendance.pct} por ciento`
          }
        >
          {attendance.value}
        </Text>
      </View>

      <View style={styles.track}>
        {attendance.pct !== null && (
          <View style={[styles.fill, { width: `${attendance.pct}%` }]} />
        )}
      </View>

      <Text style={styles.attHint}>{attendance.hint}</Text>
    </View>
  );
}

function Cell({ value, label, highlight, dim }) {
  return (
    <View style={[styles.cell, highlight && styles.cellHighlight]}>
      <Text
        style={[
          styles.cellValue,
          highlight && styles.cellValueHighlight,
          dim && styles.cellValueDim,
        ]}
      >
        {value}
      </Text>
      <Text
        style={[
          styles.cellLabel,
          highlight && styles.cellLabelHighlight,
          dim && styles.cellLabelDim,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: S.screenPadding,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.borderSoft,
    borderRadius: R.cardSm,
    padding: 12,
  },
  grid: { flexDirection: 'row', gap: 6 },
  cell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.borderSoft,
    backgroundColor: alfa(C.tinta, 0.05),
  },
  cellHighlight: {
    backgroundColor: alfa(C.green, 0.11),
    borderColor: alfa(C.green, 0.24),
  },
  cellValue: {
    color: C.textPrimary,
    fontSize: 19,
    fontFamily: F.extraBold,
    lineHeight: 22,
  },
  cellValueHighlight: { color: C.green },
  cellValueDim: { color: C.textFaint },
  cellLabel: {
    color: C.textMuted,
    fontSize: 10,
    fontFamily: F.bold,
    letterSpacing: 0.7,
    marginTop: 4,
  },
  cellLabelHighlight: { color: alfa(C.green, 0.75) },
  cellLabelDim: { color: C.textGhost },

  attRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  attLabel: { color: C.textSoft, fontSize: 13, fontFamily: F.semiBold },
  attValue: { color: C.green, fontSize: 15, fontFamily: F.extraBold },
  attValueEmpty: { color: C.textSecondary },
  track: {
    height: 8,
    borderRadius: 5,
    backgroundColor: alfa(C.tinta, 0.07),
    marginTop: 8,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 5, backgroundColor: C.green },
  attHint: { color: C.textMuted, fontSize: 11.5, marginTop: 7 },
});
