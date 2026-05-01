import { Platform } from 'react-native';
import * as Location from 'expo-location';

/**
 * Pide permiso de ubicación y devuelve la posición actual.
 * Funciona en iOS, Android y Web (vía navigator.geolocation).
 *
 * Devuelve { ok, latitude?, longitude?, accuracy?, reason? }.
 */
export async function getCurrentLocation() {
  try {
    // En web caemos al navegador por consistencia y mejor UX
    if (Platform.OS === 'web') {
      return await getWebLocation();
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return { ok: false, reason: 'Permiso de ubicación denegado' };
    }

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return {
      ok: true,
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    };
  } catch (e) {
    return { ok: false, reason: e?.message || 'Error obteniendo ubicación' };
  }
}

function getWebLocation() {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ ok: false, reason: 'Geolocalización no disponible en este navegador' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          ok: true,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) =>
        resolve({
          ok: false,
          reason: err?.message || 'No pude obtener tu ubicación',
        }),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  });
}

/**
 * Solo pregunta el permiso (sin leer todavía la posición).
 * Útil para la pantalla LocationPermissionScreen.
 */
export async function requestLocationPermission() {
  if (Platform.OS === 'web') {
    // En web no hay forma de pedir permiso sin leer; lo hacemos ya
    const r = await getWebLocation();
    return { granted: r.ok, reason: r.reason };
  }
  const { status } = await Location.requestForegroundPermissionsAsync();
  return { granted: status === 'granted', reason: status };
}
