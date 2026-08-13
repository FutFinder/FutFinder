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

  // NO se lee `matches`. Desde la migración 44d los partidos entre clubes son
  // privados hasta que terminan: sólo los ven los integrantes de los dos
  // clubes, y consultar la tabla desde el perfil público de un club devolvería
  // cero filas a cualquiera que no sea de la casa.
  //
  // El historial público sale de `historial_publico_club()`, una proyección
  // que expone SÓLO clubes, día, marcador y resultado — nunca cancha, hora
  // exacta, cuota, cupos, nómina ni ubicación— y sólo de partidos
  // `finalizado`: los cancelados y los no disputados no se publican.
  const { data, error } = await supabase.rpc('historial_publico_club', {
    p_club_id: clubId,
    p_limit: limit,
  });

  if (error) {
    // Serializado: los errores de PostgREST se imprimen como [object Object]
    // en la consola web y no se puede diagnosticar nada.
    console.error(
      '[FutFinder] getClubMatchHistory:',
      error.code || '',
      error.message || JSON.stringify(error)
    );
    // Sin la migración 44d la función no existe todavía: el perfil del club se
    // dibuja igual, con el historial vacío, en vez de romperse.
    if (['42883', 'PGRST202'].includes(error.code)) return { data: [], error: null };
    return { data: [], error };
  }
  if (!data || data.length === 0) return { data: [], error: null };

  return {
    data: data.map((m) => {
      const soyLocal = m.club_local_id === clubId;
      return {
        id: m.match_id,
        rivalNombre: (soyLocal ? m.club_visitante_nombre : m.club_local_nombre) || 'Club rival',
        // La proyección pública no expone escudos: el perfil del club ya los
        // tiene cuando hace falta, y pedirlos aquí sería una consulta más.
        rivalLogoUrl: null,
        miMarcador: soyLocal ? m.goles_local : m.goles_visitante,
        suMarcador: soyLocal ? m.goles_visitante : m.goles_local,
        fecha: m.fecha,
        estado: ESTADO_LABEL.finalizado,
        resultado: m.resultado,
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
