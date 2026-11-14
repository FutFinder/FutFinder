/**
 * Qué hacer con la respuesta de `aceptar_terminos` (migración 181).
 *
 * Lógica pura, sin Supabase ni React Native, para probarla con `node:test`.
 *
 * LA FUNCIÓN PUEDE NO EXISTIR, Y ESO NO ES UN ERROR. No hay actualizaciones
 * por aire: un build sale con este código y la migración se aplica cuando
 * Vicente da el sí, antes o después. Mientras no esté, PostgREST contesta
 * «función no encontrada» y la app tiene que seguir como siempre: la
 * aceptación queda sólo en la pantalla, que es lo que había.
 *
 * Cualquier OTRO fallo sí es un error: si el servidor ya sabe guardar la
 * aceptación y no pudo, no se le dice a la persona que quedó aceptado.
 */

/** PostgREST: la función no está en el esquema (o su caché no la conoce). */
export function esFuncionInexistente(error) {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  return /could not find the function|function .* does not exist/i.test(String(error.message || ''));
}

/**
 * @returns {{ registrada: boolean, error: {message: string}|null }}
 *   `registrada: false` sin error = el servidor todavía no guarda esto.
 */
export function interpretarAceptacion({ data, error } = {}) {
  if (error) {
    if (esFuncionInexistente(error)) return { registrada: false, error: null };
    return { registrada: false, error: { message: MENSAJE_NO_GUARDADA } };
  }
  if (data?.ok === true) return { registrada: true, error: null };
  return { registrada: false, error: { message: MENSAJE_NO_GUARDADA } };
}

export const MENSAJE_NO_GUARDADA =
  'No pudimos guardar tu aceptación. Revisa tu conexión e inténtalo de nuevo.';

/** `'14 de noviembre de 2026'` → `'2026-11-14'`, o `null` si no se entiende. */
export function fechaLargaAVersion(texto) {
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const m = /^(\d{1,2}) de ([a-záéíóú]+) de (\d{4})$/i.exec(String(texto || '').trim());
  if (!m) return null;
  const mes = MESES.indexOf(m[2].toLowerCase());
  if (mes < 0) return null;
  return `${m[3]}-${String(mes + 1).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}
