/**
 * El catálogo de servicios de un recinto (migración 75).
 *
 * ES UNA LISTA FIJA Y NO TEXTO LIBRE. Con texto libre un recinto escribe
 * «Estacionamiento», otro «estacionamientos» y un tercero «parking», y el día
 * que se quiera filtrar por «con estacionamiento» no se puede. El costo es
 * que sumar uno nuevo necesita tocar dos lugares —este archivo y el CHECK de
 * la tabla— y está bien: son diez y no cambian seguido.
 *
 * ESTE ARCHIVO Y EL CHECK DE POSTGRES TIENEN QUE DECIR LO MISMO. Si se
 * separan, la pantalla ofrece un servicio que el servidor rechaza. La prueba
 * de abajo no puede comprobar Postgres desde acá, así que la regla es: se
 * cambian juntos, en la misma migración.
 */

export const SERVICIOS = [
  { clave: 'estacionamiento', nombre: 'Estacionamiento' },
  { clave: 'camarines', nombre: 'Camarines' },
  { clave: 'duchas', nombre: 'Duchas' },
  { clave: 'banos', nombre: 'Baños' },
  { clave: 'quincho', nombre: 'Quincho' },
  { clave: 'iluminacion', nombre: 'Iluminación' },
  { clave: 'arriendo_balon', nombre: 'Arriendo de balón' },
  { clave: 'kiosco', nombre: 'Kiosco' },
  { clave: 'graderias', nombre: 'Graderías' },
  { clave: 'wifi', nombre: 'WiFi' },
];

const POR_CLAVE = new Map(SERVICIOS.map((s) => [s.clave, s]));

/** 'arriendo_balon' → 'Arriendo de balón'. Uno desconocido se devuelve legible. */
export function nombreDeServicio(clave) {
  return POR_CLAVE.get(clave)?.nombre || String(clave || '').replace(/_/g, ' ');
}

/** ¿Está en el catálogo? Es lo mismo que valida el servidor. */
export function servicioValido(clave) {
  return POR_CLAVE.has(clave);
}

/**
 * Las claves guardadas, traducidas a nombres y en el orden del catálogo.
 *
 * El orden del catálogo y no el de la base: así dos recintos con los mismos
 * servicios los muestran en el mismo orden, y la ficha se lee igual siempre.
 * Descarta en silencio lo que no reconoce — si algún día el servidor devuelve
 * un servicio nuevo, la app vieja muestra los que entiende en vez de romperse.
 */
export function nombresDeServicios(claves = []) {
  const puestas = new Set(claves || []);
  return SERVICIOS.filter((s) => puestas.has(s.clave)).map((s) => s.nombre);
}
