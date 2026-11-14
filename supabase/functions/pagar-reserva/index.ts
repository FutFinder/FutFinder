// supabase/functions/pagar-reserva/index.ts
//
// La llama la app cuando el jugador toca «pagar». Devuelve la URL de Flow a
// la que hay que mandarlo.
//
// POR QUÉ PASA POR ACÁ Y NO LLAMA A LA BASE DIRECTO. `iniciar_pago_reserva`
// está concedida a `authenticated` y la app podría llamarla sola, pero
// después hay que crear la transacción en Flow —que necesita la Secret Key—
// y anotar el token —que necesita `service_role`. Partirlo en dos viajes
// dejaría una ventana en que existe un pago pendiente que Flow no conoce.
// Acá las tres cosas pasan en una sola llamada.
//
// LO QUE SE HACE CON LA SESIÓN DEL JUGADOR Y LO QUE NO. La reserva se inicia
// CON SU TOKEN, no con `service_role`: así la comprobación de que es el
// organizador y de que la reserva se puede pagar la sigue haciendo la base,
// con las reglas de siempre. `service_role` se usa solo para anotar el token
// de Flow, que es lo único que el jugador no puede escribir.
//
// SECRETS (Supabase → Edge Functions → Secrets). Ninguno va en el repo:
//   FLOW_API_KEY        · de la cuenta de comercio
//   FLOW_SECRET_KEY     · idem — es la que firma, nunca viaja
//   FLOW_AMBIENTE       · 'sandbox' o 'produccion', OBLIGATORIO desde el
//                         2026-11-13: sin él la pasarela queda «no conectada»
//                         (ver `leerConfig` en `_shared/flowLogic.ts`)
//   FUNCTIONS_BASE_URL  · opcional, solo si hay dominio propio
//
// REINTENTAR NO REUSA LA ORDEN EN FLOW (2026-11-13). `iniciar_pago_reserva`
// devuelve el pago pendiente propio para no crear dos cobros, y antes acá se
// pedía OTRA transacción a Flow con esa misma orden: o Flow la rechazaba —y
// esa reserva no se podía pagar nunca más— o quedaban dos enlaces vivos para
// un mismo cobro. Ahora se le pregunta a Flow por el token anterior y se
// decide con `queHacerConPendiente`: si ya se cobró, se registra; si sigue
// pendiente por el mismo monto, se devuelve el MISMO enlace; si no, se cierra
// en la base y se arma una orden nueva.
//
// LA PAUSA (migración 179). Con la bandera `pagos_en_pausa` encendida no se
// crea ningún cobro nuevo: se contesta 200 con `pausada: true` y un motivo,
// ANTES de tocar la base o Flow. `flow-confirmacion` no la mira: lo que ya
// se pagó se registra igual. La barrera de verdad es el disparador de la
// base; esto es para decirlo claro (ver `_shared/pagarReserva.ts`).
//
// ANOTAR EL TOKEN PUEDE FALLAR SIN ERROR. `anotar_referencia_pago` contesta
// `{ ok: false }` con HTTP 200 si el pago ya no está pendiente. Se mira el
// resultado (`referenciaAnotada`), no sólo el error de transporte.
//
// SIN CREDENCIALES NO FALLA: contesta 200 con `configurada: false` y la app
// muestra que la pasarela todavía no está conectada. Es el estado real
// mientras no exista la cuenta de la empresa.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import {
  accionSegunEstado,
  asuntoDelPago,
  firmados,
  type FlowConfig,
  leerConfig,
  queHacerConPendiente,
  urlDePago,
} from "../_shared/flowLogic.ts";
import { registrarCobro } from "../_shared/flowPagos.ts";
import { estaEnPausa, MOTIVO_PAUSA, referenciaAnotada } from "../_shared/pagarReserva.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cuánto vive el enlace de pago. Quince minutos es lo que tarda alguien en
// buscar la tarjeta; más que eso y el bloque queda dando vueltas.
const MINUTOS_DE_PAGO = 15;

/** Lo que Flow dice hoy de un token, o `null` si no se le pudo preguntar. */
async function estadoEnFlow(token: string, config: FlowConfig): Promise<any | null> {
  try {
    const params = await firmados({ token }, config);
    const resp = await fetch(`${config.apiBase}/payment/getStatus?${params.toString()}`);
    const estado = await resp.json().catch(() => null);
    if (!resp.ok || !estado?.commerceOrder) {
      console.error("[flow] getStatus", resp.status, estado?.code ?? "", estado?.message ?? "");
      return null;
    }
    return estado;
  } catch (_e) {
    console.error("[flow] getStatus no respondió");
    return null;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const config = leerConfig((k) => Deno.env.get(k));

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const comoServicio = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Sin pasarela conectada no hay nada que pausar: ni se pregunta.
  const pausada = config ? estaEnPausa(await comoServicio.rpc("pagos_en_pausa")) : false;

  // Consulta de estado: la app pregunta ANTES de dejar apretar el botón, para
  // no crear una reserva que después no se puede pagar.
  const url = new URL(req.url);
  if (req.method === "GET" || url.searchParams.get("accion") === "estado") {
    return json({
      ok: true,
      configurada: !!config,
      ambiente: config?.ambiente ?? null,
      pausada,
    });
  }

  if (!config) {
    return json({
      ok: false,
      configurada: false,
      reason: "La pasarela de pago todavía no está conectada.",
    });
  }
  if (pausada) {
    return json({ ok: false, configurada: true, pausada: true, reason: MOTIVO_PAUSA });
  }
  if (!config.functionsBase) {
    console.error("[flow] sin SUPABASE_URL ni FUNCTIONS_BASE_URL: Flow no sabría a dónde avisar");
    return json({ ok: false, reason: "Falta configurar la URL de retorno." }, 500);
  }

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ ok: false, reason: "No autenticado" }, 401);

  let reservaId: string | null = null;
  try {
    reservaId = (await req.json())?.reservaId ?? null;
  } catch {
    return json({ ok: false, reason: "Cuerpo inválido" }, 400);
  }
  if (!reservaId) return json({ ok: false, reason: "Falta la reserva" }, 400);

  // Con la sesión del jugador: la base aplica RLS y sus propias reglas.
  const comoJugador = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });

  const { data: usuario } = await comoJugador.auth.getUser();
  const email = usuario?.user?.email;
  if (!email) return json({ ok: false, reason: "No autenticado" }, 401);

  const iniciar = () => comoJugador.rpc("iniciar_pago_reserva", { p_reserva_id: reservaId });

  // ── 1. La base crea (o reusa) el pago pendiente ────────────────
  let { data: inicio, error: errInicio } = await iniciar();
  if (errInicio) {
    console.error("[flow] iniciar_pago_reserva:", errInicio.code);
    return json({ ok: false, reason: "No se pudo iniciar el pago." }, 500);
  }
  if (!inicio?.ok) return json({ ok: false, reason: inicio?.reason || "No se pudo iniciar el pago." });

  // ── 1b. Si reusa un pendiente, ¿qué pasó con él en Flow? ───────
  if (inicio.reusado) {
    const { data: previo } = await comoServicio
      .from("pagos")
      .select("orden_comercio, referencia_externa, datos")
      .eq("id", inicio.pago_id)
      .maybeSingle();
    const tokenPrevio: string | null = previo?.referencia_externa ?? null;

    let estadoPrevio: any = null;
    if (tokenPrevio) {
      estadoPrevio = await estadoEnFlow(tokenPrevio, config);
      // Sin saber qué pasó con el cobro anterior NO se arma otro: podría
      // estar pagado.
      if (!estadoPrevio) {
        return json({ ok: false, reason: "No pudimos revisar tu intento de pago anterior. Inténtalo de nuevo en un momento." }, 502);
      }
    }

    const decision = queHacerConPendiente({
      status: estadoPrevio ? Number(estadoPrevio.status) : null,
      montoEnFlow: (previo?.datos as any)?.montoFlow,
      montoAhora: inicio.monto,
      url: (previo?.datos as any)?.url,
    });

    if (decision === "confirmar") {
      const r = await registrarCobro({
        leerPago: (o) => comoServicio.from("pagos").select("id, monto, estado").eq("orden_comercio", o).maybeSingle() as any,
        rpc: (fn, args) => comoServicio.rpc(fn, args) as any,
      }, { orden: inicio.orden_comercio, token: tokenPrevio!, estado: estadoPrevio });
      if (r.http !== 200) return json({ ok: false, reason: "No se pudo registrar tu pago. Inténtalo de nuevo." }, 500);
      return json({ ok: true, yaPagado: true, pagoId: inicio.pago_id, ambiente: config.ambiente });
    }

    if (decision === "mismo_enlace") {
      return json({
        ok: true,
        pagoId: inicio.pago_id,
        ordenComercio: inicio.orden_comercio,
        monto: inicio.monto,
        ambiente: config.ambiente,
        url: urlDePago((previo!.datos as any).url, tokenPrevio!),
      });
    }

    // cerrar_y_crear: el pendiente se cierra y se pide uno nuevo.
    const accion = estadoPrevio ? accionSegunEstado(Number(estadoPrevio.status)) : "expirar";
    const { error: errCerrar } = await comoServicio.rpc("rechazar_pago", {
      p_orden_comercio: inicio.orden_comercio,
      p_estado: accion === "rechazar" ? "fallido" : "expirado",
      p_datos: estadoPrevio ?? previo?.datos ?? null,
    });
    if (errCerrar) {
      console.error("[flow] rechazar_pago del pendiente:", errCerrar.code);
      return json({ ok: false, reason: "No se pudo iniciar el pago." }, 500);
    }
    ({ data: inicio, error: errInicio } = await iniciar());
    if (errInicio || !inicio?.ok || inicio.reusado) {
      console.error("[flow] iniciar_pago_reserva tras cerrar el pendiente:", errInicio?.code ?? inicio?.reason);
      return json({ ok: false, reason: inicio?.reason || "No se pudo iniciar el pago." }, errInicio ? 500 : 200);
    }
  }

  const { orden_comercio: orden, monto, pago_id: pagoId } = inicio;

  // ── 2. El asunto que el jugador va a ver en su tarjeta ─────────
  // Si esto falla no se cae el pago: se usa un asunto genérico. Un nombre de
  // cancha no vale un cobro perdido.
  let asunto = "Reserva de cancha · FutFinder";
  const { data: r } = await comoJugador
    .from("reservas")
    .select("fecha, hora_inicio, canchas_reservables(nombre, complejos(nombre))")
    .eq("id", reservaId)
    .maybeSingle();
  if (r) {
    const recinto = (r as any).canchas_reservables?.complejos?.nombre
      || (r as any).canchas_reservables?.nombre;
    if (recinto) asunto = asuntoDelPago(recinto, r.fecha, String(r.hora_inicio).slice(0, 5));
  }

  // ── 3. Crear la transacción en Flow ────────────────────────────
  const cuerpo = await firmados({
    commerceOrder: orden,
    subject: asunto,
    currency: "CLP",
    amount: monto,
    email,
    urlConfirmation: `${config.functionsBase}/flow-confirmacion`,
    urlReturn: `${config.functionsBase}/flow-retorno`,
    timeout: MINUTOS_DE_PAGO * 60,
  }, config);

  let creado: any;
  try {
    const resp = await fetch(`${config.apiBase}/payment/create`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: cuerpo,
    });
    creado = await resp.json();
    if (!resp.ok || !creado?.url || !creado?.token) {
      // El mensaje de Flow va al log, no al jugador: puede traer detalles de
      // la cuenta de comercio.
      console.error("[flow] payment/create", resp.status, creado?.code ?? "", creado?.message ?? "");
      return json({ ok: false, reason: "El proveedor de pago rechazó la operación." }, 502);
    }
  } catch (e) {
    console.error("[flow] payment/create no respondió:", e instanceof Error ? e.name : "error");
    return json({ ok: false, reason: "No pudimos contactar al proveedor de pago." }, 502);
  }

  // ── 4. Anotar el token para poder cruzar el aviso ──────────────
  // DESPUÉS de crear y antes de devolver: si esto falla, el jugador no se va
  // a Flow, porque un pago que no vamos a poder reconocer es peor que uno que
  // no empezó.
  // `url` y `montoFlow` se guardan para poder devolver ESTE enlace si la
  // persona vuelve a tocar «pagar» mientras sigue vigente (ver 1b).
  const anotada = referenciaAnotada(await comoServicio.rpc("anotar_referencia_pago", {
    p_orden_comercio: orden,
    p_referencia: creado.token,
    p_datos: { flowOrder: creado.flowOrder ?? null, ambiente: config.ambiente, url: creado.url, montoFlow: monto },
  }));
  if (!anotada.ok) {
    // La orden quedó creada en Flow pero nadie recibe su enlace: vence sola
    // a los MINUTOS_DE_PAGO sin que se pueda pagar.
    console.error("[flow] anotar_referencia_pago:", anotada.motivo, "orden:", orden);
    return json({ ok: false, reason: "No se pudo registrar el pago. No se te cobró nada." }, 500);
  }

  return json({
    ok: true,
    pagoId,
    ordenComercio: orden,
    monto,
    ambiente: config.ambiente,
    url: urlDePago(creado.url, creado.token),
  });
});
