/**
 * Construcción pura de la query de búsqueda de jugadores usada por
 * searchPlayers() (src/services/profile.js). Vive acá, sin importar
 * nada de Supabase, para poder probar con un cliente falso que la
 * exclusión de perfiles ocultos viaja en la consulta real, no como un
 * filtro posterior en JS.
 */

export function buildSearchPlayersQuery(client, query, filters = {}, limit = 30) {
  let q = client
    .from('profiles')
    .select(
      'id, username, foto_url, comuna, region, edad, flanco, posicion_preferida, trust_score, rating_count, rating_nivel_avg'
    )
    // Respeta "Visible en búsquedas": un perfil oculto nunca debe llegar
    // a los resultados, así que se filtra en la propia consulta.
    .eq('privacy_visible_in_search', true)
    .limit(limit);

  const term = (query || '').trim();
  if (term.length > 0) {
    q = q.ilike('username', `%${term}%`);
  } else {
    q = q.order('trust_score', { ascending: false });
  }

  // Filtros de ubicación
  if (filters.region) q = q.eq('region', filters.region);
  if (filters.comuna) q = q.eq('comuna', filters.comuna);

  // Filtro de posición (posicion_preferida es un array → "contiene")
  if (filters.posicion) {
    q = q.contains('posicion_preferida', [filters.posicion]);
  }

  // Filtro de flanco: derecho/izquierdo incluye a los 'ambos'
  if (filters.flanco === 'derecho') {
    q = q.in('flanco', ['derecho', 'ambos']);
  } else if (filters.flanco === 'izquierdo') {
    q = q.in('flanco', ['izquierdo', 'ambos']);
  } else if (filters.flanco === 'ambos') {
    q = q.eq('flanco', 'ambos');
  }

  // Filtro de edad (rango)
  if (filters.edadMin != null) q = q.gte('edad', filters.edadMin);
  if (filters.edadMax != null) q = q.lte('edad', filters.edadMax);

  return q;
}
