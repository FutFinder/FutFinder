/**
 * Mapeo de tipo de notificación → preferencia de push que la controla.
 *
 * Estas cuatro preferencias (`notif_matches`, `notif_clubs`, `notif_chat`,
 * `notif_friends`) viven como columnas boolean en `profiles` (migración 21)
 * y se editan desde SettingsScreen. Solo controlan el push externo: el
 * aviso siempre se guarda y se muestra en la bandeja dentro de la app.
 *
 * Espejo en `supabase/functions/send-push/index.ts` (la Edge Function no
 * puede importar este archivo directamente) — si se agrega un tipo nuevo a
 * la tabla `notifications`, hay que sumarlo en ambos lados.
 */

export const NOTIF_TYPE_TO_PREFERENCE = {
  // Partidos y asistencia
  match_join: 'notif_matches',
  match_reminder: 'notif_matches',
  match_rate: 'notif_matches',
  join_request: 'notif_matches',
  join_approved: 'notif_matches',
  join_rejected: 'notif_matches',
  match_cancelled: 'notif_matches',
  match_updated: 'notif_matches',
  match_slot_free: 'notif_matches',
  waitlist_turn: 'notif_matches',
  match_left: 'notif_matches',
  match_attendance: 'notif_matches',

  // Clubes y desafíos
  club_request: 'notif_clubs',
  club_request_accepted: 'notif_clubs',
  club_request_rejected: 'notif_clubs',
  club_member_joined: 'notif_clubs',
  club_member_left: 'notif_clubs',
  club_invite_accepted: 'notif_clubs',
  club_challenge: 'notif_clubs',
  club_challenge_accepted: 'notif_clubs',
  club_challenge_rejected: 'notif_clubs',
  club_challenge_extension: 'notif_clubs',
  club_challenge_closed: 'notif_clubs',
  club_challenge_proposal: 'notif_clubs',
  club_challenge_proposal_rejected: 'notif_clubs',
  club_match_published: 'notif_clubs',
  club_match_reserva_omitida: 'notif_clubs',
  club_match_change: 'notif_clubs',
  club_match_change_responded: 'notif_clubs',
  club_match_cancelled: 'notif_clubs',
  club_sancionado: 'notif_clubs',
  club_revision_resuelta: 'notif_clubs',
  club_resultado_propuesto: 'notif_clubs',
  club_resultado_confirmado: 'notif_clubs',
  club_resultado_disputado: 'notif_clubs',

  // Mensajes y menciones
  message_new: 'notif_chat',
  chat_mention_all: 'notif_chat',

  // Amistades y solicitudes
  friend_request: 'notif_friends',
  friend_accept: 'notif_friends',
};


/**
 * Tipos que SIEMPRE empujan, a propósito.
 *
 * `isPushAllowed` falla abierto, y eso está bien para un tipo desconocido.
 * El problema era que tipos CONOCIDOS —los que la propia app crea— caían en
 * esa misma rama por olvido: `complejo_admin_agregado` lleva avisos reales en
 * producción y toda la familia `reserva_*`/`balance_cargado` mueve plata, y
 * ninguno estaba mapeado. Se veían iguales que un tipo inventado.
 *
 * Listarlos acá no cambia lo que pasa —siguen empujando— pero lo vuelve una
 * DECISIÓN en vez de un descuido: son avisos de plata y de administración,
 * y las cuatro preferencias que existen (`notif_matches`, `notif_clubs`,
 * `notif_chat`, `notif_friends`) no cubren ninguno de los dos temas. El día
 * que se quiera poder silenciarlos hace falta una columna nueva y su
 * interruptor en Ajustes; hasta entonces, esta lista es el inventario de lo
 * que queda fuera.
 */
export const PUSH_SIEMPRE = [
  'complejo_admin_agregado',
  'balance_cargado',
  'reserva_confirmada',
  'reserva_cancelada',
  'reserva_invitacion_capitan',
  'reserva_invitacion_jugador',
  'reserva_invitacion_rechazada',
  'reserva_cuota_recalculada',
  'reserva_saldo_insuficiente',
  'reserva_recordatorio_pago',
  'reserva_participante_quitado',
  'reserva_cancelacion_solicitada',
  'reserva_cancelacion_rechazada',
  'waitlist_turno_vencido',
];

/** Devuelve la columna de preferencia para un tipo, o null si no está mapeado. */
export function getPreferenceColumn(type) {
  return NOTIF_TYPE_TO_PREFERENCE[type] ?? null;
}

/**
 * Decide si corresponde enviar el push externo para una notificación.
 *
 * Falla abierto a propósito: un tipo sin mapeo, un perfil no encontrado, o
 * una columna en NULL/undefined nunca bloquean el push — solo lo bloquea
 * `false` explícito, para no afectar a quienes mantienen la preferencia
 * activada ni a datos incompletos.
 */
export function isPushAllowed(profile, type) {
  const column = getPreferenceColumn(type);
  if (!column) return true;
  if (!profile) return true;
  return profile[column] !== false;
}
