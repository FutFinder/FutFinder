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
  FUTBOL_5: 'futbol5',
  FUTBOL_7: 'futbol7',
  FUTBOL_11: 'futbol11',
  AMBOS: 'ambos',
};

/**
 * Opciones para los selectores de crear/editar club. Fútbol 5 llegó con la
 * migración 195; «ambos» sigue siendo 7 y 11, que es lo que guardan los
 * clubes que ya lo eligieron.
 */
export const OPCIONES_MODALIDAD = [
  { value: MODALIDADES.FUTBOL_5, label: 'Fútbol 5' },
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
 * Sin modalidad → `[]`, y no se dibuja ninguno: uno que dice «FÚTBOL N.A.»
 * ocupa el mismo sitio sin contar nada.
 */
export function modalidadBadges(modalidad) {
  if (modalidad === MODALIDADES.FUTBOL_5) return ['FÚTBOL 5'];
  if (modalidad === MODALIDADES.FUTBOL_7) return ['FÚTBOL 7'];
  if (modalidad === MODALIDADES.FUTBOL_11) return ['FÚTBOL 11'];
  if (modalidad === MODALIDADES.AMBOS) return ['FÚTBOL 7', 'FÚTBOL 11'];
  return [];
}

/**
 * Modalidad en línea, para la meta de las tarjetas.
 * Ej: 'Fútbol 5' · 'Fútbol 7' · 'Fútbol 7 y Fútbol 11'.
 * Sin modalidad declarada devuelve `null`: quien llama la omite.
 */
export function modalidadInline(modalidad) {
  const opcion = OPCIONES_MODALIDAD.find((o) => o.value === modalidad);
  return opcion ? opcion.label : null;
}
