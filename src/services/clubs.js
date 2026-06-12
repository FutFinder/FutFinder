import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Servicio de clubes.
 *
 * Planes: 'estandar' (15 integrantes, 1 admin) | 'premium' (26, 3 admins).
 * Los límites los valida un trigger en la BD (check_club_limits).
 *
 * Ingreso al club (club_join_requests):
 *   tipo 'solicitud'  → el jugador pide entrar, un admin responde
 *   tipo 'invitacion' → un admin invita, el jugador responde
 * Al aprobarse, un trigger crea la membresía automáticamente.
 *
 * Regla: un jugador pertenece a UN solo club (unique en BD).
 */

export const CLUB_LIMITS = {
  estandar: { miembros: 15, admins: 1 },
  premium: { miembros: 26, admins: 3 },
};

async function getMe() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id || null;
}

/** Convierte "Atlético La Reina" → "atletico-la-reina" (URL pública futura). */
function slugify(nombre) {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // saca tildes
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Crea un club y deja al creador como admin.
 */
export async function createClub({ nombre, descripcion, region, comuna }) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const me = await getMe();
  if (!me) return { error: { message: 'No autenticado' } };

  const nombreClean = (nombre || '').trim();
  if (nombreClean.length < 3 || nombreClean.length > 40) {
    return { error: { message: 'El nombre debe tener entre 3 y 40 caracteres' } };
  }

  // Un jugador, un club
  const { data: existing } = await supabase
    .from('club_members')
    .select('id')
    .eq('user_id', me)
    .maybeSingle();
  if (existing) {
    return { error: { message: 'Ya perteneces a un club. Debes salir antes de crear otro.' } };
  }

  const { data: club, error } = await supabase
    .from('clubs')
    .insert({
      nombre: nombreClean,
      slug: slugify(nombreClean),
      descripcion: descripcion?.trim() || null,
      region: region || null,
      comuna: comuna || null,
      created_by: me,
    })
    .select()
    .single();

  if (error) {
    console.error('[FutFinder] createClub:', error);
    if (error.code === '23505') {
      return { error: { message: 'Ya existe un club con ese nombre' } };
    }
    return { data: null, error };
  }

  // El fundador entra como admin
  const { error: memberError } = await supabase
    .from('club_members')
    .insert({ club_id: club.id, user_id: me, rol: 'admin' });

  if (memberError) {
    console.error('[FutFinder] createClub member:', memberError);
    // rollback manual: el club sin admin no sirve
    await supabase.from('clubs').delete().eq('id', club.id);
    return { data: null, error: memberError };
  }

  return { data: club, error: null };
}

/**
 * Mi club actual (o null si no pertenezco a ninguno).
 * Devuelve { club, miRol, totalMiembros }.
 */
export async function getMyClub() {
  if (!isSupabaseConfigured) return { data: null, error: null };
  const me = await getMe();
  if (!me) return { data: null, error: null };

  const { data: membership, error } = await supabase
    .from('club_members')
    .select('club_id, rol, joined_at')
    .eq('user_id', me)
    .maybeSingle();
  if (error) {
    console.error('[FutFinder] getMyClub:', error);
    return { data: null, error };
  }
  if (!membership) return { data: null, error: null };

  const { data: club, error: clubError } = await supabase
    .from('clubs')
    .select('*')
    .eq('id', membership.club_id)
    .single();
  if (clubError) {
    console.error('[FutFinder] getMyClub club:', clubError);
    return { data: null, error: clubError };
  }

  const { count } = await supabase
    .from('club_members')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', club.id);

  return {
    data: { club, miRol: membership.rol, totalMiembros: count || 1 },
    error: null,
  };
}

/**
 * Detalle de un club por id.
 */
export async function getClubById(clubId) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  const { data, error } = await supabase
    .from('clubs')
    .select('*')
    .eq('id', clubId)
    .single();
  if (error) console.error('[FutFinder] getClubById:', error);
  return { data, error };
}

/**
 * Busca clubes por nombre (para descubrir y solicitar entrar).
 */
export async function searchClubs(query = '') {
  if (!isSupabaseConfigured) return { data: [], error: null };
  let q = supabase
    .from('clubs')
    .select('id, nombre, slug, descripcion, foto_url, region, comuna, plan, verificado')
    // los verificados (Premium) tienen prioridad en búsquedas
    .order('verificado', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30);
  if (query.trim()) q = q.ilike('nombre', `%${query.trim()}%`);

  const { data, error } = await q;
  if (error) {
    console.error('[FutFinder] searchClubs:', error);
    return { data: [], error };
  }

  // cantidad de miembros por club, en una sola query
  const ids = (data || []).map((c) => c.id);
  let countById = new Map();
  if (ids.length > 0) {
    const { data: members } = await supabase
      .from('club_members')
      .select('club_id')
      .in('club_id', ids);
    for (const m of members || []) {
      countById.set(m.club_id, (countById.get(m.club_id) || 0) + 1);
    }
  }

  return {
    data: (data || []).map((c) => ({ ...c, total_miembros: countById.get(c.id) || 0 })),
    error: null,
  };
}

/**
 * Miembros de un club con su perfil y reputación.
 */
export async function listMembers(clubId) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  const { data: members, error } = await supabase
    .from('club_members')
    .select('id, user_id, rol, joined_at')
    .eq('club_id', clubId)
    .order('rol', { ascending: true }) // admins primero
    .order('joined_at', { ascending: true });
  if (error) {
    console.error('[FutFinder] listMembers:', error);
    return { data: [], error };
  }
  if (!members || members.length === 0) return { data: [], error: null };

  const ids = members.map((m) => m.user_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, foto_url, trust_score, posicion_preferida, comuna')
    .in('id', ids);
  const byId = new Map((profiles || []).map((p) => [p.id, p]));

  return {
    data: members.map((m) => ({
      member_id: m.id,
      user_id: m.user_id,
      rol: m.rol,
      joined_at: m.joined_at,
      username: byId.get(m.user_id)?.username || 'jugador',
      foto_url: byId.get(m.user_id)?.foto_url || null,
      trust_score: byId.get(m.user_id)?.trust_score ?? 100,
      posicion_preferida: byId.get(m.user_id)?.posicion_preferida || [],
      comuna: byId.get(m.user_id)?.comuna || null,
    })),
    error: null,
  };
}

/**
 * Solicita unirse a un club (tipo 'solicitud', responde un admin).
 */
export async function requestToJoin(clubId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const me = await getMe();
  if (!me) return { error: { message: 'No autenticado' } };

  const { data: existing } = await supabase
    .from('club_members')
    .select('id')
    .eq('user_id', me)
    .maybeSingle();
  if (existing) {
    return { error: { message: 'Ya perteneces a un club' } };
  }

  const { data, error } = await supabase
    .from('club_join_requests')
    .insert({ club_id: clubId, user_id: me, tipo: 'solicitud' })
    .select()
    .single();
  if (error) {
    console.error('[FutFinder] requestToJoin:', error);
    if (error.code === '23505') {
      return { error: { message: 'Ya tienes una solicitud pendiente en este club' } };
    }
  }
  return { data, error };
}

/**
 * Invita a un jugador al club (tipo 'invitacion', responde el jugador).
 * Solo admins (lo garantiza la RLS).
 */
export async function inviteToClub(clubId, userId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const me = await getMe();
  if (!me) return { error: { message: 'No autenticado' } };

  const { data: alreadyMember } = await supabase
    .from('club_members')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  if (alreadyMember) {
    return { error: { message: 'Ese jugador ya pertenece a un club' } };
  }

  const { data, error } = await supabase
    .from('club_join_requests')
    .insert({ club_id: clubId, user_id: userId, tipo: 'invitacion' })
    .select()
    .single();
  if (error) {
    console.error('[FutFinder] inviteToClub:', error);
    if (error.code === '23505') {
      return { error: { message: 'Ese jugador ya tiene una invitación o solicitud pendiente' } };
    }
  }
  return { data, error };
}

/**
 * Aprueba o rechaza una request (solicitud si soy admin, invitación si soy
 * el invitado). Al aprobar, el trigger de la BD crea la membresía.
 */
export async function respondToRequest(requestId, approve) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { data, error } = await supabase
    .from('club_join_requests')
    .update({
      status: approve ? 'approved' : 'rejected',
      responded_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select()
    .single();
  if (error) {
    console.error('[FutFinder] respondToRequest:', error);
    // el trigger lanza excepción si el club está lleno o el jugador ya tiene club
    if (error.message?.includes('límite')) {
      return { error: { message: error.message } };
    }
    if (error.code === '23505') {
      return { error: { message: 'El jugador ya pertenece a un club' } };
    }
  }
  return { data, error };
}

/**
 * Solicitudes pendientes de un club (vista de admin), con perfil.
 */
export async function listPendingRequests(clubId) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  const { data, error } = await supabase
    .from('club_join_requests')
    .select('id, user_id, tipo, created_at')
    .eq('club_id', clubId)
    .eq('status', 'pending')
    .eq('tipo', 'solicitud')
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[FutFinder] listPendingRequests:', error);
    return { data: [], error };
  }
  if (!data || data.length === 0) return { data: [], error: null };

  const ids = data.map((r) => r.user_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, foto_url, trust_score, comuna')
    .in('id', ids);
  const byId = new Map((profiles || []).map((p) => [p.id, p]));

  return {
    data: data.map((r) => ({
      request_id: r.id,
      user_id: r.user_id,
      created_at: r.created_at,
      username: byId.get(r.user_id)?.username || 'jugador',
      foto_url: byId.get(r.user_id)?.foto_url || null,
      trust_score: byId.get(r.user_id)?.trust_score ?? 100,
      comuna: byId.get(r.user_id)?.comuna || null,
    })),
    error: null,
  };
}

/**
 * Invitaciones pendientes que ME mandaron, con datos del club.
 */
export async function listMyInvitations() {
  if (!isSupabaseConfigured) return { data: [], error: null };
  const me = await getMe();
  if (!me) return { data: [], error: null };

  const { data, error } = await supabase
    .from('club_join_requests')
    .select('id, club_id, created_at')
    .eq('user_id', me)
    .eq('status', 'pending')
    .eq('tipo', 'invitacion')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[FutFinder] listMyInvitations:', error);
    return { data: [], error };
  }
  if (!data || data.length === 0) return { data: [], error: null };

  const ids = data.map((r) => r.club_id);
  const { data: clubs } = await supabase
    .from('clubs')
    .select('id, nombre, foto_url, comuna, plan, verificado')
    .in('id', ids);
  const byId = new Map((clubs || []).map((c) => [c.id, c]));

  return {
    data: data.map((r) => ({
      request_id: r.id,
      club_id: r.club_id,
      created_at: r.created_at,
      club: byId.get(r.club_id) || null,
    })).filter((r) => r.club),
    error: null,
  };
}

/**
 * Cancela mi solicitud pendiente a un club.
 */
export async function cancelRequest(requestId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { error } = await supabase
    .from('club_join_requests')
    .delete()
    .eq('id', requestId);
  if (error) console.error('[FutFinder] cancelRequest:', error);
  return { error };
}

/**
 * Mi solicitud pendiente hacia un club (para saber qué botón mostrar).
 */
export async function getMyRequestTo(clubId) {
  if (!isSupabaseConfigured) return { data: null, error: null };
  const me = await getMe();
  if (!me) return { data: null, error: null };
  const { data, error } = await supabase
    .from('club_join_requests')
    .select('id, tipo, status, created_at')
    .eq('club_id', clubId)
    .eq('user_id', me)
    .eq('status', 'pending')
    .maybeSingle();
  if (error) console.error('[FutFinder] getMyRequestTo:', error);
  return { data, error };
}

/**
 * Salir del club.
 *  - Si soy el último miembro, el club se elimina.
 *  - Si soy admin y quedan otros miembros, no puedo salir (debo
 *    expulsarlos primero o ceder la administración — Premium).
 */
export async function leaveClub() {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const me = await getMe();
  if (!me) return { error: { message: 'No autenticado' } };

  const { data: membership } = await supabase
    .from('club_members')
    .select('id, club_id, rol')
    .eq('user_id', me)
    .maybeSingle();
  if (!membership) return { error: { message: 'No perteneces a ningún club' } };

  const { count } = await supabase
    .from('club_members')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', membership.club_id);

  if (count === 1) {
    // último miembro: se borra el club entero (cascade borra membresía,
    // requests y mensajes del chat)
    const { error } = await supabase.from('clubs').delete().eq('id', membership.club_id);
    if (error) console.error('[FutFinder] leaveClub deleteClub:', error);
    return { error, clubDeleted: true };
  }

  if (membership.rol === 'admin') {
    // ¿quedan otros admins? (posible en Premium)
    const { count: adminCount } = await supabase
      .from('club_members')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', membership.club_id)
      .eq('rol', 'admin');
    if ((adminCount || 0) <= 1) {
      return {
        error: {
          message: 'Eres el único administrador. Expulsa a los miembros o nombra otro admin antes de salir.',
        },
      };
    }
  }

  const { error } = await supabase.from('club_members').delete().eq('id', membership.id);
  if (error) console.error('[FutFinder] leaveClub:', error);
  return { error };
}

/**
 * Expulsa a un miembro (solo admins, lo garantiza la RLS).
 */
export async function removeMember(memberId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { error } = await supabase
    .from('club_members')
    .delete()
    .eq('id', memberId);
  if (error) console.error('[FutFinder] removeMember:', error);
  return { error };
}

/**
 * Promueve un miembro a admin. El trigger check_club_limits valida en la BD
 * el límite de admins del plan (1 Estándar, 3 Premium).
 */
export async function promoteToAdmin(memberId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { data, error } = await supabase
    .from('club_members')
    .update({ rol: 'admin' })
    .eq('id', memberId)
    .select()
    .single();
  if (error) {
    console.error('[FutFinder] promoteToAdmin:', error);
    if (error.message?.includes('límite')) {
      return {
        error: {
          message: 'Tu plan ya alcanzó el límite de administradores. Puedes ceder tu administración o pasar a Premium.',
        },
      };
    }
  }
  return { data, error };
}

/**
 * Cede MI administración a otro miembro: yo paso a jugador y él a admin.
 * Es una RPC atómica (transfer_club_admin) porque en plan Estándar no se
 * puede promover primero (límite de 1 admin) ni degradarse primero (la RLS
 * exigiría seguir siendo admin para promover al otro).
 */
export async function transferAdmin(memberId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { data, error } = await supabase.rpc('transfer_club_admin', {
    p_member_id: memberId,
  });
  if (error) console.error('[FutFinder] transferAdmin:', error);
  return { data, error };
}

/**
 * Actualiza datos editables del club (solo admins, lo garantiza la RLS).
 * plan y verificado NO se tocan desde el cliente.
 */
export async function updateClub(clubId, { nombre, descripcion, region, comuna }) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const patch = {};
  if (nombre !== undefined) {
    const clean = nombre.trim();
    if (clean.length < 3 || clean.length > 40) {
      return { error: { message: 'El nombre debe tener entre 3 y 40 caracteres' } };
    }
    patch.nombre = clean;
    patch.slug = slugify(clean);
  }
  if (descripcion !== undefined) patch.descripcion = descripcion?.trim() || null;
  if (region !== undefined) patch.region = region;
  if (comuna !== undefined) patch.comuna = comuna;

  const { data, error } = await supabase
    .from('clubs')
    .update(patch)
    .eq('id', clubId)
    .select()
    .single();
  if (error) {
    console.error('[FutFinder] updateClub:', error);
    if (error.code === '23505') {
      return { error: { message: 'Ya existe un club con ese nombre' } };
    }
  }
  return { data, error };
}
