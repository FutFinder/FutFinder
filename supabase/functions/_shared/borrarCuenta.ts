// Lógica pura de `eliminar-cuenta`: qué carpetas son de la persona y cómo se
// recorren y se borran. Sin red: el cliente de Storage se inyecta, así se
// prueba con `deno test` sin credenciales.

/**
 * Los buckets donde la primera carpeta es el uuid de la persona (medido en
 * producción el 2026-11-13). Los de clubes, recintos y portadas de partido
 * NO están: son de algo compartido que sigue existiendo sin ella.
 */
export const BUCKETS_PERSONALES = [
  "avatars",
  "profile-gallery",
  "solicitud-fotos",
  "support-screenshots",
] as const;

/** Lo mínimo de `supabase.storage.from(bucket)` que se usa acá. */
export interface Almacen {
  list(
    prefijo: string,
    opciones: { limit: number; offset: number },
  ): Promise<{ data: { name: string; id: string | null }[] | null; error: unknown }>;
  remove(rutas: string[]): Promise<{ error: unknown }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sólo un uuid es carpeta de alguien: nunca se borra `''` (el bucket entero). */
export function esCarpetaDePersona(userId: string): boolean {
  return typeof userId === "string" && UUID.test(userId);
}

const PAGINA = 100;
const PROFUNDIDAD_MAX = 4;

/**
 * Todas las rutas de archivo bajo `carpeta`, bajando por subcarpetas (en
 * Storage una carpeta es una entrada con `id` nulo).
 */
export async function listarArchivos(almacen: Almacen, carpeta: string, profundidad = 0): Promise<string[]> {
  const rutas: string[] = [];
  for (let offset = 0; ; offset += PAGINA) {
    const { data, error } = await almacen.list(carpeta, { limit: PAGINA, offset });
    if (error) throw error;
    const entradas = data ?? [];
    for (const e of entradas) {
      const ruta = `${carpeta}/${e.name}`;
      if (e.id === null) {
        if (profundidad < PROFUNDIDAD_MAX) rutas.push(...(await listarArchivos(almacen, ruta, profundidad + 1)));
      } else {
        rutas.push(ruta);
      }
    }
    if (entradas.length < PAGINA) break;
  }
  return rutas;
}

/** Borra en tandas de 100 (lo que acepta `remove` de una vez). */
export async function borrarRutas(almacen: Almacen, rutas: string[]): Promise<void> {
  for (let i = 0; i < rutas.length; i += PAGINA) {
    const { error } = await almacen.remove(rutas.slice(i, i + PAGINA));
    if (error) throw error;
  }
}

/**
 * Borra las carpetas de una persona en los buckets personales. Devuelve
 * cuántos archivos borró y si quedó TODO limpio (un bucket que falla no
 * frena a los demás, pero deja la cuenta en la cola para otra pasada).
 */
export async function limpiarCarpetas(
  almacenDe: (bucket: string) => Almacen,
  userId: string,
): Promise<{ borrados: number; completo: boolean }> {
  if (!esCarpetaDePersona(userId)) return { borrados: 0, completo: false };
  let borrados = 0;
  let completo = true;
  for (const bucket of BUCKETS_PERSONALES) {
    try {
      const almacen = almacenDe(bucket);
      const rutas = await listarArchivos(almacen, userId);
      await borrarRutas(almacen, rutas);
      borrados += rutas.length;
    } catch {
      completo = false;
    }
  }
  return { borrados, completo };
}

/**
 * Lo que la app muestra si la base no deja borrar. Los RAISE de
 * `delete_my_account` (P0001) son textos propios en español y se pasan tal
 * cual; cualquier otro error es interno y no se muestra.
 */
export const MENSAJE_INESPERADO = "No pudimos borrar tu cuenta. Intenta de nuevo en un rato.";

export function motivoParaMostrar(error: { code?: string; message?: string } | null): string {
  if (error?.code === "P0001" && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }
  return MENSAJE_INESPERADO;
}
