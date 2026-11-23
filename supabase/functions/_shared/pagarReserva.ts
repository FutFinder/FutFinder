// supabase/functions/_shared/pagarReserva.ts
//
// Las dos decisiones de `pagar-reserva` que no dependen de la red, sacadas
// de `index.ts` para poder probarlas con `deno test`.
//
// Vive en su propio archivo, y no en `flowLogic.ts` o `flowPagos.ts`, porque
// esos dos viajan también dentro de `flow-confirmacion`: tocarlos obliga a
// redesplegarla. Esto sólo lo importa `pagar-reserva`.

// deno-lint-ignore-file no-explicit-any

/** Lo que se le dice a la persona cuando los cobros están cortados. */
export const MOTIVO_PAUSA =
  "Los pagos con tarjeta están en pausa por un momento. No se te cobró nada: inténtalo de nuevo más tarde.";

/**
 * ¿Están cortados los cobros nuevos? Lee la respuesta de la RPC
 * `pagos_en_pausa()` (migración 179).
 *
 * SÓLO `true` ES PAUSA. Un error, un `null` o una función que todavía no
 * existe (la migración sin aplicar) cuentan como «no hay pausa»: esta
 * consulta es un atajo para contestar con un motivo claro, no la barrera. La
 * barrera es el disparador `tg_pagos_en_pausa`, que vive en la misma base
 * que la bandera y no deja nacer el pago aunque esto falle.
 */
export function estaEnPausa(resp: { data?: any; error?: any } | null | undefined): boolean {
  if (!resp || resp.error) return false;
  return resp.data === true;
}

/**
 * ¿Quedó anotado el token de Flow en el pago? Lee la respuesta de la RPC
 * `anotar_referencia_pago` (migración 78).
 *
 * EL ERROR DE TRANSPORTE NO ES EL ÚNICO FALLO. La función no lanza cuando
 * no encuentra el pago: devuelve `{ ok: false, reason }` con HTTP 200 (pasa
 * si el pago dejó de estar `pendiente` entre que se creó y este momento —lo
 * venció el cron, o lo cerró otro intento de la misma persona). Antes sólo
 * se miraba `error`, así que ese caso seguía de largo y se mandaba a la
 * persona a pagar un cobro cuyo token la base no conoce: el aviso de Flow
 * llegaba igual por la orden, pero el reintento (`queHacerConPendiente`) no
 * tenía con qué preguntar por él.
 *
 * Sólo un `ok: true` explícito vale. Cualquier otra cosa —`null`, un cuerpo
 * raro— es «no sé si quedó», y sin saberlo no se manda a nadie a pagar.
 */
export function referenciaAnotada(
  resp: { data?: any; error?: any } | null | undefined,
): { ok: boolean; motivo: string | null } {
  if (!resp) return { ok: false, motivo: "sin respuesta" };
  if (resp.error) return { ok: false, motivo: String(resp.error.code ?? "error de transporte") };
  if (resp.data?.ok === true) return { ok: true, motivo: null };
  return { ok: false, motivo: String(resp.data?.reason ?? "respuesta sin ok") };
}
