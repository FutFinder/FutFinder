// supabase/functions/_shared/correoReporte.ts
//
// Lo único que sabe de correo para "Reportar un problema" (Ajustes →
// Soporte, tabla support_tickets, migración 52). Mismo patrón que
// `correoSolicitud.ts`: cambiar de proveedor es reescribir este archivo y
// nada más.
//
// TODO ACÁ ES PURO menos `enviarCorreo`, para poder probar el asunto y el
// cuerpo sin mandar un solo correo.
//
// SECRETS (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY       · el mismo que usa `correoSolicitud.ts` — sin esto
//                          no se manda nada, y este archivo no puede
//                          suplirlo solo
//   REPORTES_EMAIL_TO    · opcional, a dónde llegan los reportes (uno o
//                          varios, separados por coma) — sin este secreto
//                          cae en DESTINO_POR_OMISION
//   REPORTES_EMAIL_FROM  · opcional, el remitente verificado
//
// SIN SECRETOS NO FALLA: `leerConfigCorreo` devuelve null y quien llama
// sigue adelante. El ticket ya está guardado en la base; el correo es el
// aviso, no el registro.

export type ConfigCorreo = {
  apiKey: string;
  para: string[];
  desde: string;
};

/** El ticket tal como lo devuelve `support_tickets`, más quién lo mandó. */
export type Ticket = {
  id: string;
  category: string;
  title: string;
  description: string | null;
  screenshot_url: string | null;
  app_version: string | null;
  platform: string | null;
  created_at: string;
  // No vive en `support_tickets` (no tiene correo, y el username está en
  // `profiles`): quien llama los junta con `auth.getUser()` antes de armar
  // el ticket, porque acá no hay forma de pedirlos sin la clave de
  // servicio, y esta función es pura a propósito.
  reporter_username: string | null;
  reporter_email: string | null;
};

// `onboarding@resend.dev` es el remitente de prueba del proveedor: sirve
// para comprobar el circuito antes de verificar un dominio propio.
const DESDE_POR_OMISION = "FutFinder <onboarding@resend.dev>";

// Mismo destino por omisión que las solicitudes de recinto: es la casilla
// del equipo, y no depende de que alguien cargue el secreto a mano.
const DESTINO_POR_OMISION = "futfindercl@gmail.com";

/**
 * Las cuatro categorías del CHECK de la migración 52, traducidas. Si el
 * catálogo cambia y esto queda atrás, el correo igual sale — con la clave
 * cruda en vez de la etiqueta — porque un correo con "fallo_tecnico" en vez
 * de "Fallo técnico" es mejor que un correo que no sale.
 */
const CATEGORIA_LABEL: Record<string, string> = {
  fallo_tecnico: "Fallo técnico",
  reserva_cancha: "Reserva o cancha",
  comportamiento_jugador: "Comportamiento de un jugador",
  sugerencia: "Sugerencia o comentario",
};

/**
 * Los secretos, o `null` si todavía no están cargados.
 *
 * Sólo la clave del proveedor es obligatoria: sin ella no hay a quién
 * pedirle que mande el correo. El destinatario, si no se fija, cae en
 * `DESTINO_POR_OMISION`.
 */
export function leerConfigCorreo(env: (k: string) => string | undefined): ConfigCorreo | null {
  const apiKey = (env("RESEND_API_KEY") ?? "").trim();
  if (!apiKey) return null;
  const para = (env("REPORTES_EMAIL_TO") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    apiKey,
    para: para.length > 0 ? para : [DESTINO_POR_OMISION],
    desde: (env("REPORTES_EMAIL_FROM") ?? "").trim() || DESDE_POR_OMISION,
  };
}

/**
 * El asunto lleva la categoría entre corchetes: es lo primero que se lee
 * en la bandeja, y separa de un vistazo un fallo técnico de una sugerencia
 * sin tener que abrir el correo.
 */
export function asuntoDeReporte(t: Ticket): string {
  const categoria = CATEGORIA_LABEL[t.category] ?? t.category;
  return `[${categoria}] ${t.title}`;
}

/**
 * El cuerpo del correo al equipo.
 *
 * Un correo que va a una bandeja del equipo no necesita HTML: lo que
 * importa es poder copiar el folio y el correo de quien reporta de un
 * tirón, y responderle con `reply_to` si el correo lo trae.
 */
export function cuerpoDeReporte(t: Ticket): string {
  const categoria = CATEGORIA_LABEL[t.category] ?? t.category;
  const quien = t.reporter_username ?? "sin nombre de usuario";
  const correo = t.reporter_email ?? "sin correo";
  return [
    `Folio:      ${t.id}`,
    `Categoría:  ${categoria}`,
    `Reportado por: ${quien} (${correo})`,
    `Fecha:      ${t.created_at}`,
    `App:        ${t.app_version ?? "versión no informada"} · ${t.platform ?? "plataforma no informada"}`,
    "",
    t.title,
    "",
    t.description ? t.description : "No dejó una descripción.",
    "",
    t.screenshot_url ? `Captura de pantalla:\n${t.screenshot_url}` : "No adjuntó captura de pantalla.",
  ].join("\n");
}

/**
 * Manda el correo. Devuelve si salió; nunca lanza.
 *
 * Un fallo del proveedor no puede voltear el reporte: ya está guardado, y
 * lo único que se pierde es el aviso inmediato.
 */
export async function enviarCorreo(config: ConfigCorreo, t: Ticket): Promise<boolean> {
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
        ...(t.reporter_email ? { reply_to: t.reporter_email } : {}),
        subject: asuntoDeReporte(t),
        text: cuerpoDeReporte(t),
      }),
    });
    if (!res.ok) {
      console.error("[reportar-problema] el proveedor rechazó el correo:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("[reportar-problema] no se pudo mandar el correo:", e);
    return false;
  }
}
