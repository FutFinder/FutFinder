import { supabase, isSupabaseConfigured } from './supabase';
import { getCurrentLocation } from './location';

/**
 * Confirma la asistencia del usuario actual a un partido leyendo su GPS
 * y llamando al RPC `confirm_attendance_gps` en la base de datos.
 *
 * Lógica del Trust Score (en SQL):
 *   - Distancia ≤ 200m de la cancha
 *   - Dentro de la ventana [hora-30min, hora+90min]
 *   → marca attendees.estado = 'confirmado_gps'
 *   → +1 al profile.trust_score (cap 100)
 *   → +1 a profile.asistencias_confirmadas
 *
 * Devuelve un objeto { ok, reason, distance? }.
 */
export async function confirmAttendanceWithGPS(matchId) {
  if (!isSupabaseConfigured) {
    return { ok: true, reason: 'Demo (sin Supabase configurado)' };
  }

  const loc = await getCurrentLocation();
  if (!loc.ok) {
    return { ok: false, reason: loc.reason || 'No pude leer tu ubicación' };
  }

  const { data, error } = await supabase.rpc('confirm_attendance_gps', {
    p_match_id: matchId,
    p_user_lat: loc.latitude,
    p_user_lng: loc.longitude,
  });

  if (error) return { ok: false, reason: error.message };
  return data; // { ok, reason, distance? }
}

/**
 * Lista los partidos en los que estoy inscrito.
 */
export async function listMyAttendances() {
  if (!isSupabaseConfigured) return { data: [], error: null };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: [], error: { message: 'No autenticado' } };

  const { data, error } = await supabase
    .from('attendees')
    .select(
      'id, estado, inscrito_at, confirmado_at, distancia_metros, ' +
        'match:matches(id, titulo, comuna, cancha_nombre, hora, latitud, longitud)'
    )
    .eq('id_jugador', user.id)
    .order('inscrito_at', { ascending: false });

  return { data: data || [], error };
}
