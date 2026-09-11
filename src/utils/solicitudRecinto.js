/**
 * El formulario con que un recinto pide sumarse a FutFinder.
 *
 * Sin React y sin Supabase, igual que el resto de `utils/`: la pantalla sabe
 * dibujar y esto sabe qué es una solicitud aceptable.
 *
 * TODO ES OBLIGATORIO SALVO EL CAMPO LIBRE, y es deliberado. Una solicitud
 * existe para que alguien del equipo pueda tomar el teléfono y llamar: sin
 * número no hay a quién llamar, sin dirección exacta no se sabe qué recinto
 * es, y sin correo no hay dónde responder. Un formulario más corto llegaría
 * más lleno y serviría menos.
 *
 * EL TELÉFONO SE PIDE MÓVIL, con la misma regla de `normalizaTelefonoCl` que
 * ya usa el resto del vertical. La diferencia con el contacto de un bloqueo es
 * que allá vacío también sirve —es opcional— y acá no.
 */

import { normalizaTelefonoCl } from './recintoPantallas.js';

/* Deliberadamente laxo: no valida que el dominio exista, solo que sea algo a
 * lo que se le pueda escribir. Una expresión más estricta rechaza correos
 * válidos raros y no impide ninguno falso. */
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Los campos obligatorios, en el mismo orden en que aparecen en la pantalla. */
const OBLIGATORIOS = [
  'nombreRecinto',
  'direccion',
  'comuna',
  'nombreDueno',
  'telefono',
  'correo',
];

const texto = (v) => String(v ?? '').trim();

/** ¿Es un correo al que se le puede responder? Vacío no lo es. */
export function correoValido(correo) {
  return CORREO.test(texto(correo).toLowerCase());
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
  };
}
