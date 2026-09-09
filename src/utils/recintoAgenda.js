/**
 * Lógica pura del lado del RECINTO (migraciones 60, 61 y 62).
 *
 * Sin React y sin Supabase. Acá viven las reglas que las RPC del recinto
 * dejaron deliberadamente al cliente, y las que ninguna pantalla debe volver a
 * derivar por su cuenta.
 *
 * TRES REGLAS QUE SE EQUIVOCAN SOLAS SI NO ESTÁN CENTRALIZADAS:
 *
 * 1. UNA RESERVA SIN CONFIRMAR NO OCUPA EL HORARIO. Es la regla central del
 *    vertical (migración 55): mientras está `armando`/`procesando`, el bloque
 *    sigue disponible para otros grupos y el primero que confirma se lo lleva.
 *    `admin_calendario_cancha` devuelve por eso `estado: 'libre'` con
 *    `grupos_en_curso > 0`, y no un estado "reservado a medias". El diseño lo
 *    contó al revés dos veces («la hora queda tomada»), así que la traducción
 *    a texto vive acá y no en cada pantalla.
 *
 * 2. SI YA SE JUGÓ SE CALCULA EN HORA LOCAL. La migración 61 no lo resuelve en
 *    Postgres a propósito: `now()` en la base es UTC y Chile está en un huso
 *    negativo, así que comparar allá corre el corte un día. Se compara acá con
 *    la hora local del dispositivo.
 *
 * 3. LA COMISIÓN NO SE RECALCULA NUNCA. Va congelada por reserva (migración
 *    62). Este archivo la lee, jamás la deriva de un porcentaje: el día que la
 *    tasa cambie, las reservas viejas tienen que seguir mostrando lo que de
 *    verdad se cobró.
 */

const ESTADOS_EN_CURSO = ['armando', 'procesando'];

/**
 * Normaliza la respuesta de una RPC del recinto a `{ data, error }`.
 *
 * OJO, la diferencia con `comoResultadoResultado`: las RPC `admin_*` levantan
 * `raise exception` en vez de devolver `{ ok: false, reason }` — decisión de la
 * migración 60, porque un fallo de permisos ahí significa que la interfaz
 * ofreció un botón que no correspondía. Así que el mensaje del servidor llega
 * por `error.message` y hay que pasarlo tal cual: ya viene redactado en
 * español y pensado para mostrarse.
 */
export function comoResultadoRecinto(data, error, etiqueta = 'recinto') {
  if (error) {
    console.error(`[FutFinder] ${etiqueta}:`, error);
    return { data: null, error: { message: error.message || 'No se pudo completar la acción.' } };
  }
  const row = Array.isArray(data) ? data[0] : data;
  // `get_disponibilidad_cancha` y `admin_calendario_cancha` sí usan el patrón
  // `{ ok: false, reason }` para los rechazos que no son de permisos.
  if (row && row.ok === false) {
    return { data: null, error: { message: row.reason || 'No se pudo completar la acción.' } };
  }
  return { data: row || null, error: null };
}

/**
 * Igual que la anterior pero para las RPC que devuelven una TABLA y no un
 * objeto — `admin_mis_complejos` es la única por ahora. Va aparte porque
 * `comoResultadoRecinto` toma `data[0]`, y aplicarla a una lista devolvería
 * silenciosamente solo el primer recinto: el error se vería como "solo
 * administro uno" en vez de como una falla.
 */
export function comoListaRecinto(data, error, etiqueta = 'recinto') {
  if (error) {
    console.error(`[FutFinder] ${etiqueta}:`, error);
    return { data: null, error: { message: error.message || 'No se pudo cargar la información.' } };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

/**
 * Convierte `fecha` ('YYYY-MM-DD') y una hora ('HH:MM') en un `Date` LOCAL.
 *
 * Se usa el constructor por componentes y no `new Date(cadena)` porque
 * `new Date('2027-03-01')` se interpreta como medianoche UTC —que en Chile es
 * el día anterior a las 21:00— y ese es exactamente el error que `reservasRules`
 * ya había tenido que esquivar con las fechas del selector.
 */
export function fechaHoraLocal(fecha, hora) {
  if (!fecha || !hora) return null;
  const [y, m, d] = String(fecha).split('-').map(Number);
  const [hh, mm] = String(hora).split(':').map(Number);
  if ([y, m, d, hh, mm].some((n) => !Number.isFinite(n))) return null;
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

/**
 * Momento en que TERMINA una reserva, en hora local.
 *
 * Si `hora_fin` no es posterior a `hora_inicio`, el bloque cruza la medianoche
 * y el término es del día siguiente. Pasa de verdad: un recinto abierto hasta
 * las 24:00 tiene un bloque cuyo fin Postgres devuelve como '00:00' (en
 * Postgres `time '23:00' + interval '1 hour'` da '00:00', no '24:00'). Sin este
 * ajuste, ese partido se consideraría terminado 23 horas antes de empezar.
 */
export function terminoLocal(reserva) {
  if (!reserva) return null;
  const inicio = fechaHoraLocal(reserva.fecha, reserva.hora_inicio);
  const fin = fechaHoraLocal(reserva.fecha, reserva.hora_fin);
  if (!fin) return null;
  if (inicio && fin <= inicio) {
    const siguiente = new Date(fin);
    siguiente.setDate(siguiente.getDate() + 1);
    return siguiente;
  }
  return fin;
}

/** ¿El partido de esta reserva ya terminó? Comparación en hora local. */
export function yaSeJugo(reserva, ahora = new Date()) {
  const fin = terminoLocal(reserva);
  if (!fin) return false;
  return ahora > fin;
}

/**
 * Estado operativo de una reserva para la agenda del recinto.
 *
 * `'jugada'` no es un estado de la base: es `confirmada` + partido terminado, y
 * se deriva acá con la hora local (ver la regla 2 del encabezado).
 */
export function estadoOperativo(reserva, ahora = new Date()) {
  if (!reserva) return null;
  if (reserva.estado === 'cancelada') return 'cancelada';
  if (reserva.estado === 'confirmada') return yaSeJugo(reserva, ahora) ? 'jugada' : 'confirmada';
  if (ESTADOS_EN_CURSO.includes(reserva.estado)) return 'en_curso';
  return reserva.estado;
}

/**
 * ¿Cuánto falta para que una reserva dividida quede pagada?
 *
 * Devuelve `null` cuando no aplica (pago único). El texto que acompaña esto en
 * la interfaz NO debe decir que la hora está tomada: sigue disponible hasta que
 * paguen todos (regla 1 del encabezado).
 */
export function avancePago(reserva) {
  if (!reserva) return null;
  const total = Number(reserva.participantes_total) || 0;
  if (total === 0) return null;
  const aceptados = Number(reserva.participantes_aceptados) || 0;
  return { aceptados, total, faltan: Math.max(0, total - aceptados), completo: aceptados >= total };
}

/**
 * Lee el desglose de la comisión de una reserva. NUNCA lo calcula.
 *
 * `admin_agenda_complejo` y `admin_reserva_detalle` ya devuelven los tres
 * números congelados. Una reserva cancelada no paga comisión, así que su neto
 * es el bruto completo: el recinto no se queda con esa plata (se le devolvió al
 * jugador), pero tampoco se le cobró nada, y mostrar un descuento ahí sería
 * mentira.
 */
export function desgloseComision(reserva) {
  if (!reserva) return null;
  const bruto = Number(reserva.comision_base ?? reserva.precio_total) || 0;
  const cancelada = reserva.estado === 'cancelada';
  const comision = cancelada ? 0 : Number(reserva.comision) || 0;
  return { bruto, comision, neto: bruto - comision, cobrada: !cancelada && comision > 0 };
}

/**
 * Intercala reservas y bloqueos en una sola lista cronológica.
 *
 * La RPC los devuelve en dos arreglos a propósito —son cosas distintas: una la
 * pidió un jugador, la otra la marcó el recinto— y la agenda los muestra
 * juntos. El `tipo` queda en cada elemento para que la pantalla sepa qué
 * pintar.
 */
export function intercalarAgenda(reservas = [], bloqueos = []) {
  const items = [
    ...(reservas || []).map((r) => ({ tipo: 'reserva', hora: r.hora_inicio, dato: r })),
    ...(bloqueos || []).map((b) => ({ tipo: 'bloqueo', hora: b.hora_inicio, dato: b })),
  ];
  return items.sort((a, b) => {
    if (a.hora === b.hora) return a.tipo === 'reserva' ? -1 : 1;
    return String(a.hora).localeCompare(String(b.hora));
  });
}

/**
 * Traduce un bloque del calendario del recinto.
 *
 * LA REGLA QUE NO SE PUEDE PERDER: un bloque con `grupos_en_curso > 0` sigue
 * siendo LIBRE. Hay gente juntando la plata, pero cualquiera puede tomar esa
 * hora hasta que alguien confirme. Por eso `disponible` es `true` ahí, y el
 * aviso que corresponde es "hay un grupo armando, sigue disponible" y nunca
 * "reservada" ni "tomada".
 */
export function estadoDeBloque(slot) {
  if (!slot) return null;
  const grupos = Number(slot.grupos_en_curso) || 0;
  const estado = slot.estado;
  return {
    estado,
    disponible: estado === 'libre',
    gruposEnCurso: grupos,
    hayGrupoArmando: estado === 'libre' && grupos > 0,
    bloqueo: slot.bloqueo || null,
    reserva: slot.reserva || null,
  };
}

/** Contadores del panel, tal como los devuelve el `resumen` de la agenda. */
export function resumenDelPanel(resumen) {
  if (!resumen) return null;
  return {
    reservasConfirmadas: Number(resumen.reservas_confirmadas) || 0,
    reservasEnCurso: Number(resumen.reservas_en_curso) || 0,
    reservasCanceladas: Number(resumen.reservas_canceladas) || 0,
    bloqueos: Number(resumen.bloqueos) || 0,
    canchasActivas: Number(resumen.canchas_activas) || 0,
    canchasTotal: Number(resumen.canchas_total) || 0,
    bruto: Number(resumen.monto_confirmado) || 0,
    comision: Number(resumen.comision_confirmada) || 0,
    neto: Number(resumen.neto_confirmado) || 0,
  };
}
