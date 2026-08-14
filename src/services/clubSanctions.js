import { supabase, isSupabaseConfigured } from './supabase';
import {
  COLUMNAS_SANCION,
  argumentosCancelarEncuentro,
  comoResultadoCancelacion,
  esFaltaDeEsquemaSanciones,
  sancionVigente,
} from '../utils/cancelacionEncuentro';

/**
 * Cancelación del encuentro y sanciones de club (migración 47).
 *
 * TODO LO QUE ESCRIBE PASA POR LA RPC. `club_sanctions` no tiene ninguna
 * política de escritura ni privilegio de `insert`/`update`/`delete` para
 * `authenticated`: un `from('club_sanctions').insert(...)` no fallaría en la
 * interfaz, fallaría en el servidor con «permission denied».
 *
 * LAS REGLAS SON DEL SERVIDOR. El motivo obligatorio, el corte de las 2 horas
 * con el `now()` de PostgreSQL y quién puede cancelar se vuelven a comprobar en
 * `cancelar_encuentro_club`. Lo que hay en `utils/cancelacionEncuentro.js` es
 * un espejo para no ofrecer un botón que el servidor va a rechazar y para
 * advertir de la sanción antes de pulsarlo, nunca la autoridad.
 *
 * LA LECTURA ES SÓLO DE LO PROPIO. La RLS de `club_sanctions` muestra las
 * sanciones del club de quien consulta y ninguna más: que un rival esté
 * sancionado se sabe al intentar desafiarlo, con el mensaje de la RPC.
 */

/**
 * Cancela el encuentro de un desafío. Unilateral: no espera al rival.
 *
 * `motivo` es obligatorio y lo valida antes `validarMotivoCancelacion()`; acá
 * se manda igual aunque venga vacío para que sea el servidor quien lo rechace
 * con su propio mensaje, que es el que la pantalla muestra.
 *
 * Devuelve `{ data, error }`. En `data` viajan `sanciona`, `sancionId` y
 * `finAt`: cancelar dentro de las 2 horas previas no falla, sanciona.
 */
export async function cancelarEncuentroClub(challengeId, motivo) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  if (!challengeId) return { data: null, error: { message: 'Falta el desafío' } };

  const { data, error } = await supabase.rpc(
    'cancelar_encuentro_club',
    argumentosCancelarEncuentro(challengeId, motivo)
  );
  return comoResultadoCancelacion(data, error, 'cancelarEncuentroClub');
}

/**
 * Las sanciones de MIS clubes, la más reciente primero.
 *
 * `data: []` es «este club no tiene sanciones» y `data: null` es «no se pudo
 * saber»: son cosas distintas y tienen que llegar distintas a la pantalla.
 * Traducir un fallo de carga a «no hay sanción» dibujaría el botón de crear
 * desafío a un club que sí está bloqueado, y el error saldría después, del
 * servidor, sin que nadie entienda por qué.
 *
 * Sin la migración 47 la tabla no existe: eso NO es un error de la pantalla
 * —el hilo se dibuja igual, sólo que sin la advertencia—, así que se devuelve
 * la lista vacía.
 */
export async function listSancionesDeClubes(clubIds = []) {
  const ids = (Array.isArray(clubIds) ? clubIds : []).filter(Boolean);
  if (!isSupabaseConfigured || ids.length === 0) return { data: [], error: null };

  const { data, error } = await supabase
    .from('club_sanctions')
    .select(COLUMNAS_SANCION)
    .in('club_id', ids)
    .order('created_at', { ascending: false });

  if (error) {
    if (esFaltaDeEsquemaSanciones(error)) return { data: [], error: null };
    console.error('[FutFinder] listSancionesDeClubes:', error);
    return { data: null, error: { message: error.message || 'No se pudieron leer las sanciones.' } };
  }
  return { data: data || [], error: null };
}

/**
 * La sanción que está bloqueando a alguno de mis clubes ahora mismo, o `null`.
 *
 * Es lo que `getChallengeCta` y `getChallengeBlockReason` esperan en su clave
 * `sancion`: con ella la pantalla dice «Club sancionado» y hasta cuándo, en vez
 * de ofrecer un botón que el servidor va a rechazar.
 */
export async function getSancionVigente(clubIds = [], ahora = new Date()) {
  const { data, error } = await listSancionesDeClubes(clubIds);
  if (error) return { data: null, error };
  return { data: sancionVigente(data, ahora), error: null };
}
