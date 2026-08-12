// supabase/functions/send-push/pushLogic.ts
//
// Lógica pura de send-push (sin I/O): armar mensajes, clasificar
// tickets/receipts de Expo y decidir qué hacer con cada token.
// Separada de index.ts para poder testearla con `deno test` sin
// necesitar Supabase ni Expo reales.

// deno-lint-ignore-file no-explicit-any

// Espejo de `src/utils/notificationPreferences.js` (Deno no puede importar
// ese archivo directamente). Si se agrega un tipo nuevo a `notifications`,
// hay que sumarlo en ambos lados. Estas preferencias solo controlan el push
// externo — el aviso siempre queda guardado y visible en la bandeja in-app.
export const NOTIF_TYPE_TO_PREFERENCE: Record<string, string> = {
  // Partidos y asistencia
  match_join: "notif_matches",
  match_reminder: "notif_matches",
  match_rate: "notif_matches",
  join_request: "notif_matches",
  join_approved: "notif_matches",
  join_rejected: "notif_matches",
  match_cancelled: "notif_matches",
  match_updated: "notif_matches",
  match_slot_free: "notif_matches",
  waitlist_turn: "notif_matches",
  match_left: "notif_matches",
  match_attendance: "notif_matches",

  // Clubes y desafíos
  club_request: "notif_clubs",
  club_request_accepted: "notif_clubs",
  club_request_rejected: "notif_clubs",
  club_member_joined: "notif_clubs",
  club_member_left: "notif_clubs",
  club_invite_accepted: "notif_clubs",
  club_challenge: "notif_clubs",
  club_challenge_accepted: "notif_clubs",
  club_challenge_rejected: "notif_clubs",
  club_challenge_extension: "notif_clubs",
  club_challenge_closed: "notif_clubs",
  club_challenge_proposal: "notif_clubs",
  club_challenge_proposal_rejected: "notif_clubs",
  club_match_published: "notif_clubs",

  // Mensajes y menciones
  message_new: "notif_chat",
  chat_mention_all: "notif_chat",

  // Amistades y solicitudes
  friend_request: "notif_friends",
  friend_accept: "notif_friends",
};

export function getPreferenceColumn(type: string): string | null {
  return NOTIF_TYPE_TO_PREFERENCE[type] ?? null;
}

// Falla abierto: un tipo sin mapear o un perfil no encontrado nunca bloquean
// el push, solo lo bloquea `false` explícito en la columna correspondiente.
export function isPushAllowed(
  profile: Record<string, any> | null,
  type: string,
): boolean {
  const column = getPreferenceColumn(type);
  if (!column) return true;
  if (!profile) return true;
  return profile[column] !== false;
}

// Errores de ticket/receipt que significan "este token ya no sirve, bórralo".
// El resto (MessageTooBig, MessageRateExceeded, InvalidCredentials) son
// problemas del mensaje o la cuenta, no del token: se registran pero el
// token se conserva.
const PERMANENT_TOKEN_ERRORS = new Set(["DeviceNotRegistered"]);

export function isPermanentTokenError(errorCode?: string | null): boolean {
  return !!errorCode && PERMANENT_TOKEN_ERRORS.has(errorCode);
}

export function isValidExpoToken(token: unknown): token is string {
  return typeof token === "string" && token.startsWith("ExponentPushToken");
}

/** Filtra tokens con formato inválido y elimina duplicados exactos. */
export function dedupeValidTokens<T extends { token: string }>(
  tokens: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const t of tokens) {
    if (!isValidExpoToken(t.token)) continue;
    if (seen.has(t.token)) continue;
    seen.add(t.token);
    out.push(t);
  }
  return out;
}

/** Enmascara un token para logs: nunca se debe loguear completo. */
export function maskToken(token: string | null | undefined): string {
  if (!token) return "(sin token)";
  return token.length <= 8 ? "…" : `…${token.slice(-8)}`;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export interface NotifLike {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, any> | null;
}

export function buildExpoMessage(notif: NotifLike, token: string) {
  return {
    to: token,
    sound: "default",
    title: notif.title,
    body: notif.body ?? "",
    data: {
      type: notif.type,
      notificationId: notif.id,
      ...(notif.data || {}),
    },
    channelId: "default",
    priority: "high" as const,
  };
}

export interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface TokenTicketResult {
  token: string;
  ticketStatus: "ok" | "error";
  ticketId: string | null;
  ticketError: string | null;
  removeToken: boolean;
}

/**
 * Empareja cada token con el ticket que le correspondió (Expo devuelve
 * `data` en el mismo orden que los mensajes enviados).
 */
export function classifyTickets(
  tokens: string[],
  tickets: ExpoTicket[],
): TokenTicketResult[] {
  return tokens.map((token, i) => {
    const ticket = tickets[i];
    if (!ticket || ticket.status !== "ok") {
      const errorCode = ticket?.details?.error ?? null;
      return {
        token,
        ticketStatus: "error" as const,
        ticketId: null,
        ticketError: errorCode ?? ticket?.message ?? "sin_respuesta",
        removeToken: isPermanentTokenError(errorCode),
      };
    }
    return {
      token,
      ticketStatus: "ok" as const,
      ticketId: ticket.id ?? null,
      ticketError: null,
      removeToken: false,
    };
  });
}

export type PushStatus =
  | "pending"
  | "sending"
  | "sent"
  | "skipped_preference"
  | "skipped_no_token"
  | "failed";

/** Si al menos un ticket salió 'ok', se considera que el push se mandó. */
export function summarizePushStatus(results: TokenTicketResult[]): PushStatus {
  return results.some((r) => r.ticketStatus === "ok") ? "sent" : "failed";
}

export interface ExpoReceipt {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

export interface ReceiptOutcome {
  receiptStatus: "ok" | "error";
  receiptError: string | null;
  removeToken: boolean;
}

export function classifyReceipt(receipt: ExpoReceipt): ReceiptOutcome {
  if (receipt.status === "ok") {
    return { receiptStatus: "ok", receiptError: null, removeToken: false };
  }
  const errorCode = receipt.details?.error ?? null;
  return {
    receiptStatus: "error",
    receiptError: errorCode ?? receipt.message ?? "error_desconocido",
    removeToken: isPermanentTokenError(errorCode),
  };
}
