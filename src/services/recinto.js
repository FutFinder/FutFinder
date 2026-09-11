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
 * Las canchas de un recinto, con lo que hace falta para administrarlas.
 *
 * NO se leen de la tabla y no es una convención: desde la migración 65 la
 * policy de `canchas_reservables` solo deja ver las de un complejo PUBLICADO,
 * así que un `select` directo devuelve cero filas justo en el estado en que se
 * carga un recinto nuevo. La RPC de la migración 72 es la única vía.
 *
 * Trae además `tiene_horario` —la condición que exige publicar— y
 * `tiene_tarifas`, para distinguir una cancha de precio único de una con
 * franjas.
 */
export async function canchasDelRecinto(complejoId) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  if (!complejoId) return { data: null, error: { message: 'Falta el recinto' } };
  const { data, error } = await supabase.rpc('admin_canchas_complejo', { p_complejo_id: complejoId });
  return comoListaRecinto(data, error, 'canchasDelRecinto');
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

/**
 * Las reglas de horario de una cancha, con su `id` para poder editarlas.
 *
 * ES LA ÚNICA LECTURA DEL RECINTO QUE VA DIRECTO A LA TABLA, y va así a
 * propósito: `cancha_horario_reglas_select` es `using (true)` desde la
 * migración 54 —el horario de atención es información pública, la necesita
 * cualquier jugador para ver la grilla— y la 65 no lo acotó como sí hizo con
 * `complejos` y `canchas_reservables`. Así que no hay nada que una RPC
 * pudiera autorizar mejor: quien tiene el `cancha_id` ya puede leerlas.
 *
 * Las ESCRITURAS sí pasan por RPC (`admin_upsert_horario_regla` y
 * `admin_eliminar_horario_regla`): la tabla no tiene ninguna política de
 * insert, update ni delete.
 */
export async function horariosDeCancha(canchaId) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  if (!canchaId) return { data: null, error: { message: 'Falta la cancha' } };
  const { data, error } = await supabase
    .from('cancha_horario_reglas')
    .select('id, cancha_id, dia_semana, hora_apertura, hora_cierre')
    .eq('cancha_id', canchaId)
    .order('dia_semana')
    .order('hora_apertura');
  return comoListaRecinto(data, error, 'horariosDeCancha');
}

/**
 * Las tarifas por franja de una cancha, con su `id` para poder editarlas.
 *
 * Direct select por la misma razón que los horarios: `cancha_tarifas_select`
 * es `using (true)` desde la migración 64 —el precio es justo lo que el
 * jugador necesita ver antes de reservar, incluso sin sesión— así que no hay
 * nada que una RPC pudiera autorizar mejor. Las escrituras sí pasan por
 * `admin_upsert_tarifa` / `admin_eliminar_tarifa`.
 *
 * `dia_semana` en `null` es «todos los días»; 0-6 es un día concreto, y ese
 * manda sobre el general.
 */
export async function tarifasDeCancha(canchaId) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  if (!canchaId) return { data: null, error: { message: 'Falta la cancha' } };
  const { data, error } = await supabase
    .from('cancha_tarifas')
    .select('id, cancha_id, dia_semana, hora_desde, hora_hasta, precio')
    .eq('cancha_id', canchaId)
    .order('dia_semana', { nullsFirst: true })
    .order('hora_desde');
  return comoListaRecinto(data, error, 'tarifasDeCancha');
}

/**
 * Cuánto sería la comisión sobre un monto, PARA MOSTRARLO ANTES de que exista
 * la reserva (artboards 4a y 4c).
 *
 * Llama a `calcular_comision()` en vez de replicar la fórmula acá, y es a
 * propósito: la migración 62 dice explícitamente que el cliente no debe
 * reproducirla. El día que la tasa, el piso o el techo cambien, esta pantalla
 * cambia sola.
 *
 * NO sirve para leer la comisión de una reserva concreta: esa va congelada en
 * su fila y la traen la agenda y el detalle ya desglosada.
 */
export async function comisionDe(base) {
  if (!isSupabaseConfigured) return { data: null, error: null };
  const monto = Number(base);
  if (!Number.isFinite(monto) || monto <= 0) return { data: 0, error: null };
  const { data, error } = await supabase.rpc('calcular_comision', { p_base: Math.round(monto) });
  if (error) {
    console.error('[FutFinder] comisionDe:', error);
    return { data: null, error: { message: error.message || 'No se pudo calcular la comisión.' } };
  }
  return { data: Number(data) || 0, error: null };
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

/**
 * Los servicios del recinto: estacionamiento, camarines, quincho.
 *
 * Lectura directa: la policy ya deja ver los de un complejo publicado a
 * cualquiera, y los propios a quien lo administra aunque no esté publicado —
 * que es justo lo que hace falta para revisar la ficha antes de publicar.
 */
export async function serviciosDelRecinto(complejoId) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  if (!complejoId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('complejo_servicios')
    .select('servicio')
    .eq('complejo_id', complejoId);
  const res = comoListaRecinto(data, error, 'serviciosDelRecinto');
  if (res.error) return res;
  return { data: (res.data || []).map((f) => f.servicio), error: null };
}

/**
 * Guarda la lista COMPLETA de servicios: lo que no viene, se quita.
 *
 * Es un conjunto de chips que se encienden y apagan, así que mandar el estado
 * final evita que dos toques rápidos dejen la base en algo que la pantalla no
 * está mostrando. Un servicio fuera del catálogo lo rechaza el servidor en vez
 * de ignorarlo — y lo rechaza ANTES de borrar nada.
 */
export async function guardarServicios(complejoId, servicios = []) {
  if (!isSupabaseConfigured) return DEMO;
  if (!complejoId) return { data: null, error: { message: 'Falta el recinto' } };
  const { data, error } = await supabase.rpc('admin_actualizar_servicios', {
    p_complejo_id: complejoId,
    p_servicios: servicios || [],
  });
  return comoResultadoRecinto(data, error, 'guardarServicios');
}

/**
 * Quita la foto de portada.
 *
 * Tiene función propia porque `admin_actualizar_complejo` no puede: su
 * `coalesce` trata el null como «no cambiar», así que por ahí no hay forma de
 * vaciar el campo. Cambiarle el significado al null habría roto los otros.
 */
export async function quitarFotoRecinto(complejoId) {
  if (!isSupabaseConfigured) return DEMO;
  if (!complejoId) return { data: null, error: { message: 'Falta el recinto' } };
  const { data, error } = await supabase.rpc('admin_quitar_foto_complejo', {
    p_complejo_id: complejoId,
  });
  return comoResultadoRecinto(data, error, 'quitarFotoRecinto');
}

/**
 * La galería del recinto: las fotos que NO son la portada (migración 80).
 *
 * Lectura directa y no RPC: `complejo_fotos_select_publico` deja ver las de un
 * recinto publicado y `complejo_fotos_select_admin` las del recinto que
 * administras aunque esté sin publicar, así que la RLS ya hace el filtro. Las
 * dos policies están partidas a propósito — ver la 76.
 */
export async function fotosDelRecinto(complejoId) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  if (!complejoId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('complejo_fotos')
    .select('id, url, orden')
    .eq('complejo_id', complejoId)
    .order('orden')
    .order('created_at');
  return comoListaRecinto(data, error, 'fotosDelRecinto');
}

/** Agrega una foto ya subida a la galería. El tope de ocho lo aplica el servidor. */
export async function agregarFotoRecinto(complejoId, url) {
  if (!isSupabaseConfigured) return DEMO;
  if (!complejoId || !url) return { data: null, error: { message: 'Faltan datos' } };
  const { data, error } = await supabase.rpc('admin_agregar_foto_complejo', {
    p_complejo_id: complejoId,
    p_url: url,
  });
  return comoResultadoRecinto(data, error, 'agregarFotoRecinto');
}

/**
 * Quita una foto de la galería.
 *
 * La RPC devuelve la `url` de la foto borrada para que quien llama pueda
 * borrar también el archivo del bucket; sin eso cada foto quitada dejaría un
 * archivo huérfano que nadie sabe a quién pertenecía.
 */
export async function quitarFotoGaleria(fotoId) {
  if (!isSupabaseConfigured) return DEMO;
  if (!fotoId) return { data: null, error: { message: 'Falta la foto' } };
  const { data, error } = await supabase.rpc('admin_quitar_foto_galeria', {
    p_foto_id: fotoId,
  });
  return comoResultadoRecinto(data, error, 'quitarFotoGaleria');
}

/**
 * ¿Me autorizaron a crear un recinto? (migración 82)
 *
 * Lectura directa: `autorizaciones_recinto_select` deja ver solo las propias,
 * y la tabla no tiene policies de escritura — las crea el equipo. Devuelve la
 * más antigua sin usar, que es la que va a consumir `crearMiRecinto`.
 *
 * `null` significa que no hay, y eso NO es un error: la enorme mayoría de las
 * cuentas no tiene autorización y la pantalla simplemente no ofrece crear.
 */
export async function miAutorizacionRecinto() {
  if (!isSupabaseConfigured) return { data: null, error: null };
  const { data, error } = await supabase
    .from('autorizaciones_recinto')
    .select('id, nota, created_at')
    .is('usada_at', null)
    .order('created_at')
    .limit(1);
  if (error) {
    console.error('[FutFinder] miAutorizacionRecinto:', error);
    return { data: null, error: { message: error.message } };
  }
  return { data: data?.[0] || null, error: null };
}

/**
 * Crea el recinto y deja a quien llama como dueño, gastando la autorización.
 *
 * Las tres cosas pasan en una sola transacción del lado del servidor: un
 * recinto sin dueño no lo puede administrar nadie, y una autorización gastada
 * sin recinto sería una cuenta que perdió su turno sin nada a cambio.
 */
export async function crearMiRecinto({
  nombre, direccion, comuna, region, latitud, longitud, descripcion,
} = {}) {
  if (!isSupabaseConfigured) return DEMO;
  const { data, error } = await supabase.rpc('crear_mi_recinto', {
    p_nombre: nombre ?? null,
    p_direccion: direccion ?? null,
    p_comuna: comuna ?? null,
    p_region: region ?? null,
    p_latitud: latitud ?? null,
    p_longitud: longitud ?? null,
    p_descripcion: descripcion ?? null,
  });
  return comoResultadoRecinto(data, error, 'crearMiRecinto');
}

/**
 * Manda el recinto a revisión de FutFinder.
 *
 * Publicar pasa por el equipo (migración 82), así que esto es lo único que el
 * dueño puede hacer por su cuenta. Exige lo mismo que publicar —una cancha
 * activa con horario— para que nadie mande a revisar un recinto vacío.
 */
export async function solicitarRevisionRecinto(complejoId) {
  if (!isSupabaseConfigured) return DEMO;
  if (!complejoId) return { data: null, error: { message: 'Falta el recinto' } };
  const { data, error } = await supabase.rpc('admin_solicitar_revision_complejo', {
    p_complejo_id: complejoId,
  });
  return comoResultadoRecinto(data, error, 'solicitarRevisionRecinto');
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
 *
 * `tipo` distingue los dos motivos por los que un recinto marca una hora
 * (migración 69): `'cerrado'` es mantención —la cancha no se puede usar— y
 * `'externo'` es que alguien la arrendó por teléfono o en el mesón, o sea que
 * la cancha SÍ se va a usar y va a llegar gente. Solo en `'externo'` se pueden
 * anotar `contactoNombre` y `contactoTelefono`; en una mantención se descartan,
 * porque no hay a quién llamar.
 *
 * Para el jugador los dos son idénticos: la hora simplemente no está.
 */
export async function crearBloqueo(
  canchaId,
  { fecha, horaInicio, horaFin, motivo, tipo = 'cerrado', contactoNombre, contactoTelefono } = {}
) {
  if (!isSupabaseConfigured) return DEMO;
  if (!canchaId) return { data: null, error: { message: 'Falta la cancha' } };
  const { data, error } = await supabase.rpc('admin_crear_bloqueo', {
    p_cancha_id: canchaId,
    p_fecha: fecha ?? null,
    p_hora_inicio: horaInicio ?? null,
    p_hora_fin: horaFin ?? null,
    p_motivo: motivo ?? null,
    p_tipo: tipo ?? 'cerrado',
    p_contacto_nombre: contactoNombre ?? null,
    p_contacto_telefono: contactoTelefono ?? null,
  });
  return comoResultadoRecinto(data, error, 'crearBloqueo');
}

export async function eliminarBloqueo(bloqueoId) {
  if (!isSupabaseConfigured) return DEMO;
  if (!bloqueoId) return { data: null, error: { message: 'Falta el bloqueo' } };
  const { data, error } = await supabase.rpc('admin_eliminar_bloqueo', { p_bloqueo_id: bloqueoId });
  return comoResultadoRecinto(data, error, 'eliminarBloqueo');
}

/* ── Cancelar, y qué queda vendido ─────────────────────────────── */

/**
 * Cancela una reserva del recinto. Es la acción más cara de toda la
 * administración y el servidor la trata como tal.
 *
 * El `motivo` es OBLIGATORIO y tiene que decir algo: el servidor rechaza menos
 * de diez caracteres, porque es lo único que el jugador va a saber y lo lee
 * tal cual. No lo rellenes con un texto por defecto desde la interfaz — que la
 * persona lo escriba.
 *
 * Devuelve `{ devuelto }` con el total que volvió a los balances. La
 * devolución va a CADA persona que puso plata, no al organizador: en un pago
 * dividido entre diez, los ocho que ya pagaron reciben lo suyo. Y no se cobra
 * comisión.
 *
 * Se puede cancelar también una reserva sin confirmar, y hay que poder: en el
 * pago dividido cada parte se cobra al aceptar unirse, así que un grupo a medio
 * armar ya tiene plata puesta.
 *
 * No se puede cancelar un partido que ya empezó. El corte lo hace el servidor
 * en hora de Chile, no en UTC.
 */
export async function cancelarReserva(reservaId, motivo) {
  if (!isSupabaseConfigured) return DEMO;
  if (!reservaId) return { data: null, error: { message: 'Falta la reserva' } };
  const { data, error } = await supabase.rpc('admin_cancelar_reserva', {
    p_reserva_id: reservaId,
    p_motivo: motivo ?? null,
  });
  return comoResultadoRecinto(data, error, 'cancelarReserva');
}

/**
 * Las reservas confirmadas que le quedan por jugar al recinto completo, de
 * todas las fechas y todas las canchas.
 *
 * Es lo que necesita la hoja de despublicar: antes de apagar el recinto, el
 * dueño tiene que ver QUÉ le queda vendido, no solo cuántas.
 *
 * OJO con `total`: cuenta TODAS las que quedan, no las que trae la lista. Si
 * hay doce y pides diez, `total` dice 12 y `reservas` trae 10 — mostrá el
 * `total` en el texto y la lista como muestra, nunca `reservas.length`.
 */
export async function reservasProximas(complejoId, limite = 20) {
  if (!isSupabaseConfigured) return DEMO;
  if (!complejoId) return { data: null, error: { message: 'Falta el recinto' } };
  const { data, error } = await supabase.rpc('admin_reservas_proximas', {
    p_complejo_id: complejoId,
    p_limite: limite,
  });
  return comoResultadoRecinto(data, error, 'reservasProximas');
}

/**
 * Corrige un bloqueo ya creado. Un campo en `null` significa no cambiarlo,
 * salvo `motivo`: ahí una cadena vacía sí lo borra, porque el motivo es
 * opcional.
 *
 * Rechaza mover el bloqueo encima de una reserva confirmada, igual que al
 * crearlo.
 */
export async function actualizarBloqueo(
  bloqueoId,
  { fecha, horaInicio, horaFin, motivo, tipo, contactoNombre, contactoTelefono } = {}
) {
  if (!isSupabaseConfigured) return DEMO;
  if (!bloqueoId) return { data: null, error: { message: 'Falta el bloqueo' } };
  const { data, error } = await supabase.rpc('admin_actualizar_bloqueo', {
    p_bloqueo_id: bloqueoId,
    p_fecha: fecha ?? null,
    p_hora_inicio: horaInicio ?? null,
    p_hora_fin: horaFin ?? null,
    p_motivo: motivo ?? null,
    p_tipo: tipo ?? null,
    p_contacto_nombre: contactoNombre ?? null,
    p_contacto_telefono: contactoTelefono ?? null,
  });
  return comoResultadoRecinto(data, error, 'actualizarBloqueo');
}

/* ── Cobros adicionales ────────────────────────────────────────── */

/**
 * Crea un cobro adicional del recinto: balón, petos, árbitro, botiquín.
 *
 * SIEMPRE OPCIONALES para el jugador — no hay forma de marcarlos obligatorios,
 * y no la habrá: un recinto no puede convertirlos en un peaje para reservar.
 *
 * Son del partido completo, no por persona: se cobran una vez por reserva.
 *
 * Hay un tope de 8 ACTIVOS por recinto. Los apagados no cuentan, así que el
 * recinto puede tener un historial largo sin chocar con el límite. El tope
 * existe porque con más, la pantalla donde el jugador los elige se vuelve un
 * catálogo y baja la conversión de la reserva.
 *
 * OJO CON LA COMISIÓN: se calcula sobre el total de la reserva, cancha +
 * adicionales. Una hora de $14.000 con un árbitro de $12.000 paga comisión
 * sobre $26.000, no sobre $14.000. Si la pantalla muestra la comisión de una
 * tarifa, tiene que decir que es sin adicionales.
 */
export async function crearCobro(complejoId, { nombre, precio } = {}) {
  if (!isSupabaseConfigured) return DEMO;
  if (!complejoId) return { data: null, error: { message: 'Falta el recinto' } };
  const { data, error } = await supabase.rpc('admin_crear_cobro', {
    p_complejo_id: complejoId,
    p_nombre: nombre ?? null,
    p_precio: precio ?? null,
  });
  return comoResultadoRecinto(data, error, 'crearCobro');
}

/**
 * Edita un cobro. No hay borrado: `activo: false` lo apaga.
 *
 * Apagar NO lo saca del historial — las reservas que ya lo incluyen lo siguen
 * mostrando, con el precio que tenían ese día. Y cambiar el precio tampoco
 * toca las reservas ya hechas: el nombre y el precio quedan congelados en cada
 * reserva al momento de reservar.
 *
 * Encenderlo cuenta contra el tope de 8 activos.
 */
export async function actualizarCobro(cobroId, { nombre, precio, activo } = {}) {
  if (!isSupabaseConfigured) return DEMO;
  if (!cobroId) return { data: null, error: { message: 'Falta el cobro' } };
  const { data, error } = await supabase.rpc('admin_actualizar_cobro', {
    p_cobro_id: cobroId,
    p_nombre: nombre ?? null,
    p_precio: precio ?? null,
    p_activo: activo ?? null,
  });
  return comoResultadoRecinto(data, error, 'actualizarCobro');
}

/**
 * Los cobros de un recinto. Como `complejo_cobros` sí tiene lectura directa
 * —a diferencia de las reservas— esto es una consulta normal y no una RPC.
 *
 * Quien administra el recinto recibe TODOS, incluidos los apagados, para poder
 * volver a encenderlos. Un jugador recibe solo los activos, y solo si el
 * recinto está publicado.
 */
export async function cobrosDelRecinto(complejoId) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  if (!complejoId) return { data: null, error: { message: 'Falta el recinto' } };
  const { data, error } = await supabase
    .from('complejo_cobros')
    .select('id, nombre, precio, activo')
    .eq('complejo_id', complejoId)
    .order('nombre');
  return comoListaRecinto(data, error, 'cobrosDelRecinto');
}

/* ── Publicar el recinto ───────────────────────────────────────── */

/**
 * Publica o despublica el recinto.
 *
 * No publicado: no aparece en el buscador, sus canchas tampoco, y nadie puede
 * reservar. Pero **las reservas ya confirmadas se respetan** — despublicar es
 * dejar de recibir, no cancelar. Mostrá eso en la confirmación, junto con
 * `reservasProximas()`, que es el dato con el que el dueño decide.
 *
 * Para publicar hace falta al menos una cancha activa con horario cargado; si
 * no, el servidor lo rechaza con el mensaje que hay que mostrar tal cual.
 */
export async function publicarRecinto(complejoId, publicado) {
  if (!isSupabaseConfigured) return DEMO;
  if (!complejoId) return { data: null, error: { message: 'Falta el recinto' } };
  const { data, error } = await supabase.rpc('admin_publicar_complejo', {
    p_complejo_id: complejoId,
    p_publicado: !!publicado,
  });
  return comoResultadoRecinto(data, error, 'publicarRecinto');
}

/* ── Tarifas por horario ───────────────────────────────────────── */

/**
 * Crea o corrige una tarifa por franja horaria.
 *
 * `diaSemana` en `null` significa TODOS los días, y es el caso habitual; con un
 * número (0 = domingo) la tarifa aplica solo a ese día y **gana** sobre la de
 * todos los días. Así "toda la semana barato hasta las 16:00, pero el sábado
 * todo el día caro" son dos tarifas y no siete.
 *
 * El rango es SEMIABIERTO en la hora de inicio: de 11:00 a 16:00 cubre los
 * bloques que empiezan 11, 12, 13, 14 y 15. El de las 16:00 ya es de la
 * siguiente. Usá `bloquesDeTarifa()` de `utils/recintoAgenda` para mostrarlo.
 *
 * El servidor rechaza tarifas que se cruzan DENTRO del mismo alcance, pero
 * permite que una de un día se cruce con una de todos los días: eso no es un
 * choque, es sobrescribir.
 */
export async function guardarTarifa(canchaId, { horaDesde, horaHasta, precio, diaSemana, tarifaId } = {}) {
  if (!isSupabaseConfigured) return DEMO;
  if (!canchaId) return { data: null, error: { message: 'Falta la cancha' } };
  const { data, error } = await supabase.rpc('admin_upsert_tarifa', {
    p_cancha_id: canchaId,
    p_hora_desde: horaDesde ?? null,
    p_hora_hasta: horaHasta ?? null,
    p_precio: precio ?? null,
    p_dia_semana: diaSemana ?? null,
    p_tarifa_id: tarifaId ?? null,
  });
  return comoResultadoRecinto(data, error, 'guardarTarifa');
}

/**
 * Borra una tarifa. La cancha no queda sin precio: cae en su precio base, que
 * es obligatorio.
 */
export async function eliminarTarifa(tarifaId) {
  if (!isSupabaseConfigured) return DEMO;
  if (!tarifaId) return { data: null, error: { message: 'Falta la tarifa' } };
  const { data, error } = await supabase.rpc('admin_eliminar_tarifa', { p_tarifa_id: tarifaId });
  return comoResultadoRecinto(data, error, 'eliminarTarifa');
}

/* ── Administradores (solo el dueño) ───────────────────────────── */

/**
 * Quiénes administran el recinto, con su `@usuario`.
 *
 * `complejo_admins_select` ya deja leer estas filas a quien administra el
 * complejo, y `profiles` es de lectura pública, así que el embed alcanza sin
 * una RPC nueva.
 */
export async function administradoresDelRecinto(complejoId) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  if (!complejoId) return { data: null, error: { message: 'Falta el recinto' } };
  const { data, error } = await supabase
    .from('complejo_admins')
    .select('id, user_id, rol, created_at, profiles!inner(username, foto_url, created_at)')
    .eq('complejo_id', complejoId)
    .order('created_at');
  if (error) {
    console.error('[FutFinder] administradoresDelRecinto:', error);
    return { data: null, error: { message: error.message || 'No se pudo cargar la lista.' } };
  }
  const filas = (data || []).map((f) => ({
    id: f.id,
    userId: f.user_id,
    rol: f.rol,
    username: f.profiles?.username || null,
    fotoUrl: f.profiles?.foto_url || null,
    enFutfinderDesde: f.profiles?.created_at || null,
  }));
  // Los dueños primero: sus filas no traen acción y conviene verlas arriba.
  // No se ordena en Postgres porque `order by rol` compara texto y deja
  // 'admin' antes que 'dueño'.
  filas.sort((a, b) => (a.rol === b.rol ? 0 : a.rol === 'dueño' ? -1 : 1));
  return { data: filas, error: null };
}

/**
 * Busca a alguien por su `@usuario` exacto, para poder agregarlo (artboard 1s).
 *
 * SOLO SE AGREGA A QUIEN YA TIENE CUENTA, y no hay creación de cuentas desde
 * acá: crear una cuenta a nombre de otra persona, sin que esa persona la
 * pida, es justamente lo que no corresponde. Si es alguien del equipo del
 * recinto, se registra y pasa su usuario.
 *
 * Coincidencia EXACTA y no parcial: esto sirve para confirmar un usuario que
 * la persona ya te dio, no para explorar quién existe en FutFinder.
 */
export async function buscarUsuarioPorUsername(username) {
  if (!isSupabaseConfigured) return { data: null, error: null };
  const u = String(username || '').trim().replace(/^@/, '');
  if (u.length < 2) return { data: null, error: null };
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, foto_url, created_at')
    .ilike('username', u)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[FutFinder] buscarUsuarioPorUsername:', error);
    return { data: null, error: { message: error.message || 'No se pudo buscar.' } };
  }
  return { data: data || null, error: null };
}


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

/**
 * Pone o quita la foto de una cancha (migración 80).
 *
 * `null` la QUITA. Es al revés que en la ficha del recinto, donde un `null`
 * significa «no cambiar»: acá la función hace una sola cosa, así que llamarla
 * ya es decir que quieres cambiar la foto.
 */
export async function actualizarFotoCancha(canchaId, url) {
  if (!isSupabaseConfigured) return DEMO;
  if (!canchaId) return { data: null, error: { message: 'Falta la cancha' } };
  const { data, error } = await supabase.rpc('admin_actualizar_foto_cancha', {
    p_cancha_id: canchaId,
    p_foto_url: url ?? null,
  });
  return comoResultadoRecinto(data, error, 'actualizarFotoCancha');
}
