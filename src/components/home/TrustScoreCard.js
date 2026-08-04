import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ShieldCheck, ChevronRight } from 'lucide-react-native';
import { colors, radius } from '../../theme/colors';

const TIER_COLORS = {
  'ÉLITE':    colors.primary,
  'SÓLIDO':   '#E8B84B',
  'EN PRUEBA': colors.textMuted,
};

export default function TrustScoreCard({ score, matchesPlayed, reports, verified, tierLabel, onPress }) {
  const tierColor = TIER_COLORS[tierLabel] ?? colors.textMuted;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.root, pressed && { opacity: 0.88 }]}
    >
      <View style={s.left}>
        <Text style={s.label}>Trust Score</Text>
        <View style={s.scoreRow}>
          <Text style={s.score}>{score}</Text>
          <Text style={s.max}>/100</Text>
        </View>
        <Text style={s.played}>{matchesPlayed} partidos jugados</Text>
        {reports > 0 && (
          <Text style={s.reports}>{reports} reporte{reports > 1 ? 's' : ''}</Text>
        )}
      </View>

      <View style={s.right}>
        {verified && (
          <View style={s.verifiedRow}>
            <ShieldCheck color={colors.primary} size={13} />
            <Text style={s.verifiedText}>Verificado</Text>
          </View>
        )}
        <View style={[s.tierBadge, { borderColor: tierColor, backgroundColor: tierColor + '1A' }]}>
          <Text style={[s.tierText, { color: tierColor }]}>{tierLabel}</Text>
        </View>
        <ChevronRight color={colors.textMuted} size={16} style={{ marginTop: 4 }} />
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary + '50',
    padding: 16,
  },
  left: { flex: 1 },
  label: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  score: {
    color: colors.textPrimary,
    fontSize: 32,
    fontWeight: '800',
    lineHeight: 36,
  },
  max: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: '600',
  },
  played: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  reports: {
    color: colors.error,
    fontSize: 11,
    marginTop: 2,
  },
  right: {
    alignItems: 'flex-end',
    gap: 6,
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  verifiedText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '600',
  },
  tierBadge: {
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tierText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
