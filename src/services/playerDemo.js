/**
 * Fixtures de DESARROLLO para validar el diseño del perfil.
 *
 * Existen porque los tres estados del diseño no se pueden ver con datos reales
 * en una cuenta nueva: el perfil vacío sí, el completo no.
 *
 * REGLAS:
 *  - Solo se activan con `__DEV__` Y con DEMO_PERFIL en true. En producción
 *    (`expo export`) `__DEV__` es false y este módulo nunca se usa.
 *  - No se escriben en la base de datos. Son objetos en memoria.
 *  - Cuando hay datos reales, los datos reales SIEMPRE ganan.
 *
 * CÓMO PROBAR LOS TRES ESTADOS:
 *  1. Perfil completo → pon DEMO_PERFIL en true y abre la pestaña Perfil.
 *  2. Perfil nuevo    → deja DEMO_PERFIL en false con una cuenta recién creada.
 *  3. Perfil ajeno    → abre otro jugador (búsqueda, chat, miembros de un club).
 */

/** Interruptor manual. Ponlo en true solo para revisar el diseño. */
export const DEMO_PERFIL = false;

/** `true` si corresponde usar los fixtures en vez de los datos reales. */
export function usarPerfilDemo() {
  return typeof __DEV__ !== 'undefined' && __DEV__ && DEMO_PERFIL;
}

/** Perfil completo de ejemplo, con la forma exacta de la tabla `profiles`. */
export function getDemoProfile(base) {
  return {
    ...base,
    username: base?.username || 'vicente22',
    foto_url: null,
    banner_url: null,
    comuna: 'Ñuñoa',
    region: 'Región Metropolitana de Santiago',
    bio:
      'Delantero desde los 12 años. Juego fútbol 7 los martes y jueves en Ñuñoa. ' +
      'Busco equipo estable para la liga de invierno y partidos amistosos los fines de semana.',
    posicion_preferida: ['delantero'],
    modalidad: 'futbol7',
    nivel: 'B',
    trust_score: 92,
    asistencias_confirmadas: 12,
    mvps: 3,
  };
}

/** Historial de ejemplo con los tres estados visuales del diseño. */
export function getDemoHistory() {
  const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString();
  const dentroDe = (dias) => new Date(Date.now() + dias * 86400000).toISOString();

  return [
    {
      id: 'demo-h1',
      estado: 'confirmado_gps',
      inscrito_at: hace(9),
      confirmado_at: hace(7),
      match: {
        id: 'demo-m1',
        titulo: 'Mixto Ñuñoa · 3 - 2',
        cancha_nombre: 'Cancha Los Robles',
        comuna: 'Ñuñoa',
        hora: hace(7),
        estado: 'finalizado',
      },
    },
    {
      id: 'demo-h2',
      estado: 'inscrito',
      inscrito_at: hace(2),
      confirmado_at: null,
      match: {
        id: 'demo-m2',
        titulo: 'Amistoso Providencia',
        cancha_nombre: 'Estadio Municipal',
        comuna: 'Providencia',
        hora: dentroDe(4),
        estado: 'abierto',
      },
    },
    {
      id: 'demo-h3',
      estado: 'confirmado_gps',
      inscrito_at: hace(24),
      confirmado_at: hace(21),
      match: {
        id: 'demo-m3',
        titulo: 'Liga barrial · 1 - 1',
        cancha_nombre: null,
        comuna: 'Ñuñoa',
        hora: hace(21),
        estado: 'finalizado',
      },
    },
    {
      id: 'demo-h4',
      estado: 'no_asistio',
      inscrito_at: hace(32),
      confirmado_at: null,
      match: {
        id: 'demo-m4',
        titulo: 'Copa Maipú',
        cancha_nombre: 'Complejo Maipú',
        comuna: 'Maipú',
        hora: hace(30),
        estado: 'finalizado',
      },
    },
  ];
}

/** Resumen de valoraciones de ejemplo (forma de getUserRatingSummary). */
export function getDemoRatingSummary() {
  return {
    avg_puntualidad: 4.7,
    avg_fairplay: 4.6,
    avg_nivel: 4.5,
    count: 24,
    overall: 4.6,
  };
}
