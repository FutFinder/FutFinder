/**
 * Helpers de navegación.
 */

/**
 * Vuelve atrás, o cae a la pestaña Partidos si no hay historial.
 *
 * Hace falta desde que los enlaces compartidos (`futfinder.cl/p/<id>`) abren el
 * detalle directamente: en ese caso la pila no tiene una pantalla anterior y un
 * `goBack()` a secas no hace nada (React Navigation avisa «GO_BACK was not
 * handled by any navigator»).
 */
export function goBackOrPartidos(navigation) {
  if (navigation.canGoBack()) {
    navigation.goBack();
    return;
  }
  navigation.navigate('Main', { screen: 'SearchTab' });
}
