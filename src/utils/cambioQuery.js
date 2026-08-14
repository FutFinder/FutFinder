/**
 * Construcción pura de la consulta de solicitudes de cambio de un partido
 * entre clubes (`club_match_changes`, migración 46).
 *
 * Vive acá, sin importar nada de Supabase, por la misma razón que
 * `nominaQuery.js`: así se puede probar contra el esquema versionado que TODAS
 * las columnas que se piden existen de verdad.
 *
 * ESA PRUEBA NO ES DECORATIVA. La nómina llegó a producción pidiendo
 * `profiles.nombre`, una columna que no existe en ninguna migración. PostgREST
 * rechaza la consulta ENTERA con 400 y `42703`, así que no se perdía un dato:
 * se perdía la pantalla. Un embed inventado no degrada, tumba.
 *
 * QUIÉN PUEDE LEER ESTO NO SE DECIDE ACÁ. La RLS de la 46 sólo deja ver las
 * solicitudes de los partidos de los clubes a los que uno pertenece; a un
 * externo le devuelve cero filas. No hay nada que filtrar en el cliente.
 */

/** Columnas de `club_match_changes` que necesita la interfaz. */
export const CAMBIO_COLUMNS = [
  'id',
  'match_id',
  'challenge_id',
  'club_proponente_id',
  'propuesto_por',
  // Lo propuesto y lo que estaba vigente al pedirlo. Los dos, porque el
  // partido puede haberse movido desde entonces y el «de X a Y» tiene que
  // seguir siendo el del momento en que se pidió.
  'campos',
  'valores_anteriores',
  'estado',
  'respondida_por',
  'respondida_at',
  'created_at',
];

/** El `select` completo, tal cual viaja a PostgREST. */
export const CAMBIO_SELECT = CAMBIO_COLUMNS.join(', ');

/** Estados en los que una solicitud sigue esperando respuesta. */
export const ESTADO_PENDIENTE = 'pendiente';

/**
 * La solicitud que está esperando respuesta en este partido, o ninguna.
 *
 * Se pide UNA porque el índice único parcial de la 46 garantiza que no hay
 * dos: `maybeSingle()` acá no es optimismo, es el reflejo de una restricción
 * de la base.
 */
export function buildCambioPendienteQuery(supabase, matchId) {
  return supabase
    .from('club_match_changes')
    .select(CAMBIO_SELECT)
    .eq('match_id', matchId)
    .eq('estado', ESTADO_PENDIENTE)
    .maybeSingle();
}

/**
 * El historial de solicitudes del partido, la más reciente primero.
 *
 * Sirve para explicar por qué el partido está como está: quién pidió qué y
 * quién lo respondió.
 */
export function buildCambiosDelPartidoQuery(supabase, matchId, limite = 20) {
  return supabase
    .from('club_match_changes')
    .select(CAMBIO_SELECT)
    .eq('match_id', matchId)
    .order('created_at', { ascending: false })
    .limit(limite);
}
