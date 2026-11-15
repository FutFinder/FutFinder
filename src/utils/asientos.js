/**
 * Asientos de un partido (migración 182): el contador «10/14», la lista de
 * asientos que se dibuja y las validaciones del armado.
 *
 * Vive acá, sin importar nada de Supabase ni de React, para poder probarse.
 *
 * ── DE DÓNDE SALEN LOS NÚMEROS ────────────────────────────────────────────
 *
 * `cupos_totales` son las plazas APARTE del organizador, así que el total del
 * partido es `cupos_totales + 1`. `cupos_disponibles` lo recalcula el servidor
 * (`matches_guard_cupos`) restando la nómina con cuenta y los asientos sin
 * cuenta (reservados e invitados por nombre). Acá no se cuenta nada: se
 * muestra lo que el servidor ya contó.
 */

/** Límites del total de jugadores (lo que acepta `matches_cupos_totales_check` más el organizador). */
export const TOTAL_JUGADORES = { min: 2, max: 31 };

/** Largo máximo de un nombre escrito a mano (igual que el `check` de la tabla). */
export const NOMBRE_MAX = 40;

const OCUPAN = ['inscrito', 'confirmado_gps', 'no_asistio'];

/** ¿Es un partido entre clubes? Esos llevan su propia cuenta por club. */
function esDeClubes(match) {
  return !!(match?.challenge_proposal_id || match?.cupos_por_club);
}

/**
 * El contador público de un partido normal: confirmados sobre total.
 * Devuelve `null` en partidos de clubes, que no usan asientos.
 */
export function contadorDeJugadores(match) {
  if (!match || esDeClubes(match)) return null;
  const plazas = Number(match.cupos_totales);
  if (!Number.isFinite(plazas) || plazas < 1) return null;
  const total = plazas + 1;
  const libres = Math.min(Math.max(Number(match.cupos_disponibles) || 0, 0), plazas);
  const confirmados = total - libres;
  const completo = libres === 0;
  return {
    total,
    confirmados,
    libres,
    completo,
    /** «10/14» */
    texto: `${confirmados}/${total}`,
    /** «quedan 4 cupos» · «queda 1 cupo» · «Completo» */
    resto: completo ? 'Completo' : `${libres === 1 ? 'queda' : 'quedan'} ${libres} ${libres === 1 ? 'cupo' : 'cupos'}`,
  };
}

/** «10/14 · quedan 4 cupos», o `null` si el partido no usa asientos. */
export function resumenDeJugadores(match) {
  const c = contadorDeJugadores(match);
  return c ? `${c.texto} · ${c.resto}` : null;
}

/** Deja un nombre escrito a mano como lo guarda el servidor, o `null` si no sirve. */
export function limpiarNombre(nombre) {
  const v = String(nombre ?? '').replace(/\s+/g, ' ').trim();
  if (v.length < 1 || v.length > NOMBRE_MAX) return null;
  return v;
}

/**
 * ¿Se pueden escribir nombres todavía? `ajustes` es lo que devuelve
 * `partidos_ajustes()`. El servidor ya mira la fecha; se vuelve a mirar acá
 * porque los ajustes se guardan unos minutos y el período puede terminar con
 * la pantalla abierta.
 */
export function nombresVigentes(ajustes, ahora = Date.now()) {
  if (!ajustes?.asientos_por_nombre) return false;
  const fin = ajustes.asientos_por_nombre_termina;
  if (!fin) return true;
  const t = new Date(fin).getTime();
  return !Number.isFinite(t) || t > ahora;
}

/**
 * Valida el armado al publicar.
 *
 * `ocupados` son los asientos que el creador llenó además del suyo:
 *   { tipo: 'amigo', user_id, username, foto_url } | { tipo: 'nombre', nombre } | { tipo: 'reservado' }
 *
 * Devuelve el mensaje del primer problema, o `null` si se puede publicar.
 */
export function validarArmado(total, ocupados = []) {
  const t = Number(total);
  if (!Number.isInteger(t) || t < TOTAL_JUGADORES.min) {
    return `El partido necesita al menos ${TOTAL_JUGADORES.min} jugadores`;
  }
  if (t > TOTAL_JUGADORES.max) return `El máximo es ${TOTAL_JUGADORES.max} jugadores`;
  // +1 por el creador. Tiene que sobrar al menos un asiento para publicar.
  if (ocupados.length + 1 >= t) {
    return 'El total tiene que ser mayor que los jugadores que ya tienes. Deja al menos un asiento libre o sube el total.';
  }
  const vistos = new Set();
  for (const a of ocupados) {
    if (a?.tipo === 'amigo') {
      if (!a.user_id) return 'Falta elegir a un amigo en uno de los asientos';
      if (vistos.has(a.user_id)) return 'Un mismo jugador no puede ocupar dos asientos';
      vistos.add(a.user_id);
    } else if (a?.tipo === 'nombre') {
      if (!limpiarNombre(a.nombre)) return `Escribe un nombre de hasta ${NOMBRE_MAX} letras`;
    } else if (a?.tipo !== 'reservado') {
      return 'Hay un asiento que no reconocemos';
    }
  }
  return null;
}

/** Lo que se le manda a `publicar_partido_con_asientos` / `asientos_armar`. */
export function payloadDeAsientos(ocupados = []) {
  return ocupados.map((a) => {
    if (a.tipo === 'amigo') return { tipo: 'amigo', user_id: a.user_id };
    if (a.tipo === 'nombre') return { tipo: 'nombre', nombre: limpiarNombre(a.nombre) };
    return { tipo: 'reservado' };
  });
}

/** Cuántos asientos quedan libres en el borrador de publicación. */
export function libresDelBorrador(total, ocupados = []) {
  return Math.max(Number(total) - 1 - ocupados.length, 0);
}

/**
 * La lista de asientos del borrador, en el orden en que se dibuja:
 * creador, ocupados y los libres al final.
 */
export function asientosDelBorrador(total, ocupados = [], creador = null) {
  const lista = [{ key: 'creador', tipo: 'creador', ...(creador || {}) }];
  ocupados.forEach((a, i) => lista.push({ ...a, key: `o${i}`, indice: i, tipo: a.tipo === 'amigo' ? 'cuenta' : a.tipo }));
  const libres = libresDelBorrador(total, ocupados);
  for (let i = 0; i < libres; i += 1) lista.push({ key: `l${i}`, tipo: 'libre' });
  return lista;
}

/**
 * La lista de asientos de un partido publicado.
 *
 * `nomina` es lo que devuelve `getMatchAttendees`; `sinCuenta` son las filas
 * de `match_asientos`. El orden es fijo —creador, cuentas, invitados por
 * nombre, reservados, libres— para que la lista no salte al recargar.
 */
export function asientosDelPartido(match, nomina = [], sinCuenta = []) {
  const c = contadorDeJugadores(match);
  if (!c) return [];
  const conCupo = nomina.filter((a) => OCUPAN.includes(a.estado));
  const creador = conCupo.find((a) => a.is_organizer || a.user_id === match.id_organizador);
  const lista = [];
  if (creador) lista.push({ ...creador, key: `u${creador.user_id}`, tipo: 'creador' });
  conCupo
    .filter((a) => a !== creador)
    .forEach((a) => lista.push({ ...a, key: `u${a.user_id}`, tipo: 'cuenta', asignado: a.origen === 'asiento_asignado' }));
  sinCuenta
    .filter((s) => s.tipo === 'nombre')
    .forEach((s) => lista.push({ key: `a${s.id}`, tipo: 'nombre', asiento_id: s.id, nombre: s.nombre }));
  sinCuenta
    .filter((s) => s.tipo === 'reservado')
    .forEach((s) => lista.push({ key: `a${s.id}`, tipo: 'reservado', asiento_id: s.id }));
  for (let i = 0; i < c.libres; i += 1) lista.push({ key: `l${i}`, tipo: 'libre' });
  return lista;
}

/** Cuántas reservas quedan por tomar con el link. */
export function reservasDisponibles(sinCuenta = []) {
  return sinCuenta.filter((s) => s.tipo === 'reservado').length;
}

// `www` y no la raíz: `futfinder.cl` redirige a `www`, y un enlace que pasa
// por una redirección no abre la app (ver scripts/enlacesUniversales.js).
const BASE_URL = 'https://www.futfinder.cl/p/';

/** El link de invitación: el del partido más el token de las reservas. */
export function linkDeInvitacion(matchId, token) {
  if (!matchId || !token) return null;
  return `${BASE_URL}${matchId}?inv=${token}`;
}

/** El mensaje que acompaña al link en WhatsApp. */
export function textoDeInvitacion(match, token) {
  const url = linkDeInvitacion(match?.id, token);
  if (!url) return '';
  return [
    `Te guardé un cupo en «${match.titulo}».`,
    'Entra con tu cuenta de FutFinder y toma tu asiento:',
    url,
  ].join('\n');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El token que viene en `?inv=`, o `null` si no tiene forma de token. */
export function tokenDeInvitacion(valor) {
  const v = String(valor ?? '').trim();
  return UUID.test(v) ? v : null;
}

const ERRORES = {
  ASIENTO_NO_AUTENTICADO: 'Inicia sesión para continuar.',
  ASIENTO_PARTIDO_NO_EXISTE: 'Este partido ya no existe.',
  ASIENTO_SOLO_ORGANIZADOR: 'Sólo quien organiza el partido puede cambiar los asientos.',
  ASIENTO_PARTIDO_DE_CLUBES: 'Los partidos entre clubes arman su nómina por club.',
  ASIENTO_PARTIDO_CERRADO: 'Este partido ya no admite cambios en sus asientos.',
  ASIENTO_SIN_LIBRES: 'No quedan asientos libres. Sube el total de jugadores o libera un asiento.',
  ASIENTO_TOTAL_INVALIDO: `El total de jugadores tiene que estar entre ${TOTAL_JUGADORES.min} y ${TOTAL_JUGADORES.max}.`,
  ASIENTO_NOMBRES_APAGADO: 'Ya no se pueden agregar jugadores sólo por nombre. Usa una cuenta de FutFinder o el link de invitación.',
  ASIENTO_NOMBRE_INVALIDO: `Escribe un nombre de hasta ${NOMBRE_MAX} letras.`,
  ASIENTO_JUGADOR_INVALIDO: 'Ese jugador no se puede agregar.',
  ASIENTO_NO_ES_AMIGO: 'Sólo puedes agregar a tus amigos. Para el resto, reserva un asiento y comparte el link.',
  ASIENTO_YA_EN_PARTIDO: 'Ese jugador ya tiene un asiento en este partido.',
  ASIENTO_NO_EXISTE: 'Ese asiento ya no existe. Actualiza la lista.',
  ASIENTO_TIPO_INVALIDO: 'No reconocemos ese tipo de asiento.',
  CUPOS_MENOR_QUE_CONFIRMADOS: 'El total no puede ser menor que los jugadores que ya tienen asiento.',
  CHOQUE_HORARIO: 'Ese jugador ya tiene otro partido a esa hora.',
  SUSPENDIDO: 'Esa cuenta está suspendida y no puede sumarse a partidos por ahora.',
  EXPULSADO: 'Ese jugador fue sacado de este partido y no puede volver a entrar.',
  TELEFONO_NO_VERIFICADO: 'Falta registrar el teléfono en Ajustes para sumarse a un partido.',
};

/** Traduce el error de una RPC de asientos a un mensaje para la pantalla. */
export function traducirErrorDeAsiento(error, respaldo = 'No pudimos guardar el cambio. Inténtalo de nuevo.') {
  const texto = typeof error === 'string' ? error : error?.message || '';
  const codigo = texto.split(':')[0].trim();
  return ERRORES[codigo] || respaldo;
}

/**
 * Lo que se le dice a quien abrió el link, según respondió
 * `tomar_asiento_reservado`. `tono` es 'ok' | 'aviso' | 'error'.
 */
export function mensajeDelLink(respuesta) {
  if (!respuesta) {
    return { tono: 'error', texto: 'No pudimos revisar tu invitación. Inténtalo de nuevo.', reintentar: true };
  }
  if (respuesta.ok) {
    return respuesta.ya_estaba
      ? { tono: 'ok', texto: 'Ya tienes tu asiento en este partido.' }
      : { tono: 'ok', texto: '¡Listo! Tomaste tu asiento en el partido.' };
  }
  switch (respuesta.reason) {
    case 'SIN_RESERVAS':
      return {
        tono: 'aviso',
        texto: 'Ya no quedan asientos reservados con este link. Si hay cupos libres, puedes unirte como cualquier jugador.',
      };
    case 'LINK_INVALIDO':
      return { tono: 'error', texto: 'Este link de invitación no es válido o ya venció.' };
    case 'PARTIDO_CERRADO':
      return { tono: 'error', texto: 'Este partido ya no recibe jugadores.' };
    case 'NO_AUTENTICADO':
      return { tono: 'aviso', texto: 'Inicia sesión para tomar tu asiento.' };
    default:
      return { tono: 'error', texto: traducirErrorDeAsiento(respuesta.reason, 'No pudimos darte el asiento. Inténtalo de nuevo.') };
  }
}
