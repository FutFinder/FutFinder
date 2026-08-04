import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Star } from 'lucide-react-native';

import { dsColors, dsRadius, dsSizes } from '../../theme/colors';

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
                      ? dsColors.gold
                      : 'rgba(240, 200, 90, 0.28)'
                    : 'rgba(255, 255, 255, 0.22)'
                }
                fill={llena ? dsColors.gold : 'none'}
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
        <Text style={styles.trustLabel}>Trust Score</Text>
        <View style={styles.trustRow}>
          <Text
            style={[styles.trustValue, trust.pct === null && styles.dim]}
            accessibilityLabel={
              trust.pct === null ? 'Trust Score no disponible' : `Trust Score ${trust.value} de 100`
            }
          >
            {trust.value}
          </Text>
          {trust.pct !== null && <Text style={styles.trustMax}>/ 100</Text>}
        </View>
        <View style={styles.track}>
          {trust.pct !== null && <View style={[styles.fill, { width: `${trust.pct}%` }]} />}
        </View>
        <Text style={styles.rightHint}>{trust.hint}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: dsSizes.gutter,
    backgroundColor: dsColors.surface,
    borderWidth: 1,
    borderColor: dsColors.borderSoft,
    borderRadius: dsRadius.xl,
    padding: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  left: { minWidth: 0 },
  score: {
    color: dsColors.textPrimary,
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 30,
    letterSpacing: -0.8,
  },
  dim: { color: 'rgba(255, 255, 255, 0.45)' },
  stars: { flexDirection: 'row', gap: 2, marginTop: 6 },
  leftHint: { color: dsColors.textMuted, fontSize: 11.5, marginTop: 6 },

  divider: { width: 1, alignSelf: 'stretch', backgroundColor: dsColors.borderSoft },

  right: { flex: 1, minWidth: 0 },
  trustLabel: {
    color: dsColors.textMuted,
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  trustRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 },
  trustValue: {
    color: dsColors.green,
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 26,
  },
  trustMax: { color: dsColors.textMuted, fontSize: 12 },
  track: {
    height: 6,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    marginTop: 8,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 4, backgroundColor: dsColors.green },
  rightHint: { color: dsColors.textMuted, fontSize: 11, marginTop: 6 },
});
