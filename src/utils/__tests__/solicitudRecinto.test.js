/**
 * Pruebas del formulario con que un recinto pide sumarse a FutFinder.
 *
 * Lo que se prueba acá es sobre todo que no se mande una solicitud con la que
 * después no se pueda hacer nada: sin teléfono no hay a quién llamar, y sin
 * dirección exacta no se sabe qué recinto es. El campo libre, las fotos y los
 * servicios SÍ son opcionales a propósito — son lo único que no bloquea el
 * envío (migración 110).
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  correoValido,
  canchasValidas,
  serviciosLimpios,
  rutasDeFotos,
  camposFaltantes,
  solicitudLista,
  comoSolicitud,
  MAX_FOTOS,
} = require('../solicitudRecinto.js');

const COMPLETA = {
  nombreRecinto: 'FutCenter Maipú',
  direccion: 'Av. El Rosal 6281',
  comuna: 'Maipú',
  nCanchas: '6',
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

test('camposFaltantes: el campo libre, las fotos y los servicios no bloquean', () => {
  // Es la decisión de la 110: nadie tiene las fotos del recinto a mano
  // siempre, y exigirlas convertiría un formulario de dos minutos en una tarea
  // para otro día.
  assert.deepEqual(camposFaltantes({ ...COMPLETA, mensaje: '' }), []);
  assert.deepEqual(camposFaltantes({ ...COMPLETA, mensaje: undefined }), []);
  assert.deepEqual(camposFaltantes({ ...COMPLETA, fotos: [], servicios: [] }), []);
  assert.deepEqual(camposFaltantes({ ...COMPLETA, fotos: undefined, servicios: undefined }), []);
});

test('camposFaltantes enumera lo que falta, en el orden de la pantalla', () => {
  assert.deepEqual(
    camposFaltantes({}),
    ['nombreRecinto', 'direccion', 'comuna', 'nCanchas', 'nombreDueno', 'telefono', 'correo'],
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

test('canchasValidas: un entero entre 1 y 60, y nada más', () => {
  assert.equal(canchasValidas('1'), true);
  assert.equal(canchasValidas('60'), true);
  assert.equal(canchasValidas(' 6 '), true, 'se recorta');
  assert.equal(canchasValidas('0'), false, 'un recinto sin canchas no es un recinto');
  assert.equal(canchasValidas('61'), false);
  assert.equal(canchasValidas(''), false);
  // `Number('3.5')` es 3.5 y pasaría por «número»: por eso se valida el texto.
  assert.equal(canchasValidas('3.5'), false);
  assert.equal(canchasValidas('seis'), false);
  assert.equal(canchasValidas(null), false);
});

test('camposFaltantes: cuántas canchas es obligatorio', () => {
  assert.deepEqual(camposFaltantes({ ...COMPLETA, nCanchas: '' }), ['nCanchas']);
  assert.deepEqual(camposFaltantes({ ...COMPLETA, nCanchas: '0' }), ['nCanchas']);
  assert.deepEqual(camposFaltantes({ ...COMPLETA, nCanchas: 6 }), [], 'un número también sirve');
});

test('serviciosLimpios deja solo el catálogo, sin repetidos y en su orden', () => {
  // El orden es el del catálogo y no el de los toques: así dos solicitudes con
  // los mismos servicios se leen igual en la bandeja del equipo.
  assert.deepEqual(serviciosLimpios(['quincho', 'estacionamiento']), ['estacionamiento', 'quincho']);
  assert.deepEqual(serviciosLimpios(['duchas', 'duchas']), ['duchas']);
  assert.deepEqual(serviciosLimpios(['helipuerto']), [], 'lo que el servidor rechazaría no sale de acá');
  assert.deepEqual(serviciosLimpios(null), []);
});

test('rutasDeFotos se queda con la ruta y respeta el tope', () => {
  // La pantalla maneja `{ path, uri }` —`uri` es la copia local que se muestra
  // mientras se llena el formulario— y solo la ruta viaja.
  assert.deepEqual(
    rutasDeFotos([{ path: 'uid/a.jpg', uri: 'file:///tmp/a.jpg' }, 'uid/b.jpg']),
    ['uid/a.jpg', 'uid/b.jpg'],
  );
  assert.deepEqual(rutasDeFotos([{ uri: 'file:///tmp/a.jpg' }]), [], 'sin ruta no se subió');
  assert.equal(rutasDeFotos(new Array(9).fill('uid/a.jpg')).length, MAX_FOTOS);
  assert.deepEqual(rutasDeFotos(null), []);
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
    nCanchas: ' 6 ',
    nombreDueno: ' Vicente Bastías ',
    telefono: '9 8765 4321',
    correo: '  Contacto@FutCenter.CL ',
    mensaje: '  Seis canchas de fútbol 7  ',
    fotos: [{ path: 'uid/a.jpg', uri: 'file:///tmp/a.jpg' }],
    servicios: ['quincho', 'estacionamiento', 'helipuerto'],
  });

  assert.deepEqual(payload, {
    nombreRecinto: 'FutCenter Maipú',
    direccion: 'Av. El Rosal 6281',
    comuna: 'Maipú',
    nombreDueno: 'Vicente Bastías',
    telefono: '+56987654321',
    correo: 'contacto@futcenter.cl',
    mensaje: 'Seis canchas de fútbol 7',
    nCanchas: 6,
    fotos: ['uid/a.jpg'],
    servicios: ['estacionamiento', 'quincho'],
  });
});

test('comoSolicitud manda las canchas como número, no como texto', () => {
  // El servidor recibe un `int`: mandar '6' lo haría fallar por tipo, no por
  // dato, y el error se leería como «revisa los datos» sin decir cuál.
  assert.strictEqual(comoSolicitud(COMPLETA).nCanchas, 6);
});

test('comoSolicitud manda arreglos vacíos cuando no hay fotos ni servicios', () => {
  // Vacío y no `null`: la columna es `not null default '{}'`, y un arreglo
  // vacío dice «no marcó nada» sin necesidad de un caso especial.
  const payload = comoSolicitud(COMPLETA);
  assert.deepEqual(payload.fotos, []);
  assert.deepEqual(payload.servicios, []);
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
