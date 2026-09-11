// Pruebas de la traducción a Flow. Se corren con `deno test` y no tocan red
// ni credenciales.
//
// EL CASO QUE IMPORTA ES EL PRIMERO. El vector está calculado por fuera, con
// `openssl dgst -sha256 -hmac`, justo para que no sea esta implementación
// comprobándose a sí misma: si alguien «ordena» los parámetros de otra
// forma, o concatena con un separador, el hexadecimal deja de coincidir.
import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  accionSegunEstado,
  asuntoDelPago,
  firmados,
  firmar,
  leerConfig,
  montoCoincide,
  urlDePago,
} from "./flowLogic.ts";

const SECRETO = "secreto";
// printf '%s' "amount15000apiKeyllavecommerceOrderFF-1" \
//   | openssl dgst -sha256 -hmac "secreto" -hex
const ESPERADA = "7b045c354d0477691486c177a4c5dbd5a5137e4ed91b0bd661f563945fd17889";

Deno.test("la firma es el HMAC de nombre+valor en orden alfabético", async () => {
  const s = await firmar(
    { amount: 15000, apiKey: "llave", commerceOrder: "FF-1" },
    SECRETO,
  );
  assertEquals(s, ESPERADA);
});

Deno.test("el orden en que se escribe el objeto no cambia la firma", async () => {
  // Un objeto literal en JavaScript conserva el orden de escritura, así que
  // sin el `sort()` esta prueba fallaría y la de arriba no.
  const alReves = await firmar(
    { commerceOrder: "FF-1", apiKey: "llave", amount: 15000 },
    SECRETO,
  );
  assertEquals(alReves, ESPERADA);
});

Deno.test("`s` viaja aparte y no se firma a sí misma", async () => {
  const cfg = {
    apiKey: "llave",
    secretKey: SECRETO,
    apiBase: "x",
    ambiente: "sandbox" as const,
    functionsBase: "y",
  };
  const cuerpo = await firmados({ amount: 15000, commerceOrder: "FF-1" }, cfg);
  assertEquals(cuerpo.get("s"), ESPERADA);
  assertEquals(cuerpo.get("apiKey"), "llave");
  // La Secret Key nunca sale en el cuerpo: solo firma.
  assert(!cuerpo.toString().includes(SECRETO));
});

Deno.test("sin credenciales no hay configuración, y eso no es un error", () => {
  assertEquals(leerConfig(() => undefined), null);
  assertEquals(leerConfig((k) => (k === "FLOW_API_KEY" ? "solo-la-mitad" : undefined)), null);
  // Espacios en blanco de un copiar y pegar no cuentan como credencial.
  assertEquals(leerConfig(() => "   "), null);
});

Deno.test("producción se pide explícitamente; cualquier otra cosa es sandbox", () => {
  const env = (extra: Record<string, string>) => (k: string) =>
    ({ FLOW_API_KEY: "a", FLOW_SECRET_KEY: "b", ...extra })[k];

  assertEquals(leerConfig(env({}))?.ambiente, "sandbox");
  assertEquals(leerConfig(env({ FLOW_AMBIENTE: "" }))?.ambiente, "sandbox");
  assertEquals(leerConfig(env({ FLOW_AMBIENTE: "prod" }))?.ambiente, "sandbox");
  assertEquals(leerConfig(env({ FLOW_AMBIENTE: "PRODUCCION" }))?.ambiente, "produccion");
  assertEquals(
    leerConfig(env({ FLOW_AMBIENTE: "produccion" }))?.apiBase,
    "https://www.flow.cl/api",
  );
});

Deno.test("un estado desconocido espera, no falla", () => {
  assertEquals(accionSegunEstado(1), "esperar");
  assertEquals(accionSegunEstado(2), "confirmar");
  assertEquals(accionSegunEstado(3), "rechazar");
  assertEquals(accionSegunEstado(4), "expirar");
  // Si Flow inventa un estado 9, marcar el pago como fallido sería peor que
  // dejarlo esperando: el cobro pudo haber salido igual.
  assertEquals(accionSegunEstado(9), "esperar");
});

Deno.test("el monto se compara como número, venga como venga", () => {
  assert(montoCoincide(15000, 15000));
  assert(montoCoincide(15000, "15000"));
  assert(montoCoincide(15000, 15000.0));
  assert(!montoCoincide(15000, 1500));
  assert(!montoCoincide(15000, null));
  assert(!montoCoincide(15000, "quince mil"));
});

Deno.test("el asunto se recorta a lo que Flow acepta", () => {
  assertEquals(asuntoDelPago("Cancha Norte", "2026-09-12", "20:00"),
    "Cancha Norte · 2026-09-12 20:00");
  const largo = asuntoDelPago("R".repeat(120), "2026-09-12", "20:00");
  assertEquals(largo.length, 80);
  assert(largo.endsWith("…"));
});

Deno.test("el token va escapado en la URL de pago", () => {
  assertEquals(urlDePago("https://x/pay", "a b+c"), "https://x/pay?token=a%20b%2Bc");
});

Deno.test("las URL de vuelta salen de SUPABASE_URL sin configurar nada más", () => {
  const base = { FLOW_API_KEY: "a", FLOW_SECRET_KEY: "b" };
  const env = (extra: Record<string, string>) => (k: string) => ({ ...base, ...extra })[k];

  assertEquals(
    leerConfig(env({ SUPABASE_URL: "https://abc.supabase.co" }))?.functionsBase,
    "https://abc.supabase.co/functions/v1",
  );
  // Con barra final, que es como se pega desde el panel.
  assertEquals(
    leerConfig(env({ SUPABASE_URL: "https://abc.supabase.co/" }))?.functionsBase,
    "https://abc.supabase.co/functions/v1",
  );
  // Un dominio propio delante gana.
  assertEquals(
    leerConfig(env({ SUPABASE_URL: "https://abc.supabase.co", FUNCTIONS_BASE_URL: "https://api.futfinder.cl/fn/" }))?.functionsBase,
    "https://api.futfinder.cl/fn",
  );
  assertEquals(leerConfig(env({}))?.functionsBase, "");
});
