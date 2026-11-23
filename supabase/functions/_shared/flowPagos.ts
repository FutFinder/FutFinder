// supabase/functions/_shared/flowPagos.ts
//
// QUÉ HACER CON UN COBRO QUE FLOW DICE QUE SALIÓ. Lo usan `flow-confirmacion`
// (el aviso de Flow) y `pagar-reserva` (cuando, al reintentar, resulta que el
// pago anterior ya se había cobrado y el aviso todavía no llega).
//
// LA REGLA: UN COBRO QUE FLOW CONFIRMÓ NUNCA SE PIERDE EN SILENCIO. Antes había
// tres caminos en que la tarjeta se cobraba y la base no dejaba nada que una
// persona pudiera ver:
//   · el monto no coincidía → se contestaba 200 y el pago quedaba
//     `pendiente`, con un `console.error` como único rastro;
//   · `confirmar_pago` contestaba `ok: false` (el pago ya estaba `expirado` o
//     `fallido`, que es lo que pasa cuando alguien paga un enlace viejo) → se
//     contestaba 200 «ok» sin escribir nada;
// Ahora los dos terminan en `pago_cobrado_sin_reserva` (migración 178): el pago
// queda `reversar` con su motivo —la cola de «plata por devolver» que ya mira
// la revisión diaria— y la persona recibe un aviso.
//
// Sin red: la base se inyecta, así se prueba con `deno test`.

import { montoCoincide } from "./flowLogic.ts";

export interface BaseDePagos {
  leerPago(orden: string): Promise<{
    data: { id: string; monto: number; estado: string } | null;
    error: unknown;
  }>;
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: any; error: unknown }>;
}

export interface Resultado {
  /** Lo que se le contesta a Flow: 200 = anotado, 500 = reintenta. */
  http: number;
  resultado: "confirmada" | "parcial" | "reversar" | "ya_estaba" | "desconocida" | "error";
}

const formatoClp = (n: unknown) => `$${Math.round(Number(n)).toLocaleString("es-CL")}`;

async function marcarParaDevolver(
  base: BaseDePagos,
  args: { orden: string; token: string; estado: unknown; motivo: string },
): Promise<Resultado> {
  const { error } = await base.rpc("pago_cobrado_sin_reserva", {
    p_orden_comercio: args.orden,
    p_referencia: args.token,
    p_datos: args.estado,
    p_motivo: args.motivo,
  });
  if (error) {
    console.error("[flow] pago_cobrado_sin_reserva falló. orden:", args.orden);
    return { http: 500, resultado: "error" };
  }
  console.error("[flow][REVERSAR]", args.motivo, "orden:", args.orden);
  return { http: 200, resultado: "reversar" };
}

/**
 * Registra un cobro que Flow ya confirmó (`status` 2). Idempotente: Flow
 * reintenta el aviso, y `confirmar_pago` y `pago_cobrado_sin_reserva`
 * reconocen un pago ya resuelto.
 */
export async function registrarCobro(
  base: BaseDePagos,
  args: { orden: string; token: string; estado: { amount?: unknown } & Record<string, unknown> },
): Promise<Resultado> {
  const { orden, token, estado } = args;

  const { data: pago, error: errPago } = await base.leerPago(orden);
  if (errPago) {
    console.error("[flow] no se pudo leer el pago. orden:", orden);
    return { http: 500, resultado: "error" };
  }
  if (!pago) {
    // Una orden que no es nuestra: 200 para que Flow no insista.
    console.error("[flow] aviso de una orden desconocida:", orden);
    return { http: 200, resultado: "desconocida" };
  }

  if (!montoCoincide(pago.monto, estado.amount)) {
    return marcarParaDevolver(base, {
      orden,
      token,
      estado,
      motivo: `Flow cobró ${formatoClp(estado.amount)} y el pago era por ${formatoClp(pago.monto)}`,
    });
  }

  const { data: res, error } = await base.rpc("confirmar_pago", {
    p_orden_comercio: orden,
    p_referencia: token,
    p_datos: estado,
  });
  if (error) {
    console.error("[flow] confirmar_pago falló. orden:", orden);
    return { http: 500, resultado: "error" };
  }
  if (!res?.ok) {
    // El pago ya no estaba pendiente (lo cerró un reintento, o venció) y aun
    // así Flow lo cobró: alguien pagó un enlace viejo.
    return marcarParaDevolver(base, {
      orden,
      token,
      estado,
      motivo: `Cobrado cuando el pago ya no estaba pendiente (${res?.reason ?? "sin motivo"})`,
    });
  }
  if (res.ya_estaba) return { http: 200, resultado: "ya_estaba" };
  if (res.resultado === "reversar") {
    console.error("[flow][REVERSAR] pagó y no hay cancha. orden:", orden);
    return { http: 200, resultado: "reversar" };
  }
  return { http: 200, resultado: res.resultado === "parcial" ? "parcial" : "confirmada" };
}
