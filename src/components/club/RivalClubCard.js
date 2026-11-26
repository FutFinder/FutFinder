import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MapPin, Zap } from 'lucide-react-native';

import { paleta as C, radios as R, fuentes as F } from '../../theme/colors';
import { temaDeClub } from '../../theme/clubThemes';
import { modalidadInline } from '../../utils/clubModalidad';
import { formatDistanciaKm } from '../../utils/distancia';
import { nivelDeClub } from '../../utils/nivelClub';
import ClubLogo from './ClubLogo';
import NivelChip from './NivelChip';
import VerifiedBadge from './VerifiedBadge';

/**
 * Tarjeta de club rival (rediseño de Clubes, 2026-11-26).
 *
 * Logo con el aro del color DEL RIVAL, nombre, «comuna · modalidad», la
 * distancia arriba a la derecha, el nivel (migración 199, reemplaza al
 * rating) y el récord V·E·D cuando se conoce. Abajo, «Desafiar» y «Ver club».
 *
 * «DESAFIAR» ES VERDE DE LA APP, no del club: es la acción principal, y el
 * tema del club es sólo un acento. El aro del logo sí lleva el tema del
 * rival —la tarjeta vive dentro de mi club, y pintarla con mi color la
 * volvería una tarjeta de mi club con el nombre de otro—.
 *
 * LO QUE NO SE SABE NO OCUPA SITIO: sin nivel no hay chip, sin distancia no
 * hay distancia y sin `record` no hay récord. Nada se inventa.
 */
export default function RivalClubCard({
  club,
  distanciaKm,
  record,
  onPress,
  onChallenge,
  puedeDesafiar = true,
  // Ya le mandé un desafío que sigue sin respuesta: el índice único del
  // servidor rechazaría el segundo, así que va el estado en vez del botón.
  desafioEnviado = false,
  ancho = ANCHO_TARJETA_RIVAL,
}) {
  const tema = temaDeClub(club);
  const lugar = [club.comuna, modalidadInline(club.modalidad)].filter(Boolean).join(' · ');
  const distancia = typeof distanciaKm === 'number' ? formatDistanciaKm(distanciaKm) : null;
  // Sin nivel ni récord la fila del medio no tiene nada: si se dibujara igual,
  // dejaría un hueco entre el nombre y los botones.
  const hayMedio = !!nivelDeClub(club.nivel) || !!record;

  return (
    <View style={[styles.card, { width: ancho }]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Ver el club ${club.nombre}${lugar ? `. ${lugar}` : ''}`}
        style={({ pressed }) => [styles.top, pressed && { opacity: 0.7 }]}
      >
        <View style={[styles.aro, { borderColor: tema.main }]}>
          <ClubLogo uri={club.foto_url} size={38} borderRadius={19} />
        </View>
        <View style={styles.info}>
          <View style={styles.nombreFila}>
            <Text style={styles.name} numberOfLines={1}>
              {club.nombre}
            </Text>
            {club.verificado ? <VerifiedBadge size={14} tema={tema} /> : null}
          </View>
          {lugar ? (
            <Text style={styles.meta} numberOfLines={1}>
              {lugar}
            </Text>
          ) : null}
        </View>
        {distancia ? (
          <View style={styles.distancia}>
            <MapPin color={C.textSecondary} size={12} strokeWidth={2} />
            <Text style={styles.distanciaTexto}>{distancia}</Text>
          </View>
        ) : null}
      </Pressable>

      {hayMedio ? (
      <View style={styles.medio}>
        <NivelChip nivel={club.nivel} compacto />
        {record ? (
          <Text
            style={styles.record}
            accessibilityLabel={`${record.v} victorias, ${record.e} empates, ${record.d} derrotas`}
          >
            <Text style={{ color: C.win }}>{record.v}</Text>V ·{' '}
            <Text style={{ color: C.textPrimary }}>{record.e}</Text>E ·{' '}
            <Text style={{ color: C.loss }}>{record.d}</Text>D
          </Text>
        ) : null}
      </View>
      ) : null}

      <View style={styles.botones}>
        {puedeDesafiar && desafioEnviado ? (
          <View style={styles.enviado} accessibilityLabel={`Ya desafiaste a ${club.nombre}`}>
            <Text style={styles.enviadoTexto}>Desafío enviado</Text>
          </View>
        ) : puedeDesafiar ? (
          <Pressable
            onPress={onChallenge}
            accessibilityRole="button"
            accessibilityLabel={`Desafiar a ${club.nombre}`}
            style={({ pressed }) => [styles.desafiar, pressed && { backgroundColor: C.greenSoftStrong }]}
          >
            <Zap color={C.green} size={15} strokeWidth={2.4} />
            <Text style={styles.desafiarTexto}>Desafiar</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`Ver el club ${club.nombre}`}
          style={({ pressed }) => [
            styles.verClub,
            !puedeDesafiar && styles.verClubAncho,
            pressed && { backgroundColor: C.surfaceHover },
          ]}
        >
          <Text style={styles.verClubTexto}>Ver club</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Ancho de la tarjeta en el carrusel, en puntos. Los carruseles la importan
 * para su `snapToInterval`, que tiene que ser el mismo número o el
 * desplazamiento deja de caer sobre una tarjeta.
 */
export const ANCHO_TARJETA_RIVAL = 290;

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  aro: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, minWidth: 0 },
  nombreFila: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { color: C.textPrimary, fontSize: 15, fontFamily: F.extraBold, flexShrink: 1 },
  meta: { color: C.textSecondary, fontSize: 12, marginTop: 2 },
  distancia: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', marginTop: 3 },
  distanciaTexto: { color: C.textSecondary, fontSize: 12, fontFamily: F.semiBold },
  medio: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 24,
    marginTop: 12,
  },
  record: { color: C.textSecondary, fontSize: 12, fontFamily: F.bold },
  botones: { flexDirection: 'row', gap: 8, marginTop: 12 },
  desafiar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: R.chip,
    borderWidth: 1,
    borderColor: C.greenBorderStrong,
    backgroundColor: C.greenSoft,
  },
  desafiarTexto: { color: C.green, fontSize: 14, fontFamily: F.bold },
  verClub: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: R.chip,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
  },
  verClubAncho: { flex: 1 },
  enviado: {
    flex: 1,
    height: 40,
    borderRadius: R.chip,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceAlt,
  },
  enviadoTexto: { color: C.textSecondary, fontSize: 13.5, fontFamily: F.bold },
  verClubTexto: { color: C.textPrimary, fontSize: 14, fontFamily: F.bold },
});
