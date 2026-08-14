/**
 * Construcción pura de la consulta de la nómina de un partido entre clubes.
 *
 * Vive acá, sin importar nada de Supabase, por la misma razón que
 * `rivalClubsQuery.js` y `searchPlayersQuery.js`: así se puede probar contra el
 * esquema versionado que TODAS las columnas que se piden existen de verdad.
 *
 * ESA PRUEBA NO ES DECORATIVA. La nómina llegó a producción pidiendo
 * `profiles.nombre`, una columna que no existe en ninguna migración. PostgREST
 * rechaza la consulta ENTERA con 400 y `42703` —«column profiles_1.nombre does
 * not exist»—, así que no se perdía un nombre: se perdían las dos listas
 * completas. Un embed inventado no degrada, tumba.
 *
 * El nombre que se muestra sale de `username`, que es el único identificador de
 * persona que `profiles` tiene. No hace falta ninguna columna nueva.
 */

/** Columnas de `attendees` que la pantalla de nómina necesita. */
export const NOMINA_ATTENDEE_COLUMNS = [
  'id',
  'id_jugador',
  'id_partido',
  'estado',
  'club_id',
  // Distingue una inscripción normal de la reserva que un administrador se
  // autorizó al proponer o al aprobar. Sin esto la nómina no puede explicar
  // por qué alguien ya estaba dentro.
  'origen',
  'inscrito_at',
];

/** Columnas de `profiles` que se traen embebidas para pintar cada fila. */
export const NOMINA_PROFILE_COLUMNS = ['id', 'username', 'foto_url', 'trust_score'];

/** El `select` completo, tal cual viaja a PostgREST. */
export const NOMINA_COLUMNS =
  `${NOMINA_ATTENDEE_COLUMNS.join(', ')}, ` +
  `profiles:id_jugador (${NOMINA_PROFILE_COLUMNS.join(', ')})`;

/**
 * Los dos clubes, siempre.
 *
 * Se piden LOS DOS a propósito: la gracia de la pantalla es ver cómo va el
 * rival, y la RLS de la 44d ya decide quién puede mirar — a un externo le
 * devuelve cero filas, así que no hay nada que filtrar acá.
 *
 * @param client   cliente de Supabase (o uno falso, en pruebas)
 * @param matchId  partido cuya nómina se pide
 */
export function buildNominaQuery(client, matchId) {
  return client
    .from('attendees')
    .select(NOMINA_COLUMNS)
    .eq('id_partido', matchId)
    .order('inscrito_at', { ascending: true });
}
