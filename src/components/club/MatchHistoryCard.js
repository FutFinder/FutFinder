import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { clubColors, clubRadius } from '../../theme/colors';
import ClubLogo from './ClubLogo';
import { RESULTADO } from '../../utils/historialClub';

/** Color e insignia por resultado. Sin resultado → neutro, sin insignia. */
function estiloResultado(resultado) {
  if (resultado === RESULTADO.VICTORIA) {
    return { color: clubColors.win, chipBg: clubColors.winSoft, letra: 'V' };
  }
  if (resultado === RESULTADO.DERROTA) {
    return { color: clubColors.loss, chipBg: clubColors.lossSoft, letra: 'D' };
  }
  if (resultado === RESULTADO.EMPATE) {
    return { color: clubColors.draw, chipBg: clubColors.drawSoft, letra: 'E' };
  }
  return { color: clubColors.textFaint, chipBg: 'transparent', letra: null };
}

/**
 * Tarjeta de un partido del historial: barra de color, escudos, marcador
 * desde la óptica del club, insignia V/E/D y dos líneas de contexto.
 *
 * TODO LO QUE MUESTRA ES DE UN PARTIDO YA DISPUTADO Y CONFIRMADO. Antes había
 * un `estado` que podía decir «Finalizado» sobre un partido sin marcador, con
 * un «vs» donde va el score; `historial_club()` (migración 49) ya no devuelve
 * esos partidos, así que la tarjeta no necesita hablar de estados.
 *
 * EL MARCADOR ES SIEMPRE «LO MÍO PRIMERO». «Club A 3-1 Club B» se lee
 * «Victoria 3-1» en el perfil de A y «Derrota 1-3» en el de B — la misma fila
 * de la base de datos, dos lecturas correctas. Quién fue local no se pierde:
 * va en la línea de contexto, porque el orden del marcador ya no lo dice.
 *
 * La hora y la cancha sólo llegan a los integrantes de los dos clubes: para
 * cualquier otro viajan en `null` y esa parte de la línea no se dibuja.
 */
export default function MatchHistoryCard({
  miNombre,
  miLogoUrl,
  rivalNombre,
  rivalLogoUrl,
  miMarcador,
  suMarcador,
  resultado,
  resultadoNombre,
  fechaLabel,
  horaLabel,
  localLabel,
  canchaNombre,
  tipoLabel,
  onPress,
}) {
  const r = estiloResultado(resultado);
  const conMarcador = miMarcador !== null && miMarcador !== undefined;
  const marcador = conMarcador ? `${miMarcador} - ${suMarcador}` : 'vs';

  // El resultado se pinta con su color y el resto en gris, así que la primera
  // línea se arma en dos trozos en vez de uno.
  const contexto = [fechaLabel, horaLabel, localLabel].filter(Boolean).join(' · ');
  const linea2 = [canchaNombre, tipoLabel].filter(Boolean).join(' · ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[
        `${resultadoNombre || 'Partido'}.`,
        `${miNombre} ${marcador} ${rivalNombre}.`,
        [fechaLabel, horaLabel, localLabel, canchaNombre, tipoLabel].filter(Boolean).join(', '),
      ].join(' ')}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={[styles.bar, { backgroundColor: r.color }]} />

      <View style={styles.center}>
        <View style={styles.scoreRow}>
          <ClubLogo uri={miLogoUrl} size={22} borderRadius={7} />
          <Text style={styles.mine} numberOfLines={1}>
            {miNombre}
          </Text>
          <Text style={styles.score} numberOfLines={1}>
            {marcador}
          </Text>
          <Text style={styles.rival} numberOfLines={1}>
            {rivalNombre}
          </Text>
          <ClubLogo uri={rivalLogoUrl} size={22} borderRadius={7} />
        </View>

        {resultadoNombre || contexto ? (
          <Text style={styles.sub} numberOfLines={1}>
            {resultadoNombre ? (
              <Text style={[styles.resultado, { color: r.color }]}>{resultadoNombre}</Text>
            ) : null}
            {contexto ? `${resultadoNombre ? ' · ' : ''}${contexto}` : ''}
          </Text>
        ) : null}
        {linea2 ? (
          <Text style={styles.sub} numberOfLines={1}>
            {linea2}
          </Text>
        ) : null}
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
  bar: { width: 4, height: 46, borderRadius: 3 },
  center: { flex: 1, minWidth: 0 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
  resultado: { fontWeight: '700' },
  badge: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, fontWeight: '800' },
});
