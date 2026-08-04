import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';
import { colors, radius } from '../../theme/colors';

export default function TacticalHeader({ userName, comuna, summary, greeting, verified, clubRoleLabel }) {
  return (
    <View style={s.root}>
      <View style={s.topRow}>
        <View style={s.left}>
          <Text style={s.greeting}>{greeting}</Text>
          <Text style={s.name} numberOfLines={1}>{userName}</Text>
          {(comuna || clubRoleLabel) ? (
            <Text style={s.sub}>{[comuna, clubRoleLabel].filter(Boolean).join(' · ')}</Text>
          ) : null}
        </View>
        {verified && (
          <View style={s.verifiedBadge}>
            <ShieldCheck color="#0E0E0D" size={12} strokeWidth={2.5} />
            <Text style={s.verifiedText}>VERIFICADO</Text>
          </View>
        )}
      </View>
      <Text style={s.summary}>{summary}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 4,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  left: { flex: 1, marginRight: 12 },
  greeting: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  name: {
    color: colors.textPrimary,
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: -0.6,
    marginTop: 1,
    lineHeight: 32,
  },
  sub: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 3,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.pill,
    marginTop: 6,
  },
  verifiedText: {
    color: '#0E0E0D',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  summary: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
    marginBottom: 4,
  },
});
