// supabase/functions/reportar-problema/index.ts
//
// La llama la app justo después de guardar un "Reportar un problema"
// (Ajustes → Soporte, tabla support_tickets, migración 52) para avisar al
// equipo por correo.
//
// EL INSERT NO PASA POR ACÁ. A diferencia de `solicitud-recinto`, la app ya
// guarda el ticket directo contra la tabla (protegida por su propia RLS,
// `auth.uid() = user_id`) porque no hace falta ninguna clave que no pueda
// vivir en el cliente para ESO. Lo único que sí la necesita es el correo:
// esta función solo lee la fila recién creada y avisa.
//
// CON EL TOKEN DE QUIEN REPORTA, NO CON service_role. La RLS de
// support_tickets ya dice "cada uno ve solo lo suyo" — reusarla acá evita
// tener que revalidar a mano de quién es el ticket, y de paso
// `auth.getUser()` con ese mismo token trae el correo de quien reporta sin
// pedir un segundo dato ni la API de administración.
//
// EL CORREO NO PUEDE VOLTEAR EL REPORTE. Si los secretos no están o el
// proveedor falla, se contesta `ok: true` con `avisado: false`: el ticket
// ya quedó guardado y el equipo lo puede leer desde Supabase igual. Por lo
// mismo, `src/services/supportTickets.js` llama a esto DESPUÉS de guardar,
// nunca antes, y no revienta el reporte si esta función no responde.
//
// SECRETS: los de `_shared/correoReporte.ts`.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enviarCorreo, leerConfigCorreo, type Ticket } from "../_shared/correoReporte.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const auth = req.headers.get("Authorization") ?? "";

  let cuerpo: any;
  try {
    cuerpo = await req.json();
  } catch {
    return json({ ok: false, reason: "No entendimos la solicitud." }, 400);
  }

  const id: string | null = typeof cuerpo?.id === "string" && cuerpo.id ? cuerpo.id : null;
  if (!id) return json({ ok: false, reason: "Falta el id del reporte." }, 400);

  // Con el token de quien reporta: la validación y la RLS siguen siendo
  // las de la base, igual que en `solicitud-recinto`.
  const comoUsuario = createClient(url, anon, { global: { headers: { Authorization: auth } } });

  const { data: { user }, error: eUser } = await comoUsuario.auth.getUser();
  if (eUser || !user) {
    return json({ ok: false, reason: "Inicia sesión para mandarnos tu reporte." }, 401);
  }

  // `support_tickets_select_own` ya deja ver solo lo propio: si esto vuelve
  // vacío, o el ticket no existe o no es de esta persona — en los dos
  // casos, nada que avisar, y no es un error que reportar de vuelta (el
  // ticket, si existe, ya está guardado de todas formas).
  const { data: fila, error: eFila } = await comoUsuario
    .from("support_tickets")
    .select("id, category, title, description, screenshot_url, app_version, platform, created_at")
    .eq("id", id)
    .maybeSingle();

  if (eFila || !fila) {
    console.error("[reportar-problema] no se encontró el ticket a avisar:", eFila);
    return json({ ok: true, avisado: false });
  }

  const config = leerConfigCorreo((k) => Deno.env.get(k));
  if (!config) {
    console.log(`[reportar-problema] ticket ${id} guardado; sin proveedor de correo configurado.`);
    return json({ ok: true, avisado: false });
  }

  // `profiles_read_all` es de lectura pública, así que el mismo token
  // alcanza para el username — no hace falta la clave de servicio tampoco
  // acá.
  const { data: perfil } = await comoUsuario
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  const ticket: Ticket = {
    id: fila.id,
    category: fila.category,
    title: fila.title,
    description: fila.description,
    screenshot_url: fila.screenshot_url,
    app_version: fila.app_version,
    platform: fila.platform,
    created_at: fila.created_at,
    reporter_username: perfil?.username ?? null,
    reporter_email: user.email ?? null,
  };

  const salio = await enviarCorreo(config, ticket);
  return json({ ok: true, avisado: salio });
});
