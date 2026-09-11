// supabase/functions/flow-confirmacion/index.ts
//
// EL AVISO DE FLOW. Es la URL que Flow llama de servidor a servidor cuando
// una transacción cambia de estado (`urlConfirmation`).
//
// NO SE LE CREE AL POST. Flow manda un `token` y nada más, y cualquiera
// puede hacer ese POST: la URL es pública por definición. Lo único que el
// aviso significa es «anda a preguntar». La verdad sale de `payment/getStatus`,
// que va firmado con la Secret Key y por lo tanto no se puede falsificar sin
// tenerla. De ahí que este archivo no lea ni un campo del cuerpo salvo el
// token.
//
// CONSECUENCIA DE ESO: esta función tiene que desplegarse SIN verificación
// de JWT (`verify_jwt = false`, ver `supabase/config.toml`). Flow no tiene
// sesión de Supabase ni puede tenerla. Lo que la protege no es un token de
// entrada, es que sin la Secret Key nadie puede hacer que `getStatus`
// conteste «pagada».
//
// LA IDEMPOTENCIA NO ESTÁ ACÁ, ESTÁ EN LA BASE. Flow reintenta el aviso
// varias veces si no contestamos 200, y puede mandarlo dos veces igual.
// `confirmar_pago` sobre un pago ya pagado devuelve ok sin volver a hacer
// nada (migración 78). Este archivo no intenta acordarse de nada.
//
// CUÁNDO CONTESTAMOS 200 Y CUÁNDO NO. 200 = «ya está anotado, no insistas».
// Si no pudimos preguntarle a Flow o la base falló, devolvemos 500 A
// PROPÓSITO, para que Flow reintente: perder un aviso de pago es perder una
// reserva pagada.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { accionSegunEstado, firmados, leerConfig, montoCoincide } from "../_shared/flowLogic.ts";

Deno.serve(async (req) => {
  const config = leerConfig((k) => Deno.env.get(k));
  if (!config) {
    // Nadie debería estar llamando esto todavía.
    console.error("[flow] llegó un aviso y no hay credenciales configuradas");
    return new Response("sin configurar", { status: 503 });
  }

  // Flow manda `application/x-www-form-urlencoded`. Se acepta JSON también
  // porque es lo que uno usa para probar a mano.
  let token = "";
  try {
    const tipo = req.headers.get("content-type") || "";
    if (tipo.includes("json")) token = (await req.json())?.token || "";
    else token = String((await req.formData()).get("token") || "");
  } catch {
    token = "";
  }
  if (!token) return new Response("falta token", { status: 400 });

  // ── 1. Preguntarle a Flow, que es lo único que vale ────────────
  let estado: any;
  try {
    const params = await firmados({ token }, config);
    const resp = await fetch(`${config.apiBase}/payment/getStatus?${params.toString()}`);
    estado = await resp.json();
    if (!resp.ok || !estado?.commerceOrder) {
      console.error("[flow] getStatus", resp.status, JSON.stringify(estado));
      return new Response("getStatus falló", { status: 500 });
    }
  } catch (e) {
    console.error("[flow] getStatus no respondió:", e);
    return new Response("getStatus no respondió", { status: 500 });
  }

  const orden: string = estado.commerceOrder;
  const accion = accionSegunEstado(Number(estado.status));
  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (accion === "esperar") {
    // Estado 1 (pendiente) o algo que Flow inventó después. No se toca nada.
    return new Response("sin cambios", { status: 200 });
  }

  if (accion !== "confirmar") {
    const { error } = await supa.rpc("rechazar_pago", {
      p_orden_comercio: orden,
      p_estado: accion === "expirar" ? "expirado" : "fallido",
      p_datos: estado,
    });
    if (error) {
      console.error("[flow] rechazar_pago:", error.message, "orden:", orden);
      return new Response("error", { status: 500 });
    }
    return new Response("ok", { status: 200 });
  }

  // ── 2. Pagada: el monto tiene que ser el nuestro ───────────────
  // `confirmar_pago` no compara montos —no los recibe— así que la
  // comparación es responsabilidad de acá. En la práctica no puede fallar
  // (el monto va firmado en el `payment/create` y Flow cobra ese), pero es
  // la diferencia entre cobrar lo que corresponde y cobrar lo que nos digan.
  const { data: pago, error: errPago } = await supa
    .from("pagos").select("id, monto, estado").eq("orden_comercio", orden).maybeSingle();
  if (errPago) {
    console.error("[flow] no se pudo leer el pago:", errPago.message, "orden:", orden);
    return new Response("error", { status: 500 });
  }
  if (!pago) {
    // Una orden que no es nuestra. No es un error nuestro: 200 para que Flow
    // no siga reintentando algo que nunca vamos a reconocer.
    console.error("[flow] aviso de una orden desconocida:", orden);
    return new Response("orden desconocida", { status: 200 });
  }
  if (!montoCoincide(pago.monto, estado.amount)) {
    // NO SE CONFIRMA. El pago queda pendiente y esto queda gritado en el log:
    // es una anomalía que tiene que mirar una persona, no algo que se resuelve
    // solo. Confirmar una reserva por un monto que no es el nuestro sería
    // regalar una cancha o cobrar de más.
    console.error(
      "[flow][ALERTA] el monto no coincide. orden:", orden,
      "esperado:", pago.monto, "recibido:", estado.amount,
    );
    return new Response("monto no coincide", { status: 200 });
  }

  const { data: res, error } = await supa.rpc("confirmar_pago", {
    p_orden_comercio: orden,
    p_referencia: token,
    p_datos: estado,
  });
  if (error) {
    console.error("[flow] confirmar_pago:", error.message, "orden:", orden);
    return new Response("error", { status: 500 });
  }
  if (res?.resultado === "reversar") {
    // Pagó y no hay cancha. Queda en la tabla para devolver; acá solo se deja
    // dicho en el log, porque es lo que uno busca cuando reclaman.
    console.error("[flow][REVERSAR] hay que devolver el pago. orden:", orden);
  }
  return new Response("ok", { status: 200 });
});
