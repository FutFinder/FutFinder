import { supabase, isSupabaseConfigured } from './supabase';
import {
  cargarHistorial,
  cargarEstadisticas,
  ESTADISTICAS_VACIAS,
  HISTORIAL_LIMITE,
} from '../utils/historialClub';

/**
 * Historial de partidos entre clubes y estadísticas del club.
 *
 * DATOS REALES, SIN FIXTURES. Hasta la Tarea 6.1 `matches` no guardaba
 * marcador, así que este módulo traía tres partidos de ejemplo y un récord
 * 1-1-1 coherente con ellos, activos sólo con `__DEV__`. La 48 trajo el
 * resultado confirmado y la 49 el historial completo; los fixtures se
 * eliminaron en la Tarea 6.2 y no queda ningún interruptor que los reviva.
 *
 * NO SE LEE `matches` NI `club_match_results` DIRECTAMENTE. Desde la 44d el
 * partido entre clubes es privado hasta que termina: consultar esas tablas
 * desde el perfil público de un club devolvería cero filas a cualquiera que no
 * sea de la casa. Todo pasa por `historial_club()` y `club_estadisticas()`
 * (migración 49), que publican el marcador confirmado y reservan la hora
 * exacta y la cancha para los integrantes de los dos clubes.
 *
 * LA LÓGICA NO ESTÁ ACÁ. Los argumentos de las RPC, la inversión del marcador
 * y las etiquetas viven en `src/utils/historialClub.js`, que no importa el
 * cliente de Supabase y por eso se puede probar. Este archivo sólo le ata el
 * cliente real.
 */

export { ESTADISTICAS_VACIAS };

/**
 * Los encuentros disputados de un club, del más reciente al más antiguo.
 *
 * Sólo partidos finalizados CON resultado confirmado: uno propuesto, uno
 * rechazado o un partido que se cerró sin que nadie confirmara el marcador no
 * aparecen, porque no son partidos jugados todavía.
 *
 * Forma de cada partido: ver `normalizarPartido()` en `utils/historialClub.js`.
 */
export async function getClubMatchHistory(clubId, { limit = HISTORIAL_LIMITE } = {}) {
  if (!isSupabaseConfigured || !clubId) return { data: [], error: null };
  return cargarHistorial(supabase, clubId, { limit });
}

/**
 * PJ, V, E, D, GF y GC del club, contando sólo resultados confirmados.
 *
 * Las calcula el servidor (`club_estadisticas()`, que a su vez delega V/E/D en
 * `club_record()`) y no el cliente: el historial viaja paginado y sumar los
 * goles de las últimas veinte filas no son los goles del club.
 */
export async function getClubEstadisticas(clubId) {
  if (!isSupabaseConfigured || !clubId) return { data: { ...ESTADISTICAS_VACIAS }, error: null };
  return cargarEstadisticas(supabase, clubId);
}
