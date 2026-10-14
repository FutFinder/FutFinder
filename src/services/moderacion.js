import { supabase, isSupabaseConfigured } from './supabase';

/**
 * La pieza de moderación (migraciones 151 y 47c).
 *
 * LA AUTORIDAD ES EL SERVIDOR, y acá más que en ningún otro servicio.
 * `es_moderador()` decide, y las tres RPC lo vuelven a comprobar por su
 * cuenta antes de hacer nada: `soyModerador()` sirve para pintar la pantalla
 * y esconder la entrada del menú, **no** para autorizar. Quien llame la RPC
 * sin estar en el padrón recibe `NO_MODERA` (42501) pase lo que pase.
 *
 * EL PADRÓN NO SE LEE NI SE ESCRIBE DESDE LA APP. `public.moderadores` no
 * tiene políticas ni privilegios de cliente: nombrar a alguien es un
 * `insert` desde el panel. Por eso acá no hay ninguna función que liste
 * moderadores — no es un olvido.
 *
 * LO QUE ESTA PANTALLA **NO** HACE: resolver reportes de usuario. La cola
 * los trae para que no pasen desapercibidos, pero resolverlos exige decidir
 * estados, medidas y apelación, y eso sigue abierto. Ver `utils/moderacion.js`,
 * donde esa decisión vive en una constante en vez de en el JSX.
 */

/**
 * ¿Estoy en el padrón?
 *
 * Devuelve `false` ante cualquier problema: es lo seguro, y además lo único
 * que se pierde es que la entrada del menú no aparezca. Un `true` de más
 * mostraría una pantalla que después falla en cada botón.
 */
export async function soyModerador() {
  if (!isSupabaseConfigured) return false;
  const { data, error } = await supabase.rpc('es_moderador');
  if (error) {
    console.warn('[FutFinder] soyModerador:', error.message);
    return false;
  }
  return data === true;
}

/**
 * Las tres colas en una llamada.
 *
 * `{ data, error }` y no sólo `data`: una cola vacía y una cola que no se
 * pudo leer se ven igual en pantalla si quien llama no puede distinguirlas,
 * y lo que hay detrás son sanciones sin resolver.
 */
export async function getColaModeracion() {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  const { data, error } = await supabase.rpc('moderacion_cola');
  if (error) {
    console.error('[FutFinder] getColaModeracion:', error);
    return { data: null, error };
  }
  return { data: data || {}, error: null };
}

/**
 * Resuelve una revisión de sanción.
 *
 * `decision` es 'retirar' o 'mantener' — lo que acepta
 * `resolver_revision_sancion()` desde la 47c. La RPC devuelve
 * `{ ok, reason }` en vez de lanzar cuando el problema es de datos (una
 * revisión que no existe, una ya resuelta), así que un `ok:false` llega por
 * `data` y no por `error`: quien llama tiene que mirar los dos.
 */
export async function resolverRevision(reviewId, decision, nota = null) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  const { data, error } = await supabase.rpc('moderacion_resolver_revision', {
    p_review_id: reviewId,
    p_decision: decision,
    p_nota: nota,
  });
  if (error) {
    console.error('[FutFinder] resolverRevision:', error);
    return { data: null, error };
  }
  return { data, error: null };
}

/**
 * Devuelve un encuentro de `resultado_en_disputa` a `esperando_resultado`
 * para que los dos clubes vuelvan a proponer.
 *
 * No manda ningún aviso: deja su evento en el hilo, que los dos clubes ven
 * al abrirlo. Un aviso nuevo necesitaría un tipo nuevo en
 * `notifications_type_check` y, sobre todo, un texto que alguien tiene que
 * escribir (ver la cabecera de la migración 151).
 */
export async function reabrirResultado(challengeId, nota = null) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  const { data, error } = await supabase.rpc('moderacion_reabrir_resultado', {
    p_challenge_id: challengeId,
    p_nota: nota,
  });
  if (error) {
    console.error('[FutFinder] reabrirResultado:', error);
    return { data: null, error };
  }
  return { data, error: null };
}
