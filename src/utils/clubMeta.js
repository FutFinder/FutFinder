/**
 * Lógica de presentación de metadatos de club: modalidad, nivel, valoración
 * y distancia entre comunas.
 *
 * Vive fuera de los componentes visuales a propósito, para que las reglas de
 * "qué se muestra cuando el dato no existe" estén en un solo lugar.
 *
 * REGLA TRANSVERSAL: no se inventa un número ni un nivel. Un dato que todavía
 * no existe se CALLA, y donde callarlo no se puede se dice en español.
 *
 * ANTES SE ESCRIBÍA «N.A.» EN TODAS PARTES, y las tarjetas de rival de un
 * club nuevo terminaban diciendo «Distancia N.A. · Fútbol N.A.» y «Nivel
 * N.A.»: tres siglas que parecen un error de la app, ocupando el sitio donde
 * debería estar lo que sí se sabe. `nivelInline` y `nivelBadge` devuelven
 * `null` cuando no hay nivel —quien llama esconde el chip— y `metaRival` arma
 * la línea sólo con los datos reales.
 *
 * `ratingLabel` sigue devolviendo el centinela 'N.A.': lo miran varias
 * tarjetas para decidir cómo dibujar la ausencia (una estrella apagada, un
 * «Sin valorar»), y cada una lo traduce a español por su cuenta.
 */

import { getComunaCoords } from '../data/comunas-coords';
import { haversineKm } from '../services/matches';

// El vocabulario de modalidad vive en `clubModalidad.js` —puro, sin
// Supabase— para que el formulario pueda validarlo sin arrastrar este
// archivo, que sí depende de la red por el cálculo de distancias. Se
// re-exporta acá para no cambiar los imports existentes.
import { MODALIDADES } from './clubModalidad.js';

export { MODALIDADES, OPCIONES_MODALIDAD, esModalidadValida } from './clubModalidad.js';

/**
 * Etiquetas de modalidad para el banner del club (MAYÚSCULAS).
 * Devuelve un array porque "ambos" se muestra como DOS chips.
 * Sin modalidad → `[]`, y no se dibuja ninguno.
 */
export function modalidadBadges(modalidad) {
  if (modalidad === MODALIDADES.FUTBOL_7) return ['FÚTBOL 7'];
  if (modalidad === MODALIDADES.FUTBOL_11) return ['FÚTBOL 11'];
  if (modalidad === MODALIDADES.AMBOS) return ['FÚTBOL 7', 'FÚTBOL 11'];
  // Sin modalidad declarada no hay chip: uno que dice «FÚTBOL N.A.» ocupa el
  // mismo sitio sin contar nada.
  return [];
}

/**
 * Modalidad en línea, para la meta de las tarjetas de rival.
 * Ej: 'Fútbol 7' · 'Fútbol 11' · 'Fútbol 7 y Fútbol 11'.
 * Sin modalidad declarada devuelve `null`: quien llama la omite.
 */
export function modalidadInline(modalidad) {
  if (modalidad === MODALIDADES.FUTBOL_7) return 'Fútbol 7';
  if (modalidad === MODALIDADES.FUTBOL_11) return 'Fútbol 11';
  if (modalidad === MODALIDADES.AMBOS) return 'Fútbol 7 y Fútbol 11';
  return null;
}

/**
 * Nivel del club para el banner. Hoy NO existe cálculo de nivel en la BD, así
 * que casi siempre devuelve `null` y el chip no se dibuja. Anunciar «NIVEL
 * N.A.» es contar que falta un dato que el usuario nunca pidió.
 */
export function nivelBadge(nivel) {
  if (!nivel) return null;
  return `NIVEL ${String(nivel).toUpperCase()}`;
}

/** Nivel en línea para tarjetas de rival: 'Nivel B', o `null` si no hay. */
export function nivelInline(nivel) {
  if (!nivel) return null;
  return `Nivel ${String(nivel).toUpperCase()}`;
}

/**
 * Valoración del club. Hoy no existe el campo en la BD → 'N.A.'.
 * Un 0 real tampoco se muestra como "0.0" si no hay valoraciones.
 */
export function ratingLabel(rating) {
  if (rating === null || rating === undefined || Number.isNaN(Number(rating))) {
    return 'N.A.';
  }
  const n = Number(rating);
  if (n <= 0) return 'N.A.';
  return n.toFixed(1).replace('.', ',');
}

/**
 * Distancia aproximada entre dos clubes, a partir de su comuna.
 *
 * Prioridad:
 *  1. lat/lng propias del club, si algún día existen.
 *  2. Centroide de la comuna (src/data/comunas-coords.js).
 *  3. null → la UI muestra 'Distancia desconocida'.
 *
 * @returns {number | null} kilómetros, o null si no se puede calcular.
 */
export function distanciaEntreClubesKm(clubA, clubB) {
  const a = coordsDeClub(clubA);
  const b = coordsDeClub(clubB);
  if (!a || !b) return null;
  return haversineKm(a, b);
}

function coordsDeClub(club) {
  if (!club) return null;
  // 1. Coordenadas propias (aún no existen en el esquema, pero si se agregan
  //    esta función las prefiere automáticamente).
  if (typeof club.latitud === 'number' && typeof club.longitud === 'number') {
    return { lat: club.latitud, lng: club.longitud };
  }
  // 2. Centroide de la comuna.
  return getComunaCoords(club.comuna);
}

/**
 * Formatea kilómetros al español de Chile: '2,4 km'.
 * @returns {string} 'Distancia desconocida' si km es null/undefined.
 */
export function formatDistanciaKm(km) {
  if (km === null || km === undefined || Number.isNaN(Number(km))) {
    return 'Distancia desconocida';
  }
  const n = Number(km);
  // Bajo 100 m no tiene sentido mostrar decimales de km.
  if (n < 0.1) return 'menos de 0,1 km';
  return `${n.toFixed(1).replace('.', ',')} km`;
}

/**
 * Línea de meta de una tarjeta de rival, sólo con lo que se sabe.
 *
 * Ej: '2,4 km · Fútbol 7' | '2,4 km' | 'Fútbol 7' | '' cuando no hay ninguno
 * de los dos, y entonces la tarjeta no dibuja la línea. La versión anterior
 * componía siempre los dos huecos y un club sin comuna ni modalidad quedaba
 * con «Distancia N.A. · Fútbol N.A.» bajo el nombre.
 *
 * La distancia sí se nombra cuando no se puede calcular —«Distancia
 * desconocida»— porque la tarjeta existe para comparar cercanía y su ausencia
 * es información; la modalidad simplemente se omite.
 */
export function metaRival({ distanciaKm, modalidad }) {
  return [formatDistanciaKm(distanciaKm), modalidadInline(modalidad)]
    .filter(Boolean)
    .join(' · ');
}
