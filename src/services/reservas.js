import { supabase, isSupabaseConfigured } from './supabase';
import { comoListaRecinto, comoResultadoRecinto } from '../utils/recintoAgenda';
import {
  nombreDeTipo, jugadoresDeTipo, notaDeCancha, comoComplejoDeLista, comoCancha,
} from '../utils/reservasJugador';
import { nombresDeServicios } from '../utils/serviciosRecinto';
import { comoReserva } from '../utils/misReservas';
import { comoDetalle } from '../utils/pagoDividido';
import { comoBalance } from '../utils/saldo';

/**
 * Servicio del vertical Reservas, LADO DEL JUGADOR.
 *
 * Hasta la migración 74 esto devolvía datos de ejemplo: tres complejos
 * inventados y una grilla de horas fija. Ahora lee de Supabase.
 *
 * LO QUE EL JUGADOR VE Y LO QUE NO. `get_disponibilidad_cancha` devuelve, por
 * cada bloque, solo si está disponible y cuánto cuesta. Nunca POR QUÉ no está:
 * ni que hay una reserva de otra persona, ni que el recinto cerró esa hora por
 * mantención. Es una decisión de privacidad del backend, no una limitación —
 * así que la interfaz usa UNA sola etiqueta para todo lo no disponible.
 *
 * SOLO SE VE LO PUBLICADO. `buscar_complejos()` filtra por `publicado` y
 * `get_disponibilidad_cancha` lo vuelve a comprobar. Un recinto a medio cargar
 * no aparece ni se le puede reservar aunque alguien tenga el id de la cancha.
 *
 * EL PRECIO ES POR BLOQUE, NO POR CANCHA. Con tarifas por franja (migración
 * 64) una misma cancha vale distinto a las 13:00 que a las 21:00, así que el
 * total de la reserva sale del bloque elegido y no del precio base. El precio
 * base solo sirve para el «desde» del listado.
 *
 * LO QUE FALTA, y es una decisión de producto, no de código: no hay pasarela
 * de pago. `crearReserva()` está lista y deja la reserva en `armando`, pero
 * pagarla necesita saldo en el Balance FutFinder y `cargar_balance` quedó
 * revocada en la migración 73 justo porque acreditaba plata sin cobrarla. El
 * flujo llega hasta el resumen.
 */

const SIN_CONFIG = { data: [], error: null };

/* ── Buscar ────────────────────────────────────────────────────── */

/**
 * Complejos publicados, con su precio más bajo, sus tipos de cancha y la
 * próxima hora libre de hoy.
 *
 * Todo eso viene en UNA llamada (`buscar_complejos`, migración 74). Calcular
 * la próxima hora libre en el cliente obligaría a pedir la disponibilidad de
 * cada cancha de cada recinto: con diez recintos de seis canchas, sesenta
 * llamadas para pintar una lista.
 *
 * `lat`/`lng` son opcionales: sin ubicación la lista viene ordenada por los
 * que tienen hora libre hoy, que es lo que la pantalla ofrece resolver.
 */
export async function listComplejosCerca({ lat, lng, query, limite = 50 } = {}) {
  if (!isSupabaseConfigured) return SIN_CONFIG;
  const { data, error } = await supabase.rpc('buscar_complejos', {
    p_lat: lat ?? null,
    p_lng: lng ?? null,
    p_query: query ?? null,
    p_limit: limite,
  });
  const res = comoListaRecinto(data, error, 'listComplejosCerca');
  if (res.error) return res;
  return { data: (res.data || []).map(comoComplejoDeLista), error: null };
}

/**
 * El bloque «juega hoy»: los recintos que todavía tienen una hora libre.
 *
 * Se deriva de la misma llamada del listado en vez de pedir otra cosa — es
 * literalmente un filtro sobre lo que ya vino.
 */
export async function listHorasLibresHoy({ lat, lng, limite = 6 } = {}) {
  const { data, error } = await listComplejosCerca({ lat, lng });
  if (error) return { data: [], error };
  const conHora = (data || [])
    .filter((c) => c.proximaHoraLibre)
    .slice(0, limite)
    .map((c) => ({
      id: `hoy-${c.id}`,
      hora: c.proximaHoraLibre,
      complejoId: c.id,
      nombre: c.nombre,
      meta: c.tipos.join(' · '),
      precio: c.desde,
    }));
  return { data: conHora, error: null };
}

/* ── Un complejo ───────────────────────────────────────────────── */

/**
 * Un complejo con sus canchas activas.
 *
 * Lectura directa: `complejos_select` deja ver solo los publicados y
 * `canchas_reservables_select` solo las de un complejo publicado (migración
 * 65), así que la RLS ya hace exactamente el filtro que corresponde. Si el
 * recinto se despublicó entremedio, esto devuelve `null` y la pantalla dice
 * que no lo encontró — que es la verdad.
 */
export async function getComplejoById(id) {
  if (!isSupabaseConfigured) return { data: null, error: null };
  if (!id) return { data: null, error: { message: 'Falta el complejo' } };

  const [
    { data: complejo, error: e1 },
    { data: canchas, error: e2 },
    { data: servicios, error: e3 },
    { data: fotos, error: e4 },
  ] = await Promise.all([
    supabase
      .from('complejos')
      .select('id, nombre, descripcion, direccion, comuna, region, latitud, longitud, foto_url, verificado_futfinder, rating_avg, rating_count')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('canchas_reservables')
      .select('id, nombre, tipo, precio_hora, duracion_slot_min, foto_url')
      .eq('complejo_id', id)
      .eq('activa', true)
      .order('nombre'),
    supabase
      .from('complejo_servicios')
      .select('servicio')
      .eq('complejo_id', id),
    // La galería (migración 80). La portada sigue viniendo en `foto_url` del
    // complejo: son cosas distintas y la del listado tiene que ser la que el
    // recinto eligió, no la primera que subió.
    supabase
      .from('complejo_fotos')
      .select('id, url')
      .eq('complejo_id', id)
      .order('orden')
      .order('created_at'),
  ]);

  if (e1 || e2 || e3 || e4) {
    console.error('[FutFinder] getComplejoById:', e1 || e2 || e3 || e4);
    return { data: null, error: { message: (e1 || e2 || e3 || e4).message || 'No se pudo cargar el complejo.' } };
  }
  if (!complejo) return { data: null, error: null };

  const kanchas = (canchas || []).map(comoCancha);
  return {
    data: {
      id: complejo.id,
      nombre: complejo.nombre,
      sector: complejo.comuna,
      direccion: complejo.direccion,
      descripcion: complejo.descripcion,
      rating: complejo.rating_avg,
      reseñas: complejo.rating_count || 0,
      verificado: !!complejo.verificado_futfinder,
      latitud: complejo.latitud,
      longitud: complejo.longitud,
      fotoUrl: complejo.foto_url,
      // La portada primero y después la galería: es el orden en que se
      // muestran, y así la primera que ve el jugador es la que el recinto
      // eligió para representarlo.
      fotos: [complejo.foto_url, ...(fotos || []).map((f) => f.url)].filter(Boolean),
      // Traducidos y en el orden del catálogo, para que dos recintos con los
      // mismos servicios los muestren igual (migración 75).
      servicios: nombresDeServicios((servicios || []).map((f) => f.servicio)),
      canchas: kanchas,
      desde: kanchas.length ? Math.min(...kanchas.map((k) => k.base)) : null,
      tipos: [...new Set(kanchas.map((k) => k.tipo))],
    },
    error: null,
  };
}

/* ── Disponibilidad ────────────────────────────────────────────── */

/**
 * Las horas de una cancha en una fecha, con su precio.
 *
 * `disponible` es lo único que dice del estado de un bloque: si está tomado
 * por otra reserva o cerrado por el recinto se ve igual, y es a propósito.
 */
export async function getDisponibilidad(canchaId, fechaIso) {
  if (!isSupabaseConfigured) return { data: { horas: [] }, error: null };
  if (!canchaId || !fechaIso) return { data: null, error: { message: 'Falta la cancha o la fecha' } };
  const { data, error } = await supabase.rpc('get_disponibilidad_cancha', {
    p_cancha_id: canchaId,
    p_fecha: fechaIso,
  });
  const res = comoResultadoRecinto(data, error, 'getDisponibilidad');
  if (res.error) return res;
  const horas = (res.data?.slots || []).map((s) => ({
    hora: s.hora_inicio,
    horaFin: s.hora_fin,
    precio: s.precio,
    disponible: !!s.disponible,
    // «Ya pasó» y «alguien la tomó» llegaban iguales (`disponible: false`),
    // así que a las 23:30 la grilla mostraba la jornada entera como
    // «Reservada» sin que nadie hubiera reservado nada (migración 97).
    pasada: !!s.pasada,
  }));
  return { data: { horas }, error: null };
}

/* ── Cobros adicionales ────────────────────────────────────────── */

/**
 * Los adicionales que ofrece el recinto: balón, petos, árbitro.
 *
 * `complejo_cobros_select` solo deja ver los ACTIVOS de un complejo publicado
 * (más los propios si administras el recinto), así que un cobro apagado no se
 * le ofrece a nadie sin necesidad de filtrar acá.
 *
 * Siempre opcionales, y del partido completo: o los toma el grupo, o nadie.
 */
export async function cobrosDelComplejo(complejoId) {
  if (!isSupabaseConfigured) return SIN_CONFIG;
  if (!complejoId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('complejo_cobros')
    .select('id, nombre, precio')
    .eq('complejo_id', complejoId)
    .eq('activo', true)
    .order('precio');
  return comoListaRecinto(data, error, 'cobrosDelComplejo');
}

/* ── Crear ─────────────────────────────────────────────────────── */

/**
 * Crea la reserva. Queda en `armando`: TODAVÍA NO OCUPA EL HORARIO.
 *
 * Es la regla central del vertical y hay que decirla en la pantalla: mientras
 * está armando, la hora sigue disponible para otros grupos y el primero que
 * confirma se la lleva. Confirmar exige pagar.
 *
 * `contactoNombre` y `contactoTelefono` son OBLIGATORIOS (migración 67): el
 * recinto necesita a quién llamar el día del partido si pasa algo. El
 * teléfono se normaliza en el servidor y solo acepta móviles.
 *
 * `cobros` son ids de `complejo_cobros`; el servidor valida que sean de ese
 * recinto y que sigan activos, y congela nombre y precio en la reserva.
 */
export async function crearReserva({
  canchaId, fecha, horaInicio, modalidad, medioPago,
  nJugadores, contactoNombre, contactoTelefono, cobros,
} = {}) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Sin conexión a la base' } };
  const { data, error } = await supabase.rpc('crear_reserva', {
    p_cancha_id: canchaId,
    p_fecha: fecha,
    p_hora_inicio: horaInicio,
    p_modalidad: modalidad,
    p_medio_pago: medioPago,
    p_n_jugadores: nJugadores ?? null,
    p_contacto_nombre: contactoNombre ?? null,
    p_contacto_telefono: contactoTelefono ?? null,
    p_cobros: cobros && cobros.length ? cobros : null,
  });
  return comoResultadoRecinto(data, error, 'crearReserva');
}

/* ── Mis reservas ──────────────────────────────────────────────── */

/**
 * Las reservas del jugador: las que organizó y en las que lo invitaron.
 *
 * RPC y no consulta directa: la pantalla necesita el nombre del recinto y de
 * la cancha, y la RLS de esas tablas solo muestra lo PUBLICADO. Un recinto
 * que se despublica haría desaparecer de la lista una reserva que la persona
 * pagó (migración 86).
 *
 * `puede_cancelar` viene calculado del servidor y NO se recalcula acá: la
 * ventana de 12 horas es una regla de plata y tener dos copias es garantizar
 * que un día digan cosas distintas.
 */
export async function misReservas(limite = 60) {
  if (!isSupabaseConfigured) return SIN_CONFIG;

  // SIN SESIÓN, `mis_reservas` DEVUELVE CERO FILAS Y NINGÚN ERROR: la RPC
  // arranca con `if auth.uid() is null then return`. Sin este chequeo, una
  // sesión vencida se ve EXACTAMENTE IGUAL que «todavía no reservaste nada»,
  // y la pantalla afirma algo falso sobre las canchas que alguien pagó en
  // vez de decirle que vuelva a entrar. Es la misma regla que ya está
  // escrita en `notificationInbox`: nunca mostrar «todo al día» cuando en
  // realidad no pudimos ni preguntar.
  const { data: sesion } = await supabase.auth.getSession();
  if (!sesion?.session) {
    return { data: null, error: { message: 'Tu sesión se cerró. Entra de nuevo para ver tus reservas.' } };
  }

  const { data, error } = await supabase.rpc('mis_reservas', { p_limite: limite });
  const res = comoListaRecinto(data, error, 'misReservas');
  if (res.error) return res;
  return { data: (res.data || []).map(comoReserva), error: null };
}

/**
 * Cancela una reserva. La ventana de 12 horas la comprueba el servidor.
 *
 * Devuelve `ok:false` con el motivo cuando ya no se puede, en vez de un
 * error: es una respuesta del negocio y la pantalla la muestra tal cual.
 */
export async function cancelarMiReserva(reservaId, motivo) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Sin conexión a la base' } };
  if (!reservaId) return { data: null, error: { message: 'Falta la reserva' } };
  const { data, error } = await supabase.rpc('cancelar_reserva', {
    p_reserva_id: reservaId,
    p_motivo: motivo || null,
  });
  return comoResultadoRecinto(data, error, 'cancelarMiReserva');
}

/* ── Pago dividido: armar el grupo ─────────────────────────────── */

/**
 * La nómina de una reserva: quién va, quién ya puso su parte, cuánto falta.
 *
 * Una sola llamada para toda la pantalla. `mis_reservas` trae el avance en
 * números para pintar la lista, pero no los nombres: pedir el detalle de cada
 * reserva solo para la lista serían N llamadas por pantalla.
 */
export async function detalleReserva(reservaId) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Sin conexión a la base' } };
  if (!reservaId) return { data: null, error: { message: 'Falta la reserva' } };
  const { data, error } = await supabase.rpc('detalle_reserva', { p_reserva_id: reservaId });
  if (error) return { data: null, error };
  if (!data?.ok) return { data: null, error: { message: data?.reason || 'No se pudo leer la reserva' } };
  return { data: comoDetalle(data), error: null };
}

/**
 * Sumar a alguien a la reserva. El servidor corta si ya no quedan cupos.
 *
 * EL ROL TIENE QUE CALZAR CON LA MODALIDAD: mandar 'jugador' en una reserva
 * de capitanes se rechaza con «Esta reserva no es de modalidad jugadores», y
 * al revés igual. Sale de `textosDeModalidad`, que es la misma fuente que
 * decide las palabras de la pantalla, para que no puedan separarse.
 */
export async function invitarParticipante(reservaId, userId, rol = 'jugador') {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Sin conexión a la base' } };
  const { data, error } = await supabase.rpc('invitar_participante_reserva', {
    p_reserva_id: reservaId, p_user_id: userId, p_rol: rol,
  });
  return comoResultadoRecinto(data, error, 'invitarParticipante');
}

/** Sacar del grupo al que no va a poner su parte. Solo el organizador. */
export async function quitarJugador(reservaId, userId) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Sin conexión a la base' } };
  const { data, error } = await supabase.rpc('quitar_participante_reserva', {
    p_reserva_id: reservaId, p_user_id: userId,
  });
  return comoResultadoRecinto(data, error, 'quitarJugador');
}

/**
 * Poner mi parte.
 *
 * NO MUEVE PLATA: autoriza que se cobre mi cuota del Balance cuando el grupo
 * esté completo. Si el grupo nunca se completa, nunca se cobró nada — por eso
 * el pago dividido es solo con Balance.
 *
 * El monto va explícito y tiene que calzar EXACTO con la cuota vigente. Es a
 * propósito: si alguien cambió entre cuántos se divide mientras yo miraba la
 * pantalla, prefiero un rechazo a que se me cobre un monto que no vi.
 *
 * Cuando entro yo último, el servidor confirma la reserva en la misma
 * llamada y lo dice en `confirmada`.
 */
export async function autorizarMiParte(reservaId, monto) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Sin conexión a la base' } };
  const { data, error } = await supabase.rpc('autorizar_cobro_reserva', {
    p_reserva_id: reservaId, p_monto: monto,
  });
  return comoResultadoRecinto(data, error, 'autorizarMiParte');
}

/** Rechazar la invitación a una reserva. */
export async function rechazarInvitacion(reservaId) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Sin conexión a la base' } };
  const { data, error } = await supabase.rpc('rechazar_invitacion_reserva', { p_reserva_id: reservaId });
  return comoResultadoRecinto(data, error, 'rechazarInvitacion');
}

/**
 * Cerrar la reserva: cobra a todos y toma la hora.
 *
 * Normalmente no hace falta llamarla —la última autorización confirma sola—
 * pero queda para el caso en que la autoconfirmación falló por algo temporal
 * (a alguien no le alcanzaba y ya cargó saldo) y el organizador reintenta.
 */
export async function confirmarReserva(reservaId) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Sin conexión a la base' } };
  const { data, error } = await supabase.rpc('confirmar_reserva', { p_reserva_id: reservaId });
  return comoResultadoRecinto(data, error, 'confirmarReserva');
}

/** Empujar a los que faltan. El servidor deja uno por hora. */
export async function recordarPago(reservaId) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Sin conexión a la base' } };
  const { data, error } = await supabase.rpc('recordar_pago_reserva', { p_reserva_id: reservaId });
  return comoResultadoRecinto(data, error, 'recordarPago');
}

/**
 * Cambiar entre cuántos se divide.
 *
 * INVALIDA TODAS las autorizaciones, incluida la de quien lo cambia: nadie
 * queda comprometido con un monto que no volvió a ver.
 */
export async function recalcularCuota(reservaId, nJugadores) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Sin conexión a la base' } };
  const { data, error } = await supabase.rpc('recalcular_cuota_reserva', {
    p_reserva_id: reservaId, p_n_jugadores: nJugadores,
  });
  return comoResultadoRecinto(data, error, 'recalcularCuota');
}

/**
 * Mi saldo.
 *
 * Solo el propio: `balance_movimientos` nunca deja ver el de otro, ni siquiera
 * el de alguien del mismo grupo. Por eso la nómina dice «falta que confirme» y
 * nunca «no le alcanza».
 */
export async function getMiBalance(limite = 50) {
  if (!isSupabaseConfigured) return { data: null, error: null };
  const { data, error } = await supabase.rpc('get_mi_balance', { p_limite: limite });

  // `get_mi_balance` devuelve un OBJETO {ok, saldo, movimientos}, no un
  // número. Hacer `Number(data) || 0` daba NaN → 0: el saldo se leía SIEMPRE
  // como cero, la pantalla del grupo decía «no te alcanza» y apagaba el
  // botón de poner la parte. Nadie podía pagar. Salió de abrir la pantalla
  // con una cuenta que sí tenía saldo, no de ningún arnés.
  if (error || !data?.ok) return { data: null, error: error || null };
  return { data: comoBalance(data), error: null };
}


/**
 * Responder la solicitud de cancelación de la cancha de un desafío.
 *
 * Solo el club que NO la pidió, y solo su admin — lo comprueba el servidor.
 * Aceptar cancela de verdad y devuelve a los dos capitanes lo que pusieron;
 * rechazar deja la cancha reservada y avisa a quien lo pidió.
 */
export async function responderCancelacionDesafio(reservaId, acepta) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Sin conexión a la base' } };
  const { data, error } = await supabase.rpc('responder_cancelacion_desafio', {
    p_reserva_id: reservaId, p_acepta: !!acepta,
  });
  return comoResultadoRecinto(data, error, 'responderCancelacionDesafio');
}

/* ── El puente desde Clubes ────────────────────────────────────── */

/**
 * Qué puede hacer este partido de clubes con su cancha.
 *
 * Una llamada y no tres: la pantalla no puede leer `club_members` del club
 * rival ni una reserva ajena por su cuenta, así que el servidor le dice de
 * una si puede reservar, si ya reservó y a quién le toca la otra mitad.
 */
export async function canchaDelPartido(matchId) {
  if (!isSupabaseConfigured || !matchId) return { data: null, error: null };
  const { data, error } = await supabase.rpc('cancha_del_partido', { p_match_id: matchId });
  if (error || !data?.ok) return { data: null, error: error || null };
  if (!data.aplica) return { data: null, error: null };
  return {
    data: {
      puedoReservar: !!data.puedo_reservar,
      reservaId: data.reserva_id || null,
      reservaEstado: data.reserva_estado || null,
      capitanRival: data.capitan_rival || null,
      capitanRivalNombre: data.capitan_rival_username || null,
      clubRival: data.club_rival || null,
      horaPartido: data.hora_partido || null,
    },
    error: null,
  };
}

/**
 * Reserva la cancha de un desafío, en modalidad capitanes.
 *
 * UNA SOLA LLAMADA para crear, invitar al capitán rival y enlazar con el
 * partido: los tres pasos no pueden quedar a medias, porque una reserva de
 * capitanes sin el segundo capitán no se puede confirmar nunca.
 */
export async function reservarCanchaDelPartido({
  matchId, canchaId, fecha, horaInicio, contactoNombre, contactoTelefono, cobros,
} = {}) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Sin conexión a la base' } };
  const { data, error } = await supabase.rpc('reservar_cancha_del_partido', {
    p_match_id: matchId,
    p_cancha_id: canchaId,
    p_fecha: fecha,
    p_hora_inicio: horaInicio,
    p_contacto_nombre: contactoNombre ?? null,
    p_contacto_telefono: contactoTelefono ?? null,
    p_cobros: cobros && cobros.length ? cobros : null,
  });
  return comoResultadoRecinto(data, error, 'reservarCanchaDelPartido');
}

export { nombreDeTipo, jugadoresDeTipo, notaDeCancha };
