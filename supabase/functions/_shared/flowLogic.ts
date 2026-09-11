// supabase/functions/_shared/flowLogic.ts
//
// TODO LO QUE SABE DE FLOW, Y NADA MÁS.
//
// La base de datos (migración 78) no menciona a Flow en ninguna parte: sabe
// de `pagos`, de órdenes y de estados, pero no de proveedores. Este archivo
// es la traducción, y está solo para que el día que Flow se cambie por otro
// haya UN archivo que reescribir y no una búsqueda por todo el repo.
//
// Está separado del `index.ts` porque la firma es exactamente el tipo de
// cosa que falla en silencio: si el orden de los parámetros está mal, Flow
// devuelve «firma inválida» y no hay forma de saber cuál de los quince
// campos lo rompió. Acá se puede probar sin red y sin credenciales
// (`flowLogic.test.ts`).

/** Los cuatro estados que devuelve Flow en `payment/getStatus`. */
export const FLOW_PENDIENTE = 1;
export const FLOW_PAGADA = 2;
export const FLOW_RECHAZADA = 3;
export const FLOW_ANULADA = 4;

export interface FlowConfig {
  apiKey: string;
  secretKey: string;
  /** Sin barra final. */
  apiBase: string;
  ambiente: "sandbox" | "produccion";
  /** Base pública de las Edge Functions, para armar las URL de vuelta. */
  functionsBase: string;
}

export interface FlowStatus {
  commerceOrder: string;
  flowOrder?: number;
  status: number;
  amount: number;
  /** Lo que Flow devolvió tal cual, para guardarlo en `pagos.datos`. */
  crudo: Record<string, unknown>;
}

const API_SANDBOX = "https://sandbox.flow.cl/api";
const API_PRODUCCION = "https://www.flow.cl/api";

/**
 * Lee la configuración de los secrets del proyecto.
 *
 * DEVUELVE `null` EN VEZ DE REVENTAR cuando no hay credenciales. Mientras la
 * empresa no esté abierta no hay cuenta de Flow, y el resto del circuito
 * —crear la reserva, la pantalla de pago, el webhook— tiene que poder
 * existir igual. Sin credenciales la función contesta «todavía no está
 * conectada» y la app lo dice con esas palabras, que es la verdad; no se
 * inventa un pago falso ni se deja un botón que explota.
 */
export function leerConfig(
  env: (k: string) => string | undefined,
): FlowConfig | null {
  const apiKey = (env("FLOW_API_KEY") || "").trim();
  const secretKey = (env("FLOW_SECRET_KEY") || "").trim();
  if (!apiKey || !secretKey) return null;

  // Por omisión, sandbox. Pasar a producción tiene que ser un acto
  // explícito: nadie cobra plata de verdad por olvidarse de una variable.
  const ambiente = (env("FLOW_AMBIENTE") || "sandbox").trim().toLowerCase() === "produccion"
    ? "produccion"
    : "sandbox";

  return {
    apiKey,
    secretKey,
    apiBase: ambiente === "produccion" ? API_PRODUCCION : API_SANDBOX,
    ambiente,
    functionsBase: baseDeFunciones(env),
  };
}

/**
 * De dónde salen las URL que Flow va a llamar de vuelta.
 *
 * Se deduce de `SUPABASE_URL`, que Supabase inyecta solo en toda Edge
 * Function: así, conectar Flow no exige configurar una variable más que
 * alguien puede escribir mal. `FUNCTIONS_BASE_URL` queda como escape para
 * cuando haya un dominio propio delante.
 */
function baseDeFunciones(env: (k: string) => string | undefined): string {
  const explicita = (env("FUNCTIONS_BASE_URL") || "").trim();
  if (explicita) return explicita.replace(/\/+$/, "");
  const url = (env("SUPABASE_URL") || "").trim().replace(/\/+$/, "");
  return url ? `${url}/functions/v1` : "";
}

/**
 * La firma que exige Flow: los parámetros ORDENADOS ALFABÉTICAMENTE por
 * nombre, concatenados como nombre+valor sin separador, y un HMAC-SHA256
 * hexadecimal con la Secret Key.
 *
 * El orden alfabético es lo único que importa y es lo único que no se ve al
 * leer el código que arma el objeto: en JavaScript un objeto literal
 * conserva el orden en que se escribió, así que si esto no ordenara, la
 * firma dependería de cómo quedó redactado el `index.ts`. De ahí que la
 * prueba fije un caso con las claves escritas al revés.
 */
export async function firmar(
  params: Record<string, string | number>,
  secretKey: string,
): Promise<string> {
  const cadena = Object.keys(params)
    .sort()
    .map((k) => k + String(params[k]))
    .join("");

  const clave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = await crypto.subtle.sign(
    "HMAC",
    clave,
    new TextEncoder().encode(cadena),
  );
  return [...new Uint8Array(firma)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Los parámetros más `s`, listos para mandar como form o como query. */
export async function firmados(
  params: Record<string, string | number>,
  config: FlowConfig,
): Promise<URLSearchParams> {
  const conApiKey = { ...params, apiKey: config.apiKey };
  const s = await firmar(conApiKey, config.secretKey);
  const cuerpo = new URLSearchParams();
  for (const [k, v] of Object.entries(conApiKey)) cuerpo.append(k, String(v));
  cuerpo.append("s", s);
  return cuerpo;
}

/**
 * Qué hay que hacer con lo que contestó Flow.
 *
 * Se traduce a las tres acciones que entiende la base (migración 78) y no a
 * los nombres de Flow, para que `index.ts` no tenga que saber que 2 es
 * pagada. Un estado desconocido NO se trata como fallido: se deja esperar,
 * porque marcar fallido un pago que en realidad salió es peor que no hacer
 * nada.
 */
export function accionSegunEstado(
  status: number,
): "confirmar" | "rechazar" | "expirar" | "esperar" {
  if (status === FLOW_PAGADA) return "confirmar";
  if (status === FLOW_RECHAZADA) return "rechazar";
  if (status === FLOW_ANULADA) return "expirar";
  return "esperar";
}

/**
 * El monto que dice Flow tiene que ser el que anotamos nosotros.
 *
 * En la práctica no puede diferir —el monto va firmado en el `payment/create`
 * y Flow cobra ese— pero es la comprobación que separa «cobramos lo que
 * corresponde» de «cobramos lo que nos digan». Flow devuelve el monto como
 * número o como texto según el endpoint, así que se normaliza.
 */
export function montoCoincide(esperado: number, recibido: unknown): boolean {
  const n = typeof recibido === "number" ? recibido : Number(recibido);
  return Number.isFinite(n) && Math.round(n) === Math.round(esperado);
}

/**
 * El asunto que ve el jugador en el comprobante de su tarjeta.
 *
 * Se recorta a 80 porque Flow rechaza asuntos largos, y se hace acá para que
 * el corte esté probado y no aparezca como un 400 sin explicación.
 */
export function asuntoDelPago(recinto: string, fecha: string, hora: string): string {
  const base = `${recinto} · ${fecha} ${hora}`;
  return base.length <= 80 ? base : base.slice(0, 79) + "…";
}

/** Adónde mandamos al jugador. Flow devuelve `url` y `token` por separado. */
export function urlDePago(url: string, token: string): string {
  return `${url}?token=${encodeURIComponent(token)}`;
}
