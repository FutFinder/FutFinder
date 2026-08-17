import { supabase, isSupabaseConfigured } from './supabase';
import {
  argumentosProponerResultado,
  argumentosConfirmarResultado,
  comoResultadoResultado,
  esFaltaDeEsquema,
} from '../utils/resultadoRpc';

/**
 * Resultado del encuentro, asistencia real y récord V/E/D (migración 48).
 *
 * TODO LO QUE ESCRIBE PASA POR UNA RPC. `club_match_results` no tiene ninguna
 * política de escritura ni privilegio de `insert`/`update`/`delete` para
 * `authenticated`: un `from('club_match_results').insert(...)` no fallaría en
 * la interfaz, fallaría en el servidor con «permission denied».
 *
 * LAS REGLAS SON DEL SERVIDOR. Quién puede proponer, quién puede confirmar y
 * en qué estado tiene que estar el desafío se vuelven a comprobar en
 * `proponer_resultado()` y `confirmar_resultado()`. Lo que hay en
 * `utils/resultadoRpc.js` es un espejo para no ofrecer un botón que el
 * servidor va a rechazar, nunca la autoridad.
 */

/** Columnas que necesita la pantalla del resultado. */
const COLUMNAS_RESULTADO =
  'id, challenge_id, match_id, club_local_id, club_visitante_id, goles_local, goles_visitante, club_proponente_id, propuesto_por, confirmado_por, confirmado_at, estado, created_at';

/**
 * Propone el marcador final y marca la asistencia real de los inscritos.
 *
 * `asistencia` es la lista de ids de jugadores que SÍ llegaron; el resto de
 * los inscritos queda `no_asistio`. Pasar `undefined`/`null` no toca la
 * asistencia — útil al reproponer un resultado tras un rechazo, cuando ya
 * quedó marcada la primera vez.
 *
 * Devuelve `{ data, error }`. En `data` viajan `resultId` y `estado`
 * (`'propuesto'`, o `'confirmado'` con `already: true` si el desafío ya
 * tenía un resultado cerrado).
 */
export async function proponerResultado(challengeId, golesLocal, golesVisitante, asistencia) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  if (!challengeId) return { data: null, error: { message: 'Falta el desafío' } };

  const { data, error } = await supabase.rpc(
    'proponer_resultado',
    argumentosProponerResultado(challengeId, golesLocal, golesVisitante, asistencia)
  );
  return comoResultadoResultado(data, error, 'proponerResultado');
}

/**
 * Confirma o rechaza el resultado propuesto. Sólo un administrador del club
 * CONTRARIO al proponente.
 *
 * Aceptar cierra el desafío (`finalizado`) y publica el partido con el
 * marcador; rechazar lo deja en `resultado_en_disputa` sin tocar ningún
 * récord, y el proponente puede volver a proponer.
 *
 * La pantalla esconde el botón cuando no corresponde, pero esconderlo no es
 * la protección: el servidor comprueba las tres condiciones (no ser quien
 * propuso, administrar el club contrario, y no pertenecer al proponente en
 * ningún rol).
 */
export async function confirmarResultado(resultId, aceptar) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  if (!resultId) return { data: null, error: { message: 'Falta el resultado' } };

  const { data, error } = await supabase.rpc(
    'confirmar_resultado',
    argumentosConfirmarResultado(resultId, aceptar)
  );
  return comoResultadoResultado(data, error, 'confirmarResultado');
}

/**
 * El resultado activo del desafío (`propuesto` o `confirmado`), o `null` si
 * no hay ninguno. Un resultado `rechazado` no cuenta como activo: el índice
 * único de la migración 48 tampoco lo cuenta, así que un desafío puede tener
 * varios rechazados y como mucho un activo a la vez.
 *
 * `data: null` con `error: null` es «no hay ninguno». `data: null` con error
 * es «no se pudo saber», y son cosas distintas: confundirlas escondería el
 * botón «Proponer resultado» sobre un desafío que en realidad sí puede
 * recibir uno.
 */
export async function getResultadoActivo(challengeId) {
  if (!isSupabaseConfigured || !challengeId) return { data: null, error: null };

  const { data, error } = await supabase
    .from('club_match_results')
    .select(COLUMNAS_RESULTADO)
    .eq('challenge_id', challengeId)
    .neq('estado', 'rechazado')
    .maybeSingle();

  if (error) {
    console.error('[FutFinder] getResultadoActivo:', error.code || '', error.message || error);
    if (esFaltaDeEsquema(error)) return { data: null, error: null };
    return { data: null, error };
  }
  return { data: data || null, error: null };
}

/**
 * EL RÉCORD DEL CLUB NO SE PIDE ACÁ.
 *
 * `club_record()` sigue siendo la fuente de V/E/D, pero la migración 49 la
 * envolvió en `club_estadisticas()`, que agrega PJ, GF y GC sin repetir su
 * `case`. Quien lo necesita llama a `getClubEstadisticas()` en
 * `services/clubMatches.js`, junto al historial que muestra esos mismos
 * partidos: dos funciones de cliente para el mismo dato terminan
 * discrepando.
 */
