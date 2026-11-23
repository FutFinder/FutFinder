import { useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from './supabase';
import { nombresVigentes, payloadDeAsientos, traducirErrorDeAsiento } from '../utils/asientos.js';

/**
 * Frontera de la app con los asientos de partido (migración 182).
 *
 * Quien tiene cuenta vive en `attendees`; acá se leen los asientos SIN cuenta
 * (`match_asientos`: reservados e invitados por nombre) y se llaman las
 * puertas del organizador y la de quien llega con el link. Los cupos los
 * cuenta el servidor: ninguna función de acá suma ni resta.
 */

// Los ajustes casi no cambian: se piden una vez y se reutilizan unos minutos.
const VIGENCIA_MS = 5 * 60 * 1000;
let cache = null;
let cacheAt = 0;
let enVuelo = null;

const APAGADO = Object.freeze({ asientos_por_nombre: false, asientos_por_nombre_termina: null });

/** Ajustes de partidos (`partidos_ajustes`). Con cualquier error, nombres apagados. */
export async function getPartidosAjustes({ forzar = false } = {}) {
  if (!isSupabaseConfigured) return APAGADO;
  if (!forzar && cache && Date.now() - cacheAt < VIGENCIA_MS) return cache;
  if (enVuelo) return enVuelo;
  enVuelo = (async () => {
    const { data, error } = await supabase.rpc('partidos_ajustes');
    enVuelo = null;
    if (error || !data) return cache || APAGADO;
    cache = data;
    cacheAt = Date.now();
    return data;
  })();
  return enVuelo;
}

/** Hook: ¿se pueden ocupar asientos escribiendo sólo un nombre? */
export function useNombresVigentes() {
  const [ajustes, setAjustes] = useState(cache || APAGADO);
  useEffect(() => {
    let vivo = true;
    getPartidosAjustes().then((a) => vivo && setAjustes(a));
    return () => {
      vivo = false;
    };
  }, []);
  return nombresVigentes(ajustes);
}

/** Asientos sin cuenta de un partido: [{ id, tipo: 'reservado' | 'nombre', nombre }]. */
export async function getAsientosSinCuenta(matchId) {
  if (!isSupabaseConfigured || !matchId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('match_asientos')
    .select('id, tipo, nombre, created_at')
    .eq('id_partido', matchId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) {
    console.error('[FutFinder] getAsientosSinCuenta:', error);
    return { data: [], error };
  }
  return { data: data || [], error: null };
}

/** Llama una puerta de asientos y devuelve `{ ok, mensaje }` listo para la pantalla. */
async function llamar(rpc, params) {
  if (!isSupabaseConfigured) return { ok: false, mensaje: 'Modo demo' };
  const { data, error } = await supabase.rpc(rpc, params);
  if (error) {
    console.error(`[FutFinder] ${rpc}:`, error);
    return { ok: false, mensaje: traducirErrorDeAsiento(error) };
  }
  return { ok: true, data };
}

/**
 * Publica el partido y sus asientos en una sola transacción.
 * `partido` son las columnas de siempre más `jugadores_total`; `ocupados`
 * es el armado del creador (ver `validarArmado`).
 */
export async function publicarPartidoConAsientos(partido, ocupados = []) {
  if (!isSupabaseConfigured) return { data: null, error: { message: 'Demo mode' } };
  const { data, error } = await supabase.rpc('publicar_partido_con_asientos', {
    p_partido: partido,
    p_asientos: payloadDeAsientos(ocupados),
  });
  if (error) {
    console.error('[FutFinder] publicar_partido_con_asientos:', error);
    const mensaje = traducirErrorDeAsiento(error, error.message || 'No pudimos publicar el partido.');
    return { data: null, error: { ...error, message: mensaje } };
  }
  return { data: data?.match || null, error: null, duplicate: !!data?.duplicate };
}

/** Sienta a un amigo; con `asientoId` reemplaza un asiento reservado o por nombre. */
export function asignarAmigo(matchId, amigoId, asientoId = null) {
  return llamar('asiento_asignar_amigo', { p_match_id: matchId, p_amigo: amigoId, p_asiento_id: asientoId });
}

/** Reserva `cantidad` asientos tomándolos de los libres. */
export function reservarAsientos(matchId, cantidad = 1) {
  return llamar('asiento_agregar', { p_match_id: matchId, p_tipo: 'reservado', p_nombre: null, p_cantidad: cantidad });
}

/** Ocupa un asiento libre con un nombre escrito a mano. */
export function agregarNombre(matchId, nombre) {
  return llamar('asiento_agregar', { p_match_id: matchId, p_tipo: 'nombre', p_nombre: nombre, p_cantidad: 1 });
}

/** Cambia un asiento sin cuenta: a reservado, o a un nombre (también corrige el nombre). */
export function cambiarAsiento(asientoId, tipo, nombre = null) {
  return llamar('asiento_cambiar', { p_asiento_id: asientoId, p_tipo: tipo, p_nombre: nombre });
}

/** Libera un asiento reservado o por nombre: vuelve a ser un cupo público. */
export function liberarAsiento(asientoId) {
  return llamar('asiento_liberar', { p_asiento_id: asientoId });
}

/** Deshace la asignación de un amigo que el organizador sentó. */
export function quitarAmigo(matchId, jugadorId) {
  return llamar('asiento_quitar_amigo', { p_match_id: matchId, p_jugador: jugadorId });
}

/** El token del link de invitación (sólo el organizador). */
export async function getTokenDeInvitacion(matchId) {
  const r = await llamar('asientos_link', { p_match_id: matchId });
  return r.ok ? { ok: true, token: r.data?.token || null } : r;
}

/**
 * Toma un asiento reservado con el link. Devuelve la respuesta del servidor
 * (`{ ok, ya_estaba }` o `{ ok: false, reason }`), o `null` si no se pudo
 * preguntar: `mensajeDelLink` convierte cada caso en lo que se muestra.
 */
export async function tomarAsientoReservado(matchId, token) {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc('tomar_asiento_reservado', { p_match_id: matchId, p_token: token });
  if (error) {
    console.error('[FutFinder] tomar_asiento_reservado:', error);
    return null;
  }
  return data ?? null;
}
