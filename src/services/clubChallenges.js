import { supabase, isSupabaseConfigured } from './supabase';
import { challengeThreadKey } from '../utils/challengeThread';

/**
 * Desafíos entre clubes (tabla club_challenges).
 *
 * Flujo:
 *   1. Un admin del club retador crea el desafío (fecha propuesta, zona, mensaje).
 *      Un trigger notifica a todos los miembros del club retado.
 *   2. Un admin del club retado lo acepta o rechaza.
 *      - ACEPTAR pasa por la RPC `aceptar_desafio()` (migración 42): mueve el
 *        desafío a 'negociacion', abre el plazo con la hora del servidor y
 *        crea el hilo grupal `challenge:<id>` con todos los administradores
 *        de ambos clubes. El cliente ya no escribe el estado a mano.
 *      - RECHAZAR sigue siendo un update directo, y lo avisa el trigger
 *        `notify_club_challenge_responded` de siempre.
 *   3. Con el desafío en negociación se acuerda la propuesta oficial.
 *
 * Patrón { data, error } en todo.
 */

/** `true` si el error significa "esa función/columna todavía no existe". */
function esFaltaDeEsquema(error) {
  if (!error) return false;
  if (['42P01', '42883', 'PGRST202', 'PGRST205', '42703'].includes(error.code)) return true;
  return /does not exist|could not find/i.test(error.message || '');
}

async function getMe() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id || null;
}

/**
 * Marca como 'expirado' los desafíos pendientes de más de 7 días.
 * Best-effort: si la RPC aún no existe (migración 28 sin correr), se ignora.
 */
async function expireOld() {
  try {
    await supabase.rpc('expire_old_challenges');
  } catch (e) {
    // noop
  }
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

  // Libera desafíos vencidos para no chocar con el índice único de pendiente.
  await expireOld();

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

  await expireOld();

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
 * Acepta un desafío. Lo hace un admin del club retado.
 *
 * Toda la transición vive en la RPC: estado, plazo de negociación, evento,
 * mensaje de sistema y avisos a los administradores de ambos clubes ocurren
 * en una sola transacción con la hora del servidor. Volver a llamarla con el
 * desafío ya aceptado devuelve la misma fila sin repetir nada, así que la
 * doble pulsación es inofensiva.
 *
 * Devuelve `{ data, threadKey, error }`: `threadKey` es el hilo grupal al
 * que hay que llevar al usuario.
 */
export async function acceptChallenge(challengeId) {
  if (!isSupabaseConfigured) return { data: null, threadKey: null, error: { message: 'Demo' } };
  if (!challengeId) {
    return { data: null, threadKey: null, error: { message: 'Falta el desafío' } };
  }

  const { data, error } = await supabase.rpc('aceptar_desafio', {
    p_challenge_id: challengeId,
  });

  if (error) {
    console.error('[FutFinder] acceptChallenge:', error);
    if (esFaltaDeEsquema(error)) {
      return {
        data: null,
        threadKey: null,
        error: {
          message:
            'Aceptar desafíos necesita la migración 42 en Supabase. Avisa al equipo antes de volver a intentarlo.',
        },
      };
    }
    return { data: null, threadKey: null, error };
  }

  // La RPC devuelve la fila de `club_challenges`; PostgREST la entrega como
  // objeto, pero un `returns setof`-like podría llegar como arreglo.
  const row = Array.isArray(data) ? data[0] : data;
  return { data: row || null, threadKey: challengeThreadKey(row?.id || challengeId), error: null };
}

/**
 * Acepta o rechaza un desafío (lo hace un admin del club retado).
 *
 * Se conserva la firma de siempre para no tocar a los dos llamadores
 * (`ClubChallengesScreen` y `NotificationsScreen`), pero por dentro los dos
 * caminos ya no son simétricos: aceptar pasa por la RPC y rechazar sigue
 * siendo el update directo que avisa por trigger.
 */
export async function respondChallenge(challengeId, accept) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };

  if (accept) {
    const { data, threadKey, error } = await acceptChallenge(challengeId);
    return { data, threadKey, error };
  }

  const me = await getMe();
  const { data, error } = await supabase
    .from('club_challenges')
    .update({
      estado: 'rechazado',
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

/**
 * Bitácora del desafío (`club_challenge_events`), antiguo → nuevo.
 *
 * Se intercala como burbujas de sistema en el hilo. La RLS solo la muestra
 * a los administradores de los dos clubes, igual que el chat.
 */
export async function listChallengeEvents(challengeId) {
  if (!isSupabaseConfigured || !challengeId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('club_challenge_events')
    .select('id, challenge_id, tipo, actor_id, club_id, payload, created_at')
    .eq('challenge_id', challengeId)
    .order('created_at', { ascending: true });
  if (error) {
    // Sin la migración 42 la tabla no existe: la conversación se muestra
    // igual, solo que sin las burbujas de sistema.
    if (esFaltaDeEsquema(error)) return { data: [], error: null };
    console.error('[FutFinder] listChallengeEvents:', error);
    return { data: [], error };
  }
  return { data: data || [], error: null };
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

/**
 * Aplica los vencimientos pendientes de UN desafío y devuelve la fila al día.
 *
 * El cron de la migración 43 corre cada 5 minutos y es la fuente fiable; esto
 * solo evita que una pantalla abierta muestre un plazo vencido mientras espera
 * al siguiente pase. No concede nada ni adelanta nada: aplica exactamente las
 * mismas transiciones que se habrían aplicado solas, con la hora del servidor.
 *
 * Best-effort a propósito: si la RPC todavía no existe se devuelve `null` sin
 * error y la pantalla sigue dibujando con lo que ya tenía.
 */
export async function refreshChallenge(challengeId) {
  if (!isSupabaseConfigured || !challengeId) return { data: null, error: null };

  const { data, error } = await supabase.rpc('refrescar_desafio', {
    p_challenge_id: challengeId,
  });

  if (error) {
    if (esFaltaDeEsquema(error)) return { data: null, error: null };
    console.error('[FutFinder] refreshChallenge:', error);
    return { data: null, error };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return { data: row || null, error: null };
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
