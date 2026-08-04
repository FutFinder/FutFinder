import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Star } from 'lucide-react-native';

import { clubColors, clubRadius, clubSizes } from '../../theme/colors';
import ClubLogo from './ClubLogo';

/**
 * Tarjeta de club rival del carrusel "Buscar rivales".
 *
 * Muestra logo, nombre, "distancia · modalidad", valoración con estrella,
 * nivel y botón "Desafiar".
 *
 * Los textos con posibles N.A. (`meta`, `ratingLabel`, `nivelLabel`) llegan
 * ya resueltos desde clubMeta.js.
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
  return (
    <View style={styles.card}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Ver el club ${club.nombre}. ${meta}`}
        style={({ pressed }) => [styles.top, pressed && { opacity: 0.7 }]}
      >
        <ClubLogo uri={club.foto_url} size={42} borderRadius={clubRadius.md} />
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
          <Star color={clubColors.textPrimary} size={11} strokeWidth={2.4} />
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
          style={({ pressed }) => [styles.challengeBtn, pressed && styles.challengePressed]}
        >
          <Text style={styles.challengeText}>Desafiar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: clubSizes.rivalCard,
    backgroundColor: clubColors.surface,
    borderRadius: clubRadius.xl,
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
    padding: 12,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  info: { flex: 1, minWidth: 0 },
  name: {
    color: clubColors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  meta: {
    color: clubColors.textSecondary,
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
    borderRadius: clubRadius.chip,
    backgroundColor: clubColors.chip,
  },
  chipText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 11.5,
    fontWeight: '700',
  },
  challengeBtn: {
    height: 38,
    marginTop: 10,
    borderRadius: clubRadius.sm,
    borderWidth: 1,
    borderColor: clubColors.greenBorder,
    backgroundColor: clubColors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  challengePressed: { backgroundColor: clubColors.greenSoftStrong },
  challengeText: {
    color: clubColors.green,
    fontSize: 13,
    fontWeight: '700',
  },
});
