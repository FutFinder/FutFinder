/**
 * La consulta de la bandeja de Avisos: filtros en el servidor y paginación
 * (C06 de la auditoría de chats y avisos del 2026-09-23).
 *
 * Vive acá, sin Supabase, para poder probarse.
 *
 * ── EL FALLO ──────────────────────────────────────────────────────────────
 *
 * La bandeja pedía los 50 avisos más recientes y DESPUÉS filtraba por
 * categoría y por club en el teléfono. Con 50 avisos de partidos encima, una
 * solicitud de club en el puesto 51 no aparecía en «Clubes» aunque existiera
 * y la campana la contara: la auditoría lo reprodujo así. Y no había forma
 * de ir más atrás de esos 50.
 *
 * ── EL ARREGLO ────────────────────────────────────────────────────────────
 *
 *   · La categoría y el club van en la consulta, ANTES del límite.
 *   · Se pagina hacia atrás con el par (created_at, id), el mismo cursor que
 *     el historial del chat (`cursorDeMensajes.js`): con sólo la fecha se
 *     pierden los avisos que empatan en el corte, y un disparador que avisa
 *     a todo un club los crea con el mismo `now()`.
 *
 * El club se reconoce igual que en `avisoDelClub` (clubsHomeSources.js):
 * `data.clubId`, `data.clubRetadorId` o `data.clubRetadoId`. Si cambia una,
 * tiene que cambiar la otra; hay una prueba que las compara.
 */

import { aplicarOrdenYCursorDeMensajes, cursorDeMensaje } from './cursorDeMensajes.js';

/** Cuántos avisos trae cada página. */
export const AVISOS_POR_PAGINA = 30;

/** Las claves de `data` que atan un aviso a un club. */
export const CLAVES_DE_CLUB = ['clubId', 'clubRetadorId', 'clubRetadoId'];

/**
 * Los tipos de aviso de una categoría según el mapa de la tarjeta
 * (`CATEGORY` de NotificationCard). `null` para «todos»: sin filtro.
 */
export function tiposDeCategoria(categoria, mapa = {}) {
  if (!categoria || categoria === 'todos') return null;
  return Object.keys(mapa)
    .filter((tipo) => mapa[tipo] === categoria)
    .sort();
}

/** Los ids de club van comillados: dentro de `or=(...)` la coma separa. */
export function filtroDeClub(clubId) {
  return CLAVES_DE_CLUB.map((k) => `data->>${k}.eq."${clubId}"`).join(',');
}

/**
 * Orden, filtros y cursor de una página de la bandeja, sobre la consulta de
 * Supabase. Todo antes del `.limit()`, que pone quien llama.
 */
export function aplicarFiltrosDeAvisos(q, { tipos = null, clubId = null, cursor = null } = {}) {
  let out = aplicarOrdenYCursorDeMensajes(q, cursor);
  if (Array.isArray(tipos)) out = out.in('type', tipos);
  if (clubId) out = out.or(filtroDeClub(clubId));
  return out;
}

/** El cursor de la bandeja cargada (más nuevo → más antiguo): el último. */
export function cursorDeAvisos(items = []) {
  for (let i = (items || []).length - 1; i >= 0; i -= 1) {
    const c = cursorDeMensaje(items[i]);
    if (c) return c;
  }
  return null;
}

/** Corta lo pedido (`limit + 1`) en la página y si queda más atrás. */
export function paginaDeAvisos(filas, limit) {
  const rows = filas || [];
  const hasMore = rows.length > limit;
  return { data: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

/** Suma una página más antigua a la bandeja, sin repetir avisos. */
export function sumarPaginaDeAvisos(previos = [], nuevos = []) {
  const vistos = new Set((previos || []).map((n) => n.id));
  return [...(previos || []), ...(nuevos || []).filter((n) => n && !vistos.has(n.id))];
}
