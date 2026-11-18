// supabase/functions/_shared/conciliarPagos.ts
//
// LOS PAGOS QUE QUEDARON `pendiente`. Un pago sale de `pendiente` sólo si
// llega el aviso de Flow (`flow-confirmacion`) o si la misma persona vuelve
// a tocar «pagar». Si alguien paga, el aviso se pierde —Flow reintenta, pero
// no para siempre— y no vuelve a la app, la plata queda cobrada con el pago
// en `pendiente` y sin ninguna marca. Esto le pregunta a Flow por esos pagos
// cada 10 minutos (la Edge Function `conciliar-pagos`, migración 190).
//
// NO HAY LÓGICA DE DINERO NUEVA: un pagado va por `registrarCobro`, el mismo
// camino del aviso (confirma, o deja en `reversar` con su motivo), y un
// rechazado o anulado por `rechazar_pago`. Todo es idempotente en la base,
// así que conciliar y recibir el aviso a la vez no duplica nada.
//
// LO QUE NO HACE, A PROPÓSITO:
//   · No cierra un pago que Flow sigue informando como pendiente, por viejo
//     que sea: el enlace puede seguir pagable, y marcarlo vencido de nuestro
//     lado es justo como se pierde un cobro (decisión del 2026-11-18).
//   · No mira la pausa de pagos (`pagos_en_pausa`): conciliar no crea cobros,
//     y es lo que tiene que seguir andando durante una pausa.
//
// Sin red: la base y Flow se inyectan, así se prueba con `deno test`.

import { accionSegunEstado, tokenConForma } from "./flowLogic.ts";
import { type BaseDePagos, registrarCobro } from "./flowPagos.ts";

/** Cuánto se espera antes de mirar un pendiente: 15 del enlace + 5 de margen. */
export const ESPERA_MINUTOS = 20;
/** Cuántos pagos se revisan por pasada, los más viejos primero. */
export const LOTE = 20;

export interface PagoPendiente {
  orden_comercio: string;
  referencia_externa: string | null;
}

/** Lo que contestó Flow a `payment/getStatus`, o `null` si no contestó. */
export type PreguntarAFlow = (token: string) => Promise<Record<string, unknown> | null>;

export type Desenlace =
  | "confirmado"
  | "reversar"
  | "cerrado"
  | "sigue_pendiente"
  | "sin_respuesta"
  | "error";

export interface Resumen {
  revisados: number;
  confirmados: number;
  reversar: number;
  cerrados: number;
  siguen_pendientes: number;
  sin_respuesta: number;
  errores: number;
}

/**
 * Un pago. Nunca lanza: lo que no se puede resolver queda como está y se
 * reintenta en la pasada siguiente.
 */
export async function conciliarUno(
  base: BaseDePagos,
  preguntar: PreguntarAFlow,
  pago: PagoPendiente,
): Promise<Desenlace> {
  const orden = pago.orden_comercio;
  const token = pago.referencia_externa;

  // Sin token nunca existió un cobro que la persona pudiera pagar (falló el
  // `payment/create` o no se alcanzó a anotar): se cierra como expirado.
  if (!token) {
    const { error } = await base.rpc("rechazar_pago", {
      p_orden_comercio: orden,
      p_estado: "expirado",
      p_datos: { conciliacion: "sin enlace de pago" },
    });
    return error ? "error" : "cerrado";
  }
  // Un token con otra forma no se le manda a Flow: no lo reconocería y cada
  // pregunta es una llamada firmada con su propio límite.
  if (!tokenConForma(token)) return "error";

  let estado: Record<string, unknown> | null;
  try {
    estado = await preguntar(token);
  } catch {
    estado = null;
  }
  if (!estado) return "sin_respuesta";
  // Flow contestó por otra orden: no se toca nada de ninguna de las dos.
  if (estado.commerceOrder && estado.commerceOrder !== orden) return "error";

  const accion = accionSegunEstado(Number(estado.status));
  if (accion === "esperar") return "sigue_pendiente";

  if (accion !== "confirmar") {
    const { error } = await base.rpc("rechazar_pago", {
      p_orden_comercio: orden,
      p_estado: accion === "expirar" ? "expirado" : "fallido",
      p_datos: estado,
    });
    return error ? "error" : "cerrado";
  }

  const r = await registrarCobro(base, { orden, token, estado });
  if (r.resultado === "error") return "error";
  if (r.resultado === "reversar") return "reversar";
  if (r.resultado === "desconocida") return "error";
  return "confirmado";
}

/** Un lote entero, de a uno (son pocos y Flow tiene límite por minuto). */
export async function conciliarLote(
  base: BaseDePagos,
  preguntar: PreguntarAFlow,
  pagos: PagoPendiente[],
): Promise<Resumen> {
  const r: Resumen = {
    revisados: 0,
    confirmados: 0,
    reversar: 0,
    cerrados: 0,
    siguen_pendientes: 0,
    sin_respuesta: 0,
    errores: 0,
  };
  for (const p of pagos) {
    r.revisados++;
    let d: Desenlace;
    try {
      d = await conciliarUno(base, preguntar, p);
    } catch {
      d = "error";
    }
    if (d === "confirmado") r.confirmados++;
    else if (d === "reversar") r.reversar++;
    else if (d === "cerrado") r.cerrados++;
    else if (d === "sigue_pendiente") r.siguen_pendientes++;
    else if (d === "sin_respuesta") r.sin_respuesta++;
    else r.errores++;
  }
  return r;
}

/** Desde cuándo un pendiente ya se puede mirar. */
export function corteDeEspera(ahora: Date, minutos = ESPERA_MINUTOS): string {
  return new Date(ahora.getTime() - minutos * 60_000).toISOString();
}

/**
 * ¿El secreto de la cabecera es el esperado? En tiempo constante, y un
 * secreto esperado vacío NUNCA deja pasar: sin configurar, nadie entra.
 */
export function secretoValido(recibido: string | null, esperado: string | undefined): boolean {
  const a = new TextEncoder().encode(recibido ?? "");
  const b = new TextEncoder().encode((esperado ?? "").trim());
  if (b.length < 32 || a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a[i] ^ b[i];
  return dif === 0;
}
