/**
 * Traducción de lo que devuelve la base a lo que muestran las pantallas del
 * JUGADOR (buscar, complejo, elegir cancha, fecha y hora, resumen).
 *
 * Sin React y sin Supabase. Existe porque `src/services/reservas.js` dejó de
 * devolver datos de ejemplo y ahora traduce filas reales: esa traducción
 * tiene reglas —el tipo de cancha, cuánta gente entra, de dónde sale el
 * precio— y ninguna debería estar escrita dos veces.
 *
 * DOS COSAS QUE SE EQUIVOCAN SOLAS:
 *
 * 1. EL PRECIO DE UNA RESERVA SALE DEL BLOQUE, NO DE LA CANCHA. Con tarifas
 *    por franja (migración 64) la misma cancha vale distinto a las 13:00 que
 *    a las 21:00. `precio_hora` es solo el precio BASE, que sirve para el
 *    «desde» del listado y para las horas que ninguna tarifa cubre. Cobrar el
 *    base sería cobrar de más en las horas baratas.
 *
 * 2. EL JUGADOR NUNCA VE LA COMISIÓN. La paga el recinto (migración 62). El
 *    total que ve y paga es el precio de la cancha más los adicionales que
 *    haya elegido, y nada más. Acá no se suma ningún cargo.
 */

const TIPOS = {
  futbol_5: { nombre: 'Fútbol 5', jugadores: 10 },
  futbol_7: { nombre: 'Fútbol 7', jugadores: 14 },
  futbol_11: { nombre: 'Fútbol 11', jugadores: 22 },
};

/** 'futbol_7' → 'Fútbol 7'. Si llega algo desconocido se devuelve tal cual. */
export function nombreDeTipo(tipo) {
  return TIPOS[tipo]?.nombre || String(tipo || '').replace('_', ' ');
}

/**
 * Cuánta gente entra en una cancha de ese tipo, contando los dos equipos.
 *
 * Es una SUGERENCIA para el reparto del pago dividido, no un límite: el
 * servidor acepta de 2 a 30 y no mira el tipo de cancha. Si alguien quiere
 * jugar 5 contra 5 en una de fútbol 7, puede.
 */
export function jugadoresDeTipo(tipo) {
  return TIPOS[tipo]?.jugadores || 14;
}

/** La línea corta bajo el nombre de la cancha: «Fútbol 7 · bloques de 60 min». */
export function notaDeCancha(cancha) {
  if (!cancha) return null;
  const min = Number(cancha.duracion_slot_min);
  if (!Number.isFinite(min) || min <= 0) return nombreDeTipo(cancha.tipo);
  return `bloques de ${min} min`;
}

/**
 * Una fila de `buscar_complejos()` con los nombres que usan las pantallas.
 *
 * `desde` puede venir en null cuando el recinto está publicado pero sin
 * canchas activas — el servidor permite ese estado y la pantalla del recinto
 * empuja a salir de él, pero mientras tanto el jugador lo puede ver. Se deja
 * en null y la interfaz omite el precio en vez de mostrar «$0».
 */
export function comoComplejoDeLista(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    nombre: fila.nombre,
    descripcion: fila.descripcion,
    direccion: fila.direccion,
    sector: fila.comuna,
    region: fila.region,
    latitud: fila.latitud,
    longitud: fila.longitud,
    fotoUrl: fila.foto_url,
    verificado: !!fila.verificado_futfinder,
    rating: fila.rating_avg,
    reseñas: Number(fila.rating_count) || 0,
    tipos: (fila.tipos || []).map(nombreDeTipo),
    canchasActivas: Number(fila.canchas_activas) || 0,
    desde: fila.desde ?? null,
    proximaHoraLibre: fila.proxima_hora_libre || null,
    distanciaKm: fila.distancia_km ?? null,
  };
}

/**
 * Una cancha, con los nombres que usan las pantallas.
 *
 * `base` y `total` valen lo mismo y los dos son el precio BASE: el total de
 * verdad depende del bloque que se elija y se calcula recién ahí (regla 1 del
 * encabezado). Se conservan los dos nombres porque las pantallas del handoff
 * ya los usaban; el día que ninguna los use, se van.
 */
export function comoCancha(fila) {
  if (!fila) return null;
  const base = Number(fila.precio_hora) || 0;
  return {
    id: fila.id,
    nombre: fila.nombre,
    tipo: nombreDeTipo(fila.tipo),
    tipoCrudo: fila.tipo,
    nota: notaDeCancha(fila),
    duracionSlotMin: Number(fila.duracion_slot_min) || 60,
    jugadoresHabitual: jugadoresDeTipo(fila.tipo),
    fotoUrl: fila.foto_url || null,
    base,
    total: base,
  };
}

/**
 * El total que paga el grupo: el precio del BLOQUE elegido más los
 * adicionales tomados.
 *
 * Sin comisión: la paga el recinto y el jugador no la ve (regla 2). Si algún
 * día alguien intenta sumarle un cargo de servicio acá, que sea contra esta
 * línea y su prueba.
 */
export function totalDeReserva({ precioBloque, cobros = [] } = {}) {
  const cancha = Number(precioBloque) || 0;
  const extras = (cobros || []).reduce((suma, c) => suma + (Number(c?.precio) || 0), 0);
  return { cancha, extras, total: cancha + extras };
}

/**
 * ¿Se puede mandar esta reserva al servidor?
 *
 * Repite lo que el servidor exige para no ofrecer un botón que va a fallar:
 * bloque elegido, nombre y teléfono. El mensaje de rechazo, si igual se
 * envía, es siempre el del servidor.
 */
export function reservaLista({ canchaId, fecha, hora, contactoNombre, contactoTelefono } = {}) {
  return Boolean(
    canchaId && fecha && hora
    && String(contactoNombre || '').trim().length >= 2
    && String(contactoTelefono || '').trim().length > 0,
  );
}
