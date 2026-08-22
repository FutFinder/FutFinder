/**
 * Vocabulario de la modalidad del club (columna `clubs.modalidad`,
 * migración 29).
 *
 * Está separado de `clubMeta.js` por una razón práctica: `clubMeta`
 * calcula distancias y para eso importa `services/matches`, que arrastra
 * Supabase. Las reglas de «qué modalidad es válida» tienen que poder
 * probarse y reutilizarse sin encender la red, y `utils/clubEdit.js` —que
 * valida el formulario— las necesita.
 *
 * `clubMeta.js` las vuelve a exportar, así que nadie tuvo que cambiar de
 * import por esto.
 */

/** Valores válidos de `clubs.modalidad`. */
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
