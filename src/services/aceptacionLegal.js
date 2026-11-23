import { supabase, isSupabaseConfigured } from './supabase';
import { VERSION_LEGAL } from '../data/legal';
import { interpretarAceptacion, interpretarAceptaciones, estadoDeAceptacion } from '../utils/aceptacionLegal';

/**
 * Deja en el servidor qué versión de los términos y la política aceptó la
 * persona de la sesión, y cuándo (migración 181). Idempotente.
 *
 * Devuelve `{ registrada, error }`. Sin la migración aplicada devuelve
 * `registrada: false` SIN error: ver `utils/aceptacionLegal.js`.
 */
export async function registrarAceptacionLegal() {
  if (!isSupabaseConfigured) return { registrada: false, error: null };
  try {
    const respuesta = await supabase.rpc('aceptar_terminos', { p_version: VERSION_LEGAL });
    return interpretarAceptacion(respuesta);
  } catch (e) {
    return interpretarAceptacion({ data: null, error: { message: e?.message || 'fetch' } });
  }
}

/**
 * Qué versiones aceptó la persona de la sesión, y cuándo. La RLS deja leer
 * sólo las propias. Devuelve `{ data, error }`; sin la migración, `data: []`.
 */
export async function misAceptacionesLegales() {
  if (!isSupabaseConfigured) return { data: [], error: null };
  try {
    const respuesta = await supabase
      .from('aceptaciones_legales')
      .select('version, aceptado_at')
      .order('aceptado_at', { ascending: true });
    return interpretarAceptaciones(respuesta);
  } catch (e) {
    return interpretarAceptaciones({ data: null, error: { message: e?.message || 'fetch' } });
  }
}

/**
 * ¿La persona de la sesión ya aceptó la versión vigente (`VERSION_LEGAL`)?
 * Devuelve 'al-dia', 'pendiente' o 'sin-saber'; ver `estadoDeAceptacion`.
 * Nunca lanza.
 */
export async function estadoDeMiAceptacion() {
  if (!isSupabaseConfigured) return 'sin-saber';
  try {
    const respuesta = await supabase
      .from('aceptaciones_legales')
      .select('version')
      .gte('version', VERSION_LEGAL)
      .limit(1);
    return estadoDeAceptacion(respuesta, VERSION_LEGAL);
  } catch {
    return 'sin-saber';
  }
}
