import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Servicio de mensajería en tiempo real.
 *
 * Tipos de hilo (thread):
 *  - DM (1-a-1):    threadKey = 'dm:<userId>'   target = { receiver_id }
 *  - Match grupal:  threadKey = 'match:<matchId>' target = { match_id }
 *  - Club:          threadKey = 'club:<clubId>'  target = { club_id }
 *
 * ESTADO DE LECTURA Y SILENCIO (migración 32)
 * -------------------------------------------
 * Los no leídos se calculan contra `chat_reads`: una fila por usuario y
 * conversación con `last_read_at`. Es un marcador AGREGADO, así que abrir un
 * chat de 200 mensajes escribe una fila, no 200.
 *
 * `chat_mutes` guarda las conversaciones silenciadas. El silencio es por
 * usuario: no afecta a los demás participantes ni impide recibir el mensaje
 * dentro de la app, solo lo saca del badge del tab.
 *
 * Mientras la migración 32 no esté aplicada, el servicio degrada solo: los
 * no leídos de club caen al marcador local en AsyncStorage que existía antes
 * y silenciar responde "no disponible" en vez de reventar la pantalla.
 */

export function threadKey({ type, id }) {
  return `${type}:${id}`;
}

export function parseThreadKey(key) {
  if (!key) return null;
  const [type, id] = key.split(':');
  return { type, id };
}

/** Longitud máxima de un mensaje. Debe coincidir con el CHECK de la BD. */
export const MAX_MESSAGE_LENGTH = 1000;

// Los comandos del compositor viven en `utils/chatMeta` porque son lógica
// pura y así se pueden probar sin levantar Supabase. Se reexportan para que
// las pantallas sigan importando todo lo del chat desde este servicio.
export { CHAT_COMMANDS, parseComposerCommand, suggestCommands } from '../utils/chatMeta';

// ============================================================
// TOLERANCIA A MIGRACIONES SIN APLICAR
// ============================================================

/** `true` si el error significa "esa tabla/columna todavía no existe". */
function esFaltaDeEsquema(error) {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST202') return true;
  if (error.code === '42703') return true; // columna inexistente
  return /does not exist|could not find/i.test(error.message || '');
}

let _v32 = null; // null = sin comprobar | true | false

/** ¿Está aplicada la migración 32 (chat_reads / chat_mutes / is_important)? */
async function tieneEsquemaV32() {
  if (_v32 !== null) return _v32;
  if (!isSupabaseConfigured) {
    _v32 = false;
    return _v32;
  }
  const { error } = await supabase.from('chat_reads').select('thread_key').limit(1);
  _v32 = !esFaltaDeEsquema(error);
  if (!_v32) {
    console.warn(
      '[FutFinder] Chat: falta la migración 32 (chat_reads / chat_mutes / is_important). ' +
        'Los no leídos del club caen al marcador local y silenciar queda deshabilitado.'
    );
  }
  return _v32;
}

async function getMe() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id || null;
}

// ============================================================
// OCULTAR HILOS (chat_hides) — comportamiento existente
// ============================================================

/**
 * Esconde un hilo de mi vista (chat_hides). Si después llega un mensaje
 * más nuevo, el hilo reaparece automáticamente.
 */
export async function hideThread(threadKeyStr) {
  if (!isSupabaseConfigured) return { error: null };
  try {
    const me = await getMe();
    if (!me) return { error: { message: 'No autenticado' } };
    const { error } = await supabase
      .from('chat_hides')
      .upsert(
        {
          user_id: me,
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
  const me = await getMe();
  if (!me) return { error: { message: 'No autenticado' } };
  const { error } = await supabase
    .from('chat_hides')
    .delete()
    .eq('user_id', me)
    .eq('thread_key', threadKeyStr);
  return { error };
}

// ============================================================
// SILENCIAR CONVERSACIÓN (chat_mutes)
// ============================================================

/** Conjunto de thread_keys silenciados por mí. */
export async function listMutedThreads() {
  const empty = new Set();
  if (!isSupabaseConfigured) return { data: empty, error: null };
  if (!(await tieneEsquemaV32())) return { data: empty, error: null };

  const me = await getMe();
  if (!me) return { data: empty, error: null };

  const { data, error } = await supabase
    .from('chat_mutes')
    .select('thread_key')
    .eq('user_id', me);
  if (error) {
    console.error('[FutFinder] listMutedThreads:', error);
    return { data: empty, error };
  }
  return { data: new Set((data || []).map((r) => r.thread_key)), error: null };
}

export async function isThreadMuted(threadKeyStr) {
  const { data } = await listMutedThreads();
  return data.has(threadKeyStr);
}

/** Silencia o reactiva una conversación. `muted` es el estado deseado. */
export async function setThreadMuted(threadKeyStr, muted) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  if (!(await tieneEsquemaV32())) {
    return { error: { message: 'Silenciar no está disponible: aplica la migración 32 en Supabase.' } };
  }
  const me = await getMe();
  if (!me) return { error: { message: 'No autenticado' } };

  if (muted) {
    const { error } = await supabase
      .from('chat_mutes')
      .upsert({ user_id: me, thread_key: threadKeyStr }, { onConflict: 'user_id,thread_key' });
    if (error) console.error('[FutFinder] setThreadMuted(on):', error);
    return { error };
  }

  const { error } = await supabase
    .from('chat_mutes')
    .delete()
    .eq('user_id', me)
    .eq('thread_key', threadKeyStr);
  if (error) console.error('[FutFinder] setThreadMuted(off):', error);
  return { error };
}

// ============================================================
// NO LEÍDOS
// ============================================================

/**
 * No leídos por conversación, en UNA sola query agregada.
 * @returns {{ data: Map<string, {unread:number, hasImportant:boolean}>, error }}
 */
export async function getUnreadByThread() {
  const empty = new Map();
  if (!isSupabaseConfigured) return { data: empty, error: null };
  if (!(await tieneEsquemaV32())) return { data: empty, error: null };

  const { data, error } = await supabase.rpc('get_chat_unread_counts');
  if (error) {
    if (esFaltaDeEsquema(error)) return { data: empty, error: null };
    console.error('[FutFinder] getUnreadByThread:', error);
    return { data: empty, error };
  }
  const map = new Map();
  for (const row of data || []) {
    map.set(row.thread_key, {
      unread: Number(row.unread) || 0,
      hasImportant: !!row.has_important,
    });
  }
  return { data: map, error: null };
}

/**
 * Marca una conversación como leída (marcador agregado, 1 escritura).
 * En DMs además actualiza `read_at` para el doble check del emisor.
 */
export async function markThreadAsRead(threadKeyStr) {
  if (!isSupabaseConfigured || !threadKeyStr) return;
  const t = parseThreadKey(threadKeyStr);
  if (!t) return;

  if (await tieneEsquemaV32()) {
    const { error } = await supabase.rpc('mark_chat_read', { p_thread_key: threadKeyStr });
    if (!error) return;
    if (!esFaltaDeEsquema(error)) console.error('[FutFinder] markThreadAsRead:', error);
  }

  // Camino antiguo (migración 32 sin aplicar).
  // OJO: aquí se escribe el marcador local directamente en vez de llamar a
  // `markClubChatRead`, porque esa función delega de vuelta en esta cuando la
  // migración 32 SÍ está aplicada y las dos se llamarían en bucle si la RPC
  // falla por algo que no sea el esquema (p. ej. un corte de red).
  if (t.type === 'club') {
    await setClubReadMarker(t.id);
    return;
  }
  if (t.type === 'dm') {
    await supabase.rpc('mark_thread_as_read', { p_other_user_id: t.id, p_match_id: null });
  }
}

/**
 * Total de no leídos para el badge del tab Chat. Las conversaciones
 * silenciadas no suman, salvo que tengan un aviso /importante sin leer.
 */
export async function countUnreadTotal() {
  if (!isSupabaseConfigured) return 0;

  if (await tieneEsquemaV32()) {
    const { data, error } = await supabase.rpc('get_chat_unread_total');
    if (!error) return Number(data) || 0;
    if (!esFaltaDeEsquema(error)) console.error('[FutFinder] countUnreadTotal:', error);
  }

  // Camino antiguo: solo DMs sin leer
  const me = await getMe();
  if (!me) return 0;
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('receiver_id', me)
    .is('read_at', null)
    .is('match_id', null);
  if (error) return 0;
  return count || 0;
}

// ============================================================
// CHAT DE CLUB — marcador local (compatibilidad con ClubsScreen)
// ============================================================

const clubReadKey = (clubId) => `club_chat_read:${clubId}`;

/** Marcador local de última lectura del chat de un club (previo a la mig. 32). */
async function setClubReadMarker(clubId) {
  try {
    await AsyncStorage.setItem(clubReadKey(clubId), new Date().toISOString());
  } catch (e) {
    console.warn('[FutFinder] setClubReadMarker:', e?.message || e);
  }
}

/** Marca el chat de un club como leído. */
export async function markClubChatRead(clubId) {
  if (!clubId) return;
  if (await tieneEsquemaV32()) {
    await markThreadAsRead(threadKey({ type: 'club', id: clubId }));
    return;
  }
  await setClubReadMarker(clubId);
}

/** Mensajes sin leer del chat de un club. Devuelve { data: number, error }. */
export async function getClubUnreadCount(clubId) {
  if (!isSupabaseConfigured || !clubId) return { data: 0, error: null };

  if (await tieneEsquemaV32()) {
    const { data } = await getUnreadByThread();
    return { data: data.get(threadKey({ type: 'club', id: clubId }))?.unread || 0, error: null };
  }

  const me = await getMe();
  if (!me) return { data: 0, error: null };

  let lastRead = null;
  try {
    lastRead = await AsyncStorage.getItem(clubReadKey(clubId));
  } catch {}

  let q = supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', clubId)
    .neq('sender_id', me);
  if (lastRead) q = q.gt('created_at', lastRead);

  const { count, error } = await q;
  if (error) {
    console.error('[FutFinder] getClubUnreadCount:', error);
    return { data: 0, error };
  }
  return { data: count || 0, error: null };
}

// ============================================================
// PERMISOS DE ACCESO A UNA CONVERSACIÓN
// ============================================================

/**
 * Qué puede hacer el usuario en esta conversación.
 *
 * La UI NO es la que protege el chat: la RLS ya impide leer y escribir donde
 * no corresponde (migraciones 04 y 11). Esto solo evita que la pantalla
 * muestre un compositor que la BD va a rechazar, y da el texto que explica
 * por qué.
 *
 * @returns {{ canRead:boolean, canWrite:boolean, reason:string|null,
 *             title:string|null, message:string|null, isClubAdmin:boolean }}
 */
export async function getThreadAccess(threadKeyStr, { challengeId = null } = {}) {
  const ok = {
    canRead: true,
    canWrite: true,
    reason: null,
    title: null,
    message: null,
    isClubAdmin: false,
  };
  if (!isSupabaseConfigured) return ok;

  const t = parseThreadKey(threadKeyStr);
  if (!t?.id) {
    return {
      ...ok,
      canRead: false,
      canWrite: false,
      reason: 'invalid',
      title: 'Conversación no válida',
      message: 'No pudimos identificar este chat.',
    };
  }

  const me = await getMe();
  if (!me) {
    return {
      ...ok,
      canRead: false,
      canWrite: false,
      reason: 'unauthenticated',
      title: 'Inicia sesión',
      message: 'Necesitas tu cuenta para ver este chat.',
    };
  }

  if (t.type === 'club') {
    const { data, error } = await supabase
      .from('club_members')
      .select('rol')
      .eq('club_id', t.id)
      .eq('user_id', me)
      .maybeSingle();
    if (error) console.error('[FutFinder] getThreadAccess(club):', error);
    if (!data) {
      return {
        ...ok,
        canRead: false,
        canWrite: false,
        reason: 'not_member',
        title: 'Este chat es solo para el club',
        message: 'Únete al club para leer y escribir en su chat.',
      };
    }
    return { ...ok, isClubAdmin: data.rol === 'admin' };
  }

  if (t.type === 'match') {
    const { data, error } = await supabase
      .from('attendees')
      .select('id, estado')
      .eq('id_partido', t.id)
      .eq('id_jugador', me)
      .maybeSingle();
    if (error) console.error('[FutFinder] getThreadAccess(match):', error);
    if (!data || data.estado === 'cancelado') {
      return {
        ...ok,
        canRead: false,
        canWrite: false,
        reason: 'not_attendee',
        title: 'No estás inscrito en este partido',
        message: 'El chat es solo para el organizador y los jugadores inscritos.',
      };
    }
    return ok;
  }

  if (t.type === 'dm') {
    if (t.id === me) {
      return {
        ...ok,
        canRead: false,
        canWrite: false,
        reason: 'self',
        title: 'No puedes chatear contigo',
        message: null,
      };
    }
    // Los chats de desafío entre clubes se permiten aunque no sean amigos.
    if (challengeId) return ok;

    const { data } = await supabase
      .from('friendships')
      .select('status')
      .or(
        `and(requester_id.eq.${me},addressee_id.eq.${t.id}),` +
        `and(requester_id.eq.${t.id},addressee_id.eq.${me})`
      )
      .order('created_at', { ascending: false })
      .limit(1);
    const status = data?.[0]?.status;
    if (status === 'blocked') {
      return {
        ...ok,
        canRead: false,
        canWrite: false,
        reason: 'blocked',
        title: 'Conversación no disponible',
        message: null,
      };
    }
    if (status !== 'accepted') {
      return {
        ...ok,
        canWrite: false,
        reason: 'not_friends',
        title: 'Solo lectura',
        message: 'Tienen que ser amigos para escribirse.',
      };
    }
    return ok;
  }

  return {
    ...ok,
    canRead: false,
    canWrite: false,
    reason: 'unknown_type',
    title: 'Conversación no válida',
    message: null,
  };
}

// ============================================================
// LISTADO DE CONVERSACIONES
// ============================================================

/**
 * Lista de conversaciones del usuario:
 *  - Chats de partido: TODO partido en el que esté inscrito (incluso sin
 *    mensajes). Como organizador también aparece, porque el trigger me
 *    agrega como attendee.
 *  - Chats de club: uno por club al que pertenezco.
 *  - DMs: los que tienen al menos un mensaje.
 *
 * Ordenadas por actividad más reciente. Los timestamps son los del servidor
 * (`messages.created_at`), nunca la hora del dispositivo.
 */
export async function listMyThreads() {
  if (!isSupabaseConfigured) return { data: [], error: null };
  try {
    const me = await getMe();
    if (!me) return { data: [], error: null };

    const v32 = await tieneEsquemaV32();
    const msgCols = v32
      ? 'id, content, created_at, sender_id, is_important'
      : 'id, content, created_at, sender_id';

    // 0) Hilos escondidos, silenciados y no leídos (en paralelo)
    const [{ data: hides }, mutedRes, unreadRes] = await Promise.all([
      supabase.from('chat_hides').select('thread_key, hidden_at').eq('user_id', me),
      listMutedThreads(),
      getUnreadByThread(),
    ]);
    const hiddenMap = new Map((hides || []).map((h) => [h.thread_key, h.hidden_at]));
    const muted = mutedRes.data;
    const unread = unreadRes.data;

    // 1) Mis inscripciones (sin join, para no depender de la detección de FKs)
    const { data: myAttendances, error: aErr } = await supabase
      .from('attendees')
      .select('id_partido, inscrito_at')
      .eq('id_jugador', me)
      .order('inscrito_at', { ascending: false });

    if (aErr) {
      console.error('[FutFinder] listMyThreads attendances:', aErr);
      return { data: [], error: aErr };
    }

    // 2) Datos de los partidos en una sola query
    const matchIds = (myAttendances || []).map((a) => a.id_partido).filter(Boolean);

    const matchesById = new Map();
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
        .select(`${msgCols}, match_id`)
        .in('match_id', matchIds)
        .order('created_at', { ascending: false })
        .limit(300);
      if (mmErr) {
        // El chat puede mostrarse sin el último mensaje: no cortamos la carga.
        console.error('[FutFinder] listMyThreads match msgs:', mmErr);
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
        const last = lastByMatch.get(a.id_partido) || null;
        const key = threadKey({ type: 'match', id: a.id_partido });
        return {
          key,
          type: 'match',
          match_id: a.id_partido,
          title: match.titulo || 'Partido',
          subtitle:
            (match.cancha_nombre || '') + (match.comuna ? ` · ${match.comuna}` : ''),
          hora: match.hora || null,
          estado: match.estado || null,
          is_organizer: match.id_organizador === me,
          foto_url: match.foto_url || null,
          last_message: last,
          last_at: last?.created_at || match.hora || a.inscrito_at,
          unread: unread.get(key)?.unread || 0,
          has_important: unread.get(key)?.hasImportant || false,
          muted: muted.has(key),
        };
      })
      .filter(Boolean);

    // 4) Chats de mis clubes (hasta 3)
    const clubThreads = [];
    const { data: myMemberships } = await supabase
      .from('club_members')
      .select('club_id, rol, joined_at')
      .eq('user_id', me);

    if (myMemberships && myMemberships.length > 0) {
      const joinedById = new Map(myMemberships.map((m) => [m.club_id, m.joined_at]));
      const rolById = new Map(myMemberships.map((m) => [m.club_id, m.rol]));
      const myClubIds = myMemberships.map((m) => m.club_id);

      const [{ data: myClubsData }, { data: clubMsgs }, { data: clubMemberRows }] =
        await Promise.all([
          supabase.from('clubs').select('id, nombre, foto_url, comuna').in('id', myClubIds),
          supabase
            .from('messages')
            .select(`${msgCols}, club_id`)
            .in('club_id', myClubIds)
            .order('created_at', { ascending: false })
            .limit(300),
          supabase.from('club_members').select('club_id').in('club_id', myClubIds),
        ]);

      const lastByClub = new Map();
      for (const msg of clubMsgs || []) {
        if (!lastByClub.has(msg.club_id)) lastByClub.set(msg.club_id, msg);
      }
      const countByClub = new Map();
      for (const row of clubMemberRows || []) {
        countByClub.set(row.club_id, (countByClub.get(row.club_id) || 0) + 1);
      }

      for (const club of myClubsData || []) {
        const last = lastByClub.get(club.id) || null;
        const key = threadKey({ type: 'club', id: club.id });
        clubThreads.push({
          key,
          type: 'club',
          club_id: club.id,
          title: club.nombre,
          subtitle: 'Chat del club' + (club.comuna ? ` · ${club.comuna}` : ''),
          member_count: countByClub.get(club.id) || 1,
          my_role: rolById.get(club.id) || 'jugador',
          foto_url: club.foto_url || null,
          last_message: last,
          last_at: last?.created_at || joinedById.get(club.id),
          unread: unread.get(key)?.unread || 0,
          has_important: unread.get(key)?.hasImportant || false,
          muted: muted.has(key),
        });
      }
    }

    // 5) DMs — query simple, agrupamos en JS
    const { data: dms, error: dmErr } = await supabase
      .from('messages')
      .select(`${msgCols}, receiver_id, read_at`)
      .is('match_id', null)
      // No filtramos club_id aquí para no romper si la migración 11 no está
      // aplicada; los mensajes de club se descartan porque receiver_id es null.
      .or(`sender_id.eq.${me},receiver_id.eq.${me}`)
      .order('created_at', { ascending: false })
      .limit(300);

    if (dmErr) {
      console.error('[FutFinder] listMyThreads DMs:', dmErr);
      return { data: [...matchThreads, ...clubThreads], error: dmErr };
    }

    const dmMap = new Map();
    for (const m of dms || []) {
      const otherId = m.sender_id === me ? m.receiver_id : m.sender_id;
      if (!otherId) continue;
      const key = threadKey({ type: 'dm', id: otherId });
      if (dmMap.has(key)) continue;
      dmMap.set(key, {
        key,
        type: 'dm',
        other_id: otherId,
        last_message: m,
        last_at: m.created_at,
        unread: unread.get(key)?.unread || 0,
        has_important: false,
        muted: muted.has(key),
      });
    }

    // 6) Resolver perfiles en UNA query: el otro usuario de cada DM y el
    //    remitente del último mensaje de cada grupo (el diseño muestra
    //    "Camilo: ..." / "Tú: ...").
    const needProfiles = new Set();
    for (const th of dmMap.values()) needProfiles.add(th.other_id);
    for (const th of [...matchThreads, ...clubThreads]) {
      if (th.last_message?.sender_id) needProfiles.add(th.last_message.sender_id);
    }
    needProfiles.delete(me);

    const profileById = new Map();
    if (needProfiles.size > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, username, foto_url')
        .in('id', Array.from(needProfiles));
      for (const p of profs || []) profileById.set(p.id, p);
    }

    for (const th of dmMap.values()) {
      const other = profileById.get(th.other_id);
      th.other_username = other?.username || 'jugador';
      th.other_foto = other?.foto_url || null;
      th.foto_url = other?.foto_url || null;
      th.title = '@' + (other?.username || 'jugador');
      th.subtitle = 'Amigos';
    }
    for (const th of [...matchThreads, ...clubThreads]) {
      const senderId = th.last_message?.sender_id;
      if (!senderId) continue;
      th.last_sender_name =
        senderId === me ? 'Tú' : profileById.get(senderId)?.username || 'Jugador';
      th.last_sender_is_me = senderId === me;
    }

    const all = [...matchThreads, ...clubThreads, ...dmMap.values()]
      // Filtrar hilos escondidos cuando no hay actividad posterior
      .filter((t) => {
        const hiddenAt = hiddenMap.get(t.key);
        if (!hiddenAt) return true;
        const lastAt = t.last_at ? new Date(t.last_at).getTime() : 0;
        return lastAt > new Date(hiddenAt).getTime();
      })
      .sort((a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0));

    return { data: all, error: null };
  } catch (e) {
    console.error('[FutFinder] listMyThreads exception:', e);
    return { data: [], error: e };
  }
}

// ============================================================
// MENSAJES DE UN HILO
// ============================================================

/**
 * Historial de un hilo (antiguo → nuevo), paginado hacia atrás.
 *
 * @param {string} threadKeyStr
 * @param {{ limit?: number, before?: string }} opts
 *        `before` = created_at ISO del mensaje más antiguo ya cargado.
 * @returns {{ data: object[], hasMore: boolean, error }}
 */
export async function listThreadMessages(threadKeyStr, { limit = 40, before = null } = {}) {
  if (!isSupabaseConfigured) return { data: [], hasMore: false, error: null };
  try {
    const t = parseThreadKey(threadKeyStr);
    if (!t) return { data: [], hasMore: false, error: { message: 'Hilo inválido' } };

    const me = await getMe();
    if (!me) return { data: [], hasMore: false, error: { message: 'No autenticado' } };

    const v32 = await tieneEsquemaV32();
    const baseCols =
      'id, created_at, sender_id, receiver_id, match_id, content, read_at' +
      (v32 ? ', is_important' : '');

    // Pedimos uno de más para saber si quedan mensajes anteriores.
    let q = supabase
      .from('messages')
      .select(t.type === 'club' ? `${baseCols}, club_id` : baseCols)
      .order('created_at', { ascending: false })
      .limit(limit + 1);

    if (before) q = q.lt('created_at', before);

    if (t.type === 'dm') {
      q = q
        .is('match_id', null)
        .or(
          `and(sender_id.eq.${me},receiver_id.eq.${t.id}),` +
          `and(sender_id.eq.${t.id},receiver_id.eq.${me})`
        );
    } else if (t.type === 'match') {
      q = q.eq('match_id', t.id);
    } else if (t.type === 'club') {
      q = q.eq('club_id', t.id);
    } else {
      return { data: [], hasMore: false, error: { message: 'Tipo de hilo desconocido' } };
    }

    const { data, error } = await q;
    if (error) {
      console.error('[FutFinder] listThreadMessages:', error);
      return { data: [], hasMore: false, error };
    }

    const rows = data || [];
    const hasMore = rows.length > limit;
    const page = (hasMore ? rows.slice(0, limit) : rows).reverse(); // antiguo → nuevo

    // Resolver remitentes en una sola query (para el nombre en los grupos)
    if ((t.type === 'match' || t.type === 'club') && page.length > 0) {
      const senderIds = Array.from(new Set(page.map((m) => m.sender_id).filter(Boolean)));
      if (senderIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, username, foto_url')
          .in('id', senderIds);
        const byId = new Map((profs || []).map((p) => [p.id, p]));
        for (const m of page) {
          const s = byId.get(m.sender_id);
          if (s) m.sender = s;
        }
      }
    }

    return { data: page, hasMore, error: null };
  } catch (e) {
    console.error('[FutFinder] listThreadMessages exception:', e);
    return { data: [], hasMore: false, error: e };
  }
}

/**
 * Envía un mensaje al hilo. El timestamp y el autor los pone el servidor.
 *
 * @param {string} threadKeyStr
 * @param {string} content
 * @param {{ important?: boolean }} opts
 * @returns {{ data, error }}
 */
export async function sendMessage(threadKeyStr, content, { important = false } = {}) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };

  const cleaned = (content || '').trim();
  if (!cleaned) return { data: null, error: { message: 'Mensaje vacío' } };
  if (cleaned.length > MAX_MESSAGE_LENGTH) {
    return {
      data: null,
      error: { message: `El mensaje no puede superar los ${MAX_MESSAGE_LENGTH} caracteres` },
    };
  }

  const t = parseThreadKey(threadKeyStr);
  if (!t) return { data: null, error: { message: 'Hilo inválido' } };

  const me = await getMe();
  if (!me) return { data: null, error: { message: 'No autenticado' } };

  const v32 = await tieneEsquemaV32();

  // Sin la columna `is_important` el aviso se enviaría como un mensaje normal
  // y nadie sabría que no rompió el silencio. Mejor decirlo que fingirlo.
  if (important && !v32) {
    return {
      data: null,
      error: {
        message:
          'Los avisos /importante no están disponibles todavía: aplica la migración 32 en Supabase.',
      },
    };
  }
  if (important && t.type !== 'club') {
    return {
      data: null,
      error: { message: 'Los avisos /importante solo existen en el chat del club' },
    };
  }

  const payload = { sender_id: me, content: cleaned };
  if (t.type === 'dm') payload.receiver_id = t.id;
  else if (t.type === 'match') payload.match_id = t.id;
  else if (t.type === 'club') payload.club_id = t.id;
  if (important) payload.is_important = true;

  const baseCols =
    'id, created_at, sender_id, receiver_id, match_id, content, read_at' +
    (v32 ? ', is_important' : '');

  const { data, error } = await supabase
    .from('messages')
    .insert(payload)
    .select(t.type === 'club' ? `${baseCols}, club_id` : baseCols)
    .single();

  if (error) console.error('[FutFinder] sendMessage:', error);
  return { data, error };
}

// ============================================================
// PARTICIPANTES DE UNA CONVERSACIÓN
// ============================================================

/**
 * Participantes del hilo, ya normalizados para la pantalla de detalles.
 * Cada fila: { user_id, username, foto_url, trust_score, posicion_preferida,
 *              role: 'admin'|'organizador'|'jugador'|null, is_me }
 */
export async function getThreadParticipants(threadKeyStr) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  const t = parseThreadKey(threadKeyStr);
  if (!t?.id) return { data: [], error: null };

  const me = await getMe();

  const decorate = (rows, roleOf) =>
    rows.map((r) => ({
      user_id: r.user_id,
      username: r.username || 'jugador',
      foto_url: r.foto_url || null,
      trust_score: r.trust_score,
      asistencias_confirmadas: r.asistencias_confirmadas,
      posicion_preferida: r.posicion_preferida || [],
      role: roleOf(r),
      is_me: r.user_id === me,
    }));

  if (t.type === 'club') {
    const { data: members, error } = await supabase
      .from('club_members')
      .select('user_id, rol')
      .eq('club_id', t.id);
    if (error) {
      console.error('[FutFinder] getThreadParticipants(club):', error);
      return { data: [], error };
    }
    const rows = await hydrateProfiles((members || []).map((m) => m.user_id));
    const rolById = new Map((members || []).map((m) => [m.user_id, m.rol]));
    return {
      data: decorate(rows, (r) => (rolById.get(r.user_id) === 'admin' ? 'admin' : 'jugador')),
      error: null,
    };
  }

  if (t.type === 'match') {
    const [{ data: attendees, error }, { data: match }] = await Promise.all([
      supabase
        .from('attendees')
        .select('id_jugador, estado')
        .eq('id_partido', t.id)
        .neq('estado', 'cancelado'),
      supabase.from('matches').select('id_organizador').eq('id', t.id).maybeSingle(),
    ]);
    if (error) {
      console.error('[FutFinder] getThreadParticipants(match):', error);
      return { data: [], error };
    }
    const rows = await hydrateProfiles((attendees || []).map((a) => a.id_jugador));
    const organizerId = match?.id_organizador || null;
    return {
      data: decorate(rows, (r) => (r.user_id === organizerId ? 'organizador' : 'jugador')),
      error: null,
    };
  }

  // DM: yo y el otro
  const rows = await hydrateProfiles([t.id, me].filter(Boolean));
  return { data: decorate(rows, () => null), error: null };
}

async function hydrateProfiles(ids) {
  const unique = Array.from(new Set((ids || []).filter(Boolean)));
  if (unique.length === 0) return [];
  const { data } = await supabase
    .from('profiles')
    .select('id, username, foto_url, trust_score, posicion_preferida, asistencias_confirmadas')
    .in('id', unique);
  return (data || []).map((p) => ({ ...p, user_id: p.id }));
}

// ============================================================
// REALTIME — suscripciones websocket
// ============================================================

/**
 * Suscribe a INSERTS/UPDATES de la tabla messages.
 * Llama a `onChange(payload)` con cada cambio y devuelve el cleanup.
 *
 * `onStatus(status)` recibe el estado del canal ('SUBSCRIBED', 'CHANNEL_ERROR',
 * 'TIMED_OUT', 'CLOSED') para poder pintar "Reconectando…".
 *
 * Filtramos del lado del cliente porque Supabase Realtime solo admite un
 * filtro `eq` por canal y aquí escuchamos varios hilos a la vez.
 *
 * `channelName` permite que dos pantallas escuchen a la vez sin pisarse: el
 * cliente de Supabase reutiliza el canal que ya existe con ese nombre, y
 * agregarle un `.on()` después de `subscribe()` lanza una excepción. Por eso
 * el nombre por defecto también es único.
 */
let messagesChannelSeq = 0;

export function subscribeToMessages(onChange, { channelName, onStatus } = {}) {
  if (!isSupabaseConfigured) return () => {};

  messagesChannelSeq += 1;
  const name = channelName || `messages:${messagesChannelSeq}`;
  const channel = supabase
    .channel(name)
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
      try {
        onStatus?.(status);
      } catch {}
    });

  return () => {
    try {
      supabase.removeChannel(channel);
    } catch {
      // noop
    }
  };
}

/**
 * Suscribe SOLO a inserts de mensajes de club (para badges de no leídos).
 * Canal con nombre propio para no colisionar con 'public:messages'.
 */
export function subscribeToClubMessages(onInsert) {
  if (!isSupabaseConfigured) return () => {};
  const channel = supabase
    .channel(`club-badges:${(messagesChannelSeq += 1)}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        try {
          if (payload?.new?.club_id) onInsert(payload.new);
        } catch (e) {
          console.error('[FutFinder] club badge handler error:', e);
        }
      }
    )
    .subscribe();
  return () => {
    try {
      supabase.removeChannel(channel);
    } catch {}
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
  if (t.type === 'club') return message.club_id === t.id;
  if (t.type === 'dm') {
    if (message.match_id || message.club_id) return false;
    const pair = [message.sender_id, message.receiver_id].filter(Boolean);
    return pair.includes(myUserId) && pair.includes(t.id);
  }
  return false;
}
