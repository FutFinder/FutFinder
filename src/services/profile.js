import { supabase, isSupabaseConfigured } from './supabase';
import { buildSearchPlayersQuery } from '../utils/searchPlayersQuery';

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
 * Igual que `getMyProfile()` pero propaga el error en vez de tragárselo
 * como `null` — para pantallas como Editar perfil, que necesitan
 * distinguir "sin sesión" de "falló la carga, hay que reintentar" y así
 * nunca mostrar un formulario vacío por un error de red pasajero.
 * Devuelve { data, error }.
 */
export async function getMyProfileWithStatus() {
  if (!isSupabaseConfigured) return { data: null, error: null };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: { message: 'No autenticado' } };
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  if (error) {
    console.error('[FutFinder] getMyProfileWithStatus:', error);
    return { data: null, error };
  }
  return { data: { ...data, email: user.email }, error: null };
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

  const { data, error } = await buildSearchPlayersQuery(supabase, query, filters, limit);
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
    'username', 'foto_url', 'banner_url', 'posicion_preferida', 'flanco',
    'edad', 'bio', 'region', 'comuna', 'modalidad', 'nivel',
    'latitud', 'longitud', 'location_updated_at',
    'onboarding_completed',
    'privacy_friend_requests', 'privacy_visible_in_search',
    'notif_matches', 'notif_clubs', 'notif_chat', 'notif_friends',
    'pref_region', 'pref_comuna', 'search_radius_km',
  ];
  const payload = {};
  for (const k of allowed) {
    if (patch[k] !== undefined) payload[k] = patch[k];
  }
  payload.updated_at = new Date().toISOString();

  const actualizar = (p) =>
    supabase.from('profiles').update(p).eq('id', user.id).select().single();

  let { data, error } = await actualizar(payload);

  // Migración 30 sin aplicar: modalidad / nivel / banner_url todavía no
  // existen. Reintentamos sin ellas para no bloquear el resto del guardado;
  // la UI seguirá mostrando N.A. hasta que se aplique la migración.
  if (error && esColumnaInexistente(error, MIGRACION_30_COLS)) {
    console.warn('[FutFinder] Faltan columnas de la migración 30 en profiles; se guarda el resto.');
    const resto = { ...payload };
    for (const c of MIGRACION_30_COLS) delete resto[c];
    ({ data, error } = await actualizar(resto));
  }

  return { data, error };
}

/** Columnas que aporta la migración 30 y pueden faltar en entornos antiguos. */
const MIGRACION_30_COLS = ['modalidad', 'nivel', 'banner_url'];

/** `true` si el error de Postgres es "la columna no existe" para alguna de `cols`. */
function esColumnaInexistente(error, cols) {
  if (error?.code !== '42703') return false;
  const msg = error.message || '';
  return cols.some((c) => new RegExp(`\\b${c}\\b`).test(msg));
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
  return getAttendanceHistoryFor(user.id, limit);
}

/**
 * Historial de participaciones de CUALQUIER jugador.
 *
 * `attendees` tiene lectura pública (ver RLS en schema.sql), así que el perfil
 * público de otro jugador puede mostrar sus participaciones. Solo se exponen
 * campos públicos del partido: nada de datos de contacto ni de organización.
 *
 * @returns {Array} filas `{ id, estado, inscrito_at, confirmado_at, match }`
 *                  ordenadas por fecha del partido (más reciente primero).
 *                  `match` puede ser null si el partido fue eliminado.
 */
export async function getAttendanceHistoryFor(userId, limit = 8) {
  if (!isSupabaseConfigured || !userId) return [];

  const { data, error } = await supabase
    .from('attendees')
    .select(
      'id, estado, inscrito_at, confirmado_at, ' +
      'match:matches(id, titulo, cancha_nombre, comuna, hora, estado)'
    )
    .eq('id_jugador', userId)
    .order('inscrito_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[FutFinder] getAttendanceHistoryFor:', error.code || '', error.message || error);
    return [];
  }

  // Ordenamos por la hora del partido, no por la fecha de inscripción: para el
  // jugador "última participación" significa el último partido jugado.
  return (data || []).slice().sort((a, b) => {
    const ha = a.match?.hora ? new Date(a.match.hora).getTime() : 0;
    const hb = b.match?.hora ? new Date(b.match.hora).getTime() : 0;
    return hb - ha;
  });
}

/**
 * Estado de cuenta público de un jugador: si tiene una sanción activa y hasta
 * cuándo. No expone el motivo ni el detalle de la sanción.
 *
 * @returns {{ suspended: boolean, suspended_until: string|null }}
 */
export async function getAccountStatusFor(userId) {
  if (!isSupabaseConfigured || !userId) return { suspended: false, suspended_until: null };

  const { data, error } = await supabase
    .from('profiles')
    .select('estado, suspended_until')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    // `estado` / `suspended_until` pueden no existir en entornos antiguos:
    // en ese caso asumimos cuenta sin sanciones en vez de romper la pantalla.
    console.warn('[FutFinder] getAccountStatusFor:', error.message || error);
    return { suspended: false, suspended_until: null };
  }

  const suspended =
    data?.estado === 'suspendido' &&
    (!data.suspended_until || new Date(data.suspended_until) > new Date());

  return { suspended, suspended_until: data?.suspended_until || null };
}

/**
 * Estadísticas derivadas en base a profile + attendees.
 *
 * Devuelve solo CONTEOS reales. Lo que no se puede calcular queda en `null`
 * para que la vista decida cómo mostrarlo (N.A.), en vez de rellenarlo con un
 * valor optimista: antes esta función devolvía 100 % de asistencia a un
 * jugador sin partidos, y estrellas derivadas del trust_score como si fueran
 * valoraciones de otros jugadores.
 *
 * Las reglas de presentación (N.A., textos, colores) viven en
 * src/utils/playerMeta.js, no aquí.
 */
export function deriveStats(profile, history) {
  if (!profile) return null;
  const rows = history || [];
  const confirmados = rows.filter((h) => h.estado === 'confirmado_gps').length;
  const ausencias = rows.filter((h) => h.estado === 'no_asistio').length;
  // Denominador de la tasa: solo partidos ya cerrados (asistió o no asistió).
  const cerrados = confirmados + ausencias;

  return {
    // `partidos_jugados` es un contador de la BD; hoy nada lo incrementa, así
    // que en la práctica vale 0. Se usa `asistencias_confirmadas` como la
    // cifra real de partidos jugados y verificados por GPS.
    partidos_jugados: profile.asistencias_confirmadas ?? 0,
    asistencias_confirmadas: profile.asistencias_confirmadas ?? 0,
    mvps: profile.mvps ?? 0,
    // Inscripciones vigentes (partido futuro, sin cancelar).
    inscritos: rows.filter(
      (h) =>
        (h.estado === 'inscrito' || h.estado === 'pendiente') &&
        h.match?.hora &&
        new Date(h.match.hora).getTime() >= Date.now()
    ).length,
    trust_score: profile.trust_score ?? null,
    // null = todavía no calculable. La vista lo traduce a "N.A.".
    tasa_asistencia: cerrados > 0 ? Math.round((confirmados / cerrados) * 100) : null,
    total_historial: rows.length,
    confirmados_historial: confirmados,
    ausencias_historial: ausencias,
  };
}
