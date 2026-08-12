import { supabase, isSupabaseConfigured } from './supabase';
import { propuestaOficialPayload } from './clubChallengeRules';

/**
 * Prórroga y propuesta oficial del ciclo de desafíos (migración 43).
 *
 * Todo lo que decide estado vive en una RPC `security definer`: el cliente no
 * escribe ni en `club_challenges` ni en `club_challenge_proposals`. Acá solo
 * se llama, se traduce el error a algo que se pueda leer en pantalla y se
 * devuelve el patrón `{ data, error }` que usa el resto de los servicios.
 *
 * Las validaciones de `clubChallengeRules.js` sirven para no gastar una
 * llamada con un formulario incompleto. La autoridad es el servidor: valida
 * de nuevo, con `now()` de PostgreSQL y con `club_members` en vivo.
 */

/** `true` si el error significa "esa función/tabla todavía no existe". */
function esFaltaDeEsquema(error) {
  if (!error) return false;
  if (['42P01', '42883', 'PGRST202', 'PGRST205', '42703'].includes(error.code)) return true;
  return /does not exist|could not find/i.test(error.message || '');
}

const FALTA_MIGRACION = {
  message:
    'Esta parte del desafío necesita una migración que todavía no está en Supabase. Avisa al equipo antes de volver a intentarlo.',
};

/**
 * Traduce el error de PostgreSQL a algo que se pueda mostrar.
 *
 * Los mensajes de las RPC ya vienen en español y son específicos («La prórroga
 * ya venció», «Solo un administrador del club contrario…»), así que se
 * respetan tal cual en vez de taparlos con un genérico.
 */
function traducirError(error, etiqueta) {
  console.error(`[FutFinder] ${etiqueta}:`, error);
  if (esFaltaDeEsquema(error)) return FALTA_MIGRACION;
  return { message: error.message || 'No se pudo completar la acción.' };
}

/**
 * Token de idempotencia para un intento de envío.
 *
 * Solo tiene que ser único: la autorización la hace la RPC con `auth.uid()`
 * y `club_members`, y desde la migración 43b el reintento por token se
 * resuelve DESPUÉS de autorizar, así que acertar un token ajeno no entrega
 * nada. Aun así se prefiere `crypto.randomUUID` donde existe; el respaldo es
 * para Hermes, que no lo trae.
 */
export function nuevoClientToken() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** PostgREST puede entregar la fila suelta o dentro de un arreglo. */
function unaFila(data) {
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

/**
 * Responde la prórroga por el club del usuario.
 *
 * Basta con que responda un administrador: la primera respuesta del club es la
 * que vale y la RPC la fija con `on conflict do nothing`, así que volver a
 * pulsar no la cambia ni duplica nada. Un «No» cierra el desafío en el acto.
 */
export async function responderProrroga(challengeId, respuesta) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  if (!challengeId) return { data: null, error: { message: 'Falta el desafío' } };

  const { data, error } = await supabase.rpc('responder_prorroga', {
    p_challenge_id: challengeId,
    p_respuesta: !!respuesta,
  });

  if (error) return { data: null, error: traducirError(error, 'responderProrroga') };
  return { data: unaFila(data), error: null };
}

/** Las respuestas de prórroga del desafío, para saber quién falta. */
export async function listRespuestasProrroga(challengeId) {
  if (!isSupabaseConfigured || !challengeId) return { data: [], error: null };

  const { data, error } = await supabase
    .from('club_challenge_extension_replies')
    .select('id, challenge_id, club_id, user_id, respuesta, created_at')
    .eq('challenge_id', challengeId);

  if (error) {
    // Sin la migración 43 la tabla no existe: la cabecera se dibuja igual,
    // solo que sin saber quién respondió.
    if (esFaltaDeEsquema(error)) return { data: [], error: null };
    console.error('[FutFinder] listRespuestasProrroga:', error);
    return { data: [], error };
  }
  return { data: data || [], error: null };
}

/**
 * Crea la propuesta oficial y deja el desafío esperando la aprobación del
 * club contrario.
 *
 * `clientToken` es lo que hace inofensivo reintentar tras un timeout de red:
 * la RPC devuelve la propuesta que ya se creó en vez de crear una segunda. La
 * pantalla tiene que generarlo UNA vez por intento de envío y conservarlo
 * entre reintentos — si lo regenera en cada toque, la idempotencia se pierde.
 */
export async function crearPropuestaOficial(challengeId, draft, clientToken = null) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  if (!challengeId) return { data: null, error: { message: 'Falta el desafío' } };

  const { data, error } = await supabase.rpc('crear_propuesta_oficial', {
    p_challenge_id: challengeId,
    p_payload: propuestaOficialPayload(draft),
    p_client_token: clientToken,
  });

  if (error) return { data: null, error: traducirError(error, 'crearPropuestaOficial') };
  return { data: unaFila(data), error: null };
}

/**
 * Aprueba la propuesta y publica el partido, todo en la misma transacción.
 *
 * NO LLEVA `clientToken`, y no es un olvido: la idempotencia la da la base.
 * `matches.challenge_proposal_id` es único y la RPC cierra la propuesta con
 * `update … where estado = 'pendiente'`, así que volver a llamarla devuelve
 * EL MISMO partido en vez de crear otro. Un token acá sería una segunda
 * defensa peor que la que ya hay.
 *
 * Quién puede: solo un administrador del club contrario al proponente que
 * además no pertenezca al club proponente. Eso lo decide el servidor con
 * `auth.uid()` y `club_members` en vivo; la interfaz esconde el botón cuando
 * no corresponde, pero esconderlo no es la protección.
 */
export async function aprobarPropuesta(proposalId) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  if (!proposalId) return { data: null, error: { message: 'Falta la propuesta' } };

  const { data, error } = await supabase.rpc('aprobar_propuesta', {
    p_proposal_id: proposalId,
  });

  if (error) return { data: null, error: traducirError(error, 'aprobarPropuesta') };
  return { data: unaFila(data), error: null };
}

/**
 * Rechaza la propuesta: solo puede el club CONTRARIO al que la hizo, y el
 * desafío vuelve a negociación conservando el registro de lo que se ofreció.
 */
export async function rechazarPropuesta(proposalId, motivo = null) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  if (!proposalId) return { data: null, error: { message: 'Falta la propuesta' } };

  const { data, error } = await supabase.rpc('rechazar_propuesta', {
    p_proposal_id: proposalId,
    p_motivo: motivo?.trim() || null,
  });

  if (error) return { data: null, error: traducirError(error, 'rechazarPropuesta') };
  return { data: unaFila(data), error: null };
}

/**
 * La propuesta abierta del desafío, o la última que hubo.
 *
 * La RLS deja leerla a cualquier integrante de los dos clubes, no solo a los
 * administradores: la dirección exacta, la cuota y las instrucciones son
 * justamente lo que un jugador necesita para decidir si va.
 */
export async function getPropuestaVigente(challengeId) {
  if (!isSupabaseConfigured || !challengeId) return { data: null, error: null };

  const { data, error } = await supabase
    .from('club_challenge_proposals')
    .select('*')
    .eq('challenge_id', challengeId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    if (esFaltaDeEsquema(error)) return { data: null, error: null };
    console.error('[FutFinder] getPropuestaVigente:', error);
    return { data: null, error };
  }
  return { data: (data && data[0]) || null, error: null };
}

/** Todas las propuestas del desafío, de la más nueva a la más antigua. */
export async function listPropuestas(challengeId) {
  if (!isSupabaseConfigured || !challengeId) return { data: [], error: null };

  const { data, error } = await supabase
    .from('club_challenge_proposals')
    .select('*')
    .eq('challenge_id', challengeId)
    .order('created_at', { ascending: false });

  if (error) {
    if (esFaltaDeEsquema(error)) return { data: [], error: null };
    console.error('[FutFinder] listPropuestas:', error);
    return { data: [], error };
  }
  return { data: data || [], error: null };
}
