/**
 * Las reservas del jugador: cómo se agrupan, cómo se nombran y qué se puede
 * hacer con cada una.
 *
 * LO QUE SE PUEDE HACER NO SE DECIDE ACÁ, SE LEE. `puede_cancelar` viene del
 * servidor (`mis_reservas`, migración 86) y no se recalcula: la ventana de 12
 * horas es una regla de plata, ya se movió de lugar una vez por un error de
 * huso (migración 70), y tener dos copias es garantizar que un día digan
 * cosas distintas. Acá solo se traduce a un botón.
 */

/** Estados en los que la reserva todavía va a pasar. */
const VIVAS = ['armando', 'procesando', 'confirmada'];

/** Una fila de `mis_reservas` con los nombres que usa la pantalla. */
export function comoReserva(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    fecha: fila.fecha,
    horaInicio: String(fila.hora_inicio || '').slice(0, 5),
    horaFin: String(fila.hora_fin || '').slice(0, 5),
    inicio: fila.inicio,
    estado: fila.estado,
    modalidad: fila.modalidad,
    medioPago: fila.medio_pago,
    precioTotal: fila.precio_total,
    cuota: fila.cuota,
    soyOrganizador: !!fila.soy_organizador,
    canchaNombre: fila.cancha_nombre,
    canchaTipo: fila.cancha_tipo,
    complejoId: fila.complejo_id,
    complejoNombre: fila.complejo_nombre,
    direccion: fila.complejo_direccion,
    comuna: fila.complejo_comuna,
    fotoUrl: fila.complejo_foto_url,
    latitud: fila.complejo_latitud,
    longitud: fila.complejo_longitud,
    pagoEstado: fila.pago_estado || null,
    cobros: fila.cobros || [],
    puedeCancelar: !!fila.puede_cancelar,
    cancelacionHasta: fila.cancelacion_hasta || null,
    // El avance del grupo, para la tarjeta de una reserva dividida
    // (migración 90). `cupos` vale 1 en una reserva normal, así que la
    // tarjeta puede preguntar `cupos > 1` sin mirar la modalidad.
    nJugadores: fila.n_jugadores ?? null,
    cupos: fila.cupos ?? 1,
    listos: fila.listos ?? 0,
    miEstado: fila.mi_estado || null,
    // La cancha de un desafío no la cancela un club solo: se le pide al
    // otro (migración 55). `puedoResponder` lo calcula el servidor, porque
    // el cliente no puede leer los miembros del club ajeno.
    esDesafioClub: !!fila.es_desafio_club,
    cancelacionEstado: fila.cancelacion_estado || 'ninguna',
    puedoResponderCancelacion: !!fila.puedo_responder_cancelacion,
  };
}

/**
 * Próximas arriba, el resto abajo.
 *
 * «Próxima» es que TODAVÍA VA A PASAR: viva y con su hora por delante. Una
 * cancelada del sábado que viene no es una próxima —no hay que ir— y ponerla
 * ahí haría que alguien cuente con una cancha que no tiene.
 *
 * Las próximas van de la más cercana a la más lejana, y el historial al
 * revés: en una lista se busca «lo que viene ahora» y en la otra «lo último
 * que hice».
 */
export function separaReservas(lista = [], ahora = new Date()) {
  const t = ahora instanceof Date ? ahora.getTime() : new Date(ahora).getTime();
  const proximas = [];
  const historial = [];

  for (const r of lista) {
    if (!r) continue;
    const inicio = r.inicio ? new Date(r.inicio).getTime() : NaN;
    const viva = VIVAS.includes(r.estado);
    if (viva && Number.isFinite(inicio) && inicio > t) proximas.push(r);
    else historial.push(r);
  }

  proximas.sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
  historial.sort((a, b) => new Date(b.inicio) - new Date(a.inicio));
  return { proximas, historial };
}

const ETIQUETAS = {
  confirmada: { texto: 'Confirmada', tono: 'green' },
  procesando: { texto: 'Falta pagar', tono: 'amber' },
  armando: { texto: 'Armando el grupo', tono: 'amber' },
  cancelada: { texto: 'Cancelada', tono: 'neutral' },
  rechazada: { texto: 'No se pudo tomar', tono: 'red' },
  vencida: { texto: 'Vencida', tono: 'neutral' },
};

/**
 * La insignia de la tarjeta.
 *
 * `procesando` se muestra como «Falta pagar» y no con su nombre interno:
 * el jugador no sabe qué es «procesando», y lo que necesita saber es que la
 * hora NO es suya hasta que pague.
 */
export function etiquetaDeEstado(reserva) {
  // En una reserva dividida que se está armando, el número dice más que la
  // palabra: «1 de 3» se entiende de una, «Armando el grupo» no dice si falta
  // mucho o si ya está.
  if (reserva?.estado === 'armando' && reserva?.cupos > 1) {
    return { texto: `${reserva.listos || 0} de ${reserva.cupos}`, tono: 'amber' };
  }
  return ETIQUETAS[reserva?.estado] || { texto: reserva?.estado || '—', tono: 'neutral' };
}

/**
 * Qué ofrece la tarjeta. `null` cuando no hay nada que hacer.
 *
 * Solo quien organiza paga o cancela: a un invitado ofrecerle cancelar sería
 * ofrecerle cancelarle el partido a otro.
 */
export function accionesDeReserva(reserva) {
  if (!reserva) return [];
  const acciones = [];

  // Una reserva dividida es del grupo, no solo de quien la organizó: al
  // invitado también hay que dejarlo entrar, o no tiene por dónde poner su
  // parte. Es la única acción que no es exclusiva del organizador.
  //
  // INCLUYE LAS CONFIRMADAS. La primera versión las dejaba fuera —«ya no hay
  // nada que armar»— y era mirar el botón en vez de mirar para qué sirve:
  // después de confirmar es JUSTO cuando uno quiere ver quiénes van, y para
  // un invitado es la única forma de saber con quién juega.
  if (reserva.cupos > 1 && VIVAS.includes(reserva.estado)) {
    acciones.push({ clave: 'grupo', label: reserva.miEstado === 'aceptado' ? 'Ver el grupo' : 'Poner mi parte' });
  }

  if (!reserva.soyOrganizador) return acciones;

  if (reserva.estado === 'procesando' || reserva.estado === 'armando') {
    if (reserva.medioPago === 'tarjeta') acciones.push({ clave: 'pagar', label: 'Continuar al pago' });
  }
  if (reserva.puedeCancelar) acciones.push({ clave: 'cancelar', label: 'Cancelar reserva' });
  return acciones;
}

/**
 * La solicitud de cancelación de un desafío, si la hay y me toca a mí.
 *
 * ERA UN CALLEJÓN SIN SALIDA: `cancelar_reserva` le PIDE al otro club en vez
 * de cancelar, mandaba el aviso… y no existía ninguna pantalla para aceptar
 * o rechazar. Una reserva confirmada quedaba cobrada y sin forma de
 * cancelarse. La función del servidor estaba desde la migración 55 y nadie
 * la llamaba.
 *
 * Solo aparece para el club que NO la pidió: el que pidió ya dijo lo suyo.
 */
export function solicitudDeCancelacion(reserva) {
  if (!reserva || !reserva.puedoResponderCancelacion) return null;
  return {
    titulo: 'El otro club quiere cancelar',
    texto: reserva.estado === 'confirmada'
      ? 'Si aceptas, la cancha se libera y se les devuelve a los dos capitanes lo que pusieron.'
      : 'Si aceptas, la reserva se cancela. Todavía no se le cobró nada a nadie.',
    aceptar: 'Aceptar y cancelar',
    rechazar: 'No cancelar',
  };
}

/**
 * Qué decirle sobre la cancelación.
 *
 * Tres situaciones y tres textos distintos: todavía no paga, ya pagó y le
 * queda ventana, y ya pagó y se le cerró. El tercero es el que más importa
 * —es donde alguien reclama— así que dice la regla entera.
 */
export function textoDeCancelacion(reserva) {
  if (!reserva) return null;
  // En un desafío pedido y sin responder, lo que hay que contar es que se
  // está esperando al otro club — no la regla de las 12 horas.
  if (reserva.cancelacionEstado === 'solicitada') {
    return reserva.puedoResponderCancelacion
      ? null
      : 'Pediste cancelar: falta que el otro club responda.';
  }
  if (reserva.cancelacionEstado === 'rechazada') {
    return 'El otro club no quiso cancelar, así que la cancha sigue reservada.';
  }
  if (reserva.estado !== 'confirmada') {
    return reserva.puedeCancelar
      ? 'Todavía no pagas, así que puedes cancelarla cuando quieras. La hora tampoco es tuya hasta que pagues.'
      : null;
  }
  if (reserva.puedeCancelar) {
    return 'Puedes cancelar con devolución hasta 12 horas antes del partido.';
  }
  return 'Ya no se puede cancelar: quedan menos de 12 horas para el partido.';
}

/**
 * Qué número mostrar en la tarjeta.
 *
 * EN UNA DIVIDIDA, EL NÚMERO GRANDE ES LO QUE PAGA QUIEN MIRA, no el total.
 * La tarjeta decía «Total del partido $18.000» a alguien a quien le cobraron
 * $9.000: el único número que esa persona puede comprobar contra su saldo
 * aparecía mal. El total queda abajo, como contexto.
 *
 * `cuota` solo está en la base para la modalidad 'jugadores'; en 'capitanes'
 * es la mitad y se calcula igual que en el servidor.
 *
 * Devuelve números, no texto con signo peso: el formato es de la pantalla.
 */
export function lineaDePrecio(reserva) {
  if (!reserva) return null;
  const cupos = reserva.cupos || 1;
  if (cupos <= 1) {
    return {
      etiqueta: reserva.soyOrganizador ? 'Total' : 'Total del partido',
      monto: reserva.precioTotal,
      total: null,
      cupos,
    };
  }
  return {
    etiqueta: 'Tu parte',
    monto: reserva.cuota ?? Math.ceil(reserva.precioTotal / cupos),
    total: reserva.precioTotal,
    cupos,
  };
}

/** Para abrir el mapa del teléfono con el recinto. */
export function enlaceDeMapa(reserva) {
  if (!reserva) return null;
  const { latitud, longitud } = reserva;
  if (Number.isFinite(Number(latitud)) && Number.isFinite(Number(longitud))) {
    return `https://www.google.com/maps/search/?api=1&query=${latitud},${longitud}`;
  }
  const texto = [reserva.complejoNombre, reserva.direccion, reserva.comuna].filter(Boolean).join(', ');
  return texto ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(texto)}` : null;
}
