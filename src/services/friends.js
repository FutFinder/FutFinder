import { supabase, isSupabaseConfigured } from './supabase';
import {
  describeFriendRequestError,
  PRIVACY_BLOCKED_MESSAGE,
} from '../utils/friendRequestPrivacy';

/**
 * Servicio de amistades.
 * Estados: 'pending' | 'accepted' | 'rejected' | 'blocked'
 */

async function getMe() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id || null;
}

/**
 * Envía una solicitud de amistad.
 *
 * LO QUE ARREGLA. Antes bastaba con que EXISTIERA una fila —en cualquier
 * estado— para devolver `existed: true` sin insertar nada y sin error. Como
 * la interfaz trata 'rejected' y 'blocked' como «sin relación» y sigue
 * ofreciendo «Agregar amigo», el usuario veía el banner «Solicitud enviada»
 * de una solicitud que nunca salió, y podía repetirlo para siempre.
 *
 * Ahora sólo 'pending' y 'accepted' cuentan como «ya existe»: son los dos
 * estados en los que de verdad no hay nada que hacer.
 *
 * UN RECHAZO NO ES PARA SIEMPRE. `friendships_unique_pair` es
 * `(requester_id, addressee_id)` —direccional— y sólo el addressee puede
 * hacer UPDATE (`friendships_update_addressee`, migración 06), así que
 * revivir la fila no es una opción para quien la envió. Borrarla sí: la
 * política de DELETE deja hacerlo a cualquiera de los dos. Se borra y se
 * inserta de nuevo.
 *
 * UN BLOQUEO SÍ LO ES, y no se toca. Borrar una fila 'blocked' sería quitar
 * de en medio la marca del bloqueo con una consulta del cliente. Tampoco se
 * intenta el INSERT: `friendships_insert` lo rechazaría (migración 51 exige
 * `not is_blocked_pair`), pero el índice único podría saltar antes con un
 * «duplicate key» que no explica nada. Se devuelve EL MISMO texto que el
 * bloqueo por privacidad, a propósito: dos mensajes distintos dejarían
 * distinguir «me bloqueó» de «no acepta solicitudes», que es justo lo que el
 * bloqueo no debe revelar.
 */
export async function sendFriendRequest(addresseeId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  if (!addresseeId) return { error: { message: 'addresseeId requerido' } };

  const me = await getMe();
  if (!me) return { error: { message: 'No autenticado' } };
  if (me === addresseeId) return { error: { message: 'No puedes agregarte a ti mismo' } };

  const existing = await getFriendshipWith(addresseeId);

  if (existing && (existing.status === 'pending' || existing.status === 'accepted')) {
    return { data: existing, error: null, existed: true };
  }

  if (existing && existing.status === 'blocked') {
    return {
      data: null,
      error: { message: PRIVACY_BLOCKED_MESSAGE },
      blockedByPrivacy: true,
    };
  }

  if (existing) {
    // 'rejected' (o cualquier estado futuro que no sea de los de arriba): la
    // fila vieja ocupa la clave única y hay que sacarla antes de insertar.
    const { error: errorAlBorrar } = await supabase
      .from('friendships')
      .delete()
      .eq('id', existing.id);
    if (errorAlBorrar) {
      console.error('[FutFinder] sendFriendRequest(limpiar rechazo):', errorAlBorrar);
      return {
        data: null,
        error: { message: 'No pudimos reenviar la solicitud. Intenta de nuevo.' },
      };
    }
  }

  const { data, error } = await supabase
    .from('friendships')
    .insert({
      requester_id: me,
      addressee_id: addresseeId,
      status: 'pending',
    })
    .select()
    .single();

  if (error) {
    console.error('[FutFinder] sendFriendRequest:', error);
    const described = describeFriendRequestError(error);
    return {
      data: null,
      error: { ...error, message: described.message },
      blockedByPrivacy: described.blockedByPrivacy,
    };
  }
  return { data, error: null };
}

/**
 * Acepta la solicitud (solo si soy el addressee).
 */
export async function acceptFriendRequest(friendshipId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { data, error } = await supabase
    .from('friendships')
    .update({
      status: 'accepted',
      responded_at: new Date().toISOString(),
    })
    .eq('id', friendshipId)
    // Sólo si sigue pendiente: una tarjeta vieja —dos dispositivos, un
    // Realtime que llegó tarde— no puede revivir algo ya resuelto.
    .eq('status', 'pending')
    .select()
    .single();
  if (error) console.error('[FutFinder] acceptFriendRequest:', error);
  return { data, error };
}

/**
 * Rechaza la solicitud (solo si soy el addressee).
 */
export async function rejectFriendRequest(friendshipId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { data, error } = await supabase
    .from('friendships')
    .update({
      status: 'rejected',
      responded_at: new Date().toISOString(),
    })
    .eq('id', friendshipId)
    .eq('status', 'pending')
    .select()
    .single();
  if (error) console.error('[FutFinder] rejectFriendRequest:', error);
  return { data, error };
}

/**
 * Cancela mi solicitud pendiente (la borra). Tengo que ser el requester.
 */
export async function cancelFriendRequest(friendshipId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { error } = await supabase
    .from('friendships')
    .delete()
    .eq('id', friendshipId);
  if (error) console.error('[FutFinder] cancelFriendRequest:', error);
  return { error };
}

/**
 * Elimina amistad existente (yo borro de mi lado, queda sin amigos para los dos).
 */
export async function removeFriend(otherUserId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const me = await getMe();
  if (!me) return { error: { message: 'No autenticado' } };
  const { error } = await supabase
    .from('friendships')
    .delete()
    .or(
      `and(requester_id.eq.${me},addressee_id.eq.${otherUserId}),` +
      `and(requester_id.eq.${otherUserId},addressee_id.eq.${me})`
    );
  if (error) console.error('[FutFinder] removeFriend:', error);
  return { error };
}

/**
 * Devuelve la relación de amistad con otro usuario, o null si no existe.
 * Útil para saber qué botón mostrar en su perfil.
 */
export async function getFriendshipWith(otherUserId) {
  if (!isSupabaseConfigured) return null;
  if (!otherUserId) return null;
  const me = await getMe();
  if (!me) return null;
  if (me === otherUserId) return null;

  const { data, error } = await supabase
    .from('friendships')
    .select('id, requester_id, addressee_id, status, created_at, responded_at')
    .or(
      `and(requester_id.eq.${me},addressee_id.eq.${otherUserId}),` +
      `and(requester_id.eq.${otherUserId},addressee_id.eq.${me})`
    )
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0];
}

/**
 * POR QUÉ LAS TRES LISTAS DEVUELVEN `{ data, error }`.
 *
 * Antes devolvían un arreglo pelado y se tragaban el error
 * (`if (error || !data) return []`). Con eso, una red caída o una sesión
 * vencida se veían EXACTAMENTE igual que «no tienes amigos ni solicitudes»:
 * `FriendsScreen` envolvía las llamadas en un try/catch que nunca podía
 * ejecutarse, porque estas funciones no lanzaban nunca, y su estado de error
 * era inalcanzable. La bandeja de chat ya distinguía las dos cosas; esto es
 * ponerlas de acuerdo.
 *
 * El fallo de los PERFILES no se propaga: la lista existe igual y lo que se
 * pierde es el nombre y la foto de alguna fila, no la lista entera.
 */

/** Lista mis amigos (status accepted). Devuelve la otra persona. */
export async function listMyFriends() {
  if (!isSupabaseConfigured) return { data: [], error: null };
  const me = await getMe();
  if (!me) return { data: [], error: null };

  const { data, error } = await supabase
    .from('friendships')
    .select('id, requester_id, addressee_id, status, responded_at')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`)
    .order('responded_at', { ascending: false });
  if (error) {
    console.error('[FutFinder] listMyFriends:', error);
    return { data: [], error };
  }
  if (!data) return { data: [], error: null };

  const otherIds = data.map((f) =>
    f.requester_id === me ? f.addressee_id : f.requester_id
  );
  if (otherIds.length === 0) return { data: [], error: null };

  const { data: profiles } = await supabase
    .from('profiles')
    .select(
      'id, username, foto_url, trust_score, comuna, region, posicion_preferida, asistencias_confirmadas'
    )
    .in('id', otherIds);
  const byId = new Map((profiles || []).map((p) => [p.id, p]));

  const filas = data
    .map((f) => {
      const otherId = f.requester_id === me ? f.addressee_id : f.requester_id;
      const p = byId.get(otherId);
      if (!p) return null;
      return {
        friendship_id: f.id,
        user_id: otherId,
        username: p.username,
        foto_url: p.foto_url,
        trust_score: p.trust_score,
        asistencias_confirmadas: p.asistencias_confirmadas,
        posicion_preferida: p.posicion_preferida || [],
        comuna: p.comuna,
        region: p.region,
        friends_since: f.responded_at,
      };
    })
    .filter(Boolean);
  return { data: filas, error: null };
}

/**
 * Solicitudes pendientes que ME enviaron (las que puedo aceptar/rechazar).
 */
export async function listIncomingRequests() {
  if (!isSupabaseConfigured) return { data: [], error: null };
  const me = await getMe();
  if (!me) return { data: [], error: null };

  const { data, error } = await supabase
    .from('friendships')
    .select('id, requester_id, created_at')
    .eq('addressee_id', me)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[FutFinder] listIncomingRequests:', error);
    return { data: [], error };
  }
  if (!data) return { data: [], error: null };

  const ids = data.map((f) => f.requester_id);
  if (ids.length === 0) return { data: [], error: null };

  const { data: profiles } = await supabase
    .from('profiles')
    .select(
      'id, username, foto_url, trust_score, comuna, region, posicion_preferida, asistencias_confirmadas'
    )
    .in('id', ids);
  const byId = new Map((profiles || []).map((p) => [p.id, p]));

  const filas = data.map((f) => {
    const p = byId.get(f.requester_id);
    return {
      friendship_id: f.id,
      user_id: f.requester_id,
      username: p?.username || 'jugador',
      foto_url: p?.foto_url || null,
      // OJO: sin default 100. trust_score es 100 por defecto en la BD, así que
      // inventarlo aquí haría que un jugador nuevo se vea como confiable.
      trust_score: p?.trust_score ?? null,
      asistencias_confirmadas: p?.asistencias_confirmadas,
      posicion_preferida: p?.posicion_preferida || [],
      comuna: p?.comuna,
      region: p?.region,
      sent_at: f.created_at,
    };
  });
  return { data: filas, error: null };
}

/**
 * Solicitudes que YO envié y están pendientes (puedo cancelarlas).
 */
export async function listOutgoingRequests() {
  if (!isSupabaseConfigured) return { data: [], error: null };
  const me = await getMe();
  if (!me) return { data: [], error: null };

  const { data, error } = await supabase
    .from('friendships')
    .select('id, addressee_id, created_at')
    .eq('requester_id', me)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[FutFinder] listOutgoingRequests:', error);
    return { data: [], error };
  }
  if (!data) return { data: [], error: null };

  const ids = data.map((f) => f.addressee_id);
  if (ids.length === 0) return { data: [], error: null };

  const { data: profiles } = await supabase
    .from('profiles')
    .select(
      'id, username, foto_url, trust_score, comuna, region, posicion_preferida, asistencias_confirmadas'
    )
    .in('id', ids);
  const byId = new Map((profiles || []).map((p) => [p.id, p]));

  const filas = data.map((f) => {
    const p = byId.get(f.addressee_id);
    return {
      friendship_id: f.id,
      user_id: f.addressee_id,
      username: p?.username || 'jugador',
      foto_url: p?.foto_url || null,
      trust_score: p?.trust_score ?? null,
      asistencias_confirmadas: p?.asistencias_confirmadas,
      posicion_preferida: p?.posicion_preferida || [],
      comuna: p?.comuna,
      region: p?.region,
      sent_at: f.created_at,
    };
  });
  return { data: filas, error: null };
}

/**
 * Realtime sobre `friendships`: avisa cuando llega, se acepta o se cancela
 * una solicitud, para refrescar contadores y listas sin recargar a mano.
 * Devuelve la función de limpieza.
 *
 * OJO con el nombre del canal: el cliente de Supabase reutiliza el canal que
 * ya existe con ese nombre, y agregarle un `.on()` después de `subscribe()`
 * lanza una excepción. Como la bandeja y la pantalla de amigos pueden estar
 * montadas a la vez, cada suscripción usa un nombre propio.
 */
let friendshipsChannelSeq = 0;

export function subscribeToFriendships(onChange) {
  if (!isSupabaseConfigured) return () => {};
  friendshipsChannelSeq += 1;
  const channel = supabase
    .channel(`friendships:${friendshipsChannelSeq}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'friendships' },
      (payload) => {
        try {
          onChange(payload);
        } catch (e) {
          console.error('[FutFinder] friendships realtime handler:', e);
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

export async function countPendingRequests() {
  if (!isSupabaseConfigured) return 0;
  const { data, error } = await supabase.rpc('count_pending_friend_requests');
  if (error) return 0;
  return data || 0;
}

/**
 * Estado de amistad con varios usuarios a la vez (1 sola query).
 * Devuelve { data, error } donde data es un Map<userId, {
 *   status: 'none' | 'friends' | 'sent' | 'received',
 *   friendshipId: string | null,
 * }>.
 * Útil para pintar el botón correcto junto a cada integrante de un club.
 */
export async function getFriendshipStatuses(otherIds = []) {
  const result = new Map();
  if (!isSupabaseConfigured) return { data: result, error: null };
  const me = await getMe();
  if (!me) return { data: result, error: null };

  const ids = otherIds.filter((id) => id && id !== me);
  for (const id of ids) result.set(id, { status: 'none', friendshipId: null });
  if (ids.length === 0) return { data: result, error: null };

  const idList = ids.join(',');
  const { data, error } = await supabase
    .from('friendships')
    .select('id, requester_id, addressee_id, status')
    .in('status', ['pending', 'accepted'])
    .or(
      `and(requester_id.eq.${me},addressee_id.in.(${idList})),` +
      `and(addressee_id.eq.${me},requester_id.in.(${idList}))`
    );
  if (error) {
    console.error('[FutFinder] getFriendshipStatuses:', error);
    return { data: result, error };
  }

  for (const f of data || []) {
    const otherId = f.requester_id === me ? f.addressee_id : f.requester_id;
    if (!result.has(otherId)) continue;
    if (f.status === 'accepted') {
      result.set(otherId, { status: 'friends', friendshipId: f.id });
    } else {
      // pending: 'sent' si yo soy el requester, 'received' si me lo enviaron
      result.set(otherId, {
        status: f.requester_id === me ? 'sent' : 'received',
        friendshipId: f.id,
      });
    }
  }

  return { data: result, error: null };
}
