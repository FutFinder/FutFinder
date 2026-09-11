/**
 * Qué parte de una foto se queda cuando la caja donde va no tiene su misma
 * proporción.
 *
 * NADIE SACA FOTOS DE 16:9. Una cámara de teléfono da 4:3 acostada o 3:4
 * parada, así que casi siempre sobra alto y hay que sacarle algo. El recorte
 * en sí no es el problema — el problema es que lo decida el programa por su
 * cuenta y se quede justo con la parte que no importa.
 *
 * Por eso esto devuelve el rectángulo y no lo aplica: la pantalla muestra las
 * tres opciones, la persona elige, y recién ahí se recorta. Y por eso está
 * acá y no adentro del componente: es aritmética con casos de borde (fotos ya
 * proporcionadas, fotos panorámicas, medidas ausentes) y se prueba sin
 * levantar nada.
 */

/** Las tres partes que se pueden conservar. Vale para alto y para ancho. */
export const ANCLAJES = ['inicio', 'centro', 'fin'];

/** Cómo se llama cada una según qué sobre. Es el texto que ve la persona. */
export function nombreDeAnclaje(anclaje, orientacion = 'vertical') {
  const vertical = { inicio: 'Arriba', centro: 'Centro', fin: 'Abajo' };
  const horizontal = { inicio: 'Izquierda', centro: 'Centro', fin: 'Derecha' };
  const mapa = orientacion === 'horizontal' ? horizontal : vertical;
  return mapa[anclaje] || mapa.centro;
}

/**
 * Qué sobra: alto (la foto es más «parada» que la caja) o ancho.
 *
 * Devuelve `null` cuando no sobra nada, que es la señal de que no hay nada
 * que preguntarle a nadie.
 */
export function queSobra(ancho, alto, proporcion) {
  if (!(ancho > 0) || !(alto > 0) || !(proporcion > 0)) return null;
  const suya = ancho / alto;
  // Medio punto porcentual de tolerancia: una foto de 1920x1081 es 16:9 para
  // cualquiera que la mire, y no vale la pena hacer elegir por un píxel.
  if (Math.abs(suya - proporcion) / proporcion < 0.005) return null;
  return suya > proporcion ? 'horizontal' : 'vertical';
}

/**
 * El rectángulo que hay que conservar, en píxeles de la foto original.
 *
 * `null` si no hay que recortar. El resultado se le pasa tal cual a
 * `expo-image-manipulator`, que espera `originX`/`originY`/`width`/`height`.
 */
export function recorteParaProporcion(ancho, alto, proporcion, anclaje = 'centro') {
  const sobra = queSobra(ancho, alto, proporcion);
  if (!sobra) return null;

  const donde = ANCLAJES.includes(anclaje) ? anclaje : 'centro';

  if (sobra === 'vertical') {
    // La foto es más alta de lo que cabe: se recorta arriba y abajo.
    const nuevoAlto = Math.round(ancho / proporcion);
    const sobrante = alto - nuevoAlto;
    const originY = donde === 'inicio' ? 0
      : donde === 'fin' ? sobrante
        : Math.round(sobrante / 2);
    return { originX: 0, originY, width: ancho, height: nuevoAlto };
  }

  // La foto es más ancha: se recorta a los lados. Pasa con panorámicas.
  const nuevoAncho = Math.round(alto * proporcion);
  const sobrante = ancho - nuevoAncho;
  const originX = donde === 'inicio' ? 0
    : donde === 'fin' ? sobrante
      : Math.round(sobrante / 2);
  return { originX, originY: 0, width: nuevoAncho, height: alto };
}

/**
 * Cómo hay que dibujar la foto dentro de la caja para que la vista previa
 * muestre EXACTAMENTE lo que va a quedar guardado.
 *
 * DEVUELVE PORCENTAJES Y NO PÍXELES, a propósito. La primera versión medía la
 * caja con `onLayout` y calculaba desplazamientos en píxeles; el problema es
 * que hasta que esa medición no llega no se puede dibujar nada, y cuando no
 * llegaba —pasa dentro de un modal— la vista previa quedaba vacía sin decir
 * por qué. En porcentajes no hay nada que medir: la caja ya tiene su
 * proporción fijada y el navegador resuelve el resto.
 *
 * Los valores salen como cadenas con `%` porque es lo que esperan `width`,
 * `height`, `top` y `left` de React Native.
 */
export function encuadreEnCaja(ancho, alto, proporcion, anclaje) {
  const centrado = { ancho: '100%', alto: '100%', x: '0%', y: '0%' };
  if (!(ancho > 0) || !(alto > 0) || !(proporcion > 0)) return centrado;

  const suya = ancho / alto;
  const donde = ANCLAJES.includes(anclaje) ? anclaje : 'centro';
  const pc = (n) => `${Number(n.toFixed(4))}%`;

  if (suya < proporcion) {
    // Sobra alto: la foto se dibuja del ancho de la caja y se sube.
    const altoPct = 100 * (proporcion / suya);
    const sobrante = altoPct - 100;
    const y = donde === 'inicio' ? 0 : donde === 'fin' ? -sobrante : -sobrante / 2;
    return { ancho: '100%', alto: pc(altoPct), x: '0%', y: pc(y) };
  }
  if (suya > proporcion) {
    const anchoPct = 100 * (suya / proporcion);
    const sobrante = anchoPct - 100;
    const x = donde === 'inicio' ? 0 : donde === 'fin' ? -sobrante : -sobrante / 2;
    return { ancho: pc(anchoPct), alto: '100%', x: pc(x), y: '0%' };
  }
  return centrado;
}

/**
 * La misma cuenta que `encuadreEnCaja` pero en fracciones sueltas, para poder
 * comprobar en una prueba que lo que se ve es lo que se guarda. Si estas dos
 * cuentas se separan, la persona elige una cosa y se guarda otra.
 */
export function fraccionVisible(ancho, alto, proporcion, anclaje) {
  const e = encuadreEnCaja(ancho, alto, proporcion, anclaje);
  const num = (t) => parseFloat(t);
  if (num(e.alto) > 100) return { desde: -num(e.y) / num(e.alto), largo: 100 / num(e.alto) };
  if (num(e.ancho) > 100) return { desde: -num(e.x) / num(e.ancho), largo: 100 / num(e.ancho) };
  return { desde: 0, largo: 1 };
}

/** La proporción de las cajas grandes del vertical. Una sola, y en un lugar. */
export const PROPORCION_PORTADA = 16 / 9;
