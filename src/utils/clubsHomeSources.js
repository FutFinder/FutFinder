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

/**
 * CUÁNTO DURA UN DESENLACE EN LA PORTADA.
 *
 * `clubsHomeTasks.js` clasifica tres situaciones —abierta, vencida y
 * resuelta— y `PendingTaskCard` sabe dibujar la vencida: opacidad .55, sin
 * botón y chip «Expiró». Nada la producía. El contexto sólo dejaba pasar lo
 * accionable (`estado === 'pendiente'` en los desafíos, `estado =
 * 'pendiente'` en la consulta del cambio), así que ese estado era
 * inalcanzable desde el flujo real y el «rato» que promete el encabezado de
 * `clubsHomeTasks.js` no existía.
 *
 * POR QUÉ HAY QUE ACOTARLO. `listChallengesForClub()` devuelve el historial
 * COMPLETO del club, sin límite y ordenado por fecha. Dejar pasar todo lo
 * cerrado pondría cada desenlace de la historia del club en la portada para
 * siempre. Siete días es lo que dura la explicación; después el hilo del
 * desafío sigue siendo el sitio donde mirar.
 */
export const DIAS_DESENLACE_VISIBLE = 7;

/**
 * `true` si `iso` cae dentro de los últimos `dias`.
 *
 * Una fecha FUTURA cuenta como dentro, y no es un descuido: un desafío que se
 * cierra con un «No» a la prórroga (migración 43, línea 733) se cierra en el
 * acto, con su `prorroga_vence_at` todavía por delante. Acaba de pasar.
 *
 * Una fecha ausente o ilegible devuelve `false`. Ante un desenlace que no se
 * puede fechar preferimos no mostrarlo: dejarlo entrar sería volver al
 * historial sin fin por la puerta de atrás.
 */
function dentroDeVentana(iso, ahora, dias) {
  const t = new Date(iso ?? NaN).getTime();
  if (!Number.isFinite(t)) return false;
  return ahora.getTime() - t <= dias * 86400000;
}

/**
 * Los desafíos recibidos que la portada tiene que enseñar: los que esperan
 * respuesta, y los que se cerraron sin acuerdo hace poco.
 *
 * QUÉ DESENLACE ENTRA, Y POR QUÉ SÓLO UNO. De los cuatro cierres malos de
 * `club_challenges`, `sin_acuerdo` es el único que cumple las tres cosas que
 * hacen falta:
 *
 *   - `sin_acuerdo` — no lo decidió nadie, lo decidió el reloj, y el servidor
 *     avisa a los DOS clubes (`desafio_avisar` con `club_challenge_closed`).
 *     Es noticia, y «Expiró» es exactamente lo que pasó.
 *   - `expirado` — nadie respondió, y ese nadie es mi club. La 43 avisa sólo
 *     al retador y lo argumenta: «el retado nunca respondió, y avisarle de
 *     algo que decidió ignorar es ruido». La portada no contradice eso.
 *   - `rechazado` — lo decide el retado, o sea yo (migración 26, línea 75).
 *     Contarme lo que acabo de decidir es el mismo ruido.
 *   - `cancelado` — la 47 sólo lo aplica desde `publicado` o `en_juego` y no
 *     escribe fecha de cierre, así que no hay con qué fecharlo; y el texto de
 *     la tarea, «Desafío recibido», no es lo que ocurrió: se canceló un
 *     encuentro ya publicado. Eso lo cuenta el hilo.
 *
 * CON QUÉ FECHA SE MIDE. `sin_acuerdo` se escribe cuando vence la prórroga
 * (43:395) o cuando un club responde que no se juega (43:733), y ninguno de
 * los dos toca `responded_at`. El plazo de la prórroga manda sobre el de la
 * negociación porque es el que corría al cerrarse; con el otro, un desafío
 * cerrado ayer contaría como cerrado hace tres días.
 *
 * LO QUE SIGUE VIVO Y NO ENTRA. `negociacion`, `esperando_aprobacion`,
 * `publicado`, `bloqueado_sancion`: son desafíos abiertos, pero esta tarea
 * dice «Desafío recibido / Responder» y ahí no hay nada que responder. Se
 * atienden en el hilo, no en la portada.
 */
export function desafiosRecibidosParaTareas(
  recibidos,
  { ahora = new Date(), dias = DIAS_DESENLACE_VISIBLE } = {}
) {
  return (Array.isArray(recibidos) ? recibidos : []).filter((d) => {
    if (d?.estado === 'pendiente') return true;
    if (d?.estado !== 'sin_acuerdo') return false;
    return dentroDeVentana(d.prorroga_vence_at || d.negociacion_vence_at, ahora, dias);
  });
}

/**
 * La solicitud de cambio que la portada tiene que enseñar del próximo
 * partido, o `null`. Una como máximo, igual que antes.
 *
 * LA PENDIENTE MANDA. Si hay una esperando respuesta, es la única que
 * importa; el índice único parcial de la 46 garantiza que no hay dos.
 *
 * SI NO, EL ÚLTIMO CADUCADO. `caducado` es el plazo de dos horas que se
 * cumplió sin que nadie respondiera: no lo decidió ningún club, y por eso es
 * noticia. `rechazado` sí lo decidió uno de los dos y ya tuvo su respuesta y
 * su evento en el hilo; `aceptado` salió bien y `normalizarTareas` ni lo
 * dibuja. Ninguno de los dos vuelve como aviso.
 *
 * Se compara `respondida_at` en vez de confiar en el orden de la consulta:
 * `getCambiosDelPartido` ordena de más nuevo a más viejo hoy, y una función
 * que se apoya en eso se rompe en silencio si mañana ordena distinto.
 */
export function cambioParaTareas(
  cambios,
  { ahora = new Date(), dias = DIAS_DESENLACE_VISIBLE } = {}
) {
  const lista = Array.isArray(cambios) ? cambios : [];
  const pendiente = lista.find((c) => c?.estado === 'pendiente');
  if (pendiente) return pendiente;

  let ultimo = null;
  for (const c of lista) {
    if (c?.estado !== 'caducado') continue;
    if (!dentroDeVentana(c.respondida_at, ahora, dias)) continue;
    if (!ultimo || new Date(c.respondida_at) > new Date(ultimo.respondida_at)) ultimo = c;
  }
  return ultimo;
}

/**
 * Las propuestas oficiales que la portada tiene que enseñar: la que espera
 * decisión, y la que MI club mandó y el rival rechazó hace poco.
 *
 * POR QUÉ ESTA ERA LA QUE FALTABA. De los tres dominios de la portada, la
 * propuesta era el único donde `'vencida'` no podía nacer ni cambiando el
 * cableado a medias: sólo se pedía la propuesta de los desafíos en
 * `esperando_aprobacion`, y de ese estado no sale ninguna vencida. Un rechazo
 * devuelve el desafío a `negociacion` (43d:130). Por eso el contexto ahora
 * también pide la propuesta de los desafíos en `negociacion`: es donde queda
 * el rechazo que hay que contar.
 *
 * `rechazada` ENTRA SÓLO SI LA PROPUSE YO. Responder una propuesta le toca al
 * club que NO la propuso (43:1078). Si el proponente es el rival, quien
 * rechazó fue mi propio club, y contarme lo que acabo de decidir es el mismo
 * ruido que un desafío `rechazado`. Sin `clubId` no se puede saber quién fue
 * quién, así que no entra ninguna.
 *
 * `caducada` NO ENTRA, Y ES LO CONTRARIO DE UN OLVIDO. Las tres únicas
 * escrituras de ese estado —44:329, 44b:438 y 45:855— son la misma sentencia
 * dentro del RPC de aprobación: «las demás propuestas del desafío que
 * siguieran abiertas quedan caducadas». No hay cron ni plazo que la produzca.
 * Una propuesta caducada implica que OTRA se aprobó y el partido se publicó,
 * así que pintarla «Expiró» diría que la negociación falló justo cuando
 * terminó bien — el error que `RESUELTOS` existe para impedir. El texto sí
 * está escrito en `clubsHomeTasks.js` por si una reparación manual en la base
 * deja una suelta.
 *
 * `aprobada` tampoco: salió bien, y `normalizarTareas` ni la dibuja.
 */
export function propuestasParaTareas(
  propuestas,
  { clubId = null, ahora = new Date(), dias = DIAS_DESENLACE_VISIBLE } = {}
) {
  return (Array.isArray(propuestas) ? propuestas : []).filter((p) => {
    if (!p) return false;
    if (p.estado === 'pendiente') return true;
    if (p.estado !== 'rechazada') return false;
    if (!clubId || p.club_proponente_id !== clubId) return false;
    return dentroDeVentana(p.respondida_at, ahora, dias);
  });
}

/**
 * Los rivales sugeridos, con su distancia y ordenados de más cerca a más
 * lejos.
 *
 * QUÉ ARREGLA. `listRivalCandidates()` no calcula distancia y devuelve la
 * lista ordenada por «verificados primero, luego los más nuevos». La portada
 * la exponía cruda, pero `ClubsScreen` sí lee `rival.distanciaKm` para
 * componer la meta de la tarjeta, así que todas decían «Distancia N.A.» y el
 * carrusel no tenía nada que ver con la cercanía. `ClubDetailScreen` sí hacía
 * las dos cosas: la pantalla que este rediseño puso como entrada del módulo
 * mostraba peor información que la que reemplazó.
 *
 * POR QUÉ EL CÁLCULO ENTRA POR PARÁMETRO. `distanciaEntreClubesKm()` vive en
 * `clubMeta.js`, que importa `haversineKm` de `services/matches`, que arrastra
 * `./supabase` y no carga bajo `node --test`. Inyectarlo deja la regla
 * probable sin mover el cálculo de sitio — el mismo patrón de
 * `rivalClubsQuery.js` y `nominaQuery.js` con el cliente de Supabase.
 *
 * EL ORDEN DE LOS QUE NO SE PUEDEN MEDIR. Van al final, y entre ellos se
 * conserva el orden en que vinieron, que ya prioriza a los verificados. El
 * comparador de `ClubDetailScreen` devuelve `1` cuando los dos son `null`,
 * que es un comparador inconsistente: acá empatan de verdad y `sort` los deja
 * como estaban, porque es estable desde ES2019.
 *
 * Un resultado que no sea un número finito se trata como «sin distancia». Un
 * `NaN` colado envenenaría el orden entero: nunca es mayor ni menor que nada,
 * así que el comparador dejaría de ser transitivo.
 */
export function rivalesPorCercania(rivales, { club = null, distancia = null } = {}) {
  const lista = Array.isArray(rivales) ? rivales : [];
  const medible = club && typeof distancia === 'function';

  const conDistancia = lista.map((rival) => {
    const km = medible ? distancia(club, rival) : null;
    return { ...rival, distanciaKm: Number.isFinite(km) ? km : null };
  });

  return conDistancia.sort((a, b) => {
    if (a.distanciaKm === b.distanciaKm) return 0;
    if (a.distanciaKm === null) return 1;
    if (b.distanciaKm === null) return -1;
    return a.distanciaKm - b.distanciaKm;
  });
}
