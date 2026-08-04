import React from 'react';
import { Text, StyleSheet } from 'react-native';

import { clubColors, clubRadius } from '../../theme/colors';

/**
 * Chip pequeño en mayúsculas sobre el banner del club.
 * Se usa para la modalidad ("FÚTBOL 7", "FÚTBOL 11", "FÚTBOL N.A.") y para
 * el nivel ("NIVEL B", "NIVEL N.A.").
 *
 * Las etiquetas las produce src/utils/clubMeta.js, no este componente.
 */
export default function ClubTagBadge({ label, style }) {
  return <Text style={[styles.chip, style]}>{label}</Text>;
}

const styles = StyleSheet.create({
  chip: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: clubColors.textSecondary,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: clubRadius.chip,
    borderWidth: 1,
    borderColor: clubColors.border,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    overflow: 'hidden',
  },
});
