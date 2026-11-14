// deno test supabase/functions/_shared/pagarReserva.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { estaEnPausa, MOTIVO_PAUSA, referenciaAnotada } from "./pagarReserva.ts";

Deno.test("anotar la referencia: sólo un ok:true explícito vale", () => {
  assertEquals(referenciaAnotada({ data: { ok: true }, error: null }), { ok: true, motivo: null });
});

Deno.test("anotar la referencia: ok:false con HTTP 200 es un fallo, con su motivo", () => {
  const r = referenciaAnotada({
    data: { ok: false, reason: "No hay un pago pendiente con esa orden" },
    error: null,
  });
  assertEquals(r.ok, false);
  assertEquals(r.motivo, "No hay un pago pendiente con esa orden");
});

Deno.test("anotar la referencia: el error de transporte sigue siendo un fallo", () => {
  const r = referenciaAnotada({ data: null, error: { code: "PGRST301", message: "x" } });
  assertEquals(r, { ok: false, motivo: "PGRST301" });
});

Deno.test("anotar la referencia: sin cuerpo o con un cuerpo raro no se da por buena", () => {
  for (const data of [null, undefined, {}, "ok", true, { ok: "true" }, { ok: 1 }]) {
    assertEquals(referenciaAnotada({ data, error: null }).ok, false, JSON.stringify(data));
  }
  assertEquals(referenciaAnotada(null).ok, false);
  assertEquals(referenciaAnotada(undefined).ok, false);
});

Deno.test("pausa: sólo true es pausa", () => {
  assert(estaEnPausa({ data: true, error: null }));
  for (const data of [false, null, undefined, "true", 1, { activo: true }]) {
    assertEquals(estaEnPausa({ data, error: null }), false, JSON.stringify(data));
  }
});

Deno.test("pausa: si no se pudo preguntar, no se inventa una pausa", () => {
  // La migración 179 sin aplicar contesta PGRST202 (la función no existe).
  assertEquals(estaEnPausa({ data: null, error: { code: "PGRST202" } }), false);
  assertEquals(estaEnPausa({ data: true, error: { code: "08006" } }), false);
  assertEquals(estaEnPausa(null), false);
});

Deno.test("pausa: el motivo dice que no se cobró y qué hacer", () => {
  assert(/no se te cobró/i.test(MOTIVO_PAUSA));
  assert(/más tarde/i.test(MOTIVO_PAUSA));
});
