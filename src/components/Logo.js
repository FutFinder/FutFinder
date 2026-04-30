import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle, G } from 'react-native-svg';
import { colors } from '../theme/colors';

/**
 * Logo de FutFinder: pin de ubicación con balón de fútbol dentro
 * + texto "futfinder" donde "fut" es blanco/negro y "finder" es verde.
 *
 * Props:
 *  - size: tamaño del pin en px (default 48)
 *  - showText: si muestra el texto al lado (default true)
 *  - textColor: color base del texto (default blanco)
 */
export default function Logo({ size = 48, showText = true, textColor = '#FFFFFF' }) {
  return (
    <View style={styles.row}>
      <Svg width={size} height={size * 1.2} viewBox="0 0 100 120">
        {/* Pin shape */}
        <Path
          d="M50 5 C25 5 8 22 8 47 C8 78 50 115 50 115 C50 115 92 78 92 47 C92 22 75 5 50 5 Z"
          fill="none"
          stroke={colors.primary}
          strokeWidth={6}
        />
        {/* Balón de fútbol dentro del pin */}
        <G>
          <Circle cx={50} cy={47} r={22} fill={colors.background} stroke={colors.primary} strokeWidth={3} />
          {/* Pentágono central del balón */}
          <Path
            d="M50 35 L60 42 L56 53 L44 53 L40 42 Z"
            fill={colors.primary}
          />
          {/* Detalles del balón */}
          <Path d="M50 35 L50 28" stroke={colors.primary} strokeWidth={2.5} strokeLinecap="round" />
          <Path d="M60 42 L67 39" stroke={colors.primary} strokeWidth={2.5} strokeLinecap="round" />
          <Path d="M56 53 L60 60" stroke={colors.primary} strokeWidth={2.5} strokeLinecap="round" />
          <Path d="M44 53 L40 60" stroke={colors.primary} strokeWidth={2.5} strokeLinecap="round" />
          <Path d="M40 42 L33 39" stroke={colors.primary} strokeWidth={2.5} strokeLinecap="round" />
        </G>
      </Svg>

      {showText && (
        <Text style={[styles.text, { color: textColor, fontSize: size * 0.78 }]}>
          fut<Text style={{ color: colors.primary }}>finder</Text>
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    fontWeight: '800',
    letterSpacing: -0.5,
  },
});
