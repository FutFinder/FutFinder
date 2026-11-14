import { isSupabaseConfigured } from './supabase';
import { getMyProfile, getMyAttendanceHistory } from './profile';
import { listMyFriends } from './friends';
import { getMyClubs } from './clubs';
import { misAceptacionesLegales } from './aceptacionLegal';

/**
 * Arma un export en JSON de los datos propios del usuario, para descargar
 * antes de un `delete_my_account` (migración 21) — buena práctica de
 * privacidad, no una obligación legal formal de esta app.
 *
 * ALCANCE ACTUAL: perfil, historial de partidos, amigos, clubes y las
 * versiones de los términos que la persona aceptó (migración 181). NO incluye
 * mensajes de chat: son potencialmente enormes, cruzan muchos hilos y
 * también contienen datos de otras personas (no solo del usuario que pide
 * el export).
 */
export async function buildMyDataExport() {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };

  const profile = await getMyProfile();
  if (!profile) return { data: null, error: { message: 'No se pudo cargar tu perfil' } };

  const [historial, amigos, clubes, aceptaciones] = await Promise.all([
    getMyAttendanceHistory(1000),
    listMyFriends(),
    getMyClubs(),
    misAceptacionesLegales(),
  ]);

  return {
    data: {
      generado_en: new Date().toISOString(),
      perfil: profile,
      historial_partidos: historial,
      amigos: amigos.data || [],
      clubes: clubes.data || [],
      terminos_aceptados: aceptaciones.data || [],
    },
    error: null,
  };
}
