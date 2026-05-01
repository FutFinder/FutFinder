import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Lista partidos abiertos cerca del usuario, ordenados por hora.
 * Si pasas comuna filtra por comuna.
 */
export async function listOpenMatches({ comuna = null, limit = 20 } = {}) {
  if (!isSupabaseConfigured) return { data: getDemoMatches(), error: null };

  let q = supabase
    .from('matches')
    .select(
      'id, titulo, comuna, cancha_nombre, latitud, longitud, hora, ' +
        'cupos_disponibles, cupos_totales, precio_cuota, nivel, estado, ' +
        'organizador:profiles!id_organizador(id, username, trust_score)'
    )
    .eq('estado', 'abierto')
    .gte('hora', new Date().toISOString())
    .order('hora', { ascending: true })
    .limit(limit);

  if (comuna) q = q.eq('comuna', comuna);
  const { data, error } = await q;
  return { data: data || [], error };
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
