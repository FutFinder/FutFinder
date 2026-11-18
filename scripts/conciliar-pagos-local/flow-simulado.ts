// Corre la Edge Function `conciliar-pagos` de verdad, con Deno, pero con un
// Flow de mentira: intercepta `fetch` a la API de Flow y contesta
// `payment/getStatus` según `FLOW_SIMULADO` (JSON token → respuesta, o
// "CAE" para simular que Flow no contesta). Todo lo demás —la base, la
// lógica— es lo real. Lo lanza `probar.mjs`; no se usa en producción.

const respuestas: Record<string, unknown> = JSON.parse(Deno.env.get("FLOW_SIMULADO") || "{}");
const puerto = Number(Deno.env.get("PUERTO_FUNCION") || "8790");
const fetchReal = globalThis.fetch;

globalThis.fetch = async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
  if (url.hostname.endsWith("flow.cl")) {
    const token = url.searchParams.get("token") || "";
    // La consulta tiene que ir firmada: sin `s` o sin apiKey, Flow la rechazaría.
    if (!url.searchParams.get("s") || !url.searchParams.get("apiKey")) {
      return new Response(JSON.stringify({ code: 108, message: "sin firma" }), { status: 401 });
    }
    const r = respuestas[token];
    if (r === "CAE") throw new TypeError("Flow no contesta (simulado)");
    if (!r) return new Response(JSON.stringify({ code: 105, message: "token desconocido" }), { status: 400 });
    return new Response(JSON.stringify(r), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return fetchReal(entrada as any, init);
};

const serveReal = Deno.serve.bind(Deno);
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (handler: any) => serveReal({ port: puerto, hostname: "127.0.0.1", onListen: () => console.log("LISTO") }, handler);

await import("../../supabase/functions/conciliar-pagos/index.ts");
