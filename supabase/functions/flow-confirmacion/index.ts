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
// reserva pagada. Un token sin forma, o uno que Flow no reconoce, es 400: no
// viene de Flow y reintentarlo no cambia nada.
//
// LA URL ES PÚBLICA Y CADA POST ERA UNA LLAMADA FIRMADA A FLOW (2026-11-13).
// Con basura en el token se gastaba el límite de la API del comercio y se
// devolvía 500. Ahora: la forma del token se mira antes, y hay un tope por IP
// en la base (`limite_aviso_de_pago`, migración 178).
//
// UN COBRO CONFIRMADO NUNCA SE PIERDE: ver `_shared/flowPagos.ts`.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import { accionSegunEstado, firmados, leerConfig, tokenConForma } from "../_shared/flowLogic.ts";
import { registrarCobro } from "../_shared/flowPagos.ts";

const texto = (cuerpo: string, status: number) => new Response(cuerpo, { status });

Deno.serve(async (req) => {
  if (req.method !== "POST") return texto("solo POST", 405);

  const config = leerConfig((k) => Deno.env.get(k));
  if (!config) {
    // Nadie debería estar llamando esto todavía.
    console.error("[flow] llegó un aviso y no hay credenciales configuradas");
    return texto("sin configurar", 503);
  }

  // Flow manda `application/x-www-form-urlencoded`. Se acepta JSON también
  // porque es lo que uno usa para probar a mano.
  let token = "";
  try {
    const tipo = req.headers.get("content-type") || "";
    if (tipo.includes("json")) token = String((await req.json())?.token || "");
    else token = String((await req.formData()).get("token") || "");
  } catch {
    token = "";
  }
  if (!tokenConForma(token)) return texto("token inválido", 400);

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── 0. Tope por IP, antes de gastar una llamada a Flow ─────────
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "sin-ip";
  const { data: permitido, error: errLimite } = await supa.rpc("limite_aviso_de_pago", { p_ip: ip });
  if (errLimite) {
    // Si el tope no responde se sigue: perder un aviso real es peor.
    console.error("[flow] limite_aviso_de_pago no respondió");
  } else if (permitido === false) {
    return texto("demasiados avisos", 429);
  }

  // ── 1. Preguntarle a Flow, que es lo único que vale ────────────
  let estado: any;
  try {
    const params = await firmados({ token }, config);
    const resp = await fetch(`${config.apiBase}/payment/getStatus?${params.toString()}`);
    estado = await resp.json().catch(() => null);
    if (resp.status === 400) {
      // Flow no conoce ese token: no es un aviso suyo.
      return texto("token desconocido", 400);
    }
    if (!resp.ok || !estado?.commerceOrder) {
      // Sólo código y mensaje: la respuesta completa puede traer el correo
      // de quien paga.
      console.error("[flow] getStatus", resp.status, estado?.code ?? "", estado?.message ?? "");
      return texto("getStatus falló", 500);
    }
  } catch (_e) {
    console.error("[flow] getStatus no respondió");
    return texto("getStatus no respondió", 500);
  }

  const orden: string = estado.commerceOrder;
  const accion = accionSegunEstado(Number(estado.status));

  if (accion === "esperar") {
    // Estado 1 (pendiente) o algo que Flow inventó después. No se toca nada.
    return texto("sin cambios", 200);
  }

  if (accion !== "confirmar") {
    const { error } = await supa.rpc("rechazar_pago", {
      p_orden_comercio: orden,
      p_estado: accion === "expirar" ? "expirado" : "fallido",
      p_datos: estado,
    });
    if (error) {
      console.error("[flow] rechazar_pago falló. orden:", orden);
      return texto("error", 500);
    }
    return texto("ok", 200);
  }

  // ── 2. Pagada ──────────────────────────────────────────────────
  const r = await registrarCobro({
    leerPago: (o) => supa.from("pagos").select("id, monto, estado").eq("orden_comercio", o).maybeSingle() as any,
    rpc: (fn, args) => supa.rpc(fn, args) as any,
  }, { orden, token, estado });
  return texto(r.resultado, r.http);
});
