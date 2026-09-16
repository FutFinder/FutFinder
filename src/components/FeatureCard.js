import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { reservas as C, reservasRadius as R, reservasFonts as F } from '../theme/colors';

/**
 * Tarjeta de feature usada en la pantalla Welcome
 * Muestra ícono circular verde + título + descripción
 */
export default function FeatureCard({ icon: Icon, title, description }) {
  return (
    <View style={styles.card}>
      <View style={styles.iconCircle}>
        <Icon color={C.green} size={22} strokeWidth={2.2} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: C.surfaceAlt,
    borderRadius: R.cardSm,
    padding: 18,
    alignItems: 'center',
    minHeight: 150,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.greenSoft,
    borderWidth: 1.5,
    borderColor: C.green,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  title: {
    color: C.textPrimary,
    fontSize: 14,
    fontFamily: F.bold,
    textAlign: 'center',
    marginBottom: 6,
  },
  description: {
    color: C.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },
});
