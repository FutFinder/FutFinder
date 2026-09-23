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
  leerConfigCorreo,
  type Ticket,
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
