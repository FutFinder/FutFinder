// Pruebas de `registrarCobro`: un cobro que Flow confirmó nunca se pierde.
// Se corren con `deno test`; la base es un objeto en memoria.
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { type BaseDePagos, registrarCobro } from "./flowPagos.ts";

function baseFalsa(opciones: {
  pago?: { id: string; monto: number; estado: string } | null;
  errorLeer?: boolean;
  confirmar?: { data?: any; error?: unknown };
  devolver?: { error?: unknown };
}) {
  const llamadas: { fn: string; args: Record<string, unknown> }[] = [];
  const base: BaseDePagos = {
    leerPago: () =>
      Promise.resolve(
        opciones.errorLeer
          ? { data: null, error: new Error("red") }
          : { data: opciones.pago === undefined ? { id: "p1", monto: 15000, estado: "pendiente" } : opciones.pago, error: null },
      ),
    rpc: (fn, args) => {
      llamadas.push({ fn, args });
      if (fn === "confirmar_pago") {
        return Promise.resolve({ data: opciones.confirmar?.data ?? { ok: true, resultado: "confirmada" }, error: opciones.confirmar?.error ?? null });
      }
      return Promise.resolve({ data: { ok: true }, error: opciones.devolver?.error ?? null });
    },
  };
  return { base, llamadas };
}

const AVISO = { orden: "FF-1", token: "T0KEN0000000000000000", estado: { amount: 15000, status: 2 } };

Deno.test("cobro normal: se confirma y se le contesta 200 a Flow", async () => {
  const { base, llamadas } = baseFalsa({});
  assertEquals(await registrarCobro(base, AVISO), { http: 200, resultado: "confirmada" });
  assertEquals(llamadas.map((l) => l.fn), ["confirmar_pago"]);
});

Deno.test("monto distinto: no se confirma, queda para devolver con su motivo", async () => {
  const { base, llamadas } = baseFalsa({});
  const r = await registrarCobro(base, { ...AVISO, estado: { amount: 9000, status: 2 } });
  assertEquals(r, { http: 200, resultado: "reversar" });
  assertEquals(llamadas.map((l) => l.fn), ["pago_cobrado_sin_reserva"]);
  const motivo = String(llamadas[0].args.p_motivo);
  assertEquals(motivo.includes("9.000") && motivo.includes("15.000"), true, motivo);
});

Deno.test("enlace viejo pagado (el pago ya no estaba pendiente): queda para devolver", async () => {
  const { base, llamadas } = baseFalsa({ confirmar: { data: { ok: false, reason: "El pago está en estado expirado" } } });
  assertEquals(await registrarCobro(base, AVISO), { http: 200, resultado: "reversar" });
  assertEquals(llamadas.map((l) => l.fn), ["confirmar_pago", "pago_cobrado_sin_reserva"]);
});

Deno.test("si no se pudo anotar la devolución, Flow tiene que reintentar (500)", async () => {
  const { base } = baseFalsa({ confirmar: { data: { ok: false } }, devolver: { error: new Error("x") } });
  assertEquals((await registrarCobro(base, AVISO)).http, 500);
});

Deno.test("aviso repetido: no hace nada más y contesta 200", async () => {
  const { base, llamadas } = baseFalsa({ confirmar: { data: { ok: true, ya_estaba: true } } });
  assertEquals(await registrarCobro(base, AVISO), { http: 200, resultado: "ya_estaba" });
  assertEquals(llamadas.length, 1);
});

Deno.test("orden desconocida: 200 sin tocar nada; base caída: 500 para reintentar", async () => {
  const desconocida = baseFalsa({ pago: null });
  assertEquals(await registrarCobro(desconocida.base, AVISO), { http: 200, resultado: "desconocida" });
  assertEquals(desconocida.llamadas.length, 0);
  const caida = baseFalsa({ errorLeer: true });
  assertEquals((await registrarCobro(caida.base, AVISO)).http, 500);
  const confirmarFalla = baseFalsa({ confirmar: { error: new Error("db") } });
  assertEquals((await registrarCobro(confirmarFalla.base, AVISO)).http, 500);
});

Deno.test("pagó y no hay cancha (la base ya lo dejó para devolver): 200", async () => {
  const { base } = baseFalsa({ confirmar: { data: { ok: true, resultado: "reversar" } } });
  assertEquals(await registrarCobro(base, AVISO), { http: 200, resultado: "reversar" });
});
