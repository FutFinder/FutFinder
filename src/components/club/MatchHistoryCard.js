import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { clubColors, clubRadius } from '../../theme/colors';
import { RESULTADO } from '../../services/clubMatches';

/** Color e insignia por resultado. Sin resultado → neutro, sin insignia. */
function estiloResultado(resultado) {
  if (resultado === RESULTADO.VICTORIA) {
    return { color: clubColors.win, chipBg: clubColors.winSoft, letra: 'V', nombre: 'Victoria' };
  }
  if (resultado === RESULTADO.DERROTA) {
    return { color: clubColors.loss, chipBg: clubColors.lossSoft, letra: 'D', nombre: 'Derrota' };
  }
  if (resultado === RESULTADO.EMPATE) {
    return { color: clubColors.draw, chipBg: clubColors.drawSoft, letra: 'E', nombre: 'Empate' };
  }
  return { color: clubColors.textFaint, chipBg: 'transparent', letra: null, nombre: 'Sin resultado' };
}

/**
 * Tarjeta compacta de un partido del historial: barra de color, marcador,
 * nombres, fecha · estado, insignia V/E/D y chevron.
 *
 * Si el partido no tiene marcador (los partidos reales todavía no lo guardan
 * en la BD) se muestra "vs" en lugar de inventar un score.
 */
export default function MatchHistoryCard({
  miNombre,
  rivalNombre,
  miMarcador,
  suMarcador,
  fechaLabel,
  estado,
  resultado,
  onPress,
}) {
  const r = estiloResultado(resultado);
  const conMarcador = miMarcador !== null && miMarcador !== undefined;
  const marcador = conMarcador ? `${miMarcador} - ${suMarcador}` : 'vs';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${r.nombre}. ${miNombre} ${marcador} ${rivalNombre}. ${fechaLabel} ${estado}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={[styles.bar, { backgroundColor: r.color }]} />

      <View style={styles.center}>
        <View style={styles.scoreRow}>
          <Text style={styles.mine} numberOfLines={1}>
            {miNombre}
          </Text>
          <Text style={styles.score} numberOfLines={1}>
            {marcador}
          </Text>
          <Text style={styles.rival} numberOfLines={1}>
            {rivalNombre}
          </Text>
        </View>
        <Text style={styles.sub} numberOfLines={1}>
          {[fechaLabel, estado].filter(Boolean).join(' · ')}
        </Text>
      </View>

      {r.letra ? (
        <View style={[styles.badge, { backgroundColor: r.chipBg }]}>
          <Text style={[styles.badgeText, { color: r.color }]}>{r.letra}</Text>
        </View>
      ) : null}

      <ChevronRight color={clubColors.textFaint} size={16} strokeWidth={2.2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: clubColors.surface,
    borderRadius: clubRadius.lg,
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  pressed: { backgroundColor: clubColors.surfaceHover },
  bar: { width: 4, height: 38, borderRadius: 3 },
  center: { flex: 1, minWidth: 0 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  mine: {
    color: clubColors.textPrimary,
    fontSize: 13.5,
    fontWeight: '700',
    maxWidth: 96,
    flexShrink: 1,
  },
  // El marcador nunca se comprime ni se parte en dos líneas: si falta
  // espacio, se recortan los nombres a los lados.
  score: {
    color: clubColors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
    flexShrink: 0,
    flexGrow: 0,
  },
  rival: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 13.5,
    fontWeight: '700',
    flexShrink: 1,
  },
  sub: {
    color: clubColors.textMuted,
    fontSize: 11.5,
    marginTop: 3,
  },
  badge: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, fontWeight: '800' },
});
