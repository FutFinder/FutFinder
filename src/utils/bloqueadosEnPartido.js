/**
 * Jugadores que bloqueaste y que están en un partido (pedido de Vicente,
 * 2026-11-18): en la lista se marcan con «Bloqueado» y arriba se avisa que
 * están dentro, para que no te enteres en la cancha.
 *
 * Sólo se sabe a quién bloqueaste TÚ: quién te bloqueó a ti no se muestra
 * nunca (la RLS de `blocked_users` sólo deja leer las filas propias).
 *
 * Puro: recibe la lista del partido y el conjunto de ids bloqueados.
 */

/** Los jugadores con cuenta de `lista` que están en `bloqueados`. */
export function bloqueadosDentro(lista, bloqueados) {
  if (!bloqueados || bloqueados.size === 0 || !Array.isArray(lista)) return [];
  const vistos = new Set();
  const out = [];
  for (const j of lista) {
    const id = j?.user_id;
    if (!id || vistos.has(id) || !bloqueados.has(id)) continue;
    vistos.add(id);
    out.push(j);
  }
  return out;
}

/** El aviso de arriba de la lista, o `null` si no hay ninguno. */
export function avisoDeBloqueados(jugadores) {
  const n = jugadores?.length || 0;
  if (n === 0) return null;
  if (n === 1) {
    const u = jugadores[0]?.username;
    return `${u ? `@${u}` : 'Un jugador que bloqueaste'} está en este partido. Lo bloqueaste antes.`;
  }
  return `${n} jugadores que bloqueaste están en este partido.`;
}
