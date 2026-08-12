// Extensión `.js` explícita en las dos: `node --test` carga estos módulos
// directamente, sin el resolvedor de Metro, y un import sin extensión no
// resuelve. Es la misma razón por la que `challengeThread.js` la lleva.
import { coordenadasValidas } from '../services/clubChallengeRules.js';
import { matchComuna } from '../data/regiones-chile.js';

/**
 * La ubicación de la propuesta oficial: dirección, cancha, comuna, región y
 * el punto en el mapa.
 *
 * POR QUÉ ES UN MÓDULO Y NO CUATRO `useState` con la lógica en el JSX.
 *
 * `LocationAutocomplete.pick()` no llama un callback, llama DOS y en un orden
 * fijo: primero `onSelect(...)` con el lugar elegido y justo después
 * `onChangeText(direccionElegida)`, haciendo eco del texto. La pantalla
 * borraba las coordenadas en cada `onChangeText` —para que editar la dirección
 * a mano invalidara el punto—, así que ese eco las borraba en el mismo
 * instante en que se acababan de elegir: el usuario elegía la cancha y el
 * formulario seguía pidiéndole que la eligiera.
 *
 * Escrito en línea dentro del JSX, ese error no lo alcanzaba ninguna prueba, y
 * además los manejadores leían el estado por closure, así que dentro del mismo
 * tick veían un valor rancio. Acá las dos transiciones son funciones puras que
 * reciben el estado anterior y devuelven el siguiente, y se aplican con la
 * forma funcional de `setState`. Así el resultado no depende del orden en que
 * el componente dispare los callbacks, y la secuencia real se puede probar.
 *
 * LA REGLA: las coordenadas valen mientras el texto de la dirección sea
 * EXACTAMENTE aquel del que salieron. Por eso `coords` se guarda junto con su
 * dirección de origen, en vez de tener una bandera aparte que haya que
 * acordarse de bajar.
 */

export const UBICACION_VACIA = Object.freeze({
  direccion: '',
  canchaNombre: '',
  comuna: '',
  region: '',
  /** `{ lat, lng, direccion }` o `null`. La dirección es la de origen. */
  coords: null,
});

/**
 * El usuario eligió una sugerencia del buscador.
 *
 * Rellena lo que el buscador sabe y respeta lo que el usuario ya había puesto:
 * una cancha escrita a mano no se pisa, y una comuna que el buscador no
 * reconoce no borra la que ya estaba.
 */
export function seleccionarLugar(estado = UBICACION_VACIA, seleccion = {}) {
  const base = estado || UBICACION_VACIA;
  const { lat, lng, address, comunaRaw, regionRaw, canchaName } = seleccion || {};

  const direccion = address || base.direccion;
  const zona = matchComuna(comunaRaw) || matchComuna(regionRaw);

  return {
    ...base,
    direccion,
    // Se ata el punto a la dirección de la que salió. Si la sugerencia no
    // trae coordenadas usables, quedan en null: NO se conservan las de una
    // selección anterior, porque describirían otro lugar.
    coords: coordenadasValidas(lat, lng) ? { lat, lng, direccion } : null,
    comuna: zona ? zona.comuna : base.comuna,
    region: zona ? zona.region : base.region,
    canchaNombre:
      canchaName && !String(base.canchaNombre || '').trim() ? canchaName : base.canchaNombre,
  };
}

/**
 * Cambió el texto de la dirección.
 *
 * Lo dispara tanto el teclado del usuario como el eco del propio componente
 * tras elegir una sugerencia, y desde acá no hay forma de distinguirlos —ni
 * hace falta: lo que decide es si el texto sigue siendo el de las coordenadas
 * que hay guardadas. Si lo es, era el eco (o el usuario dejó la dirección tal
 * cual) y el punto sigue valiendo. Si no, la dirección ya describe otro lugar
 * y el punto deja de valer.
 */
export function escribirDireccion(estado = UBICACION_VACIA, texto = '') {
  const base = estado || UBICACION_VACIA;
  return {
    ...base,
    direccion: texto,
    coords: base.coords && base.coords.direccion === texto ? base.coords : null,
  };
}

/** `true` si hay un punto en el mapa que corresponde a la dirección escrita. */
export function ubicacionFijada(estado) {
  const c = estado?.coords;
  return !!c && coordenadasValidas(c.lat, c.lng) && c.direccion === estado.direccion;
}

/**
 * Los campos de ubicación tal como los espera `validarPropuestaOficial` y,
 * detrás, `propuestaOficialPayload`. Traducir a mano en la pantalla es donde
 * un nombre mal puesto se convierte en un campo que llega vacío al servidor.
 */
export function ubicacionDraft(estado) {
  const fijada = ubicacionFijada(estado);
  const base = estado || UBICACION_VACIA;
  return {
    direccion: base.direccion,
    canchaNombre: base.canchaNombre,
    comuna: base.comuna,
    region: base.region,
    latitud: fijada ? base.coords.lat : null,
    longitud: fijada ? base.coords.lng : null,
  };
}
