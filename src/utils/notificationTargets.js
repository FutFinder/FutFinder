import { getMatchById } from '../services/matches';
import { getClubById } from '../services/clubs';

/**
 * Traduce tipo + `data` de una notificación en un destino de navegación.
 *
 * Único punto de verdad para "a dónde va cada tipo de aviso" — lo usan tanto
 * NotificationsScreen (tap dentro de la app) como App.js (tap sobre un push),
 * para que agregar o corregir un destino no signifique mantener dos switch
 * idénticos por separado.
 *
 * Devuelve:
 *   - { screen, params, resource? } si hay suficiente información para navegar.
 *     `resource` (opcional) describe qué verificar antes de navegar — ver
 *     `verifyTargetExists`.
 *   - null si el tipo es desconocido o falta el dato necesario en `data`
 *     (p.ej. un aviso viejo sin matchId). Quien llame debe avisar al usuario
 *     en ese caso, no navegar a ciegas ni quedarse en silencio.
 */
export function resolveNotificationTarget(n) {
  const type = n?.type;
  const data = n?.data || {};

  switch (type) {
    case 'message_new': {
      const threadKey = data.threadKey || data.threadId;
      return threadKey ? { screen: 'ChatThread', params: { threadKey } } : null;
    }

    // Partidos: el detalle ya sabe mostrar "este partido no existe / fue
    // cancelado" si hace falta (MatchDetailScreen), así que no repetimos el
    // chequeo aquí.
    case 'match_join':
    case 'match_reminder':
    case 'match_updated':
    case 'match_slot_free':
    case 'waitlist_turn':
    case 'match_left':
    case 'match_attendance':
    case 'join_approved':
    case 'join_rejected':
      return data.matchId ? { screen: 'MatchDetail', params: { matchId: data.matchId } } : null;

    // Al organizador le sirve más caer directo en la pestaña de solicitudes
    // que en el detalle público del partido.
    case 'join_request':
      return data.matchId
        ? { screen: 'ManageMatch', params: { matchId: data.matchId, tab: 'solicitudes' } }
        : null;

    case 'match_rate':
      return data.matchId ? { screen: 'RateMatch', params: { matchId: data.matchId } } : null;

    case 'match_cancelled':
      return { screen: 'Main', params: { screen: 'SearchTab' } };

    // Clubes: a diferencia del detalle de partido, ClubDetail/ClubChallenges
    // no tienen un estado "este club ya no existe" propio, así que sí
    // verificamos el recurso antes de navegar.
    case 'club_request':
    case 'club_request_accepted':
    case 'club_member_joined':
    case 'club_member_left':
    case 'club_invite_accepted':
      return data.clubId
        ? { screen: 'ClubDetail', params: { clubId: data.clubId }, resource: { kind: 'club', id: data.clubId } }
        : null;

    case 'club_request_rejected':
      return { screen: 'Main', params: { screen: 'ClubsTab' } };

    case 'club_challenge':
      // Recibido: abre la bandeja de desafíos de mi club (el retado).
      return data.clubRetadoId
        ? {
            screen: 'ClubChallenges',
            params: { clubId: data.clubRetadoId },
            resource: { kind: 'club', id: data.clubRetadoId },
          }
        : null;

    case 'club_challenge_accepted':
    case 'club_challenge_rejected':
      // Respondido: abre la bandeja de desafíos de mi club (el retador).
      return data.clubRetadorId
        ? {
            screen: 'ClubChallenges',
            params: { clubId: data.clubRetadorId },
            resource: { kind: 'club', id: data.clubRetadorId },
          }
        : null;

    // ProfileScreen ya muestra "Este jugador no existe" si el usuario fue
    // borrado, así que tampoco verificamos el recurso aquí.
    case 'friend_request':
    case 'friend_accept':
      return data.fromUserId ? { screen: 'UserProfile', params: { userId: data.fromUserId } } : null;

    default:
      return null;
  }
}

const MISSING_COPY = {
  match: {
    title: 'Este partido ya no existe',
    message: 'Puede que lo hayan borrado o cancelado.',
  },
  club: {
    title: 'Este club ya no existe',
    message: 'Puede que lo hayan eliminado.',
  },
};

/** Copia genérica cuando el aviso no trae los datos necesarios para navegar. */
export const UNRESOLVED_NOTIFICATION_COPY = {
  title: 'No pudimos abrir este aviso',
  message: 'Puedes revisarlo desde la bandeja de Avisos.',
};

/**
 * Confirma que el recurso al que apunta un destino sigue existiendo.
 * Si el target no trae `resource`, se asume válido (pantallas de pestaña,
 * o destinos cuya propia pantalla ya sabe mostrar el estado "no existe").
 */
export async function verifyTargetExists(target) {
  const resource = target?.resource;
  if (!resource) return { ok: true };

  try {
    if (resource.kind === 'match') {
      const { data } = await getMatchById(resource.id);
      return { ok: !!data, copy: MISSING_COPY.match };
    }
    if (resource.kind === 'club') {
      const { data } = await getClubById(resource.id);
      return { ok: !!data, copy: MISSING_COPY.club };
    }
  } catch (e) {
    // Un error de red no significa que el recurso no exista: preferimos
    // dejar pasar la navegación y que la pantalla de destino lo resuelva,
    // en vez de bloquear al usuario por un problema de conectividad.
    console.warn('[FutFinder] verifyTargetExists:', e);
    return { ok: true };
  }
  return { ok: true };
}

/**
 * Resuelve, verifica y navega para una notificación — el flujo completo que
 * comparten el tap dentro de la app y el tap sobre un push.
 *
 * `navigate(screen, params)` es el único punto que difiere entre ambos
 * llamadores (un `navigation` de pantalla vs. el `navigationRef` global).
 */
export async function navigateToNotification(n, { navigate, onMissing, onUnresolved }) {
  const target = resolveNotificationTarget(n);
  if (!target) {
    onUnresolved?.(UNRESOLVED_NOTIFICATION_COPY);
    return false;
  }

  const { ok, copy } = await verifyTargetExists(target);
  if (!ok) {
    onMissing?.(copy);
    return false;
  }

  navigate(target.screen, target.params);
  return true;
}
