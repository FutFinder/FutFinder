// Pruebas del aviso por correo de "Reportar un problema". Se corren con
// `deno test` y no tocan red ni credenciales.
//
// LO QUE SE PRUEBA ES QUE LA FALTA DE SECRETOS NO SEA UN ERROR. Mientras no
// exista la cuenta del proveedor de correo, `leerConfigCorreo` tiene que
// devolver null en silencio: el ticket se guarda igual (la app ya lo hace
// directo contra la tabla) y el circuito completo no puede depender de un
// secreto que todavía no está.
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  asuntoDeReporte,
  cuerpoDeReporte,
  leerCaptura,
  leerConfigCorreo,
  resolverCaptura,
  type Ticket,
  VIGENCIA_ENLACE_S,
} from "./correoReporte.ts";

const env = (m: Record<string, string>) => (k: string) => m[k];

const TICKET: Ticket = {
  id: "11111111-1111-1111-1111-111111111111",
  category: "fallo_tecnico",
  title: "Error al cargar el mapa",
  description: null,
  screenshot_url: null,
  app_version: null,
  platform: null,
  created_at: "2026-09-22T12:00:00.000Z",
  reporter_username: "vicho",
  reporter_email: "vicho@example.com",
};

Deno.test("sin la clave del proveedor no hay configuración, y eso no es un error", () => {
  assertEquals(leerConfigCorreo(env({})), null);
  assertEquals(leerConfigCorreo(env({ REPORTES_EMAIL_TO: "a@b.cl" })), null, "un destinatario sin clave no manda nada");
});

Deno.test("con la clave y sin REPORTES_EMAIL_TO, cae en el destino por omisión", () => {
  const c = leerConfigCorreo(env({ RESEND_API_KEY: "llave" }));
  assertEquals(c?.para, ["futfindercl@gmail.com"]);
});

Deno.test("con los dos secretos hay configuración, y el remitente tiene omisión", () => {
  const c = leerConfigCorreo(env({ RESEND_API_KEY: "llave", REPORTES_EMAIL_TO: "equipo@futfinder.cl" }));
  assertEquals(c?.apiKey, "llave");
  assertEquals(c?.para, ["equipo@futfinder.cl"]);
  assertEquals(c?.desde, "FutFinder <onboarding@resend.dev>");
});

Deno.test("varios destinatarios van separados por coma, sin espacios de más", () => {
  const c = leerConfigCorreo(env({
    RESEND_API_KEY: "llave",
    REPORTES_EMAIL_TO: " equipo@futfinder.cl , vicente@futfinder.cl ,, ",
    REPORTES_EMAIL_FROM: "FutFinder <hola@futfinder.cl>",
  }));
  assertEquals(c?.para, ["equipo@futfinder.cl", "vicente@futfinder.cl"]);
  assertEquals(c?.desde, "FutFinder <hola@futfinder.cl>");
});

Deno.test("el asunto lleva la categoría traducida entre corchetes", () => {
  assertEquals(asuntoDeReporte(TICKET), "[Fallo técnico] Error al cargar el mapa");
});

Deno.test("una categoría fuera del catálogo sale igual, con la clave cruda", () => {
  // Mejor un correo con "otra_cosa" en vez de una etiqueta bonita, que un
  // correo que no sale porque el catálogo cambió y esto quedó atrás.
  assertEquals(
    asuntoDeReporte({ ...TICKET, category: "otra_cosa" }),
    "[otra_cosa] Error al cargar el mapa",
  );
});

Deno.test("el cuerpo trae el folio, la categoría y quién reporta", () => {
  const cuerpo = cuerpoDeReporte(TICKET);
  assertEquals(cuerpo.includes("11111111-1111-1111-1111-111111111111"), true);
  assertEquals(cuerpo.includes("Fallo técnico"), true);
  assertEquals(cuerpo.includes("vicho (vicho@example.com)"), true);
  assertEquals(cuerpo.includes("Error al cargar el mapa"), true);
});

Deno.test("sin descripción lo dice, en vez de dejar un hueco", () => {
  assertEquals(cuerpoDeReporte(TICKET).includes("No dejó una descripción."), true);
  assertEquals(
    cuerpoDeReporte({ ...TICKET, description: "Pasa siempre al abrir el buscador" })
      .includes("Pasa siempre al abrir el buscador"),
    true,
  );
});

Deno.test("sin captura lo dice, y con captura trae el enlace", () => {
  assertEquals(cuerpoDeReporte(TICKET).includes("No adjuntó captura de pantalla."), true);
  const conCaptura = cuerpoDeReporte({ ...TICKET, screenshot_url: "https://ejemplo/captura.png" });
  assertEquals(conCaptura.includes("https://ejemplo/captura.png"), true);
});

Deno.test("sin username ni correo, el cuerpo lo dice en vez de dejar un hueco", () => {
  // Reportes viejos o de una app que no mandó el dato: no puede leerse
  // como "(null)" ni como "()" vacío.
  const cuerpo = cuerpoDeReporte({ ...TICKET, reporter_username: null, reporter_email: null });
  assertEquals(cuerpo.includes("sin nombre de usuario (sin correo)"), true);
});

Deno.test("app y plataforma sin informar lo dicen, no quedan en blanco", () => {
  const cuerpo = cuerpoDeReporte(TICKET);
  assertEquals(cuerpo.includes("versión no informada"), true);
  assertEquals(cuerpo.includes("plataforma no informada"), true);
  const conDatos = cuerpoDeReporte({ ...TICKET, app_version: "1.4.2", platform: "ios" });
  assertEquals(conDatos.includes("1.4.2 · ios"), true);
});

// ── La captura, desde que el bucket es privado (migración 174) ──────────
//
// La columna `screenshot_url` trae DOS formas y las dos tienen que terminar
// en un enlace que abra: la ruta (app nueva) y la URL pública completa
// (tickets anteriores y apps ya instaladas, que no se actualizan solas).

const RUTA = "22222222-2222-2222-2222-222222222222/1700000000000.jpg";
const URL_VIEJA =
  `https://proyecto.supabase.co/storage/v1/object/public/support-screenshots/${RUTA}?t=1700000000001`;
const FIRMADA = "https://proyecto.supabase.co/storage/v1/object/sign/support-screenshots/x.jpg?token=abc";

Deno.test("captura: la ruta que guarda la app nueva se lee como ruta", () => {
  assertEquals(leerCaptura(RUTA), { tipo: "ruta", ruta: RUTA, original: null });
  assertEquals(leerCaptura(`/${RUTA}`), { tipo: "ruta", ruta: RUTA, original: null }, "una barra de más no la rompe");
});

Deno.test("captura: de la URL pública vieja se saca la ruta, sin el ?t= de caché", () => {
  assertEquals(leerCaptura(URL_VIEJA), { tipo: "ruta", ruta: RUTA, original: URL_VIEJA });
});

Deno.test("captura: un nombre con espacios o tildes vuelve de la URL tal como está en el bucket", () => {
  const url = "https://p.supabase.co/storage/v1/object/public/support-screenshots/uid/mi%20captura%20%C3%B1.png";
  const c = leerCaptura(url);
  assertEquals(c.tipo === "ruta" && c.ruta, "uid/mi captura ñ.png");
});

Deno.test("captura: una URL de otro bucket o de otro sitio no se toca", () => {
  const otroBucket = "https://p.supabase.co/storage/v1/object/public/avatars/uid/avatar.jpg";
  assertEquals(leerCaptura(otroBucket), { tipo: "externa", url: otroBucket });
  assertEquals(leerCaptura("https://ejemplo/captura.png"), { tipo: "externa", url: "https://ejemplo/captura.png" });
});

Deno.test("captura: vacío, nulo o sólo espacios es «no adjuntó»", () => {
  assertEquals(leerCaptura(null), { tipo: "ninguna" });
  assertEquals(leerCaptura(undefined), { tipo: "ninguna" });
  assertEquals(leerCaptura("   "), { tipo: "ninguna" });
});

Deno.test("captura: se firma la RUTA, por una semana, venga como ruta o como URL vieja", async () => {
  for (const valor of [RUTA, URL_VIEJA]) {
    const pedidos: Array<[string, number]> = [];
    const r = await resolverCaptura(valor, (ruta, segundos) => {
      pedidos.push([ruta, segundos]);
      return Promise.resolve(FIRMADA);
    });
    assertEquals(pedidos, [[RUTA, VIGENCIA_ENLACE_S]]);
    assertEquals(r, { screenshot_url: FIRMADA, screenshot_ruta: RUTA, screenshot_firmado: true });
  }
  assertEquals(VIGENCIA_ENLACE_S, 60 * 60 * 24 * 7);
});

Deno.test("captura: sin captura no se firma nada", async () => {
  let llamadas = 0;
  const r = await resolverCaptura(null, () => {
    llamadas++;
    return Promise.resolve(FIRMADA);
  });
  assertEquals(llamadas, 0);
  assertEquals(r, { screenshot_url: null, screenshot_ruta: null, screenshot_firmado: false });
});

Deno.test("captura: si no se puede firmar, el correo igual dice dónde está", async () => {
  // Con ruta: no hay enlace, pero la ruta no se pierde.
  const sinEnlace = await resolverCaptura(RUTA, () => Promise.resolve(null));
  assertEquals(sinEnlace, { screenshot_url: null, screenshot_ruta: RUTA, screenshot_firmado: false });
  // Con la URL vieja: se manda esa, que abre mientras el bucket siga público.
  const conVieja = await resolverCaptura(URL_VIEJA, () => Promise.reject(new Error("storage caído")));
  assertEquals(conVieja, { screenshot_url: URL_VIEJA, screenshot_ruta: RUTA, screenshot_firmado: false });
});

Deno.test("cuerpo: el enlace firmado avisa que vence y dónde queda la captura después", () => {
  const cuerpo = cuerpoDeReporte({ ...TICKET, screenshot_url: FIRMADA, screenshot_ruta: RUTA, screenshot_firmado: true });
  assertEquals(cuerpo.includes(FIRMADA), true);
  assertEquals(cuerpo.includes("vence en 7 días"), true);
  assertEquals(cuerpo.includes(`Storage → support-screenshots → ${RUTA}`), true);
});

Deno.test("cuerpo: una captura que no se pudo firmar NUNCA se lee como «no adjuntó»", () => {
  const sinEnlace = cuerpoDeReporte({ ...TICKET, screenshot_url: null, screenshot_ruta: RUTA, screenshot_firmado: false });
  assertEquals(sinEnlace.includes("No adjuntó captura de pantalla."), false);
  assertEquals(sinEnlace.includes(`Storage → support-screenshots → ${RUTA}`), true);
  const conVieja = cuerpoDeReporte({ ...TICKET, screenshot_url: URL_VIEJA, screenshot_ruta: RUTA, screenshot_firmado: false });
  assertEquals(conVieja.includes(URL_VIEJA), true);
  assertEquals(conVieja.includes("vence en 7 días"), false, "no promete un enlace firmado que no hay");
});
