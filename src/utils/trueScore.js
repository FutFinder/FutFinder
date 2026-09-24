/**
 * TrueScore del lado de la app: sólo PRESENTA lo que calcula el servidor.
 *
 * Nada acá suma ni resta puntos. Los umbrales de los niveles, el costo de
 * salirse y cada evento del historial llegan de Postgres (`truescore_ajustes`,
 * `truescore_costo_salida`, `truescore_eventos`, migración 134). Si un número
 * cambia en `truescore_config`, la app lo muestra sin tocar este archivo.
 *
 * Vive en `utils/` y sin importar nada de React ni de Supabase para poder
 * probarlo con `node --test`.
 */

/**
 * El nivel de un puntaje según la tabla que manda el servidor
 * (`niveles`, de mayor a menor). Devuelve null si no hay tabla: sin TrueScore
 * activo la app no pinta niveles.
 */
export function nivelTrueScore(puntaje, niveles) {
  if (!Array.isArray(niveles) || niveles.length === 0) return null;
  const n = Number(puntaje);
  if (!Number.isFinite(n)) return null;
  const ordenados = [...niveles].sort((a, b) => Number(b.desde) - Number(a.desde));
  return ordenados.find((nv) => n >= Number(nv.desde)) || ordenados[ordenados.length - 1];
}

/** Marcas que acepta el organizador, en el orden en que se muestran. */
export const MARCAS_ASISTENCIA = ['asistio', 'tarde', 'no_fue'];

/**
 * ¿Marcó a todos los de la nómina? La confirmación es de una sola vez y el
 * servidor la rechaza incompleta; la pantalla lo dice antes de intentarlo.
 */
export function marcasCompletas(nomina = [], marcas = {}) {
  const faltan = nomina.filter((j) => !MARCAS_ASISTENCIA.includes(marcas[j.user_id]));
  return { completas: faltan.length === 0 && nomina.length > 0, faltan: faltan.length };
}

/**
 * ¿Sigue abierto el plazo para confirmar la asistencia? Desde el fin del
 * partido hasta `horas` después. El servidor vuelve a comprobarlo con su reloj.
 */
export function plazoAsistenciaAbierto(match, horas, ahora = Date.now()) {
  if (!match?.hora) return false;
  if (match.asistencia_confirmada_at || match.asistencia_vencida_at) return false;
  const fin = new Date(match.hora).getTime() + (Number(match.duracion_min) || 90) * 60000;
  return ahora >= fin && ahora <= fin + Number(horas) * 3600000;
}

function puntos(n) {
  return `${n} ${n === 1 ? 'punto' : 'puntos'}`;
}

/**
 * La regla de salida en una frase, sin números: los puntos exactos los dice
 * el servidor al abrir la confirmación (`truescore_costo_salida`).
 */
export const TEXTO_REGLA_SALIDA_TS =
  'Salirte siempre cuesta, y mientras antes avises, menos: la penalización baja a medida que falta más para el partido.';

/** Qué decirle a un jugador antes de salirse, con el costo del servidor. */
export function textoCostoSalida(costo) {
  if (!costo?.ok) return null;
  const n = Number(costo.puntos) || 0;
  const base = `Salirte ahora te resta ${puntos(n)} de TrueScore.`;
  const extra = costo.rompe_racha
    ? ' Además pierdes tu racha de asistencias.'
    : ' Otro jugador puede tomar tu cupo, pero la penalización se aplica igual.';
  return base + extra;
}

/** Qué decirle al organizador antes de cancelar, con el costo del servidor. */
export function textoCostoCancelacion(costo, tipo) {
  if (!costo?.ok) return null;
  if (tipo === 'lluvia' || tipo === 'cierre_cancha') {
    return 'Por lluvia o cierre de cancha no pierdes puntos, y el partido queda neutro para todos.';
  }
  const n = Number(costo.puntos) || 0;
  if (n === 0) {
    return `Cancelas con ${costo.horas_sin_costo} h o más de aviso: no pierdes puntos. Para los jugadores el partido queda neutro.`;
  }
  return `Tu TrueScore baja ${puntos(n)} porque cancelas con menos de ${costo.horas_sin_costo} h de aviso. Para los jugadores el partido queda neutro.`;
}

const TITULOS_EVENTO = {
  inicio: 'Inicio de TrueScore',
  asistio: 'Asististe a tiempo',
  tarde: 'Llegaste tarde',
  planton: 'No fuiste y no avisaste',
  salida: 'Te saliste del partido',
  neutro: 'Sin cambios',
  cancelacion_organizador: 'Cancelaste un partido',
  sin_confirmar_organizador: 'No confirmaste la asistencia',
  reversion: 'Reclamo aceptado',
  reclamo_organizador: 'Un reclamo probó una marca errónea',
  bono_organizador: 'Confirmaste la asistencia a tiempo',
  inactividad: 'Tiempo sin jugar',
};

/** Tipos que un jugador puede reclamar (fase 2): lo marcaron tarde o ausente. */
const RECLAMABLES = ['tarde', 'planton'];

/**
 * ¿Se puede reclamar este evento? Sólo tardanzas y ausencias marcadas en un
 * partido, dentro del plazo que manda el servidor, y si todavía no hay un
 * reclamo por él. El servidor vuelve a comprobarlo todo.
 */
export function puedeReclamar(evento, { fase2, plazoHoras, reclamo, ahora = Date.now() } = {}) {
  if (!fase2 || !evento || !evento.match_id) return false;
  if (!RECLAMABLES.includes(evento.tipo)) return false;
  if (reclamo) return false;
  const creado = new Date(evento.created_at).getTime();
  if (!Number.isFinite(creado)) return false;
  return ahora <= creado + Number(plazoHoras) * 3600000;
}

/** El estado de un reclamo dicho en una frase. */
export function textoEstadoReclamo(reclamo) {
  if (!reclamo) return null;
  if (reclamo.estado === 'aceptado') return 'Reclamo aceptado: se corrigió tu marca.';
  if (reclamo.estado === 'vencido') return 'Tu reclamo se cerró sin las confirmaciones necesarias.';
  const n = Number(reclamo.confirmaciones) || 0;
  const total = Number(reclamo.necesarias) || 0;
  return `Reclamo abierto: ${n} de ${total} compañeros confirmaron.`;
}

/** Una fila de `truescore_eventos` lista para el historial. */
export function describirEvento(e) {
  if (!e) return null;
  const aplicados = Number(e.puntos_aplicados) || 0;
  const esInicio = e.tipo === 'inicio';
  return {
    id: e.id,
    titulo: TITULOS_EVENTO[e.tipo] || 'Movimiento',
    detalle: e.motivo || '',
    // El inicio fija el puntaje: se muestra el valor, no la diferencia.
    cambio: esInicio ? `${e.puntaje_despues}` : aplicados > 0 ? `+${aplicados}` : `${aplicados}`,
    tono: esInicio || aplicados === 0 ? 'neutro' : aplicados > 0 ? 'positivo' : 'negativo',
    puntaje: e.puntaje_despues,
    racha: e.racha_despues,
    fecha: e.created_at,
  };
}
