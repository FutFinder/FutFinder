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

/**
 * Columnas mínimas para pintar una tarjeta de club rival.
 *
 * `tema` está acá porque la tarjeta se pinta con el color del RIVAL, no con
 * el del club que la mira: el carrusel «Buscar rivales» vive dentro de «Mi
 * club», y sin esta columna dos clubes con temas distintos se contaminarían
 * en la misma pantalla. Requiere la migración 53; `listRivalCandidates()`
 * reintenta sin ella si todavía no está aplicada.
 */
export const RIVAL_CLUB_COLUMNS =
  'id, nombre, slug, foto_url, region, comuna, verificado, tema';

/**
 * @param client        cliente de Supabase (o uno falso, en pruebas)
 * @param excludeIds    ids de clubes que nunca deben aparecer: el club que
 *                      reta y todos los clubes del usuario
 * @param query         término de búsqueda por nombre
 * @param region        región exacta (opcional)
 * @param comuna        comuna exacta (opcional)
 * @param limit         tope de filas
 * @param columns       columnas a traer
 */
export function buildRivalClubsQuery(
  client,
  { excludeIds = [], query = '', region = null, comuna = null, limit = 30, columns = RIVAL_CLUB_COLUMNS } = {}
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
  if (region) q = q.eq('region', region);
  if (comuna) q = q.eq('comuna', comuna);

  // Mismo orden que searchClubs(): los verificados primero.
  return q
    .order('verificado', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
}

/**
 * Qué estado vacío le toca al explorador de clubes.
 *
 * VIVE ACÁ Y NO EN EL JSX porque es una decisión, no un adorno, y porque
 * ya se equivocó una vez de una forma que nadie podía ver leyendo el
 * componente: `catalogoConClubes` —antes llamada `hasAnyClub`— significa
 * «la consulta sin filtros trajo algo», NO «la persona tiene club». En
 * modo rival esa consulta excluye los clubes propios a propósito, así que
 * cero resultados no dice nada sobre los clubes de quien mira, y la
 * pantalla le decía «Todavía no tienes clubes» —ofreciéndole crear uno— a
 * un integrante que venía de ver su club en la portada dos toques antes.
 *
 * Devuelve: 'cargando' | 'error' | 'sin-rivales' | 'sin-clubes' |
 * 'sin-resultados' | 'con-filas'.
 */
export function estadoDelExplorador({
  cargando = false,
  error = false,
  cantidad = 0,
  hayTexto = false,
  hayFiltros = false,
  modoRival = false,
  catalogoConClubes = true,
} = {}) {
  if (cargando) return 'cargando';
  if (error) return 'error';
  if (cantidad > 0) return 'con-filas';

  // Con texto o filtros puestos, «no hay» es siempre «no calza», nunca
  // «no existe»: el botón que corresponde es limpiar, no crear.
  if (hayTexto || hayFiltros) return 'sin-resultados';

  if (modoRival) return 'sin-rivales';
  return catalogoConClubes ? 'sin-resultados' : 'sin-clubes';
}
