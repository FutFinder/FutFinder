import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Clock, Users, MapPin, Swords } from 'lucide-react-native';
import { colors, radius } from '../../theme/colors';

function formatHora(iso) {
  try {
    const d = new Date(iso);
    const today = new Date();
    const sameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const isTomorrow =
      d.getFullYear() === tomorrow.getFullYear() &&
      d.getMonth() === tomorrow.getMonth() &&
      d.getDate() === tomorrow.getDate();
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    if (sameDay) return `Hoy · ${hh}:${mm}`;
    if (isTomorrow) return `Mañana · ${hh}:${mm}`;
    return (
      d.toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' }) +
      ` · ${hh}:${mm}`
    );
  } catch {
    return iso;
  }
}

function nivelLabel(n) {
  return { recreativo: 'Recreativo', intermedio: 'Intermedio', competitivo: 'Competitivo' }[n] || n;
}

export default function MatchCard({ match: m, onJoin, onPress }) {
  const cuposLeft = m.cupos_disponibles ?? 0;

  return (
    <Pressable
      onPress={() => onPress?.(m.id)}
      style={({ pressed }) => [s.root, m.club_local_id && s.clubMatch, pressed && { opacity: 0.93 }]}
    >
      {m.club_local_id && (
        <View style={s.clubBadge}>
          <Swords color="#0E0E0D" size={10} strokeWidth={2.5} />
          <Text style={s.clubBadgeText}>PARTIDO DE CLUBES</Text>
        </View>
      )}

      <View style={s.topRow}>
        <Text style={s.title} numberOfLines={2}>{m.titulo}</Text>
        <View style={[s.priceBadge, cuposLeft === 0 && s.fullBadge]}>
          <Text style={[s.priceText, cuposLeft === 0 && s.fullText]}>
            {cuposLeft === 0 ? 'Lleno' : m.precio_cuota === 0 ? 'Gratis' : `$${m.precio_cuota.toLocaleString('es-CL')}`}
          </Text>
        </View>
      </View>

      <Text style={s.venue} numberOfLines={1}>{m.cancha_nombre} · {m.comuna}</Text>

      <View style={s.chips}>
        <View style={s.chip}>
          <Clock color={colors.primary} size={10} />
          <Text style={s.chipText}>{formatHora(m.hora)}</Text>
        </View>
        <View style={s.chip}>
          <Users color={colors.primary} size={10} />
          <Text style={s.chipText}>{cuposLeft} cupos</Text>
        </View>
      </View>

      <Text style={s.level}>{nivelLabel(m.nivel || 'recreativo')}</Text>

      <Pressable
        onPress={() => onJoin?.(m.id)}
        disabled={cuposLeft === 0}
        style={({ pressed }) => [s.joinBtn, cuposLeft === 0 && s.joinBtnFull, pressed && { opacity: 0.8 }]}
      >
        <Text style={s.joinText}>
          {cuposLeft === 0 ? 'Lleno' : m.aprobacion === 'manual' ? 'Solicitar' : 'Unirme'}
        </Text>
      </Pressable>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: {
    width: 240,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 14,
  },
  clubMatch: {
    borderColor: colors.primary,
    borderWidth: 1.5,
    backgroundColor: colors.primarySoft,
  },
  clubBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginBottom: 8,
  },
  clubBadgeText: { color: '#0E0E0D', fontSize: 8, fontWeight: '800', letterSpacing: 0.4 },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 4,
  },
  title: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
  },
  priceBadge: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  fullBadge: {
    backgroundColor: 'rgba(229,72,77,0.10)',
    borderColor: colors.error,
  },
  priceText: { color: colors.primary, fontSize: 10, fontWeight: '700' },
  fullText: { color: colors.error },
  venue: { color: colors.textSecondary, fontSize: 11, marginBottom: 9 },
  chips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  chipText: { color: colors.textPrimary, fontSize: 10, fontWeight: '500' },
  level: { color: colors.textMuted, fontSize: 10, marginBottom: 12 },
  joinBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: 9,
    alignItems: 'center',
  },
  joinBtnFull: {
    backgroundColor: colors.borderSoft,
  },
  joinText: { color: '#0E0E0D', fontSize: 12, fontWeight: '800' },
});
