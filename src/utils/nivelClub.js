/**
 * Nivel del club (migración 199): lo elige el propio club y lo puede cambiar
 * desde «Editar club». Reemplaza al rating en la cabecera y en las tarjetas de
 * rival.
 *
 * Es puro —sin Supabase ni React— para que el formulario, el servicio y las
 * tarjetas lean el MISMO vocabulario, y para probarlo sin red.
 *
 * `null` es «el club no eligió» y NO se dibuja nada: ni un chip vacío ni un
 * «Sin nivel». No es lo mismo que «recreativo» (el mismo criterio de la 156).
 *
 * El nivel de los PARTIDOS (`matches.nivel`) es otro vocabulario, de tres
 * valores, y no vive acá: ver `services/matchRules.js`.
 */

/** De menor a mayor. `barras` es lo que el chip dibuja (1 a 5). */
export const NIVELES_CLUB = Object.freeze([
  Object.freeze({ value: 'recreativo', label: 'Recreativo', desc: 'Se juntan a jugar y pasarlo bien.', barras: 1 }),
  Object.freeze({ value: 'amateur', label: 'Amateur', desc: 'Juegan seguido y quieren ir mejorando.', barras: 2 }),
  Object.freeze({ value: 'intermedio', label: 'Intermedio', desc: 'Equipo estable que busca partidos parejos.', barras: 3 }),
  Object.freeze({ value: 'competitivo', label: 'Competitivo', desc: 'Van por el resultado en cada partido.', barras: 4 }),
  Object.freeze({ value: 'elite', label: 'Élite', desc: 'Máxima exigencia, rivales de su mismo nivel.', barras: 5 }),
]);

const POR_VALOR = new Map(NIVELES_CLUB.map((n) => [n.value, n]));

/** `true` sólo para los cinco valores que acepta el CHECK de `clubs.nivel`. */
export function esNivelClubValido(valor) {
  return typeof valor === 'string' && POR_VALOR.has(valor);
}

/**
 * La definición del nivel, o `null` si el club no eligió o llega un valor
 * desconocido. Un valor que la app no conoce se calla en vez de pintarse
 * crudo: mejor ningún chip que un «PROFESIONAL» sin traducir.
 */
export function nivelDeClub(valor) {
  return POR_VALOR.get(valor) || null;
}

/** Texto del nivel, o `null`. */
export function etiquetaNivel(valor) {
  return nivelDeClub(valor)?.label || null;
}
