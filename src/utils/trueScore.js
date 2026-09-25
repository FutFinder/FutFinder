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

/**
 * La etiqueta corta de un puntaje para la portada.
 *
 * Con TrueScore sale de la tabla `niveles` que manda el servidor —la misma
 * que usa `truescore_nivel()` para decidir el color— y no de tramos escritos
 * a mano. Inicio decía «SÓLIDO» a una cuenta que el servidor clasifica
 * «Confiable»: dos escalas distintas para el mismo número.
 *
 * Sin puntaje devuelve null: quien llama decide qué dibujar, pero nunca
 * recibe una etiqueta para un número que no existe.
 */
export function etiquetaTier(puntaje, { fase1 = false, niveles = null } = {}) {
  const n = Number(puntaje);
  if (puntaje === null || puntaje === undefined || !Number.isFinite(n)) return null;
  if (fase1) {
    const nivel = nivelTrueScore(n, niveles);
    return nivel ? String(nivel.nombre).toUpperCase() : null;
  }
  return n >= 90 ? 'ÉLITE' : n >= 70 ? 'SÓLIDO' : 'EN PRUEBA';
}

/**
 * Qué hace de verdad confirmar con GPS, en una frase.
 *
 * Con fase 1 el GPS sólo deja constancia de que llegaste: los puntos los
 * aplica el organizador cuando confirma la asistencia (`confirmar_asistencia`,
 * migración 134). Prometer «suma a tu Trust Score» era describir el flujo
 * antiguo, que sigue vivo con el flag apagado.
 */
export function textoEfectoGps(fase1) {
  return fase1
    ? 'Deja registrado que llegaste a la cancha. Los puntos de TrueScore los aplica el organizador cuando confirma la asistencia.'
    : 'Confirmar suma a tu Trust Score.';
}

/** Cómo se sube el puntaje, para la tarjeta de «no puedes unirte». */
export function textoComoSubir(fase1) {
  return fase1
    ? 'Tu TrueScore sube cuando asistes a tiempo y el organizador lo confirma, y más aún con cada partido seguido.'
    : 'Sube tu Trust Score jugando partidos y confirmando asistencia con GPS.';
}

// ------------------------------------------------- el costo antes de salir

/**
 * En qué estado quedó la consulta de `truescore_costo_salida`.
 *
 * Tres respuestas distintas que la pantalla mezclaba en una sola: mientras la
 * RPC no contestaba, y también si fallaba, el botón decía «Salir del partido»
 * sin costo y se dejaba pulsar. El jugador confirmaba a ciegas una acción que
 * le resta puntos.
 *
 *   `undefined` → todavía no contesta          → 'cargando'
 *   `null`      → la RPC falló (lo que devuelve el servicio ante un error)
 *                 o el servidor no dio un costo usable  → 'error'
 *   `{ ok: true, puntos }` → 'listo'; `puntos` puede ser 0, y cero es un
 *                 costo válido que hay que mostrar, no un hueco.
 */
export function estadoCostoSalida(respuesta) {
  if (respuesta === undefined) {
    return { estado: 'cargando', costo: null, error: null };
  }
  if (respuesta === null) {
    return {
      estado: 'error',
      costo: null,
      error: 'No pudimos calcular cuánto te cuesta. Revisa tu conexión e inténtalo de nuevo.',
    };
  }
  if (!respuesta.ok) {
    return { estado: 'error', costo: null, error: respuesta.reason || 'No pudimos calcular cuánto te cuesta.' };
  }
  // `Number(null)` es 0, así que un `puntos: null` habría pasado por un cero
  // válido y habilitado el botón con un costo que el servidor nunca dio.
  if (respuesta.puntos === null || respuesta.puntos === undefined
      || !Number.isFinite(Number(respuesta.puntos))) {
    return { estado: 'error', costo: null, error: 'El servidor no devolvió un costo válido.' };
  }
  return { estado: 'listo', costo: respuesta, error: null };
}

/** «−7 pts» / «sin costo» para el botón que confirma la salida. */
export function sufijoCosto(costo) {
  const n = Number(costo?.puntos);
  if (!Number.isFinite(n)) return '';
  return n > 0 ? ` (−${n} pts)` : ' (sin costo)';
}

// ----------------------------------------------------------------- teléfono

/**
 * En qué estado quedó la consulta de `mi_telefono` (migración 138).
 *
 * El mismo error que el costo de salida, en otra pantalla: «no pudimos
 * consultarlo» se convertía en «no tiene teléfono». Una caída de red le
 * mostraba el formulario de registro a alguien que ya tenía su número
 * guardado, y guardar desde ahí escribía sobre un estado desconocido.
 *
 *   `undefined`        → todavía no contesta            → 'cargando'
 *   `{ ok: false }`    → no se pudo consultar           → 'error'
 *   `{ ok: true, … }`  → la respuesta real del servidor → 'listo'
 *
 * `puedeGuardar` es la respuesta a la única pregunta que importa antes de
 * escribir: ¿sabemos qué hay guardado? Sólo el tercer caso dice que sí.
 */
export function estadoTelefono(respuesta) {
  if (respuesta === undefined) {
    return { estado: 'cargando', datos: null, error: null, puedeGuardar: false };
  }
  if (!respuesta || respuesta.ok !== true) {
    return {
      estado: 'error',
      datos: null,
      error: respuesta?.reason || 'No pudimos consultar tu teléfono. Inténtalo de nuevo.',
      puedeGuardar: false,
    };
  }
  return { estado: 'listo', datos: respuesta, error: null, puedeGuardar: true };
}

// --------------------------------------------------------- historial largo

/**
 * Pega una página nueva al historial ya cargado sin repetir ni perder filas.
 *
 * Dos razones para que exista y no sea un `concat`:
 *
 *   · El historial antiguo pagina con `lte` sobre `created_at` para no
 *     perder los empates de segundo, así que devuelve a propósito las filas
 *     del borde otra vez. Acá se descartan por `id`.
 *   · Mientras el jugador baja pueden entrar eventos nuevos. Son más nuevos
 *     que todo lo cargado, así que no entran por el final: se ignoran hasta
 *     que la pantalla recargue desde arriba, y ninguna fila vieja se duplica
 *     ni se salta por el desplazamiento.
 *
 * El orden de lo ya cargado se respeta tal cual: sólo se agrega al final.
 */
export function fusionarHistorial(actual = [], nuevas = []) {
  const vistos = new Set(actual.map((f) => String(f.id)));
  const agregadas = [];
  for (const fila of nuevas) {
    const clave = String(fila?.id);
    if (!fila || vistos.has(clave)) continue;
    vistos.add(clave);
    agregadas.push(fila);
  }
  return { filas: [...actual, ...agregadas], agregadas: agregadas.length };
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
