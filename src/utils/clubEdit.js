/**
 * Lógica pura de «Editar club»: qué campos viajan a `clubs`, cómo se
 * validan y quién puede mandarlos.
 *
 * Vive fuera del servicio y de la pantalla porque son las reglas, no la
 * red: acá se prueba sin Supabase que un HEX no llega nunca a la columna
 * `tema`, que un campo que el formulario no tocó no se manda —`undefined`
 * es «no lo edité» y `null` es «lo borré»— y que el slug se recalcula con
 * el nombre.
 *
 * ESTO ES UN ESPEJO, NO LA AUTORIDAD. Quien de verdad decide es el
 * servidor: la policy `clubs_update` (migración 20) limita la escritura a
 * los administradores del club y el CHECK de `clubs.tema` (migración 53)
 * rechaza cualquier valor fuera de las cuatro claves. Esconder el
 * formulario es comodidad para quien mira; la garantía está en la base de
 * datos.
 */

import { esModalidadValida } from './clubModalidad.js';
import { esTemaClubValido } from '../theme/clubThemes.js';

/** Largo del nombre aceptado por el CHECK de `clubs.nombre` (migración 11). */
export const NOMBRE_MIN = 3;
export const NOMBRE_MAX = 40;

/**
 * "Atlético La Reina" → "atletico-la-reina" (URL pública futura).
 * El rango `̀-ͯ` son las marcas diacríticas que deja `NFD`.
 */
export function slugClub(nombre) {
  return String(nombre ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Arma el `patch` que se manda a `clubs.update()`.
 *
 * Solo entran los campos presentes en la entrada: un formulario que no
 * cargó la comuna no puede borrarla sin querer.
 *
 * @returns {{ patch: object|null, error: {message: string}|null }}
 */
export function buildClubPatch({
  nombre,
  descripcion,
  region,
  comuna,
  modalidad,
  tema,
} = {}) {
  const patch = {};

  if (nombre !== undefined) {
    const limpio = String(nombre ?? '').trim();
    if (limpio.length < NOMBRE_MIN || limpio.length > NOMBRE_MAX) {
      return {
        patch: null,
        error: {
          message: `El nombre debe tener entre ${NOMBRE_MIN} y ${NOMBRE_MAX} caracteres`,
        },
      };
    }
    patch.nombre = limpio;
    // El slug acompaña siempre al nombre: si no, la URL pública futura
    // seguiría apuntando al nombre viejo.
    patch.slug = slugClub(limpio);
    // Un nombre de sólo símbolos/emoji (pasa el mínimo de 3 caracteres,
    // pero `slugClub` sólo deja `a-z0-9\s-`) produce un slug vacío. Como
    // `clubs.slug` tiene un índice único, el SEGUNDO club así choca contra
    // el primero y el servidor devuelve 23505 — un «ya existe un club con
    // ese nombre» que no es cierto: lo que choca es el slug vacío, no el
    // nombre. Se corta acá, con un mensaje que sí explica qué pasa.
    if (!patch.slug) {
      return {
        patch: null,
        error: { message: 'El nombre necesita al menos una letra o un número' },
      };
    }
  }

  if (descripcion !== undefined) {
    patch.descripcion = String(descripcion ?? '').trim() || null;
  }

  if (region !== undefined) patch.region = region;
  if (comuna !== undefined) patch.comuna = comuna;

  if (modalidad !== undefined) {
    if (modalidad != null && !esModalidadValida(modalidad)) {
      return { patch: null, error: { message: 'Modalidad no válida' } };
    }
    patch.modalidad = modalidad || null;
  }

  if (tema !== undefined) {
    // Sin `|| null` a propósito: el tema no se puede vaciar. La columna es
    // NOT NULL con default 'green', así que «sin tema» ya es verde y no hay
    // nada que borrar.
    if (!esTemaClubValido(tema)) {
      return { patch: null, error: { message: 'Tema del club no válido' } };
    }
    patch.tema = tema;
  }

  return { patch, error: null };
}

/**
 * ¿Puedo editar este club?
 *
 * `clubesAdmin` son los clubes donde puedo editar: los que administro MÁS
 * los que me concedieron `editClub` (migración 119) — ver
 * `getMisClubesConPermiso('editClub')`. No el primero: comparar contra el
 * primero es el fallo que ya se corrigió en la bandeja de desafíos.
 *
 * `null` no es `[]`: una lista vacía es «no calificar en ninguno» y `null`
 * es «no se pudo averiguar». Los dos niegan el permiso —negarlo es lo
 * seguro— pero la pantalla los cuenta distinto, ver `getEditClubStatus()`.
 */
export function puedeEditarClub({ clubesAdmin, clubId } = {}) {
  if (!Array.isArray(clubesAdmin)) return false;
  if (!clubId) return false;
  return clubesAdmin.includes(clubId);
}

/**
 * Qué vista mostrar en «Editar club»:
 *   'loading' → todavía se comprueba el permiso
 *   'error'   → no se pudo comprobar (red caída, sesión rara)
 *   'denied'  → se comprobó y no soy administrador de este club
 *   'ready'   → formulario
 *
 * Un formulario abierto mientras no se sabe el permiso invita a escribir
 * cambios que el servidor va a rechazar después.
 */
export function getEditClubStatus({ loading, clubesAdmin, clubId } = {}) {
  if (loading) return 'loading';
  if (!Array.isArray(clubesAdmin)) return 'error';
  return puedeEditarClub({ clubesAdmin, clubId }) ? 'ready' : 'denied';
}
