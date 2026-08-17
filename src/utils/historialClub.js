/**
 * El historial real de un club y sus estadísticas (migración 49).
 *
 * POR QUÉ VIVE ACÁ Y NO EN EL SERVICIO. Igual que `nominaQuery.js` y
 * `expedienteSancion.js`: `services/clubMatches.js` ata estas funciones al
 * cliente único de Supabase y no se puede cargar en una prueba, mientras que
 * ESTO —los argumentos de la RPC, la inversión del marcador y las etiquetas—
 * es exactamente lo que se rompe en silencio. Los cargadores reciben el
 * cliente por parámetro para que la prueba recorra el MISMO código que la
 * pantalla, con un cliente falso con la forma de PostgREST.
 *
 * HASTA LA 6.1 NO HABÍA HISTORIAL QUE MOSTRAR. `matches` no guardaba
 * marcador, así que el perfil del club dibujaba tres partidos de ejemplo
 * («Deportivo Ñuñoa 1-0», «Atlético Maipú 2-3»…) con `__DEV__`, y un récord
 * 1-1-1 derivado de ellos. La 48 trajo el marcador confirmado y la 49 el
 * historial completo; los fixtures se retiraron en la misma tarea, porque
 * apagarlos antes habría dejado la sección vacía y apagarlos después habría
 * dejado datos falsos conviviendo con datos reales.
 *
 * LA PERSPECTIVA ES DEL CLUB QUE SE MIRA, NO DEL LOCAL. `historial_club()`
 * devuelve el marcador tal como se jugó (`goles_local` / `goles_visitante`) y
 * el resultado ya calculado desde `p_club_id`. Acá se invierte el marcador
 * cuando el club es el visitante: «Club A 3-1 Club B» es «Victoria 3-1» para
 * A y «Derrota 1-3» para B, y NADA en la tarjeta puede quedar diciendo lo
 * contrario. Por eso la letra V/E/D se deriva de los dos números que la
 * tarjeta pinta —no de la columna del servidor— y una prueba comprueba que
 * las dos coincidan siempre: una discrepancia entre el marcador y la insignia
 * es peor que cualquiera de las dos por separado.
 */

/** Resultado de un partido, desde la óptica del club que se está mirando. */
export const RESULTADO = {
  VICTORIA: 'V',
  EMPATE: 'E',
  DERROTA: 'D',
};

/** Nombre de la RPC del historial (migración 49). */
export const HISTORIAL_RPC = 'historial_club';

/** Nombre de la RPC de las estadísticas (migración 49). */
export const ESTADISTICAS_RPC = 'club_estadisticas';

/**
 * Columnas que la interfaz consume de `historial_club()`.
 *
 * Se contrastan contra la migración en una prueba, por lo mismo que
 * `NOMINA_COLUMNS`: una columna inventada acá no degrada la tarjeta, la deja
 * sin marcador y sin resultado.
 */
export const HISTORIAL_COLUMNAS = [
  'match_id',
  'fecha',
  'hora',
  'club_local_id',
  'club_local_nombre',
  'club_local_foto_url',
  'club_visitante_id',
  'club_visitante_nombre',
  'club_visitante_foto_url',
  'goles_local',
  'goles_visitante',
  'resultado',
  'cancha_nombre',
  'nivel',
  'soy_integrante',
];

/** Columnas de `club_estadisticas()`. */
export const ESTADISTICAS_COLUMNAS = ['pj', 'v', 'e', 'd', 'gf', 'gc'];

/**
 * Las estadísticas de un club que todavía no jugó.
 *
 * Congelado y compartido: es el valor inicial de la pantalla y también lo que
 * se devuelve cuando la migración no está aplicada. Nadie debería mutarlo.
 */
export const ESTADISTICAS_VACIAS = Object.freeze({ pj: 0, v: 0, e: 0, d: 0, gf: 0, gc: 0 });

/** Partidos que se piden por defecto. */
export const HISTORIAL_LIMITE = 20;

/**
 * El tope real de `historial_club()`: su `least(coalesce(p_limit, 20), 50)`.
 *
 * Lo pide la pantalla del historial completo. Está acá y no escrito a mano en
 * la pantalla para que el día que la RPC cambie su tope haya un solo número que
 * mover.
 */
export const HISTORIAL_LIMITE_MAX = 50;

/** Argumentos de `historial_club(p_club_id, p_limit)`. */
export function argumentosHistorial(clubId, limit = HISTORIAL_LIMITE) {
  const n = Number(limit);
  return {
    p_club_id: clubId,
    p_limit:
      Number.isFinite(n) && n > 0
        ? Math.min(Math.trunc(n), HISTORIAL_LIMITE_MAX)
        : HISTORIAL_LIMITE,
  };
}

/** Argumentos de `club_estadisticas(p_club_id)`. */
export function argumentosEstadisticas(clubId) {
  return { p_club_id: clubId };
}

/**
 * V/E/D a partir del marcador YA visto desde el club.
 *
 * Espeja el `case` de `historial_club()` y de `club_record()`. Si alguno de
 * los dos goles falta, no hay resultado: `null`, que la tarjeta dibuja como
 * «Sin resultado» en vez de inventar un empate.
 */
export function resultadoDesdeMarcador(miMarcador, suMarcador) {
  if (!Number.isFinite(miMarcador) || !Number.isFinite(suMarcador)) return null;
  if (miMarcador > suMarcador) return RESULTADO.VICTORIA;
  if (miMarcador < suMarcador) return RESULTADO.DERROTA;
  return RESULTADO.EMPATE;
}

/** 'V' → 'Victoria'. Lo que se lee, no la letra de la insignia. */
export function resultadoNombre(resultado) {
  if (resultado === RESULTADO.VICTORIA) return 'Victoria';
  if (resultado === RESULTADO.DERROTA) return 'Derrota';
  if (resultado === RESULTADO.EMPATE) return 'Empate';
  return 'Sin resultado';
}

/**
 * EL TIPO DE PARTIDO NO SE MUESTRA EN EL HISTORIAL DE UN CLUB, Y NO ES UN
 * OLVIDO.
 *
 * `historial_club()` devuelve `matches.nivel` y la Tarea 6.2 lo pintaba como
 * «Recreativo / Intermedio / Competitivo». La auditoría de la 6.3 encontró que
 * en un encuentro entre clubes ese campo NO ES UNA DECISIÓN DE NADIE:
 *
 *   · `club_challenges` no tiene columna de nivel;
 *   · `club_challenge_proposals` tampoco —se acuerdan fecha, cancha,
 *     modalidad, cupos, método de inscripción y cuota, nunca el nivel—;
 *   · `aprobar_propuesta()` (migración 44) crea el `matches` sin `nivel`, así
 *     que queda el `default 'recreativo'` de la tabla.
 *
 * Comprobado contra el proyecto el 2026-08-17: los 7 partidos de clubes que
 * existen tienen `nivel = 'recreativo'`, todos por omisión. Mostrarlo era
 * enseñar un valor por defecto como si fuera un dato —exactamente lo que la
 * 6.2 vino a quitar del historial— y un encuentro competitivo se habría leído
 * igual «Recreativo».
 *
 * VOLVER A MOSTRARLO ES UNA LÍNEA, el día que el nivel se acuerde de verdad en
 * la propuesta: `tipoLabel` en `normalizarPartido()` y la prop en
 * `MatchHistoryCard`. Está registrado en `docs/memoria/operacion/pendientes.md`.
 *
 * El vocabulario existe y es correcto en `services/matchRules.js`, donde SÍ lo
 * elige una persona: el organizador de un partido normal.
 */

/** El nivel que la tabla pone cuando nadie lo eligió. */
export const NIVEL_POR_OMISION = 'recreativo';

/**
 * '2026-07-28' → '28 jul'.
 *
 * SE PARTE EL TEXTO A MANO A PROPÓSITO. `new Date('2026-07-28')` es medianoche
 * UTC, y en Chile (UTC-4) eso es el 27 a las 20:00: el historial mostraba el
 * día ANTERIOR al del partido. `fecha` ya viene convertida a
 * `America/Santiago` por la RPC, así que acá sólo se arma una fecha local con
 * esos tres números.
 */
export function formatFechaCorta(fecha) {
  if (!fecha) return '';
  const partes = String(fecha).slice(0, 10).split('-');
  if (partes.length !== 3) return '';
  const [y, m, d] = partes.map((p) => Number(p));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '';
  try {
    return new Date(y, m - 1, d)
      .toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })
      .replace('.', '');
  } catch {
    return '';
  }
}

/** Dos dígitos, como en el resto de la aplicación. */
function dosDigitos(n) {
  return String(n).padStart(2, '0');
}

/**
 * Un marcador, o `null` si no hay marcador.
 *
 * NO SE PUEDE USAR `Number()` A SECAS: `Number(null)` es 0 y `Number('')`
 * también, así que un partido sin resultado confirmado se leería como un 0-0
 * —un empate inventado— en vez de descartarse. Es justo lo contrario de lo
 * que esta tarea viene a arreglar.
 */
function comoGoles(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * Hora del partido en formato 24 h, o `null` si no viajó.
 *
 * `hora` sólo llega a los integrantes de los dos clubes: para cualquier otro
 * la RPC la manda en `null` y la tarjeta simplemente no la dibuja. Se formatea
 * con la hora del dispositivo, igual que `PartidoCard` y `ClubProposalScreen`.
 */
export function formatHora(hora) {
  if (!hora) return null;
  const d = new Date(hora);
  if (Number.isNaN(d.getTime())) return null;
  return `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`;
}

/**
 * Una fila de `historial_club()` como la consume la tarjeta.
 *
 * Devuelve `null` si la fila no sirve: sin `match_id`, sin marcador, o de un
 * partido en el que el club no jugó. La RPC ya filtra las tres cosas —el
 * `join` contra los resultados confirmados es interno—, pero un historial que
 * cuenta partidos que nadie confirmó es exactamente el fallo que esta tarea
 * viene a cerrar, y no se sostiene sobre una sola línea de SQL.
 */
export function normalizarPartido(row, clubId) {
  if (!row || !row.match_id || !clubId) return null;

  const esLocal = row.club_local_id === clubId;
  const esVisitante = row.club_visitante_id === clubId;
  if (!esLocal && !esVisitante) return null;

  const golesLocal = comoGoles(row.goles_local);
  const golesVisitante = comoGoles(row.goles_visitante);
  if (golesLocal === null || golesVisitante === null) return null;

  const miMarcador = esLocal ? golesLocal : golesVisitante;
  const suMarcador = esLocal ? golesVisitante : golesLocal;
  const resultado = resultadoDesdeMarcador(miMarcador, suMarcador);

  return {
    id: row.match_id,
    esLocal,
    miNombre: (esLocal ? row.club_local_nombre : row.club_visitante_nombre) || 'Mi club',
    miLogoUrl: (esLocal ? row.club_local_foto_url : row.club_visitante_foto_url) || null,
    rivalNombre: (esLocal ? row.club_visitante_nombre : row.club_local_nombre) || 'Club rival',
    rivalLogoUrl: (esLocal ? row.club_visitante_foto_url : row.club_local_foto_url) || null,
    miMarcador,
    suMarcador,
    resultado,
    resultadoNombre: resultadoNombre(resultado),
    fechaLabel: formatFechaCorta(row.fecha),
    horaLabel: formatHora(row.hora),
    localLabel: esLocal ? 'Local' : 'Visita',
    canchaNombre: row.cancha_nombre || null,
    // `nivel` viaja en la fila pero no se muestra: en un encuentro entre
    // clubes nadie lo elige. Ver `NIVEL_POR_OMISION` arriba.
    soyIntegrante: row.soy_integrante === true,
  };
}

/** El historial completo, normalizado y sin las filas que no sirven. */
export function normalizarHistorial(rows, clubId) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => normalizarPartido(r, clubId))
    .filter(Boolean);
}

/** Las estadísticas, con ceros donde el servidor no mandó número. */
export function normalizarEstadisticas(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ...ESTADISTICAS_VACIAS };
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    pj: n(row.pj),
    v: n(row.v),
    e: n(row.e),
    d: n(row.d),
    gf: n(row.gf),
    gc: n(row.gc),
  };
}

/**
 * «8 partidos jugados · 21 goles a favor · 12 en contra», o `null` si el club
 * todavía no jugó.
 *
 * Vive acá y no en la pantalla porque lo muestran DOS: el perfil del club bajo
 * los últimos encuentros y la pantalla del historial completo. Escrito dos
 * veces terminaría diciendo dos cosas distintas del mismo dato, que es el
 * mismo error que se corrigió al dejar V/E/D en una sola función.
 *
 * NO SE DERIVA DE LOS PARTIDOS CARGADOS: el historial viaja paginado y sumar
 * los goles de las filas visibles daría un total falso en cuanto el club pase
 * del límite. Estos números salen de `club_estadisticas()`.
 */
export function resumenEstadisticas(estadisticas) {
  const s = estadisticas || ESTADISTICAS_VACIAS;
  if (!s.pj) return null;
  return (
    `${s.pj} ${s.pj === 1 ? 'partido jugado' : 'partidos jugados'} · ` +
    `${s.gf} ${s.gf === 1 ? 'gol' : 'goles'} a favor · ` +
    `${s.gc} en contra`
  );
}

/** `true` si el error es «la migración 49 no está aplicada todavía». */
export function esFaltaDeHistorial(error) {
  return ['42883', 'PGRST202'].includes(error?.code);
}

/**
 * Lee el historial real del club.
 *
 * Sin la migración 49 la función no existe: se devuelve el historial vacío en
 * vez de romper el perfil del club, igual que hacía la 44d. Cualquier otro
 * error SÍ se devuelve: «no se pudo leer» y «no hay partidos» no son lo mismo,
 * y confundirlos es lo que una vez dibujó una nómina vacía y falsa.
 */
export async function cargarHistorial(client, clubId, { limit = HISTORIAL_LIMITE } = {}) {
  if (!client || !clubId) return { data: [], error: null };

  const { data, error } = await client.rpc(HISTORIAL_RPC, argumentosHistorial(clubId, limit));

  if (error) {
    // Serializado: los errores de PostgREST se imprimen como [object Object]
    // en la consola web y no se puede diagnosticar nada.
    console.error(
      '[FutFinder] historialClub:',
      error.code || '',
      error.message || JSON.stringify(error)
    );
    if (esFaltaDeHistorial(error)) return { data: [], error: null };
    return { data: [], error };
  }

  return { data: normalizarHistorial(data, clubId), error: null };
}

/**
 * Lee PJ/V/E/D/GF/GC del club.
 *
 * NO se calculan sobre el historial ya cargado: ése viaja paginado, y sumar
 * los goles de las últimas veinte filas no son los goles del club.
 */
export async function cargarEstadisticas(client, clubId) {
  if (!client || !clubId) return { data: { ...ESTADISTICAS_VACIAS }, error: null };

  const { data, error } = await client.rpc(ESTADISTICAS_RPC, argumentosEstadisticas(clubId));

  if (error) {
    console.error(
      '[FutFinder] clubEstadisticas:',
      error.code || '',
      error.message || JSON.stringify(error)
    );
    if (esFaltaDeHistorial(error)) return { data: { ...ESTADISTICAS_VACIAS }, error: null };
    return { data: { ...ESTADISTICAS_VACIAS }, error };
  }

  return { data: normalizarEstadisticas(data), error: null };
}
