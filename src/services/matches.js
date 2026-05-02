import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Distancia haversine en km entre dos coords {lat, lng}.
 * Útil para ordenar y filtrar partidos del lado del cliente.
 */
export function haversineKm(a, b) {
  if (!a || !b) return null;
  const R = 6371; // km
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Lista partidos abiertos cerca del usuario, ordenados por hora.
 * Si pasas comuna filtra por comuna.
 */
export async function listOpenMatches({ comuna = null, limit = 50 } = {}) {
  if (!isSupabaseConfigured) return { data: getDemoMatches(), error: null };

  // Mostramos partidos abiertos cuya hora oficial sea hace ≤ 2 horas
  // (siguen siendo válidos para confirmar asistencia hasta 90 min después).
  const dosHorasAtras = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  let q = supabase
    .from('matches')
    .select('*')
    .eq('estado', 'abierto')
    .gte('hora', dosHorasAtras)
    .order('hora', { ascending: true })
    .limit(limit);

  if (comuna) q = q.eq('comuna', comuna);
  const { data, error } = await q;
  if (error) {
    console.error('[FutFinder] listOpenMatches error:', error);
  }
  return { data: data || [], error };
}

/**
 * Filtra una lista de partidos por criterios del usuario y los enriquece
 * con la distancia calculada desde sus coordenadas (si vienen).
 *
 * filters:
 *   - text: string  → busca en titulo, cancha_nombre, comuna
 *   - maxKm: number → solo si userCoords está presente
 *   - timeWindow: 'hoy' | 'manana' | 'finde' | 'todos'
 *   - niveles: ['recreativo','intermedio','competitivo'] o []
 *   - precioMin: number, precioMax: number
 * userCoords: { lat, lng } | null
 */
export function applyFilters(matches, filters, userCoords) {
  const text = (filters.text || '').toLowerCase().trim();
  const niveles = filters.niveles || [];
  const timeWindow = filters.timeWindow || 'todos';
  const maxKm = filters.maxKm ?? null;
  const pMin = filters.precioMin ?? 0;
  const pMax = filters.precioMax ?? 999999;

  // Pre-calculamos distancia para todos
  const enriched = matches.map((m) => {
    const km = userCoords
      ? haversineKm(userCoords, { lat: m.latitud, lng: m.longitud })
      : null;
    return { ...m, _distanciaKm: km };
  });

  // Ventana horaria
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startTomorrow = new Date(startOfDay);
  startTomorrow.setDate(startTomorrow.getDate() + 1);
  const endTomorrow = new Date(startTomorrow);
  endTomorrow.setDate(endTomorrow.getDate() + 1);
  const dayOfWeek = now.getDay(); // 0=dom 6=sáb
  const daysToSat = (6 - dayOfWeek + 7) % 7;
  const startSat = new Date(startOfDay);
  startSat.setDate(startSat.getDate() + daysToSat);
  const endSun = new Date(startSat);
  endSun.setDate(endSun.getDate() + 2);

  function inWindow(matchHora) {
    const h = new Date(matchHora);
    if (timeWindow === 'todos') return true;
    if (timeWindow === 'hoy') return h >= now && h < startTomorrow;
    if (timeWindow === 'manana') return h >= startTomorrow && h < endTomorrow;
    if (timeWindow === 'finde') return h >= startSat && h < endSun;
    return true;
  }

  return enriched.filter((m) => {
    if (text) {
      const hay =
        (m.titulo || '').toLowerCase().includes(text) ||
        (m.cancha_nombre || '').toLowerCase().includes(text) ||
        (m.comuna || '').toLowerCase().includes(text);
      if (!hay) return false;
    }
    if (niveles.length > 0 && !niveles.includes(m.nivel)) return false;
    if (m.precio_cuota < pMin || m.precio_cuota > pMax) return false;
    if (!inWindow(m.hora)) return false;
    if (maxKm !== null && m._distanciaKm !== null && m._distanciaKm > maxKm) return false;
    return true;
  });
}

/**
 * Crea un nuevo partido.
 * El organizador es el usuario autenticado.
 */
export async function createMatch({
  titulo,
  comuna,
  cancha_nombre,
  latitud,
  longitud,
  hora,
  cupos_totales,
  precio_cuota = 0,
  nivel = 'recreativo',
  descripcion = null,
}) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo mode' } };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: { message: 'No autenticado' } };

  const { data, error } = await supabase
    .from('matches')
    .insert({
      id_organizador: user.id,
      titulo,
      comuna,
      cancha_nombre,
      latitud,
      longitud,
      hora,
      cupos_totales,
      cupos_disponibles: cupos_totales,
      precio_cuota,
      nivel,
      descripcion,
    })
    .select()
    .single();

  return { data, error };
}

/**
 * El usuario actual se inscribe a un partido.
 * Usa la función RPC join_match (atómica, decrementa cupo).
 */
export async function joinMatch(matchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  const { data, error } = await supabase.rpc('join_match', { p_match_id: matchId });
  if (error) return { ok: false, error };
  return data; // { ok: true } o { ok: false, reason }
}

// ----- Datos de demo (cuando Supabase no está configurado todavía) -----
function getDemoMatches() {
  const now = Date.now();
  return [
    {
      id: 'demo-1',
      titulo: 'Partido en Estadio Nacional',
      comuna: 'Ñuñoa',
      cancha_nombre: 'Complejo Ñuñoa · Cancha 3',
      latitud: -33.4569,
      longitud: -70.6107,
      hora: new Date(now + 5 * 3600 * 1000).toISOString(),
      cupos_disponibles: 2,
      cupos_totales: 10,
      precio_cuota: 3500,
      nivel: 'intermedio',
      organizador: { username: 'demo_user', trust_score: 92 },
    },
    {
      id: 'demo-2',
      titulo: 'Pichanga Las Condes',
      comuna: 'Las Condes',
      cancha_nombre: 'Club Manquehue · Cancha A',
      latitud: -33.4172,
      longitud: -70.5631,
      hora: new Date(now + 28 * 3600 * 1000).toISOString(),
      cupos_disponibles: 6,
      cupos_totales: 12,
      precio_cuota: 4200,
      nivel: 'recreativo',
      organizador: { username: 'demo_user', trust_score: 88 },
    },
  ];
}
