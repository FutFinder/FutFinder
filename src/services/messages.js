import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Servicio de mensajería en tiempo real.
 *
 * Tipos de hilo (thread):
 *  - DM (1-a-1):    threadKey = 'dm:<userId>'   target = { receiver_id }
 *  - Match grupal:  threadKey = 'match:<matchId>' target = { match_id }
 */

export function threadKey({ type, id }) {
  return `${type}:${id}`;
}

export function parseThreadKey(key) {
  if (!key) return null;
  const [type, id] = key.split(':');
  return { type, id };
}

/**
 * Lista de conversaciones del usuario:
 *  - Match chats: TODO partido al que esté inscrito (incluso sin mensajes).
 *    Si soy el organizador, también aparece porque el trigger me agrega
 *    como attendee automáticamente.
 *  - DMs: solo aquellos con al menos un mensaje (porque no hay forma
 *    todavía de "iniciar un DM vacío").
 */
export async function listMyThreads() {
  if (!isSupabaseConfigured) return [];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const me = user.id;

  // 1) Mis inscripciones — esto define los chats de partido que veo
  const { data: myAttendances = [], error: aErr } = await supabase
    .from('attendees')
    .select(
      'id_partido, inscrito_at,' +
      ' match:matches(id, titulo, comuna, cancha_nombre, hora, estado, id_organizador)'
    )
    .eq('id_jugador', me)
    .order('inscrito_at', { ascending: false });
  if (aErr) console.error('[FutFinder] listMyThreads attendances:', aErr);

  // 2) Último mensaje por partido (un solo round-trip)
  const matchIds = (myAttendances || [])
    .map((a) => a.id_partido)
    .filter(Boolean);
  const lastByMatch = new Map();
  if (matchIds.length > 0) {
    const { data: matchMsgs = [], error: mErr } = await supabase
      .from('messages')
      .select('id, content, created_at, sender_id, match_id')
      .in('match_id', matchIds)
      .order('created_at', { ascending: false })
      .limit(200);
    if (mErr) console.error('[FutFinder] listMyThreads match msgs:', mErr);
    for (const msg of matchMsgs) {
      if (!lastByMatch.has(msg.match_id)) lastByMatch.set(msg.match_id, msg);
    }
  }

  const matchThreads = (myAttendances || [])
    .filter((a) => a.match) // si el partido fue borrado, lo saltamos
    .map((a) => {
      const last = lastByMatch.get(a.id_partido);
      return {
        key: threadKey({ type: 'match', id: a.id_partido }),
        type: 'match',
        match_id: a.id_partido,
        title: a.match.titulo || 'Partido',
        subtitle:
          (a.match.cancha_nombre || '') +
          (a.match.comuna ? ` · ${a.match.comuna}` : ''),
        is_organizer: a.match.id_organizador === me,
        last_message: last || null,
        last_at: last?.created_at || a.match.hora || a.inscrito_at,
        unread: 0, // grupales: sin contador per-usuario en V1
      };
    });

  // 3) DMs (solo los que tienen al menos un mensaje)
  const { data: dms = [], error: dmErr } = await supabase
    .from('messages')
    .select(
      'id, created_at, sender_id, receiver_id, content, read_at,' +
      ' sender:sender_id(id, username, foto_url),' +
      ' receiver:receiver_id(id, username, foto_url)'
    )
    .is('match_id', null)
    .or(`sender_id.eq.${me},receiver_id.eq.${me}`)
    .order('created_at', { ascending: false })
    .limit(200);
  if (dmErr) console.error('[FutFinder] listMyThreads DMs:', dmErr);

  const dmMap = new Map();
  for (const m of dms) {
    const other = m.sender_id === me ? m.receiver : m.sender;
    const otherId = m.sender_id === me ? m.receiver_id : m.sender_id;
    if (!otherId) continue;
    const key = threadKey({ type: 'dm', id: otherId });
    if (!dmMap.has(key)) {
      dmMap.set(key, {
        key,
        type: 'dm',
        other_id: otherId,
        other_username: other?.username || 'jugador',
        other_foto: other?.foto_url || null,
        title: '@' + (other?.username || 'jugador'),
        subtitle: 'Mensaje directo',
        last_message: m,
        last_at: m.created_at,
        unread: 0,
      });
    }
    if (m.receiver_id === me && !m.read_at) {
      dmMap.get(key).unread += 1;
    }
  }

  return [...matchThreads, ...dmMap.values()].sort(
    (a, b) => new Date(b.last_at) - new Date(a.last_at)
  );
}

/**
 * Devuelve el historial de un hilo (newest last).
 */
export async function listThreadMessages(threadKeyStr, { limit = 50 } = {}) {
  if (!isSupabaseConfigured) return [];
  const t = parseThreadKey(threadKeyStr);
  if (!t) return [];

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const me = user.id;

  let q = supabase
    .from('messages')
    .select(
      'id, created_at, sender_id, receiver_id, match_id, content, read_at,' +
      ' sender:sender_id(id, username, foto_url)'
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (t.type === 'dm') {
    // mensajes entre me y t.id (en cualquier dirección)
    q = q
      .is('match_id', null)
      .or(
        `and(sender_id.eq.${me},receiver_id.eq.${t.id}),` +
        `and(sender_id.eq.${t.id},receiver_id.eq.${me})`
      );
  } else if (t.type === 'match') {
    q = q.eq('match_id', t.id);
  } else {
    return [];
  }

  const { data, error } = await q;
  if (error) {
    console.error('[FutFinder] listThreadMessages:', error);
    return [];
  }
  // Devolvemos en orden ascendente (más antiguo → más nuevo)
  return (data || []).reverse();
}

/**
 * Envía un mensaje al hilo. Devuelve { data, error }.
 */
export async function sendMessage(threadKeyStr, content) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const cleaned = (content || '').trim();
  if (!cleaned) return { error: { message: 'Mensaje vacío' } };

  const t = parseThreadKey(threadKeyStr);
  if (!t) return { error: { message: 'Hilo inválido' } };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: { message: 'No autenticado' } };

  const payload = {
    sender_id: user.id,
    content: cleaned,
  };
  if (t.type === 'dm') payload.receiver_id = t.id;
  else if (t.type === 'match') payload.match_id = t.id;

  const { data, error } = await supabase
    .from('messages')
    .insert(payload)
    .select(
      'id, created_at, sender_id, receiver_id, match_id, content, read_at,' +
      ' sender:sender_id(id, username, foto_url)'
    )
    .single();

  if (error) console.error('[FutFinder] sendMessage:', error);
  return { data, error };
}

/**
 * Marca como leídos los mensajes del hilo (sólo DMs).
 */
export async function markThreadAsRead(threadKeyStr) {
  if (!isSupabaseConfigured) return;
  const t = parseThreadKey(threadKeyStr);
  if (!t || t.type !== 'dm') return;

  await supabase.rpc('mark_thread_as_read', {
    p_other_user_id: t.id,
    p_match_id: null,
  });
}

/**
 * Cuenta total de mensajes no leídos para mostrar en el tab.
 */
export async function countUnreadTotal() {
  if (!isSupabaseConfigured) return 0;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('receiver_id', user.id)
    .is('read_at', null)
    .is('match_id', null);
  if (error) return 0;
  return count || 0;
}

// ============================================================
// REALTIME — suscripciones websocket
// ============================================================

/**
 * Suscribe a INSERTS/UPDATES de la tabla messages.
 * Llama a `onChange(payload)` con cada cambio.
 * Devuelve una función para desuscribirse (cleanup en useEffect).
 *
 * NOTA: filtramos del lado del cliente porque Supabase Realtime
 * sólo soporta un filtro `eq` por canal. Para hilos múltiples
 * es más simple así. A escala se puede optimizar con un canal
 * por hilo activo.
 */
export function subscribeToMessages(onChange) {
  if (!isSupabaseConfigured) return () => {};

  const channel = supabase
    .channel('public:messages')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'messages' },
      (payload) => {
        try {
          onChange(payload);
        } catch (e) {
          console.error('[FutFinder] Realtime handler error:', e);
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[FutFinder] Realtime conectado a messages');
      }
    });

  return () => {
    try {
      supabase.removeChannel(channel);
    } catch (e) {
      // noop
    }
  };
}

/**
 * Helper: determina si un mensaje pertenece al hilo dado.
 * Útil para filtrar del lado del cliente al recibir Realtime.
 */
export function messageBelongsToThread(message, threadKeyStr, myUserId) {
  const t = parseThreadKey(threadKeyStr);
  if (!t || !message) return false;
  if (t.type === 'match') return message.match_id === t.id;
  if (t.type === 'dm') {
    if (message.match_id) return false;
    const pair = [message.sender_id, message.receiver_id].filter(Boolean);
    return pair.includes(myUserId) && pair.includes(t.id);
  }
  return false;
}
