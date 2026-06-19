import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Desafíos entre clubes (tabla club_challenges).
 *
 * Flujo:
 *   1. Un admin del club retador crea el desafío (fecha propuesta, zona, mensaje).
 *      Un trigger notifica a todos los miembros del club retado.
 *   2. Un admin del club retado lo acepta o rechaza. Otro trigger notifica a los
 *      admins del retador. Al aceptar, el cliente abre un DM entre ambos admins.
 *   3. (Parte 2) Con el desafío aceptado se crea el partido de club.
 *
 * Patrón { data, error } en todo.
 */

async function getMe() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id || null;
}

/**
 * Crea un desafío. retadorClubId debe ser un club donde soy admin.
 * fechaPropuesta: Date | ISO string | null.
 */
export async function createChallenge({
  retadorClubId,
  retadoClubId,
  fechaPropuesta = null,
  zona = null,
  mensaje = null,
}) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const me = await getMe();
  if (!me) return { error: { message: 'No autenticado' } };
  if (!retadorClubId || !retadoClubId) {
    return { error: { message: 'Faltan los clubes del desafío' } };
  }
  if (retadorClubId === retadoClubId) {
    return { error: { message: 'Un club no puede desafiarse a sí mismo' } };
  }

  const fechaIso =
    fechaPropuesta instanceof Date ? fechaPropuesta.toISOString() : fechaPropuesta || null;

  const { data, error } = await supabase
    .from('club_challenges')
    .insert({
      club_retador_id: retadorClubId,
      club_retado_id: retadoClubId,
      creado_por: me,
      fecha_propuesta: fechaIso,
      zona: zona?.trim() || null,
      mensaje: mensaje?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    console.error('[FutFinder] createChallenge:', error);
    if (error.code === '23505') {
      return { error: { message: 'Ya tienes un desafío pendiente con este club' } };
    }
  }
  return { data, error };
}

/**
 * Desafíos de un club, separados en recibidos y enviados, enriquecidos con el
 * club rival y el nombre de quién lo creó.
 * Devuelve { data: { recibidos, enviados }, error }.
 */
export async function listChallengesForClub(clubId) {
  const vacio = { recibidos: [], enviados: [] };
  if (!isSupabaseConfigured || !clubId) return { data: vacio, error: null };

  const { data, error } = await supabase
    .from('club_challenges')
    .select('*')
    .or(`club_retador_id.eq.${clubId},club_retado_id.eq.${clubId}`)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[FutFinder] listChallengesForClub:', error);
    return { data: vacio, error };
  }
  if (!data || data.length === 0) return { data: vacio, error: null };

  // Enriquecer con el club "otro" y el creador, en pocas queries.
  const otherClubIds = new Set();
  const creadorIds = new Set();
  for (const c of data) {
    otherClubIds.add(c.club_retador_id === clubId ? c.club_retado_id : c.club_retador_id);
    creadorIds.add(c.creado_por);
  }

  const [{ data: clubs }, { data: profiles }] = await Promise.all([
    supabase.from('clubs').select('id, nombre, foto_url, comuna, region, verificado').in('id', [...otherClubIds]),
    supabase.from('profiles').select('id, username').in('id', [...creadorIds]),
  ]);
  const clubById = new Map((clubs || []).map((c) => [c.id, c]));
  const nameById = new Map((profiles || []).map((p) => [p.id, p.username]));

  const enrich = (c) => {
    const esRecibido = c.club_retado_id === clubId;
    const otherId = esRecibido ? c.club_retador_id : c.club_retado_id;
    return {
      ...c,
      direccion: esRecibido ? 'recibido' : 'enviado',
      otroClub: clubById.get(otherId) || null,
      creadorNombre: nameById.get(c.creado_por) || 'un admin',
    };
  };

  return {
    data: {
      recibidos: data.filter((c) => c.club_retado_id === clubId).map(enrich),
      enviados: data.filter((c) => c.club_retador_id === clubId).map(enrich),
    },
    error: null,
  };
}

/** Cuenta los desafíos recibidos pendientes de un club (para el badge). */
export async function countPendingForClub(clubId) {
  if (!isSupabaseConfigured || !clubId) return 0;
  const { count, error } = await supabase
    .from('club_challenges')
    .select('id', { count: 'exact', head: true })
    .eq('club_retado_id', clubId)
    .eq('estado', 'pendiente');
  if (error) return 0;
  return count || 0;
}

/**
 * Acepta o rechaza un desafío (lo hace un admin del club retado).
 * El trigger notifica al retador. Devuelve la fila para poder abrir el DM.
 */
export async function respondChallenge(challengeId, accept) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const me = await getMe();
  const { data, error } = await supabase
    .from('club_challenges')
    .update({
      estado: accept ? 'aceptado' : 'rechazado',
      responded_at: new Date().toISOString(),
      respondido_por: me,
    })
    .eq('id', challengeId)
    .eq('estado', 'pendiente')
    .select()
    .single();
  if (error) console.error('[FutFinder] respondChallenge:', error);
  return { data, error };
}

/** Cancela un desafío enviado (admin del retador). */
export async function cancelChallenge(challengeId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { error } = await supabase
    .from('club_challenges')
    .update({ estado: 'cancelado', responded_at: new Date().toISOString() })
    .eq('id', challengeId)
    .eq('estado', 'pendiente');
  if (error) console.error('[FutFinder] cancelChallenge:', error);
  return { error };
}

/**
 * Vincula el desafío con el partido de club recién creado (challenge.match_id).
 * Lo llama CreateMatchScreen tras crear el partido en modo club.
 */
export async function linkChallengeMatch(challengeId, matchId) {
  if (!isSupabaseConfigured) return { error: null };
  if (!challengeId || !matchId) return { error: { message: 'Faltan datos' } };
  const { error } = await supabase
    .from('club_challenges')
    .update({ match_id: matchId })
    .eq('id', challengeId);
  if (error) console.error('[FutFinder] linkChallengeMatch:', error);
  return { error };
}

/** Un desafío por id, enriquecido (para abrir desde una notificación). */
export async function getChallenge(challengeId) {
  if (!isSupabaseConfigured || !challengeId) return { data: null, error: null };
  const { data, error } = await supabase
    .from('club_challenges')
    .select('*')
    .eq('id', challengeId)
    .single();
  if (error) {
    console.error('[FutFinder] getChallenge:', error);
    return { data: null, error };
  }
  return { data, error: null };
}
