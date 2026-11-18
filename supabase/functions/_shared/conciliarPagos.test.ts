// Pruebas de la conciliación de pagos pendientes. Se corren con `deno test`;
// la base y Flow son objetos en memoria.
// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import type { BaseDePagos } from "./flowPagos.ts";
import {
  conciliarLote,
  conciliarUno,
  corteDeEspera,
  type PagoPendiente,
  secretoValido,
} from "./conciliarPagos.ts";

const TOKEN = "T0KEN0000000000000000";

function baseFalsa(opciones: { confirmar?: any; errorRpc?: string } = {}) {
  const llamadas: { fn: string; args: Record<string, unknown> }[] = [];
  const base: BaseDePagos = {
    leerPago: () => Promise.resolve({ data: { id: "p1", monto: 15000, estado: "pendiente" }, error: null }),
    rpc: (fn, args) => {
      llamadas.push({ fn, args });
      if (opciones.errorRpc === fn) return Promise.resolve({ data: null, error: new Error("base") });
      if (fn === "confirmar_pago") {
        return Promise.resolve({ data: opciones.confirmar ?? { ok: true, resultado: "confirmada" }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    },
  };
  return { base, llamadas };
}

const flowDice = (estado: Record<string, unknown> | null) => () => Promise.resolve(estado);
const pago = (extra: Partial<PagoPendiente> = {}): PagoPendiente => ({
  orden_comercio: "FF-1",
  referencia_externa: TOKEN,
  ...extra,
});

Deno.test("Flow dice pagado: se registra el cobro por el mismo camino del aviso", async () => {
  const { base, llamadas } = baseFalsa();
  const d = await conciliarUno(base, flowDice({ commerceOrder: "FF-1", status: 2, amount: 15000 }), pago());
  assertEquals(d, "confirmado");
  assertEquals(llamadas.map((l) => l.fn), ["confirmar_pago"]);
  assertEquals(llamadas[0].args.p_referencia, TOKEN);
});

Deno.test("Flow dice pagado por otro monto: queda para devolver, no se confirma", async () => {
  const { base, llamadas } = baseFalsa();
  const d = await conciliarUno(base, flowDice({ commerceOrder: "FF-1", status: 2, amount: 9000 }), pago());
  assertEquals(d, "reversar");
  assertEquals(llamadas.map((l) => l.fn), ["pago_cobrado_sin_reserva"]);
});

Deno.test("Flow dice pagado y la base ya no tenía la hora: reversar", async () => {
  const { base } = baseFalsa({ confirmar: { ok: true, resultado: "reversar" } });
  assertEquals(
    await conciliarUno(base, flowDice({ commerceOrder: "FF-1", status: 2, amount: 15000 }), pago()),
    "reversar",
  );
});

Deno.test("rechazado → fallido; anulado → expirado", async () => {
  const a = baseFalsa();
  assertEquals(await conciliarUno(a.base, flowDice({ commerceOrder: "FF-1", status: 3 }), pago()), "cerrado");
  assertEquals(a.llamadas[0].args.p_estado, "fallido");
  const b = baseFalsa();
  assertEquals(await conciliarUno(b.base, flowDice({ commerceOrder: "FF-1", status: 4 }), pago()), "cerrado");
  assertEquals(b.llamadas[0].args.p_estado, "expirado");
});

Deno.test("Flow dice pendiente: NO se toca, aunque sea viejo (el enlace puede seguir pagable)", async () => {
  const { base, llamadas } = baseFalsa();
  assertEquals(await conciliarUno(base, flowDice({ commerceOrder: "FF-1", status: 1 }), pago()), "sigue_pendiente");
  assertEquals(llamadas, []);
});

Deno.test("un estado que Flow invente después tampoco se toca", async () => {
  const { base, llamadas } = baseFalsa();
  assertEquals(await conciliarUno(base, flowDice({ commerceOrder: "FF-1", status: 9 }), pago()), "sigue_pendiente");
  assertEquals(llamadas, []);
});

Deno.test("Flow no contesta o lanza: no se toca, se reintenta la próxima pasada", async () => {
  const a = baseFalsa();
  assertEquals(await conciliarUno(a.base, flowDice(null), pago()), "sin_respuesta");
  const b = baseFalsa();
  assertEquals(await conciliarUno(b.base, () => Promise.reject(new Error("red")), pago()), "sin_respuesta");
  assertEquals([...a.llamadas, ...b.llamadas], []);
});

Deno.test("sin token: nunca hubo enlace, se cierra como expirado sin preguntarle a Flow", async () => {
  const { base, llamadas } = baseFalsa();
  let preguntas = 0;
  const d = await conciliarUno(base, () => { preguntas++; return Promise.resolve(null); }, pago({ referencia_externa: null }));
  assertEquals(d, "cerrado");
  assertEquals(preguntas, 0);
  assertEquals(llamadas[0].fn, "rechazar_pago");
  assertEquals(llamadas[0].args.p_estado, "expirado");
});

Deno.test("Flow contesta por otra orden: no se toca ninguna", async () => {
  const { base, llamadas } = baseFalsa();
  assertEquals(await conciliarUno(base, flowDice({ commerceOrder: "FF-OTRA", status: 2, amount: 15000 }), pago()), "error");
  assertEquals(llamadas, []);
});

Deno.test("un token sin forma no se le manda a Flow", async () => {
  const { base } = baseFalsa();
  let preguntas = 0;
  const d = await conciliarUno(base, () => { preguntas++; return Promise.resolve(null); }, pago({ referencia_externa: "x y" }));
  assertEquals(d, "error");
  assertEquals(preguntas, 0);
});

Deno.test("la base falla al cerrar: error, no 'cerrado'", async () => {
  const { base } = baseFalsa({ errorRpc: "rechazar_pago" });
  assertEquals(await conciliarUno(base, flowDice({ commerceOrder: "FF-1", status: 3 }), pago()), "error");
});

Deno.test("el lote cuenta cada desenlace y un pago que revienta no frena a los demás", async () => {
  const { base } = baseFalsa();
  const respuestas: Record<string, any> = {
    A: { commerceOrder: "A", status: 2, amount: 15000 },
    B: { commerceOrder: "B", status: 1 },
    C: { commerceOrder: "C", status: 3 },
  };
  const preguntar = (t: string) => {
    if (t === TOKEN.replace("0", "D")) throw new Error("explota");
    return Promise.resolve(respuestas[t.slice(-1)] ?? null);
  };
  const lote = ["A", "B", "C"].map((o) => ({ orden_comercio: o, referencia_externa: TOKEN.slice(0, -1) + o }));
  lote.push({ orden_comercio: "D", referencia_externa: TOKEN.replace("0", "D") });
  lote.push({ orden_comercio: "E", referencia_externa: null });
  assertEquals(await conciliarLote(base, preguntar, lote), {
    revisados: 5,
    confirmados: 1,
    reversar: 0,
    cerrados: 2,
    siguen_pendientes: 1,
    sin_respuesta: 1,
    errores: 0,
  });
});

Deno.test("corte de espera: 20 minutos antes de ahora", () => {
  assertEquals(corteDeEspera(new Date("2026-11-18T12:20:00Z")), "2026-11-18T12:00:00.000Z");
});

Deno.test("secreto: igual pasa; distinto, vacío o corto no", () => {
  const s = "a".repeat(40);
  assertEquals(secretoValido(s, s), true);
  assertEquals(secretoValido("b".repeat(40), s), false);
  assertEquals(secretoValido(null, s), false);
  assertEquals(secretoValido("", ""), false);
  assertEquals(secretoValido("corto", "corto"), false);
  assertEquals(secretoValido(s, undefined), false);
});
