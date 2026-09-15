// supabase/functions/_shared/correoSolicitud.ts
//
// Lo único que sabe de correo. Igual que `flowLogic.ts` con Flow: cambiar de
// proveedor es reescribir este archivo y nada más.
//
// TODO ACÁ ES PURO menos `enviarCorreo`, para poder probar el asunto, el
// cuerpo y la lectura de secretos sin mandar un solo correo.
//
// SECRETS (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY         · del proveedor
//   SOLICITUDES_EMAIL_TO   · a dónde llegan las solicitudes (uno o varios,
//                            separados por coma)
//   SOLICITUDES_EMAIL_FROM · opcional, el remitente verificado
//
// SIN SECRETOS NO FALLA: `leerConfigCorreo` devuelve null y quien llama sigue
// adelante. La solicitud ya está guardada en la base; el correo es el aviso,
// no el registro.

export type ConfigCorreo = {
  apiKey: string;
  para: string[];
  desde: string;
};

/**
 * La solicitud tal como la devuelve `solicitudes_recinto`.
 *
 * Los tres campos de la migración 110 son OPCIONALES en el tipo, no por
 * comodidad: las solicitudes anteriores a esa migración no los tienen, y una
 * app vieja tampoco los manda. El cuerpo del correo lo dice en vez de dejar un
 * hueco que se lea como «no tiene canchas».
 */
export type Solicitud = {
  id: string;
  nombre_recinto: string;
  direccion: string;
  comuna: string;
  nombre_dueno: string;
  telefono: string;
  correo: string;
  mensaje: string | null;
  n_canchas?: number | null;
  servicios?: string[] | null;
  fotos?: string[] | null;
  created_at?: string | null;
};

// `onboarding@resend.dev` es el remitente de prueba del proveedor: sirve para
// comprobar el circuito antes de verificar un dominio propio.
const DESDE_POR_OMISION = "FutFinder <onboarding@resend.dev>";

/**
 * Los secretos, o `null` si todavía no están cargados.
 *
 * Hacen falta los dos: una clave sin destinatario manda el correo a ninguna
 * parte, y un destinatario sin clave no manda nada.
 */
export function leerConfigCorreo(env: (k: string) => string | undefined): ConfigCorreo | null {
  const apiKey = (env("RESEND_API_KEY") ?? "").trim();
  const para = (env("SOLICITUDES_EMAIL_TO") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!apiKey || para.length === 0) return null;
  return {
    apiKey,
    para,
    desde: (env("SOLICITUDES_EMAIL_FROM") ?? "").trim() || DESDE_POR_OMISION,
  };
}

/** El asunto lleva el recinto y la comuna: es lo que se lee en la bandeja. */
export function asuntoDeSolicitud(s: Solicitud): string {
  return `Nuevo recinto: ${s.nombre_recinto} (${s.comuna})`;
}

// Los servicios se escriben con la clave del catálogo y solo se le sacan los
// guiones bajos. Traducirlos a «Arriendo de balón» obligaría a mantener el
// catálogo de la 75 en un TERCER lugar —el CHECK de Postgres, `serviciosRecinto.js`
// y acá— y lo que se gana es que un correo interno se lea un poco más lindo.
const legible = (clave: string) => clave.replace(/_/g, " ");

/**
 * El cuerpo del correo al equipo.
 *
 * `enlaces` son las URL FIRMADAS de las fotos, que arma quien llama: el bucket
 * es privado (migración 110) y la fila solo guarda la ruta, así que acá no hay
 * forma de construirlas — y tampoco debería haberla, porque firmar necesita la
 * clave de servicio y esta función es pura a propósito.
 *
 * Un correo que va a una bandeja del equipo no necesita HTML: lo que importa
 * es poder copiar el teléfono y la dirección de un tirón.
 */
export function cuerpoDeSolicitud(s: Solicitud, enlaces: string[] = []): string {
  const servicios = (s.servicios ?? []).map(legible);
  return [
    `Recinto:   ${s.nombre_recinto}`,
    `Dirección: ${s.direccion}, ${s.comuna}`,
    `Canchas:   ${s.n_canchas ?? "no lo dijo"}`,
    `Dueño:     ${s.nombre_dueno}`,
    `Teléfono:  ${s.telefono}`,
    `Correo:    ${s.correo}`,
    `Servicios: ${servicios.length ? servicios.join(", ") : "no marcó ninguno"}`,
    "",
    s.mensaje ? `Nos cuenta:\n${s.mensaje}` : "No dejó un mensaje.",
    "",
    enlaces.length
      ? `Fotos (${enlaces.length}, los enlaces vencen en 7 días):\n${enlaces.join("\n")}`
      : "No adjuntó fotos.",
    "",
    `Solicitud ${s.id}`,
  ].join("\n");
}

/**
 * Manda el correo. Devuelve si salió; nunca lanza.
 *
 * Un fallo del proveedor no puede voltear la solicitud: ya está guardada, y
 * lo único que se pierde es el aviso inmediato.
 */
export async function enviarCorreo(
  config: ConfigCorreo,
  s: Solicitud,
  enlaces: string[] = [],
): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.desde,
        to: config.para,
        reply_to: s.correo,
        subject: asuntoDeSolicitud(s),
        text: cuerpoDeSolicitud(s, enlaces),
      }),
    });
    if (!res.ok) {
      console.error("[solicitud-recinto] el proveedor rechazó el correo:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("[solicitud-recinto] no se pudo mandar el correo:", e);
    return false;
  }
}
