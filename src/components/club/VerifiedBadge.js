import React from 'react';
import Svg, { Path } from 'react-native-svg';

import { temaClub } from '../../theme/clubThemes';

/**
 * Insignia de club verificado: escudo festoneado de 12 puntas con un check.
 *
 * Se dibuja, no se importa: hace falta en cuatro tamaños (13 en el chip del
 * club activo, 17 en el resumen, 21 en la cabecera de «Mi club» y junto al
 * chip «Premium») y en cuatro colores de tema. Una imagen obligaría a
 * mantener dieciséis archivos y se vería sucia al escalar.
 *
 * El escudo va en `tema.main` y el check en `tema.ink`, que es la tinta con
 * 4,5:1 garantizado sobre el principal de cada tema — no blanco fijo, que
 * sobre el amarillo no se leería.
 *
 * Los dos `Path` están calculados sobre un lienzo de 24×24 y escalan con
 * `size`: el festoneado es un dodecágono cuyos lados se curvan hacia afuera.
 *
 * @param {number} [size=17]  Lado en px.
 * @param {object} [tema]     Escala de `theme/clubThemes.js`. Sin ella, verde.
 */
export default function VerifiedBadge({ size = 17, tema, style }) {
  const escala = tema || temaClub('green');

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={style}
      accessibilityRole="image"
      accessibilityLabel="Club verificado"
    >
      <Path d={ESCUDO} fill={escala.main} />
      <Path
        d={CHECK}
        stroke={escala.ink}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** Dodecágono con los lados curvados hacia afuera: las 12 puntas del sello. */
const ESCUDO =
  'M9.64 3.21Q12.00 0.40 14.36 3.21Q17.80 1.95 18.43 5.57Q22.05 6.20 20.79 9.64' +
  'Q23.60 12.00 20.79 14.36Q22.05 17.80 18.43 18.43Q17.80 22.05 14.36 20.79' +
  'Q12.00 23.60 9.64 20.79Q6.20 22.05 5.57 18.43Q1.95 17.80 3.21 14.36' +
  'Q0.40 12.00 3.21 9.64Q1.95 6.20 5.57 5.57Q6.20 1.95 9.64 3.21Z';

const CHECK = 'M7.8 12.2 10.6 15 16.2 9.4';
