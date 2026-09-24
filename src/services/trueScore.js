import { useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Frontera de la app con TrueScore (migración 134).
 *
 * El puntaje lo calcula el servidor; acá sólo se leen los flags, la tabla de
 * niveles, el costo de irse de un partido y el historial, y se llaman las
 * dos acciones nuevas: expulsar y verificar el teléfono.
 */

// Los ajustes casi no cambian: se piden una vez y se reutilizan unos minutos.
// Sin esto, cada fila de cada lista pediría lo mismo.
const VIGENCIA_MS = 5 * 60 * 1000;
let cache = null;
let cacheAt = 0;
let enVuelo = null;

const APAGADO = Object.freeze({ fase1: false, fase2: false, telefono_obligatorio: false, niveles: [] });

/** Flags y tabla de niveles. Con cualquier error se asume TrueScore apagado. */
export async function getTrueScoreAjustes({ forzar = false } = {}) {
  if (!isSupabaseConfigured) return APAGADO;
  if (!forzar && cache && Date.now() - cacheAt < VIGENCIA_MS) return cache;
  if (enVuelo) return enVuelo;
  enVuelo = (async () => {
    const { data, error } = await supabase.rpc('truescore_ajustes');
    enVuelo = null;
    if (error || !data) return cache || APAGADO;
    cache = data;
    cacheAt = Date.now();
    return data;
  })();
  return enVuelo;
}

/** Hook: los ajustes de TrueScore, o `APAGADO` mientras cargan. */
export function useTrueScoreAjustes() {
  const [ajustes, setAjustes] = useState(cache || APAGADO);
  useEffect(() => {
    let vivo = true;
    getTrueScoreAjustes().then((a) => vivo && setAjustes(a));
    return () => {
      vivo = false;
    };
  }, []);
  return ajustes;
}

/**
 * Lo que le cuesta a quien llama irse del partido ahora: salirse si es
 * jugador, cancelar si es el organizador (`tipo` = motivo de cancelación).
 */
export async function getCostoSalida(matchId, tipo = 'otro') {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('truescore_costo_salida', {
    p_match_id: matchId,
    p_tipo_cancelacion: tipo,
  });
  if (error) return null;
  return data;
}

/** El organizador saca a un jugador. No le resta puntos y no puede volver. */
export async function expulsarJugador(matchId, jugadorId) {
  if (!isSupabaseConfigured) return { ok: false, reason: 'Sin conexión con el servidor' };
  const { data, error } = await supabase.rpc('expulsar_jugador', {
    p_match_id: matchId,
    p_jugador: jugadorId,
  });
  if (error) return { ok: false, reason: 'No pudimos sacar al jugador. Intenta de nuevo.', error };
  return data;
}

/** Mis eventos de TrueScore, del más nuevo al más viejo. */
export async function listMisEventosTrueScore({ limite = 100 } = {}) {
  if (!isSupabaseConfigured) return { data: [], error: null };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: [], error: { message: 'No autenticado' } };
  const { data, error } = await supabase
    .from('truescore_eventos')
    .select('id, match_id, tipo, puntos_aplicados, puntaje_despues, racha_despues, motivo, created_at')
    .eq('user_id', user.id)
    .order('id', { ascending: false })
    .limit(limite);
  return { data: data || [], error };
}

// --------------------------------------------------------------- reclamos

function reclamoFallido(error) {
  return { ok: false, reason: 'No pudimos completar el reclamo. Intenta de nuevo.', error };
}

/** Reclamo mi marca de tardanza o ausencia en este partido (fase 2). */
export async function reclamarMarca(matchId) {
  if (!isSupabaseConfigured) return { ok: false, reason: 'Sin conexión con el servidor' };
  const { data, error } = await supabase.rpc('truescore_reclamar', { p_match_id: matchId });
  if (error) return reclamoFallido(error);
  return data;
}

/** Como compañero que asistió, confirmo que el reclamante sí estuvo. */
export async function confirmarReclamo(reclamoId) {
  if (!isSupabaseConfigured) return { ok: false, reason: 'Sin conexión con el servidor' };
  const { data, error } = await supabase.rpc('truescore_confirmar_reclamo', { p_reclamo_id: reclamoId });
  if (error) return reclamoFallido(error);
  return data;
}

/** Los reclamos de un partido que puedo ver (el mío, o los que me toca confirmar). */
export async function reclamosDelPartido(matchId) {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.rpc('truescore_reclamos_del_partido', { p_match_id: matchId });
  if (error) return [];
  return data || [];
}

/** Mis reclamos, por evento: { [evento_id]: reclamo }. */
export async function misReclamos() {
  if (!isSupabaseConfigured) return {};
  const { data, error } = await supabase.rpc('truescore_mis_reclamos');
  if (error) return {};
  const porEvento = {};
  (data || []).forEach((r) => {
    porEvento[r.evento_id] = r;
  });
  return porEvento;
}

// --------------------------------------------------------------- fair play

/** Motivos de un reporte de fair play (fase 3), en el orden en que se ofrecen. */
export const MOTIVOS_FAIRPLAY = [
  { value: 'juego_brusco', label: 'Juego brusco' },
  { value: 'antideportivo', label: 'Conducta antideportiva' },
  { value: 'agresion_fisica', label: 'Agresión física' },
];

/** Reporto a un compañero de este partido. */
export async function reportarFairplay(matchId, reportadoId, motivo, comentario = null) {
  if (!isSupabaseConfigured) return { ok: false, reason: 'Sin conexión con el servidor' };
  const { data, error } = await supabase.rpc('fairplay_reportar', {
    p_match_id: matchId,
    p_reportado: reportadoId,
    p_motivo: motivo,
    p_comentario: comentario,
  });
  if (error) return { ok: false, reason: 'No pudimos enviar el reporte. Intenta de nuevo.', error };
  return data;
}

/** A quiénes reporté en este partido: { [userId]: motivo }. */
export async function misReportesFairplay(matchId) {
  if (!isSupabaseConfigured) return {};
  const { data, error } = await supabase.rpc('fairplay_mis_reportes', { p_match_id: matchId });
  if (error) return {};
  const porJugador = {};
  (data || []).forEach((r) => {
    porJugador[r.reported_id] = r.motivo;
  });
  return porJugador;
}

/** Para el organizador: agresiones físicas reportadas en su partido. */
export async function agresionesDelPartido(matchId) {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.rpc('fairplay_agresiones_del_partido', { p_match_id: matchId });
  if (error) return [];
  return data || [];
}

/** El organizador confirma una agresión física reportada. */
export async function confirmarAgresion(reporteId) {
  if (!isSupabaseConfigured) return { ok: false, reason: 'Sin conexión con el servidor' };
  const { data, error } = await supabase.rpc('fairplay_confirmar_agresion', { p_reporte_id: reporteId });
  if (error) return { ok: false, reason: 'No pudimos confirmar la agresión. Intenta de nuevo.', error };
  return data;
}

// ---------------------------------------------------------------- teléfono

/** ¿Mi cuenta tiene un teléfono verificado? */
export async function miTelefonoVerificado() {
  if (!isSupabaseConfigured) return false;
  const { data, error } = await supabase.rpc('mi_telefono_verificado');
  if (error) return false;
  return !!data;
}

/**
 * Pasa un número chileno a formato internacional: «9 1234 5678» y
 * «+56 9 1234 5678» quedan como «+56912345678». Devuelve null si no es un
 * celular chileno válido.
 */
export function normalizarCelularChileno(texto) {
  const digitos = String(texto || '').replace(/\D/g, '');
  const local = digitos.startsWith('56') ? digitos.slice(2) : digitos;
  if (!/^9\d{8}$/.test(local)) return null;
  return `+56${local}`;
}

// Traduce lo que responde Auth. El caso esperado mientras no haya proveedor
// de SMS configurado es el primero: se dice tal cual, sin culpar al usuario.
function traducirErrorTelefono(error) {
  const msg = String(error?.message || '');
  if (/sms|provider|phone.*(disabled|not enabled)|unsupported phone/i.test(msg)) {
    return 'La verificación por SMS todavía no está disponible. Te avisaremos cuando la activemos.';
  }
  if (/already|registered|exists/i.test(msg)) {
    return 'Ese número ya está asociado a otra cuenta.';
  }
  if (/expired|invalid|token/i.test(msg)) {
    return 'El código no es válido o ya venció. Pide uno nuevo.';
  }
  if (/rate|too many|seconds/i.test(msg)) {
    return 'Pediste demasiados códigos seguidos. Espera un momento e intenta de nuevo.';
  }
  return 'No pudimos completar la verificación. Intenta de nuevo.';
}

/** Envía el código por SMS al número (lo asocia a la cuenta al verificarse). */
export async function enviarCodigoTelefono(telefono) {
  if (!isSupabaseConfigured) return { ok: false, reason: 'Sin conexión con el servidor' };
  const { error } = await supabase.auth.updateUser({ phone: telefono });
  if (error) return { ok: false, reason: traducirErrorTelefono(error), error };
  return { ok: true };
}

/** Confirma el código recibido por SMS. */
export async function verificarCodigoTelefono(telefono, codigo) {
  if (!isSupabaseConfigured) return { ok: false, reason: 'Sin conexión con el servidor' };
  const { error } = await supabase.auth.verifyOtp({
    phone: telefono,
    token: String(codigo || '').trim(),
    type: 'phone_change',
  });
  if (error) return { ok: false, reason: traducirErrorTelefono(error), error };
  return { ok: true };
}
