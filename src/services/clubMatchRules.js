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
 * 2. HAY DOS UBICACIONES, Y NO SE PUEDEN CONFUNDIR. `matches` guarda una
 *    APROXIMADA —rejilla de 0,01°, ~1 km—; la EXACTA vive en
 *    `club_match_locations`. Desde la migración 44d **ninguna de las dos es
 *    pública**: el partido entero sólo lo ven los integrantes de los dos
 *    clubes hasta que termina. La aproximada es lo que hay en las listas,
 *    donde pedir la exacta sería una consulta por tarjeta, y por eso la
 *    tarjeta avisa de que lo es. En el detalle, a un integrante se le entrega
 *    la exacta.
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

/**
 * `true` sólo para el flujo formal que usa la nómina y las RPC de U3.
 *
 * Los partidos de clubes del flujo antiguo también tienen dos clubes, pero no
 * nacieron de una propuesta ni tienen reparto por club. Mandarlos a esta
 * nómina ofrecería RPC que el servidor rechaza y les quitaría su CTA anterior.
 */
export function usaNominaPorClub(match) {
  return !!(
    esPartidoDeClubes(match) &&
    match.challenge_proposal_id &&
    match.cupos_por_club != null
  );
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
 * EL NUMERADOR SOLO SE DIBUJA CUANDO SE SABE. `inscritosDeMiClub` llega desde
 * la nómina (U3, `cupos_ocupados_club()`); en las listas no se pide, porque
 * sería una consulta por tarjeta. Cuando falta, la etiqueta se queda en «9
 * cupos para tu club»: un «0 de 9» inventado sería falso en cuanto alguien se
 * inscriba, y esa mentira es peor que no decir el número.
 *
 * Cuando sí se sabe, el numerador es de MI club y no del partido: contar los
 * dieciocho juntos es exactamente el error que esta función existe para
 * evitar.
 */
export function cuposLabel(match, misClubIds, { inscritosDeMiClub = null } = {}) {
  const porClub = match?.cupos_por_club;

  if (esPartidoDeClubes(match) && porClub != null) {
    if (!soyDeAlgunClub(match, misClubIds)) return `${porClub} cupos por club`;
    return Number.isFinite(inscritosDeMiClub)
      ? `${inscritosDeMiClub} de ${porClub} inscritos de tu club`
      : `${porClub} cupos para tu club`;
  }

  // Partido normal, o partido de clubes anterior a la migración 44: la
  // etiqueta de siempre, sin tocar nada.
  const libres = match?.cupos_disponibles ?? 0;
  const totales = match?.cupos_totales ?? 0;
  return libres <= 0 ? 'Sin cupos' : `${libres} de ${totales} cupos`;
}

// ─────────────────────────────────────────────────────── Nómina por club

/** Los dos estados que ocupan cupo. Mismo criterio que `cupos_ocupados_club()`. */
const OCUPAN_CUPO = new Set(['inscrito', 'confirmado_gps']);

/**
 * Cómo va la nómina de un club: inscritos, postulaciones y cupos libres.
 *
 * `pendiente` NO cuenta como ocupado, igual que en la base: en selección por
 * administrador se postulan muchos y el administrador elige. Si postular
 * reservara, tres postulaciones llenarían un club de tres.
 */
export function resumenNomina(attendees, clubId, cuposPorClub) {
  const filas = (Array.isArray(attendees) ? attendees : []).filter(
    (a) => a && a.club_id === clubId
  );
  const inscritos = filas.filter((a) => OCUPAN_CUPO.has(a.estado)).length;
  const pendientes = filas.filter((a) => a.estado === 'pendiente').length;
  const cupos = Number.isFinite(cuposPorClub) ? cuposPorClub : 0;
  return { inscritos, pendientes, disponibles: Math.max(cupos - inscritos, 0), cupos };
}

/** Mi fila en la nómina, o `null` si no estoy. */
export function miFilaEnNomina(attendees, userId) {
  if (!userId) return null;
  return (Array.isArray(attendees) ? attendees : []).find((a) => a?.id_jugador === userId) || null;
}

/**
 * Qué puede hacer esta persona con la nómina, dicho en una sola palabra.
 *
 * La interfaz no protege nada —eso es de las RPC— pero ofrecer un botón que el
 * servidor va a rechazar es peor que no ofrecerlo. El orden de las salidas es
 * el de la vida real: primero si el partido sigue vivo, después si soy de
 * alguno de los dos clubes, y sólo al final qué me toca.
 *
 * ctx = { match, misClubIds, miFila, resumen, ahora }
 */
export function accionNomina({ match, misClubIds, miFila, resumen, ahora = new Date() } = {}) {
  if (!match) return { accion: 'ninguna', motivo: 'Este partido ya no existe' };
  if (match.estado === 'cancelado') return { accion: 'ninguna', motivo: 'El partido se canceló' };

  const hora = new Date(match.hora).getTime();
  if (Number.isFinite(hora) && hora <= (ahora instanceof Date ? ahora : new Date(ahora)).getTime()) {
    return { accion: 'ninguna', motivo: 'El partido ya comenzó' };
  }
  if (!soyDeAlgunClub(match, misClubIds)) {
    return { accion: 'ninguna', motivo: 'Solo se inscriben los integrantes de los dos clubes' };
  }

  if (miFila?.estado === 'pendiente') return { accion: 'cancelar_postulacion' };
  if (miFila && OCUPAN_CUPO.has(miFila.estado)) return { accion: 'salir' };

  if (resumen && resumen.disponibles <= 0 && match.metodo_inscripcion !== 'seleccion_admin') {
    return { accion: 'ninguna', motivo: 'Tu club ya llenó sus cupos' };
  }
  return {
    accion: match.metodo_inscripcion === 'seleccion_admin' ? 'postular' : 'inscribirse',
  };
}

/** El texto del botón para cada acción. Español de Chile, sin adornos. */
export const ACCION_LABEL = {
  inscribirse: 'Inscribirme',
  postular: 'Postular a la nómina',
  salir: 'Salir del partido',
  cancelar_postulacion: 'Retirar mi postulación',
};

/**
 * `true` si soy administrador de este club dentro de este partido.
 *
 * Se pide la lista de clubes donde SÍ administro, no un booleano suelto:
 * administrar el club rival no da ningún derecho sobre esta nómina, y esa
 * distinción es justo la que `confirmar_nomina_club()` hace en el servidor.
 */
export function puedoConfirmarNomina(clubId, misClubIdsAdmin) {
  const admin = Array.isArray(misClubIdsAdmin) ? misClubIdsAdmin.filter(Boolean) : [];
  return !!clubId && admin.includes(clubId);
}

/**
 * `true` si la ubicación de este partido está protegida en la base.
 *
 * El criterio es `challenge_proposal_id`, y es EXACTAMENTE el mismo que usa
 * la migración 44b: la ubicación de estos partidos no está en `matches` sino
 * en `club_match_locations`, con su propia RLS. Que la interfaz y la base
 * usen el mismo predicado es lo que evita que una diga una cosa y la otra
 * otra.
 *
 * No se usa `esPartidoDeClubes()` a propósito: los partidos de clubes del
 * flujo antiguo (migración 27) nunca pasaron por una propuesta protegida y su
 * dirección siempre fue pública, también en la base. Tratarlos aquí como
 * protegidos escondería en pantalla algo que la API entrega igual, que es
 * justo la incoherencia que esto viene a cerrar.
 */
export function esUbicacionProtegida(match) {
  return !!match?.challenge_proposal_id;
}

/**
 * `true` si las coordenadas que trae el partido son una aproximación.
 *
 * La marca la pone la base (`matches.ubicacion_aproximada`, migración 44b).
 * Describe EL DATO, no a quien mira: en una lista nadie tiene el punto exacto
 * —pedirlo sería una consulta por tarjeta—, así que ahí la distancia es
 * aproximada también para los integrantes, y la tarjeta tiene que decirlo. En
 * el detalle, en cambio, a un integrante sí se le entrega el punto exacto.
 */
export function esUbicacionAproximada(match) {
  return !!match?.ubicacion_aproximada;
}

/**
 * `true` si a esta persona se le puede mostrar la dirección de la calle.
 *
 * ESTO NO ES LA PROTECCIÓN. La protección es la RLS de
 * `club_match_locations`: a quien no le corresponde, la consulta le devuelve
 * cero filas y no hay nada que ocultar. Esta función decide si tiene sentido
 * pedirla y si se dibuja el botón de «Cómo llegar»; nada más.
 */
export function puedeVerDireccion(match, misClubIds) {
  if (!esUbicacionProtegida(match)) return true;
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
