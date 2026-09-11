/**
 * Pruebas del formulario con que un recinto pide sumarse a FutFinder.
 *
 * Lo que se prueba acá es sobre todo que no se mande una solicitud con la que
 * después no se pueda hacer nada: sin teléfono no hay a quién llamar, y sin
 * dirección exacta no se sabe qué recinto es. El campo libre SÍ es opcional a
 * propósito — es la única parte que no bloquea el envío.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  correoValido,
  camposFaltantes,
  solicitudLista,
  comoSolicitud,
} = require('../solicitudRecinto.js');

const COMPLETA = {
  nombreRecinto: 'FutCenter Maipú',
  direccion: 'Av. El Rosal 6281',
  comuna: 'Maipú',
  nombreDueno: 'Vicente Bastías',
  telefono: '9 8765 4321',
  correo: 'contacto@futcenter.cl',
  mensaje: '',
};

test('correoValido pide algo que de verdad se pueda responder', () => {
  assert.equal(correoValido('contacto@futcenter.cl'), true);
  assert.equal(correoValido('  Contacto@FutCenter.CL  '), true, 'se recorta y no distingue mayúsculas');
  assert.equal(correoValido('contacto@futcenter'), false, 'sin dominio no llega a ninguna parte');
  assert.equal(correoValido('futcenter.cl'), false);
  assert.equal(correoValido('con espacio@futcenter.cl'), false);
  assert.equal(correoValido(''), false);
  assert.equal(correoValido(null), false);
});

test('camposFaltantes: una solicitud completa no tiene faltantes', () => {
  assert.deepEqual(camposFaltantes(COMPLETA), []);
});

test('camposFaltantes: el campo libre es lo único que no bloquea', () => {
  assert.deepEqual(camposFaltantes({ ...COMPLETA, mensaje: '' }), []);
  assert.deepEqual(camposFaltantes({ ...COMPLETA, mensaje: undefined }), []);
});

test('camposFaltantes enumera lo que falta, en el orden de la pantalla', () => {
  assert.deepEqual(
    camposFaltantes({}),
    ['nombreRecinto', 'direccion', 'comuna', 'nombreDueno', 'telefono', 'correo'],
  );
});

test('camposFaltantes: el teléfono es obligatorio y tiene que ser un móvil', () => {
  // A diferencia del contacto de un bloqueo, acá vacío NO sirve: la solicitud
  // existe para poder llamar al recinto.
  assert.deepEqual(camposFaltantes({ ...COMPLETA, telefono: '' }), ['telefono']);
  assert.deepEqual(camposFaltantes({ ...COMPLETA, telefono: '221234567' }), ['telefono'], 'un fijo no sirve');
  assert.deepEqual(camposFaltantes({ ...COMPLETA, telefono: '+56 9 8765 4321' }), []);
});

test('camposFaltantes: un nombre o una dirección de una letra no son un dato', () => {
  assert.deepEqual(camposFaltantes({ ...COMPLETA, nombreRecinto: 'F' }), ['nombreRecinto']);
  assert.deepEqual(camposFaltantes({ ...COMPLETA, direccion: '  ' }), ['direccion']);
  assert.deepEqual(camposFaltantes({ ...COMPLETA, nombreDueno: 'V' }), ['nombreDueno']);
});

test('solicitudLista solo es verdadera cuando no falta nada', () => {
  assert.equal(solicitudLista(COMPLETA), true);
  assert.equal(solicitudLista({ ...COMPLETA, correo: 'nope' }), false);
  assert.equal(solicitudLista(null), false);
});

test('comoSolicitud normaliza lo que se escribió a mano', () => {
  const payload = comoSolicitud({
    nombreRecinto: '  FutCenter Maipú  ',
    direccion: ' Av. El Rosal 6281 ',
    comuna: ' Maipú ',
    nombreDueno: ' Vicente Bastías ',
    telefono: '9 8765 4321',
    correo: '  Contacto@FutCenter.CL ',
    mensaje: '  Seis canchas de fútbol 7  ',
  });

  assert.deepEqual(payload, {
    nombreRecinto: 'FutCenter Maipú',
    direccion: 'Av. El Rosal 6281',
    comuna: 'Maipú',
    nombreDueno: 'Vicente Bastías',
    telefono: '+56987654321',
    correo: 'contacto@futcenter.cl',
    mensaje: 'Seis canchas de fútbol 7',
  });
});

test('comoSolicitud manda el campo libre vacío como null, no como cadena vacía', () => {
  // El servidor guarda `null` cuando no hay nada que contar; mandar '' dejaría
  // filas que parecen tener mensaje y no lo tienen.
  assert.equal(comoSolicitud({ ...COMPLETA, mensaje: '   ' }).mensaje, null);
  assert.equal(comoSolicitud(COMPLETA).mensaje, null);
});

test('comoSolicitud devuelve null si la solicitud no está lista', () => {
  // Nunca se arma un payload a medias: el que llama no tiene que acordarse de
  // validar antes.
  assert.equal(comoSolicitud({ ...COMPLETA, telefono: '221234567' }), null);
  assert.equal(comoSolicitud(null), null);
});
