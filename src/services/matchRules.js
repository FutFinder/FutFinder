/**
 * Reglas centralizadas del módulo Partidos.
 *
 * Toda la UI (listado, detalle, wizard, gestión, asistencia) lee de aquí:
 * ningún componente vuelve a escribir un umbral de tiempo, una penalización
 * ni un límite de cupos por su cuenta.
 *
 * IMPORTANTE — estos valores reflejan las reglas REALES del backend, no la
 * maqueta:
 *   · La maqueta dice «sin sanción hasta 1 h 30 antes». El backend usa una
 *     ventana de 2 horas (`leave_match_penalized` / `cancel_match`), así que
 *     mandamos 2 h y lo escribimos así en los textos.
 *   · La maqueta dice «las cuentas nuevas parten en 50». En este backend
 *     `profiles.trust_score` nace en 100 (ver `supabase/schema.sql`).
 * Si alguna de las dos reglas cambia en Postgres, se cambia acá y la app
 * completa queda alineada.
 */

/**
 * Umbral de anticipación y castigos de Trust Score.
 *
 * `freeHours` NO significa que salirse sea gratis: es la frontera entre la
 * sanción leve y la grave, y así lo cobra `leave_match_penalized` en Postgres
 * (3 puntos con más de 2 h de anticipación, 20 después). El texto del CTA
 * prometía «sin sanción» y después se descontaban 3: prometer de menos y
 * cobrar es peor que advertir de más.
 */
export const PENALTY = {
  /** Horas antes del partido que separan la sanción leve de la grave. */
  freeHours: 2,
  /** Puntos que pierde un jugador al salirse. */
  leaveEarly: 3,
  leaveLate: 20,
  /** Puntos que pierde el organizador al cancelar. */
  cancelEarly: 15,
  cancelLate: 25,
};

/** Límites de cupos que acepta la tabla `matches`. */
export const CUPOS = { min: 1, max: 30 };

/** Duraciones ofrecidas al publicar (minutos). */
export const DURACIONES = [60, 90, 120];

/** Niveles del partido. */
export const NIVELES = [
  { value: 'recreativo', label: 'Recreativo', desc: 'Se juega para pasarlo bien' },
  { value: 'intermedio', label: 'Intermedio', desc: 'Experiencia habitual jugando' },
  { value: 'competitivo', label: 'Competitivo', desc: 'Exigencia alta, ritmo sostenido' },
];

/** Modalidades soportadas. */
export const MODALIDADES = [
  { value: 'futbol7', label: 'Fútbol 7' },
  { value: 'futbol11', label: 'Fútbol 11' },
];

/** Opciones de Trust Score mínimo. */
export const TRUST_OPTS = [
  { value: 0, label: 'Sin mínimo', desc: 'Cualquier jugador puede unirse' },
  { value: 50, label: '50 o más', desc: 'Filtra cuentas con historial de faltas' },
  { value: 70, label: '70 o más', desc: 'Solo jugadores con buen historial' },
  { value: 85, label: '85 o más', desc: 'Muy exigente, pocos jugadores calificarán' },
];

/** Presets de rango de edad. `null` = sin restricción. */
export const EDAD_PRESETS = [
  { label: 'Sin restricción', min: null, max: null },
  { label: '18 a 25', min: 18, max: 25 },
  { label: '18 a 35', min: 18, max: 35 },
  { label: '25 a 45', min: 25, max: 45 },
  { label: '35 o más', min: 35, max: 99 },
];

/** Distancias del filtro de ubicación. */
export const DIST_OPTS = [
  { label: '2 km', value: 2 },
  { label: '5 km', value: 5 },
  { label: '10 km', value: 10 },
  { label: 'Cualquiera', value: null },
];

/** Minutos que tiene quien está en lista de espera para confirmar su cupo. */
export const WAITLIST_CONFIRM_MINUTES = 30;

/** Radio en metros que valida `confirm_attendance_gps`. */
export const GPS_RADIUS_METERS = 200;

/**
 * La ventana en que el servidor acepta confirmar por GPS: desde 30 minutos
 * antes de la hora hasta 30 minutos después del término calculado
 * (`confirm_attendance_gps`). Las pantallas ofrecían el botón solo DURANTE el
 * partido, así que a 15 minutos del inicio —cuando la gente va llegando a la
 * cancha, que es el momento de confirmar— no había nada que tocar.
 */
export const GPS_WINDOW_MIN = { antes: 30, despues: 30 };

/** Horas después del partido en que el organizador aún puede guardar asistencia. */
export const ATTENDANCE_WINDOW_HOURS = 72;

/** Largo máximo de la descripción. */
export const DESC_MAX = 500;

/** Estados de partido que ya no aceptan inscripciones. */
export const CLOSED_STATES = ['en_curso', 'finalizado', 'cancelado'];

// ---------------------------------------------------------------- helpers

/** ¿Falta más que la ventana sin penalización para que empiece el partido? */
export function isPenaltyFree(hora) {
  if (!hora) return true;
  return new Date(hora).getTime() - Date.now() > PENALTY.freeHours * 3600 * 1000;
}

/** Puntos que costaría salirse ahora mismo. */
export function leavePenaltyFor(hora) {
  return isPenaltyFree(hora) ? PENALTY.leaveEarly : PENALTY.leaveLate;
}

/** Puntos que costaría cancelar ahora mismo (organizador). */
export function cancelPenaltyFor(hora) {
  return isPenaltyFree(hora) ? PENALTY.cancelEarly : PENALTY.cancelLate;
}

/**
 * La ventana del filtro «Fin de semana», desde un reloj que se puede fijar.
 *
 * EL FALLO: el cálculo buscaba siempre el PRÓXIMO sábado. Un domingo a
 * mediodía eso apuntaba al sábado de la semana siguiente, así que el partido
 * de esa misma tarde —el fin de semana en el que está parado el usuario—
 * quedaba fuera y aparecían los de dentro de seis días.
 *
 * Si hoy es sábado o domingo, el fin de semana es este: empieza AHORA (no a
 * medianoche, para no ofrecer partidos que ya empezaron) y termina el lunes a
 * las 00:00. El resto de la semana apunta al sábado que viene.
 */
export function ventanaDeFinDeSemana(ahora = new Date()) {
  const dia = ahora.getDay(); // 0 = domingo, 6 = sábado
  const medianoche = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const enCurso = dia === 6 || dia === 0;

  const desde = enCurso ? new Date(ahora) : new Date(medianoche);
  if (!enCurso) desde.setDate(desde.getDate() + ((6 - dia + 7) % 7));

  // El lunes a las 00:00 cierra siempre: dos días si arrancamos el sábado.
  const hasta = new Date(medianoche);
  hasta.setDate(hasta.getDate() + (dia === 0 ? 1 : (6 - dia + 7) % 7 + 2));

  return { desde, hasta };
}

/**
 * La ventana de tiempo de un filtro de fecha: `{ desde, hasta }`.
 *
 * Es la MISMA definición para la consulta y para el filtro en memoria. Cuando
 * cada uno calculaba lo suyo, «Fin de semana» significaba una cosa en la base
 * y otra en la pantalla. `hasta` es `null` cuando la ventana no cierra.
 */
export function rangoDeFecha(ventana, ahora = new Date()) {
  const medianoche = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const manana = new Date(medianoche);
  manana.setDate(manana.getDate() + 1);

  if (ventana === 'hoy') {
    return { desde: new Date(ahora), hasta: manana };
  }
  if (ventana === 'manana') {
    const pasado = new Date(manana);
    pasado.setDate(pasado.getDate() + 1);
    return { desde: manana, hasta: pasado };
  }
  if (ventana === 'finde') return ventanaDeFinDeSemana(ahora);
  return { desde: null, hasta: null };
}

/** Texto humano de cuánto falta: «1 h 20», «3 días», «ya empezó». */
export function timeUntilLabel(hora) {
  if (!hora) return '';
  const ms = new Date(hora).getTime() - Date.now();
  if (ms <= 0) return 'ya empezó';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  if (h < 24) return rest ? `${h} h ${rest}` : `${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 día' : `${d} días`;
}

/** Frase reutilizable sobre la penalización por salir. */
export function leaveRuleText(hora) {
  const free = isPenaltyFree(hora);
  return free
    ? `Salir ahora resta ${PENALTY.leaveEarly} puntos de Trust Score. Desde ${PENALTY.freeHours} h antes del partido son ${PENALTY.leaveLate}.`
    : `Falta menos de ${PENALTY.freeHours} h: salir ahora resta ${PENALTY.leaveLate} puntos de Trust Score.`;
}

/**
 * El turno vigente de quien espera en la cola, o `null`.
 *
 * El servidor avisa al primero de la lista y le guarda el cupo por unos
 * minutos (`match_waitlist.confirmar_antes_de`, migración 105). La pantalla
 * solo mostraba «En lista de espera · N° 1» y «Salir de la lista»: el jugador
 * recibía el aviso y no tenía dónde tomar el cupo que ya era suyo.
 */
export function turnoDeLaLista(entrada, ahora = new Date()) {
  const hasta = entrada?.confirmar_antes_de;
  if (!hasta) return null;
  const restanMs = new Date(hasta).getTime() - ahora.getTime();
  if (!(restanMs > 0)) return null;
  return { hasta: new Date(hasta), minutos: Math.max(1, Math.ceil(restanMs / 60000)) };
}

/**
 * ¿Este partido acepta a cualquiera? (no pide Trust Score mínimo)
 *
 * Es la regla del filtro «Sin mínimo» del buscador y la del contador que
 * ofrece el detalle cuando a alguien lo deja fuera el mínimo del organizador.
 */
export function aceptaACualquiera(match) {
  return Number(match?.min_trust_score || 0) === 0;
}

/**
 * Ventana de confirmación por GPS de un partido: `{ desde, hasta }`.
 * Devuelve `null` si el partido no tiene hora.
 */
export function ventanaGps(match) {
  if (!match?.hora) return null;
  const inicio = new Date(match.hora).getTime();
  const fin = inicio + (match.duracion_min ?? 90) * 60 * 1000;
  return {
    desde: new Date(inicio - GPS_WINDOW_MIN.antes * 60 * 1000),
    hasta: new Date(fin + GPS_WINDOW_MIN.despues * 60 * 1000),
  };
}

/** ¿Estamos dentro de la ventana en que el servidor acepta el GPS? */
export function enVentanaGps(match, ahora = new Date()) {
  const v = ventanaGps(match);
  if (!v) return false;
  const t = ahora.getTime();
  return t >= v.desde.getTime() && t <= v.hasta.getTime();
}

/**
 * ¿El partido ya terminó (hora + duración)?
 *
 * `ahora` se puede fijar: las pantallas que se quedan abiertas mueven su
 * propio reloj, y así la regla se puede probar sin esperar.
 */
export function hasFinished(match, ahora = new Date()) {
  if (!match?.hora) return false;
  const end =
    new Date(match.hora).getTime() + (match.duracion_min ?? 90) * 60 * 1000;
  return ahora.getTime() >= end;
}

/** ¿El partido ya empezó? */
export function hasStarted(match, ahora = new Date()) {
  if (!match?.hora) return false;
  return ahora.getTime() >= new Date(match.hora).getTime();
}

/** ¿El organizador todavía puede registrar asistencia? */
export function attendanceOpen(match) {
  if (!hasFinished(match)) return false;
  const end =
    new Date(match.hora).getTime() + (match.duracion_min ?? 90) * 60 * 1000;
  return Date.now() <= end + ATTENDANCE_WINDOW_HOURS * 3600 * 1000;
}

/** Etiqueta del rango de edad de un partido. */
export function edadLabel(match) {
  const min = match?.edad_min ?? null;
  const max = match?.edad_max ?? null;
  if (min == null && max == null) return 'Sin restricción';
  if (min != null && max != null) return `${min} a ${max} años`;
  if (min != null) return `${min} años o más`;
  return `Hasta ${max} años`;
}

/** Etiqueta del Trust Score mínimo. */
export function trustLabel(match) {
  const t = match?.min_trust_score ?? 0;
  return t > 0 ? `${t}+` : 'Sin mínimo';
}

/** Etiqueta de modalidad, tolerando partidos antiguos sin el campo. */
export function modalidadLabel(match) {
  const m = match?.modalidad;
  if (m === 'futbol7') return 'Fútbol 7';
  if (m === 'futbol11') return 'Fútbol 11';
  return null;
}

/** Etiqueta de nivel. */
export function nivelLabel(nivel) {
  return NIVELES.find((n) => n.value === nivel)?.label || nivel || '';
}

/** «Gratis» o «$5.000». */
export function cuotaLabel(precio) {
  const p = Number(precio || 0);
  return p === 0 ? 'Gratis' : `$${p.toLocaleString('es-CL')}`;
}

/** Etiqueta de estado del partido. */
export function estadoLabel(match) {
  switch (match?.estado) {
    case 'cancelado':
      return { label: 'Cancelado', tone: 'danger' };
    case 'finalizado':
      return { label: 'Finalizado', tone: 'muted' };
    case 'en_curso':
      return { label: 'En curso', tone: 'gold' };
    case 'lleno':
      return { label: 'Completo', tone: 'muted' };
    default:
      if ((match?.cupos_disponibles ?? 0) <= 0) {
        return { label: 'Completo', tone: 'muted' };
      }
      return { label: 'Abierto', tone: 'green' };
  }
}

// ------------------------------------------------------- bloqueos y CTA

/**
 * Única fuente de verdad de por qué un jugador NO puede pedir cupo.
 *
 * Devuelve `null` si puede, o `{ code, title, detail, actions }`.
 * Nunca inventa un motivo: si falta el dato (por ejemplo la edad del perfil)
 * no bloquea, y deja que el backend responda.
 *
 * ctx:
 *   match, myId, myProfile, myAttendee, myWaitlist, conflict, online
 */
export function getBlockReason(ctx) {
  const { match, myId, myProfile, myAttendee, conflict, online, ahora } = ctx || {};
  if (!match) return null;
  const reloj = ahora || new Date();

  if (online === false) {
    return {
      code: 'offline',
      title: 'Sin conexión',
      detail:
        'Necesitas conexión para pedir un cupo. Estás viendo la última versión guardada de este partido.',
    };
  }

  if (match.estado === 'cancelado') {
    return {
      code: 'cancelado',
      title: 'Este partido fue cancelado',
      detail: match.motivo_cancelacion
        ? `Motivo del organizador: ${match.motivo_cancelacion}`
        : 'El organizador lo canceló y ya no acepta jugadores.',
    };
  }
  if (match.estado === 'finalizado' || hasFinished(match, reloj)) {
    return {
      code: 'finalizado',
      title: 'Este partido ya terminó',
      detail: 'Busca otro partido abierto cerca de ti.',
    };
  }
  if (match.estado === 'en_curso' || hasStarted(match, reloj)) {
    return {
      code: 'en_curso',
      title: 'Este partido ya comenzó',
      detail: 'No se aceptan jugadores una vez que empieza.',
    };
  }

  if (myProfile?.suspended) {
    return {
      code: 'restringido',
      title: 'Tu cuenta tiene una restricción activa',
      detail: myProfile.suspended_until
        ? `Podrás volver a unirte el ${new Date(
            myProfile.suspended_until
          ).toLocaleDateString('es-CL', { day: '2-digit', month: 'long' })}.`
        : 'Tu Trust Score llegó a 0 y no puedes unirte a partidos por ahora.',
      actions: ['verMotivo'],
    };
  }

  if (myId && match.id_organizador === myId) {
    return {
      code: 'organizador',
      title: 'Organizas este partido',
      detail: 'Desde la gestión puedes revisar solicitudes y el plantel.',
    };
  }

  if (myAttendee && myAttendee.estado !== 'pendiente' && myAttendee.estado !== 'cancelado') {
    return {
      code: 'ya_confirmado',
      title: 'Ya estás confirmado en este partido',
      detail: 'Revisa tu cupo para ver la cancha, la cuota y el chat.',
    };
  }

  if (myAttendee?.estado === 'pendiente') {
    return {
      code: 'solicitud_existente',
      title: 'Ya tienes una solicitud enviada',
      detail: 'El organizador la está revisando. Te avisamos cuando responda.',
      actions: ['verEstado'],
    };
  }

  const minTrust = match.min_trust_score ?? 0;
  const myTrust = myProfile?.trust_score;
  if (minTrust > 0 && typeof myTrust === 'number' && myTrust < minTrust) {
    return {
      code: 'trust_bajo',
      title: 'No cumples el Trust Score mínimo',
      detail: `Este partido pide ${minTrust} o más y tu Trust Score actual es ${myTrust}.`,
      trust: { actual: myTrust, requerido: minTrust },
      actions: ['verSinMinimo', 'publicar', 'buscarOtros'],
    };
  }

  const edad = myProfile?.edad ?? null;
  const eMin = match.edad_min ?? null;
  const eMax = match.edad_max ?? null;
  if (edad != null && ((eMin != null && edad < eMin) || (eMax != null && edad > eMax))) {
    return {
      code: 'edad',
      title: 'Tu edad está fuera del rango',
      detail: `El organizador pide jugadores de ${edadLabel(match).toLowerCase()} y tu perfil dice ${edad} años.`,
      actions: ['buscarOtros'],
    };
  }

  if (conflict?.conflict) {
    return {
      code: 'choque_horario',
      title: 'Ya tienes un partido a esta hora',
      detail: `Estás inscrito en «${conflict.titulo}». Puedes cambiarte, pero no estar en los dos.`,
      soft: true, // no bloquea el CTA: ofrece el swap
      conflict,
    };
  }

  return null;
}

/**
 * Quién puede leer y escribir en el chat de un partido.
 *
 * EL FALLO: la pantalla solo miraba si existía una fila en `attendees`, así
 * que un solicitante PENDIENTE —cuyo cupo no está confirmado— encontraba el
 * compositor habilitado, y en un partido cancelado, que el flujo promete en
 * solo lectura, también. La RLS protege el servidor; esto evita ofrecer lo
 * que la base va a rechazar y explica por qué.
 *
 * `inscripcion` es la fila de `attendees` de esta persona (o `null`).
 * Devuelve `{ canRead, canWrite, reason, title, message }`.
 */
export function accesoAlChatDelPartido(inscripcion, partido) {
  if (!inscripcion || inscripcion.estado === 'cancelado') {
    return {
      canRead: false,
      canWrite: false,
      reason: 'not_attendee',
      title: 'No estás inscrito en este partido',
      message: 'El chat es solo para el organizador y los jugadores inscritos.',
    };
  }
  if (inscripcion.estado === 'pendiente') {
    return {
      canRead: false,
      canWrite: false,
      reason: 'solicitud_pendiente',
      title: 'Tu solicitud todavía está pendiente',
      message: 'El chat del partido se abre cuando el organizador confirme tu cupo.',
    };
  }
  if (partido?.estado === 'cancelado') {
    return {
      canRead: true,
      canWrite: false,
      reason: 'partido_cancelado',
      title: 'El partido se canceló',
      message: 'La conversación queda en solo lectura.',
    };
  }
  return { canRead: true, canWrite: true, reason: null, title: null, message: null };
}

/**
 * Qué mostrar en «Mi cupo» (`MatchSpotScreen`), derivado del estado real.
 *
 * EL FALLO: la pantalla se abría por URL y saludaba con «Cupo confirmado»,
 * «Estás en la lista» y «Salir del partido» a cualquiera, tuviera cupo o no;
 * y en un partido cancelado mostraba el aviso de cancelación y el «Cupo
 * confirmado» al mismo tiempo. Acá el estado del partido manda sobre el del
 * jugador, y no tener cupo es un estado con nombre propio.
 *
 * Devuelve `{ code, titulo, texto, puedeSalir, puedeConfirmarGps, puedeChat }`
 * con `code`: 'sin_cupo' | 'pendiente' | 'cancelado' | 'finalizado' | 'confirmado'.
 */
export function estadoDeMiCupo({ match, mine, ahora = new Date() } = {}) {
  if (!match) return null;

  const cancelado = match.estado === 'cancelado';
  const terminado = match.estado === 'finalizado' || hasFinished(match, ahora);

  if (!mine || mine.estado === 'cancelado') {
    return {
      code: 'sin_cupo',
      titulo: 'No tienes cupo en este partido',
      texto: cancelado
        ? 'Además, el organizador lo canceló.'
        : 'Puede que hayas salido o que nunca te inscribieras. Entra al partido para pedir tu cupo.',
      puedeSalir: false,
      puedeConfirmarGps: false,
      puedeChat: false,
    };
  }

  if (mine.estado === 'pendiente') {
    return {
      code: 'pendiente',
      titulo: 'Tu solicitud está pendiente',
      texto: 'El organizador todavía no responde. Tu cupo no está reservado.',
      puedeSalir: false,
      puedeConfirmarGps: false,
      puedeChat: false,
    };
  }

  if (cancelado) {
    return {
      code: 'cancelado',
      titulo: 'El partido se canceló',
      texto: match.motivo_cancelacion
        ? `Motivo del organizador: ${match.motivo_cancelacion}`
        : 'Ya no se juega. El chat quedó en solo lectura.',
      puedeSalir: false,
      puedeConfirmarGps: false,
      puedeChat: true,
    };
  }

  if (mine.estado === 'no_asistio') {
    return {
      code: 'finalizado',
      titulo: 'Quedaste como ausente',
      texto: 'El organizador registró que no llegaste a este partido.',
      puedeSalir: false,
      puedeConfirmarGps: false,
      puedeChat: true,
    };
  }

  if (terminado) {
    return {
      code: 'finalizado',
      titulo: 'Partido jugado',
      texto: 'Este partido ya terminó. El organizador registrará la asistencia.',
      puedeSalir: false,
      // La ventana sigue abierta media hora después del término: quien llegó y
      // jugó todavía alcanza a confirmar.
      puedeConfirmarGps: mine.estado === 'inscrito' && enVentanaGps(match, ahora),
      puedeChat: true,
    };
  }

  return {
    code: 'confirmado',
    titulo: 'Cupo confirmado',
    texto:
      match.recordatorio_1h !== false
        ? 'Estás en la lista. Te recordamos el partido una hora antes.'
        : 'Estás en la lista. Anota la hora: este partido no envía recordatorio.',
    puedeSalir: true,
    puedeConfirmarGps: mine.estado === 'inscrito' && enVentanaGps(match, ahora),
    puedeChat: true,
  };
}

/**
 * Estado del CTA sticky del detalle, derivado del estado real.
 *
 * Devuelve `{ kind, label, hint, tone }` donde `kind` es:
 *   'gestionar' | 'unirme' | 'solicitar' | 'espera' | 'en_espera'
 *   | 'tomar_cupo' | 'pendiente' | 'confirmado' | 'bloqueado'
 *
 * `ctx.ahora` permite fijar el reloj: la pantalla lo va moviendo para que el
 * turno de la lista de espera se apague solo, sin recargar.
 */
export function getCtaState(ctx) {
  const { match, myId, myAttendee, myWaitlist, online, ahora } = ctx || {};
  if (!match) return { kind: 'bloqueado', label: 'Partido no disponible', tone: 'muted' };

  const isOrganizer = myId && match.id_organizador === myId;
  if (isOrganizer) {
    return {
      kind: 'gestionar',
      label: 'Gestionar partido',
      tone: 'primary',
      disabled: online === false,
    };
  }

  const block = getBlockReason(ctx);

  // Un partido caído o terminado manda sobre cualquier otra cosa: se mostraba
  // «Cupo confirmado» junto al aviso de cancelación, y el jugador se quedaba
  // sin saber cuál de las dos era la verdad.
  if (block && (block.code === 'cancelado' || block.code === 'finalizado')) {
    return {
      kind: 'bloqueado',
      label: block.title,
      hint: block.detail,
      tone: 'muted',
      block,
    };
  }

  if (myAttendee?.estado === 'pendiente') {
    return {
      kind: 'pendiente',
      label: 'Solicitud pendiente',
      hint: 'El organizador todavía no responde. Tu cupo no está reservado.',
      tone: 'gold',
    };
  }
  if (myAttendee && myAttendee.estado !== 'cancelado') {
    return {
      kind: 'confirmado',
      label: 'Cupo confirmado',
      hint: leaveRuleText(match.hora),
      tone: 'green',
    };
  }
  if (myWaitlist) {
    const turno = turnoDeLaLista(myWaitlist, ahora || new Date());
    if (turno) {
      const manual = match.aprobacion === 'manual';
      return {
        kind: 'tomar_cupo',
        label: manual ? 'Pedir el cupo que se liberó' : 'Tomar mi cupo',
        hint: manual
          ? `El cupo es tuyo por ${turno.minutos} ${turno.minutos === 1 ? 'minuto' : 'minutos'} más, pero este partido lo revisa el organizador: manda tu solicitud ahora.`
          : `Se liberó un cupo y es tuyo por ${turno.minutos} ${turno.minutos === 1 ? 'minuto' : 'minutos'} más. Nadie puede tomarlo hasta entonces.`,
        tone: 'primary',
        turno,
        // Qué acción dispara la pantalla: en un partido de aprobación manual
        // `join_match` rechaza a propósito (migración 103).
        via: manual ? 'solicitar' : 'unirme',
        disabled: online === false,
      };
    }
    return {
      kind: 'en_espera',
      label: `En lista de espera · N° ${myWaitlist.posicion}`,
      hint: `Si se libera un cupo te avisamos y tienes ${WAITLIST_CONFIRM_MINUTES} min para confirmar. Salir de la lista no afecta tu Trust Score.`,
      tone: 'gold',
    };
  }

  if (block && !block.soft) {
    return {
      kind: 'bloqueado',
      label:
        block.code === 'finalizado' || block.code === 'cancelado' || block.code === 'en_curso'
          ? block.title
          : 'No puedes solicitar cupo',
      hint: block.detail,
      tone: 'muted',
      block,
    };
  }

  const full = (match.cupos_disponibles ?? 0) <= 0;
  if (full) {
    return {
      kind: 'espera',
      label: 'Entrar a la lista de espera',
      hint: `Los ${match.cupos_totales} cupos están tomados. Salir de la lista no afecta tu Trust Score.`,
      tone: 'outline',
      block,
      disabled: online === false,
    };
  }

  if (match.aprobacion === 'manual') {
    return {
      kind: 'solicitar',
      label: 'Solicitar cupo',
      hint: 'El organizador revisa cada solicitud antes de confirmar tu cupo.',
      tone: 'primary',
      block,
      disabled: online === false,
    };
  }

  return {
    kind: 'unirme',
    label: 'Unirme al partido',
    hint: `Tu cupo queda confirmado al instante · ${cuotaLabel(match.precio_cuota)} en cancha`,
    tone: 'primary',
    block,
    disabled: online === false,
  };
}

/**
 * Validación campo por campo del borrador de publicación.
 * Devuelve un objeto `{ campo: mensaje }` — vacío si todo está bien.
 *
 * `step` limita la validación a los campos de ese paso (1, 2, 3) o `null`
 * para validar el borrador completo antes de publicar.
 */
export function validateDraft(draft, step = null) {
  const e = {};
  const inStep = (s) => step == null || step === s;

  if (inStep(1)) {
    const cupos = Number(draft.cupos);
    if (!Number.isFinite(cupos) || cupos < CUPOS.min) {
      e.cupos = `Necesitas al menos ${CUPOS.min} cupo para publicar`;
    } else if (cupos > CUPOS.max) {
      e.cupos = `El máximo es ${CUPOS.max} cupos`;
    }

    const cuota = draft.cuota === '' ? 0 : Number(draft.cuota);
    if (!Number.isFinite(cuota) || cuota < 0) {
      e.cuota = 'La cuota no puede ser negativa. Escribe 0 si es gratis.';
    }

    if (!NIVELES.some((n) => n.value === draft.nivel)) {
      e.nivel = 'Elige el nivel del partido';
    }
    if (!DURACIONES.includes(Number(draft.duracion))) {
      e.duracion = 'Elige una duración';
    }
    if (!TRUST_OPTS.some((t) => t.value === Number(draft.minTrust))) {
      e.minTrust = 'Elige un Trust Score mínimo válido';
    }

    const eMin = draft.edadMin == null || draft.edadMin === '' ? null : Number(draft.edadMin);
    const eMax = draft.edadMax == null || draft.edadMax === '' ? null : Number(draft.edadMax);
    if (eMin != null && (!Number.isFinite(eMin) || eMin < 12 || eMin > 99)) {
      e.edad = 'La edad mínima debe estar entre 12 y 99';
    } else if (eMax != null && (!Number.isFinite(eMax) || eMax < 12 || eMax > 99)) {
      e.edad = 'La edad máxima debe estar entre 12 y 99';
    } else if (eMin != null && eMax != null && eMin >= eMax) {
      e.edad = 'La edad mínima debe ser menor que la máxima';
    }

    if ((draft.descripcion || '').length > DESC_MAX) {
      e.descripcion = `La descripción no puede pasar de ${DESC_MAX} caracteres`;
    }
  }

  if (inStep(2)) {
    if (!(draft.titulo || '').trim()) e.titulo = 'Pon un título al partido';
    if (!MODALIDADES.some((m) => m.value === draft.modalidad)) {
      e.modalidad = 'Elige Fútbol 7 o Fútbol 11';
    }
    if (!(draft.cancha || '').trim()) e.cancha = 'Falta el nombre de la cancha';
    if (!(draft.region || '').trim()) e.region = 'Elige una región';
    if (!(draft.comuna || '').trim()) e.comuna = 'Elige una comuna';

    const dt = draft.fecha && draft.hora ? combineDateTime(draft.fecha, draft.hora) : null;
    if (!draft.fecha) e.fecha = 'Elige la fecha del partido';
    else if (!dt) e.fecha = 'La fecha no es válida';
    else {
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const day = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
      if (day < start) e.fecha = 'La fecha ya pasó. Elige hoy o un día futuro.';
    }
    if (!draft.hora) e.hora = 'Elige la hora del partido';
    else if (dt && dt.getTime() <= Date.now()) {
      e.hora = 'La hora ya pasó. Elige una hora futura.';
    }
  }

  if (inStep(3)) {
    if (draft.aprobacion !== 'inmediata' && draft.aprobacion !== 'manual') {
      e.aprobacion = 'Elige cómo entran los jugadores';
    }
  }

  return e;
}

/** Orden en que se hace scroll al primer error. */
export const FIELD_ORDER = [
  'titulo',
  'modalidad',
  'cancha',
  'region',
  'comuna',
  'fecha',
  'hora',
  'cupos',
  'cuota',
  'nivel',
  'duracion',
  'minTrust',
  'edad',
  'descripcion',
  'aprobacion',
];

/**
 * Decide si abrir `PublishMatchScreen` debe partir de un borrador limpio en
 * el paso 1. Es «nueva» toda entrada salvo que traiga un `draftStep` válido
 * (1-3) de un borrador guardado explícito; la ruta antigua con `matchId`
 * redirige a edición y no pasa por el wizard, así que tampoco cuenta.
 */
export function isFreshPublishEntry(routeParams) {
  const p = routeParams || {};
  if (p.matchId) return false;
  const step = p.draftStep;
  const isSavedStep = Number.isInteger(step) && step >= 1 && step <= 3;
  return !isSavedStep;
}

/** Combina `Date` (día) + 'HH:MM' en un `Date` completo. */
export function combineDateTime(fecha, hora) {
  try {
    const d = fecha instanceof Date ? new Date(fecha) : new Date(fecha);
    if (Number.isNaN(d.getTime())) return null;
    const [hh, mi] = String(hora).split(':').map((n) => parseInt(n, 10));
    if (!Number.isFinite(hh) || !Number.isFinite(mi)) return null;
    if (hh > 23 || mi > 59) return null;
    d.setHours(hh, mi, 0, 0);
    return d;
  } catch {
    return null;
  }
}
