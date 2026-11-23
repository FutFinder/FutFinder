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
  // EL ENLACE QUE VA EN EL CORREO, no lo que guarda la columna: quien llama
  // lo arma con `resolverCaptura`. Desde la migración 174 el bucket es
  // privado y la columna trae una ruta (o, en tickets viejos y apps ya
  // instaladas, una URL pública que ya no abre).
  screenshot_url: string | null;
  // Dónde está la captura dentro del bucket, cuando es de las nuestras: el
  // enlace firmado vence, y el equipo tiene que poder encontrarla después.
  screenshot_ruta?: string | null;
  // Si `screenshot_url` es un enlace firmado (vence) o el que guardó la app.
  screenshot_firmado?: boolean;
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

/** El bucket de las capturas. Privado desde la migración 174. */
export const BUCKET_CAPTURAS = "support-screenshots";

/**
 * Cuánto dura el enlace firmado del correo: una semana, igual que las fotos
 * de `solicitud-recinto`. Es lo que tarda en el peor caso alguien del equipo
 * en abrir el correo; pasado eso, la captura sigue en el bucket.
 */
export const VIGENCIA_ENLACE_S = 60 * 60 * 24 * 7;

/**
 * Lo que puede traer `support_tickets.screenshot_url`, ya entendido:
 *  - `ninguna`: no adjuntó captura.
 *  - `ruta`:    una captura de nuestro bucket. Hay que firmarla. `original`
 *               es la URL tal como se guardó, cuando lo que se guardó fue
 *               una URL (sirve de respaldo si no se pudiera firmar).
 *  - `externa`: una URL que no es de nuestro bucket. Se manda tal cual.
 */
export type Captura =
  | { tipo: "ninguna" }
  | { tipo: "ruta"; ruta: string; original: string | null }
  | { tipo: "externa"; url: string };

/**
 * Entiende las DOS formas en que la app guarda la captura.
 *
 * La app nueva guarda la ruta dentro del bucket (`<user_id>/<marca>.jpg`).
 * Los tickets anteriores a la migración 174, y los de cualquier app ya
 * instalada —no hay OTA—, guardan la URL pública completa, con su `?t=` de
 * caché. Las dos tienen que terminar en un enlace que abra, así que de la
 * URL se saca la ruta. Pura: no toca red.
 */
export function leerCaptura(valor: string | null | undefined): Captura {
  const v = (valor ?? "").trim();
  if (!v) return { tipo: "ninguna" };

  if (/^https?:\/\//i.test(v)) {
    try {
      const m = new URL(v).pathname.match(
        /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/support-screenshots\/(.+)$/,
      );
      if (m) return { tipo: "ruta", ruta: decodeURIComponent(m[1]), original: v };
    } catch {
      // Una URL que no se deja leer se manda como vino: mejor un enlace raro
      // en el correo que un reporte que dice que no traía captura.
    }
    return { tipo: "externa", url: v };
  }

  return { tipo: "ruta", ruta: v.replace(/^\/+/, ""), original: null };
}

/** Firma una ruta del bucket por tantos segundos, o `null` si no pudo. */
export type Firmador = (ruta: string, segundos: number) => Promise<string | null>;

/**
 * De lo que guarda la columna a lo que va en el correo.
 *
 * `firmar` viene de fuera para que esto se pueda probar sin Storage: en la
 * función es `createSignedUrl` con el token de quien reporta.
 *
 * SI NO SE PUEDE FIRMAR, EL CORREO SALE IGUAL. Con una URL guardada se manda
 * esa (abre mientras el bucket siga público); con una ruta, se dice dónde
 * está. Nunca se contesta «no adjuntó captura» sobre un ticket que sí traía.
 */
export async function resolverCaptura(
  valor: string | null | undefined,
  firmar: Firmador,
): Promise<Pick<Ticket, "screenshot_url" | "screenshot_ruta" | "screenshot_firmado">> {
  const c = leerCaptura(valor);
  if (c.tipo === "ninguna") return { screenshot_url: null, screenshot_ruta: null, screenshot_firmado: false };
  if (c.tipo === "externa") return { screenshot_url: c.url, screenshot_ruta: null, screenshot_firmado: false };

  let firmada: string | null = null;
  try {
    firmada = await firmar(c.ruta, VIGENCIA_ENLACE_S);
  } catch {
    firmada = null;
  }
  if (firmada) return { screenshot_url: firmada, screenshot_ruta: c.ruta, screenshot_firmado: true };
  return { screenshot_url: c.original, screenshot_ruta: c.ruta, screenshot_firmado: false };
}

/** El párrafo de la captura, según lo que se haya conseguido. */
function parrafoDeCaptura(t: Ticket): string {
  const donde = t.screenshot_ruta ? `Storage → ${BUCKET_CAPTURAS} → ${t.screenshot_ruta}` : null;
  if (t.screenshot_url && t.screenshot_firmado) {
    return [
      "Captura de pantalla (enlace privado, vence en 7 días):",
      t.screenshot_url,
      ...(donde ? [`Pasado ese plazo queda en ${donde}`] : []),
    ].join("\n");
  }
  if (t.screenshot_url && donde) {
    return [
      "Captura de pantalla (no se pudo firmar el enlace; éste es el que guardó la app y sólo abre si el bucket sigue público):",
      t.screenshot_url,
      `Está en ${donde}`,
    ].join("\n");
  }
  if (t.screenshot_url) return `Captura de pantalla:\n${t.screenshot_url}`;
  if (donde) return `Adjuntó una captura, pero no se pudo generar el enlace.\nEstá en ${donde}`;
  return "No adjuntó captura de pantalla.";
}

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
    parrafoDeCaptura(t),
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
