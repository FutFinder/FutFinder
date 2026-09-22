import { supabase, isSupabaseConfigured } from './supabase';
import { getClubEstadisticas } from './clubMatches';
import { distanciaEntreClubesKm } from '../utils/clubMeta';

/**
 * El tablero abierto de desafíos (migración 112): en paralelo al desafío
 * 1 a 1 de siempre, un club publica que busca rival sin elegir a nadie
 * todavía, otros responden, y el que publicó elige una respuesta —el
 * resto queda descartado— y entra al mismo ciclo formal de siempre
 * (`aceptar_desafio()`, migración 42): mismo hilo de negociación, misma
 * propuesta oficial, mismo partido.
 *
 * Patrón { data, error } en todo, igual que `clubChallenges.js`.
 */

function esFaltaDeEsquema(error) {
  if (!error) return false;
  if (['42P01', '42883', 'PGRST202', 'PGRST205', '42703'].includes(error.code)) return true;
  return /does not exist|could not find/i.test(error.message || '');
}

async function getMe() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id || null;
}

/** Best-effort: marca como expiradas las publicaciones de más de 7 días. */
async function expireOld() {
  try {
    await supabase.rpc('expirar_desafios_abiertos');
  } catch {
    // noop — migración 112 puede no estar aplicada todavía
  }
}

const CLUB_COLUMNAS = 'nombre, foto_url, comuna, region, modalidad, tema';

/** Publica un desafío abierto. `clubId` debe ser un club donde soy admin. */
export async function publishOpenChallenge({ clubId, modalidad, fechaPropuesta, zona, mensaje }) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  const me = await getMe();
  if (!me) return { data: null, error: { message: 'No autenticado' } };
  if (!clubId) return { data: null, error: { message: 'Falta el club' } };

  const fechaIso = fechaPropuesta instanceof Date ? fechaPropuesta.toISOString() : fechaPropuesta;

  const { data, error } = await supabase
    .from('club_open_challenges')
    .insert({
      club_id: clubId,
      creado_por: me,
      modalidad,
      fecha_propuesta: fechaIso,
      zona: zona?.trim() || null,
      mensaje: mensaje?.trim() || null,
    })
    .select()
    .single();

  if (error) console.error('[FutFinder] publishOpenChallenge:', error);
  return { data, error };
}

/** Edita una publicación mientras sigue abierta. */
export async function updateOpenChallenge(openChallengeId, { modalidad, fechaPropuesta, zona, mensaje }) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  const fechaIso = fechaPropuesta instanceof Date ? fechaPropuesta.toISOString() : fechaPropuesta;

  const { data, error } = await supabase
    .from('club_open_challenges')
    .update({
      modalidad,
      fecha_propuesta: fechaIso,
      zona: zona?.trim() || null,
      mensaje: mensaje?.trim() || null,
    })
    .eq('id', openChallengeId)
    .eq('estado', 'abierto')
    .select()
    .single();

  if (error) console.error('[FutFinder] updateOpenChallenge:', error);
  return { data, error };
}

/** Retira (cancela) una publicación propia. */
export async function cancelOpenChallenge(openChallengeId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { error } = await supabase
    .from('club_open_challenges')
    .update({ estado: 'cancelado' })
    .eq('id', openChallengeId)
    .eq('estado', 'abierto');
  if (error) console.error('[FutFinder] cancelOpenChallenge:', error);
  return { error };
}

/**
 * Mis publicaciones (cualquier estado), la más nueva primero, con la
 * cantidad real de respuestas de cada una (`respuestasCount`) — cuenta las
 * mismas filas que vería «Ver respuestas», salvo las retiradas: un club que
 * se arrepintió no cuenta como interés recibido.
 */
export async function listMyOpenChallenges(clubId) {
  if (!isSupabaseConfigured || !clubId) return { data: [], error: null };
  await expireOld();
  const { data, error } = await supabase
    .from('club_open_challenges')
    .select('*')
    .eq('club_id', clubId)
    .order('created_at', { ascending: false });
  if (error) {
    if (esFaltaDeEsquema(error)) return { data: [], error: null };
    console.error('[FutFinder] listMyOpenChallenges:', error);
    return { data: [], error };
  }
  const rows = data || [];
  if (rows.length === 0) return { data: [], error: null };

  const counts = await Promise.all(
    rows.map((r) =>
      supabase
        .from('club_open_challenge_responses')
        .select('id', { count: 'exact', head: true })
        .eq('open_challenge_id', r.id)
        .neq('estado', 'retirada')
    )
  );
  const enriched = rows.map((r, i) => ({ ...r, respuestasCount: counts[i]?.count ?? 0 }));
  return { data: enriched, error: null };
}

/**
 * Cuántas respuestas esperan decisión en las publicaciones de este club.
 *
 * ES EL NÚMERO DEL BADGE DEL ACCESO RÁPIDO «DESAFÍOS», y existe porque ese
 * badge contaba otra cosa: los desafíos DIRECTOS recibidos, que desde el
 * tablero abierto (migración 112) ya no viven en la pantalla que el tile
 * abre. El badge prometía trabajo pendiente y llevaba a un sitio donde no
 * estaba — el mismo defecto de los hallazgos 1 y 2 del informe del 22-09.
 *
 * SÓLO `pendiente`, Y SÓLO DE PUBLICACIONES `abierto`. `respuestasCount` de
 * `listMyOpenChallenges()` cuenta todo lo que no se retiró, aceptadas y
 * rechazadas incluidas: sirve para rotular «Respuestas (3)» en la tarjeta,
 * pero como badge diría que hay tres cosas que decidir cuando ya se
 * decidieron las tres. Y una respuesta a una publicación cerrada o expirada
 * tampoco se puede aceptar.
 *
 * DOS CONSULTAS PLANAS, SIN EMBED. Un `!inner` sobre `club_open_challenges`
 * ahorraría un viaje, pero un embed mal nombrado no degrada: PostgREST
 * rechaza la consulta entera con 400 y el badge se cae junto con la portada
 * — el mismo argumento de `nominaQuery.js`. La RLS ya deja al club dueño de
 * la publicación leer todas sus respuestas.
 *
 * Devuelve 0 ante cualquier problema, incluida la falta de la migración 112:
 * un badge que no se dibuja es mejor que una portada que no carga.
 */
export async function countRespuestasPendientes(clubId) {
  if (!isSupabaseConfigured || !clubId) return { data: 0, error: null };

  const { data: publicaciones, error: errPubs } = await supabase
    .from('club_open_challenges')
    .select('id')
    .eq('club_id', clubId)
    .eq('estado', 'abierto');
  if (errPubs) {
    if (esFaltaDeEsquema(errPubs)) return { data: 0, error: null };
    console.error('[FutFinder] countRespuestasPendientes(publicaciones):', errPubs);
    return { data: 0, error: errPubs };
  }
  if (!publicaciones || publicaciones.length === 0) return { data: 0, error: null };

  const { count, error } = await supabase
    .from('club_open_challenge_responses')
    .select('id', { count: 'exact', head: true })
    .in('open_challenge_id', publicaciones.map((p) => p.id))
    .eq('estado', 'pendiente');
  if (error) {
    if (esFaltaDeEsquema(error)) return { data: 0, error: null };
    console.error('[FutFinder] countRespuestasPendientes:', error);
    return { data: 0, error };
  }
  return { data: count || 0, error: null };
}

/**
 * Publicaciones abiertas de OTROS clubes, enriquecidas con la distancia real
 * (por comuna, igual que «Buscar rivales») y el historial real V/E/D del
 * club — nunca con nivel ni valoración, que no existen en la base.
 */
export async function listOpenChallenges({ myClub, excludeClubId, limit = 20 } = {}) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  await expireOld();

  let q = supabase
    .from('club_open_challenges')
    .select(`*, clubs(${CLUB_COLUMNAS})`)
    .eq('estado', 'abierto')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (excludeClubId) q = q.neq('club_id', excludeClubId);

  const { data, error } = await q;
  if (error) {
    if (esFaltaDeEsquema(error)) return { data: [], error: null };
    console.error('[FutFinder] listOpenChallenges:', error);
    return { data: [], error };
  }
  const rows = data || [];
  if (rows.length === 0) return { data: [], error: null };

  const estadisticas = await Promise.all(rows.map((r) => getClubEstadisticas(r.club_id)));

  const enriched = rows.map((r, i) => ({
    ...r,
    club: r.clubs || null,
    distanciaKm: myClub ? distanciaEntreClubesKm(myClub, r.clubs) : null,
    estadisticas: estadisticas[i]?.data || null,
  }));

  return { data: enriched, error: null };
}

/** Responde a una publicación abierta. `clubId` debe ser un club donde soy admin. */
export async function respondToOpenChallenge(openChallengeId, { clubId, mensaje }) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  const me = await getMe();
  if (!me) return { data: null, error: { message: 'No autenticado' } };

  const { data, error } = await supabase
    .from('club_open_challenge_responses')
    .insert({
      open_challenge_id: openChallengeId,
      club_id: clubId,
      creado_por: me,
      mensaje: mensaje?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    console.error('[FutFinder] respondToOpenChallenge:', error);
    if (error.code === '23505') {
      return { data: null, error: { message: 'Ya respondiste a esta publicación' } };
    }
  }
  return { data, error };
}

/** Mi respuesta a una publicación (o null si nunca respondí). */
export async function getMyResponseTo(openChallengeId, clubId) {
  if (!isSupabaseConfigured || !openChallengeId || !clubId) return { data: null, error: null };
  const { data, error } = await supabase
    .from('club_open_challenge_responses')
    .select('*')
    .eq('open_challenge_id', openChallengeId)
    .eq('club_id', clubId)
    .maybeSingle();
  if (error) {
    console.error('[FutFinder] getMyResponseTo:', error);
    return { data: null, error };
  }
  return { data, error: null };
}

/**
 * `.update().eq(...).eq('estado', X)` sin `.select()` NO informa si la fila
 * de verdad cambió: con la condición de estado sin matchear —la respuesta
 * ya la gestionó otra persona, o cambió de estado mientras tanto—
 * PostgREST devuelve éxito con cero filas, `error: null`, y quien llamó no
 * tiene forma de distinguirlo de un guardado real. Este helper sí lo
 * distingue: pide de vuelta la fila tocada y, si no viene ninguna, arma un
 * error legible en su lugar.
 */
async function actualizarRespuestaSiEstado(responseId, { hacia, siEstaEn, quePasoSiNo }) {
  const { data, error } = await supabase
    .from('club_open_challenge_responses')
    .update({ estado: hacia })
    .eq('id', responseId)
    .eq('estado', siEstaEn)
    .select('id');
  if (error) return { error };
  if (!data || data.length === 0) return { error: { message: quePasoSiNo } };
  return { error: null };
}

/** Retira mi respuesta pendiente. */
export async function withdrawResponse(responseId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { error } = await actualizarRespuestaSiEstado(responseId, {
    hacia: 'retirada',
    siEstaEn: 'pendiente',
    quePasoSiNo: 'Esta respuesta ya no está pendiente — puede que ya la hayan gestionado. Actualiza para ver el estado real.',
  });
  if (error) console.error('[FutFinder] withdrawResponse:', error);
  return { error };
}

/** Vuelvo a intentar tras haberla retirado. */
export async function reconsiderMyResponse(responseId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { error } = await actualizarRespuestaSiEstado(responseId, {
    hacia: 'pendiente',
    siEstaEn: 'retirada',
    quePasoSiNo: 'Esta respuesta ya no está retirada — puede que haya cambiado mientras tanto. Actualiza para ver el estado real.',
  });
  if (error) console.error('[FutFinder] reconsiderMyResponse:', error);
  return { error };
}

/** Las respuestas que recibió mi publicación, con el club que respondió. */
export async function listResponsesForOpenChallenge(openChallengeId) {
  if (!isSupabaseConfigured || !openChallengeId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('club_open_challenge_responses')
    .select(`*, clubs(${CLUB_COLUMNAS})`)
    .eq('open_challenge_id', openChallengeId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[FutFinder] listResponsesForOpenChallenge:', error);
    return { data: [], error };
  }
  const rows = data || [];
  if (rows.length === 0) return { data: [], error: null };

  const estadisticas = await Promise.all(rows.map((r) => getClubEstadisticas(r.club_id)));
  return {
    data: rows.map((r, i) => ({
      ...r,
      club: r.clubs || null,
      estadisticas: estadisticas[i]?.data || null,
    })),
    error: null,
  };
}

/** El club que publicó rechaza una respuesta pendiente. */
export async function rejectResponse(responseId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { error } = await actualizarRespuestaSiEstado(responseId, {
    hacia: 'rechazada',
    siEstaEn: 'pendiente',
    quePasoSiNo: 'Esta respuesta ya no está pendiente — puede que ya la hayan gestionado. Actualiza para ver el estado real.',
  });
  if (error) console.error('[FutFinder] rejectResponse:', error);
  return { error };
}

/** El club que publicó reconsidera una respuesta que había rechazado. */
export async function reconsiderResponse(responseId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { error } = await actualizarRespuestaSiEstado(responseId, {
    hacia: 'pendiente',
    siEstaEn: 'rechazada',
    quePasoSiNo: 'Esta respuesta ya no está rechazada — puede que haya cambiado mientras tanto. Actualiza para ver el estado real.',
  });
  if (error) console.error('[FutFinder] reconsiderResponse:', error);
  return { error };
}

/**
 * El club que publicó elige una respuesta: entra al ciclo formal de
 * siempre (migración 42) vía `aceptar_desafio()`. Devuelve el desafío
 * resultante ya en 'negociacion', con su hilo de chat abierto.
 */
export async function acceptResponse(responseId) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  if (!responseId) return { data: null, error: { message: 'Falta la respuesta' } };

  const { data, error } = await supabase.rpc('aceptar_respuesta_desafio_abierto', {
    p_response_id: responseId,
  });

  if (error) {
    console.error('[FutFinder] acceptResponse:', error);
    if (esFaltaDeEsquema(error)) {
      return {
        data: null,
        error: {
          message:
            'El tablero abierto necesita la migración 112 en Supabase. Avisa al equipo antes de volver a intentarlo.',
        },
      };
    }
    return { data: null, error };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { data: row || null, error: null };
}
