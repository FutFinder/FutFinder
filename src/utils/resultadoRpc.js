/**
 * Resultado del encuentro y asistencia real (migraciones 48 y 48b).
 *
 * ES UN ESPEJO, NO LA AUTORIDAD, igual que `cambioRpc.js` y
 * `revisionSancion.js`. `proponer_resultado()` y `confirmar_resultado()`
 * vuelven a comprobar la membresía, el estado del desafío y quién propuso
 * cada vez; lo de acá existe para no ofrecer un botón que el servidor va a
 * rechazar, nunca para decidir por él.
 *
 * Vive fuera de `services/clubResults.js` por la misma razón que
 * `cambioRpc.js` vive fuera de `clubMatchChanges.js`: el servicio importa el
 * cliente de Supabase y no se puede cargar en una prueba, mientras que ESTO
 * —los nombres de los argumentos, la traducción de la respuesta y qué botón
 * corresponde— es exactamente lo que se rompe en silencio.
 */

import { esFaltaDeEsquema } from './cambioRpc.js';

export { esFaltaDeEsquema };

export const FALTA_MIGRACION_RESULTADO = {
  message:
    'Registrar o confirmar el resultado necesita una migración que todavía no está en Supabase. Avisa al equipo antes de volver a intentarlo.',
};

/**
 * Único estado del desafío en el que se puede proponer un resultado nuevo.
 *
 * `resultado_en_disputa` NO entra acá (corrección de la migración 48b): es
 * terminal desde el lado del club — ni el proponente ni el contrario pueden
 * reabrirlo con una propuesta nueva, sólo la moderación, igual que
 * `bloqueado_sancion` sólo lo desbloquea una revisión resuelta.
 */
export const ESTADOS_CON_RESULTADO = ['esperando_resultado'];

/**
 * Argumentos de `proponer_resultado(p_challenge_id, p_goles_local, p_goles_visitante, p_asistencia)`.
 *
 * `p_asistencia` es la lista de ids de jugadores que SÍ llegaron; el resto de
 * los inscritos queda `no_asistio`. Ausente o no-arreglo viaja como `null`
 * («no toques la asistencia»); un arreglo vacío se conserva tal cual («nadie
 * de los inscritos llegó»), porque son dos respuestas distintas del lado del
 * servidor.
 */
export function argumentosProponerResultado(challengeId, golesLocal, golesVisitante, asistencia) {
  return {
    p_challenge_id: challengeId,
    p_goles_local: Number(golesLocal),
    p_goles_visitante: Number(golesVisitante),
    p_asistencia: Array.isArray(asistencia) ? asistencia : null,
  };
}

/**
 * Argumentos de `confirmar_resultado(p_result_id, p_aceptar)`.
 *
 * `p_aceptar` se fuerza a booleano: la firma lo declara `boolean` y mandar 1
 * o la cadena 'false' es un error de casteo del lado del servidor.
 */
export function argumentosConfirmarResultado(resultId, aceptar) {
  return {
    p_result_id: resultId,
    p_aceptar: !!aceptar,
  };
}

/**
 * Convierte la respuesta de las RPC al `{ data, error }` del resto de los
 * servicios.
 *
 * Las dos devuelven `{ ok, reason }` en vez de lanzar: no ser el club
 * contrario o llegar con el desafío en el estado equivocado no son errores
 * del sistema, son respuestas, y la pantalla las muestra tal cual.
 */
export function comoResultadoResultado(data, error, etiqueta = 'resultado') {
  if (error) {
    console.error(`[FutFinder] ${etiqueta}:`, error);
    if (esFaltaDeEsquema(error)) return { data: null, error: FALTA_MIGRACION_RESULTADO };
    return { data: null, error: { message: error.message || 'No se pudo completar la acción.' } };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row && row.ok === false) {
    return { data: null, error: { message: row.reason || 'No se pudo completar la acción.' } };
  }
  return { data: row || null, error: null };
}

/** Los clubes del desafío donde soy administrador. */
function misClubesDelDesafio(challenge, clubesAdmin) {
  const delDesafio = [challenge?.club_retador_id, challenge?.club_retado_id].filter(Boolean);
  const admin = (Array.isArray(clubesAdmin) ? clubesAdmin : [])
    .filter((id) => id && delDesafio.includes(id));
  return { delDesafio, admin };
}

/**
 * Si «Proponer resultado» y «Confirmar resultado» corresponden, y por qué no.
 *
 * PROPONE UNO DE LOS DOS CLUBES, NUNCA EL QUE ADMINISTRA LOS DOS: después
 * sería quien confirma su propia propuesta por la otra puerta (mismo
 * conflicto que 43d/46/47).
 *
 * CONFIRMA EL CLUB CONTRARIO, NUNCA EL PROPONENTE: ni la persona que propuso
 * (aunque el desafío tenga otro administrador), ni un administrador que
 * también pertenece al club proponente.
 */
export function accionesDeResultado({
  challenge = null,
  clubesAdmin = [],
  resultadoActivo = null,
  miUserId = null,
} = {}) {
  const c = challenge || {};
  const { delDesafio, admin } = misClubesDelDesafio(c, clubesAdmin);

  const esDeClubes = delDesafio.length === 2;
  const administroLosDos = admin.length > 1;
  const miClubId = admin.length === 1 ? admin[0] : null;

  const salida = {
    esDeClubes,
    soyAdmin: admin.length > 0,
    administroLosDos,
    miClubId,
    puedeProponer: false,
    puedeConfirmar: false,
    bloqueoProponer: null,
    bloqueoConfirmar: null,
  };

  if (!esDeClubes) return salida;

  const enEstadoDeResultado = ESTADOS_CON_RESULTADO.includes(c.estado);

  // ── proponer ──────────────────────────────────────────────────
  if (!salida.soyAdmin) {
    salida.bloqueoProponer =
      'Solo un administrador de alguno de los dos clubes puede proponer el resultado.';
  } else if (administroLosDos) {
    salida.bloqueoProponer =
      'Administras los dos clubes de este encuentro: no puedes proponer el resultado en nombre de uno solo.';
  } else if (!enEstadoDeResultado) {
    salida.bloqueoProponer = 'Este desafío no está esperando un resultado.';
  } else if (resultadoActivo?.estado === 'propuesto') {
    salida.bloqueoProponer = 'Ya hay un resultado propuesto esperando confirmación del otro club.';
  }
  salida.puedeProponer = !salida.bloqueoProponer;

  // ── confirmar ─────────────────────────────────────────────────
  if (!resultadoActivo || resultadoActivo.estado !== 'propuesto') {
    salida.bloqueoConfirmar = 'No hay ningún resultado propuesto esperando confirmación.';
  } else if (miUserId && resultadoActivo.propuesto_por === miUserId) {
    salida.bloqueoConfirmar = 'No puedes confirmar tu propio resultado: lo confirma el club contrario.';
  } else if (!salida.soyAdmin) {
    salida.bloqueoConfirmar = 'Solo un administrador del club contrario puede confirmar este resultado.';
  } else if (administroLosDos || miClubId === resultadoActivo.club_proponente_id) {
    // Administrar los dos clubes implica pertenecer también al proponente;
    // administrar sólo el proponente lo dice directamente. Mismo mensaje que
    // el servidor en los dos casos.
    salida.bloqueoConfirmar = administroLosDos
      ? 'No puedes confirmar un resultado propuesto por un club al que perteneces.'
      : 'Solo un administrador del club contrario puede confirmar este resultado.';
  }
  salida.puedeConfirmar = !salida.bloqueoConfirmar;

  return salida;
}
