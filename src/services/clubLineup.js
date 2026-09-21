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
 *
 * `expectedUpdatedAt` es el `updated_at` que la pantalla tenía cargado
 * cuando empezó a editar (o `null` si nunca se había guardado una). Sin
 * esto, el `upsert` de más abajo pisaba entera la fila sin comparar nada:
 * dos admins editando a la vez, el segundo en guardar borraba el trabajo
 * del primero sin ningún aviso, ni para el que pisó ni para el que perdió
 * su trabajo. Se compara justo antes de escribir — queda una ventana breve
 * entre la comprobación y el guardado real, aceptada a propósito: cerrarla
 * del todo pide una transacción o una función en la base, y el objetivo acá
 * es que dos ediciones EN PARALELO (minutos aparte) no se pisen en
 * silencio, no blindar los dos guardados que caen en el mismo segundo.
 */
export async function saveClubLineup(
  clubId,
  { modo, formacion, personalizado, asignaciones, puestosPersonalizados, expectedUpdatedAt = null }
) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return { data: null, error: { message: 'No autenticado' } };

  const { data: actual } = await supabase
    .from('club_lineups')
    .select('updated_at')
    .eq('club_id', clubId)
    .maybeSingle();
  const actualUpdatedAt = actual?.updated_at || null;
  if (actualUpdatedAt !== expectedUpdatedAt) {
    return {
      data: null,
      error: {
        message: 'Alguien más guardó una alineación distinta mientras editabas. Recarga para ver los cambios y vuelve a intentarlo.',
        conflict: true,
      },
    };
  }

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
