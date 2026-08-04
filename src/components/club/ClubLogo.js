import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { Shield } from 'lucide-react-native';

import { clubColors } from '../../theme/colors';

/**
 * Logo de club con fallback a escudo.
 *
 * @param {string|null} uri  URL del logo.
 * @param {number} size      Lado en px.
 * @param {number} borderRadius  Por defecto redondeado tipo "squircle".
 * @param {string} accent    Color del escudo del fallback.
 */
export default function ClubLogo({
  uri,
  size = 42,
  borderRadius,
  accent = clubColors.textMuted,
  style,
}) {
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
        style,
      ]}
    >
      <Shield color={accent} size={Math.round(size * 0.46)} strokeWidth={1.8} />
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
