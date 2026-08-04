import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { dsColors } from '../../theme/colors';

/** Nº de bandas del degradado diagonal (más bandas = transición más suave). */
const RAMP_BANDS = 22;
/** Nº de franjas finas de la textura superpuesta. */
const TEXTURE_STRIPES = 26;

/**
 * Degradado diagonal + textura para los banners de club y de jugador,
 * sin dependencias externas.
 *
 * El diseño de referencia usa `linear-gradient(135deg, …)` y
 * `repeating-linear-gradient(115deg, …)` de CSS. Como el proyecto no tiene
 * expo-linear-gradient (y no se agrega solo por esto), se aproxima con Views:
 *
 *  1. base oscura (#101312, la pinta el contenedor)
 *  2. RAMP_BANDS bandas contiguas de verde con alfa decreciente dentro de un
 *     contenedor rotado 25° → lee como degradado diagonal suave
 *  3. franjas blancas finas encima → textura
 *  4. halo verde en la esquina superior derecha
 *
 * @param {'filled'|'empty'} variant
 *   'filled' → banner con identidad (verde, como en el perfil/club completo)
 *   'empty'  → aún sin portada: gris neutro, textura más marcada y leyenda
 * @param {string} [emptyLabel] Texto centrado en la variante 'empty'.
 */
export default function BannerBackdrop({ variant = 'filled', emptyLabel }) {
  const empty = variant === 'empty';

  return (
    <View style={styles.backdrop} pointerEvents="none">
      <View style={styles.rotor}>
        {Array.from({ length: RAMP_BANDS }).map((_, i) => {
          // Caída lineal 1 → 0.18 a lo largo de la diagonal. No baja a 0 para
          // que todo el banner conserve el color base de la referencia en vez
          // de apagarse a negro en la esquina opuesta.
          const t = 1 - i / (RAMP_BANDS - 1);
          const alpha = Math.round((0.18 + 0.82 * t) * 100) / 100;
          const rgb = empty ? '27, 32, 29' : '23, 58, 28';
          return (
            <View
              key={`band-${i}`}
              style={[styles.band, { backgroundColor: `rgba(${rgb}, ${alpha})` }]}
            />
          );
        })}
      </View>

      <View style={styles.rotor}>
        {Array.from({ length: TEXTURE_STRIPES }).map((_, i) => (
          <View
            key={`tex-${i}`}
            style={[styles.textureStripe, empty && styles.textureStripeEmpty]}
          />
        ))}
      </View>

      {!empty && <View style={styles.glow} />}

      {empty && emptyLabel ? (
        <View style={styles.emptyLabelWrap}>
          <Text style={styles.emptyLabel}>{emptyLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
  textureStripeEmpty: { width: 6, marginRight: 6 },
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
  emptyLabelWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  emptyLabel: {
    fontSize: 10.5,
    color: dsColors.textMuted,
    letterSpacing: 0.3,
  },
});
