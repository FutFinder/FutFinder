import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Conectividad y caché de lectura para Partidos.
 *
 * El proyecto no trae `@react-native-netinfo`, así que el estado de red se
 * deduce de dos señales que sí están disponibles en web y nativo:
 *   1. `navigator.onLine` + eventos online/offline (web).
 *   2. Los fallos de red que reportan los propios servicios (`markOffline`).
 *
 * Es una heurística, no un radar: sirve para decidir si deshabilitamos las
 * acciones que necesitan red y si mostramos el contenido en caché, que es
 * exactamente lo que pide el diseño.
 */

let online = true;
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => {
    try {
      fn(online);
    } catch {}
  });
}

export function isOnline() {
  return online;
}

/** Un servicio detectó un fallo de red. */
export function markOffline() {
  if (online) {
    online = false;
    emit();
  }
}

/** Una petición terminó bien → volvimos a tener red. */
export function markOnline() {
  if (!online) {
    online = true;
    emit();
  }
}

export function subscribeConnectivity(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Web: escuchamos los eventos del navegador, que sí son fiables.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    online = navigator.onLine;
  }
  window.addEventListener('online', markOnline);
  window.addEventListener('offline', markOffline);
}

/** Hook: `const online = useOnline()`. */
export function useOnline() {
  const [value, setValue] = useState(online);
  useEffect(() => subscribeConnectivity(setValue), []);
  return value;
}

/**
 * ¿Este error es de red (y no del servidor rechazando algo)?
 * Supabase-js envuelve los fallos de fetch como TypeError «Failed to fetch».
 */
export function isNetworkError(error) {
  if (!error) return false;
  const msg = String(error.message || error).toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('network request failed') ||
    msg.includes('networkerror') ||
    msg.includes('load failed') ||
    error.name === 'TypeError'
  );
}

// -------------------------------------------------------------- caché

const PREFIX = '@futfinder/cache/';

/** Guarda una respuesta para poder mostrarla sin conexión. */
export async function cacheWrite(key, value) {
  try {
    await AsyncStorage.setItem(
      PREFIX + key,
      JSON.stringify({ at: Date.now(), value })
    );
  } catch {}
}

/** Lee de caché. Devuelve `{ value, at }` o `null`. */
export async function cacheRead(key) {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Texto tipo «hace 4 min» para el aviso de contenido en caché. */
export function cacheAgeLabel(at) {
  if (!at) return '';
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 1) return 'hace instantes';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}
