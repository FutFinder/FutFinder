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

/**
 * Manda a una pestaña dejando la pila vacía.
 *
 * `navigate('Main', { screen })` cambia la pestaña, pero si hay pantallas
 * apiladas encima —el detalle de un partido, por ejemplo— siguen ahí y el
 * botón parece no hacer nada: la pestaña cambió DEBAJO de lo que se ve. Hay
 * que sacar la pila primero.
 */
export function irAPestana(navigation, pestana) {
  if (navigation.canGoBack()) {
    const padre = navigation.getParent?.();
    if (typeof navigation.popToTop === 'function') navigation.popToTop();
    else if (padre && typeof padre.popToTop === 'function') padre.popToTop();
    else navigation.goBack();
  }
  navigation.navigate('Main', { screen: pestana });
}
