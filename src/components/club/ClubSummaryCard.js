import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MapPin, ChevronRight, Crown } from 'lucide-react-native';

import { temaClub } from '../../theme/clubThemes';
import { clubTonos, clubSuperficies } from '../../theme/colors';
import ClubLogo from './ClubLogo';
import VerifiedBadge from './VerifiedBadge';

/**
 * La ficha del club en la portada: identidad, récord y entrada al detalle.
 *
 * Tres bandas: quién es el club, cómo le va, y el paso al detalle completo.
 *
 * «N.A.» ES EL CASO NORMAL. Un club recién creado no tiene partidos jugados
 * ni valoración, y esa es la mayoría de los clubes durante sus primeras
 * semanas. Un 0 en su lugar diría que jugó y perdió.
 *
 * SOBRE EL COLOR DE «V». Va en el acento del club, siguiendo el handoff de
 * diseño; «D» se queda en el rojo semántico fijo. En el tema rojo los dos
 * quedan parecidos, y ahí la letra es lo que distingue — por eso el rótulo
 * es tan grande como el número. Ojo si se revisa: es el único punto donde el
 * acento toca algo con carga de resultado.
 *
 * @param {object} club          Fila de `clubs`.
 * @param {object} [tema]        Escala de `theme/clubThemes.js`.
 * @param {string} [rol]         'admin' | 'jugador'.
 * @param {object} [stats]       `{ v, e, d }` de `club_estadisticas()`.
 * @param {string} [ratingLabel] Ya formateado ('4,6' o 'N.A.').
 * @param {number} [totalMiembros]
 * @param {number} [maxMiembros]
 * @param {Function} [onVerClub]
 */
export default function ClubSummaryCard({
  club,
  tema,
  rol,
  stats,
  ratingLabel = 'N.A.',
  totalMiembros,
  maxMiembros,
  onVerClub,
}) {
  const escala = tema || temaClub('green');
  if (!club) return null;

  const esAdmin = rol === 'admin';
  const esPremium = club.plan === 'premium';

  return (
    <View style={styles.tarjeta}>
      <View style={styles.identidad}>
        <ClubLogo
          uri={club.foto_url}
          size={56}
          borderRadius={18}
          tema={escala}
          style={{ backgroundColor: escala.soft }}
        />
        <View style={styles.identidadTextos}>
          <View style={styles.nombreFila}>
            <Text style={styles.nombre} numberOfLines={1}>
              {club.nombre}
            </Text>
            {club.verificado ? <VerifiedBadge size={17} tema={escala} /> : null}
          </View>

          {club.comuna ? (
            <View style={styles.comunaFila}>
              <MapPin size={12} color="rgba(255, 255, 255, 0.4)" strokeWidth={2.2} />
              <Text style={styles.comuna} numberOfLines={1}>
                {club.comuna}
              </Text>
            </View>
          ) : null}

          <View style={styles.chips}>
            <Chip texto={esAdmin ? 'Administrador' : 'Jugador'} color={escala.main} />
            {club.modalidad ? <Chip texto={etiquetaModalidad(club.modalidad)} /> : null}
            {Number.isFinite(totalMiembros) && Number.isFinite(maxMiembros) ? (
              <Chip texto={`${totalMiembros} / ${maxMiembros}`} />
            ) : null}
            {esPremium ? <Chip texto="Premium" color="#FFBE1A" Icono={Crown} /> : null}
          </View>
        </View>
      </View>

      <View style={styles.stats}>
        <StatTile valor={stats?.v} rotulo="V" color={escala.main} />
        <StatTile valor={stats?.e} rotulo="E" />
        <StatTile valor={stats?.d} rotulo="D" color={clubTonos.danger.fg} />
        <StatTile texto={ratingLabel} rotulo="RATING" />
      </View>

      <Pressable
        onPress={onVerClub}
        accessibilityRole="button"
        accessibilityLabel={`Ver ${club.nombre}`}
        style={({ pressed }) => [styles.verClub, pressed && { opacity: 0.75 }]}
      >
        <Text style={styles.verClubTexto}>Ver club</Text>
        <ChevronRight size={17} color="rgba(255, 255, 255, 0.4)" strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

function Chip({ texto, color, Icono }) {
  return (
    <View style={styles.chip}>
      {Icono ? <Icono size={11} color={color || '#FFFFFF'} strokeWidth={2.4} /> : null}
      <Text style={[styles.chipTexto, color && { color }]}>{texto}</Text>
    </View>
  );
}

/** Sin dato es «N.A.», no 0: un club sin partidos no perdió ninguno. */
function StatTile({ valor, texto, rotulo, color }) {
  const contenido = texto ?? (Number.isFinite(valor) ? String(valor) : 'N.A.');
  const sinDato = contenido === 'N.A.';

  return (
    <View style={styles.statTile}>
      <Text style={[styles.statValor, color && !sinDato && { color }, sinDato && styles.statVacio]}>
        {contenido}
      </Text>
      <Text style={[styles.statRotulo, color && !sinDato && { color }]}>{rotulo}</Text>
    </View>
  );
}

function etiquetaModalidad(valor) {
  if (valor === 'futbol7') return 'Fútbol 7';
  if (valor === 'futbol11') return 'Fútbol 11';
  return String(valor);
}

const styles = StyleSheet.create({
  tarjeta: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: clubSuperficies.borde,
    backgroundColor: clubSuperficies.card,
    overflow: 'hidden',
  },
  identidad: { flexDirection: 'row', gap: 12, padding: 14 },
  identidadTextos: { flex: 1, minWidth: 0, gap: 5 },
  nombreFila: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nombre: { flexShrink: 1, fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
  comunaFila: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  comuna: { fontSize: 12, color: 'rgba(255, 255, 255, 0.4)' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  chipTexto: { fontSize: 11, fontWeight: '700', color: 'rgba(255, 255, 255, 0.7)' },
  stats: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 14 },
  statTile: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 10,
    borderRadius: 13,
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
  },
  statValor: { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
  statVacio: { fontSize: 13, color: 'rgba(255, 255, 255, 0.45)' },
  statRotulo: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: 'rgba(255, 255, 255, 0.4)',
  },
  verClub: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 13,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.07)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  verClubTexto: { fontSize: 13.5, fontWeight: '700', color: '#FFFFFF' },
});
