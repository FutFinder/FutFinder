/**
 * Reglas de presentación del partido de clubes.
 *
 * Puro: sin React, sin Supabase, sin colores. Decide QUÉ decir; las tarjetas
 * deciden cómo se ve.
 *
 * DOS COSAS QUE NO SE PUEDEN PERDER DE VISTA:
 *
 * 1. LOS CUPOS NO SON COMPARTIDOS. Un partido de 9 por club tiene
 *    `cupos_totales = 18`, pero esos 18 no están a disposición de cualquiera:
 *    son 9 y 9. Mostrar «18 de 18 cupos» —lo que hace la tarjeta de un partido
 *    normal— hace creer que el club rival puede quedarse con todos.
 *
 * 2. LA DIRECCIÓN EXACTA ES DE LOS DOS CLUBES. La RLS de
 *    `club_challenge_proposals` ya la reserva a sus integrantes; el partido
 *    publicado, en cambio, vive en `matches`, que es de lectura pública. Así
 *    que la reserva hay que sostenerla también acá, al pintar.
 *
 * Los partidos normales no pasan por ninguna de estas dos reglas y no cambian
 * en nada.
 */

/**
 * `true` si el partido enfrenta a dos clubes.
 *
 * Se piden los DOS ids, no `challenge_proposal_id`: los partidos del flujo
 * antiguo (migración 27) también enfrentan clubes y merecen la misma tarjeta.
 * Lo que no tienen es reparto por club, y de eso se ocupa `cuposLabel`.
 */
export function esPartidoDeClubes(match) {
  return !!(match && match.club_local_id && match.club_visitante_id);
}

/** `'local'`, `'visitante'` o `null` si no soy de ninguno de los dos. */
export function miLadoEnPartido(match, misClubIds) {
  if (!esPartidoDeClubes(match)) return null;
  const mios = Array.isArray(misClubIds) ? misClubIds.filter(Boolean) : [];
  if (mios.includes(match.club_local_id)) return 'local';
  if (mios.includes(match.club_visitante_id)) return 'visitante';
  return null;
}

/** `true` si pertenezco a alguno de los dos clubes del partido. */
export function soyDeAlgunClub(match, misClubIds) {
  return miLadoEnPartido(match, misClubIds) !== null;
}

/**
 * Qué decir sobre los cupos.
 *
 * En un partido de clubes con reparto, el número que importa es el del club:
 * los otros nueve no son tuyos.
 *
 * TODO(U3): cuando `attendees.club_id` esté poblado y exista el conteo real
 * por club, esto pasa a «3 de 9 inscritos de tu club». Hasta entonces NO se
 * muestra un numerador: no hay dato que ponerle y un «0 de 9» sería falso en
 * cuanto alguien se inscriba.
 */
export function cuposLabel(match, misClubIds) {
  const porClub = match?.cupos_por_club;

  if (esPartidoDeClubes(match) && porClub != null) {
    return soyDeAlgunClub(match, misClubIds)
      ? `${porClub} cupos para tu club`
      : `${porClub} cupos por club`;
  }

  // Partido normal, o partido de clubes anterior a la migración 44: la
  // etiqueta de siempre, sin tocar nada.
  const libres = match?.cupos_disponibles ?? 0;
  const totales = match?.cupos_totales ?? 0;
  return libres <= 0 ? 'Sin cupos' : `${libres} de ${totales} cupos`;
}

/**
 * `true` si a esta persona se le puede mostrar la dirección de la calle.
 *
 * En un partido de clubes, sólo a los integrantes de los dos clubes. En
 * cualquier otro partido, a todo el mundo, como siempre.
 */
export function puedeVerDireccion(match, misClubIds) {
  if (!esPartidoDeClubes(match)) return true;
  return soyDeAlgunClub(match, misClubIds);
}

/**
 * Dónde se juega, según quién pregunta.
 *
 * La cancha y la comuna son públicas —hacen falta para saber si el partido te
 * queda cerca—; la calle y el número, no.
 */
export function lugarLabel(match, misClubIds) {
  const partes = [match?.cancha_nombre];
  if (puedeVerDireccion(match, misClubIds) && match?.direccion) partes.push(match.direccion);
  partes.push(match?.comuna);
  return partes.filter(Boolean).join(' · ');
}

/**
 * Iniciales para dibujar cuando un club no tiene escudo.
 *
 * Una letra por palabra y hasta dos, saltando las partículas: «Club Deportivo
 * de los Andes» da «CD», no «CDLA». Un nombre de una sola palabra da sus dos
 * primeras letras.
 */
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'da', 'do']);

export function iniciales(nombre) {
  const limpio = String(nombre || '').trim();
  if (!limpio) return 'FF';

  const palabras = limpio
    .split(/\s+/)
    .filter((p) => p && !PARTICULAS.has(p.toLowerCase()));

  if (palabras.length === 0) return 'FF';
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();
  return (palabras[0][0] + palabras[1][0]).toUpperCase();
}

/**
 * Los dos clubes listos para pintar.
 *
 * Nunca devuelve nombre vacío ni revienta si la consulta no trajo el club:
 * una tarjeta a medio dibujar es peor que una con un nombre genérico.
 */
export function clubesDelPartido(match) {
  const arma = (club, porDefecto) => {
    const nombre = String(club?.nombre || '').trim() || porDefecto;
    return {
      id: club?.id || null,
      nombre,
      fotoUrl: club?.foto_url || null,
      iniciales: iniciales(nombre),
    };
  };

  return {
    local: arma(match?.club_local, 'Club local'),
    visitante: arma(match?.club_visitante, 'Club visitante'),
  };
}

/**
 * El próximo partido de clubes de alguno de mis clubes, o `null`.
 *
 * Devolver `null` es un resultado normal —no todos los días hay partido de
 * club— y la pantalla tiene que saber no dibujar la sección.
 */
export function proximoPartidoDeClub(matches, misClubIds, { ahora = new Date() } = {}) {
  const mios = Array.isArray(misClubIds) ? misClubIds.filter(Boolean) : [];
  if (mios.length === 0) return null;

  const desde = (ahora instanceof Date ? ahora : new Date(ahora)).getTime();

  const candidatos = (Array.isArray(matches) ? matches : [])
    .filter(Boolean)
    .filter((m) => esPartidoDeClubes(m) && soyDeAlgunClub(m, mios))
    .filter((m) => m.estado !== 'cancelado' && m.estado !== 'finalizado')
    .filter((m) => {
      const t = new Date(m.hora).getTime();
      return Number.isFinite(t) && t > desde;
    })
    .sort((a, b) => new Date(a.hora) - new Date(b.hora));

  return candidatos[0] || null;
}

/**
 * Reparte los partidos de Inicio entre la sección destacada y el resto.
 *
 * Es UNA función y no dos porque el destacado y la lista tienen que decidirse
 * a la vez: el partido que sube a «Próximo partido de tu club» es exactamente
 * el que hay que quitar de «Partidos cerca de ti», o aparecería dos veces en
 * la misma pantalla.
 *
 * `cercanos` es la lista ya filtrada por distancia, y `todos` la lista sin
 * filtrar. La distinción importa: el partido de mi club puede jugarse lejos y
 * aun así tengo que verlo — es de mi club, no un partido cualquiera al que
 * podría llegar caminando.
 */
export function seleccionInicio(todos, cercanos, misClubIds, { ahora = new Date() } = {}) {
  const destacado = proximoPartidoDeClub(todos, misClubIds, { ahora });
  const resto = (Array.isArray(cercanos) ? cercanos : []).filter(
    (m) => m && (!destacado || m.id !== destacado.id)
  );
  return { destacado, resto };
}
