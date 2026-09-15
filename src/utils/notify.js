import { Alert, Platform } from 'react-native';

import { empujarAviso } from './avisos';

/**
 * notify(title, message)
 *
 * Un mensaje para la persona, que se ve en los tres lados.
 *
 * ANTES USABA `window.alert` EN WEB, Y EN LA APP WEB ESTÁ SUPRIMIDO:
 * devuelve en 3 milisegundos sin mostrar nada. Eran 17 llamadas, casi todas
 * errores, que nadie veía nunca — se tocaba algo, fallaba, y no aparecía
 * nada. `Alert.alert` de React Native tampoco funciona en web, así que la
 * única salida que anda en todos lados es un aviso propio de la app.
 *
 * SIGUE ALIMENTANDO LA CONSOLA. El log estaba antes y se queda: es lo que
 * permite reconstruir qué pasó cuando alguien cuenta un problema.
 */
export function notify(title, message = '', tono = 'info') {
  console.log('[FutFinder notify]', title, message);

  const id = empujarAviso(title, message, tono);

  // Red de seguridad: si por lo que sea no hay dónde pintarlo —una pantalla
  // montada fuera del árbol de la app, una prueba— en móvil se cae al aviso
  // del sistema antes que tragarse el mensaje. En web no hay a qué caer, y
  // por eso el log de arriba nunca sobra.
  if (id === null && Platform.OS !== 'web' && String(title || '').trim()) {
    Alert.alert(title, message);
  }
}
