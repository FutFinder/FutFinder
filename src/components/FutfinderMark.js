import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * Marca de FutFinder del handoff "Bienvenida" (pin/hoja con una estrella
 * dentro) — distinta del balón-en-pin de `Logo.js`, que sigue usándose en
 * el resto de la app. Vive aparte a propósito: `Logo` está en decenas de
 * pantallas con la paleta original, y no hay razón para arrastrar esas
 * pantallas a un ícono nuevo solo porque Bienvenida estrenó uno. Esta marca
 * queda acotada a las pantallas de entrada (Portada, Crear cuenta, Iniciar
 * sesión), las únicas que usan el diseño de este handoff.
 *
 * `glow`: halo verde difuso detrás del ícono, para la versión grande del
 * hero de Portada — CSS usa `filter:drop-shadow(...)`, que RN no tiene
 * para SVG; se aproxima con un círculo semitransparente detrás.
 */
export default function FutfinderMark({ size = 24, color = '#55DF69', glow = false }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {glow ? (
        <View
          style={[
            styles.glow,
            {
              width: size * 2.2,
              height: size * 2.2,
              borderRadius: size * 1.1,
              backgroundColor: color,
            },
          ]}
        />
      ) : null}
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path
          d="M12 22s7.5-7.1 7.5-12.6A7.5 7.5 0 0 0 4.5 9.4C4.5 14.9 12 22 12 22z"
          stroke={color}
          strokeWidth={1.7}
          strokeLinecap="round"
        />
        <Path
          d="m12 5.9 1.5 3.1 3.3.4-2.4 2.3.6 3.3L12 13.4l-3 1.6.6-3.3L7.2 9.4l3.3-.4z"
          fill={color}
          stroke="none"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  glow: { position: 'absolute', opacity: 0.25 },
});
