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
 *   - region: string → solo partidos de esa región (null = cualquiera)
 *   - comuna: string → solo de esa comuna (null = cualquiera)
 *   - maxKm: number → solo si userCoords está presente
 *   - timeWindow: 'hoy' | 'manana' | 'finde' | 'todos'
 *   - niveles: ['recreativo','intermedio','competitivo'] o []
 *   - precioMin: number, precioMax: number
 * userCoords: { lat, lng } | null
 */
export function applyFilters(matches, filters, userCoords) {
  const text = (filters.text || '').toLowerCase().trim();
  const region = filters.region || null;
  const comunaF = filters.comuna || null;
  const niveles = filters.niveles || [];
  const timeWindow = filters.timeWindow || 'todos';
  const maxKm = filters.maxKm ?? null;
  const pMin = filters.precioMin ?? 0;
  const pMax = filters.precioMax ?? 999999;
  const durMin = filters.duracionMin ?? null;
  const durMax = filters.duracionMax ?? null;

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
    if (region && m.region !== region) return false;
    if (comunaF && m.comuna !== comunaF) return false;
    if (niveles.length > 0 && !niveles.includes(m.nivel)) return false;
    if (m.precio_cuota < pMin || m.precio_cuota > pMax) return false;
    if (durMin !== null || durMax !== null) {
      const d = m.duracion_min ?? null;
      if (d === null) return false; // sin duración cargada → no matchea filtro de duración
      if (durMin !== null && d < durMin) return false;
      if (durMax !== null && d > durMax) return false;
    }
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
  region,
  comuna,
  cancha_nombre,
  latitud,
  longitud,
  hora,
  cupos_totales,
  precio_cuota = 0,
  nivel = 'recreativo',
  descripcion = null,
  duracion_min = 90,
}) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo mode' } };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: { message: 'No autenticado' } };

  const { data, error } = await supabase
    .from('matches')
    .insert({
      id_organizador: user.id,
      titulo,
      region,
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
      duracion_min,
    })
    .select()
    .single();

  return { data, error };
}

/**
 * Trae un partido por id (para edición o detalle).
 */
export async function getMatchById(matchId) {
  if (!isSupabaseConfigured) return { data: null, error: null };
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .single();
  return { data, error };
}

/**
 * Actualiza un partido existente.
 * RLS solo permite al organizador.
 */
export async function updateMatch(matchId, patch) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  const allowed = [
    'titulo', 'region', 'comuna', 'cancha_nombre',
    'latitud', 'longitud', 'hora',
    'cupos_totales', 'cupos_disponibles',
    'precio_cuota', 'nivel', 'descripcion', 'estado', 'foto_url',
    'duracion_min',
  ];
  const payload = {};
  for (const k of allowed) {
    if (patch[k] !== undefined) payload[k] = patch[k];
  }
  const { data, error } = await supabase
    .from('matches')
    .update(payload)
    .eq('id', matchId)
    .select()
    .single();
  return { data, error };
}

/**
 * Elimina un partido. RLS solo permite al organizador.
 * El borrado en cascada elimina attendees y messages asociados.
 */
export async function deleteMatch(matchId) {
  if (!isSupabaseConfigured) return { error: { message: 'Demo' } };
  const { error } = await supabase
    .from('matches')
    .delete()
    .eq('id', matchId);
  if (error) console.error('[FutFinder] deleteMatch:', error);
  return { error };
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

/**
 * El usuario actual se sale del partido (libera cupo).
 * RLS: el organizador NO puede usar esto, debe eliminar el partido.
 */
export async function leaveMatch(matchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  const { data, error } = await supabase.rpc('leave_match', { p_match_id: matchId });
  if (error) return { ok: false, error };
  return data;
}

/**
 * Lista los jugadores inscritos en un partido con info de perfil.
 * Devuelve [{id, username, foto_url, trust_score, comuna, posicion_preferida, is_organizer, estado, inscrito_at}]
 */
export async function getMatchAttendees(matchId) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  try {
    // 1) Trae attendees
    const { data: atts, error: aErr } = await supabase
      .from('attendees')
      .select('id, id_jugador, estado, inscrito_at, confirmado_at')
      .eq('id_partido', matchId)
      .order('inscrito_at', { ascending: true });
    if (aErr) {
      console.error('[FutFinder] getMatchAttendees:', aErr);
      return { data: [], error: aErr };
    }

    // 2) Trae datos del match (para saber quién es organizador)
    const { data: match } = await supabase
      .from('matches')
      .select('id, titulo, comuna, cancha_nombre, hora, cupos_totales, cupos_disponibles, precio_cuota, nivel, descripcion, estado, id_organizador')
      .eq('id', matchId)
      .single();

    const playerIds = (atts || []).map((a) => a.id_jugador);
    if (playerIds.length === 0) {
      return { data: [], match, error: null };
    }

    // 3) Trae perfiles en una sola query
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, username, foto_url, trust_score, comuna, posicion_preferida')
      .in('id', playerIds);
    const byId = new Map((profs || []).map((p) => [p.id, p]));

    const list = (atts || []).map((a) => {
      const p = byId.get(a.id_jugador) || {};
      return {
        attendee_id: a.id,
        user_id: a.id_jugador,
        username: p.username || 'jugador',
        foto_url: p.foto_url || null,
        trust_score: p.trust_score ?? 100,
        comuna: p.comuna,
        posicion_preferida: p.posicion_preferida,
        is_organizer: a.id_jugador === match?.id_organizador,
        estado: a.estado,
        inscrito_at: a.inscrito_at,
        confirmado_at: a.confirmado_at,
      };
    });

    return { data: list, match, error: null };
  } catch (e) {
    console.error('[FutFinder] getMatchAttendees exception:', e);
    return { data: [], error: e };
  }
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
