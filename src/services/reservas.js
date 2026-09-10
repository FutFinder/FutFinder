import { supabase, isSupabaseConfigured } from './supabase';
import { comoListaRecinto, comoResultadoRecinto } from '../utils/recintoAgenda';
import {
  nombreDeTipo, jugadoresDeTipo, notaDeCancha, comoComplejoDeLista, comoCancha,
} from '../utils/reservasJugador';
import { nombresDeServicios } from '../utils/serviciosRecinto';

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
  ] = await Promise.all([
    supabase
      .from('complejos')
      .select('id, nombre, descripcion, direccion, comuna, region, latitud, longitud, foto_url, verificado_futfinder, rating_avg, rating_count')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('canchas_reservables')
      .select('id, nombre, tipo, precio_hora, duracion_slot_min')
      .eq('complejo_id', id)
      .eq('activa', true)
      .order('nombre'),
    supabase
      .from('complejo_servicios')
      .select('servicio')
      .eq('complejo_id', id),
  ]);

  if (e1 || e2 || e3) {
    console.error('[FutFinder] getComplejoById:', e1 || e2 || e3);
    return { data: null, error: { message: (e1 || e2 || e3).message || 'No se pudo cargar el complejo.' } };
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

export { nombreDeTipo, jugadoresDeTipo, notaDeCancha };
