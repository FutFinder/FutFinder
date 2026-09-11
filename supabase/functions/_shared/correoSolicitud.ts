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

/** La solicitud tal como la devuelve `solicitudes_recinto`. */
export type Solicitud = {
  id: string;
  nombre_recinto: string;
  direccion: string;
  comuna: string;
  nombre_dueno: string;
  telefono: string;
  correo: string;
  mensaje: string | null;
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

// Un correo que va a una bandeja del equipo no necesita HTML: lo que importa
// es poder copiar el teléfono y la dirección de un tirón.
export function cuerpoDeSolicitud(s: Solicitud): string {
  return [
    `Recinto:   ${s.nombre_recinto}`,
    `Dirección: ${s.direccion}, ${s.comuna}`,
    `Dueño:     ${s.nombre_dueno}`,
    `Teléfono:  ${s.telefono}`,
    `Correo:    ${s.correo}`,
    "",
    s.mensaje ? `Nos cuenta:\n${s.mensaje}` : "No dejó un mensaje.",
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
export async function enviarCorreo(config: ConfigCorreo, s: Solicitud): Promise<boolean> {
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
        text: cuerpoDeSolicitud(s),
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
