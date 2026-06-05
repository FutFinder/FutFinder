import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MapPin } from 'lucide-react-native';

import { colors, radius } from '../theme/colors';

/**
 * Stub para web: react-native-maps no soporta el navegador. Mostramos un
 * placeholder y la lista de partidos sigue debajo, totalmente funcional.
 */
export default function MatchMap() {
  return (
    <View style={styles.box}>
      <MapPin color={colors.primary} size={28} />
      <Text style={styles.title}>Mapa disponible en celular</Text>
      <Text style={styles.text}>
        Para una experiencia más ágil te recomendamos abrir FutFinder en la app
        del iPhone o Android. Aquí abajo igual ves la lista filtrada.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    height: 180,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surfaceAlt,
    padding: 22,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 4,
  },
  text: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
    maxWidth: 280,
  },
});
