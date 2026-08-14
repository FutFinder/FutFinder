import { supabase, isSupabaseConfigured } from './supabase';
import { buildCambioPendienteQuery, buildCambiosDelPartidoQuery } from '../utils/cambioQuery';
import {
  argumentosProponer,
  argumentosResponder,
  comoResultadoCambio,
  esFaltaDeEsquema,
  FALTA_MIGRACION,
} from '../utils/cambioRpc';

/**
 * Cambios negociados de un partido entre clubes (migración 46).
 *
 * TODO LO QUE ESCRIBE PASA POR UNA RPC. `club_match_changes` no tiene ninguna
 * política de escritura ni privilegio de `insert`/`update`/`delete` para
 * `authenticated`: un `from('club_match_changes').insert(...)` no fallaría en
 * la interfaz, fallaría en el servidor. Acá sólo se llama, se traduce el error
 * y se devuelve el `{ data, error }` de siempre.
 *
 * LAS REGLAS SON DEL SERVIDOR. El plazo de 2 horas se calcula con el `now()`
 * de PostgreSQL, quién puede responder sale de `club_members` en vivo, y el
 * partido no se toca hasta que alguien acepta. Lo que hay en
 * `utils/cambioPartido.js` es un espejo para no ofrecer un botón que el
 * servidor va a rechazar, nunca la autoridad.
 *
 * Los argumentos de las RPC y la lectura de su respuesta viven en
 * `utils/cambioRpc.js`, donde sí se pueden probar: este archivo importa el
 * cliente de Supabase y con él media aplicación.
 */

function traducirError(error, etiqueta) {
  console.error(`[FutFinder] ${etiqueta}:`, error);
  if (esFaltaDeEsquema(error)) return FALTA_MIGRACION;
  return { message: error.message || 'No se pudo completar la acción.' };
}

/**
 * Pide un cambio del partido. NO lo aplica.
 *
 * `campos` sale de `construirCampos()` y trae sólo lo que de verdad cambia.
 * `clientToken` hace la llamada idempotente: dos pulsaciones seguidas
 * devuelven la MISMA solicitud (`already: true`) en vez de abrir dos
 * negociaciones sobre el mismo partido.
 */
export async function proponerCambioPartido(matchId, campos, clientToken = null) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  if (!matchId) return { data: null, error: { message: 'Falta el partido' } };
  if (!campos || Object.keys(campos).length === 0) {
    return { data: null, error: { message: 'Elige al menos un dato que quieras cambiar.' } };
  }

  const { data, error } = await supabase.rpc(
    'proponer_cambio_partido',
    argumentosProponer(matchId, campos, clientToken)
  );
  return comoResultadoCambio(data, error, 'proponerCambioPartido');
}

/**
 * Acepta o rechaza la solicitud. Sólo un administrador del club CONTRARIO.
 *
 * Aceptar aplica el cambio al partido y avisa a los inscritos; rechazar deja
 * el partido exactamente como estaba. El motivo del rechazo es opcional: la
 * pantalla no lo exige, porque obligarlo sólo consigue motivos escritos para
 * poder pulsar el botón.
 *
 * La pantalla esconde el botón cuando no corresponde, pero esconderlo no es la
 * protección: el servidor comprueba las tres condiciones (administrador del
 * otro club, no pertenecer al club que pidió el cambio, y no ser quien lo
 * pidió).
 */
export async function responderCambioPartido(changeId, aceptar, motivo = null) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  if (!changeId) return { data: null, error: { message: 'Falta la solicitud' } };

  const { data, error } = await supabase.rpc(
    'responder_cambio_partido',
    argumentosResponder(changeId, aceptar, motivo)
  );
  return comoResultadoCambio(data, error, 'responderCambioPartido');
}

/**
 * La solicitud que está esperando respuesta, o `null` si no hay ninguna.
 *
 * `data: null` con `error: null` es «no hay ninguna pendiente». `data: null`
 * con error es «no se pudo saber», y son cosas distintas que tienen que llegar
 * distintas a la pantalla: traducir un fallo de carga a «no hay nada
 * pendiente» es exactamente lo que hizo que la nómina de U3 mostrara un
 * partido vacío y coherente que no era verdad.
 */
export async function getCambioPendiente(matchId) {
  if (!isSupabaseConfigured || !matchId) return { data: null, error: null };

  const { data, error } = await buildCambioPendienteQuery(supabase, matchId);
  if (error) return { data: null, error: traducirError(error, 'getCambioPendiente') };
  return { data: data || null, error: null };
}

/**
 * El historial de solicitudes del partido, la más reciente primero.
 *
 * Acá sí, `data: []` es «nunca se pidió un cambio» y `data: null` es «no se
 * pudo cargar».
 */
export async function getCambiosDelPartido(matchId) {
  if (!isSupabaseConfigured || !matchId) return { data: [], error: null };

  const { data, error } = await buildCambiosDelPartidoQuery(supabase, matchId);
  if (error) return { data: null, error: traducirError(error, 'getCambiosDelPartido') };
  return { data: data || [], error: null };
}
