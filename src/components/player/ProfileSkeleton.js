import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet } from 'react-native';

import { dsColors, dsRadius, dsSizes } from '../../theme/colors';

/**
 * Skeleton de carga del perfil: replica la silueta del héroe y de las dos
 * primeras tarjetas, para que el salto al contenido real no mueva el layout.
 *
 * La animación de opacidad usa `useNativeDriver: false` a propósito: en web el
 * driver nativo no existe y avisa por consola en cada carga.
 */
export default function ProfileSkeleton() {
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const shimmer = { opacity: pulse };

  return (
    <View accessibilityLabel="Cargando el perfil" style={styles.wrap}>
      <View style={styles.hero}>
        <Animated.View style={[styles.banner, shimmer]} />
        <View style={styles.heroBody}>
          <View style={styles.heroRow}>
            <Animated.View style={[styles.avatar, shimmer]} />
            <View style={styles.heroTexts}>
              <Animated.View style={[styles.line, { width: '55%' }, shimmer]} />
              <Animated.View style={[styles.lineSm, { width: '35%' }, shimmer]} />
            </View>
          </View>
          <View style={styles.chipsRow}>
            <Animated.View style={[styles.chip, shimmer]} />
            <Animated.View style={[styles.chip, shimmer]} />
          </View>
        </View>
      </View>

      <Animated.View style={[styles.card, shimmer]} />
      <Animated.View style={[styles.cardTall, shimmer]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 4, gap: 16 },
  hero: {
    marginHorizontal: dsSizes.gutter,
    borderRadius: dsRadius.hero,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: dsColors.borderSoft,
  },
  banner: { height: 118, backgroundColor: 'rgba(255, 255, 255, 0.08)' },
  heroBody: { backgroundColor: dsColors.surface, paddingHorizontal: 14, paddingBottom: 14 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginTop: -30 },
  avatar: {
    width: dsSizes.logo,
    height: dsSizes.logo,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: dsColors.surface,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  heroTexts: { flex: 1, gap: 7, paddingBottom: 6 },
  line: { height: 14, borderRadius: 7, backgroundColor: 'rgba(255, 255, 255, 0.08)' },
  lineSm: { height: 10, borderRadius: 6, backgroundColor: 'rgba(255, 255, 255, 0.06)' },
  chipsRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  chip: {
    flex: 1,
    height: 44,
    borderRadius: dsRadius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  card: {
    marginHorizontal: dsSizes.gutter,
    height: 72,
    borderRadius: dsRadius.lg,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  cardTall: {
    marginHorizontal: dsSizes.gutter,
    height: 150,
    borderRadius: dsRadius.xl,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
});
