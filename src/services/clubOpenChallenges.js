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

/** Retira mi respuesta pendiente. */
export async function withdrawResponse(responseId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { error } = await supabase
    .from('club_open_challenge_responses')
    .update({ estado: 'retirada' })
    .eq('id', responseId)
    .eq('estado', 'pendiente');
  if (error) console.error('[FutFinder] withdrawResponse:', error);
  return { error };
}

/** Vuelvo a intentar tras haberla retirado. */
export async function reconsiderMyResponse(responseId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { error } = await supabase
    .from('club_open_challenge_responses')
    .update({ estado: 'pendiente' })
    .eq('id', responseId)
    .eq('estado', 'retirada');
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
  const { error } = await supabase
    .from('club_open_challenge_responses')
    .update({ estado: 'rechazada' })
    .eq('id', responseId)
    .eq('estado', 'pendiente');
  if (error) console.error('[FutFinder] rejectResponse:', error);
  return { error };
}

/** El club que publicó reconsidera una respuesta que había rechazado. */
export async function reconsiderResponse(responseId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { error } = await supabase
    .from('club_open_challenge_responses')
    .update({ estado: 'pendiente' })
    .eq('id', responseId)
    .eq('estado', 'rechazada');
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
