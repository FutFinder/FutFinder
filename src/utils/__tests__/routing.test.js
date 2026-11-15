/**
 * Pruebas de la ruta inicial (Splash): qué pantalla ve alguien con sesión
 * completa, con sesión a medio onboarding, y sin sesión — las tres rutas
 * "privadas vs. públicas" que decide el arranque de la app.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { getInitialRouteName, isPrivateRoute, rutasTrasEntrar } = require('../routing.js');

test('getInitialRouteName: con sesión y onboarding completo, va a la ruta privada Main', () => {
  assert.equal(getInitialRouteName(true), 'Main');
});

test('getInitialRouteName: con sesión pero onboarding a medias, continúa el onboarding (no es la app completa)', () => {
  assert.equal(getInitialRouteName(false), 'LocationPermission');
});

test('getInitialRouteName: sin sesión, va a la ruta pública Welcome', () => {
  assert.equal(getInitialRouteName(null), 'Welcome');
});

test('getInitialRouteName: estado de sesión aún no resuelto (undefined) nunca cae en Main — el default es público', () => {
  assert.equal(getInitialRouteName(undefined), 'Welcome');
});

test('getInitialRouteName: un valor inesperado (no true/false/null) tampoco cae en una ruta privada', () => {
  assert.equal(getInitialRouteName('algo-raro'), 'Welcome');
  assert.equal(getInitialRouteName(0), 'Welcome');
  assert.equal(getInitialRouteName({}), 'Welcome');
});

test('isPrivateRoute: Main y LocationPermission requieren sesión', () => {
  assert.equal(isPrivateRoute('Main'), true);
  assert.equal(isPrivateRoute('LocationPermission'), true);
});

test('isPrivateRoute: Welcome es pública', () => {
  assert.equal(isPrivateRoute('Welcome'), false);
});

test('isPrivateRoute: consistente con lo que devuelve getInitialRouteName en cada caso de sesión', () => {
  assert.equal(isPrivateRoute(getInitialRouteName(true)), true);
  assert.equal(isPrivateRoute(getInitialRouteName(false)), true);
  assert.equal(isPrivateRoute(getInitialRouteName(null)), false);
});

test('rutasTrasEntrar: quien abrió un link de invitación sin sesión vuelve a él, con Main debajo', () => {
  const pending = { name: 'MatchDetail', params: { matchId: 'm1', inv: 'tok' } };
  assert.deepEqual(rutasTrasEntrar(pending), {
    index: 1,
    routes: [{ name: 'Main' }, { name: 'MatchDetail', params: { matchId: 'm1', inv: 'tok' } }],
  });
});

test('rutasTrasEntrar: sin destino pendiente se entra al Home', () => {
  assert.deepEqual(rutasTrasEntrar(null), { index: 0, routes: [{ name: 'Main', params: undefined }] });
  assert.deepEqual(rutasTrasEntrar({ name: 'Main', params: { screen: 'SearchTab' } }), {
    index: 0,
    routes: [{ name: 'Main', params: { screen: 'SearchTab' } }],
  });
});
