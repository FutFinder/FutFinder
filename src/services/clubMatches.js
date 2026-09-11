import { supabase, isSupabaseConfigured } from './supabase';
import { listPartidosDeClub } from './matches';
import {
  cargarHistorial,
  cargarEstadisticas,
  ESTADISTICAS_VACIAS,
  HISTORIAL_LIMITE,
  HISTORIAL_LIMITE_MAX,
} from '../utils/historialClub';
import { calendarioDePartidos } from '../utils/calendarioClub';

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
 * El calendario de partidos del club: los ya jugados y confirmados, y los
 * programados desde un desafío que la otra parte ya aceptó — combinados y
 * ordenados por fecha. Ver `calendarioDePartidos()` en
 * `utils/calendarioClub.js` para qué entra y qué queda afuera a propósito
 * (un finalizado sin resultado confirmado no aparece en ninguna de las dos
 * listas de origen).
 */
export async function getClubMatchCalendar(clubId) {
  if (!isSupabaseConfigured || !clubId) return { data: [], error: null };

  const [proximosRes, historialRes] = await Promise.all([
    listPartidosDeClub(clubId, { limit: 100 }),
    cargarHistorial(supabase, clubId, { limit: HISTORIAL_LIMITE_MAX }),
  ]);

  if (proximosRes.error || historialRes.error) {
    return { data: [], error: proximosRes.error || historialRes.error };
  }

  return {
    data: calendarioDePartidos({ proximos: proximosRes.data, historial: historialRes.data }, clubId),
    error: null,
  };
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
