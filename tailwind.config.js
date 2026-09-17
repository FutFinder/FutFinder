/**
 * NativeWind para la parte de la app que se estiliza con `className`:
 * Inicio, Avisos y la barra de pestañas. El resto usa `StyleSheet`.
 *
 * LOS COLORES SALEN DE `src/theme/colors.js`, NO DE ACÁ. Mientras
 * `theme.extend` estuvo vacío, la única forma de pintar algo era el valor
 * arbitrario —`bg-[#00FF66]`— y eso dejó la paleta escrita a mano en doce
 * archivos. Cuando la app se unificó en una sola estética, esos hex no los vio
 * nadie: no son imports, así que ni el lint ni la migración de tokens los
 * tocaron, y el verde flúor del rediseño anterior sobrevivió en 41 lugares.
 *
 * Con la paleta acá, `bg-verde` y `bg-[#55DF69]` se ven igual, pero solo uno
 * cambia cuando cambie la paleta. `nadieEscribeLaPaletaAMano.test.js` obliga a
 * usar el primero.
 *
 * El `require` de un módulo ES funciona: lo resuelve Node, no Metro.
 */
const { paleta } = require('./src/theme/colors.js');

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Las pruebas quedan fuera: `nadieEscribeLaPaletaAMano.test.js` nombra las
  // clases prohibidas para poder prohibirlas, y con el glob abierto Tailwind
  // las leía como uso real y generaba CSS muerto para cada una.
  content: [
    './App.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
    '!./src/**/__tests__/**',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        verde: paleta.green,
        'verde-hover': paleta.greenHover,
        'verde-ink': paleta.greenInk,
        fondo: paleta.bg,
        superficie: paleta.surface,
        'superficie-alta': paleta.surfaceAlt,
        borde: paleta.border,
        rojo: paleta.red,
        ambar: paleta.amber,
        oro: paleta.gold,
        texto: paleta.textPrimary,
        'texto-dim': paleta.textSecondary,
        'texto-mute': paleta.textMuted,
      },
    },
  },
  plugins: [],
};
