/**
 * Construcción pura de la consulta de clubes candidatos a rival.
 *
 * Vive acá, sin importar nada de Supabase, para poder probar con un
 * cliente falso que la exclusión de los clubes propios viaja DENTRO de la
 * consulta y no como un `filter()` posterior en JavaScript. La diferencia
 * importa: filtrar después trae las filas igual, deja los clubes propios
 * al alcance de cualquiera que mire la respuesta de red, y descuadra el
 * `limit` (pides 30, excluyes 2, muestras 28 y parece que no hay más).
 *
 * Esta es solo la primera de las tres capas que exige el enunciado. Las
 * otras dos son `listRivalCandidates()` en src/services/clubs.js y, sobre
 * todo, el trigger `club_challenges_valida_rival()` de la migración 41,
 * que es el único que de verdad impide desafiar a un club propio: un
 * cliente modificado puede saltarse esta consulta, pero no el trigger.
 */

/** Columnas mínimas para pintar una tarjeta de club rival. */
export const RIVAL_CLUB_COLUMNS =
  'id, nombre, slug, foto_url, region, comuna, plan, verificado';

/**
 * @param client        cliente de Supabase (o uno falso, en pruebas)
 * @param excludeIds    ids de clubes que nunca deben aparecer: el club que
 *                      reta y todos los clubes del usuario
 * @param query         término de búsqueda por nombre
 * @param limit         tope de filas
 * @param columns       columnas a traer
 */
export function buildRivalClubsQuery(
  client,
  { excludeIds = [], query = '', limit = 30, columns = RIVAL_CLUB_COLUMNS } = {}
) {
  let q = client.from('clubs').select(columns);

  // Sin ids que excluir no se agrega el filtro: `in.()` con lista vacía es
  // sintaxis inválida en PostgREST y tumbaría la consulta entera.
  const limpios = [...new Set((excludeIds || []).filter(Boolean))];
  if (limpios.length > 0) {
    q = q.not('id', 'in', `(${limpios.join(',')})`);
  }

  const term = (query || '').trim();
  if (term.length > 0) {
    q = q.ilike('nombre', `%${term}%`);
  }

  // Mismo orden que searchClubs(): los verificados primero.
  return q
    .order('verificado', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
}
