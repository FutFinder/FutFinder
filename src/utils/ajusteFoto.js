/**
 * Ajustar una foto antes de subirla: agrandarla, achicarla y moverla dentro
 * de un recuadro con la proporción de destino (1:1 el logo y la foto de
 * perfil, 16:9 los banners).
 *
 * POR QUÉ EXISTE. En la app nativa el selector del sistema ya recorta con
 * zoom (`allowsEditing`), pero en la web —futfinder.cl, que es como hoy se usa
 * FutFinder, también desde el teléfono— el selector es un `<input
 * type="file">` sin editor: la foto se subía entera y se mostraba recortada
 * por el centro, sin que nadie eligiera qué parte quedaba.
 *
 * EL ESTADO ES EL CENTRO Y EL ZOOM. `{ zoom, cx, cy }`, con el centro en
 * píxeles de la foto original. Con zoom 1 el recuadro es el más grande que
 * cabe (lo mismo que `recorteParaProporcion` de `encuadre.js`); con zoom 2 es
 * la mitad de cada lado. Mover cambia el centro; agrandar cambia el zoom sin
 * mover el centro. Cada cambio se «normaliza» para que el recuadro nunca
 * salga de la foto: no hay fondo vacío que subir.
 *
 * LO QUE SE VE ES LO QUE SE GUARDA. `dibujoEnCaja` no tiene una cuenta
 * propia: sale del mismo `recorteDeAjuste` que se le pasa a
 * `expo-image-manipulator`. La prueba compara los dos.
 *
 * Sin React ni React Native, para poder probarlo en Node.
 */

/** Hasta dónde se puede agrandar: más allá la foto queda pixelada. */
export const ZOOM_MAXIMO = 4;

const valido = (n) => Number.isFinite(n) && n > 0;
const entre = (n, min, max) => Math.min(max, Math.max(min, n));

/** El recuadro más grande con la proporción pedida que cabe en la foto. */
function recuadroBase(ancho, alto, proporcion) {
  if (ancho / alto > proporcion) return { w: alto * proporcion, h: alto };
  return { w: ancho, h: ancho / proporcion };
}

/** Sin tocar nada: zoom 1, por el centro. */
export function ajusteInicial(ancho, alto) {
  return { zoom: 1, cx: (Number(ancho) || 0) / 2, cy: (Number(alto) || 0) / 2 };
}

/** El zoom dentro de 1..ZOOM_MAXIMO; cualquier basura vuelve a 1. */
function zoomValido(zoom) {
  const z = Number(zoom);
  return Number.isFinite(z) ? entre(z, 1, ZOOM_MAXIMO) : 1;
}

/** El recuadro sin redondear, ya metido dentro de la foto. */
function recuadro(ancho, alto, proporcion, ajuste) {
  const base = recuadroBase(ancho, alto, proporcion);
  const zoom = zoomValido(ajuste?.zoom);
  const w = base.w / zoom;
  const h = base.h / zoom;
  const cx = Number.isFinite(ajuste?.cx) ? ajuste.cx : ancho / 2;
  const cy = Number.isFinite(ajuste?.cy) ? ajuste.cy : alto / 2;
  return {
    x: entre(cx - w / 2, 0, ancho - w),
    y: entre(cy - h / 2, 0, alto - h),
    w,
    h,
    zoom,
  };
}

/** Deja el ajuste con el centro que de verdad queda tras meterlo en la foto. */
function normalizar(ancho, alto, proporcion, ajuste) {
  const r = recuadro(ancho, alto, proporcion, ajuste);
  return { zoom: r.zoom, cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
}

/**
 * El rectángulo a conservar, en píxeles enteros de la foto original, tal como
 * lo espera `expo-image-manipulator` (`originX`, `originY`, `width`,
 * `height`). `null` si la foto no tiene medidas.
 */
export function recorteDeAjuste(ancho, alto, proporcion, ajuste) {
  if (!valido(ancho) || !valido(alto) || !valido(proporcion)) return null;
  const r = recuadro(ancho, alto, proporcion, ajuste);
  const width = Math.max(1, Math.round(r.w));
  const height = Math.max(1, Math.round(r.h));
  return {
    originX: entre(Math.round(r.x), 0, ancho - width),
    originY: entre(Math.round(r.y), 0, alto - height),
    width,
    height,
  };
}

/** Agrandar o achicar sin mover el centro. */
export function ajusteConZoom(ajuste, zoom, ancho, alto, proporcion) {
  if (!valido(ancho) || !valido(alto) || !valido(proporcion)) return ajusteInicial(ancho, alto);
  return normalizar(ancho, alto, proporcion, { ...(ajuste || ajusteInicial(ancho, alto)), zoom: zoomValido(zoom) });
}

/**
 * Después de arrastrar `dx`, `dy` píxeles de pantalla sobre una caja de
 * `anchoCaja` píxeles de ancho.
 *
 * El signo va al revés del dedo: arrastrar la foto hacia la derecha muestra
 * más de su lado izquierdo, como cualquier recortador. Se calcula siempre
 * desde el ajuste del comienzo del gesto, no acumulando, para que no derive.
 */
export function ajusteTrasArrastre(ajuste, dx, dy, anchoCaja, ancho, alto, proporcion) {
  if (!valido(ancho) || !valido(alto) || !valido(proporcion)) return ajusteInicial(ancho, alto);
  const inicial = ajuste || ajusteInicial(ancho, alto);
  if (!valido(anchoCaja)) return normalizar(ancho, alto, proporcion, inicial);
  const r = recuadro(ancho, alto, proporcion, inicial);
  const pixelesDeFotoPorPunto = r.w / anchoCaja;
  return normalizar(ancho, alto, proporcion, {
    zoom: r.zoom,
    cx: r.x + r.w / 2 - (Number(dx) || 0) * pixelesDeFotoPorPunto,
    cy: r.y + r.h / 2 - (Number(dy) || 0) * pixelesDeFotoPorPunto,
  });
}

/**
 * Cómo dibujar la foto dentro de la caja para mostrar EXACTAMENTE el recorte:
 * tamaño y corrimiento en porcentajes de la caja, que es lo que aceptan
 * `width`, `height`, `left` y `top` sin tener que medir nada.
 */
export function dibujoEnCaja(ancho, alto, proporcion, ajuste) {
  const r = recorteDeAjuste(ancho, alto, proporcion, ajuste);
  if (!r) return { ancho: '100%', alto: '100%', x: '0%', y: '0%' };
  const pc = (n) => `${Number(n.toFixed(6))}%`;
  return {
    ancho: pc((100 * ancho) / r.width),
    alto: pc((100 * alto) / r.height),
    x: pc((-100 * r.originX) / r.width),
    y: pc((-100 * r.originY) / r.height),
  };
}

/** El zoom al pellizcar: crece en la misma proporción que la distancia entre los dedos. */
export function zoomPorPellizco(zoomInicio, distanciaInicio, distanciaAhora) {
  if (!valido(distanciaInicio) || !valido(distanciaAhora)) return zoomInicio;
  return zoomInicio * (distanciaAhora / distanciaInicio);
}
