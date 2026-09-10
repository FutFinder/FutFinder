/**
 * Lógica pura de las PANTALLAS del recinto (artboards 1b–1r y 3a–3l del
 * handoff `FutFinder Recinto.dc.html`).
 *
 * Complementa `recintoAgenda.js`, que traduce lo que devuelven las RPC. Acá
 * vive lo que las pantallas necesitan calcular por su cuenta: fechas, rótulos,
 * y las validaciones que el servidor ya hace pero que la interfaz tiene que
 * poder anticipar para no ofrecer un botón que va a fallar.
 *
 * CUATRO COSAS QUE SE EQUIVOCAN SOLAS SI NO ESTÁN ACÁ:
 *
 * 1. LAS FECHAS SE ARMAN COMPONENTE A COMPONENTE, NUNCA CON `toISOString()`.
 *    Chile está en un huso negativo, así que `new Date().toISOString()` a las
 *    21:30 devuelve el día siguiente. Es el mismo error que `reservasRules`
 *    ya tuvo que esquivar en el selector de fechas y que la migración 70
 *    acaba de arreglar del lado de Postgres.
 *
 * 2. LOS NOMBRES DE DÍAS Y MESES VAN ESCRITOS, no por `toLocaleDateString`.
 *    Hermes no trae `Intl` completo en todas las plataformas donde corre la
 *    app, y un rótulo de fecha que sale en inglés en Android es un error que
 *    solo se ve en el dispositivo.
 *
 * 3. LAS VALIDACIONES DE ACÁ NO REEMPLAZAN AL SERVIDOR, LO ANTICIPAN. El
 *    motivo de diez caracteres y el choque con una reserva confirmada se
 *    comprueban igual en la base. Se repiten acá para poder desactivar un
 *    botón antes de enviarlo, pero **el mensaje que se le muestra a la
 *    persona es siempre el que llega del servidor**: si algún día divergen,
 *    manda el servidor.
 *
 * 4. UNA RESERVA SIN CONFIRMAR NO OCUPA EL HORARIO. Vale también acá: al
 *    contar cuántos bloques chocan con algo, solo `'reservada'` cuenta.
 *    `'libre'` con grupos armando sigue siendo libre (ver la regla 1 de
 *    `recintoAgenda.js`).
 */

import { horaAMinutos, minutosAHora } from './recintoAgenda.js';

const DIAS_LARGOS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/* ── Fechas ─────────────────────────────────────────────────────────────── */

/** `Date` → 'YYYY-MM-DD' en hora LOCAL (ver la regla 1 del encabezado). */
export function fechaISO(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 'YYYY-MM-DD' → `Date` local a medianoche. Null si no se puede leer. */
export function desdeISO(fecha) {
  if (!fecha) return null;
  const [y, m, d] = String(fecha).split('-').map(Number);
  if (![y, m, d].every(Number.isFinite)) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Hoy en hora local del dispositivo. */
export function hoyISO(ahora = new Date()) {
  return fechaISO(ahora);
}

/** Suma (o resta) días a una fecha ISO, sin salirse del calendario local. */
export function sumarDias(fecha, n) {
  const base = desdeISO(fecha);
  if (!base) return null;
  base.setDate(base.getDate() + Number(n || 0));
  return fechaISO(base);
}

/**
 * Los siete días de la semana que contiene esta fecha, de lunes a domingo.
 *
 * Lunes primero y no domingo: es como se lee una semana en Chile, y es lo que
 * muestra la tira del calendario (artboard 1p, «Semana del 7 al 13»).
 */
export function semanaDe(fecha) {
  const base = desdeISO(fecha);
  if (!base) return [];
  // getDay(): 0 = domingo. Se corre al lunes anterior; el domingo retrocede 6.
  const dow = base.getDay();
  const alLunes = dow === 0 ? -6 : 1 - dow;
  const lunes = sumarDias(fecha, alLunes);
  return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
}

/** 'lun', 'mar', … para la tira de días. */
export function diaCorto(fecha) {
  const d = desdeISO(fecha);
  return d ? DIAS_CORTOS[d.getDay()] : null;
}

/** El número del día del mes, para la tira: 7. */
export function numeroDeDia(fecha) {
  const d = desdeISO(fecha);
  return d ? d.getDate() : null;
}

/** 'Lunes 7 de septiembre'. Sin año: la agenda siempre mira días cercanos. */
export function fechaLarga(fecha) {
  const d = desdeISO(fecha);
  if (!d) return null;
  return `${DIAS_LARGOS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

/**
 * 'Hoy', 'Mañana', o la fecha larga.
 *
 * Ayer no tiene rótulo propio a propósito: la agenda de un día pasado se lee
 * mejor con su fecha, y «Ayer» invita a confundirlo con la de hoy.
 */
export function fechaRelativa(fecha, ahora = new Date()) {
  const hoy = hoyISO(ahora);
  if (fecha === hoy) return 'Hoy';
  if (fecha === sumarDias(hoy, 1)) return 'Mañana';
  return fechaLarga(fecha);
}

/** 'Semana del 7 al 13 de septiembre' — o con los dos meses si la semana los cruza. */
export function rotuloDeSemana(fecha) {
  const dias = semanaDe(fecha);
  if (dias.length !== 7) return null;
  const a = desdeISO(dias[0]);
  const b = desdeISO(dias[6]);
  if (a.getMonth() === b.getMonth()) {
    return `Semana del ${a.getDate()} al ${b.getDate()} de ${MESES[a.getMonth()]}`;
  }
  return `Semana del ${a.getDate()} de ${MESES[a.getMonth()]} al ${b.getDate()} de ${MESES[b.getMonth()]}`;
}

/* ── Duraciones ─────────────────────────────────────────────────────────── */

/**
 * Minutos entre dos horas 'HH:MM'.
 *
 * Si el término no es posterior al inicio, el bloque cruza la medianoche —
 * pasa de verdad en una cancha abierta hasta las 24:00, donde Postgres
 * devuelve el fin como '00:00'. Mismo ajuste que `terminoLocal()`.
 */
export function duracionEnMinutos(horaInicio, horaFin) {
  const a = horaAMinutos(horaInicio);
  const b = horaAMinutos(horaFin);
  if (a === null || b === null) return null;
  return b > a ? b - a : b + 24 * 60 - a;
}

/** 60 → '1 hora'; 90 → '1 h 30 min'; 120 → '2 horas'; 45 → '45 min'. */
export function etiquetaDuracion(minutos) {
  const m = Number(minutos);
  if (!Number.isFinite(m) || m <= 0) return null;
  const horas = Math.floor(m / 60);
  const resto = m % 60;
  if (horas === 0) return `${resto} min`;
  if (resto === 0) return horas === 1 ? '1 hora' : `${horas} horas`;
  return `${horas} h ${resto} min`;
}

/* ── Rótulos de la agenda ───────────────────────────────────────────────── */

/**
 * Una línea con lo que tiene el día: «3 reservas y 1 hora ocupada por fuera».
 *
 * Las horas ocupadas por fuera se cuentan aparte de las cerradas: son cosas
 * distintas para quien abre el recinto en la mañana (migración 69). Las
 * canceladas no se nombran — están en la lista, pero no son lo que define el
 * día.
 */
export function resumenDeAgenda(agenda) {
  const reservas = (agenda?.reservas || []).filter((r) => r.estado !== 'cancelada').length;
  const bloqueos = agenda?.bloqueos || [];
  const externos = bloqueos.filter((b) => b.tipo === 'externo').length;
  const cerrados = bloqueos.length - externos;

  const partes = [];
  if (reservas > 0) partes.push(reservas === 1 ? '1 reserva' : `${reservas} reservas`);
  if (externos > 0) partes.push(externos === 1 ? '1 hora por fuera' : `${externos} horas por fuera`);
  if (cerrados > 0) partes.push(cerrados === 1 ? '1 hora cerrada' : `${cerrados} horas cerradas`);

  if (partes.length === 0) return 'Sin reservas ni horas ocupadas';
  if (partes.length === 1) return partes[0];
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

/**
 * Cómo se rotula una reserva en la agenda, con su tono.
 *
 * `'en_curso'` NO dice que la hora esté tomada: sigue disponible hasta que
 * alguien confirme, y decirlo al revés fue el error que el diseño cometió dos
 * veces (ver la regla 1 de `recintoAgenda.js`). Por eso el texto es «Sin
 * confirmar» y no «Reservada».
 */
export function etiquetaDeReserva(estadoOperativo) {
  switch (estadoOperativo) {
    case 'confirmada': return { texto: 'Pagada', tono: 'green' };
    case 'en_curso':   return { texto: 'Sin confirmar', tono: 'amber' };
    case 'jugada':     return { texto: 'Jugada', tono: 'neutral' };
    case 'cancelada':  return { texto: 'Cancelada', tono: 'red' };
    default:           return { texto: 'Sin confirmar', tono: 'amber' };
  }
}

/**
 * «hace 20 min», «hace 4 h», «hace 2 días». Para decir cuánto pasó desde que
 * terminó un partido, en la agenda de un día que ya se jugó.
 *
 * Sin segundos y sin semanas: la agenda mira días cercanos, y una precisión
 * mayor no cambia ninguna decisión de quien la lee.
 */
export function haceCuanto(momento, ahora = new Date()) {
  if (!(momento instanceof Date) || Number.isNaN(momento.getTime())) return null;
  const minutos = Math.floor((ahora - momento) / 60000);
  if (minutos < 1) return 'recién';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'hace 1 día' : `hace ${dias} días`;
}

/* ── Cancelar una reserva (migración 66) ────────────────────────────────── */

/** Lo mismo que exige el servidor: al menos diez caracteres sin contar espacios al borde. */
export const MINIMO_MOTIVO = 10;

/**
 * ¿El motivo alcanza para enviarlo?
 *
 * Se comprueba acá solo para poder desactivar el botón. El texto de rechazo
 * que se muestra es el del servidor, no uno inventado en la pantalla.
 */
export function motivoDeCancelacionValido(texto) {
  return String(texto || '').trim().length >= MINIMO_MOTIVO;
}

/* ── Ocupar un horario (migraciones 60 y 69) ────────────────────────────── */

/**
 * Las horas que se pueden elegir como inicio y como término de un bloqueo,
 * derivadas de los slots que ya devolvió el calendario.
 *
 * Se saca del calendario y no de un rango fijo porque el horario de atención
 * es por cancha y por día: ofrecer las 24 horas dejaría elegir un bloqueo
 * fuera del horario, que no rompe nada pero tampoco significa nada.
 *
 * Devuelve `{ inicios, terminos }`: los términos incluyen el cierre, que no es
 * el inicio de ningún bloque.
 */
export function horasElegibles(slots = []) {
  const inicios = (slots || []).map((s) => s.hora_inicio).filter(Boolean);
  const ultimo = (slots || [])[slots.length - 1];
  const terminos = inicios.slice(1);
  if (ultimo?.hora_fin) terminos.push(ultimo.hora_fin);
  return { inicios, terminos };
}

/**
 * Los slots que caen dentro de un rango, con la MISMA regla semiabierta que
 * usan las tarifas y los bloqueos en el servidor: cuenta el bloque cuyo inicio
 * está en [desde, hasta). El bloque que empieza justo a la hora de término
 * queda afuera.
 */
export function bloquesEnRango(slots = [], desde, hasta) {
  const a = horaAMinutos(desde);
  const b = horaAMinutos(hasta);
  if (a === null || b === null || b <= a) return [];
  return (slots || []).filter((s) => {
    const i = horaAMinutos(s.hora_inicio);
    return i !== null && i >= a && i < b;
  });
}

/**
 * Los bloques del rango que ya tienen una reserva confirmada.
 *
 * Es el aviso anticipado de la regla 7 (artboard 1r): el servidor rechaza el
 * bloqueo con «Ese horario tiene una reserva confirmada: cancélala antes de
 * bloquearlo», y la pantalla puede decirlo antes de enviar. Solo `'reservada'`
 * cuenta: un bloque libre con grupos armando sigue libre.
 */
export function reservasQueChocan(slots = [], desde, hasta) {
  return bloquesEnRango(slots, desde, hasta)
    .filter((s) => s.estado === 'reservada' && s.reserva)
    .map((s) => ({ hora_inicio: s.hora_inicio, reserva: s.reserva }));
}

/**
 * El primer sub-rango libre que queda si se recorta el choque por delante.
 *
 * Es la salida que ofrece 1r («Ocupar solo 14:00–16:00»): si la reserva está al
 * principio del rango pedido, se propone empezar después de ella. Devuelve
 * `null` cuando recortar no deja nada o cuando el choque no está al principio,
 * porque ahí la propuesta sería adivinar.
 */
export function rangoSinChoque(slots = [], desde, hasta) {
  const dentro = bloquesEnRango(slots, desde, hasta);
  if (dentro.length === 0) return null;
  const primeroLibre = dentro.findIndex((s) => s.estado !== 'reservada');
  if (primeroLibre <= 0) return null;
  if (dentro.slice(primeroLibre).some((s) => s.estado === 'reservada')) return null;
  return { desde: dentro[primeroLibre].hora_inicio, hasta };
}

/** «Ocupar 2 horas» / «Ocupar 1 hora» / «Ocupar 90 min», según cuánto se marcó. */
export function etiquetaOcupar(desde, hasta) {
  const min = duracionEnMinutos(desde, hasta);
  const dur = etiquetaDuracion(min);
  return dur ? `Ocupar ${dur}` : 'Ocupar';
}

/* ── Horarios de atención (migración 60) ────────────────────────────────── */

/**
 * Los días de la semana en el orden en que se leen en Chile: lunes primero.
 *
 * `dia` es el número que usa Postgres (`extract(dow)`, 0 = domingo), y no se
 * reordena en la base: se reordena SOLO para mostrar. Cambiar la numeración
 * rompería las reglas ya cargadas.
 */
export const DIAS_SEMANA = [
  { dia: 1, corto: 'Lun', letra: 'L', largo: 'lunes' },
  { dia: 2, corto: 'Mar', letra: 'M', largo: 'martes' },
  { dia: 3, corto: 'Mié', letra: 'X', largo: 'miércoles' },
  { dia: 4, corto: 'Jue', letra: 'J', largo: 'jueves' },
  { dia: 5, corto: 'Vie', letra: 'V', largo: 'viernes' },
  { dia: 6, corto: 'Sáb', letra: 'S', largo: 'sábado' },
  { dia: 0, corto: 'Dom', letra: 'D', largo: 'domingo' },
];

/**
 * Las horas que se pueden elegir como apertura o cierre, de a `paso` minutos.
 *
 * `incluirMedianoche` agrega '24:00' al final y solo tiene sentido para el
 * CIERRE. No es un truco: Postgres acepta `time '24:00'`, pasa la validación
 * de «el cierre tiene que ser posterior a la apertura» y genera los bloques
 * correctos. Sin ella, una cancha abierta hasta la medianoche no se podría
 * cargar — habría que poner 23:00 y perder la última hora.
 */
export function horasDelReloj({ paso = 30, incluirMedianoche = false } = {}) {
  const horas = [];
  for (let m = 0; m < 24 * 60; m += paso) horas.push(minutosAHora(m));
  if (incluirMedianoche) horas.push('24:00');
  return horas;
}

/** ¿Se cruzan dos rangos horarios? Pegados NO se cruzan: 14:00–16:00 después de 10:00–14:00 vale. */
export function rangosSeCruzan(unoDesde, unoHasta, otroDesde, otroHasta) {
  const a1 = horaAMinutos(unoDesde);
  const a2 = horaAMinutos(unoHasta);
  const b1 = horaAMinutos(otroDesde);
  const b2 = horaAMinutos(otroHasta);
  if ([a1, a2, b1, b2].some((v) => v === null)) return false;
  return a1 < b2 && a2 > b1;
}

/**
 * La regla ya cargada que chocaría con este horario nuevo, o `null`.
 *
 * Anticipa lo que el servidor rechaza con «Ya hay un horario que se cruza con
 * este ese día» (migración 60). Se comprueba acá para poder ofrecer las dos
 * salidas —empezar donde termina la otra, o editarla— en vez de mostrar el
 * error y dejar a la persona adivinando. El mensaje que se muestra si igual
 * se envía es el del servidor.
 *
 * `reglaId` es la regla que se está editando: no choca consigo misma.
 */
export function choqueDeHorario(reglas = [], diaSemana, apertura, cierre, reglaId = null) {
  return (reglas || []).find(
    (r) => r.dia_semana === diaSemana
      && r.id !== reglaId
      && rangosSeCruzan(apertura, cierre, r.hora_apertura, r.hora_cierre),
  ) || null;
}

/** Las reglas de un día, ordenadas por hora de apertura. */
export function horariosDelDia(reglas = [], diaSemana) {
  return (reglas || [])
    .filter((r) => r.dia_semana === diaSemana)
    .sort((a, b) => (horaAMinutos(a.hora_apertura) ?? 0) - (horaAMinutos(b.hora_apertura) ?? 0));
}

/** '09:00–14:00'. Guion largo, que es como se escribe un rango. */
export function rangoLegible(desde, hasta) {
  if (!desde || !hasta) return null;
  return `${String(desde).slice(0, 5)}\u2013${String(hasta).slice(0, 5)}`;
}

/* ── Teléfono (migraciones 67 y 69) ─────────────────────────────────────── */

/**
 * La misma normalización que `normaliza_telefono_cl()` en Postgres.
 *
 * Se repite en el cliente para poder avisar mientras se escribe, pero el que
 * manda es el del servidor: si esto aceptara algo que allá se rechaza, el
 * error igual aparece — con el mensaje del servidor, que es el que se muestra.
 *
 * Devuelve `+569XXXXXXXX` o `null`. Solo móviles: el contacto existe para
 * llamar o escribir por WhatsApp el día del partido, y a un fijo no se le
 * escribe.
 */
export function normalizaTelefonoCl(telefono) {
  const digitos = String(telefono || '').replace(/\D/g, '');
  let d = digitos;
  if (d.length === 11 && d.startsWith('56')) d = d.slice(2);
  else if (d.length === 12 && d.startsWith('056')) d = d.slice(3);
  return d.length === 9 && d.startsWith('9') ? `+56${d}` : null;
}

/** ¿Se puede enviar este teléfono? Vacío también sirve: el contacto es opcional. */
export function telefonoAceptable(telefono) {
  const t = String(telefono || '').trim();
  if (t === '') return true;
  return normalizaTelefonoCl(t) !== null;
}

/* ── Horas sueltas ──────────────────────────────────────────────────────── */

/** Reexportadas para que una pantalla no tenga que importar de dos archivos. */
export { horaAMinutos, minutosAHora };
