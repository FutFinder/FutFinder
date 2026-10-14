/**
 * El orden en que hay que aplicar las migraciones de `supabase/migrations/`.
 *
 * POR QUÉ ESTO EXISTE, Y POR QUÉ NO ES UNA LÍNEA. Los archivos se llaman
 * `<número><letra opcional>_<descripción>.sql`, y **ningún ordenamiento
 * estándar los pone bien**:
 *
 *   · Alfabético (lo que hace `ls`, `sort`, y lo que haría cualquier
 *     herramienta que lea el directorio) mete la **100 justo después de la
 *     09 y noventa posiciones antes de la 10**. Una base construida así
 *     aplica `100_si_se_cae_el_partido_se_suelta_la_cancha` sobre tablas
 *     que la `10_matches_columnas_faltantes` todavía no creó.
 *   · `sort -V` arregla eso pero rompe lo otro: pone **44b, 44c, 44d y 44e
 *     ANTES que la 44**, que es la que crea lo que las demás modifican.
 *
 * Las dos trampas son silenciosas en el sentido que importa: no fallan al
 * leer el directorio, fallan al aplicar, y para entonces la base ya está a
 * medias.
 *
 * EL ORDEN CORRECTO es: por número, y a igual número la que no tiene letra
 * primero (44, 44b, 44c, 44d, 44e, 45, 45b…).
 *
 * Se usa desde `scripts/construir-base.mjs` y lo fija
 * `scripts/__tests__/ordenMigraciones.test.js`.
 */

/** `44b_lo_que_sea.sql` → `{ numero: 44, letra: 'b' }`. */
export function partirNombre(nombre) {
  const m = /^(\d+)([a-z]*)_/.exec(String(nombre || ''));
  if (!m) return null;
  return { numero: Number(m[1]), letra: m[2] || '' };
}

/**
 * Compara dos nombres de migración. Devuelve <0, 0 o >0 como espera `sort`.
 *
 * Un nombre que no calza con el patrón se va al final en vez de romper el
 * orden del resto: construir la base y que falte un archivo raro es mejor
 * que no construirla.
 */
export function compararMigraciones(a, b) {
  const pa = partirNombre(a);
  const pb = partirNombre(b);
  if (!pa && !pb) return String(a).localeCompare(String(b));
  if (!pa) return 1;
  if (!pb) return -1;
  if (pa.numero !== pb.numero) return pa.numero - pb.numero;
  // A igual número, la que no tiene letra va primero: la 44 crea lo que la
  // 44b modifica.
  if (pa.letra === pb.letra) return 0;
  if (pa.letra === '') return -1;
  if (pb.letra === '') return 1;
  return pa.letra < pb.letra ? -1 : 1;
}

/** Los nombres, en el orden en que hay que aplicarlos. */
export function ordenarMigraciones(nombres) {
  return [...(nombres || [])].sort(compararMigraciones);
}
