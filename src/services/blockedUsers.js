import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Bloqueo de usuarios (tabla blocked_users, migración 51).
 *
 * ALCANCE ACTUAL — leer antes de construir encima:
 *  - Bloquear corta las solicitudes de amistad futuras (en las dos
 *    direcciones) y el DM existente si ya eran amigos, porque
 *    bloquear_usuario() pasa esa amistad a 'blocked' y la RLS de chat
 *    (migración 36) solo deja pasar 'accepted'.
 *  - NO filtra a la persona bloqueada de búsquedas, partidos ni chats
 *    grupales/de club: sigue viéndose ahí. Si eso hace falta, es un
 *    alcance nuevo, no un bug de esto.
 *  - La RLS de blocked_users solo deja ver/crear/borrar las filas propias
 *    (donde yo soy blocker_id), así que la persona bloqueada nunca puede
 *    detectar el bloqueo ni deshacerlo desde su cliente.
 */

async function getMe() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id || null;
}

/** `true` si el error significa "la migración 51 no está aplicada todavía". */
function faltaLaMigracion(error) {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST202') return true;
  return /blocked_users|bloquear_usuario|desbloquear_usuario/.test(error.message || '');
}

/** Bloquea a otro usuario. */
export async function blockUser(blockedId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  if (!blockedId) return { error: { message: 'Falta el usuario a bloquear' } };

  const { error } = await supabase.rpc('bloquear_usuario', { p_blocked_id: blockedId });
  if (error) {
    if (faltaLaMigracion(error)) {
      console.warn('[FutFinder] blocked_users no existe: aplica la migración 51.');
      return { error: { message: 'El bloqueo de usuarios no está disponible todavía.' } };
    }
    console.error('[FutFinder] blockUser:', error.code || '', error.message || error);
    return { error };
  }
  return { error: null };
}

/** Deshace un bloqueo propio. */
export async function unblockUser(blockedId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  if (!blockedId) return { error: { message: 'Falta el usuario a desbloquear' } };

  const { error } = await supabase.rpc('desbloquear_usuario', { p_blocked_id: blockedId });
  if (error) {
    if (faltaLaMigracion(error)) {
      return { error: { message: 'El bloqueo de usuarios no está disponible todavía.' } };
    }
    console.error('[FutFinder] unblockUser:', error.code || '', error.message || error);
    return { error };
  }
  return { error: null };
}

/** `true` si YO bloqueé a este usuario (no dice si él me bloqueó a mí). */
export async function isBlockedByMe(userId) {
  if (!isSupabaseConfigured || !userId) return false;
  const me = await getMe();
  if (!me) return false;

  const { data, error } = await supabase
    .from('blocked_users')
    .select('id')
    .eq('blocker_id', me)
    .eq('blocked_id', userId)
    .maybeSingle();

  if (error) {
    if (!faltaLaMigracion(error)) {
      console.error('[FutFinder] isBlockedByMe:', error.code || '', error.message || error);
    }
    return false;
  }
  return Boolean(data);
}

/**
 * Lista los usuarios que bloqueé, con su perfil básico para mostrarlos.
 * @returns {{ data: Array<{id, blockedId, blockedAt, profile}>, error }}
 */
export async function listBlockedUsers() {
  if (!isSupabaseConfigured) return { data: [], error: null };

  const { data, error } = await supabase
    .from('blocked_users')
    .select(
      'id, blocked_id, created_at, ' +
        'profile:profiles!blocked_users_blocked_id_fkey(id, username, nombre, foto_url)'
    )
    .order('created_at', { ascending: false });

  if (error) {
    if (faltaLaMigracion(error)) return { data: [], error: null };
    console.error('[FutFinder] listBlockedUsers:', error.code || '', error.message || error);
    return { data: [], error };
  }

  const rows = (data || []).map((r) => ({
    id: r.id,
    blockedId: r.blocked_id,
    blockedAt: r.created_at,
    profile: r.profile || null,
  }));
  return { data: rows, error: null };
}
