import { isSupabaseConfigured, supabase } from './supabase';
import { getMyProfile, getMyAttendanceHistory } from './profile';
import { listMyFriends } from './friends';
import { getMyClubs } from './clubs';
import { misAceptacionesLegales } from './aceptacionLegal';

/**
 * Arma un export en JSON de los datos propios del usuario, para descargar
 * antes de un `delete_my_account` (migración 21) — buena práctica de
 * privacidad, no una obligación legal formal de esta app.
 *
 * ALCANCE: perfil, historial de partidos, amigos, clubes y las versiones de
 * los términos aceptadas (migración 181), armados acá; y todo lo demás que es
 * de la persona —teléfono, ubicación guardada, reservas, pagos, movimientos de
 * saldo, calificaciones que dio, reportes que hizo, tickets, solicitudes de
 * recinto, bloqueos, historial de puntaje y los últimos 5.000 mensajes que
 * escribió— desde `exportar_mis_datos` (migración 192), porque varias de esas
 * tablas el cliente no las puede leer enteras. Nada escrito por otras
 * personas (ni mensajes recibidos ni calificaciones recibidas con su autor).
 *
 * Si la función falla, el archivo sale igual con lo de acá y lo dice en
 * `incompleto`: es mejor entregar algo que nada, pero sin hacerlo pasar por
 * completo.
 */
export async function buildMyDataExport() {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };

  const profile = await getMyProfile();
  if (!profile) return { data: null, error: { message: 'No se pudo cargar tu perfil' } };

  const [historial, amigos, clubes, aceptaciones, servidor] = await Promise.all([
    getMyAttendanceHistory(1000),
    listMyFriends(),
    getMyClubs(),
    misAceptacionesLegales(),
    supabase.rpc('exportar_mis_datos'),
  ]);
  if (servidor.error) console.error('[FutFinder] exportar_mis_datos:', servidor.error.code);
  const delServidor = servidor.data && typeof servidor.data === 'object' ? servidor.data : {};

  return {
    data: {
      generado_en: new Date().toISOString(),
      perfil: profile,
      historial_partidos: historial,
      amigos: amigos.data || [],
      clubes: clubes.data || [],
      terminos_aceptados: aceptaciones.data || [],
      ...delServidor,
      ...(servidor.error
        ? { incompleto: 'No pudimos traer reservas, pagos, mensajes y el resto de tus datos del servidor. Vuelve a intentarlo.' }
        : {}),
    },
    error: null,
  };
}
