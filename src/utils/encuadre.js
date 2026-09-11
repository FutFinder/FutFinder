/**
 * Qué parte de una foto se queda cuando la caja donde va no tiene su misma
 * proporción.
 *
 * NADIE SACA FOTOS DE 16:9. Una cámara de teléfono da 4:3 acostada o 3:4
 * parada, así que casi siempre sobra alto y hay que sacarle algo. El recorte
 * en sí no es el problema — el problema es que lo decida el programa por su
 * cuenta y se quede justo con la parte que no importa.
 *
 * EL RECORTE TIENE UN SOLO GRADO DE LIBERTAD. El rectángulo que se conserva
 * siempre ocupa todo el ancho (o todo el alto) y tiene la proporción de
 * destino, así que lo único que hay que decidir es DÓNDE queda: un número
 * entre 0 y 1. Por eso la pantalla puede ofrecer arrastrar la foto y tres
 * atajos, y las dos cosas escriben en la misma variable.
 */

/** Extremos y centro. Son los atajos, no las únicas posiciones posibles. */
export const POSICIONES = [
  { clave: 'inicio', valor: 0 },
  { clave: 'centro', valor: 0.5 },
  { clave: 'fin', valor: 1 },
];

/** Cómo se llama cada atajo según qué sobre. Es el texto que ve la persona. */
export function nombreDePosicion(clave, orientacion = 'vertical') {
  const vertical = { inicio: 'Arriba', centro: 'Centro', fin: 'Abajo' };
  const horizontal = { inicio: 'Izquierda', centro: 'Centro', fin: 'Derecha' };
  const mapa = orientacion === 'horizontal' ? horizontal : vertical;
  return mapa[clave] || mapa.centro;
}

/** Deja la posición dentro de 0..1 y convierte cualquier basura en el centro. */
export function posicionValida(posicion) {
  const n = Number(posicion);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
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
export function recorteParaProporcion(ancho, alto, proporcion, posicion = 0.5) {
  const sobra = queSobra(ancho, alto, proporcion);
  if (!sobra) return null;

  const p = posicionValida(posicion);

  if (sobra === 'vertical') {
    // La foto es más alta de lo que cabe: se recorta arriba y abajo.
    const nuevoAlto = Math.round(ancho / proporcion);
    const originY = Math.round((alto - nuevoAlto) * p);
    return { originX: 0, originY, width: ancho, height: nuevoAlto };
  }

  // La foto es más ancha: se recorta a los lados. Pasa con panorámicas.
  const nuevoAncho = Math.round(alto * proporcion);
  const originX = Math.round((ancho - nuevoAncho) * p);
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
 * por qué. En porcentajes no hay nada que medir.
 *
 * Los valores salen como cadenas con `%` porque es lo que esperan `width`,
 * `height`, `top` y `left` de React Native.
 */
export function encuadreEnCaja(ancho, alto, proporcion, posicion = 0.5) {
  const entera = { ancho: '100%', alto: '100%', x: '0%', y: '0%' };
  if (!(ancho > 0) || !(alto > 0) || !(proporcion > 0)) return entera;

  const suya = ancho / alto;
  const p = posicionValida(posicion);
  const pc = (n) => `${Number(n.toFixed(4))}%`;

  if (suya < proporcion) {
    // Sobra alto: la foto se dibuja del ancho de la caja y se sube.
    const altoPct = 100 * (proporcion / suya);
    return { ancho: '100%', alto: pc(altoPct), x: '0%', y: pc(-(altoPct - 100) * p) };
  }
  if (suya > proporcion) {
    const anchoPct = 100 * (suya / proporcion);
    return { ancho: pc(anchoPct), alto: '100%', x: pc(-(anchoPct - 100) * p), y: '0%' };
  }
  return entera;
}

/**
 * La misma cuenta que `encuadreEnCaja` pero en fracciones sueltas, para poder
 * comprobar en una prueba que lo que se ve es lo que se guarda. Si estas dos
 * cuentas se separan, la persona elige una cosa y se guarda otra.
 */
export function fraccionVisible(ancho, alto, proporcion, posicion) {
  const e = encuadreEnCaja(ancho, alto, proporcion, posicion);
  const num = (t) => parseFloat(t);
  if (num(e.alto) > 100) return { desde: -num(e.y) / num(e.alto), largo: 100 / num(e.alto) };
  if (num(e.ancho) > 100) return { desde: -num(e.x) / num(e.ancho), largo: 100 / num(e.ancho) };
  return { desde: 0, largo: 1 };
}

/**
 * Cuántos píxeles de foto hay fuera de la caja, o sea cuánto se puede
 * arrastrar.
 *
 * Es lo ÚNICO que necesita medir la caja, y solo hace falta para el arrastre:
 * el gesto viene en píxeles de pantalla y hay que traducirlo a una fracción.
 * Devuelve 0 cuando no hay nada que mover o cuando todavía no se midió, y con
 * 0 el arrastre simplemente no hace nada — los atajos siguen funcionando.
 */
export function recorridoDeArrastre(ancho, alto, proporcion, ladoCaja) {
  if (!(ladoCaja > 0)) return 0;
  const f = fraccionVisible(ancho, alto, proporcion, 0.5);
  if (!(f.largo < 1)) return 0;
  return ladoCaja / f.largo - ladoCaja;
}

/**
 * La posición nueva después de arrastrar.
 *
 * El signo va al revés de lo que uno escribiría: arrastrar la foto HACIA
 * ABAJO muestra la parte de ARRIBA, que es como se comporta cualquier
 * recortador. Con `recorrido` en 0 devuelve la posición sin tocar, así que
 * una caja sin medir no mueve nada en vez de saltar al extremo.
 */
export function posicionTrasArrastre(posicionInicial, desplazamiento, recorrido) {
  const inicial = posicionValida(posicionInicial);
  if (!(recorrido > 0) || !Number.isFinite(desplazamiento)) return inicial;
  return posicionValida(inicial - desplazamiento / recorrido);
}

/** La proporción de las cajas grandes del vertical. Una sola, y en un lugar. */
export const PROPORCION_PORTADA = 16 / 9;
