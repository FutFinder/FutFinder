import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Star } from 'lucide-react-native';

import {
  paleta as C,
  radios as R,
  fuentes as F,
} from '../../theme/colors';
import { temaDeClub } from '../../theme/clubThemes';
import ClubLogo from './ClubLogo';

/**
 * Tarjeta de club rival del carrusel "Buscar rivales".
 *
 * Muestra logo, nombre, "distancia · modalidad", valoración con estrella,
 * nivel y botón "Desafiar".
 *
 * Los textos con posibles N.A. (`meta`, `ratingLabel`, `nivelLabel`) llegan
 * ya resueltos desde clubMeta.js.
 *
 * EL COLOR ES DEL RIVAL, NO DE QUIEN MIRA. Estas tarjetas viven dentro de
 * «Mi club», así que pintarlas con el tema de la pantalla las volvería
 * tarjetas de mi club con el nombre de otro. El tema sale de la propia fila
 * (`club.tema`, columna que viaja en `RIVAL_CLUB_COLUMNS`); un rival sin
 * tema —o traído por un entorno sin la migración 53— se ve verde.
 */
export default function RivalClubCard({
  club,
  meta,
  ratingLabel,
  nivelLabel,
  onPress,
  onChallenge,
  puedeDesafiar = true,
}) {
  const tema = temaDeClub(club);

  return (
    <View style={styles.card}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Ver el club ${club.nombre}. ${meta}`}
        style={({ pressed }) => [styles.top, pressed && { opacity: 0.7 }]}
      >
        <ClubLogo uri={club.foto_url} size={42} borderRadius={R.iconBtn} />
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {club.nombre}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        </View>
      </Pressable>

      <View style={styles.chipRow}>
        <View
          style={styles.chip}
          accessibilityLabel={
            ratingLabel === 'N.A.' ? 'Valoración no disponible' : `Valoración ${ratingLabel}`
          }
        >
          <Star color={C.textPrimary} size={11} strokeWidth={2.4} />
          <Text style={styles.chipText}>{ratingLabel}</Text>
        </View>
        <View style={styles.chip}>
          <Text style={styles.chipText} numberOfLines={1}>
            {nivelLabel}
          </Text>
        </View>
      </View>

      {puedeDesafiar ? (
        <Pressable
          onPress={onChallenge}
          // El botón mide 38 px como en la referencia; el hitSlop lo lleva
          // al mínimo táctil de 44 sin cambiar el diseño.
          hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
          accessibilityRole="button"
          accessibilityLabel={`Desafiar a ${club.nombre}`}
          style={({ pressed }) => [
            styles.challengeBtn,
            { borderColor: tema.border, backgroundColor: tema.soft },
            pressed && { backgroundColor: tema.softStrong },
          ]}
        >
          <Text style={[styles.challengeText, { color: tema.main }]}>Desafiar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Ancho de la tarjeta, en puntos.
 *
 * Vive acá y no en el theme porque no es un token de la paleta: es una
 * medida de ESTA tarjeta. El carrusel de `ClubDetailScreen` la importa para
 * su `snapToInterval`, que tiene que ser el mismo número o el desplazamiento
 * deja de caer sobre una tarjeta.
 */
export const ANCHO_TARJETA_RIVAL = 196;

const styles = StyleSheet.create({
  card: {
    width: ANCHO_TARJETA_RIVAL,
    backgroundColor: C.surface,
    borderRadius: R.cardSm,
    borderWidth: 1,
    borderColor: C.borderSoft,
    padding: 12,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  info: { flex: 1, minWidth: 0 },
  name: {
    color: C.textPrimary,
    fontSize: 14,
    fontFamily: F.bold,
  },
  meta: {
    color: C.textSecondary,
    fontSize: 11.5,
    marginTop: 2,
  },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '58%',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: R.chip,
    backgroundColor: C.chip,
  },
  chipText: {
    color: C.textStrong,
    fontSize: 11.5,
    fontFamily: F.bold,
  },
  challengeBtn: {
    height: 38,
    marginTop: 10,
    borderRadius: R.chip,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  challengeText: {
    fontSize: 13,
    fontFamily: F.bold,
  },
});
