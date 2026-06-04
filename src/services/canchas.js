import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Servicio de canchas registradas en FutFinder.
 *
 * El directorio se alimenta automáticamente: cada vez que un usuario crea
 * un partido con cancha + coordenadas, un trigger del lado de la DB
 * (tg_register_cancha) la añade o incrementa su contador de usos.
 *
 * Las búsquedas más populares aparecen primero.
 */

export async function searchCanchas(query, { limit = 5 } = {}) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  const q = (query || '').trim();
  if (q.length < 2) return { data: [], error: null };

  const { data, error } = await supabase.rpc('search_canchas', {
    p_query: q,
    p_limit: limit,
  });
  if (error) {
    console.warn('[FutFinder] searchCanchas:', error);
    return { data: [], error };
  }
  return { data: data || [], error: null };
}
