import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';

import { temaClub } from '../../theme/clubThemes';

/**
 * Lo que ocupa el lugar de «Pendiente para ti» cuando no hay nada pendiente.
 *
 * No es una lista vacía: una sección que desaparece deja al usuario sin saber
 * si no tiene tareas o si algo falló al cargarlas. Este banner responde esa
 * pregunta y con eso desaparecen también el badge y el «Ver todo», que no
 * tendrían nada que contar.
 *
 * @param {object} [tema] Escala de `theme/clubThemes.js`.
 */
export default function AllClearBanner({ tema }) {
  const escala = tema || temaClub('green');

  return (
    <View
      style={[styles.banner, { borderColor: escala.border }]}
      accessibilityRole="text"
      accessibilityLabel="Todo al día. Sin desafíos ni cambios por responder"
    >
      <View style={[styles.icono, { backgroundColor: escala.soft }]}>
        <Check size={18} color={escala.main} strokeWidth={2.6} />
      </View>
      <View style={styles.textos}>
        <Text style={styles.titulo}>Todo al día</Text>
        <Text style={styles.subtitulo}>Sin desafíos ni cambios por responder</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: '#0E0F0E',
  },
  icono: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textos: { flex: 1, minWidth: 0, gap: 2 },
  titulo: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  subtitulo: { fontSize: 12, color: 'rgba(255, 255, 255, 0.45)' },
});
