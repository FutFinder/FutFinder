// Pruebas del aviso por correo de una solicitud de recinto. Se corren con
// `deno test` y no tocan red ni credenciales.
//
// LO QUE SE PRUEBA ES QUE LA FALTA DE SECRETOS NO SEA UN ERROR. Mientras no
// exista la cuenta del proveedor de correo, `leerConfigCorreo` tiene que
// devolver null en silencio: la solicitud se guarda igual y el circuito
// completo no puede depender de un secreto que todavía no está.
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  asuntoDeSolicitud,
  cuerpoDeSolicitud,
  leerConfigCorreo,
  type Solicitud,
} from "./correoSolicitud.ts";

const env = (m: Record<string, string>) => (k: string) => m[k];

const SOLICITUD: Solicitud = {
  id: "11111111-1111-1111-1111-111111111111",
  nombre_recinto: "FutCenter Maipú",
  direccion: "Av. El Rosal 6281",
  comuna: "Maipú",
  nombre_dueno: "Vicente Bastías",
  telefono: "+56987654321",
  correo: "contacto@futcenter.cl",
  mensaje: null,
};

Deno.test("sin secretos no hay configuración, y eso no es un error", () => {
  assertEquals(leerConfigCorreo(env({})), null);
  assertEquals(leerConfigCorreo(env({ RESEND_API_KEY: "llave" })), null, "una clave sin destinatario no manda a nadie");
  assertEquals(leerConfigCorreo(env({ SOLICITUDES_EMAIL_TO: "a@b.cl" })), null, "un destinatario sin clave no manda nada");
});

Deno.test("con los dos secretos hay configuración, y el remitente tiene omisión", () => {
  const c = leerConfigCorreo(env({ RESEND_API_KEY: "llave", SOLICITUDES_EMAIL_TO: "equipo@futfinder.cl" }));
  assertEquals(c?.apiKey, "llave");
  assertEquals(c?.para, ["equipo@futfinder.cl"]);
  assertEquals(c?.desde, "FutFinder <onboarding@resend.dev>");
});

Deno.test("varios destinatarios van separados por coma, sin espacios de más", () => {
  const c = leerConfigCorreo(env({
    RESEND_API_KEY: "llave",
    SOLICITUDES_EMAIL_TO: " equipo@futfinder.cl , vicente@futfinder.cl ,, ",
    SOLICITUDES_EMAIL_FROM: "FutFinder <hola@futfinder.cl>",
  }));
  assertEquals(c?.para, ["equipo@futfinder.cl", "vicente@futfinder.cl"]);
  assertEquals(c?.desde, "FutFinder <hola@futfinder.cl>");
});

Deno.test("el asunto lleva el recinto y la comuna: es lo que se lee en la bandeja", () => {
  assertEquals(asuntoDeSolicitud(SOLICITUD), "Nuevo recinto: FutCenter Maipú (Maipú)");
});

Deno.test("el cuerpo trae todo lo que hace falta para llamar", () => {
  const cuerpo = cuerpoDeSolicitud(SOLICITUD);
  assertEquals(cuerpo.includes("Av. El Rosal 6281, Maipú"), true);
  assertEquals(cuerpo.includes("+56987654321"), true);
  assertEquals(cuerpo.includes("contacto@futcenter.cl"), true);
  assertEquals(cuerpo.includes("11111111-1111-1111-1111-111111111111"), true);
});

Deno.test("sin mensaje lo dice, en vez de dejar un hueco", () => {
  assertEquals(cuerpoDeSolicitud(SOLICITUD).includes("No dejó un mensaje."), true);
  assertEquals(
    cuerpoDeSolicitud({ ...SOLICITUD, mensaje: "Seis canchas de fútbol 7" }).includes("Seis canchas de fútbol 7"),
    true,
  );
});
