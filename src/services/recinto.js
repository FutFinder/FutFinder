import { supabase, isSupabaseConfigured } from './supabase';
import { comoResultadoRecinto, comoListaRecinto } from '../utils/recintoAgenda';

/**
 * Administración de un recinto: ficha, canchas, horarios, bloqueos, agenda,
 * comisión y administradores (migraciones 60, 61 y 62).
 *
 * TODO PASA POR UNA RPC, y acá no es una convención sino la única vía posible:
 * `complejos`, `canchas_reservables` y `cancha_horario_reglas` NO tienen
 * ninguna política de escritura, y `complejo_admins`, `cancha_bloqueos` y
 * `reserva_comisiones` tampoco. Un `from('canchas_reservables').update(...)`
 * no fallaría acá, fallaría en el servidor sin tocar una fila. Es deliberado:
 * una sola puerta, con la autorización en un lugar auditable (mismo criterio
 * que la migración 50).
 *
 * LAS RESERVAS NO SE LEEN DE LA TABLA. `reservas_select` solo deja leer al
 * organizador y a los participantes, así que un administrador de complejo no
 * ve ni una fila con un `select` directo. La agenda, el calendario y el
 * detalle vienen de las tres RPC de la migración 61, que devuelven una vista
 * recortada a propósito: del organizador su `username` y su foto, y del resto
 * de los participantes solo cuántos son y cuántos aceptaron — nunca sus
 * identidades.
 *
 * LOS ERRORES LLEGAN COMO EXCEPCIÓN. Las RPC `admin_*` levantan
 * `raise exception` con un mensaje ya redactado en español, en vez de devolver
 * `{ ok: false, reason }` como el resto del vertical. Eso significa que hay que
 * mirar `error.message` y mostrarlo, no buscar un `reason`. Lo normaliza
 * `comoResultadoRecinto`.
 *
 * LA COMISIÓN NO SE CALCULA ACÁ. Va congelada en cada reserva (migración 62) y
 * las RPC la devuelven ya desglosada en `comision_base`, `comision` y `neto`.
 * `parametrosDeComision()` existe solo para poder mostrar la REGLA («5%, mínimo
 * $1.000») antes de que exista una reserva; nunca para recalcular una.
 */

const DEMO = { data: null, error: { message: 'Demo' } };

/* ── Lecturas ──────────────────────────────────────────────────── */

/**
 * Los complejos que administra la persona autenticada, con su `rol`.
 *
 * El `rol` importa para la interfaz: solo un `dueño` puede sumar o quitar
 * administradores, así que la pantalla lo necesita para decidir si muestra esa
 * sección. Devuelve una lista: con dos o más recintos se muestra el selector,
 * con uno se entra directo al panel.
 */
export async function misRecintos() {
  if (!isSupabaseConfigured) return { data: [], error: null };
  const { data, error } = await supabase.rpc('admin_mis_complejos');
  return comoListaRecinto(data, error, 'misRecintos');
}

/**
 * Agenda de un día completo del recinto, más los contadores del panel.
 *
 * Trae `resumen`, `reservas` y `bloqueos` en una sola llamada para que la
 * pantalla principal se arme de una vez. Las reservas vienen en los estados
 * `confirmada`, `armando`, `procesando` y `cancelada`; `rechazada` y `vencida`
 * quedan fuera porque nunca ocuparon el horario.
 */
export async function agendaDelDia(complejoId, fecha) {
  if (!isSupabaseConfigured) return DEMO;
  if (!complejoId || !fecha) return { data: null, error: { message: 'Falta el recinto o la fecha' } };
  const { data, error } = await supabase.rpc('admin_agenda_complejo', {
    p_complejo_id: complejoId,
    p_fecha: fecha,
  });
  return comoResultadoRecinto(data, error, 'agendaDelDia');
}

/**
 * Calendario de una cancha en una fecha, con el motivo de cada bloque.
 *
 * Es la contracara de `getDisponibilidad` del lado del jugador, que nunca dice
 * POR QUÉ un bloque no está. Acá cada slot viene como `'libre'`,
 * `'reservada'` o `'bloqueada'`.
 *
 * OJO: un slot con `grupos_en_curso > 0` sigue siendo `'libre'`. Hay gente
 * juntando la plata, pero la hora está disponible hasta que alguien confirme.
 * Usa `estadoDeBloque()` de `utils/recintoAgenda` para no equivocarse con eso.
 */
export async function calendarioDeCancha(canchaId, fecha) {
  if (!isSupabaseConfigured) return DEMO;
  if (!canchaId || !fecha) return { data: null, error: { message: 'Falta la cancha o la fecha' } };
  const { data, error } = await supabase.rpc('admin_calendario_cancha', {
    p_cancha_id: canchaId,
    p_fecha: fecha,
  });
  return comoResultadoRecinto(data, error, 'calendarioDeCancha');
}

/** Detalle de una reserva, con el desglose bruto / comisión / neto. */
export async function detalleDeReserva(reservaId) {
  if (!isSupabaseConfigured) return DEMO;
  if (!reservaId) return { data: null, error: { message: 'Falta la reserva' } };
  const { data, error } = await supabase.rpc('admin_reserva_detalle', { p_reserva_id: reservaId });
  return comoResultadoRecinto(data, error, 'detalleDeReserva');
}

/**
 * La regla de la comisión, para mostrarla antes de que exista una reserva.
 *
 * Devuelve `{ tasa, piso, techo, iva_tasa }`. NO sirve para calcular la
 * comisión de una reserva concreta: esa va congelada en la fila y la traen las
 * RPC de arriba.
 */
export async function parametrosDeComision() {
  if (!isSupabaseConfigured) return DEMO;
  const { data, error } = await supabase.rpc('comision_params');
  return comoResultadoRecinto(data, error, 'parametrosDeComision');
}

/* ── Ficha del recinto ─────────────────────────────────────────── */

/**
 * Edita la ficha. Un campo en `null` significa NO CAMBIAR, no borrar.
 *
 * Por eso hoy no se puede vaciar la descripción ni la dirección; si alguna vez
 * hace falta, se agrega un parámetro de borrado explícito en vez de cambiarle
 * el significado al `null`. La región y la comuna no están: las cambia el
 * equipo de FutFinder, no el recinto.
 */
export async function actualizarFicha(complejoId, { nombre, descripcion, direccion, fotoUrl } = {}) {
  if (!isSupabaseConfigured) return DEMO;
  if (!complejoId) return { data: null, error: { message: 'Falta el recinto' } };
  const { data, error } = await supabase.rpc('admin_actualizar_complejo', {
    p_complejo_id: complejoId,
    p_nombre: nombre ?? null,
    p_descripcion: descripcion ?? null,
    p_direccion: direccion ?? null,
    p_foto_url: fotoUrl ?? null,
  });
  return comoResultadoRecinto(data, error, 'actualizarFicha');
}

/* ── Canchas ───────────────────────────────────────────────────── */

/** Crea una cancha. `tipo` es `futbol_5`, `futbol_7` o `futbol_11`. */
export async function crearCancha(complejoId, { nombre, tipo, precioHora, duracionSlotMin } = {}) {
  if (!isSupabaseConfigured) return DEMO;
  if (!complejoId) return { data: null, error: { message: 'Falta el recinto' } };
  const { data, error } = await supabase.rpc('admin_crear_cancha', {
    p_complejo_id: complejoId,
    p_nombre: nombre ?? null,
    p_tipo: tipo ?? null,
    p_precio_hora: precioHora ?? null,
    p_duracion_slot_min: duracionSlotMin ?? 60,
  });
  return comoResultadoRecinto(data, error, 'crearCancha');
}

/**
 * Edita una cancha. El `tipo` NO se puede cambiar y por eso no es parámetro:
 * una de fútbol 7 no se convierte en una de fútbol 11 sin obra. Si la cancha
 * cambió de verdad, se crea otra y se desactiva esta, para no reescribir el
 * tipo de las reservas históricas.
 *
 * `activa: false` no borra nada: la cancha deja de aparecer y de recibir
 * reservas nuevas, y las ya confirmadas se respetan.
 */
export async function actualizarCancha(canchaId, { nombre, precioHora, duracionSlotMin, activa } = {}) {
  if (!isSupabaseConfigured) return DEMO;
  if (!canchaId) return { data: null, error: { message: 'Falta la cancha' } };
  const { data, error } = await supabase.rpc('admin_actualizar_cancha', {
    p_cancha_id: canchaId,
    p_nombre: nombre ?? null,
    p_precio_hora: precioHora ?? null,
    p_duracion_slot_min: duracionSlotMin ?? null,
    p_activa: activa ?? null,
  });
  return comoResultadoRecinto(data, error, 'actualizarCancha');
}

/* ── Horarios (plantilla semanal recurrente) ───────────────────── */

/**
 * Crea o edita una regla de horario. `diaSemana` es 0 = domingo.
 *
 * El servidor rechaza dos reglas del mismo día que se cruzan, porque eso hace
 * que el calendario emita el mismo bloque dos veces. Pegadas sí valen:
 * 14:00–16:00 después de 10:00–14:00 está bien.
 *
 * PARA CARGAR VARIOS DÍAS hay que llamarla una vez por día, y eso no es
 * atómico: si la cuarta falla, quedan tres cargados. Mientras no exista una RPC
 * que reciba la lista, la pantalla tiene que informar qué días alcanzó a
 * guardar en vez de decir "no se pudo".
 */
export async function guardarHorario(canchaId, { diaSemana, horaApertura, horaCierre, reglaId } = {}) {
  if (!isSupabaseConfigured) return DEMO;
  if (!canchaId) return { data: null, error: { message: 'Falta la cancha' } };
  const { data, error } = await supabase.rpc('admin_upsert_horario_regla', {
    p_cancha_id: canchaId,
    p_dia_semana: diaSemana ?? null,
    p_hora_apertura: horaApertura ?? null,
    p_hora_cierre: horaCierre ?? null,
    p_regla_id: reglaId ?? null,
  });
  return comoResultadoRecinto(data, error, 'guardarHorario');
}

export async function eliminarHorario(reglaId) {
  if (!isSupabaseConfigured) return DEMO;
  if (!reglaId) return { data: null, error: { message: 'Falta el horario' } };
  const { data, error } = await supabase.rpc('admin_eliminar_horario_regla', { p_regla_id: reglaId });
  return comoResultadoRecinto(data, error, 'eliminarHorario');
}

/* ── Bloqueos (excepciones de una fecha puntual) ───────────────── */

/**
 * Bloquea un rango de horas de una cancha en UNA fecha.
 *
 * No es recurrente: para cerrar todos los martes se usa el horario, no un
 * bloqueo. El servidor rechaza bloquear un horario que ya tiene una reserva
 * confirmada —el mensaje dice que hay que cancelarla primero— porque dejar el
 * bloque reservado y bloqueado a la vez es un estado ambiguo.
 *
 * El `motivo` es privado del recinto: el jugador nunca lo ve, solo ve esas
 * horas como no disponibles.
 */
export async function crearBloqueo(canchaId, { fecha, horaInicio, horaFin, motivo } = {}) {
  if (!isSupabaseConfigured) return DEMO;
  if (!canchaId) return { data: null, error: { message: 'Falta la cancha' } };
  const { data, error } = await supabase.rpc('admin_crear_bloqueo', {
    p_cancha_id: canchaId,
    p_fecha: fecha ?? null,
    p_hora_inicio: horaInicio ?? null,
    p_hora_fin: horaFin ?? null,
    p_motivo: motivo ?? null,
  });
  return comoResultadoRecinto(data, error, 'crearBloqueo');
}

export async function eliminarBloqueo(bloqueoId) {
  if (!isSupabaseConfigured) return DEMO;
  if (!bloqueoId) return { data: null, error: { message: 'Falta el bloqueo' } };
  const { data, error } = await supabase.rpc('admin_eliminar_bloqueo', { p_bloqueo_id: bloqueoId });
  return comoResultadoRecinto(data, error, 'eliminarBloqueo');
}

/* ── Administradores (solo el dueño) ───────────────────────────── */

/**
 * Suma un administrador. `userId` es el id de una persona que YA tiene cuenta
 * en FutFinder: se la busca por su nombre de usuario, porque el modelo de
 * perfiles no tiene correo.
 *
 * Solo un `dueño` puede llamarla, y no puede tocar la fila de otro dueño — ni
 * la suya. Esas dos reglas juntas impiden que un complejo quede sin dueño.
 * Cambiar de dueño es una operación del equipo de FutFinder.
 *
 * Al nombrado le llega un aviso `complejo_admin_agregado`.
 */
export async function agregarAdministrador(complejoId, userId, rol = 'admin') {
  if (!isSupabaseConfigured) return DEMO;
  if (!complejoId || !userId) return { data: null, error: { message: 'Falta el recinto o la persona' } };
  const { data, error } = await supabase.rpc('admin_agregar_admin', {
    p_complejo_id: complejoId,
    p_user_id: userId,
    p_rol: rol,
  });
  return comoResultadoRecinto(data, error, 'agregarAdministrador');
}

/** Quita un administrador. No se puede quitar a un dueño. */
export async function quitarAdministrador(complejoId, userId) {
  if (!isSupabaseConfigured) return DEMO;
  if (!complejoId || !userId) return { data: null, error: { message: 'Falta el recinto o la persona' } };
  const { data, error } = await supabase.rpc('admin_quitar_admin', {
    p_complejo_id: complejoId,
    p_user_id: userId,
  });
  return comoResultadoRecinto(data, error, 'quitarAdministrador');
}
