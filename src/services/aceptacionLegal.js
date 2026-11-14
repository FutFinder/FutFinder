import { supabase, isSupabaseConfigured } from './supabase';
import { VERSION_LEGAL } from '../data/legal';
import { interpretarAceptacion } from '../utils/aceptacionLegal';

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
