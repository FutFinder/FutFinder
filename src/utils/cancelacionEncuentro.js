/**
 * Cancelación del encuentro y sanción del club (migración 47).
 *
 * Un administrador puede cancelar un encuentro publicado sin pedirle permiso
 * al rival, pero tiene que decir por qué, y si lo hace con el partido encima
 * su CLUB queda 14 días sin poder abrir desafíos nuevos. Este archivo es la
 * parte que puede vivir fuera del servidor: decidir qué botón corresponde,
 * advertir de la sanción ANTES de pulsarlo, armar los argumentos de la RPC y
 * redactar lo que se lee en el hilo. No toca React, Supabase ni colores.
 *
 * ES UN ESPEJO, NO LA AUTORIDAD. `cancelar_encuentro_club` vuelve a comprobar
 * el motivo, la membresía y el corte de las 2 horas con el `now()` de
 * PostgreSQL, y ésa es la que manda: el reloj del teléfono no puede regalar ni
 * quitar margen. Lo de acá existe para no ofrecer un botón que el servidor va
 * a rechazar y para poder EXPLICAR por qué no está disponible.
 *
 * LA SANCIÓN ES DEL CLUB. Acá no aparece el Trust Score de nadie, y hay una
 * prueba que lo comprueba sobre los textos: el servidor tampoco lo toca.
 *
 * EL TEXTO SE ARMA ACÁ Y NO EN LA BASE, por lo mismo que el resto de los
 * eventos del ciclo: la fila guarda `tipo` y `payload` (datos), no una frase.
 * Así la redacción se corrige sin migrar filas.
 */

// La extensión explícita es a propósito: estas funciones se prueban con
// `node --test`, que resuelve ESM sin las extensiones implícitas de Metro.
import {
  CANCELACION_SANCION_HORAS,
  SANCION_DIAS,
  cancelacionSanciona,
  finDeSancion,
} from '../services/clubChallengeRules.js';
import { esFaltaDeEsquema } from './cambioRpc.js';

/** Largo máximo del motivo. Espejo del CHECK de `club_sanctions.motivo`. */
export const MOTIVO_MAX = 300;

/** Estados de `club_sanctions` que de verdad bloquean. */
export const ESTADOS_SANCION_ACTIVOS = ['vigente', 'provisional'];

/**
 * Columnas de `club_sanctions` que necesita la interfaz.
 *
 * Vive acá, y no dentro del servicio, por lo mismo que `nominaQuery.js`: una
 * sola columna que no exista hace que PostgREST rechace la consulta ENTERA con
 * 400 y `42703`, y la pantalla se queda sin saber si su club está sancionado.
 * La prueba contrasta cada nombre contra el `create table` de la migración 47.
 *
 * `aplicada_por` NO se pide: quién apretó el botón es auditoría del servidor,
 * no algo que la pantalla del club tenga que mostrar.
 */
export const COLUMNAS_SANCION =
  'id, club_id, challenge_id, match_id, tipo, motivo, inicio_at, fin_at, estado, created_at';

/** Estados del desafío en los que todavía hay un encuentro que cancelar. */
const ESTADOS_CANCELABLES = ['publicado', 'en_juego'];

/** Estados del partido que admiten la cancelación. */
const ESTADOS_PARTIDO_CANCELABLES = ['abierto', 'lleno', 'en_curso'];

const MESES_LARGOS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Fecha válida o null. Nunca lanza: una fecha ilegible es un dato, no un error. */
function aFecha(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

function esTextoConContenido(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * «28 de agosto», sin `Intl`.
 *
 * A mano y no con `toLocaleDateString`: Hermes puede venir sin los datos de
 * localización y devolvería la fecha en inglés, o el mes en número.
 */
export function fechaLarga(valor) {
  const d = aFecha(valor);
  if (!d) return null;
  return `${d.getDate()} de ${MESES_LARGOS[d.getMonth()]}`;
}

// ---------------------------------------------------------------------------
// El motivo
// ---------------------------------------------------------------------------

/**
 * El motivo es OBLIGATORIO, y no como formalidad: es lo que van a leer el club
 * rival, los jugadores inscritos y quien revise la sanción.
 *
 * Un motivo más largo que el máximo se RECHAZA en vez de recortarse. Recortar
 * dejaría en el historial una explicación cortada a la mitad, y ese texto es
 * justamente el que se conserva para siempre.
 *
 * Devuelve `{ ok, motivo, error }`: `motivo` ya viene recortado de espacios,
 * que es como viaja al servidor.
 */
export function validarMotivoCancelacion(motivo) {
  const texto = typeof motivo === 'string' ? motivo.trim() : '';

  if (texto.length === 0) {
    return {
      ok: false,
      motivo: null,
      error: 'Escribe el motivo de la cancelación: lo verán el club rival y los jugadores inscritos.',
    };
  }
  if (texto.length > MOTIVO_MAX) {
    return {
      ok: false,
      motivo: null,
      error: `El motivo no puede pasar de ${MOTIVO_MAX} caracteres.`,
    };
  }
  return { ok: true, motivo: texto, error: null };
}

// ---------------------------------------------------------------------------
// Qué acción corresponde ofrecer
// ---------------------------------------------------------------------------

/**
 * Quién puede cancelar el encuentro, y por qué no los demás.
 *
 * ESPEJO DE LA AUTORIZACIÓN DEL SERVIDOR, no la protección. Esconder el botón
 * no impide nada: `cancelar_encuentro_club` vuelve a comprobar la membresía y
 * el estado con los datos de PostgreSQL.
 *
 * `sanciona` NO es un impedimento: cancelar dentro de las 2 horas está
 * permitido, sólo cuesta 14 días de sanción al club. Es un aviso, no un
 * bloqueo, y confundir las dos cosas dejaría un partido imposible de cancelar
 * justo cuando más falta hace cancelarlo.
 *
 * `clubesAdmin` son los clubes del desafío donde soy administrador.
 */
export function accionesDeCancelacion({
  challenge = null,
  partido = null,
  clubesAdmin = [],
  ahora = new Date(),
} = {}) {
  const c = challenge || {};
  const p = partido || {};

  const delDesafio = [c.club_retador_id, c.club_retado_id].filter(Boolean);
  const admin = (Array.isArray(clubesAdmin) ? clubesAdmin : [])
    .filter((id) => id && delDesafio.includes(id));

  const esDeClubes = !!p.id && !!p.challenge_proposal_id && delDesafio.length === 2;
  const administroLosDos = admin.length > 1;
  const soyAdmin = admin.length > 0;

  const salida = {
    esDeClubes,
    soyAdmin,
    administroLosDos,
    miClubId: admin.length === 1 ? admin[0] : null,
    puedeCancelar: false,
    bloqueo: null,
    sanciona: false,
    finDeSancion: null,
  };

  // Sin encuentro no hay nada que cancelar, y tampoco nada que explicar: la
  // barra no se dibuja. Un mensaje acá sería ruido en un hilo que todavía
  // está negociando.
  if (!esDeClubes) return salida;

  const sanciona = cancelacionSanciona(p.hora, ahora);
  salida.sanciona = sanciona;
  salida.finDeSancion = sanciona ? finDeSancion(aFecha(ahora) || new Date()) : null;

  const YA_CANCELADO = 'Este encuentro ya está cancelado.';
  const YA_NO = 'Este encuentro ya no se puede cancelar.';

  if (c.estado === 'cancelado' || p.estado === 'cancelado') {
    salida.bloqueo = YA_CANCELADO;
  } else if (!soyAdmin) {
    salida.bloqueo = 'Solo un administrador de alguno de los dos clubes puede cancelar el encuentro.';
  } else if (administroLosDos) {
    salida.bloqueo =
      'Administras los dos clubes de este encuentro: no puedes cancelarlo en nombre de uno solo.';
  } else if (!ESTADOS_CANCELABLES.includes(c.estado)) {
    salida.bloqueo = YA_NO;
  } else if (!ESTADOS_PARTIDO_CANCELABLES.includes(p.estado)) {
    salida.bloqueo = YA_NO;
  }

  salida.puedeCancelar = !salida.bloqueo;
  return salida;
}

/**
 * Lo que hay que leer ANTES de confirmar la cancelación.
 *
 * FALLA DEL LADO DE LA ADVERTENCIA: sin hora legible se avisa de la sanción.
 * Prometer «sin sanción» y que después la haya es mucho peor que advertir de
 * una que no llegue a aplicarse — y el que decide es el servidor, no esto.
 */
export function avisoDeCancelacion({ partido = null, ahora = new Date() } = {}) {
  const hora = aFecha(partido?.hora);
  const sanciona = hora ? cancelacionSanciona(hora, ahora) : true;

  if (sanciona) {
    return {
      sanciona: true,
      titulo: 'Cancelar ahora sanciona a tu club',
      detalle:
        `Faltan menos de ${CANCELACION_SANCION_HORAS} horas para el encuentro. Tu club quedará `
        + `${SANCION_DIAS} días sin poder crear ni aceptar desafíos. Los partidos que ya publicó `
        + 'siguen en pie y se juegan igual.',
    };
  }

  return {
    sanciona: false,
    titulo: 'Se cancelará para los dos clubes',
    detalle:
      `Faltan más de ${CANCELACION_SANCION_HORAS} horas, así que no hay sanción. Se avisará a los `
      + 'administradores de ambos clubes y a los jugadores ya inscritos, y el partido quedará '
      + 'cancelado en el historial con el motivo que escribas.',
  };
}

// ---------------------------------------------------------------------------
// La RPC
// ---------------------------------------------------------------------------

/**
 * Se reexporta con nombre propio para que el servicio de sanciones tenga una
 * sola puerta de entrada. La comprobación es la misma de siempre —«esa función
 * o columna todavía no existe»— y no hay razón para escribirla dos veces.
 */
export { esFaltaDeEsquema as esFaltaDeEsquemaSanciones } from './cambioRpc.js';

export const FALTA_MIGRACION_SANCIONES = {
  message:
    'Cancelar el encuentro necesita una migración que todavía no está en Supabase. Avisa al equipo antes de volver a intentarlo.',
};

/**
 * Argumentos de `cancelar_encuentro_club(p_challenge_id, p_motivo)`.
 *
 * UN NOMBRE DE ARGUMENTO MAL PUESTO NO DEGRADA, TUMBA. PostgREST no contesta
 * «te faltó `p_motivo`»: contesta 404 «function not found», porque para él una
 * función con otros argumentos es otra función.
 *
 * El motivo vacío viaja como CADENA VACÍA y no como `null`: así el servidor lo
 * rechaza con su propio mensaje en vez de leerlo como un argumento ausente.
 */
export function argumentosCancelarEncuentro(challengeId, motivo) {
  return {
    p_challenge_id: challengeId,
    p_motivo: typeof motivo === 'string' ? motivo.trim() : '',
  };
}

/**
 * Convierte la respuesta de la RPC al `{ data, error }` del resto de los
 * servicios.
 *
 * La RPC devuelve `{ ok, reason }` en vez de lanzar: no ser administrador o
 * llegar tarde no son errores del sistema, son respuestas, y la pantalla las
 * muestra tal cual. Lo que sí se traduce es la migración ausente, porque
 * «function does not exist» no le dice nada a nadie.
 */
export function comoResultadoCancelacion(data, error, etiqueta = 'cancelarEncuentro') {
  if (error) {
    console.error(`[FutFinder] ${etiqueta}:`, error);
    if (esFaltaDeEsquema(error)) return { data: null, error: FALTA_MIGRACION_SANCIONES };
    return {
      data: null,
      error: { message: error.message || 'No se pudo cancelar el encuentro.' },
    };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row && row.ok === false) {
    return { data: null, error: { message: row.reason || 'No se pudo cancelar el encuentro.' } };
  }
  return { data: row || null, error: null };
}

// ---------------------------------------------------------------------------
// El texto del hilo
// ---------------------------------------------------------------------------

/**
 * El sujeto de la frase: el CLUB primero y, si el servidor lo entregó, el
 * administrador. El club es lo que no puede faltar —un encuentro lo cancela un
 * club, no una persona— y el `username` es trazabilidad para el resto del
 * hilo. Sale de `profiles` dentro de la RPC, nunca del cliente.
 */
function sujeto(club, username) {
  const nombre = esTextoConContenido(club) ? club.trim() : 'Un club';
  if (!esTextoConContenido(username)) return nombre;
  return `${nombre} (@${username.trim()})`;
}

/** «Deportivo (@vicente) canceló el encuentro: «se nos inundó la cancha».» */
export function textoEncuentroCancelado(payload) {
  const quien = sujeto(payload?.club_cancela_nombre, payload?.actor_username);
  const motivo = esTextoConContenido(payload?.motivo) ? payload.motivo.trim() : null;
  return motivo
    ? `${quien} canceló el encuentro: «${motivo}».`
    : `${quien} canceló el encuentro.`;
}

/**
 * «Deportivo quedó sancionado 14 días por cancelar tarde. Hasta el 28 de agosto.»
 *
 * La sanción es DEL CLUB: la frase nombra al club y nunca a una persona,
 * aunque el `payload` traiga quién la disparó.
 */
export function textoSancionAplicada(payload) {
  const club = esTextoConContenido(payload?.club_nombre) ? payload.club_nombre.trim() : 'Un club';
  const dias = Number.isFinite(Number(payload?.dias)) ? Number(payload.dias) : SANCION_DIAS;
  const hasta = fechaLarga(payload?.fin_at);

  const base = `${club} quedó sancionado ${dias} días y no podrá crear ni aceptar desafíos nuevos`;
  return hasta ? `${base}. Hasta el ${hasta}.` : `${base}.`;
}

// ---------------------------------------------------------------------------
// La sanción vigente
// ---------------------------------------------------------------------------

/**
 * La sanción que de verdad está bloqueando ahora mismo, o `null`.
 *
 * Con dos encima manda la que termina más tarde: es la que fija hasta cuándo
 * el club no puede operar. Una 'retirada' por la revisión no cuenta, y una que
 * ya se cumplió tampoco.
 */
export function sancionVigente(sanciones, ahora = new Date()) {
  if (!Array.isArray(sanciones)) return null;
  const ref = (aFecha(ahora) || new Date()).getTime();

  let mejor = null;
  let mejorFin = -Infinity;

  for (const s of sanciones) {
    if (!s || typeof s !== 'object') continue;
    if (!ESTADOS_SANCION_ACTIVOS.includes(s.estado)) continue;

    const fin = aFecha(s.fin_at);
    if (!fin || fin.getTime() <= ref) continue;

    const inicio = aFecha(s.inicio_at);
    if (inicio && inicio.getTime() > ref) continue;

    if (fin.getTime() > mejorFin) {
      mejor = s;
      mejorFin = fin.getTime();
    }
  }
  return mejor;
}

/** «No pueden crear ni aceptar desafíos hasta el 28 de agosto. Motivo: …» */
export function textoDeSancion(sancion) {
  if (!sancion) return null;
  const hasta = fechaLarga(sancion.fin_at);
  const motivo = esTextoConContenido(sancion.motivo) ? sancion.motivo.trim() : null;

  const base = hasta
    ? `Tu club no puede crear ni aceptar desafíos hasta el ${hasta}`
    : 'Tu club no puede crear ni aceptar desafíos por ahora';

  return motivo ? `${base}. Motivo: ${motivo}.` : `${base}.`;
}
