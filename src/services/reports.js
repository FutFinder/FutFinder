import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Reportes de un usuario sobre otro ("Reportar esta cuenta").
 *
 * ALCANCE ACTUAL — leer antes de construir encima:
 *  - Esta capa SOLO recibe el reporte y lo guarda (tabla user_reports,
 *    migración 31). El reporte queda en estado 'pendiente'.
 *  - NO existe moderación: no hay panel de soporte, nadie revisa ni resuelve,
 *    y no hay flujo de apelaciones. Por eso el perfil muestra el CONTEO de
 *    reportes recibidos pero nunca su contenido, y "Apelar una decisión"
 *    sigue deshabilitado (no hay decisiones que apelar).
 *  - PUNTO DE INTEGRACIÓN futuro: cuando exista moderación, mover `estado`
 *    a 'revisado'/'descartado' y conectar sanciones con profiles.estado /
 *    profiles.suspended_until, que ya existen.
 *
 * La RLS garantiza que un usuario solo pueda leer los reportes que él envió:
 * nadie puede ver quién lo reportó ni qué escribió.
 */

/** Motivos válidos (deben coincidir con el CHECK de la migración 31). */
export const MOTIVOS_REPORTE = [
  { value: 'informacion_falsa', label: 'Información falsa' },
  { value: 'contenido_ofensivo', label: 'Contenido ofensivo' },
  { value: 'foto_inapropiada', label: 'Fotografía inapropiada' },
  { value: 'suplantacion', label: 'Suplantación de identidad' },
  { value: 'conducta_antideportiva', label: 'Conducta antideportiva' },
  { value: 'spam', label: 'Spam' },
  { value: 'otro', label: 'Otro' },
];

export function esMotivoValido(v) {
  return MOTIVOS_REPORTE.some((m) => m.value === v);
}

async function getMe() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id || null;
}

/**
 * `true` si el error significa "la tabla user_reports no existe todavía"
 * (migración 31 sin aplicar).
 *
 * PostgREST no devuelve el 42P01 de Postgres: responde PGRST205 cuando la
 * tabla no está en su caché de esquema. Hay que contemplar los dos.
 */
function faltaLaTabla(error) {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  return /user_reports/.test(error.message || '');
}

/**
 * Envía un reporte sobre otro usuario.
 *
 * @param {object} p
 * @param {string} p.reportedId  Usuario reportado.
 * @param {string} p.motivo      Uno de MOTIVOS_REPORTE.
 * @param {string} [p.descripcion] Detalle opcional (máx. 600).
 * @param {string} [p.elemento]  Elemento concreto, ej. 'foto:<uuid>'.
 * @returns {{ data, error }}
 */
export async function reportUser({ reportedId, motivo, descripcion, elemento }) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  if (!reportedId) return { data: null, error: { message: 'Falta el usuario reportado' } };
  if (!esMotivoValido(motivo)) return { data: null, error: { message: 'Selecciona un motivo' } };

  const me = await getMe();
  if (!me) return { data: null, error: { message: 'No autenticado' } };
  if (me === reportedId) {
    return { data: null, error: { message: 'No puedes reportarte a ti mismo' } };
  }

  const desc = (descripcion || '').trim();
  if (desc.length > 600) {
    return { data: null, error: { message: 'La descripción no puede superar los 600 caracteres' } };
  }

  const { data, error } = await supabase
    .from('user_reports')
    .insert({
      reporter_id: me,
      reported_id: reportedId,
      motivo,
      descripcion: desc || null,
      elemento: elemento || null,
    })
    .select()
    .single();

  if (error) {
    // Índice único parcial: ya hay un reporte pendiente de este usuario.
    if (error.code === '23505') {
      return {
        data: null,
        error: { message: 'Ya enviaste un reporte sobre esta cuenta y sigue en revisión.' },
      };
    }
    // La tabla no existe todavía (migración 31 sin aplicar). No es un fallo
    // del código, así que se avisa como warning y no como error.
    if (faltaLaTabla(error)) {
      console.warn('[FutFinder] user_reports no existe: aplica la migración 31.');
      return {
        data: null,
        error: {
          message: 'Los reportes no están disponibles todavía. Aplica la migración 31 en Supabase.',
        },
      };
    }
    console.error('[FutFinder] reportUser:', error.code || '', error.message || error);
    return { data: null, error };
  }

  return { data, error: null };
}

/**
 * Nº de reportes pendientes en contra de un usuario.
 * Usa la RPC count_reports_against (SECURITY DEFINER) porque la RLS oculta
 * las filas: el conteo se puede ver, el contenido no.
 *
 * @returns {{ data: number, error }} 0 si la migración 31 no está aplicada.
 */
export async function countReportsAgainst(userId) {
  if (!isSupabaseConfigured || !userId) return { data: 0, error: null };

  const { data, error } = await supabase.rpc('count_reports_against', { p_user_id: userId });

  if (error) {
    // Sin migración 31 la RPC no existe: no es un fallo que deba romper la
    // pantalla, simplemente todavía no hay reportes que contar.
    if (
      error.code === 'PGRST202' ||
      faltaLaTabla(error) ||
      /does not exist/i.test(error.message || '')
    ) {
      return { data: 0, error: null };
    }
    console.error('[FutFinder] countReportsAgainst:', error.code || '', error.message || error);
    return { data: 0, error };
  }

  return { data: Number(data) || 0, error: null };
}

/**
 * ¿Ya reporté a este usuario y sigue pendiente?
 * Sirve para no ofrecer un reporte duplicado que la BD va a rechazar.
 */
export async function getMyPendingReportFor(userId) {
  if (!isSupabaseConfigured || !userId) return { data: null, error: null };
  const me = await getMe();
  if (!me) return { data: null, error: null };

  const { data, error } = await supabase
    .from('user_reports')
    .select('id, motivo, created_at')
    .eq('reporter_id', me)
    .eq('reported_id', userId)
    .eq('estado', 'pendiente')
    .maybeSingle();

  if (error) {
    // Sin migración 31 no hay reportes que consultar: no es un error.
    if (faltaLaTabla(error)) return { data: null, error: null };
    console.error('[FutFinder] getMyPendingReportFor:', error.code || '', error.message || error);
    return { data: null, error };
  }
  return { data, error: null };
}
