import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Servicio de amistades.
 * Estados: 'pending' | 'accepted' | 'rejected' | 'blocked'
 */

async function getMe() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id || null;
}

/**
 * Envía una solicitud de amistad. Si ya existe una relación previa
 * (pending/accepted), no la duplica.
 */
export async function sendFriendRequest(addresseeId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  if (!addresseeId) return { error: { message: 'addresseeId requerido' } };

  const me = await getMe();
  if (!me) return { error: { message: 'No autenticado' } };
  if (me === addresseeId) return { error: { message: 'No puedes agregarte a ti mismo' } };

  // Si ya existe una relación (en cualquier dirección), no creamos otra
  const existing = await getFriendshipWith(addresseeId);
  if (existing) {
    return { data: existing, error: null, existed: true };
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

  if (error) console.error('[FutFinder] sendFriendRequest:', error);
  return { data, error };
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
 * Lista mis amigos (status accepted). Devuelve la otra persona.
 */
export async function listMyFriends() {
  if (!isSupabaseConfigured) return [];
  const me = await getMe();
  if (!me) return [];

  const { data, error } = await supabase
    .from('friendships')
    .select('id, requester_id, addressee_id, status, responded_at')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`)
    .order('responded_at', { ascending: false });
  if (error || !data) return [];

  const otherIds = data.map((f) =>
    f.requester_id === me ? f.addressee_id : f.requester_id
  );
  if (otherIds.length === 0) return [];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, foto_url, trust_score, comuna, region')
    .in('id', otherIds);
  const byId = new Map((profiles || []).map((p) => [p.id, p]));

  return data
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
        comuna: p.comuna,
        region: p.region,
        friends_since: f.responded_at,
      };
    })
    .filter(Boolean);
}

/**
 * Solicitudes pendientes que ME enviaron (las que puedo aceptar/rechazar).
 */
export async function listIncomingRequests() {
  if (!isSupabaseConfigured) return [];
  const me = await getMe();
  if (!me) return [];

  const { data, error } = await supabase
    .from('friendships')
    .select('id, requester_id, created_at')
    .eq('addressee_id', me)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error || !data) return [];

  const ids = data.map((f) => f.requester_id);
  if (ids.length === 0) return [];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, foto_url, trust_score, comuna')
    .in('id', ids);
  const byId = new Map((profiles || []).map((p) => [p.id, p]));

  return data.map((f) => ({
    friendship_id: f.id,
    user_id: f.requester_id,
    username: byId.get(f.requester_id)?.username || 'jugador',
    foto_url: byId.get(f.requester_id)?.foto_url || null,
    trust_score: byId.get(f.requester_id)?.trust_score || 100,
    comuna: byId.get(f.requester_id)?.comuna,
    sent_at: f.created_at,
  }));
}

/**
 * Solicitudes que YO envié y están pendientes (puedo cancelarlas).
 */
export async function listOutgoingRequests() {
  if (!isSupabaseConfigured) return [];
  const me = await getMe();
  if (!me) return [];

  const { data, error } = await supabase
    .from('friendships')
    .select('id, addressee_id, created_at')
    .eq('requester_id', me)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error || !data) return [];

  const ids = data.map((f) => f.addressee_id);
  if (ids.length === 0) return [];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, foto_url')
    .in('id', ids);
  const byId = new Map((profiles || []).map((p) => [p.id, p]));

  return data.map((f) => ({
    friendship_id: f.id,
    user_id: f.addressee_id,
    username: byId.get(f.addressee_id)?.username || 'jugador',
    foto_url: byId.get(f.addressee_id)?.foto_url || null,
    sent_at: f.created_at,
  }));
}

export async function countPendingRequests() {
  if (!isSupabaseConfigured) return 0;
  const { data, error } = await supabase.rpc('count_pending_friend_requests');
  if (error) return 0;
  return data || 0;
}
