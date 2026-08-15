/**
 * Incomparecencia y revisión de sanciones (migración 47c).
 *
 * Un club que no se presenta al partido puede ser informado por el rival
 * DESPUÉS de la hora del encuentro, y eso le deja una sanción provisional de
 * 14 días. Cualquier club afectado por una cancelación o por una sanción puede
 * pedir que la revisen. Este archivo es la parte que puede vivir fuera del
 * servidor: decidir qué botón corresponde, armar los argumentos de las RPC y
 * redactar lo que se lee en el hilo. No toca React, Supabase ni colores.
 *
 * ES UN ESPEJO, NO LA AUTORIDAD, igual que `cancelacionEncuentro.js`.
 * `reportar_incomparecencia` vuelve a comprobar la hora con el `now()` de
 * PostgreSQL, la membresía y el estado del encuentro, y ésa es la que manda.
 * Lo de acá existe para no ofrecer un botón que el servidor va a rechazar y
 * para poder EXPLICAR por qué no está disponible.
 *
 * LO QUE ACÁ NO ESTÁ: resolver la revisión. `resolver_revision_sancion` está
 * revocada de `authenticated` y sólo la puede ejecutar `service_role`, así que
 * no hay ninguna pantalla que llamarla — y no la hay a propósito. Ver
 * `docs/memoria/operacion/pendientes.md`.
 */

import { esFaltaDeEsquema } from './cambioRpc.js';
import { ESTADOS_SANCION_ACTIVOS, fechaLarga } from './cancelacionEncuentro.js';

/** Espejo del CHECK de `club_match_noshow_reports.motivo`. */
export const MOTIVO_INCOMPARECENCIA_MAX = 300;

/**
 * Espejo del CHECK de `club_sanction_reviews.motivo`.
 *
 * Más largo que el de la incomparecencia a propósito: informar es una frase
 * («no llegó nadie»), y pedir una revisión es contar qué pasó de verdad. Un
 * tope corto acá obligaría a resumir justo lo que hay que explicar.
 */
export const MOTIVO_REVISION_MAX = 1000;

/**
 * Columnas de `club_match_noshow_reports` que necesita la interfaz.
 *
 * Vive acá, y no dentro del servicio, por lo mismo que `COLUMNAS_SANCION`: una
 * sola columna que no exista hace que PostgREST rechace la consulta ENTERA con
 * 400 y `42703`, y la pantalla se queda sin saber si ya hay un informe.
 */
export const COLUMNAS_INCOMPARECENCIA =
  'id, challenge_id, match_id, club_reportante_id, club_reportado_id, motivo, sancion_id, created_at';

/**
 * Columnas de `club_sanction_reviews` que necesita la interfaz.
 *
 * `contexto` NO se pide: es el expediente y puede pesar decenas de kilobytes
 * que ninguna pantalla muestra. `resuelta_por` tampoco: quién resolvió es
 * auditoría del servidor.
 */
export const COLUMNAS_REVISION =
  'id, club_id, challenge_id, match_id, sancion_id, tipo, motivo, estado, decision, nota, resuelta_at, created_at';

/** Estados del desafío en los que todavía hay un encuentro al que faltar. */
const ESTADOS_CON_ENCUENTRO = ['publicado', 'en_juego', 'esperando_resultado'];

function aFecha(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

function esTextoConContenido(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function nombreDe(valor, porDefecto) {
  return esTextoConContenido(valor) ? valor.trim() : porDefecto;
}

/** Valida un motivo contra su tope. Devuelve `{ ok, motivo, error }`. */
function validarMotivo(motivo, max, vacio, largo) {
  const texto = typeof motivo === 'string' ? motivo.trim() : '';
  if (texto.length === 0) return { ok: false, motivo: null, error: vacio };
  if (texto.length > max) return { ok: false, motivo: null, error: largo };
  return { ok: true, motivo: texto, error: null };
}

/**
 * El motivo de la incomparecencia es obligatorio: es de lo que se acusa a otro
 * club, y una acusación sin palabras no se puede responder ni revisar.
 */
export function validarMotivoIncomparecencia(motivo) {
  return validarMotivo(
    motivo,
    MOTIVO_INCOMPARECENCIA_MAX,
    'Escribe qué pasó: lo leerá el club acusado y quien revise la sanción.',
    `El motivo no puede pasar de ${MOTIVO_INCOMPARECENCIA_MAX} caracteres.`
  );
}

/** El motivo de la revisión es lo ÚNICO que va a leer quien la resuelva. */
export function validarMotivoRevision(motivo) {
  return validarMotivo(
    motivo,
    MOTIVO_REVISION_MAX,
    'Cuenta qué pasó: es lo único que va a leer quien revise la medida.',
    `El texto de la revisión no puede pasar de ${MOTIVO_REVISION_MAX} caracteres.`
  );
}

/** Los clubes del desafío donde soy administrador. */
function misClubesDelDesafio(challenge, clubesAdmin) {
  const delDesafio = [challenge?.club_retador_id, challenge?.club_retado_id].filter(Boolean);
  const admin = (Array.isArray(clubesAdmin) ? clubesAdmin : [])
    .filter((id) => id && delDesafio.includes(id));
  return { delDesafio, admin };
}

// ---------------------------------------------------------------------------
// Informar la incomparecencia
// ---------------------------------------------------------------------------

/**
 * Quién puede informar una incomparecencia, contra quién, y por qué no los
 * demás.
 *
 * LA HORA ES LA REGLA. Antes del inicio del partido no hay incomparecencia que
 * informar: nadie ha faltado todavía. El servidor lo vuelve a comprobar con su
 * propio reloj, así que ofrecer el botón antes sólo conseguiría un rechazo.
 *
 * SIN MARGEN DE CORTESÍA. Se compara con la hora de inicio y no con «la hora
 * más quince minutos»: quien llegó tarde, llegó, y eso se discute en la
 * revisión, que es donde hay una persona leyendo.
 */
export function accionesDeIncomparecencia({
  challenge = null,
  partido = null,
  clubesAdmin = [],
  reporte = null,
  ahora = new Date(),
} = {}) {
  const c = challenge || {};
  const p = partido || {};
  const { delDesafio, admin } = misClubesDelDesafio(c, clubesAdmin);

  const esDeClubes = !!p.id && !!p.challenge_proposal_id && delDesafio.length === 2;
  const administroLosDos = admin.length > 1;
  const miClubId = admin.length === 1 ? admin[0] : null;

  const salida = {
    esDeClubes,
    soyAdmin: admin.length > 0,
    administroLosDos,
    miClubId,
    clubReportadoId: null,
    yaInformada: !!reporte?.id,
    puedeInformar: false,
    bloqueo: null,
  };

  // Sin encuentro publicado no hay nada que informar y tampoco nada que
  // explicar: la barra no existe. Un aviso acá sería ruido en un hilo que
  // todavía está negociando la fecha.
  if (!esDeClubes) return salida;

  if (miClubId) {
    salida.clubReportadoId =
      miClubId === c.club_retador_id ? c.club_retado_id : c.club_retador_id;
  }

  const referencia = aFecha(ahora) || new Date();
  const hora = aFecha(p.hora);

  if (salida.yaInformada) {
    salida.bloqueo = 'Ya se informó una incomparecencia en este encuentro.';
  } else if (c.estado === 'cancelado' || p.estado === 'cancelado') {
    salida.bloqueo = 'Este encuentro se canceló: nadie faltó a un partido que no se jugó.';
  } else if (!salida.soyAdmin) {
    salida.bloqueo =
      'Solo un administrador de alguno de los dos clubes puede informar una incomparecencia.';
  } else if (administroLosDos) {
    salida.bloqueo =
      'Administras los dos clubes de este encuentro: no puedes informar una incomparecencia contra uno de ellos.';
  } else if (!ESTADOS_CON_ENCUENTRO.includes(c.estado)) {
    salida.bloqueo = 'Este encuentro ya no admite un informe de incomparecencia.';
  } else if (!hora || referencia.getTime() < hora.getTime()) {
    // Sin hora legible se bloquea: ofrecer el botón «por si acaso» termina en
    // un rechazo del servidor que nadie sabe explicar.
    salida.bloqueo = 'Podrás informar la incomparecencia después de la hora del partido.';
  }

  salida.puedeInformar = !salida.bloqueo;
  return salida;
}

// ---------------------------------------------------------------------------
// Pedir la revisión
// ---------------------------------------------------------------------------

/** La sanción de MI club atada a este encuentro que todavía está en pie. */
function sancionDeEsteEncuentro(sanciones, clubId, challengeId) {
  if (!Array.isArray(sanciones) || !clubId) return null;
  const candidatas = sanciones.filter(
    (s) => s
      && s.club_id === clubId
      && s.challenge_id === challengeId
      && ESTADOS_SANCION_ACTIVOS.includes(s.estado)
  );
  if (candidatas.length === 0) return null;

  // Con dos encima manda la más reciente: es la que hay que discutir.
  return candidatas.reduce((mejor, s) => {
    const a = aFecha(s.created_at)?.getTime() ?? 0;
    const b = aFecha(mejor.created_at)?.getTime() ?? 0;
    return a > b ? s : mejor;
  });
}

/** La revisión que ya existe sobre esta misma medida, o `null`. */
function revisionDeLaMedida(revisiones, { clubId, challengeId, sancionId }) {
  if (!Array.isArray(revisiones)) return null;
  return revisiones.find(
    (r) => r
      && r.club_id === clubId
      && r.challenge_id === challengeId
      && (sancionId ? r.sancion_id === sancionId : !r.sancion_id)
  ) || null;
}

/**
 * Si «Solicitar revisión» corresponde, sobre qué medida, y por qué no.
 *
 * SE OFRECE ANTE CUALQUIER CANCELACIÓN O SANCIÓN. Una sanción la sufre el club
 * sancionado; una cancelación la sufre el rival, que se quedó sin partido y
 * con gente organizada. Los dos casos llevan a la misma puerta.
 *
 * UNA REVISIÓN POR MEDIDA. No es una cola de apelaciones: si ya hay una en
 * curso se muestra su estado, y si ya se resolvió no se vuelve a abrir. El
 * índice único de la migración dice lo mismo, y es el que manda.
 */
export function accionesDeRevision({
  challenge = null,
  partido = null,
  clubesAdmin = [],
  sanciones = [],
  revisiones = [],
} = {}) {
  const c = challenge || {};
  const p = partido || {};
  const { delDesafio, admin } = misClubesDelDesafio(c, clubesAdmin);

  const esDeClubes = !!p.id && !!p.challenge_proposal_id && delDesafio.length === 2;
  const administroLosDos = admin.length > 1;
  const miClubId = admin.length === 1 ? admin[0] : null;

  const salida = {
    esDeClubes,
    soyAdmin: admin.length > 0,
    administroLosDos,
    miClubId,
    tipo: null,
    sancionId: null,
    sancion: null,
    revision: null,
    puedeSolicitar: false,
    bloqueo: null,
  };

  if (!esDeClubes) return salida;

  const sancion = sancionDeEsteEncuentro(sanciones, miClubId, c.id);
  const cancelado = c.estado === 'cancelado' || p.estado === 'cancelado';

  if (sancion) {
    salida.tipo = 'sancion';
    salida.sancion = sancion;
    salida.sancionId = sancion.id;
  } else if (cancelado) {
    salida.tipo = 'cancelacion';
  }

  salida.revision = revisionDeLaMedida(revisiones, {
    clubId: miClubId,
    challengeId: c.id,
    sancionId: salida.sancionId,
  });

  if (!salida.soyAdmin) {
    salida.bloqueo = 'Solo un administrador de alguno de los dos clubes puede pedir una revisión.';
  } else if (administroLosDos) {
    salida.bloqueo =
      'Administras los dos clubes de este encuentro: no puedes pedir una revisión en nombre de uno solo.';
  } else if (!salida.tipo) {
    salida.bloqueo = 'Todavía no hay ninguna cancelación ni sanción que revisar en este encuentro.';
  } else if (salida.revision?.estado === 'pendiente') {
    salida.bloqueo = 'Ya pediste una revisión: está en cola.';
  } else if (salida.revision) {
    salida.bloqueo = 'Esta medida ya se revisó.';
  }

  salida.puedeSolicitar = !salida.bloqueo;
  return salida;
}

// ---------------------------------------------------------------------------
// Las RPC
// ---------------------------------------------------------------------------

export const FALTA_MIGRACION_REVISIONES = {
  message:
    'Informar una incomparecencia o pedir una revisión necesita una migración que todavía no está en Supabase. Avisa al equipo antes de volver a intentarlo.',
};

export { esFaltaDeEsquema as esFaltaDeEsquemaRevisiones } from './cambioRpc.js';

/**
 * Argumentos de `reportar_incomparecencia(p_challenge_id, p_motivo)`.
 *
 * El motivo vacío viaja como CADENA VACÍA y no como `null`: así el servidor lo
 * rechaza con su propio mensaje en vez de leerlo como un argumento ausente.
 */
export function argumentosReportarIncomparecencia(challengeId, motivo) {
  return {
    p_challenge_id: challengeId,
    p_motivo: typeof motivo === 'string' ? motivo.trim() : '',
  };
}

/**
 * Argumentos de `solicitar_revision_sancion(p_challenge_id, p_motivo, p_sancion_id)`.
 *
 * `p_sancion_id` va en `null` cuando no hay sanción —una cancelación con aviso
 * suficiente no deja ninguna— y NUNCA como cadena vacía: `''` no es un uuid y
 * PostgREST lo rechazaría con `22P02` antes de llegar a la función, en vez de
 * dejar que el servidor busque la sanción por su cuenta.
 */
export function argumentosSolicitarRevision(challengeId, motivo, sancionId = null) {
  return {
    p_challenge_id: challengeId,
    p_motivo: typeof motivo === 'string' ? motivo.trim() : '',
    p_sancion_id: sancionId || null,
  };
}

/**
 * Convierte la respuesta de las RPC al `{ data, error }` del resto de los
 * servicios.
 *
 * Las dos devuelven `{ ok, reason }` en vez de lanzar: llegar antes de la hora
 * o no ser administrador no son errores del sistema, son respuestas, y la
 * pantalla las muestra tal cual.
 */
export function comoResultadoRevision(data, error, etiqueta = 'revisionSancion') {
  if (error) {
    console.error(`[FutFinder] ${etiqueta}:`, error);
    if (esFaltaDeEsquema(error)) return { data: null, error: FALTA_MIGRACION_REVISIONES };
    return {
      data: null,
      error: { message: error.message || 'No se pudo completar la acción.' },
    };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row && row.ok === false) {
    return { data: null, error: { message: row.reason || 'No se pudo completar la acción.' } };
  }
  return { data: row || null, error: null };
}

// ---------------------------------------------------------------------------
// El texto del hilo
// ---------------------------------------------------------------------------

/** «Deportivo informó que Los Xupa no se presentó: «no llegó nadie».» */
export function textoIncomparecenciaReportada(payload) {
  const quien = nombreDe(payload?.club_reportante_nombre, 'Un club');
  const acusado = nombreDe(payload?.club_reportado_nombre, 'el club rival');
  const motivo = esTextoConContenido(payload?.motivo) ? payload.motivo.trim() : null;

  const base = `${quien} informó que ${acusado} no se presentó al partido`;
  return motivo ? `${base}: «${motivo}».` : `${base}.`;
}

/**
 * «Deportivo pidió que se revise la sanción.»
 *
 * SIN EL MOTIVO, a propósito. Que se pidió una revisión es público para los dos
 * clubes; lo que se le dice a quien modera es del club que la pide. El servidor
 * tampoco lo manda en el evento.
 */
export function textoRevisionSolicitada(payload) {
  const club = nombreDe(payload?.club_nombre, 'Un club');
  const medida = payload?.tipo === 'cancelacion' ? 'la cancelación' : 'la sanción';
  return `${club} pidió que se revise ${medida}.`;
}

/** «La revisión de Deportivo terminó: se retiró la sanción.» */
export function textoRevisionResuelta(payload) {
  const club = nombreDe(payload?.club_nombre, 'un club');
  const nota = esTextoConContenido(payload?.nota) ? payload.nota.trim() : null;

  const decision = payload?.decision === 'retirada'
    ? 'se retiró la sanción'
    : 'se mantiene la medida';

  const base = `Se revisó lo que pidió ${club}: ${decision}`;
  return nota ? `${base}. ${nota}` : `${base}.`;
}

/** «Pediste una revisión el 14 de agosto. Todavía no la resuelven.» */
export function textoEstadoRevision(revision) {
  if (!revision) return null;
  const cuando = fechaLarga(revision.created_at);

  if (revision.estado === 'pendiente') {
    return cuando
      ? `Pediste una revisión el ${cuando}. Todavía no la resuelven.`
      : 'Pediste una revisión. Todavía no la resuelven.';
  }

  const decision = revision.decision === 'retirada'
    ? 'La revisión retiró la sanción.'
    : 'La revisión mantuvo la medida.';
  return esTextoConContenido(revision.nota) ? `${decision} ${revision.nota.trim()}` : decision;
}
