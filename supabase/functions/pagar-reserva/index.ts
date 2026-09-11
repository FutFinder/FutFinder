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
//   FLOW_AMBIENTE       · 'sandbox' (omisión) o 'produccion'
//   FUNCTIONS_BASE_URL  · opcional, solo si hay dominio propio
//
// SIN CREDENCIALES NO FALLA: contesta 200 con `configurada: false` y la app
// muestra que la pasarela todavía no está conectada. Es el estado real
// mientras no exista la cuenta de la empresa.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { asuntoDelPago, firmados, leerConfig, urlDePago } from "../_shared/flowLogic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cuánto vive el enlace de pago. Quince minutos es lo que tarda alguien en
// buscar la tarjeta; más que eso y el bloque queda dando vueltas.
const MINUTOS_DE_PAGO = 15;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const config = leerConfig((k) => Deno.env.get(k));

  // Consulta de estado: la app pregunta ANTES de dejar apretar el botón, para
  // no crear una reserva que después no se puede pagar.
  const url = new URL(req.url);
  if (req.method === "GET" || url.searchParams.get("accion") === "estado") {
    return json({
      ok: true,
      configurada: !!config,
      ambiente: config?.ambiente ?? null,
    });
  }

  if (!config) {
    return json({
      ok: false,
      configurada: false,
      reason: "La pasarela de pago todavía no está conectada.",
    });
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

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  // Con la sesión del jugador: la base aplica RLS y sus propias reglas.
  const comoJugador = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });

  const { data: usuario } = await comoJugador.auth.getUser();
  const email = usuario?.user?.email;
  if (!email) return json({ ok: false, reason: "No autenticado" }, 401);

  // ── 1. La base crea (o reusa) el pago pendiente ────────────────
  const { data: inicio, error: errInicio } = await comoJugador
    .rpc("iniciar_pago_reserva", { p_reserva_id: reservaId });

  if (errInicio) {
    console.error("[flow] iniciar_pago_reserva:", errInicio.message);
    return json({ ok: false, reason: "No se pudo iniciar el pago." }, 500);
  }
  if (!inicio?.ok) return json({ ok: false, reason: inicio?.reason || "No se pudo iniciar el pago." });

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
      console.error("[flow] payment/create", resp.status, JSON.stringify(creado));
      return json({ ok: false, reason: "El proveedor de pago rechazó la operación." }, 502);
    }
  } catch (e) {
    console.error("[flow] payment/create no respondió:", e);
    return json({ ok: false, reason: "No pudimos contactar al proveedor de pago." }, 502);
  }

  // ── 4. Anotar el token para poder cruzar el aviso ──────────────
  // DESPUÉS de crear y antes de devolver: si esto falla, el jugador no se va
  // a Flow, porque un pago que no vamos a poder reconocer es peor que uno que
  // no empezó.
  const comoServicio = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error: errRef } = await comoServicio.rpc("anotar_referencia_pago", {
    p_orden_comercio: orden,
    p_referencia: creado.token,
    p_datos: { flowOrder: creado.flowOrder ?? null, ambiente: config.ambiente },
  });
  if (errRef) {
    console.error("[flow] anotar_referencia_pago:", errRef.message, "orden:", orden);
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
