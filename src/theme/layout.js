/**
 * Medidas de disposición compartidas.
 */

/**
 * Ancho máximo de una pantalla de la app.
 *
 * Las pantallas de entrada están diseñadas sobre un teléfono de 390 px
 * (`FutFinder Inicio.dc.html`). En el build web servido en escritorio, un
 * `flex: 1` las estira a todo el ancho de la ventana y las tarjetas quedan
 * de dos mil píxeles de largo con el texto perdido a la izquierda: nada que
 * ver con el diseño. Fijar un máximo y centrar la columna deja la web como
 * el mockup.
 *
 * El valor es 430 —el ancho del iPhone más ancho— a propósito: así ningún
 * teléfono real queda con franjas a los costados y la regla solo se activa
 * donde sobra ancho (escritorio y tablets).
 */
export const PHONE_MAX_WIDTH = 430;

/**
 * Estilo para el contenedor raíz de una pantalla: la centra y le pone el
 * tope de ancho. Se combina con el `flex: 1` y el fondo propios de cada
 * pantalla — `contentStyle` del navegador ya pinta los costados de
 * `clubsExplorer.bg`, casi el mismo tono, así que la columna no se ve como
 * un recuadro pegado encima sino como el final natural del contenido.
 */
export const phoneColumn = {
  width: '100%',
  maxWidth: PHONE_MAX_WIDTH,
  alignSelf: 'center',
};
