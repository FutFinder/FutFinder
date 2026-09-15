import { supabase, isSupabaseConfigured } from './supabase';

/**
 * La alineación del club (migración 92): un tablero por club, no por
 * partido, que sólo admin o capitán pueden guardar — el resto del club la
 * lee. `asignaciones` es un jsonb `{ puesto: member_id }` sin FK adentro,
 * así que un integrante expulsado después de guardar simplemente deja de
 * resolver a nadie en el cliente, en vez de romper la lectura.
 */

const COLUMNAS =
  'club_id, modo, formacion, personalizado, asignaciones, puestos_personalizados, updated_by, updated_at';

/** La alineación vigente del club, o `null` si nunca se ha guardado una. */
export async function getClubLineup(clubId) {
  if (!isSupabaseConfigured) return { data: null, error: null };
  const { data, error } = await supabase
    .from('club_lineups')
    .select(COLUMNAS)
    .eq('club_id', clubId)
    .maybeSingle();
  if (error) {
    console.error('[FutFinder] getClubLineup:', error);
    return { data: null, error };
  }
  return { data, error: null };
}

/**
 * Guarda (crea o sobrescribe) la alineación del club. La RLS de la 92 es
 * quien de verdad decide si puede: sólo admin/capitán del club, y sólo con
 * `updated_by` igual a quien llama.
 */
export async function saveClubLineup(
  clubId,
  { modo, formacion, personalizado, asignaciones, puestosPersonalizados }
) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return { data: null, error: { message: 'No autenticado' } };

  const { data, error } = await supabase
    .from('club_lineups')
    .upsert(
      {
        club_id: clubId,
        modo,
        formacion,
        personalizado: !!personalizado,
        asignaciones: asignaciones || {},
        puestos_personalizados: puestosPersonalizados || {},
        updated_by: uid,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'club_id' }
    )
    .select(COLUMNAS)
    .single();

  if (error) {
    console.error('[FutFinder] saveClubLineup:', error);
    return {
      data: null,
      error: { message: error.message || 'No se pudo guardar la alineación' },
    };
  }
  return { data, error: null };
}
