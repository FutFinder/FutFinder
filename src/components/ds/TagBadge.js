import React from 'react';
import { Text, StyleSheet } from 'react-native';

import {
  reservas as C,
  reservasRadius as R,
  reservasFonts as F,
} from '../../theme/colors';

/**
 * Chip pequeño en mayúsculas sobre un banner (club o jugador).
 *
 * Se usa para modalidad ("FÚTBOL 7", "FÚTBOL N.A."), posición ("DELANTERO")
 * y nivel ("NIVEL B", "NIVEL N.A.").
 *
 * @param {boolean} placeholder  true cuando el dato NO existe todavía: el chip
 *   se dibuja con borde discontinuo y texto apagado, para que un "N.A." nunca
 *   se lea como un valor real.
 *
 * Las etiquetas las producen clubMeta.js / playerMeta.js, no este componente.
 */
export default function TagBadge({ label, placeholder = false, style }) {
  return <Text style={[styles.chip, placeholder && styles.placeholder, style]}>{label}</Text>;
}

const styles = StyleSheet.create({
  chip: {
    fontSize: 10.5,
    fontFamily: F.bold,
    letterSpacing: 0.6,
    color: C.textSecondary,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: R.chip,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    overflow: 'hidden',
  },
  placeholder: {
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 255, 255, 0.18)',
    color: C.textMuted,
  },
});
