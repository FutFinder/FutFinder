import { supabase, isSupabaseConfigured } from './supabase';
import { createSharedChannel } from '../utils/chatMeta';
import { buildNominaQuery } from '../utils/nominaQuery';

/**
 * Inscripción y nómina de un partido entre clubes (migración 45).
 *
 * TODO LO QUE ESCRIBE PASA POR UNA RPC. Desde la migración 44e `attendees` no
 * tiene ninguna política de escritura ni privilegio de `insert`/`update`/
 * `delete` para `authenticated`: un `from('attendees').insert(...)` no fallaría
 * en la interfaz, fallaría en el servidor. Acá sólo se llama, se traduce el
 * error y se devuelve el `{ data, error }` de siempre.
 *
 * LOS CUPOS SON POR CLUB. El servidor cuenta las filas de `attendees` de MI
 * club con la fila del partido bloqueada (`select … for update`), así que dos
 * inscripciones al último cupo se serializan y sólo una entra. La pantalla no
 * hace ninguna cuenta que decida: dibuja la que trae el servidor.
 */

/** `true` si el error significa "esa función/columna todavía no existe". */
function esFaltaDeEsquema(error) {
  if (!error) return false;
  if (['42P01', '42883', 'PGRST202', 'PGRST205', '42703'].includes(error.code)) return true;
  return /does not exist|could not find/i.test(error.message || '');
}

const FALTA_MIGRACION = {
  message:
    'La inscripción por club necesita una migración que todavía no está en Supabase. Avisa al equipo antes de volver a intentarlo.',
};

function traducirError(error, etiqueta) {
  console.error(`[FutFinder] ${etiqueta}:`, error);
  if (esFaltaDeEsquema(error)) return FALTA_MIGRACION;
  return { message: error.message || 'No se pudo completar la acción.' };
}

/**
 * Las RPC de la 45 devuelven `{ ok, reason }` en vez de lanzar: un cupo lleno
 * o una postulación duplicada no son errores del sistema, son respuestas. Esto
 * lo convierte al `{ data, error }` que espera el resto de los servicios, de
 * modo que la pantalla tenga un solo camino de error que dibujar.
 */
function comoResultado(data, error, etiqueta) {
  if (error) return { data: null, error: traducirError(error, etiqueta) };
  const row = Array.isArray(data) ? data[0] : data;
  if (row && row.ok === false) {
    return { data: null, error: { message: row.reason || 'No se pudo completar la acción.' } };
  }
  return { data: row || null, error: null };
}

/**
 * La nómina completa del partido, los dos clubes.
 *
 * Las columnas se arman en `buildNominaQuery` para poder contrastarlas con el
 * esquema versionado en una prueba. Ahí está el porqué.
 *
 * NO DEVUELVE `[]` CUANDO FALLA, Y ESO ES EL ARREGLO. Antes, cualquier error
 * que oliera a esquema se traducía a «nómina vacía» y se seguía dibujando: la
 * consulta se caía con 400 por pedir `profiles.nombre` —una columna que no
 * existe— y la pantalla mostraba «0 de 7», las dos listas en blanco y el botón
 * «Inscribirme» a gente que ya estaba inscrita. Todo consistente, todo falso.
 * Una lista vacía y una lista que no se pudo cargar son cosas distintas y
 * tienen que llegar distintas a la pantalla: `data: []` es «no hay nadie»,
 * `data: null` es «no sé quién hay».
 */
export async function getNominaPartido(matchId) {
  if (!isSupabaseConfigured || !matchId) return { data: [], error: null };

  const { data, error } = await buildNominaQuery(supabase, matchId);

  if (error) return { data: null, error: traducirError(error, 'getNominaPartido') };
  return { data: data || [], error: null };
}

/**
 * Me inscribo, o postulo si el partido es de selección por administrador.
 *
 * QUÉ DEVUELVE IMPORTA: `estado` es `'inscrito'` o `'pendiente'`, y la
 * pantalla tiene que decir cuál de las dos cosas pasó. Volver a pulsar
 * devuelve `already: true` con el estado que ya había, sin crear una segunda
 * fila ni cambiar nada.
 */
export async function inscribirmeEnPartidoDeClub(matchId) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  if (!matchId) return { data: null, error: { message: 'Falta el partido' } };

  const { data, error } = await supabase.rpc('join_club_match', { p_match_id: matchId });
  return comoResultado(data, error, 'inscribirmeEnPartidoDeClub');
}

/**
 * Me salgo del partido, o retiro mi postulación.
 *
 * Es la misma RPC para las dos cosas porque en el servidor es la misma
 * operación: se borra mi fila y se devuelve el cupo sólo si lo estaba
 * ocupando. Una postulación pendiente nunca reservó ninguno.
 */
export async function salirDePartidoDeClub(matchId) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  if (!matchId) return { data: null, error: { message: 'Falta el partido' } };

  const { data, error } = await supabase.rpc('leave_club_match', { p_match_id: matchId });
  return comoResultado(data, error, 'salirDePartidoDeClub');
}

/**
 * Confirmo o rechazo a un jugador de MI club.
 *
 * El servidor exige ser administrador del club DEL JUGADOR —no del rival— y
 * no deja confirmarse a uno mismo. La pantalla esconde el botón cuando no
 * corresponde, pero esconderlo no es la protección.
 */
export async function confirmarNominaClub(matchId, playerId, aprobar) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  if (!matchId || !playerId) return { data: null, error: { message: 'Falta el jugador' } };

  const { data, error } = await supabase.rpc('confirmar_nomina_club', {
    p_match_id: matchId,
    p_player_id: playerId,
    p_aprobar: !!aprobar,
  });
  return comoResultado(data, error, 'confirmarNominaClub');
}

/**
 * Un canal compartido por partido, no uno por pantalla.
 *
 * `supabase.channel(topic)` REUTILIZA el canal que ya existe con ese nombre, y
 * añadirle un segundo `postgres_changes` después de `subscribe()` revienta con
 * «cannot add postgres_changes callbacks … after subscribe()». Es el mismo
 * fallo que en su día obligó a escribir `createSharedChannel`, y acá vuelve a
 * aparecer en cuanto el detalle del partido y la nómina están montados a la
 * vez. Con esto se abre UN canal por partido y se reparte a quien escuche.
 */
const canalesPorPartido = new Map();

function canalDeNomina(matchId) {
  let compartido = canalesPorPartido.get(matchId);
  if (compartido) return compartido;

  compartido = createSharedChannel({
    open: ({ emit, emitStatus }) => {
      const canal = supabase
        .channel(`nomina:${matchId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'attendees', filter: `id_partido=eq.${matchId}` },
          (payload) => emit(payload)
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'attendees', filter: `id_partido=eq.${matchId}` },
          (payload) => emit(payload)
        )
        .subscribe(emitStatus);

      // Postgres Changes no permite filtrar eventos DELETE. Escucharlos sin
      // filtro expondría a este canal las bajas de todas las nóminas. Un sondeo
      // corto es una reserva segura: cubre bajas y reconexiones sin pedirle al
      // usuario que recargue, mientras INSERT/UPDATE siguen llegando al tiro.
      const sondeo = setInterval(() => emit({ eventType: 'POLL' }), 15_000);
      return { canal, sondeo };
    },
    close: ({ canal, sondeo }) => {
      canalesPorPartido.delete(matchId);
      clearInterval(sondeo);
      try {
        supabase.removeChannel(canal);
      } catch (e) {
        console.warn('[FutFinder] canalDeNomina (baja):', e?.message || e);
      }
    },
  });

  canalesPorPartido.set(matchId, compartido);
  return compartido;
}

/**
 * Avisa cuando la nómina de este partido cambia, sin recargar a mano.
 *
 * Escucha INSERT/UPDATE de `attendees` filtrado por partido y mantiene un
 * sondeo de respaldo para DELETE/reconexiones: cualquier inscripción, baja o
 * confirmación —venga de quien venga— termina disparando `onCambio` sin gesto
 * manual. Devuelve la función para darse de baja, y la pantalla TIENE que
 * llamarla al desmontarse: es la que cierra canal y sondeo cuando se va el
 * último suscriptor.
 *
 * No se intenta aplicar el cambio fila por fila: llega un evento y se vuelve a
 * pedir la nómina entera. Es una consulta corta, y reconstruir el estado desde
 * el payload de Realtime es exactamente donde se cuelan las divergencias entre
 * lo que se ve y lo que hay.
 */
export function suscribirseANomina(matchId, onCambio) {
  if (!isSupabaseConfigured || !matchId || typeof onCambio !== 'function') return () => {};
  return canalDeNomina(matchId).subscribe(() => onCambio());
}
