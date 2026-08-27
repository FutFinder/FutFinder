import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MapPin } from 'lucide-react-native';

import { tactical } from '../theme/colors';

/**
 * Marca «FutFinder» (pin + wordmark) para el header de cada pestaña.
 *
 * Sin props de tamaño ni color a propósito: las tres implementaciones que
 * reemplaza (Home, Chat, Partidos) habían divergido en tamaño de ícono,
 * tamaño de texto y tono de verde. Fijar los valores acá — en vez de
 * exponerlos como props — es lo que evita que un futuro cambio los separe
 * otra vez. Usa los tokens de `tactical` (el rediseño de Home) siempre,
 * sin adaptarse a la paleta de la pantalla que la aloja — mismo criterio
 * que ya sigue `NotificationBell`.
 */
export default function BrandMark({ style }) {
  return (
    <View style={[styles.row, style]}>
      <MapPin size={26} color={tactical.neon} strokeWidth={2.2} />
      <Text style={styles.word}>
        fut<Text style={styles.wordAccent}>finder</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  word: {
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: tactical.text,
  },
  wordAccent: { color: tactical.neon },
});
