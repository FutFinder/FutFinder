/**
 * Paginación hacia atrás del historial de un hilo de chat (C03 de la
 * auditoría de chats y avisos del 2026-09-23).
 *
 * Vive acá, sin Supabase, para poder probarse: `messages.js` arrastra el
 * cliente y con él media aplicación.
 *
 * ── POR QUÉ UN CURSOR COMPUESTO (created_at, id) ──────────────────────────
 *
 * La página siguiente pedía `created_at < el del mensaje más antiguo ya
 * cargado`. Dos mensajes con EXACTAMENTE la misma fecha, uno al final de una
 * página y otro al principio de la siguiente, y el segundo no aparece nunca:
 * la desigualdad estricta lo deja fuera por empatar. Y empatan más de lo que
 * parece: el servidor pone `now()`, que es el mismo para toda una
 * transacción, y el esquema no exige fechas únicas. La auditoría lo midió con
 * 41 mensajes a la misma hora: la primera página trajo 40 y la segunda, 0.
 *
 * Es el mismo fallo, y el mismo arreglo, que el del buscador de partidos
 * (`paginacionPartidos.js`): ordenar y paginar por el mismo par. El `id` no
 * significa nada para el usuario, pero es único, que es todo lo que un
 * desempate necesita. «Antes que este» pasa a ser
 * `created_at < c OR (created_at = c AND id < i)`.
 *
 * DOS `or=` EN LA MISMA CONSULTA SE SUMAN CON AND: el hilo de un DM ya trae
 * su propio `.or(...)` (quién manda y quién recibe). PostgREST combina los
 * dos como condiciones separadas; se comprobó contra el stack local.
 *
 * Los valores van entre comillas dobles por la misma razón que en el
 * buscador: dentro de un `or=(...)` la coma y el paréntesis separan términos.
 */

/** El punto desde donde seguir hacia atrás, o `null`. */
export function cursorDeMensaje(m) {
  if (!m?.created_at || !m?.id) return null;
  if (typeof m.id === 'string' && m.id.startsWith('local-')) return null;
  return { created_at: m.created_at, id: m.id };
}

/**
 * El cursor de lo que ya está en pantalla (antiguo → nuevo): el primer
 * mensaje confirmado por el servidor. Los optimistas (`local-…`) no tienen
 * fecha del servidor y no sirven de referencia.
 */
export function cursorDeHistorial(mensajes = []) {
  for (const m of mensajes || []) {
    const c = cursorDeMensaje(m);
    if (c) return c;
  }
  return null;
}

/**
 * Ordena de nuevo → antiguo por `(created_at, id)` y, si hay cursor, deja
 * fuera lo ya entregado. Orden y cursor van juntos a propósito: cambiar uno
 * sin el otro vuelve a perder mensajes sin que nadie se entere.
 */
export function aplicarOrdenYCursorDeMensajes(q, cursor = null) {
  let out = q.order('created_at', { ascending: false }).order('id', { ascending: false });
  if (cursor?.created_at && cursor?.id) {
    out = out.or(
      `created_at.lt."${cursor.created_at}",` +
        `and(created_at.eq."${cursor.created_at}",id.lt."${cursor.id}")`
    );
  }
  return out;
}

/** El mismo criterio que el filtro de PostgREST, para comprobarlo en memoria. */
export function vieneAntesQue(m, cursor) {
  if (!cursor) return true;
  if (m.created_at < cursor.created_at) return true;
  return m.created_at === cursor.created_at && String(m.id) < String(cursor.id);
}

/** Comparador de nuevo → antiguo, el mismo orden que pide la consulta. */
export function deNuevoAAntiguo(a, b) {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  if (a.id === b.id) return 0;
  return String(a.id) < String(b.id) ? 1 : -1;
}
