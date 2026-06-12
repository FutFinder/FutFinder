import React from 'react';
import Svg, { Path, Circle, G } from 'react-native-svg';

/**
 * Ícono personalizado: lupa con un balón de fútbol como lente.
 * Mismo viewBox (24x24) y grosor de trazo que los íconos Lucide para
 * que conviva con el resto de la tab bar sin desentonar.
 *
 * El balón reusa el dibujo del Logo (pentágono central + 5 costuras).
 *
 * Props compatibles con Lucide: color, size, strokeWidth.
 */
export default function SearchFootballIcon({
  color = '#FFFFFF',
  size = 24,
  strokeWidth = 2,
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Lente de la lupa (es también el balón) */}
      <Circle
        cx={10.5}
        cy={10.5}
        r={7}
        stroke={color}
        strokeWidth={strokeWidth}
      />
      {/* Mango de la lupa */}
      <Path
        d="M15.7 15.7 L20.5 20.5"
        stroke={color}
        strokeWidth={strokeWidth + 0.4}
        strokeLinecap="round"
      />
      {/* Balón dentro del lente: pentágono central + costuras */}
      <G>
        <Path
          d="M10.5 7.6 L13 9.4 L12.05 12.3 L8.95 12.3 L8 9.4 Z"
          fill={color}
        />
        <Path d="M10.5 7.6 L10.5 5.6" stroke={color} strokeWidth={strokeWidth * 0.65} strokeLinecap="round" />
        <Path d="M13 9.4 L14.9 8.7" stroke={color} strokeWidth={strokeWidth * 0.65} strokeLinecap="round" />
        <Path d="M12.05 12.3 L13.2 14.2" stroke={color} strokeWidth={strokeWidth * 0.65} strokeLinecap="round" />
        <Path d="M8.95 12.3 L7.8 14.2" stroke={color} strokeWidth={strokeWidth * 0.65} strokeLinecap="round" />
        <Path d="M8 9.4 L6.1 8.7" stroke={color} strokeWidth={strokeWidth * 0.65} strokeLinecap="round" />
      </G>
    </Svg>
  );
}
