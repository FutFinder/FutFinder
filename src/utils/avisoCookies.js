import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Si este navegador ya vio el aviso de cookies de la versión web.
 *
 * Es un aviso y no un pedido de consentimiento porque FutFinder sólo guarda
 * lo necesario para funcionar (sesión, cuenta recordada, preferencias): no
 * hay nada opcional que aceptar o rechazar. Si algún día se suma medición o
 * publicidad, esto tiene que pasar a ser un «Aceptar / Rechazar» de verdad,
 * con lo opcional apagado hasta que la persona diga que sí.
 *
 * Se guarda la VERSIÓN del aviso y no un simple «visto»: si la política de
 * cookies cambia de fondo, subir este número vuelve a mostrarlo una vez.
 */
export const VERSION_AVISO_COOKIES = '2026-10-26';
const KEY = 'futfinder.avisoCookies';

export function debeMostrarseAviso(guardado) {
  return guardado !== VERSION_AVISO_COOKIES;
}

export async function avisoCookiesPendiente() {
  try {
    return debeMostrarseAviso(await AsyncStorage.getItem(KEY));
  } catch {
    // Sin almacenamiento (modo privado estricto) se muestra: es mejor
    // repetir el aviso que no darlo nunca.
    return true;
  }
}

export async function marcarAvisoCookiesVisto() {
  try {
    await AsyncStorage.setItem(KEY, VERSION_AVISO_COOKIES);
  } catch {
    // Si no se puede guardar, el aviso vuelve la próxima vez. Nada más.
  }
}
