import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Star } from 'lucide-react-native';

import {
  paleta as C,
  radios as R,
  medidas as S,
  fuentes as F,
  alfa,
} from '../../theme/colors';
import { useTrueScoreAjustes } from '../../services/trueScore';
import { nivelTrueScore } from '../../utils/trueScore';

// Color del nivel de TrueScore, desde la única paleta.
const TONO_NIVEL = { verde: C.green, amarillo: C.amber, rojo: C.red };

/**
 * "Reputación": valoración media con estrellas + Trust Score.
 *
 * Sin evaluaciones → "N.A.", cinco estrellas VACÍAS (nunca cinco llenas, que
 * se leerían como una valoración perfecta) y "Sin evaluaciones todavía".
 *
 * Sin partidos confirmados → Trust Score "N.A." con la barra vacía: el 100 de
 * la BD es un valor por defecto, no una reputación ganada.
 *
 * @param {object} rating { value, hasRatings, count, filled } de ratingDisplay()
 * @param {object} trust  { value, pct, hint } de trustDisplay()
 */
export default function ReputationCard({ rating, trust }) {
  // Con TrueScore el número se pinta con el color de su nivel (spec §1.4).
  const ajustes = useTrueScoreAjustes();
  const nivel =
    ajustes.fase1 && trust.pct !== null ? nivelTrueScore(trust.value, ajustes.niveles) : null;
  const tono = nivel ? TONO_NIVEL[nivel.color] || C.green : C.green;
  const nombre = ajustes.fase1 ? 'TrueScore' : 'Trust Score';
  return (
    <View style={styles.card}>
      <View style={styles.left}>
        <Text
          style={[styles.score, !rating.hasRatings && styles.dim]}
          accessibilityLabel={
            rating.hasRatings
              ? `Valoración ${rating.value} de 5`
              : 'Valoración no disponible'
          }
        >
          {rating.value}
        </Text>
        <View style={styles.stars}>
          {[1, 2, 3, 4, 5].map((i) => {
            const llena = rating.hasRatings && i <= rating.filled;
            return (
              <Star
                key={i}
                size={13}
                strokeWidth={1.8}
                color={
                  rating.hasRatings
                    ? llena
                      ? C.gold
                      : 'rgba(240, 200, 90, 0.28)'
                    : alfa(C.tinta, 0.22)
                }
                fill={llena ? C.gold : 'none'}
              />
            );
          })}
        </View>
        <Text style={styles.leftHint} numberOfLines={1}>
          {rating.hasRatings
            ? `${rating.count} ${rating.count === 1 ? 'evaluación' : 'evaluaciones'}`
            : 'Sin evaluaciones todavía'}
        </Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.right}>
        <Text style={styles.trustLabel}>{nombre}</Text>
        <View style={styles.trustRow}>
          <Text
            style={[styles.trustValue, { color: tono }, trust.pct === null && styles.dim]}
            accessibilityLabel={
              trust.pct === null
                ? `${nombre} no disponible`
                : `${nombre} ${trust.value} de 100${nivel ? `, ${nivel.nombre}` : ''}`
            }
          >
            {trust.value}
          </Text>
          {trust.pct !== null && <Text style={styles.trustMax}>/ 100</Text>}
        </View>
        <View style={styles.track}>
          {trust.pct !== null && (
            <View style={[styles.fill, { width: `${trust.pct}%`, backgroundColor: tono }]} />
          )}
        </View>
        <Text style={styles.rightHint}>{nivel ? nivel.nombre : trust.hint}</Text>
      </View>
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
    padding: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  left: { minWidth: 0 },
  score: {
    color: C.textPrimary,
    fontSize: 28,
    fontFamily: F.extraBold,
    lineHeight: 30,
    letterSpacing: -0.8,
  },
  dim: { color: C.textFaint },
  stars: { flexDirection: 'row', gap: 2, marginTop: 6 },
  leftHint: { color: C.textMuted, fontSize: 11.5, marginTop: 6 },

  divider: { width: 1, alignSelf: 'stretch', backgroundColor: C.borderSoft },

  right: { flex: 1, minWidth: 0 },
  trustLabel: {
    color: C.textMuted,
    fontSize: 9.5,
    fontFamily: F.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  trustRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 },
  trustValue: {
    color: C.green,
    fontSize: 24,
    fontFamily: F.extraBold,
    lineHeight: 26,
  },
  trustMax: { color: C.textMuted, fontSize: 12 },
  track: {
    height: 6,
    borderRadius: 4,
    backgroundColor: alfa(C.tinta, 0.07),
    marginTop: 8,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 4, backgroundColor: C.green },
  rightHint: { color: C.textMuted, fontSize: 11, marginTop: 6 },
});
