/**
 * Lógica de presentación de metadatos de club: modalidad, nivel, valoración
 * y distancia entre comunas.
 *
 * Vive fuera de los componentes visuales a propósito, para que las reglas de
 * "qué se muestra cuando el dato no existe" estén en un solo lugar.
 *
 * REGLA TRANSVERSAL: si un dato no existe todavía se muestra "N.A."
 * (No Aplica / Aún no disponible). Nunca se inventa un número ni un nivel.
 */

import { getComunaCoords } from '../data/comunas-coords';
import { haversineKm } from '../services/matches';

/** Valores válidos de `clubs.modalidad` (ver migración 29). */
export const MODALIDADES = {
  FUTBOL_7: 'futbol7',
  FUTBOL_11: 'futbol11',
  AMBOS: 'ambos',
};

/** Opciones para los selectores de crear/editar club. */
export const OPCIONES_MODALIDAD = [
  { value: MODALIDADES.FUTBOL_7, label: 'Fútbol 7' },
  { value: MODALIDADES.FUTBOL_11, label: 'Fútbol 11' },
  { value: MODALIDADES.AMBOS, label: 'Fútbol 7 y Fútbol 11' },
];

/** `true` si el valor es una modalidad conocida (para validar formularios). */
export function esModalidadValida(valor) {
  return Object.values(MODALIDADES).includes(valor);
}

/**
 * Etiquetas de modalidad para el banner del club (MAYÚSCULAS).
 * Devuelve un array porque "ambos" se muestra como DOS chips.
 * Sin modalidad → ['FÚTBOL N.A.'].
 */
export function modalidadBadges(modalidad) {
  if (modalidad === MODALIDADES.FUTBOL_7) return ['FÚTBOL 7'];
  if (modalidad === MODALIDADES.FUTBOL_11) return ['FÚTBOL 11'];
  if (modalidad === MODALIDADES.AMBOS) return ['FÚTBOL 7', 'FÚTBOL 11'];
  return ['FÚTBOL N.A.'];
}

/**
 * Modalidad en línea, para la meta de las tarjetas de rival.
 * Ej: 'Fútbol 7' · 'Fútbol 11' · 'Fútbol 7 y Fútbol 11' · 'Fútbol N.A.'
 */
export function modalidadInline(modalidad) {
  if (modalidad === MODALIDADES.FUTBOL_7) return 'Fútbol 7';
  if (modalidad === MODALIDADES.FUTBOL_11) return 'Fútbol 11';
  if (modalidad === MODALIDADES.AMBOS) return 'Fútbol 7 y Fútbol 11';
  return 'Fútbol N.A.';
}

/**
 * Nivel del club para el banner. Hoy NO existe cálculo de nivel en la BD,
 * así que siempre resuelve a 'NIVEL N.A.' salvo que llegue un nivel real.
 */
export function nivelBadge(nivel) {
  if (!nivel) return 'NIVEL N.A.';
  return `NIVEL ${String(nivel).toUpperCase()}`;
}

/** Nivel en línea para tarjetas de rival: 'Nivel B' | 'Nivel N.A.'. */
export function nivelInline(nivel) {
  if (!nivel) return 'Nivel N.A.';
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
 *  3. null → la UI muestra 'Distancia N.A.'.
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
 * @returns {string} 'Distancia N.A.' si km es null/undefined.
 */
export function formatDistanciaKm(km) {
  if (km === null || km === undefined || Number.isNaN(Number(km))) {
    return 'Distancia N.A.';
  }
  const n = Number(km);
  // Bajo 100 m no tiene sentido mostrar decimales de km.
  if (n < 0.1) return 'menos de 0,1 km';
  return `${n.toFixed(1).replace('.', ',')} km`;
}

/**
 * Línea de meta completa de una tarjeta de rival.
 * Ej: '2,4 km · Fútbol 7' | 'Distancia N.A. · Fútbol N.A.'
 */
export function metaRival({ distanciaKm, modalidad }) {
  return `${formatDistanciaKm(distanciaKm)} · ${modalidadInline(modalidad)}`;
}
