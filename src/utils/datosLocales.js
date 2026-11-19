import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Lo que la app guarda en el dispositivo y es DE UNA CUENTA, para borrarlo al
 * cerrar sesión.
 *
 * POR QUÉ. Hasta el 2026-11-19 cerrar sesión sólo soltaba el token: la copia
 * temporal de partidos —con la lista de jugadores de cada partido abierto—,
 * el club que tenías abierto, qué mensajes de club ya leíste y qué avisos del
 * panel de recinto viste se quedaban en el navegador. En un computador
 * compartido, la siguiente persona los heredaba. La política de cookies dice
 * que se borran al cerrar sesión, y esto es lo que lo cumple.
 *
 * LO QUE NO SE BORRA, a propósito: la cuenta recordada (es justo para entrar
 * de nuevo; se olvida al ELIMINAR la cuenta, `forgetRememberedAccount`), el
 * aviso de cookies (es del dispositivo, no de una cuenta) y la sesión, que la
 * suelta Supabase.
 *
 * Los prefijos repiten los de cada módulo; una prueba los compara con el
 * fuente para que no se separen.
 */
export const PREFIJOS_DE_LA_CUENTA = [
  '@futfinder/cache/', // services/connectivity.js — copia temporal
  'futfinder:clubActivo', // contexts/ClubsHomeContext.js
  'club_chat_read:', // services/messages.js
  'futfinder.panelRecintoBienvenida.', // utils/avisoPanelRecinto.js
];

/** De una lista de claves, las que son de la cuenta. */
export function clavesDeLaCuenta(claves) {
  return (claves || []).filter((k) => PREFIJOS_DE_LA_CUENTA.some((p) => String(k).startsWith(p)));
}

/** Borra lo de la cuenta. Devuelve cuántas claves borró. Nunca lanza. */
export async function olvidarDatosDeLaCuenta(almacen = AsyncStorage) {
  try {
    const borrar = clavesDeLaCuenta(await almacen.getAllKeys());
    if (borrar.length) await almacen.multiRemove(borrar);
    return borrar.length;
  } catch {
    return 0;
  }
}
