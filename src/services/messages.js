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
/**
 * Esconde un hilo de mi vista (chat_hides). Si después llega un mensaje
 * más nuevo, el hilo reaparece automáticamente.
 */
export async function hideThread(threadKeyStr) {
  if (!isSupabaseConfigured) return { error: null };
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: { message: 'No autenticado' } };
    const { error } = await supabase
      .from('chat_hides')
      .upsert(
        {
          user_id: user.id,
          thread_key: threadKeyStr,
          hidden_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,thread_key' }
      );
    if (error) console.error('[FutFinder] hideThread:', error);
    return { error };
  } catch (e) {
    return { error: e };
  }
}

export async function unhideThread(threadKeyStr) {
  if (!isSupabaseConfigured) return { error: null };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: { message: 'No autenticado' } };
  const { error } = await supabase
    .from('chat_hides')
    .delete()
    .eq('user_id', user.id)
    .eq('thread_key', threadKeyStr);
  return { error };
}

export async function listMyThreads() {
  if (!isSupabaseConfigured) return { data: [], error: null };
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: [], error: null };
    const me = user.id;

    // 0) Hilos escondidos por mí
    const { data: hides } = await supabase
      .from('chat_hides')
      .select('thread_key, hidden_at')
      .eq('user_id', me);
    const hiddenMap = new Map((hides || []).map((h) => [h.thread_key, h.hidden_at]));

    // 1) Mis inscripciones (SIN join para evitar problemas de FK detection)
    const { data: myAttendances, error: aErr } = await supabase
      .from('attendees')
      .select('id_partido, inscrito_at')
      .eq('id_jugador', me)
      .order('inscrito_at', { ascending: false });

    if (aErr) {
      console.error('[FutFinder] listMyThreads attendances:', aErr);
      return { data: [], error: aErr };
    }

    // 2) Trae datos de los partidos en una sola query
    const matchIds = (myAttendances || [])
      .map((a) => a.id_partido)
      .filter(Boolean);

    let matchesById = new Map();
    if (matchIds.length > 0) {
      const { data: ms, error: mErr } = await supabase
        .from('matches')
        .select('id, titulo, comuna, cancha_nombre, hora, estado, id_organizador, foto_url')
        .in('id', matchIds);
      if (mErr) {
        console.error('[FutFinder] listMyThreads matches:', mErr);
        return { data: [], error: mErr };
      }
      for (const m of ms || []) matchesById.set(m.id, m);
    }

    // 3) Último mensaje por partido
    const lastByMatch = new Map();
    if (matchIds.length > 0) {
      const { data: matchMsgs, error: mmErr } = await supabase
        .from('messages')
        .select('id, content, created_at, sender_id, match_id')
        .in('match_id', matchIds)
        .order('created_at', { ascending: false })
        .limit(200);
      if (mmErr) {
        console.error('[FutFinder] listMyThreads match msgs:', mmErr);
        // No retornamos error — el chat puede mostrarse sin último mensaje
      } else {
        for (const msg of matchMsgs || []) {
          if (!lastByMatch.has(msg.match_id)) lastByMatch.set(msg.match_id, msg);
        }
      }
    }

    const matchThreads = (myAttendances || [])
      .map((a) => {
        const match = matchesById.get(a.id_partido);
        if (!match) return null;
        const last = lastByMatch.get(a.id_partido);
        return {
          key: threadKey({ type: 'match', id: a.id_partido }),
          type: 'match',
          match_id: a.id_partido,
          title: match.titulo || 'Partido',
          subtitle:
            (match.cancha_nombre || '') +
            (match.comuna ? ` · ${match.comuna}` : ''),
          is_organizer: match.id_organizador === me,
          foto_url: match.foto_url || null,
          last_message: last || null,
          last_at: last?.created_at || match.hora || a.inscrito_at,
          unread: 0,
        };
      })
      .filter(Boolean);

    // 4) DMs — query simple, agrupamos en JS
    const { data: dms, error: dmErr } = await supabase
      .from('messages')
      .select('id, created_at, sender_id, receiver_id, content, read_at')
      .is('match_id', null)
      .or(`sender_id.eq.${me},receiver_id.eq.${me}`)
      .order('created_at', { ascending: false })
      .limit(200);

    if (dmErr) {
      console.error('[FutFinder] listMyThreads DMs:', dmErr);
      // Si la tabla messages no existe, devolvemos solo match threads
      return { data: matchThreads, error: dmErr };
    }

    // 5) Resolver usernames de DMs en una sola query
    const otherIds = new Set();
    for (const m of dms || []) {
      const other = m.sender_id === me ? m.receiver_id : m.sender_id;
      if (other) otherIds.add(other);
    }
    let userById = new Map();
    if (otherIds.size > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, username, foto_url')
        .in('id', Array.from(otherIds));
      for (const p of profs || []) userById.set(p.id, p);
    }

    const dmMap = new Map();
    for (const m of dms || []) {
      const otherId = m.sender_id === me ? m.receiver_id : m.sender_id;
      if (!otherId) continue;
      const key = threadKey({ type: 'dm', id: otherId });
      if (!dmMap.has(key)) {
        const other = userById.get(otherId);
        dmMap.set(key, {
          key,
          type: 'dm',
          other_id: otherId,
          other_username: other?.username || 'jugador',
          other_foto: other?.foto_url || null,
          foto_url: other?.foto_url || null,
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

    const all = [...matchThreads, ...dmMap.values()]
      // Filtrar hilos escondidos cuando no hay actividad posterior
      .filter((t) => {
        const hiddenAt = hiddenMap.get(t.key);
        if (!hiddenAt) return true;
        const lastAt = t.last_at ? new Date(t.last_at).getTime() : 0;
        const hiddenAtTs = new Date(hiddenAt).getTime();
        // Reaparece si hubo actividad posterior a cuando lo escondí
        return lastAt > hiddenAtTs;
      })
      .sort((a, b) => new Date(b.last_at) - new Date(a.last_at));
    return { data: all, error: null };
  } catch (e) {
    console.error('[FutFinder] listMyThreads exception:', e);
    return { data: [], error: e };
  }
}

/**
 * Devuelve el historial de un hilo (newest last) sin JOIN de PostgREST.
 * Resolvemos senders en una query aparte para evitar errores raros
 * de FK detection cuando el partido tiene varios senders.
 * Retorna { data, error } para que la pantalla pueda diferenciar.
 */
export async function listThreadMessages(threadKeyStr, { limit = 50 } = {}) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  try {
    const t = parseThreadKey(threadKeyStr);
    if (!t) return { data: [], error: { message: 'Hilo inválido' } };

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: [], error: { message: 'No autenticado' } };
    const me = user.id;

    let q = supabase
      .from('messages')
      .select('id, created_at, sender_id, receiver_id, match_id, content, read_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (t.type === 'dm') {
      q = q
        .is('match_id', null)
        .or(
          `and(sender_id.eq.${me},receiver_id.eq.${t.id}),` +
          `and(sender_id.eq.${t.id},receiver_id.eq.${me})`
        );
    } else if (t.type === 'match') {
      q = q.eq('match_id', t.id);
    } else {
      return { data: [], error: { message: 'Tipo de hilo desconocido' } };
    }

    const { data, error } = await q;
    if (error) {
      console.error('[FutFinder] listThreadMessages:', error);
      return { data: [], error };
    }

    const messages = (data || []).reverse(); // antiguo → nuevo

    // Resolver senders en una sola query (para mostrar @username en grupos)
    if (t.type === 'match' && messages.length > 0) {
      const senderIds = Array.from(
        new Set(messages.map((m) => m.sender_id).filter(Boolean))
      );
      if (senderIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, username, foto_url')
          .in('id', senderIds);
        const byId = new Map((profs || []).map((p) => [p.id, p]));
        for (const m of messages) {
          const s = byId.get(m.sender_id);
          if (s) m.sender = s;
        }
      }
    }

    return { data: messages, error: null };
  } catch (e) {
    console.error('[FutFinder] listThreadMessages exception:', e);
    return { data: [], error: e };
  }
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
    .select('id, created_at, sender_id, receiver_id, match_id, content, read_at')
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
