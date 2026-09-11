import React from 'react';
import Svg, { Path, Circle } from 'react-native-svg';

/**
 * Marca de FutFinder para las pantallas de entrada (Portada, Tutorial,
 * Crear cuenta, Iniciar sesión): el pin con el balón dentro, calcado de
 * `FutFinder Inicio.dc.html`.
 *
 * Es el mismo dibujo de `Logo.js` —que sigue sirviendo al resto de la app—
 * pero sin las cinco líneas de detalle del balón y sin texto, y tomando el
 * verde por prop en vez de `colors.primary`: estas pantallas usan la paleta
 * nueva (#5AE06A) y `Logo` está cableado a la vieja (#71B533). Vive aparte
 * para no arrastrar a esas decenas de pantallas a un cambio de paleta que
 * no pidieron.
 *
 * `size` es el ancho; el alto sale de la proporción 100:120 del viewBox,
 * igual que en el diseño (34×41 en la Portada, 21×25 en el resto).
 *
 * `bgColor` rellena el balón para que tape el trazo del pin que queda
 * detrás: tiene que ser el fondo sobre el que se dibuja la marca.
 */
export default function FutfinderMark({ size = 24, color = '#5AE06A', bgColor = '#0B0D0C' }) {
  return (
    <Svg width={size} height={size * 1.2} viewBox="0 0 100 120" fill="none">
      <Path
        d="M50 5 C25 5 8 22 8 47 C8 78 50 115 50 115 C50 115 92 78 92 47 C92 22 75 5 50 5 Z"
        stroke={color}
        strokeWidth={7}
      />
      <Circle cx={50} cy={47} r={22} fill={bgColor} stroke={color} strokeWidth={4} />
      <Path d="M50 35 L60 42 L56 53 L44 53 L40 42 Z" fill={color} />
    </Svg>
  );
}
