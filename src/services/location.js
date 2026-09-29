import { Platform } from 'react-native';
import * as Location from 'expo-location';

import { conPlazo, posicionDelNavegador } from '../utils/geolocalizacion.js';

/**
 * Pide permiso de ubicación y devuelve la posición actual.
 * Funciona en iOS, Android y Web (vía navigator.geolocation).
 *
 * Devuelve { ok, latitude?, longitude?, accuracy?, reason? }.
 *
 * SIEMPRE TERMINA (G01). Lo de dentro puede no contestar nunca —el Chrome de
 * la Mac de pruebas no llamó a ningún callback de `getCurrentPosition` con el
 * permiso denegado, y su propia opción `timeout` tampoco saltó—, así que el
 * plazo lo pone la app con `conPlazo`. Vale para las dos plataformas: en
 * nativo el que puede quedarse mudo es el diálogo de permisos.
 */
export async function getCurrentLocation() {
  return conPlazo(ubicacionReal());
}

async function ubicacionReal() {
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

// El `timeout` que se le pasa al navegador se queda: cuando funciona, ahorra
// la espera del plazo nuestro. Lo que ya no se hace es confiar SÓLO en él.
function getWebLocation() {
  const geo = typeof navigator === 'undefined' ? null : navigator.geolocation;
  return posicionDelNavegador(geo, {
    enableHighAccuracy: false,
    timeout: 8000,
    maximumAge: 60000,
  });
}

/**
 * Solo pregunta el permiso (sin leer todavía la posición).
 * Útil para la pantalla LocationPermissionScreen.
 */
export async function requestLocationPermission() {
  if (Platform.OS === 'web') {
    // En web no hay forma de pedir permiso sin leer; lo hacemos ya. Con su
    // plazo, igual que arriba: esta pantalla no puede quedarse esperando.
    const r = await conPlazo(getWebLocation());
    return { granted: r.ok, reason: r.reason };
  }
  const { status } = await conPlazo(
    Location.requestForegroundPermissionsAsync().then((p) => ({ ok: true, status: p.status })),
    { alVencer: { ok: false, status: 'undetermined' } }
  );
  return { granted: status === 'granted', reason: status };
}
