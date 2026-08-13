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

  // Mostramos solo partidos cuya hora oficial todavía NO haya pasado.
  // Una vez que `hora` pasa, el partido desaparece de Buscar y de Inicio.
  // El chat sigue activo para los inscritos (ChatThreadScreen maneja el
  // estado post-partido).
  const ahora = new Date().toISOString();

  let q = supabase
    .from('matches')
    .select('*')
    .eq('estado', 'abierto')
    .gt('hora', ahora)
    .order('hora', { ascending: true })
    .limit(limit);

  if (comuna) q = q.eq('comuna', comuna);
  const { data, error } = await q;
  if (error) {
    console.error('[FutFinder] listOpenMatches error:', error);
    return { data: [], error };
  }
  return { data: await withClubs(await withOrganizers(data)), error: null };
}

/**
 * Adjunta `organizador: { username, foto_url, trust_score }` a una lista de
 * partidos con una sola consulta. Las tarjetas del listado necesitan mostrar
 * quién organiza, y sin esto haría una consulta por tarjeta.
 */
export async function withOrganizers(matches) {
  const list = matches || [];
  if (!isSupabaseConfigured || list.length === 0) return list;
  const ids = [...new Set(list.map((m) => m.id_organizador).filter(Boolean))];
  if (!ids.length) return list;
  const { data: profs } = await supabase
    .from('profiles')
    .select('id, username, foto_url, trust_score')
    .in('id', ids);
  const byId = new Map((profs || []).map((p) => [p.id, p]));
  return list.map((m) => ({ ...m, organizador: byId.get(m.id_organizador) || null }));
}

/**
 * Adjunta los dos clubes a los partidos que enfrentan clubes.
 *
 * Una sola consulta para toda la lista, no una por partido. Los partidos
 * normales pasan intactos y sin coste: si en la tanda no hay ninguno de
 * clubes, no se consulta nada.
 *
 * Si el club fue borrado, la fila llega sin él y `clubesDelPartido()` pone un
 * nombre genérico: media tarjeta vacía se ve rota.
 */
export async function withClubs(matches) {
  const list = matches || [];
  if (!isSupabaseConfigured || list.length === 0) return list;

  const ids = [
    ...new Set(list.flatMap((m) => [m.club_local_id, m.club_visitante_id]).filter(Boolean)),
  ];
  if (!ids.length) return list;

  const { data: clubs } = await supabase
    .from('clubs')
    .select('id, nombre, foto_url')
    .in('id', ids);

  const byId = new Map((clubs || []).map((c) => [c.id, c]));
  return list.map((m) =>
    m.club_local_id || m.club_visitante_id
      ? {
          ...m,
          club_local: byId.get(m.club_local_id) || null,
          club_visitante: byId.get(m.club_visitante_id) || null,
        }
      : m
  );
}

/**
 * La ubicación exacta de un partido nacido de un desafío entre clubes.
 *
 * Vive en `club_match_locations` (migración 44b), fuera de `matches`, porque
 * `matches` es de lectura pública y la dirección de estos partidos es de los
 * integrantes de los dos clubes.
 *
 * LO QUE PROTEGE NO ES ESTA FUNCIÓN, ES LA RLS. A quien no le corresponde, la
 * consulta le devuelve cero filas: no hay nada que esconder después. Por eso
 * «no soy del club» y «este partido no tiene ubicación guardada» llegan aquí
 * de la misma forma —`{ data: null }`— y la pantalla no necesita distinguirlos
 * para decidir qué dibujar.
 *
 * Sólo se pregunta por los partidos protegidos: para un partido normal la
 * dirección viene en la propia fila y esta consulta sería un viaje perdido.
 */
export async function getClubMatchLocation(matchId) {
  if (!isSupabaseConfigured || !matchId) return { data: null, error: null };

  const { data, error } = await supabase
    .from('club_match_locations')
    .select('match_id, direccion, latitud, longitud')
    .eq('match_id', matchId)
    .maybeSingle();

  if (error) {
    // Sin la migración 44b la tabla no existe: la pantalla se dibuja igual,
    // sólo que sin dirección exacta. No es motivo para dejarla en blanco.
    if (['42P01', 'PGRST205'].includes(error.code) || /does not exist/i.test(error.message || '')) {
      return { data: null, error: null };
    }
    console.error('[FutFinder] getClubMatchLocation:', error);
    return { data: null, error };
  }
  return { data: data || null, error: null };
}

/**
 * Trae los partidos abiertos cuyas coordenadas están dentro de un cuadrante
 * (bounding box) — usado por el mapa de la pestaña Buscar al moverlo.
 */
export async function listMatchesInBounds({
  minLat,
  maxLat,
  minLng,
  maxLng,
  limit = 100,
} = {}) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  if ([minLat, maxLat, minLng, maxLng].some((v) => v == null)) {
    return { data: [], error: null };
  }

  const ahora = new Date().toISOString();
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .eq('estado', 'abierto')
    .gt('hora', ahora)
    .gte('latitud', minLat)
    .lte('latitud', maxLat)
    .gte('longitud', minLng)
    .lte('longitud', maxLng)
    .not('latitud', 'is', null)
    .not('longitud', 'is', null)
    .order('hora', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[FutFinder] listMatchesInBounds:', error);
    return { data: [], error };
  }
  return { data: await withClubs(await withOrganizers(data)), error: null };
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
 * Filtro del listado de Partidos rediseñado.
 *
 * Recibe el objeto de filtros de `FiltersSheet` (`EMPTY_FILTERS`) y devuelve la
 * lista enriquecida con `_distanciaKm`, ya ordenada: por cercanía cuando hay
 * ubicación y por hora cuando no.
 *
 * Reglas de los filtros que dependen de datos opcionales:
 *   · modalidad: los partidos antiguos sin `modalidad` no se descartan cuando
 *     el usuario no filtra por modalidad, pero sí quedan fuera si la filtra.
 *   · rango de edad: un partido «sin restricción» siempre entra, porque acepta
 *     a cualquiera.
 */
export function filterMatches(matches, f = {}, userCoords = null) {
  const text = (f.text || '').toLowerCase().trim();
  const enriched = (matches || []).map((m) => ({
    ...m,
    _distanciaKm: userCoords
      ? haversineKm(userCoords, { lat: Number(m.latitud), lng: Number(m.longitud) })
      : null,
  }));

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startTomorrow = new Date(startOfDay);
  startTomorrow.setDate(startTomorrow.getDate() + 1);
  const endTomorrow = new Date(startTomorrow);
  endTomorrow.setDate(endTomorrow.getDate() + 1);
  const daysToSat = (6 - now.getDay() + 7) % 7;
  const startSat = new Date(startOfDay);
  startSat.setDate(startSat.getDate() + daysToSat);
  const endSun = new Date(startSat);
  endSun.setDate(endSun.getDate() + 2);

  const inWindow = (hora) => {
    const h = new Date(hora);
    switch (f.fecha) {
      case 'hoy':
        return h >= now && h < startTomorrow;
      case 'manana':
        return h >= startTomorrow && h < endTomorrow;
      case 'finde':
        return h >= startSat && h < endSun;
      default:
        return true;
    }
  };

  const edadRange = resolveEdadFilter(f);

  const out = enriched.filter((m) => {
    if (text) {
      const hay =
        (m.titulo || '').toLowerCase().includes(text) ||
        (m.cancha_nombre || '').toLowerCase().includes(text) ||
        (m.comuna || '').toLowerCase().includes(text) ||
        (m.direccion || '').toLowerCase().includes(text);
      if (!hay) return false;
    }
    if (f.region && m.region !== f.region) return false;
    if (f.comuna && m.comuna !== f.comuna) return false;
    if (f.modalidad && m.modalidad !== f.modalidad) return false;
    if (f.nivel && m.nivel !== f.nivel) return false;
    if (f.disponibilidad === 'con_cupos' && (m.cupos_disponibles ?? 0) <= 0) return false;
    if (f.cuota) {
      const p = Number(m.precio_cuota || 0);
      if (p < f.cuota.min || p > f.cuota.max) return false;
    }
    if (edadRange) {
      const mMin = m.edad_min ?? null;
      const mMax = m.edad_max ?? null;
      // Un partido sin restricción acepta a cualquiera → siempre entra.
      const abierto = mMin == null && mMax == null;
      if (!abierto) {
        const noSolapa =
          (edadRange.max != null && mMin != null && mMin > edadRange.max) ||
          (edadRange.min != null && mMax != null && mMax < edadRange.min);
        if (noSolapa) return false;
      }
    }
    if (!inWindow(m.hora)) return false;
    if (f.maxKm != null && m._distanciaKm != null && m._distanciaKm > f.maxKm) return false;
    return true;
  });

  return out.sort((a, b) => {
    if (userCoords && a._distanciaKm != null && b._distanciaKm != null) {
      return a._distanciaKm - b._distanciaKm;
    }
    return new Date(a.hora) - new Date(b.hora);
  });
}

/** Traduce el preset/rango personalizado de edad del filtro a `{min,max}`. */
function resolveEdadFilter(f) {
  if (f.edadPreset === -1) {
    const min = f.edadMin === '' || f.edadMin == null ? null : Number(f.edadMin);
    const max = f.edadMax === '' || f.edadMax == null ? null : Number(f.edadMax);
    if (min == null && max == null) return null;
    return { min, max };
  }
  const presets = [
    null,
    { min: 18, max: 25 },
    { min: 18, max: 35 },
    { min: 25, max: 45 },
    { min: 35, max: 99 },
  ];
  return presets[f.edadPreset ?? 0] || null;
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
  direccion = null,
  latitud,
  longitud,
  hora,
  cupos_totales,
  precio_cuota = 0,
  nivel = 'recreativo',
  descripcion = null,
  duracion_min = 90,
  aprobacion = 'inmediata',
  min_trust_score = 0,
  modalidad = null,
  edad_min = null,
  edad_max = null,
  recordatorio_1h = true,
  pedir_asistencia = true,
  /**
   * Token generado por el cliente antes del primer intento. Hace la
   * publicación idempotente: si el usuario toca dos veces «Publicar» o se
   * reintenta por timeout, el segundo insert choca con el índice único y
   * devolvemos el partido que ya existe en vez de crear un duplicado.
   */
  client_token = null,
  // Partido de clubes (null = partido normal)
  club_local_id = null,
  club_visitante_id = null,
  challenge_id = null,
}) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo mode' } };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: { message: 'No autenticado' } };

  const payload = {
    id_organizador: user.id,
    titulo,
    region,
    comuna,
    cancha_nombre,
    direccion,
    latitud,
    longitud,
    hora,
    cupos_totales,
    cupos_disponibles: cupos_totales,
    precio_cuota,
    nivel,
    descripcion,
    duracion_min,
    aprobacion,
    min_trust_score,
    modalidad,
    edad_min,
    edad_max,
    recordatorio_1h,
    pedir_asistencia,
    club_local_id,
    club_visitante_id,
    challenge_id,
  };
  if (client_token) payload.client_token = client_token;

  const { data, error } = await supabase
    .from('matches')
    .insert(payload)
    .select()
    .single();

  // 23505 = unique_violation → ya se publicó con este token, lo recuperamos.
  if (error && client_token && (error.code === '23505' || /duplicate key/i.test(error.message || ''))) {
    const { data: existing } = await supabase
      .from('matches')
      .select('*')
      .eq('client_token', client_token)
      .maybeSingle();
    if (existing) return { data: existing, error: null, duplicate: true };
  }

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
    'titulo', 'region', 'comuna', 'cancha_nombre', 'direccion',
    'latitud', 'longitud', 'hora',
    'cupos_totales', 'cupos_disponibles',
    'precio_cuota', 'nivel', 'descripcion', 'estado', 'foto_url',
    'duracion_min', 'aprobacion', 'min_trust_score',
    'modalidad', 'edad_min', 'edad_max',
    'recordatorio_1h', 'pedir_asistencia', 'motivo_cancelacion',
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
  if (error) return { ok: false, reason: translateJoinError(error.message), error };
  return data; // { ok: true } o { ok: false, reason }
}

/**
 * Traduce los errores de esquema de PostgREST a algo accionable.
 *
 * Si la migración 33 no está aplicada en la base de datos, PostgREST responde
 * «Could not find the 'modalidad' column of 'matches' in the schema cache»,
 * que no le dice nada a nadie. Este helper lo convierte en la instrucción real.
 */
export function translateSchemaError(error) {
  if (!error) return null;
  const msg = String(error.message || '');
  const m = msg.match(/Could not find the '([^']+)' column of '([^']+)'/i);
  if (!m) return null;
  const columnasNuevas = [
    'modalidad', 'edad_min', 'edad_max', 'recordatorio_1h',
    'pedir_asistencia', 'motivo_cancelacion', 'client_token',
  ];
  if (columnasNuevas.includes(m[1])) {
    return `Falta aplicar la migración «33_partidos_flujo_completo.sql» en Supabase: la tabla ${m[2]} todavía no tiene la columna ${m[1]}.`;
  }
  return `La base de datos no tiene la columna ${m[1]} en ${m[2]}. Revisa las migraciones pendientes.`;
}

/**
 * Igual que `translateSchemaError`, pero para las RPC que puede que no existan
 * todavía (lista de espera, asistencia).
 */
export function translateMissingRpcError(error) {
  if (!error) return null;
  const msg = String(error.message || '');
  if (/Could not find the function|does not exist/i.test(msg)) {
    return 'Esta acción necesita la migración «33_partidos_flujo_completo.sql» aplicada en Supabase.';
  }
  return null;
}

// Traduce las excepciones del trigger tg_enforce_join_rules a mensajes legibles.
function translateJoinError(msg = '') {
  if (msg.includes('SUSPENDIDO')) {
    return 'Tu cuenta está suspendida temporalmente y no puede unirse a partidos.';
  }
  if (msg.includes('CHOQUE_HORARIO')) {
    return 'Ya tienes un partido a esta hora.';
  }
  const m = msg.match(/TRUST_BAJO:(\d+):(\d+)/);
  if (m) {
    return `Trust Score insuficiente: este partido pide ${m[2]} y tú tienes ${m[1]}.`;
  }
  return null;
}

/**
 * Devuelve si el partido choca con otro en el que el usuario ya está inscrito.
 *   { conflict: false } | { conflict: true, matchId, titulo, hora, canSwap }
 */
export async function getScheduleConflict(matchId) {
  if (!isSupabaseConfigured) return { conflict: false };
  const { data, error } = await supabase.rpc('get_schedule_conflict', {
    p_match_id: matchId,
  });
  if (error) {
    console.warn('[FutFinder] getScheduleConflict:', error);
    return { conflict: false };
  }
  return data || { conflict: false };
}

/**
 * Sale del partido viejo e inscribe en el nuevo en un solo flujo.
 * Devuelve { ok, pending?, reason? }.
 */
export async function swapMatch(oldMatchId, newMatchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  const { data, error } = await supabase.rpc('swap_match', {
    p_old: oldMatchId,
    p_new: newMatchId,
  });
  if (error) return { ok: false, reason: translateJoinError(error.message), error };
  return data;
}

/**
 * Salir de un partido con penalización por tiempo (jugador).
 * Devuelve { ok, penalty, freed, reason? }.
 */
export async function leaveMatchPenalized(matchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true, penalty: 0 };
  const { data, error } = await supabase.rpc('leave_match_penalized', {
    p_match_id: matchId,
  });
  if (error) return { ok: false, error };
  return data;
}

/**
 * Cancelar un partido con penalización por tiempo (anfitrión).
 * Devuelve { ok, penalty, reason? }.
 */
export async function cancelMatch(matchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true, penalty: 0 };
  const { data, error } = await supabase.rpc('cancel_match', {
    p_match_id: matchId,
  });
  if (error) return { ok: false, error };
  return data;
}

/**
 * El anfitrión cancela su partido original (penalización -25) y se une al nuevo.
 * Devuelve { ok, pending?, reason? }.
 */
export async function cancelMatchAndJoin(oldMatchId, newMatchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  const { data, error } = await supabase.rpc('cancel_match_and_join', {
    p_old: oldMatchId,
    p_new: newMatchId,
  });
  if (error) return { ok: false, reason: translateJoinError(error.message), error };
  return data;
}

/**
 * Solicita unirse a un partido con aprobación MANUAL.
 * Crea un attendee en estado 'pendiente' (sin descontar cupo) y
 * notifica al anfitrión. Usa la RPC request_join.
 */
export async function requestJoinMatch(matchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  const { data, error } = await supabase.rpc('request_join', { p_match_id: matchId });
  if (error) return { ok: false, reason: translateJoinError(error.message), error };
  return data; // { ok, reason? }
}

/**
 * El anfitrión aprueba una solicitud pendiente.
 * Pasa al jugador a 'inscrito', descuenta cupo y le notifica.
 */
export async function approveJoinRequest(matchId, playerId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  const { data, error } = await supabase.rpc('approve_join', {
    p_match_id: matchId,
    p_player_id: playerId,
  });
  if (error) return { ok: false, error };
  return data;
}

/**
 * El anfitrión rechaza una solicitud pendiente (la borra) y notifica al jugador.
 */
export async function rejectJoinRequest(matchId, playerId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  const { data, error } = await supabase.rpc('reject_join', {
    p_match_id: matchId,
    p_player_id: playerId,
  });
  if (error) return { ok: false, error };
  return data;
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

    // 2) Trae datos del match (para saber quién es organizador).
    //    Va con `*` a propósito: el detalle, la gestión y la edición necesitan
    //    todas las columnas (modalidad, rango de edad, coordenadas, duración,
    //    aprobación, recordatorios, motivo de cancelación…). Con una lista fija
    //    la pantalla caía en valores por defecto y mostraba datos que no eran
    //    los del partido.
    const { data: match } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();

    // Los dos clubes, si el partido enfrenta clubes: el detalle los necesita
    // para el encabezado con escudos y nombres.
    const [conClubes] = await withClubs(match ? [match] : []);
    const matchConClubes = conClubes || match;

    const playerIds = (atts || []).map((a) => a.id_jugador);
    if (playerIds.length === 0) {
      return { data: [], match: matchConClubes, error: null };
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

    return { data: list, match: matchConClubes, error: null };
  } catch (e) {
    console.error('[FutFinder] getMatchAttendees exception:', e);
    return { data: [], error: e };
  }
}

/**
 * Cancela el partido y deja el motivo visible para los jugadores.
 *
 * NO borra el registro: `cancel_match` cambia `estado` a 'cancelado' para que
 * el partido siga en el historial y el chat quede en solo lectura.
 */
export async function cancelMatchWithReason(matchId, motivo = null) {
  // El motivo se escribe ANTES de cancelar. La RPC `cancel_match` que está
  // corriendo en la base es una versión anterior a este repo (la migración 33
  // no la sobrescribe a propósito) y no sabemos con certeza si cambia el
  // `estado` o borra la fila. Escribiendo primero, el motivo queda guardado en
  // el caso en que el registro sobreviva, y no se pierde nada si no.
  if (motivo && isSupabaseConfigured) {
    await supabase
      .from('matches')
      .update({ motivo_cancelacion: motivo })
      .eq('id', matchId);
  }

  const res = await cancelMatch(matchId);
  if (!res?.ok) return res;

  // ¿Quedó como 'cancelado' en el historial, o desapareció?
  let survived = true;
  if (isSupabaseConfigured) {
    const { data } = await supabase
      .from('matches')
      .select('id, estado')
      .eq('id', matchId)
      .maybeSingle();
    survived = !!data;
  }
  return { ...res, survived };
}

/**
 * El jugador retira su propia solicitud pendiente (aprobación manual).
 * No toca cupos porque una solicitud pendiente nunca reservó uno.
 */
export async function cancelMyJoinRequest(matchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'No autenticado' };
  const { error } = await supabase
    .from('attendees')
    .delete()
    .eq('id_partido', matchId)
    .eq('id_jugador', user.id)
    .eq('estado', 'pendiente');
  if (error) return { ok: false, error };
  return { ok: true };
}

/**
 * Solicitudes pendientes de un partido, con la info que el organizador
 * necesita para decidir: posición, Trust Score e historial disponible.
 */
export async function getMatchRequests(matchId) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  const { data: atts, error } = await supabase
    .from('attendees')
    .select('id, id_jugador, inscrito_at')
    .eq('id_partido', matchId)
    .eq('estado', 'pendiente')
    .order('inscrito_at', { ascending: true });
  if (error) return { data: [], error };
  const ids = (atts || []).map((a) => a.id_jugador);
  if (!ids.length) return { data: [], error: null };

  const { data: profs } = await supabase
    .from('profiles')
    .select('id, username, foto_url, trust_score, edad, comuna, posicion_preferida, partidos_jugados, asistencias_confirmadas')
    .in('id', ids);
  const byId = new Map((profs || []).map((p) => [p.id, p]));

  return {
    data: (atts || []).map((a) => {
      const p = byId.get(a.id_jugador) || {};
      return {
        attendee_id: a.id,
        user_id: a.id_jugador,
        username: p.username || 'jugador',
        foto_url: p.foto_url || null,
        trust_score: p.trust_score ?? null,
        edad: p.edad ?? null,
        comuna: p.comuna || null,
        posicion_preferida: p.posicion_preferida || null,
        partidos_jugados: p.partidos_jugados ?? 0,
        asistencias_confirmadas: p.asistencias_confirmadas ?? 0,
        solicitado_at: a.inscrito_at,
      };
    }),
    error: null,
  };
}

// ------------------------------------------------------ lista de espera

/** Cola de espera del partido, en orden de llegada. */
export async function getWaitlist(matchId) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  const { data, error } = await supabase
    .from('match_waitlist')
    .select('id, id_jugador, created_at, avisado_at, confirmar_antes_de')
    .eq('id_partido', matchId)
    .order('created_at', { ascending: true });
  if (error) return { data: [], error };
  const ids = (data || []).map((w) => w.id_jugador);
  if (!ids.length) return { data: [], error: null };
  const { data: profs } = await supabase
    .from('profiles')
    .select('id, username, foto_url, trust_score')
    .in('id', ids);
  const byId = new Map((profs || []).map((p) => [p.id, p]));
  return {
    data: (data || []).map((w, i) => {
      const p = byId.get(w.id_jugador) || {};
      return {
        id: w.id,
        user_id: w.id_jugador,
        posicion: i + 1,
        username: p.username || 'jugador',
        foto_url: p.foto_url || null,
        trust_score: p.trust_score ?? null,
        avisado_at: w.avisado_at,
        confirmar_antes_de: w.confirmar_antes_de,
      };
    }),
    error: null,
  };
}

/** Entra a la lista de espera. Devuelve `{ ok, posicion }`. */
export async function joinWaitlist(matchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true, posicion: 1 };
  const { data, error } = await supabase.rpc('join_waitlist', { p_match_id: matchId });
  if (error) {
    return {
      ok: false,
      reason: translateMissingRpcError(error) || translateJoinError(error.message),
      error,
    };
  }
  return data;
}

/** Sale de la lista de espera. No afecta el Trust Score. */
export async function leaveWaitlist(matchId) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  const { data, error } = await supabase.rpc('leave_waitlist', { p_match_id: matchId });
  if (error) return { ok: false, reason: translateMissingRpcError(error), error };
  return data;
}

// ---------------------------------------------------------- asistencia

/**
 * El organizador guarda la asistencia del partido.
 * `marks` = { [userId]: 'presente' | 'ausente' }.
 *
 * La RPC valida que quien llama sea el organizador, que el partido haya
 * terminado y aplica el efecto en el Trust Score de cada jugador.
 */
export async function saveMatchAttendance(matchId, marks) {
  if (!isSupabaseConfigured) return { ok: true, demo: true };
  const { data, error } = await supabase.rpc('save_match_attendance', {
    p_match_id: matchId,
    p_marks: marks,
  });
  if (error) return { ok: false, reason: translateMissingRpcError(error), error };
  return data;
}

/**
 * Cuántos partidos abiertos cerca no exigen Trust Score mínimo.
 * Sirve para la alternativa honesta de la pantalla de bloqueo.
 */
export async function countMatchesWithoutMinTrust({ region = null } = {}) {
  if (!isSupabaseConfigured) return 0;
  let q = supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'abierto')
    .gt('hora', new Date().toISOString())
    .gt('cupos_disponibles', 0)
    .or('min_trust_score.is.null,min_trust_score.eq.0');
  if (region) q = q.eq('region', region);
  const { count } = await q;
  return count || 0;
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
