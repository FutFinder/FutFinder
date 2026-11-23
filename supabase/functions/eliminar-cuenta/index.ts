// supabase/functions/eliminar-cuenta/index.ts
//
// «Eliminar mi cuenta» (Ajustes). La llama la app con la sesión de quien se
// borra.
//
// POR QUÉ HAY UNA FUNCIÓN Y NO SÓLO LA RPC. Lo de la base lo hace entero
// `delete_my_account()` (migración 176, en una sola transacción): borra lo
// personal, anonimiza lo contable, deja sin autor lo compartido y cancela lo
// futuro con aviso. Lo que la base NO puede hacer es borrar los archivos:
// Supabase no deja tocar `storage.objects` por SQL. Sin esto, la foto de
// perfil y la galería de alguien que se borró seguirían públicas por URL.
//
// EL ORDEN IMPORTA. Primero la base, con el token de la persona (así
// `auth.uid()` es ella y las reglas son las de siempre); sólo si eso salió
// bien, los archivos, con service_role. Al revés, alguien a quien la base no
// deja borrarse (tiene saldo, administra un recinto) se quedaría sin fotos
// y con la cuenta viva.
//
// LA COLA. La RPC anota la cuenta en `cuentas_por_limpiar`. Esta función la
// marca limpia cuando terminó, y de paso limpia hasta 10 cuentas viejas que
// sigan pendientes: las que borraron apps ya instaladas, que llaman la RPC
// directo y no pasan por acá.
//
// SECRETS: ninguno propio (SUPABASE_URL, SUPABASE_ANON_KEY y
// SUPABASE_SERVICE_ROLE_KEY los inyecta la plataforma).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import { type Almacen, limpiarCarpetas, MENSAJE_INESPERADO, motivoParaMostrar } from "../_shared/borrarCuenta.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const PENDIENTES_POR_PASADA = 10;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, reason: MENSAJE_INESPERADO }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const servicio = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") ?? "";

  const comoUsuario = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: eUser } = await comoUsuario.auth.getUser();
  if (eUser || !user) {
    return json({ ok: false, reason: "Inicia sesión para borrar tu cuenta." }, 401);
  }

  // 1. La base, como la persona.
  const { error: eBorrar } = await comoUsuario.rpc("delete_my_account");
  if (eBorrar) {
    const reason = motivoParaMostrar(eBorrar);
    if (reason === MENSAJE_INESPERADO) console.error("[eliminar-cuenta] delete_my_account:", eBorrar.code);
    return json({ ok: false, reason }, reason === MENSAJE_INESPERADO ? 500 : 409);
  }

  // 2. Los archivos, con service_role. La cuenta ya no existe: si algo falla
  // acá no se le dice a la persona que «no se pudo», queda en la cola.
  const admin = createClient(url, servicio, { auth: { persistSession: false, autoRefreshToken: false } });
  const almacenDe = (bucket: string) => admin.storage.from(bucket) as unknown as Almacen;

  const limpiar = async (userId: string) => {
    const r = await limpiarCarpetas(almacenDe, userId);
    if (r.completo) {
      await admin.from("cuentas_por_limpiar")
        .update({ archivos_limpios_at: new Date().toISOString() })
        .eq("user_id", userId);
    }
    return r;
  };

  let archivos = 0;
  try {
    archivos = (await limpiar(user.id)).borrados;

    const { data: pendientes } = await admin.from("cuentas_por_limpiar")
      .select("user_id")
      .is("archivos_limpios_at", null)
      .neq("user_id", user.id)
      .order("borrada_at", { ascending: true })
      .limit(PENDIENTES_POR_PASADA);
    for (const p of pendientes ?? []) await limpiar(p.user_id);
  } catch (e) {
    console.error("[eliminar-cuenta] limpieza de archivos:", e instanceof Error ? e.name : "error");
  }

  return json({ ok: true, archivos });
});
