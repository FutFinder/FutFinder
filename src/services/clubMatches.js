import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Historial de partidos entre clubes.
 *
 * ESTADO ACTUAL DEL BACKEND (importante):
 *  - `matches` ya tiene club_local_id / club_visitante_id / challenge_id
 *    (migración 27), así que se pueden identificar los partidos de club.
 *  - Pero NO existe columna de marcador ni de resultado. Por eso un partido
 *    real se devuelve con `marcador: null` y `resultado: null`, y la UI
 *    muestra "vs" en lugar de un score inventado.
 *  - El récord V-E-D del club se deriva de `resultado`; mientras no haya
 *    marcadores reales, el récord real es 0-0-0.
 *
 * FIXTURES DE DESARROLLO:
 *  - `getDemoMatchHistory()` devuelve 3 partidos de ejemplo (V, D, E) que
 *    SOLO se usan cuando `__DEV__` es true y el club no tiene partidos
 *    reales. Nunca se escriben en la base de datos.
 *  - Para desactivarlos sin tocar el resto, pon DEMO_HISTORIAL en false.
 */

/** Interruptor de los fixtures visuales. Solo aplica en desarrollo. */
export const DEMO_HISTORIAL = true;

/** `true` si corresponde mostrar fixtures en vez de un estado vacío. */
export function usarHistorialDemo() {
  return typeof __DEV__ !== 'undefined' && __DEV__ && DEMO_HISTORIAL;
}

/** Resultados posibles de un partido de club, desde la óptica de mi club. */
export const RESULTADO = {
  VICTORIA: 'V',
  EMPATE: 'E',
  DERROTA: 'D',
};

/** `matches.estado` → etiqueta que se muestra en la tarjeta del historial. */
const ESTADO_LABEL = {
  abierto: 'Abierto',
  lleno: 'Lleno',
  en_curso: 'En curso',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
};

/**
 * Partidos de club (ida y vuelta) de un club concreto.
 * @returns {{data: Array, error: any}} data: partidos normalizados.
 *
 * Forma de cada partido:
 *   { id, rivalNombre, rivalLogoUrl, miMarcador, suMarcador, fecha,
 *     estado, resultado, esDemo }
 */
export async function getClubMatchHistory(clubId, { limit = 20 } = {}) {
  if (!isSupabaseConfigured || !clubId) return { data: [], error: null };

  // `hora` es la fecha-hora del partido (timestamptz), ver supabase/schema.sql.
  const { data, error } = await supabase
    .from('matches')
    .select('id, titulo, hora, estado, club_local_id, club_visitante_id')
    .or(`club_local_id.eq.${clubId},club_visitante_id.eq.${clubId}`)
    .order('hora', { ascending: false })
    .limit(limit);

  if (error) {
    // Serializado: los errores de PostgREST se imprimen como [object Object]
    // en la consola web y no se puede diagnosticar nada.
    console.error(
      '[FutFinder] getClubMatchHistory:',
      error.code || '',
      error.message || JSON.stringify(error)
    );
    return { data: [], error };
  }
  if (!data || data.length === 0) return { data: [], error: null };

  // Nombres/logos de los clubes rivales, en una sola query.
  const rivalIds = data
    .map((m) => (m.club_local_id === clubId ? m.club_visitante_id : m.club_local_id))
    .filter(Boolean);

  let rivalById = new Map();
  if (rivalIds.length > 0) {
    const { data: clubs } = await supabase
      .from('clubs')
      .select('id, nombre, foto_url')
      .in('id', rivalIds);
    rivalById = new Map((clubs || []).map((c) => [c.id, c]));
  }

  return {
    data: data.map((m) => {
      const rivalId = m.club_local_id === clubId ? m.club_visitante_id : m.club_local_id;
      const rival = rivalById.get(rivalId);
      return {
        id: m.id,
        rivalNombre: rival?.nombre || 'Club rival',
        rivalLogoUrl: rival?.foto_url || null,
        // Sin marcador en la BD todavía (ver comentario de cabecera).
        miMarcador: null,
        suMarcador: null,
        fecha: m.hora,
        estado: ESTADO_LABEL[m.estado] || m.estado,
        resultado: null,
        esDemo: false,
      };
    }),
    error: null,
  };
}

/**
 * Fixtures visuales para validar el diseño del historial en desarrollo.
 * NO son datos reales y no se persisten en ninguna parte.
 */
export function getDemoMatchHistory() {
  return [
    {
      id: 'demo-1',
      rivalNombre: 'Deportivo Ñuñoa',
      rivalLogoUrl: null,
      miMarcador: 1,
      suMarcador: 0,
      fechaLabel: '28 jul',
      estado: 'Finalizado',
      resultado: RESULTADO.VICTORIA,
      esDemo: true,
    },
    {
      id: 'demo-2',
      rivalNombre: 'Atlético Maipú',
      rivalLogoUrl: null,
      miMarcador: 2,
      suMarcador: 3,
      fechaLabel: '14 jul',
      estado: 'Finalizado',
      resultado: RESULTADO.DERROTA,
      esDemo: true,
    },
    {
      id: 'demo-3',
      rivalNombre: 'Los Cóndores FC',
      rivalLogoUrl: null,
      miMarcador: 2,
      suMarcador: 2,
      fechaLabel: '02 jul',
      estado: 'Finalizado',
      resultado: RESULTADO.EMPATE,
      esDemo: true,
    },
  ];
}

/**
 * Récord V-E-D derivado de una lista de partidos.
 * Con partidos reales sin marcador, `resultado` es null y el récord queda
 * en 0-0-0 (que es la verdad hasta que existan marcadores).
 */
export function calcularRecord(partidos) {
  const record = { v: 0, e: 0, d: 0 };
  for (const p of partidos || []) {
    if (p.resultado === RESULTADO.VICTORIA) record.v += 1;
    else if (p.resultado === RESULTADO.EMPATE) record.e += 1;
    else if (p.resultado === RESULTADO.DERROTA) record.d += 1;
  }
  return record;
}

/** '2026-07-28T21:00:00Z' → '28 jul'. Usa `fechaLabel` si ya viene formateada. */
export function formatFechaCorta(partido) {
  if (partido.fechaLabel) return partido.fechaLabel;
  if (!partido.fecha) return '';
  try {
    return new Date(partido.fecha)
      .toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })
      .replace('.', '');
  } catch {
    return '';
  }
}
