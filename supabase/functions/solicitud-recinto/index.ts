// supabase/functions/solicitud-recinto/index.ts
//
// La llama la app cuando el dueño de un recinto manda el formulario de
// «quiero sumar mi recinto». Guarda la solicitud y avisa al equipo por correo.
//
// POR QUÉ PASA POR ACÁ Y NO LLAMA A LA BASE DIRECTO. `crear_solicitud_recinto`
// está concedida a `authenticated` y la app puede llamarla sola —de hecho lo
// hace si esto no responde, ver `src/services/solicitudRecinto.js`. Lo que no
// puede hacer la app es mandar el correo: eso necesita una clave de proveedor
// que no puede vivir en el cliente.
//
// LO QUE SE HACE CON LA SESIÓN Y LO QUE NO. La solicitud se crea CON EL TOKEN
// de quien la manda, así que la validación y la RLS siguen siendo las de la
// base. `service_role` se usa solo para leer la fila recién creada —la policy
// deja verla al dueño, pero acá hace falta el teléfono y el correo completos—
// y para anotar `avisada_at`, que el solicitante no puede escribir.
//
// EL CORREO NO PUEDE VOLTEAR LA SOLICITUD. Si los secretos no están o el
// proveedor falla, se contesta `ok: true` con `avisada: false`: la fila quedó
// escrita y se lee desde Supabase. Decirle a alguien «no se pudo» cuando su
// solicitud SÍ se guardó lo haría mandarla de nuevo para nada.
//
// SECRETS: los de `_shared/correoSolicitud.ts`. Hoy no están cargados —no hay
// cuenta de proveedor de correo todavía— y esta función ya funciona igual.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enviarCorreo, leerConfigCorreo, type Solicitud } from "../_shared/correoSolicitud.ts";

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
  const servicio = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") ?? "";

  let cuerpo: any;
  try {
    cuerpo = await req.json();
  } catch {
    return json({ ok: false, reason: "No entendimos la solicitud." }, 400);
  }

  // Con el token de quien la manda: la base decide si puede y si los datos
  // están bien, con las mismas reglas que si la app llamara sola.
  const comoUsuario = createClient(url, anon, { global: { headers: { Authorization: auth } } });

  const { data, error } = await comoUsuario.rpc("crear_solicitud_recinto", {
    p_nombre_recinto: cuerpo?.nombreRecinto ?? null,
    p_direccion: cuerpo?.direccion ?? null,
    p_comuna: cuerpo?.comuna ?? null,
    p_nombre_dueno: cuerpo?.nombreDueno ?? null,
    p_telefono: cuerpo?.telefono ?? null,
    p_correo: cuerpo?.correo ?? null,
    p_mensaje: cuerpo?.mensaje ?? null,
  });

  if (error) {
    // `verify_jwt` NO garantiza que haya sesión: la clave anónima es un JWT
    // válido, así que esta función corre igual para quien no inició sesión y
    // choca con el `grant ... to authenticated` de la RPC. No es un error del
    // servidor, es que falta la sesión — y decirlo así evita mandar a alguien
    // a «inténtalo de nuevo» cuando reintentar no va a cambiar nada.
    if ((error as any)?.code === "42501") {
      return json({ ok: false, reason: "Inicia sesión para mandarnos tu recinto." });
    }
    console.error("[solicitud-recinto] no se pudo guardar:", error);
    return json({ ok: false, reason: "No pudimos guardar tu solicitud. Inténtalo de nuevo." }, 500);
  }
  if (!data?.ok) {
    return json({ ok: false, reason: data?.reason ?? "Revisa los datos del formulario." });
  }

  const id: string = data.id;
  const reusada: boolean = !!data.reusada;

  const config = leerConfigCorreo((k) => Deno.env.get(k));
  if (!config) {
    console.log(`[solicitud-recinto] solicitud ${id} guardada; sin proveedor de correo configurado.`);
    return json({ ok: true, id, reusada, avisada: false });
  }

  const admin = createClient(url, servicio);
  const { data: fila, error: eFila } = await admin
    .from("solicitudes_recinto")
    .select("id, nombre_recinto, direccion, comuna, nombre_dueno, telefono, correo, mensaje, created_at, avisada_at")
    .eq("id", id)
    .maybeSingle();

  if (eFila || !fila) {
    console.error("[solicitud-recinto] guardada pero no se pudo leer para avisar:", eFila);
    return json({ ok: true, id, reusada, avisada: false });
  }

  // Una solicitud reusada ya avisada no se avisa dos veces: apretar el botón
  // de nuevo no puede llenar la bandeja del equipo.
  if (fila.avisada_at) return json({ ok: true, id, reusada, avisada: true });

  const salio = await enviarCorreo(config, fila as Solicitud);
  if (salio) {
    const { error: eSello } = await admin
      .from("solicitudes_recinto")
      .update({ avisada_at: new Date().toISOString() })
      .eq("id", id);
    if (eSello) console.error("[solicitud-recinto] correo enviado pero no se pudo anotar:", eSello);
  }

  return json({ ok: true, id, reusada, avisada: salio });
});
