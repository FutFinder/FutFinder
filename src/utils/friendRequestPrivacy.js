/**
 * Traduce el error de Postgres/PostgREST al enviar una solicitud de
 * amistad en un mensaje legible para la UI.
 *
 * El rechazo por privacidad ocurre en la política RLS de `friendships`
 * (migración 35), no acá: cuando el destinatario tiene
 * `privacy_friend_requests = 'nobody'`, Postgres devuelve una violación
 * de row-level security (código 42501) en vez de insertar la fila. Esta
 * función solo reconoce ese error y lo convierte en un mensaje que la
 * pantalla pueda mostrar tal cual, sin camuflar otros errores reales
 * (de red, de datos, etc.) como si fueran un bloqueo de privacidad.
 */

export const PRIVACY_BLOCKED_MESSAGE =
  'Este jugador no acepta solicitudes de amistad por ahora.';

export function describeFriendRequestError(error) {
  if (!error) return null;
  const isPrivacyBlock =
    error.code === '42501' || /row-level security policy/i.test(error.message || '');
  return {
    message: isPrivacyBlock
      ? PRIVACY_BLOCKED_MESSAGE
      : error.message || 'No se pudo enviar la solicitud.',
    blockedByPrivacy: isPrivacyBlock,
  };
}
