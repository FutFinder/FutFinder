import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { Shield } from 'lucide-react-native';

import { clubColors } from '../../theme/colors';

/**
 * Logo de club con fallback a escudo.
 *
 * El escudo provisional (cuando el club no subió logo) es parte de la
 * identidad: `tema` le da su color y el fondo suave del recuadro. Sin
 * `tema` queda el escudo gris neutro de siempre, que es lo correcto donde
 * el logo es un dato más y no la identidad de la pantalla.
 *
 * @param {string|null} uri  URL del logo.
 * @param {number} size      Lado en px.
 * @param {number} borderRadius  Por defecto redondeado tipo "squircle".
 * @param {object} [tema]    Escala de `theme/clubThemes.js`.
 * @param {string} [accent]  Color del escudo, si se quiere forzar uno.
 */
export default function ClubLogo({
  uri,
  size = 42,
  borderRadius,
  tema,
  accent,
  style,
}) {
  const color = accent || tema?.main || clubColors.textMuted;
  const br = borderRadius ?? Math.round(size * 0.3);

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[{ width: size, height: size, borderRadius: br }, style]}
        resizeMode="cover"
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: br },
        tema && { backgroundColor: tema.soft, borderColor: tema.border },
        style,
      ]}
    >
      <Shield color={color} size={Math.round(size * 0.46)} strokeWidth={1.8} />
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: clubColors.surfaceAlt,
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
