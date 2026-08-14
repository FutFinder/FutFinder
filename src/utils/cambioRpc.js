/**
 * Cómo se llaman las dos RPC de cambios y cómo se lee lo que devuelven.
 *
 * Vive fuera de `services/clubMatchChanges.js` por la misma razón que
 * `nominaQuery.js` vive fuera de `clubRoster.js`: el servicio importa el
 * cliente de Supabase y no se puede cargar en una prueba, mientras que ESTO
 * —los nombres de los argumentos y la traducción de la respuesta— es
 * exactamente lo que se rompe en silencio.
 *
 * UN NOMBRE DE ARGUMENTO MAL PUESTO NO DEGRADA, TUMBA. PostgREST no contesta
 * «te faltó `p_motivo`»: contesta 404 «function not found», porque para él una
 * función con otros argumentos es otra función. La prueba contrasta cada
 * nombre contra la firma real de la migración 46.
 */

/** `true` si el error significa "esa función/columna todavía no existe". */
export function esFaltaDeEsquema(error) {
  if (!error) return false;
  if (['42P01', '42883', 'PGRST202', 'PGRST205', '42703'].includes(error.code)) return true;
  return /does not exist|could not find/i.test(error.message || '');
}

export const FALTA_MIGRACION = {
  message:
    'Los cambios del partido necesitan una migración que todavía no está en Supabase. Avisa al equipo antes de volver a intentarlo.',
};

/** Argumentos de `proponer_cambio_partido(p_match_id, p_campos, p_client_token)`. */
export function argumentosProponer(matchId, campos, clientToken = null) {
  return {
    p_match_id: matchId,
    p_campos: campos,
    p_client_token: clientToken || null,
  };
}

/**
 * Argumentos de `responder_cambio_partido(p_change_id, p_aceptar, p_motivo)`.
 *
 * `p_aceptar` se fuerza a booleano: la firma lo declara `boolean` y mandar 1 o
 * la cadena 'false' es un error de casteo del lado del servidor, no un valor
 * que PostgreSQL vaya a interpretar con buena voluntad.
 *
 * El motivo es OPCIONAL y sólo tiene sentido al rechazar. Se manda ya
 * recortado y en null cuando está vacío: el servidor lo vuelve a limpiar, pero
 * mandar tres espacios y que el chat diga «rechazó el cambio: «   »» sería un
 * error que nace acá.
 */
export function argumentosResponder(changeId, aceptar, motivo = null) {
  const acepta = !!aceptar;
  const texto = typeof motivo === 'string' ? motivo.trim() : '';
  return {
    p_change_id: changeId,
    p_aceptar: acepta,
    p_motivo: !acepta && texto ? texto : null,
  };
}

/**
 * Convierte la respuesta de la RPC al `{ data, error }` del resto de los
 * servicios.
 *
 * Las RPC de la 46 devuelven `{ ok, reason }` en vez de lanzar: estar fuera de
 * plazo o no ser el club que responde no son errores del sistema, son
 * respuestas, y la pantalla las muestra tal cual. Lo que sí se traduce es la
 * migración ausente, porque «function does not exist» no le dice nada a nadie.
 */
export function comoResultadoCambio(data, error, etiqueta = 'cambioPartido') {
  if (error) {
    console.error(`[FutFinder] ${etiqueta}:`, error);
    if (esFaltaDeEsquema(error)) return { data: null, error: FALTA_MIGRACION };
    return { data: null, error: { message: error.message || 'No se pudo completar la acción.' } };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row && row.ok === false) {
    return { data: null, error: { message: row.reason || 'No se pudo completar la acción.' } };
  }
  return { data: row || null, error: null };
}
