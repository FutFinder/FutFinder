/**
 * Pruebas del guardado temporal de la contraseña del registro.
 *
 * El registro manda un código al correo antes de que exista una contraseña
 * usable: la contraseña recién se fija después de verificar el código. Entre
 * esos dos momentos hay que sostenerla en algún lado, y ese lado tiene que
 * ser solo memoria —nunca AsyncStorage, localStorage ni parámetros de
 * navegación— y de un solo uso.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  guardarPasswordPendiente,
  consumirPasswordPendiente,
  olvidarPasswordPendiente,
} = require('../pendingSignUp.js');

test('lo guardado se recupera con el mismo correo', () => {
  guardarPasswordPendiente('jugador@futfinder.cl', 'contrasena123');
  assert.equal(consumirPasswordPendiente('jugador@futfinder.cl'), 'contrasena123');
});

test('es de un solo uso: consumir dos veces no devuelve la contraseña de nuevo', () => {
  guardarPasswordPendiente('jugador@futfinder.cl', 'contrasena123');
  assert.equal(consumirPasswordPendiente('jugador@futfinder.cl'), 'contrasena123');
  assert.equal(consumirPasswordPendiente('jugador@futfinder.cl'), null);
});

test('otro correo no puede consumir la contraseña guardada', () => {
  guardarPasswordPendiente('jugador@futfinder.cl', 'contrasena123');
  assert.equal(consumirPasswordPendiente('otro@futfinder.cl'), null);
  // La del dueño sigue disponible: un correo distinto no la borra.
  assert.equal(consumirPasswordPendiente('jugador@futfinder.cl'), 'contrasena123');
});

test('el correo se compara normalizado (mayúsculas y espacios no importan)', () => {
  guardarPasswordPendiente('  JuGaDoR@FutFinder.CL ', 'contrasena123');
  assert.equal(consumirPasswordPendiente('jugador@futfinder.cl'), 'contrasena123');
});

test('olvidar borra lo guardado (abandonar el registro no deja la contraseña en memoria)', () => {
  guardarPasswordPendiente('jugador@futfinder.cl', 'contrasena123');
  olvidarPasswordPendiente();
  assert.equal(consumirPasswordPendiente('jugador@futfinder.cl'), null);
});

test('guardar de nuevo reemplaza lo anterior: no se acumulan contraseñas en memoria', () => {
  guardarPasswordPendiente('uno@futfinder.cl', 'primera123');
  guardarPasswordPendiente('dos@futfinder.cl', 'segunda123');
  assert.equal(consumirPasswordPendiente('uno@futfinder.cl'), null);
  assert.equal(consumirPasswordPendiente('dos@futfinder.cl'), 'segunda123');
});

test('sin nada guardado, consumir devuelve null y no revienta', () => {
  olvidarPasswordPendiente();
  assert.equal(consumirPasswordPendiente('jugador@futfinder.cl'), null);
  assert.equal(consumirPasswordPendiente(null), null);
  assert.equal(consumirPasswordPendiente(undefined), null);
});

test('no se guarda nada si falta el correo o la contraseña', () => {
  olvidarPasswordPendiente();
  guardarPasswordPendiente('', 'contrasena123');
  assert.equal(consumirPasswordPendiente(''), null);
  guardarPasswordPendiente('jugador@futfinder.cl', '');
  assert.equal(consumirPasswordPendiente('jugador@futfinder.cl'), null);
});
