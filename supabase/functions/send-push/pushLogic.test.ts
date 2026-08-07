// supabase/functions/send-push/pushLogic.test.ts
//
// Pruebas de la lógica pura de send-push. Correr con:
//   deno test supabase/functions/send-push/pushLogic.test.ts
//
// No necesitan Supabase ni Expo reales: cubren exactamente las
// decisiones que antes hacía mal la edge function (marcar sent_push
// en tickets con error, no limpiar tokens muertos, no diferenciar
// omitido-por-preferencia de fallido, etc).

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  classifyReceipt,
  classifyTickets,
  dedupeValidTokens,
  isPushAllowed,
  isValidExpoToken,
  summarizePushStatus,
} from "./pushLogic.ts";

// ── Ticket exitoso ──────────────────────────────────────────────
Deno.test("classifyTickets: ticket ok mantiene el token y guarda el ticketId", () => {
  const result = classifyTickets(
    ["ExponentPushToken[aaa]"],
    [{ status: "ok", id: "ticket-1" }],
  );
  assertEquals(result, [
    {
      token: "ExponentPushToken[aaa]",
      ticketStatus: "ok",
      ticketId: "ticket-1",
      ticketError: null,
      removeToken: false,
    },
  ]);
  assertEquals(summarizePushStatus(result), "sent");
});

// ── Ticket rechazado (DeviceNotRegistered) ───────────────────────
Deno.test("classifyTickets: ticket error DeviceNotRegistered marca el token para borrar", () => {
  const result = classifyTickets(
    ["ExponentPushToken[dead]"],
    [{
      status: "error",
      message: "device not registered",
      details: { error: "DeviceNotRegistered" },
    }],
  );
  assertEquals(result[0].ticketStatus, "error");
  assertEquals(result[0].ticketError, "DeviceNotRegistered");
  assert(result[0].removeToken, "DeviceNotRegistered debe eliminar el token");
  // Nunca se marca como enviado si el único ticket vino con error.
  assertEquals(summarizePushStatus(result), "failed");
});

Deno.test("classifyTickets: error transitorio (MessageRateExceeded) no borra el token", () => {
  const result = classifyTickets(
    ["ExponentPushToken[ok-luego]"],
    [{
      status: "error",
      message: "rate exceeded",
      details: { error: "MessageRateExceeded" },
    }],
  );
  assertFalse(result[0].removeToken);
});

Deno.test("classifyTickets: lote mixto — un token bueno y uno muerto, cada uno con su resultado", () => {
  const result = classifyTickets(
    ["ExponentPushToken[bueno]", "ExponentPushToken[muerto]"],
    [
      { status: "ok", id: "ticket-ok" },
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ],
  );
  assertEquals(result[0].removeToken, false);
  assertEquals(result[1].removeToken, true);
  // Al menos un ticket ok → el push sí se considera enviado, aunque
  // el otro token del mismo usuario haya fallado.
  assertEquals(summarizePushStatus(result), "sent");
});

// ── Receipt fallido ──────────────────────────────────────────────
Deno.test("classifyReceipt: receipt ok no elimina el token", () => {
  const outcome = classifyReceipt({ status: "ok" });
  assertEquals(outcome, { receiptStatus: "ok", receiptError: null, removeToken: false });
});

Deno.test("classifyReceipt: receipt error DeviceNotRegistered elimina el token", () => {
  const outcome = classifyReceipt({
    status: "error",
    message: "\"ExponentPushToken[xxx]\" is not a registered push notification recipient",
    details: { error: "DeviceNotRegistered" },
  });
  assertEquals(outcome.receiptStatus, "error");
  assertEquals(outcome.receiptError, "DeviceNotRegistered");
  assert(outcome.removeToken);
});

Deno.test("classifyReceipt: receipt error sin código conocido conserva el token", () => {
  const outcome = classifyReceipt({ status: "error", message: "algo raro" });
  assertEquals(outcome.receiptError, "algo raro");
  assertFalse(outcome.removeToken);
});

// ── Token inválido ────────────────────────────────────────────────
Deno.test("isValidExpoToken: rechaza formatos que no son de Expo", () => {
  assert(isValidExpoToken("ExponentPushToken[abc123]"));
  assertFalse(isValidExpoToken("no-es-un-token"));
  assertFalse(isValidExpoToken(""));
  assertFalse(isValidExpoToken(null));
  assertFalse(isValidExpoToken(undefined));
});

Deno.test("dedupeValidTokens: filtra inválidos y no duplica el mismo token dos veces", () => {
  const rows = [
    { token: "ExponentPushToken[a]", platform: "ios" },
    { token: "basura", platform: "android" },
    { token: "ExponentPushToken[a]", platform: "ios" }, // duplicado exacto
    { token: "ExponentPushToken[b]", platform: "android" },
  ];
  const out = dedupeValidTokens(rows);
  assertEquals(out.map((t) => t.token), [
    "ExponentPushToken[a]",
    "ExponentPushToken[b]",
  ]);
});

// ── Preferencia desactivada ───────────────────────────────────────
Deno.test("isPushAllowed: notif_matches=false bloquea un push de tipo match_join", () => {
  assertFalse(isPushAllowed({ notif_matches: false }, "match_join"));
});

Deno.test("isPushAllowed: perfil sin la columna en false, permite el push", () => {
  assert(isPushAllowed({ notif_matches: true }, "match_join"));
  assert(isPushAllowed({}, "match_join"));
});

Deno.test("isPushAllowed: falla abierto si no hay perfil o el tipo no está mapeado", () => {
  assert(isPushAllowed(null, "match_join"));
  assert(isPushAllowed({ notif_matches: false }, "tipo_no_mapeado"));
});
