/**
 * El formulario con que un recinto pide sumarse a FutFinder.
 *
 * Sin React y sin Supabase, igual que el resto de `utils/`: la pantalla sabe
 * dibujar y esto sabe qué es una solicitud aceptable.
 *
 * LO OBLIGATORIO ES LO QUE HACE POSIBLE LA PRIMERA LLAMADA: sin número no hay
 * a quién llamar, sin dirección exacta no se sabe qué recinto es, y sin correo
 * no hay dónde responder. `nCanchas` se sumó por lo mismo (migración 110): es
 * un número que se contesta en dos segundos y es lo que decide si el recinto
 * entra ahora o más adelante.
 *
 * LAS FOTOS Y LOS SERVICIOS SON OPCIONALES, y también a propósito. Nadie tiene
 * las fotos del recinto a mano siempre, y exigirlas convertiría un formulario
 * de dos minutos en una tarea para otro día. Lo que ayudan cuando están es
 * ahorrarse media primera llamada; lo que costarían si bloquearan es la
 * solicitud entera.
 *
 * LOS SERVICIOS SON EL CATÁLOGO CERRADO DE LA 75, no una lista aparte: lo que
 * el dueño marca acá es exactamente lo que después se guarda en la ficha del
 * recinto, así que se copia sin traducir nada.
 *
 * EL TELÉFONO SE PIDE MÓVIL, con la misma regla de `normalizaTelefonoCl` que
 * ya usa el resto del vertical. La diferencia con el contacto de un bloqueo es
 * que allá vacío también sirve —es opcional— y acá no.
 */

import { normalizaTelefonoCl } from './recintoPantallas.js';
import { SERVICIOS } from './serviciosRecinto.js';

/* Deliberadamente laxo: no valida que el dominio exista, solo que sea algo a
 * lo que se le pueda escribir. Una expresión más estricta rechaza correos
 * válidos raros y no impide ninguno falso. */
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Los campos obligatorios, en el mismo orden en que aparecen en la pantalla. */
const OBLIGATORIOS = [
  'nombreRecinto',
  'direccion',
  'comuna',
  'nCanchas',
  'nombreDueno',
  'telefono',
  'correo',
];

/**
 * Los mismos topes que el servidor (migración 110). Sesenta canchas es más del
 * doble del recinto más grande que conocemos: el tope no está para discutir un
 * caso real, sino para que un dedo apoyado en el teclado no mande un 4000.
 */
export const MAX_FOTOS = 6;
export const MAX_CANCHAS = 60;

const texto = (v) => String(v ?? '').trim();

/** ¿Es un correo al que se le puede responder? Vacío no lo es. */
export function correoValido(correo) {
  return CORREO.test(texto(correo).toLowerCase());
}

/**
 * ¿Es una cantidad de canchas creíble? Un entero entre 1 y 60.
 *
 * Se valida como texto y no con `Number`: `Number(' ')` es 0 y `Number('3a')`
 * es NaN, pero `Number('3.5')` es 3.5 y pasaría por «número». Acá lo que se
 * escribe son dígitos o no es una cantidad de canchas.
 */
export function canchasValidas(valor) {
  const t = texto(valor);
  if (!/^[0-9]{1,2}$/.test(t)) return false;
  const n = Number(t);
  return n >= 1 && n <= MAX_CANCHAS;
}

/**
 * Las claves de servicio que el servidor va a aceptar, en el orden del
 * catálogo y sin repetidas.
 *
 * Descarta en silencio lo que no reconoce —al revés que el servidor, que lo
 * rechaza— porque acá el filtro existe justamente para que nunca salga de la
 * app algo que allá sería un error.
 */
export function serviciosLimpios(lista) {
  const puestos = new Set(lista || []);
  return SERVICIOS.filter((s) => puestos.has(s.clave)).map((s) => s.clave);
}

/**
 * Las rutas de las fotos ya subidas, como mucho `MAX_FOTOS`.
 *
 * Acepta tanto rutas sueltas como los `{ path, uri }` que maneja la pantalla
 * —`uri` es la copia local que se muestra mientras se llena el formulario— y
 * se queda solo con la ruta, que es lo único que viaja.
 */
export function rutasDeFotos(fotos) {
  return (fotos || [])
    .map((f) => (typeof f === 'string' ? f : f?.path))
    .filter((p) => typeof p === 'string' && p.length > 0)
    .slice(0, MAX_FOTOS);
}

/**
 * Qué falta para poder enviar, en el orden de la pantalla.
 *
 * Devuelve claves y no mensajes: el texto de cada error vive junto al campo,
 * que es donde se lee.
 */
export function camposFaltantes(form) {
  const f = form || {};
  return OBLIGATORIOS.filter((campo) => {
    const valor = texto(f[campo]);
    if (campo === 'telefono') return normalizaTelefonoCl(valor) === null;
    if (campo === 'correo') return !correoValido(valor);
    if (campo === 'nCanchas') return !canchasValidas(valor);
    // Dos caracteres es el mismo piso que usa el servidor para los nombres del
    // vertical: una letra suelta no es un dato, es un dedo en el teclado.
    return valor.length < 2;
  });
}

/** ¿Se puede enviar? */
export function solicitudLista(form) {
  return camposFaltantes(form).length === 0;
}

/**
 * El formulario tal como lo recibe el servidor, o `null` si todavía no está
 * listo.
 *
 * Devolver `null` en vez de un payload a medias es para que quien llama no
 * tenga que acordarse de validar antes: no hay forma de mandar una solicitud
 * incompleta sin darse cuenta.
 */
export function comoSolicitud(form) {
  if (!solicitudLista(form)) return null;
  const mensaje = texto(form.mensaje);
  return {
    nombreRecinto: texto(form.nombreRecinto),
    direccion: texto(form.direccion),
    comuna: texto(form.comuna),
    nombreDueno: texto(form.nombreDueno),
    telefono: normalizaTelefonoCl(form.telefono),
    correo: texto(form.correo).toLowerCase(),
    mensaje: mensaje === '' ? null : mensaje,
    nCanchas: Number(texto(form.nCanchas)),
    fotos: rutasDeFotos(form.fotos),
    servicios: serviciosLimpios(form.servicios),
  };
}
