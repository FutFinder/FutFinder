/**
 * Pruebas del catálogo de servicios.
 *
 * Lo importante acá es que el catálogo del cliente diga lo mismo que el CHECK
 * de Postgres: si se separan, la pantalla ofrece un servicio que el servidor
 * rechaza. Esta prueba no puede leer Postgres, así que fija la lista exacta —
 * si alguien la cambia sin tocar la migración, falla y se entera acá.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SERVICIOS, nombreDeServicio, servicioValido, nombresDeServicios,
} = require('../serviciosRecinto.js');

test('el catálogo es exactamente el que acepta el CHECK de la migración 75', () => {
  assert.deepEqual(SERVICIOS.map((s) => s.clave), [
    'estacionamiento', 'camarines', 'duchas', 'banos', 'quincho',
    'iluminacion', 'arriendo_balon', 'kiosco', 'graderias', 'wifi',
  ]);
});

test('nombreDeServicio traduce, y no revienta con uno desconocido', () => {
  assert.equal(nombreDeServicio('arriendo_balon'), 'Arriendo de balón');
  assert.equal(nombreDeServicio('banos'), 'Baños');
  assert.equal(nombreDeServicio('piscina_climatizada'), 'piscina climatizada');
  assert.equal(nombreDeServicio(null), '');
});

test('servicioValido es la misma puerta que el servidor', () => {
  assert.equal(servicioValido('quincho'), true);
  assert.equal(servicioValido('piscina'), false);
});

test('nombresDeServicios usa el orden del CATÁLOGO, no el de la base', () => {
  // Dos recintos con los mismos servicios tienen que mostrarlos igual.
  assert.deepEqual(
    nombresDeServicios(['wifi', 'camarines', 'estacionamiento']),
    ['Estacionamiento', 'Camarines', 'WiFi'],
  );
});

test('nombresDeServicios descarta lo que no reconoce en vez de romperse', () => {
  // Si el servidor agrega un servicio nuevo, una app vieja muestra los que
  // entiende y sigue funcionando.
  assert.deepEqual(nombresDeServicios(['quincho', 'helipuerto']), ['Quincho']);
  assert.deepEqual(nombresDeServicios([]), []);
  assert.deepEqual(nombresDeServicios(null), []);
});
