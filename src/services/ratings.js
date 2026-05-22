import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Servicio de calificaciones post-partido.
 *
 * Reglas de negocio (todas reforzadas en RLS):
 *  - Solo puedo calificar a otros asistentes que confirmaron GPS en el mismo partido.
 *  - El partido tiene que haber empezado hace al menos 90 minutos.
 *  - Una vez calificada una persona, no puedo volver a calificarla (UNIQUE).
 *  - No puedo calificarme a mí mismo.
 *
 * Dimensiones (todas 1–5 estrellas):
 *  - puntualidad
 *  - fairplay
 *  - nivel
 */

async function getMyId() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id || null;
}

/**
 * Devuelve si un partido es "calificable" desde el punto de vista del usuario actual:
 *  - El partido ya pasó (hace ≥ 90 min)
 *  - Yo soy un asistente confirmado_gps
 *
 * También devuelve cuánto tiempo falta (en minutos) si todavía no es calificable.
 */
export async function isMatchRatable(matchId) {
  if (!isSupabaseConfigured) return { ok: false, reason: 'demo' };

  const me = await getMyId();
  if (!me) return { ok: false, reason: 'no-auth' };

  // Soy confirmado_gps en ese partido?
  const { data: myAtt } = await supabase
    .from('attendees')
    .select('estado')
    .eq('id_partido', matchId)
    .eq('id_jugador', me)
    .maybeSingle();

  if (!myAtt) return { ok: false, reason: 'not-attendee' };
  if (myAtt.estado !== 'confirmado_gps') {
    return { ok: false, reason: 'not-confirmed-gps' };
  }

  // El partido ya pasó hace ≥ 90 min?
  const { data: match } = await supabase
    .from('matches')
    .select('hora')
    .eq('id', matchId)
    .maybeSingle();

  if (!match) return { ok: false, reason: 'no-match' };

  const matchTime = new Date(match.hora).getTime();
  const ninetyMin = 90 * 60 * 1000;
  const diff = matchTime + ninetyMin - Date.now();

  if (diff > 0) {
    return {
      ok: false,
      reason: 'too-early',
      minutesUntilRatable: Math.ceil(diff / 60000),
    };
  }

  return { ok: true };
}

/**
 * Lista de personas a quienes puedo calificar en este partido:
 *  - Confirmadas por GPS
 *  - Distintas de mí
 *
 * Para cada una marca si yo ya la califiqué (already_rated = true) y devuelve
 * la calificación que le di (myRating: { puntualidad, fairplay, nivel, comentario })
 * para que la UI pueda mostrar estado o permitir editar comentario.
 */
export async function getRatableAttendees(matchId) {
  if (!isSupabaseConfigured) return { data: [], error: null };

  const me = await getMyId();
  if (!me) return { data: [], error: { message: 'no-auth' } };

  // 1) Todos los asistentes confirmados (excepto yo)
  const { data: attendees, error: errA } = await supabase
    .from('attendees')
    .select('id_jugador')
    .eq('id_partido', matchId)
    .eq('estado', 'confirmado_gps')
    .neq('id_jugador', me);

  if (errA) return { data: [], error: errA };

  const userIds = (attendees || []).map((a) => a.id_jugador);
  if (userIds.length === 0) return { data: [], error: null };

  // 2) Sus perfiles
  const { data: profiles, error: errP } = await supabase
    .from('profiles')
    .select('id, username, foto_url, rating_count, rating_nivel_avg')
    .in('id', userIds);

  if (errP) return { data: [], error: errP };

  // 3) Mis ratings ya hechos para este partido
  const { data: myRatings, error: errR } = await supabase
    .from('ratings')
    .select('rated_id, puntualidad, fairplay, nivel, comentario')
    .eq('match_id', matchId)
    .eq('rater_id', me);

  if (errR) return { data: [], error: errR };

  const ratingsByUser = new Map(
    (myRatings || []).map((r) => [r.rated_id, r])
  );

  // 4) Mezclar
  const merged = (profiles || []).map((p) => {
    const r = ratingsByUser.get(p.id) || null;
    return {
      ...p,
      already_rated: Boolean(r),
      myRating: r,
    };
  });

  return { data: merged, error: null };
}

/**
 * Envía un batch de ratings al servidor.
 *
 * Parámetros:
 *   matchId : uuid
 *   ratings : array de objetos {
 *               rated_id, puntualidad, fairplay, nivel, comentario?
 *             }
 *
 * Cada rating se inserta como una fila. Si alguna falla por RLS o constraint
 * (por ejemplo el usuario ya estaba calificado) el resto sigue intentando.
 * Devolvemos { inserted: number, skipped: number, errors: [] }.
 */
export async function submitRatings(matchId, ratings) {
  if (!isSupabaseConfigured) return { inserted: 0, skipped: 0, errors: [] };
  if (!Array.isArray(ratings) || ratings.length === 0) {
    return { inserted: 0, skipped: 0, errors: [] };
  }

  const me = await getMyId();
  if (!me) return { inserted: 0, skipped: 0, errors: ['no-auth'] };

  const rows = ratings.map((r) => ({
    match_id:    matchId,
    rater_id:    me,
    rated_id:    r.rated_id,
    puntualidad: clamp(r.puntualidad),
    fairplay:    clamp(r.fairplay),
    nivel:       clamp(r.nivel),
    comentario:  (r.comentario || '').trim() || null,
  }));

  // Insertamos todos a la vez. Si alguno ya existía, lo capturamos.
  const { data, error } = await supabase
    .from('ratings')
    .insert(rows)
    .select('id');

  if (error) {
    // Posibles causas: duplicado (unique), RLS (no elegible), etc.
    return {
      inserted: 0,
      skipped: rows.length,
      errors: [error.message || 'insert-error'],
    };
  }

  return {
    inserted: data?.length ?? 0,
    skipped: rows.length - (data?.length ?? 0),
    errors: [],
  };
}

/**
 * Devuelve el resumen de calificaciones de un usuario (lo que ya está en profiles).
 *   { avg_puntualidad, avg_fairplay, avg_nivel, count, overall }
 *
 * overall = promedio simple de las 3 dimensiones, redondeado a 1 decimal.
 */
export async function getUserRatingSummary(userId) {
  if (!isSupabaseConfigured) {
    return {
      avg_puntualidad: 0,
      avg_fairplay: 0,
      avg_nivel: 0,
      count: 0,
      overall: 0,
    };
  }
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'rating_puntualidad_avg, rating_fairplay_avg, rating_nivel_avg, rating_count'
    )
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) {
    return {
      avg_puntualidad: 0,
      avg_fairplay: 0,
      avg_nivel: 0,
      count: 0,
      overall: 0,
    };
  }

  const p = Number(data.rating_puntualidad_avg || 0);
  const f = Number(data.rating_fairplay_avg || 0);
  const n = Number(data.rating_nivel_avg || 0);
  const cnt = Number(data.rating_count || 0);
  const overall = cnt > 0 ? Math.round(((p + f + n) / 3) * 10) / 10 : 0;

  return {
    avg_puntualidad: p,
    avg_fairplay: f,
    avg_nivel: n,
    count: cnt,
    overall,
  };
}

/**
 * Últimos N comentarios públicos recibidos por un usuario (para mostrarlos en su perfil).
 */
export async function getReceivedRatings(userId, { limit = 10 } = {}) {
  if (!isSupabaseConfigured) return { data: [], error: null };

  const { data, error } = await supabase
    .from('ratings')
    .select(
      'id, puntualidad, fairplay, nivel, comentario, created_at, match_id, rater_id'
    )
    .eq('rated_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return { data: data || [], error };
}

// =========================================================
// Helpers
// =========================================================
function clamp(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(5, Math.round(n)));
}
