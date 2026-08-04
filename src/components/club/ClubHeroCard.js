import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { MapPin, BadgeCheck } from 'lucide-react-native';

import { clubColors, clubRadius, clubSizes } from '../../theme/colors';
import ClubLogo from './ClubLogo';
import ClubTagBadge from './ClubTagBadge';
import ClubStatsRow from './ClubStatsRow';

/** Nº de bandas del degradado diagonal (más bandas = transición más suave). */
const RAMP_BANDS = 22;
/** Nº de franjas finas de la textura superpuesta. */
const TEXTURE_STRIPES = 26;

/**
 * Degradado diagonal + textura del banner, sin dependencias externas.
 *
 * El diseño de referencia usa `linear-gradient(135deg, …)` y
 * `repeating-linear-gradient(115deg, …)` de CSS. Como el proyecto no tiene
 * expo-linear-gradient (y no se agrega solo por esto), se aproxima con Views:
 *
 *  1. base oscura (#101312)
 *  2. RAMP_BANDS bandas contiguas de verde con alfa decreciente dentro de un
 *     contenedor rotado 25° → lee como degradado diagonal suave
 *  3. franjas blancas finas encima → textura
 *  4. halo verde en la esquina superior derecha
 */
function BannerBackdrop() {
  return (
    <View style={styles.backdrop} pointerEvents="none">
      <View style={styles.rotor}>
        {Array.from({ length: RAMP_BANDS }).map((_, i) => {
          // Caída lineal 1 → 0.18 a lo largo de la diagonal. No baja a 0 para
          // que todo el banner conserve el verde de la referencia en vez de
          // apagarse a negro en la esquina opuesta.
          const t = 1 - i / (RAMP_BANDS - 1);
          const alpha = Math.round((0.18 + 0.82 * t) * 100) / 100;
          return (
            <View
              key={`band-${i}`}
              style={[styles.band, { backgroundColor: `rgba(23, 58, 28, ${alpha})` }]}
            />
          );
        })}
      </View>

      <View style={styles.rotor}>
        {Array.from({ length: TEXTURE_STRIPES }).map((_, i) => (
          <View key={`tex-${i}`} style={styles.textureStripe} />
        ))}
      </View>

      <View style={styles.glow} />
    </View>
  );
}

/**
 * Tarjeta principal del club: banner con etiquetas de modalidad y nivel,
 * logo superpuesto, nombre + verificado, comuna · miembros y récord V/E/D/rating.
 *
 * Todos los textos llegan ya resueltos desde clubMeta.js (incluidos los N.A.),
 * este componente no decide qué mostrar cuando falta un dato.
 */
export default function ClubHeroCard({
  club,
  badges,
  nivelLabel,
  miembrosLabel,
  record,
  ratingLabel,
  onPressMiembros,
}) {
  return (
    <View style={styles.card}>
      <View style={styles.banner}>
        {club.banner_url ? (
          <Image source={{ uri: club.banner_url }} style={styles.bannerImg} resizeMode="cover" />
        ) : (
          <BannerBackdrop />
        )}
        <View style={styles.badgeRow}>
          {badges.map((b) => (
            <ClubTagBadge key={b} label={b} />
          ))}
          <ClubTagBadge label={nivelLabel} />
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.identityRow}>
          <ClubLogo
            uri={club.foto_url}
            size={clubSizes.logo}
            borderRadius={22}
            accent={clubColors.green}
            style={styles.logo}
          />
          <View style={styles.nameCol}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {club.nombre}
              </Text>
              {club.verificado ? (
                <BadgeCheck
                  color={clubColors.gold}
                  size={17}
                  strokeWidth={2.2}
                  accessibilityLabel="Club verificado"
                />
              ) : null}
            </View>
            <Pressable
              onPress={onPressMiembros}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Ver integrantes. ${miembrosLabel}`}
              style={({ pressed }) => [styles.metaRow, pressed && { opacity: 0.7 }]}
            >
              <MapPin color={clubColors.textSecondary} size={12} strokeWidth={2} />
              <Text style={styles.metaText} numberOfLines={1}>
                {miembrosLabel}
              </Text>
            </Pressable>
          </View>
        </View>

        <ClubStatsRow record={record} ratingLabel={ratingLabel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: clubSizes.gutter,
    borderRadius: clubRadius.hero,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
  },

  // ── Banner ──
  banner: {
    height: 118,
    backgroundColor: clubColors.bannerTo,
    position: 'relative',
    overflow: 'hidden',
  },
  bannerImg: { width: '100%', height: '100%' },
  backdrop: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  // Contenedor rotado y sobredimensionado: al recortarse contra el banner,
  // las bandas/franjas quedan en diagonal y cubren toda la superficie.
  rotor: {
    position: 'absolute',
    left: -160,
    top: -160,
    right: -160,
    bottom: -160,
    flexDirection: 'row',
    transform: [{ rotate: '25deg' }],
  },
  // Bandas contiguas (sin gap) → degradado.
  band: { flex: 1, height: '100%' },
  // Franjas finas separadas → textura.
  textureStripe: {
    width: 2,
    height: '100%',
    marginRight: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  // Halo verde de la esquina superior derecha. Alfa muy bajo y radio grande
  // para que no se lea como un círculo con borde definido.
  glow: {
    position: 'absolute',
    right: -70,
    top: -90,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(90, 224, 106, 0.07)',
  },
  badgeRow: {
    position: 'absolute',
    left: 12,
    top: 12,
    flexDirection: 'row',
    gap: 6,
  },

  // ── Cuerpo ──
  body: {
    backgroundColor: clubColors.surface,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    marginTop: -30,
  },
  logo: {
    borderWidth: 2,
    borderColor: clubColors.surface,
    backgroundColor: clubColors.surfaceAlt,
  },
  nameCol: { flex: 1, minWidth: 0, paddingBottom: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: {
    color: clubColors.textPrimary,
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.4,
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
  },
  metaText: {
    color: clubColors.textSecondary,
    fontSize: 12.5,
    flexShrink: 1,
  },
});
