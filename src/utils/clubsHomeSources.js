/**
 * Las reglas puras que alimentan la portada de Clubes.
 *
 * POR QUÉ ESTÁ SEPARADO DEL HOOK. `useClubsHome` es un hook y el repo no
 * tiene infraestructura de pruebas de render: las pruebas son de lógica
 * pura. Todo lo que decida algo vive acá y se prueba; en el hook queda atar
 * los servicios y llamar a estas funciones.
 *
 * Hermano de `clubsHomeTasks.js`, que hace lo mismo con la lista de tareas.
 * Los imports van con extensión `.js`: bajo `node --test` no hay Metro que
 * resuelva un import sin ella.
 */

/**
 * `true` si este aviso es del club indicado.
 *
 * Los avisos son del usuario, no del club: `notifications` no tiene
 * `club_id`. Lo que sí tiene es `data`, y ahí hay marcas fiables puestas por
 * el servidor:
 *
 *   - `clubId` lo adjuntan los avisos de membresía (migraciones 13, 14 y 16)
 *     y los de sanción (47 y 47c).
 *   - `clubRetadorId` y `clubRetadoId` los adjunta todo aviso de un desafío
 *     (26, 28, 42 y 43).
 *
 * Filtrar por esas tres claves no depende de adivinar el `type`. Lo que NO se
 * puede atribuir es un aviso que solo lleva `matchId` —asistencia,
 * cancelación de un partido normal—: esos quedan fuera a propósito, porque
 * una lista corta y cierta es mejor que una completa y adivinada.
 */
export function avisoDelClub(notificacion, clubId) {
  // Sin club activo no hay nada que atribuir. Sin esta guardia, un aviso sin
  // club daría `undefined === undefined` y entraría en la lista de todos.
  if (!clubId) return false;
  const d = notificacion?.data || {};
  return d.clubId === clubId || d.clubRetadorId === clubId || d.clubRetadoId === clubId;
}

/**
 * Qué club queda activo: el guardado si sigue siendo mío, si no el primero.
 *
 * `getMyClubs()` ordena por `joined_at`, así que «el primero» es el club más
 * antiguo, que es la elección menos sorprendente cuando no hay una guardada.
 * Devuelve `null` sin clubes, y esa es la señal de que la portada tiene que
 * dibujar el estado de invitado.
 */
export function elegirClubActivo(misClubes, guardado) {
  const lista = (Array.isArray(misClubes) ? misClubes : []).filter((m) => m?.club?.id);
  if (lista.length === 0) return null;
  const sigueSiendoMio = guardado && lista.some((m) => m.club.id === guardado);
  return sigueSiendoMio ? guardado : lista[0].club.id;
}

/**
 * `'member'`, `'pending'` o `'none'`.
 *
 * `'pending'` cubre los DOS caminos por los que se espera una respuesta: una
 * invitación que me mandaron y una solicitud que yo envié. Antes la solicitud
 * solo se detectaba si quedaba un id de club en `AsyncStorage` de una
 * membresía anterior, así que quien postulaba a su primer club veía «Aún sin
 * club» mientras esperaba.
 */
export function derivarMembresia({ clubes, invitaciones, solicitudes } = {}) {
  if ((clubes || []).length > 0) return 'member';
  if ((invitaciones || []).length > 0 || (solicitudes || []).length > 0) return 'pending';
  return 'none';
}

/**
 * `true` si este partido puede tener un cambio pendiente que consultar.
 *
 * La única condición es haber nacido de una propuesta:
 * `responder_cambio_partido()` rechaza con «Este no es un partido entre
 * clubes» cuando `challenge_proposal_id` es nulo, y no mira nada más
 * (migración 46, línea 395).
 *
 * NO se usa `usaNominaPorClub()`, que además exige `cupos_por_club != null`:
 * ese campo puede quedar nulo (`clubChallengeRules.js`, `propuestaOficialPayload`),
 * y con él un partido nacido de una propuesta no habría mostrado nunca su
 * cambio pendiente. Son dos conceptos distintos y no tienen por qué ir juntos.
 */
export function partidoAdmiteCambio(match) {
  return !!(match && match.challenge_proposal_id);
}
