// supabase/functions/conciliar-pagos/index.ts
//
// CONCILIA LOS PAGOS QUE QUEDARON `pendiente`. La llama `pg_cron` cada 10
// minutos (`llamar_conciliar_pagos()`, migración 190). Le pregunta a Flow por
// los pendientes con más de 20 minutos, de a 20 y los más viejos primero, y
// resuelve cada uno por el mismo camino que el aviso de Flow. La lógica está
// en `_shared/conciliarPagos.ts`.
//
// QUIÉN PUEDE LLAMARLA. Se despliega sin verificación de JWT (no hay sesión:
// la llama la base) y la protege un secreto propio en la cabecera
// `x-conciliar-secreto`: el secreto `CONCILIAR_PAGOS_SECRETO` de la función y
// el mismo valor en Vault como `conciliar_pagos_secreto`. Sin secreto
// configurado no entra nadie. Aunque alguien la llamara, sólo haría lo que
// ya hace sola: preguntarle a Flow, que es idempotente.
//
// SIN CREDENCIALES DE FLOW contesta 200 sin hacer nada: no hay pagos que
// conciliar, y el cron no tiene que llenar los logs de errores mientras la
// pasarela no está conectada.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import { firmados, leerConfig } from "../_shared/flowLogic.ts";
import { conciliarLote, corteDeEspera, LOTE, secretoValido } from "../_shared/conciliarPagos.ts";

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "solo POST" }, 405);
  if (!secretoValido(req.headers.get("x-conciliar-secreto"), Deno.env.get("CONCILIAR_PAGOS_SECRETO"))) {
    return json({ error: "no autorizado" }, 401);
  }

  const config = leerConfig((k) => Deno.env.get(k));
  if (!config) return json({ configurada: false });

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: pagos, error } = await supa
    .from("pagos")
    .select("orden_comercio, referencia_externa")
    .eq("estado", "pendiente")
    .lt("created_at", corteDeEspera(new Date()))
    .order("created_at", { ascending: true })
    .limit(LOTE);
  if (error) {
    console.error("[conciliar] no se pudo leer el lote:", error.code);
    return json({ error: "no se pudo leer el lote" }, 500);
  }

  const preguntar = async (token: string) => {
    const params = await firmados({ token }, config);
    const resp = await fetch(`${config.apiBase}/payment/getStatus?${params.toString()}`);
    const estado = await resp.json().catch(() => null);
    if (!resp.ok || !estado?.commerceOrder) {
      // Sólo código y mensaje: la respuesta completa trae el correo de quien paga.
      console.error("[conciliar] getStatus", resp.status, estado?.code ?? "", estado?.message ?? "");
      return null;
    }
    return estado as Record<string, unknown>;
  };

  const resumen = await conciliarLote(
    {
      leerPago: (o) => supa.from("pagos").select("id, monto, estado").eq("orden_comercio", o).maybeSingle() as any,
      rpc: (fn, args) => supa.rpc(fn, args) as any,
    },
    preguntar,
    pagos ?? [],
  );

  // Una fila por pasada que revisó algo: la revisión diaria mira esto.
  if (resumen.revisados > 0) {
    const { error: errAnotar } = await supa.from("conciliaciones").insert({ ...resumen, ambiente: config.ambiente });
    if (errAnotar) console.error("[conciliar] no se pudo anotar la pasada:", errAnotar.code);
  }
  if (resumen.reversar > 0) console.error("[conciliar][REVERSAR]", resumen.reversar, "cobros sin reserva");

  return json(resumen);
});
