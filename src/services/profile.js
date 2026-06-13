import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Servicio de perfil del jugador.
 */

export async function getMyProfile() {
  if (!isSupabaseConfigured) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  if (error) {
    console.error('[FutFinder] getMyProfile:', error);
    return null;
  }
  return { ...data, email: user.email };
}

/**
 * Estado de cuenta del usuario actual para gating de funciones.
 * Devuelve { suspended, trust_score, suspended_until }.
 */
export async function getMyAccountStatus() {
  if (!isSupabaseConfigured) return { suspended: false, trust_score: 100, suspended_until: null };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { suspended: false, trust_score: 100, suspended_until: null };
  const { data } = await supabase
    .from('profiles')
    .select('trust_score, estado, suspended_until')
    .eq('id', user.id)
    .maybeSingle();
  const suspended =
    data?.estado === 'suspendido' &&
    (!data.suspended_until || new Date(data.suspended_until) > new Date());
  return {
    suspended,
    trust_score: data?.trust_score ?? 100,
    suspended_until: data?.suspended_until || null,
  };
}

export async function getProfileById(id) {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return null;
  return data;
}

/**
 * Busca jugadores por username (búsqueda parcial, case-insensitive) + filtros.
 * Excluye al usuario actual. Si query está vacío, devuelve los perfiles
 * con más actividad (orden por trust_score) como sugerencia inicial.
 *
 * filters (todos opcionales):
 *   posicion : 'arquero' | 'defensa' | ... (busca en el array posicion_preferida)
 *   flanco   : 'derecho' | 'izquierdo' | 'ambos'
 *              (derecho/izquierdo incluye también a quienes juegan 'ambos')
 *   edadMin  : number
 *   edadMax  : number
 *   region   : string
 *   comuna   : string
 */
export async function searchPlayers(query, { limit = 30, filters = {} } = {}) {
  if (!isSupabaseConfigured) return { data: [], error: null };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const myId = user?.id || null;

  let q = supabase
    .from('profiles')
    .select(
      'id, username, foto_url, comuna, region, edad, flanco, posicion_preferida, trust_score, rating_count, rating_nivel_avg'
    )
    .limit(limit);

  const term = (query || '').trim();
  if (term.length > 0) {
    q = q.ilike('username', `%${term}%`);
  } else {
    q = q.order('trust_score', { ascending: false });
  }

  // Filtros de ubicación
  if (filters.region) q = q.eq('region', filters.region);
  if (filters.comuna) q = q.eq('comuna', filters.comuna);

  // Filtro de posición (posicion_preferida es un array → "contiene")
  if (filters.posicion) {
    q = q.contains('posicion_preferida', [filters.posicion]);
  }

  // Filtro de flanco: derecho/izquierdo incluye a los 'ambos'
  if (filters.flanco === 'derecho') {
    q = q.in('flanco', ['derecho', 'ambos']);
  } else if (filters.flanco === 'izquierdo') {
    q = q.in('flanco', ['izquierdo', 'ambos']);
  } else if (filters.flanco === 'ambos') {
    q = q.eq('flanco', 'ambos');
  }

  // Filtro de edad (rango)
  if (filters.edadMin != null) q = q.gte('edad', filters.edadMin);
  if (filters.edadMax != null) q = q.lte('edad', filters.edadMax);

  const { data, error } = await q;
  if (error) {
    console.error('[FutFinder] searchPlayers:', error);
    return { data: [], error };
  }

  // Excluir mi propio perfil de los resultados
  const filtered = (data || []).filter((p) => p.id !== myId);
  return { data: filtered, error: null };
}

export async function updateMyProfile(patch) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: { message: 'No autenticado' } };

  // Sanitiza: solo permitimos estos campos desde el cliente.
  const allowed = [
    'username', 'foto_url', 'posicion_preferida', 'flanco',
    'edad', 'bio', 'region', 'comuna',
    'latitud', 'longitud', 'location_updated_at',
    'onboarding_completed',
    'privacy_friend_requests', 'privacy_visible_in_search',
    'notif_matches', 'notif_clubs', 'notif_chat', 'notif_friends',
    'pref_region', 'pref_comuna',
  ];
  const payload = {};
  for (const k of allowed) {
    if (patch[k] !== undefined) payload[k] = patch[k];
  }
  payload.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('profiles')
    .update(payload)
    .eq('id', user.id)
    .select()
    .single();
  return { data, error };
}

/**
 * Marca el onboarding como completado en el perfil del usuario actual.
 * Si pasa coords, también guarda lat/lng como ubicación persistente.
 */
export async function completeOnboarding({ latitud = null, longitud = null } = {}) {
  if (!isSupabaseConfigured) return { error: null };
  const patch = { onboarding_completed: true };
  if (latitud != null && longitud != null) {
    patch.latitud = latitud;
    patch.longitud = longitud;
    patch.location_updated_at = new Date().toISOString();
  }
  return updateMyProfile(patch);
}

/**
 * Guarda la ubicación GPS actual del usuario para no volver a pedirla.
 */
export async function saveMyLocation({ latitud, longitud }) {
  return updateMyProfile({
    latitud, longitud,
    location_updated_at: new Date().toISOString(),
  });
}

/**
 * Devuelve si el usuario actual ya completó el onboarding.
 *  - true  → mandar directo a Main
 *  - false → continuar con LocationPermission/Terms
 *  - null  → no hay sesión iniciada
 */
export async function getOnboardingState() {
  if (!isSupabaseConfigured) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('onboarding_completed, username')
    .eq('id', user.id)
    .single();
  if (error) {
    console.warn('[FutFinder] getOnboardingState:', error.message);
    return false;
  }
  return Boolean(data?.onboarding_completed);
}

/**
 * Trae los últimos N partidos en los que el usuario participó.
 * Devuelve filas con info del match + estado de su asistencia.
 */
export async function getMyAttendanceHistory(limit = 8) {
  if (!isSupabaseConfigured) return [];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('attendees')
    .select(
      'id, estado, inscrito_at, confirmado_at, ' +
      'match:matches(id, titulo, cancha_nombre, comuna, hora)'
    )
    .eq('id_jugador', user.id)
    .order('inscrito_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[FutFinder] getMyAttendanceHistory:', error);
    return [];
  }
  return data || [];
}

/**
 * Estadísticas derivadas en base a profile + attendees.
 * Calcula tasa de asistencia, estrellas, etc. del lado del cliente.
 */
export function deriveStats(profile, history) {
  if (!profile) return null;
  const total = history?.length || 0;
  const confirmados = (history || []).filter((h) => h.estado === 'confirmado_gps').length;
  const tasaAsistencia = total > 0 ? Math.round((confirmados / total) * 100) : 100;

  // Stars: derivamos de trust_score (0-100 → 0-5)
  const starsRaw = (profile.trust_score / 100) * 5;
  const stars = Math.round(starsRaw * 10) / 10; // 1 decimal

  // Estado de la cuenta
  let estadoCuenta = 'Cuenta en buen estado';
  if (profile.trust_score < 60) estadoCuenta = 'Reputación baja — mejora asistiendo';
  else if (profile.trust_score < 40) estadoCuenta = 'Cuenta con observaciones';

  return {
    partidos_jugados: profile.partidos_jugados ?? 0,
    asistencias_confirmadas: profile.asistencias_confirmadas ?? 0,
    mvps: profile.mvps ?? 0,
    trust_score: profile.trust_score ?? 100,
    tasa_asistencia: tasaAsistencia,
    stars,
    total_historial: total,
    confirmados_historial: confirmados,
    estado_cuenta: estadoCuenta,
  };
}
