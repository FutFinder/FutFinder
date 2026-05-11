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

export async function updateMyProfile(patch) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: { message: 'No autenticado' } };

  // Sanitiza: solo permitimos estos campos desde el cliente.
  const allowed = [
    'username', 'foto_url', 'posicion_preferida', 'flanco',
    'edad', 'bio', 'region', 'comuna',
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
