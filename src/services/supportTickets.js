import { Platform } from 'react-native';

import { supabase, isSupabaseConfigured } from './supabase';
import { uploadSupportScreenshot, removeSupportScreenshotFile } from './storage';
import { APP_VERSION } from '../utils/appVersion';

/**
 * "Reportar un problema" (Ajustes → Soporte).
 *
 * ALCANCE ACTUAL — leer antes de construir encima:
 *  - Esta capa SOLO recibe el reporte, sube la captura si hay una, y guarda
 *    la fila (tabla support_tickets, migración 52). Queda en `estado`
 *    'pendiente'.
 *  - NO existe panel de soporte propio: el equipo cambia `estado` a
 *    'en_proceso'/'resuelto' directo desde el Table Editor de Supabase, con
 *    su propio rol (no pasa por RLS). El cliente solo inserta y lee lo
 *    suyo; nunca actualiza ni borra un ticket.
 *  - Distinto de `reports.js` (reportar la CONDUCTA de otro jugador, con
 *    destinatario): este reporte es sobre la app, sin destinatario.
 */

/** Categorías válidas (deben coincidir con el CHECK de la migración 52). */
export const CATEGORIAS_TICKET = [
  {
    value: 'fallo_tecnico',
    label: 'Fallo técnico',
    sub: 'Pantalla congelada, botones que no responden',
  },
  {
    value: 'reserva_cancha',
    label: 'Reserva o cancha',
    sub: 'Cobro duplicado, horario incorrecto, cancha cerrada',
  },
  {
    value: 'comportamiento_jugador',
    label: 'Comportamiento de un jugador',
    sub: 'Agresiones, no-show, actitud en el partido',
  },
  {
    value: 'sugerencia',
    label: 'Sugerencia o comentario',
    sub: 'Ideas para mejorar la app',
  },
];

export function esCategoriaValida(v) {
  return CATEGORIAS_TICKET.some((c) => c.value === v);
}

async function getMe() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id || null;
}

/**
 * `true` si el error significa "la tabla support_tickets no existe
 * todavía" (migración 52 sin aplicar). PostgREST no devuelve el 42P01 de
 * Postgres: responde PGRST205 cuando la tabla no está en su caché de
 * esquema. Hay que contemplar los dos.
 */
function faltaLaTabla(error) {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  return /support_tickets/.test(error.message || '');
}

/**
 * Envía un reporte sobre la app. Si viene `screenshotAsset`, primero sube
 * la imagen; si después falla guardar la fila, borra el archivo recién
 * subido para no dejarlo huérfano (mismo criterio que `uploadGalleryPhoto`
 * en `gallery.js`).
 *
 * @param {object} p
 * @param {string} p.category     Uno de CATEGORIAS_TICKET.
 * @param {string} p.title        Asunto (obligatorio).
 * @param {string} [p.description] Detalle opcional (máx. 600).
 * @param {object} [p.screenshotAsset] Asset de `pickImage()`, opcional.
 * @param {(step: 'screenshot'|'ticket') => void} [p.onStep] Aviso de progreso para la UI.
 * @returns {{ data, error }}
 */
export async function submitSupportTicket({ category, title, description, screenshotAsset, onStep }) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo' } };
  if (!esCategoriaValida(category)) return { data: null, error: { message: 'Selecciona una categoría' } };

  const asunto = (title || '').trim();
  if (!asunto) return { data: null, error: { message: 'Escribe un asunto' } };

  const desc = (description || '').trim();
  if (desc.length > 600) {
    return { data: null, error: { message: 'La descripción no puede superar los 600 caracteres' } };
  }

  const me = await getMe();
  if (!me) return { data: null, error: { message: 'No autenticado' } };

  let screenshotUrl = null;
  let screenshotPath = null;
  if (screenshotAsset) {
    onStep?.('screenshot');
    const { url, path, error: uploadError } = await uploadSupportScreenshot(screenshotAsset, me);
    if (uploadError) {
      console.error('[FutFinder] submitSupportTicket screenshot:', uploadError);
      return { data: null, error: { message: 'No pudimos subir la captura de pantalla' } };
    }
    screenshotUrl = url;
    screenshotPath = path;
  }

  onStep?.('ticket');
  const { data, error } = await supabase
    .from('support_tickets')
    .insert({
      user_id: me,
      category,
      title: asunto,
      description: desc || null,
      screenshot_url: screenshotUrl,
      app_version: APP_VERSION,
      platform: Platform.OS,
    })
    .select()
    .single();

  if (error) {
    if (screenshotPath) await removeSupportScreenshotFile(screenshotPath);
    if (faltaLaTabla(error)) {
      console.warn('[FutFinder] support_tickets no existe: aplica la migración 52.');
      return {
        data: null,
        error: { message: 'Los reportes no están disponibles todavía. Aplica la migración 52 en Supabase.' },
      };
    }
    console.error('[FutFinder] submitSupportTicket:', error.code || '', error.message || error);
    return { data: null, error };
  }

  return { data, error: null };
}
