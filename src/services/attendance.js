import { supabase, isSupabaseConfigured } from './supabase';
import { getCurrentLocation } from './location';

/**
 * Confirma la asistencia del usuario actual a un partido leyendo su GPS
 * y llamando al RPC `confirm_attendance_gps` en la base de datos.
 *
 * Lo que hace la RPC (migración 134):
 *   - Distancia ≤ 200 m de la cancha.
 *   - Ventana [hora − 30 min, fin del partido + 30 min], con fin = hora +
 *     duracion_min (90 si falta).
 *   → marca attendees.estado = 'confirmado_gps' y suma 1 a
 *     profiles.asistencias_confirmadas.
 *   → Con TrueScore (fase 1) no mueve el puntaje: `trust_delta` llega en 0 y
 *     los puntos los aplica después el organizador al marcar asistencia.
 *     Sin TrueScore, +1 al trust_score (tope 100).
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
